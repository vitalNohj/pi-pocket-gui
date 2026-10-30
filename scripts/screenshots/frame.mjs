// Frames the raw screenshots for the README (frame.html), with a headless Chromium over the DevTools protocol.
//   CHROME=/path/to/chrome node scripts/screenshots/frame.mjs <raw-folder> <out-folder>
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [raw, out] = process.argv.slice(2).map((each) => resolve(each));
const chrome = process.env.CHROME ?? "chromium";
const page = pathToFileURL(resolve(import.meta.dirname, "frame.html")).href;
const WALLPAPER = "radial-gradient(circle at 20% 15%, #f7a072 0, transparent 45%), radial-gradient(circle at 85% 30%, #7aa2f7 0, transparent 50%), radial-gradient(circle at 50% 100%, #bb9af7 0, transparent 55%), #1a1b26";
const GROUND = "linear-gradient(140deg, #24283b 0%, #3b4261 55%, #565f89 100%)";
const LIGHT = "linear-gradient(140deg, #dce0e8 0%, #c6d0f5 60%, #e6e9ef 100%)";

const shots = [
    { name: "hero", shot: "mac-solid.png", style: "mac", ground: GROUND },
    { name: "see-through", shot: "mac-clear.png", style: "mac", ground: WALLPAPER, clear: "1" },
    { name: "light", shot: "mac-light.png", style: "mac", ground: LIGHT },
    { name: "windows", shot: "win-solid.png", style: "win", ground: GROUND },
    { name: "settings", shot: "settings.png", style: "mac", ground: GROUND },
];

const profile = mkdtempSync(join(tmpdir(), "frame-"));
const browser = spawn(chrome, [
    "--headless=new",
    "--remote-debugging-port=9335",
    `--user-data-dir=${profile}`,
    "--allow-file-access-from-files",
    
    "--hide-scrollbars",
    "about:blank",
]);

let targets;

for (let tries = 0; tries < 50 && targets === undefined; tries++) {
    await new Promise((done) => setTimeout(done, 200));
    targets = await fetch("http://127.0.0.1:9335/json/list").then((response) => response.json(), () => undefined);
}

const socket = new WebSocket(targets.find((each) => each.type === "page").webSocketDebuggerUrl);
const pending = new Map();
let id = 0;

socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));

    pending.get(message.id)?.(message.result);
});
await new Promise((done) => socket.addEventListener("open", done));

const send = (method, params = {}) =>
    new Promise((done) => {
        pending.set(++id, done);
        socket.send(JSON.stringify({ id, method, params }));
    });

await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1100, deviceScaleFactor: Number(process.env.SCALE ?? 1), mobile: false });
await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });

for (const each of shots) {
    const query = new URLSearchParams({ shot: pathToFileURL(join(raw, each.shot)).href, style: each.style, ground: each.ground, ...(each.clear ? { clear: each.clear } : {}) });

    await send("Page.navigate", { url: `${page}?${query}` });

    for (let tries = 0; tries < 50; tries++) {
        const ready = await send("Runtime.evaluate", { expression: "document.body?.dataset.ready === '1'", returnByValue: true });

        if (ready.result.value === true) {
            break;
        }

        await new Promise((done) => setTimeout(done, 100));
    }

    const box = await send("Runtime.evaluate", {
        expression: "JSON.stringify(document.getElementById('stage').getBoundingClientRect())",
        returnByValue: true,
    });
    const { x, y, width, height } = JSON.parse(box.result.value);
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { x, y, width, height, scale: 1 } });

    writeFileSync(join(out, `${each.name}.png`), Buffer.from(shot.data, "base64"));
    console.log(join(out, `${each.name}.png`));
}

socket.close();
browser.kill();
