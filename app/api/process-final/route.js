import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import pLimit from "p-limit";

// Local Libs
import { analyzeVideoWithGemini } from "../../../lib/gemini";
import { ffprobeDuration } from "../../../lib/ffmpeg";
import { selectBestSegments } from "../../../lib/selection";
import { ensureDir, writeJSON } from "../../../lib/util";

// Service Clients
import { supabase } from "../../../lib/supabase";
import { uploadVideo, createVideoFromSegments } from "../../../lib/cloudinary";

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
    throw new Error(
      `Failed to download video from ${url}: ${response.statusText}`
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(localPath, buffer);
  return localPath;
}

export async function POST(request) {
  const { stream, writer } = createStream();

  // Immediately return the streamable response
  const response = new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });

  (async () => {
    const workdir = path.resolve("/tmp", "work");
    const uploadsDir = path.resolve("/tmp", "uploads");

    try {
      // 1. Get video paths from request (paths in Supabase Storage)
      const { videoPaths, prompt } = await request.json();
      const userPrompt =
        prompt || "anything that seems fun and makes my life look enjoyable";

      if (!videoPaths || videoPaths.length === 0) {
        writer.write({ status: "error", message: "No video paths provided." });
        writer.close();
        return;
      }

      await ensureDir(workdir);
      await ensureDir(uploadsDir);

      // 2. Get public URLs from Supabase
      writer.write({
        status: "processing",
        message: `Found ${videoPaths.length} videos. Generating URLs from Supabase...`,
      });
      const videoUrls = videoPaths.map(
        (p) => supabase.storage.from("videos").getPublicUrl(p).data.publicUrl
      );

      // 3. Download videos locally for analysis
      writer.write({ status: "processing", message: "Downloading videos..." });
      const savedFiles = [];
      for (let i = 0; i < videoUrls.length; i++) {
        const url = videoUrls[i];
        const filename = `video_${i + 1}.mp4`;
        const localPath = path.join(uploadsDir, filename);
        await downloadVideoToLocal(url, localPath);
        savedFiles.push(localPath);
      }

      // 4. Analyze videos with Gemini (same as before)
      writer.write({
        status: "processing",
        message: "Analyzing videos with AI...",
      });
      const durations = await Promise.all(
        savedFiles.map((f) => ffprobeDuration(f))
      );
      const limit = pLimit(2);
      const analyses = await Promise.all(
        savedFiles.map((file) =>
          limit(async () => {
            const meta = await analyzeVideoWithGemini({ file, userPrompt });
            meta.durationSec = durations[savedFiles.indexOf(file)];
            return meta;
          })
        )
      );

      // 5. Select the best segments (same as before)
      writer.write({
        status: "processing",
        message: "Selecting best segments...",
      });
      const selection = selectBestSegments({ videos: analyses, userPrompt });
      if (selection.chosen.length === 0) {
        writer.write({
          status: "error",
          message: "AI could not select any segments.",
        });
        writer.close();
        return;
      }
      writer.write({
        status: "processing",
        message: `Selected ${
          selection.chosen.length
        } segments, total ~${selection.totalDurationSec.toFixed(1)}s`,
      });

      // 6. Upload ALL source videos to Cloudinary (not just unique ones from selection)
      writer.write({
        status: "processing",
        message: "Uploading sources to Cloudinary...",
      });
      const videoPublicIds = {};

      // Upload all downloaded videos
      for (const localPath of savedFiles) {
        writer.write({
          status: "processing",
          message: `Uploading ${path.basename(localPath)}...`,
        });
        const videoInfo = await uploadVideo(localPath); // Now returns { public_id, format }
        videoPublicIds[localPath] = videoInfo;
        console.log(
          `Uploaded ${localPath} -> ${videoInfo.public_id} (${videoInfo.format})`
        );
      }

      // Log the mapping for debugging
      console.log("Video public IDs mapping:", videoPublicIds);
      console.log(
        "Selection chosen files:",
        selection.chosen.map((s) => s.file)
      );

      // 7. Create the final video in Cloudinary
      writer.write({
        status: "processing",
        message: "Creating final edit in Cloudinary...",
      });
      const finalVideoUrl = await createVideoFromSegments({
        chosen: selection.chosen,
        videoPublicIds,
      });

      // 8. Save the result to Supabase
      writer.write({
        status: "processing",
        message: "Saving result to database...",
      });
      const { error: dbError } = await supabase
        .from("web_processed_videos")
        .insert([
          {
            prompt: userPrompt,
            final_video_url: finalVideoUrl,
            source_video_paths: videoPaths,
            metadata: selection, // Store the whole selection metadata
          },
        ]);
      if (dbError) {
        // Don't fail the whole request, just log the DB error
        writer.write({
          status: "error",
          message: `DB write failed: ${dbError.message}`,
        });
      }

      // 9. Done!
      writer.write({
        status: "done",
        message: "Final edit complete!",
        videoUrl: finalVideoUrl,
      });
    } catch (error) {
      console.error(error);
      writer.write({
        status: "error",
        message: error.message || "An unknown error occurred.",
      });
    } finally {
      // 10. Cleanup local temp files
      writer.write({
        status: "processing",
        message: "Cleaning up temporary files...",
      });
      await fs.rm(workdir, { recursive: true, force: true });
      await fs.rm(uploadsDir, { recursive: true, force: true });
      writer.close();
    }
  })();

  return response;
}

// Add runtime configuration
export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes
