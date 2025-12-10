import { supabase } from "./supabaseService.js";
import { getUpcomingSunday } from "../utils/date.js";
import { getPruningSuggestions } from "./geminiService.js";
import {
  trimAndFormatClip,
  concatenateTsFiles,
  generateThumbnail,
} from "./ffmpegService.js";
import { uploadBufferToS3 } from "./s3Service.js";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import fs from "node:fs/promises";
import path from "node:path";

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
    console.error("Invalid URL for key extraction:", url);
    return null;
  }
}

export async function processMontageCreation({ user }) {
  const userId = user.id;
  const tempDir = path.join("/tmp/mylyfe-montage", `${userId}-${Date.now()}`);
  const tempFiles = [];

  // Track the ID to update it later
  let montageId = null;

  try {
    console.log(`[Montage] Starting montage creation for user ${userId}`);
    await fs.mkdir(tempDir, { recursive: true });

    // 0. INITIALIZE STATUS: Create the row immediately as 'processing'
    const upcomingSunday = getUpcomingSunday().toISOString();

    const { data: newMontage, error: initError } = await supabase
      .from("montages")
      .insert({
        user_id: userId,
        week_end_date: upcomingSunday,
        status: "processing",
        // video_url is now nullable, so we don't include it yet
      })
      .select("id")
      .single();

    if (initError)
      throw new Error(
        `Failed to initialize montage record: ${initError.message}`
      );
    montageId = newMontage.id;
    console.log(`[Montage] Initialized record ID ${montageId} as processing.`);

    // 1. Fetch clips from Supabase
    const { data: initialClips, error: fetchError } = await supabase
      .from("clips")
      .select("*")
      .eq("user_id", userId)
      .eq("week_end_date", upcomingSunday)
      .order("score", { ascending: false });

    if (fetchError)
      throw new Error(`Failed to fetch clips: ${fetchError.message}`);

    // Handle case where no clips exist
    if (!initialClips || initialClips.length === 0) {
      console.log("[Montage] No clips found for the upcoming week. Exiting.");
      // Update status to failed (or you might want a specific 'no_clips' status)
      await supabase
        .from("montages")
        .update({ status: "failed", description: "No clips found" })
        .eq("id", montageId);
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

    let currentDuration = initialClips.reduce(
      (sum, clip) => sum + (clip.end_sec - clip.start_sec),
      0
    );

    // 3. Smart Selection
    console.log(
      `[Montage] Starting selection. Initial duration: ${currentDuration.toFixed(
        2
      )}s`
    );
    if (currentDuration > MAX_DURATION_SEC) {
      // 3a. Prune based on AI suggestions
      for (const index of indicesToRemove) {
        if (clipsById[index]) {
          const clip = clipsById[index];
          currentDuration -= clip.end_sec - clip.start_sec;
          delete clipsById[index];
          console.log(
            `[Montage] AI prune: Removed clip index ${index}. New duration: ${currentDuration.toFixed(
              2
            )}s`
          );
          if (currentDuration <= MAX_DURATION_SEC) break;
        }
      }

      // 3b. Prune based on lowest score if still over duration
      if (currentDuration > MAX_DURATION_SEC) {
        const remainingClips = Object.values(clipsById).sort(
          (a, b) => b.score - a.score
        );
        while (
          currentDuration > MAX_DURATION_SEC &&
          remainingClips.length > 0
        ) {
          const removedClip = remainingClips.pop(); // Removes the lowest score
          currentDuration -= removedClip.end_sec - removedClip.start_sec;
          // Find and delete from clipsById using the actual clip id
          const indexToDelete = Object.keys(clipsById).find(
            (key) => clipsById[key].id === removedClip.id
          );
          if (indexToDelete) delete clipsById[indexToDelete];
          console.log(
            `[Montage] Score prune: Removed clip ${
              removedClip.id
            }. New duration: ${currentDuration.toFixed(2)}s`
          );
        }
      }
    }

    let selectedClips = Object.values(clipsById);

    // 4. Final Sort
    selectedClips.sort((a, b) => new Date(a.clip_date) - new Date(b.clip_date));
    console.log(
      `[Montage] Final selection: ${
        selectedClips.length
      } clips with total duration ${currentDuration.toFixed(2)}s`
    );

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
      await trimAndFormatClip(
        downloadPath,
        formattedPath,
        clip.start_sec,
        clip.end_sec
      );
      formattedClipPaths.push(formattedPath);
    }

    if (formattedClipPaths.length === 0) {
      throw new Error("No clips could be processed for the final montage.");
    }

    // 6. Concatenate and create final montage
    const montagePath = path.join(tempDir, "final_montage.mp4");
    tempFiles.push(montagePath);
    await concatenateTsFiles(formattedClipPaths, montagePath);

    // 7. Generate thumbnail for final montage
    const montageThumbnailPath = path.join(tempDir, "final_montage_thumb.jpg");
    tempFiles.push(montageThumbnailPath);
    await generateThumbnail(montagePath, montageThumbnailPath);

    // 8. Upload final video and thumbnail to S3
    const weekEndDate = upcomingSunday.split("T")[0];
    const uniqueId = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const montageKey = `montages/${userId}/${weekEndDate}/${uniqueId}.mp4`;
    const montageThumbKey = `montages/thumbnails/${userId}/${weekEndDate}/${uniqueId}.jpg`;

    const uploadPromises = [
      fs
        .readFile(montagePath)
        .then((buffer) => uploadBufferToS3(buffer, montageKey, "video/mp4")),
      fs
        .readFile(montageThumbnailPath)
        .then((buffer) =>
          uploadBufferToS3(buffer, montageThumbKey, "image/jpeg")
        ),
    ];
    const [montageUrl, montageThumbnailUrl] = await Promise.all(uploadPromises);
    console.log(`[Montage] Final video uploaded to ${montageUrl}`);

    // 9. UPDATE STATUS: Success
    const { error: updateError } = await supabase
      .from("montages")
      .update({
        video_url: montageUrl,
        thumbnail_url: montageThumbnailUrl,
        status: "complete",
        completed_at: new Date().toISOString(),
      })
      .eq("id", montageId);

    if (updateError) {
      throw new Error(
        `Failed to update montage record: ${updateError.message}`
      );
    }

    // 10. UPDATE USER PROFILE: reset week_vids_count
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ week_vids_count: 0 })
      .eq("id", userId);

    if (profileError) {
      console.error(
        `Failed to reset week_vids_count for user ${userId}: ${profileError.message}`
      );
    } else {
      console.log(
        `[Montage] Reset week_vids_count for user ${userId} to 0.`
      );
    }


    console.log(`[Montage] Process complete for user ${userId}.`);
  } catch (error) {
    console.error(`[Montage] CRITICAL FAILURE for user ${userId}:`, error);

    // 10. UPDATE STATUS: Failed
    if (montageId) {
      await supabase
        .from("montages")
        .update({
          status: "failed",
          // Optional: You could add a 'error_message' column to your DB to store `error.message`
        })
        .eq("id", montageId)
        .catch((err) =>
          console.error("Failed to update status to failed:", err)
        );
    }
  } finally {
    // 11. Final Cleanup
    console.log(`[Montage] Cleaning up temporary directory: ${tempDir}`);
    await fs.rm(tempDir, { recursive: true, force: true }).catch((err) => {
      console.error(`Failed to clean up temp directory ${tempDir}:`, err);
    });
  }
}
