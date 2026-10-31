# Pi Pocket on this computer (phase 1)

The app can run Pi Pocket itself, on this computer, instead of opening a server that runs elsewhere. Nothing of Pi
Pocket ships with the app: the app downloads it the first time it is needed, keeps it current, and runs it while the
app runs.

This is phase 1 of three:

1. **Pi Pocket on this computer** (this document).
2. **The runner** in Pi Pocket: a server executes a session's tools on another computer ([remote/plan.md](remote/plan.md)).
3. **The app as a runner:** the app offers this computer to a server it is connected to.

## What the person sees

Settings → Connection offers two choices:

- **This computer:** "Pi Pocket runs on this computer while the app runs." The first time, Install downloads it (about
  60 MB, about 400 MB on disk), then it starts and the app opens it, signed in as its owner. Settings: the folder new
  sessions start in, the port, who can connect (this computer only, the local network, Tailscale, or a Cloudflare
  tunnel), and the data folder. A change takes a restart of Pi Pocket, which the card offers.
- **Another server:** the address of a Pi Pocket that runs elsewhere, as before.

A Pi Pocket that already answers at the chosen port (one started from a terminal) is offered instead: **Open it**
switches to Another server with its address.

Settings that existed before this choice keep opening their server (Another server); a new install starts on This
computer.

While the app runs, so does Pi Pocket: closing the window keeps both in the tray. Quitting the app stops Pi Pocket;
Pi Durable picks running sessions up at the next start. Launch at login, with Start hidden, makes this computer's Pi
Pocket an always-on server for a phone.

## How

### What is downloaded, and where

```
<app data>/server/
  current.json                     the runtime in use; the one before an update, until the new one starts; one built
                                   by an update, waiting for the next start
  runtimes/<id>/                   one Node.js, with Pi Pocket installed globally in it
    bin/node, lib/node_modules/pi-pocket  (Windows: node.exe, node_modules\pi-pocket)
  downloads/                       the Node.js archives in use
  launcher.pid                     the launcher the app started, to stop one left by a crash of the app
  server.log                       what Pi Pocket printed (login tokens hidden), up to 2 MB
```

- **Node.js:** the newest LTS release from nodejs.org that Pi Pocket's `engines` allows, as `.tar.gz` (macOS, Linux)
  or `.zip` (Windows), checked against nodejs.org's `SHASUMS256.txt`, unpacked with the system's `tar` (Windows 10 and
  later have one). Not Electron's Node: it has no npm, and Pi Pocket's own updater needs one beside the Node that runs
  it.
- **Pi Pocket:** `npm install --global --prefix <runtime> pi-pocket@<latest>` with that Node's own npm, so the runtime is an ordinary
  global install and Pi Pocket's own updater (Settings → Updates in Pi Pocket) works in it. npm checks each package
  against the registry's integrity hash. Install scripts are off (`--ignore-scripts`): Pi Pocket needs none.
- **The runtime's npm stays its own:** Pi Pocket's updater runs the npm beside its Node and asks it for the global
  folder. On macOS and Linux `bin/npm` is a script that runs the first `node` on PATH (the person's, with another
  global folder), so the app rewrites `bin/npm` and `bin/npx` to run the runtime's Node, and npm's builtin config
  (`lib/node_modules/npm/npmrc`) pins `prefix` to the runtime. Pi Pocket then sees an `npm-global` install.
- A runtime is built in `runtimes/<id>.partial` and renamed when whole: a half-built runtime never takes a name.

### Running it

The app starts Pi Pocket's launcher, the same command a person types, with the runtime's Node:

```
<runtime>/bin/node <runtime>/lib/node_modules/pi-pocket/bin/pi-pocket.js \
    --access <local|lan|tailscale|cloudflare> -y --port <port> --cwd <folder> --data <data folder>
```

- The launcher supervises the server: restarts after a crash, the restart Pi Pocket asks for (Settings, its own
  updates), the rollback of a failed self-update, and the Tailscale or Cloudflare address.
- **The environment** is the person's login shell's (`$SHELL -ilc env`, on macOS and Linux), so the agent finds the
  same tools as in a terminal: an app started from the Dock gets only a bare `PATH`. The runtime's `bin` goes at the
  end of `PATH`, so Pi Pocket's updater finds an npm and a Node even on a computer with none of its own, and a Node
  the person has stays first.
- **Signing in:** the launcher prints `Sign in  <address>/login?token=…` once the server is ready. The app reads it,
  and opens that link in its own view once per start: the cookie it sets keeps the app signed in as the owner. The
  link never leaves the app. The app opens `http://127.0.0.1:<port>`, or the Tailscale address when Pi Pocket listens
  only there.
- **Stopping:** at quit, the app asks the launcher to stop (it stops the server and its tunnel) and waits up to 15
  seconds. The app's own updates quit the same way.
- **Problems** show on the config screen with the cause from the log: a port in use, a data folder another Pi Pocket
  holds, a failed download. A launcher that exits with Pi Pocket's configuration error (78) is not started again
  until the person does. Other stops are retried 5 times, waiting 2, 4, 8, 16, then 32 seconds.

### Keeping it current

- Pi Pocket updates itself the way it does on any computer: its Settings → Updates checks npm, and can install by
  itself when no session has worked for 10 minutes.
- The app checks, at start and then as often as its own updates, for a newer Node.js LTS and a newer Pi Pocket. When there is
  one, it builds a new runtime in the background. The new runtime takes over at the next start of the app, or at once
  from Settings or the tray ("Restart Pi Pocket to update"). Sessions resume after the restart.
- If the new runtime stops before it is ready, or is not ready within 2 minutes, the app goes back to the previous one
  and says so. Old runtimes and archives are removed once a new one has started.
- "Keep Pi Pocket up to date" (on by default) turns the app's checks on or off; Pi Pocket's own setting is separate.
  The checks follow Settings → Updates → How often.

## Not in phase 1

- A QR code or link for a phone in the app: Pi Pocket's own sharing does it once the server is reachable.
- Updating while the app runs without a restart: a restart is the safe moment, as in Pi Pocket.
- A machine-readable ready line from the launcher (`--json`): reading its printed panel is enough for now; a small
  upstream change would make it sturdier.
