import { randomUUID } from "node:crypto";
import { upload } from "../services/s3Service.js";
import { processVideoInBackground } from "../services/videoProcessingService.js";
import { supabase } from "../services/supabaseService.js";
import { deleteFromS3 } from "../services/s3Service.js";
import { createJob, getJob, updateJob } from "../services/jobStatusService.js";
import { getKeyFromUrl } from "../utils/getKeyFromUrl.js";

const uploadMiddleware = upload.single("video");

export const uploadClip = (req, res) => {
  uploadMiddleware(req, res, async (err) => {
    // Make callback ASYNC
    if (err) {
      console.error("Upload error:", err);
      return res
        .status(400)
        .json({ message: "File upload failed.", error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ message: "No file was uploaded." });
    }

    const { userPrompt } = req.body;
    if (!userPrompt) {
      return res.status(400).json({ message: "userPrompt is required." });
    }

    const { date } = req.body;
    if (!date) {
      return res.status(400).json({ message: "date is required." });
    }

    const jobId = randomUUID();

    try {
      // 1. AWAIT the DB creation
      await createJob(jobId, {
        userId: req.user.id,
        uploadUrl: req.file.location,
        filename: req.file.originalname,
      });

      // 2. Respond to client
      res.status(202).json({
        message:
          "Video uploaded successfully. Processing has started in the background.",
        uploadUrl: req.file.location,
        jobId: jobId,
      });

      // 3. Trigger background processing
      const jobData = {
        file: req.file,
        user: req.user,
        userPrompt: userPrompt,
        date: date,
        jobId: jobId,
      };

      setImmediate(() => {
        processVideoInBackground(jobData);
      });
    } catch (dbError) {
      console.error("Failed to create job:", dbError);
      return res
        .status(500)
        .json({ message: "Failed to initialize upload job." });
    }
  });
};

export const getClipProcessingStatus = async (req, res) => {
  const { jobId } = req.params;

  // 1. AWAIT getJob
  let job = await getJob(jobId);

  if (!job) {
    return res.status(404).json({ message: "Job not found." });
  }

  if (job.userId !== req.user.id) {
    return res
      .status(403)
      .json({ message: "You are not authorized to view this job." });
  }

  // Check if we need to fetch the final clip details
  if (job.status === "completed" && job.clipId && !job.clip) {
    // If the job in DB says completed, the service `getJob`
    // might not have fetched the actual clip details from the `clips` table.
    // Let's fetch the clip details to return to the frontend.

    const { data: clipData } = await supabase
      .from("clips")
      .select("*")
      .eq("id", job.clipId)
      .single();

    if (clipData) job.clip = clipData;
  }

  // NOTE: Your original logic had a fallback where if status is processing
  // it checked the 'clips' table just in case the background worker crashed
  // before updating the job status. You can keep that logic if you wish,
  // but usually relying on the 'processing_jobs' table is cleaner.
  // The logic below assumes processVideoInBackground calls updateJob('completed').

  const response = {
    jobId: jobId,
    status: job.status,
    uploadUrl: job.uploadUrl,
    updatedAt: job.updatedAt,
  };

  if (job.clip) {
    response.clip = job.clip;
  }

  if (job.status === "failed" && job.error) {
    response.error = job.error;
  }

  return res.status(200).json(response);
};

export const deleteClip = async (req, res) => {
  const { id: clipId } = req.params;
  const userId = req.user.id;

  console.log(`Received request to delete clip ${clipId} for user ${userId}`);

  try {
    // 1. Fetch the clip from Supabase to verify ownership and get URLs
    const { data: clip, error: fetchError } = await supabase
      .from("clips")
      .select("clip_url, thumbnail_url")
      .eq("id", clipId)
      .eq("user_id", userId)
      .single();

    if (fetchError || !clip) {
      // If no row is found, or if there's another error, deny access.
      // This securely prevents users from deleting clips they don't own.
      return res.status(404).json({
        message: "Clip not found or you do not have permission to delete it.",
      });
    }

    // 2. Extract S3 keys from the URLs
    const clipKey = getKeyFromUrl(clip.clip_url);
    const thumbKey = getKeyFromUrl(clip.thumbnail_url);

    console.log(
      `Found clip. Video key: ${clipKey}, Thumbnail key: ${thumbKey}`
    );

    // 3. Delete files from S3
    const deletePromises = [];
    if (clipKey) {
      deletePromises.push(deleteFromS3(clipKey));
    }
    if (thumbKey) {
      deletePromises.push(deleteFromS3(thumbKey));
    }
    await Promise.all(deletePromises);
    console.log("Successfully deleted files from S3.");

    // 4. Delete the record from the Supabase table
    const { error: deleteError } = await supabase
      .from("clips")
      .delete()
      .eq("id", clipId);

    if (deleteError) {
      throw new Error(`Supabase delete failed: ${deleteError.message}`);
    }
    console.log("Successfully deleted record from Supabase.");

    res.status(200).json({ message: "Clip deleted successfully." });
  } catch (error) {
    console.error(`Failed to delete clip ${clipId}:`, error);
    res
      .status(500)
      .json({ message: error.message || "An internal error occurred." });
  }
};
