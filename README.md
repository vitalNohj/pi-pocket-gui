# Pi Pocket (desktop)

A desktop app for [Pi Pocket](https://github.com/TannerMidd/pi-pocket). It connects to a Pi Pocket server that already runs, on this computer or another one, and adds what a browser tab cannot: a tray with your pinned sessions, a badge, native notifications, a global shortcut, launch at login, and offline dictation.

It does not install or run a server. Start one first:

```bash
npm install -g pi-pocket && pi-pocket
```

Then open the app, put the server's address (default `http://127.0.0.1:8787`), and sign in inside Pi Pocket with your login link or an invite.

> Status: early. See [DESIGN.md](DESIGN.md).

## Install

Download the file for your computer from [Releases](https://github.com/vitalNohj/pi-pocket-gui/releases/latest):

- **macOS:** `…-mac-arm64.dmg` (Apple Silicon) or `…-mac-x64.dmg` (Intel). Open it and drag the app into Applications. The app is not signed by Apple yet, so the first time, right-click it and choose **Open**; if macOS still refuses, use **Open Anyway** in System Settings → Privacy & Security, or run `xattr -cr /Applications/pi-pocket-gui.app`.
- **Windows:** `…-win-x64.exe`. Windows SmartScreen warns about an unsigned app: **More info** → **Run anyway**.
- **Linux:** `…-linux-x86_64.AppImage` (make it executable and run it), or `…-linux-amd64.deb`.

### Updates

The app looks for a new release at start and every 6 hours (Server settings… → Updates).

- **Windows and the AppImage** download it and install it when the app restarts; the app asks first.
- **macOS:** until the app is signed by Apple, macOS will not let it replace itself. It downloads the new disk image to Downloads, checked against GitHub's checksum, and opens it: drag the app into Applications over the old one. Settings and your sign-in stay.
- **The .deb** opens the release page: install the new .deb the same way.

## Settings

Everything is in **Server settings…** (the File menu, the tray, or Ctrl+,), and in a JSON file you can edit by hand:

- Linux: `~/.config/pi-pocket-gui/config.json`
- macOS: `~/Library/Application Support/pi-pocket-gui/config.json`
- Windows: `%APPDATA%\pi-pocket-gui\config.json`

A value that is not valid falls back to its default, and the settings screen lists it.

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

## License

MIT. Pi Pocket's icon is MIT too ([assets/NOTICE.md](assets/NOTICE.md)).
