/**
 * This computer as a runner: the app runs `pi-pocket runner` (Pi Pocket's docs/runners.md) while it runs, so a Pi
 * Pocket server can run sessions' tools here: files and commands on this computer, the agent and its keys on the
 * server. It links with a one-time code the server's page gives (the bridge's `linkRunner`), keeps the link in the
 * app's own folder, and starts the runner again when it stops, unless the server ended the link for good.
 *
 * The runner comes from the Pi Pocket runtime the app installs (src/main/local-server.ts): one is installed for it
 * when there is none yet, also when the app connects to another server.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import type { RunnerState } from "../shared/types";
import { cleanLine } from "./local-versions";

/** `pi-pocket runner`'s exit code when the server ended the link for good: starting it again would not help. */
export const STOPPED_BY_SERVER = 3;
const LOG_LINES = 200;
const STOP_LIMIT_MS = 5000;
const LEGACY_EXIT_MS = 5000;
const LEGACY_WARNING = "This runner does not support session confirmation. Update Pi Pocket to ask before new sessions.";

/** One request from the runner's stdout; ids belong to that runner process only. */
export interface RunnerConfirmation {
    id: number;
    server: string;
    computer: string;
    person: string;
    folder: string;
    kind: "new" | "fork";
}

export interface RunnerHost {
    /** Where the link and its log go. */
    home: string;
    platform: NodeJS.Platform;
    /** Whether the person wants it running (the settings' runner.enabled). */
    enabled: () => boolean;
    setEnabled: (enabled: boolean) => Promise<void>;
    confirmSessions: () => boolean;
    /** Show one question. Aborting the signal must close it. Errors deny the request. */
    ask: (request: RunnerConfirmation, signal: AbortSignal) => Promise<boolean>;
    /** The installed runtime to run it from; undefined when there is none with the runner. */
    runtime: () => { node: string; launcher: string; bin: string } | undefined;
    /** Install Pi Pocket on this computer, or update it, so a runtime has the runner. */
    prepare: () => Promise<void>;
    environment: () => Promise<NodeJS.ProcessEnv>;
    changed: () => void;
}

/** What `runner.json` holds; the key stays in the file. */
interface Link {
    server: string;
    id: string;
    name: string;
}

/** The name this computer suggests for itself: its host name, without macOS's ".local" or a domain. */
export function computerName(name = hostname()): string {
    const short = name.replace(/\.local$/i, "").split(".")[0] ?? "";

    return short.replace(/-/g, " ").trim().slice(0, 60) || "This computer";
}

/** A line the runner printed, without its time stamp's brackets doubled and without colors. */
function plain(line: string): string {
    return cleanLine(line).trimEnd();
}

export function setUpRunner(host: RunnerHost) {
    const linkFile = join(host.home, "runner.json");
    let child: ChildProcess | undefined;
    let status: RunnerState["status"] = "off";
    let message: string | undefined;
    let lines: string[] = [];
    let failures = 0;
    let restartTimer: NodeJS.Timeout | undefined;
    let runningFrom: string | undefined;
    let busy: string | undefined;
    let quitting = false;
    /** A step (linking, unlinking) stopped it on purpose: what it does next is the step's to decide. */
    let holding = false;
    let starting: Promise<void> | undefined;
    let generation = 0;
    let cancelQuestions: (() => void) | undefined;
    let legacyLauncher: string | undefined;
    let confirmError: string | undefined;
    let confirmationSync = Promise.resolve();

    const readLink = (): Link | undefined => {
        try {
            const value = JSON.parse(readFileSync(linkFile, "utf8")) as Partial<Link>;

            return typeof value.server === "string" && typeof value.id === "string" && typeof value.name === "string"
                ? { server: value.server, id: value.id, name: value.name }
                : undefined;
        } catch {
            return undefined;
        }
    };

    const set = (next: RunnerState["status"], text?: string) => {
        status = next;
        message = text;
        host.changed();
    };

    const log = (line: string) => {
        lines.push(plain(line));

        if (lines.length > LOG_LINES) {
            lines = lines.slice(-LOG_LINES);
        }
    };

    /** Runs the launcher with these runner arguments to its end: its output, or its last lines as the error. */
    const runOnce = async (args: string[]): Promise<string> => {
        const runtime = host.runtime();

        if (runtime === undefined) {
            throw new Error("The runner is not installed on this computer.");
        }

        const env = await host.environment();

        return new Promise((done, fail) => {
            const proc = spawn(runtime.node, [runtime.launcher, "runner", ...args, "--config", linkFile], {
                cwd: homedir(),
                env: { ...env, NO_COLOR: "1" },
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true,
            });
            let output = "";
            const keep = (chunk: Buffer) => {
                output = `${output}${chunk.toString("utf8")}`.slice(-8000);
            };

            proc.stdout.on("data", keep);
            proc.stderr.on("data", keep);
            proc.on("error", fail);
            proc.on("close", (code) => {
                const text = output.split("\n").map(plain).filter(Boolean).join("\n");

                if (code === 0) {
                    done(text);
                } else {
                    fail(new Error(text.replace(/^pi-pocket runner: /gm, "") || `The runner stopped with code ${String(code)}.`));
                }
            });
        });
    };

    /** Serialize writes so a quick second setting change is always applied last. No link yet is not an error. */
    const syncConfirmation = (): Promise<void> => {
        confirmationSync = confirmationSync.then(async () => {
            if (readLink() === undefined) {
                return;
            }

            try {
                await runOnce(["settings", "confirm", host.confirmSessions() ? "on" : "off"]);
                confirmError = undefined;
            } catch (error) {
                confirmError = `Could not set session confirmation: ${(error as Error).message}`;
                log(confirmError);
            }

            host.changed();
        });

        return confirmationSync;
    };

    const startRunner = async (): Promise<void> => {
        const attempt = generation;

        if (child !== undefined || quitting || holding || !host.enabled()) {
            return;
        }

        const link = readLink();

        if (link === undefined) {
            set("unlinked");

            return;
        }

        const runtime = host.runtime();

        if (runtime === undefined) {
            set("failed", "Install or update Pi Pocket under This computer in Connection to use the runner.");

            return;
        }

        await syncConfirmation();
        const env = await host.environment();
        const separator = host.platform === "win32" ? ";" : ":";

        if (attempt !== generation || child !== undefined || quitting || holding || !host.enabled()) {
            return;
        }

        log(`— ${new Date().toISOString()} runner for ${link.server}, as "${link.name}"`);
        set("connecting", `Connecting to ${link.server}…`);

        const usesConfirmation = legacyLauncher !== runtime.launcher;
        const began = Date.now();
        let unknownOption = false;
        const proc = spawn(runtime.node, [runtime.launcher, "runner", ...(usesConfirmation ? ["--confirm-via", "stdio"] : []), "--config", linkFile], {
            cwd: homedir(),
            // The person's tools first, as in their terminal; the runtime's Node and npm after.
            env: { ...env, PATH: `${env.PATH ?? ""}${separator}${runtime.bin}`, NO_COLOR: "1", PI_POCKET_DESKTOP_APP: "1" },
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
        });

        child = proc;
        runningFrom = runtime.launcher;

        const questions = new Map<number, { request: RunnerConfirmation; controller: AbortController }>();
        const queue: number[] = [];
        let asking = false;
        const cancelPending = () => {
            for (const question of questions.values()) {
                question.controller.abort();
            }

            questions.clear();
            queue.length = 0;
        };

        cancelQuestions = cancelPending;

        const askNext = async (): Promise<void> => {
            if (asking) {
                return;
            }

            asking = true;

            try {
                while (queue.length > 0) {
                    const id = queue.shift()!;
                    const question = questions.get(id);

                    if (question === undefined) {
                        continue;
                    }

                    let allow = false;

                    try {
                        allow = await host.ask(question.request, question.controller.signal) === true;
                    } catch (error) {
                        log(`Could not ask about the session: ${(error as Error).message}`);
                    }

                    // END, stop, or a new process makes even a late Allow have no effect.
                    if (questions.get(id) === question && !question.controller.signal.aborted && child === proc && proc.stdin.writable) {
                        proc.stdin.write(`${JSON.stringify({ id, allow })}\n`);
                    }

                    if (questions.get(id) === question) {
                        questions.delete(id);
                    }
                }
            } finally {
                asking = false;
            }
        };

        const confirmationLine = (line: string): boolean => {
            const end = line.startsWith("PI-POCKET-CONFIRM-END ");
            const prefix = end ? "PI-POCKET-CONFIRM-END " : "PI-POCKET-CONFIRM ";

            if (!line.startsWith(prefix)) {
                return false;
            }

            if (child !== proc || quitting || status === "stopping") {
                return true;
            }

            try {
                const value: unknown = JSON.parse(line.slice(prefix.length));

                if (!isConfirmationId(value)) {
                    throw new Error("invalid id");
                }

                if (end) {
                    const question = questions.get(value.id);

                    questions.delete(value.id);
                    question?.controller.abort();
                } else if (isConfirmation(value)) {
                    if (!questions.has(value.id)) {
                        questions.set(value.id, { request: value, controller: new AbortController() });
                        queue.push(value.id);
                        void askNext();
                    }
                } else {
                    throw new Error("invalid request");
                }
            } catch {
                log("Ignored an invalid session confirmation line.");
            }

            return true;
        };

        const onLine = (line: string) => {
            log(line);
            unknownOption ||= /unknown (?:option|command)\b/i.test(plain(line));

            if (child !== proc) {
                return;
            }

            if (/\] (Connected to|Back with) /.test(line)) {
                failures = 0;
                set("connected");
            } else if (/\] Disconnected/.test(line)) {
                cancelPending();
                set("connecting", "Reconnecting. Sessions must wait for the server.");
            } else if (/\] Connection: /.test(line) && status !== "connected") {
                set("connecting", plain(line).replace(/^\[[^\]]*\] Connection: /, "Cannot reach the server: "));
            }
        };

        readLines(proc.stdout, (line) => {
            if (!confirmationLine(line)) {
                onLine(line);
            }
        });
        readLines(proc.stderr, onLine);
        proc.stdin.on("error", (error) => log(`Could not answer the session question: ${error.message}`));
        proc.on("error", (error) => log(`Could not start: ${error.message}`));
        proc.on("close", (code, signal) => {
            cancelPending();
            if (child !== proc) {
                return;
            }

            child = undefined;
            runningFrom = undefined;
            cancelQuestions = undefined;

            if (quitting || status === "stopping" || !host.enabled()) {
                set(readLink() === undefined ? "unlinked" : "off");

                // Turned on again while it was stopping: start it now, as the setting says.
                if (!quitting && !holding && host.enabled()) {
                    void start();
                }

                return;
            }

            if (code !== STOPPED_BY_SERVER && usesConfirmation && unknownOption && Date.now() - began <= LEGACY_EXIT_MS) {
                legacyLauncher = runtime.launcher;
                log("This runner does not support --confirm-via; retrying without the flag.");
                void start();

                return;
            }

            const last = lines.at(-1)?.replace(/^pi-pocket runner: /, "") ?? "";

            if (code === STOPPED_BY_SERVER) {
                set("ended", last || "The server ended this computer's link. Link it again.");

                return;
            }

            failures += 1;
            const wait = Math.min(60, 2 ** Math.min(failures, 6));

            set("failed", `The runner stopped (${signal ?? `code ${String(code)}`}). Restarting in ${String(wait)} s. ${last}`.trim());
            restartTimer = setTimeout(() => void start(), wait * 1000);
        });
    };

    /** Coalesce starts while the link setting and environment are being read. */
    const start = (): Promise<void> => {
        clearTimeout(restartTimer);
        starting ??= startRunner().finally(() => {
            starting = undefined;
        });

        return starting;
    };

    const stop = async (): Promise<void> => {
        clearTimeout(restartTimer);
        generation += 1;
        cancelQuestions?.();
        await starting;
        const proc = child;

        if (proc === undefined || proc.exitCode !== null) {
            return;
        }

        set("stopping");
        // It says goodbye to the server and stops its daemon; Windows has no SIGTERM, and it ends there at once.
        proc.kill("SIGTERM");

        const timer = setTimeout(() => proc.kill("SIGKILL"), STOP_LIMIT_MS);

        await new Promise<void>((resolve) => {
            if (proc.exitCode !== null || proc.signalCode !== null) {
                resolve();
            } else {
                proc.once("close", () => resolve());
            }
        });
        clearTimeout(timer);
    };

    /** Work that takes a while, one at a time, shown while it runs. */
    const step = async <T>(text: string, work: () => Promise<T>): Promise<T> => {
        if (busy !== undefined) {
            throw new Error(`${busy} Wait for it to end.`);
        }

        busy = text;
        host.changed();

        try {
            return await work();
        } finally {
            busy = undefined;
            host.changed();
        }
    };

    return {
        state(): RunnerState {
            const link = readLink();
            const confirmationProblem = confirmError ?? (legacyLauncher !== undefined && legacyLauncher === host.runtime()?.launcher ? LEGACY_WARNING : undefined);

            return {
                status,
                ...(message === undefined ? {} : { message }),
                ...(link === undefined ? {} : { link }),
                ...(busy === undefined ? {} : { busy }),
                enabled: host.enabled(),
                ...(confirmationProblem === undefined ? {} : { confirmError: confirmationProblem }),
                available: host.runtime() !== undefined,
                computerName: computerName(),
                log: lines.slice(-40),
            };
        },
        /** The link, for the server's page: whether this computer is linked to it, and as which. */
        link: readLink,
        /** At the app's start: run it when it is on and linked. */
        boot: (): void => {
            if (readLink() === undefined) {
                set("unlinked");
            } else if (host.enabled()) {
                void start();
            } else {
                set("off");
            }
        },
        /**
         * Link this computer to `server` with a one-time code from it, then run the runner. Installs or updates Pi
         * Pocket on this computer first when it has no runner.
         */
        linkTo: (server: string, code: string): Promise<void> =>
            step("Linking this computer…", async () => {
                if (host.runtime() === undefined) {
                    busy = "Installing the runner…";
                    host.changed();
                    await host.prepare();

                    if (host.runtime() === undefined) {
                        throw new Error("The runner is not available. Update Pi Pocket under This computer in Connection, then try again.");
                    }
                }

                holding = true;

                try {
                    await stop();
                    await mkdir(host.home, { recursive: true });
                    busy = "Linking this computer…";
                    host.changed();
                    log(await runOnce(["link", server, code]));
                    await syncConfirmation();
                    failures = 0;
                    await host.setEnabled(true);
                } finally {
                    // Linked, or not: the link there is now (the new one, or the one before) runs again.
                    holding = false;
                    await start();
                }
            }),
        /** Forget the link; the computer stays listed on the server until removed there. */
        unlink: (): Promise<void> =>
            step("Unlinking…", async () => {
                holding = true;

                try {
                    await stop();
                    await confirmationSync;
                    await rm(linkFile, { force: true });
                    confirmError = undefined;
                    set("unlinked");
                } finally {
                    holding = false;
                }
            }),
        /** Turn running it on or off (the setting already changed). */
        enabledChanged: (): void => {
            if (host.enabled()) {
                if (status === "ended") {
                    return;
                }

                void start();
            } else {
                void stop().then(() => {
                    if (!host.enabled()) {
                        set(readLink() === undefined ? "unlinked" : "off");
                    } else if (!quitting && !holding) {
                        void start();
                    }
                });
            }
        },
        /** The setting already changed. The runner reads the saved choice for each request; keep it running. */
        confirmChanged: syncConfirmation,
        restart: async (): Promise<void> => {
            await stop();
            failures = 0;
            await start();
        },
        /** The runtimes changed (an update): run from the new one, since the old one goes away. */
        runtimeChanged: (): void => {
            const now = host.runtime()?.launcher;

            if (child !== undefined && now !== undefined && now !== runningFrom) {
                void stop().then(start);
            } else if (child === undefined && status === "failed" && now !== undefined && host.enabled()) {
                void start();
            }
        },
        linked: (): boolean => existsSync(linkFile),
        quit: async (): Promise<void> => {
            quitting = true;
            await stop();
        },
    };
}

function isConfirmationId(value: unknown): value is { id: number } {
    return typeof value === "object" && value !== null && "id" in value && Number.isSafeInteger(value.id) && (value.id as number) >= 0;
}

function isConfirmation(value: { id: number }): value is RunnerConfirmation {
    const request = value as Partial<RunnerConfirmation>;

    return typeof request.server === "string" && typeof request.computer === "string" && typeof request.person === "string"
        && typeof request.folder === "string" && (request.kind === "new" || request.kind === "fork");
}

function readLines(stream: NodeJS.ReadableStream, listener: (line: string) => void): void {
    let buffer = "";

    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
        buffer += chunk;
        let newline = buffer.indexOf("\n");

        while (newline !== -1) {
            listener(buffer.slice(0, newline).replace(/\r$/, ""));
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf("\n");
        }
    });
    stream.on("end", () => {
        if (buffer !== "") {
            listener(buffer);
        }
    });
}
