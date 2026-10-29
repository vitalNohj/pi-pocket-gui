# Pi Pocket (desktop)

A desktop app for [Pi Pocket](https://github.com/TannerMidd/pi-pocket). It connects to a Pi Pocket server that already runs, on this computer or another one, and adds what a browser tab cannot: a tray with your pinned sessions, a badge, native notifications, a global shortcut, launch at login, and offline dictation.

It does not install or run a server. Start one first:

```bash
npm install -g pi-pocket && pi-pocket
```

Then open the app, put the server's address (default `http://127.0.0.1:8787`), and sign in inside Pi Pocket with your login link or an invite.

> Status: early. Linux first; macOS and Windows builds follow. See [DESIGN.md](DESIGN.md).

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

## License

MIT. Pi Pocket's icon is MIT too ([assets/NOTICE.md](assets/NOTICE.md)).
