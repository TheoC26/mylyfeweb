'use client';
import { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase-client';
import { processFilesForUpload } from '../lib/client-video-processor';

export default function Home() {
  const [files, setFiles] = useState([]);
  const [prompt, setPrompt] = useState('anything that seems fun and makes my life look enjoyable');
  const [progress, setProgress] = useState([]);
  const [finalVideoUrl, setFinalVideoUrl] = useState(null); // For the permanent URL / download link
  const [playerUrl, setPlayerUrl] = useState(null); // For the playable blob URL
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef(null);

  // Clean up blob URL when component unmounts or when a new video is made
  useEffect(() => {
    return () => {
      if (playerUrl) {
        URL.revokeObjectURL(playerUrl);
      }
    };
  }, [playerUrl]);

  const handleFileChange = (e) => {
    setFiles(Array.from(e.target.files));
  };

  const processVideosOnServer = async (videoPaths) => {
    updateProgress({ status: 'processing', message: 'Starting AI video generation...' });
    
    const response = await fetch("/api/process-final", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ videoPaths, prompt }),
    });

    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        setIsProcessing(false);
        break;
      }

      const chunk = decoder.decode(value);
      const lines = chunk
        .split("\n\n")
        .filter((line) => line.startsWith("data: "));

      for (const line of lines) {
        const jsonString = line.replace("data: ", "");
        try {
          const data = JSON.parse(jsonString);
          updateProgress(data);
          if (data.status === "done") {
            // When done, we get the permanent Supabase URL
            setFinalVideoUrl(data.videoUrl);
            // Now, create a playable blob URL to get around COEP
            loadVideoForPlayer(data.videoUrl);
            setIsProcessing(false);
          }
          if (data.status === "error") {
            setIsProcessing(false);
          }
        } catch (e) {
          console.error("Failed to parse progress update:", jsonString);
        }
      }
    }
  };

  // Fetches the video and creates a local blob URL to use in the video player
  const loadVideoForPlayer = async (videoUrl) => {
    try {
      updateProgress({ status: 'processing', message: 'Loading video for preview...' });
      const response = await fetch(videoUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      setPlayerUrl(blobUrl);
    } catch (error) {
      console.error('Error creating blob URL for player:', error);
      updateProgress({ status: 'error', message: 'Could not load video preview.' });
    }
  };

  const updateProgress = (newStatus) => {
    setProgress(prev => [...prev, newStatus]);
  }

  const handleProcessClick = async () => {
    if (files.length === 0) {
      alert("Please select video files to upload.");
      return;
    }

    setIsProcessing(true);
    setProgress([]);
    setFinalVideoUrl(null);
    setPlayerUrl(null); // Clear previous video

    try {
      const processedFileChunks = await processFilesForUpload({
        files,
        sizeLimit: 19 * 1024 * 1024, // 19MB to be safe with Gemini's 20MB limit
        progressCallback: (message) => updateProgress({ status: 'processing', message }),
      });

      updateProgress({ status: 'processing', message: `Uploading ${processedFileChunks.length} video parts to Supabase...` });

      const uploadPromises = processedFileChunks.map(fileChunk => {
        const fileName = `public/${Date.now()}-${fileChunk.name}`;
        return supabase.storage.from('videos').upload(fileName, fileChunk);
      });

      const uploadResults = await Promise.all(uploadPromises);

      const videoPaths = [];
      for (const result of uploadResults) {
        if (result.error) {
          throw new Error(`Supabase upload failed: ${result.error.message}`);
        }
        videoPaths.push(result.data.path);
      }

      updateProgress({ status: 'processing', message: 'Uploads complete! Starting server process...' });
      
      await processVideosOnServer(videoPaths);

    } catch (error) {
      console.error("Processing error:", error);
      updateProgress({
        status: "error",
        message: error.message || "An unknown error occurred.",
      });
      setIsProcessing(false);
    }
  };

  return (
    <div className="font-sans bg-white text-black min-h-screen flex flex-col items-center justify-center p-8">
      <header className="w-full max-w-4xl text-center mb-8">
        <h1 className="text-5xl font-bold mb-2">MyLyfe Video Maker</h1>
        <p className="text-lg text-gray-600">Upload your videos, give a prompt, and let AI create a highlight reel.</p>
      </header>

      <main className="w-full max-w-4xl bg-gray-100 rounded-2xl shadow-xl border-2 border-gray-200 p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Left side: Upload and Prompt */}
          <div>
            <div className="mb-6">
              <label htmlFor="video-upload" className="block text-xl font-medium mb-2">1. Upload Videos</label>
              <div 
                className="border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center cursor-pointer hover:border-gray-500 transition"
                onClick={() => fileInputRef.current?.click()}
              >
                <input 
                  type="file" 
                  id="video-upload" 
                  ref={fileInputRef}
                  multiple 
                  accept="video/*" 
                  onChange={handleFileChange}
                  className="hidden"
                />
                <p className="text-gray-500">Click to select files or drag and drop</p>
                {files.length > 0 && (
                  <ul className="mt-4 text-left text-sm text-gray-600">
                    {files.map(file => <li key={file.name}>- {file.name}</li>)}
                  </ul>
                )}
              </div>
            </div>

            <div className="mb-6">
              <label htmlFor="prompt" className="block text-xl font-medium mb-2">2. Enter a Prompt</label>
              <textarea
                id="prompt"
                rows="3"
                className="w-full bg-white border border-gray-300 rounded-2xl p-3 focus:ring-2 focus:ring-black focus:border-black transition text-black"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              ></textarea>
            </div>

            <button
              onClick={handleProcessClick}
              disabled={isProcessing || files.length === 0}
              className="w-full bg-black hover:bg-gray-800 text-white font-bold py-3 px-4 rounded-2xl transition disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isProcessing ? 'Processing...' : 'Create MyLyfe'}
            </button>
          </div>

          {/* Right side: Progress and Result */}
          <div className="bg-gray-100 rounded-2xl p-6">
            <h2 className="text-xl font-medium mb-4">Progress</h2>
            <div className="h-20 flex items-center justify-center bg-white rounded-2xl p-4 font-bold text-sm">
              {progress.length > 0 ? (
                <div className={`flex items-start ${progress[progress.length - 1].status === 'error' ? 'text-red-500' : 'text-black'}`}>
                  <span className="mr-2">{progress[progress.length - 1].status === 'error' ? '✖' : '»'}</span>
                  <span>{progress[progress.length - 1].message}</span>
                </div>
              ) : (
                <p className="text-gray-500">Waiting to start...</p>
              )}
            </div>

            {(playerUrl || finalVideoUrl) && (
              <div className="mt-6">
                <h2 className="text-xl font-medium mb-4">Your Video is Ready!</h2>
                <video
                  key={playerUrl} // Key helps React replace the element
                  controls
                  src={playerUrl || finalVideoUrl}
                  className="w-full rounded-2xl"
                ></video>
                <a 
                  href={finalVideoUrl} 
                  download 
                  className="mt-4 inline-block w-full text-center bg-black hover:bg-gray-800 text-white font-bold py-2 px-4 rounded-2xl transition"
                >
                  Download Video
                </a>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
