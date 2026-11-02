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
> **Use this computer from your server with a runner.** Without a runner, Pi uses the server's files and commands. Link this computer to use its files and commands instead. See [Runner](#runner) for setup and access rules.

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

Pick **This computer** in Settings and click **Install Pi Pocket**. The app downloads Pi Pocket and the Node.js it needs (about 60 MB, 400 MB on disk). It starts the server and signs you in as its owner.

- **It runs while the app runs,** also with the window closed to the tray. Quitting the app stops it; running sessions pick up at the next start. With **Launch at login** and **Start hidden**, this computer is an always-on Pi Pocket for your phone.
- **Who can connect:** this computer only, the local network, your Tailscale network, or anywhere through a Cloudflare link. **Folder for new sessions** sets the starting folder. **Advanced** holds the server port and data folder (`~/.pi-pocket` by default), plus **Uninstall**. The server log is below it.
- **Kept up to date:** the app looks for a newer Pi Pocket and Node.js at start and every few hours, and installs them beside the ones in use. They take over when Pi Pocket restarts: **Restart** in Settings, the tray's **Restart Pi Pocket to update**, or the next start of the app. If a new version does not start, the one before runs again. Pi Pocket's own Settings → Updates works too.
- **Pi Pocket already running** on that port (started in a terminal) is found and offered instead.
- **It sees your tools:** Pi Pocket gets the same environment as your terminal (your shell's `PATH`), so the agent finds `git`, `node`, and the rest.

Everything lives in the app's data folder (below), in `server/`: the runtimes and `server.log`. How it works: [docs/local-server.md](docs/local-server.md).

### A window without a title bar

Pi Pocket runs to the window's top edge, and only what sits under the window's buttons makes room for them: on macOS the sidebar starts a little lower and the conversation keeps its whole height. On Windows and Linux the buttons sit at the top right instead, and the tiled window under them is notched around them: its border goes down and around the buttons rather than under them.

<img src="docs/images/windows.png" alt="The Windows and Linux layout: minimize, maximize, and close at the top right, with the conversation's border notched around them" width="100%" />

The app tells the page where the buttons are through the [Window Controls Overlay](https://developer.mozilla.org/en-US/docs/Web/API/Window_Controls_Overlay_API), the web's own standard for it. An older Pi Pocket gets a plain band as tall as the buttons. Drag the window by the bar beside them. Server settings → Window → Title bar → **System** brings back the normal title bar, after a restart.

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

### Billion context

The **Billion context** card, under **Server tools**, installs [billion-context-pi-pocket-adapter](https://github.com/vitalNohj/billion-context-pi-pocket-adapter) (context compression for long conversations) in the Pi Pocket the app runs on this computer, and turns it on. Pi Pocket must be running.

- **Install** downloads the newest commit of the adapter's `main` branch from GitHub, checks each file against the git hash the commit lists, and puts `billion-context-pi-pocket-adapter.ts` and its folder in Pi Pocket's `extensions` folder. Then it turns the extension on through Pi Pocket's API.
- **Update** shows when a newer commit is out, at each start and as often as the app looks for its own updates. It turns the extension off, swaps the files, and turns it on again. **Update automatically** does this without asking (off by default).
- **Uninstall** turns it off and removes those files. Its settings file (`billion-context-pi-pocket-adapter.json`) and its saved state stay.
- A copy installed by hand under another file name is left alone: the card says so.

With **Another server**, the card shows the command that installs it on that server instead.

### Runner

Use the **Runner** card under **Server tools**, or the **Runner** link at the top of Server settings. A runner lets your server use this computer's files and commands. The agent, models, API keys, and history stay on the server. No SSH or open port is needed.

1. Open your server in the desktop app. Choose **Menu → Runners → Link a computer → Link this computer**. The app installs Node.js and Pi Pocket if needed, then links this computer with a one-time code.
2. Under **Menu → Runners**, choose **New session** on this computer and pick a folder. The session title shows which computer it uses.
3. Keep the app open, including in the tray. The **Runner** card shows the connection state. Use **Enable runner**, **Reconnect**, or **Unlink** to manage the link.

By default, the app asks before the server starts a new session or a copy of a session on this computer. The question shows the server, person, and folder; **Deny** is the default. A session can read and change files and run commands as you, also outside that folder. Turn off **Ask before new sessions** in the **Runner** card to start sessions without asking. The app saves the choice with `runner settings confirm on|off --config FILE`; no runner restart is needed. This needs a runner with session confirmation support; the card shows an error for an older runner.

When the runner is off or the app is closed, the server shows this computer as offline. Its sessions cannot use tools here until it reconnects. Running commands continue through a connection drop of up to 2 minutes.

**Link another computer:** open that section in the Runner card. On the server, choose **Menu → Runners → Link a computer**, then **Link another computer**. In a browser, choose **Make a link code** instead. The code expires after 10 minutes. On the other computer, install Node.js 22.19 or newer, then run:

```sh
npm install -g https://codeload.github.com/vitalNohj/pi-pocket/tar.gz/live-0.28
pi-pocket runner serve
```

Enter the server address and link code when asked. On Linux, the runner offers to start as a service at login. Run the command again to use the saved link.

**Access:** only you can start sessions on a computer you linked. These sessions are private by default. The server owner can enable **Share sessions on linked computers** under **Menu → Runners**. Anyone who can prompt a shared session can run commands on that computer.

The server must support runners. For now, use [vitalNohj/pi-pocket](https://github.com/vitalNohj/pi-pocket) `live-0.28`. This is also the version the app installs for **This computer**.

### Settings

Open **Server settings…** from the File menu, tray menu, Pi Pocket menu, or a right-click on the page. You can also press Ctrl+, (⌘, on macOS). This shortcut works even if the server page fails.

The top links go to **Connection**, **App preferences**, **Runner**, and **Server tools**. Connection comes first. App preferences follow, then server tools. Most cards start closed. Each card has a short description. Ports, timeouts, limits, and update intervals are in closed **Advanced** sections.

| Section | Card | What it controls |
|---|---|---|
| Connection | **Pi Pocket on this computer** | Install and run the server here. Choose a session folder and who can connect. Server updates are separate from app updates. |
| Connection | **Another server** | Enter a full address or a host and port. Check it, then connect. |
| Connection | **Get the server** | Set up Pi Pocket on another computer. Shown with **Another server**. |
| App preferences | **Window** | Startup, tray, title bar, links, and the global shortcut. |
| App preferences | **Appearance** | Background transparency, opacity, and system effects. |
| App preferences | **Notifications** | Desktop alerts, sound, and approval buttons. |
| App preferences | **Dictation** | Download speech models and turn speech into text on this computer. |
| App preferences | **Updates** | Desktop app updates. The check interval is in **Advanced**. |
| Server tools | **Runner** | Let your server use this computer's files and commands. See [Runner](#runner). |
| Server tools | **Billion context** | Install context compression here, or get installation steps for your server. |
| Server tools | **Remote server** | Connect at startup, allow other addresses, and set check and retry limits. Shown with **Another server**. |

Use the server address you open in a browser, not a model API address. A failed check keeps your saved address and any working connection. The status shows **Connected** when Pi Pocket is open. To change servers, enter and check the new address before you connect.

If a sign-in page hides Pi Pocket, choose **Open webpage anyway**. This is available only for HTML pages. A **Server settings** button stays visible until Pi Pocket is detected. HTTP errors and other responses return to settings.

<img src="docs/images/settings.png" alt="The settings screen: the connection on the left, the Window settings on the right" width="100%" />

In **Remote server**, **Other allowed addresses** can include a sign-in page, such as Cloudflare Access. Enter one address per line, without a path. By default, **Advanced** uses a 10-second server check interval, 3 failed checks before reconnecting, a 30-second maximum retry delay, and a 4-second check timeout. The app keeps trying after a connection fails.

The settings are also a JSON file you can edit by hand. A value that is not valid falls back to its default, and the settings screen lists it.

| | |
|---|---|
| Linux | `~/.config/pi-pocket-gui/config.json` |
| macOS | `~/Library/Application Support/pi-pocket-gui/config.json` |
| Windows | `%APPDATA%\pi-pocket-gui\config.json` |

### Updates

The **Updates** card manages the desktop app, not the server. The app checks at startup and every 6 hours by default. Choose **Check now** to check manually. Change the interval in **Updates → Advanced**. Server updates are under **Connection → Pi Pocket on this computer → Server updates**.

- **Windows and the AppImage** download it and install it when the app restarts. The app asks first.
- **macOS:** until the app is signed by Apple, macOS will not let it replace itself. It downloads the new disk image to Downloads, checked against GitHub's checksum, then quits and opens it (macOS cannot replace an app that is running): drag the app into Applications over the old one, then open it again. Your settings and sign-in stay.
- **The .deb** opens the release page: install the new .deb the same way.

## How it talks to Pi Pocket

Pi Pocket's page runs in the app as it does in a browser, with one addition: a small, versioned bridge (`window.pocketHost`) through which the page tells the app about pins, the badge, and notifications, and the app tells the page when its window is hidden. The bridge is on a branch of Pi Pocket and not yet in a release: against a Pi Pocket without it, the app still works, without the tray pins, badge, and notifications, and says so once.

## Roadmap

Being worked on, none of it in the app yet:

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
