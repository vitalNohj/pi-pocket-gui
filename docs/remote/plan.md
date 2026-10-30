# Remote execution: plan and findings

Status: research done, nothing built. Written 2026-10-30, against Pi Pocket 0.26.0, Pi Durable / coding-agent 1.4.0, and
this app 0.1.5 (Electron 45.1.0).

## The goal

A Pi Pocket session whose tools run on another computer, the one this app runs on, while the agent, its model, its keys,
and the session's history stay on the server.

- The New session sheet gets a third choice beside Home and Computer: **Remote**. It lists the execution environments
  (computers) the person may use, and then their folders, served by that computer.
- If the server is not on this computer, a setting can make Remote the default.
- The agent can find out where it runs (the computer's OS, shell, folder, and what it can do).

## Chosen approach

**The runner is a mode of Pi Pocket itself, served by the server, run by this app's built-in Node.**

- Pi Pocket gets a runner mode in the same package. It is not a second server: it holds no sessions and no durable
  state, only carries out file, command, and git requests.
- The server builds that mode into one JavaScript file and serves it at a versioned address with a hash.
- The app downloads it once per server version, checks the hash, caches it, and starts it as a child process with
  `ELECTRON_RUN_AS_NODE=1`. Electron 45 has Node 24.22.1 (Pi Pocket needs 22.19 or newer) and a built-in `WebSocket`.
- The runner dials out to the server and keeps one WebSocket open. The server sends requests down it ("run this",
  "read this"); answers and streamed output come back the same way. No port is opened on this computer. Behind a proxy
  that blocks WebSockets, the fallback is a long-lived HTTP stream down and plain POSTs up, as Pi Pocket's live updates
  already work.
- On the server, the runner plugs in as Pi Durable's `ExecutionEnv` (the interface the tools already use). No second
  file interface.

Why this over a separate runner program: one codebase, so git, folder checks, local-server discovery, and Pi's tool code
are reused, not written twice; the versions always match; a server's local changes come along; no Node install needed.

## Issues

### Added by this approach

1. **The server decides what runs on this computer.** A compromised server could ship a runner without folder limits.
   Either the server is fully trusted, or a small fixed safety layer in the app checks every request before the
   downloaded code acts on it.
2. **Bundling.** Pi Pocket is not built as one file today. The runner build must leave out the web server, sessions,
   and model code, and must not pull in server-only parts by accident.
3. **Updates in the middle of work.** When the server updates, the runner must swap versions; a running command
   finishes or stops cleanly first.
4. **Older servers.** A server without runner mode serves no code: the app does not offer Remote for it.
5. **Two Node versions.** The runner runs on Electron's Node 24, the server perhaps on 22: the same code must work on
   both.
6. **Desktop only.** A headless machine needs its own way to start a runner, such as `npx pi-pocket runner`.

### In any remote design

1. **Not knowing after a drop.** If the connection breaks in the middle of a command, the server cannot tell whether it
   ran. The session shows "runner offline", waits (proposed default 10 minutes, adjustable, deadline persisted), has a
   Stop button, never repeats an uncertain write or command, and never falls back to the server. This matches what
   Durable does after a restart today: the coding tools are not safe to repeat, so a cut-off call returns `interrupted`.
2. **Many small round trips over a distant link:** loading skills and AGENTS.md, `git status` on 500 files, extension
   hooks on every step. These need batching or caching on the runner.
3. **Large files** (downloads, images, diffs) need size limits and backpressure so one does not block the rest.
4. **Background tasks** use `/proc`, Unix process groups, bash, and `split`: macOS and Windows need their own backends.
5. **Bash reaches the whole computer.** Folder limits bind only the file tools; real containment needs the OS's sandbox.
6. **Shared sessions:** who may run things on another person's computer? Suggested: only the runner's owner.
7. **Extensions:** unknown ones are blocked in remote sessions; Firstmate is off there; billion-context-pi needs an
   audited exception.
8. **The browser** still runs on the server. Reaching this computer's `localhost` needs a per-session tunnel; the list of
   running servers needs new code for macOS and Windows.
9. **Secrets:** keys the server puts into commands never go to a runner unless allowed.
10. **Pairing:** the signed-in app gets a one-time credential and exchanges it for a hashed, revocable, runner-only key.
    The login token never goes to the runner. Idea from Xpropel/Pi-Remote: QR pairing with a 2-digit check code.

## Open decisions

| Question | Suggested for version 1 |
|---|---|
| Runner lifetime: only while the app is open, or a login service? | Only while the app is open |
| Background tasks in version 1? | Later |
| Trust: server fully trusted, or a fixed safety layer in the app? | Fully trusted now, safety layer later |
| Shared sessions: who may run on someone's runner? | Only its owner |

## Estimates

From 4 read-only reviews (gpt-6.1-sol, thinking max). Rows overlap; totals are rough. A separate runner program was
assumed; with the chosen approach the runner drops from about 2,100–3,200 lines to about 800–1,300, and folders, git,
and skills shrink, so version 1 is roughly **8,000–14,000 lines** instead of 11,000–19,000 (estimated, not counted).

### Version 1

| Area | Difficulty | Lines | Files |
|---|---|---|---|
| Runner (separate program; much less as a Pi Pocket mode) | 4/5 | 2,200–3,400 | 10–14 |
| Pairing and the connection | 4/5 | 1,200–1,900 | 8–11 |
| Pi's tools on the runner (add grep/find/ls; SDK grep spawns `rg` locally) | 4/5 | 1,100–1,850 | 6–8 |
| Offline and restart handling | 5/5 | 800–1,400 | 6–9 |
| Sessions keep their computer; Remote in the New session sheet | 3/5 | 1,150–2,000 | 14–21 |
| The agent knows its computer | 2/5 | 270–470 | 6–9 |
| Folders, files, diffs, branches | 3–4/5 | 1,700–2,850 | 25–37 |
| Skills, AGENTS.md, memory, model defaults | 3–4/5 | 900–1,550 | 16–24 |
| Secrets and the guard's path rules | 4/5 | 350–650 | 8–12 |
| Extensions: block unknown ones, adapt Pi Pocket's own | 3/5 | 1,700–3,200 | 18–26 |
| Browser: tunnel to this computer's `localhost`; Reveal in Finder | 4/5 | 1,100–1,950 | 18–24 |

### Later

| Area | Difficulty | Lines |
|---|---|---|
| Background tasks on the runner | 5/5 | 1,300–2,050 |
| Worktrees | 4/5 | 400–700 |
| Artifacts and Design from files on this computer | 4/5 | 400–750 |
| Browser: list of servers running on this computer | 3/5 | 600–1,100 |
| Extensions' tools on this computer (hooks and UI stay on the server) | 4/5 | 3,800–6,500 |
| Browser running on this computer | 5/5 | 1,400–2,400 |

Until a later item is built, a remote session turns that feature off and says why. It never runs it on the server
instead.

## Suggested order of pull requests

1. Runner mode and pairing.
2. Tools and offline handling.
3. Sessions keep their computer; the New session sheet.
4. Folders, files, git.
5. Skills, memory, secrets, extension blocking.
6. Browser tunnel and Reveal in Finder.

## Review findings worth keeping

- **Browser:** the panel streams JPEG frames (`Page.startScreencast`) long-polled through `/browser/frame`. Recommended
  tunnel: each conversation's Chromium context gets its own proxy (`Target.createBrowserContext` with `proxyServer` and
  `proxyBypassList: "<-loopback>"`), forwarding loopback through runner TCP channels, with HTTP, WebSocket, and CONNECT,
  so pages keep their origins and hot reload works. A process-wide proxy or PAC cannot override Chromium's localhost
  bypass; URL rewriting breaks origins.
- **Extensions:** Pi Pocket does not load Pi's `ExtensionRunner`, so the extensions in `~/.pi` are not active in Pocket
  today. Version 1 adds a remote-support flag and a session-bound `host.operations(id)` over `envFor()`, and gates
  commands, web parts, `host.on` listeners, and `CommandEnvs` (no server secrets by default). Built-ins needing work:
  background, browser, artifacts (path inputs), design (export and design-system file), codemode (temporary path),
  memory (`projectOf`), teams and subagents. Remote hooks are possible but add a round trip per step and fail offline.
- **Core:** the server needs an HTTP upgrade handler (`src/server/main.ts`); tools are installed in
  `src/server/app.ts` (`registry.install(CodingTools)`, `Harness.open({ env })`); cwd lives in both
  `SessionMeta.cwd` and Durable's `AgentDoc.cwd`; `!` commands do not survive a server restart today; the system
  prompt reports the server's `process.platform`.
- **Folders:** about 70 direct `fs` / `child_process` call sites touch the project (workspace, files, git, changes,
  branches, worktrees, skills, prompts, memory, artifacts, design). Access must be keyed by (environment, cwd), not cwd,
  and made asynchronous; HEAD polling (every 3 s) and the 500-file status need caching or batching.

Full notes: [research/core-notes.md](research/core-notes.md) (core, with file and line references) and
[research/folders-audit.md](research/folders-audit.md) (every call site that touches the disk). Line numbers are as of
Pi Pocket 0.26.0.

## Related

- Xpropel/Pi-Remote (github.com/Xpropel/Pi-Remote): the opposite direction (the agent runs in a local `pi`, a relay
  mirrors it to a browser). Not usable as a part; ideas taken: QR pairing with a check code, remote bash off by default,
  online only while the window is open, Cloudflare Tunnel on demand.
- npm `pi-remote` is deprecated, renamed `@wherever-dev/pi` (Wherever), also the opposite direction. Unrelated to the
  above.
- Pi's own `examples/extensions/ssh.ts` shows tool Operations over SSH.
