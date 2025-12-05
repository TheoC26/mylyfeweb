import { upload } from '../services/s3Service.js';
import { processVideoInBackground } from '../services/videoProcessingService.js';
import { supabase } from '../services/supabaseService.js';
import { deleteFromS3 } from '../services/s3Service.js';

const uploadMiddleware = upload.single('video');

/**
 * Extracts the S3 key from a full S3 URL.
 * @param {string} url The S3 URL.
 * @returns {string|null} The S3 key or null if the URL is invalid.
 */
function getKeyFromUrl(url) {
  if (!url) return null;
  try {
    const urlObject = new URL(url);
    // The key is the pathname, but we need to remove the leading '/'
    return urlObject.pathname.substring(1);
  } catch (error) {
    console.error('Invalid URL for key extraction:', url);
    return null;
  }
}

export const uploadClip = (req, res) => {
  uploadMiddleware(req, res, (err) => {
    if (err) {
      console.error('Upload error:', err);
      return res.status(400).json({ message: 'File upload failed.', error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No file was uploaded.' });
    }

    const { userPrompt } = req.body;
    if (!userPrompt) {
      return res.status(400).json({ message: 'userPrompt is required.' });
    }

    // Immediately respond to the client
    res.status(202).json({
      message: 'Video uploaded successfully. Processing has started in the background.',
      uploadUrl: req.file.location,
    });

    // Trigger background processing without waiting for it to complete
    const jobData = {
      file: req.file,
      user: req.user,
      userPrompt: userPrompt,
    };
    
    setImmediate(() => {
      processVideoInBackground(jobData);
    });
  });
};

export const deleteClip = async (req, res) => {
  const { id: clipId } = req.params;
  const userId = req.user.id;

  console.log(`Received request to delete clip ${clipId} for user ${userId}`);

  try {
    // 1. Fetch the clip from Supabase to verify ownership and get URLs
    const { data: clip, error: fetchError } = await supabase
      .from('clips')
      .select('clip_url, thumbnail_url')
      .eq('id', clipId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !clip) {
      // If no row is found, or if there's another error, deny access.
      // This securely prevents users from deleting clips they don't own.
      return res.status(404).json({ message: 'Clip not found or you do not have permission to delete it.' });
    }

    // 2. Extract S3 keys from the URLs
    const clipKey = getKeyFromUrl(clip.clip_url);
    const thumbKey = getKeyFromUrl(clip.thumbnail_url);
    
    console.log(`Found clip. Video key: ${clipKey}, Thumbnail key: ${thumbKey}`);

    // 3. Delete files from S3
    const deletePromises = [];
    if (clipKey) {
      deletePromises.push(deleteFromS3(clipKey));
    }
    if (thumbKey) {
      deletePromises.push(deleteFromS3(thumbKey));
    }
    await Promise.all(deletePromises);
    console.log('Successfully deleted files from S3.');

    // 4. Delete the record from the Supabase table
    const { error: deleteError } = await supabase
      .from('clips')
      .delete()
      .eq('id', clipId);

    if (deleteError) {
      throw new Error(`Supabase delete failed: ${deleteError.message}`);
    }
    console.log('Successfully deleted record from Supabase.');

    res.status(200).json({ message: 'Clip deleted successfully.' });

  } catch (error) {
    console.error(`Failed to delete clip ${clipId}:`, error);
    res.status(500).json({ message: error.message || 'An internal error occurred.' });
  }
};
