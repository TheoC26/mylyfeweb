import { Router } from 'express';
import { uploadClip, deleteClip } from '../controllers/clipsController.js';
import { protect } from '../middleware/auth.js';

const router = Router();

// POST /api/clips/
// Protected route for uploading a video clip.
router.post('/', protect, uploadClip);

// DELETE /api/clips/:id
// Protected route for deleting a specific video clip.
router.delete('/:id', protect, deleteClip);

export default router;
