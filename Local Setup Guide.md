🚀 WhisperVibe Studio - Local Setup GuideHier ist die Anleitung, um die App als echtes, skalierbares Projekt auf deinem Rechner aufzusetzen.1. Projekt initialisierenÖffne dein Terminal (PowerShell oder Git Bash) und führe folgendes aus:# 1. Vite Projekt erstellen (React + JavaScript)
npm create vite@latest whisper-vibe-studio -- --template react

# 2. In den Ordner gehen
cd whisper-vibe-studio

# 3. Dependencies installieren
# Wir brauchen transformers.js für die AI und lucide-react für die Icons
npm install @xenova/transformers lucide-react
2. Die Dateien erstellenErstelle oder überschreibe die folgenden Dateien in deinem src Ordner.A. Der Worker (src/worker.js)Erstelle eine neue Datei src/worker.js. Hier läuft die AI getrennt vom Main-Thread.// src/worker.js
import { pipeline, env } from '@xenova/transformers';

// WICHTIG: Da wir lokal arbeiten, aber die Modelle nicht lokal haben (zu groß),
// erlauben wir den Download vom HuggingFace Hub.
// Die WASM Dateien werden ebenfalls aus dem CDN oder node_modules geladen.
env.allowLocalModels = false;
env.useBrowserCache = true;

let transcriber = null;
let currentModel = null;

self.addEventListener('message', async (event) => {
    const { type, data } = event.data;

    if (type === 'load') {
        try {
            const modelName = data.model || 'Xenova/whisper-base';
            
            if (transcriber && currentModel === modelName) {
                self.postMessage({ status: 'ready', message: 'Modell bereits geladen.' });
                return;
            }

            self.postMessage({ status: 'loading', message: `Lade ${modelName}...` });
            
            // Pipeline initialisieren
            transcriber = await pipeline('automatic-speech-recognition', modelName, {
                quantized: true,
                progress_callback: (data) => {
                    if (data.status === 'progress') {
                        self.postMessage({ 
                            status: 'downloading', 
                            file: data.file, 
                            progress: data.progress,
                            loaded: data.loaded,
                            total: data.total
                        });
                    }
                    if (data.status === 'done') {
                         self.postMessage({ status: 'file_done', file: data.file });
                    }
                }
            });

            currentModel = modelName;
            self.postMessage({ status: 'ready', message: 'AI Engine bereit!' });
        } catch (err) {
            console.error(err);
            self.postMessage({ status: 'error', message: 'Ladefehler: ' + err.message });
        }
    }

    if (type === 'run') {
        if (!transcriber) {
            self.postMessage({ status: 'error', message: 'Modell ist noch nicht geladen.' });
            return;
        }

        try {
            self.postMessage({ status: 'processing', message: 'Analysiere Audio-Wellenformen...' });

            const options = {
                chunk_length_s: 30,
                stride_length_s: 5,
                return_timestamps: true,
                repetition_penalty: 1.4, // Anti-Loop für Musik
                no_speech_threshold: 0.6, 
            };

            if (data.language && data.language !== 'auto') {
                options.language = data.language;
            }

            // Inferenz starten
            const output = await transcriber(data.audio, options);

            self.postMessage({ status: 'complete', output });
        } catch (err) {
            console.error(err);
            self.postMessage({ status: 'error', message: 'Transkriptionsfehler: ' + err.message });
        }
    }
});
B. Die App (src/App.jsx)Überschreibe deine src/App.jsx hiermit. Beachte, wie wir den Worker jetzt importieren!// src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import { Upload, FileText, Download, AlertCircle, Activity, Cpu, Wand2, RotateCcw, Bug, Settings2, Languages, Gauge, Clock, Music } from 'lucide-react';

export default function App() {
  // --- STATE ---
  const [worker, setWorker] = useState(null);
  const [status, setStatus] = useState('idle'); 
  const [statusMessage, setStatusMessage] = useState('System initialisieren...');
  const [downloadState, setDownloadState] = useState({}); 
  
  // Settings State
  const [selectedModel, setSelectedModel] = useState('Xenova/whisper-base'); 
  const [selectedLanguage, setSelectedLanguage] = useState('auto');
  const [showSettings, setShowSettings] = useState(false);

  const [audioFile, setAudioFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [transcript, setTranscript] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  
  const audioRef = useRef(null);

  // --- WORKER SETUP ---
  useEffect(() => {
    // VITE MAGIC: Importiere den Worker als Modul
    const newWorker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

    newWorker.onmessage = (e) => {
      const { status: workerStatus, message, output, file, progress } = e.data;

      switch (workerStatus) {
        case 'loading':
          setStatus('loading_model');
          setStatusMessage(message);
          break;
        case 'downloading':
          setStatus('loading_model');
          setDownloadState(prev => ({ ...prev, [file]: progress }));
          setStatusMessage(`Lade ${file}...`);
          break;
        case 'ready':
          setStatus('ready');
          setStatusMessage(message);
          break;
        case 'processing':
          setStatus('processing');
          setStatusMessage(message);
          break;
        case 'complete':
          setStatus('complete');
          setTranscript(output);
          setStatusMessage('Transkription abgeschlossen!');
          break;
        case 'error':
          setStatus('error');
          setStatusMessage(message);
          break;
      }
    };

    setWorker(newWorker);
    newWorker.postMessage({ type: 'load', data: { model: 'Xenova/whisper-base' } });

    return () => newWorker.terminate();
  }, []);

  const changeModel = (newModel) => {
    if (!worker) return;
    setSelectedModel(newModel);
    setTranscript(null);
    setDownloadState({}); 
    worker.postMessage({ type: 'load', data: { model: newModel } });
  };

  // --- ACTIONS ---
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setAudioFile(file);
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    setTranscript(null);
    setAudioDuration(0);
    if (status === 'complete') setStatus('ready');
  };

  const handleMetadataLoaded = (e) => {
      setAudioDuration(e.target.duration);
  };

  const startTranscription = async () => {
    if (!worker || !audioFile) return;
    try {
        setStatus('processing');
        setStatusMessage('Resampling auf 16kHz...');
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const fileData = await audioFile.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(fileData);
        
        const offlineCtx = new OfflineAudioContext(1, audioBuffer.duration * 16000, 16000);
        const source = offlineCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineCtx.destination);
        source.start(0);
        const resampledBuffer = await offlineCtx.startRendering();
        const audioData = resampledBuffer.getChannelData(0);

        worker.postMessage({ 
            type: 'run', 
            data: { audio: audioData, language: selectedLanguage } 
        });
    } catch (e) {
        console.error(e);
        setStatus('error');
        setStatusMessage('Audio-Decoding Fehler: ' + e.message);
    }
  };

  const exportSRT = () => {
    if (!transcript || !transcript.chunks) return;
    let srtContent = "";
    transcript.chunks.forEach((chunk, index) => {
        const formatTime = (seconds) => {
            const date = new Date(0);
            date.setSeconds(seconds);
            const ms = Math.floor((seconds % 1) * 1000);
            const iso = date.toISOString().substr(11, 8);
            return `${iso},${ms.toString().padStart(3, '0')}`;
        };
        const start = chunk.timestamp[0];
        const end = chunk.timestamp[1] || chunk.timestamp[0] + 2;
        srtContent += `${index + 1}\n${formatTime(start)} --> ${formatTime(end)}\n${chunk.text.trim()}\n\n`;
    });
    const blob = new Blob([srtContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transkript.srt';
    a.click();
  };

  const jumpToTime = (timestamp) => {
    if (audioRef.current && timestamp) {
      audioRef.current.currentTime = timestamp[0];
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const formatDuration = (sec) => {
      if(!sec) return "0:00";
      const minutes = Math.floor(sec / 60);
      const seconds = Math.floor(sec % 60);
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const renderDownloadStatus = () => {
    const files = Object.entries(downloadState);
    if (files.length === 0) return null;
    const activeFile = files.find(([_, prog]) => prog < 100) || files[files.length - 1];
    const [fileName, progress] = activeFile;
    return (
      <div className="w-full max-w-md mx-auto mt-6 bg-slate-800/50 p-4 rounded-lg border border-slate-700">
        <div className="flex justify-between text-xs text-blue-300 mb-2 font-mono">
          <span className="truncate pr-4">{fileName}</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>
    );
  };

  const isTranscriptEmpty = transcript && (!transcript.text || transcript.text.trim() === "");

  // --- UI RENDER ---
  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100 font-sans selection:bg-cyan-500/30 selection:text-cyan-100">
      <header className="border-b border-slate-800 bg-[#0f172a]/80 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <div className="bg-gradient-to-tr from-blue-500 to-cyan-500 p-2 rounded-lg">
                <Activity className="text-white w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold text-white">WhisperVibe <span className="text-xs text-cyan-500 ml-1 border border-cyan-500/30 px-1.5 py-0.5 rounded">Local</span></h1>
          </div>
          <button onClick={() => setShowSettings(!showSettings)} className="text-slate-400 hover:text-white"><Settings2 /></button>
        </div>
        {showSettings && (
            <div className="bg-slate-900/95 border-b border-slate-800 p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div className="space-y-2">
                    <label className="flex items-center space-x-2 text-sm font-bold text-slate-300"><Gauge className="w-4" /> <span>Modell</span></label>
                    <button onClick={() => changeModel('Xenova/whisper-tiny')} className={`block w-full text-left px-4 py-2 rounded border ${selectedModel.includes('tiny') ? 'border-purple-500 bg-purple-500/10' : 'border-slate-700'}`}>Tiny (Schnell)</button>
                    <button onClick={() => changeModel('Xenova/whisper-base')} className={`block w-full text-left px-4 py-2 rounded border ${selectedModel.includes('base') ? 'border-purple-500 bg-purple-500/10' : 'border-slate-700'}`}>Base (Standard)</button>
                    <button onClick={() => changeModel('Xenova/whisper-small')} className={`block w-full text-left px-4 py-2 rounded border ${selectedModel.includes('small') ? 'border-purple-500 bg-purple-500/10' : 'border-slate-700'}`}>Small (High Quality)</button>
                 </div>
                 <div className="space-y-2">
                    <label className="flex items-center space-x-2 text-sm font-bold text-slate-300"><Languages className="w-4" /> <span>Sprache</span></label>
                    <select value={selectedLanguage} onChange={(e) => setSelectedLanguage(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded px-4 py-2">
                        <option value="auto">Auto</option>
                        <option value="en">Englisch</option>
                        <option value="de">Deutsch</option>
                    </select>
                 </div>
            </div>
        )}
      </header>

      <main className="max-w-5xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          {status === 'loading_model' && renderDownloadStatus()}
          {status === 'processing' && <div className="text-white animate-pulse mt-4">Verarbeite Audio... <span className="block text-xs text-slate-400">{statusMessage}</span></div>}
          {status === 'error' && <div className="text-red-400 bg-red-900/20 p-4 rounded border border-red-500/50 inline-block mt-4"><AlertCircle className="inline mr-2"/>{statusMessage}</div>}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-[#1e293b]/50 border border-slate-700 rounded-2xl p-6">
                <label className="block w-full cursor-pointer border-2 border-dashed border-slate-700 hover:border-cyan-500 rounded-xl p-8 text-center transition-colors">
                    <input type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />
                    {audioFile ? <Music className="w-10 h-10 mx-auto text-cyan-400 mb-2"/> : <Upload className="w-10 h-10 mx-auto text-slate-500 mb-2"/>}
                    <span className="text-slate-300 block text-sm">{audioFile ? audioFile.name : "Datei auswählen"}</span>
                </label>
                {audioUrl && (
                    <div className="mt-6">
                        <div className="flex justify-between text-xs text-slate-400 mb-1"><span>Dauer:</span> <span className="text-cyan-400">{formatDuration(audioDuration)}</span></div>
                        <audio ref={audioRef} src={audioUrl} controls className="w-full mb-4" onTimeUpdate={() => setCurrentTime(audioRef.current.currentTime)} onLoadedMetadata={handleMetadataLoaded} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} />
                        <button onClick={startTranscription} disabled={status !== 'ready' && status !== 'complete'} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                            {status === 'processing' ? <Activity className="w-5 h-5 animate-spin mx-auto"/> : "Transkription starten"}
                        </button>
                    </div>
                )}
            </div>
            {transcript && !isTranscriptEmpty && (
                <button onClick={exportSRT} className="w-full py-3 bg-slate-800 border border-slate-700 hover:bg-slate-700 rounded-xl text-slate-300 flex items-center justify-center gap-2"><Download className="w-4 h-4"/> SRT Download</button>
            )}
          </div>

          <div className="lg:col-span-8">
            <div className="bg-[#1e293b]/50 border border-slate-700 rounded-2xl h-[600px] flex flex-col p-6 overflow-hidden">
                <div className="flex justify-between items-center mb-4 border-b border-slate-700 pb-4">
                    <h3 className="font-bold text-slate-200 flex gap-2"><FileText className="text-cyan-400 w-5"/> Ausgabe</h3>
                    {transcript && <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded border border-green-500/30">FERTIG</span>}
                </div>
                <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                    {!transcript && <div className="h-full flex flex-col items-center justify-center text-slate-600"><FileText className="w-12 h-12 opacity-20 mb-2"/><p>Warte auf Input...</p></div>}
                    {transcript?.chunks?.map((chunk, i) => {
                        const active = currentTime >= chunk.timestamp[0] && currentTime <= (chunk.timestamp[1] || chunk.timestamp[0] + 2);
                        return (
                            <div key={i} onClick={() => jumpToTime(chunk.timestamp)} className={`p-3 rounded cursor-pointer transition-all border border-transparent hover:bg-slate-700/30 ${active ? 'bg-blue-500/10 border-blue-500/30 shadow-lg' : ''}`}>
                                <div className={`text-xs font-mono mb-1 ${active ? 'text-blue-400' : 'text-slate-500'}`}>{chunk.timestamp[0].toFixed(1)}s</div>
                                <p className={`text-base ${active ? 'text-white font-medium' : 'text-slate-300'}`}>{chunk.text}</p>
                            </div>
                        )
                    })}
                </div>
            </div>
          </div>
        </div>
      </main>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(71, 85, 105, 0.4); border-radius: 10px; }
      `}</style>
    </div>
  );
}
3. StartenFühre im Terminal aus:npm run dev
Öffne die angezeigte URL (meist http://localhost:5173).💡 Pro-Tipp für dein Godot/Research-ToolWenn du das später in dein Research-Tool integrieren willst:Du kannst den worker.js auch als eigenständigen Microservice (z.B. via Express.js Server) laufen lassen, an den du Audio-Dateien sendest und JSON zurückbekommst. Das entlastet den Frontend-Browser noch mehr, falls du riesige Dateien hast.