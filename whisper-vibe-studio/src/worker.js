// src/worker.js
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
                chunk_length_s: 10,
                stride_length_s: 3,
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