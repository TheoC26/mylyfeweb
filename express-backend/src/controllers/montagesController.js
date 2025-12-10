import { processMontageCreation } from '../services/montageCreationService.js';
import { supabase } from "../services/supabaseService.js";
import { deleteFromS3 } from "../services/s3Service.js";
import { getKeyFromUrl } from "../utils/getKeyFromUrl.js";

export const createMontage = (req, res) => {
  const user = req.user;

  // Immediately respond to the client to let them know the process has started.
  res.status(202).json({
    message: 'Montage creation process has started. This may take several minutes.',
  });

  // Trigger the long-running background process without awaiting it.
  setImmediate(() => {
    processMontageCreation({ user });
  });
};

export const deleteMontage = async (req, res) => {
  const { id: montageId } = req.params;
  const userId = req.user.id;

  console.log(`Received request to delete montage ${montageId} for user ${userId}`);

  try {
    // 1. Fetch the clip from Supabase to verify ownership and get URLs
    const { data: montage, error: fetchError } = await supabase
      .from("montages")
      .select("video_url, thumbnail_url")
      .eq("id", montageId)
      .eq("user_id", userId)
      .single();

    if (fetchError || !montage) {
      // If no row is found, or if there's another error, deny access.
      // This securely prevents users from deleting clips they don't own.
      return res.status(404).json({
        message: "Montage not found or you do not have permission to delete it.",
      });
    }

    // 2. Extract S3 keys from the URLs
    const montageKey = getKeyFromUrl(montage.video_url);
    const thumbKey = getKeyFromUrl(montage.thumbnail_url);

    console.log(
      `Found montage. Video key: ${montageKey}, Thumbnail key: ${thumbKey}`
    );

    // 3. Delete files from S3
    const deletePromises = [];
    if (montageKey) {
      deletePromises.push(deleteFromS3(montageKey));
    }
    if (thumbKey) {
      deletePromises.push(deleteFromS3(thumbKey));
    }
    await Promise.all(deletePromises);
    console.log("Successfully deleted files from S3.");

    // 4. Delete the record from the Supabase table
    const { error: deleteError } = await supabase
      .from("montages")
      .delete()
      .eq("id", montageId);

    if (deleteError) {
      throw new Error(`Supabase delete failed: ${deleteError.message}`);
    }
    console.log("Successfully deleted record from Supabase.");

    res.status(200).json({ message: "Montage deleted successfully." });
  } catch (error) {
    console.error(`Failed to delete montage ${montageId}:`, error);
    res
      .status(500)
      .json({ message: error.message || "An internal error occurred." });
  }
};