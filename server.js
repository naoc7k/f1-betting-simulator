/**
 * F1 Betting Simulator - Authoritative Multiplayer & Static Server (Node.js)
 * Zero external dependencies. Runs on port 8080.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const ROOMS = new Map();

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

function cleanupPresence(entry) {
  const now = Date.now() / 1000;
  const st = entry.state;
  if (!st || !Array.isArray(st.players)) return;
  for (const p of st.players) {
    const last = entry.heartbeats.get(p.id) ?? now;
    p.online = (now - last) < 8.0;
  }
}

function sendJson(res, status, data) {
  const body = Buffer.from(JSON.stringify(data), 'utf-8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, server: 'node', ts: Date.now() / 1000 });
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
      const isHost = parsed.query.host === '1';
      const actions = isHost ? entry.actions.splice(0) : [];
      return sendJson(res, 200, { ok: true, state: entry.state, actions, updatedAt: entry.updatedAt });
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        let payload = {};
        try { payload = JSON.parse(body || '{}'); } catch (e) {}

        if (op === 'state') {
          const state = payload.state;
          if (!state) return sendJson(res, 400, { ok: false, error: 'INVALID_STATE' });
          let entry = ROOMS.get(code);
          if (!entry) {
            entry = { state, actions: [], updatedAt: now, heartbeats: new Map() };
            ROOMS.set(code, entry);
          }
          if (payload.pid) entry.heartbeats.set(payload.pid, now);
          for (const p of (state.players || [])) {
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
          if (!entry) return sendJson(res, 404, { ok: false, error: 'ROOM_NOT_FOUND' });
          if (pid) entry.heartbeats.set(pid, now);
          const st = entry.state;
          if (st && Array.isArray(st.players)) {
            if (action.type === 'JOIN_ROOM' && action.player) {
              const pl = action.player;
              pl.online = true;
              const ex = st.players.find(x => x.id === pl.id);
              if (ex) {
                Object.assign(ex, { name: pl.name, avatar: pl.avatar, color: pl.color, chips: pl.chips, online: true });
              } else if (st.players.length < 8) {
                st.players.push(pl);
              }
            } else if (action.type === 'DISCONNECT' && pid) {
              entry.heartbeats.set(pid, 0);
              const ex = st.players.find(x => x.id === pid);
              if (ex) ex.online = false;
            } else if (action.type === 'LEAVE_ROOM' && pid) {
              st.players = st.players.filter(x => x.id !== pid);
              entry.heartbeats.delete(pid);
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

  // Static files
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
