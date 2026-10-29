/** The config screen: the connection on top, how to get a server below it, then the settings. */
import type { ConfigReason, ConfigState, GuiConfigApi, ProbeResult, Settings } from "../../shared/types";

declare global {
    interface Window {
        gui: GuiConfigApi;
    }
}

const gui = window.gui;

function element<T extends HTMLElement>(id: string): T {
    const found = document.getElementById(id);

    if (found === null) {
        throw new Error(`#${id} is missing`);
    }

    return found as T;
}

const urlInput = element<HTMLInputElement>("url");
const schemeInput = element<HTMLSelectElement>("scheme");
const hostInput = element<HTMLInputElement>("host");
const portInput = element<HTMLInputElement>("port");
const pathInput = element<HTMLInputElement>("path");
const urlFields = element<HTMLDivElement>("url-fields");
const partFields = element<HTMLDivElement>("part-fields");
const urlError = element<HTMLParagraphElement>("url-error");
const status = element<HTMLSpanElement>("status");
const statusDetail = element<HTMLParagraphElement>("status-detail");
const banner = element<HTMLDivElement>("banner");
const back = element<HTMLButtonElement>("back");
const retry = element<HTMLButtonElement>("retry");
const retryNote = element<HTMLSpanElement>("retry-note");
const saved = element<HTMLSpanElement>("saved");

let state: ConfigState | undefined;
/** The address the person is editing; a state update from the main process does not overwrite it while it differs. */
let editing = false;
let checkSeq = 0;

// ——— The address, as one field or as parts ———

function mode(): "url" | "parts" {
    return (document.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value ?? "url") as "url" | "parts";
}

function typedUrl(): string {
    if (mode() === "url") {
        return urlInput.value.trim();
    }

    const host = hostInput.value.trim();
    const port = portInput.value.trim();
    const path = pathInput.value.trim();

    if (host === "") {
        return "";
    }

    const bracketed = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;

    return `${schemeInput.value}://${bracketed}${port === "" ? "" : `:${port}`}${path === "" || path === "/" ? "" : path.startsWith("/") ? path : `/${path}`}`;
}

function fillAddress(url: string): void {
    urlInput.value = url;

    try {
        const parsed = new URL(url);

        schemeInput.value = parsed.protocol === "https:" ? "https" : "http";
        hostInput.value = parsed.hostname.replace(/^\[|\]$/g, "");
        portInput.value = parsed.port;
        pathInput.value = parsed.pathname === "/" ? "" : parsed.pathname;
    } catch {
        hostInput.value = "";
    }
}

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) {
    radio.addEventListener("change", () => {
        const url = mode() === "parts" ? urlInput.value.trim() : typedUrl();

        if (url !== "") {
            fillAddress(url);
        }

        urlFields.hidden = mode() !== "url";
        partFields.hidden = mode() !== "parts";
    });
}

for (const input of [urlInput, hostInput, portInput, pathInput, schemeInput]) {
    input.addEventListener("input", () => {
        editing = true;
        urlError.hidden = true;
        showStatus(undefined, "Not checked yet");
    });
}

// ——— What the check found ———

function showStatus(probe: ProbeResult | undefined, pending?: string): void {
    if (probe === undefined) {
        status.dataset.state = "checking";
        status.textContent = pending ?? "Checking…";
        statusDetail.textContent = "";

        return;
    }

    switch (probe.kind) {
        case "detected":
            status.dataset.state = "detected";
            status.textContent = "Detected";
            statusDetail.textContent =
                probe.bridge > 0
                    ? `Pi Pocket answers at ${probe.url}, with desktop support.`
                    : `Pi Pocket answers at ${probe.url}. It has no desktop support yet (notifications, tray pins): please update it.`;
            break;
        case "other":
            status.dataset.state = "other";
            status.textContent = "Not detected";
            statusDetail.textContent = probe.message;
            break;
        case "unreachable":
            status.dataset.state = "not-detected";
            status.textContent = "Not detected";
            statusDetail.textContent = `Nothing answered at ${probe.url}. ${probe.message}`;
            break;
        case "invalid":
            status.dataset.state = "not-detected";
            status.textContent = "Not detected";
            statusDetail.textContent = probe.message;
            break;
    }
}

function reasonBanner(reason: ConfigReason): { text: string; tone: "error" | "info" } | undefined {
    switch (reason.kind) {
        case "load-failed":
            return { text: `Pi Pocket did not load from ${reason.url}: ${reason.message}`, tone: "error" };
        case "outage":
            return { text: `Lost the connection to ${reason.url}: ${reason.message} The app goes back as soon as it answers.`, tone: "error" };
        case "crashed":
            return { text: `${reason.message} Retry opens Pi Pocket again.`, tone: "error" };
        case "first-run":
            return { text: "Welcome. Check the server's address, then connect.", tone: "info" };
        default:
            return undefined;
    }
}

let countdown: number | undefined;

function render(next: ConfigState): void {
    state = next;
    element("app-version").textContent = next.appVersion;
    element("config-path").textContent = next.configPath;

    if (!editing) {
        fillAddress(next.settings.server.url);
    }

    const message = reasonBanner(next.reason);

    banner.hidden = message === undefined;

    if (message !== undefined) {
        banner.textContent = message.text;
        banner.dataset.tone = message.tone;
    }

    back.hidden = !next.canReturn;

    const failing = next.reason.kind === "load-failed" || next.reason.kind === "outage" || next.reason.kind === "crashed" || next.reason.kind === "not-detected";

    retry.hidden = !failing && next.nextRetryAt === undefined;

    if (!editing || next.probe?.url === typedUrlNormalized()) {
        showStatus(next.probe);
    }

    window.clearInterval(countdown);
    countdown = undefined;

    if (next.nextRetryAt !== undefined) {
        const tick = () => {
            const left = Math.max(0, Math.round(((next.nextRetryAt ?? 0) - Date.now()) / 1000));

            retryNote.textContent = left > 0 ? `Trying again in ${String(left)} s` : "Trying again…";
        };

        tick();
        countdown = window.setInterval(tick, 1000);
    } else {
        retryNote.textContent = "";
    }

    renderSettings(next);
}

function typedUrlNormalized(): string {
    return typedUrl().replace(/\/+$/, "");
}

// ——— Connection actions ———

async function check(): Promise<ProbeResult | undefined> {
    const url = typedUrl();

    if (url === "") {
        urlError.hidden = false;
        urlError.textContent = "Type the server's address.";

        return undefined;
    }

    const seq = ++checkSeq;

    showStatus(undefined);

    const result = await gui.probe(url);

    if (seq === checkSeq) {
        showStatus(result);

        if (result.kind === "invalid") {
            urlError.hidden = false;
            urlError.textContent = result.message;
        }
    }

    return result;
}

element("test").addEventListener("click", () => {
    void check();
});

element<HTMLFormElement>("connect-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
        const result = await check();

        if (result === undefined || result.kind === "invalid") {
            return;
        }

        // A server that is not detected may still be right (a sign-in page in front of it): connect anyway.
        editing = false;
        await gui.connect(result.url);
    })();
});

retry.addEventListener("click", () => {
    void gui.retryNow();
});

back.addEventListener("click", () => {
    void gui.back();
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-open]")) {
    button.addEventListener("click", () => {
        void gui.openExternal(button.dataset.open as "github" | "docs");
    });
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
    button.addEventListener("click", () => {
        const text = element(button.dataset.copy ?? "").textContent ?? "";

        void navigator.clipboard.writeText(text).then(() => {
            button.textContent = "Copied";
            window.setTimeout(() => {
                button.textContent = "Copy";
            }, 1500);
        });
    });
}

element("show-file").addEventListener("click", () => {
    void gui.showConfigFile();
});

// ——— Settings ———

const settingInputs = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("[data-key]")];

function read(settings: Settings, key: string): unknown {
    const [section, name] = key.split(".") as [keyof Settings, string];

    return (settings[section] as Record<string, unknown>)[name];
}

function renderSettings(next: ConfigState): void {
    for (const input of settingInputs) {
        if (input === document.activeElement) {
            continue;
        }

        const value = read(next.settings, input.dataset.key ?? "");

        if (input instanceof HTMLInputElement && input.type === "checkbox") {
            input.checked = value === true;
        } else if (Array.isArray(value)) {
            input.value = value.join("\n");
        } else {
            input.value = String(value);
        }
    }

    element("tray-note").textContent = next.trayAvailable
        ? "Closing the window keeps the app running in the tray, so notifications keep coming."
        : "This desktop shows no tray icons (on GNOME, the AppIndicator extension adds them), so closing minimizes instead.";

    const problems = element("problems");
    const list = element("problem-list");

    problems.hidden = next.problems.length === 0;
    list.replaceChildren(
        ...next.problems.map((problem) => {
            const item = document.createElement("li");
            const path = document.createElement("code");

            path.textContent = problem.path;
            item.append(path, ` ${problem.message}`);

            return item;
        }),
    );
}

function collect(): Settings {
    const settings = structuredClone(state!.settings);

    for (const input of settingInputs) {
        const [section, name] = (input.dataset.key ?? "").split(".") as [keyof Settings, string];
        const target = settings[section] as Record<string, unknown>;
        let value: unknown;

        if (input instanceof HTMLInputElement && input.type === "checkbox") {
            value = input.checked;
        } else if (input instanceof HTMLInputElement && input.type === "number") {
            value = input.value === "" ? Number.NaN : Number(input.value);
        } else if (input instanceof HTMLTextAreaElement) {
            value = input.value
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line !== "");
        } else {
            value = input.value;
        }

        target[name] = value;
    }

    return settings;
}

let saveTimer: number | undefined;

function scheduleSave(): void {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
        void (async () => {
            const next = await gui.save(collect());

            render(next);
            saved.textContent = next.problems.length === 0 ? "Saved" : "Saved, with problems below";
            window.setTimeout(() => {
                saved.textContent = "";
            }, 2000);
        })();
    }, 300);
}

for (const input of settingInputs) {
    input.addEventListener("change", scheduleSave);
}

element<HTMLFormElement>("settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
});

// ——— Start ———

gui.onState(render);
void gui.state().then(render);
