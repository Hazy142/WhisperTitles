import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Upload, Play, Pause, FileText, Download, AlertCircle, Activity, Cpu, Wand2, RotateCcw, Bug, Settings2, Languages, Gauge, Zap, Clock, Music } from 'lucide-react';

/**
 * WORKER CODE BLOBS
 */
const workerScript = `
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

env.allowLocalModels = false;
env.useBrowserCache = true;

let transcriber = null;
let currentModel = null;

self.addEventListener('message', async (event) => {
    const { type, data } = event.data;

    if (type === 'load') {
        try {
            const modelName = data.model || 'Xenova/whisper-tiny';
            
            if (transcriber && currentModel === modelName) {
                self.postMessage({ status: 'ready', message: 'Modell bereits geladen.' });
                return;
            }

            self.postMessage({ status: 'loading', message: `Lade ${modelName}...` });
            
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
                chunk_length_s: 15,
                stride_length_s: 3,
                return_timestamps: true,
                repetition_penalty: 1.4, // Aggressiver gegen Loops bei Musik
                no_speech_threshold: 0.6, // Sensibler für Sprache in Rauschen/Musik
            };

            if (data.language && data.language !== 'auto') {
                options.language = data.language;
            }

            const output = await transcriber(data.audio, options);

            console.log("Worker Output Raw:", output);
            self.postMessage({ status: 'complete', output });
        } catch (err) {
            console.error(err);
            self.postMessage({ status: 'error', message: 'Transkriptionsfehler: ' + err.message });
        }
    }
});
`;

export default function App() {
  // --- STATE ---
  const [worker, setWorker] = useState(null);
  const [status, setStatus] = useState('idle'); 
  const [statusMessage, setStatusMessage] = useState('System initialisieren...');
  const [downloadState, setDownloadState] = useState({}); 
  
  // Settings State
  const [selectedModel, setSelectedModel] = useState('Xenova/whisper-base'); // Default auf Base erhöht
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
    const blob = new Blob([workerScript], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    const newWorker = new Worker(workerUrl, { type: 'module' });

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
        default:
          break;
      }
    };

    setWorker(newWorker);

    // Initial Load mit Base Model (besser als Tiny für Start)
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
    setAudioDuration(0); // Reset duration until loaded
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

        // Resampling Logic
        const offlineCtx = new OfflineAudioContext(1, audioBuffer.duration * 16000, 16000);
        const source = offlineCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineCtx.destination);
        source.start(0);
        
        const resampledBuffer = await offlineCtx.startRendering();
        const audioData = resampledBuffer.getChannelData(0);

        console.log(`Audio Info: ${audioBuffer.duration}s, Resampled Samples: ${audioData.length}`);

        worker.postMessage({
            type: 'run', 
            data: {
                audio: audioData,
                language: selectedLanguage 
            } 
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
        
        srtContent += `${index + 1}\n`;
        srtContent += `${formatTime(start)} --> ${formatTime(end)}\n`;
        srtContent += `${chunk.text.trim()}\n\n`;
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

  // --- UI RENDERING ---

  const renderDownloadStatus = () => {
    const files = Object.entries(downloadState);
    if (files.length === 0) return null;

    const activeFile = files.find(([_, prog]) => prog < 100) || files[files.length - 1];
    const [fileName, progress] = activeFile;
    const isModelFile = fileName.includes('onnx');

    return (
      <div className="w-full max-w-md mx-auto mt-6 bg-slate-800/50 p-4 rounded-lg border border-slate-700 animate-fade-in">
        <div className="flex justify-between text-xs text-blue-300 mb-2 font-mono">
          <span className="truncate pr-4" title={fileName}>
            {isModelFile ? `⚡ Lade ${selectedModel}...` : '⚙️ Lade Config...'}
          </span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        {isModelFile && progress < 100 && (
            <div className="text-[10px] text-slate-500 text-center mt-2">
                Erster Download kann je nach Modellgröße (Small ~500MB) dauern.
            </div>
        )}
      </div>
    );
  };

  const isTranscriptEmpty = transcript && (!transcript.text || transcript.text.trim() === "");

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100 font-sans selection:bg-cyan-500/30 selection:text-cyan-100">
      {/* Header */}
      <header className="border-b border-slate-800 bg-[#0f172a]/80 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <div className="bg-gradient-to-tr from-blue-500 to-cyan-500 p-2 rounded-lg shadow-lg shadow-cyan-500/20">
                <Activity className="text-white w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
              WhisperVibe <span className="text-xs font-medium text-cyan-500 ml-1 border border-cyan-500/30 px-1.5 py-0.5 rounded">4.0 Studio</span>
            </h1>
          </div>
          
          <div className="flex items-center space-x-3">
             <button 
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2 rounded-lg transition-colors ${showSettings ? 'bg-blue-500/20 text-blue-400' : 'text-slate-400 hover:bg-slate-800'}`}
                title="Einstellungen"
             >
                <Settings2 className="w-5 h-5" />
             </button>
          </div>
        </div>
        
        {/* Settings Panel */}
        {showSettings && (
            <div className="bg-slate-900/95 border-b border-slate-800 animate-slide-down">
                <div className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    
                    {/* Model Selector */}
                    <div className="space-y-2">
                        <label className="flex items-center space-x-2 text-sm font-semibold text-slate-300">
                            <Gauge className="w-4 h-4 text-purple-400" />
                            <span>KI Modell Größe</span>
                        </label>
                        <div className="grid grid-cols-1 gap-2">
                            <button 
                                onClick={() => changeModel('Xenova/whisper-tiny')}
                                className={`px-4 py-3 rounded-lg border text-left transition-all ${selectedModel === 'Xenova/whisper-tiny' 
                                    ? 'bg-purple-500/20 border-purple-500/50 ring-1 ring-purple-500/50' 
                                    : 'bg-slate-800 border-slate-700 hover:border-slate-600'}`}
                            >
                                <div className="flex justify-between">
                                    <span className="font-bold text-sm">Tiny (Schnell)</span>
                                    <span className="text-xs bg-slate-700 px-1.5 py-0.5 rounded text-slate-300">~40MB</span>
                                </div>
                                <div className="text-xs text-slate-400 mt-1">Gut für klare Sprache, schnell geladen.</div>
                            </button>
                            <button 
                                onClick={() => changeModel('Xenova/whisper-base')}
                                className={`px-4 py-3 rounded-lg border text-left transition-all ${selectedModel === 'Xenova/whisper-base' 
                                    ? 'bg-purple-500/20 border-purple-500/50 ring-1 ring-purple-500/50' 
                                    : 'bg-slate-800 border-slate-700 hover:border-slate-600'}`}
                            >
                                <div className="flex justify-between">
                                    <span className="font-bold text-sm">Base (Balanced)</span>
                                    <span className="text-xs bg-slate-700 px-1.5 py-0.5 rounded text-slate-300">~200MB</span>
                                </div>
                                <div className="text-xs text-slate-400 mt-1">Der Standard. Guter Kompromiss.</div>
                            </button>
                            <button 
                                onClick={() => changeModel('Xenova/whisper-small')}
                                className={`px-4 py-3 rounded-lg border text-left transition-all ${selectedModel === 'Xenova/whisper-small' 
                                    ? 'bg-purple-500/20 border-purple-500/50 ring-1 ring-purple-500/50' 
                                    : 'bg-slate-800 border-slate-700 hover:border-slate-600'}`}
                            >
                                <div className="flex justify-between">
                                    <span className="font-bold text-sm text-yellow-400">Small (High Quality)</span>
                                    <span className="text-xs bg-slate-700 px-1.5 py-0.5 rounded text-slate-300">~500MB</span>
                                </div>
                                <div className="text-xs text-slate-400 mt-1">Für Musik, Akzente & schwieriges Audio. Ladezeit beachten!</div>
                            </button>
                        </div>
                    </div>

                    {/* Language Selector */}
                    <div className="space-y-2">
                        <label className="flex items-center space-x-2 text-sm font-semibold text-slate-300">
                            <Languages className="w-4 h-4 text-blue-400" />
                            <span>Zielsprache</span>
                        </label>
                        <select 
                            value={selectedLanguage}
                            onChange={(e) => setSelectedLanguage(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-4 py-3 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                        >
                            <option value="auto">✨ Automatisch erkennen</option>
                            <option value="en">🇬🇧 Englisch (Music Default)</option>
                            <option value="de">🇩🇪 Deutsch</option>
                        </select>
                        <p className="text-xs text-slate-500">
                            Bei englischen Songs "Englisch" wählen, sonst versucht die AI deutsche Wörter zu erfinden.
                        </p>
                    </div>

                </div>
            </div>
        )}
      </header>

      <main className="max-w-5xl mx-auto px-4 py-12">
        
        {/* Hero Status */}
        <div className="text-center mb-12 relative">
          {status === 'loading_model' && renderDownloadStatus()}

          {status === 'ready' && !transcript && (
             <div className="inline-flex items-center space-x-2 px-4 py-2 bg-purple-500/10 border border-purple-500/20 rounded-full text-purple-400 text-sm animate-fade-in">
                <Gauge className="w-4 h-4" />
                <span>Aktives Modell: {selectedModel.replace('Xenova/whisper-', '').toUpperCase()}</span>
             </div>
          )}

          {status === 'processing' && (
             <div className="bg-slate-800/80 backdrop-blur border border-indigo-500/30 rounded-xl p-8 max-w-md mx-auto shadow-2xl shadow-indigo-500/10">
                <div className="relative w-16 h-16 mx-auto mb-4">
                    <div className="absolute inset-0 border-4 border-indigo-500/20 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-t-indigo-400 rounded-full animate-spin"></div>
                    <Wand2 className="absolute inset-0 m-auto text-indigo-400 w-6 h-6" />
                </div>
                <p className="text-lg font-medium text-white">Verarbeite Audio...</p>
                <p className="text-sm text-slate-400 mt-2">{statusMessage}</p>
             </div>
          )}

          {status === 'error' && (
            <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-6 max-w-md mx-auto flex flex-col items-center text-center space-y-2 text-red-200">
              <AlertCircle className="w-8 h-8 text-red-400" />
              <span className="font-bold">Ein Fehler ist aufgetreten</span>
              <span className="text-sm opacity-80">{statusMessage}</span>
              <button 
                onClick={() => window.location.reload()}
                className="mt-4 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 rounded text-sm transition-colors flex items-center"
              >
                <RotateCcw className="w-3 h-3 mr-2" /> Reload App
              </button>
            </div>
          )}
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 relative z-10">
          
          {/* Left Column: Input & Controls */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-[#1e293b]/50 backdrop-blur border border-slate-700 rounded-2xl p-6 shadow-xl hover:border-slate-600 transition-colors">
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Input Source</h3>
                <label className="block w-full cursor-pointer group relative overflow-hidden rounded-xl">
                    <input 
                        type="file" 
                        accept="audio/*" 
                        onChange={handleFileUpload} 
                        className="hidden" 
                    />
                    <div className={`border-2 border-dashed rounded-xl p-8 text-center transition-all duration-300 
                        ${audioFile 
                            ? 'border-cyan-500/50 bg-cyan-500/5' 
                            : 'border-slate-600 group-hover:border-cyan-400 group-hover:bg-slate-700/50'}`
                    }>
                        {audioFile ? (
                             <Music className="w-10 h-10 mx-auto mb-3 text-cyan-400" />
                        ) : (
                             <Upload className="w-10 h-10 mx-auto mb-3 text-slate-500 group-hover:text-cyan-400 transition-transform group-hover:scale-110 duration-300" />
                        )}
                        
                        <span className="block text-sm font-medium text-slate-200 truncate max-w-full">
                            {audioFile ? audioFile.name : "Audio hier ablegen"}
                        </span>
                        <span className="block text-xs text-slate-500 mt-1">
                            {audioFile ? `${(audioFile.size / 1024 / 1024).toFixed(2)} MB` : "MP3, WAV, M4A"}
                        </span>
                    </div>
                </label>

                {audioUrl && (
                    <div className="mt-6 animate-fade-in">
                        <div className="flex items-center justify-between text-xs text-slate-400 mb-2 px-1">
                             <span className="flex items-center"><Clock className="w-3 h-3 mr-1"/> Dauer:</span>
                             <span className="font-mono text-cyan-400">{formatDuration(audioDuration)}</span>
                        </div>
                        <audio 
                            ref={audioRef} 
                            src={audioUrl} 
                            controls 
                            className="w-full mb-4 rounded-lg opacity-90 hover:opacity-100 transition-opacity"
                            onTimeUpdate={() => audioRef.current && setCurrentTime(audioRef.current.currentTime)}
                            onLoadedMetadata={handleMetadataLoaded}
                            onPlay={() => setIsPlaying(true)}
                            onPause={() => setIsPlaying(false)}
                        />
                        
                        <button
                            onClick={startTranscription}
                            disabled={status !== 'ready' && status !== 'complete'}
                            className={`w-full py-3.5 px-4 rounded-xl font-bold flex items-center justify-center space-x-2 transition-all transform active:scale-[0.98]
                                ${status === 'ready' || status === 'complete' 
                                    ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/25'
                                    : 'bg-slate-700/50 text-slate-500 cursor-not-allowed border border-slate-700'}`}
                        >
                            {status === 'processing' ? (
                                <Activity className="w-4 h-4 animate-spin" />
                            ) : (
                                <Wand2 className="w-4 h-4" />
                            )}
                            <span>
                                {status === 'processing' ? 'Analysiere...' : 'Transkribieren starten'}
                            </span>
                        </button>
                    </div>
                )}
            </div>

            {transcript && !isTranscriptEmpty && (
                <button
                    onClick={exportSRT}
                    className="w-full py-3 px-4 bg-slate-800 border border-slate-700 hover:bg-slate-750 hover:border-slate-600 rounded-xl flex items-center justify-center space-x-2 text-slate-300 hover:text-white transition-all group"
                >
                    <Download className="w-4 h-4 group-hover:-translate-y-0.5 transition-transform" />
                    <span>SRT Untertitel herunterladen</span>
                </button>
            )}
          </div>

          {/* Right Column: Transcript Output */}
          <div className="lg:col-span-8">
            <div className="bg-[#1e293b]/50 backdrop-blur border border-slate-700 rounded-2xl flex flex-col h-[600px] shadow-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-700/50 flex items-center justify-between bg-slate-800/30">
                    <h3 className="font-bold text-slate-200 flex items-center space-x-2">
                        <FileText className="text-cyan-400 w-4 h-4" />
                        <span>Live Ausgabe</span>
                    </h3>
                    <div className="flex items-center space-x-2">
                         {transcript ? (
                             <span className="text-[10px] font-mono px-2 py-0.5 bg-green-500/10 text-green-400 rounded border border-green-500/20">FERTIG</span>
                         ) : (
                             <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-700 text-slate-400 rounded">WARTEZUSTAND</span>
                         )}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-1 custom-scrollbar scroll-smooth">
                    {/* Fallback for completed but empty transcript */}
                    {status === 'complete' && isTranscriptEmpty && (
                        <div className="h-full flex flex-col items-center justify-center text-amber-500/80 p-8 text-center">
                            <Bug className="w-12 h-12 mb-3 opacity-70" />
                            <h4 className="font-bold text-lg">Keine Sprache erkannt</h4>
                            <p className="text-sm text-slate-400 mt-2 max-w-sm">
                                Das Modell hat nichts verstanden. (Musik erkannt?)
                                <br/>
                                <span className="font-semibold text-amber-400 block mt-2">Lösung für Remixes:</span>
                                1. Öffne Einstellungen <Settings2 className="w-3 h-3 inline"/>.
                                <br/>
                                2. Wähle das <b>SMALL</b> Modell (500MB).
                                <br/>
                                3. Stelle Sprache explizit auf Englisch oder Deutsch (nicht Auto).
                            </p>
                        </div>
                    )}

                    {!transcript && status !== 'processing' && (
                        <div className="h-full flex flex-col items-center justify-center text-slate-600">
                            <div className="bg-slate-800/50 p-4 rounded-full mb-3">
                                <FileText className="w-8 h-8 opacity-50" />
                            </div>
                            <p className="text-sm font-medium">Warte auf Audio-Input...</p>
                        </div>
                    )}
                    
                    {status === 'processing' && !transcript && (
                        <div className="space-y-4 p-4 animate-pulse">
                            {[1,2,3,4].map(i => (
                                <div key={i} className="flex gap-4">
                                    <div className="w-12 h-4 bg-slate-700/50 rounded"></div>
                                    <div className="flex-1 h-4 bg-slate-700/30 rounded"></div>
                                </div>
                            ))}
                        </div>
                    )}

                    {transcript && transcript.chunks && transcript.chunks.map((chunk, idx) => {
                        const start = chunk.timestamp[0];
                        const end = chunk.timestamp[1] || start + 2;
                        const isActive = currentTime >= start && currentTime <= end;
                        
                        return (
                            <div 
                                key={idx} 
                                onClick={() => jumpToTime(chunk.timestamp)}
                                className={`group flex gap-4 p-3 rounded-lg transition-all cursor-pointer border border-transparent
                                    ${isActive 
                                        ? 'bg-blue-500/10 border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.1)]' 
                                        : 'hover:bg-slate-700/30 hover:border-slate-700/50'}
                                `}
                            >
                                <div className={`text-xs font-mono pt-1 min-w-[80px] ${isActive ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-400'}`}>
                                    {start.toFixed(1)}s <span className="opacity-30">→</span> {end.toFixed(1)}s
                                </div>
                                <p className={`text-base leading-relaxed flex-1 ${isActive ? 'text-white font-medium' : 'text-slate-300'}`}>
                                    {chunk.text}
                                </p>
                            </div>
                        )
                    })}
                </div>
            </div>
          </div>

        </div>
      </main>
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(71, 85, 105, 0.4);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(71, 85, 105, 0.8);
        }
        @keyframes fade-in {
            from { opacity: 0; transform: translateY(5px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
            animation: fade-in 0.3s ease-out forwards;
        }
        @keyframes slide-down {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-down {
            animation: slide-down 0.2s ease-out forwards;
        }
      `}</style>
    </div>
  );
}
