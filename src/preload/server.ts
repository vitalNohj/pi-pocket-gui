/**
 * The server page's preload: `window.pocketHost`, the host bridge Pi Pocket's web app uses (docs/desktop.md there).
 * The main process says first whether this frame may have it: only the main window's top frame, on the configured
 * server's origin. Anywhere else (a sign-in page in front of the server, another window) the page gets nothing.
 */
import { contextBridge, ipcRenderer } from "electron";
import type { HostEvent, HostHello } from "../shared/types";

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
}
