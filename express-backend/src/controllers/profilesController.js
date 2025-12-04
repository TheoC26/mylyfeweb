import sharp from 'sharp';
import { supabase } from '../services/supabaseService.js';
import { uploadBufferToS3, deleteFromS3 } from '../services/s3Service.js';

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

/**
 * Handles profile photo creation and updates.
 * Compresses the image, uploads to S3, updates the database,
 * and deletes the old photo.
 */
export const updateProfilePhoto = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No photo file provided.' });
  }

  const userId = req.user.id;
  let oldPhotoKey = null;

  try {
    // 1. Get the current profile to find the old photo URL
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('profile_pic_url')
      .eq('id', userId)
      .single();

    if (profileError && profileError.code !== 'PGRST116') { // Ignore 'no rows found' error
      throw new Error(`Supabase profile fetch failed: ${profileError.message}`);
    }

    if (profile?.profile_pic_url) {
      oldPhotoKey = getKeyFromUrl(profile.profile_pic_url);
    }

    // 2. Compress the image with Sharp
    const compressedBuffer = await sharp(req.file.buffer)
      .resize(500, 500, { fit: 'cover' })
      .webp({ quality: 80 })
      .toBuffer();

    // 3. Upload the new photo to S3
    const newPhotoKey = `profiles/${userId}/${Date.now()}.webp`;
    const newPhotoUrl = await uploadBufferToS3(compressedBuffer, newPhotoKey, 'image/webp');

    // 4. Update the profile in Supabase with the new URL
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ profile_pic_url: newPhotoUrl })
      .eq('id', userId);

    if (updateError) {
      throw new Error(`Supabase profile update failed: ${updateError.message}`);
    }

    // 5. If update was successful, delete the old photo from S3
    if (oldPhotoKey) {
      await deleteFromS3(oldPhotoKey);
    }

    res.status(200).json({
      message: 'Profile photo updated successfully.',
      profile_pic_url: newPhotoUrl,
    });

  } catch (error) {
    console.error('Profile photo update failed:', error);
    res.status(500).json({ message: error.message || 'An internal error occurred.' });
  }
};

/**
 * Handles profile photo deletion.
 * Deletes the photo from S3 and sets the database field to null.
 */
export const deleteProfilePhoto = async (req, res) => {
  const userId = req.user.id;

  try {
    // 1. Get the current profile to find the photo URL
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('profile_pic_url')
      .eq('id', userId)
      .single();

    if (profileError) {
      throw new Error(`Supabase profile fetch failed: ${profileError.message}`);
    }

    const photoKey = getKeyFromUrl(profile?.profile_pic_url);

    if (!photoKey) {
      return res.status(404).json({ message: 'No profile photo to delete.' });
    }

    // 2. Set the profile_pic_url to null in Supabase
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ profile_pic_url: null })
      .eq('id', userId);

    if (updateError) {
      throw new Error(`Supabase profile update failed: ${updateError.message}`);
    }

    // 3. Delete the file from S3
    await deleteFromS3(photoKey);

    res.status(200).json({ message: 'Profile photo deleted successfully.' });

  } catch (error) {
    console.error('Profile photo deletion failed:', error);
    res.status(500).json({ message: error.message || 'An internal error occurred.' });
  }
};
