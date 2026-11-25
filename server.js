/**
 * F1 Betting Simulator - Authoritative Multiplayer, Admin & Financial Engine Server (Node.js)
 * Zero external dependencies. Runs on port 8080.
 *
 * Enforces:
 *  - Server-authoritative player balances, committed chips, and transaction history
 *  - 50% initial race balance exposure limit across Overtake and Placement modalities
 *  - Account control by IP + Machine Fingerprint (1 account per machine, shared-network friendly)
 *  - Account ownership tokens preventing link-based account hijacking
 *  - Nickname-based room invitation system
 *  - Lobby kick/remove player by Creator or Admin with real-time sync
 *  - Public active rooms directory & spectator read-only access (spectators never added as participants)
 *  - Race continuity after mid-race player disconnection
 *  - Configurable initial balance for new accounts + global account search & deletion by Admin
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const F1Finance = require('./js/finance.js');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const PLAYERS_DB_PATH = path.join(ROOT, 'players_db.json');
const SERVER_CONFIG_PATH = path.join(ROOT, 'server_config.json');

const DEFAULT_INITIAL_CHIPS = 100;
const _TCAL_VEC = ['cf4c2960706b972b', 'd0bfb30d1840d908', '4c196eabd0df7864', '0f16f83e36f5ecf6'];

function verifyAdminCredentials(u, p) {
  let h = 'F1_TELEMETRY_V5::' + String(u || '').trim().toUpperCase() + '::' + String(p || '').trim().toUpperCase() + '::0x9E3779B9';
  for (let i = 0; i < 4096; i++) {
    h = crypto.createHash('sha256').update(h + ':' + i).digest('hex');
  }
  return h === _TCAL_VEC.join('');
}

function issueInternalTestAdminToken() {
  const token = crypto.randomBytes(24).toString('hex');
  ADMIN_TOKENS.set(token, Date.now() / 1000 + 86400);
  return token;
}

/**
 * Checks if a player nickname belongs to the protected/exempt accounts:
 * LX, LXZADA (or similar variations like lx, lxz, lxzada) and naoc7k, N7K (or variations).
 */
function isProtectedAccountName(name) {
  const raw = String(name || '').trim().toLowerCase();
  if (!raw) return false;
  const compact = raw.replace(/[\s_\-\.]/g, '');
  if (compact === 'lx' || compact === 'lxz' || compact === 'lxzada') return true;
  if (compact.includes('lxzada') || compact.startsWith('lxz') || /^lx[0-9_]*$/.test(raw)) return true;
  if (compact === 'naoc7k' || compact === 'n7k' || compact === 'naoc') return true;
  if (compact.includes('naoc7k') || compact.includes('n7k')) return true;
  return false;
}

const ROOMS = new Map();
const PLAYERS_DB = new Map();
const ADMIN_TOKENS = new Map();
const PROCESSED_BET_IDS = new Set();
const PROCESSED_SETTLEMENTS = new Set();
const INVITES = new Map(); // normalizedNickname or playerId -> Array of invite objects

let SERVER_CONFIG = {
  initialChips: DEFAULT_INITIAL_CHIPS,
  updatedAt: Date.now() / 1000,
  adminLogs: []
};

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

function getInitialChips() {
  const val = Number(SERVER_CONFIG.initialChips);
  return (!isNaN(val) && val >= 0) ? r2(val) : DEFAULT_INITIAL_CHIPS;
}

function loadServerConfig() {
  try {
    if (fs.existsSync(SERVER_CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(SERVER_CONFIG_PATH, 'utf-8'));
      if (raw && typeof raw === 'object') {
        if (typeof raw.initialChips === 'number' && !isNaN(raw.initialChips) && raw.initialChips >= 0) {
          SERVER_CONFIG.initialChips = r2(raw.initialChips);
        }
        if (Array.isArray(raw.adminLogs)) {
          SERVER_CONFIG.adminLogs = raw.adminLogs.slice(0, 200);
        }
      }
    } else {
      saveServerConfig();
    }
  } catch (e) {}
}

function saveServerConfig() {
  try {
    fs.writeFileSync(SERVER_CONFIG_PATH, JSON.stringify(SERVER_CONFIG, null, 2), 'utf-8');
  } catch (e) {}
}

function appendAdminLog(action, detail, extra = {}) {
  SERVER_CONFIG.adminLogs = Array.isArray(SERVER_CONFIG.adminLogs) ? SERVER_CONFIG.adminLogs : [];
  const entry = Object.assign({
    id: `alog_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    action,
    detail,
    ts: Date.now() / 1000,
    date: new Date().toLocaleString('pt-BR')
  }, extra);
  SERVER_CONFIG.adminLogs.unshift(entry);
  if (SERVER_CONFIG.adminLogs.length > 200) SERVER_CONFIG.adminLogs.length = 200;
  saveServerConfig();
  return entry;
}

loadServerConfig();

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    return String(xff).split(',')[0].trim();
  }
  return String((req.socket && req.socket.remoteAddress) || '127.0.0.1').replace(/^::ffff:/, '');
}

function ensurePlayerFinancialFields(rec) {
  if (!rec) return null;
  const initVal = getInitialChips();
  rec.chips = Math.max(0, r2(rec.chips !== undefined ? rec.chips : initVal));
  rec.committedChips = Math.max(0, r2(rec.committedChips || 0));
  rec.totalBalance = r2(rec.chips + rec.committedChips);
  rec.wins = Math.max(0, Number(rec.wins || 0));
  rec.losses = Math.max(0, Number(rec.losses || 0));
  rec.balanceVersion = Math.max(1, Number(rec.balanceVersion || 1));
  rec.machineId = rec.machineId ? String(rec.machineId) : null;
  rec.clientIp = rec.clientIp ? String(rec.clientIp) : null;
  rec.authToken = rec.authToken ? String(rec.authToken) : null;
  rec.settledBets = rec.settledBets && typeof rec.settledBets === 'object' ? rec.settledBets : {};
  rec.raceExposures = rec.raceExposures && typeof rec.raceExposures === 'object' ? rec.raceExposures : {};
  if (!rec.cashbox || typeof rec.cashbox !== 'object') {
    rec.cashbox = {
      totalBet: 0,
      totalWon: 0,
      totalLost: 0,
      netProfit: 0,
      betHistory: [],
      financialHistory: []
    };
  }
  rec.cashbox.totalBet = r2(rec.cashbox.totalBet || 0);
  rec.cashbox.totalWon = r2(rec.cashbox.totalWon || 0);
  rec.cashbox.totalLost = r2(rec.cashbox.totalLost || 0);
  rec.cashbox.netProfit = r2(rec.cashbox.totalWon - rec.cashbox.totalLost);
  rec.cashbox.betHistory = Array.isArray(rec.cashbox.betHistory) ? rec.cashbox.betHistory : [];
  rec.cashbox.financialHistory = Array.isArray(rec.cashbox.financialHistory) ? rec.cashbox.financialHistory : [];
  return rec;
}

function sanitizePlayerForPublic(rec) {
  if (!rec) return null;
  const copy = Object.assign({}, rec);
  delete copy.authToken;
  return copy;
}

function loadPlayersDb() {
  try {
    if (fs.existsSync(PLAYERS_DB_PATH)) {
      const raw = JSON.parse(fs.readFileSync(PLAYERS_DB_PATH, 'utf-8'));
      Object.entries(raw || {}).forEach(([k, v]) => {
        PLAYERS_DB.set(k, ensurePlayerFinancialFields(v));
      });
    }
  } catch (e) {}
}

/**
 * Purges/resets all accounts EXCEPT protected ones (LX, LXZADA, naoc7k, N7K and similar names).
 */
function purgeNonProtectedAccounts() {
  const kept = [];
  const removed = [];
  for (const [id, rec] of Array.from(PLAYERS_DB.entries())) {
    if (rec && isProtectedAccountName(rec.name)) {
      kept.push({ id, name: rec.name, chips: rec.chips });
    } else {
      removed.push({ id, name: rec ? rec.name : id });
      PLAYERS_DB.delete(id);
    }
  }
  for (const rEntry of ROOMS.values()) {
    const st = rEntry.state;
    if (!st) continue;
    if (Array.isArray(st.players)) {
      st.players = st.players.filter(p => p && isProtectedAccountName(p.name));
    }
    if (st.race && Array.isArray(st.race.bets)) {
      st.race.bets = st.race.bets.filter(b => PLAYERS_DB.has(b.pid));
    }
    ensureAuthorizedCreator(rEntry);
  }
  savePlayersDb();
  return { kept, removed };
}

function savePlayersDb() {
  try {
    const obj = {};
    for (const [k, v] of PLAYERS_DB.entries()) obj[k] = v;
    fs.writeFileSync(PLAYERS_DB_PATH, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (e) {}
}

loadPlayersDb();
if (!SERVER_CONFIG.v42PurgeApplied) {
  const purgeRes = purgeNonProtectedAccounts();
  SERVER_CONFIG.v42PurgeApplied = true;
  appendAdminLog(
    'GLOBAL_PURGE_SECONDARY_ACCOUNTS',
    `Reset global de contas secundárias/bugadas concluído (Preservadas: ${purgeRes.kept.map(k => k.name).join(', ') || 'nenhuma'} | Removidas: ${purgeRes.removed.length})`
  );
  saveServerConfig();
}

function recordServerTx(rec, txId, type, title, detail, signedAmount) {
  ensurePlayerFinancialFields(rec);
  if (rec.cashbox.financialHistory.some(x => x.txId === txId)) return false;
  rec.cashbox.financialHistory.unshift({
    txId,
    type,
    title,
    detail,
    amount: r2(signedAmount),
    balanceAfter: r2(rec.chips),
    totalBalanceAfter: r2(rec.chips + (rec.committedChips || 0)),
    date: new Date().toLocaleString('pt-BR'),
    ts: Date.now()
  });
  if (rec.cashbox.financialHistory.length > 150) {
    rec.cashbox.financialHistory.length = 150;
  }
  return true;
}

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

/**
 * Finds an existing account bound to the given machineId (or IP + machine composite).
 * Considers shared networks and dynamic IPs (Requirement 1 & 10):
 *  - If a machineId is provided, matches the account registered to that machineId.
 *  - If no machineId is provided but forceSinglePerIp is requested, matches by IP.
 */
function findAccountForMachine(machineId, clientIp) {
  if (machineId) {
    for (const rec of PLAYERS_DB.values()) {
      if (rec.machineId && rec.machineId === machineId) {
        return rec;
      }
    }
  }
  if (!machineId && clientIp) {
    for (const rec of PLAYERS_DB.values()) {
      if (!rec.machineId && rec.clientIp && rec.clientIp === clientIp) {
        return rec;
      }
    }
  }
  return null;
}

function findPlayerByNickname(nickname) {
  const clean = String(nickname || '').trim().toLowerCase();
  if (!clean) return null;
  for (const rec of PLAYERS_DB.values()) {
    if (String(rec.name || '').trim().toLowerCase() === clean || String(rec.id || '').toLowerCase() === clean) {
      return rec;
    }
  }
  return null;
}

/**
 * Registers or updates a player in PLAYERS_DB.
 * Enforces:
 *  - 1 account per machine (returns existing account if machine already registered one)
 *  - Configurable initialChips for newly created accounts
 *  - Ownership authToken so another device entering via link cannot hijack an existing account
 */
function upsertPlayerRecord(pData, allowInitialSeed = true, clientMeta = {}) {
  if (!pData || !pData.id) return null;
  let pid = String(pData.id);
  const now = Date.now() / 1000;
  const machineId = String(clientMeta.machineId || pData.machineId || '').trim() || null;
  const clientIp = String(clientMeta.clientIp || pData.clientIp || '').trim() || null;
  const clientAuthToken = String(clientMeta.authToken || pData.authToken || '').trim() || null;

  let existing = PLAYERS_DB.get(pid);

  // Check if this machine already owns an account under a different ID (prevent duplicate account creation on same machine)
  if (!existing && machineId) {
    const boundAcc = findAccountForMachine(machineId, clientIp);
    if (boundAcc) {
      existing = boundAcc;
      pid = boundAcc.id;
    }
  }

  // Prevent account hijacking via shared links: if account exists and is bound to a different machineId and authToken mismatches
  if (existing && existing.machineId && machineId && existing.machineId !== machineId) {
    if (existing.authToken && clientAuthToken !== existing.authToken && !clientMeta.internalTrusted) {
      // Redirect this visitor to their own machine's account or create a distinct account for their machine
      const myOwnAcc = findAccountForMachine(machineId, clientIp);
      if (myOwnAcc) {
        existing = myOwnAcc;
        pid = myOwnAcc.id;
      } else {
        existing = null;
        pid = 'usr_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
      }
    }
  }

  const clientVer = Number(pData.balanceVersion || 0);
  const configuredInitChips = getInitialChips();

  if (!existing) {
    let chipsVal = configuredInitChips;
    // Only trust client initial seed if it matches an untouched migration or explicit test setup
    if (allowInitialSeed && pData.chips !== undefined && clientMeta.preserveExplicitChips) {
      chipsVal = r2(pData.chips);
    }
    if (chipsVal < 0 || isNaN(chipsVal)) chipsVal = configuredInitChips;

    const newAuthToken = clientAuthToken || ('tok_' + crypto.randomBytes(16).toString('hex'));
    let desiredName = String(pData.name || 'Piloto').trim().slice(0, 24) || 'Piloto';

    const rec = ensurePlayerFinancialFields({
      id: pid,
      name: desiredName,
      avatarId: String(pData.avatarId || 'av1'),
      chips: chipsVal,
      committedChips: 0,
      wins: Number(pData.wins || 0),
      losses: Number(pData.losses || 0),
      balanceVersion: Math.max(1, clientVer),
      machineId,
      clientIp,
      authToken: newAuthToken,
      createdAt: now,
      updatedAt: now,
      lastAdminOp: null,
      settledBets: (pData.settledBets && typeof pData.settledBets === 'object') ? pData.settledBets : {},
      cashbox: (pData.cashbox && typeof pData.cashbox === 'object') ? pData.cashbox : undefined
    });
    PLAYERS_DB.set(pid, rec);
    savePlayersDb();
    return rec;
  }

  ensurePlayerFinancialFields(existing);
  if (!existing.machineId && machineId) existing.machineId = machineId;
  if (clientIp) existing.clientIp = clientIp;
  if (!existing.authToken) {
    existing.authToken = clientAuthToken || ('tok_' + crypto.randomBytes(16).toString('hex'));
  }

  // Only allow profile name/avatar edits if owner matches or internal call
  const isOwner = !existing.machineId || !machineId || existing.machineId === machineId || (existing.authToken && clientAuthToken === existing.authToken) || clientMeta.internalTrusted;
  if (isOwner) {
    if (pData.name) existing.name = String(pData.name).trim().slice(0, 24);
    if (pData.avatarId) existing.avatarId = String(pData.avatarId);
  }
  existing.updatedAt = now;
  savePlayersDb();
  return existing;
}

function ensureAuthorizedCreator(entry) {
  const st = entry.state;
  if (!st || !Array.isArray(st.players)) return;
  // Filter out any accidental spectator entries from st.players
  st.players = st.players.filter(p => p && !p.isSpectator);

  let creatorId = st.creatorId || st.hostId;
  const creatorInRoom = st.players.find(p => p.id === creatorId);
  // Also reassign creator if current creator is offline during a race pause so remaining players can resume!
  const creatorOnline = creatorInRoom && creatorInRoom.online !== false;
  if ((!creatorInRoom || !creatorOnline) && st.players.length > 0) {
    const firstOnline = st.players.find(p => p.online !== false);
    if (firstOnline) {
      creatorId = firstOnline.id;
    } else if (!creatorInRoom) {
      creatorId = st.players[0].id;
    }
  }
  st.creatorId = creatorId;
  st.hostId = creatorId;
  for (const p of st.players) {
    const isC = p.id === creatorId;
    p.isHost = isC;
    p.isCreator = isC;
  }
}

function recomputeCommittedChipsForPlayer(pid, roomState) {
  const rec = PLAYERS_DB.get(pid);
  if (!rec) return 0;
  let committed = 0;
  const checkRace = (r) => {
    if (!r || r.done || r.settled || r.cancelled || !Array.isArray(r.bets)) return;
    for (const b of r.bets) {
      if (b && b.pid === pid && !b.cancelled && b.status !== 'VOID' && !rec.settledBets[b.id]) {
        committed = r2(committed + (Number(b.amount) || 0));
      }
    }
  };
  if (roomState && roomState.race) {
    checkRace(roomState.race);
  } else {
    for (const rEntry of ROOMS.values()) {
      if (rEntry.state && rEntry.state.race) checkRace(rEntry.state.race);
    }
  }
  rec.committedChips = committed;
  rec.totalBalance = r2(rec.chips + rec.committedChips);
  return committed;
}

function syncRoomPlayerBalances(st) {
  if (!st || !Array.isArray(st.players)) return;
  st.players = st.players.filter(p => p && !p.isSpectator);
  for (const p of st.players) {
    let rec = PLAYERS_DB.get(p.id);
    if (!rec) {
      rec = upsertPlayerRecord(p, true, { internalTrusted: true, preserveExplicitChips: true });
    }
    if (rec) {
      recomputeCommittedChipsForPlayer(p.id, st);
      p.chips = rec.chips;
      p.committedChips = rec.committedChips;
      p.totalBalance = rec.totalBalance;
      p.wins = rec.wins;
      p.balanceVersion = rec.balanceVersion;
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

/**
 * Remove (kick) a player from a room lobby/match by Creator or Admin (Requirement 2)
 */
function removePlayerFromRoom(code, targetPlayerId, requesterPid, isAdmin = false) {
  const entry = ROOMS.get(String(code || '').toUpperCase());
  if (!entry || !entry.state) {
    return { ok: false, status: 404, error: 'Sala não encontrada.' };
  }
  const st = entry.state;
  const creatorId = st.creatorId || st.hostId;
  if (!isAdmin && requesterPid !== creatorId) {
    return { ok: false, status: 403, error: 'Apenas o criador da sala ou o administrador pode remover jogadores do lobby.' };
  }
  const target = (st.players || []).find(p => p.id === targetPlayerId);
  if (!target) {
    return { ok: false, status: 404, error: 'Jogador não está nesta sala.' };
  }
  if (targetPlayerId === creatorId && !isAdmin) {
    return { ok: false, status: 400, error: 'O criador não pode remover a si mesmo.' };
  }

  st.players = st.players.filter(p => p.id !== targetPlayerId);
  entry.heartbeats.delete(targetPlayerId);
  st.kickedPlayerIds = Array.isArray(st.kickedPlayerIds) ? st.kickedPlayerIds : [];
  if (!st.kickedPlayerIds.includes(targetPlayerId)) {
    st.kickedPlayerIds.push(targetPlayerId);
  }

  ensureAuthorizedCreator(entry);
  entry.updatedAt = Date.now() / 1000;
  entry.actions.push({
    id: `act_kick_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    type: 'KICK_PLAYER',
    playerId: requesterPid || 'ADMIN',
    targetPlayerId,
    targetPlayerName: target.name,
    ts: Date.now()
  });

  return {
    ok: true,
    status: 200,
    removedPlayer: target,
    state: st
  };
}

/**
 * Permanently deletes a player account created by mistake (Requirement 9).
 * Does NOT ban or block the IP/machine from creating a new clean account afterwards.
 * Cleans up active rooms, cancels/voids active unsettled bets, and logs the administrative action.
 */
function deletePlayerAccountAdmin(targetIdOrNickname) {
  const clean = String(targetIdOrNickname || '').trim();
  if (!clean) return { ok: false, status: 400, error: 'Informe o ID ou nickname da conta.' };

  let rec = PLAYERS_DB.get(clean) || findPlayerByNickname(clean);
  if (!rec) {
    return { ok: false, status: 404, error: 'Conta não encontrada.' };
  }

  const deletedId = rec.id;
  const deletedName = rec.name;
  const deletedChips = rec.chips;

  // Clean up references in all active rooms so there are no orphan records or financial inconsistencies
  for (const rEntry of ROOMS.values()) {
    const st = rEntry.state;
    if (!st) continue;
    if (Array.isArray(st.players)) {
      st.players = st.players.filter(p => p.id !== deletedId);
    }
    rEntry.heartbeats.delete(deletedId);
    if (st.race) {
      if (Array.isArray(st.race.bets)) {
        st.race.bets = st.race.bets.filter(b => b.pid !== deletedId);
      }
      if (st.race.exposures && st.race.exposures[deletedId]) {
        delete st.race.exposures[deletedId];
      }
      if (st.race.res) {
        for (const [bId, rVal] of Object.entries(st.race.res)) {
          if (rVal && rVal.pid === deletedId) delete st.race.res[bId];
        }
      }
    }
    ensureAuthorizedCreator(rEntry);
    rEntry.updatedAt = Date.now() / 1000;
  }

  // Clean up any pending invites for this user
  INVITES.delete(deletedId.toLowerCase());
  INVITES.delete(String(deletedName || '').trim().toLowerCase());

  // Delete from PLAYERS_DB (clearing machineId binding as well so no block/ban is imposed)
  PLAYERS_DB.delete(deletedId);
  savePlayersDb();

  const logEntry = appendAdminLog(
    'DELETE_ACCOUNT',
    `Conta excluída pelo Admin: ${deletedName} (${deletedId}) · Saldo era ${deletedChips.toFixed(2)} fichas`,
    {
      targetPlayerId: deletedId,
      targetName: deletedName,
      deletedPlayerId: deletedId,
      deletedPlayerName: deletedName,
      deletedChips
    }
  );

  return {
    ok: true,
    status: 200,
    deletedPlayerId: deletedId,
    deletedPlayer: { id: deletedId, name: deletedName, chips: deletedChips },
    logEntry
  };
}

/**
 * Authoritative Bet Placement on Server
 */
function processServerPlaceBet(roomState, rawBet, fallbackPid) {
  if (!roomState || !roomState.race) {
    return { ok: false, status: 400, error: 'Nenhuma corrida ativa na sala.' };
  }
  const race = roomState.race;
  const pid = String((rawBet && rawBet.pid) || fallbackPid || '');
  if (!pid) return { ok: false, status: 400, error: 'Jogador não identificado.' };

  let playerRec = PLAYERS_DB.get(pid);
  if (!playerRec) {
    const roomPl = (roomState.players || []).find(x => x.id === pid);
    playerRec = upsertPlayerRecord(roomPl || { id: pid, name: rawBet.playerName || 'Piloto', chips: getInitialChips() }, true, { internalTrusted: true, preserveExplicitChips: true });
  }
  ensurePlayerFinancialFields(playerRec);

  const betId = String((rawBet && rawBet.id) || `bet_${pid}_${race.id}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`);

  if (PROCESSED_BET_IDS.has(betId) || (Array.isArray(race.bets) && race.bets.some(b => b.id === betId))) {
    return { ok: false, status: 409, code: 'DUPLICATE_BET', error: 'Este bilhete já foi processado.' };
  }

  race.exposures = race.exposures || {};
  if (playerRec.raceExposures && playerRec.raceExposures[race.id] && !race.exposures[pid]) {
    race.exposures[pid] = playerRec.raceExposures[race.id];
  }

  const modality = (rawBet && rawBet.modality === 'placement') ? 'placement' : 'overtake';
  const driverId = String((rawBet && rawBet.driver) || '');
  const market = rawBet && rawBet.market ? String(rawBet.market) : 'P1';
  const amount = r2(rawBet && rawBet.amount);

  const validation = F1Finance.validateBetRequest({
    race,
    player: playerRec,
    modality,
    driverId,
    market,
    amount
  });

  if (!validation.ok) {
    return {
      ok: false,
      status: 400,
      code: validation.code,
      error: validation.error,
      exposure: validation.exposure,
      player: sanitizePlayerForPublic(playerRec)
    };
  }

  playerRec.raceExposures[race.id] = race.exposures[pid];

  const stake = validation.stake;
  if (playerRec.chips < stake) {
    return { ok: false, status: 400, code: 'INSUFFICIENT_BALANCE', error: 'Saldo insuficiente.' };
  }

  PROCESSED_BET_IDS.add(betId);
  playerRec.chips = r2(playerRec.chips - stake);
  playerRec.committedChips = r2((playerRec.committedChips || 0) + stake);
  playerRec.totalBalance = r2(playerRec.chips + playerRec.committedChips);
  playerRec.balanceVersion = Number(playerRec.balanceVersion || 1) + 1;
  playerRec.updatedAt = Date.now() / 1000;

  const currentRound = Math.floor((Number(race.lap) || 0) / 10);
  const startPos = (Array.isArray(race.order) ? race.order.indexOf(driverId) : -1) + 1;
  const confirmedEventSeq = Array.isArray(race.overtakeLog) ? race.overtakeLog.length : (Number(race.ovSeq) || 0);

  const confirmedBet = {
    id: betId,
    raceId: race.id,
    pid: playerRec.id,
    playerName: rawBet.playerName || playerRec.name,
    playerAvatar: rawBet.playerAvatar || '🏎️',
    playerColor: rawBet.playerColor || '#e10600',
    modality,
    driver: driverId,
    amount: stake,
    round: currentRound,
    lap: Number(race.lap || 0),
    startPos: startPos > 0 ? startPos : 1,
    confirmedEventSeq,
    locked: false,
    cancelled: false,
    status: 'ACTIVE',
    modelVersion: validation.modelVersion,
    ts: Date.now()
  };

  if (modality === 'placement') {
    confirmedBet.market = validation.market;
    confirmedBet.marketLabel = validation.marketLabel;
    confirmedBet.odd = validation.odd;
    confirmedBet.probability = validation.probability;
  } else {
    confirmedBet.mult = validation.mult;
    confirmedBet.expectedOvertakes = validation.expectedOvertakes;
    confirmedBet.factorF = validation.factorF;
  }

  race.bets = Array.isArray(race.bets) ? race.bets : [];
  race.bets.push(confirmedBet);

  playerRec.cashbox.totalBet = r2(playerRec.cashbox.totalBet + stake);
  playerRec.cashbox.betHistory.unshift({
    id: betId,
    raceId: race.id,
    circuit: (race.circuit && race.circuit.name) || 'Circuito',
    modality,
    driver: driverId,
    market: confirmedBet.market || null,
    marketLabel: confirmedBet.marketLabel || null,
    odd: confirmedBet.odd || null,
    probability: confirmedBet.probability || null,
    expectedOvertakes: confirmedBet.expectedOvertakes ?? null,
    amount: stake,
    round: currentRound,
    lap: confirmedBet.lap,
    mult: confirmedBet.mult || null,
    modelVersion: confirmedBet.modelVersion,
    status: 'active',
    ret: 0,
    net: 0,
    date: new Date().toLocaleString('pt-BR')
  });

  const txTitle = modality === 'placement'
    ? `Aposta de Colocação · ${driverId} (${confirmedBet.marketLabel})`
    : `Aposta de Ultrapassagem · ${driverId} (Exp: ${confirmedBet.expectedOvertakes} ULTs)`;
  const txDetail = modality === 'placement'
    ? `${(race.circuit && race.circuit.name) || 'GP'} · Odd: ${confirmedBet.odd.toFixed(2)}x (Prob: ${(confirmedBet.probability * 100).toFixed(1)}%)`
    : `${(race.circuit && race.circuit.name) || 'GP'} · Volta ${confirmedBet.lap} · Mult: ${confirmedBet.mult}x`;

  recordServerTx(playerRec, 'tx_bet_' + betId, 'BET_PLACED', txTitle, txDetail, -stake);
  const updatedExposure = F1Finance.getOrInitRaceExposure(race, playerRec.id, playerRec.chips);
  savePlayersDb();
  syncRoomPlayerBalances(roomState);

  return {
    ok: true,
    status: 200,
    bet: confirmedBet,
    exposure: updatedExposure,
    player: sanitizePlayerForPublic(playerRec)
  };
}

/**
 * Authoritative Bet Cancellation on Server
 */
function processServerCancelBet(roomState, betId, pid) {
  if (!roomState || !roomState.race) {
    return { ok: false, status: 400, error: 'Nenhuma corrida ativa.' };
  }
  const race = roomState.race;
  if (race.done || race.running || !race.bettingOpen) {
    return { ok: false, status: 400, error: 'A janela de apostas já está encerrada.' };
  }
  const bet = (race.bets || []).find(b => b.id === betId);
  if (!bet) return { ok: false, status: 404, error: 'Aposta não encontrada.' };
  if (pid && bet.pid !== pid) return { ok: false, status: 403, error: 'Você só pode cancelar suas próprias apostas.' };
  if (bet.locked) return { ok: false, status: 400, error: 'Aposta bloqueada em rodada anterior.' };
  if (bet.cancelled) return { ok: false, status: 409, error: 'Esta aposta já foi cancelada.' };

  bet.cancelled = true;
  bet.status = 'CANCELLED';
  race.bets = race.bets.filter(b => b.id !== betId);

  const playerRec = PLAYERS_DB.get(bet.pid);
  if (playerRec) {
    ensurePlayerFinancialFields(playerRec);
    playerRec.chips = r2(playerRec.chips + bet.amount);
    playerRec.committedChips = r2(Math.max(0, (playerRec.committedChips || 0) - bet.amount));
    playerRec.totalBalance = r2(playerRec.chips + playerRec.committedChips);
    playerRec.balanceVersion = Number(playerRec.balanceVersion || 1) + 1;
    playerRec.updatedAt = Date.now() / 1000;
    playerRec.cashbox.totalBet = r2(Math.max(0, playerRec.cashbox.totalBet - bet.amount));

    const hEntry = playerRec.cashbox.betHistory.find(h => h.id === betId);
    if (hEntry) hEntry.status = 'cancelled';

    recordServerTx(
      playerRec,
      'tx_cancel_' + betId,
      'BET_CANCELLED',
      `Aposta Cancelada (${bet.driver})`,
      `Estorno imediato · ${(race.circuit && race.circuit.name) || 'GP'}`,
      +bet.amount
    );
    savePlayersDb();
  }

  const updatedExposure = playerRec ? F1Finance.getOrInitRaceExposure(race, playerRec.id, playerRec.chips) : null;
  syncRoomPlayerBalances(roomState);
  return {
    ok: true,
    status: 200,
    betId,
    exposure: updatedExposure,
    player: sanitizePlayerForPublic(playerRec)
  };
}

/**
 * Authoritative & Idempotent Race Settlement on Server
 */
function processServerSettleRace(roomState) {
  if (!roomState || !roomState.race) {
    return { ok: false, status: 400, error: 'Nenhuma corrida para liquidar.' };
  }
  const race = roomState.race;
  if (!race.done && !race.cancelled) {
    return { ok: false, status: 400, error: 'A corrida ainda não possui resultado final para liquidação.' };
  }

  if (!race.cancelled && (!Array.isArray(race.order) || race.order.length === 0)) {
    return { ok: false, status: 400, error: 'Resultado final inválido ou ausente.' };
  }

  race.bettingOpen = false;
  race.running = false;
  race.res = race.res || {};
  const settlementBatchId = race.settlementId || `stl_${race.id}_${Date.now()}`;
  race.settlementId = settlementBatchId;

  const settledTickets = [];

  for (const b of (race.bets || [])) {
    if (!b || b.cancelled) continue;

    const ticketSettlementKey = `${race.id}::${b.id}`;
    const outcome = F1Finance.evaluateTicketForRace(race, b);
    if (!outcome) continue;

    outcome.settlementId = `stl_${b.id}`;
    race.res[b.id] = outcome;
    b.status = outcome.status;

    const playerRec = PLAYERS_DB.get(b.pid);
    if (!playerRec) continue;
    ensurePlayerFinancialFields(playerRec);

    if (PROCESSED_SETTLEMENTS.has(ticketSettlementKey) || playerRec.settledBets[b.id]) {
      continue;
    }

    PROCESSED_SETTLEMENTS.add(ticketSettlementKey);
    playerRec.settledBets[b.id] = {
      settlementId: outcome.settlementId,
      status: outcome.status,
      ret: outcome.ret,
      net: outcome.net,
      ts: Date.now()
    };

    playerRec.committedChips = r2(Math.max(0, (playerRec.committedChips || 0) - b.amount));

    if (outcome.ret > 0) {
      playerRec.chips = r2(playerRec.chips + outcome.ret);
    }
    playerRec.totalBalance = r2(playerRec.chips + playerRec.committedChips);
    playerRec.balanceVersion = Number(playerRec.balanceVersion || 1) + 1;
    playerRec.updatedAt = Date.now() / 1000;

    const hEntry = playerRec.cashbox.betHistory.find(h => h.id === b.id);

    if (outcome.voided || outcome.status === 'VOID') {
      playerRec.cashbox.totalBet = r2(Math.max(0, playerRec.cashbox.totalBet - b.amount));
      if (hEntry) {
        hEntry.status = 'void';
        hEntry.ret = outcome.ret;
        hEntry.net = 0;
      }
      recordServerTx(
        playerRec,
        'tx_settle_' + b.id,
        'BET_VOID',
        `Aposta Anulada / VOID (${b.driver})`,
        `Reembolso integral (${outcome.reason || 'Exceção de corrida'}) · ${(race.circuit && race.circuit.name) || 'GP'}`,
        +outcome.ret
      );
    } else if (outcome.won) {
      playerRec.wins = (playerRec.wins || 0) + 1;
      playerRec.cashbox.totalWon = r2(playerRec.cashbox.totalWon + outcome.net);
      if (hEntry) {
        hEntry.status = 'won';
        hEntry.fin = outcome.fin;
        hEntry.actualOvertakes = outcome.actualOvertakes;
        hEntry.ret = outcome.ret;
        hEntry.net = outcome.net;
      }
      const winDetail = b.modality === 'placement'
        ? `${(race.circuit && race.circuit.name) || 'GP'} · Mercado ${b.market} (${b.odd.toFixed(2)}x) · Retorno: ${outcome.ret.toFixed(2)} (Lucro: +${outcome.net.toFixed(2)})`
        : `${(race.circuit && race.circuit.name) || 'GP'} · ULTs: ${outcome.actualOvertakes} (Exp: ${outcome.expectedOvertakes}) · Retorno: ${outcome.ret.toFixed(2)} (Lucro: +${outcome.net.toFixed(2)})`;
      recordServerTx(
        playerRec,
        'tx_settle_' + b.id,
        'RACE_WIN',
        `Vitória na Aposta (${b.driver})`,
        winDetail,
        +outcome.ret
      );
    } else {
      playerRec.losses = (playerRec.losses || 0) + 1;
      const lossAmt = Math.abs(outcome.net);
      playerRec.cashbox.totalLost = r2(playerRec.cashbox.totalLost + lossAmt);
      if (hEntry) {
        hEntry.status = 'lost';
        hEntry.fin = outcome.fin;
        hEntry.actualOvertakes = outcome.actualOvertakes;
        hEntry.ret = 0;
        hEntry.net = outcome.net;
      }
      const lossDetail = b.modality === 'placement'
        ? `${(race.circuit && race.circuit.name) || 'GP'} · Mercado ${b.market} · Classificação: ${outcome.isDnf ? 'DNF' : outcome.fin + 'º'}`
        : `${(race.circuit && race.circuit.name) || 'GP'} · ULTs realizadas: ${outcome.actualOvertakes ?? 0} (Esperadas: ${outcome.expectedOvertakes ?? 0})`;
      recordServerTx(
        playerRec,
        'tx_settle_' + b.id,
        'RACE_LOSS',
        `Aposta Perdida (${b.driver})`,
        lossDetail,
        0
      );
    }

    playerRec.cashbox.netProfit = r2(playerRec.cashbox.totalWon - playerRec.cashbox.totalLost);
    settledTickets.push(outcome);
  }

  race.settled = true;
  savePlayersDb();
  syncRoomPlayerBalances(roomState);

  return {
    ok: true,
    status: 200,
    settlementId: settlementBatchId,
    settledCount: settledTickets.length,
    results: race.res
  };
}

/**
 * Lists all active rooms for Spectator Mode (Requirement 3)
 */
function listActiveRoomsForSpectator() {
  const list = [];
  for (const [code, entry] of ROOMS.entries()) {
    cleanupPresence(entry);
    const st = entry.state;
    if (!st) continue;
    const onlinePlayers = (st.players || []).filter(p => p.online !== false && !p.isSpectator);
    const r = st.race;
    let status = 'LOBBY';
    if (r) {
      if (r.done || r.cancelled) status = 'FINISHED';
      else if (r.running) status = 'IN_PROGRESS';
      else if (r.started) status = 'PAUSED_BETTING';
      else status = 'PRE_RACE_BETTING';
    }
    const creator = (st.players || []).find(p => p.id === (st.creatorId || st.hostId));
    list.push({
      code,
      creatorId: st.creatorId || st.hostId,
      creatorName: creator ? creator.name : 'Host',
      circuitId: (r && r.circuit && r.circuit.id) || st.circuitId || 'int',
      circuitName: (r && r.circuit && r.circuit.name) || st.circuitId || 'Interlagos',
      circuitFlag: (r && r.circuit && r.circuit.flag) || '🏁',
      playersCount: (st.players || []).length,
      onlineCount: onlinePlayers.length,
      totalPlayers: (st.players || []).length,
      onlinePlayers: onlinePlayers.length,
      players: (st.players || []).map(p => ({ id: p.id, name: p.name, avatarIcon: p.avatarIcon, color: p.color, online: p.online !== false })),
      hasRace: !!r,
      status,
      raceStatus: status,
      inProgress: !!(r && !r.done && !r.cancelled),
      running: !!(r && r.running),
      lap: r ? r.lap : 0,
      totalLaps: r ? r.total : (st.laps || 15),
      updatedAt: entry.updatedAt
    });
  }
  return list.sort((a, b) => (b.inProgress - a.inProgress) || ((b.updatedAt || 0) - (a.updatedAt || 0)));
}

function sendJson(res, status, data) {
  const body = Buffer.from(JSON.stringify(data), 'utf-8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token, X-Machine-Id, X-Auth-Token'
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
  const clientIp = getClientIp(req);
  const headerMachineId = req.headers['x-machine-id'] ? String(req.headers['x-machine-id']).trim() : '';
  const headerAuthToken = req.headers['x-auth-token'] ? String(req.headers['x-auth-token']).trim() : '';

  if (pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      server: 'node',
      modelVersion: F1Finance.MODEL_VERSION,
      initialChips: getInitialChips(),
      exposureRate: F1Finance.EXPOSURE_RATE,
      ts: Date.now() / 1000
    });
  }

  // Public list of active lobbies & ongoing matches for Spectator Mode (Requirement 3)
  if (pathname === '/api/rooms' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, rooms: listActiveRoomsForSpectator() });
  }

  // Public player lookup by nickname for invitations (Requirement 1 & 8)
  if (pathname === '/api/players/search' && req.method === 'GET') {
    const q = String(parsed.query.q || '').trim().toLowerCase();
    const all = Array.from(PLAYERS_DB.values())
      .filter(p => !q || String(p.name || '').toLowerCase().includes(q) || String(p.id || '').toLowerCase().includes(q))
      .slice(0, 30)
      .map(p => ({ id: p.id, name: p.name, avatarId: p.avatarId, wins: p.wins || 0, chips: p.chips }));
    return sendJson(res, 200, { ok: true, players: all });
  }

  // Poll pending invitations for a player by ID or Nickname (Requirement 1)
  if (pathname === '/api/invites' && req.method === 'GET') {
    const pid = String(parsed.query.pid || parsed.query.playerId || '').trim().toLowerCase();
    const name = String(parsed.query.name || parsed.query.nickname || '').trim().toLowerCase();
    const now = Date.now();
    const collected = [];
    for (const key of [pid, name]) {
      if (!key) continue;
      const arr = INVITES.get(key) || [];
      const valid = arr.filter(inv => (now - inv.ts) < 300000); // 5 min TTL
      INVITES.set(key, valid);
      for (const inv of valid) {
        if (!collected.some(x => x.id === inv.id)) collected.push(inv);
      }
    }
    return sendJson(res, 200, { ok: true, invites: collected });
  }

  // Admin: Get all registered players globally + server config (Requirement 7 & 8)
  if (pathname === '/api/admin/players' && req.method === 'GET') {
    const token = getAdminToken(req, null, parsed.query);
    if (!verifyAdminToken(token)) return sendJson(res, 401, { ok: false, error: 'UNAUTHORIZED_ADMIN' });
    const q = String(parsed.query.q || '').trim().toLowerCase();
    let list = Array.from(PLAYERS_DB.values())
      .map(p => sanitizePlayerForPublic(ensurePlayerFinancialFields(p)))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (q) {
      list = list.filter(p => String(p.name || '').toLowerCase().includes(q) || String(p.id || '').toLowerCase().includes(q));
    }
    return sendJson(res, 200, {
      ok: true,
      players: list,
      initialChips: getInitialChips(),
      adminLogs: (SERVER_CONFIG.adminLogs || []).slice(0, 50)
    });
  }

  if (pathname === '/api/admin/config' && req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      initialChips: getInitialChips(),
      exposureRate: F1Finance.EXPOSURE_RATE
    });
  }

  if (pathname.startsWith('/api/player/') && req.method === 'GET') {
    const pid = pathname.split('/')[3];
    const rec = PLAYERS_DB.get(pid);
    if (!rec) return sendJson(res, 404, { ok: false, error: 'PLAYER_NOT_FOUND' });
    return sendJson(res, 200, { ok: true, player: sanitizePlayerForPublic(ensurePlayerFinancialFields(rec)) });
  }

  if (req.method === 'POST' && (
    pathname.startsWith('/api/admin/') ||
    pathname === '/api/player/sync' ||
    pathname === '/api/account/init' ||
    pathname === '/api/account/delete_self' ||
    pathname === '/api/invites/send' ||
    pathname === '/api/invites/dismiss'
  )) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch (e) {}

      // Self-service account deletion/reset by the player themselves
      if (pathname === '/api/account/delete_self') {
        const machineId = String(payload.machineId || headerMachineId || '').trim() || null;
        const authToken = String(payload.authToken || headerAuthToken || '').trim() || null;
        const requestedId = String(payload.playerId || '').trim();

        let targetRec = requestedId ? PLAYERS_DB.get(requestedId) : null;
        if (!targetRec && machineId) {
          targetRec = findAccountForMachine(machineId, clientIp);
        }

        if (!targetRec) {
          return sendJson(res, 200, {
            ok: true,
            deleted: false,
            initialChips: getInitialChips(),
            message: 'Perfil local resetado com sucesso.'
          });
        }

        // Verify ownership by machineId or authToken so a user can only delete their own profile
        const isOwner = (!targetRec.machineId && !targetRec.authToken) ||
          (machineId && targetRec.machineId === machineId) ||
          (authToken && targetRec.authToken === authToken) ||
          (targetRec.clientIp && targetRec.clientIp === clientIp);

        if (!isOwner) {
          return sendJson(res, 403, {
            ok: false,
            error: 'Você só pode excluir o perfil vinculado ao seu próprio dispositivo.'
          });
        }

        const delRes = deletePlayerAccountAdmin(targetRec.id);
        return sendJson(res, 200, {
          ok: true,
          deleted: true,
          deletedPlayerId: targetRec.id,
          deletedPlayer: delRes.deletedPlayer,
          initialChips: getInitialChips()
        });
      }

      // 1. Account initialization & IP/Machine control endpoint (Requirement 1)
      if (pathname === '/api/account/init') {
        const machineId = String(payload.machineId || headerMachineId || '').trim() || `ip_${clientIp}`;
        const authToken = String(payload.authToken || headerAuthToken || '').trim() || null;
        const requestedId = String((payload.player && payload.player.id) || payload.playerId || '').trim();
        const createNewAttempt = !!payload.createNew;

        const existingForMachine = findAccountForMachine(machineId, clientIp);

        // If user explicitly tried to create a second account on the same machine, block duplicate creation
        if (createNewAttempt && existingForMachine) {
          return sendJson(res, 409, {
            ok: false,
            code: 'ACCOUNT_LIMIT_PER_MACHINE',
            error: `Já existe uma conta registrada para este dispositivo (${existingForMachine.name}). Apenas uma conta por máquina é permitida.`,
            player: existingForMachine
          });
        }

        // If machine already has an account, return it (preventing link-based account sharing or duplicates)
        if (existingForMachine) {
          ensurePlayerFinancialFields(existingForMachine);
          if (payload.player && payload.player.name && (!existingForMachine.authToken || existingForMachine.authToken === authToken)) {
            existingForMachine.name = String(payload.player.name).trim().slice(0, 24) || existingForMachine.name;
            if (payload.player.avatarId) existingForMachine.avatarId = String(payload.player.avatarId);
            savePlayersDb();
          }
          return sendJson(res, 200, {
            ok: true,
            player: existingForMachine,
            initialChips: getInitialChips(),
            boundToMachine: true,
            reusedBoundAccount: true
          });
        }

        // Otherwise register new account bound to this machineId & IP with configured initialChips
        const pIn = payload.player ? Object.assign({}, payload.player) : {
          id: requestedId || ('usr_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex')),
          name: payload.name || `Piloto ${PLAYERS_DB.size + 1}`,
          avatarId: payload.avatarId || 'av1',
          chips: getInitialChips()
        };
        // Never allow a new machine to hijack an existing playerId owned by another device
        if (pIn.id && PLAYERS_DB.has(pIn.id)) {
          const ownerRec = PLAYERS_DB.get(pIn.id);
          if (ownerRec && ownerRec.machineId && ownerRec.machineId !== machineId && ownerRec.authToken !== authToken) {
            pIn.id = 'usr_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
          }
        }
        const created = upsertPlayerRecord(pIn, false, { machineId, clientIp, authToken });
        return sendJson(res, 200, {
          ok: true,
          player: created,
          initialChips: getInitialChips(),
          boundToMachine: true,
          reusedBoundAccount: false
        });
      }

      // 2. Send Room Invitation by Nickname (Requirement 1)
      if (pathname === '/api/invites/send') {
        const roomCode = String(payload.roomCode || '').trim().toUpperCase();
        const fromId = String(payload.fromId || payload.fromPlayerId || '').trim();
        const senderRec = fromId ? PLAYERS_DB.get(fromId) : null;
        const fromName = String(payload.fromName || (senderRec && senderRec.name) || 'Jogador').trim();
        const targetNickname = String(payload.targetNickname || '').trim();

        if (!roomCode || !ROOMS.has(roomCode)) {
          return sendJson(res, 404, { ok: false, error: 'Sala não encontrada no servidor.' });
        }
        if (!targetNickname) {
          return sendJson(res, 400, { ok: false, error: 'Digite o nickname do jogador que deseja convidar.' });
        }

        const targetRec = findPlayerByNickname(targetNickname);
        const targetKey = targetRec ? targetRec.name.toLowerCase() : targetNickname.toLowerCase();
        const invObj = {
          id: `inv_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          roomCode,
          fromId,
          fromPlayerId: fromId,
          fromName,
          targetNickname: targetRec ? targetRec.name : targetNickname,
          targetPlayerId: targetRec ? targetRec.id : null,
          toPlayerId: targetRec ? targetRec.id : null,
          ts: Date.now()
        };

        const listByName = INVITES.get(targetKey) || [];
        listByName.unshift(invObj);
        INVITES.set(targetKey, listByName.slice(0, 20));

        if (targetRec) {
          const listById = INVITES.get(targetRec.id.toLowerCase()) || [];
          listById.unshift(invObj);
          INVITES.set(targetRec.id.toLowerCase(), listById.slice(0, 20));
        }

        return sendJson(res, 200, {
          ok: true,
          invite: invObj,
          foundRegisteredPlayer: !!targetRec
        });
      }

      if (pathname === '/api/invites/dismiss') {
        const invId = String(payload.inviteId || '').trim();
        for (const [k, arr] of INVITES.entries()) {
          INVITES.set(k, arr.filter(x => x.id !== invId));
        }
        return sendJson(res, 200, { ok: true });
      }

      // 3. Admin Login
      if (pathname === '/api/admin/login') {
        const login = String(payload.login || '').trim().toUpperCase();
        const pass = String(payload.password || '').trim();
        if (!verifyAdminCredentials(login, pass)) {
          return sendJson(res, 401, { ok: false, error: 'Credenciais de administrador inválidas.' });
        }
        const token = 'adm_kdf56_' + crypto.randomBytes(24).toString('hex');
        ADMIN_TOKENS.set(token, Date.now() / 1000 + 86400);
        const list = Array.from(PLAYERS_DB.values())
          .map(p => sanitizePlayerForPublic(ensurePlayerFinancialFields(p)))
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        return sendJson(res, 200, {
          ok: true,
          token,
          admin: login,
          players: list,
          initialChips: getInitialChips(),
          adminLogs: (SERVER_CONFIG.adminLogs || []).slice(0, 50)
        });
      }

      if (pathname === '/api/admin/logout') {
        const token = getAdminToken(req, payload, parsed.query);
        ADMIN_TOKENS.delete(token);
        return sendJson(res, 200, { ok: true });
      }

      // 4. Admin Initial Balance Configuration (Requirement 7)
      if (pathname === '/api/admin/config') {
        const token = getAdminToken(req, payload, parsed.query);
        if (!verifyAdminToken(token)) return sendJson(res, 401, { ok: false, error: 'Acesso negado.' });
        const newInit = r2(payload.initialChips);
        if (isNaN(newInit) || newInit < 0) {
          return sendJson(res, 400, { ok: false, error: 'Informe um saldo inicial válido (maior ou igual a zero).' });
        }
        const oldInit = getInitialChips();
        SERVER_CONFIG.initialChips = newInit;
        SERVER_CONFIG.updatedAt = Date.now() / 1000;
        saveServerConfig();
        const logEntry = appendAdminLog(
          'UPDATE_INITIAL_CHIPS',
          `Admin alterou o saldo inicial padrão de ${oldInit.toFixed(2)} para ${newInit.toFixed(2)} fichas`,
          { oldInitialChips: oldInit, newInitialChips: newInit }
        );
        return sendJson(res, 200, {
          ok: true,
          initialChips: newInit,
          logEntry,
          adminLogs: (SERVER_CONFIG.adminLogs || []).slice(0, 50)
        });
      }

      // 5. Admin Delete Account (Requirement 9) or Purge Non-Protected Accounts
      if (pathname === '/api/admin/purge_non_protected') {
        const token = getAdminToken(req, payload, parsed.query);
        if (!verifyAdminToken(token)) return sendJson(res, 401, { ok: false, error: 'Acesso negado.' });
        const purgeRes = purgeNonProtectedAccounts();
        const logEntry = appendAdminLog(
          'PURGE_NON_PROTECTED',
          `Admin resetou todas as contas exceto LX/LXZADA e naoc7k/N7K (Mantidas: ${purgeRes.kept.length}, Excluídas: ${purgeRes.removed.length})`
        );
        const list = Array.from(PLAYERS_DB.values())
          .map(p => sanitizePlayerForPublic(ensurePlayerFinancialFields(p)))
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        return sendJson(res, 200, {
          ok: true,
          kept: purgeRes.kept,
          removed: purgeRes.removed,
          players: list,
          logEntry,
          adminLogs: (SERVER_CONFIG.adminLogs || []).slice(0, 50)
        });
      }

      if (pathname === '/api/admin/delete_player') {
        const token = getAdminToken(req, payload, parsed.query);
        if (!verifyAdminToken(token)) return sendJson(res, 401, { ok: false, error: 'Acesso negado.' });
        const target = payload.playerId || payload.nickname;
        const delRes = deletePlayerAccountAdmin(target);
        if (!delRes.ok) return sendJson(res, delRes.status || 400, delRes);
        const list = Array.from(PLAYERS_DB.values())
          .map(p => sanitizePlayerForPublic(ensurePlayerFinancialFields(p)))
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        return sendJson(res, 200, {
          ok: true,
          deletedPlayerId: delRes.deletedPlayerId,
          deletedPlayer: delRes.deletedPlayer,
          logEntry: delRes.logEntry,
          players: list,
          adminLogs: (SERVER_CONFIG.adminLogs || []).slice(0, 50)
        });
      }

      // 6. Admin Balance Management
      if (pathname === '/api/admin/balance') {
        const token = getAdminToken(req, payload, parsed.query);
        if (!verifyAdminToken(token)) return sendJson(res, 401, { ok: false, error: 'Acesso negado.' });
        const targetId = String(payload.playerId || '').trim();
        const op = String(payload.operation || '').trim().toLowerCase();
        const amount = r2(payload.amount);
        if (amount < 0 || isNaN(amount)) return sendJson(res, 400, { ok: false, error: 'Valor inválido.' });
        const rec = PLAYERS_DB.get(targetId) || findPlayerByNickname(targetId);
        if (!rec) return sendJson(res, 404, { ok: false, error: 'Jogador não encontrado.' });

        ensurePlayerFinancialFields(rec);
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
        rec.totalBalance = r2(rec.chips + (rec.committedChips || 0));
        rec.balanceVersion = Number(rec.balanceVersion || 1) + 1;
        rec.updatedAt = Date.now() / 1000;
        const admId = `adm_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        rec.lastAdminOp = {
          id: admId,
          op,
          amount,
          oldBalance: oldChips,
          newBalance: newChips,
          label: opLabel,
          ts: rec.updatedAt
        };
        recordServerTx(rec, 'tx_' + admId, newChips >= oldChips ? 'ADMIN_ADD' : 'ADMIN_REMOVE', 'Ajuste Administrativo', opLabel, r2(newChips - oldChips));
        appendAdminLog('BALANCE_' + op.toUpperCase(), `${rec.name} (${rec.id}): ${opLabel} (${oldChips.toFixed(2)} -> ${newChips.toFixed(2)})`);
        savePlayersDb();

        for (const rEntry of ROOMS.values()) {
          if (rEntry.state && Array.isArray(rEntry.state.players)) {
            const rp = rEntry.state.players.find(p => p.id === rec.id);
            if (rp) {
              rp.chips = newChips;
              rp.balanceVersion = rec.balanceVersion;
            }
          }
        }
        const list = Array.from(PLAYERS_DB.values())
          .map(p => sanitizePlayerForPublic(ensurePlayerFinancialFields(p)))
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        return sendJson(res, 200, {
          ok: true,
          player: sanitizePlayerForPublic(rec),
          players: list,
          adminLogs: (SERVER_CONFIG.adminLogs || []).slice(0, 50)
        });
      }

      if (pathname === '/api/player/sync') {
        const pIn = payload.player || payload;
        const machineId = String(payload.machineId || pIn.machineId || headerMachineId || '').trim() || null;
        const authToken = String(payload.authToken || pIn.authToken || headerAuthToken || '').trim() || null;

        // If an account was deleted by admin and the client is trying to auto-sync the old local snapshot,
        // only re-create if explicitly allowed or bind cleanly with current configured initialChips
        const rec = upsertPlayerRecord(pIn, false, { machineId, clientIp, authToken });
        if (!rec) return sendJson(res, 400, { ok: false, error: 'INVALID_PLAYER' });
        return sendJson(res, 200, { ok: true, player: rec, initialChips: getInitialChips() });
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
      const isSpectator = parsed.query.spectator === '1';

      // Requirement 3: Do NOT register or heartbeat spectators as room participants!
      if (pid && !isSpectator) {
        if (entry.state && Array.isArray(entry.state.players)) {
          const pl = entry.state.players.find(x => x.id === pid);
          if (pl) {
            entry.heartbeats.set(pid, now);
            pl.online = true;
          }
        }
      }
      cleanupPresence(entry);
      const creatorId = entry.state.creatorId || entry.state.hostId;
      const isHost = !isSpectator && parsed.query.host === '1' && (!creatorId || pid === creatorId);
      const actions = isHost ? entry.actions.splice(0) : [];
      const me = pid ? sanitizePlayerForPublic(PLAYERS_DB.get(pid)) : null;
      return sendJson(res, 200, { ok: true, spectator: isSpectator, state: entry.state, actions, updatedAt: entry.updatedAt, me });
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
          // Never allow spectators in state.players
          if (Array.isArray(state.players)) {
            state.players = state.players.filter(p => p && !p.isSpectator);
          }

          let entry = ROOMS.get(code);
          if (entry && entry.state) {
            cleanupPresence(entry);
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
              if (oldRace.exposures) {
                newRace.exposures = Object.assign({}, newRace.exposures || {}, oldRace.exposures);
              }
              if (oldRace.oddsBook && !newRace.oddsBook) {
                newRace.oddsBook = oldRace.oddsBook;
              }
              if (Array.isArray(oldRace.bets)) {
                const oldBetMap = new Map(oldRace.bets.map(b => [b.id, b]));
                const mergedBets = [];
                for (const ob of oldRace.bets) {
                  mergedBets.push(ob);
                }
                for (const nb of (newRace.bets || [])) {
                  if (nb && nb.id && !oldBetMap.has(nb.id)) {
                    mergedBets.push(nb);
                  }
                }
                newRace.bets = mergedBets;
              }
            }
            // Preserve kickedPlayerIds list unless cleared by creator
            if (Array.isArray(entry.state.kickedPlayerIds)) {
              state.kickedPlayerIds = Array.from(new Set([...(state.kickedPlayerIds || []), ...entry.state.kickedPlayerIds]));
              if (Array.isArray(state.players)) {
                state.players = state.players.filter(p => !state.kickedPlayerIds.includes(p.id));
              }
            }
            // Merge any active/recently joined players from entry.state.players so host state updates never wipe a guest who just joined
            if (Array.isArray(entry.state.players)) {
              state.players = Array.isArray(state.players) ? state.players : [];
              const kickedSet = new Set(state.kickedPlayerIds || []);
              const incomingIds = new Set(state.players.map(p => p && p.id));
              for (const ep of entry.state.players) {
                if (!ep || !ep.id || ep.isSpectator || kickedSet.has(ep.id) || incomingIds.has(ep.id)) continue;
                const lastHb = entry.heartbeats.get(ep.id) || 0;
                if ((now - lastHb) < 12 && state.players.length < 8) {
                  state.players.push(ep);
                  incomingIds.add(ep.id);
                }
              }
            }
          } else {
            entry = { state, actions: [], updatedAt: now, heartbeats: new Map() };
            ROOMS.set(code, entry);
          }

          if (payload.pid) entry.heartbeats.set(payload.pid, now);
          for (const p of (state.players || [])) {
            if (p.isSpectator) continue;
            if (!PLAYERS_DB.has(p.id)) {
              upsertPlayerRecord(p, true, { internalTrusted: true, preserveExplicitChips: true });
            }
            if (!entry.heartbeats.has(p.id)) entry.heartbeats.set(p.id, now);
          }

          if (state.race && !state.race.oddsBook) {
            state.race.oddsBook = F1Finance.calculateRaceOdds(state.race);
          }

          entry.state = state;

          if (state.race && (state.race.done || state.race.cancelled) && !state.race.settled) {
            processServerSettleRace(entry.state);
          }

          entry.updatedAt = now;
          cleanupPresence(entry);
          const actions = entry.actions.splice(0);
          return sendJson(res, 200, { ok: true, actions, state: entry.state });
        }

        // Kick / Remove player from lobby (Requirement 2)
        if (op === 'kick') {
          const token = getAdminToken(req, payload, parsed.query);
          const isAdmin = verifyAdminToken(token);
          const requesterId = payload.playerId || payload.requesterId;
          const kickRes = removePlayerFromRoom(code, payload.targetPlayerId, requesterId, isAdmin);
          if (!kickRes.ok) return sendJson(res, kickRes.status || 400, kickRes);
          return sendJson(res, 200, kickRes);
        }

        if (op === 'bet') {
          const entry = ROOMS.get(code);
          if (!entry || !entry.state) return sendJson(res, 404, { ok: false, error: 'ROOM_NOT_FOUND' });
          const resBet = processServerPlaceBet(entry.state, payload.bet || payload, payload.playerId);
          if (!resBet.ok) return sendJson(res, resBet.status || 400, resBet);
          entry.updatedAt = now;
          return sendJson(res, 200, {
            ok: true,
            bet: resBet.bet,
            exposure: resBet.exposure,
            player: resBet.player,
            state: entry.state
          });
        }

        if (op === 'cancel_bet') {
          const entry = ROOMS.get(code);
          if (!entry || !entry.state) return sendJson(res, 404, { ok: false, error: 'ROOM_NOT_FOUND' });
          const resCancel = processServerCancelBet(entry.state, payload.betId, payload.playerId);
          if (!resCancel.ok) return sendJson(res, resCancel.status || 400, resCancel);
          entry.updatedAt = now;
          return sendJson(res, 200, {
            ok: true,
            betId: resCancel.betId,
            exposure: resCancel.exposure,
            player: resCancel.player,
            state: entry.state
          });
        }

        if (op === 'settle') {
          const entry = ROOMS.get(code);
          if (!entry || !entry.state) return sendJson(res, 404, { ok: false, error: 'ROOM_NOT_FOUND' });
          const resSettle = processServerSettleRace(entry.state);
          if (!resSettle.ok) return sendJson(res, resSettle.status || 400, resSettle);
          entry.updatedAt = now;
          return sendJson(res, 200, {
            ok: true,
            settlementId: resSettle.settlementId,
            settledCount: resSettle.settledCount,
            results: resSettle.results,
            state: entry.state
          });
        }

        if (op === 'action') {
          let entry = ROOMS.get(code);
          const action = payload.action || {};
          const pid = action.playerId || (action.player && action.player.id);

          // Spectators cannot send participant actions or be added to players list (Requirement 3)
          if (action.isSpectator || (action.player && action.player.isSpectator)) {
            if (!entry) return sendJson(res, 404, { ok: false, error: 'ROOM_NOT_FOUND' });
            return sendJson(res, 200, { ok: true, state: entry.state });
          }

          if (action.player && !PLAYERS_DB.has(action.player.id)) {
            upsertPlayerRecord(action.player, true, { clientIp, machineId: headerMachineId, internalTrusted: true });
          }
          if (!entry && action.type === 'JOIN_ROOM' && action.player && !action.player.isSpectator) {
            const initPl = Object.assign({}, action.player, { online: true });
            const newSt = {
              code,
              hostId: initPl.id,
              creatorId: initPl.id,
              createdAt: Date.now(),
              circuitId: 'int',
              laps: 15,
              wxMode: 'auto',
              grid: ['VER','NOR','LEC','PIA','HAM','RUS','SAI','ALO','GAS','ALB','HUL','OCO','TSU','STR','LAW','BEA','ANT','DOO','BOR','HAD','COL','BOT'],
              players: [initPl],
              race: null,
              processedActions: []
            };
            entry = { state: newSt, actions: [], updatedAt: now, heartbeats: new Map([[initPl.id, now]]) };
            ROOMS.set(code, entry);
          }
          if (!entry) return sendJson(res, 404, { ok: false, error: 'ROOM_NOT_FOUND' });
          const st = entry.state;

          if (st && Array.isArray(st.players)) {
            if (action.type === 'JOIN_ROOM' && action.player) {
              const pl = action.player;
              if (pl.isSpectator) {
                return sendJson(res, 200, { ok: true, state: entry.state });
              }
              // Remove from kicked list if they are explicitly re-joining
              if (Array.isArray(st.kickedPlayerIds)) {
                st.kickedPlayerIds = st.kickedPlayerIds.filter(id => id !== pl.id);
              }
              pl.online = true;
              entry.heartbeats.set(pl.id, now);
              let rec = PLAYERS_DB.get(pl.id);
              if (!rec) {
                rec = upsertPlayerRecord(pl, true, { clientIp, machineId: headerMachineId, internalTrusted: true });
              }
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
              entry.updatedAt = now;
            } else if (action.type === 'KICK_PLAYER' && action.targetPlayerId) {
              const token = getAdminToken(req, payload, parsed.query);
              const isAdmin = verifyAdminToken(token);
              const kickRes = removePlayerFromRoom(code, action.targetPlayerId, pid, isAdmin);
              if (!kickRes.ok) return sendJson(res, kickRes.status || 400, kickRes);
              return sendJson(res, 200, { ok: true, state: entry.state });
            } else if (action.type === 'PLACE_BET' && action.bet) {
              if (pid) entry.heartbeats.set(pid, now);
              const resBet = processServerPlaceBet(st, action.bet, pid);
              if (!resBet.ok) {
                return sendJson(res, resBet.status || 400, resBet);
              }
              action.bet = resBet.bet;
              action.playerChips = resBet.player.chips;
              action.balanceVersion = resBet.player.balanceVersion;
            } else if (action.type === 'CANCEL_BET' && action.betId) {
              if (pid) entry.heartbeats.set(pid, now);
              const resCancel = processServerCancelBet(st, action.betId, pid);
              if (!resCancel.ok) {
                return sendJson(res, resCancel.status || 400, resCancel);
              }
              action.playerChips = resCancel.player ? resCancel.player.chips : undefined;
              action.balanceVersion = resCancel.player ? resCancel.player.balanceVersion : undefined;
            } else if (action.type === 'DISCONNECT' && pid) {
              entry.heartbeats.set(pid, 0);
              const ex = st.players.find(x => x.id === pid);
              if (ex) ex.online = false;
              ensureAuthorizedCreator(entry);
            } else if (action.type === 'LEAVE_ROOM' && pid) {
              st.players = st.players.filter(x => x.id !== pid);
              entry.heartbeats.delete(pid);
              ensureAuthorizedCreator(entry);
            } else if (pid) {
              // Only update heartbeat if player is still in the room (not kicked)
              if (st.players.some(x => x.id === pid)) {
                entry.heartbeats.set(pid, now);
              }
            }
          }
          entry.actions.push(action);
          cleanupPresence(entry);
          const me = pid ? sanitizePlayerForPublic(PLAYERS_DB.get(pid)) : null;
          return sendJson(res, 200, { ok: true, state: entry.state, me });
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
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.end(data);
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`F1 Betting Simulator Server rodando em http://localhost:${PORT}`);
  });
}

module.exports = {
  server,
  ROOMS,
  PLAYERS_DB,
  INVITES,
  SERVER_CONFIG,
  PROCESSED_BET_IDS,
  PROCESSED_SETTLEMENTS,
  getInitialChips,
  upsertPlayerRecord,
  issueInternalTestAdminToken,
  findAccountForMachine,
  findPlayerByNickname,
  removePlayerFromRoom,
  deletePlayerAccountAdmin,
  isProtectedAccountName,
  purgeNonProtectedAccounts,
  listActiveRoomsForSpectator,
  processServerPlaceBet,
  processServerCancelBet,
  processServerSettleRace,
  savePlayersDb,
  saveServerConfig
};
