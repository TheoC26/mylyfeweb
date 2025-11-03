'use client';
import { upload } from "@vercel/blob/client";
import { useState, useRef } from 'react';

export default function Home() {
  const [files, setFiles] = useState([]);
  const [prompt, setPrompt] = useState('anything that seems fun and makes my life look enjoyable');
  const [progress, setProgress] = useState([]);
  const [finalVideoUrl, setFinalVideoUrl] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    setFiles(Array.from(e.target.files));
  };

  const handleProcessClick = async () => {
    if (files.length === 0) {
      alert("Please select video files to upload.");
      return;
    }

    setIsProcessing(true);
    setProgress([]);
    setFinalVideoUrl(null);

    const blobUrls = [];

    for (const file of files) {
      try {
        console.log("Uploading file:", {
          name: file.name,
          size: file.size,
          type: file.type,
          sizeInMB: (file.size / (1024 * 1024)).toFixed(2),
        });

        // Use client upload with multipart support
        const blob = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/upload",
          multipart: true, // Enable multipart for large files
        });

        console.log("Upload successful:", blob);
        blobUrls.push(blob.url);
      } catch (error) {
        console.error("Upload error for", file.name, ":", error);
        setProgress((prev) => [
          ...prev,
          {
            status: "error",
            message: `Upload failed for ${file.name}: ${error.message}`,
          },
        ]);
        setIsProcessing(false);
        return;
      }
    }

    // Continue with your processing logic...
    const response = await fetch("/api/process", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ videoUrls: blobUrls, prompt }),
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
          setProgress((prev) => [...prev, data]);
          if (data.status === "done") {
            setFinalVideoUrl(data.videoUrl);
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

            {finalVideoUrl && (
              <div className="mt-6">
                <h2 className="text-xl font-medium mb-4">Your Video is Ready!</h2>
                <video controls src={finalVideoUrl} className="w-full rounded-2xl"></video>
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
