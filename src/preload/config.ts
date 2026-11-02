/**
 * The config page's preload: `window.gui`, the few calls the config screen makes to the main process. It runs only in
 * the app's own config page (pocket-gui://app), never on the server's page, and the main process checks the sender
 * of every call as well.
 */
import { contextBridge, ipcRenderer } from "electron";
import type { ConfigState, GuiConfigApi, ProbeResult, Settings } from "../shared/types";

const api: GuiConfigApi = {
    state: () => ipcRenderer.invoke("config:state") as Promise<ConfigState>,
    probe: (url: string) => ipcRenderer.invoke("config:probe", url) as Promise<ProbeResult>,
    save: (settings: Settings) => ipcRenderer.invoke("config:save", settings) as Promise<ConfigState>,
    connect: (url, allowUnverified = false) => ipcRenderer.invoke("config:connect", url, allowUnverified) as Promise<ProbeResult>,
    openSettings: () => ipcRenderer.invoke("config:open-settings") as Promise<void>,
    back: () => ipcRenderer.invoke("config:back") as Promise<void>,
    retryNow: () => ipcRenderer.invoke("config:retry") as Promise<void>,
    openExternal: (target) => ipcRenderer.invoke("config:open-external", target) as Promise<void>,
    showConfigFile: () => ipcRenderer.invoke("config:show-file") as Promise<void>,
    checkUpdates: () => ipcRenderer.invoke("config:check-updates") as Promise<void>,
    updateAction: () => ipcRenderer.invoke("config:update-action") as Promise<void>,
    relaunch: () => ipcRenderer.invoke("config:relaunch") as Promise<void>,
    local: (action) => ipcRenderer.invoke("config:local", action) as Promise<void>,
    view: (side) => ipcRenderer.invoke("config:view", side) as Promise<void>,
    chooseFolder: (start: string) => ipcRenderer.invoke("config:choose-folder", start) as Promise<string | undefined>,
    dictation: (action) => ipcRenderer.invoke("config:dictation", action) as Promise<void>,
    showDictationFolder: () => ipcRenderer.invoke("config:show-dictation-folder") as Promise<void>,
    billionContext: (action) => ipcRenderer.invoke("config:billion-context", action) as Promise<void>,
    runner: (action) => ipcRenderer.invoke("config:runner", action) as Promise<void>,
    linkRunner: (request) => ipcRenderer.invoke("config:link-runner", request) as Promise<void>,
    onFocus: (listener) => {
        const handler = (_event: unknown, section: string) => {
            listener(section);
        };

        ipcRenderer.on("config:focus", handler);

        return () => {
            ipcRenderer.removeListener("config:focus", handler);
        };
    },
    onState: (listener) => {
        const handler = (_event: unknown, state: ConfigState) => {
            listener(state);
        };

        ipcRenderer.on("config:state", handler);

        return () => {
            ipcRenderer.removeListener("config:state", handler);
        };
    },
};

contextBridge.exposeInMainWorld("gui", api);
