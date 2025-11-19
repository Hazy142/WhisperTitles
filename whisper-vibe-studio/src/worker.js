import { pipeline, env } from '@xenova/transformers';

// Konfiguration: Erlaubt das Laden von externen Modellen (HuggingFace Hub)
env.allowLocalModels = false;
env.useBrowserCache = true;

let transcriber = null;
let currentModel = null;

self.addEventListener('message', async (event) => {
    const { type, data } = event.data;

    if (type === 'load') {
        try {
            const modelName = data.model || 'Xenova/whisper-base';
            
            // Wenn das Modell schon geladen ist, abbrechen
            if (transcriber && currentModel === modelName) {
                self.postMessage({ status: 'ready', message: 'Modell bereits geladen.' });
                return;
            }

            self.postMessage({ status: 'loading', message: `Initialisiere ${modelName}...` });

            // Hilfsfunktion für den Ladebalken
            const progressCallback = (data) => {
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
            };

            try {
                // 1. VERSUCH: WEBGPU (Turbo Modus) 🚀
                console.log('Versuche WebGPU Start...');
                self.postMessage({ status: 'loading', message: `Starte ${modelName} mit GPU-Power...` });

                transcriber = await pipeline('automatic-speech-recognition', modelName, {
                    quantized: true,
                    device: 'webgpu', // <--- HIER IST DER SCHLÜSSEL
                    progress_callback: progressCallback
                });

                self.postMessage({ status: 'ready', message: 'AI Engine bereit (GPU-Modus) 🚀' });

            } catch (gpuError) {
                // 2. FALLBACK: CPU (Sicherheitsnetz) 🛡️
                console.warn("WebGPU Start fehlgeschlagen, wechsle auf CPU...", gpuError);
                self.postMessage({ status: 'loading', message: 'GPU nicht verfügbar. Starte CPU-Modus...' });

                transcriber = await pipeline('automatic-speech-recognition', modelName, {
                    quantized: true,
                    device: 'cpu', // Fallback auf Prozessor
                    progress_callback: progressCallback
                });

                self.postMessage({ status: 'ready', message: 'AI Engine bereit (CPU-Modus)' });
            }

            currentModel = modelName;

        } catch (err) {
            console.error(err);
            self.postMessage({ status: 'error', message: 'Kritischer Ladefehler: ' + err.message });
        }
    }

    if (type === 'run') {
        if (!transcriber) {
            self.postMessage({ status: 'error', message: 'Modell ist noch nicht geladen.' });
            return;
        }

        try {
            self.postMessage({ status: 'processing', message: 'Analysiere Audio...' });

            const options = {
                chunk_length_s: 30,
                stride_length_s: 5,
                return_timestamps: true,
                repetition_penalty: 1.4, // Wichtig gegen Loops bei Musik
                no_speech_threshold: 0.6, 
            };

            if (data.language && data.language !== 'auto') {
                options.language = data.language;
            }

            const output = await transcriber(data.audio, options);

            self.postMessage({ status: 'complete', output });
        } catch (err) {
            console.error(err);
            self.postMessage({ status: 'error', message: 'Transkriptionsfehler: ' + err.message });
        }
    }
});