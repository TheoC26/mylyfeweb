import { Router } from 'express';
import { createMontage, deleteMontage } from '../controllers/montagesController.js';
import { protect } from '../middleware/auth.js';

const router = Router();

// POST /api/montages
// Protected route to trigger the creation of a new montage video.
router.post('/', protect, createMontage);

// DELETE /api/montages/:id
// Protected route for deleting a specific montage.
router.delete("/:id", protect, deleteMontage);

export default router;
