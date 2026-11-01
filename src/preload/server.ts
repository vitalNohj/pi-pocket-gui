/// <reference lib="dom" />
/**
 * The server page's preload: `window.pocketHost`, the host bridge Pi Pocket's web app uses (docs/desktop.md there).
 * The main process says first whether this frame may have it: only the main window's top frame, on the configured
 * server's origin. Anywhere else (a sign-in page in front of the server, another window) the page gets nothing.
 */
import { contextBridge, ipcRenderer } from "electron";
import type { HostEvent, HostHello, ThemeToken } from "../shared/types";

/** The bridge version this app speaks. */
const API_VERSION = 1;

const hello = ipcRenderer.sendSync("host:hello") as HostHello | null;

if (hello !== null && typeof hello === "object") {
    let visible = hello.visible;
    let listener: ((event: HostEvent) => void) | undefined;

    ipcRenderer.on("host:event", (_event, message: HostEvent) => {
        if (message.type === "visibility") {
            visible = message.visible;
        }

        try {
            listener?.(message);
        } catch (error) {
            console.error(error);
        }
    });

    contextBridge.exposeInMainWorld("pocketHost", {
        kind: "pi-pocket-gui",
        apiVersion: API_VERSION,
        capabilities: ["menu", "badge", "notify", "visibility", "pinned", "open", "runner"],
        menuItems: () => [{ id: "server-settings", label: "Server settings…", hint: "This desktop app's connection" }],
        invoke: (id: unknown) => {
            if (typeof id !== "string") {
                return false;
            }

            ipcRenderer.send("host:invoke", id);

            return true;
        },
        setBadge: (count: unknown) => {
            ipcRenderer.send("host:badge", count);
        },
        notify: (message: unknown) => {
            ipcRenderer.send("host:notify", message);
        },
        visible: () => visible,
        setPinned: (list: unknown) => {
            ipcRenderer.send("host:pinned", list);
        },
        // This computer as a runner (Pi Pocket's docs/runners.md): its name, and linking it with a one-time code.
        computerName: () => hello.computerName,
        linkRunner: (request: unknown) => {
            const code = typeof request === "object" && request !== null ? (request as { code?: unknown }).code : undefined;

            return ipcRenderer.invoke("host:link-runner", { code }) as Promise<{ ok: boolean; error?: string }>;
        },
        // One listener: the page's `web/host.js` passes each event on to its own.
        subscribe: (next: unknown) => {
            listener = typeof next === "function" ? (next as (event: HostEvent) => void) : undefined;
        },
    });

    watchTheme();
    reportRightClicks();

    if (hello.dictation) {
        offerDictation();
    }
}

/** What the main process sends about one dictation (src/main/dictation.ts, PageMessage). */
type DictationMessage =
    | { id: number; type: "result"; text: string; final: boolean }
    | { id: number; type: "error"; error: string }
    | { id: number; type: "end" };

/**
 * Offline dictation: stands in the browser's SpeechRecognition (Electron has no speech service of its own), so Pi
 * Pocket's mic button and Alt+V work unchanged. The microphone is read here, at 16 kHz, and goes to the main process,
 * which recognises it on this computer.
 */
function offerDictation(): void {
    let next = 0;
    const listeners = new Map<number, (message: DictationMessage) => void>();
    const captures = new Map<number, () => void>();

    const release = (id: number): void => {
        captures.get(id)?.();
        captures.delete(id);
    };

    ipcRenderer.on("host:dictation", (_event, message: DictationMessage) => {
        const listener = listeners.get(message.id);

        if (message.type === "end") {
            release(message.id);
            listeners.delete(message.id);
        }

        try {
            listener?.(message);
        } catch (error) {
            console.error(error);
        }
    });

    const capture = async (id: number): Promise<void> => {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });

        // Stopped while the microphone was asked for.
        if (!listeners.has(id)) {
            stream.getTracks().forEach((track) => track.stop());

            return;
        }

        // The browser resamples the microphone to the model's rate. A script processor needs no module, which a page's
        // content security policy could block.
        const context = new AudioContext({ sampleRate: 16_000 });
        const source = context.createMediaStreamSource(stream);
        const processor = context.createScriptProcessor(2048, 1, 1);
        const mute = context.createGain();

        mute.gain.value = 0;
        processor.onaudioprocess = (event) => {
            ipcRenderer.send("host:dictation-audio", id, new Float32Array(event.inputBuffer.getChannelData(0)));
        };
        source.connect(processor);
        processor.connect(mute);
        mute.connect(context.destination);

        captures.set(id, () => {
            processor.onaudioprocess = null;
            source.disconnect();
            processor.disconnect();
            stream.getTracks().forEach((track) => track.stop());
            void context.close();
        });
    };

    const dictation = {
        /** Starts listening; returns the dictation's number. `listener` hears its results, errors, and end. */
        start: (listener: unknown): number => {
            const id = ++next;

            if (typeof listener !== "function") {
                return id;
            }

            listeners.set(id, listener as (message: DictationMessage) => void);

            const fail = (error: string): void => {
                release(id);
                ipcRenderer.send("host:dictation-stop", id, true);
                (listener as (message: DictationMessage) => void)({ id, type: "error", error });
                (listener as (message: DictationMessage) => void)({ id, type: "end" });
                listeners.delete(id);
            };

            void (ipcRenderer.invoke("host:dictation-start", id) as Promise<{ ok?: true; error?: string }>).then(
                async (answer) => {
                    if (answer.error !== undefined) {
                        fail(answer.error);

                        return;
                    }

                    try {
                        await capture(id);
                    } catch (error) {
                        const name = (error as Error).name;

                        fail(name === "NotAllowedError" ? "not-allowed" : name === "NotFoundError" ? "audio-capture" : (error as Error).message);
                    }
                },
                (error: unknown) => {
                    fail((error as Error).message);
                },
            );

            return id;
        },
        /** Stops listening; the words said so far are still recognised, unless `drop`. */
        stop: (id: unknown, drop: unknown): void => {
            if (typeof id === "number" && listeners.has(id)) {
                release(id);
                ipcRenderer.send("host:dictation-stop", id, drop === true);
            }
        },
    };

    contextBridge.executeInMainWorld({ func: installRecognition, args: [dictation] });
}

/**
 * Runs in the page's own world: a SpeechRecognition with the calls Pi Pocket's web/voice.js makes (lang, continuous,
 * interimResults, start, stop, abort, onresult, onerror, onend). Self-contained: it is sent to the page as source.
 */
function installRecognition(dictation: {
    start: (listener: (message: DictationMessage) => void) => number;
    stop: (id: number, drop: boolean) => void;
}): void {
    interface Alternative {
        transcript: string;
        confidence: number;
    }

    const result = (transcript: string, isFinal: boolean) => {
        const alternative: Alternative = { transcript, confidence: 1 };

        return Object.assign([alternative], { isFinal, item: (index: number) => (index === 0 ? alternative : null) });
    };

    class OfflineSpeechRecognition extends EventTarget {
        lang = "";
        continuous = false;
        interimResults = false;
        maxAlternatives = 1;
        onresult: ((event: Event) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;
        onend: ((event: Event) => void) | null = null;
        onstart: ((event: Event) => void) | null = null;
        #id: number | undefined;
        #finals: ReturnType<typeof result>[] = [];

        start(): void {
            if (this.#id !== undefined) {
                throw new DOMException("Dictation has already started.", "InvalidStateError");
            }

            this.#finals = [];

            const id = dictation.start((message) => {
                if (this.#id !== id) {
                    return;
                }

                if (message.type === "result") {
                    if (message.text === "" || (!message.final && !this.interimResults)) {
                        return;
                    }

                    const heard = result(message.text, message.final);
                    const results = [...this.#finals, heard];

                    if (message.final) {
                        this.#finals.push(heard);
                    }

                    this.#fire("result", { resultIndex: this.#finals.length - (message.final ? 1 : 0), results: Object.assign(results, { item: (index: number) => results[index] ?? null }) });

                    if (message.final && !this.continuous) {
                        this.stop();
                    }
                } else if (message.type === "error") {
                    this.#fire("error", { error: message.error, message: message.error });
                } else {
                    this.#id = undefined;
                    this.#fire("end", {});
                }
            });

            this.#id = id;
            queueMicrotask(() => {
                this.#fire("start", {});
            });
        }

        stop(): void {
            if (this.#id !== undefined) {
                dictation.stop(this.#id, false);
            }
        }

        abort(): void {
            if (this.#id !== undefined) {
                dictation.stop(this.#id, true);
            }
        }

        #fire(type: string, fields: Record<string, unknown>): void {
            const event = Object.assign(new Event(type), fields);
            const handler = (this as unknown as Record<string, unknown>)[`on${type}`];

            if (typeof handler === "function") {
                (handler as (event: Event) => void).call(this, event);
            }

            this.dispatchEvent(event);
        }
    }

    Object.defineProperty(globalThis, "SpeechRecognition", { value: OfflineSpeechRecognition, configurable: true, writable: true });
    Object.defineProperty(globalThis, "webkitSpeechRecognition", { value: OfflineSpeechRecognition, configurable: true, writable: true });
}

/**
 * The page's own right-click, for the app's menu (src/main/themed-menu.ts). Electron's `context-menu` event opens the
 * menu wherever it fires; macOS has been known not to fire it for this view, and then this report is what opens it.
 * Only a right-click the page left alone: Pi Pocket's own menus (a session row's) call preventDefault, and the
 * listener runs after theirs, as the event bubbles. A right-click, a two-finger click, and a Control+click on macOS
 * all arrive as this one event.
 */
function reportRightClicks(): void {
    document.addEventListener("contextmenu", (event) => {
        if (event.defaultPrevented) {
            return;
        }

        const field = textField(event.target);
        const selection = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
            ? field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0)
            : document.getSelection()?.toString() ?? "";

        ipcRenderer.send("host:context-menu", {
            x: event.clientX,
            y: event.clientY,
            isEditable: field !== undefined,
            selectionText: selection,
        });
    });
}

const TEXT_INPUTS = new Set(["", "text", "search", "url", "tel", "email", "password", "number"]);

/** The text field a right-click landed in, the way Chromium decides what is editable; none on anything else. */
function textField(target: EventTarget | null): HTMLElement | undefined {
    if (!(target instanceof HTMLElement)) {
        return undefined;
    }

    if (target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && TEXT_INPUTS.has(target.type))) {
        return target.readOnly || target.disabled ? undefined : target;
    }

    return target.isContentEditable ? target : undefined;
}

// The tokens src/main/theme.ts takes. A preload cannot import a module of its own, so the list is here too.
const TOKENS: ThemeToken[] = [
    "desk",
    "bg",
    "card",
    "text",
    "body",
    "muted",
    "accent",
    "accent-fill",
    "accent-ink",
    "brand",
    "ok",
    "warn",
    "err",
    "code-bg",
];

/**
 * Pi Pocket's colors as the page shows them, for the app's settings screen, window, and tray (src/main/theme.ts): read
 * at start and again whenever the theme changes (the root's attributes and inline variables, or a theme stylesheet).
 * Each token is resolved to #rrggbb[aa] by painting it, so color-mix() and theme files of any form come out the same.
 */
function watchTheme(): void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sent = "";

    const read = (): void => {
        const root = document.documentElement;
        const style = getComputedStyle(root);

        // The configured origin can also serve an error, sign-in, or unrelated page. A missing/invalid var()
        // inherits its text color (often black), which is not a theme. Wait for a complete palette instead.
        if (TOKENS.some((token) => {
            const value = style.getPropertyValue(`--${token}`).trim();

            return value === "" || !CSS.supports("color", value);
        })) {
            return;
        }

        const probe = document.createElement("span");
        const canvas = document.createElement("canvas");

        canvas.width = canvas.height = 1;

        const paint = canvas.getContext("2d", { willReadFrequently: true });

        if (paint === null) {
            return;
        }

        probe.style.display = "none";
        root.append(probe);

        const colors: Record<string, string> = {};

        try {
            for (const token of TOKENS) {
                // The root's own value: the app's see-through CSS changes --bg on the body, never on the root.
                probe.style.color = "";
                probe.style.color = `var(--${token})`;

                const color = getComputedStyle(probe).color;

                paint.clearRect(0, 0, 1, 1);
                paint.fillStyle = color;
                paint.fillRect(0, 0, 1, 1);

                const [r = 0, g = 0, b = 0, a = 0] = paint.getImageData(0, 0, 1, 1).data;
                const hex = (value: number) => value.toString(16).padStart(2, "0");

                colors[token] = `#${hex(r)}${hex(g)}${hex(b)}${a === 255 ? "" : hex(a)}`;
            }
        } finally {
            probe.remove();
        }

        const theme = { mode: root.dataset.mode === "light" ? "light" : "dark", colors };
        const json = JSON.stringify(theme);

        if (json !== sent) {
            sent = json;
            ipcRenderer.send("host:theme", theme);
        }
    };

    const soon = (): void => {
        clearTimeout(timer);
        timer = setTimeout(read, 150);
    };

    const start = (): void => {
        read();
        new MutationObserver(soon).observe(document.documentElement, { attributes: true });
        new MutationObserver(soon).observe(document.head, { childList: true, subtree: true, attributes: true });
        // A theme's stylesheet applies when it loads, after the element that asks for it.
        document.addEventListener("load", soon, true);
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }
}
