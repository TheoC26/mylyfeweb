import { S3Client } from '@aws-sdk/client-s3';
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

export const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.S3_BUCKET_NAME,
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
