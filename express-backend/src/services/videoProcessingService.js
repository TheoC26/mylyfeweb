import { analyzeVideoWithGemini } from './geminiService.js';
import { supabase } from './supabaseService.js';
import { getUpcomingSunday } from '../utils/date.js';

export async function processVideoInBackground(jobData) {
  const { file, user, userPrompt } = jobData;
  const { key: s3Key, bucket: s3Bucket, location: clipUrl } = file;
  const userId = user.id;

  try {
    console.log(`Starting background processing for ${s3Key}`);

    // 1. Analyze with Gemini
    const analysisResult = await analyzeVideoWithGemini({
      s3Bucket,
      s3Key,
      userPrompt,
    });

    // 2. Prepare data for Supabase
    const weekEndDate = getUpcomingSunday();
    const clipData = {
      user_id: userId,
      clip_url: clipUrl,
      start_sec: analysisResult.startSec,
      end_sec: analysisResult.endSec,
      description: analysisResult.description,
      relevance: analysisResult.scores.relevance,
      quality: analysisResult.scores.quality,
      confidence: analysisResult.scores.confidence,
      date_uploaded: new Date(),
      week_end_date: weekEndDate,
    };

    // 3. Insert into Supabase
    console.log('Inserting clip data into Supabase...');
    const { error } = await supabase.from('clips').insert([clipData]);

    if (error) {
      throw new Error(`Supabase insert failed: ${error.message}`);
    }

    console.log(`Successfully processed and saved clip ${s3Key}`);
    // Here you could add a notification step (e.g., webhook, push notification)
    // to inform the user that processing is complete.

  } catch (error) {
    console.error(`[FAIL] Background processing for ${s3Key} failed:`, error);
    // Here you could update a status in your DB to reflect the failure.
  }
}
