import { supabase } from "./supabaseService.js"; // Ensure this points to your supabase admin client

export async function createJob(jobId, payload = {}) {
  const { userId, uploadUrl, filename, status = "processing" } = payload;

  const { error } = await supabase.from("processing_jobs").insert({
    job_id: jobId,
    user_id: userId,
    status,
    upload_url: uploadUrl,
    filename,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.error("Error creating job in DB:", error);
    throw error;
  }
}

export async function updateJob(jobId, patch = {}) {
  // Map camelCase JS props to snake_case DB columns if necessary
  const updates = {
    updated_at: new Date().toISOString(),
    status: patch.status,
  };

  if (patch.clipId) updates.clip_id = patch.clipId;
  if (patch.error) updates.error = patch.error;

  const { error } = await supabase
    .from("processing_jobs")
    .update(updates)
    .eq("job_id", jobId);

  if (error) {
    console.error(`Error updating job ${jobId}:`, error);
  }
}

export async function getJob(jobId) {
  const { data, error } = await supabase
    .from("processing_jobs")
    .select("*")
    .eq("job_id", jobId)
    .single();

  if (error || !data) return null;

  console.log("Fetched job from DB:", data);

  // Convert snake_case back to camelCase to match what controller expects
  return {
    jobId: data.job_id,
    userId: data.user_id,
    status: data.status,
    uploadUrl: data.upload_url,
    filename: data.filename,
    clipId: data.clip_id,
    error: data.error,
    updatedAt: data.updated_at,
  };
}

// Optional, if you ever need to clean up
export async function deleteJob(jobId) {
  await supabase.from("processing_jobs").delete().eq("job_id", jobId);
}