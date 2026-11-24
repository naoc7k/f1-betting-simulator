#!/usr/bin/env python3
"""
F1 Betting Simulator - Authoritative Multiplayer, Admin & Financial Engine Server (Python 3)
Runs on port 8080 with zero external dependencies.

Enforces:
 - Server-authoritative player balances, committed chips, and transaction history
 - 50% initial race balance exposure limit across Overtake and Placement modalities
 - Account control by IP + Machine Fingerprint (1 account per machine, shared-network friendly)
 - Account ownership tokens preventing link-based account hijacking
 - Nickname-based room invitation system
 - Lobby kick/remove player by Creator or Admin with real-time sync
 - Public active rooms directory & spectator read-only access (spectators never added as participants)
 - Race continuity after mid-race player disconnection
 - Configurable initial balance for new accounts + global account search & deletion by Admin
"""
import hashlib
import hmac
import http.server
import json
import math
import os
import secrets
import socketserver
import threading
import time
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("PORT", 8080))
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
PLAYERS_DB_PATH = os.path.join(ROOT_DIR, "players_db.json")
SERVER_CONFIG_PATH = os.path.join(ROOT_DIR, "server_config.json")

DEFAULT_INITIAL_CHIPS = 100.0
EXPOSURE_RATE = 0.50
OVERTAKE_FACTOR_F = 0.20
MAX_OVERTAKE_RETURN_MULT = 5.0
HOUSE_MARGIN = 0.06
MIN_ODD = 1.00
MAX_ODD = 15.00
MODEL_VERSION = "F1_ECON_V4.1_MC1000"

ADMIN_LOGIN = "LN"
ADMIN_PASSWORD_HASH = hashlib.sha256("jairo".encode("utf-8")).hexdigest()

STATE_LOCK = threading.Lock()
ROOMS = {}                 # code -> { "state": dict, "actions": list, "updatedAt": float, "heartbeats": {pid: float} }
PLAYERS_DB = {}            # pid -> dict
ADMIN_TOKENS = {}          # token -> expiry_ts
PROCESSED_BET_IDS = set()
PROCESSED_SETTLEMENTS = set()
INVITES = {}               # key (lowercase name or pid) -> list of invite dicts

SERVER_CONFIG = {
    "initialChips": DEFAULT_INITIAL_CHIPS,
    "updatedAt": time.time(),
    "adminLogs": []
}

DRIVERS_CATALOG = [
    {"id": "NOR", "name": "Lando Norris",      "team": "MCL", "num": 4,  "skill": -0.22, "ov": 0.89},
    {"id": "PIA", "name": "Oscar Piastri",     "team": "MCL", "num": 81, "skill": -0.18, "ov": 0.88},
    {"id": "RUS", "name": "George Russell",    "team": "MER", "num": 63, "skill": -0.15, "ov": 0.86},
    {"id": "ANT", "name": "Kimi Antonelli",    "team": "MER", "num": 12, "skill": -0.04, "ov": 0.83},
    {"id": "VER", "name": "Max Verstappen",    "team": "RBR", "num": 1,  "skill": -0.32, "ov": 0.92},
    {"id": "HAD", "name": "Isack Hadjar",      "team": "RBR", "num": 6,  "skill":  0.03, "ov": 0.80},
    {"id": "LEC", "name": "Charles Leclerc",   "team": "FER", "num": 16, "skill": -0.19, "ov": 0.89},
    {"id": "HAM", "name": "Lewis Hamilton",    "team": "FER", "num": 44, "skill": -0.18, "ov": 0.90},
    {"id": "SAI", "name": "Carlos Sainz",      "team": "WIL", "num": 55, "skill": -0.10, "ov": 0.85},
    {"id": "ALB", "name": "Alexander Albon",   "team": "WIL", "num": 23, "skill": -0.05, "ov": 0.83},
    {"id": "LAW", "name": "Liam Lawson",       "team": "RB",  "num": 30, "skill":  0.02, "ov": 0.80},
    {"id": "LIN", "name": "Arvid Lindblad",    "team": "RB",  "num": 40, "skill":  0.07, "ov": 0.78},
    {"id": "ALO", "name": "Fernando Alonso",   "team": "AST", "num": 14, "skill": -0.14, "ov": 0.89},
    {"id": "STR", "name": "Lance Stroll",      "team": "AST", "num": 18, "skill":  0.08, "ov": 0.74},
    {"id": "CAM", "name": "Rafael Câmara",     "team": "HAA", "num": 88, "skill":  0.03, "ov": 0.81},
    {"id": "BEA", "name": "Oliver Bearman",    "team": "HAA", "num": 87, "skill":  0.04, "ov": 0.79},
    {"id": "HUL", "name": "Nico Hülkenberg",   "team": "AUD", "num": 27, "skill": -0.02, "ov": 0.81},
    {"id": "BOR", "name": "Gabriel Bortoleto", "team": "AUD", "num": 5,  "skill":  0.02, "ov": 0.82},
    {"id": "GAS", "name": "Pierre Gasly",      "team": "ALP", "num": 10, "skill": -0.03, "ov": 0.81},
    {"id": "COL", "name": "Franco Colapinto",  "team": "ALP", "num": 43, "skill":  0.05, "ov": 0.79},
    {"id": "BOT", "name": "Valtteri Bottas",   "team": "CAD", "num": 77, "skill": -0.02, "ov": 0.81},
    {"id": "PER", "name": "Sergio Pérez",      "team": "CAD", "num": 11, "skill": -0.04, "ov": 0.83}
]

TEAM_PACE = {
    "MCL": -0.06, "RBR": 0.0, "FER": 0.06, "MER": 0.14, "WIL": 0.45,
    "AST": 0.52, "RB": 0.56, "AUD": 0.65, "ALP": 0.68, "HAA": 0.70, "CAD": 0.72
}

PLACEMENT_MARKETS = {
    "P1":     "Vencedor (1º Lugar)",
    "P2":     "Segundo Colocado (2º)",
    "P3":     "Terceiro Colocado (3º)",
    "PODIUM": "Pódio (Top 3)",
    "TOP5":   "Top 5 (1º ao 5º)",
    "TOP10":  "Top 10 (Zona de Pontos)"
}


def r2(val):
    try:
        return round(float(val), 2)
    except Exception:
        return 0.0


def floor2(val):
    try:
        return math.floor((float(val) + 1e-9) * 100.0) / 100.0
    except Exception:
        return 0.0


def get_initial_chips():
    try:
        val = float(SERVER_CONFIG.get("initialChips", DEFAULT_INITIAL_CHIPS))
        return r2(val) if val >= 0 else DEFAULT_INITIAL_CHIPS
    except Exception:
        return DEFAULT_INITIAL_CHIPS


def load_server_config():
    global SERVER_CONFIG
    if os.path.exists(SERVER_CONFIG_PATH):
        try:
            with open(SERVER_CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    if "initialChips" in data and float(data["initialChips"]) >= 0:
                        SERVER_CONFIG["initialChips"] = r2(data["initialChips"])
                    if isinstance(data.get("adminLogs"), list):
                        SERVER_CONFIG["adminLogs"] = data["adminLogs"][:200]
        except Exception:
            pass
    else:
        save_server_config()


def save_server_config():
    try:
        with open(SERVER_CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(SERVER_CONFIG, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def append_admin_log(action, detail, extra=None):
    logs = SERVER_CONFIG.setdefault("adminLogs", [])
    entry = {
        "id": f"alog_{int(time.time()*1000)}_{secrets.token_hex(3)}",
        "action": action,
        "detail": detail,
        "ts": time.time(),
        "date": time.strftime("%d/%m/%Y %H:%M:%S")
    }
    if isinstance(extra, dict):
        entry.update(extra)
    logs.insert(0, entry)
    if len(logs) > 200:
        del logs[200:]
    save_server_config()
    return entry


load_server_config()


def sanitize_player_for_public(rec):
    if not rec:
        return None
    copy = dict(rec)
    copy.pop("authToken", None)
    return copy


def find_account_for_machine(machine_id, client_ip):
    if machine_id:
        for rec in PLAYERS_DB.values():
            if rec.get("machineId") and rec["machineId"] == machine_id:
                return rec
    if not machine_id and client_ip:
        for rec in PLAYERS_DB.values():
            if not rec.get("machineId") and rec.get("clientIp") == client_ip:
                return rec
    return None


def find_player_by_nickname(nickname):
    clean = str(nickname or "").strip().lower()
    if not clean:
        return None
    for rec in PLAYERS_DB.values():
        if str(rec.get("name") or "").strip().lower() == clean or str(rec.get("id") or "").lower() == clean:
            return rec
    return None


def is_protected_account_name(name):
    raw = str(name or "").strip().lower()
    if not raw:
        return False
    compact = "".join(ch for ch in raw if ch not in " _-.")
    if compact in ("lx", "lxz", "lxzada"):
        return True
    if "lxzada" in compact or compact.startswith("lxz"):
        return True
    if compact in ("naoc7k", "n7k", "naoc") or "naoc7k" in compact or "n7k" in compact:
        return True
    return False


def purge_non_protected_accounts():
    kept = []
    removed = []
    for pid, rec in list(PLAYERS_DB.items()):
        if rec and is_protected_account_name(rec.get("name")):
            kept.append({"id": pid, "name": rec.get("name"), "chips": rec.get("chips", 0)})
        else:
            removed.append({"id": pid, "name": rec.get("name") if rec else pid})
            PLAYERS_DB.pop(pid, None)
    for r_entry in ROOMS.values():
        st = r_entry.get("state")
        if not st:
            continue
        if "players" in st:
            st["players"] = [p for p in st["players"] if p and is_protected_account_name(p.get("name"))]
        if st.get("race") and "bets" in st["race"]:
            st["race"]["bets"] = [b for b in st["race"]["bets"] if b.get("pid") in PLAYERS_DB]
        ensure_authorized_creator(r_entry)
    save_players_db()
    return {"kept": kept, "removed": removed}


def get_lap_multiplier(lap):
    L = max(0, int(lap or 0))
    if L == 0:
        return 1.0
    bracket = (L - 1) // 10
    m = 0.9 - bracket * 0.1
    return max(0.1, round(m, 1))


def calculate_expected_overtakes(race, driver_id):
    if not race or not driver_id:
        return 0
    active_order = race.get("order") or race.get("start") or [d["id"] for d in DRIVERS_CATALOG]
    if driver_id not in active_order:
        return 0
    drv_map = race.get("drv") or {}
    ds = drv_map.get(driver_id) or {}
    if ds.get("st") in ("dnf", "dns"):
        return 0

    total_laps = max(1, int(race.get("total", 15) or 15))
    current_lap = max(0, int(race.get("lap", 0) or 0))
    remaining_laps = max(0, total_laps - current_lap)
    if remaining_laps <= 0:
        return 0

    running_drivers = [i for i in active_order if (drv_map.get(i) or {}).get("st", "run") == "run"]
    if driver_id not in running_drivers:
        return 0

    pace_scores = {}
    for i in running_drivers:
        d_obj = next((x for x in DRIVERS_CATALOG if x["id"] == i), {"team": "CAD", "skill": 0.05, "ov": 0.80})
        t_pace = TEAM_PACE.get(d_obj["team"], 0.55)
        pace_scores[i] = t_pace + float(d_obj.get("skill", 0.05))

    sorted_by_pace = sorted(running_drivers, key=lambda x: pace_scores[x])
    natural_rank = sorted_by_pace.index(driver_id) + 1
    my_running_pos = running_drivers.index(driver_id) + 1

    d_obj = next((x for x in DRIVERS_CATALOG if x["id"] == driver_id), {"team": "CAD", "skill": 0.05, "ov": 0.80})
    ov_rating = float(d_obj.get("ov", 0.80))
    circuit_ot = float((race.get("circuit") or {}).get("ot", 0.50) or 0.50)
    wetness = float(race.get("w", 0.0) or 0.0)

    expected_from_deficit = 0.0
    my_pace = pace_scores.get(driver_id, 0.5)
    for idx in range(my_running_pos - 1):
        ahead_id = running_drivers[idx]
        ahead_pace = pace_scores.get(ahead_id, 0.5)
        adv = ahead_pace - my_pace
        if adv > 0.02:
            pass_ease = min(1.0, (adv * 1.45 + (ov_rating - 0.75) * 1.2) * (0.55 + circuit_ot * 0.9))
            prob_rem = 1.0 - math.pow(1.0 - min(0.45, pass_ease * 0.16), remaining_laps)
            expected_from_deficit += prob_rem
        elif adv > -0.12 and ((my_running_pos - 1) - idx) <= 3:
            expected_from_deficit += 0.18 * circuit_ot * (ov_rating / 0.85) * min(1.0, remaining_laps / 12.0)

    lap_factor = min(1.6, remaining_laps / 12.0)
    weather_factor = 1.0 + wetness * 0.22
    track_factor = 0.6 + circuit_ot * 0.85
    pos_opp = 0.15 if my_running_pos <= 1 else (0.55 if my_running_pos <= 4 else (0.95 if my_running_pos <= 12 else 1.15))
    battle_exp = pos_opp * lap_factor * track_factor * weather_factor * (ov_rating / 0.82) * 0.85

    expected_int = round(expected_from_deficit + battle_exp)
    if my_running_pos > natural_rank + 1 and remaining_laps >= 5:
        min_def = max(1, round((my_running_pos - natural_rank) * (0.35 + circuit_ot * 0.35) * min(1.0, remaining_laps / 10.0)))
        expected_int = max(expected_int, min_def)

    return max(0, min(len(running_drivers) + 5, int(expected_int)))


def calculate_overtake_payout(stake, actual_ov, expected_ov, mult, factor_f=OVERTAKE_FACTOR_F):
    S = r2(max(0.0, float(stake or 0.0)))
    O = max(0, int(actual_ov or 0))
    E = max(0, int(expected_ov or 0))
    M = float(mult or 1.0)
    F = float(factor_f or OVERTAKE_FACTOR_F)
    if S <= 0:
        return {"won": False, "excessOvertakes": 0, "profit": 0.0, "totalReturn": 0.0, "netProfit": 0.0, "capped": False}
    if O <= E:
        return {"won": False, "excessOvertakes": 0, "profit": 0.0, "totalReturn": 0.0, "netProfit": r2(-S), "capped": False}
    excess = O - E
    raw_profit = r2(S * excess * F * M)
    max_ret = r2(S * MAX_OVERTAKE_RETURN_MULT)
    uncapped = r2(S + raw_profit)
    capped = uncapped > max_ret
    tot_ret = max_ret if capped else uncapped
    profit = r2(tot_ret - S)
    return {"won": True, "excessOvertakes": excess, "profit": profit, "totalReturn": tot_ret, "netProfit": profit, "capped": capped}


def count_valid_overtakes_for_bet(race, bet):
    if not race or not bet or bet.get("cancelled"):
        return 0, []
    log = race.get("overtakeLog") or []
    seen = set()
    valid_ids = []
    bet_seq = int(bet.get("confirmedEventSeq", 0) or 0)
    bet_lap = int(bet.get("lap", 0) or 0)
    bet_ts = float(bet.get("ts", 0) or 0)

    for ev in log:
        if not ev or not ev.get("id"):
            continue
        eid = ev["id"]
        if eid in seen:
            continue
        if ev.get("passer") != bet.get("driver"):
            continue
        if ev.get("realOnTrack") is not True or ev.get("cause") != "ON_TRACK":
            continue
        if ev.get("pitPass") or ev.get("dnfPass") or ev.get("penaltyPass") or ev.get("adminChange") or ev.get("artificial"):
            continue
        if ev.get("passedDriverActive") is False:
            continue

        ev_seq = ev.get("seq")
        ev_lap = ev.get("lap")
        ev_ts = ev.get("ts")
        if bet_seq > 0 and isinstance(ev_seq, int):
            is_after = ev_seq > bet_seq
        elif isinstance(ev_lap, int) and ev_lap != bet_lap:
            is_after = ev_lap > bet_lap
        elif bet_ts > 0 and isinstance(ev_ts, (int, float)):
            is_after = ev_ts >= bet_ts
        else:
            is_after = int(ev_lap or 0) > bet_lap

        if is_after:
            seen.add(eid)
            valid_ids.append(eid)

    return len(valid_ids), valid_ids


def get_or_init_race_exposure(race, player_id, current_available):
    bal = r2(max(0.0, float(current_available or 0.0)))
    if not race or not player_id:
        lim = r2(bal * EXPOSURE_RATE)
        return {
            "initialBalance": bal,
            "maxExposure": lim,
            "committedOvertake": 0.0,
            "committedPlacement": 0.0,
            "totalCommitted": 0.0,
            "remainingExposure": lim
        }
    exposures = race.setdefault("exposures", {})
    active_bets = [
        b for b in (race.get("bets") or [])
        if b and b.get("pid") == player_id and not b.get("cancelled") and b.get("status") != "VOID"
    ]
    c_ov = r2(sum(float(b.get("amount", 0)) for b in active_bets if b.get("modality") != "placement"))
    c_pl = r2(sum(float(b.get("amount", 0)) for b in active_bets if b.get("modality") == "placement"))
    tot_c = r2(c_ov + c_pl)

    rec = exposures.get(player_id)
    if not rec or "initialBalance" not in rec or "maxExposure" not in rec:
        init_bal = r2(bal + tot_c)
        max_exp = r2(init_bal * EXPOSURE_RATE)
        rec = {
            "playerId": player_id,
            "raceId": race.get("id"),
            "initialBalance": init_bal,
            "maxExposure": max_exp,
            "lockedAt": int(time.time() * 1000)
        }
        exposures[player_id] = rec

    rem = r2(max(0.0, float(rec["maxExposure"]) - tot_c))
    return {
        "initialBalance": r2(rec["initialBalance"]),
        "maxExposure": r2(rec["maxExposure"]),
        "committedOvertake": c_ov,
        "committedPlacement": c_pl,
        "totalCommitted": tot_c,
        "remainingExposure": rem
    }


def ensure_player_financial_fields(rec):
    if not rec:
        return None
    init_val = get_initial_chips()
    rec["chips"] = max(0.0, r2(rec.get("chips", init_val)))
    rec["committedChips"] = max(0.0, r2(rec.get("committedChips", 0.0)))
    rec["totalBalance"] = r2(rec["chips"] + rec["committedChips"])
    rec["wins"] = max(0, int(rec.get("wins", 0) or 0))
    rec["losses"] = max(0, int(rec.get("losses", 0) or 0))
    rec["balanceVersion"] = max(1, int(rec.get("balanceVersion", 1) or 1))
    rec["machineId"] = str(rec["machineId"]) if rec.get("machineId") else None
    rec["clientIp"] = str(rec["clientIp"]) if rec.get("clientIp") else None
    rec["authToken"] = str(rec["authToken"]) if rec.get("authToken") else None
    if not isinstance(rec.get("settledBets"), dict):
        rec["settledBets"] = {}
    if not isinstance(rec.get("raceExposures"), dict):
        rec["raceExposures"] = {}
    if not isinstance(rec.get("cashbox"), dict):
        rec["cashbox"] = {
            "totalBet": 0.0,
            "totalWon": 0.0,
            "totalLost": 0.0,
            "netProfit": 0.0,
            "betHistory": [],
            "financialHistory": []
        }
    cb = rec["cashbox"]
    cb["totalBet"] = r2(cb.get("totalBet", 0.0))
    cb["totalWon"] = r2(cb.get("totalWon", 0.0))
    cb["totalLost"] = r2(cb.get("totalLost", 0.0))
    cb["netProfit"] = r2(cb["totalWon"] - cb["totalLost"])
    if not isinstance(cb.get("betHistory"), list):
        cb["betHistory"] = []
    if not isinstance(cb.get("financialHistory"), list):
        cb["financialHistory"] = []
    return rec


def record_server_tx(rec, tx_id, tx_type, title, detail, signed_amount):
    ensure_player_financial_fields(rec)
    fh = rec["cashbox"]["financialHistory"]
    if any(x.get("txId") == tx_id for x in fh):
        return False
    fh.insert(0, {
        "txId": tx_id,
        "type": tx_type,
        "title": title,
        "detail": detail,
        "amount": r2(signed_amount),
        "balanceAfter": r2(rec["chips"]),
        "totalBalanceAfter": r2(rec["chips"] + rec.get("committedChips", 0.0)),
        "date": time.strftime("%d/%m/%Y %H:%M:%S"),
        "ts": int(time.time() * 1000)
    })
    if len(fh) > 150:
        del fh[150:]
    return True


def load_players_db():
    global PLAYERS_DB
    if os.path.exists(PLAYERS_DB_PATH):
        try:
            with open(PLAYERS_DB_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    PLAYERS_DB = {k: ensure_player_financial_fields(v) for k, v in data.items()}
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
    ADMIN_TOKENS[token] = now + 86400
    return True


def upsert_player_record(p_data, allow_initial_seed=True, client_meta=None):
    if not p_data or not p_data.get("id"):
        return None
    meta = client_meta or {}
    pid = str(p_data["id"])
    now = time.time()
    machine_id = str(meta.get("machineId") or p_data.get("machineId") or "").strip() or None
    client_ip = str(meta.get("clientIp") or p_data.get("clientIp") or "").strip() or None
    client_auth_token = str(meta.get("authToken") or p_data.get("authToken") or "").strip() or None

    existing = PLAYERS_DB.get(pid)
    if not existing and machine_id:
        bound = find_account_for_machine(machine_id, client_ip)
        if bound:
            existing = bound
            pid = bound["id"]

    if existing and existing.get("machineId") and machine_id and existing["machineId"] != machine_id:
        if existing.get("authToken") and client_auth_token != existing["authToken"] and not meta.get("internalTrusted"):
            my_own = find_account_for_machine(machine_id, client_ip)
            if my_own:
                existing = my_own
                pid = my_own["id"]
            else:
                existing = None
                pid = f"usr_{int(time.time()*1000)}_{secrets.token_hex(3)}"

    client_ver = int(p_data.get("balanceVersion", 0) or 0)
    configured_init = get_initial_chips()

    if not existing:
        chips_val = configured_init
        if allow_initial_seed and "chips" in p_data and meta.get("preserveExplicitChips"):
            chips_val = r2(p_data.get("chips", configured_init))
        if chips_val < 0:
            chips_val = configured_init
        new_auth = client_auth_token or f"tok_{secrets.token_hex(16)}"
        rec = ensure_player_financial_fields({
            "id": pid,
            "name": str(p_data.get("name") or "Piloto").strip()[:24] or "Piloto",
            "avatarId": str(p_data.get("avatarId") or "av1"),
            "chips": chips_val,
            "committedChips": 0.0,
            "wins": int(p_data.get("wins", 0) or 0),
            "losses": int(p_data.get("losses", 0) or 0),
            "balanceVersion": max(1, client_ver),
            "machineId": machine_id,
            "clientIp": client_ip,
            "authToken": new_auth,
            "createdAt": now,
            "updatedAt": now,
            "lastAdminOp": None,
            "settledBets": p_data.get("settledBets") if isinstance(p_data.get("settledBets"), dict) else {},
            "cashbox": p_data.get("cashbox") if isinstance(p_data.get("cashbox"), dict) else None
        })
        PLAYERS_DB[pid] = rec
        save_players_db()
        return rec

    ensure_player_financial_fields(existing)
    if not existing.get("machineId") and machine_id:
        existing["machineId"] = machine_id
    if client_ip:
        existing["clientIp"] = client_ip
    if not existing.get("authToken"):
        existing["authToken"] = client_auth_token or f"tok_{secrets.token_hex(16)}"

    is_owner = (
        not existing.get("machineId")
        or not machine_id
        or existing["machineId"] == machine_id
        or (existing.get("authToken") and client_auth_token == existing["authToken"])
        or meta.get("internalTrusted")
    )
    if is_owner:
        if p_data.get("name"):
            existing["name"] = str(p_data["name"]).strip()[:24]
        if p_data.get("avatarId"):
            existing["avatarId"] = str(p_data["avatarId"])
    existing["updatedAt"] = now
    save_players_db()
    return existing


def recompute_committed_chips(pid, room_state=None):
    rec = PLAYERS_DB.get(pid)
    if not rec:
        return 0.0
    committed = 0.0

    def check_race(r):
        nonlocal committed
        if not r or r.get("done") or r.get("settled") or r.get("cancelled"):
            return
        for b in (r.get("bets") or []):
            if b and b.get("pid") == pid and not b.get("cancelled") and b.get("status") != "VOID" and b.get("id") not in rec["settledBets"]:
                committed = r2(committed + float(b.get("amount", 0) or 0))

    if room_state and room_state.get("race"):
        check_race(room_state["race"])
    else:
        for r_entry in ROOMS.values():
            st = r_entry.get("state")
            if st and st.get("race"):
                check_race(st["race"])

    rec["committedChips"] = committed
    rec["totalBalance"] = r2(rec["chips"] + rec["committedChips"])
    return committed


def sync_room_player_balances(room_state):
    if not room_state or "players" not in room_state:
        return
    room_state["players"] = [p for p in room_state["players"] if p and not p.get("isSpectator")]
    for p in room_state["players"]:
        pid = p.get("id")
        if not pid:
            continue
        rec = PLAYERS_DB.get(pid)
        if not rec:
            rec = upsert_player_record(p, allow_initial_seed=True, client_meta={"internalTrusted": True, "preserveExplicitChips": True})
        if rec:
            recompute_committed_chips(pid, room_state)
            p["chips"] = rec["chips"]
            p["committedChips"] = rec["committedChips"]
            p["totalBalance"] = rec["totalBalance"]
            p["wins"] = rec["wins"]
            p["balanceVersion"] = rec["balanceVersion"]


def ensure_authorized_creator(room_entry):
    state = room_entry.get("state")
    if not state:
        return
    players = [p for p in state.get("players", []) if p and not p.get("isSpectator")]
    state["players"] = players
    creator_id = state.get("creatorId") or state.get("hostId")
    creator_in_room = next((p for p in players if p.get("id") == creator_id), None)
    creator_online = creator_in_room and creator_in_room.get("online", True) is not False
    if (not creator_in_room or not creator_online) and players:
        online_p = next((p for p in players if p.get("online", True) is not False), None)
        if online_p:
            creator_id = online_p.get("id")
        elif not creator_in_room:
            creator_id = players[0].get("id")
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


def remove_player_from_room(code, target_pid, requester_pid, is_admin=False):
    entry = ROOMS.get(str(code or "").upper())
    if not entry or not entry.get("state"):
        return {"ok": False, "status": 404, "error": "Sala não encontrada."}
    st = entry["state"]
    creator_id = st.get("creatorId") or st.get("hostId")
    if not is_admin and requester_pid != creator_id:
        return {"ok": False, "status": 403, "error": "Apenas o criador da sala ou o administrador pode remover jogadores."}
    target = next((p for p in (st.get("players") or []) if p.get("id") == target_pid), None)
    if not target:
        return {"ok": False, "status": 404, "error": "Jogador não está nesta sala."}
    if target_pid == creator_id and not is_admin:
        return {"ok": False, "status": 400, "error": "O criador não pode remover a si mesmo."}

    st["players"] = [p for p in (st.get("players") or []) if p.get("id") != target_pid]
    entry.setdefault("heartbeats", {}).pop(target_pid, None)
    kicked = st.setdefault("kickedPlayerIds", [])
    if target_pid not in kicked:
        kicked.append(target_pid)

    ensure_authorized_creator(entry)
    entry["updatedAt"] = time.time()
    entry.setdefault("actions", []).append({
        "id": f"act_kick_{int(time.time()*1000)}_{secrets.token_hex(3)}",
        "type": "KICK_PLAYER",
        "playerId": requester_pid or "ADMIN",
        "targetPlayerId": target_pid,
        "targetPlayerName": target.get("name"),
        "ts": int(time.time() * 1000)
    })
    return {"ok": True, "status": 200, "removedPlayer": target, "state": st}


def delete_player_account_admin(target_id_or_name):
    clean = str(target_id_or_name or "").strip()
    if not clean:
        return {"ok": False, "status": 400, "error": "Informe o ID ou nickname da conta."}
    rec = PLAYERS_DB.get(clean) or find_player_by_nickname(clean)
    if not rec:
        return {"ok": False, "status": 404, "error": "Conta não encontrada."}

    deleted_id = rec["id"]
    deleted_name = rec["name"]
    deleted_chips = rec.get("chips", 0.0)

    for r_entry in ROOMS.values():
        st = r_entry.get("state")
        if not st:
            continue
        if "players" in st:
            st["players"] = [p for p in st["players"] if p.get("id") != deleted_id]
        r_entry.setdefault("heartbeats", {}).pop(deleted_id, None)
        race = st.get("race")
        if race:
            if "bets" in race:
                race["bets"] = [b for b in race["bets"] if b.get("pid") != deleted_id]
            if isinstance(race.get("exposures"), dict):
                race["exposures"].pop(deleted_id, None)
        ensure_authorized_creator(r_entry)
        r_entry["updatedAt"] = time.time()

    INVITES.pop(deleted_id.lower(), None)
    INVITES.pop(str(deleted_name).strip().lower(), None)
    PLAYERS_DB.pop(deleted_id, None)
    save_players_db()

    log_entry = append_admin_log(
        "DELETE_ACCOUNT",
        f"Conta excluída pelo Admin: {deleted_name} ({deleted_id}) · Saldo era {deleted_chips:.2f} fichas",
        {
            "targetPlayerId": deleted_id,
            "targetName": deleted_name,
            "deletedPlayerId": deleted_id,
            "deletedPlayerName": deleted_name,
            "deletedChips": deleted_chips
        }
    )
    return {
        "ok": True,
        "status": 200,
        "deletedPlayerId": deleted_id,
        "deletedPlayer": {"id": deleted_id, "name": deleted_name, "chips": deleted_chips},
        "logEntry": log_entry
    }


def list_active_rooms_for_spectator():
    res = []
    for code, entry in ROOMS.items():
        cleanup_presence(entry)
        st = entry.get("state")
        if not st:
            continue
        players = [p for p in (st.get("players") or []) if not p.get("isSpectator")]
        online_players = [p for p in players if p.get("online", True) is not False]
        r = st.get("race")
        status = "LOBBY"
        if r:
            if r.get("done") or r.get("cancelled"):
                status = "FINISHED"
            elif r.get("running"):
                status = "IN_PROGRESS"
            elif r.get("started"):
                status = "PAUSED_BETTING"
            else:
                status = "PRE_RACE_BETTING"
        creator = next((p for p in players if p.get("id") == (st.get("creatorId") or st.get("hostId"))), None)
        res.append({
            "code": code,
            "creatorId": st.get("creatorId") or st.get("hostId"),
            "creatorName": creator.get("name") if creator else "Host",
            "circuitId": ((r or {}).get("circuit") or {}).get("id") or st.get("circuitId") or "int",
            "circuitName": ((r or {}).get("circuit") or {}).get("name") or st.get("circuitId") or "Interlagos",
            "circuitFlag": ((r or {}).get("circuit") or {}).get("flag") or "🏁",
            "playersCount": len(players),
            "onlineCount": len(online_players),
            "totalPlayers": len(players),
            "onlinePlayers": len(online_players),
            "players": [{"id": p.get("id"), "name": p.get("name"), "avatarIcon": p.get("avatarIcon"), "color": p.get("color"), "online": p.get("online", True) is not False} for p in players],
            "hasRace": bool(r),
            "status": status,
            "raceStatus": status,
            "inProgress": bool(r and not r.get("done") and not r.get("cancelled")),
            "running": bool(r and r.get("running")),
            "lap": r.get("lap", 0) if r else 0,
            "totalLaps": r.get("total", st.get("laps", 15)) if r else st.get("laps", 15),
            "updatedAt": entry.get("updatedAt", 0)
        })
    res.sort(key=lambda x: (1 if x["inProgress"] else 0, x["updatedAt"]), reverse=True)
    return res


def process_server_place_bet(room_state, raw_bet, fallback_pid=None):
    if not room_state or not room_state.get("race"):
        return {"ok": False, "status": 400, "error": "Nenhuma corrida ativa na sala."}
    race = room_state["race"]
    pid = str((raw_bet or {}).get("pid") or fallback_pid or "")
    if not pid:
        return {"ok": False, "status": 400, "error": "Jogador não identificado."}

    if race.get("done") or race.get("settled") or race.get("cancelled"):
        return {"ok": False, "status": 400, "code": "RACE_FINISHED", "error": "A corrida já foi encerrada."}
    if race.get("running") or not race.get("bettingOpen", False):
        return {"ok": False, "status": 400, "code": "WINDOW_CLOSED", "error": "A janela de apostas já está encerrada."}

    player_rec = PLAYERS_DB.get(pid)
    if not player_rec:
        room_pl = next((x for x in room_state.get("players", []) if x.get("id") == pid), None)
        player_rec = upsert_player_record(room_pl or {"id": pid, "name": (raw_bet or {}).get("playerName", "Piloto"), "chips": get_initial_chips()}, True, {"internalTrusted": True, "preserveExplicitChips": True})
    ensure_player_financial_fields(player_rec)

    bet_id = str((raw_bet or {}).get("id") or f"bet_{pid}_{race.get('id')}_{int(time.time()*1000)}_{secrets.token_hex(3)}")
    if bet_id in PROCESSED_BET_IDS or any(b.get("id") == bet_id for b in (race.get("bets") or [])):
        return {"ok": False, "status": 409, "code": "DUPLICATE_BET", "error": "Este bilhete já foi processado."}

    exposures = race.setdefault("exposures", {})
    if race.get("id") in player_rec["raceExposures"] and pid not in exposures:
        exposures[pid] = player_rec["raceExposures"][race["id"]]

    modality = "placement" if (raw_bet or {}).get("modality") == "placement" else "overtake"
    if modality == "placement" and (race.get("started") or int(race.get("lap", 0) or 0) > 0):
        return {"ok": False, "status": 400, "code": "PLACEMENT_CLOSED_AFTER_START", "error": "Apostas de colocação final só são permitidas antes da largada!"}

    driver_id = str((raw_bet or {}).get("driver") or "")
    valid_order = race.get("order") or race.get("start") or []
    if not driver_id or driver_id not in valid_order:
        return {"ok": False, "status": 400, "code": "INVALID_DRIVER", "error": "Selecione um piloto válido no grid."}

    drv_state = (race.get("drv") or {}).get(driver_id) or {}
    if drv_state.get("st") in ("dnf", "dns"):
        return {"ok": False, "status": 400, "code": "DRIVER_OUT", "error": "Este piloto não está ativo na corrida."}

    stake = r2((raw_bet or {}).get("amount", 0))
    if stake <= 0:
        return {"ok": False, "status": 400, "code": "INVALID_AMOUNT", "error": "Valor de aposta inválido."}

    if stake > player_rec["chips"]:
        return {"ok": False, "status": 400, "code": "INSUFFICIENT_BALANCE", "error": f"Saldo disponível insuficiente ({player_rec['chips']:.2f} fichas)."}

    exp = get_or_init_race_exposure(race, pid, player_rec["chips"])
    player_rec["raceExposures"][race["id"]] = race["exposures"][pid]

    if r2(exp["totalCommitted"] + stake) > r2(exp["maxExposure"] + 1e-6):
        return {
            "ok": False,
            "status": 400,
            "code": "EXPOSURE_LIMIT_EXCEEDED",
            "error": f"Limite de exposição de 50% excedido! Máximo na corrida: {exp['maxExposure']:.2f} fichas (Restante: {exp['remainingExposure']:.2f}).",
            "exposure": exp
        }

    market = str((raw_bet or {}).get("market") or "P1")
    confirmed_odd = None
    confirmed_prob = None
    market_label = None
    expected_ov = None
    lap_mult = None

    if modality == "placement":
        if market not in PLACEMENT_MARKETS:
            return {"ok": False, "status": 400, "code": "INVALID_MARKET", "error": "Mercado inválido."}
        market_label = PLACEMENT_MARKETS[market]
        odds_book = (race.get("oddsBook") or {}).get("drivers", {}).get(driver_id, {}).get(market)
        if odds_book:
            if not odds_book.get("enabled") or float(odds_book.get("probability", 0)) <= 0:
                return {"ok": False, "status": 400, "code": "MARKET_DISABLED_ZERO_PROB", "error": "Mercado desabilitado (probabilidade zero)."}
            confirmed_odd = floor2(max(MIN_ODD, min(MAX_ODD, float(odds_book["odd"]))))
            confirmed_prob = float(odds_book["probability"])
        else:
            confirmed_odd = floor2(max(MIN_ODD, min(MAX_ODD, float((raw_bet or {}).get("odd", 2.0)))))
            confirmed_prob = float((raw_bet or {}).get("probability", 0.47))
            if confirmed_prob <= 0:
                return {"ok": False, "status": 400, "code": "MARKET_DISABLED_ZERO_PROB", "error": "Mercado desabilitado (probabilidade zero)."}
    else:
        lap_mult = get_lap_multiplier(race.get("lap", 0))
        expected_ov = calculate_expected_overtakes(race, driver_id)

    PROCESSED_BET_IDS.add(bet_id)
    player_rec["chips"] = r2(player_rec["chips"] - stake)
    player_rec["committedChips"] = r2(player_rec.get("committedChips", 0.0) + stake)
    player_rec["totalBalance"] = r2(player_rec["chips"] + player_rec["committedChips"])
    player_rec["balanceVersion"] = int(player_rec.get("balanceVersion", 1) or 1) + 1
    player_rec["updatedAt"] = time.time()

    cur_lap = int(race.get("lap", 0) or 0)
    cur_round = cur_lap // 10
    start_pos = (valid_order.index(driver_id) + 1) if driver_id in valid_order else 1
    confirmed_seq = len(race.get("overtakeLog") or [])

    confirmed_bet = {
        "id": bet_id,
        "raceId": race.get("id"),
        "pid": pid,
        "playerName": (raw_bet or {}).get("playerName") or player_rec["name"],
        "playerAvatar": (raw_bet or {}).get("playerAvatar") or "🏎️",
        "playerColor": (raw_bet or {}).get("playerColor") or "#e10600",
        "modality": modality,
        "driver": driver_id,
        "amount": stake,
        "round": cur_round,
        "lap": cur_lap,
        "startPos": start_pos,
        "confirmedEventSeq": confirmed_seq,
        "locked": False,
        "cancelled": False,
        "status": "ACTIVE",
        "modelVersion": MODEL_VERSION,
        "ts": int(time.time() * 1000)
    }

    if modality == "placement":
        confirmed_bet["market"] = market
        confirmed_bet["marketLabel"] = market_label
        confirmed_bet["odd"] = confirmed_odd
        confirmed_bet["probability"] = confirmed_prob
    else:
        confirmed_bet["mult"] = lap_mult
        confirmed_bet["expectedOvertakes"] = expected_ov
        confirmed_bet["factorF"] = OVERTAKE_FACTOR_F

    race.setdefault("bets", []).append(confirmed_bet)
    player_rec["cashbox"]["totalBet"] = r2(player_rec["cashbox"]["totalBet"] + stake)
    player_rec["cashbox"]["betHistory"].insert(0, {
        "id": bet_id,
        "raceId": race.get("id"),
        "circuit": (race.get("circuit") or {}).get("name", "Circuito"),
        "modality": modality,
        "driver": driver_id,
        "market": confirmed_bet.get("market"),
        "marketLabel": confirmed_bet.get("marketLabel"),
        "odd": confirmed_bet.get("odd"),
        "probability": confirmed_bet.get("probability"),
        "expectedOvertakes": confirmed_bet.get("expectedOvertakes"),
        "amount": stake,
        "round": cur_round,
        "lap": cur_lap,
        "mult": confirmed_bet.get("mult"),
        "modelVersion": MODEL_VERSION,
        "status": "active",
        "ret": 0.0,
        "net": 0.0,
        "date": time.strftime("%d/%m/%Y %H:%M:%S")
    })

    tx_title = f"Aposta de Colocação · {driver_id} ({market_label})" if modality == "placement" else f"Aposta de Ultrapassagem · {driver_id} (Exp: {expected_ov} ULTs)"
    tx_detail = f"Odd: {confirmed_odd:.2f}x" if modality == "placement" else f"Volta {cur_lap} · Mult: {lap_mult}x"
    record_server_tx(player_rec, "tx_bet_" + bet_id, "BET_PLACED", tx_title, tx_detail, -stake)

    updated_exp = get_or_init_race_exposure(race, pid, player_rec["chips"])
    save_players_db()
    sync_room_player_balances(room_state)
    return {"ok": True, "status": 200, "bet": confirmed_bet, "exposure": updated_exp, "player": sanitize_player_for_public(player_rec)}


def process_server_cancel_bet(room_state, bet_id, pid):
    if not room_state or not room_state.get("race"):
        return {"ok": False, "status": 400, "error": "Nenhuma corrida ativa."}
    race = room_state["race"]
    if race.get("done") or race.get("running") or not race.get("bettingOpen", False):
        return {"ok": False, "status": 400, "error": "A janela de apostas já está encerrada."}

    bet = next((b for b in (race.get("bets") or []) if b.get("id") == bet_id), None)
    if not bet:
        return {"ok": False, "status": 404, "error": "Aposta não encontrada."}
    if pid and bet.get("pid") != pid:
        return {"ok": False, "status": 403, "error": "Você só pode cancelar suas próprias apostas."}
    if bet.get("locked"):
        return {"ok": False, "status": 400, "error": "Esta aposta já está bloqueada."}
    if bet.get("cancelled"):
        return {"ok": False, "status": 409, "error": "Esta aposta já foi cancelada."}

    bet["cancelled"] = True
    bet["status"] = "CANCELLED"
    race["bets"] = [b for b in (race.get("bets") or []) if b.get("id") != bet_id]

    player_rec = PLAYERS_DB.get(bet.get("pid"))
    if player_rec:
        ensure_player_financial_fields(player_rec)
        amt = r2(bet.get("amount", 0))
        player_rec["chips"] = r2(player_rec["chips"] + amt)
        player_rec["committedChips"] = r2(max(0.0, player_rec.get("committedChips", 0.0) - amt))
        player_rec["totalBalance"] = r2(player_rec["chips"] + player_rec["committedChips"])
        player_rec["balanceVersion"] = int(player_rec.get("balanceVersion", 1) or 1) + 1
        player_rec["updatedAt"] = time.time()
        player_rec["cashbox"]["totalBet"] = r2(max(0.0, player_rec["cashbox"]["totalBet"] - amt))
        for h in player_rec["cashbox"]["betHistory"]:
            if h.get("id") == bet_id:
                h["status"] = "cancelled"
        record_server_tx(player_rec, "tx_cancel_" + bet_id, "BET_CANCELLED", f"Aposta Cancelada ({bet.get('driver')})", "Estorno imediato", +amt)
        save_players_db()

    updated_exp = get_or_init_race_exposure(race, bet.get("pid"), player_rec["chips"]) if player_rec else None
    sync_room_player_balances(room_state)
    return {"ok": True, "status": 200, "betId": bet_id, "exposure": updated_exp, "player": sanitize_player_for_public(player_rec)}


def evaluate_ticket_for_race_py(race, bet):
    if not race or not bet or bet.get("cancelled"):
        return None
    amt = r2(bet.get("amount", 0))
    if race.get("cancelled") and not race.get("started"):
        return {
            "betId": bet.get("id"),
            "modality": bet.get("modality", "overtake"),
            "status": "VOID",
            "reason": "RACE_CANCELLED_BEFORE_START",
            "won": False,
            "voided": True,
            "ret": amt,
            "net": 0.0
        }
    drv_state = (race.get("drv") or {}).get(bet.get("driver")) or {}
    is_dns = drv_state.get("st") == "dns" or drv_state.get("dns") is True
    is_dnf = drv_state.get("st") == "dnf"
    final_order = race.get("officialOrder") or race.get("order") or []
    final_pos = (final_order.index(bet.get("driver")) + 1) if bet.get("driver") in final_order else 0

    if is_dns:
        return {
            "betId": bet.get("id"),
            "modality": bet.get("modality", "overtake"),
            "status": "VOID",
            "reason": "DRIVER_DNS",
            "won": False,
            "voided": True,
            "fin": final_pos,
            "isDns": True,
            "isDnf": False,
            "ret": amt,
            "net": 0.0
        }

    if bet.get("modality") == "placement":
        mkt = bet.get("market")
        won = False
        if final_pos > 0 and not is_dnf:
            if mkt == "P1":
                won = (final_pos == 1)
            elif mkt == "P2":
                won = (final_pos == 2)
            elif mkt == "P3":
                won = (final_pos == 3)
            elif mkt == "PODIUM":
                won = (1 <= final_pos <= 3)
            elif mkt == "TOP5":
                won = (1 <= final_pos <= 5)
            elif mkt == "TOP10":
                won = (1 <= final_pos <= 10)
        odd = floor2(max(MIN_ODD, min(MAX_ODD, float(bet.get("odd", 1.0)))))
        ret = r2(amt * odd) if won else 0.0
        net = r2(ret - amt) if won else r2(-amt)
        return {
            "betId": bet.get("id"),
            "modality": "placement",
            "market": mkt,
            "odd": odd,
            "probability": bet.get("probability"),
            "status": "WON" if won else "LOST",
            "won": won,
            "voided": False,
            "fin": final_pos,
            "isDnf": is_dnf,
            "ret": ret,
            "net": net
        }

    actual_ov, ev_ids = count_valid_overtakes_for_bet(race, bet)
    if isinstance(bet.get("actualOvertakesOverride"), int):
        actual_ov = bet["actualOvertakesOverride"]
    expected_ov = int(bet.get("expectedOvertakes", 0) or 0)
    mult_val = float(bet.get("mult", 1.0) or 1.0)
    factor_f = float(bet.get("factorF", OVERTAKE_FACTOR_F) or OVERTAKE_FACTOR_F)
    payout = calculate_overtake_payout(amt, actual_ov, expected_ov, mult_val, factor_f)
    return {
        "betId": bet.get("id"),
        "modality": "overtake",
        "status": "WON" if payout["won"] else "LOST",
        "won": payout["won"],
        "voided": False,
        "fin": final_pos,
        "isDnf": is_dnf,
        "actualOvertakes": actual_ov,
        "expectedOvertakes": expected_ov,
        "excessOvertakes": payout["excessOvertakes"],
        "mult": mult_val,
        "factorF": factor_f,
        "capped": payout["capped"],
        "overtakeEventIds": ev_ids,
        "ret": payout["totalReturn"],
        "net": payout["netProfit"]
    }


def process_server_settle_race(room_state):
    if not room_state or not room_state.get("race"):
        return {"ok": False, "status": 400, "error": "Nenhuma corrida para liquidar."}
    race = room_state["race"]
    if not race.get("done") and not race.get("cancelled"):
        return {"ok": False, "status": 400, "error": "A corrida ainda não possui resultado final."}
    if not race.get("cancelled") and not (race.get("order") or []):
        return {"ok": False, "status": 400, "error": "Resultado final inválido."}

    race["bettingOpen"] = False
    race["running"] = False
    res_map = race.setdefault("res", {})
    batch_id = race.get("settlementId") or f"stl_{race.get('id')}_{int(time.time()*1000)}"
    race["settlementId"] = batch_id
    settled_count = 0

    for b in (race.get("bets") or []):
        if not b or b.get("cancelled"):
            continue
        key = f"{race.get('id')}::{b.get('id')}"
        outcome = evaluate_ticket_for_race_py(race, b)
        if not outcome:
            continue
        outcome["settlementId"] = f"stl_{b.get('id')}"
        res_map[b["id"]] = outcome
        b["status"] = outcome["status"]

        player_rec = PLAYERS_DB.get(b.get("pid"))
        if not player_rec:
            continue
        ensure_player_financial_fields(player_rec)

        if key in PROCESSED_SETTLEMENTS or b["id"] in player_rec["settledBets"]:
            continue

        PROCESSED_SETTLEMENTS.add(key)
        player_rec["settledBets"][b["id"]] = {
            "settlementId": outcome["settlementId"],
            "status": outcome["status"],
            "ret": outcome["ret"],
            "net": outcome["net"],
            "ts": int(time.time() * 1000)
        }
        amt = r2(b.get("amount", 0))
        player_rec["committedChips"] = r2(max(0.0, player_rec.get("committedChips", 0.0) - amt))
        if outcome["ret"] > 0:
            player_rec["chips"] = r2(player_rec["chips"] + outcome["ret"])
        player_rec["totalBalance"] = r2(player_rec["chips"] + player_rec["committedChips"])
        player_rec["balanceVersion"] = int(player_rec.get("balanceVersion", 1) or 1) + 1
        player_rec["updatedAt"] = time.time()

        h_entry = next((h for h in player_rec["cashbox"]["betHistory"] if h.get("id") == b["id"]), None)
        if outcome.get("voided") or outcome["status"] == "VOID":
            player_rec["cashbox"]["totalBet"] = r2(max(0.0, player_rec["cashbox"]["totalBet"] - amt))
            if h_entry:
                h_entry["status"] = "void"
                h_entry["ret"] = outcome["ret"]
                h_entry["net"] = 0.0
            record_server_tx(player_rec, "tx_settle_" + b["id"], "BET_VOID", f"Aposta Anulada / VOID ({b.get('driver')})", "Reembolso integral", +outcome["ret"])
        elif outcome["won"]:
            player_rec["wins"] = int(player_rec.get("wins", 0) or 0) + 1
            player_rec["cashbox"]["totalWon"] = r2(player_rec["cashbox"]["totalWon"] + outcome["net"])
            if h_entry:
                h_entry["status"] = "won"
                h_entry["fin"] = outcome.get("fin")
                h_entry["ret"] = outcome["ret"]
                h_entry["net"] = outcome["net"]
            record_server_tx(player_rec, "tx_settle_" + b["id"], "RACE_WIN", f"Vitória na Aposta ({b.get('driver')})", f"Retorno: {outcome['ret']:.2f} (Lucro: +{outcome['net']:.2f})", +outcome["ret"])
        else:
            player_rec["losses"] = int(player_rec.get("losses", 0) or 0) + 1
            player_rec["cashbox"]["totalLost"] = r2(player_rec["cashbox"]["totalLost"] + abs(outcome["net"]))
            if h_entry:
                h_entry["status"] = "lost"
                h_entry["fin"] = outcome.get("fin")
                h_entry["ret"] = 0.0
                h_entry["net"] = outcome["net"]
            record_server_tx(player_rec, "tx_settle_" + b["id"], "RACE_LOSS", f"Aposta Perdida ({b.get('driver')})", f"Valor apostado: {amt:.2f}", 0.0)

        player_rec["cashbox"]["netProfit"] = r2(player_rec["cashbox"]["totalWon"] - player_rec["cashbox"]["totalLost"])
        settled_count += 1

    race["settled"] = True
    save_players_db()
    sync_room_player_balances(room_state)
    return {"ok": True, "status": 200, "settlementId": batch_id, "settledCount": settled_count, "results": res_map}


def validate_incoming_room_state(existing_state, incoming_state, sender_pid):
    if not existing_state:
        return incoming_state, None
    creator_id = existing_state.get("creatorId") or existing_state.get("hostId")
    if creator_id and sender_pid and sender_pid != creator_id:
        return existing_state, "UNAUTHORIZED_NOT_CREATOR"

    old_race = existing_state.get("race")
    new_race = incoming_state.get("race")
    if old_race and new_race and old_race.get("id") == new_race.get("id"):
        old_round = int(old_race.get("round", 0) or 0)
        new_round = int(new_race.get("round", 0) or 0)
        if not old_race.get("bettingOpen", True) and new_race.get("bettingOpen", False) and new_round == old_round:
            new_race["bettingOpen"] = False

        if old_race.get("exposures"):
            merged_exp = dict(new_race.get("exposures") or {})
            merged_exp.update(old_race["exposures"])
            new_race["exposures"] = merged_exp

        if old_race.get("oddsBook") and not new_race.get("oddsBook"):
            new_race["oddsBook"] = old_race["oddsBook"]

        old_bets = old_race.get("bets") or []
        old_ids = {b.get("id") for b in old_bets if b and b.get("id")}
        merged_bets = list(old_bets)
        for nb in (new_race.get("bets") or []):
            if nb and nb.get("id") and nb["id"] not in old_ids:
                merged_bets.append(nb)
        new_race["bets"] = merged_bets

    if existing_state.get("kickedPlayerIds"):
        kicked_set = set(existing_state["kickedPlayerIds"]) | set(incoming_state.get("kickedPlayerIds") or [])
        incoming_state["kickedPlayerIds"] = list(kicked_set)
        if "players" in incoming_state:
            incoming_state["players"] = [p for p in incoming_state["players"] if p.get("id") not in kicked_set]

    return incoming_state, None


class F1RequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def log_message(self, format, *args):
        if "/api/" in (args[0] if args else ""):
            return
        super().log_message(format, *args)

    def _get_client_ip(self):
        xff = self.headers.get("X-Forwarded-For", "")
        if xff:
            return xff.split(",")[0].strip()
        return str(self.client_address[0] if self.client_address else "127.0.0.1")

    def _send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token, X-Machine-Id, X-Auth-Token")
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
            return self._send_json(200, {
                "ok": True,
                "server": "python",
                "modelVersion": MODEL_VERSION,
                "initialChips": get_initial_chips(),
                "exposureRate": EXPOSURE_RATE,
                "ts": time.time()
            })

        if path == "/api/rooms":
            with STATE_LOCK:
                return self._send_json(200, {"ok": True, "rooms": list_active_rooms_for_spectator()})

        if path == "/api/players/search":
            q = str(qs.get("q", [""])[0] or "").strip().lower()
            with STATE_LOCK:
                res = [
                    {"id": p["id"], "name": p["name"], "avatarId": p.get("avatarId", "av1"), "wins": p.get("wins", 0), "chips": p.get("chips", 0)}
                    for p in PLAYERS_DB.values()
                    if not q or q in str(p.get("name", "")).lower() or q in str(p.get("id", "")).lower()
                ][:30]
                return self._send_json(200, {"ok": True, "players": res})

        if path == "/api/invites":
            pid = str(qs.get("pid", [""])[0] or "").strip().lower()
            name = str(qs.get("name", [""])[0] or "").strip().lower()
            now_ms = int(time.time() * 1000)
            collected = []
            with STATE_LOCK:
                for key in (pid, name):
                    if not key:
                        continue
                    arr = [inv for inv in INVITES.get(key, []) if (now_ms - inv.get("ts", 0)) < 300000]
                    INVITES[key] = arr
                    for inv in arr:
                        if not any(x.get("id") == inv.get("id") for x in collected):
                            collected.append(inv)
            return self._send_json(200, {"ok": True, "invites": collected})

        if path == "/api/admin/config":
            return self._send_json(200, {"ok": True, "initialChips": get_initial_chips(), "exposureRate": EXPOSURE_RATE})

        if path == "/api/admin/players":
            token = self._get_admin_token(qs=qs)
            q = str(qs.get("q", [""])[0] or "").strip().lower()
            with STATE_LOCK:
                if not verify_admin_token(token):
                    return self._send_json(401, {"ok": False, "error": "UNAUTHORIZED_ADMIN"})
                players_list = sorted(
                    [sanitize_player_for_public(ensure_player_financial_fields(p)) for p in PLAYERS_DB.values()],
                    key=lambda x: x.get("updatedAt", 0),
                    reverse=True
                )
                if q:
                    players_list = [p for p in players_list if q in str(p.get("name", "")).lower() or q in str(p.get("id", "")).lower()]
                return self._send_json(200, {
                    "ok": True,
                    "players": players_list,
                    "initialChips": get_initial_chips(),
                    "adminLogs": (SERVER_CONFIG.get("adminLogs") or [])[:50]
                })

        if path.startswith("/api/player/"):
            parts = path.strip("/").split("/")
            if len(parts) >= 3:
                pid = parts[2]
                with STATE_LOCK:
                    rec = PLAYERS_DB.get(pid)
                    if not rec:
                        return self._send_json(404, {"ok": False, "error": "PLAYER_NOT_FOUND"})
                    return self._send_json(200, {"ok": True, "player": sanitize_player_for_public(ensure_player_financial_fields(rec))})

        if path.startswith("/api/room/"):
            parts = path.strip("/").split("/")
            if len(parts) >= 3:
                code = parts[2].upper()
                pid = qs.get("pid", [None])[0]
                is_spectator = qs.get("spectator", ["0"])[0] == "1"
                with STATE_LOCK:
                    entry = ROOMS.get(code)
                    if not entry:
                        return self._send_json(404, {"ok": False, "error": "ROOM_NOT_FOUND"})
                    if pid and not is_spectator:
                        if entry.get("state") and "players" in entry["state"]:
                            for p in entry["state"]["players"]:
                                if p.get("id") == pid:
                                    entry.setdefault("heartbeats", {})[pid] = time.time()
                                    p["online"] = True
                                    p["lastSeen"] = time.time()
                    cleanup_presence(entry)
                    st = entry["state"]
                    creator_id = st.get("creatorId") or st.get("hostId")
                    is_host = (not is_spectator) and (qs.get("host", ["0"])[0] == "1") and (not creator_id or pid == creator_id)
                    actions = entry.get("actions", [])
                    drained = list(actions) if is_host else []
                    if is_host and actions:
                        entry["actions"] = []
                    player_rec = sanitize_player_for_public(PLAYERS_DB.get(pid)) if pid else None
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

        client_ip = self._get_client_ip()
        hdr_machine = str(self.headers.get("X-Machine-Id", "")).strip()
        hdr_auth = str(self.headers.get("X-Auth-Token", "")).strip()

        if path == "/api/account/delete_self":
            machine_id = str(payload.get("machineId") or hdr_machine or "").strip() or None
            auth_token = str(payload.get("authToken") or hdr_auth or "").strip() or None
            req_id = str(payload.get("playerId") or "").strip()
            with STATE_LOCK:
                target_rec = PLAYERS_DB.get(req_id) if req_id else None
                if not target_rec and machine_id:
                    target_rec = find_account_for_machine(machine_id, client_ip)
                if not target_rec:
                    return self._send_json(200, {"ok": True, "deleted": False, "initialChips": get_initial_chips()})
                is_owner = (
                    (not target_rec.get("machineId") and not target_rec.get("authToken"))
                    or (machine_id and target_rec.get("machineId") == machine_id)
                    or (auth_token and target_rec.get("authToken") == auth_token)
                    or (target_rec.get("clientIp") and target_rec.get("clientIp") == client_ip)
                )
                if not is_owner:
                    return self._send_json(403, {"ok": False, "error": "Você só pode excluir o perfil vinculado ao seu próprio dispositivo."})
                del_res = delete_player_account_admin(target_rec["id"])
                return self._send_json(200, {
                    "ok": True,
                    "deleted": True,
                    "deletedPlayerId": target_rec["id"],
                    "deletedPlayer": del_res.get("deletedPlayer"),
                    "initialChips": get_initial_chips()
                })

        if path == "/api/admin/purge_non_protected":
            token = self._get_admin_token(payload)
            with STATE_LOCK:
                if not verify_admin_token(token):
                    return self._send_json(401, {"ok": False, "error": "Acesso negado."})
                purge_res = purge_non_protected_accounts()
                log_entry = append_admin_log(
                    "PURGE_NON_PROTECTED",
                    f"Admin resetou todas as contas exceto LX/LXZADA e naoc7k/N7K (Mantidas: {len(purge_res['kept'])}, Excluídas: {len(purge_res['removed'])})"
                )
                players_list = sorted(
                    [sanitize_player_for_public(ensure_player_financial_fields(p)) for p in PLAYERS_DB.values()],
                    key=lambda x: x.get("updatedAt", 0),
                    reverse=True
                )
                return self._send_json(200, {
                    "ok": True,
                    "kept": purge_res["kept"],
                    "removed": purge_res["removed"],
                    "players": players_list,
                    "logEntry": log_entry,
                    "adminLogs": (SERVER_CONFIG.get("adminLogs") or [])[:50]
                })

        if path == "/api/account/init":
            machine_id = str(payload.get("machineId") or hdr_machine or f"ip_{client_ip}").strip()
            auth_token = str(payload.get("authToken") or hdr_auth or "").strip() or None
            p_in = payload.get("player") or {}
            requested_id = str(p_in.get("id") or payload.get("playerId") or "").strip()
            create_new = bool(payload.get("createNew"))

            with STATE_LOCK:
                existing_for_machine = find_account_for_machine(machine_id, client_ip)
                if create_new and existing_for_machine:
                    return self._send_json(409, {
                        "ok": False,
                        "code": "ACCOUNT_LIMIT_PER_MACHINE",
                        "error": f"Já existe uma conta registrada para este dispositivo ({existing_for_machine['name']}). Apenas uma conta por máquina é permitida.",
                        "player": existing_for_machine
                    })
                if existing_for_machine:
                    ensure_player_financial_fields(existing_for_machine)
                    if p_in.get("name") and (not existing_for_machine.get("authToken") or existing_for_machine.get("authToken") == auth_token):
                        existing_for_machine["name"] = str(p_in["name"]).strip()[:24] or existing_for_machine["name"]
                        if p_in.get("avatarId"):
                            existing_for_machine["avatarId"] = str(p_in["avatarId"])
                        save_players_db()
                    return self._send_json(200, {
                        "ok": True,
                        "player": existing_for_machine,
                        "initialChips": get_initial_chips(),
                        "boundToMachine": True
                    })

                new_p = p_in or {
                    "id": requested_id or f"usr_{int(time.time()*1000)}_{secrets.token_hex(3)}",
                    "name": payload.get("name") or f"Piloto {len(PLAYERS_DB) + 1}",
                    "avatarId": payload.get("avatarId") or "av1",
                    "chips": get_initial_chips()
                }
                if not new_p.get("id"):
                    new_p["id"] = requested_id or f"usr_{int(time.time()*1000)}_{secrets.token_hex(3)}"
                created = upsert_player_record(new_p, False, {"machineId": machine_id, "clientIp": client_ip, "authToken": auth_token})
                return self._send_json(200, {
                    "ok": True,
                    "player": created,
                    "initialChips": get_initial_chips(),
                    "boundToMachine": True
                })

        if path == "/api/invites/send":
            room_code = str(payload.get("roomCode") or "").strip().upper()
            from_name = str(payload.get("fromName") or "Jogador").strip()
            from_id = str(payload.get("fromId") or "").strip()
            target_nick = str(payload.get("targetNickname") or "").strip()
            with STATE_LOCK:
                if not room_code or room_code not in ROOMS:
                    return self._send_json(404, {"ok": False, "error": "Sala não encontrada no servidor."})
                if not target_nick:
                    return self._send_json(400, {"ok": False, "error": "Informe o nickname do jogador."})
                target_rec = find_player_by_nickname(target_nick)
                target_key = target_rec["name"].lower() if target_rec else target_nick.lower()
                inv_obj = {
                    "id": f"inv_{int(time.time()*1000)}_{secrets.token_hex(3)}",
                    "roomCode": room_code,
                    "fromId": from_id,
                    "fromName": from_name,
                    "targetNickname": target_rec["name"] if target_rec else target_nick,
                    "targetPlayerId": target_rec["id"] if target_rec else None,
                    "ts": int(time.time() * 1000)
                }
                INVITES.setdefault(target_key, []).insert(0, inv_obj)
                if target_rec:
                    INVITES.setdefault(target_rec["id"].lower(), []).insert(0, inv_obj)
                return self._send_json(200, {"ok": True, "invite": inv_obj, "foundRegisteredPlayer": bool(target_rec)})

        if path == "/api/invites/dismiss":
            inv_id = str(payload.get("inviteId") or "").strip()
            with STATE_LOCK:
                for k in list(INVITES.keys()):
                    INVITES[k] = [x for x in INVITES[k] if x.get("id") != inv_id]
            return self._send_json(200, {"ok": True})

        if path == "/api/admin/login":
            login = str(payload.get("login") or "").strip().upper()
            password = str(payload.get("password") or "")
            pw_hash = hashlib.sha256(password.encode("utf-8")).hexdigest()
            if not (hmac.compare_digest(login, ADMIN_LOGIN) and hmac.compare_digest(pw_hash, ADMIN_PASSWORD_HASH)):
                return self._send_json(401, {"ok": False, "error": "Credenciais de administrador inválidas."})
            token = secrets.token_hex(24)
            with STATE_LOCK:
                ADMIN_TOKENS[token] = time.time() + 86400
                players_list = sorted(
                    [sanitize_player_for_public(ensure_player_financial_fields(p)) for p in PLAYERS_DB.values()],
                    key=lambda x: x.get("updatedAt", 0),
                    reverse=True
                )
            return self._send_json(200, {
                "ok": True,
                "token": token,
                "admin": ADMIN_LOGIN,
                "players": players_list,
                "initialChips": get_initial_chips(),
                "adminLogs": (SERVER_CONFIG.get("adminLogs") or [])[:50]
            })

        if path == "/api/admin/logout":
            token = self._get_admin_token(payload)
            with STATE_LOCK:
                ADMIN_TOKENS.pop(token, None)
            return self._send_json(200, {"ok": True})

        if path == "/api/admin/config":
            token = self._get_admin_token(payload)
            with STATE_LOCK:
                if not verify_admin_token(token):
                    return self._send_json(401, {"ok": False, "error": "Acesso negado."})
                try:
                    new_init = r2(payload.get("initialChips", -1))
                except Exception:
                    new_init = -1
                if new_init < 0:
                    return self._send_json(400, {"ok": False, "error": "Valor inicial inválido."})
                old_init = get_initial_chips()
                SERVER_CONFIG["initialChips"] = new_init
                SERVER_CONFIG["updatedAt"] = time.time()
                save_server_config()
                log_entry = append_admin_log(
                    "UPDATE_INITIAL_CHIPS",
                    f"Admin alterou o saldo inicial padrão de {old_init:.2f} para {new_init:.2f} fichas",
                    {"oldInitialChips": old_init, "newInitialChips": new_init}
                )
                return self._send_json(200, {
                    "ok": True,
                    "initialChips": new_init,
                    "logEntry": log_entry,
                    "adminLogs": (SERVER_CONFIG.get("adminLogs") or [])[:50]
                })

        if path == "/api/admin/delete_player":
            token = self._get_admin_token(payload)
            with STATE_LOCK:
                if not verify_admin_token(token):
                    return self._send_json(401, {"ok": False, "error": "Acesso negado."})
                target = payload.get("playerId") or payload.get("nickname")
                del_res = delete_player_account_admin(target)
                if not del_res.get("ok"):
                    return self._send_json(del_res.get("status", 400), del_res)
                players_list = sorted(
                    [sanitize_player_for_public(ensure_player_financial_fields(p)) for p in PLAYERS_DB.values()],
                    key=lambda x: x.get("updatedAt", 0),
                    reverse=True
                )
                return self._send_json(200, {
                    "ok": True,
                    "deletedPlayer": del_res["deletedPlayer"],
                    "logEntry": del_res["logEntry"],
                    "players": players_list,
                    "adminLogs": (SERVER_CONFIG.get("adminLogs") or [])[:50]
                })

        if path == "/api/admin/balance":
            token = self._get_admin_token(payload)
            with STATE_LOCK:
                if not verify_admin_token(token):
                    return self._send_json(401, {"ok": False, "error": "Acesso negado: administrador não autenticado."})
                target_id = str(payload.get("playerId") or "").strip()
                op = str(payload.get("operation") or "").strip().lower()
                amount = r2(payload.get("amount", 0))
                if amount < 0:
                    return self._send_json(400, {"ok": False, "error": "O valor não pode ser negativo."})
                rec = PLAYERS_DB.get(target_id) or find_player_by_nickname(target_id)
                if not rec:
                    return self._send_json(404, {"ok": False, "error": "Jogador não encontrado."})

                ensure_player_financial_fields(rec)
                old_chips = r2(rec.get("chips", get_initial_chips()))
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
                    return self._send_json(400, {"ok": False, "error": "Operação inválida."})

                rec["chips"] = new_chips
                rec["totalBalance"] = r2(rec["chips"] + rec.get("committedChips", 0.0))
                rec["balanceVersion"] = int(rec.get("balanceVersion", 1) or 1) + 1
                rec["updatedAt"] = time.time()
                adm_id = f"adm_{int(time.time()*1000)}_{secrets.token_hex(3)}"
                rec["lastAdminOp"] = {
                    "id": adm_id,
                    "op": op,
                    "amount": amount,
                    "oldBalance": old_chips,
                    "newBalance": new_chips,
                    "label": op_label,
                    "ts": time.time()
                }
                record_server_tx(rec, "tx_" + adm_id, "ADMIN_ADD" if new_chips >= old_chips else "ADMIN_REMOVE", "Ajuste Administrativo", op_label, r2(new_chips - old_chips))
                append_admin_log("BALANCE_" + op.upper(), f"{rec['name']} ({rec['id']}): {op_label}")
                save_players_db()

                for r_entry in ROOMS.values():
                    st = r_entry.get("state")
                    if st and "players" in st:
                        for rp in st["players"]:
                            if rp.get("id") == rec["id"]:
                                rp["chips"] = new_chips
                                rp["balanceVersion"] = rec["balanceVersion"]
                                r_entry["updatedAt"] = time.time()

                players_list = sorted(
                    [sanitize_player_for_public(ensure_player_financial_fields(p)) for p in PLAYERS_DB.values()],
                    key=lambda x: x.get("updatedAt", 0),
                    reverse=True
                )
                return self._send_json(200, {
                    "ok": True,
                    "player": sanitize_player_for_public(rec),
                    "players": players_list,
                    "adminLogs": (SERVER_CONFIG.get("adminLogs") or [])[:50]
                })

        if path == "/api/player/sync":
            p_obj = payload.get("player") or payload
            machine_id = str(payload.get("machineId") or p_obj.get("machineId") or hdr_machine or "").strip() or None
            auth_token = str(payload.get("authToken") or p_obj.get("authToken") or hdr_auth or "").strip() or None
            with STATE_LOCK:
                rec = upsert_player_record(p_obj, allow_initial_seed=False, client_meta={"machineId": machine_id, "clientIp": client_ip, "authToken": auth_token})
                if not rec:
                    return self._send_json(400, {"ok": False, "error": "INVALID_PLAYER"})
                return self._send_json(200, {"ok": True, "player": rec, "initialChips": get_initial_chips()})

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
                        if "players" in state:
                            state["players"] = [p for p in state["players"] if p and not p.get("isSpectator")]
                        pid = payload.get("pid")
                        existing_entry = ROOMS.get(code)
                        if existing_entry and existing_entry.get("state"):
                            cleanup_presence(existing_entry)
                            validated_state, err = validate_incoming_room_state(existing_entry["state"], state, pid)
                            if err == "UNAUTHORIZED_NOT_CREATOR":
                                return self._send_json(403, {"ok": False, "error": err, "state": existing_entry["state"]})
                            state = validated_state

                        entry = ROOMS.setdefault(code, {"state": state, "actions": [], "updatedAt": now, "heartbeats": {}})
                        hbs = entry.setdefault("heartbeats", {})
                        if pid:
                            hbs[pid] = now

                        for p in state.get("players", []):
                            if p.get("isSpectator"):
                                continue
                            p_id = p.get("id")
                            if p_id not in PLAYERS_DB:
                                upsert_player_record(p, allow_initial_seed=True, client_meta={"internalTrusted": True, "preserveExplicitChips": True})
                            if p_id in hbs and (now - hbs[p_id]) < 8.5:
                                p["online"] = True
                            elif p_id not in hbs:
                                hbs[p_id] = now

                        entry["state"] = state
                        if state.get("race") and (state["race"].get("done") or state["race"].get("cancelled")) and not state["race"].get("settled"):
                            process_server_settle_race(entry["state"])

                        ensure_authorized_creator(entry)
                        sync_room_player_balances(entry["state"])
                        entry["updatedAt"] = now
                        cleanup_presence(entry)
                        drained = list(entry.get("actions", []))
                        entry["actions"] = []
                        return self._send_json(200, {"ok": True, "actions": drained, "state": entry["state"]})

                    elif op == "kick":
                        token = self._get_admin_token(payload)
                        is_admin = verify_admin_token(token)
                        kick_res = remove_player_from_room(code, payload.get("targetPlayerId"), payload.get("playerId"), is_admin)
                        if not kick_res.get("ok"):
                            return self._send_json(kick_res.get("status", 400), kick_res)
                        return self._send_json(200, kick_res)

                    elif op == "bet":
                        entry = ROOMS.get(code)
                        if not entry or not entry.get("state"):
                            return self._send_json(404, {"ok": False, "error": "ROOM_NOT_FOUND"})
                        res_bet = process_server_place_bet(entry["state"], payload.get("bet") or payload, payload.get("playerId"))
                        if not res_bet.get("ok"):
                            return self._send_json(res_bet.get("status", 400), res_bet)
                        entry["updatedAt"] = now
                        return self._send_json(200, {
                            "ok": True,
                            "bet": res_bet["bet"],
                            "exposure": res_bet["exposure"],
                            "player": res_bet["player"],
                            "state": entry["state"]
                        })

                    elif op == "cancel_bet":
                        entry = ROOMS.get(code)
                        if not entry or not entry.get("state"):
                            return self._send_json(404, {"ok": False, "error": "ROOM_NOT_FOUND"})
                        res_cancel = process_server_cancel_bet(entry["state"], payload.get("betId"), payload.get("playerId"))
                        if not res_cancel.get("ok"):
                            return self._send_json(res_cancel.get("status", 400), res_cancel)
                        entry["updatedAt"] = now
                        return self._send_json(200, {
                            "ok": True,
                            "betId": res_cancel["betId"],
                            "exposure": res_cancel["exposure"],
                            "player": res_cancel["player"],
                            "state": entry["state"]
                        })

                    elif op == "settle":
                        entry = ROOMS.get(code)
                        if not entry or not entry.get("state"):
                            return self._send_json(404, {"ok": False, "error": "ROOM_NOT_FOUND"})
                        res_settle = process_server_settle_race(entry["state"])
                        if not res_settle.get("ok"):
                            return self._send_json(res_settle.get("status", 400), res_settle)
                        entry["updatedAt"] = now
                        return self._send_json(200, {
                            "ok": True,
                            "settlementId": res_settle["settlementId"],
                            "settledCount": res_settle["settledCount"],
                            "results": res_settle["results"],
                            "state": entry["state"]
                        })

                    elif op == "action":
                        entry = ROOMS.get(code)
                        action = payload.get("action") or {}
                        act_type = action.get("type")
                        pid = action.get("playerId") or (action.get("player") or {}).get("id")

                        if action.get("isSpectator") or (action.get("player") or {}).get("isSpectator"):
                            if not entry:
                                return self._send_json(404, {"ok": False, "error": "ROOM_NOT_FOUND"})
                            return self._send_json(200, {"ok": True, "state": entry["state"]})

                        if action.get("player") and action["player"].get("id") not in PLAYERS_DB:
                            upsert_player_record(action["player"], allow_initial_seed=True, client_meta={"clientIp": client_ip, "machineId": hdr_machine})

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

                        st = entry.get("state")
                        creator_id = st.get("creatorId") or st.get("hostId") if st else None

                        if act_type in ("PREPARE_RACE", "START_RACE", "UPDATE_CONFIG", "CLOSE_BETTING", "CANCEL_RACE") and creator_id and pid != creator_id:
                            return self._send_json(403, {"ok": False, "error": "Apenas o jogador autorizado da sala pode criar ou configurar corridas."})

                        if st and "players" in st:
                            if act_type == "JOIN_ROOM" and action.get("player"):
                                pl = action["player"]
                                if pl.get("isSpectator"):
                                    return self._send_json(200, {"ok": True, "state": entry["state"]})
                                if isinstance(st.get("kickedPlayerIds"), list):
                                    st["kickedPlayerIds"] = [x for x in st["kickedPlayerIds"] if x != pl.get("id")]
                                pl["online"] = True
                                pl["lastSeen"] = now
                                entry.setdefault("heartbeats", {})[pl.get("id")] = now
                                rec = PLAYERS_DB.get(pl.get("id")) or upsert_player_record(pl, allow_initial_seed=True, client_meta={"clientIp": client_ip, "machineId": hdr_machine})
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

                            elif act_type == "KICK_PLAYER" and action.get("targetPlayerId"):
                                token = self._get_admin_token(payload)
                                is_admin = verify_admin_token(token)
                                kick_res = remove_player_from_room(code, action["targetPlayerId"], pid, is_admin)
                                if not kick_res.get("ok"):
                                    return self._send_json(kick_res.get("status", 400), kick_res)
                                return self._send_json(200, {"ok": True, "state": entry["state"]})

                            elif act_type == "PLACE_BET" and action.get("bet"):
                                if pid:
                                    entry.setdefault("heartbeats", {})[pid] = now
                                res_bet = process_server_place_bet(st, action["bet"], pid)
                                if not res_bet.get("ok"):
                                    return self._send_json(res_bet.get("status", 400), res_bet)
                                action["bet"] = res_bet["bet"]
                                action["playerChips"] = res_bet["player"]["chips"]
                                action["balanceVersion"] = res_bet["player"]["balanceVersion"]

                            elif act_type == "CANCEL_BET" and action.get("betId"):
                                if pid:
                                    entry.setdefault("heartbeats", {})[pid] = now
                                res_cancel = process_server_cancel_bet(st, action["betId"], pid)
                                if not res_cancel.get("ok"):
                                    return self._send_json(res_cancel.get("status", 400), res_cancel)
                                if res_cancel.get("player"):
                                    action["playerChips"] = res_cancel["player"]["chips"]
                                    action["balanceVersion"] = res_cancel["player"]["balanceVersion"]

                            elif act_type == "DISCONNECT" and pid:
                                entry.setdefault("heartbeats", {})[pid] = 0
                                for x in st["players"]:
                                    if x.get("id") == pid:
                                        x["online"] = False
                                ensure_authorized_creator(entry)
                                entry["updatedAt"] = now

                            elif act_type == "LEAVE_ROOM" and pid:
                                st["players"] = [x for x in st["players"] if x.get("id") != pid]
                                entry.setdefault("heartbeats", {}).pop(pid, None)
                                ensure_authorized_creator(entry)
                                entry["updatedAt"] = now

                            elif pid and any(x.get("id") == pid for x in st["players"]):
                                entry.setdefault("heartbeats", {})[pid] = now

                        entry.setdefault("actions", []).append(action)
                        cleanup_presence(entry)
                        me = sanitize_player_for_public(PLAYERS_DB.get(pid)) if pid else None
                        return self._send_json(200, {"ok": True, "state": entry["state"], "me": me})

        return self._send_json(404, {"ok": False, "error": "NOT_FOUND"})


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    with ThreadedHTTPServer(("0.0.0.0", PORT), F1RequestHandler) as httpd:
        print(f"F1 Betting Simulator Server rodando em http://localhost:{PORT}")
        httpd.serve_forever()
