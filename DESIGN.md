# Pi Pocket GUI — design

A desktop app (Electron) for Pi Pocket. It connects to one Pi Pocket server that already runs, at a URL the person gives
it, and adds what a browser tab cannot: a tray, a badge, native notifications, a global hotkey, launch at login, and
offline dictation.

Decided with the owner in a grilling session on 2026-10-28. Rule for every open choice: **more options are better** —
when there is a sensible choice, it is a setting, with a safe default.

## Scope

- **One URL, one server.** No server profiles, no several servers. Pi Pocket itself is one server per address.
- **No bundled or installed server.** When nothing answers, the config screen says how to get Pi Pocket (GitHub, and
  `npm install -g pi-pocket`). A bundled server may come later; it is out of scope now.
- **No sign-in handling.** The person signs in with their own invite or login link, inside Pi Pocket's own pages.
- **Linux first**, then macOS (the owner tests), then Windows.

## Stack

- Electron + TypeScript, built with `tsc`, packaged with electron-builder. MIT. Repo `vitalNohj/pi-pocket-gui`.
- Product name **Pi Pocket**; executable `pi-pocket-gui` (so it never clashes with the server's `pi-pocket` command).
- Icon: Pi Pocket's own π icon (`assets/icon.svg`, MIT, from upstream). The tray icon adds a dot when something needs
  you.
- Look: Pi Pocket's default look (Tokyo Night palette, Geist, JetBrains Mono), so the config page and the server feel
  like one app.

## Connection and the config screen

- Settings live in `<appData>/pi-pocket-gui/config.json` (Linux: `~/.config/pi-pocket-gui/config.json`). It is plain
  JSON, edited by hand or in the app, and checked on load: an invalid value falls back to its default, and the config
  screen lists what was wrong.
- The URL is prefilled with `http://127.0.0.1:8787` (Pi Pocket's default). It can be typed whole, or built from parts
  (scheme, host, port, path).
- At start the app probes the URL once and the config screen says **Detected** or **Not detected** at the top, with
  the connection card. Below it: **Get the server yourself** (GitHub link, copyable `npm install -g pi-pocket &&
  pi-pocket`).
- Probe: `GET /api/pocket/info` → `{ "name": "pi-pocket", "bridge": <level> }` (no version, ever). Until a server has
  that route, a fallback reads `/manifest.webmanifest` and checks `name === "Pi Pocket"`.
- When the server cannot be reached (at start or when the page fails to load) the config screen shows the error, with
  **Retry**, **Edit connection**, and a background retry that backs off up to 30 s (configurable) and switches back
  to Pi Pocket as soon as it answers.
- The config screen opens from: Pi Pocket's menu (**GUI Settings…**, through the bridge), the tray, and the app
  menu. The tray and app menu always work, also on a server without the bridge.
- Certificates stay strict: a self-signed https server fails like it does in Chrome, and the error shows on the
  config screen.

## Desktop features

- Single instance. A second launch focuses the first window.
- **Tray menu:** Open, the pinned sessions of this GUI (Pi Pocket keeps pins per browser, so the GUI has its own),
  GUI Settings…, Quit. Each pin shows the same state as Pi Pocket's sidebar square: working, waiting for you,
  failed, finished and unread, read. A click opens that session in the GUI window.
- **Tray icon and badge** count every session that needs you, as Pi Pocket's home-screen badge does.
- **Close to tray** (default on). When the desktop has no tray (plain GNOME without AppIndicator), close minimizes, and
  the config screen says why.
- **Launch at login** (default off), **global show/hide hotkey** (default off), **notifications** (default on), **GUI
  update checks** (default on: at start and every 6 hours; asks before it restarts). electron-updater, from this
  repo's GitHub Releases. Pi Pocket itself keeps updating through its own updater, on the server.

## Notifications

- Web Push does not work in Electron. The server sends each push decision it makes (same rules: who can see it, their
  preferences, whether they look at the session) also over the live connection to that person's desktop clients. The
  bridge shows it as a native notification.
- Notifications only come while the GUI runs (also hidden in the tray). Closed means no notifications.
- The GUI tells the page when its window is hidden or minimized, so the server's "is looking at it" check stays
  correct.
- A click opens the session (or PiP).
- **Approvals:** the server sends the full call. The GUI decides how to show it: truncated to a length you set, with
  invisible and reordering characters shown as visible marks (`⟨U+202E⟩`). **Deny** is always offered. **Allow** is
  offered by the setting `notifications.allowFromNotification`: `whenFullyShown` (default: only when the whole call
  fits), `always`, or `never`. The server still checks that the person who answers may answer.

## Offline dictation

- Chrome's speech recognition needs Google's private API keys, which Electron apps do not get, so it fails with
  `network`. It cannot be fixed in Electron.
- The GUI's preload installs its own `SpeechRecognition` into the page. Pi Pocket's `web/voice.js` uses it unchanged.
  No upstream change, no audio over the bridge or to the server.
- Recognition runs natively (sherpa-onnx's Node addon) in the GUI's main process. Audio goes from the preload to the
  GUI's own main process only.
- Models download on demand, checked against checksums, into `<appData>/pi-pocket-gui/models/`: Parakeet TDT 0.6B v2
  (English), v3 (25 European languages, suggested), Whisper tiny, base, small, large-v3-turbo, large-v3. Several can
  be downloaded; one is active. Words come after each pause (Silero VAD), not live word by word.

## The upstream part (Pi Pocket core)

Built in a worktree from `upstream/main` (`/home/nohj/pi-pocket-desktop-bridge`), pushed to the fork
(`vitalNohj/pi-pocket`), and applied to the live instance for testing. Filed upstream as **one issue and one PR** only
when everything is finished, explaining that it is for this GUI or any other wrapper app.

- `GET /api/pocket/info` (no sign-in): `{ name: "pi-pocket", bridge: 1 }`. No version.
- **Host bridge**, generic and versioned: the wrapper's preload exposes `window.pocketHost`:

  ```js
  window.pocketHost = {
      kind: "pi-pocket-gui",
      apiVersion: 1,
      capabilities: ["menu", "badge", "notify", "visibility", "pinned"], // "dictation" reserved
      menuItems(), // [{ id, label, group }]
      invoke(id), // e.g. "server-settings"
      setBadge(count),
      notify(message), // the server's push message, with actions for approvals
      onVisibility(callback),
      setPinned(list), // [{ id, title, state }]
      onOpen(callback), // the wrapper asks the page to open a session
  };
  ```

  Pi Pocket uses only the capabilities it finds, and ignores what it does not know.
- The page shows the wrapper's menu items (a "Desktop" group with **GUI Settings…**).
- The server sends push decisions to desktop clients over the live connection.
- The page reports visibility from the wrapper.
- A server without the bridge still works in the GUI, with a one-time notice: "This server doesn't support desktop
  features yet. Please update it."

## Security

- The bridge exists only in the top frame of the configured server's origin. Never in iframes (artifacts), never on
  another origin, never after navigating away. The main process checks the sender's frame and origin on every IPC
  call.
- `contextIsolation` on, `sandbox` on, `nodeIntegration` off, `webSecurity` on.
- Navigation stays on the server's origin and the app's own config page (`pocket-gui://`). Other http(s) links open in
  the system browser; other schemes are refused.
- Permissions (microphone, notifications, clipboard) are granted only to the server's origin.

## Builds

- GitHub Actions (free on a public repo) builds on each tag: Linux AppImage + .deb, macOS .dmg, Windows NSIS. Unsigned
  for now; signing comes with the macOS and Windows work.
- Linux is tested on opti2 under Xvfb. The owner checks the tray and notifications on a real desktop, then macOS, then
  Windows.

## Order

1. GUI core and the config screen.
2. The upstream bridge, on the fork and the live instance.
3. Tray, pins, badge, notifications.
4. Offline dictation.
5. CI builds.
6. macOS, then Windows.
7. File the upstream issue and PR.
