
import { GoogleGenerativeAI } from "@google/generative-ai";
import { readFileAsBase64 } from "./util.js";
import { v4 as uuidv4 } from "uuid";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const MODEL = "gemini-2.5-flash";

export async function analyzeVideoWithGemini(options) {
  const { file, userPrompt, wantTranscriptHints, progressCallback } = options;
  
  progressCallback?.("Reading video file...");
  const videoBase64 = readFileAsBase64(file);

  const model = genAI.getGenerativeModel({ model: MODEL });

  const instructions = `
You are a video editor assistant. Analyze the provided video and return JSON ONLY.
Goal: split the video into meaningful segments (shots or beats) and rate them for relevance to the user's intent.

User intent: "${userPrompt}"

Rules:
- Prefer natural shot/beat boundaries. Aim for segments 2–6 seconds.
- For each segment, provide:
  - start_sec (number, seconds from start)
  - end_sec (number, > start_sec)
  - description (1–2 short sentences, concrete details)
  - tags (array of short tokens like ["friends","party","outdoors"])
  - scores.relevance (0..1: how well it matches user intent)
  - scores.confidence (0..1: confidence in your analysis)
  - transcript_excerpt (optional; key spoken words if helpful)
- Ensure timestamps align with clear moments so cutting with ffmpeg -c copy is clean.
- Prefer segments with visible faces, emotion, activity, and variety.
- Return compact JSON with a top-level "segments" array. No extra text.
  `;

  const inputs = [
    { text: instructions },
    ...(wantTranscriptHints
      ? [{ text: `Transcript hints:\n${wantTranscriptHints.slice(0, 8000)}` }]
      : []),
    {
      inlineData: {
        mimeType: "video/mp4",
        data: videoBase64
      }
    }
  ];

  progressCallback?.("Analyzing with Gemini...");
  const result = await model.generateContent({
    contents: [{ role: "user", parts: inputs }]
  });

  const text = result.response.text();
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  const jsonStr =
    jsonStart >= 0 && jsonEnd > jsonStart ? text.slice(jsonStart, jsonEnd + 1) : text;

  let parsed = null;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Gemini parsing failed. Raw:\n${text}`);
  }

  const segments = (parsed?.segments || []).map((s) => ({
    id: uuidv4(),
    file,
    startSec: Math.max(0, s.start_sec),
    endSec: Math.max(s.end_sec, s.start_sec + 0.5),
    durationSec: Math.max(0.5, s.end_sec - s.start_sec),
    description: s.description,
    tags: s.tags,
    transcriptExcerpt: s.transcript_excerpt,
    scores: {
      relevance:
        typeof s.scores?.relevance === "number" ? s.scores.relevance : 0,
      quality: typeof s.scores?.quality === "number" ? s.scores.quality : 0.5,
      vibe: typeof s.scores?.vibe === "number" ? s.scores.vibe : 0.5,
      confidence:
        typeof s.scores?.confidence === "number" ? s.scores.confidence : 0.5
    }
  }));

  return { file, segments };
}
