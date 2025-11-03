import { v2 as cloudinary } from "cloudinary";

// Configure Cloudinary with credentials from environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * Uploads a local video file to Cloudinary.
 * @param {string} localPath - The local path to the video file.
 * @returns {Promise<string>} The public_id of the uploaded video in Cloudinary.
 */
export async function uploadVideo(localPath) {
  try {
    const result = await cloudinary.uploader.upload(localPath, {
      resource_type: "video",
      folder: "mylyfe_uploads",
    });

    // Return both public_id and format
    return {
      public_id: result.public_id,
      format: result.format, // This will be 'mp4', 'mov', etc.
    };
  } catch (error) {
    console.error("Error uploading to Cloudinary:", error);
    throw new Error(`Cloudinary upload failed: ${error.message}`);
  }
}

/**
 * Creates a new video by cutting and concatenating segments from other videos
 * already in Cloudinary, applying final formatting.
 * @param {object} options
 * @param {Array<object>} options.chosen - The array of selected segment objects.
 * @param {object} options.videoPublicIds - A map of { localPath: cloudinary_public_id }.
 * @returns {Promise<string>} The URL of the final, processed video.
 */
export async function createVideoFromSegments({ chosen, videoPublicIds }) {
  if (!chosen || chosen.length === 0) {
    throw new Error("Cannot create video from empty selection.");
  }

  const firstSegment = chosen[0];
  const baseVideo = videoPublicIds[firstSegment.file];
  const basePublicId = baseVideo.public_id;
  const baseFormat = baseVideo.format;

  const targetWidth = 1080;
  const targetHeight = 1920;

  // Start transformation chain with resize for the base video
  const transformChain = [
    {
      background: "white",
      crop: "pad",
      height: targetHeight,
      width: targetWidth,
    },
    {
      start_offset: firstSegment.startSec.toFixed(2),
      end_offset: firstSegment.endSec.toFixed(2),
    },
  ];

  // Add subsequent segments
  if (chosen.length > 1) {
    for (let i = 1; i < chosen.length; i++) {
      const segment = chosen[i];
      const video = videoPublicIds[segment.file];
      const overlayPublicId = video.public_id.replace(/\//g, ":");

      // Add the splice overlay with format
      transformChain.push({
        flags: "splice",
        overlay: `video:${overlayPublicId}.${video.format}`,
      });

      // Resize the overlay to match dimensions
      transformChain.push({
        background: "white",
        crop: "pad",
        height: targetHeight,
        width: targetWidth,
      });

      // Add trim for the overlay
      transformChain.push({
        start_offset: segment.startSec.toFixed(2),
        end_offset: segment.endSec.toFixed(2),
      });

      // Apply the layer
      transformChain.push({ flags: "layer_apply" });
    }
  }

  // Add the format extension to the base video
  const transformationUrl = cloudinary.url(`${basePublicId}.${baseFormat}`, {
    resource_type: "video",
    transformation: transformChain,
  });

  console.log("Generated transformation URL:", transformationUrl);

  try {
    const finalVideoName = `final_edit_${Date.now()}`;
    const result = await cloudinary.uploader.upload(transformationUrl, {
      resource_type: "video",
      public_id: finalVideoName,
      folder: "mylyfe_edits",
    });
    return result.secure_url;
  } catch (error) {
    console.error("Error creating final video in Cloudinary:", error);
    throw new Error(`Final video creation failed: ${error.message}`);
  }
}