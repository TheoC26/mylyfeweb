'use client';

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
      alert('Please select video files to upload.');
      return;
    }

    setIsProcessing(true);
    setProgress([]);
    setFinalVideoUrl(null);

    const formData = new FormData();
    files.forEach(file => {
      formData.append('videos', file);
    });
    formData.append('prompt', prompt);

    const response = await fetch('/api/process', {
      method: 'POST',
      body: formData,
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
      const lines = chunk.split('\n\n').filter(line => line.startsWith('data: '));

      for (const line of lines) {
        const jsonString = line.replace('data: ', '');
        try {
          const data = JSON.parse(jsonString);
          setProgress(prev => [...prev, data]);
          if (data.status === 'done') {
            setFinalVideoUrl(data.videoUrl);
            setIsProcessing(false);
          }
          if (data.status === 'error') {
            setIsProcessing(false);
          }
        } catch (e) {
          console.error('Failed to parse progress update:', jsonString);
        }
      }
    }
  };

  return (
    <div className="font-sans bg-gray-900 text-white min-h-screen flex flex-col items-center justify-center p-8">
      <header className="w-full max-w-4xl text-center mb-8">
        <h1 className="text-5xl font-bold mb-2">MyLyfe Video Maker</h1>
        <p className="text-lg text-gray-400">Upload your videos, give a prompt, and let AI create a highlight reel.</p>
      </header>

      <main className="w-full max-w-4xl bg-gray-800 rounded-lg shadow-lg p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Left side: Upload and Prompt */}
          <div>
            <div className="mb-6">
              <label htmlFor="video-upload" className="block text-xl font-medium mb-2">1. Upload Videos</label>
              <div 
                className="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-gray-400 transition"
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
                <p className="text-gray-400">Click to select files or drag and drop</p>
                {files.length > 0 && (
                  <ul className="mt-4 text-left text-sm text-gray-300">
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
                className="w-full bg-gray-700 border border-gray-600 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition text-white"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              ></textarea>
            </div>

            <button
              onClick={handleProcessClick}
              disabled={isProcessing || files.length === 0}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition disabled:bg-gray-500 disabled:cursor-not-allowed"
            >
              {isProcessing ? 'Processing...' : 'Create MyLyfe'}
            </button>
          </div>

          {/* Right side: Progress and Result */}
          <div className="bg-gray-900 rounded-lg p-6">
            <h2 className="text-xl font-medium mb-4">Progress</h2>
            <div className="h-64 overflow-y-auto bg-black bg-opacity-20 rounded-md p-4 font-mono text-sm space-y-2">
              {progress.map((p, i) => (
                <div key={i} className={`flex items-start ${p.status === 'error' ? 'text-red-400' : 'text-gray-300'}`}>
                  <span className="mr-2">{p.status === 'error' ? '✖' : '»'}</span>
                  <span>{p.message}</span>
                </div>
              ))}
              {isProcessing && progress.length === 0 && <p className="text-gray-400">Waiting to start...</p>}
            </div>

            {finalVideoUrl && (
              <div className="mt-6">
                <h2 className="text-xl font-medium mb-4">Your Video is Ready!</h2>
                <video controls src={finalVideoUrl} className="w-full rounded-lg"></video>
                <a 
                  href={finalVideoUrl} 
                  download 
                  className="mt-4 inline-block w-full text-center bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition"
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