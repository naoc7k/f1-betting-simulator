#!/usr/bin/env python3
"""
F1 Betting Simulator - Authoritative Multiplayer & Static Web Server
Runs on port 8080 with zero external dependencies.
"""
import http.server
import json
import os
import socketserver
import threading
import time
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("PORT", 8080))
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

ROOMS_LOCK = threading.Lock()
ROOMS = {}  # code -> { "state": dict, "actions": list, "updatedAt": float, "heartbeats": {pid: float} }


def cleanup_presence(room_entry):
    now = time.time()
    state = room_entry.get("state")
    if not state or "players" not in state:
        return
    hbs = room_entry.get("heartbeats", {})
    changed = False
    for p in state["players"]:
        pid = p.get("id")
        last = hbs.get(pid, p.get("lastSeen", now))
        is_online = (now - last) < 8.0
        if p.get("online") != is_online:
            p["online"] = is_online
            changed = True
    if changed:
        room_entry["updatedAt"] = now


class F1RequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def log_message(self, format, *args):
        # Quiet logging for frequent polling ticks
        if "/api/" in (args[0] if args else ""):
            return
        super().log_message(format, *args)

    def _send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send_json(200, {"ok": True})

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path == "/api/health":
            return self._send_json(200, {"ok": True, "server": "python", "ts": time.time()})

        if path.startswith("/api/room/"):
            parts = path.strip("/").split("/")
            if len(parts) >= 3:
                code = parts[2].upper()
                pid = qs.get("pid", [None])[0]
                with ROOMS_LOCK:
                    entry = ROOMS.get(code)
                    if not entry:
                        return self._send_json(404, {"ok": False, "error": "ROOM_NOT_FOUND"})
                    if pid:
                        entry.setdefault("heartbeats", {})[pid] = time.time()
                        if entry.get("state") and "players" in entry["state"]:
                            for p in entry["state"]["players"]:
                                if p.get("id") == pid:
                                    p["online"] = True
                                    p["lastSeen"] = time.time()
                    cleanup_presence(entry)
                    actions = entry.get("actions", [])
                    # If requested by host, drain pending actions
                    is_host = qs.get("host", ["0"])[0] == "1"
                    drained = list(actions) if is_host else []
                    if is_host and actions:
                        entry["actions"] = []
                    return self._send_json(200, {
                        "ok": True,
                        "state": entry["state"],
                        "actions": drained,
                        "updatedAt": entry["updatedAt"]
                    })

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {}

        if path.startswith("/api/room/"):
            parts = path.strip("/").split("/")
            if len(parts) >= 4:
                code = parts[2].upper()
                op = parts[3]
                now = time.time()
                with ROOMS_LOCK:
                    if op == "state":
                        state = payload.get("state")
                        if not state:
                            return self._send_json(400, {"ok": False, "error": "INVALID_STATE"})
                        entry = ROOMS.setdefault(code, {"state": state, "actions": [], "updatedAt": now, "heartbeats": {}})
                        hbs = entry.setdefault("heartbeats", {})
                        pid = payload.get("pid")
                        if pid:
                            hbs[pid] = now
                        # Preserve recent heartbeats on state update
                        for p in state.get("players", []):
                            p_id = p.get("id")
                            if p_id in hbs and (now - hbs[p_id]) < 8.0:
                                p["online"] = True
                            elif p_id not in hbs:
                                hbs[p_id] = now
                        entry["state"] = state
                        entry["updatedAt"] = now
                        cleanup_presence(entry)
                        drained = list(entry.get("actions", []))
                        entry["actions"] = []
                        return self._send_json(200, {"ok": True, "actions": drained, "state": entry["state"]})

                    elif op == "action":
                        entry = ROOMS.get(code)
                        action = payload.get("action") or {}
                        act_type = action.get("type")
                        pid = action.get("playerId") or (action.get("player") or {}).get("id")
                        if not entry:
                            if act_type == "CREATE_ROOM" and action.get("state"):
                                ROOMS[code] = {
                                    "state": action["state"],
                                    "actions": [],
                                    "updatedAt": now,
                                    "heartbeats": {pid: now} if pid else {}
                                }
                                return self._send_json(200, {"ok": True, "state": action["state"]})
                            return self._send_json(404, {"ok": False, "error": "ROOM_NOT_FOUND"})

                        if pid:
                            entry.setdefault("heartbeats", {})[pid] = now

                        # Direct state update for JOIN / LEAVE / HEARTBEAT / DISCONNECT so guests see immediate response
                        st = entry.get("state")
                        if st and "players" in st:
                            if act_type == "JOIN_ROOM" and action.get("player"):
                                pl = action["player"]
                                pl["online"] = True
                                pl["lastSeen"] = now
                                existing = next((x for x in st["players"] if x.get("id") == pl.get("id")), None)
                                if existing:
                                    existing.update({
                                        "name": pl.get("name", existing.get("name")),
                                        "avatar": pl.get("avatar", existing.get("avatar")),
                                        "color": pl.get("color", existing.get("color")),
                                        "chips": pl.get("chips", existing.get("chips")),
                                        "online": True,
                                        "lastSeen": now
                                    })
                                else:
                                    if len(st["players"]) < 8:
                                        st["players"].append(pl)
                                entry["updatedAt"] = now
                            elif act_type == "DISCONNECT" and pid:
                                entry.setdefault("heartbeats", {})[pid] = 0
                                for x in st["players"]:
                                    if x.get("id") == pid:
                                        x["online"] = False
                                entry["updatedAt"] = now
                            elif act_type == "LEAVE_ROOM" and pid:
                                st["players"] = [x for x in st["players"] if x.get("id") != pid]
                                entry.setdefault("heartbeats", {}).pop(pid, None)
                                entry["updatedAt"] = now

                        entry.setdefault("actions", []).append(action)
                        cleanup_presence(entry)
                        return self._send_json(200, {"ok": True, "state": entry["state"]})

        return self._send_json(404, {"ok": False, "error": "NOT_FOUND"})


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    with ThreadedHTTPServer(("0.0.0.0", PORT), F1RequestHandler) as httpd:
        print(f"F1 Betting Simulator Server rodando em http://localhost:{PORT}")
        httpd.serve_forever()
