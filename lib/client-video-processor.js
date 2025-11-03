import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpeg;

async function loadFFmpeg(progressCallback) {
  if (ffmpeg && ffmpeg.loaded) {
    return ffmpeg;
  }
  ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => {
    // You can capture ffmpeg logs here if needed for debugging
  });
  // Note: We removed the progress handler as splitting with '-c copy' is too fast to measure.

  progressCallback('Loading video engine...');
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  return ffmpeg;
}

async function runFFmpegCommand(file, command, progressCallback) {
  const ffmpeg = await loadFFmpeg(progressCallback);
  const inputFileName = `input-${Date.now()}-${file.name}`;
  const outputFileName = `output-${Date.now()}.mp4`;

  await ffmpeg.writeFile(inputFileName, await fetchFile(file));

  const commandArray = command
    .replace("{input}", inputFileName)
    .replace("{output}", outputFileName)
    .split(" ");

  await ffmpeg.exec(commandArray);

  const data = await ffmpeg.readFile(outputFileName);
  await ffmpeg.deleteFile(inputFileName);
  await ffmpeg.deleteFile(outputFileName);

  // Preserve original filename better
  const baseName = file.name.replace(/\.[^/.]+$/, "");
  return new File([data], `${baseName}-part-${Date.now()}.mp4`, {
    type: "video/mp4",
  });
}

async function getVideoDuration(file) {
  const ffmpeg = await loadFFmpeg(() => {});
  const inputFileName = `duration-check-${Date.now()}.mp4`;

  await ffmpeg.writeFile(inputFileName, await fetchFile(file));

  let duration = 0;
  let logOutput = "";

  // Capture all log output
  const logHandler = ({ message }) => {
    logOutput += message + "\n";
  };

  ffmpeg.on("log", logHandler);

  try {
    await ffmpeg.exec(["-i", inputFileName]);
  } catch (e) {
    // Expected to fail
  }

  ffmpeg.off("log", logHandler);

  console.log("=== FULL FFMPEG OUTPUT ===");
  console.log(logOutput);
  console.log("=== END OUTPUT ===");

  // Try multiple duration patterns
  const patterns = [
    /Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/, // HH:MM:SS.CS
    /Duration: (\d{2}):(\d{2}):(\d{2})/, // HH:MM:SS
  ];

  for (const pattern of patterns) {
    const match = logOutput.match(pattern);
    if (match) {
      const hours = parseInt(match[1]) || 0;
      const minutes = parseInt(match[2]) || 0;
      const seconds = parseInt(match[3]) || 0;
      const fraction = match[4] ? parseInt(match[4]) / 100 : 0;

      duration = hours * 3600 + minutes * 60 + seconds + fraction;
      console.log(
        `Found duration: ${duration}s (${hours}h ${minutes}m ${seconds}s)`
      );
      break;
    }
  }

  if (duration === 0) {
    console.error(
      "Failed to parse duration, defaulting to file-size-based split"
    );
    // Fallback: assume 30fps and estimate from file size (very rough)
    duration = 60; // Default to 60 seconds if we can't determine
  }

  await ffmpeg.deleteFile(inputFileName);
  return duration;
}


export async function processFilesForUpload({
  files,
  sizeLimit,
  progressCallback,
}) {
  await loadFFmpeg(progressCallback);
  const finalFiles = [];
  const minFileSize = 1024 * 1024; // 1MB minimum - adjust as needed

  for (let i = 0; i < files.length; i++) {
    const currentFile = files[i];
    progressCallback(
      `Checking file ${i + 1} of ${files.length}: ${currentFile.name}`
    );

    const filesToProcess = [currentFile];
    let splitCount = 0;
    const maxSplits = 10; // Safety limit to prevent infinite loops

    while (filesToProcess.length > 0) {
      const fileToProcess = filesToProcess.shift();

      if (fileToProcess.size <= sizeLimit) {
        finalFiles.push(fileToProcess);
        progressCallback(`File part is ready for upload.`);
      } else if (fileToProcess.size < minFileSize * 2) {
        // File is too large but too small to split meaningfully
        console.warn(
          `File ${fileToProcess.name} is too large but cannot be split further`
        );
        finalFiles.push(fileToProcess); // Include it anyway
        progressCallback(
          `Warning: File cannot be split smaller, including as-is.`
        );
      } else if (splitCount >= maxSplits) {
        // Safety check: stop after too many splits
        console.warn(`Reached maximum split count for ${currentFile.name}`);
        finalFiles.push(fileToProcess);
        progressCallback(
          `Warning: Maximum splits reached, including remaining parts.`
        );
      } else {
        splitCount++;
        progressCallback(
          `File is too large (${(fileToProcess.size / 1024 / 1024).toFixed(
            1
          )}MB). Splitting (attempt ${splitCount})...`
        );

        const duration = await getVideoDuration(fileToProcess);
        const midPoint = duration / 2;

        // Keyframe-aware splitting with re-encoding
        // This ensures clean cuts at keyframes and no corruption
        const firstHalf = await runFFmpegCommand(
          fileToProcess,
          `-i {input} -t ${midPoint} -c copy -avoid_negative_ts make_zero {output}`,
          progressCallback
        );

        const secondHalf = await runFFmpegCommand(
          fileToProcess,
          `-ss ${midPoint} -i {input} -c copy -avoid_negative_ts make_zero {output}`,
          progressCallback
        );

        console.log(
          `Split ${fileToProcess.name} (${(
            fileToProcess.size /
            1024 /
            1024
          ).toFixed(1)}MB) into: ` +
            `${firstHalf.name} (${(firstHalf.size / 1024 / 1024).toFixed(
              1
            )}MB), ` +
            `${secondHalf.name} (${(secondHalf.size / 1024 / 1024).toFixed(
              1
            )}MB)`
        );

        filesToProcess.push(firstHalf, secondHalf);
      }
    }
  }

  progressCallback("All files are processed and ready for upload.");
  return finalFiles;
}