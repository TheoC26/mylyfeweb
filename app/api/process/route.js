
import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { globby } from "globby";
import pLimit from "p-limit";
import { analyzeVideoWithGemini } from "../../../lib/gemini";
import { ffprobeDuration, cutSegment, concatSegments } from "../../../lib/ffmpeg";
import { selectBestSegments } from "../../../lib/selection";
import { ensureDir, writeJSON } from "../../../lib/util";

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
      controller.enqueue(`data: ${JSON.stringify(data)}
\n`);
    },
    close() {
      controller.close();
    },
    error(err) {
      controller.error(err);
    }
  };
  return { stream, writer };
}


export async function POST(request) {
  const { stream, writer } = createStream();
  
  // Immediately return the streamable response
  const response = new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });

  (async () => {
    try {
      const formData = await request.formData();
      const files = formData.getAll("videos");
      const userPrompt = formData.get("prompt") || "anything that seems fun and makes my life look enjoyable";
      const targetDurationSec = Number(process.env.TARGET_DURATION_SECONDS || 60);
      
      if (files.length === 0) {
        writer.write({ status: 'error', message: 'No videos uploaded.' });
        writer.close();
        return;
      }

      const workdir = path.resolve(process.cwd(), "work");
      const uploadsDir = path.resolve(process.cwd(), "uploads");
      ensureDir(workdir);
      ensureDir(uploadsDir);
      
      writer.write({ status: 'processing', message: `Found ${files.length} videos. Saving to server...` });

      const savedFiles = [];
      for (const file of files) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const filePath = path.join(uploadsDir, file.name);
        await fs.writeFile(filePath, buffer);
        savedFiles.push(filePath);
      }
      
      writer.write({ status: 'processing', message: 'Probing video durations...' });
      const durations = await Promise.all(savedFiles.map((f) => ffprobeDuration(f)));
      durations.forEach((d, i) => {
        if (d) writer.write({ status: 'processing', message: `${path.basename(savedFiles[i])} duration: ${d.toFixed(1)}s` });
      });

      const limit = pLimit(2);
      let analysisCount = 0;
      const analyses = await Promise.all(
        savedFiles.map((file) =>
          limit(async () => {
            const progressCallback = (message) => {
              writer.write({ status: 'processing', message: `[${path.basename(file)}] ${message}` });
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
              writer.write({ status: 'processing', message: `Analyzed ${analysisCount} of ${savedFiles.length} videos.` });
              return meta;
            } catch (e) {
              writer.write({ status: 'error', message: `Gemini analysis failed for ${file}: ${e.message}` });
              return { file, segments: [] };
            }
          })
        )
      );

      const validAnalyses = analyses.filter((a) => a.segments.length > 0);
      const metadataPath = path.join(workdir, "metadata.json");
      writeJSON(metadataPath, { userPrompt, targetDurationSec, videos: validAnalyses });
      writer.write({ status: 'processing', message: `Wrote metadata to ${metadataPath}` });

      writer.write({ status: 'processing', message: 'Selecting best segments...' });
      const selection = selectBestSegments({
        userPrompt,
        targetDurationSec,
        videos: analyses,
      });
      writer.write({ status: 'processing', message: `Selected ${selection.chosen.length} segments, total ~${selection.totalDurationSec.toFixed(1)}s` });

      if (selection.chosen.length === 0) {
        writer.write({ status: 'error', message: 'No segments selected. Check prompts or model output.' });
        writer.close();
        return;
      }

      const cutsDir = path.join(workdir, "cuts");
      const cutFiles = [];
      let i = 0;
      for (const seg of selection.chosen) {
        i += 1;
        writer.write({ status: 'processing', message: `Cutting ${path.basename(seg.file)} [${seg.startSec.toFixed(2)}-${seg.endSec.toFixed(2)}]` });
        const out = await cutSegment(seg, cutsDir, i);
        if (out) {
          cutFiles.push(out);
        }
      }

      const outFileName = `final_edit_${new Date().toISOString().replace(/:/g, "_")}.mp4`;
      const outFile = path.join(process.cwd(), 'public', outFileName);
      ensureDir(path.dirname(outFile));

      writer.write({ status: 'processing', message: 'Concatenating segments into final video...' });
      await concatSegments(cutFiles, outFile);
      writer.write({ status: 'done', message: 'Final edit saved.', videoUrl: `/${outFileName}` });

    } catch (error) {
      console.error(error);
      writer.write({ status: 'error', message: error.message || 'An unknown error occurred.' });
    } finally {
      writer.close();
    }
  })();

  return response;
}
