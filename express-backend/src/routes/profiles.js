import { Router } from 'express';
import { updateProfilePhoto, deleteProfilePhoto } from '../controllers/profilesController.js';
import { protect } from '../middleware/auth.js';
import { uploadInMemory } from '../services/s3Service.js';

const router = Router();

// Middleware for handling single photo upload, stored in memory
const photoUploadMiddleware = uploadInMemory.single('photo');

// POST /api/profiles/photo
// Protected route for creating or updating a profile photo.
// Expects a multipart/form-data request with a 'photo' file field.
router.post('/photo', protect, photoUploadMiddleware, updateProfilePhoto);

// DELETE /api/profiles/photo
// Protected route for deleting a profile photo.
router.delete('/photo', protect, deleteProfilePhoto);

export default router;
