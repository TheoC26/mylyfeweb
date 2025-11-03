import { NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs/promises';
import pLimit from 'p-limit';

// Local Libs
import { analyzeVideoWithGemini } from '../../../lib/gemini';
import { ffprobeDuration } from '../../../lib/ffmpeg';
import { selectBestSegments } from '../../../lib/selection';
import { ensureDir } from '../../../lib/util';

// Service Clients
import { supabase } from '../../../lib/supabase';
import { uploadVideo, createVideoFromSegments } from '../../../lib/cloudinary';

// Helper to create a writable stream for streaming response
function createStream() {
  let controller;
  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
  });
  const writer = {
    write(data) {
      controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
    },
    close() {
      controller.close();
    },
    error(err) {
      controller.error(err);
    },
  };
  return { stream, writer };
}

// Helper to download a video from a public URL to a local path
async function downloadVideoToLocal(url, localPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download video from ${url}: ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(localPath, buffer);
  return localPath;
}

export async function POST(request) {
  const { stream, writer } = createStream();

  const response = new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });

  (async () => {
    const workdir = path.resolve('/tmp', 'work');
    const uploadsDir = path.resolve('/tmp', 'uploads');
    let localFinalVideoPath = ''; // Keep track for cleanup

    try {
      const { videoPaths, prompt } = await request.json();
      const userPrompt =
        prompt || 'anything that seems fun and makes my life look enjoyable';

      if (!videoPaths || videoPaths.length === 0) {
        writer.write({ status: 'error', message: 'No video paths provided.' });
        return writer.close();
      }

      await ensureDir(workdir);
      await ensureDir(uploadsDir);

      writer.write({ status: 'processing', message: `Found ${videoPaths.length} videos. Generating URLs...` });
      const videoUrls = videoPaths.map(
        (p) => supabase.storage.from('videos').getPublicUrl(p).data.publicUrl
      );

      writer.write({ status: 'processing', message: 'Downloading videos for analysis...' });
      const savedFiles = await Promise.all(
        videoUrls.map((url, i) => {
          const filename = `video_${i + 1}.mp4`;
          const localPath = path.join(uploadsDir, filename);
          return downloadVideoToLocal(url, localPath);
        })
      );

      writer.write({ status: 'processing', message: 'Analyzing videos with AI...' });
      const durations = await Promise.all(savedFiles.map((f) => ffprobeDuration(f)));
      const limit = pLimit(2);
      const analyses = await Promise.all(
        savedFiles.map((file, i) =>
          limit(async () => {
            const meta = await analyzeVideoWithGemini({ file, userPrompt });
            meta.durationSec = durations[i];
            return meta;
          })
        )
      );

      writer.write({ status: 'processing', message: 'Selecting best segments...' });
      const selection = selectBestSegments({ videos: analyses, userPrompt });
      if (selection.chosen.length === 0) {
        writer.write({ status: 'error', message: 'AI could not select any segments.' });
        return writer.close();
      }
      writer.write({ status: 'processing', message: `Selected ${selection.chosen.length} segments.` });

      writer.write({ status: 'processing', message: 'Uploading sources to Cloudinary...' });
      const videoPublicIds = {};
      const uniqueFiles = [...new Set(selection.chosen.map(seg => seg.file))];
      await Promise.all(uniqueFiles.map(async (localPath) => {
        const publicId = await uploadVideo(localPath);
        videoPublicIds[localPath] = publicId;
      }));

      writer.write({ status: 'processing', message: 'Creating final edit in Cloudinary...' });
      const cloudinaryVideoUrl = await createVideoFromSegments({ chosen: selection.chosen, videoPublicIds });

      writer.write({ status: 'processing', message: 'Downloading final edit...' });
      const finalVideoName = `montage-${Date.now()}.mp4`;
      localFinalVideoPath = path.join('/tmp', finalVideoName);
      await downloadVideoToLocal(cloudinaryVideoUrl, localFinalVideoPath);

      writer.write({ status: 'processing', message: 'Uploading final video to Supabase...' });
      const videoBuffer = await fs.readFile(localFinalVideoPath);
      const supabasePath = `final-montages/${finalVideoName}`;
      const { error: uploadError } = await supabase.storage.from('videos').upload(supabasePath, videoBuffer, {
        contentType: 'video/mp4',
        upsert: true,
      });
      if (uploadError) {
        throw new Error(`Supabase upload failed: ${uploadError.message}`);
      }
      const { data: { publicUrl: supabaseFinalUrl } } = supabase.storage.from('videos').getPublicUrl(supabasePath);

      writer.write({ status: 'processing', message: 'Saving result to database...' });
      const { error: dbError } = await supabase.from('processed_videos').insert([
        {
          prompt: userPrompt,
          final_video_url: supabaseFinalUrl,
          source_video_paths: videoPaths,
          metadata: selection,
        },
      ]);
      if (dbError) {
        writer.write({ status: 'error', message: `DB write failed: ${dbError.message}` });
      }

      writer.write({
        status: 'done',
        message: 'Final edit complete!',
        videoUrl: supabaseFinalUrl,
      });

    } catch (error) {
      console.error(error);
      writer.write({ status: 'error', message: error.message || 'An unknown error occurred.' });
    } finally {
      writer.write({ status: 'processing', message: 'Cleaning up temporary files...' });
      await fs.rm(workdir, { recursive: true, force: true });
      await fs.rm(uploadsDir, { recursive: true, force: true });
      if(localFinalVideoPath) await fs.rm(localFinalVideoPath, { force: true });
      writer.close();
    }
  })();

  return response;
}

export const runtime = 'nodejs';
export const maxDuration = 300;
