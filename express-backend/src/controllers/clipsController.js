import { upload } from '../services/s3Service.js';
import { processVideoInBackground } from '../services/videoProcessingService.js';

const uploadMiddleware = upload.single('video');

export const uploadClip = (req, res) => {
  console.log('Received upload request for clip.');
  uploadMiddleware(req, res, (err) => {
    console.log('Upload middleware called.');
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
    
    // Use setImmediate to ensure the response is sent before processing starts
    setImmediate(() => {
      processVideoInBackground(jobData);
    });
  });
};
