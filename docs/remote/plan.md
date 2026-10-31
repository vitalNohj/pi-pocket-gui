# Remote execution: plan

Status: design, nothing built. Updated 2026-10-31. Against Pi Pocket 0.27.0, Pi Durable / coding-agent 1.4.0, and this
app 0.1.6 (Electron 45.1.0, Node 24.22.1 built in).

## The goal

A Pi Pocket session that **runs on the main server and executes on another computer**. The agent, the model, the
provider keys, the history, and everything else stay on the main server. Only the tools (files, commands, git) run on
the other computer.

Provider keys never leave the main server. A computer that executes needs no key of any provider.

## Decisions

| Decision | Why |
|---|---|
| **Run there, execute here** (not: run here, show there). | The provider keys stay only on the main server. |
| **The app bundles a full Pi Pocket.** | New users get a server with the app. The code that runs on this computer ships with the app, versioned and known: the server never sends code. |
| **Two modes, one at a time, no switching.** Standalone: the bundled Pi Pocket is the server. Remote: the app opens a main server, and the bundled Pi Pocket only executes for it. | Simple to explain, nothing to merge, no second set of sessions on this computer while in remote mode. |
| **The bundled Pi Pocket runs while the app runs** (in the tray when the window is closed, at login when that is on). | When the app quits, standalone sessions stop and Pi Durable picks them up at the next start; remote sessions wait for the computer. |
| **A session's place is fixed when it is made.** A remote session executes on its computer for its whole life; it never moves to the server or to another computer. | Nothing to migrate, and no question of where a step ran. |
| **This computer is offered for remote work only when you turn it on** (Settings → Remote execution, shown only in remote mode). | Executing for a server is a real permission: opt in, never by default. |
| **Each new remote session on a computer needs a yes on that computer.** The app shows a dialog: who, which session, which folder. A folder said yes to joins the computer's allowed list. | Someone signed in as you elsewhere cannot start work on, or widen access to, your computer without you at it. |
| **Settings are split by who owns them.** The app: standalone or remote, and "offer this computer". The Pi Pocket server: a Runners section for other runners. | The app links itself; other runners (deployable ones) are the server's business, in standalone mode too. |
| **Only the session's owner can make a remote session execute.** A per-session switch, off by default, lets the others in the session prompt it too. No handover of sessions. | Nobody else's message, schedule, or hook runs anything on someone's computer unless its owner allowed it for that session. |
| **Folders are allowed per computer, not per session.** The list starts empty and grows as you pick folders. | One list per computer to check and to prune. |
| **The execution layer is its own part, not part of the app.** | The same runner serves the app today and, later, a deployable runner (a VPS, a container, a CI machine) linked to the same sessions. |
| **Each computer gets its own key**, got through the existing sign-in, with no extra step in the app. | See [Verification](#verification). |

## The parts

```
Main Pi Pocket server                              This computer
┌──────────────────────────────────┐               ┌──────────────────────────────┐
│ agent, models, keys, sessions     │               │ Pi Pocket desktop app         │
│                                   │               │   (window, tray, settings)    │
│ execution environments            │               │          │ starts, stops      │
│   "server"  → local ExecutionEnv  │   WebSocket   │          ▼                    │
│   "runner"  → RemoteExecutionEnv ◄├───────────────┤► runner (bundled Pi Pocket,   │
│                                   │  (runner      │   runner mode): files,        │
│ runner registry, keys, policy     │   dials out)  │   commands, git, request log  │
└──────────────────────────────────┘               └──────────────────────────────┘
```

Three pieces, each usable without the others:

1. **The protocol** (`pi-pocket/src/remote/protocol`): message types, versions, request IDs, and the request log's
   states. No Electron, no server, no file system. Both sides import it.
2. **The runner** (`pi-pocket/src/remote/runner`, started as `pi-pocket runner`): connects out to a server with its
   key, carries out requests through Pi Durable's `ExecutionEnv` on its own computer, and keeps the request log. It
   knows nothing about the app. The app starts it as a child process (Electron's Node, `ELECTRON_RUN_AS_NODE=1`); a
   deployable runner is the same command under systemd, launchd, or a container.
3. **The server side** (`pi-pocket/src/remote/host`): accepts runners, keeps the registry of computers and their keys,
   and gives a session a `RemoteExecutionEnv` that sends each tool call to that session's runner. It plugs in where the
   session's `ExecutionEnv` is chosen today (`Harness.open({ env })`), so the tools do not change.

All three live in Pi Pocket itself (the app bundles Pi Pocket, and the server side must be there anyway). The app adds
only: start and stop the runner, link this computer in Settings, and show its state in the tray.

## Settings

**The app (Pi Pocket desktop):**

- **Server:** this computer (the bundled Pi Pocket, standalone) or the address of a main server (remote). One or the
  other.
- **Remote execution** (remote mode only): offer this computer to the main server. On: the app links itself (its
  sign-in gets the runner its key) and starts the runner. Off: the runner stops and its key is revoked. Below it, this
  computer's allowed folders, which can be removed.

In standalone mode, the server is on this computer and executes here already: nothing to link.

**The Pi Pocket server, Settings → Runners** (on any Pi Pocket, the bundled one included):

- Every computer that executes for this server: the desktop apps that linked themselves and the runners linked by hand,
  with their state, last seen, owner, and allowed folders. Revoke one, or remove a folder.
- **Link a runner:** shows a one-time code for a deployable runner (`pi-pocket runner link <server> <code>`).

So a standalone Pi Pocket on a laptop can also have runners: a VPS or a CI machine linked to it by code.

## Verification

**The sign-in proves who you are. The runner then gets a key of its own.** You do nothing extra: the app is signed in,
so it asks the server for the key itself.

Why not use the sign-in directly:

- The sign-in is the page's cookie, and it can do everything you can: read every session, invite people, change
  settings. The runner needs one thing only: accept work for your sessions.
- A key per computer can be revoked alone (a lost laptop) without signing you out everywhere, and Settings →
  Computers on the server lists each one with when it was last seen.
- A deployable runner has no browser and no sign-in. It needs a key anyway: one mechanism for both.

How: the signed-in app asks the server for a one-time code; the runner exchanges it for its key; the server keeps only
the key's hash. The key is limited to "be a runner for this person". For a deployable runner, the server's web UI shows
the one-time code to paste (`pi-pocket runner link <server> <code>`).

## How a remote session works

1. In the app, connect to the main server (remote mode), then turn on Settings → Remote execution. The app links this
   computer, as above. Turning it off stops the runner and revokes its key.
2. The runner connects out to the server and stays connected. No port opens on this computer.
3. On the server, New session → the computer ("Maya's MacBook") → a folder. The folders come from the runner.
4. **The computer confirms.** The app shows a dialog on this computer: "Maya wants to start *Rate limiting for login*
   in ~/code/aurora-api on this computer", with Allow and Deny. The session waits ("waiting for MacBook to allow")
   until then, and Deny ends it. A folder allowed this way joins the computer's allowed list.

   A deployable runner has no dialog: its allowed folders are in its own config file (or `pi-pocket runner allow
   <folder>`), and a new session in a folder not on that list is refused.
5. The agent runs on the server with the server's keys. Each tool call goes to the runner, runs on this computer, and
   the result comes back. The session and its history are on the server.
6. While the computer is asleep, offline, or the app is closed, the session shows "MacBook offline", waits, and has a
   Stop button. It never runs the step on the server instead.

**The owner rule:** only the session's owner (the person who made it) can start a turn in a remote session. Others in
the session can watch and chat; their messages cannot start the agent. Schedules, hooks, goals, and subagents of a
remote session act as the owner and only for the owner. A runner accepts work only for sessions owned by its own person.

**Letting others prompt:** the owner can turn on "Others can prompt this session" for one session (off by default, with
a warning that their messages then run things on the owner's computer). They can then prompt it and see its output, as
in any shared session. The owner can turn it off at any time. Ownership never moves.

**Subagents and linked sessions** started by a remote session execute on the same computer, with the same owner.

## Problems and solutions

★ marks the chosen solution.

### 1. Not knowing what happened after a drop

- ★ **Every request has an ID; the runner keeps a durable log of them** (in the bundled Pi Pocket's data folder):
  received, started, finished with its result. After a reconnect, the server asks about each request in flight and gets
  the result, "still running" (output resumes where it stopped), "killed when the app quit", or "never received". Only
  the last is sent again.
- ★ **Duplicate requests are ignored by ID**, so resending is always safe. Remote tool calls can then be marked safe to
  repeat in Pi Durable, and recover better than local ones do today (those come back `interrupted` after a restart).
- Commands run under a small supervisor that writes their exit code to a file, so a runner restart keeps the outcome.
- Optional: while a command runs, the app keeps the computer awake (a setting).

### 2. Many small requests over a distant link

- ★ **Bundled requests:** one "project context" request returns AGENTS.md, skills, git status, and the branch.
- ★ **The runner pushes changes** (it watches the project) instead of the server polling, which today checks the
  branch every 3 seconds.
- Independent requests go side by side. Test with an injected delay.

### 3. Large files

- ★ Chunked transfers with flow control; small control messages go first, so a big file never holds up a command's
  output. Size limits and ranged reads. Downloads stream to the browser without being held on the server.

### 4. Bash reaches the whole computer

- Folder limits bind the file tools only. A plain runner means "the agent acts as you on this computer".
- ★ Later: an optional sandbox for the runner's commands (macOS's sandbox, Landlock on Linux, restricted processes on
  Windows): write only in the project and temp folders.
- Strongest: a deployable runner in a VM or container.

### 5. Secrets

- ★ The server's own secrets (keys it puts into commands) are never sent to a runner unless the owner allows that key
  for that computer; they then go in memory, for the one command. Output from the runner is masked for them.
- A runner can use its own computer's keychain or environment instead.

### 6. Background tasks on macOS and Windows

- ★ The runner keeps its jobs in plain Node (no `/proc`): a job is its process ID and start time. Stopping one stops
  its process group (macOS, Linux) or its process tree (Windows).
- First version: jobs end when the runner stops, and the session says so.

### 7. The browser and this computer's `localhost`

- The browser panel runs on the server, so it cannot reach this computer's `localhost`.
- ★ Later: the runner is a whole Pi Pocket, browser code included. A remote session's browser could run on this
  computer and reach its `localhost` directly, sending its frames to the server as now.
- Until then: a per-session tunnel (the server's browser reaches this computer's `localhost` through the runner).

### 8. Extensions

- Most extensions stay on the server and work as now. Extensions get the session's `ExecutionEnv`, so the ones that use
  it work remotely unchanged.
- ★ An extension says where it runs (server, the session's computer, or not in remote sessions). One that does not say
  is off in remote sessions.

### 9. Versions

- The app (with its runner) and the main server update separately. The protocol has a version and a list of
  capabilities; each side uses what both have, and the server says plainly when a runner is too old.

### 10. Paths and computers

- Paths belong to their computer (Windows paths, case-insensitive file systems): the runner normalizes them, and the
  server treats them as text it never builds itself.
- Each runner has a stable ID and a name. One person can have several (a laptop, later a deployable runner).

## Size

Pi Pocket 0.27.0 is about 12 MB unpacked; bundled with its production dependencies the app grows by tens of MB. Not a
concern.

## Order of work

1. **Bundled Pi Pocket, standalone mode:** the app ships Pi Pocket, starts it with Electron's Node, and opens it. New
   users need no separate install.
2. **The protocol and the runner** in Pi Pocket, with the request log, tested against a local server.
3. **The server side:** runner registry, keys, linking, `RemoteExecutionEnv`, the owner rule.
4. **Sessions on a computer:** the session keeps its computer; New session offers the computers; offline handling.
5. **Folders, files, git, project context** through the runner.
6. **Secrets, extension flags, background tasks, the browser** (each can follow on its own).

## Open questions

None at the moment.

## Research

Earlier reviews (gpt-6.1-sol, read-only), written for a design with a separate runner program. Their file and line
references (Pi Pocket 0.26.0) and their list of every place the server touches the disk still apply:

- [research/core-notes.md](research/core-notes.md): connection, tools, background tasks, Durable's replay rules, data
  model, the New session sheet.
- [research/folders-audit.md](research/folders-audit.md): about 70 places in the server that touch project files.

Related: Xpropel/Pi-Remote (github.com/Xpropel/Pi-Remote) does the opposite (the agent runs in a local `pi`, a relay
mirrors it to a browser). Ideas taken from it: link a device with a code, online only while the app runs.
