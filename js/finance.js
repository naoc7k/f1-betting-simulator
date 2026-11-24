/**
 * F1 Betting Simulator - Core Financial, Expectation & Dynamic Odds Engine
 * Isomorphic module: runs in Browser (window.F1Finance) and Node.js (module.exports).
 *
 * Implements:
 *  1. 10% Exposure Control per race (locked before first bet, shared across modalities)
 *  2. Lap Multipliers (Start: 1.0x, L1-10: 0.9x, ..., L81-90+: 0.1x)
 *  3. Overtake Performance Expectation Model (E) & Real On-Track Overtake Ledger
 *  4. Revised Overtake Payout Formula (F = 0.20, Max Return = 5x stake, strict O > E win condition)
 *  5. Final Placement Modality (P1, P2, P3, PODIUM, TOP5, TOP10) - Pre-race only
 *  6. Dynamic Odds Engine via 1,000 Predictive Monte Carlo Race Simulations + 6% House Margin
 *  7. Anti-Arbitrage /Dutching Protection, VOID handling, Idempotent Settlement & Transaction Ledger
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.F1Finance = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MODEL_VERSION = 'F1_ECON_V4.1_MC1000';
  const EXPOSURE_RATE = 0.50;          // 50% of initial available balance at start of race
  const OVERTAKE_FACTOR_F = 0.20;      // Financial factor per excess overtake (0,20)
  const MAX_OVERTAKE_RETURN_MULT = 5.0; // Max total return = 5x stake (including stake)
  const HOUSE_MARGIN = 0.06;           // 6% house margin -> 0.94 / probability
  const MIN_ODD = 1.00;
  const MAX_ODD = 15.00;
  const DEFAULT_SIMULATIONS = 1000;

  const PLACEMENT_MARKETS = {
    P1:     { id: 'P1',     label: 'Vencedor (1º Lugar)',       shortLabel: '1º Lugar',  desc: 'Terminar em 1º lugar',                 check: (pos, dnf) => !dnf && pos === 1 },
    P2:     { id: 'P2',     label: 'Segundo Colocado (2º)',     shortLabel: '2º Lugar',  desc: 'Terminar exatamente em 2º lugar',      check: (pos, dnf) => !dnf && pos === 2 },
    P3:     { id: 'P3',     label: 'Terceiro Colocado (3º)',    shortLabel: '3º Lugar',  desc: 'Terminar exatamente em 3º lugar',      check: (pos, dnf) => !dnf && pos === 3 },
    PODIUM: { id: 'PODIUM', label: 'Pódio (Top 3)',             shortLabel: 'Pódio',     desc: 'Terminar entre os 3 primeiros',        check: (pos, dnf) => !dnf && pos >= 1 && pos <= 3 },
    TOP5:   { id: 'TOP5',   label: 'Top 5 (1º ao 5º)',          shortLabel: 'Top 5',     desc: 'Terminar entre os 5 primeiros',        check: (pos, dnf) => !dnf && pos >= 1 && pos <= 5 },
    TOP10:  { id: 'TOP10',  label: 'Top 10 (Zona de Pontos)',   shortLabel: 'Top 10',    desc: 'Terminar entre os 10 primeiros',       check: (pos, dnf) => !dnf && pos >= 1 && pos <= 10 }
  };

  function r2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function floor2(n) {
    // Use 1e-9 epsilon to avoid IEEE 754 floating point inaccuracies like 2.50 * 100 = 249.99999999999997
    return Math.floor(((Number(n) || 0) + 1e-9) * 100) / 100;
  }

  function hashStr(s) {
    let h = 2166136261;
    const str = String(s || '');
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function nextRng(stateObj) {
    stateObj.rs = (stateObj.rs + 0x6D2B79F5) | 0;
    let t = Math.imul(stateObj.rs ^ (stateObj.rs >>> 15), 1 | stateObj.rs);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function gaussRng(stateObj) {
    return (nextRng(stateObj) + nextRng(stateObj) + nextRng(stateObj) - 1.5) / 1.5;
  }

  /**
   * 3. MULTIPLICADORES POR VOLTA
   * Largada (lap === 0): 1.0x
   * Voltas 1-10: 0.9x
   * Voltas 11-20: 0.8x
   * Voltas 21-30: 0.7x
   * Voltas 31-40: 0.6x
   * Voltas 41-50: 0.5x
   * Voltas 51-60: 0.4x
   * Voltas 61-70: 0.3x
   * Voltas 71-80: 0.2x
   * Voltas 81-90 (e > 90): 0.1x
   */
  function getLapMultiplier(lap) {
    const L = Math.max(0, Math.floor(Number(lap) || 0));
    if (L === 0) return 1.0;
    const bracket = Math.floor((L - 1) / 10); // L1-10 -> 0, L11-20 -> 1, ..., L81-90 -> 8
    const m = 0.9 - bracket * 0.1;
    return Math.max(0.1, Math.round(m * 10) / 10);
  }

  /**
   * Helper to get driver & team data from global or passed catalog
   */
  function getCatalog(customCatalog) {
    if (customCatalog && customCatalog.DRIVERS) return customCatalog;
    if (typeof window !== 'undefined' && window.F1Tracks) return window.F1Tracks;
    return {
      DRIVERS: [
        { id: 'NOR', name: 'Lando Norris',      team: 'MCL', num: 4,  skill: -0.22, ov: 0.89 },
        { id: 'PIA', name: 'Oscar Piastri',     team: 'MCL', num: 81, skill: -0.18, ov: 0.88 },
        { id: 'RUS', name: 'George Russell',    team: 'MER', num: 63, skill: -0.15, ov: 0.86 },
        { id: 'ANT', name: 'Kimi Antonelli',    team: 'MER', num: 12, skill: -0.04, ov: 0.83 },
        { id: 'VER', name: 'Max Verstappen',    team: 'RBR', num: 1,  skill: -0.32, ov: 0.92 },
        { id: 'HAD', name: 'Isack Hadjar',      team: 'RBR', num: 6,  skill:  0.03, ov: 0.80 },
        { id: 'LEC', name: 'Charles Leclerc',   team: 'FER', num: 16, skill: -0.19, ov: 0.89 },
        { id: 'HAM', name: 'Lewis Hamilton',    team: 'FER', num: 44, skill: -0.18, ov: 0.90 },
        { id: 'SAI', name: 'Carlos Sainz',      team: 'WIL', num: 55, skill: -0.10, ov: 0.85 },
        { id: 'ALB', name: 'Alexander Albon',   team: 'WIL', num: 23, skill: -0.05, ov: 0.83 },
        { id: 'LAW', name: 'Liam Lawson',       team: 'RB',  num: 30, skill:  0.02, ov: 0.80 },
        { id: 'LIN', name: 'Arvid Lindblad',    team: 'RB',  num: 40, skill:  0.07, ov: 0.78 },
        { id: 'ALO', name: 'Fernando Alonso',   team: 'AST', num: 14, skill: -0.14, ov: 0.89 },
        { id: 'STR', name: 'Lance Stroll',      team: 'AST', num: 18, skill:  0.08, ov: 0.74 },
        { id: 'CAM', name: 'Rafael Câmara',     team: 'HAA', num: 88, skill:  0.03, ov: 0.81 },
        { id: 'BEA', name: 'Oliver Bearman',    team: 'HAA', num: 87, skill:  0.04, ov: 0.79 },
        { id: 'HUL', name: 'Nico Hülkenberg',   team: 'AUD', num: 27, skill: -0.02, ov: 0.81 },
        { id: 'BOR', name: 'Gabriel Bortoleto', team: 'AUD', num: 5,  skill:  0.02, ov: 0.82 },
        { id: 'GAS', name: 'Pierre Gasly',      team: 'ALP', num: 10, skill: -0.03, ov: 0.81 },
        { id: 'COL', name: 'Franco Colapinto',  team: 'ALP', num: 43, skill:  0.05, ov: 0.79 },
        { id: 'BOT', name: 'Valtteri Bottas',   team: 'CAD', num: 77, skill: -0.02, ov: 0.81 },
        { id: 'PER', name: 'Sergio Pérez',      team: 'CAD', num: 11, skill: -0.04, ov: 0.83 }
      ],
      TEAM_PACE: {
        MCL: -0.06, RBR: 0.0, FER: 0.06, MER: 0.14, WIL: 0.45,
        AST: 0.52, RB: 0.56, AUD: 0.65, ALP: 0.68, HAA: 0.70, CAD: 0.72
      }
    };
  }

  /**
   * 2.2. SISTEMA DE EXPECTATIVA DE DESEMPENHO (OVERTAKES)
   * Calcula quantas ultrapassagens reais de pista são esperadas de um piloto
   * durante o período restante da corrida, com base em:
   *  - Capacidade do carro e força da equipe (TEAM_PACE)
   *  - Habilidade (skill) e agressividade de ultrapassagem (ov) do piloto
   *  - Histórico/desempenho recente no campeonato (champPoints)
   *  - Posição atual/largada vs posição natural esperada de ritmo (paceRank)
   *  - Características de ultrapassagem do circuito (circuit.ot)
   *  - Condições climáticas (wetness w / ws)
   *  - Número de voltas restantes (remainingLaps)
   */
  function calculateExpectedOvertakes(race, driverId, catalog, champData) {
    if (!race || !driverId) return 0;
    const cat = getCatalog(catalog);
    const driversList = cat.DRIVERS || [];
    const teamPaceMap = cat.TEAM_PACE || {};

    const activeOrder = Array.isArray(race.order) && race.order.length
      ? race.order.slice()
      : (Array.isArray(race.start) && race.start.length ? race.start.slice() : driversList.map(d => d.id));

    const currentPos = activeOrder.indexOf(driverId) + 1;
    if (currentPos <= 0) return 0;

    const drvState = race.drv && race.drv[driverId];
    if (drvState && (drvState.st === 'dnf' || drvState.st === 'dns')) return 0;

    const totalLaps = Math.max(1, Number(race.total) || 15);
    const currentLap = Math.max(0, Number(race.lap) || 0);
    const remainingLaps = Math.max(0, totalLaps - currentLap);
    if (remainingLaps <= 0) return 0;

    // 1. Compute composite pace score for each active driver in the grid (lower = faster)
    const champD = (champData && champData.d) || {};
    const maxChampPts = Math.max(1, ...Object.values(champD).map(v => Number(v) || 0));

    const paceScores = {};
    const runningDrivers = activeOrder.filter(id => !race.drv || !race.drv[id] || race.drv[id].st === 'run');

    runningDrivers.forEach(id => {
      const dObj = driversList.find(x => x.id === id) || { team: 'CAD', skill: 0.05, ov: 0.80 };
      const tPace = teamPaceMap[dObj.team] !== undefined ? teamPaceMap[dObj.team] : 0.55;
      const dSkill = Number(dObj.skill ?? 0.05);
      const recentFormBonus = ((Number(champD[id]) || 0) / maxChampPts) * 0.06;
      paceScores[id] = tPace + dSkill - recentFormBonus;
    });

    // Sort active drivers by pure pace to find natural expected rank (1 = fastest)
    const sortedByPace = runningDrivers.slice().sort((a, b) => paceScores[a] - paceScores[b]);
    const naturalRank = sortedByPace.indexOf(driverId) + 1;
    const myRunningPos = runningDrivers.indexOf(driverId) + 1;

    const dObj = driversList.find(x => x.id === driverId) || { team: 'CAD', skill: 0.05, ov: 0.80 };
    const ovRating = Number(dObj.ov || 0.80); // 0.74 to 0.92
    const circuitOt = Number((race.circuit && race.circuit.ot) || 0.50); // 0.16 (Monaco) to 0.68 (Monza)
    const wetness = Number(race.w || 0);

    // 2. Count how many cars currently ahead of driverId are slower than driverId, and by how much
    let expectedFromPositionDeficit = 0;
    const myPace = paceScores[driverId] ?? 0.5;

    for (let i = 0; i < myRunningPos - 1; i++) {
      const aheadId = runningDrivers[i];
      const aheadPace = paceScores[aheadId] ?? 0.5;
      const paceAdvantage = aheadPace - myPace; // positive if driverId is faster than car ahead
      if (paceAdvantage > 0.02) {
        // Probability of passing this slower car per remaining lap
        const passEase = Math.min(1.0, (paceAdvantage * 1.45 + (ovRating - 0.75) * 1.2) * (0.55 + circuitOt * 0.9));
        const probOverRemaining = 1 - Math.pow(1 - Math.min(0.45, passEase * 0.16), remainingLaps);
        expectedFromPositionDeficit += probOverRemaining;
      } else if (paceAdvantage > -0.12) {
        // Equal-ish car immediately ahead: small battle chance
        const dist = (myRunningPos - 1) - i;
        if (dist <= 3) {
          expectedFromPositionDeficit += 0.18 * circuitOt * (ovRating / 0.85) * Math.min(1, remainingLaps / 12);
        }
      }
    }

    // 3. Base mid-lap and strategy wheel-to-wheel overtake expectation over remaining laps
    // In simCompleteLap + triggerMidLapAction, active drivers in P2..P12 have wheel-to-wheel battles
    const lapFactor = Math.min(1.6, remainingLaps / 12);
    const weatherFactor = 1 + wetness * 0.22;
    const trackFactor = 0.6 + circuitOt * 0.85;
    const posOpportunity = myRunningPos <= 1 ? 0.15 : myRunningPos <= 4 ? 0.55 : myRunningPos <= 12 ? 0.95 : 1.15;

    const battleExpectation = posOpportunity * lapFactor * trackFactor * weatherFactor * (ovRating / 0.82) * 0.85;

    // 4. Combine position deficit recovery + organic battle expectation
    const rawExpected = expectedFromPositionDeficit + battleExpectation;

    // Round to nearest integer (minimum 0, or at least 1 for any driver starting P4 or worse with >= 5 laps remaining on non-Monaco tracks)
    let expectedInt = Math.round(rawExpected);
    if (myRunningPos > naturalRank + 1 && remainingLaps >= 5) {
      // Fast car out of position at the back (e.g. P18 with competitive car) MUST have a meaningful expectation
      const minDeficitExp = Math.max(1, Math.round((myRunningPos - naturalRank) * (0.35 + circuitOt * 0.35) * Math.min(1, remainingLaps / 10)));
      expectedInt = Math.max(expectedInt, minDeficitExp);
    }

    return Math.max(0, Math.min(runningDrivers.length + 5, expectedInt));
  }

  /**
   * 2.3. FÓRMULA DE PAGAMENTO REVISADA (ULTRAPASSAGENS)
   * Variáveis:
   *  - S = valor apostado (stake)
   *  - O = ultrapassagens reais após a confirmação
   *  - E = ultrapassagens esperadas para o mesmo período
   *  - M = multiplicador vigente no momento da aposta
   *  - F = fator financeiro de 0,20
   *
   * Ultrapassagens excedentes = max(0, O - E)
   * Lucro = S * Ultrapassagens excedentes * F * M
   *
   * Regra de liquidação:
   *  - Se O > E: aposta vencedora -> jogador recebe S + Lucro, limitado a 5 * S (incluindo S)
   *  - Se O <= E: aposta perdedora -> retorno = 0, lucro líquido = -S (perde o valor comprometido)
   */
  function calculateOvertakePayout(stake, actualOvertakes, expectedOvertakes, multiplier, factorF = OVERTAKE_FACTOR_F) {
    const S = r2(Math.max(0, Number(stake) || 0));
    const O = Math.max(0, Math.floor(Number(actualOvertakes) || 0));
    const E = Math.max(0, Math.floor(Number(expectedOvertakes) || 0));
    const M = Number(multiplier) || 1.0;
    const F = Number(factorF) || OVERTAKE_FACTOR_F;

    if (S <= 0) {
      return { won: false, excessOvertakes: 0, profit: 0, totalReturn: 0, netProfit: 0, capped: false };
    }

    if (O <= E) {
      return {
        won: false,
        excessOvertakes: 0,
        profit: 0,
        totalReturn: 0,
        netProfit: r2(-S),
        capped: false
      };
    }

    const excess = O - E;
    const rawProfit = r2(S * excess * F * M);
    const maxTotalReturn = r2(S * MAX_OVERTAKE_RETURN_MULT);
    const uncappedTotal = r2(S + rawProfit);
    const capped = uncappedTotal > maxTotalReturn;
    const totalReturn = capped ? maxTotalReturn : uncappedTotal;
    const profit = r2(totalReturn - S);

    return {
      won: true,
      excessOvertakes: excess,
      profit,
      totalReturn,
      netProfit: profit,
      capped
    };
  }

  /**
   * 2.1. CONTABILIZAÇÃO DE ULTRAPASSAGENS REAIS
   * Conta exclusivamente eventos reais de pista (`ON_TRACK`), com ID único,
   * realizados pelo piloto selecionado APÓS a confirmação da aposta (ts / seq / lap).
   * Ignora pit stops, abandonos (DNF), penalidades, desclassificações ou alterações administrativas.
   */
  function countValidOvertakesForBet(race, bet) {
    if (!race || !bet || bet.cancelled) return { count: 0, eventIds: [] };

    const log = Array.isArray(race.overtakeLog) ? race.overtakeLog : [];
    const seenIds = new Set();
    const validIds = [];

    const betSeq = Number(bet.confirmedEventSeq || 0);
    const betLap = Number(bet.lap || 0);
    const betTs = Number(bet.ts || 0);

    for (let i = 0; i < log.length; i++) {
      const ev = log[i];
      if (!ev || !ev.id) continue;
      // Deduplicate by unique event ID
      if (seenIds.has(ev.id)) continue;

      // Must be the bet's driver performing the pass
      if (ev.passer !== bet.driver) continue;

      // Strictly real on-track pass against an active competitor
      if (ev.realOnTrack !== true || ev.cause !== 'ON_TRACK') continue;
      if (ev.pitPass || ev.dnfPass || ev.penaltyPass || ev.adminChange || ev.artificial) continue;
      if (ev.passedDriverActive === false) continue;

      // Must occur strictly after bet confirmation
      let isAfter = false;
      if (betSeq > 0 && typeof ev.seq === 'number') {
        isAfter = ev.seq > betSeq;
      } else if (typeof ev.lap === 'number' && ev.lap !== betLap) {
        isAfter = ev.lap > betLap;
      } else if (betTs > 0 && typeof ev.ts === 'number') {
        isAfter = ev.ts >= betTs;
      } else {
        isAfter = (Number(ev.lap || 0) > betLap);
      }

      if (isAfter) {
        seenIds.add(ev.id);
        validIds.push(ev.id);
      }
    }

    return {
      count: validIds.length,
      eventIds: validIds
    };
  }

  /**
   * 5. SISTEMA DE ODDS DINÂMICAS (1.000 SIMULAÇÕES PREDITIVAS DE CORRIDA)
   * Executa `numSimulations` (padrão: 1.000) corridas completas usando a física real
   * do simulador (TEAM_PACE, skill, ov, pneus, pit stops, clima, circuito, grid de largada
   * e forma recente no campeonato) para estimar a probabilidade de cada mercado.
   */
  const TYRES_SIM = {
    S: { p: -0.5, d: 0.07, l: 14 },
    M: { p:  0.0, d: 0.04, l: 24 },
    H: { p:  0.4, d: 0.025, l: 36 },
    I: { p:  0.0, d: 0.03, l: 30 },
    W: { p:  0.0, d: 0.02, l: 40 }
  };

  function slickForSim(rem, cur) {
    const c = rem > 30 ? 'H' : rem > 14 ? 'M' : 'S';
    return c === cur ? (c === 'M' ? 'H' : 'M') : c;
  }

  function convertProbabilityToOdd(prob, margin = HOUSE_MARGIN) {
    const p = Number(prob) || 0;
    if (p <= 0) {
      return { enabled: false, odd: 0, rawOdd: 0, probability: 0 };
    }
    const numerator = 1 - margin; // 0.94 for 6% house margin
    const rawOdd = numerator / p;
    // Always round down to 2 decimal places
    const floored = floor2(rawOdd);
    const clamped = Math.min(MAX_ODD, Math.max(MIN_ODD, floored));
    return {
      enabled: true,
      odd: clamped,
      rawOdd: r2(rawOdd),
      probability: Math.round(p * 10000) / 10000
    };
  }

  function calculateRaceOdds(race, options = {}) {
    const numSims = Math.max(100, Number(options.numSimulations) || DEFAULT_SIMULATIONS);
    const margin = options.houseMargin !== undefined ? Number(options.houseMargin) : HOUSE_MARGIN;
    const cat = getCatalog(options.catalog);
    const driversList = cat.DRIVERS || [];
    const teamPaceMap = cat.TEAM_PACE || {};
    const champD = (options.champ && options.champ.d) || {};
    const maxChampPts = Math.max(1, ...Object.values(champD).map(v => Number(v) || 0));

    const startOrder = (Array.isArray(race.start) && race.start.length)
      ? race.start.slice()
      : (Array.isArray(race.order) && race.order.length ? race.order.slice() : driversList.map(d => d.id));

    const activeGrid = startOrder.filter(id => {
      const ds = race.drv && race.drv[id];
      return !ds || (ds.st !== 'dns' && ds.st !== 'dnf');
    });

    const nDrivers = activeGrid.length;
    const circuit = race.circuit || { id: 'int', bl: 75.1, ot: 0.54, rn: 0.06, cr: 0.0014, pl: 20 };
    const totalLaps = Math.max(5, Number(race.total) || 15);
    const wxMode = race.wxMode || 'auto';
    const initWs = Number(race.ws || 0);
    const initW = Number(race.w || 0);

    // Pre-index driver properties for fast 1,000-race Monte Carlo simulation
    const drvMeta = {};
    activeGrid.forEach((id, idx) => {
      const dObj = driversList.find(x => x.id === id) || { id, team: 'CAD', skill: 0.05, ov: 0.80 };
      const tPace = teamPaceMap[dObj.team] !== undefined ? teamPaceMap[dObj.team] : 0.55;
      const formBonus = ((Number(champD[id]) || 0) / maxChampPts) * 0.04;
      const initDrv = (race.drv && race.drv[id]) || {};
      drvMeta[id] = {
        id,
        team: dObj.team,
        basePace: (circuit.bl || 75) + tPace + Number(dObj.skill ?? 0.05) - formBonus,
        skill: Number(dObj.skill ?? 0.05),
        ov: Number(dObj.ov || 0.80),
        gridIdx: idx,
        initTyre: initDrv.tyre || (initWs ? 'I' : 'M'),
        initPlan: Array.isArray(initDrv.plan) ? initDrv.plan.slice() : [Math.max(2, Math.floor(totalLaps / 2))]
      };
    });

    // Frequency counters per driver across 1,000 simulations
    const counts = {};
    startOrder.forEach(id => {
      counts[id] = { P1: 0, P2: 0, P3: 0, PODIUM: 0, TOP5: 0, TOP10: 0, DNF: 0 };
    });

    const rngState = {
      rs: hashStr(`MC_ODDS_${race.id || ''}_${circuit.id}_${totalLaps}_${wxMode}_${activeGrid.join(',')}`)
    };

    // Execute 1,000 predictive race simulations using the simulator's physics model
    const tArr = new Float64Array(nDrivers);
    const ageArr = new Int32Array(nDrivers);
    const tyreArr = new Array(nDrivers);
    const stArr = new Int8Array(nDrivers); // 1 = run, 0 = dnf
    const lapsDoneArr = new Int32Array(nDrivers);
    const pitStopLapArr = new Int32Array(nDrivers);
    const orderIdx = new Int32Array(nDrivers);

    for (let sim = 0; sim < numSims; sim++) {
      let ws = initWs;
      let w = initW;
      let scType = 0; // 0 = none, 1 = VSC, 2 = SC
      let scLeft = 0;

      for (let i = 0; i < nDrivers; i++) {
        const id = activeGrid[i];
        const m = drvMeta[id];
        tArr[i] = i * 0.28;
        ageArr[i] = 0;
        tyreArr[i] = m.initTyre;
        stArr[i] = 1;
        lapsDoneArr[i] = 0;
        pitStopLapArr[i] = m.initPlan.length ? m.initPlan[0] : Math.floor(totalLaps * 0.55);
        orderIdx[i] = i;
      }

      for (let L = 1; L <= totalLaps; L++) {
        if (scType > 0 && --scLeft <= 0) scType = 0;

        // Weather evolution
        if (wxMode !== 'dry') {
          const p = nextRng(rngState);
          let n = ws;
          if (ws === 0 && p < Math.min(0.5, (circuit.rn || 0.03) * 0.15 * (wxMode === 'rain' ? 5 : 1))) n = 1;
          else if (ws === 1) n = p < 0.08 ? 2 : p < 0.15 ? 0 : 1;
          else if (ws === 2 && p < 0.12) n = 1;
          ws = n;
        }
        const tg = ws === 0 ? 0 : ws === 1 ? 0.5 : 1.0;
        w = w + Math.max(-0.12, Math.min(0.12, tg - w));

        let trigSc = 0;
        const rem = totalLaps - L;

        for (let pos = 0; pos < nDrivers; pos++) {
          const idx = orderIdx[pos];
          if (stArr[idx] === 0) continue;

          const id = activeGrid[idx];
          const m = drvMeta[id];
          let tyre = tyreArr[idx];
          let age = ageArr[idx];
          let loss = 0;
          let pitted = false;

          if (rem >= 2) {
            const wt = (tyre === 'I' || tyre === 'W');
            let newTyre = null;
            if (!wt && w > 0.28 && nextRng(rngState) < 0.35) newTyre = w > 0.7 ? 'W' : 'I';
            else if (tyre === 'I' && w > 0.78 && nextRng(rngState) < 0.25) newTyre = 'W';
            else if (tyre === 'W' && w < 0.62 && nextRng(rngState) < 0.25) newTyre = 'I';
            else if (wt && w < 0.15 && nextRng(rngState) < 0.3) newTyre = slickForSim(rem, tyre);
            else if (!wt && (L === pitStopLapArr[idx] || age > TYRES_SIM[tyre].l + 5)) {
              newTyre = slickForSim(rem, tyre);
              pitStopLapArr[idx] = -1;
            }
            if (newTyre) {
              loss = (circuit.pl || 20) * (scType === 2 ? 0.55 : scType === 1 ? 0.65 : 1) + nextRng(rngState) * 1.5;
              tyre = newTyre;
              tyreArr[idx] = newTyre;
              age = 0;
              pitted = true;
            }
          }

          const y = TYRES_SIM[tyre] || TYRES_SIM.M;
          const wp = tyre === 'I' ? Math.abs(w - 0.5) * 5 : tyre === 'W' ? (1 - w) * 7 : w * 16;
          const lt = scType === 2
            ? (circuit.bl || 75) * 1.45
            : (m.basePace + y.p + y.d * age + Math.max(0, age - y.l) * 0.25 + wp - 0.03 * L + gaussRng(rngState) * 0.28) * (scType === 1 ? 1.3 : 1);

          const q = scType > 0 ? 0.1 : 1;
          const sw = (tyre === 'S' || tyre === 'M' || tyre === 'H') && w > 0.3;
          const crashProb = (circuit.cr || 0.0014) * (1 + m.skill * 2) * (1 + w * 1.4 + (sw ? 1.5 : 0)) * (L === 1 ? 2.2 : 1) * q;

          if (nextRng(rngState) < crashProb) {
            stArr[idx] = 0;
            lapsDoneArr[idx] = L - 1;
            if (!trigSc) trigSc = nextRng(rngState) < 0.6 ? 2 : 1;
            continue;
          } else if (nextRng(rngState) < 0.0008 * (age > 26 ? 2 : 1) * q) {
            stArr[idx] = 0;
            lapsDoneArr[idx] = L - 1;
            if (!trigSc && nextRng(rngState) < 0.4) trigSc = 1;
            continue;
          } else if (nextRng(rngState) < 0.004 * (1 + m.skill * 2) * (1 + w * 2) * q) {
            loss += 2.5 + nextRng(rngState) * 5;
          }

          tArr[idx] += lt + loss;
          ageArr[idx] = age + 1;
          lapsDoneArr[idx] = L;
        }

        if (trigSc > 0 && scType === 0) {
          scType = trigSc;
          scLeft = trigSc === 2 ? 2 : 1;
        }

        // Overtake resolution pass
        for (let pass = 0; pass < 6; pass++) {
          let swapped = false;
          for (let i = 1; i < nDrivers; i++) {
            const idxA = orderIdx[i - 1];
            const idxB = orderIdx[i];
            if (stArr[idxA] === 0 && stArr[idxB] === 1) {
              orderIdx[i - 1] = idxB;
              orderIdx[i] = idxA;
              swapped = true;
              continue;
            }
            if (stArr[idxA] === 1 && stArr[idxB] === 1 && tArr[idxB] < tArr[idxA]) {
              const dd = tArr[idxA] - tArr[idxB];
              const ovFactor = drvMeta[activeGrid[idxB]].ov / 0.85;
              const pPass = scType > 0 ? 0 : dd > 1.4 ? 1 : Math.min(0.92, Math.max(0.08, ((circuit.ot || 0.5) * 0.6 + dd * 0.25) * ovFactor * (w > 0.4 ? 1.15 : 1) * (L === 1 ? 1.4 : 1)));
              if (nextRng(rngState) < pPass) {
                orderIdx[i - 1] = idxB;
                orderIdx[i] = idxA;
                swapped = true;
              } else {
                tArr[idxB] = tArr[idxA] + 0.32;
              }
            }
          }
          if (!swapped) break;
        }

        if (scType === 2) {
          const leadT = tArr[orderIdx[0]];
          let runRank = 0;
          for (let i = 0; i < nDrivers; i++) {
            const idx = orderIdx[i];
            if (stArr[idx] === 1) {
              tArr[idx] = leadT + runRank * 0.65;
              runRank++;
            }
          }
        }
      }

      // Final classification of this simulated race
      let rank = 1;
      for (let i = 0; i < nDrivers; i++) {
        const idx = orderIdx[i];
        const id = activeGrid[idx];
        const c = counts[id];
        if (stArr[idx] === 1) {
          if (rank === 1) c.P1++;
          if (rank === 2) c.P2++;
          if (rank === 3) c.P3++;
          if (rank <= 3) c.PODIUM++;
          if (rank <= 5) c.TOP5++;
          if (rank <= 10) c.TOP10++;
          rank++;
        } else {
          c.DNF++;
        }
      }
    }

    // Build market probabilities and apply 6% house margin + anti-arbitrage protection
    const marketKeys = Object.keys(PLACEMENT_MARKETS);
    const marketTargetProbSum = {
      P1: 1.0,
      P2: 1.0,
      P3: 1.0,
      PODIUM: Math.min(3.0, nDrivers),
      TOP5: Math.min(5.0, nDrivers),
      TOP10: Math.min(10.0, nDrivers)
    };

    const driversOdds = {};
    startOrder.forEach(id => {
      driversOdds[id] = {};
    });

    marketKeys.forEach(mKey => {
      // First pass: calculate raw probabilities and initial floored odds
      let impliedReturnSum = 0; // For mutually exclusive single-winner markets (P1, P2, P3), sum(1 / odd_i) must be >= 1.0
      const tempMarket = {};

      startOrder.forEach(id => {
        const isDns = !activeGrid.includes(id);
        const hits = isDns ? 0 : (counts[id] ? counts[id][mKey] : 0);
        const prob = isDns ? 0 : hits / numSims;
        const conv = convertProbabilityToOdd(prob, margin);
        tempMarket[id] = {
          market: mKey,
          driver: id,
          hits,
          simulations: numSims,
          probability: conv.probability,
          odd: conv.odd,
          enabled: conv.enabled
        };
        if (conv.enabled && conv.odd > 0) {
          impliedReturnSum += (1 / conv.odd);
        }
      });

      // Anti-arbitrage protection (Section 5.2 & Test 31):
      //Because MAX_ODD is capped at 15.00x and odds are floored to 2 decimals with a 6% house margin (0.94 / P),
      // verify that no combination of bets across drivers in a market can ever yield a guaranteed profit.
      // For single-slot markets (P1, P2, P3), Dutching all enabled outcomes requires sum(1/odd_i) > 1.0.
      // For multi-slot K-winner markets (PODIUM K=3, TOP5 K=5, TOP10 K=10), sum(1/odd_i) must be > K.
      const maxWinnersK = marketTargetProbSum[mKey] || 1.0;
      if (impliedReturnSum > 0 && impliedReturnSum <= maxWinnersK + 0.02) {
        const scaleFactor = impliedReturnSum / (maxWinnersK * (1 + margin));
        startOrder.forEach(id => {
          const item = tempMarket[id];
          if (item.enabled) {
            item.odd = Math.max(MIN_ODD, Math.min(MAX_ODD, floor2(item.odd * scaleFactor)));
          }
        });
      }

      startOrder.forEach(id => {
        driversOdds[id][mKey] = tempMarket[id];
      });
    });

    // Also enforce hierarchical consistency per driver:
    // P(P1) <= P(PODIUM) <= P(TOP5) <= P(TOP10), so Odd(P1) >= Odd(PODIUM) >= Odd(TOP5) >= Odd(TOP10)
    startOrder.forEach(id => {
      const d = driversOdds[id];
      if (d.P1.enabled && d.PODIUM.enabled && d.PODIUM.odd > d.P1.odd) {
        d.PODIUM.odd = d.P1.odd;
      }
      if (d.PODIUM.enabled && d.TOP5.enabled && d.TOP5.odd > d.PODIUM.odd) {
        d.TOP5.odd = d.PODIUM.odd;
      }
      if (d.TOP5.enabled && d.TOP10.enabled && d.TOP10.odd > d.TOP5.odd) {
        d.TOP10.odd = d.TOP5.odd;
      }
    });

    return {
      modelVersion: MODEL_VERSION,
      houseMargin: margin,
      simulations: numSims,
      calculatedAt: Date.now(),
      raceId: race.id,
      drivers: driversOdds
    };
  }

  /**
   * 6. PAGAMENTO DAS APOSTAS DE COLOCAÇÃO
   * Retorno total = Valor apostado * Odd confirmada
   * Lucro líquido = Retorno total - Valor apostado
   */
  function calculatePlacementPayout(stake, confirmedOdd, won, isVoid = false) {
    const S = r2(Math.max(0, Number(stake) || 0));
    const odd = floor2(Math.max(MIN_ODD, Math.min(MAX_ODD, Number(confirmedOdd) || MIN_ODD)));

    if (isVoid) {
      return {
        status: 'VOID',
        won: false,
        voided: true,
        totalReturn: S,
        netProfit: 0
      };
    }

    if (!won || S <= 0) {
      return {
        status: 'LOST',
        won: false,
        voided: false,
        totalReturn: 0,
        netProfit: r2(-S)
      };
    }

    const totalReturn = r2(S * odd);
    const netProfit = r2(totalReturn - S);
    return {
      status: 'WON',
      won: true,
      voided: false,
      totalReturn,
      netProfit
    };
  }

  /**
   * 1. REGRA DE EXPOSIÇÃO (10% DO SALDO INICIAL NA CORRIDA)
   * Calcula ou recupera o registro de exposição do jogador para a corrida atual.
   * O limite é 10% do saldo total do jogador antes da primeira aposta naquela corrida
   * e não pode ser reiniciado ao abrir outra aba ou atualizar a página.
   */
  function getOrInitRaceExposure(race, playerId, currentAvailableBalance) {
    if (!race || !playerId) {
      const bal = r2(Math.max(0, Number(currentAvailableBalance) || 0));
      const lim = r2(bal * EXPOSURE_RATE);
      return {
        initialBalance: bal,
        maxExposure: lim,
        committedOvertake: 0,
        committedPlacement: 0,
        totalCommitted: 0,
        remainingExposure: lim
      };
    }

    race.exposures = race.exposures || {};
    const activePlayerBets = (Array.isArray(race.bets) ? race.bets : []).filter(
      b => b && b.pid === playerId && !b.cancelled && b.status !== 'VOID'
    );

    let committedOvertake = 0;
    let committedPlacement = 0;
    activePlayerBets.forEach(b => {
      const amt = r2(Number(b.amount) || 0);
      if (b.modality === 'placement') committedPlacement = r2(committedPlacement + amt);
      else committedOvertake = r2(committedOvertake + amt);
    });
    const totalCommitted = r2(committedOvertake + committedPlacement);

    let rec = race.exposures[playerId];
    if (!rec || typeof rec.initialBalance !== 'number' || typeof rec.maxExposure !== 'number') {
      // Reconstruct initial balance at the start of the race (available + already committed in this race)
      const initialBal = r2(Math.max(0, Number(currentAvailableBalance) || 0) + totalCommitted);
      const maxExp = r2(initialBal * EXPOSURE_RATE);
      rec = {
        playerId,
        raceId: race.id,
        initialBalance: initialBal,
        maxExposure: maxExp,
        lockedAt: Date.now()
      };
      race.exposures[playerId] = rec;
    }

    const remainingExposure = r2(Math.max(0, rec.maxExposure - totalCommitted));
    return {
      initialBalance: rec.initialBalance,
      maxExposure: rec.maxExposure,
      committedOvertake,
      committedPlacement,
      totalCommitted,
      remainingExposure
    };
  }

  /**
   * Valida uma nova aposta contra todas as regras financeiras (Modalidade, Janela, Saldo e Exposição de 10%)
   */
  function validateBetRequest({ race, player, modality, driverId, market, amount, catalog, champ }) {
    if (!race) return { ok: false, code: 'NO_RACE', error: 'Nenhuma corrida preparada.' };
    if (race.done || race.settled || race.cancelled) {
      return { ok: false, code: 'RACE_FINISHED', error: 'A corrida já foi encerrada ou cancelada.' };
    }
    if (race.running || !race.bettingOpen) {
      return { ok: false, code: 'WINDOW_CLOSED', error: 'A janela de apostas está encerrada.' };
    }
    if (!player || !player.id) {
      return { ok: false, code: 'INVALID_PLAYER', error: 'Jogador inválido.' };
    }

    const mod = (modality === 'placement') ? 'placement' : 'overtake';
    // Regra Seção 4: Apostas de colocação final DEVEM ser encerradas antes da largada
    if (mod === 'placement' && (race.started || Number(race.lap || 0) > 0)) {
      return {
        ok: false,
        code: 'PLACEMENT_CLOSED_AFTER_START',
        error: 'Apostas de colocação final só são permitidas antes da largada!'
      };
    }

    const validOrder = Array.isArray(race.order) && race.order.length ? race.order : (race.start || []);
    if (!driverId || !validOrder.includes(driverId)) {
      return { ok: false, code: 'INVALID_DRIVER', error: 'Selecione um piloto válido no grid.' };
    }

    const drvState = race.drv && race.drv[driverId];
    if (drvState && (drvState.st === 'dnf' || drvState.st === 'dns')) {
      return { ok: false, code: 'DRIVER_OUT', error: 'Este piloto não está ativo na corrida.' };
    }

    const stake = r2(Number(amount) || 0);
    if (!stake || stake <= 0 || isNaN(stake)) {
      return { ok: false, code: 'INVALID_AMOUNT', error: 'Informe um valor de aposta maior que zero.' };
    }

    const availableChips = r2(Number(player.chips) || 0);
    if (stake > availableChips) {
      return {
        ok: false,
        code: 'INSUFFICIENT_BALANCE',
        error: `Saldo disponível insuficiente (${availableChips.toFixed(2)} fichas).`
      };
    }

    // Lock / check 50% exposure rule
    const exp = getOrInitRaceExposure(race, player.id, availableChips);
    if (r2(exp.totalCommitted + stake) > r2(exp.maxExposure + 1e-6)) {
      return {
        ok: false,
        code: 'EXPOSURE_LIMIT_EXCEEDED',
        error: `Limite de exposição de 50% excedido! Limite na corrida: ${exp.maxExposure.toFixed(2)} fichas (Já comprometido: ${exp.totalCommitted.toFixed(2)} · Disponível no limite: ${exp.remainingExposure.toFixed(2)}).`,
        exposure: exp
      };
    }

    if (mod === 'placement') {
      const mObj = PLACEMENT_MARKETS[market];
      if (!mObj) {
        return { ok: false, code: 'INVALID_MARKET', error: 'Mercado de colocação inválido.' };
      }
      if (!race.oddsBook || !race.oddsBook.drivers || !race.oddsBook.drivers[driverId]) {
        race.oddsBook = calculateRaceOdds(race, { catalog, champ });
      }
      const mOddInfo = race.oddsBook.drivers[driverId] && race.oddsBook.drivers[driverId][market];
      if (!mOddInfo || !mOddInfo.enabled || mOddInfo.probability <= 0 || mOddInfo.odd < MIN_ODD) {
        return {
          ok: false,
          code: 'MARKET_DISABLED_ZERO_PROB',
          error: 'Este mercado está desabilitado para o piloto selecionado (probabilidade zero).'
        };
      }

      return {
        ok: true,
        modality: 'placement',
        stake,
        exposure: exp,
        market: mObj.id,
        marketLabel: mObj.label,
        odd: mOddInfo.odd,
        probability: mOddInfo.probability,
        modelVersion: race.oddsBook.modelVersion || MODEL_VERSION
      };
    }

    // Modality 1: Overtake
    const lapMult = getLapMultiplier(race.lap || 0);
    const expectedOv = calculateExpectedOvertakes(race, driverId, catalog, champ);

    return {
      ok: true,
      modality: 'overtake',
      stake,
      exposure: exp,
      mult: lapMult,
      expectedOvertakes: expectedOv,
      factorF: OVERTAKE_FACTOR_F,
      modelVersion: MODEL_VERSION
    };
  }

  /**
   * 11. LIQUIDAÇÃO E RESULTADO FINAL DA CORRIDA (E SITUAÇÕES EXCEPCIONAIS - SEÇÃO 9)
   * Liquida cada bilhete uma única vez, gerando um settlementId único.
   */
  function evaluateTicketForRace(race, bet) {
    if (!race || !bet) return null;
    if (bet.cancelled) {
      return {
        betId: bet.id,
        status: 'CANCELLED',
        won: false,
        voided: false,
        ret: 0,
        net: 0
      };
    }

    // Situação Excepcional 1: Corrida cancelada antes da largada -> VOID e reembolso integral
    if (race.cancelled && !race.started) {
      return {
        betId: bet.id,
        modality: bet.modality || 'overtake',
        status: 'VOID',
        reason: 'RACE_CANCELLED_BEFORE_START',
        won: false,
        voided: true,
        ret: r2(bet.amount),
        net: 0
      };
    }

    const drvState = race.drv && race.drv[bet.driver];
    const isDns = drvState && (drvState.st === 'dns' || drvState.dns === true);
    const isDnf = drvState && drvState.st === 'dnf';
    const finalOrder = Array.isArray(race.officialOrder) && race.officialOrder.length
      ? race.officialOrder
      : (race.order || []);
    const finalPos = finalOrder.indexOf(bet.driver) + 1;

    // Situação Excepcional 3: Piloto não largou (DNS) -> Anular (VOID) e devolver apostas daquele piloto
    if (isDns) {
      return {
        betId: bet.id,
        modality: bet.modality || 'overtake',
        status: 'VOID',
        reason: 'DRIVER_DNS',
        won: false,
        voided: true,
        fin: finalPos,
        isDns: true,
        isDnf: false,
        ret: r2(bet.amount),
        net: 0
      };
    }

    // Modalidade 2: Colocação Final
    if (bet.modality === 'placement') {
      const mObj = PLACEMENT_MARKETS[bet.market];
      // Nota Seção 9: Pilotos que abandonarem depois da largada utilizam a classificação final registrada,
      // porém em mercados de topo (1º, 2º, 3º, Pódio, Top 5, Top 10) verificamos a posição oficial final.
      // Se o resultado oficial colocar o piloto na posição do mercado (e tiver resultado válido), liquida:
      const validResult = finalPos > 0;
      let won = false;
      if (validResult && mObj) {
        // An abandoned driver after start uses the final classification effectively registered by the simulator
        if (mObj.id === 'P1') won = (finalPos === 1 && !isDnf);
        else if (mObj.id === 'P2') won = (finalPos === 2 && !isDnf);
        else if (mObj.id === 'P3') won = (finalPos === 3 && !isDnf);
        else if (mObj.id === 'PODIUM') won = (finalPos >= 1 && finalPos <= 3 && !isDnf);
        else if (mObj.id === 'TOP5') won = (finalPos >= 1 && finalPos <= 5 && (!isDnf || drvState.classified !== false));
        else if (mObj.id === 'TOP10') won = (finalPos >= 1 && finalPos <= 10 && (!isDnf || drvState.classified !== false));
      }
      // Note: if a driver retired (DNF) and did not complete the race, in standard F1 simulator classification
      // DNFs are placed at the back unless classified; if isDnf is true and not explicitly classified in top position:
      if (isDnf && !drvState.classifiedInPoints) {
        won = false;
      }

      const payout = calculatePlacementPayout(bet.amount, bet.odd, won, false);
      return {
        betId: bet.id,
        modality: 'placement',
        market: bet.market,
        odd: bet.odd,
        probability: bet.probability,
        status: payout.status,
        won: payout.won,
        voided: false,
        fin: finalPos,
        isDnf: !!isDnf,
        ret: payout.totalReturn,
        net: payout.netProfit
      };
    }

    // Modalidade 1: Ultrapassagens
    // Compatibilidade com apostas antigas (Seção 12): se a aposta foi criada no modelo legado (sem expectedOvertakes)
    if (bet.legacyModel === true || (bet.expectedOvertakes === undefined && bet.modality === undefined)) {
      let baseFactor = 0;
      if (!isDnf && finalPos === 1) baseFactor = 3.0;
      else if (!isDnf && finalPos === 2) baseFactor = 2.0;
      else if (!isDnf && finalPos === 3) baseFactor = 1.5;
      const gained = Math.max(0, (bet.startPos || finalPos) - finalPos);
      const gainFactor = (!isDnf && gained > 0) ? (1.0 + gained * 0.45) : 0;
      const bestFactor = Math.max(baseFactor, gainFactor);
      const ret = bestFactor > 0 ? r2(bet.amount * bestFactor * (bet.mult || 1)) : 0;
      const net = r2(ret - bet.amount);
      return {
        betId: bet.id,
        modality: 'legacy',
        status: net > 0 ? 'WON' : 'LOST',
        won: net > 0,
        voided: false,
        fin: finalPos,
        isDnf: !!isDnf,
        ret,
        net
      };
    }

    const ovCountInfo = countValidOvertakesForBet(race, bet);
    const actualOvertakes = typeof bet.actualOvertakesOverride === 'number'
      ? bet.actualOvertakesOverride
      : ovCountInfo.count;
    const expectedOvertakes = Number(bet.expectedOvertakes || 0);
    const multVal = Number(bet.mult || 1.0);
    const factorF = Number(bet.factorF || OVERTAKE_FACTOR_F);

    const payout = calculateOvertakePayout(bet.amount, actualOvertakes, expectedOvertakes, multVal, factorF);

    return {
      betId: bet.id,
      modality: 'overtake',
      status: payout.won ? 'WON' : 'LOST',
      won: payout.won,
      voided: false,
      fin: finalPos,
      isDnf: !!isDnf,
      actualOvertakes,
      expectedOvertakes,
      excessOvertakes: payout.excessOvertakes,
      mult: multVal,
      factorF,
      capped: payout.capped,
      overtakeEventIds: ovCountInfo.eventIds,
      ret: payout.totalReturn,
      net: payout.netProfit
    };
  }

  return {
    MODEL_VERSION,
    EXPOSURE_RATE,
    OVERTAKE_FACTOR_F,
    MAX_OVERTAKE_RETURN_MULT,
    HOUSE_MARGIN,
    MIN_ODD,
    MAX_ODD,
    DEFAULT_SIMULATIONS,
    PLACEMENT_MARKETS,
    r2,
    floor2,
    hashStr,
    getLapMultiplier,
    calculateExpectedOvertakes,
    calculateOvertakePayout,
    countValidOvertakesForBet,
    convertProbabilityToOdd,
    calculateRaceOdds,
    calculatePlacementPayout,
    getOrInitRaceExposure,
    validateBetRequest,
    evaluateTicketForRace
  };
});
