import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Generates a thumbnail from the first frame of a video.
 * @param {string} inputPath
 * @param {string} outputPath
 */
export async function generateThumbnail(inputPath, outputPath) {
  try {
    console.log(`Generating thumbnail for ${inputPath}...`);
    await execa("ffmpeg", [
      "-i",
      inputPath,
      "-ss",
      "00:00:01.000",
      "-vframes",
      "1",
      "-f",
      "image2",
      "-y",
      outputPath,
    ]);
    console.log(`Thumbnail saved to ${outputPath}`);
  } catch (error) {
    console.error(
      "FFmpeg thumbnail generation failed:",
      error.stderr || error.message
    );
    await fs.unlink(outputPath).catch(() => {});
    throw new Error("Failed to generate video thumbnail.");
  }
}

/**
 * Compresses a video to a smaller size.
 * @param {string} inputPath
 * @param {string} outputPath
 */
export async function compressVideo(inputPath, outputPath) {
  try {
    console.log(`Compressing video for ${inputPath}...`);
    await execa("ffmpeg", [
      "-i",
      inputPath,
      "-vf",
      "scale=-2:720",
      "-crf",
      "28",
      "-preset",
      "veryfast",
      "-y",
      outputPath,
    ]);
    console.log(`Compressed video saved to ${outputPath}`);
  } catch (error) {
    console.error(
      "FFmpeg video compression failed:",
      error.stderr || error.message
    );
    await fs.unlink(outputPath).catch(() => {});
    throw new Error("Failed to compress video.");
  }
}

/**
 * Trims a video clip and formats it to 9:16 with a white background.
 * Adds necessary bitstream filters and STANDARDIZES AUDIO.
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {number} startSec
 * @param {number} endSec
 */
export async function trimAndFormatClip(
  inputPath,
  outputPath,
  startSec,
  endSec
) {
  try {
    const duration = endSec - startSec;
    console.log(
      `Trimming and formatting ${inputPath} from ${startSec}s for ${duration}s...`
    );

    await execa("ffmpeg", [
      "-ss",
      startSec.toString(),
      "-i",
      inputPath,
      "-t",
      duration.toString(),

      // VIDEO FILTERS
      "-vf",
      "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:-1:-1:color=white",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-bsf:v",
      "h264_mp4toannexb",

      // AUDIO STANDARDIZATION (The Fix)
      "-c:a",
      "aac", // Encode to AAC
      "-ar",
      "44100", // Force 44.1kHz sample rate
      "-ac",
      "2", // Force 2 channels (Stereo)

      "-f",
      "mpegts",
      "-y",
      outputPath,
    ]);
    console.log(`Formatted clip saved to ${outputPath}`);
  } catch (error) {
    console.error(
      `FFmpeg trim/format failed for ${inputPath}:`,
      error.stderr || error.message
    );
    await fs.unlink(outputPath).catch(() => {});
    throw new Error("Failed to trim and format clip.");
  }
}

/**
 * Concatenates multiple .ts video files into a single MP4 using the Demuxer method.
 * @param {string[]} tsFilePaths
 * @param {string} outputPath
 */
export async function concatenateTsFiles(tsFilePaths, outputPath) {
  let listFilePath = null;
  try {
    console.log(`Concatenating ${tsFilePaths.length} clips...`);

    // 1. Create a temporary list file for the concat demuxer
    // Format must be: file '/path/to/file'
    const fileContent = tsFilePaths.map((p) => `file '${p}'`).join("\n");
    const tempDir = path.dirname(tsFilePaths[0]);
    listFilePath = path.join(tempDir, `concat_list_${Date.now()}.txt`);

    await fs.writeFile(listFilePath, fileContent);

    // 2. Run FFmpeg using the concat demuxer (-f concat)
    // -safe 0 is required to allow absolute paths in the list file
    await execa("ffmpeg", [
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFilePath,
      "-c",
      "copy",
      "-bsf:a",
      "aac_adtstoasc", // Fixes audio stream structure when moving from TS to MP4
      "-movflags",
      "+faststart", // Optimizes video for web streaming
      "-y",
      outputPath,
    ]);

    console.log(`Final montage saved to ${outputPath}`);
  } catch (error) {
    console.error(
      "FFmpeg concatenation failed:",
      error.stderr || error.message
    );
    await fs.unlink(outputPath).catch(() => {});
    throw new Error("Failed to concatenate video clips.");
  } finally {
    // Clean up the text file
    if (listFilePath) {
      await fs.unlink(listFilePath).catch(() => {});
    }
  }
}
