/**
 * Dictation's worker: an Electron utility process (src/main/dictation.ts starts it) that runs the speech model, so a
 * slow or failing model never holds up or brings down the app. It loads sherpa-onnx from the folder the app downloaded
 * it to, finds where speech starts and stops with Silero VAD, and recognises each phrase once it ends. While a phrase
 * is still being spoken, a quick model also recognises what it has so far, for words that show as you speak.
 *
 * Audio comes in as 16 kHz mono Float32Array chunks. Messages: see WorkerIn and WorkerOut below.
 */
import { join } from "node:path";

export interface LoadMessage {
    type: "load";
    /** The folder holding node_modules/sherpa-onnx-node and its native build. */
    engine: string;
    vad: string;
    config: Record<string, unknown>;
    /** Recognise the phrase so far while it is spoken. */
    live: boolean;
    /** The longest phrase passed to the model at once, in seconds. */
    longest: number;
}

export type WorkerIn =
    | LoadMessage
    | { type: "start"; id: number }
    | { type: "audio"; id: number; samples: Float32Array }
    | { type: "stop"; id: number }
    | { type: "abort"; id: number };

export type WorkerOut =
    | { type: "loaded"; ms: number }
    | { type: "load-failed"; message: string }
    | { type: "result"; id: number; text: string; final: boolean }
    | { type: "error"; id: number; message: string }
    | { type: "ended"; id: number };

const RATE = 16_000;
const WINDOW = 512;
/** Audio kept from before the detector hears speech, for the words said so far. */
const PREROLL = Math.round(RATE * 0.3);
/** How much more speech before the words so far are recognised again. */
const LIVE_STEP = Math.round(RATE * 0.7);

// sherpa-onnx's Node addon has no types; these are the calls used here.
interface Stream {
    acceptWaveform(wave: { sampleRate: number; samples: Float32Array }): void;
}
interface Recognizer {
    createStream(): Stream;
    decodeAsync(stream: Stream): Promise<{ text?: string }>;
}
interface Vad {
    acceptWaveform(samples: Float32Array): void;
    isEmpty(): boolean;
    isDetected(): boolean;
    front(enableExternalBuffer: boolean): { start: number; samples: Float32Array };
    pop(): void;
    flush(): void;
    reset(): void;
}
interface Sherpa {
    OfflineRecognizer: { createAsync(config: Record<string, unknown>): Promise<Recognizer> };
    Vad: new (config: Record<string, unknown>, bufferSeconds: number) => Vad;
}

const port = process.parentPort;

const send = (message: WorkerOut): void => {
    port.postMessage(message);
};

let recognizer: Recognizer | undefined;
let vad: Vad | undefined;
let live = false;
/** Messages are handled one after another: audio waits for the model to load. */
let queue: Promise<void> = Promise.resolve();

/** The dictation that listens now. */
let session:
    | {
          id: number;
          /** Samples not yet given to the detector (it takes WINDOW at a time). */
          pending: Float32Array;
          /** The phrase being spoken, with the audio just before it. */
          phrase: Float32Array[];
          phraseLength: number;
          /** The last fraction of a second, kept for the start of the next phrase. */
          recent: Float32Array[];
          recentLength: number;
          speaking: boolean;
          /** The phrase's length when its words so far were last recognised. */
          liveAt: number;
          liveBusy: boolean;
          /** Counts phrases: a result of the words so far is dropped once its phrase has ended. */
          phraseNumber: number;
          /** The phrases waiting for the model, in order. */
          decoding: Promise<void>;
      }
    | undefined;

function concat(parts: Float32Array[], length: number): Float32Array {
    const out = new Float32Array(length);
    let at = 0;

    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }

    return out;
}

async function recognise(samples: Float32Array): Promise<string> {
    const stream = recognizer!.createStream();

    stream.acceptWaveform({ sampleRate: RATE, samples });

    const result = await recognizer!.decodeAsync(stream);

    return (result.text ?? "").trim();
}

async function load(message: LoadMessage): Promise<void> {
    const started = Date.now();

    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const sherpa = require(join(message.engine, "node_modules", "sherpa-onnx-node")) as Sherpa;

        recognizer = await sherpa.OfflineRecognizer.createAsync({
            featConfig: { sampleRate: RATE, featureDim: 80 },
            modelConfig: message.config,
        });
        vad = new sherpa.Vad(
            {
                sileroVad: {
                    model: message.vad,
                    threshold: 0.5,
                    minSilenceDuration: 0.5,
                    minSpeechDuration: 0.25,
                    windowSize: WINDOW,
                    maxSpeechDuration: message.longest,
                },
                sampleRate: RATE,
                numThreads: 1,
                provider: "cpu",
                debug: 0,
            },
            60,
        );
        live = message.live;
        send({ type: "loaded", ms: Date.now() - started });
    } catch (error) {
        send({ type: "load-failed", message: (error as Error).message });
    }
}

/** Takes the phrases the detector has finished and queues each for the model. */
function takePhrases(): void {
    const current = session;

    if (current === undefined || vad === undefined) {
        return;
    }

    while (!vad.isEmpty()) {
        // Electron does not allow buffers the addon owns: copy.
        const segment = vad.front(false);

        vad.pop();
        current.phraseNumber++;
        current.phrase = [];
        current.phraseLength = 0;
        current.liveAt = 0;

        const samples = segment.samples;

        current.decoding = current.decoding.then(async () => {
            try {
                const text = await recognise(samples);

                send({ type: "result", id: current.id, text, final: true });
            } catch (error) {
                send({ type: "error", id: current.id, message: (error as Error).message });
            }
        });
    }
}

/** Recognises the phrase so far, when there is enough new speech and the model is free. */
function recogniseSoFar(): void {
    const current = session;

    if (current === undefined || !live || !current.speaking || current.liveBusy) {
        return;
    }

    if (current.phraseLength - current.liveAt < LIVE_STEP) {
        return;
    }

    const number = current.phraseNumber;
    const samples = concat(current.phrase, current.phraseLength);

    current.liveAt = current.phraseLength;
    current.liveBusy = true;
    // After the phrases already waiting, so a result never comes before an earlier phrase's.
    current.decoding = current.decoding.then(async () => {
        try {
            const text = await recognise(samples);

            if (session === current && current.phraseNumber === number && text !== "") {
                send({ type: "result", id: current.id, text, final: false });
            }
        } catch {
            // Only the words so far: the whole phrase is recognised again when it ends.
        } finally {
            current.liveBusy = false;
        }
    });
}

function audio(id: number, samples: Float32Array): void {
    const current = session;

    if (current === undefined || current.id !== id || vad === undefined) {
        return;
    }

    let pending = current.pending.length === 0 ? samples : concat([current.pending, samples], current.pending.length + samples.length);
    let at = 0;

    for (; at + WINDOW <= pending.length; at += WINDOW) {
        const chunk = pending.slice(at, at + WINDOW);

        vad.acceptWaveform(chunk);

        const speaking = vad.isDetected();

        if (speaking && !current.speaking) {
            // The phrase starts with the audio just before the detector heard it.
            current.phrase = [...current.recent];
            current.phraseLength = current.recentLength;
            current.liveAt = 0;
        }

        current.speaking = speaking;

        if (speaking) {
            current.phrase.push(chunk);
            current.phraseLength += chunk.length;
        }

        current.recent.push(chunk);
        current.recentLength += chunk.length;

        while (current.recentLength - (current.recent[0]?.length ?? 0) >= PREROLL) {
            current.recentLength -= current.recent.shift()!.length;
        }

        takePhrases();
    }

    pending = pending.slice(at);
    current.pending = pending;
    recogniseSoFar();
}

async function stop(id: number, drop: boolean): Promise<void> {
    const current = session;

    if (current === undefined || current.id !== id) {
        send({ type: "ended", id });

        return;
    }

    if (!drop && vad !== undefined) {
        // What is left: the end of the last phrase.
        if (current.pending.length > 0) {
            const padded = new Float32Array(WINDOW);

            padded.set(current.pending);
            vad.acceptWaveform(padded);
        }

        vad.flush();
        takePhrases();
        await current.decoding;
    }

    vad?.reset();
    session = undefined;
    send({ type: "ended", id });
}

function handle(message: WorkerIn): Promise<void> | void {
    switch (message.type) {
        case "load":
            return load(message);
        case "start":
            if (recognizer === undefined || vad === undefined) {
                send({ type: "error", id: message.id, message: "The speech model is not loaded." });
                send({ type: "ended", id: message.id });

                return;
            }

            vad.reset();
            session = {
                id: message.id,
                pending: new Float32Array(0),
                phrase: [],
                phraseLength: 0,
                recent: [],
                recentLength: 0,
                speaking: false,
                liveAt: 0,
                liveBusy: false,
                phraseNumber: 0,
                decoding: Promise.resolve(),
            };

            return;
        case "audio":
            audio(message.id, message.samples);

            return;
        case "stop":
            return stop(message.id, false);
        case "abort":
            return stop(message.id, true);
    }
}

port.on("message", (event: { data: WorkerIn }) => {
    const message = event.data;

    // Audio is handled at once (in order with the rest); the waits are inside each phrase's own chain.
    queue = queue.then(() => handle(message)).catch((error: unknown) => {
        console.error(error);
    });
});
