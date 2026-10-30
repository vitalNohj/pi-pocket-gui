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
        capabilities: ["menu", "badge", "notify", "visibility", "pinned", "open"],
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
        // One listener: the page's `web/host.js` passes each event on to its own.
        subscribe: (next: unknown) => {
            listener = typeof next === "function" ? (next as (event: HostEvent) => void) : undefined;
        },
    });

    watchTheme();
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
