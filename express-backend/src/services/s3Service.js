import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import multer from 'multer';
import multerS3 from 'multer-s3';
import { getUpcomingSunday } from '../utils/date.js';

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME;

// --- Video Upload Service (existing) ---
export const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: BUCKET_NAME,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname });
    },
    key: function (req, file, cb) {
      const userId = req.user.id;
      const weekEndDate = getUpcomingSunday().toISOString().split('T')[0]; // YYYY-MM-DD
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const filename = `clips/${userId}/${weekEndDate}/${uniqueSuffix}-${file.originalname}`;
      cb(null, filename);
    },
  }),
  limits: { fileSize: 1024 * 1024 * 500 }, // 500MB file size limit
});


// --- Profile Photo Services (new) ---

// Multer config for handling file uploads in memory for processing
export const uploadInMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 10 }, // 10MB limit for profile photos
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Not an image! Please upload an image file.'), false);
    }
  },
});

/**
 * Uploads a buffer to S3.
 * @param {Buffer} buffer The file buffer to upload.
 * @param {string} key The destination key (path/filename) in S3.
 * @param {string} contentType The MIME type of the file.
 * @returns {Promise<string>} The public URL of the uploaded file.
 */
export async function uploadBufferToS3(buffer, key, contentType) {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3.send(command);
  return `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

/**
 * Deletes a file from S3 using its key.
 * @param {string} key The key of the file to delete.
 */
export async function deleteFromS3(key) {
  if (!key) return;
  
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  try {
    await s3.send(command);
    console.log(`Successfully deleted ${key} from S3.`);
  } catch (error) {
    console.error(`Failed to delete ${key} from S3:`, error);
  }
}
