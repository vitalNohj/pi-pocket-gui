// Drives a running dev build over the DevTools protocol: list pages, screenshot one, or evaluate in it.
//   node scripts/dev/cdp.mjs list
//   node scripts/dev/cdp.mjs shot <url-substring> <out.png> [scale]
//   node scripts/dev/cdp.mjs eval <url-substring> '<expression>'
// Start the app with --remote-debugging-port=9333 --remote-allow-origins=* first (development only).
const port = process.env.CDP_PORT ?? "9333";
const [command, match, arg] = process.argv.slice(2);
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();

if (command === "list") {
    for (const target of targets) {
        console.log(target.type, target.url, "|", target.title);
    }
    process.exit(0);
}

const target = targets.find((each) => each.type === "page" && each.url.includes(match ?? ""));

if (target === undefined) {
    console.error(`no page matches ${match}`);
    process.exit(1);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();

socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));

    pending.get(message.id)?.(message);
});

await new Promise((done) => socket.addEventListener("open", done));

function send(method, params = {}) {
    const callId = ++id;

    socket.send(JSON.stringify({ id: callId, method, params }));

    return new Promise((done) => pending.set(callId, done));
}

if (command === "shot") {
    // An optional scale (a 4th argument, e.g. 0.5) gives a smaller copy, for a quick look.
    const scale = Number(process.argv[5] ?? 1);
    const metrics = (await send("Page.getLayoutMetrics")).result.cssVisualViewport;
    // CDP_CLEAR=1: what the page leaves see-through stays so in the PNG (for the see-through background).
    if (process.env.CDP_CLEAR === "1") {
        await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    }

    const result = await send("Page.captureScreenshot", {
        format: "png",
        ...(scale === 1 ? {} : { clip: { x: 0, y: 0, width: metrics.clientWidth, height: metrics.clientHeight, scale } }),
    });
    const { writeFileSync } = await import("node:fs");

    writeFileSync(arg, Buffer.from(result.result.data, "base64"));
    console.log(arg);
} else if (command === "eval") {
    const result = await send("Runtime.evaluate", { expression: arg, awaitPromise: true, returnByValue: true });

    console.log(JSON.stringify(result.result?.result?.value ?? result.result ?? result.error, null, 2));
}

socket.close();
