import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { globby } from "globby";
import pLimit from "p-limit";
import { analyzeVideoWithGemini } from "../../../lib/gemini";
import {
  ffprobeDuration,
  cutSegment,
  concatSegments,
} from "../../../lib/ffmpeg";
import { selectBestSegments } from "../../../lib/selection";
import { ensureDir, writeJSON } from "../../../lib/util";
import { put } from "@vercel/blob";

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

// Helper to download video from Vercel Blob to local file
async function downloadVideoToLocal(blobUrl, localPath) {
  const response = await fetch(blobUrl);
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.statusText}`);
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
    try {
      const { videoUrls, prompt } = await request.json();
      const userPrompt =
        prompt || "anything that seems fun and makes my life look enjoyable";
      const targetDurationSec = Number(
        process.env.TARGET_DURATION_SECONDS || 60
      );

      if (!videoUrls || videoUrls.length === 0) {
        writer.write({ status: "error", message: "No video URLs provided." });
        writer.close();
        return;
      }

      const workdir = path.resolve(process.cwd(), "work");
      const uploadsDir = path.resolve(process.cwd(), "uploads");
      ensureDir(workdir);
      ensureDir(uploadsDir);

      writer.write({
        status: "processing",
        message: `Found ${videoUrls.length} videos. Downloading from Vercel Blob...`,
      });

      // Download videos from Vercel Blob to local files
      const savedFiles = [];
      for (let i = 0; i < videoUrls.length; i++) {
        const url = videoUrls[i];
        const filename = `video_${i + 1}.mp4`; // Generate a filename
        const localPath = path.join(uploadsDir, filename);

        writer.write({
          status: "processing",
          message: `Downloading ${filename}...`,
        });
        await downloadVideoToLocal(url, localPath);
        savedFiles.push(localPath);
      }

      writer.write({
        status: "processing",
        message: "Probing video durations...",
      });
      const durations = await Promise.all(
        savedFiles.map((f) => ffprobeDuration(f))
      );
      durations.forEach((d, i) => {
        if (d)
          writer.write({
            status: "processing",
            message: `${path.basename(savedFiles[i])} duration: ${d.toFixed(
              1
            )}s`,
          });
      });

      const limit = pLimit(2);
      let analysisCount = 0;
      const analyses = await Promise.all(
        savedFiles.map((file) =>
          limit(async () => {
            const progressCallback = (message) => {
              writer.write({
                status: "processing",
                message: `[${path.basename(file)}] ${message}`,
              });
            };

            try {
              const meta = await analyzeVideoWithGemini({
                file,
                userPrompt,
                progressCallback,
              });
              const idx = savedFiles.indexOf(file);
              const dur = durations[idx];
              if (dur) meta.durationSec = dur;
              analysisCount++;
              writer.write({
                status: "processing",
                message: `Analyzed ${analysisCount} of ${savedFiles.length} videos.`,
              });
              return meta;
            } catch (e) {
              writer.write({
                status: "error",
                message: `Gemini analysis failed for ${file}: ${e.message}`,
              });
              return { file, segments: [] };
            }
          })
        )
      );

      const validAnalyses = analyses.filter((a) => a.segments.length > 0);
      const metadataPath = path.join(workdir, "metadata.json");
      writeJSON(metadataPath, {
        userPrompt,
        targetDurationSec,
        videos: validAnalyses,
      });
      writer.write({
        status: "processing",
        message: `Wrote metadata to ${metadataPath}`,
      });

      writer.write({
        status: "processing",
        message: "Selecting best segments...",
      });
      const selection = selectBestSegments({
        userPrompt,
        targetDurationSec,
        videos: analyses,
      });
      writer.write({
        status: "processing",
        message: `Selected ${
          selection.chosen.length
        } segments, total ~${selection.totalDurationSec.toFixed(1)}s`,
      });

      if (selection.chosen.length === 0) {
        writer.write({
          status: "error",
          message: "No segments selected. Check prompts or model output.",
        });
        writer.close();
        return;
      }

      const cutsDir = path.join(workdir, "cuts");
      const cutFiles = [];
      let i = 0;
      for (const seg of selection.chosen) {
        i += 1;
        writer.write({
          status: "processing",
          message: `Cutting ${path.basename(seg.file)} [${seg.startSec.toFixed(
            2
          )}-${seg.endSec.toFixed(2)}]`,
        });
        const out = await cutSegment(seg, cutsDir, i);
        if (out) {
          cutFiles.push(out);
        }
      }

      const outFileName = `final_edit_${new Date()
        .toISOString()
        .replace(/:/g, "_")}.mp4`;
      const localOutFile = path.join(process.cwd(), "public", outFileName);
      ensureDir(path.dirname(localOutFile));

      writer.write({
        status: "processing",
        message: "Concatenating segments into final video...",
      });
      await concatSegments(cutFiles, localOutFile);

      // Upload the final video back to Vercel Blob
      writer.write({
        status: "processing",
        message: "Uploading final video to storage...",
      });
      const finalVideoBuffer = await fs.readFile(localOutFile);
      const finalBlob = await put(outFileName, finalVideoBuffer, {
        access: "public",
        addRandomSuffix: true,
      });

      writer.write({
        status: "done",
        message: "Final edit complete!",
        videoUrl: finalBlob.url,
      });

      // Clean up local files
      writer.write({
        status: "processing",
        message: "Cleaning up temporary files...",
      });
      try {
        await fs.rm(workdir, { recursive: true, force: true });
        await fs.rm(uploadsDir, { recursive: true, force: true });
        await fs.rm(localOutFile, { force: true });
      } catch (error) {
        console.error("Cleanup error:", error);
      }
    } catch (error) {
      console.error(error);
      writer.write({
        status: "error",
        message: error.message || "An unknown error occurred.",
      });
    } finally {
      writer.close();
    }
  })();

  return response;
}
