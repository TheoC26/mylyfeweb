import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const MODEL = "gemini-2.5-flash-lite";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Creates a default segment object to be used when analysis fails.
 * Now accepts a duration to calculate the endSec.
 * @param {number} [duration=3] - The total duration of the video in seconds.
 */
function createDefaultSegment(duration) {
  console.log("Returning default segment due to analysis failure.");

  // If duration is missing, default to 3 so the min() logic works safely
  const safeDuration = typeof duration === "number" ? duration : .5;

  return {
    id: uuidv4(),
    startSec: 0,
    // Logic: The minimum of the clip length OR 3 seconds
    endSec: Math.min(safeDuration, 3),
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
 * @param {number} [options.videoDuration] - (Optional) The duration of the video in seconds.
 * @returns {Promise<object>} The processed segment data or a default segment on failure.
 */
export async function analyzeVideoWithGemini(options) {
  // 1. Destructure videoDuration from options
  const { localPath, userPrompt, videoDuration } = options;

  try {
    const videoBase64 = await fs.readFile(localPath, { encoding: "base64" });

    if (!videoBase64 || videoBase64.length < 1000) {
      throw new Error(
        `Failed to read video file or file is corrupt/empty: ${path.basename(
          localPath
        )}`
      );
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
- - The clip should be between 2 and 6 seconds, unless there is someone speaking to the camera in which case you can include their full statement.
- Provide: start_sec, end_sec, description (1–2 short sentences, concrete details), and scores for relevance (0..1: how well it matches user intent), quality (0..1: how high quality the video is), and confidence (0..1: confidence in your analysis).
- Return compact JSON with a top-level "segments" array containing just ONE segment.
Example: { "segments": [ { "start_sec": 1.5, "end_sec": 5.2, "description": "...", "scores": { "relevance": 0.9, "quality": 0.8, "confidence": 0.7 } } ] }`;

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

        if (
          !parsed?.segments ||
          !Array.isArray(parsed.segments) ||
          parsed.segments.length === 0
        ) {
          throw new Error(
            `Invalid response structure or no segments found. Got: ${text}`
          );
        }

        const segment = parsed.segments[0];
        const processedSegment = {
          id: uuidv4(),
          startSec: Math.max(0, segment.start_sec),
          endSec: Math.max(segment.end_sec, segment.start_sec + 0.5),
          description: segment.description || "No description",
          scores: {
            relevance:
              typeof segment.scores?.relevance === "number"
                ? segment.scores.relevance
                : 0,
            quality:
              typeof segment.scores?.quality === "number"
                ? segment.scores.quality
                : 0.5,
            confidence:
              typeof segment.scores?.confidence === "number"
                ? segment.scores.confidence
                : 0.5,
          },
        };

        console.log("Successfully analyzed video.");
        return processedSegment;
      } catch (error) {
        console.warn(`Gemini attempt ${attempt} failed: ${error.message}`);

        if (
          error.message &&
          error.message.includes("503") &&
          attempt < maxRetries
        ) {
          const delayTime = 2 ** attempt * 5000 + Math.random() * 1000;
          console.warn(
            `Gemini API returned 503. Retrying in ${Math.round(
              delayTime / 1000
            )}s...`
          );
          await delay(delayTime);
        } else {
          console.error(
            "Gemini analysis is not retriable or has failed all retries."
          );
          break;
        }
      }
    }

    // 2. Pass videoDuration to the fallback function
    return createDefaultSegment(videoDuration);
  } catch (error) {
    console.error(
      `A critical error occurred in analyzeVideoWithGemini: ${error.message}`
    );
    // 3. Pass videoDuration to the fallback function here as well
    return createDefaultSegment(videoDuration);
  }
}

/**
 * Asks Gemini to identify redundant clips to improve variety.
 * @param {Array<{index: number, description: string}>} clips - A list of clips with their index and description.
 * @returns {Promise<number[]>} A prioritized list of clip indices to remove.
 */
export async function getPruningSuggestions(clips) {
  if (!clips || clips.length === 0) {
    return [];
  }

  const model = genAI.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  });

  const prompt = `
You are a video montage editor. I have a list of potential video clips, each with an index and a description.
Your goal is to identify clips that are visually or thematically redundant to improve the variety of the final video.
Do not remove clips that are unique. Only target clips that are very similar to others.

Here is the list of clips:
${JSON.stringify(clips)}

Please return a JSON object with a single key, "remove_indices", which is an array of numbers.
The numbers should be the indices of the clips you recommend removing.
Prioritize the most redundant clips first in the array. If there are no redundant clips, return an empty array.

Example response:
{
  "remove_indices": [12, 5, 2]
}`;

  try {
    console.log("Asking Gemini for pruning suggestions...");
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);

    if (parsed && Array.isArray(parsed.remove_indices)) {
      console.log(
        "Gemini suggested removing clips at indices:",
        parsed.remove_indices
      );
      return parsed.remove_indices;
    }

    console.warn(
      "Gemini did not return valid pruning suggestions. Raw response:",
      text
    );
    return [];
  } catch (error) {
    console.error("Gemini pruning analysis failed:", error);
    // On failure, we just don't prune anything.
    return [];
  }
}
