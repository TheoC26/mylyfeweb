import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const MODEL = "gemini-2.5-flash-lite";

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Creates a default segment object to be used when analysis fails.
 */
function createDefaultSegment() {
  console.log("Returning default segment due to analysis failure.");
  return {
    id: uuidv4(),
    startSec: 0,
    endSec: 0.5,
    description: "Video analysis failed.",
    scores: {
      relevance: 0.5,
      quality: 0.5,
      confidence: 0.5,
    },
  };
}

/**
 * Analyzes a local video file with Gemini, with retry logic.
 * @param {object} options
 * @param {string} options.localPath - The local path to the video file.
 * @param {string} options.userPrompt - The user's prompt for the analysis.
 * @returns {Promise<object>} The processed segment data or a default segment on failure.
 */
export async function analyzeVideoWithGemini(options) {
  const { localPath, userPrompt } = options;

  try {
    const videoBase64 = await fs.readFile(localPath, { encoding: "base64" });

    if (!videoBase64 || videoBase64.length < 1000) {
      throw new Error(`Failed to read video file or file is corrupt/empty: ${path.basename(localPath)}`);
    }

    const model = genAI.getGenerativeModel({
      model: MODEL,
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    });

    const instructions = `
You are a video editor assistant. Analyze the provided video and return JSON ONLY.
Goal: Find the single best segment, between 2 and 8 seconds long, that matches the user's intent.
User intent: "${userPrompt}"
Rules:
- Find only the one best clip.
- The clip must be between 2 and 8 seconds.
- Provide: start_sec, end_sec, description (1–2 short sentences, concrete details), and scores for relevance (0..1: how well it matches user intent), quality (0..1: how high quality the video is), and confidence (0..1: confidence in your analysis).
- Return compact JSON with a top-level "segments" array containing just ONE segment.
Example: { "segments": [ { "start_sec": 12.5, "end_sec": 17.0, "description": "...", "scores": { "relevance": 0.9, "quality": 0.8, "confidence": 0.8 } } ] }`;

    const inputs = [
      { text: instructions },
      { inlineData: { mimeType: "video/mp4", data: videoBase64 } },
    ];

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Analyzing with Gemini (Attempt ${attempt})...`);
        const result = await model.generateContent({
          contents: [{ role: "user", parts: inputs }],
        });

        const text = result.response.text();
        const parsed = JSON.parse(text);

        if (!parsed?.segments || !Array.isArray(parsed.segments) || parsed.segments.length === 0) {
          throw new Error(`Invalid response structure or no segments found. Got: ${text}`);
        }

        const segment = parsed.segments[0];
        const processedSegment = {
          id: uuidv4(),
          startSec: Math.max(0, segment.start_sec),
          endSec: Math.max(segment.end_sec, segment.start_sec + 0.5),
          description: segment.description || "No description",
          scores: {
            relevance: typeof segment.scores?.relevance === "number" ? segment.scores.relevance : 0,
            quality: typeof segment.scores?.quality === "number" ? segment.scores.quality : 0.5,
            confidence: typeof segment.scores?.confidence === "number" ? segment.scores.confidence : 0.5,
          },
        };

        console.log("Successfully analyzed video.");
        return processedSegment;

      } catch (error) {
        console.warn(`Gemini attempt ${attempt} failed: ${error.message}`);
        
        if (error.message && error.message.includes('503') && attempt < maxRetries) {
          const delayTime = (2 ** attempt) * 5000 + Math.random() * 1000;
          console.warn(`Gemini API returned 503. Retrying in ${Math.round(delayTime / 1000)}s...`);
          await delay(delayTime);
        } else {
          console.error("Gemini analysis is not retriable or has failed all retries.");
          break;
        }
      }
    }

    return createDefaultSegment();

  } catch (error) {
    console.error(`A critical error occurred in analyzeVideoWithGemini: ${error.message}`);
    return createDefaultSegment();
  }
}