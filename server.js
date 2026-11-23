/**
 * F1 Betting Simulator - Authoritative Multiplayer, Admin & Balance Server (Node.js)
 * Zero external dependencies. Runs on port 8080.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const PLAYERS_DB_PATH = path.join(ROOT, 'players_db.json');

const INITIAL_CHIPS = 100;
const ADMIN_LOGIN = 'LN';
const ADMIN_PASS_HASH = crypto.createHash('sha256').update('jairo').digest('hex');

const ROOMS = new Map();
const PLAYERS_DB = new Map();
const ADMIN_TOKENS = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function r2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function loadPlayersDb() {
  try {
    if (fs.existsSync(PLAYERS_DB_PATH)) {
      const raw = JSON.parse(fs.readFileSync(PLAYERS_DB_PATH, 'utf-8'));
      Object.entries(raw || {}).forEach(([k, v]) => PLAYERS_DB.set(k, v));
    }
  } catch (e) {}
}

function savePlayersDb() {
  try {
    const obj = {};
    for (const [k, v] of PLAYERS_DB.entries()) obj[k] = v;
    fs.writeFileSync(PLAYERS_DB_PATH, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (e) {}
}

loadPlayersDb();

function verifyAdminToken(token) {
  if (!token) return false;
  const exp = ADMIN_TOKENS.get(token);
  const now = Date.now() / 1000;
  if (!exp || now > exp) {
    ADMIN_TOKENS.delete(token);
    return false;
  }
  ADMIN_TOKENS.set(token, now + 86400);
  return true;
}

function upsertPlayerRecord(pData, trustClientChips = true) {
  if (!pData || !pData.id) return null;
  const pid = String(pData.id);
  const now = Date.now() / 1000;
  const existing = PLAYERS_DB.get(pid);
  const clientVer = Number(pData.balanceVersion || 0);

  if (!existing) {
    let chipsVal = r2(pData.chips !== undefined ? pData.chips : INITIAL_CHIPS);
    if (chipsVal === 25000 && Number(pData.wins || 0) === 0) chipsVal = INITIAL_CHIPS;
    const rec = {
      id: pid,
      name: String(pData.name || 'Piloto').trim().slice(0, 24),
      avatarId: String(pData.avatarId || 'av1'),
      chips: chipsVal,
      wins: Number(pData.wins || 0),
      balanceVersion: Math.max(1, clientVer),
      updatedAt: now,
      lastAdminOp: null
    };
    PLAYERS_DB.set(pid, rec);
    savePlayersDb();
    return rec;
  }

  existing.name = String(pData.name || existing.name).trim().slice(0, 24);
  existing.avatarId = String(pData.avatarId || existing.avatarId || 'av1');
  if (pData.wins !== undefined) existing.wins = Math.max(existing.wins || 0, Number(pData.wins || 0));

  const serverVer = Number(existing.balanceVersion || 1);
  if (trustClientChips && typeof pData.chips === 'number' && clientVer >= serverVer) {
    existing.chips = Math.max(0, r2(pData.chips));
    existing.balanceVersion = Math.max(serverVer, clientVer);
  }
  existing.updatedAt = now;
  savePlayersDb();
  return existing;
}

function ensureAuthorizedCreator(entry) {
  const st = entry.state;
  if (!st || !Array.isArray(st.players)) return;
  let creatorId = st.creatorId || st.hostId;
  const creatorInRoom = st.players.find(p => p.id === creatorId);
  if (!creatorInRoom && st.players.length > 0) {
    const firstOnline = st.players.find(p => p.online !== false) || st.players[0];
    creatorId = firstOnline.id;
  }
  st.creatorId = creatorId;
  st.hostId = creatorId;
  for (const p of st.players) {
    const isC = p.id === creatorId;
    p.isHost = isC;
    p.isCreator = isC;
  }
}

function syncRoomPlayerBalances(st) {
  if (!st || !Array.isArray(st.players)) return;
  for (const p of st.players) {
    const rec = PLAYERS_DB.get(p.id);
    if (rec) {
      const pVer = Number(p.balanceVersion || 0);
      const sVer = Number(rec.balanceVersion || 1);
      if (sVer > pVer) {
        p.chips = rec.chips;
        p.balanceVersion = sVer;
      } else {
        rec.chips = r2(p.chips !== undefined ? p.chips : rec.chips);
        rec.balanceVersion = Math.max(sVer, pVer);
      }
    }
  }
}

function cleanupPresence(entry) {
  const now = Date.now() / 1000;
  const st = entry.state;
  if (!st || !Array.isArray(st.players)) return;
  for (const p of st.players) {
    const last = entry.heartbeats.get(p.id) ?? now;
    p.online = (now - last) < 8.5;
  }
  ensureAuthorizedCreator(entry);
  syncRoomPlayerBalances(st);
}

function sendJson(res, status, data) {
  const body = Buffer.from(JSON.stringify(data), 'utf-8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token'
  });
  res.end(body);
}

function getAdminToken(req, payload, query) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  if (req.headers['x-admin-token']) return String(req.headers['x-admin-token']).trim();
  if (payload && payload.token) return String(payload.token).trim();
  if (query && query.token) return String(query.token).trim();
  return '';
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, server: 'node', ts: Date.now() / 1000 });
  }

  if (pathname === '/api/admin/players' && req.method === 'GET') {
    const token = getAdminToken(req, null, parsed.query);
    if (!verifyAdminToken(token)) return sendJson(res, 401, { ok: false, error: 'UNAUTHORIZED_ADMIN' });
    const list = Array.from(PLAYERS_DB.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return sendJson(res, 200, { ok: true, players: list });
  }

  if (pathname.startsWith('/api/player/') && req.method === 'GET') {
    const pid = pathname.split('/')[3];
    const rec = PLAYERS_DB.get(pid);
    if (!rec) return sendJson(res, 404, { ok: false, error: 'PLAYER_NOT_FOUND' });
    return sendJson(res, 200, { ok: true, player: rec });
  }

  if (req.method === 'POST' && (pathname.startsWith('/api/admin/') || pathname === '/api/player/sync')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch (e) {}

      if (pathname === '/api/admin/login') {
        const login = String(payload.login || '').trim();
        const pass = String(payload.password || '');
        const hash = crypto.createHash('sha256').update(pass).digest('hex');
        if (login !== ADMIN_LOGIN || hash !== ADMIN_PASS_HASH) {
          return sendJson(res, 401, { ok: false, error: 'Credenciais de administrador inválidas.' });
        }
        const token = crypto.randomBytes(24).toString('hex');
        ADMIN_TOKENS.set(token, Date.now() / 1000 + 86400);
        const list = Array.from(PLAYERS_DB.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        return sendJson(res, 200, { ok: true, token, admin: ADMIN_LOGIN, players: list });
      }

      if (pathname === '/api/admin/logout') {
        const token = getAdminToken(req, payload, parsed.query);
        ADMIN_TOKENS.delete(token);
        return sendJson(res, 200, { ok: true });
      }

      if (pathname === '/api/admin/balance') {
        const token = getAdminToken(req, payload, parsed.query);
        if (!verifyAdminToken(token)) return sendJson(res, 401, { ok: false, error: 'Acesso negado.' });
        const targetId = String(payload.playerId || '').trim();
        const op = String(payload.operation || '').trim().toLowerCase();
        const amount = r2(payload.amount);
        if (amount < 0) return sendJson(res, 400, { ok: false, error: 'Valor inválido.' });
        const rec = PLAYERS_DB.get(targetId);
        if (!rec) return sendJson(res, 404, { ok: false, error: 'Jogador não encontrado.' });

        const oldChips = r2(rec.chips);
        let newChips = oldChips;
        let opLabel = '';
        if (op === 'add') {
          newChips = r2(oldChips + amount);
          opLabel = `Admin adicionou +${amount.toFixed(2)} fichas`;
        } else if (op === 'remove') {
          newChips = r2(Math.max(0, oldChips - amount));
          opLabel = `Admin removeu -${amount.toFixed(2)} fichas`;
        } else if (op === 'set') {
          newChips = r2(Math.max(0, amount));
          opLabel = `Admin definiu o saldo para ${newChips.toFixed(2)} fichas`;
        } else {
          return sendJson(res, 400, { ok: false, error: 'Operação inválida.' });
        }

        rec.chips = newChips;
        rec.balanceVersion = Number(rec.balanceVersion || 1) + 1;
        rec.updatedAt = Date.now() / 1000;
        rec.lastAdminOp = {
          id: `adm_${Date.now()}`,
          op,
          amount,
          oldBalance: oldChips,
          newBalance: newChips,
          label: opLabel,
          ts: rec.updatedAt
        };
        savePlayersDb();

        for (const rEntry of ROOMS.values()) {
          if (rEntry.state && Array.isArray(rEntry.state.players)) {
            const rp = rEntry.state.players.find(p => p.id === targetId);
            if (rp) {
              rp.chips = newChips;
              rp.balanceVersion = rec.balanceVersion;
            }
          }
        }
        const list = Array.from(PLAYERS_DB.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        return sendJson(res, 200, { ok: true, player: rec, players: list });
      }

      if (pathname === '/api/player/sync') {
        const rec = upsertPlayerRecord(payload.player || payload, true);
        if (!rec) return sendJson(res, 400, { ok: false, error: 'INVALID_PLAYER' });
        return sendJson(res, 200, { ok: true, player: rec });
      }
    });
    return;
  }

  if (pathname.startsWith('/api/room/')) {
    const parts = pathname.replace(/^\/+|\/+$/g, '').split('/');
    const code = (parts[2] || '').toUpperCase();
    const op = parts[3] || '';
    const now = Date.now() / 1000;

    if (req.method === 'GET') {
      const entry = ROOMS.get(code);
      if (!entry) return sendJson(res, 404, { ok: false, error: 'ROOM_NOT_FOUND' });
      const pid = parsed.query.pid;
      if (pid) {
        entry.heartbeats.set(pid, now);
        if (entry.state && Array.isArray(entry.state.players)) {
          const pl = entry.state.players.find(x => x.id === pid);
          if (pl) pl.online = true;
        }
      }
      cleanupPresence(entry);
      const creatorId = entry.state.creatorId || entry.state.hostId;
      const isHost = parsed.query.host === '1' && (!creatorId || pid === creatorId);
      const actions = isHost ? entry.actions.splice(0) : [];
      const me = pid ? PLAYERS_DB.get(pid) : null;
      return sendJson(res, 200, { ok: true, state: entry.state, actions, updatedAt: entry.updatedAt, me });
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        let payload = {};
        try { payload = JSON.parse(body || '{}'); } catch (e) {}

        if (op === 'state') {
          let state = payload.state;
          if (!state) return sendJson(res, 400, { ok: false, error: 'INVALID_STATE' });
          let entry = ROOMS.get(code);
          if (entry && entry.state) {
            const creatorId = entry.state.creatorId || entry.state.hostId;
            if (creatorId && payload.pid && payload.pid !== creatorId) {
              return sendJson(res, 403, { ok: false, error: 'UNAUTHORIZED_NOT_CREATOR', state: entry.state });
            }
            const oldRace = entry.state.race;
            const newRace = state.race;
            if (oldRace && newRace && oldRace.id === newRace.id) {
              if (!oldRace.bettingOpen && newRace.bettingOpen && Number(newRace.round || 0) === Number(oldRace.round || 0)) {
                newRace.bettingOpen = false;
              }
            }
          } else {
            entry = { state, actions: [], updatedAt: now, heartbeats: new Map() };
            ROOMS.set(code, entry);
          }
          if (payload.pid) entry.heartbeats.set(payload.pid, now);
          for (const p of (state.players || [])) {
            upsertPlayerRecord(p, true);
            if (!entry.heartbeats.has(p.id)) entry.heartbeats.set(p.id, now);
          }
          entry.state = state;
          entry.updatedAt = now;
          cleanupPresence(entry);
          const actions = entry.actions.splice(0);
          return sendJson(res, 200, { ok: true, actions, state: entry.state });
        }

        if (op === 'action') {
          let entry = ROOMS.get(code);
          const action = payload.action || {};
          const pid = action.playerId || (action.player && action.player.id);
          if (action.player) upsertPlayerRecord(action.player, true);
          if (!entry) return sendJson(res, 404, { ok: false, error: 'ROOM_NOT_FOUND' });
          if (pid) entry.heartbeats.set(pid, now);
          const st = entry.state;
          if (st && Array.isArray(st.players)) {
            if (action.type === 'JOIN_ROOM' && action.player) {
              const pl = action.player;
              pl.online = true;
              const rec = upsertPlayerRecord(pl, true);
              if (rec) {
                pl.chips = rec.chips;
                pl.balanceVersion = rec.balanceVersion;
              }
              const ex = st.players.find(x => x.id === pl.id);
              if (ex) {
                Object.assign(ex, { name: pl.name, avatarId: pl.avatarId, avatarIcon: pl.avatarIcon, color: pl.color, chips: pl.chips, balanceVersion: pl.balanceVersion, online: true });
              } else if (st.players.length < 8) {
                st.players.push(pl);
              }
              ensureAuthorizedCreator(entry);
            } else if (action.type === 'DISCONNECT' && pid) {
              entry.heartbeats.set(pid, 0);
              const ex = st.players.find(x => x.id === pid);
              if (ex) ex.online = false;
            } else if (action.type === 'LEAVE_ROOM' && pid) {
              st.players = st.players.filter(x => x.id !== pid);
              entry.heartbeats.delete(pid);
              ensureAuthorizedCreator(entry);
            }
          }
          entry.actions.push(action);
          cleanupPresence(entry);
          return sendJson(res, 200, { ok: true, state: entry.state });
        }

        return sendJson(res, 404, { ok: false });
      });
      return;
    }
  }

  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '\\') safePath = '/index.html';
  const fullPath = path.join(ROOT, safePath);
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`F1 Betting Simulator Server rodando em http://localhost:${PORT}`);
});
