import { supabase } from "./supabaseService.js";
import { getUpcomingSunday } from "../utils/date.js";
import { analyzeVideoWithGemini } from "./geminiService.js";
import { generateThumbnail, compressVideo } from "./ffmpegService.js";
import { uploadBufferToS3 } from "./s3Service.js";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import fs from "node:fs/promises";
import path from "node:path";

const s3 = new S3Client({ region: process.env.AWS_REGION });

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

export async function processVideoInBackground(jobData) {
  const { file, user, userPrompt } = jobData;
  const { key: s3Key, bucket: s3Bucket, location: clipUrl } = file;
  const userId = user.id;

  const tempDir = "/tmp/mylyfe-processing";
  const uniqueId = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const originalPath = path.join(tempDir, `${uniqueId}_original.mp4`);
  const thumbnailPath = path.join(tempDir, `${uniqueId}_thumb.jpg`);
  const compressedPath = path.join(tempDir, `${uniqueId}_compressed.mp4`);

  const tempFiles = [originalPath, thumbnailPath, compressedPath];

  try {
    console.log(`Starting background processing for ${s3Key}`);
    await fs.mkdir(tempDir, { recursive: true });

    // 1. Download original video from S3
    await downloadFileFromS3(s3Bucket, s3Key, originalPath);

    // 2. Generate thumbnail and compress video (can run in parallel)
    await Promise.all([
      generateThumbnail(originalPath, thumbnailPath),
      compressVideo(originalPath, compressedPath),
    ]);

    // 3. Upload thumbnail to S3
    const thumbnailKey = `thumbnails/${userId}/${uniqueId}.jpg`;
    const thumbnailUploadPromise = fs
      .readFile(thumbnailPath)
      .then((buffer) => uploadBufferToS3(buffer, thumbnailKey, "image/jpeg"));

    // 4. Analyze the *compressed* video with Gemini
    const analysisPromise = analyzeVideoWithGemini({
      localPath: compressedPath,
      userPrompt,
    });

    // 5. Wait for analysis and thumbnail upload to complete
    const [thumbnailUrl, analysisResult] = await Promise.all([
      thumbnailUploadPromise,
      analysisPromise,
    ]);

    console.log(`Thumbnail uploaded to ${thumbnailUrl}`);

    // 6. Prepare data for Supabase
    const weekEndDate = getUpcomingSunday();
    const clipData = {
      user_id: userId,
      clip_url: clipUrl, // URL of the original, full-quality video
      thumbnail_url: thumbnailUrl, // URL of the new thumbnail
      start_sec: analysisResult.startSec,
      end_sec: analysisResult.endSec,
      description: analysisResult.description,
      relevance: analysisResult.scores.relevance,
      quality: analysisResult.scores.quality,
      confidence: analysisResult.scores.confidence,
      score: analysisResult.scores.relevance * 0.7 + analysisResult.scores.quality * 0.2 + analysisResult.scores.confidence * 0.1,
      date_uploaded: new Date(),
      week_end_date: weekEndDate,
    };

    // 7. Insert into Supabase
    console.log("Inserting clip data into Supabase...");
    const { error } = await supabase.from("clips").insert([clipData]);

    if (error) {
      throw new Error(`Supabase insert failed: ${error.message}`);
    }

    console.log(`Successfully processed and saved clip ${s3Key}`);

    // 8. Update user profile by incrementing week_vids_count
    const { data, error: userError } = await supabase.rpc(
      "increment_week_vids_count",
      {
        p_row_id: userId,
      }
    );


    if (userError) {
      console.error(
        `Failed to update user ${userId} profile: ${userError.message}`
      );
    } else {
      console.log(`User ${userId} profile updated successfully.`);
    }
  } catch (error) {
    console.error(`[FAIL] Background processing for ${s3Key} failed:`, error);
    // Optional: Here you could update a status in your DB to reflect the failure.
  } finally {
    // 8. Clean up all temporary files
    console.log("Cleaning up temporary files...");
    for (const tempFile of tempFiles) {
      await fs.unlink(tempFile).catch((err) => {
        // Ignore errors if file doesn't exist (e.g., if a step failed before creating it)
        if (err.code !== "ENOENT") {
          console.error(`Failed to delete temp file ${tempFile}:`, err);
        }
      });
    }
  }
}
