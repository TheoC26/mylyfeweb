import fs from "node:fs/promises"; // Use promises version
import fsSync from "node:fs"; // Keep sync version for readFileAsBase64
import path from "node:path";

export async function ensureDir(p) {
  try {
    await fs.mkdir(p, { recursive: true });
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
  }
}

export async function writeJSON(p, data) {
  await fs.writeFile(p, JSON.stringify(data, null, 2), "utf-8");
}

export function readFileAsBase64(p) {
  const buf = fsSync.readFileSync(p);
  return buf.toString("base64");
}

export function toHhmmss(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((s % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const ss = Math.floor(s % 60)
    .toString()
    .padStart(2, "0");
  return `${h}:${m}:${ss}`;
}
