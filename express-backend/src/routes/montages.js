import { Router } from 'express';
import { createMontage } from '../controllers/montagesController.js';
import { protect } from '../middleware/auth.js';

const router = Router();

// POST /api/montages
// Protected route to trigger the creation of a new montage video.
router.post('/', protect, createMontage);

export default router;
