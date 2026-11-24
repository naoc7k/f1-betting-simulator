/**
 * F1 Betting Simulator - Mandatory 11-Test System Update Verification Suite (Section 11)
 * Tests:
 * 1. Criação de contas em diferentes dispositivos (mesma rede/IP com machineId distinto + IPs distintos)
 * 2. Tentativa de criação de contas duplicadas na mesma máquina e proteção contra sequestro via link
 * 3. Convite de jogadores por nickname (envio, listagem, descarte, busca parcial)
 * 4. Remoção de jogadores do lobby (pelo criador e pelo administrador, bloqueio de não-autorizados)
 * 5. Visualização de partidas e lobbies em andamento no modo espectador (sem registrar como participante)
 * 6. Continuidade da corrida após desconexão de um jogador na volta 10 (promoção automática de criador e retomada)
 * 7. Validação do limite de apostas de 50% (no cliente finance.js e no servidor server.js)
 * 8. Alteração do saldo inicial pelo administrador (persistência em server_config.json, aplica apenas a novas contas)
 * 9. Visualização de todas as contas e busca por nickname no painel administrativo (independentemente do dispositivo)
 * 10. Exclusão de conta pelo administrador (limpeza de salas/apostas/convites, log admin, sem banir a máquina)
 * 11. Sincronização entre dispositivos (estado em tempo real, saldos e eventos)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const F1Finance = require('./js/finance.js');
const srv = require('./server.js');

const PLAYERS_DB_PATH = path.join(__dirname, 'players_db.json');
const CONFIG_DB_PATH = path.join(__dirname, 'server_config.json');

const originalPlayersDb = fs.existsSync(PLAYERS_DB_PATH)
  ? fs.readFileSync(PLAYERS_DB_PATH, 'utf-8')
  : '{}';
const originalConfigDb = fs.existsSync(CONFIG_DB_PATH)
  ? fs.readFileSync(CONFIG_DB_PATH, 'utf-8')
  : null;

const RESULTS = [];

async function runTest(num, name, fn) {
  try {
    const detail = await fn();
    RESULTS.push({ num, name, status: 'APROVADO', detail: detail || 'OK' });
    console.log(`✅ [Teste ${String(num).padStart(2, '0')}/11] ${name} -> APROVADO (${detail || 'OK'})`);
  } catch (err) {
    RESULTS.push({ num, name, status: 'REPROVADO', detail: err.message });
    console.error(`❌ [Teste ${String(num).padStart(2, '0')}/11] ${name} -> REPROVADO: ${err.message}`);
  }
}

function requestJson(port, method, reqPath, bodyObj = null, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = bodyObj ? Buffer.from(JSON.stringify(bodyObj), 'utf-8') : null;
    const headers = Object.assign({}, customHeaders);
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = data.length;
    }
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: reqPath,
      method,
      headers
    }, (res) => {
      let chunks = '';
      res.on('data', d => { chunks += d; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(chunks || '{}') });
        } catch (e) {
          resolve({ status: res.statusCode, data: {} });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  await new Promise(resolve => srv.server.listen(0, '127.0.0.1', resolve));
  const port = srv.server.address().port;

  let dev1Account = null;
  let dev2Account = null;
  let dev3Account = null;
  let adminToken = null;

  try {
    // Login admin upfront for admin tests
    const admLogin = await requestJson(port, 'POST', '/api/admin/login', { login: 'LN', password: 'jairo' });
    assert.strictEqual(admLogin.status, 200);
    adminToken = admLogin.data.token;

    // 1. Criação de contas em diferentes dispositivos
    await runTest(1, 'Criação de contas em diferentes dispositivos (mesma rede compartilhada e redes distintas)', async () => {
      // Device 1 on IP 192.168.1.10 with machineId hw_device_alpha_001
      const r1 = await requestJson(port, 'POST', '/api/account/init', {
        machineId: 'hw_device_alpha_001',
        name: 'AlphaRacer',
        avatarId: 'av1'
      }, { 'X-Forwarded-For': '192.168.1.10' });
      assert.strictEqual(r1.status, 200);
      assert.strictEqual(r1.data.ok, true);
      dev1Account = r1.data.player;
      assert.strictEqual(dev1Account.name, 'AlphaRacer');
      assert.ok(dev1Account.authToken);

      // Device 2 on SAME shared network IP (192.168.1.10) but distinct machineId hw_device_beta_002
      const r2 = await requestJson(port, 'POST', '/api/account/init', {
        machineId: 'hw_device_beta_002',
        name: 'BetaRacer',
        avatarId: 'av2'
      }, { 'X-Forwarded-For': '192.168.1.10' });
      assert.strictEqual(r2.status, 200);
      assert.strictEqual(r2.data.ok, true);
      dev2Account = r2.data.player;
      assert.notStrictEqual(dev2Account.id, dev1Account.id);

      // Device 3 on different IP (10.0.0.55) with machineId hw_device_gamma_003
      const r3 = await requestJson(port, 'POST', '/api/account/init', {
        machineId: 'hw_device_gamma_003',
        name: 'GammaRacer',
        avatarId: 'av3'
      }, { 'X-Forwarded-For': '10.0.0.55' });
      assert.strictEqual(r3.status, 200);
      dev3Account = r3.data.player;
      assert.notStrictEqual(dev3Account.id, dev1Account.id);
      assert.notStrictEqual(dev3Account.id, dev2Account.id);

      return `3 contas distintas criadas: ${dev1Account.name} (${dev1Account.id}), ${dev2Account.name} (${dev2Account.id}) na mesma rede e ${dev3Account.name} (${dev3Account.id})`;
    });

    // 2. Tentativa de criação de contas duplicadas na mesma máquina e proteção de links
    await runTest(2, 'Bloqueio de criação de conta duplicada na mesma máquina e proteção contra uso de conta alheia', async () => {
      // Explicit attempt to create a second account on Device 1 (createNew: true) -> 409 ACCOUNT_LIMIT_PER_MACHINE
      const dupCreate = await requestJson(port, 'POST', '/api/account/init', {
        machineId: 'hw_device_alpha_001',
        createNew: true,
        name: 'CloneAlpha'
      }, { 'X-Forwarded-For': '192.168.1.10' });
      assert.strictEqual(dupCreate.status, 409);
      assert.strictEqual(dupCreate.data.code, 'ACCOUNT_LIMIT_PER_MACHINE');
      assert.strictEqual(dupCreate.data.player.id, dev1Account.id);

      // Attempt to call /api/account/init on Device 1 requesting a different playerId -> returns the existing bound account without overwriting name
      const reInit = await requestJson(port, 'POST', '/api/account/init', {
        machineId: 'hw_device_alpha_001',
        playerId: 'usr_another_attempt',
        name: 'HackerClone'
      }, { 'X-Forwarded-For': '192.168.1.10' });
      assert.strictEqual(reInit.status, 200);
      assert.strictEqual(reInit.data.reusedBoundAccount, true);
      assert.strictEqual(reInit.data.player.id, dev1Account.id);
      assert.strictEqual(reInit.data.player.name, 'AlphaRacer');

      // Attempt by external link visitor to hijack Device 1's account without Device 1's authToken
      const hijackRes = await requestJson(port, 'POST', '/api/account/init', {
        machineId: 'hw_external_link_visitor',
        playerId: dev1Account.id,
        authToken: 'invalid_token_from_link'
      }, { 'X-Forwarded-For': '172.16.0.99' });
      assert.strictEqual(hijackRes.status, 200);
      assert.notStrictEqual(hijackRes.data.player.id, dev1Account.id, 'Visitante por link não pode assumir a conta do criador');
      // Clean up the visitor test account
      srv.PLAYERS_DB.delete(hijackRes.data.player.id);

      return `Duplicação bloqueada (409 ACCOUNT_LIMIT_PER_MACHINE -> vinculado a ${dev1Account.id}) e sequestro de conta por link impedido`;
    });

    // 3. Convite de jogadores por nickname
    await runTest(3, 'Sistema de convite de jogadores através do nickname (busca, envio, recebimento e descarte)', async () => {
      const roomCode = 'RM11T';
      // Create room by AlphaRacer
      await requestJson(port, 'POST', `/api/room/${roomCode}/state`, {
        pid: dev1Account.id,
        state: {
          code: roomCode,
          creatorId: dev1Account.id,
          hostId: dev1Account.id,
          circuitId: 'int',
          laps: 15,
          players: [{ id: dev1Account.id, name: dev1Account.name, chips: dev1Account.chips, online: true }],
          race: null
        }
      });

      // Search player by partial nickname
      const searchRes = await requestJson(port, 'GET', `/api/players/search?q=Beta`);
      assert.strictEqual(searchRes.status, 200);
      assert.ok(searchRes.data.players.some(p => p.id === dev2Account.id));

      // AlphaRacer invites BetaRacer by nickname
      const sendRes = await requestJson(port, 'POST', '/api/invites/send', {
        fromPlayerId: dev1Account.id,
        targetNickname: 'BetaRacer',
        roomCode
      });
      assert.strictEqual(sendRes.status, 200);
      assert.strictEqual(sendRes.data.invite.toPlayerId, dev2Account.id);

      // BetaRacer checks pending invites
      const checkRes = await requestJson(port, 'GET', `/api/invites?playerId=${dev2Account.id}`);
      assert.strictEqual(checkRes.status, 200);
      assert.strictEqual(checkRes.data.invites.length, 1);
      assert.strictEqual(checkRes.data.invites[0].roomCode, roomCode);
      const inviteId = checkRes.data.invites[0].id;

      // BetaRacer dismisses/consumes invite after accepting
      const disRes = await requestJson(port, 'POST', '/api/invites/dismiss', {
        playerId: dev2Account.id,
        inviteId
      });
      assert.strictEqual(disRes.status, 200);
      const afterCheck = await requestJson(port, 'GET', `/api/invites?playerId=${dev2Account.id}`);
      assert.strictEqual(afterCheck.data.invites.length, 0);

      return `Convite enviado por nickname para '${dev2Account.name}', recebido em tempo real (${inviteId}) e processado com sucesso`;
    });

    // 4. Remoção de jogadores do lobby
    await runTest(4, 'Remoção de jogadores do lobby pelo criador ou administrador e atualização em tempo real', async () => {
      const roomCode = 'RM11T';
      // BetaRacer and GammaRacer join room RM11T
      await requestJson(port, 'POST', `/api/room/${roomCode}/action`, {
        action: { type: 'JOIN_ROOM', player: { id: dev2Account.id, name: dev2Account.name, chips: dev2Account.chips, online: true } }
      });
      await requestJson(port, 'POST', `/api/room/${roomCode}/action`, {
        action: { type: 'JOIN_ROOM', player: { id: dev3Account.id, name: dev3Account.name, chips: dev3Account.chips, online: true } }
      });

      let roomGet = await requestJson(port, 'GET', `/api/room/${roomCode}?pid=${dev1Account.id}`);
      assert.strictEqual(roomGet.data.state.players.length, 3);

      // Unauthorized kick attempt: BetaRacer (non-creator, non-admin) tries to kick GammaRacer
      const unauthKick = await requestJson(port, 'POST', `/api/room/${roomCode}/kick`, {
        requesterId: dev2Account.id,
        targetPlayerId: dev3Account.id
      });
      assert.strictEqual(unauthKick.status, 403);

      // Authorized kick by room creator (AlphaRacer removes GammaRacer)
      const creatorKick = await requestJson(port, 'POST', `/api/room/${roomCode}/kick`, {
        requesterId: dev1Account.id,
        targetPlayerId: dev3Account.id
      });
      assert.strictEqual(creatorKick.status, 200);
      assert.strictEqual(creatorKick.data.state.players.length, 2);
      assert.ok(!creatorKick.data.state.players.some(p => p.id === dev3Account.id));
      assert.ok(creatorKick.data.state.kickedPlayerIds.includes(dev3Account.id));

      return `Tentativa não autorizada bloqueada (403); Criador removeu ${dev3Account.name} e lobby atualizou para 2 participantes`;
    });

    // 5. Visualização de partidas no modo espectador
    await runTest(5, 'Modo Espectador: listagem de lobbies em andamento e conexão sem registrar como participante', async () => {
      const roomCode = 'RM11T';
      // Start a race in RM11T with AlphaRacer and BetaRacer
      const race = {
        id: 'race_spec_1',
        circuit: { id: 'int', name: 'Interlagos', flag: '🇧🇷', bl: 75.1, ot: 0.54, rn: 0.06, cr: 0.0014, pl: 20 },
        total: 20,
        lap: 5,
        started: true,
        running: true,
        bettingOpen: false,
        done: false,
        order: ['VER', 'NOR', 'LEC'],
        start: ['VER', 'NOR', 'LEC'],
        drv: {
          VER: { t: 0, tyre: 'M', age: 5, st: 'run', gp: 1, ov: 0, lapsDone: 5 },
          NOR: { t: 0.4, tyre: 'M', age: 5, st: 'run', gp: 2, ov: 0, lapsDone: 5 },
          LEC: { t: 0.9, tyre: 'S', age: 5, st: 'run', gp: 3, ov: 0, lapsDone: 5 }
        },
        bets: [],
        exposures: {}
      };
      const curRoom = srv.ROOMS.get(roomCode).state;
      curRoom.race = race;
      await requestJson(port, 'POST', `/api/room/${roomCode}/state`, {
        pid: dev1Account.id,
        state: curRoom
      });

      // Query active lobbies list (/api/rooms)
      const roomsRes = await requestJson(port, 'GET', '/api/rooms');
      assert.strictEqual(roomsRes.status, 200);
      const found = roomsRes.data.rooms.find(r => r.code === roomCode);
      assert.ok(found, 'Lobby em andamento deve aparecer em /api/rooms');
      assert.strictEqual(found.status, 'IN_PROGRESS');
      assert.strictEqual(found.lap, 5);
      assert.strictEqual(found.totalLaps, 20);

      // Connect as spectator (?spectator=1) using GammaRacer's ID
      const specPoll = await requestJson(port, 'GET', `/api/room/${roomCode}?pid=${dev3Account.id}&spectator=1`);
      assert.strictEqual(specPoll.status, 200);
      assert.strictEqual(specPoll.data.spectator, true);
      const playersInRoom = specPoll.data.state.players;
      assert.strictEqual(playersInRoom.length, 2);
      assert.ok(!playersInRoom.some(p => p.id === dev3Account.id), 'Espectador não pode ser registrado na lista de participantes');
      assert.ok(!srv.ROOMS.get(roomCode).heartbeats.has(dev3Account.id), 'Espectador não deve gerar heartbeat de jogador ativo');

      return `Lobby ${roomCode} listado como IN_PROGRESS (Volta 5/20) e espectador conectado sem entrar em room.players (2 jogadores mantidos)`;
    });

    // 6. Continuidade da corrida após desconexão de um jogador (após 10 voltas)
    await runTest(6, 'Continuidade da corrida após 10 voltas quando um jogador (inclusive o criador) desconecta', async () => {
      const roomCode = 'RM11T';
      const entry = srv.ROOMS.get(roomCode);
      // Advance race to Lap 10 pause window
      entry.state.race.lap = 10;
      entry.state.race.running = false;
      entry.state.race.bettingOpen = true;
      entry.state.race.started = true;

      // Simulate original creator (AlphaRacer) disconnecting > 15s ago while BetaRacer stays online (heartbeats use seconds)
      const nowSec = Date.now() / 1000;
      entry.heartbeats.set(dev1Account.id, nowSec - 25);
      entry.heartbeats.set(dev2Account.id, nowSec);

      // BetaRacer polls room -> server automatically marks AlphaRacer offline and promotes BetaRacer to creatorId/hostId
      const pollAfterDisc = await requestJson(port, 'GET', `/api/room/${roomCode}?pid=${dev2Account.id}`);
      assert.strictEqual(pollAfterDisc.status, 200);
      const st = pollAfterDisc.data.state;
      assert.strictEqual(st.creatorId, dev2Account.id, 'Criador deve ser reatribuído automaticamente ao jogador restante online');
      assert.strictEqual(st.hostId, dev2Account.id);

      // BetaRacer closes betting window and resumes race at Lap 11 with only 1 online player
      st.race.bettingOpen = false;
      st.race.running = true;
      st.race.lap = 11;
      const resumeRes = await requestJson(port, 'POST', `/api/room/${roomCode}/state`, {
        pid: dev2Account.id,
        state: st
      });
      assert.strictEqual(resumeRes.status, 200);
      assert.strictEqual(resumeRes.data.state.race.running, true);
      assert.strictEqual(resumeRes.data.state.race.lap, 11);

      return `Desconexão na Volta 10 tratada: ${dev2Account.name} promovido a líder e corrida retomada na Volta 11 com 1 jogador online`;
    });

    // 7. Validação do limite de apostas de 50%
    await runTest(7, 'Validação rigorosa do novo limite de apostas de 50% no cliente e no servidor', async () => {
      assert.strictEqual(F1Finance.EXPOSURE_RATE, 0.50, 'F1Finance.EXPOSURE_RATE deve ser 0.50');

      const roomCode = 'RM50PCT';
      // Ensure BetaRacer has 200 chips -> 50% exposure limit = 100 chips
      srv.PLAYERS_DB.get(dev2Account.id).chips = 200;
      const race = {
        id: 'race_50pct',
        circuit: { id: 'int', name: 'Interlagos', bl: 75.1, ot: 0.54, rn: 0.06, cr: 0.0014, pl: 20 },
        total: 15,
        lap: 0,
        started: false,
        running: false,
        bettingOpen: true,
        done: false,
        order: ['VER', 'NOR', 'LEC'],
        start: ['VER', 'NOR', 'LEC'],
        drv: {
          VER: { t: 0, tyre: 'M', age: 0, st: 'run', gp: 1, ov: 0, lapsDone: 0 },
          NOR: { t: 0.3, tyre: 'M', age: 0, st: 'run', gp: 2, ov: 0, lapsDone: 0 },
          LEC: { t: 0.6, tyre: 'M', age: 0, st: 'run', gp: 3, ov: 0, lapsDone: 0 }
        },
        bets: [],
        exposures: {}
      };
      await requestJson(port, 'POST', `/api/room/${roomCode}/state`, {
        pid: dev2Account.id,
        state: { code: roomCode, creatorId: dev2Account.id, hostId: dev2Account.id, players: [srv.PLAYERS_DB.get(dev2Account.id)], race }
      });

      // Bet 100 chips (exact 50% of 200) -> MUST SUCCEED
      const betOk = await requestJson(port, 'POST', `/api/room/${roomCode}/bet`, {
        playerId: dev2Account.id,
        bet: { pid: dev2Account.id, modality: 'overtake', driver: 'VER', amount: 100 }
      });
      assert.strictEqual(betOk.status, 200);
      assert.strictEqual(betOk.data.exposure.maxExposure, 100);
      assert.strictEqual(betOk.data.exposure.totalCommitted, 100);
      assert.strictEqual(betOk.data.exposure.remainingExposure, 0);

      // Attempt to bet 1 more chip (101 > 50% of 200) -> MUST FAIL on server
      const betFail = await requestJson(port, 'POST', `/api/room/${roomCode}/bet`, {
        playerId: dev2Account.id,
        bet: { pid: dev2Account.id, modality: 'overtake', driver: 'NOR', amount: 1 }
      });
      assert.strictEqual(betFail.status, 400);
      assert.strictEqual(betFail.data.code, 'EXPOSURE_LIMIT_EXCEEDED');

      return `Saldo inicial 200 🪙 -> Limite de 50% (100 🪙) aceito; tentativa de apostar 101 🪙 bloqueada pelo servidor`;
    });

    // 8. Alteração do saldo inicial pelo administrador
    await runTest(8, 'Configuração do saldo inicial pelo administrador (persistência e aplicação exclusiva a novas contas)', async () => {
      const existingBalanceAlpha = srv.PLAYERS_DB.get(dev1Account.id).chips;

      // Admin changes initialChips from 100 to 500
      const cfgRes = await requestJson(port, 'POST', '/api/admin/config', {
        token: adminToken,
        initialChips: 500
      });
      assert.strictEqual(cfgRes.status, 200);
      assert.strictEqual(cfgRes.data.initialChips, 500);

      // Verify saved permanently in server_config.json
      const diskCfg = JSON.parse(fs.readFileSync(CONFIG_DB_PATH, 'utf-8'));
      assert.strictEqual(diskCfg.initialChips, 500);

      // Verify existing account balance was NOT modified
      assert.strictEqual(srv.PLAYERS_DB.get(dev1Account.id).chips, existingBalanceAlpha);

      // Create a new account on Device 4 -> must receive 500 chips!
      const newAccRes = await requestJson(port, 'POST', '/api/account/init', {
        machineId: 'hw_device_delta_004',
        name: 'DeltaNewbie',
        avatarId: 'av4'
      }, { 'X-Forwarded-For': '10.0.0.88' });
      assert.strictEqual(newAccRes.status, 200);
      assert.strictEqual(newAccRes.data.player.chips, 500);

      return `Saldo inicial alterado para 500 🪙 (salvo em server_config.json); nova conta recebeu 500 🪙 e contas antigas permaneceram inalteradas`;
    });

    // 9. Visualização de todas as contas no painel administrativo
    await runTest(9, 'Gerenciamento global de contas no painel administrativo (todas as máquinas + busca por nickname)', async () => {
      const admList = await requestJson(port, 'GET', `/api/admin/players?token=${adminToken}`);
      assert.strictEqual(admList.status, 200);
      assert.strictEqual(admList.data.initialChips, 500);

      const players = admList.data.players;
      const names = players.map(p => p.name);
      assert.ok(names.includes('AlphaRacer'), 'Conta do Dispositivo 1 deve aparecer');
      assert.ok(names.includes('BetaRacer'), 'Conta do Dispositivo 2 deve aparecer');
      assert.ok(names.includes('GammaRacer'), 'Conta do Dispositivo 3 deve aparecer');
      assert.ok(names.includes('DeltaNewbie'), 'Conta do Dispositivo 4 deve aparecer');

      // Search by nickname endpoint
      const searchDelta = await requestJson(port, 'GET', `/api/players/search?q=delta`);
      assert.strictEqual(searchDelta.status, 200);
      assert.strictEqual(searchDelta.data.players[0].name, 'DeltaNewbie');

      return `Painel Admin listou todas as ${players.length} contas registradas globalmente em diferentes dispositivos`;
    });

    // 10. Exclusão de conta pelo administrador
    await runTest(10, 'Exclusão de conta pelo administrador (limpeza de dados, log administrativo e sem bloqueio/banimento)', async () => {
      // Find DeltaNewbie created in Test 8
      const deltaEntry = Array.from(srv.PLAYERS_DB.values()).find(p => p.name === 'DeltaNewbie');
      assert.ok(deltaEntry);

      // Admin deletes DeltaNewbie
      const delRes = await requestJson(port, 'POST', '/api/admin/delete_player', {
        token: adminToken,
        playerId: deltaEntry.id
      });
      assert.strictEqual(delRes.status, 200);
      assert.strictEqual(delRes.data.deletedPlayerId, deltaEntry.id);
      assert.ok(!srv.PLAYERS_DB.has(deltaEntry.id), 'Conta deve ser removida do banco de dados');

      // Verify admin action was logged
      const lastLog = srv.SERVER_CONFIG.adminLogs[0];
      assert.strictEqual(lastLog.action, 'DELETE_ACCOUNT');
      assert.strictEqual(lastLog.targetPlayerId, deltaEntry.id);

      // Verify other accounts were NOT affected
      assert.ok(srv.PLAYERS_DB.has(dev1Account.id));
      assert.ok(srv.PLAYERS_DB.has(dev2Account.id));

      // IMPORTANT REQUIREMENT 9: Deleting an accidental account must NOT ban or block the machine from creating a new clean account
      const recreateRes = await requestJson(port, 'POST', '/api/account/init', {
        machineId: 'hw_device_delta_004',
        name: 'DeltaCleanAccount',
        avatarId: 'av5'
      }, { 'X-Forwarded-For': '10.0.0.88' });
      assert.strictEqual(recreateRes.status, 200);
      assert.strictEqual(recreateRes.data.player.name, 'DeltaCleanAccount');

      return `Conta '${deltaEntry.name}' excluída, ação registrada no log admin e dispositivo liberado para criar nova conta ('DeltaCleanAccount') sem banimento`;
    });

    // 11. Sincronização entre dispositivos
    await runTest(11, 'Sincronização em tempo real entre dispositivos (saldos, estado de corrida e ações)', async () => {
      const roomCode = 'RM50PCT';
      // Admin modifies BetaRacer's balance by +250 chips
      const modRes = await requestJson(port, 'POST', '/api/admin/balance', {
        token: adminToken,
        playerId: dev2Account.id,
        operation: 'add',
        amount: 250
      });
      assert.strictEqual(modRes.status, 200);
      const updatedChips = modRes.data.player.chips;

      // Another device polls room RM50PCT and sees BetaRacer's updated balance synchronized in room.players
      const pollRoom = await requestJson(port, 'GET', `/api/room/${roomCode}?pid=${dev1Account.id}&spectator=1`);
      assert.strictEqual(pollRoom.status, 200);
      const syncedBeta = pollRoom.data.state.players.find(p => p.id === dev2Account.id);
      assert.ok(syncedBeta);
      assert.strictEqual(syncedBeta.chips, updatedChips);

      return `Saldo de ${dev2Account.name} (${updatedChips} 🪙) e estado da sala sincronizados instantaneamente entre dispositivos`;
    });

    // 12. Exclusão do próprio perfil pelo jogador (/api/account/delete_self) e preservação de LX/LXZADA e naoc7k/N7K
    await runTest(12, 'Exclusão do próprio perfil pelo jogador (/api/account/delete_self) e preservação de LX/LXZADA e naoc7k/N7K', async () => {
      // Create protected accounts: LXZADA, LX, naoc7k, N7K
      const lx1 = await requestJson(port, 'POST', '/api/account/init', { machineId: 'hw_lx_1', name: 'LXZADA' }, { 'X-Forwarded-For': '10.1.1.1' });
      const lx2 = await requestJson(port, 'POST', '/api/account/init', { machineId: 'hw_lx_2', name: 'LX' }, { 'X-Forwarded-For': '10.1.1.2' });
      const n7k1 = await requestJson(port, 'POST', '/api/account/init', { machineId: 'hw_n7k_1', name: 'naoc7k' }, { 'X-Forwarded-For': '10.1.1.3' });
      const n7k2 = await requestJson(port, 'POST', '/api/account/init', { machineId: 'hw_n7k_2', name: 'N7K' }, { 'X-Forwarded-For': '10.1.1.4' });

      // Give LXZADA 2500 chips and naoc7k 1800 chips to verify they stay completely untouched
      srv.PLAYERS_DB.get(lx1.data.player.id).chips = 2500;
      srv.PLAYERS_DB.get(n7k1.data.player.id).chips = 1800;

      // Test self-deletion: AlphaRacer deletes their own profile using their machineId & authToken
      const selfDelRes = await requestJson(port, 'POST', '/api/account/delete_self', {
        playerId: dev1Account.id,
        machineId: 'hw_device_alpha_001',
        authToken: dev1Account.authToken
      }, { 'X-Forwarded-For': '192.168.1.10' });
      assert.strictEqual(selfDelRes.status, 200);
      assert.strictEqual(selfDelRes.data.deleted, true);
      assert.ok(!srv.PLAYERS_DB.has(dev1Account.id), 'Perfil de AlphaRacer deve ter sido removido pelo próprio jogador');

      // Test purge of all non-protected accounts (/api/admin/purge_non_protected)
      const purgeRes = await requestJson(port, 'POST', '/api/admin/purge_non_protected', {
        token: adminToken
      });
      assert.strictEqual(purgeRes.status, 200);
      const remainingNames = Array.from(srv.PLAYERS_DB.values()).map(p => p.name);
      assert.ok(remainingNames.includes('LXZADA'));
      assert.ok(remainingNames.includes('LX'));
      assert.ok(remainingNames.includes('naoc7k'));
      assert.ok(remainingNames.includes('N7K'));
      assert.ok(!remainingNames.includes('BetaRacer'), 'BetaRacer não protegido deve ter sido removido');
      assert.ok(!remainingNames.includes('GammaRacer'), 'GammaRacer não protegido deve ter sido removido');
      assert.strictEqual(srv.PLAYERS_DB.get(lx1.data.player.id).chips, 2500);
      assert.strictEqual(srv.PLAYERS_DB.get(n7k1.data.player.id).chips, 1800);

      return `Auto-exclusão validada e limpeza manteve intocadas apenas as contas protegidas: ${remainingNames.join(', ')}`;
    });

  } finally {
    // Restore original database files
    fs.writeFileSync(PLAYERS_DB_PATH, originalPlayersDb, 'utf-8');
    if (originalConfigDb !== null) {
      fs.writeFileSync(CONFIG_DB_PATH, originalConfigDb, 'utf-8');
    } else if (fs.existsSync(CONFIG_DB_PATH)) {
      fs.unlinkSync(CONFIG_DB_PATH);
    }
    srv.server.close();
  }

  const passed = RESULTS.filter(r => r.status === 'APROVADO').length;
  const failed = RESULTS.filter(r => r.status !== 'APROVADO').length;
  console.log(`\n=============================================================`);
  console.log(`RESUMO DOS 11 TESTES DE ATUALIZAÇÃO DO SISTEMA: ${passed}/11 APROVADOS | ${failed} REPROVADOS`);
  console.log(`=============================================================`);
  if (failed > 0) process.exit(1);
})();
