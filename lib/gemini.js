import { GoogleGenerativeAI } from "@google/generative-ai";
import { readFileAsBase64 } from "./util.js";
import { v4 as uuidv4 } from "uuid";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const MODEL = "gemini-2.5-flash"; // or "gemini-1.5-pro" for better accuracy

export async function analyzeVideoWithGemini(options) {
  const { file, userPrompt, wantTranscriptHints, progressCallback } = options;

  try {
    progressCallback?.("Reading video file...");
    const videoBase64 = readFileAsBase64(file);

    // Check file size to avoid API limits
    const fileSizeKB = Buffer.byteLength(videoBase64, "base64") / 1024;
    console.log(`Video file size: ${fileSizeKB.toFixed(2)} KB`);

    if (fileSizeKB > 20 * 1024) {
      // 20MB limit for Gemini
      throw new Error(
        `Video file too large: ${fileSizeKB.toFixed(2)} KB. Max: 20MB`
      );
    }

    const model = genAI.getGenerativeModel({
      model: MODEL,
      generationConfig: {
        temperature: 0.1, // Lower temperature for more consistent JSON
      },
    });

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

Example format:
{
  "segments": [
    {
      "start_sec": 0.0,
      "end_sec": 3.5,
      "description": "Person laughing with friends at outdoor party",
      "tags": ["friends", "party", "laughter", "outdoors"],
      "scores": {
        "relevance": 0.9,
        "confidence": 0.8
      }
    }
  ]
}
    `;

    const inputs = [
      { text: instructions },
      ...(wantTranscriptHints
        ? [{ text: `Transcript hints:\n${wantTranscriptHints.slice(0, 8000)}` }]
        : []),
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
    console.log("Raw Gemini response:", text.substring(0, 500) + "..."); // Log first 500 chars

    // More robust JSON extraction
    let jsonStr = text.trim();

    // Remove markdown code blocks if present
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
      console.error("JSON parsing failed:", e);
      console.error("Raw response:", text);
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
      .filter((s) => s.start_sec !== undefined && s.end_sec !== undefined) // Filter out invalid segments
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
          vibe: typeof s.scores?.vibe === "number" ? s.scores.vibe : 0.5,
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
