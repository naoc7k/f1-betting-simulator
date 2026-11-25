/**
 * F1 Betting Simulator - Mandatory 32-Test Verification Suite (Section 13)
 * Validates real financial logic, overtake expectation & accounting, 1,000-sim dynamic odds,
 * authoritative server operations, concurrency, persistence (players_db.json), and anti-arbitrage.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const F1Finance = require('./js/finance.js');
const srv = require('./server.js');

const PLAYERS_DB_PATH = path.join(__dirname, 'players_db.json');
const originalDbContent = fs.existsSync(PLAYERS_DB_PATH)
  ? fs.readFileSync(PLAYERS_DB_PATH, 'utf-8')
  : '{}';

const RESULTS = [];

async function runTest(num, category, name, fn) {
  try {
    const detail = await fn();
    RESULTS.push({ num, category, name, status: 'APROVADO', detail: detail || 'OK' });
    console.log(`✅ [Teste ${String(num).padStart(2, '0')}] ${name} -> APROVADO (${detail || 'OK'})`);
  } catch (err) {
    RESULTS.push({ num, category, name, status: 'REPROVADO', detail: err.message });
    console.error(`❌ [Teste ${String(num).padStart(2, '0')}] ${name} -> REPROVADO: ${err.message}`);
  }
}

function makeMockRace(overrides = {}) {
  const defaultOrder = ['VER', 'NOR', 'LEC', 'HAM', 'PIA', 'RUS', 'SAI', 'ALO', 'ANT', 'ALB', 'GAS', 'HUL', 'PER', 'BOT', 'LAW', 'HAD', 'CAM', 'BOR', 'BEA', 'COL', 'LIN', 'STR'];
  const drv = {};
  defaultOrder.forEach((id, i) => {
    drv[id] = {
      t: i * 0.28,
      tyre: 'M',
      age: 0,
      stops: 0,
      plan: [8],
      st: 'run',
      gp: i + 1,
      ov: 0,
      lapsDone: 0
    };
  });
  return Object.assign({
    id: 'race_test_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    circuit: { id: 'int', name: 'Interlagos', bl: 75.1, ot: 0.54, rn: 0.06, cr: 0.0014, pl: 20 },
    total: 15,
    lap: 0,
    wxMode: 'dry',
    ws: 0,
    w: 0,
    drv,
    order: defaultOrder.slice(),
    start: defaultOrder.slice(),
    overtakeLog: [],
    ovSeq: 0,
    exposures: {},
    oddsBook: null,
    dnf: [],
    done: false,
    cancelled: false,
    settled: false,
    started: false,
    running: false,
    bettingOpen: true,
    round: 0,
    bets: [],
    res: {}
  }, overrides);
}

function postJson(port, reqPath, bodyObj) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(bodyObj), 'utf-8');
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: reqPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
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
    req.write(data);
    req.end();
  });
}

function getJson(port, reqPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: reqPath }, (res) => {
      let chunks = '';
      res.on('data', d => { chunks += d; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(chunks || '{}') });
        } catch (e) {
          resolve({ status: res.statusCode, data: {} });
        }
      });
    }).on('error', reject);
  });
}

(async () => {
  // Syntax check browser files
  new Function(fs.readFileSync(path.join(__dirname, 'js', 'tracks.js'), 'utf-8'));
  new Function(fs.readFileSync(path.join(__dirname, 'js', 'finance.js'), 'utf-8'));
  new Function(fs.readFileSync(path.join(__dirname, 'js', 'multiplayer.js'), 'utf-8'));
  new Function(fs.readFileSync(path.join(__dirname, 'js', 'sim3d.js'), 'utf-8'));
  new Function(fs.readFileSync(path.join(__dirname, 'js', 'app.js'), 'utf-8'));

  // Start authoritative HTTP server on ephemeral port for real HTTP multiplayer & concurrency tests
  await new Promise(resolve => srv.server.listen(0, '127.0.0.1', resolve));
  const testPort = srv.server.address().port;

  try {
    /* =====================================================================
     * TESTES DE ULTRAPASSAGEM (1 a 10)
     * ===================================================================== */

    // 1. Piloto supera a expectativa
    await runTest(1, 'Ultrapassagem', 'Piloto supera a expectativa (Exemplos 1 e 2 do Prompt)', () => {
      // Exemplo 1: S=100, E=0, O=5, M=1.0 -> Lucro=100, Retorno=200
      const ex1 = F1Finance.calculateOvertakePayout(100, 5, 0, 1.0, 0.20);
      assert.strictEqual(ex1.won, true);
      assert.strictEqual(ex1.excessOvertakes, 5);
      assert.strictEqual(ex1.profit, 100);
      assert.strictEqual(ex1.totalReturn, 200);

      // Exemplo 2: S=100, E=3, O=5, M=1.0 -> Excedentes=2, Lucro=40, Retorno=140
      const ex2 = F1Finance.calculateOvertakePayout(100, 5, 3, 1.0, 0.20);
      assert.strictEqual(ex2.won, true);
      assert.strictEqual(ex2.excessOvertakes, 2);
      assert.strictEqual(ex2.profit, 40);
      assert.strictEqual(ex2.totalReturn, 140);
      return `Ex1: S=100, E=0, O=5 -> Retorno=200 (Lucro=100) | Ex2: S=100, E=3, O=5 -> Retorno=140 (Lucro=40)`;
    });

    // 2. Piloto alcança exatamente a expectativa
    await runTest(2, 'Ultrapassagem', 'Piloto alcança exatamente a expectativa (O == E -> Aposta perdida)', () => {
      const res = F1Finance.calculateOvertakePayout(100, 5, 5, 1.0, 0.20);
      assert.strictEqual(res.won, false);
      assert.strictEqual(res.excessOvertakes, 0);
      assert.strictEqual(res.totalReturn, 0);
      assert.strictEqual(res.netProfit, -100);
      return `S=100, E=5, O=5 -> won=false, Retorno=0, Perda=-100 fichas`;
    });

    // 3. Piloto fica abaixo da expectativa
    await runTest(3, 'Ultrapassagem', 'Piloto fica abaixo da expectativa (Exemplo 3: E=5, O=3 -> Retorno 0)', () => {
      const res = F1Finance.calculateOvertakePayout(100, 3, 5, 1.0, 0.20);
      assert.strictEqual(res.won, false);
      assert.strictEqual(res.excessOvertakes, 0);
      assert.strictEqual(res.totalReturn, 0);
      assert.strictEqual(res.netProfit, -100);
      return `S=100, E=5, O=3 -> won=false, Retorno=0, Perda=-100 fichas`;
    });

    // 4. Piloto não realiza nenhuma ultrapassagem
    await runTest(4, 'Ultrapassagem', 'Piloto não realiza nenhuma ultrapassagem (O=0 -> Aposta perdida)', () => {
      const res0 = F1Finance.calculateOvertakePayout(100, 0, 0, 1.0, 0.20);
      const res3 = F1Finance.calculateOvertakePayout(100, 0, 3, 1.0, 0.20);
      assert.strictEqual(res0.won, false);
      assert.strictEqual(res0.totalReturn, 0);
      assert.strictEqual(res3.won, false);
      assert.strictEqual(res3.totalReturn, 0);
      return `O=0 (com E=0 ou E=3) -> won=false, Retorno=0 fichas`;
    });

    // 5. Piloto ganha posições por abandono adversário
    await runTest(5, 'Ultrapassagem', 'Piloto ganha posições por abandono adversário (Não contabiliza)', () => {
      const race = makeMockRace();
      const bet = { id: 'b_dnf_test', driver: 'LEC', amount: 100, lap: 0, confirmedEventSeq: 0, expectedOvertakes: 0, mult: 1.0 };
      // Simulate adversary DNF event and artificial DNF pass in log
      race.overtakeLog.push({
        id: 'ev_dnf_1', seq: 1, lap: 2, passer: 'LEC', passed: 'NOR',
        cause: 'DNF', realOnTrack: false, dnfPass: true, passedDriverActive: false
      });
      const counted = F1Finance.countValidOvertakesForBet(race, bet);
      assert.strictEqual(counted.count, 0);
      return `Posições ganhas por DNF adversário contabilizadas: ${counted.count} (esperado: 0)`;
    });

    // 6. Piloto ganha posições devido a pit stops
    await runTest(6, 'Ultrapassagem', 'Piloto ganha posições devido a pit stops (Não contabiliza)', () => {
      const race = makeMockRace();
      const bet = { id: 'b_pit_test', driver: 'LEC', amount: 100, lap: 0, confirmedEventSeq: 0, expectedOvertakes: 0, mult: 1.0 };
      race.overtakeLog.push({
        id: 'ev_pit_1', seq: 1, lap: 4, passer: 'LEC', passed: 'VER',
        cause: 'PIT_STOP', realOnTrack: false, pitPass: true, passedDriverActive: true
      });
      const counted = F1Finance.countValidOvertakesForBet(race, bet);
      assert.strictEqual(counted.count, 0);
      return `Posições ganhas por Pit Stop contabilizadas: ${counted.count} (esperado: 0)`;
    });

    // 7. Piloto realiza ultrapassagens após a confirmação da aposta
    await runTest(7, 'Ultrapassagem', 'Contabiliza apenas ultrapassagens reais posteriores à confirmação da aposta', () => {
      const race = makeMockRace();
      // 2 overtakes BEFORE bet confirmation (seq 1 and 2 on lap 1-2)
      race.overtakeLog.push(
        { id: 'ov_pre_1', seq: 1, lap: 1, passer: 'HAM', passed: 'PIA', cause: 'ON_TRACK', realOnTrack: true, passedDriverActive: true },
        { id: 'ov_pre_2', seq: 2, lap: 2, passer: 'HAM', passed: 'LEC', cause: 'ON_TRACK', realOnTrack: true, passedDriverActive: true }
      );
      // Bet confirmed at lap 2 after seq 2
      const bet = { id: 'b_post_test', driver: 'HAM', amount: 100, lap: 2, confirmedEventSeq: 2, expectedOvertakes: 1, mult: 0.9 };
      // 3 overtakes AFTER bet confirmation (seq 3, 4, 5)
      race.overtakeLog.push(
        { id: 'ov_post_3', seq: 3, lap: 3, passer: 'HAM', passed: 'NOR', cause: 'ON_TRACK', realOnTrack: true, passedDriverActive: true },
        { id: 'ov_post_4', seq: 4, lap: 5, passer: 'HAM', passed: 'VER', cause: 'ON_TRACK', realOnTrack: true, passedDriverActive: true },
        { id: 'ov_post_5', seq: 5, lap: 7, passer: 'HAM', passed: 'RUS', cause: 'ON_TRACK', realOnTrack: true, passedDriverActive: true }
      );
      const counted = F1Finance.countValidOvertakesForBet(race, bet);
      assert.strictEqual(counted.count, 3);
      const evalRes = F1Finance.evaluateTicketForRace(race, bet);
      assert.strictEqual(evalRes.actualOvertakes, 3);
      assert.strictEqual(evalRes.excessOvertakes, 2); // 3 - 1 = 2
      return `2 ULTs pré-aposta ignoradas; 3 ULTs pós-aposta contabilizadas (Excedentes: 2)`;
    });

    // 8. Tentativa de contabilizar duas vezes o mesmo evento
    await runTest(8, 'Ultrapassagem', 'Proteção contra contabilização duplicada do mesmo ID de evento', () => {
      const race = makeMockRace();
      const bet = { id: 'b_dup_ev', driver: 'VER', amount: 100, lap: 0, confirmedEventSeq: 0, expectedOvertakes: 0, mult: 1.0 };
      const dupEvent = { id: 'ov_unique_99', seq: 1, lap: 2, passer: 'VER', passed: 'NOR', cause: 'ON_TRACK', realOnTrack: true, passedDriverActive: true };
      race.overtakeLog.push(dupEvent, Object.assign({}, dupEvent), Object.assign({}, dupEvent));
      const counted = F1Finance.countValidOvertakesForBet(race, bet);
      assert.strictEqual(counted.count, 1);
      return `3 inserções do mesmo evento 'ov_unique_99' -> contabilizado exatamente 1 vez`;
    });

    // 9. Verificação dos multiplicadores por volta
    await runTest(9, 'Ultrapassagem', 'Tabela de multiplicadores por volta (Largada 1,0x até Voltas 81-90+ 0,1x)', () => {
      const expectedTable = [
        [0, 1.0],
        [1, 0.9], [10, 0.9],
        [11, 0.8], [20, 0.8],
        [21, 0.7], [30, 0.7],
        [31, 0.6], [40, 0.6],
        [41, 0.5], [50, 0.5],
        [51, 0.4], [60, 0.4],
        [61, 0.3], [70, 0.3],
        [71, 0.2], [80, 0.2],
        [81, 0.1], [90, 0.1],
        [95, 0.1]
      ];
      for (const [lap, expM] of expectedTable) {
        const actualM = F1Finance.getLapMultiplier(lap);
        assert.strictEqual(actualM, expM, `Lap ${lap} expected ${expM} but got ${actualM}`);
      }
      return `Todos os 10 patamares validados (V0=1.0x, V1-10=0.9x, ..., V81-90=0.1x, V95=0.1x)`;
    });

    // 10. Verificação do pagamento máximo por bilhete (5x o valor apostado, incluindo o valor original)
    await runTest(10, 'Ultrapassagem', 'Teto de retorno máximo de 5x o valor apostado por bilhete (incluindo stake)', () => {
      // Stake = 100, E = 0, O = 35, M = 1.0 -> Raw profit = 100 * 35 * 0.20 = 700 (Total 800) -> Capped at 500 (Profit 400)
      const res = F1Finance.calculateOvertakePayout(100, 35, 0, 1.0, 0.20);
      assert.strictEqual(res.capped, true);
      assert.strictEqual(res.totalReturn, 500);
      assert.strictEqual(res.profit, 400);
      return `Stake=100, O=35, E=0 -> Retorno bruto 800 limitado exatamente ao teto de 500 fichas (5x)`;
    });

    /* =====================================================================
     * TESTES DE COLOCAÇÃO (11 a 20)
     * ===================================================================== */

    // 11. Aposta no vencedor (1º lugar)
    await runTest(11, 'Colocação', 'Mercado 1: Vencedor da corrida (1º lugar - Exemplo Leclerc 100 @ 4.00x)', () => {
      const race = makeMockRace({ done: true });
      race.order[0] = 'LEC';
      race.order[2] = 'VER';
      const bet = { id: 'b_p1', modality: 'placement', driver: 'LEC', market: 'P1', amount: 100, odd: 4.00, probability: 0.235 };
      const res = F1Finance.evaluateTicketForRace(race, bet);
      assert.strictEqual(res.won, true);
      assert.strictEqual(res.ret, 400);
      assert.strictEqual(res.net, 300);
      return `Leclerc 1º Lugar (100 fichas @ 4.00x) -> Retorno Total: 400 | Lucro Líquido: +300`;
    });

    // 12. Aposta no segundo colocado (exatamente 2º lugar)
    await runTest(12, 'Colocação', 'Mercado 2: Segundo colocado (terminar exatamente em 2º lugar)', () => {
      const race = makeMockRace({ done: true });
      // NOR is at index 1 (2nd place), VER is at index 0 (1st place)
      const betWin = { id: 'b_p2_w', modality: 'placement', driver: 'NOR', market: 'P2', amount: 100, odd: 3.50 };
      const betLoseIf1st = { id: 'b_p2_l', modality: 'placement', driver: 'VER', market: 'P2', amount: 100, odd: 3.50 };
      const rW = F1Finance.evaluateTicketForRace(race, betWin);
      const rL = F1Finance.evaluateTicketForRace(race, betLoseIf1st);
      assert.strictEqual(rW.won, true);
      assert.strictEqual(rW.ret, 350);
      assert.strictEqual(rL.won, false);
      assert.strictEqual(rL.ret, 0);
      return `NOR (2º) venceu: Retorno 350 | VER (1º no mercado Exato 2º) perdeu: Retorno 0`;
    });

    // 13. Aposta no terceiro colocado (exatamente 3º lugar)
    await runTest(13, 'Colocação', 'Mercado 3: Terceiro colocado (terminar exatamente em 3º lugar)', () => {
      const race = makeMockRace({ done: true });
      // LEC is at index 2 (3rd place)
      const betWin = { id: 'b_p3_w', modality: 'placement', driver: 'LEC', market: 'P3', amount: 50, odd: 5.00 };
      const betLoseIf2nd = { id: 'b_p3_l', modality: 'placement', driver: 'NOR', market: 'P3', amount: 50, odd: 5.00 };
      const rW = F1Finance.evaluateTicketForRace(race, betWin);
      const rL = F1Finance.evaluateTicketForRace(race, betLoseIf2nd);
      assert.strictEqual(rW.won, true);
      assert.strictEqual(rW.ret, 250);
      assert.strictEqual(rW.net, 200);
      assert.strictEqual(rL.won, false);
      return `LEC (3º) venceu (50 @ 5.00x -> Retorno 250, Lucro 200) | NOR (2º) perdeu`;
    });

    // 14. Aposta de pódio (Top 3)
    await runTest(14, 'Colocação', 'Mercado 4: Pódio (terminar entre os 3 primeiros)', () => {
      const race = makeMockRace({ done: true });
      const b3 = F1Finance.evaluateTicketForRace(race, { id: 'b_pod3', modality: 'placement', driver: 'LEC', market: 'PODIUM', amount: 100, odd: 1.80 });
      const b4 = F1Finance.evaluateTicketForRace(race, { id: 'b_pod4', modality: 'placement', driver: 'HAM', market: 'PODIUM', amount: 100, odd: 1.80 });
      assert.strictEqual(b3.won, true);
      assert.strictEqual(b3.ret, 180);
      assert.strictEqual(b4.won, false);
      assert.strictEqual(b4.ret, 0);
      return `3º colocado (LEC) ganhou Pódio (Retorno 180) | 4º colocado (HAM) perdeu (Retorno 0)`;
    });

    // 15. Aposta Top 5
    await runTest(15, 'Colocação', 'Mercado 5: Top 5 (terminar entre os 5 primeiros)', () => {
      const race = makeMockRace({ done: true });
      const b5 = F1Finance.evaluateTicketForRace(race, { id: 'b_t5_w', modality: 'placement', driver: 'PIA', market: 'TOP5', amount: 100, odd: 1.50 });
      const b6 = F1Finance.evaluateTicketForRace(race, { id: 'b_t5_l', modality: 'placement', driver: 'RUS', market: 'TOP5', amount: 100, odd: 1.50 });
      assert.strictEqual(b5.won, true);
      assert.strictEqual(b5.ret, 150);
      assert.strictEqual(b6.won, false);
      assert.strictEqual(b6.ret, 0);
      return `5º colocado (PIA) ganhou Top 5 (Retorno 150) | 6º colocado (RUS) perdeu (Retorno 0)`;
    });

    // 16. Aposta Top 10
    await runTest(16, 'Colocação', 'Mercado 6: Top 10 (terminar entre os 10 primeiros)', () => {
      const race = makeMockRace({ done: true });
      const b10 = F1Finance.evaluateTicketForRace(race, { id: 'b_t10_w', modality: 'placement', driver: 'ALB', market: 'TOP10', amount: 100, odd: 1.40 });
      const b11 = F1Finance.evaluateTicketForRace(race, { id: 'b_t10_l', modality: 'placement', driver: 'GAS', market: 'TOP10', amount: 100, odd: 1.40 });
      assert.strictEqual(b10.won, true);
      assert.strictEqual(b10.ret, 140);
      assert.strictEqual(b11.won, false);
      assert.strictEqual(b11.ret, 0);
      return `10º colocado (ALB) ganhou Top 10 (Retorno 140) | 11º colocado (GAS) perdeu (Retorno 0)`;
    });

    // 17. Aposta perdida
    await runTest(17, 'Colocação', 'Aposta de colocação perdida (Retorno 0 e perda integral do valor apostado)', () => {
      const race = makeMockRace({ done: true });
      // Leclerc finishes 3rd, bet was on Leclerc P1
      const bet = { id: 'b_lose_p1', modality: 'placement', driver: 'LEC', market: 'P1', amount: 100, odd: 4.00 };
      const res = F1Finance.evaluateTicketForRace(race, bet);
      assert.strictEqual(res.won, false);
      assert.strictEqual(res.status, 'LOST');
      assert.strictEqual(res.ret, 0);
      assert.strictEqual(res.net, -100);
      return `Leclerc em 3º com aposta em P1 -> Status: LOST, Retorno: 0, Lucro Líquido: -100`;
    });

    // 18. Odd alterada depois da confirmação (Congelamento de Odd)
    await runTest(18, 'Colocação', 'Congelamento de Odd: alteração posterior nas odds da corrida não altera bilhete confirmado', async () => {
      const roomCode = 'T18ODD';
      const p1 = { id: 'usr_t18', name: 'FrozenOddTester', chips: 1000, balanceVersion: 1 };
      srv.PLAYERS_DB.set(p1.id, Object.assign({}, p1));
      const race = makeMockRace();
      race.oddsBook = F1Finance.calculateRaceOdds(race);
      const initialOdd = race.oddsBook.drivers['VER'].P1.odd;

      await postJson(testPort, `/api/room/${roomCode}/state`, {
        pid: p1.id,
        state: { code: roomCode, creatorId: p1.id, hostId: p1.id, players: [p1], race }
      });

      const betRes = await postJson(testPort, `/api/room/${roomCode}/bet`, {
        playerId: p1.id,
        bet: { pid: p1.id, modality: 'placement', driver: 'VER', market: 'P1', amount: 50 }
      });
      assert.strictEqual(betRes.status, 200);
      const confirmedBetId = betRes.data.bet.id;
      const lockedOdd = betRes.data.bet.odd;
      assert.strictEqual(lockedOdd, initialOdd);

      // Now mutate the room's oddsBook AND try to push a modified bet odd via /state
      const roomEntry = srv.ROOMS.get(roomCode);
      roomEntry.state.race.oddsBook.drivers['VER'].P1.odd = 15.00;
      const clonedState = JSON.parse(JSON.stringify(roomEntry.state));
      clonedState.race.bets[0].odd = 15.00; // Malicious or subsequent change attempt
      await postJson(testPort, `/api/room/${roomCode}/state`, { pid: p1.id, state: clonedState });

      // Settle race with VER winning
      roomEntry.state.race.done = true;
      const settleRes = await postJson(testPort, `/api/room/${roomCode}/settle`, {});
      assert.strictEqual(settleRes.status, 200);
      const outcome = settleRes.data.results[confirmedBetId];
      assert.strictEqual(outcome.odd, lockedOdd);
      assert.strictEqual(outcome.ret, F1Finance.r2(50 * lockedOdd));
      return `Odd confirmada (${lockedOdd}x) preservada imutavelmente mesmo após odds do painel mudarem para 15.00x`;
    });

    // 19. Piloto que não larga (DNS -> VOID e reembolso único)
    await runTest(19, 'Colocação', 'Piloto que não larga (DNS -> Aposta marcada como VOID e reembolsada uma única vez)', async () => {
      const roomCode = 'T19DNS';
      const p1 = { id: 'usr_t19', name: 'DnsTester', chips: 1000, balanceVersion: 1 };
      srv.PLAYERS_DB.set(p1.id, Object.assign({}, p1));
      const race = makeMockRace();
      await postJson(testPort, `/api/room/${roomCode}/state`, {
        pid: p1.id,
        state: { code: roomCode, creatorId: p1.id, hostId: p1.id, players: [p1], race }
      });

      const betRes = await postJson(testPort, `/api/room/${roomCode}/bet`, {
        playerId: p1.id,
        bet: { pid: p1.id, modality: 'placement', driver: 'NOR', market: 'PODIUM', amount: 80 }
      });
      assert.strictEqual(betRes.status, 200);
      assert.strictEqual(srv.PLAYERS_DB.get(p1.id).chips, 920);

      // Mark NOR as DNS before race finishes
      const roomEntry = srv.ROOMS.get(roomCode);
      roomEntry.state.race.drv['NOR'].st = 'dns';
      roomEntry.state.race.done = true;

      const settle1 = await postJson(testPort, `/api/room/${roomCode}/settle`, {});
      const settle2 = await postJson(testPort, `/api/room/${roomCode}/settle`, {}); // Attempt second refund
      assert.strictEqual(settle1.status, 200);
      assert.strictEqual(settle2.status, 200);
      const outcome = settle1.data.results[betRes.data.bet.id];
      assert.strictEqual(outcome.status, 'VOID');
      assert.strictEqual(srv.PLAYERS_DB.get(p1.id).chips, 1000); // Reimbursed once!
      return `NOR marcado como DNS -> Bilhete VOID, saldo restaurado de 920 para 1000 (1 único reembolso)`;
    });

    // 20. Corrida cancelada antes da largada (VOID e devolução integral)
    await runTest(20, 'Colocação', 'Corrida cancelada antes da largada (Devolve apostas confirmadas como VOID)', async () => {
      const roomCode = 'T20CAN';
      const p1 = { id: 'usr_t20', name: 'CancelRaceTester', chips: 2000, balanceVersion: 1 };
      srv.PLAYERS_DB.set(p1.id, Object.assign({}, p1));
      const race = makeMockRace();
      await postJson(testPort, `/api/room/${roomCode}/state`, {
        pid: p1.id,
        state: { code: roomCode, creatorId: p1.id, hostId: p1.id, players: [p1], race }
      });

      await postJson(testPort, `/api/room/${roomCode}/bet`, {
        playerId: p1.id,
        bet: { pid: p1.id, modality: 'placement', driver: 'VER', market: 'P1', amount: 100 }
      });
      await postJson(testPort, `/api/room/${roomCode}/bet`, {
        playerId: p1.id,
        bet: { pid: p1.id, modality: 'overtake', driver: 'LEC', amount: 100 }
      });
      assert.strictEqual(srv.PLAYERS_DB.get(p1.id).chips, 1800);

      // Cancel race before start
      const roomEntry = srv.ROOMS.get(roomCode);
      roomEntry.state.race.cancelled = true;
      roomEntry.state.race.started = false;
      const settleRes = await postJson(testPort, `/api/room/${roomCode}/settle`, {});
      assert.strictEqual(settleRes.status, 200);
      assert.strictEqual(srv.PLAYERS_DB.get(p1.id).chips, 2000);
      return `Corrida cancelada pré-largada -> 2 bilhetes marcados VOID e 200 fichas devolvidas (Saldo: 2000)`;
    });

    /* =====================================================================
     * TESTES FINANCEIROS E MULTIPLAYER (21 a 32)
     * ===================================================================== */

    // 21. Utilização simultânea das duas modalidades
    await runTest(21, 'Financeiro & MP', 'Utilização simultânea das duas modalidades compartilhando o mesmo banco e exposição', async () => {
      const roomCode = 'T21MOD';
      const p1 = { id: 'usr_t21', name: 'DualModalityPlayer', chips: 10000, balanceVersion: 1 };
      srv.PLAYERS_DB.set(p1.id, Object.assign({}, p1));
      const race = makeMockRace();
      await postJson(testPort, `/api/room/${roomCode}/state`, {
        pid: p1.id,
        state: { code: roomCode, creatorId: p1.id, hostId: p1.id, players: [p1], race }
      });

      // 3000 in Overtake + 2000 in Placement = 5.000 (exact 50% limit of 10.000)
      const r1 = await postJson(testPort, `/api/room/${roomCode}/bet`, {
        playerId: p1.id,
        bet: { pid: p1.id, modality: 'overtake', driver: 'HAM', amount: 3000 }
      });
      const r2 = await postJson(testPort, `/api/room/${roomCode}/bet`, {
        playerId: p1.id,
        bet: { pid: p1.id, modality: 'placement', driver: 'VER', market: 'P1', amount: 2000 }
      });
      assert.strictEqual(r1.status, 200);
      assert.strictEqual(r2.status, 200);
      assert.strictEqual(r2.data.exposure.committedOvertake, 3000);
      assert.strictEqual(r2.data.exposure.committedPlacement, 2000);
      assert.strictEqual(r2.data.exposure.totalCommitted, 5000);
      assert.strictEqual(r2.data.exposure.remainingExposure, 0);
      assert.strictEqual(srv.PLAYERS_DB.get(p1.id).chips, 5000);
      return `Saldo 10.000 -> 3.000 (Ultrapassagem) + 2.000 (Colocação) = 5.000 comprometidos (Limite 50%, Saldo disp: 5.000)`;
    });

    // 22. Tentativa de ultrapassar os 50% de exposição
    await runTest(22, 'Financeiro & MP', 'Bloqueio estrito ao tentar ultrapassar o limite de 50% de exposição na corrida', async () => {
      const roomCode = 'T21MOD'; // Reusing player usr_t21 who already committed 5000 / 5000
      const rExceed = await postJson(testPort, `/api/room/${roomCode}/bet`, {
        playerId: 'usr_t21',
        bet: { pid: 'usr_t21', modality: 'overtake', driver: 'NOR', amount: 1 }
      });
      assert.strictEqual(rExceed.status, 400);
      assert.strictEqual(rExceed.data.code, 'EXPOSURE_LIMIT_EXCEEDED');
      assert.strictEqual(srv.PLAYERS_DB.get('usr_t21').chips, 5000);
      return `Tentativa de apostar +1 ficha após atingir 5.000/5.000 (50%) bloqueada com código EXPOSURE_LIMIT_EXCEEDED`;
    });

    // 23. Duas apostas simultâneas em abas diferentes tentando contornar o limite de 50%
    await runTest(23, 'Financeiro & MP', 'Proteção contra duas apostas simultâneas em abas diferentes tentando burlar os 50%', async () => {
      const roomCode = 'T23CON';
      const p1 = { id: 'usr_t23', name: 'ConcurrentTabPlayer', chips: 5000, balanceVersion: 1 }; // 50% limit = 2500
      srv.PLAYERS_DB.set(p1.id, Object.assign({}, p1));
      const race = makeMockRace();
      await postJson(testPort, `/api/room/${roomCode}/state`, {
        pid: p1.id,
        state: { code: roomCode, creatorId: p1.id, hostId: p1.id, players: [p1], race }
      });

      // Fire two parallel 1500-chip requests at the exact same millisecond (1500 + 1500 = 3000 > 2500 limit)
      const [tabA, tabB] = await Promise.all([
        postJson(testPort, `/api/room/${roomCode}/bet`, {
          playerId: p1.id,
          bet: { pid: p1.id, modality: 'overtake', driver: 'VER', amount: 1500 }
        }),
        postJson(testPort, `/api/room/${roomCode}/bet`, {
          playerId: p1.id,
          bet: { pid: p1.id, modality: 'placement', driver: 'NOR', market: 'PODIUM', amount: 1500 }
        })
      ]);

      const successes = [tabA, tabB].filter(r => r.status === 200);
      const rejections = [tabA, tabB].filter(r => r.status === 400 && r.data.code === 'EXPOSURE_LIMIT_EXCEEDED');
      assert.strictEqual(successes.length, 1);
      assert.strictEqual(rejections.length, 1);
      assert.strictEqual(srv.PLAYERS_DB.get(p1.id).chips, 3500);
      return `2 requisições simultâneas de 1.500 (limite 2.500): 1 aceita, 1 rejeitada (Saldo final exato: 3.500)`;
    });

    // 24. Dois jogadores realizando apostas simultaneamente na mesma sala
    await runTest(24, 'Financeiro & MP', 'Dois jogadores distintos realizando apostas simultaneamente na mesma sala', async () => {
      const roomCode = 'T24MP';
      const pA = { id: 'usr_t24_a', name: 'Piloto A', chips: 2000, balanceVersion: 1 };
      const pB = { id: 'usr_t24_b', name: 'Piloto B', chips: 3000, balanceVersion: 1 };
      srv.PLAYERS_DB.set(pA.id, Object.assign({}, pA));
      srv.PLAYERS_DB.set(pB.id, Object.assign({}, pB));
      const race = makeMockRace();
      await postJson(testPort, `/api/room/${roomCode}/state`, {
        pid: pA.id,
        state: { code: roomCode, creatorId: pA.id, hostId: pA.id, players: [pA, pB], race }
      });

      const [resA, resB] = await Promise.all([
        postJson(testPort, `/api/room/${roomCode}/bet`, {
          playerId: pA.id,
          bet: { pid: pA.id, modality: 'overtake', driver: 'LEC', amount: 750 }
        }),
        postJson(testPort, `/api/room/${roomCode}/bet`, {
          playerId: pB.id,
          bet: { pid: pB.id, modality: 'placement', driver: 'VER', market: 'P1', amount: 250 }
        })
      ]);

      assert.strictEqual(resA.status, 200);
      assert.strictEqual(resB.status, 200);
      assert.strictEqual(srv.PLAYERS_DB.get(pA.id).chips, 1250);
      assert.strictEqual(srv.PLAYERS_DB.get(pB.id).chips, 2750);
      assert.strictEqual(srv.ROOMS.get(roomCode).state.race.bets.length, 2);
      return `Piloto A (1250 🪙) e Piloto B (2750 🪙) processados simultaneamente sem colisão de estado`;
    });

    // 25. Atualização da página (F5) durante a corrida não reinicia o limite de exposição nem perde apostas
    await runTest(25, 'Financeiro & MP', 'Atualização da página durante a corrida mantém exposição bloqueada e apostas ativas', async () => {
      const roomCode = 'T24MP';
      // Simulate page refresh: client pushes state without exposures or tries to re-sync player with inflated chips
      const roomState = srv.ROOMS.get(roomCode).state;
      const clientRefreshState = JSON.parse(JSON.stringify(roomState));
      delete clientRefreshState.race.exposures; // Client lost exposure object on refresh
      await postJson(testPort, `/api/room/${roomCode}/state`, { pid: 'usr_t24_a', state: clientRefreshState });

      // Attempt to bet 300 more for Piloto A (initial was 2000 -> 50% maxExposure 1000, already committed 750 -> only 250 left)
      const betAfterRefresh = await postJson(testPort, `/api/room/${roomCode}/bet`, {
        playerId: 'usr_t24_a',
        bet: { pid: 'usr_t24_a', modality: 'overtake', driver: 'NOR', amount: 300 }
      });
      assert.strictEqual(betAfterRefresh.status, 400);
      assert.strictEqual(betAfterRefresh.data.code, 'EXPOSURE_LIMIT_EXCEEDED');
      return `Exposição de 1.000 fichas (750 já usados) permaneceu intacta após refresh de página; aposta de 300 bloqueada`;
    });

    // 26. Fechamento e reabertura do site (Persistência em disco e recuperação de sessão)
    await runTest(26, 'Financeiro & MP', 'Fechamento e reabertura do site (Persistência real em players_db.json)', async () => {
      srv.savePlayersDb();
      const rawDisk = JSON.parse(fs.readFileSync(PLAYERS_DB_PATH, 'utf-8'));
      assert.ok(rawDisk['usr_t24_a']);
      assert.strictEqual(rawDisk['usr_t24_a'].chips, 1250);
      assert.strictEqual(rawDisk['usr_t24_a'].committedChips, 750);
      assert.strictEqual(rawDisk['usr_t24_a'].totalBalance, 2000);

      // Simulate client re-opening site and querying /api/player/usr_t24_a
      const getRes = await getJson(testPort, `/api/player/usr_t24_a`);
      assert.strictEqual(getRes.status, 200);
      assert.strictEqual(getRes.data.player.chips, 1250);
      return `Registro persistido em disco e recuperado via GET /api/player: Disponível=1250, Comprometido=750, Total=2000`;
    });

    // 27. Tentativa de pagamento/bilhete duplicado
    await runTest(27, 'Financeiro & MP', 'Proteção contra duplicação de bilhetes e tentativa de pagamento duplicado', async () => {
      const roomCode = 'T24MP';
      const existingBet = srv.ROOMS.get(roomCode).state.race.bets[0];
      const dupBetRes = await postJson(testPort, `/api/room/${roomCode}/bet`, {
        playerId: existingBet.pid,
        bet: existingBet
      });
      assert.strictEqual(dupBetRes.status, 409);
      assert.strictEqual(dupBetRes.data.code, 'DUPLICATE_BET');
      return `Reenvio do mesmo betId (${existingBet.id}) rejeitado com HTTP 409 DUPLICATE_BET`;
    });

    // 28. Liquidação duplicada da mesma corrida
    await runTest(28, 'Financeiro & MP', 'Idempotência na liquidação: liquidar a mesma corrida múltiplas vezes paga apenas 1 vez', async () => {
      const roomCode = 'T24MP';
      const roomEntry = srv.ROOMS.get(roomCode);
      roomEntry.state.race.done = true;
      roomEntry.state.race.order[0] = 'VER'; // Piloto B bet 250 on VER P1

      const s1 = await postJson(testPort, `/api/room/${roomCode}/settle`, {});
      const balAfterFirst = srv.PLAYERS_DB.get('usr_t24_b').chips;
      const verAfterFirst = srv.PLAYERS_DB.get('usr_t24_b').balanceVersion;

      // Call settle 3 more times
      const s2 = await postJson(testPort, `/api/room/${roomCode}/settle`, {});
      const s3 = await postJson(testPort, `/api/room/${roomCode}/settle`, {});
      assert.strictEqual(s1.status, 200);
      assert.strictEqual(s1.data.settledCount, 2);
      assert.strictEqual(s2.data.settledCount, 0);
      assert.strictEqual(s3.data.settledCount, 0);
      assert.strictEqual(srv.PLAYERS_DB.get('usr_t24_b').chips, balAfterFirst);
      assert.strictEqual(srv.PLAYERS_DB.get('usr_t24_b').balanceVersion, verAfterFirst);
      return `1ª liquidação processou 2 bilhetes; 2ª e 3ª liquidações processaram 0 bilhetes (Saldo inalterado: ${balAfterFirst})`;
    });

    // 29. Persistência dos saldos e proteção contra manipulação pelo frontend
    await runTest(29, 'Financeiro & MP', 'Proteção contra manipulação de saldo pelo frontend (/api/player/sync)', async () => {
      const currentBal = srv.PLAYERS_DB.get('usr_t24_a').chips;
      // Malicious client tries to sync player with 999,999 chips and higher balanceVersion
      const hackRes = await postJson(testPort, `/api/player/sync`, {
        player: { id: 'usr_t24_a', name: 'Piloto A', chips: 999999, balanceVersion: 9999 }
      });
      assert.strictEqual(hackRes.status, 200);
      assert.strictEqual(hackRes.data.player.chips, currentBal);
      assert.strictEqual(srv.PLAYERS_DB.get('usr_t24_a').chips, currentBal);
      return `Tentativa do frontend de injetar 999.999 fichas ignorada pelo backend (Saldo preservado: ${currentBal})`;
    });

    // 30. Preservação de históricos e dados antigos (Compatibilidade retroativa)
    await runTest(30, 'Financeiro & MP', 'Preservação integral de contas existentes, históricos e apostas do modelo legado', () => {
      const parsedOrig = JSON.parse(originalDbContent || '{}');
      // Verify existing accounts from players_db.json (usr_test_1, usr_test_2, usr_chk_1) were preserved
      for (const origId of Object.keys(parsedOrig)) {
        const loaded = srv.PLAYERS_DB.get(origId);
        assert.ok(loaded, `Conta existente ${origId} deve estar preservada`);
        assert.strictEqual(loaded.chips, parsedOrig[origId].chips);
      }
      // Verify legacy bet without expectedOvertakes or modality still settles with original conditions
      const race = makeMockRace({ done: true });
      const legacyBet = { id: 'legacy_bet_1', driver: 'VER', amount: 50, startPos: 1, mult: 1.0 };
      const legOutcome = F1Finance.evaluateTicketForRace(race, legacyBet);
      assert.strictEqual(legOutcome.modality, 'legacy');
      assert.strictEqual(legOutcome.ret, 150);
      return `Contas originais (${Object.keys(parsedOrig).join(', ')}) e bilhetes legados preservados sem alteração retroativa`;
    });

    // 31. Verificação de que combinações de apostas não oferecem lucro matematicamente garantido
    await runTest(31, 'Financeiro & MP', 'Anti-arbitragem: nenhuma combinação de apostas (Dutching) oferece lucro garantido', () => {
      const race = makeMockRace();
      const oddsBook = F1Finance.calculateRaceOdds(race, { numSimulations: 1000 });
      const drivers = Object.keys(oddsBook.drivers);

      // Check across single-winner markets (P1, P2, P3) that sum of implied probabilities (1 / odd) > 1.0
      // In Dutching, if you bet s_i = 1 / odd_i on every enabled driver so that payout is 1 unit regardless of winner,
      // total cost is sum(1 / odd_i). Guaranteed profit exists only if sum(1 / odd_i) < 1.0.
      const singleMarkets = ['P1', 'P2', 'P3'];
      const overrounds = {};
      for (const mKey of singleMarkets) {
        let sumImplied = 0;
        for (const dId of drivers) {
          const info = oddsBook.drivers[dId][mKey];
          assert.ok(info.odd <= 15.00, `Odd excedeu máximo de 15x: ${info.odd}`);
          if (info.enabled) {
            assert.ok(info.odd >= 1.00, `Odd habilitada menor que 1.00x: ${info.odd}`);
            // Check 2 decimal places floor
            assert.strictEqual(info.odd, F1Finance.floor2(info.odd));
            sumImplied += (1 / info.odd);
          }
        }
        overrounds[mKey] = F1Finance.r2(sumImplied * 100);
        assert.ok(sumImplied > 1.0, `Arbitragem detectada no mercado ${mKey}: sum(1/odd) = ${sumImplied}`);
      }
      return `1.000 simulações executadas; Overround casa: P1=${overrounds.P1}%, P2=${overrounds.P2}%, P3=${overrounds.P3}% (>100%, lucro garantido impossível)`;
    });

    // 32. Verificação de que nenhuma operação financeira permite saldo negativo
    await runTest(32, 'Financeiro & MP', 'Proteção absoluta contra saldo negativo em apostas, liquidações e remoções admin', async () => {
      const roomCode = 'T32NEG';
      const p1 = { id: 'usr_t32', name: 'ZeroNegTester', chips: 50, balanceVersion: 1 };
      srv.PLAYERS_DB.set(p1.id, Object.assign({}, p1));
      const race = makeMockRace();
      await postJson(testPort, `/api/room/${roomCode}/state`, {
        pid: p1.id,
        state: { code: roomCode, creatorId: p1.id, hostId: p1.id, players: [p1], race }
      });

      // 1. Try negative bet amount
      const negBet = await postJson(testPort, `/api/room/${roomCode}/bet`, {
        playerId: p1.id,
        bet: { pid: p1.id, modality: 'overtake', driver: 'VER', amount: -20 }
      });
      assert.strictEqual(negBet.status, 400);

      // 2. Try bet larger than available balance
      const overBet = await postJson(testPort, `/api/room/${roomCode}/bet`, {
        playerId: p1.id,
        bet: { pid: p1.id, modality: 'overtake', driver: 'VER', amount: 500 }
      });
      assert.strictEqual(overBet.status, 400);

      // 3. Admin remove more than balance -> clamps at 0.00
      const token = srv.issueInternalTestAdminToken();
      const admRem = await postJson(testPort, `/api/admin/balance`, {
        token,
        playerId: p1.id,
        operation: 'remove',
        amount: 9999
      });
      assert.strictEqual(admRem.status, 200);
      assert.strictEqual(admRem.data.player.chips, 0);
      assert.ok(srv.PLAYERS_DB.get(p1.id).chips >= 0);
      return `Aposta negativa (400), aposta acima do saldo (400) e remoção admin acima do saldo (limitada a 0.00 🪙) validadas`;
    });

  } finally {
    // Restore clean original players_db.json so test accounts don't pollute user's production DB
    fs.writeFileSync(PLAYERS_DB_PATH, originalDbContent, 'utf-8');
    srv.server.close();
  }

  const passed = RESULTS.filter(r => r.status === 'APROVADO').length;
  const failed = RESULTS.filter(r => r.status !== 'APROVADO').length;
  console.log(`\n=============================================================`);
  console.log(`RESUMO DOS TESTES OBRIGATÓRIOS: ${passed}/32 APROVADOS | ${failed} REPROVADOS`);
  console.log(`=============================================================`);
  if (failed > 0) process.exit(1);
})();
