import { GoogleGenerativeAI } from "@google/generative-ai";
import { readFileAsBase64 } from "./util.js";
import { v4 as uuidv4 } from "uuid";
import path from "node:path";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const MODEL = "gemini-2.5-flash";

export async function analyzeVideoWithGemini(options) {
  const { file, userPrompt, isFastMode, progressCallback } = options;

  try {
    progressCallback?.("Reading video file...");
    const videoBase64 = readFileAsBase64(file);

    if (!videoBase64 || videoBase64.length < 1000) {
      throw new Error(
        `Failed to read video file or file is corrupt/empty: ${path.basename(
          file
        )}`
      );
    }

    const fileSizeKB = Buffer.byteLength(videoBase64, "base64") / 1024;
    if (fileSizeKB > 19 * 1024) {
      throw new Error(
        `Video file too large: ${fileSizeKB.toFixed(2)} KB. Max: 19MB`
      );
    }

    const model = genAI.getGenerativeModel({
      model: MODEL,
      generationConfig: {
        temperature: 0.1,
      },
    });

    const instructionsLegacy = `
You are a video editor assistant. Analyze the provided video and return JSON ONLY.
Goal: split the video into meaningful segments (shots or beats) and rate them for relevance to the user's intent.
User intent: "${userPrompt}"
Rules:
- Prefer natural shot/beat boundaries. Aim for segments 2–6 seconds.
- For each segment, provide: start_sec, end_sec, description (1–2 short sentences, concrete details), tags (array of short tokens like ["friends","party","outdoors"]), and scores for relevance (0..1: how well it matches user intent), quality (0..1: how high quality the video is), and confidence (0..1: confidence in your analysis).
- Ensure timestamps align with clear moments.
- Prefer segments with visible faces, emotion, activity, and variety.
- Return compact JSON with a top-level "segments" array. No extra text.
Example: { "segments": [ { "start_sec": 0.0, "end_sec": 3.5, "description": "...", "tags": ["..."], "scores": { "relevance": 0.9, "quality": 0.8, "confidence": 0.8 } } ] }`;

    const instructionsFast = `
You are a video editor assistant. Analyze the provided video and return JSON ONLY.
Goal: Find the single best segment, between 2 and 8 seconds long, that matches the user's intent.
User intent: "${userPrompt}"
Rules:
- Find only the one best clip.
- The clip must be between 2 and 8 seconds.
- Provide: start_sec, end_sec, description (1–2 short sentences, concrete details), and scores for relevance (0..1: how well it matches user intent), quality (0..1: how high quality the video is), and confidence (0..1: confidence in your analysis).
- Return compact JSON with a top-level "segments" array containing just ONE segment.
Example: { "segments": [ { "start_sec": 12.5, "end_sec": 17.0, "description": "...", "scores": { "relevance": 0.9, "quality": 0.8, "confidence": 0.8 } } ] }`;

    const instructions = isFastMode ? instructionsFast : instructionsLegacy;

    const inputs = [
      { text: instructions },
      {
        inlineData: {
          mimeType: "video/mp4",
          data: videoBase64,
        },
      },
    ];

    progressCallback?.("Analyzing with Gemini...");
    const result = await model.generateContent({
      contents: [{ role: "user", parts: inputs }],
    });

    const text = result.response.text();

    let jsonStr = text.trim();
    if (jsonStr.startsWith("```json")) {
      jsonStr = jsonStr.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }
    const jsonStart = jsonStr.indexOf("{");
    const jsonEnd = jsonStr.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      jsonStr = jsonStr.slice(jsonStart, jsonEnd + 1);
    }

    let parsed = null;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error(
        `Gemini parsing failed: ${e.message}. Raw response: ${text.substring(
          0,
          200
        )}...`
      );
    }

    if (!parsed?.segments || !Array.isArray(parsed.segments)) {
      throw new Error(
        `Invalid response structure. Expected segments array, got: ${typeof parsed?.segments}`
      );
    }

    const segments = parsed.segments
      .filter((s) => s.start_sec !== undefined && s.end_sec !== undefined)
      .map((s) => ({
        id: uuidv4(),
        file,
        startSec: Math.max(0, s.start_sec),
        endSec: Math.max(s.end_sec, s.start_sec + 0.5),
        durationSec: Math.max(0.5, s.end_sec - s.start_sec),
        description: s.description || "No description",
        tags: Array.isArray(s.tags) ? s.tags : [],
        transcriptExcerpt: s.transcript_excerpt || "",
        scores: {
          relevance:
            typeof s.scores?.relevance === "number" ? s.scores.relevance : 0,
          quality:
            typeof s.scores?.quality === "number" ? s.scores.quality : 0.5,
          confidence:
            typeof s.scores?.confidence === "number"
              ? s.scores.confidence
              : 0.5,
        },
      }));

    console.log(
      `Successfully analyzed video: ${segments.length} segments found`
    );
    return { file, segments };
  } catch (error) {
    console.error("Gemini analysis error:", error);
    progressCallback?.(`Analysis failed: ${error.message}`);
    throw error;
  }
}
