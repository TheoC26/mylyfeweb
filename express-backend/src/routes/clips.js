import { Router } from 'express';
import { uploadClip } from '../controllers/clipsController.js';
import { protect } from '../middleware/auth.js';

const router = Router();

// POST /api/clips/
// Protected route for uploading a video clip.
// Expects a multipart/form-data request with:
// - A 'video' file field
// - A 'userPrompt' text field
router.post('/', protect, uploadClip);

export default router;
