<div align="center">

<img src="assets/icon.svg" width="96" alt="Pi Pocket" />

# Pi Pocket for desktop

**[Pi Pocket](https://github.com/TannerMidd/pi-pocket) as a real app on macOS, Windows, and Linux: on this computer, or your server's.**

Pi Pocket installed and kept current for you · a tray with your pinned sessions · a badge · native notifications · a seamless window · a see-through background

[Download](https://github.com/vitalNohj/pi-pocket-gui/releases/latest) · [Install](#install) · [Settings](#settings) · [Roadmap](#roadmap)

<img src="docs/images/hero.png" alt="Pi Pocket in the desktop app: the session list on the left, a conversation on the right, the macOS traffic lights over the sidebar" width="100%" />

</div>

> [!WARNING]
> **Windows Defender may block the Windows installer.** It flags `pi-pocket-gui-0.2.6-win-x64.exe` as `Program:Win32/Contebrew.A!ml`, a machine-learning guess (`!ml`), not a match with any known malware. The build isn't code-signed yet. The file has been submitted to Microsoft as a false positive. Until it's cleared: in Windows Security → **Protection history**, open the entry and choose **Allow**, then download it again. The source and the build are public: [the workflow](.github/workflows/build.yml) builds every release.

> [!NOTE]
> **Remote execution is still being worked on.** Pi works on the files and runs the commands of the computer the server is on. With Pi Pocket on this computer, that is this computer. With a server elsewhere (a home server, a VPS), it is that machine, not this one: working on this computer's files from a remote server needs remote execution, which is not in the app yet.

## What it is

The app runs Pi Pocket on this computer for you, or opens one you already run elsewhere (a home server, a VPS, behind a tunnel), in a window of its own, and adds what a browser tab cannot do.

|  |  |
|---|---|
| **Pi Pocket on this computer** | No terminal: the app downloads Pi Pocket and the Node.js it needs, runs it while the app runs, and keeps both up to date. |
| **Tray** | Your pinned sessions with their state (◆ waiting for you, ◐ working, ✕ failed), one click away. |
| **Badge** | How many sessions need you, on the dock or taskbar icon. |
| **Notifications** | Native ones, even with the window hidden. An approval can be answered from the notification. |
| **Seamless window** | No title bar: Pi Pocket runs to the top edge, and the window's buttons sit over it. |
| **See-through background** | The desktop shows through Pi Pocket's background, blurred, as much as you choose. |
| **Your theme** | The settings screen, the window, and the tray's π follow the theme Pi Pocket shows. |
| **Global shortcut** | Show or hide the window from anywhere. |
| **Launch at login** | Optionally hidden in the tray, so notifications keep coming. |
| **Updates** | It checks for new releases and installs them (or downloads them, on macOS). |

## Install

Download the app for your computer from [**Releases**](https://github.com/vitalNohj/pi-pocket-gui/releases/latest):

| | File | |
|---|---|---|
| **macOS** | `…-mac-arm64.dmg` (Apple Silicon) or `…-mac-x64.dmg` (Intel) | Drag the app into Applications. It is not signed by Apple yet: the first time, right-click it and choose **Open**. If macOS still refuses, use **Open Anyway** in System Settings → Privacy & Security, or run `xattr -cr "/Applications/Pi Pocket.app"`. |
| **Windows** | `…-win-x64.exe` | SmartScreen warns about an unsigned app: **More info** → **Run anyway**. Defender may block it as a false positive: [see above](#pi-pocket-for-desktop). |
| **Linux** | `…-linux-x86_64.AppImage` or `…-linux-amd64.deb` | Make the AppImage executable and run it, or install the .deb. |

Open the app and pick where Pi Pocket runs:

- **This computer:** click **Install Pi Pocket**. Nothing else to install, not even Node.js. See [Pi Pocket on this computer](#pi-pocket-on-this-computer).
- **Another server:** give its address and sign in inside Pi Pocket with your login link or an invite. To set one up, run `npm install -g pi-pocket && pi-pocket` on it (Node.js 22.19 or newer).

> Version 0.1.0 was named `pi-pocket-gui.app` on macOS. After installing a newer one, move the old one to the Trash.

## A closer look

### Pi Pocket on this computer

Pick **This computer** in Settings and click **Install Pi Pocket**. The app downloads the newest Pi Pocket from npm and a Node.js for it from nodejs.org (about 60 MB, 400 MB on disk; checked against nodejs.org's checksums and npm's), starts it, and opens it, signed in as its owner.

- **It runs while the app runs,** also with the window closed to the tray. Quitting the app stops it; running sessions pick up at the next start. With **Launch at login** and **Start hidden**, this computer is an always-on Pi Pocket for your phone.
- **Who can connect:** this computer only, the local network, your Tailscale network, or anywhere through a Cloudflare link. Also the folder new sessions start in, the port, and the data folder (`~/.pi-pocket` by default, the same as Pi Pocket in a terminal).
- **Kept up to date:** the app looks for a newer Pi Pocket and Node.js at start and every few hours, and installs them beside the ones in use. They take over when Pi Pocket restarts: **Restart** in Settings, the tray's **Restart Pi Pocket to update**, or the next start of the app. If a new version does not start, the one before runs again. Pi Pocket's own Settings → Updates works too.
- **Pi Pocket already running** on that port (started in a terminal) is found and offered instead.
- **It sees your tools:** Pi Pocket gets the same environment as your terminal (your shell's `PATH`), so the agent finds `git`, `node`, and the rest.

Everything lives in the app's data folder (below), in `server/`: the runtimes and `server.log`. How it works: [docs/local-server.md](docs/local-server.md).

### A window without a title bar

Pi Pocket runs to the window's top edge, and only what sits under the window's buttons makes room for them: on macOS the sidebar starts a little lower and the conversation keeps its whole height. On Windows and Linux the buttons sit at the top right instead, and the tiled window under them is notched around them: its border goes down and around the buttons rather than under them.

<img src="docs/images/windows.png" alt="The Windows and Linux layout: minimize, maximize, and close at the top right, with the conversation's border notched around them" width="100%" />

The app tells the page where the buttons are through the [Window Controls Overlay](https://developer.mozilla.org/en-US/docs/Web/API/Window_Controls_Overlay_API), the web's own standard for it. An older Pi Pocket gets a plain band as tall as the buttons. Drag the window by the bar beside them. Settings → Window → Title bar → **The system's** brings back the normal title bar, after a restart.

### See-through background

Turn on **See-through background** in Settings → Appearance, and set the **Opacity** from 0% to 100%. Menus, sheets, and cards stay solid, so text stays readable.

<img src="docs/images/see-through.png" alt="The desktop's colors showing through Pi Pocket's background, blurred" width="100%" />

- **macOS:** the system's blur (vibrancy). **Blur** picks its material.
- **Windows 11 (22H2 or newer):** Acrylic or Mica. Windows 10 cannot.
- **Linux:** turning it on takes a restart (the settings screen offers one). Your compositor does the blur: on Hyprland, `decoration:blur`; on KDE, the Blur effect. GNOME shows it see-through, without blur.

### It follows your theme

Change the theme in Pi Pocket and the app follows: the settings screen, the window's own background, and the tray's π. It remembers the colors, so the next start looks right before the server answers.

<img src="docs/images/light.png" alt="The same window in Catppuccin Latte, a light theme" width="100%" />

### Dictation, offline

Pi Pocket's mic button (and Alt+V) works in the app, recognised on your computer: the audio never leaves it. Nothing comes with the app. In **Server settings → Dictation**, pick a speech model and press **Download**; the speech engine ([sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx), about 12 MB) comes with the first model. **Remove** deletes a model, and removing the last one deletes the engine too. Every file is checked against its SHA-256 before it is used.

| Model | Languages | Download |
|---|---|---|
| Parakeet TDT 0.6B v2 (recommended) | English | 661 MB |
| Parakeet TDT 0.6B v3 (recommended) | 25 European languages | 670 MB |
| Whisper large-v3 turbo, large-v3, small, base, tiny | 99 languages | 1.0 GB to 104 MB |
| Distil-Whisper large-v3.5 | English | 984 MB |
| Moonshine base | English | 287 MB |
| SenseVoice small | Chinese, Cantonese, Japanese, Korean | 237 MB |

Words show while you speak and are corrected when you pause (**Words as you speak**; turn it off to save CPU). A model loads at the first dictation and leaves memory after 10 idle minutes. The mic needs Pi Pocket on `127.0.0.1`/`localhost` or `https`: browsers, and so the app, keep the microphone from plain-http pages on other addresses.

### Billion-context Pi

The **Billion-context Pi** card installs [billion-context-pi-pocket-adapter](https://github.com/vitalNohj/billion-context-pi-pocket-adapter) (context compression for long conversations) in the Pi Pocket the app runs on this computer, and turns it on. Pi Pocket must be running.

- **Install** downloads the newest commit of the adapter's `main` branch from GitHub, checks each file against the git hash the commit lists, and puts `billion-context-pi-pocket-adapter.ts` and its folder in Pi Pocket's `extensions` folder. Then it turns the extension on through Pi Pocket's API.
- **Update** shows when a newer commit is out, at each start and as often as the app looks for its own updates. It turns the extension off, swaps the files, and turns it on again. **Update automatically** does this without asking (off by default).
- **Uninstall** turns it off and removes those files. Its settings file (`billion-context-pi-pocket-adapter.json`) and its saved state stay.
- A copy installed by hand under another file name is left alone: the card says so.

With **Another server**, the card shows the command that installs it on that server instead.

### This computer as a runner

A Pi Pocket server can run a session's tools on this computer: its files and commands here, while the agent, its models, its keys, and its history stay on the server. The computer connects out to the server, so it needs no SSH or open port.

- **Link it:** open the server in the app, then **Menu → Computers → Link a computer → Link this computer**. The app installs what the runner needs (Node.js and Pi Pocket, the first time only), links this computer with a one-time code, and runs `pi-pocket runner` while it is open, also hidden in the tray.
- **Use it:** in Computers, **New session** on this computer picks a folder here. The session's title says which computer it runs on.
- The **This computer as a runner** card shows whether it is connected, turns the runner off and on, and unlinks it. Off, or with the app closed, the server shows the computer as offline, and its sessions' tools fail until it is back. A short drop (up to 2 minutes) loses nothing: running commands carry on.
- **Another computer, such as a server:** the card and the Computers sheet give the steps: `npm install -g` Pi Pocket there, `pi-pocket runner link <server> <code>`, then `pi-pocket runner service` (Linux with systemd) or `pi-pocket runner` in a terminal.
- Anyone who can prompt such a session can do on this computer what you can. Only the server's owner can start one.

The server must have runner support: Pi Pocket from [vitalNohj/pi-pocket](https://github.com/vitalNohj/pi-pocket) `live-0.28` for now, which the app also installs for **This computer**.

### Settings

Everything is on one screen: **Server settings…** in the File menu, the tray, Pi Pocket's own menu, a right-click on the page, or Ctrl+, (⌘, on macOS). The shortcut belongs to the desktop app and works even on a broken server page. The badge says **Connected** once Pi Pocket is open; **Connect** waits until you change the address and check the new one.

Use the **web interface address** that opens Pi Pocket in your browser, not a model/API endpoint. A failed check keeps you in settings and does not replace your saved server or close a working connection. If a sign-in gateway prevents detection, **Open webpage anyway** is offered only for an HTML page; an app-owned **Server settings** button stays visible until Pi Pocket is detected. HTTP errors and non-webpage responses (including JSON) reopen settings automatically rather than leaving you on an error page.

<img src="docs/images/settings.png" alt="The settings screen: the connection on the left, the Window settings on the right" width="100%" />

With **Another server** picked, the **Remote server** card has what the app does with it: open it at start when it answers, and other addresses the window may show (a sign-in page in front of it, such as Cloudflare Access). Its **Advanced** part holds how the app watches the server: a check every 10 seconds while it is open, an outage after 3 failed checks in a row (this screen then says the server is down, and the app keeps trying), retries up to 30 seconds apart, and 4 seconds for each check to answer.

The settings are also a JSON file you can edit by hand. A value that is not valid falls back to its default, and the settings screen lists it.

| | |
|---|---|
| Linux | `~/.config/pi-pocket-gui/config.json` |
| macOS | `~/Library/Application Support/pi-pocket-gui/config.json` |
| Windows | `%APPDATA%\pi-pocket-gui\config.json` |

### Updates

The app looks for a new release at start and every 6 hours (Settings → Updates → **Check now**).

- **Windows and the AppImage** download it and install it when the app restarts. The app asks first.
- **macOS:** until the app is signed by Apple, macOS will not let it replace itself. It downloads the new disk image to Downloads, checked against GitHub's checksum, then quits and opens it (macOS cannot replace an app that is running): drag the app into Applications over the old one, then open it again. Your settings and sign-in stay.
- **The .deb** opens the release page: install the new .deb the same way.

## How it talks to Pi Pocket

Pi Pocket's page runs in the app as it does in a browser, with one addition: a small, versioned bridge (`window.pocketHost`) through which the page tells the app about pins, the badge, and notifications, and the app tells the page when its window is hidden. The bridge is on a branch of Pi Pocket and not yet in a release: against a Pi Pocket without it, the app still works, without the tray pins, badge, and notifications, and says so once.

## Roadmap

Being worked on, none of it in the app yet:

- **Remote execution:** sessions on your server whose files and commands are on this computer.
- **New session from anywhere:** ⌘N / Ctrl+N, the dock's or taskbar's menu, and a `pi-pocket://new` link.
- **Signed builds** for macOS and Windows, so updates install themselves everywhere.

## Develop

```bash
npm install
npm start      # build and run
npm test       # unit tests
npm run dist:linux
```

`PI_POCKET_GUI_USER_DATA=/tmp/gui-data npm start` runs with a separate settings folder.

A push to `main` builds every platform on GitHub Actions (the run's artifacts). A tag publishes a release, which the app's updater reads:

```bash
npm version patch   # bumps package.json and tags vX.Y.Z
git push --follow-tags
```

The screenshots above come from the app itself, run against a Pi Pocket with made-up people and sessions ([scripts/screenshots/](scripts/screenshots/)).

## License

MIT. Pi Pocket's icon is MIT too ([assets/NOTICE.md](assets/NOTICE.md)).
