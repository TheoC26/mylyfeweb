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

  const MIN_DURATION = 60; // 1 min
  const MAX_DURATION = 180; // 3 min
  let currentThreshold = 0.7; // Start with high threshold
  const thresholdStep = 0.1; // How much to lower threshold each iteration
  const minThreshold = 0.1; // Don't go below this

  let chosen = [];
  let total = 0;

  // Keep trying with lower thresholds until we reach MIN_DURATION or use all videos
  while (total < MIN_DURATION && currentThreshold >= minThreshold) {
    console.log(`Trying with threshold: ${currentThreshold.toFixed(2)}`);

    chosen = [];
    total = 0;
    const usedFiles = new Set();

    // Select best segment from each video that meets current threshold
    for (const { s, score } of scored) {
      if (usedFiles.has(s.file)) continue; // Skip if we already have a segment from this video
      if (score < currentThreshold) continue; // Skip if score too low
      if (total + s.durationSec > MAX_DURATION) continue; // Skip if would exceed max

      chosen.push(s);
      total += s.durationSec;
      usedFiles.add(s.file);

      console.log(
        `Added segment from ${s.file}: ${s.durationSec.toFixed(
          1
        )}s (score: ${score.toFixed(2)}), total: ${total.toFixed(1)}s`
      );

      // If we've used all videos, we can't add more
      if (usedFiles.size === videos.length) {
        console.log(`Used all ${videos.length} videos`);
        break;
      }
    }

    // If we reached our target or used all videos, we're done
    if (total >= MIN_DURATION || chosen.length === videos.length) {
      break;
    }

    // Otherwise, lower the threshold and try again
    currentThreshold -= thresholdStep;
  }

  // Sort chosen segments by file and start time for smooth playback
  chosen.sort((a, b) =>
    a.file === b.file ? a.startSec - b.startSec : a.file.localeCompare(b.file)
  );

  console.log(
    `Final selection with threshold ${currentThreshold + thresholdStep}:`
  );
  console.log(
    `${chosen.length} segments from ${chosen.length} videos, ${total.toFixed(
      1
    )}s total`
  );
  chosen.forEach((s, i) => {
    const score = scored.find((item) => item.s === s)?.score || 0;
    console.log(
      `  ${i + 1}. ${s.file}: ${s.startSec.toFixed(1)}-${s.endSec.toFixed(
        1
      )}s (${s.durationSec.toFixed(1)}s, score: ${score.toFixed(2)})`
    );
  });

  return { chosen, totalDurationSec: total };
}
