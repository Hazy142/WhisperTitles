import { pipeline, env } from '@xenova/transformers';

// Konfiguration
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
                // 1. VERSUCH: WEBGPU 🚀
                console.log('Versuche WebGPU Start...');
                // Wir sagen der UI, was wir tun
                self.postMessage({ status: 'loading', message: `Starte ${modelName} auf GPU...` });

                transcriber = await pipeline('automatic-speech-recognition', modelName, {
                    quantized: true,
                    device: 'webgpu', 
                    progress_callback: progressCallback
                });

                self.postMessage({ status: 'ready', message: 'AI Engine bereit (GPU-Modus) 🚀' });

            } catch (gpuError) {
                // 2. FEHLER-ANALYSE 🕵️‍♂️
                // Wir zeigen den Fehler jetzt direkt in der UI an, statt ihn zu verstecken!
                console.error("WebGPU Fehler:", gpuError);
                
                const errorText = gpuError.message || JSON.stringify(gpuError);
                
                // Kurzer Moment, damit man den Fehler lesen kann, dann Fallback
                self.postMessage({ status: 'loading', message: `GPU-Fehler: ${errorText}. Wechsel auf CPU...` });
                
                // Kleine Pause (2 Sekunden), damit du den Text lesen kannst
                await new Promise(r => setTimeout(r, 3000));

                transcriber = await pipeline('automatic-speech-recognition', modelName, {
                    quantized: true,
                    device: 'cpu', 
                    progress_callback: progressCallback
                });

                self.postMessage({ status: 'ready', message: `Bereit (CPU-Modus - GPU Fehler: ${errorText.substring(0, 20)}...)` });
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
                repetition_penalty: 1.4,
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