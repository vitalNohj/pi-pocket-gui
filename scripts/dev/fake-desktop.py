#!/usr/bin/env python3
"""A desktop for testing on a machine without one: on the session bus it owns a notification server
(org.freedesktop.Notifications) and a tray watcher (org.kde.StatusNotifierWatcher), so the app shows its tray and
notifications. Each notification is written as one JSON line to $FAKE_DESKTOP_LOG. To press a notification's button,
or to click it, call this script's own method:

    gdbus call --session --dest org.freedesktop.Notifications --object-path /org/freedesktop/Notifications \
        --method dev.fake.Notifications.Invoke <id> <action-key>      # "default" is a click

Run it with `dbus-run-session -- sh -c 'python3 fake-desktop.py & exec <app>'` (scripts/dev/run-desktop.sh does).
"""
import json
import os
import sys

import dbus
import dbus.service
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib

LOG = os.environ.get("FAKE_DESKTOP_LOG", "/tmp/fake-desktop.jsonl")


def log(record):
    with open(LOG, "a", encoding="utf-8") as out:
        out.write(json.dumps(record) + "\n")


class Notifications(dbus.service.Object):
    def __init__(self, bus):
        super().__init__(bus, "/org/freedesktop/Notifications")
        self.next_id = 1

    @dbus.service.method("org.freedesktop.Notifications", out_signature="as")
    def GetCapabilities(self):
        return ["actions", "body", "body-markup", "icon-static", "persistence"]

    @dbus.service.method("org.freedesktop.Notifications", in_signature="susssasa{sv}i", out_signature="u")
    def Notify(self, app_name, replaces_id, icon, summary, body, actions, hints, timeout):
        nid = int(replaces_id) if replaces_id else self.next_id
        self.next_id = max(self.next_id, nid) + 1
        log({
            "event": "notify",
            "id": nid,
            "replaces": int(replaces_id),
            "app": str(app_name),
            "summary": str(summary),
            "body": str(body),
            "actions": [str(a) for a in actions],
            "urgency": int(hints["urgency"]) if "urgency" in hints else None,
            "timeout": int(timeout),
        })
        return nid

    @dbus.service.method("org.freedesktop.Notifications", in_signature="u")
    def CloseNotification(self, nid):
        log({"event": "close", "id": int(nid)})
        self.NotificationClosed(nid, 3)

    @dbus.service.method("org.freedesktop.Notifications", out_signature="ssss")
    def GetServerInformation(self):
        return ("fake-desktop", "dev", "1", "1.2")

    @dbus.service.signal("org.freedesktop.Notifications", signature="uu")
    def NotificationClosed(self, nid, reason):
        pass

    @dbus.service.signal("org.freedesktop.Notifications", signature="us")
    def ActionInvoked(self, nid, key):
        pass

    @dbus.service.method("dev.fake.Notifications", in_signature="us")
    def Invoke(self, nid, key):
        log({"event": "invoke", "id": int(nid), "key": str(key)})
        self.ActionInvoked(nid, key)
        self.NotificationClosed(nid, 2)


class Watcher(dbus.service.Object):
    def __init__(self, bus):
        super().__init__(bus, "/StatusNotifierWatcher")
        self.items = []

    @dbus.service.method("org.kde.StatusNotifierWatcher", in_signature="s", sender_keyword="sender")
    def RegisterStatusNotifierItem(self, service, sender=None):
        item = service if service.startswith(":") else f"{sender}{service}"
        self.items.append(item)
        log({"event": "tray", "item": item})
        self.StatusNotifierItemRegistered(item)

    @dbus.service.method("org.kde.StatusNotifierWatcher", in_signature="s")
    def RegisterStatusNotifierHost(self, service):
        pass

    @dbus.service.signal("org.kde.StatusNotifierWatcher", signature="s")
    def StatusNotifierItemRegistered(self, item):
        pass

    @dbus.service.method("org.freedesktop.DBus.Properties", in_signature="ss", out_signature="v")
    def Get(self, interface, prop):
        return self.GetAll(interface)[prop]

    @dbus.service.method("org.freedesktop.DBus.Properties", in_signature="s", out_signature="a{sv}")
    def GetAll(self, interface):
        return {
            "RegisteredStatusNotifierItems": dbus.Array(self.items, signature="s"),
            "IsStatusNotifierHostRegistered": True,
            "ProtocolVersion": dbus.Int32(0),
        }


def main():
    DBusGMainLoop(set_as_default=True)
    bus = dbus.SessionBus()
    keep = [
        dbus.service.BusName("org.freedesktop.Notifications", bus),
        dbus.service.BusName("org.kde.StatusNotifierWatcher", bus),
        Notifications(bus),
        Watcher(bus),
    ]
    log({"event": "ready", "pid": os.getpid()})
    print("fake desktop ready", file=sys.stderr, flush=True)
    GLib.MainLoop().run()
    del keep


if __name__ == "__main__":
    main()
