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
    // -i: input file, -vframes 1: output only one frame
    // -an: disable audio, -s: size (resolution)
    // -ss: seek to position (1 second in to avoid black frames)
    // -y: overwrite output file if it exists
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
    // Attempt to delete the potentially corrupt output file
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
    // -vf "scale=-1:720": resize video to 720p height, maintaining aspect ratio
    // -crf 28: Constant Rate Factor for quality/size balance (higher is more compressed)
    // -preset veryfast: encoding speed vs. compression ratio
    // -y: overwrite output file if it exists
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
    // Attempt to delete the potentially corrupt output file
    await fs.unlink(outputPath).catch(() => {});
    throw new Error('Failed to compress video.');
  }
}
