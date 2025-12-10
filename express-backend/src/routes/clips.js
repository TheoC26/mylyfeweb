import { Router } from "express";
import {
  uploadClip,
  deleteClip,
  getClipProcessingStatus,
} from "../controllers/clipsController.js";
import { protect } from "../middleware/auth.js";

const router = Router();

// POST /api/clips/
// Protected route for uploading a video clip.
router.post("/", protect, uploadClip);

// GET /api/clips/jobs/:jobId
// Polling endpoint to check the status of a background processing job.
router.get("/jobs/:jobId", protect, getClipProcessingStatus);

// DELETE /api/clips/:id
// Protected route for deleting a specific video clip.
router.delete("/:id", protect, deleteClip);

export default router;
