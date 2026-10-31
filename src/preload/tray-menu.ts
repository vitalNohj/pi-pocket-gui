/**
 * The tray menu's page (src/main/tray-popup.ts). It only reports which item was chosen; the main process checks the
 * sender and runs the action. Keyboard movement stays in the page.
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("trayMenu", {
    choose: (id: unknown) => {
        ipcRenderer.send("tray-menu:choose", id);
    },
});
