#!/usr/bin/env bash
# Like run-headless.sh, on a private session bus with a fake desktop (fake-desktop.py): the tray shows, and each
# notification is logged to $FAKE_DESKTOP_LOG (default /tmp/fake-desktop.jsonl). The bus's address is written to
# /tmp/gui-bus, for gdbus calls from another shell: DBUS_SESSION_BUS_ADDRESS=$(cat /tmp/gui-bus) gdbus …
set -euo pipefail
cd "$(dirname "$0")/../.."
export FAKE_DESKTOP_LOG="${FAKE_DESKTOP_LOG:-/tmp/fake-desktop.jsonl}"
: > "$FAKE_DESKTOP_LOG"

exec dbus-run-session -- bash -c '
    echo "$DBUS_SESSION_BUS_ADDRESS" > /tmp/gui-bus
    python3 scripts/dev/fake-desktop.py &
    for _ in $(seq 50); do grep -q ready "$FAKE_DESKTOP_LOG" && break; sleep 0.1; done
    exec scripts/dev/run-headless.sh "$@"
' run-desktop "$@"
