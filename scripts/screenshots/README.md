# README screenshots

Everything in them is made up: the people, folders, sessions, and the model's answers.

1. Start a Pi Pocket with demo data (a checkout of Pi Pocket with the desktop bridge, for its test helpers):

   ```bash
   mkdir -p /tmp/pp-demo/home
   HOME=/tmp/pp-demo/home PI_POCKET_SRC=~/pi-pocket node scripts/screenshots/demo-server.mts
   ```

   Its first line is JSON with the owner's sign-in link.

2. Run the built app at 2× against it (`http://127.0.0.3:8898`), with DevTools on, and sign in with that link:

   ```bash
   PI_POCKET_GUI_USER_DATA=/tmp/pp-shots xvfb-run -a -s "-screen 0 2880x1900x24" \
       ./node_modules/.bin/electron . --force-device-scale-factor=2 --remote-debugging-port=9334 --remote-allow-origins='*'
   ```

3. Take the raw shots with `scripts/dev/cdp.mjs shot` (`CDP_PORT=9334`) into one folder, as `mac-solid.png`, `mac-clear.png`
   (with the see-through CSS on and `CDP_CLEAR=1`), `mac-light.png`, `win-solid.png`, and `settings.png`. For the macOS
   layout on Linux, make the page's `navigator.windowControlsOverlay.getTitlebarAreaRect()` return the Mac's rectangle
   (`new DOMRect(76, 0, innerWidth - 76, 28)`) and dispatch `geometrychange`.

   For the notch around the window's buttons, the server must run Pi Pocket's `desktop-bridge` branch (it draws the
   notch), or the app must be one that adds it. The sidebar shows pinned sessions from `localStorage["pocket.pinned"]`
   (`[74, 60, 18]` for the demo's sessions).

   On Windows: give the demo a home outside your own (for example `C:\pp-demo\home`), so your own `.agents/skills` does
   not bring up a trust prompt. Run the app at 1× with the window at 1360×860 and capture each page at `scale: 2`,
   with `--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows` so a covered window
   still paints. Pi Pocket shows a Windows folder by its whole path in the top bar: set that line's text to the folder's
   name (`aurora-api`) before each shot.

4. Frame them (`frame.html`: a window with traffic lights or Windows' buttons, a shadow, and a background):

   ```bash
   SCALE=2 CHROME=/path/to/chrome node scripts/screenshots/frame.mjs <raw-folder> docs/images
   ```
