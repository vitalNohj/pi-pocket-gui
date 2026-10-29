#!/usr/bin/env bash
# Runs the built app on a virtual screen (Xvfb) with DevTools on port 9333, for testing on a machine without a
# display. Pass --fresh to start with empty settings. Data goes to /tmp/gui-data unless PI_POCKET_GUI_USER_DATA is set.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PI_POCKET_GUI_USER_DATA="${PI_POCKET_GUI_USER_DATA:-/tmp/gui-data}"

if [[ "${1:-}" == "--fresh" ]]; then
    rm -rf "$PI_POCKET_GUI_USER_DATA"
    shift
fi

exec xvfb-run -a -s "-screen 0 1280x860x24" ./node_modules/.bin/electron . \
    --remote-debugging-port="${CDP_PORT:-9333}" --remote-allow-origins='*' "$@"
