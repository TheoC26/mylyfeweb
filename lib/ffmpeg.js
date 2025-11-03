import { execa } from "execa";
import path from "node:path";
import fs from "node:fs";
import { ensureDir, toHhmmss } from "./util.js";

export async function ffprobeDuration(file) {
  try {
    const { stdout } = await execa("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ]);
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) ? d : undefined;
  } catch {
    return undefined;
  }
}

export async function cutSegment(seg, outDir, index) {
  if (seg.endSec <= seg.startSec) {
    console.warn(
      `Skipping segment with invalid duration: ${seg.file} [${seg.startSec}-${seg.endSec}]`
    );
    return "";
  }
  ensureDir(outDir);
  const outPath = path.join(
    outDir,
    `seg_${index.toString().padStart(3, "0")}.mp4`
  );

  const ss = toHhmmss(seg.startSec);
  const to = toHhmmss(seg.endSec);

  try {
    await execa("ffmpeg", [
      "-y",
      "-ss",
      ss,
      "-to",
      to,
      "-i",
      seg.file,
      "-r",
      "30",
      "-pix_fmt",
      "yuv420p",
      outPath,
    ]);
  } catch {
    return "";
  }

  return outPath;
}

export async function concatSegments(segmentFiles, outFile) {
  const listFile = outFile + ".list.txt";
  fs.writeFileSync(
    listFile,
    segmentFiles.map((f) => `file '${path.resolve(f)}'`).join("\n"),
    "utf-8"
  );

  await execa("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    outFile,
  ]);
}
