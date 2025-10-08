
export function selectBestSegments(input) {
  const { videos } = input;

  const all = videos.flatMap((v) => v.segments);

  const scored = all
    .map((s) => {
      const rel = s.scores.relevance ?? 0;
      const qual = s.scores.quality ?? 0.5;
      const conf = s.scores.confidence ?? 0.5;
      const durPenalty = s.durationSec > 12 ? 0.9 : 1;
      const score = rel * 0.7 + qual * 0.2 + conf * 0.1;
      return { s, score: score * durPenalty };
    })
    .sort((a, b) => b.score - a.score);

  const chosen = [];
  let total = 0;
  const usedFiles = new Set();

  const MIN_DURATION = 60; // 1 min
  const MAX_DURATION = 180; // 3 min
  const MIN_SCORE_THRESHOLD = 0.5;

  for (const { s, score } of scored) {
    if (usedFiles.has(s.file)) continue;
    if (score < MIN_SCORE_THRESHOLD) continue;

    if (total + s.durationSec > MAX_DURATION) continue;

    chosen.push(s);
    total += s.durationSec;
    usedFiles.add(s.file);

    if (total >= MAX_DURATION - 0.25) break;
  }

  if (total < MIN_DURATION) {
    for (const { s, score } of scored) {
      if (usedFiles.has(s.file)) continue;
      if (score < MIN_SCORE_THRESHOLD) continue;

      if (total + s.durationSec > MAX_DURATION) continue;

      chosen.push(s);
      total += s.durationSec;
      usedFiles.add(s.file);

      if (total >= MIN_DURATION) break;
    }
  }

  chosen.sort((a, b) =>
    a.file === b.file ? a.startSec - b.startSec : a.file.localeCompare(b.file)
  );

  return { chosen, totalDurationSec: total };
}
