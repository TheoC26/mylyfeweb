import { execa } from 'execa';
import fs from 'node:fs/promises';

/**
 * Generates a thumbnail from the first frame of a video.
 * @param {string} inputPath - Path to the input video file.
 * @param {string} outputPath - Path to save the output thumbnail JPEG.
 * @returns {Promise<void>}
 */
export async function generateThumbnail(inputPath, outputPath) {
  try {
    console.log(`Generating thumbnail for ${inputPath}...`);
    await execa('ffmpeg', [
      '-i', inputPath,
      '-ss', '00:00:01.000',
      '-vframes', '1',
      '-f', 'image2',
      '-y', outputPath,
    ]);
    console.log(`Thumbnail saved to ${outputPath}`);
  } catch (error) {
    console.error('FFmpeg thumbnail generation failed:', error.stderr || error.message);
    await fs.unlink(outputPath).catch(() => {});
    throw new Error('Failed to generate video thumbnail.');
  }
}

/**
 * Compresses a video to a smaller size.
 * @param {string} inputPath - Path to the input video file.
 * @param {string} outputPath - Path to save the output compressed MP4.
 * @returns {Promise<void>}
 */
export async function compressVideo(inputPath, outputPath) {
  try {
    console.log(`Compressing video for ${inputPath}...`);
    await execa('ffmpeg', [
      '-i', inputPath,
      '-vf', 'scale=-2:720',
      '-crf', '28',
      '-preset', 'veryfast',
      '-y', outputPath,
    ]);
    console.log(`Compressed video saved to ${outputPath}`);
  } catch (error) {
    console.error('FFmpeg video compression failed:', error.stderr || error.message);
    await fs.unlink(outputPath).catch(() => {});
    throw new Error('Failed to compress video.');
  }
}

/**
 * Trims a video clip and formats it to 9:16 with a white background.
 * @param {string} inputPath - Path to the input video file.
 * @param {string} outputPath - Path to save the output .ts file.
 * @param {number} startSec - The start time of the clip in seconds.
 * @param {number} endSec - The end time of the clip in seconds.
 * @returns {Promise<void>}
 */
export async function trimAndFormatClip(inputPath, outputPath, startSec, endSec) {
  try {
    const duration = endSec - startSec;
    console.log(`Trimming and formatting ${inputPath} from ${startSec}s for ${duration}s...`);
    await execa('ffmpeg', [
      '-ss', startSec.toString(),
      '-i', inputPath,
      '-t', duration.toString(),
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:-1:-1:color=white',
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-y', outputPath,
    ]);
    console.log(`Formatted clip saved to ${outputPath}`);
  } catch (error) {
    console.error(`FFmpeg trim/format failed for ${inputPath}:`, error.stderr || error.message);
    await fs.unlink(outputPath).catch(() => {});
    throw new Error('Failed to trim and format clip.');
  }
}

/**
 * Concatenates multiple .ts video files into a single MP4.
 * @param {string[]} tsFilePaths - An array of paths to the .ts files to concatenate.
 * @param {string} outputPath - The path for the final output MP4 file.
 * @returns {Promise<void>}
 */
export async function concatenateTsFiles(tsFilePaths, outputPath) {
  try {
    console.log(`Concatenating ${tsFilePaths.length} clips...`);
    const concatString = `concat:${tsFilePaths.join('|')}`;
    await execa('ffmpeg', [
      '-i', concatString,
      '-c', 'copy', // Copies the stream without re-encoding
      '-y', outputPath,
    ]);
    console.log(`Final montage saved to ${outputPath}`);
  } catch (error) {
    console.error('FFmpeg concatenation failed:', error.stderr || error.message);
    await fs.unlink(outputPath).catch(() => {});
    throw new Error('Failed to concatenate video clips.');
  }
}
