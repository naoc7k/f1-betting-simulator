#!/usr/bin/env python3
"""
F1 Betting Simulator - Authoritative Multiplayer, Admin & Balance Server
Runs on port 8080 with zero external dependencies.
"""
import hashlib
import hmac
import http.server
import json
import os
import secrets
import socketserver
import threading
import time
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("PORT", 8080))
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
PLAYERS_DB_PATH = os.path.join(ROOT_DIR, "players_db.json")

INITIAL_CHIPS = 100.0
ADMIN_LOGIN = "LN"
ADMIN_PASSWORD_HASH = hashlib.sha256("jairo".encode("utf-8")).hexdigest()

STATE_LOCK = threading.Lock()
ROOMS = {}         # code -> { "state": dict, "actions": list, "updatedAt": float, "heartbeats": {pid: float} }
PLAYERS_DB = {}    # pid -> { "id", "name", "avatarId", "chips", "wins", "updatedAt", "balanceVersion", "lastAdminNote" }
ADMIN_TOKENS = {}  # token -> expiry_ts


def r2(val):
    try:
        return round(float(val), 2)
    except Exception:
        return 0.0


def load_players_db():
    global PLAYERS_DB
    if os.path.exists(PLAYERS_DB_PATH):
        try:
            with open(PLAYERS_DB_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    PLAYERS_DB = data
        except Exception:
            PLAYERS_DB = {}


def save_players_db():
    try:
        with open(PLAYERS_DB_PATH, "w", encoding="utf-8") as f:
            json.dump(PLAYERS_DB, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


load_players_db()


def verify_admin_token(token):
    if not token:
        return False
    now = time.time()
    exp = ADMIN_TOKENS.get(token)
    if not exp or now > exp:
        ADMIN_TOKENS.pop(token, None)
        return False
    # Extend session on activity
    ADMIN_TOKENS[token] = now + 86400
    return True


def upsert_player_record(p_data, trust_client_chips=True):
    """
    Registers or updates a player in PLAYERS_DB.
    If the admin has modified a player's balance on the server (higher balanceVersion),
    the server's authoritative balance overrides older client snapshots.
    """
    if not p_data or not p_data.get("id"):
        return None
    pid = str(p_data["id"])
    now = time.time()
    existing = PLAYERS_DB.get(pid)
    client_ver = int(p_data.get("balanceVersion", 0) or 0)

    if not existing:
        chips_val = r2(p_data.get("chips", INITIAL_CHIPS))
        # Clamp legacy 25000 default to 100 if fresh v2 migration without bets
        if chips_val == 25000 and int(p_data.get("wins", 0) or 0) == 0:
            chips_val = INITIAL_CHIPS
        rec = {
            "id": pid,
            "name": str(p_data.get("name") or "Piloto").strip()[:24],
            "avatarId": str(p_data.get("avatarId") or "av1"),
            "chips": chips_val,
            "wins": int(p_data.get("wins", 0) or 0),
            "balanceVersion": max(1, client_ver),
            "updatedAt": now,
            "lastAdminOp": None
        }
        PLAYERS_DB[pid] = rec
        save_players_db()
        return rec

    existing["name"] = str(p_data.get("name") or existing["name"]).strip()[:24]
    existing["avatarId"] = str(p_data.get("avatarId") or existing.get("avatarId", "av1"))
    if "wins" in p_data and p_data["wins"] is not None:
        existing["wins"] = max(existing.get("wins", 0), int(p_data["wins"] or 0))

    server_ver = int(existing.get("balanceVersion", 1) or 1)
    if trust_client_chips and "chips" in p_data and p_data["chips"] is not None:
        if client_ver >= server_ver:
            existing["chips"] = max(0.0, r2(p_data["chips"]))
            existing["balanceVersion"] = max(server_ver, client_ver)

    existing["updatedAt"] = now
    save_players_db()
    return existing


def sync_room_player_balances(room_state):
    """Ensures every player in the room state reflects the authoritative server balance if admin updated it."""
    if not room_state or "players" not in room_state:
        return
    for p in room_state["players"]:
        pid = p.get("id")
        if pid and pid in PLAYERS_DB:
            rec = PLAYERS_DB[pid]
            p_ver = int(p.get("balanceVersion", 0) or 0)
            s_ver = int(rec.get("balanceVersion", 1) or 1)
            if s_ver > p_ver:
                p["chips"] = rec["chips"]
                p["balanceVersion"] = s_ver
            else:
                rec["chips"] = r2(p.get("chips", rec["chips"]))
                rec["balanceVersion"] = max(s_ver, p_ver)


def ensure_authorized_creator(room_entry):
    """
    Guarantees that exactly ONE player in the room has race creation authority (creatorId / hostId).
    Assigned when the first authorized player enters the lobby, or reassigned if the creator leaves the room.
    """
    state = room_entry.get("state")
    if not state:
        return
    players = state.get("players", [])
    creator_id = state.get("creatorId") or state.get("hostId")

    # Check if current creator is still in the room
    creator_in_room = next((p for p in players if p.get("id") == creator_id), None)
    if not creator_in_room and players:
        # Assign to first online player or first player in lobby
        online_p = next((p for p in players if p.get("online", True)), players[0])
        creator_id = online_p.get("id")

    state["creatorId"] = creator_id
    state["hostId"] = creator_id
    for p in players:
        is_c = (p.get("id") == creator_id)
        p["isHost"] = is_c
        p["isCreator"] = is_c


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
        is_online = (now - last) < 8.5
        if p.get("online") != is_online:
            p["online"] = is_online
            changed = True
    ensure_authorized_creator(room_entry)
    sync_room_player_balances(state)
    if changed:
        room_entry["updatedAt"] = now


def validate_incoming_room_state(existing_state, incoming_state, sender_pid):
    """
    Server-side security & rule enforcement:
    1. Only the authorized creator (creatorId/hostId) can create a new race or control race lifecycle.
    2. Once betting window is closed (bettingCloseLockedForRound == round), it CANNOT be reopened in the same round.
    """
    if not existing_state:
        return incoming_state, None

    creator_id = existing_state.get("creatorId") or existing_state.get("hostId")

    # Prevent non-creators from overwriting room config or creating/starting races
    if creator_id and sender_pid and sender_pid != creator_id:
        return existing_state, "UNAUTHORIZED_NOT_CREATOR"

    old_race = existing_state.get("race")
    new_race = incoming_state.get("race")

    if old_race and new_race and old_race.get("id") == new_race.get("id"):
        old_round = int(old_race.get("round", 0) or 0)
        new_round = int(new_race.get("round", 0) or 0)
        # Rule 1: If betting was already closed in this same round, block reopening it!
        if not old_race.get("bettingOpen", True) and new_race.get("bettingOpen", False) and new_round == old_round:
            new_race["bettingOpen"] = False

        # Preserve locked bets
        old_locked_ids = {b.get("id") for b in old_race.get("bets", []) if b.get("locked")}
        for b in new_race.get("bets", []):
            if b.get("id") in old_locked_ids or not new_race.get("bettingOpen", True):
                b["locked"] = True

    return incoming_state, None


class F1RequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def log_message(self, format, *args):
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
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token")
        self.end_headers()
        self.wfile.write(body)

    def _get_admin_token(self, payload=None, qs=None):
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            return auth[7:].strip()
        hdr = self.headers.get("X-Admin-Token", "")
        if hdr:
            return hdr.strip()
        if payload and isinstance(payload, dict) and payload.get("token"):
            return str(payload["token"]).strip()
        if qs and "token" in qs:
            return qs["token"][0]
        return ""

    def do_OPTIONS(self):
        self._send_json(200, {"ok": True})

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path == "/api/health":
            return self._send_json(200, {"ok": True, "server": "python", "ts": time.time()})

        # Admin: Get all registered players & balances
        if path == "/api/admin/players":
            token = self._get_admin_token(qs=qs)
            with STATE_LOCK:
                if not verify_admin_token(token):
                    return self._send_json(401, {"ok": False, "error": "UNAUTHORIZED_ADMIN"})
                players_list = sorted(
                    list(PLAYERS_DB.values()),
                    key=lambda x: x.get("updatedAt", 0),
                    reverse=True
                )
                return self._send_json(200, {"ok": True, "players": players_list})

        # Player balance check
        if path.startswith("/api/player/"):
            parts = path.strip("/").split("/")
            if len(parts) >= 3:
                pid = parts[2]
                with STATE_LOCK:
                    rec = PLAYERS_DB.get(pid)
                    if not rec:
                        return self._send_json(404, {"ok": False, "error": "PLAYER_NOT_FOUND"})
                    return self._send_json(200, {"ok": True, "player": rec})

        if path.startswith("/api/room/"):
            parts = path.strip("/").split("/")
            if len(parts) >= 3:
                code = parts[2].upper()
                pid = qs.get("pid", [None])[0]
                with STATE_LOCK:
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
                    st = entry["state"]
                    creator_id = st.get("creatorId") or st.get("hostId")
                    is_host = (qs.get("host", ["0"])[0] == "1") and (not creator_id or pid == creator_id)
                    actions = entry.get("actions", [])
                    drained = list(actions) if is_host else []
                    if is_host and actions:
                        entry["actions"] = []
                    player_rec = PLAYERS_DB.get(pid) if pid else None
                    return self._send_json(200, {
                        "ok": True,
                        "state": st,
                        "actions": drained,
                        "updatedAt": entry["updatedAt"],
                        "me": player_rec
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

        # 1. Admin Login endpoint
        if path == "/api/admin/login":
            login = str(payload.get("login") or "").strip()
            password = str(payload.get("password") or "")
            pw_hash = hashlib.sha256(password.encode("utf-8")).hexdigest()
            login_ok = hmac.compare_digest(login, ADMIN_LOGIN)
            pw_ok = hmac.compare_digest(pw_hash, ADMIN_PASSWORD_HASH)
            if not (login_ok and pw_ok):
                return self._send_json(401, {"ok": False, "error": "Credenciais de administrador inválidas."})
            token = secrets.token_hex(24)
            with STATE_LOCK:
                ADMIN_TOKENS[token] = time.time() + 86400
                players_list = sorted(list(PLAYERS_DB.values()), key=lambda x: x.get("updatedAt", 0), reverse=True)
            return self._send_json(200, {
                "ok": True,
                "token": token,
                "admin": ADMIN_LOGIN,
                "players": players_list
            })

        # 2. Admin Logout
        if path == "/api/admin/logout":
            token = self._get_admin_token(payload)
            with STATE_LOCK:
                ADMIN_TOKENS.pop(token, None)
            return self._send_json(200, {"ok": True})

        # 3. Admin Balance Management (add, remove, set)
        if path == "/api/admin/balance":
            token = self._get_admin_token(payload)
            with STATE_LOCK:
                if not verify_admin_token(token):
                    return self._send_json(401, {"ok": False, "error": "Acesso negado: administrador não autenticado."})
                target_id = str(payload.get("playerId") or "").strip()
                op = str(payload.get("operation") or "").strip().lower()  # 'add' | 'remove' | 'set'
                try:
                    amount = r2(payload.get("amount", 0))
                except Exception:
                    return self._send_json(400, {"ok": False, "error": "Valor inválido."})

                if amount < 0:
                    return self._send_json(400, {"ok": False, "error": "O valor não pode ser negativo."})

                rec = PLAYERS_DB.get(target_id)
                if not rec:
                    return self._send_json(404, {"ok": False, "error": "Jogador não encontrado."})

                old_chips = r2(rec.get("chips", INITIAL_CHIPS))
                if op == "add":
                    new_chips = r2(old_chips + amount)
                    op_label = f"Admin adicionou +{amount:.2f} fichas"
                elif op == "remove":
                    new_chips = r2(max(0.0, old_chips - amount))
                    op_label = f"Admin removeu -{amount:.2f} fichas"
                elif op == "set":
                    new_chips = r2(max(0.0, amount))
                    op_label = f"Admin definiu o saldo para {new_chips:.2f} fichas"
                else:
                    return self._send_json(400, {"ok": False, "error": "Operação inválida (use add, remove ou set)."})

                rec["chips"] = new_chips
                rec["balanceVersion"] = int(rec.get("balanceVersion", 1) or 1) + 1
                rec["updatedAt"] = time.time()
                rec["lastAdminOp"] = {
                    "id": f"adm_{int(time.time()*1000)}_{secrets.token_hex(3)}",
                    "op": op,
                    "amount": amount,
                    "oldBalance": old_chips,
                    "newBalance": new_chips,
                    "label": op_label,
                    "ts": time.time()
                }
                save_players_db()

                # Propagate immediately to all active rooms where this player is present
                for r_entry in ROOMS.values():
                    st = r_entry.get("state")
                    if st and "players" in st:
                        for rp in st["players"]:
                            if rp.get("id") == target_id:
                                rp["chips"] = new_chips
                                rp["balanceVersion"] = rec["balanceVersion"]
                                r_entry["updatedAt"] = time.time()

                players_list = sorted(list(PLAYERS_DB.values()), key=lambda x: x.get("updatedAt", 0), reverse=True)
                return self._send_json(200, {
                    "ok": True,
                    "player": rec,
                    "players": players_list
                })

        # 4. Player Registration & Balance Sync endpoint
        if path == "/api/player/sync":
            p_obj = payload.get("player") or payload
            with STATE_LOCK:
                rec = upsert_player_record(p_obj, trust_client_chips=True)
                if not rec:
                    return self._send_json(400, {"ok": False, "error": "INVALID_PLAYER"})
                return self._send_json(200, {"ok": True, "player": rec})

        # 5. Room State & Action endpoints
        if path.startswith("/api/room/"):
            parts = path.strip("/").split("/")
            if len(parts) >= 4:
                code = parts[2].upper()
                op = parts[3]
                now = time.time()
                with STATE_LOCK:
                    if op == "state":
                        state = payload.get("state")
                        if not state:
                            return self._send_json(400, {"ok": False, "error": "INVALID_STATE"})
                        pid = payload.get("pid")
                        existing_entry = ROOMS.get(code)
                        if existing_entry and existing_entry.get("state"):
                            validated_state, err = validate_incoming_room_state(existing_entry["state"], state, pid)
                            if err == "UNAUTHORIZED_NOT_CREATOR":
                                return self._send_json(403, {"ok": False, "error": err, "state": existing_entry["state"]})
                            state = validated_state

                        entry = ROOMS.setdefault(code, {"state": state, "actions": [], "updatedAt": now, "heartbeats": {}})
                        hbs = entry.setdefault("heartbeats", {})
                        if pid:
                            hbs[pid] = now

                        for p in state.get("players", []):
                            p_id = p.get("id")
                            upsert_player_record(p, trust_client_chips=True)
                            if p_id in hbs and (now - hbs[p_id]) < 8.5:
                                p["online"] = True
                            elif p_id not in hbs:
                                hbs[p_id] = now

                        entry["state"] = state
                        ensure_authorized_creator(entry)
                        sync_room_player_balances(entry["state"])
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

                        if action.get("player"):
                            upsert_player_record(action["player"], trust_client_chips=True)

                        if not entry:
                            if act_type == "CREATE_ROOM" and action.get("state"):
                                st = action["state"]
                                st["creatorId"] = pid or st.get("hostId")
                                st["hostId"] = st["creatorId"]
                                ROOMS[code] = {
                                    "state": st,
                                    "actions": [],
                                    "updatedAt": now,
                                    "heartbeats": {pid: now} if pid else {}
                                }
                                ensure_authorized_creator(ROOMS[code])
                                sync_room_player_balances(st)
                                return self._send_json(200, {"ok": True, "state": st})
                            return self._send_json(404, {"ok": False, "error": "ROOM_NOT_FOUND"})

                        if pid:
                            entry.setdefault("heartbeats", {})[pid] = now

                        st = entry.get("state")
                        creator_id = st.get("creatorId") or st.get("hostId") if st else None

                        # Block unauthorized players from sending race creation / config actions
                        if act_type in ("PREPARE_RACE", "START_RACE", "UPDATE_CONFIG", "CLOSE_BETTING") and creator_id and pid != creator_id:
                            return self._send_json(403, {"ok": False, "error": "Apenas o jogador autorizado da sala pode criar ou configurar corridas."})

                        if st and "players" in st:
                            if act_type == "JOIN_ROOM" and action.get("player"):
                                pl = action["player"]
                                pl["online"] = True
                                pl["lastSeen"] = now
                                rec = upsert_player_record(pl, trust_client_chips=True)
                                if rec:
                                    pl["chips"] = rec["chips"]
                                    pl["balanceVersion"] = rec["balanceVersion"]
                                existing = next((x for x in st["players"] if x.get("id") == pl.get("id")), None)
                                if existing:
                                    existing.update({
                                        "name": pl.get("name", existing.get("name")),
                                        "avatarId": pl.get("avatarId", existing.get("avatarId")),
                                        "avatarIcon": pl.get("avatarIcon", existing.get("avatarIcon")),
                                        "color": pl.get("color", existing.get("color")),
                                        "chips": pl.get("chips", existing.get("chips")),
                                        "balanceVersion": pl.get("balanceVersion", existing.get("balanceVersion", 1)),
                                        "online": True,
                                        "lastSeen": now
                                    })
                                else:
                                    if len(st["players"]) < 8:
                                        st["players"].append(pl)
                                ensure_authorized_creator(entry)
                                entry["updatedAt"] = now

                            elif act_type in ("PLACE_BET", "CANCEL_BET") and pid:
                                # Validate betting window is actually open on server
                                race = st.get("race")
                                if race and (race.get("done") or race.get("running") or not race.get("bettingOpen", False)):
                                    return self._send_json(400, {"ok": False, "error": "A janela de apostas já está encerrada."})
                                if typeof_num(action.get("playerChips")):
                                    new_c = r2(action["playerChips"])
                                    for x in st["players"]:
                                        if x.get("id") == pid:
                                            x["chips"] = new_c
                                            x["balanceVersion"] = int(x.get("balanceVersion", 1) or 1) + 1
                                            upsert_player_record(x, trust_client_chips=True)

                            elif act_type == "DISCONNECT" and pid:
                                entry.setdefault("heartbeats", {})[pid] = 0
                                for x in st["players"]:
                                    if x.get("id") == pid:
                                        x["online"] = False
                                entry["updatedAt"] = now

                            elif act_type == "LEAVE_ROOM" and pid:
                                st["players"] = [x for x in st["players"] if x.get("id") != pid]
                                entry.setdefault("heartbeats", {}).pop(pid, None)
                                ensure_authorized_creator(entry)
                                entry["updatedAt"] = now

                        entry.setdefault("actions", []).append(action)
                        cleanup_presence(entry)
                        return self._send_json(200, {"ok": True, "state": entry["state"]})

        return self._send_json(404, {"ok": False, "error": "NOT_FOUND"})


def typeof_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    with ThreadedHTTPServer(("0.0.0.0", PORT), F1RequestHandler) as httpd:
        print(f"F1 Betting Simulator Server rodando em http://localhost:{PORT}")
        httpd.serve_forever()
