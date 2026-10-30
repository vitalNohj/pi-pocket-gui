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
    connect: (url: string) => ipcRenderer.invoke("config:connect", url) as Promise<void>,
    back: () => ipcRenderer.invoke("config:back") as Promise<void>,
    retryNow: () => ipcRenderer.invoke("config:retry") as Promise<void>,
    openExternal: (target) => ipcRenderer.invoke("config:open-external", target) as Promise<void>,
    showConfigFile: () => ipcRenderer.invoke("config:show-file") as Promise<void>,
    checkUpdates: () => ipcRenderer.invoke("config:check-updates") as Promise<void>,
    updateAction: () => ipcRenderer.invoke("config:update-action") as Promise<void>,
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
