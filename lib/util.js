
import fs from "node:fs";
import path from "node:path";

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

export function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

export function readFileAsBase64(p) {
  const buf = fs.readFileSync(p);
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
