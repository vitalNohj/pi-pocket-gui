/** The config screen: the connection on top, how to get a server below it, then the settings. */
import type { BillionContextAction, ConfigReason, ConfigState, DictationModelState, GuiConfigApi, LocalAction, LocalState, ProbeResult, Settings } from "../../shared/types";

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
/** The last check this page made, and of which address: Connect, once connected, waits for a check of a new one. */
let checked: ProbeResult | undefined;
let checkedInput: string | undefined;
let checking: number | undefined;
let connecting = false;
const connectButton = element<HTMLButtonElement>("connect");

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
        addressChanged();
    });
}

function addressChanged(): void {
    editing = true;
    urlError.hidden = true;
    checkSeq++;
    checking = undefined;
    checked = undefined;
    checkedInput = undefined;

    if (state !== undefined && connectedHere(state)) {
        showConnected(state);
    } else {
        showStatus(undefined, "Not checked yet");
    }

    updateConnect();
}

for (const input of [urlInput, hostInput, portInput, pathInput, schemeInput]) {
    input.addEventListener("input", addressChanged);
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

/** The typed address is the one Pi Pocket is open at. */
function connectedHere(next: ConfigState): boolean {
    return next.connectedUrl !== undefined && sameUrl(typedUrl(), next.connectedUrl);
}

function sameUrl(a: string, b: string): boolean {
    const plain = (url: string) => {
        try {
            const parsed = new URL(url.trim());

            return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, "")}`;
        } catch {
            return url.trim().replace(/\/+$/, "");
        }
    };

    return plain(a) === plain(b);
}

function showConnected(next: ConfigState): void {
    if (next.probe?.kind === "other" && sameUrl(next.probe.url, next.connectedUrl ?? "")) {
        showStatus(next.probe);

        return;
    }

    const bridge = next.probe !== undefined && next.probe.kind === "detected" && sameUrl(next.probe.url, next.connectedUrl ?? "") ? next.probe.bridge : 1;

    status.dataset.state = "connected";
    status.textContent = "Connected";
    statusDetail.textContent =
        bridge > 0
            ? `Pi Pocket is open at ${next.connectedUrl ?? ""}, with desktop support.`
            : `Pi Pocket is open at ${next.connectedUrl ?? ""}. It has no desktop support yet (notifications, tray pins): please update it.`;
}

function checkedHere(): ProbeResult | undefined {
    if (checked !== undefined && (checkedInput === typedUrl() || sameUrl(checked.url, typedUrl()))) {
        return checked;
    }

    return state?.probe !== undefined && sameUrl(state.probe.url, typedUrl()) ? state.probe : undefined;
}

/** The first Connect may check for you, but a failed check never opens an error/API page. */
function updateConnect(): void {
    for (const input of [urlInput, hostInput, portInput, pathInput, schemeInput, ...document.querySelectorAll<HTMLInputElement>('input[name="mode"]')]) {
        input.disabled = connecting;
    }

    element<HTMLButtonElement>("test").disabled = connecting || checking !== undefined;

    if (connecting || checking !== undefined) {
        connectButton.disabled = true;
        connectButton.textContent = connecting ? "Connecting…" : "Checking…";

        return;
    }

    const current = checkedHere();
    const unverified = current?.kind === "other" && current.canOpen;

    connectButton.textContent = unverified ? "Open webpage anyway" : "Connect";
    connectButton.title = "";

    if (state !== undefined && connectedHere(state)) {
        connectButton.disabled = true;
        connectButton.title = "Already open at this address. Use Back to Pi Pocket to return.";
    } else if (current !== undefined) {
        connectButton.disabled = current.kind !== "detected" && !unverified;
        connectButton.title = connectButton.disabled ? "Pi Pocket was not detected. Check its web interface address." : "";
    } else {
        connectButton.disabled = state?.connectedUrl !== undefined;
        connectButton.title = connectButton.disabled ? "Check the new address first." : "";
    }
}

function reasonBanner(reason: ConfigReason): { text: string; tone: "error" | "info" } | undefined {
    switch (reason.kind) {
        case "not-detected":
            return reason.probe.kind === "detected" ? undefined : {
                text: reason.probe.message,
                tone: reason.probe.kind === "other" && reason.probe.canOpen ? "info" : "error",
            };
        case "load-failed":
            return { text: `Pi Pocket did not load from ${reason.url}: ${reason.message}`, tone: "error" };
        case "outage":
            return { text: `Lost the connection to ${reason.url}: ${reason.message} The app goes back as soon as it answers.`, tone: "error" };
        case "crashed":
            return { text: `${reason.message} Retry opens Pi Pocket again.`, tone: "error" };
        case "first-run":
            return { text: "Welcome. Check the server's address, then connect.", tone: "info" };
        case "local":
            return undefined;
        default:
            return undefined;
    }
}

let countdown: number | undefined;

/** The Updates card: where the app's own update stands, and the button for its next step. */
function renderUpdate(next: ConfigState): void {
    const update = next.update;
    const action = element("update-action") as HTMLButtonElement;
    const check = element("update-check") as HTMLButtonElement;
    const busy = update.status === "checking" || update.status === "downloading";
    const when = update.checkedAt === undefined ? "" : `Checked ${new Date(update.checkedAt).toLocaleString()}.`;
    const how: Record<typeof update.method, string> = {
        install: "Updates download by themselves and install when the app restarts.",
        download: "This Mac build isn't signed by Apple, so updates can't install themselves: the app downloads the new disk image, then quits and opens it. Drag the app over the old one, then open it again.",
        page: "Install updates the way you installed this app.",
        source: "Run from source: git pull updates it.",
    };
    let status = "Not checked yet";
    let label = "";

    switch (update.status) {
        case "checking":
            status = "Checking…";
            break;
        case "current":
            status = update.method === "source" ? `Run from source (${next.appVersion})` : `Up to date (${next.appVersion})`;
            break;
        case "available":
            status = `Pi Pocket ${update.version ?? ""} is available`;
            label = update.method === "download" ? "Download" : update.method === "page" ? "Open release" : "";
            break;
        case "downloading":
            status = `Downloading ${update.version ?? ""}… ${update.percent ?? 0}%`;
            break;
        case "ready":
            status = update.method === "install" ? `Pi Pocket ${update.version ?? ""} is ready` : `Pi Pocket ${update.version ?? ""} is downloaded`;
            label = update.method === "install" ? "Restart now" : "Quit and open";
            break;
        case "error":
            status = "The check failed";
            break;
        default:
            break;
    }

    element("update-status").textContent = status;
    element("update-detail").textContent =
        update.status === "error" ? `${update.message ?? ""} ${when}`.trim() : `${how[update.method]} ${when}`.trim();
    action.hidden = label === "";
    action.textContent = label;
    check.disabled = busy;
}

element("update-check").addEventListener("click", () => {
    void gui.checkUpdates();
});

element("update-action").addEventListener("click", () => {
    void gui.updateAction();
});

/** Pi Pocket's colors, as its page shows them: this screen looks like the Pi Pocket it opens. */
function renderTheme(next: ConfigState): void {
    const root = document.documentElement;

    for (const [token, value] of Object.entries(next.theme.colors)) {
        root.style.setProperty(`--${token}`, value);
    }

    root.dataset.mode = next.theme.mode;
    root.dataset.ready = "";
}

// ——— This computer's Pi Pocket ———

const ACCESS_NOTES: Record<string, string> = {
    local: "Only this computer. Share sessions with a phone through Tailscale or a Cloudflare link instead.",
    lan: "Phones and computers on the same Wi-Fi. Anyone on it can reach the sign-in page.",
    tailscale: "Your devices on Tailscale, wherever they are. Needs Tailscale running on this computer.",
    cloudflare: "A public https link through Cloudflare, for a phone anywhere. Pi Pocket downloads cloudflared once.",
};

const LOCAL_LABELS: Record<LocalState["status"], { pill: string; state: string }> = {
    absent: { pill: "Not installed", state: "other" },
    installing: { pill: "Installing…", state: "checking" },
    stopped: { pill: "Stopped", state: "other" },
    starting: { pill: "Starting…", state: "checking" },
    running: { pill: "Running", state: "connected" },
    external: { pill: "Already running", state: "detected" },
    stopping: { pill: "Stopping…", state: "checking" },
    failed: { pill: "Stopped", state: "not-detected" },
};

function renderLocal(next: ConfigState): void {
    const local = next.local;
    const isLocal = next.settings.server.mode === "local";

    for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="where"]')) {
        radio.checked = radio.value === next.settings.server.mode;
    }

    element("local-card").hidden = !isLocal;
    element("remote-card").hidden = isLocal;
    element("get-card").hidden = isLocal;

    const label = LOCAL_LABELS[local.status];
    const pill = element("local-status");

    pill.textContent = label.pill;
    pill.dataset.state = label.state;

    const versions = local.installed === undefined ? "" : `Pi Pocket ${local.installed.pocket}, Node.js ${local.installed.node}.`;
    const detail: Record<LocalState["status"], string> = {
        absent: "Pi Pocket runs on this computer while the app runs, also hidden in the tray. Install downloads it and the Node.js it needs (about 60 MB, 400 MB on disk), from npm and nodejs.org.",
        installing: local.message ?? "Installing…",
        stopped: `${versions} It starts with the app.`,
        starting: `${versions} Starting…`,
        running: `${versions} Open at ${local.url ?? ""}. It stops when you quit the app; running sessions pick up at the next start.`,
        external: `${local.message ?? "Pi Pocket already runs at this port."} Open it, or stop it and start this computer's own.`,
        stopping: "Stopping…",
        failed: local.message ?? "Pi Pocket stopped.",
    };

    element("local-detail").textContent = detail[local.status];

    const bar = element("local-progress");
    const percent = local.progress?.percent;

    bar.hidden = local.status !== "installing";
    (bar.firstElementChild as HTMLElement).style.width = percent === undefined ? "100%" : `${String(percent)}%`;
    bar.classList.toggle("indeterminate", percent === undefined);

    const show = (action: string, visible: boolean) => {
        for (const button of document.querySelectorAll<HTMLButtonElement>(`.actions [data-local="${action}"]`)) {
            button.hidden = !visible;
        }
    };
    const installed = local.installed !== undefined;

    show("install", local.status === "absent" || (local.status === "failed" && !installed));
    show("start", installed && (local.status === "stopped" || local.status === "failed"));
    show("open", local.status === "external");
    show("restart", local.status === "running");
    show("stop", local.status === "running" || local.status === "starting");
    element("local-uninstall-row").hidden = !installed || local.status === "installing" || local.status === "stopping";
    element("local-show").hidden = !(local.status === "running" && next.connectedUrl !== undefined);
    element("local-restart-row").hidden = !local.restartNeeded;

    element<HTMLInputElement>("local-folder").placeholder = local.defaults.folder;
    element<HTMLInputElement>("local-data").placeholder = local.defaults.data;
    element("access-note").textContent = ACCESS_NOTES[next.settings.local.access] ?? "";

    const update = local.update;
    const updateStatus: Record<typeof update.status, string> = {
        idle: "Not checked yet",
        checking: "Checking…",
        current: "Up to date",
        building: `Installing Pi Pocket ${update.pocket ?? ""}${update.percent === undefined ? "" : ` (${String(update.percent)}%)`}…`,
        ready: `Pi Pocket ${update.pocket ?? ""} is ready`,
        error: "The update failed",
    };

    element("local-update-status").textContent = updateStatus[update.status];
    element("local-update-detail").textContent =
        update.status === "error"
            ? update.message ?? ""
            : update.status === "ready"
              ? "It takes over when Pi Pocket restarts: Restart above, the tray, or the next start of the app."
              : update.checkedAt === undefined
                ? ""
                : `Checked ${new Date(update.checkedAt).toLocaleString()}.`;
    element<HTMLButtonElement>("local-update-check").disabled =
        !installed || update.status === "checking" || update.status === "building" || local.status === "installing";

    const log = element("local-log");
    const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;

    log.textContent = local.log.join("\n");

    if (atBottom) {
        log.scrollTop = log.scrollHeight;
    }

    element("local-log-box").hidden = local.log.length === 0;

    if (local.status === "failed") {
        (element("local-log-box") as HTMLDetailsElement).open = true;
    }
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-local]")) {
    button.addEventListener("click", () => {
        void gui.local(button.dataset.local as LocalAction);
    });
}

element("local-show").addEventListener("click", () => {
    void gui.back();
});

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="where"]')) {
    radio.addEventListener("change", () => {
        if (radio.checked) {
            void gui.local(radio.value === "local" ? "use-local" : "use-remote");
        }
    });
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-choose]")) {
    button.addEventListener("click", () => {
        const input = element<HTMLInputElement>(button.dataset.choose ?? "");

        void gui.chooseFolder(input.value || input.placeholder).then((folder) => {
            if (folder !== undefined) {
                input.value = folder;
                scheduleSave();
            }
        });
    });
}

function render(next: ConfigState): void {
    state = next;
    renderTheme(next);
    document.body.classList.toggle("recovering", next.recovery);
    element("recovery").hidden = !next.recovery;
    element("settings-page").hidden = next.recovery;
    element("settings-shortcut").textContent = `Return to Server settings any time with ${next.platform === "darwin" ? "⌘," : "Ctrl+,"}, the tray menu, or a right-click on the page.`;
    renderLocal(next);
    renderDictation(next);
    renderBillionContext(next);
    element("app-version").textContent = next.appVersion;
    renderUpdate(next);
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

    if (connectedHere(next)) {
        showConnected(next);
    } else if (!editing || (next.probe !== undefined && sameUrl(next.probe.url, typedUrl()))) {
        showStatus(next.probe);
    }

    updateConnect();

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

// ——— Connection actions ———

async function check(): Promise<ProbeResult | undefined> {
    const url = typedUrl();

    if (url === "") {
        urlError.hidden = false;
        urlError.textContent = "Type the server's address.";

        return undefined;
    }

    const seq = ++checkSeq;

    checking = seq;
    showStatus(undefined);
    updateConnect();

    let result: ProbeResult;

    try {
        result = await gui.probe(url);
    } catch (error) {
        result = { kind: "unreachable", url, message: String(error) };
    }

    if (checking === seq) {
        checking = undefined;
    }

    // Editing while a request was in flight cancels that result, including a submit waiting to connect to it.
    if (seq !== checkSeq || url !== typedUrl()) {
        updateConnect();

        return undefined;
    }

    checked = result;
    checkedInput = url;
    showStatus(result);
    updateConnect();

    if (result.kind === "invalid") {
        urlError.hidden = false;
        urlError.textContent = result.message;
    }

    return result;
}

element("test").addEventListener("click", () => {
    void check();
});

element<HTMLFormElement>("connect-form").addEventListener("submit", (event) => {
    event.preventDefault();

    if (connectButton.disabled) {
        return;
    }

    void (async () => {
        // An unknown HTML page needs a separate, explicit click after Check, not an automatic fallback.
        const previous = checkedHere();
        const allowUnverified = previous?.kind === "other" && previous.canOpen;
        const result = await check();

        if (result === undefined || (result.kind !== "detected" && !(allowUnverified && result.kind === "other" && result.canOpen))) {
            return;
        }

        connecting = true;
        updateConnect();

        try {
            const found = await gui.connect(result.url, allowUnverified);

            checked = found;
            checkedInput = typedUrl();

            if (found.kind === "detected" || (allowUnverified && found.kind === "other" && found.canOpen)) {
                editing = false;
            }

            render(await gui.state());

            if (found.kind !== "detected") {
                showStatus(found);
            }
        } catch (error) {
            urlError.hidden = false;
            urlError.textContent = `Could not connect: ${String(error)}`;
        } finally {
            connecting = false;
            updateConnect();
        }
    })();
});

retry.addEventListener("click", () => {
    void gui.retryNow();
});

back.addEventListener("click", () => {
    void gui.back();
});

element("server-settings").addEventListener("click", () => {
    void gui.openSettings();
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

    renderAppearance(next);
    renderTitleBar(next);

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
        } else if (input instanceof HTMLInputElement && (input.type === "number" || input.type === "range")) {
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

/** The title bar: a change takes a new window. Seamless on Windows and Linux has no menu bar to show. */
function renderTitleBar(next: ConfigState): void {
    const chosen = next.settings.window.titleBar;

    element("title-bar-restart").hidden = chosen === next.titleBarAtStart;
    element("menu-bar-row").hidden = next.platform === "darwin" || next.titleBarAtStart === "seamless";
    element("title-bar-note").textContent =
        next.platform === "darwin"
            ? "Seamless: Pi Pocket runs to the window's top edge, under the traffic lights."
            : "Seamless: Pi Pocket runs to the window's top edge, under the window's buttons. The menu bar's keys still work (Ctrl+, opens these settings).";
}

/** The Appearance card: what this desktop can do, and the config screen itself see-through like the server's page. */
function renderAppearance(next: ConfigState): void {
    const appearance = next.settings.appearance;
    const support = next.translucency;
    const toggle = document.querySelector<HTMLInputElement>('[data-key="appearance.translucent"]')!;
    const note = element("translucent-note");

    for (const row of document.querySelectorAll<HTMLElement>("[data-platform]")) {
        row.hidden = row.dataset.platform !== next.platform;
    }

    if (support.kind === "unsupported") {
        note.textContent = support.message;
        toggle.disabled = true;
    } else {
        toggle.disabled = false;
        note.textContent =
            next.platform === "linux"
                ? "The desktop shows through Pi Pocket's background. Your compositor blurs it if set to (Hyprland's decoration:blur, KDE's Blur effect); GNOME shows it unblurred."
                : "The desktop shows through Pi Pocket's background, blurred.";
    }

    // Linux: on takes a new window; off works now, but the window stays see-through-capable until a restart.
    element("translucent-restart").hidden = !(next.platform === "linux" && appearance.translucent !== next.translucentAtStart);

    const live = appearance.translucent && support.kind === "live";

    for (const row of element("appearance-card").querySelectorAll<HTMLElement>(".row")) {
        // The tray menu is its own setting: it stays usable while translucency is off.
        if (row.contains(toggle) || row.id === "translucent-restart" || row.id === "tray-menu-row") {
            continue;
        }

        row.classList.toggle("off", !appearance.translucent);
    }

    showOpacity(appearance.opacity);
    document.documentElement.dataset.translucent = live ? "on" : "off";
}

function showOpacity(value: number): void {
    element("opacity-value").textContent = `${String(value)}%`;
    document.documentElement.style.setProperty("--opacity", `${String(value)}%`);
}

for (const input of settingInputs) {
    input.addEventListener("change", scheduleSave);
}

// The opacity follows the slider as it moves; the save waits for the slider to settle.
const opacity = document.querySelector<HTMLInputElement>('[data-key="appearance.opacity"]')!;

opacity.addEventListener("input", () => {
    showOpacity(Number(opacity.value));
    scheduleSave();
});

for (const button of document.querySelectorAll("[data-relaunch]")) {
    button.addEventListener("click", () => {
        void gui.relaunch();
    });
}

element<HTMLFormElement>("settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
});

// ——— Dictation ———

function formatSize(bytes: number): string {
    return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${String(Math.max(1, Math.round(bytes / 1e6)))} MB`;
}

/** Runs a dictation action; a failure shows in the card. */
function dictationAction(type: "download" | "cancel" | "remove" | "use", id: string): void {
    gui.dictation({ type, id }).catch((error: unknown) => {
        const message = element("dictation-message");

        message.textContent = (error as Error).message;
        message.hidden = false;
    });
}

function modelRow(model: DictationModelState, busy: boolean): HTMLElement {
    const row = document.createElement("div");
    const text = document.createElement("span");
    const name = document.createElement("strong");
    const about = document.createElement("small");
    const buttons = document.createElement("span");

    row.className = "row model";
    row.dataset.chosen = String(model.chosen);
    name.textContent = model.name;

    if (model.recommended) {
        const tag = document.createElement("em");

        tag.textContent = "Recommended";
        name.append(" ", tag);
    }

    if (model.chosen) {
        const tag = document.createElement("em");

        tag.className = "in-use";
        tag.textContent = "In use";
        name.append(" ", tag);
    }

    about.textContent = `${model.languages} · ${formatSize(model.size)} · ${model.note} ${model.license}.`;
    text.append(name, about);
    buttons.className = "buttons";

    const button = (label: string, type: "download" | "cancel" | "remove" | "use", kind = "secondary"): void => {
        const each = document.createElement("button");

        each.type = "button";
        each.className = kind;
        each.textContent = label;
        each.addEventListener("click", () => {
            if (type === "remove" && !confirm(`Remove ${model.name}? It can be downloaded again.`)) {
                return;
            }

            dictationAction(type, model.id);
        });
        buttons.append(each);
    };

    if (model.download !== undefined) {
        const progress = document.createElement("span");
        const bar = document.createElement("div");
        const fill = document.createElement("div");
        const step = document.createElement("small");

        progress.className = "model-progress";
        bar.className = "progress";
        fill.style.width = `${String(model.download.percent)}%`;
        bar.append(fill);
        step.textContent = `${model.download.step} ${String(model.download.percent)}%`;
        progress.append(bar, step);
        text.append(progress);
        button("Cancel", "cancel");
    } else if (model.installed) {
        if (!model.chosen) {
            button("Use", "use");
        }

        button("Remove", "remove", "secondary danger");

        // Removing waits for a download: they share the engine.
        for (const each of buttons.querySelectorAll("button")) {
            each.disabled = busy;
        }
    } else {
        button("Download", "download");
        buttons.querySelector("button")!.disabled = busy;
    }

    row.append(text, buttons);

    return row;
}

function renderDictation(next: ConfigState): void {
    const dictation = next.dictation;
    const card = element("dictation-card");
    const list = element("dictation-models");
    const message = element("dictation-message");

    element("dictation-engine-size").textContent = dictation.engine.installed ? "installed" : `${formatSize(dictation.engine.size)}`;
    element("dictation-folder").textContent = dictation.folder;
    message.hidden = dictation.message === undefined;
    message.textContent = dictation.message ?? "";

    if (!dictation.supported) {
        element("dictation-note").textContent = "Dictation has no speech engine for this computer's system and processor.";
        list.replaceChildren();
        card.querySelectorAll<HTMLElement>(".row").forEach((row) => row.classList.add("off"));

        return;
    }

    list.replaceChildren(...dictation.models.map((model) => modelRow(model, dictation.downloading)));
}

element("dictation-show-folder").addEventListener("click", () => {
    void gui.showDictationFolder();
});

gui.onFocus((section) => {
    if (section === "dictation") {
        const card = element<HTMLDetailsElement>("dictation-card");

        card.open = true;
        card.scrollIntoView({ behavior: "smooth", block: "start" });
    }
});

// ——— Billion-context Pi ———

function billionContextAction(action: BillionContextAction): void {
    gui.billionContext(action).catch(() => {
        // The error shows in the card, through the state.
    });
}

function renderBillionContext(next: ConfigState): void {
    const extension = next.billionContext;
    const remote = extension.server === "remote";
    const installed = extension.installed;
    const busy = extension.busy !== undefined;
    const running = extension.server === "running";
    const message = element("bc-message");
    const shown = (id: string, visible: boolean): void => {
        const button = element<HTMLButtonElement>(id);

        button.hidden = !visible;
        button.disabled = busy;
    };

    element("bc-local").hidden = remote;
    element("bc-remote").hidden = !remote;
    element("bc-command").textContent = extension.command;
    element("bc-folder").textContent = extension.folder;
    message.hidden = extension.message === undefined;
    message.textContent = extension.message ?? "";

    const latest = extension.latest?.version === undefined ? "" : ` ${extension.latest.version}`;
    const checked = extension.checkedAt === undefined ? "" : ` Checked ${new Date(extension.checkedAt).toLocaleString()}.`;
    let status: string;
    let detail: string;

    if (installed === undefined) {
        status = extension.foreign ? "Installed outside the app" : "Not installed";
        detail = extension.foreign
            ? "Its folder is in Pi Pocket's extensions folder under another name. Manage it in Pi Pocket's Menu → Extensions, or remove that copy to let the app install it."
            : extension.server === "absent"
              ? "Install Pi Pocket on this computer first (above)."
              : extension.server === "stopped"
                ? "Start Pi Pocket first: the app turns the extension on through it."
                : "Install downloads it from GitHub (about 1 MB, 4 MB on disk) and turns it on.";
    } else {
        const state = installed.error !== undefined ? "failed to load" : installed.enabled === true ? "on" : installed.enabled === false ? "off" : "";

        status = `billion-context-pi ${installed.version}${state === "" ? "" : `, ${state}`}`;
        detail = installed.error ?? (
            installed.commit === undefined
                ? "Installed outside the app: it does not update it."
                : extension.updateAvailable
                  ? `A newer version${latest} is out.${checked}`
                  : extension.checkedAt === undefined
                    ? ""
                    : `Up to date.${checked}`
        );

        if (!running) {
            detail = `${detail} Start Pi Pocket to turn it on or off.`.trim();
        }
    }

    element("bc-status").textContent = extension.busy ?? status;
    element("bc-detail").textContent = detail;
    shown("bc-install", installed === undefined && !extension.foreign && running);
    shown("bc-update", installed?.commit !== undefined && extension.updateAvailable && running);
    shown("bc-enable", installed !== undefined && installed.enabled === false && running);
    shown("bc-disable", installed !== undefined && installed.enabled === true && running);
    shown("bc-check", installed?.commit !== undefined);
    shown("bc-uninstall", installed !== undefined);
    element("bc-auto-row").classList.toggle("off", installed?.commit === undefined);
}

for (const [id, action] of [
    ["bc-install", "install"],
    ["bc-update", "update"],
    ["bc-enable", "enable"],
    ["bc-disable", "disable"],
    ["bc-check", "check"],
    ["bc-uninstall", "uninstall"],
    ["bc-show-folder", "show-folder"],
] as const) {
    element(id).addEventListener("click", () => billionContextAction(action));
}

element("bc-page").addEventListener("click", (event) => {
    event.preventDefault();
    billionContextAction("open-page");
});

// ——— Start ———

gui.onState(render);
void gui.state().then(render);
