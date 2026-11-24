/**
 * F1 Betting Simulator - Authoritative Multiplayer, Admin & Financial Engine Server (Node.js)
 * Zero external dependencies. Runs on port 8080.
 *
 * Enforces:
 *  - Server-authoritative player balances, committed chips, and transaction history
 *  - 10% initial race balance exposure limit across Overtake and Placement modalities
 *  - Protection against client-side balance inflation / manipulation
 *  - Concurrency protection, duplicate bet rejection, and idempotent race settlement
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

const INITIAL_CHIPS = 100;
const ADMIN_LOGIN = 'LN';
const ADMIN_PASS_HASH = crypto.createHash('sha256').update('jairo').digest('hex');

const ROOMS = new Map();
const PLAYERS_DB = new Map();
const ADMIN_TOKENS = new Map();
const PROCESSED_BET_IDS = new Set();
const PROCESSED_SETTLEMENTS = new Set();

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

function ensurePlayerFinancialFields(rec) {
  if (!rec) return null;
  rec.chips = Math.max(0, r2(rec.chips !== undefined ? rec.chips : INITIAL_CHIPS));
  rec.committedChips = Math.max(0, r2(rec.committedChips || 0));
  rec.totalBalance = r2(rec.chips + rec.committedChips);
  rec.wins = Math.max(0, Number(rec.wins || 0));
  rec.losses = Math.max(0, Number(rec.losses || 0));
  rec.balanceVersion = Math.max(1, Number(rec.balanceVersion || 1));
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

function savePlayersDb() {
  try {
    const obj = {};
    for (const [k, v] of PLAYERS_DB.entries()) obj[k] = v;
    fs.writeFileSync(PLAYERS_DB_PATH, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (e) {}
}

loadPlayersDb();

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
 * Registers or updates a player in PLAYERS_DB.
 * IMPORTANT SECURITY RULE (Section 8):
 * Once a player exists on the server, the client CANNOT arbitrarily increase or overwrite `chips`.
 * Only authoritative server operations (admin, bet placement, bet cancellation, race settlement) can change `chips`.
 */
function upsertPlayerRecord(pData, allowInitialSeed = true) {
  if (!pData || !pData.id) return null;
  const pid = String(pData.id);
  const now = Date.now() / 1000;
  const existing = PLAYERS_DB.get(pid);
  const clientVer = Number(pData.balanceVersion || 0);

  if (!existing) {
    let chipsVal = allowInitialSeed && pData.chips !== undefined ? r2(pData.chips) : INITIAL_CHIPS;
    if (chipsVal === 25000 && Number(pData.wins || 0) === 0) chipsVal = INITIAL_CHIPS;
    if (chipsVal < 0 || isNaN(chipsVal)) chipsVal = INITIAL_CHIPS;
    const rec = ensurePlayerFinancialFields({
      id: pid,
      name: String(pData.name || 'Piloto').trim().slice(0, 24),
      avatarId: String(pData.avatarId || 'av1'),
      chips: chipsVal,
      committedChips: 0,
      wins: Number(pData.wins || 0),
      losses: Number(pData.losses || 0),
      balanceVersion: Math.max(1, clientVer),
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
  existing.name = String(pData.name || existing.name).trim().slice(0, 24);
  existing.avatarId = String(pData.avatarId || existing.avatarId || 'av1');
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
  for (const p of st.players) {
    let rec = PLAYERS_DB.get(p.id);
    if (!rec) {
      rec = upsertPlayerRecord(p, true);
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
    playerRec = upsertPlayerRecord(roomPl || { id: pid, name: rawBet.playerName || 'Piloto', chips: INITIAL_CHIPS }, true);
  }
  ensurePlayerFinancialFields(playerRec);

  const betId = String((rawBet && rawBet.id) || `bet_${pid}_${race.id}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`);

  // Duplicate ticket protection
  if (PROCESSED_BET_IDS.has(betId) || (Array.isArray(race.bets) && race.bets.some(b => b.id === betId))) {
    return { ok: false, status: 409, code: 'DUPLICATE_BET', error: 'Este bilhete já foi processado.' };
  }

  // Restore persisted exposure record for this player & race if already locked in PLAYERS_DB
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
      player: playerRec
    };
  }

  // Persist locked exposure on player record so refreshing/reopening tabs can never reset it
  playerRec.raceExposures[race.id] = race.exposures[pid];

  // Immediately deduct stake from available balance
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

  // Update player cashbox & transaction ledger
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
    player: playerRec
  };
}

/**
 * Authoritative Bet Cancellation on Server (while betting window is open and not locked)
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
    player: playerRec
  };
}

/**
 * Authoritative & Idempotent Race Settlement on Server (Section 11 & Section 9)
 */
function processServerSettleRace(roomState) {
  if (!roomState || !roomState.race) {
    return { ok: false, status: 400, error: 'Nenhuma corrida para liquidar.' };
  }
  const race = roomState.race;
  if (!race.done && !race.cancelled) {
    return { ok: false, status: 400, error: 'A corrida ainda não possui resultado final para liquidação.' };
  }

  // Do not settle without a reliable final order unless race was cancelled before start
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

    // Strictly idempotent per ticket: never pay or settle the same ticket twice!
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
      // VOID refund: stake returned once, no win/loss increment, totalBet adjusted
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
    return sendJson(res, 200, { ok: true, server: 'node', modelVersion: F1Finance.MODEL_VERSION, ts: Date.now() / 1000 });
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
    return sendJson(res, 200, { ok: true, player: ensurePlayerFinancialFields(rec) });
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
        if (amount < 0 || isNaN(amount)) return sendJson(res, 400, { ok: false, error: 'Valor inválido.' });
        const rec = PLAYERS_DB.get(targetId);
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
        const pIn = payload.player || payload;
        // Do NOT trust client balance inflation for existing accounts
        const rec = upsertPlayerRecord(pIn, true);
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
              // Preserve authoritative server-confirmed bets, oddsBook, and locked exposures!
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
                  // Never allow incoming state to mutate frozen fields of an already confirmed bet!
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
          } else {
            entry = { state, actions: [], updatedAt: now, heartbeats: new Map() };
            ROOMS.set(code, entry);
          }

          if (payload.pid) entry.heartbeats.set(payload.pid, now);
          for (const p of (state.players || [])) {
            upsertPlayerRecord(p, true);
            if (!entry.heartbeats.has(p.id)) entry.heartbeats.set(p.id, now);
          }

          // Ensure dynamic oddsBook exists on newly prepared pre-start race
          if (state.race && !state.race.oddsBook) {
            state.race.oddsBook = F1Finance.calculateRaceOdds(state.race);
          }

          entry.state = state;

          // If race just finished or was cancelled, trigger authoritative idempotent server settlement
          if (state.race && (state.race.done || state.race.cancelled) && !state.race.settled) {
            processServerSettleRace(entry.state);
          }

          entry.updatedAt = now;
          cleanupPresence(entry);
          const actions = entry.actions.splice(0);
          return sendJson(res, 200, { ok: true, actions, state: entry.state });
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
            } else if (action.type === 'PLACE_BET' && action.bet) {
              const resBet = processServerPlaceBet(st, action.bet, pid);
              if (!resBet.ok) {
                return sendJson(res, resBet.status || 400, resBet);
              }
              action.bet = resBet.bet;
              action.playerChips = resBet.player.chips;
              action.balanceVersion = resBet.player.balanceVersion;
            } else if (action.type === 'CANCEL_BET' && action.betId) {
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
            } else if (action.type === 'LEAVE_ROOM' && pid) {
              st.players = st.players.filter(x => x.id !== pid);
              entry.heartbeats.delete(pid);
              ensureAuthorizedCreator(entry);
            }
          }
          entry.actions.push(action);
          cleanupPresence(entry);
          const me = pid ? PLAYERS_DB.get(pid) : null;
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
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
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
  PROCESSED_BET_IDS,
  PROCESSED_SETTLEMENTS,
  upsertPlayerRecord,
  processServerPlaceBet,
  processServerCancelBet,
  processServerSettleRace,
  savePlayersDb
};
