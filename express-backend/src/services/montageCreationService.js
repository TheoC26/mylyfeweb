import { supabase } from './supabaseService.js';
import { getUpcomingSunday } from '../utils/date.js';
import { getPruningSuggestions } from './geminiService.js';
import { trimAndFormatClip, concatenateTsFiles, generateThumbnail } from './ffmpegService.js';
import { uploadBufferToS3 } from './s3Service.js';
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import fs from 'node:fs/promises';
import path from 'node:path';

const s3 = new S3Client({ region: process.env.AWS_REGION });
const MAX_DURATION_SEC = 90;

async function downloadFileFromS3(bucket, key, downloadPath) {
  console.log(`Downloading ${key} from S3 to ${downloadPath}...`);
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await s3.send(command);
  
  const stream = response.Body;
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  await fs.writeFile(downloadPath, buffer);
  console.log(`Successfully downloaded ${key}.`);
}

function getKeyFromUrl(url) {
  if (!url) return null;
  try {
    const urlObject = new URL(url);
    return urlObject.pathname.substring(1);
  } catch (error) {
    console.error('Invalid URL for key extraction:', url);
    return null;
  }
}

export async function processMontageCreation({ user }) {
  const userId = user.id;
  const tempDir = path.join('/tmp/mylyfe-montage', `${userId}-${Date.now()}`);
  const tempFiles = [];

  try {
    console.log(`[Montage] Starting montage creation for user ${userId}`);
    await fs.mkdir(tempDir, { recursive: true });

    // 1. Fetch clips from Supabase
    const upcomingSunday = getUpcomingSunday().toISOString();
    const { data: initialClips, error: fetchError } = await supabase
      .from('clips')
      .select('*')
      .eq('user_id', userId)
      .eq('week_end_date', upcomingSunday)
      .order('score', { ascending: false });

    if (fetchError) throw new Error(`Failed to fetch clips: ${fetchError.message}`);
    if (!initialClips || initialClips.length === 0) {
      console.log('[Montage] No clips found for the upcoming week. Exiting.');
      return;
    }
    console.log(`[Montage] Found ${initialClips.length} initial clips.`);

    // 2. AI Pruning
    const descriptionsForPruning = initialClips.map((clip, index) => ({
      index: index,
      description: clip.description,
    }));
    const indicesToRemove = await getPruningSuggestions(descriptionsForPruning);
    
    let clipsById = initialClips.reduce((acc, clip, index) => {
      acc[index] = clip;
      return acc;
    }, {});

    let currentDuration = initialClips.reduce((sum, clip) => sum + (clip.end_sec - clip.start_sec), 0);

    // 3. Smart Selection
    console.log(`[Montage] Starting selection. Initial duration: ${currentDuration.toFixed(2)}s`);
    if (currentDuration > MAX_DURATION_SEC) {
      // 3a. Prune based on AI suggestions
      for (const index of indicesToRemove) {
        if (clipsById[index]) {
          const clip = clipsById[index];
          currentDuration -= (clip.end_sec - clip.start_sec);
          delete clipsById[index];
          console.log(`[Montage] AI prune: Removed clip index ${index}. New duration: ${currentDuration.toFixed(2)}s`);
          if (currentDuration <= MAX_DURATION_SEC) break;
        }
      }

      // 3b. Prune based on lowest score if still over duration
      if (currentDuration > MAX_DURATION_SEC) {
        const remainingClips = Object.values(clipsById).sort((a, b) => b.score - a.score);
        while (currentDuration > MAX_DURATION_SEC && remainingClips.length > 0) {
          const removedClip = remainingClips.pop(); // Removes the lowest score
          currentDuration -= (removedClip.end_sec - removedClip.start_sec);
          // Find and delete from clipsById using the actual clip id
          const indexToDelete = Object.keys(clipsById).find(key => clipsById[key].id === removedClip.id);
          if(indexToDelete) delete clipsById[indexToDelete];
          console.log(`[Montage] Score prune: Removed clip ${removedClip.id}. New duration: ${currentDuration.toFixed(2)}s`);
        }
      }
    }
    
    let selectedClips = Object.values(clipsById);

    // 4. Final Sort
    selectedClips.sort((a, b) => new Date(a.date_uploaded) - new Date(b.date_uploaded));
    console.log(`[Montage] Final selection: ${selectedClips.length} clips with total duration ${currentDuration.toFixed(2)}s`);

    // 5. Download and Process clips
    const formattedClipPaths = [];
    for (let i = 0; i < selectedClips.length; i++) {
      const clip = selectedClips[i];
      const s3Key = getKeyFromUrl(clip.clip_url);
      if (!s3Key) continue;

      const downloadPath = path.join(tempDir, `${i}_${path.basename(s3Key)}`);
      const formattedPath = path.join(tempDir, `${i}_formatted.ts`);
      tempFiles.push(downloadPath, formattedPath);

      await downloadFileFromS3(process.env.S3_BUCKET_NAME, s3Key, downloadPath);
      await trimAndFormatClip(downloadPath, formattedPath, clip.start_sec, clip.end_sec);
      formattedClipPaths.push(formattedPath);
    }

    if (formattedClipPaths.length === 0) {
      throw new Error('No clips could be processed for the final montage.');
    }

    // 6. Concatenate and create final montage
    const montagePath = path.join(tempDir, 'final_montage.mp4');
    tempFiles.push(montagePath);
    await concatenateTsFiles(formattedClipPaths, montagePath);

    // 7. Generate thumbnail for final montage
    const montageThumbnailPath = path.join(tempDir, 'final_montage_thumb.jpg');
    tempFiles.push(montageThumbnailPath);
    await generateThumbnail(montagePath, montageThumbnailPath);

    // 8. Upload final video and thumbnail to S3
    const weekEndDate = upcomingSunday.split('T')[0];
    const uniqueId = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const montageKey = `montages/${userId}/${weekEndDate}/${uniqueId}.mp4`;
    const montageThumbKey = `montages/thumbnails/${userId}/${weekEndDate}/${uniqueId}.jpg`;

    const uploadPromises = [
      fs.readFile(montagePath).then(buffer => uploadBufferToS3(buffer, montageKey, 'video/mp4')),
      fs.readFile(montageThumbnailPath).then(buffer => uploadBufferToS3(buffer, montageThumbKey, 'image/jpeg')),
    ];
    const [montageUrl, montageThumbnailUrl] = await Promise.all(uploadPromises);
    console.log(`[Montage] Final video uploaded to ${montageUrl}`);

    // 9. Save to 'montages' table in Supabase
    const { error: insertError } = await supabase.from('montages').insert({
      user_id: userId,
      video_url: montageUrl,
      thumbnail_url: montageThumbnailUrl,
    });
    if (insertError) throw new Error(`Failed to save montage to database: ${insertError.message}`);

    console.log(`[Montage] Process complete for user ${userId}.`);

  } catch (error) {
    console.error(`[Montage] CRITICAL FAILURE for user ${userId}:`, error);
  } finally {
    // 10. Final Cleanup
    console.log(`[Montage] Cleaning up temporary directory: ${tempDir}`);
    await fs.rm(tempDir, { recursive: true, force: true }).catch(err => {
      console.error(`Failed to clean up temp directory ${tempDir}:`, err);
    });
  }
}
