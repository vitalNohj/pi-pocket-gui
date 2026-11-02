/**
 * Offline dictation: Pi Pocket's mic button, recognised on this computer. Nothing ships with the app. Choosing a model
 * in the settings downloads it, and with the first model the speech engine (sherpa-onnx, about 11 MB) and the voice
 * detector; removing the last model removes the engine too. Each file is checked against its SHA-256.
 *
 * The server page's preload (src/preload/server.ts) stands in the browser's SpeechRecognition, so Pi Pocket's own
 * mic button and Alt+V use it unchanged. Its audio comes here, and goes on to a worker process
 * (src/main/dictation-worker.ts) that runs the model. The audio never leaves the computer.
 *
 * On disk, in <userData>/dictation: engine-<version>/ (node_modules with the addon, silero_vad.onnx), models/<id>/.
 * A folder takes its name only once all its files are in and checked.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { ipcMain, utilityProcess, type IpcMainEvent, type IpcMainInvokeEvent, type UtilityProcess } from "electron";
import type { DictationAction, DictationState, Settings } from "../shared/types";
import {
    ENGINE_JS,
    ENGINE_VERSION,
    engineNative,
    engineSize,
    longestPhraseSeconds,
    modelById,
    modelConfig,
    MODELS,
    VAD,
    type CatalogFile,
    type SpeechModel,
} from "./dictation-catalog";
import { downloadChecked } from "./download";
import type { WorkerIn, WorkerOut } from "./dictation-worker";

export interface DictationHost {
    home: string;
    platform: NodeJS.Platform;
    arch: string;
    settings: () => Settings;
    /** Saves a changed choice of model. */
    choose: (model: string) => void;
    fetch: (url: string) => Promise<Response>;
    /** The call came from the server's page (its top frame, on the server's origin). */
    fromServerPage: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
    /** Sends a message to the server's page. */
    toPage: (message: PageMessage) => void;
    /** The state changed: show it on the config screen. */
    changed: () => void;
    /** The mic was used with no model: open the settings at Dictation. */
    needModel: () => void;
}

/** What the server page's stand-in SpeechRecognition hears back. */
export type PageMessage =
    | { id: number; type: "result"; text: string; final: boolean }
    | { id: number; type: "error"; error: string }
    | { id: number; type: "end" };

/** A loaded model is kept this long after the last dictation, then its memory is freed. */
const IDLE_MS = 10 * 60 * 1000;

export function setUpDictation(host: DictationHost) {
    const root = join(host.home, "dictation");
    const engineDir = join(root, `engine-${ENGINE_VERSION}`);
    const modelsDir = join(root, "models");
    const native = engineNative(host.platform, host.arch);

    let installed = new Set<string>();
    let engineReady = false;
    /** The one download running: a model, with the engine first when it is missing. */
    let download: { id: string; received: number; total: number; step: string; controller: AbortController } | undefined;
    let message: string | undefined;

    let worker: UtilityProcess | undefined;
    /** The model the worker has, or is loading. */
    let workerModel: string | undefined;
    let loading: Promise<void> | undefined;
    let loadDone: (() => void) | undefined;
    let loadFailed: ((error: Error) => void) | undefined;
    let idleTimer: NodeJS.Timeout | undefined;
    /** The dictation that listens now (only one, in the whole app). */
    let active: number | undefined;
    let status: DictationState["status"] = "idle";

    const scan = async (): Promise<void> => {
        engineReady = existsSync(join(engineDir, "node_modules", "sherpa-onnx-node")) && existsSync(join(engineDir, VAD.name));

        const names = await readdir(modelsDir).catch(() => [] as string[]);

        installed = new Set(names.filter((name) => modelById(name) !== undefined));

        // Downloads the app quit in the middle of, and engines an update left behind.
        for (const name of names.filter((each) => each.endsWith(".partial"))) {
            await rm(join(modelsDir, name), { recursive: true, force: true });
        }

        await rm(`${engineDir}.partial`, { recursive: true, force: true });

        if (engineReady) {
            await removeOldEngines();
        }

        // A chosen model that is gone (removed by hand): none.
        const chosen = host.settings().dictation.model;

        if (chosen !== "" && !installed.has(chosen)) {
            host.choose("");
        }

        host.changed();
    };

    // ——— Downloads ———

    const extract = (archive: string, into: string): Promise<void> =>
        new Promise((done, fail) => {
            const tar = host.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";

            execFile(tar, ["-xzf", archive, "-C", into, "--strip-components=1"], { windowsHide: true }, (error) => {
                if (error === null) {
                    done();
                } else {
                    fail(new Error(`Could not unpack ${archive.split(/[\\/]/).pop() ?? archive}: ${error.message}`));
                }
            });
        });

    const fetchAll = async (files: CatalogFile[], folder: string, step: string): Promise<void> => {
        const job = download!;
        let before = job.received;

        job.step = step;

        for (const file of files) {
            await downloadChecked({
                url: file.url,
                name: file.name,
                folder,
                sha256: file.sha256,
                size: file.size,
                fetch: host.fetch,
                signal: job.controller.signal,
                onBytes: (received) => {
                    job.received = before + received;
                    throttledChanged();
                },
            });
            before += file.size;
            job.received = before;
        }
    };

    let changedAt = 0;
    let changedTimer: NodeJS.Timeout | undefined;

    const throttledChanged = (): void => {
        const now = Date.now();

        if (now - changedAt >= 250) {
            changedAt = now;
            host.changed();
        } else if (changedTimer === undefined) {
            changedTimer = setTimeout(() => {
                changedTimer = undefined;
                changedAt = Date.now();
                host.changed();
            }, 250);
        }
    };

    const installEngine = async (): Promise<void> => {
        if (native === undefined) {
            throw new Error("Dictation has no speech engine for this computer's processor.");
        }

        const partial = `${engineDir}.partial`;
        const archives = join(partial, "archives");

        await rm(partial, { recursive: true, force: true });
        await mkdir(archives, { recursive: true });
        await fetchAll([ENGINE_JS, native, VAD], archives, "Downloading the speech engine…");

        for (const pkg of [ENGINE_JS, native]) {
            const into = join(partial, "node_modules", pkg.package);

            await mkdir(into, { recursive: true });
            await extract(join(archives, pkg.name), into);
        }

        await rename(join(archives, VAD.name), join(partial, VAD.name));
        await rm(archives, { recursive: true, force: true });
        await rm(engineDir, { recursive: true, force: true });
        await rename(partial, engineDir);
        engineReady = true;
        await removeOldEngines();
    };

    /** Engines of other versions, from before an update of the app, and their unfinished downloads. */
    const removeOldEngines = async (): Promise<void> => {
        for (const name of await readdir(root).catch(() => [] as string[])) {
            if (name.startsWith("engine-") && name !== `engine-${ENGINE_VERSION}` && name !== `engine-${ENGINE_VERSION}.partial`) {
                await rm(join(root, name), { recursive: true, force: true });
            }
        }
    };

    const downloadModel = async (model: SpeechModel): Promise<void> => {
        if (download !== undefined) {
            return;
        }

        const total = model.files.reduce((sum, file) => sum + file.size, 0) + (engineReady ? 0 : engineSize(host.platform, host.arch));

        download = { id: model.id, received: 0, total, step: "Starting…", controller: new AbortController() };
        message = undefined;
        host.changed();

        const folder = join(modelsDir, model.id);
        const partial = `${folder}.partial`;

        try {
            await mkdir(root, { recursive: true });

            if (!engineReady) {
                await installEngine();
            }

            await rm(partial, { recursive: true, force: true });
            await mkdir(partial, { recursive: true });
            await fetchAll(model.files, partial, `Downloading ${model.name}…`);
            await rm(folder, { recursive: true, force: true });
            await rename(partial, folder);
            installed.add(model.id);

            if (host.settings().dictation.model === "") {
                host.choose(model.id);
            }
        } catch (error) {
            await rm(partial, { recursive: true, force: true }).catch(() => undefined);
            await rm(`${engineDir}.partial`, { recursive: true, force: true }).catch(() => undefined);
            message = download.controller.signal.aborted ? undefined : `${model.name} did not download: ${(error as Error).message}`;
        } finally {
            download = undefined;
            host.changed();
        }
    };

    const removeModel = async (id: string): Promise<void> => {
        if (workerModel === id) {
            unload();
        }

        await rm(join(modelsDir, id), { recursive: true, force: true });
        installed.delete(id);

        if (host.settings().dictation.model === id) {
            host.choose([...installed][0] ?? "");
        }

        // The last model gone: the engine goes too.
        if (installed.size === 0) {
            unload();
            await rm(root, { recursive: true, force: true });
            engineReady = false;
        }

        host.changed();
    };

    // ——— The worker ———

    /** Ends the worker; a dictation that listens ends too, unless `keepActive` (a new model loads for it). */
    const unload = (keepActive = false): void => {
        clearTimeout(idleTimer);
        idleTimer = undefined;

        if (active !== undefined && !keepActive) {
            host.toPage({ id: active, type: "error", error: "aborted" });
            host.toPage({ id: active, type: "end" });
            active = undefined;
        }

        loadFailed?.(new Error("The speech model was unloaded."));
        worker?.kill();
        worker = undefined;
        workerModel = undefined;
        loading = undefined;
        status = "idle";
        host.changed();
    };

    const post = (message: WorkerIn): void => {
        worker?.postMessage(message);
    };

    const fromWorker = (message: WorkerOut): void => {
        switch (message.type) {
            case "loaded":
                status = "ready";
                loadDone?.();
                host.changed();
                break;
            case "load-failed":
                loadFailed?.(new Error(message.message));
                break;
            case "result":
                host.toPage({ id: message.id, type: "result", text: message.text, final: message.final });
                break;
            case "error":
                host.toPage({ id: message.id, type: "error", error: message.message });
                break;
            case "ended":
                host.toPage({ id: message.id, type: "end" });

                if (active === message.id) {
                    active = undefined;
                    status = "ready";
                    host.changed();
                }

                idle();
                break;
        }
    };

    /** Loads the chosen model in a worker, once. */
    const load = (model: SpeechModel): Promise<void> => {
        if (workerModel === model.id && loading !== undefined) {
            return loading;
        }

        unload(true);

        const child = utilityProcess.fork(join(__dirname, "dictation-worker.js"), [], {
            serviceName: "Pi Pocket dictation",
            stdio: "pipe",
            // macOS: the engine's libraries are signed by their makers, not with the app.
            ...(host.platform === "darwin" ? { allowLoadingUnsignedLibraries: true } : {}),
        });

        worker = child;
        workerModel = model.id;
        status = "loading";
        host.changed();

        const lines: string[] = [];
        const keep = (chunk: Buffer) => {
            lines.push(...chunk.toString("utf8").split("\n").filter(Boolean));
            lines.splice(0, Math.max(0, lines.length - 20));
        };

        child.stdout?.on("data", keep);
        child.stderr?.on("data", keep);
        child.on("message", (message: WorkerOut) => {
            fromWorker(message);
        });
        child.on("exit", (code) => {
            if (worker !== child) {
                return;
            }

            const why = `The speech model stopped (code ${String(code)})${lines.length > 0 ? `: ${lines.slice(-2).join(" ")}` : "."}`;

            worker = undefined;
            workerModel = undefined;
            loading = undefined;
            loadFailed?.(new Error(why));

            if (active !== undefined) {
                host.toPage({ id: active, type: "error", error: why.replace(/\.$/, "") });
                host.toPage({ id: active, type: "end" });
                active = undefined;
            }

            status = "error";
            message = why;
            host.changed();
        });

        loading = new Promise<void>((done, fail) => {
            loadDone = done;
            loadFailed = fail;
        }).finally(() => {
            loadDone = undefined;
            loadFailed = undefined;
        });
        loading.catch((error: unknown) => {
            if (worker === child) {
                message = (error as Error).message;
                status = "error";

                // The dictation waiting for this model ends: the page stops its microphone.
                if (active !== undefined) {
                    host.toPage({ id: active, type: "error", error: message });
                    host.toPage({ id: active, type: "end" });
                    active = undefined;
                }

                worker.kill();
                worker = undefined;
                workerModel = undefined;
                loading = undefined;
                host.changed();
            }
        });

        const threads = Math.max(1, Math.min(4, availableParallelism() - 1));

        post({
            type: "load",
            engine: engineDir,
            vad: join(engineDir, VAD.name),
            config: modelConfig(model, join(modelsDir, model.id), threads, join),
            live: host.settings().dictation.live,
            longest: longestPhraseSeconds(model),
        });

        return loading;
    };

    const idle = (): void => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            if (active === undefined) {
                unload();
            }
        }, IDLE_MS);
    };

    // ——— The server page's calls ———

    ipcMain.handle("host:dictation-start", async (event, id: unknown) => {
        if (!host.fromServerPage(event) || typeof id !== "number") {
            return { error: "service-not-allowed" };
        }

        const chosen = modelById(host.settings().dictation.model);

        if (chosen === undefined || !installed.has(chosen.id) || !engineReady) {
            host.needModel();

            return { error: "no speech model is downloaded yet (GUI Settings → Dictation)" };
        }

        // A dictation still listening (another box): it ends first.
        if (active !== undefined && active !== id) {
            post({ type: "abort", id: active });
        }

        active = id;
        clearTimeout(idleTimer);

        // The model loads while the mic starts; the worker keeps the audio until it is ready.
        void load(chosen).catch(() => undefined);
        post({ type: "start", id });
        status = "listening";
        host.changed();

        return { ok: true };
    });

    ipcMain.on("host:dictation-audio", (event, id: unknown, samples: unknown) => {
        if (host.fromServerPage(event) && typeof id === "number" && id === active && samples instanceof Float32Array) {
            post({ type: "audio", id, samples });
        }
    });

    ipcMain.on("host:dictation-stop", (event, id: unknown, drop: unknown) => {
        if (!host.fromServerPage(event) || typeof id !== "number") {
            return;
        }

        if (worker === undefined) {
            host.toPage({ id, type: "end" });

            return;
        }

        post({ type: drop === true ? "abort" : "stop", id });
    });

    void scan();

    return {
        state(): DictationState {
            const chosen = host.settings().dictation.model;

            return {
                supported: native !== undefined,
                status,
                ...(message === undefined ? {} : { message }),
                engine: { installed: engineReady, size: engineSize(host.platform, host.arch) },
                folder: root,
                models: MODELS.map((model) => ({
                    id: model.id,
                    name: model.name,
                    languages: model.languages,
                    note: model.note,
                    license: model.license,
                    size: model.files.reduce((sum, file) => sum + file.size, 0),
                    recommended: model.recommended === true,
                    installed: installed.has(model.id),
                    chosen: model.id === chosen,
                    ...(download?.id === model.id
                        ? { download: { step: download.step, percent: Math.min(100, Math.floor((download.received / download.total) * 100)) } }
                        : {}),
                })),
                downloading: download !== undefined,
            };
        },

        async act(action: DictationAction): Promise<void> {
            const model = modelById(action.id);

            if (model === undefined) {
                throw new Error("No such model");
            }

            switch (action.type) {
                case "download":
                    await downloadModel(model);
                    break;
                case "cancel":
                    if (download?.id === model.id) {
                        download.controller.abort();
                    }

                    break;
                case "remove":
                    // A download writes under the same folder, and the last model's removal takes the engine.
                    if (download !== undefined) {
                        throw new Error("Wait for the download to end, or cancel it, before removing a model.");
                    }

                    await removeModel(model.id);
                    break;
                case "use":
                    if (installed.has(model.id)) {
                        host.choose(model.id);
                        host.changed();
                    }

                    break;
            }
        },

        /** The settings changed: a new model (or live words on or off) loads at the next dictation. */
        settingsChanged(): void {
            const chosen = host.settings().dictation.model;

            if (workerModel !== undefined && (workerModel !== chosen || active === undefined)) {
                if (active === undefined) {
                    unload();
                }
            }

            host.changed();
        },

        quit(): void {
            download?.controller.abort();
            worker?.kill();
            worker = undefined;
        },
    };
}
