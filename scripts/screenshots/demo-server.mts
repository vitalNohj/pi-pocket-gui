/**
 * A Pi Pocket with made-up people, folders, and sessions, for the README's screenshots. Nothing in it is real: a
 * scripted model answers, in demo projects under $HOME (set HOME to an empty folder). It runs Pi Pocket's own test
 * helpers, so point it at a checkout:
 *
 *   HOME=/tmp/pp-demo/home PI_POCKET_SRC=~/pi-pocket node scripts/screenshots/demo-server.ts [port] [host]
 *
 * It prints the owner's sign-in link as JSON on its first line ({"login": …}), then stays up until stopped.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const source = resolve(process.env.PI_POCKET_SRC ?? "../pi-pocket");
const home = process.env.HOME ?? "";
const port = Number(process.argv[2] ?? 8898);
const host = process.argv[3] ?? "127.0.0.3";
const load = (path: string) => import(pathToFileURL(join(source, path)).href);

// The helpers first: they point Pi's own folder at a temporary one before anything else loads.
const helpers = await load("test/helpers.ts");
const { fauxAssistantMessage, fauxProvider, fauxText, fauxThinking, fauxToolCall } = await import(
    pathToFileURL(join(source, "node_modules/@earendil-works/pi-ai/dist/providers/faux.js")).href
);
const { createHandler } = await load("src/server/http.ts");

// ——— Demo projects ———

const code = join(home, "code");
const api = join(code, "aurora-api");

function files(root: string, entries: Record<string, string>): void {
    for (const [path, text] of Object.entries(entries)) {
        mkdirSync(join(root, path, ".."), { recursive: true });
        writeFileSync(join(root, path), text);
    }
}

files(api, {
    "package.json": JSON.stringify({ name: "aurora-api", type: "module", scripts: { test: "node --test" } }, null, 2),
    "src/routes/login.js": `import { checkPassword, startSession } from "../auth.js";

export async function login(request, reply) {
    const { email, password } = request.body;
    const user = await checkPassword(email, password);

    if (!user) {
        return reply.code(401).send({ error: "Wrong email or password" });
    }

    return reply.send(await startSession(user));
}
`,
    "src/auth.js": "export async function checkPassword() {}\nexport async function startSession() {}\n",
    "test/rate-limit.test.js": `import assert from "node:assert/strict";
import { test } from "node:test";
import { rateLimit } from "../src/middleware/rate-limit.js";

test("the sixth try in a minute is refused", () => {
    const limit = rateLimit({ tries: 5, perMs: 60_000 });
    const results = Array.from({ length: 6 }, () => limit("10.0.0.7", 0));

    assert.deepEqual(results, [true, true, true, true, true, false]);
});

test("each address has its own count", () => {
    const limit = rateLimit({ tries: 1, perMs: 60_000 });

    assert.equal(limit("10.0.0.7", 0), true);
    assert.equal(limit("10.0.0.8", 0), true);
});

test("the window moves on", () => {
    const limit = rateLimit({ tries: 1, perMs: 60_000 });

    assert.equal(limit("10.0.0.7", 0), true);
    assert.equal(limit("10.0.0.7", 61_000), true);
});
`,
});

for (const folder of ["pocket-site", "checkout-service", "infra", "mobile-app"]) {
    files(join(code, folder), { "README.md": `# ${folder}\n` });
}

// ——— The scripted model ———

const MIDDLEWARE = `/** At most \`tries\` attempts per address in any \`perMs\` window. */
export function rateLimit({ tries, perMs }) {
    const seen = new Map();

    return (address, now = Date.now()) => {
        const recent = (seen.get(address) ?? []).filter((at) => now - at < perMs);

        recent.push(now);
        seen.set(address, recent);

        return recent.length <= tries;
    };
}
`;

type Message = { role: string; content: unknown };

/** The main session's run: read, write, edit, test, then the summary. Other sessions get one short answer. */
function route(request: { messages: Message[] }) {
    const messages = request.messages.filter((message) => message.role !== "system");
    const lastUser = messages.findLastIndex((message) => message.role === "user");
    const step = messages.slice(lastUser).filter((message) => message.role === "toolResult").length;
    const asked = JSON.stringify(messages[lastUser]?.content ?? "");
    const tool = (name: string, args: Record<string, unknown>, ...before: unknown[]) =>
        fauxAssistantMessage([...before, fauxToolCall(name, args)], { stopReason: "toolUse" });

    if (!asked.includes("rate limit")) {
        return fauxAssistantMessage([fauxText(REPLIES.find(([key]) => asked.includes(key))?.[1] ?? "On it.")]);
    }

    switch (step) {
        case 0:
            return tool(
                "read",
                { path: "src/routes/login.js" },
                fauxThinking(
                    "The login route has no limit at all. A small in-memory sliding window per IP is enough for one instance; " +
                        "a shared store can come later if the API runs on several machines.",
                ),
                fauxText("Let me look at the route first."),
            );
        case 1:
            return tool("write", { path: "src/middleware/rate-limit.js", content: MIDDLEWARE });
        case 2:
            return tool("edit", {
                path: "src/routes/login.js",
                edits: [
                    {
                        oldText: 'import { checkPassword, startSession } from "../auth.js";\n',
                        newText:
                            'import { checkPassword, startSession } from "../auth.js";\nimport { rateLimit } from "../middleware/rate-limit.js";\n\nconst limited = rateLimit({ tries: 5, perMs: 60_000 });\n',
                    },
                    {
                        oldText: "    const { email, password } = request.body;\n",
                        newText:
                            '    if (!limited(request.ip)) {\n        return reply.code(429).header("Retry-After", "60").send({ error: "Too many tries. Wait a minute." });\n    }\n\n    const { email, password } = request.body;\n',
                    },
                ],
            });
        case 3:
            return tool("bash", { command: "node --test 2>&1 | tail -8" });
        default:
            return fauxAssistantMessage([
                fauxText(
                    "Done. The login route now allows **5 tries a minute per IP address**.\n\n" +
                        "- `src/middleware/rate-limit.js`: a sliding window kept in memory, one list of times per address.\n" +
                        "- `src/routes/login.js`: the 6th try gets **429 Too Many Requests** with `Retry-After: 60`.\n\n" +
                        "All 3 tests pass. The counts live in this process only: if the API runs on more than one machine, " +
                        "move them to Redis so every instance shares them. Should I do that next?",
                ),
            ]);
    }
}

const REPLIES: [string, string][] = [
    ["flaky", "The checkout test waited on a fixed 200 ms timer. It now waits for the order event instead: 50 runs, 0 failures."],
    ["Postgres", "The migration plan is in `docs/postgres-17.md`: dump, restore on a replica, switch reads, then writes."],
    ["landing", "Three headline options are in the artifact. I'd pick the second: it says what the app does in five words."],
    ["dependencies", "12 packages updated. Two needed code changes; both are in the diff, and the tests pass."],
    ["crash", "The crash comes from a null session after sign-out. Fixed, with a test that signs out mid-request."],
];

const model = fauxProvider({
    tokensPerSecond: 4000,
    models: [{ id: "sonnet-4-5", name: "Claude Sonnet 4.5", reasoning: true, contextWindow: 200_000 }],
});

model.setResponses(Array.from({ length: 400 }, () => route as never));

// ——— The app and its people ———

const app = await helpers.openApp(model);
const owner = helpers.owner(app);

app.config.updateUser(owner.id, { name: "Maya Chen" });
app.config.lastModel = { provider: "faux", modelId: "sonnet-4-5", thinkingLevel: "medium" };
app.config.addUser("Sam Ortiz", "guest");

async function session(cwd: string, title: string, message: string, cost: number): Promise<number> {
    const { id } = await app.commands.createSession(owner, { cwd: join(code, cwd), title });

    await app.commands.configure(id, owner, { model: { provider: "faux", modelId: "sonnet-4-5" }, thinkingLevel: "medium" });
    await helpers.say(app, id, message);
    await helpers.recordCost(app, id, cost);

    return id;
}

// Oldest first: the last one made is at the top of the list.
const made: Record<string, number> = {};

made.deps = await session("infra", "Weekly dependency bumps", "Bump the dependencies", 0.38);
made.postgres = await session("infra", "Migrate to Postgres 17", "Plan the Postgres 17 migration", 0.91);
made.crash = await session("mobile-app", "Crash after sign-out", "Find the crash after sign-out", 0.57);
made.landing = await session("pocket-site", "Landing page copy", "Write the landing page headline", 0.22);
made.flaky = await session("checkout-service", "Fix flaky checkout test", "Fix the flaky checkout test", 0.64);
made.main = await session("aurora-api", "Rate limiting for login", "Add rate limiting to the login route: 5 tries a minute per IP.", 0.47);

const server = createServer(createHandler({ app, listen: { host, port }, restart: () => {} }));

await new Promise<void>((done) => server.listen(port, host, done));

console.log(
    JSON.stringify({
        login: `http://${host}:${port}/login?token=${encodeURIComponent(app.config.ownerToken)}`,
        base: `http://${host}:${port}`,
        sessions: made,
    }),
);

const stop = async () => {
    server.closeAllConnections();
    server.close();
    await app.close();
    helpers.cleanUp();
    process.exit(0);
};

process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
