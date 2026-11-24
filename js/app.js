/**
 * F1 Betting Simulator 3D · Full-Stack Multiplayer, Admin Panel, Betting & Cashbox Application
 */
(function () {
  const { TEAMS, DRIVERS, TEAM_PACE, AVATARS, CIRCUITS } = window.F1Tracks;
  const FIN = window.F1Finance;
  const MP = window.F1Multiplayer;
  const SIM3D = window.F1Sim3D;

  const MAX_BET_AMOUNT = 10000;
  const MIN_RACE_LAPS = 5;
  const MAX_RACE_LAPS = 90;
  const MIN_PLAYERS_TO_START = 2;
  const LAP_DURATION_MS = 30000; // 30 seconds per lap
  const INITIAL_CHIPS = 100;     // Saldo inicial de todos os jogadores: 100 fichas

  const ACCOUNTS_STORAGE_KEY = 'f1bs_accounts_v2';
  const LAST_ACCOUNT_KEY = 'f1bs_last_account_id_v2';
  const TAB_ACCOUNT_KEY = 'f1bs_tab_account_id_v2';
  const GLOBAL_HISTORY_KEY = 'f1bs_history_v2';
  const ACTIVE_ROOM_KEY = 'f1bs_active_room_code_v2';
  const ADMIN_TOKEN_KEY = 'f1bs_admin_token_v2';

  const TYRES = {
    S: { p: -0.5, d: 0.07, l: 14, name: 'Macio (S)' },
    M: { p:  0.0, d: 0.04, l: 24, name: 'Médio (M)' },
    H: { p:  0.4, d: 0.025, l: 36, name: 'Duro (H)' },
    I: { p:  0.0, d: 0.03, l: 30, name: 'Intermediário (I)' },
    W: { p:  0.0, d: 0.02, l: 40, name: 'Chuva (W)' }
  };

  const S = {
    view: 'home',
    profileModalOpen: false,
    profileDraftName: '',
    profileDraftAvatar: 'av1',
    user: null, // Persistent player profile { id, name, avatarId, chips, balanceVersion, wins, losses, raceExposures, cashbox, settledBets }
    room: null, // Synchronized room { code, hostId, creatorId, circuitId, laps, wxMode, grid, players, race }
    betTab: 'overtake',       // 'overtake' | 'placement'
    selectedBetDriver: 'VER',
    selectedBetMarket: 'P1',  // 'P1' | 'P2' | 'P3' | 'PODIUM' | 'TOP5' | 'TOP10'
    betAmountInput: 10,
    betInFlight: false,       // Mutex against simultaneous double-click / concurrent bet requests
    highlightedDriver: null,
    spectator: false,
    history: [],
    champ: { d: {}, t: {}, n: 0 },
    connStatus: { backend: false, webrtc: false, ws: false, local: true },
    hostTickTimer: null,
    presenceTimer: null,
    // Admin Panel State
    admin: {
      token: null,
      authenticated: false,
      loginName: '',
      players: [],
      loading: false,
      searchQuery: ''
    },
    // Anti-flicker render signatures
    _lastEventsSig: '',
    _lastTowerSig: '',
    _lastBetsSig: '',
    _lastBetDriverOrderSig: '',
    _lastRoomPlayersSig: ''
  };

  const $ = (sel) => document.querySelector(sel);
  const dv = (id) => DRIVERS.find(d => d.id === id) || DRIVERS[0];
  const avObj = (avId) => AVATARS.find(a => a.id === avId) || AVATARS[0];
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => Number((+n || 0).toFixed(2)).toLocaleString('pt-BR');
  const r2 = (n) => Math.round((+n || 0) * 100) / 100;
  const vm = (m) => String(m).replace('.', ',') + 'x';

  function toast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = 'toast';
    if (type === 'ok') t.style.background = 'linear-gradient(135deg, #2ecc71, #1e8449)';
    if (type === 'gold') {
      t.style.background = 'linear-gradient(135deg, #ffc83d, #d68910)';
      t.style.color = '#000';
    }
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2800);
  }

  /* =====================================================================
   * 1. PERSISTENT PROFILE, LOGIN, SERVER BALANCE SYNC & CASHBOX
   * ===================================================================== */
  function loadAccountsMap() {
    try {
      return JSON.parse(localStorage.getItem(ACCOUNTS_STORAGE_KEY) || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function saveAccountsMap(map) {
    try {
      localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(map));
    } catch (e) {}
  }

  function createDefaultAccount(name = 'Piloto 1', avatarId = 'av1', customId = null) {
    const id = customId || ('usr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7));
    return {
      id,
      name: name.trim() || 'Piloto',
      avatarId: avatarId || 'av1',
      chips: INITIAL_CHIPS,
      balanceVersion: 1,
      initial100Applied: true,
      wins: 0,
      settledBets: {},
      cashbox: {
        totalBet: 0,
        totalWon: 0,
        totalLost: 0,
        netProfit: 0,
        betHistory: [],
        financialHistory: []
      }
    };
  }

  function ensureAccountIntegrity(acc) {
    if (!acc.cashbox) {
      acc.cashbox = { totalBet: 0, totalWon: 0, totalLost: 0, netProfit: 0, betHistory: [], financialHistory: [] };
    }
    acc.cashbox.totalBet = r2(acc.cashbox.totalBet || 0);
    acc.cashbox.totalWon = r2(acc.cashbox.totalWon || 0);
    acc.cashbox.totalLost = r2(acc.cashbox.totalLost || 0);
    acc.cashbox.netProfit = r2(acc.cashbox.totalWon - acc.cashbox.totalLost);
    acc.cashbox.betHistory = acc.cashbox.betHistory || [];
    acc.cashbox.financialHistory = acc.cashbox.financialHistory || [];
    acc.settledBets = acc.settledBets || {};
    acc.raceExposures = acc.raceExposures || {};
    acc.losses = Number(acc.losses || 0);
    acc.committedChips = r2(acc.committedChips || 0);
    acc.avatarId = acc.avatarId || 'av1';
    acc.balanceVersion = Number(acc.balanceVersion || 1);

    // Migrate accounts that had the previous 25.000 default initial balance to 100
    if (!acc.initial100Applied) {
      acc.initial100Applied = true;
      if (acc.chips === 25000 && acc.cashbox.betHistory.length === 0) {
        acc.chips = INITIAL_CHIPS;
        acc.balanceVersion += 1;
      }
    }
    if (typeof acc.chips !== 'number' || isNaN(acc.chips) || acc.chips < 0) {
      acc.chips = Math.max(0, Number(acc.chips) || INITIAL_CHIPS);
    }
    acc.totalBalance = r2(acc.chips + acc.committedChips);
    return acc;
  }

  function saveCurrentUser(setAsDefaultLast = true, syncServer = true) {
    if (!S.user) return;
    ensureAccountIntegrity(S.user);
    const map = loadAccountsMap();
    map[S.user.id] = S.user;
    saveAccountsMap(map);
    try {
      sessionStorage.setItem(TAB_ACCOUNT_KEY, S.user.id);
      if (setAsDefaultLast) {
        localStorage.setItem(LAST_ACCOUNT_KEY, S.user.id);
      }
    } catch (e) {}
    if (syncServer) {
      syncPlayerWithBackend(S.user);
    }
  }

  async function syncPlayerWithBackend(userObj) {
    if (!userObj || location.protocol === 'file:') return;
    try {
      const res = await fetch('/api/player/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player: {
            id: userObj.id,
            name: userObj.name,
            avatarId: userObj.avatarId,
            chips: userObj.chips,
            wins: userObj.wins || 0,
            balanceVersion: userObj.balanceVersion || 1
          }
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.ok && data.player) {
          applyAuthoritativeServerPlayerRecord(data.player);
        }
      }
    } catch (e) {}
  }

  function applyAuthoritativeServerPlayerRecord(srvRec) {
    if (!srvRec || !S.user || srvRec.id !== S.user.id) return;
    const srvVer = Number(srvRec.balanceVersion || 1);
    const myVer = Number(S.user.balanceVersion || 1);
    if (srvVer > myVer) {
      const diff = r2(srvRec.chips - S.user.chips);
      S.user.chips = r2(srvRec.chips);
      S.user.balanceVersion = srvVer;
      if (srvRec.lastAdminOp && srvRec.lastAdminOp.id) {
        recordFinancialTx(
          'tx_' + srvRec.lastAdminOp.id,
          diff >= 0 ? 'RACE_WIN' : 'RACE_LOSS',
          'Ajuste Administrativo de Saldo',
          srvRec.lastAdminOp.label || 'Alteração realizada pelo Administrador',
          diff
        );
      }
      saveCurrentUser(true, false);
      const balanceEl = $('#header-balance-val');
      if (balanceEl) balanceEl.textContent = fmt(S.user.chips);
      if (S.view === 'wallet' || S.view === 'home' || S.view === 'admin') {
        render();
      } else {
        updateHeaderAndRoomDOM();
      }
    }
  }

  // Listen to authoritative balance updates piggybacked on multiplayer polling
  MP.onServerMeUpdate = (meRec) => {
    applyAuthoritativeServerPlayerRecord(meRec);
  };

  function initUserAuth() {
    const map = loadAccountsMap();
    let tabAccId = null;
    let lastAccId = null;
    try {
      tabAccId = sessionStorage.getItem(TAB_ACCOUNT_KEY);
      lastAccId = localStorage.getItem(LAST_ACCOUNT_KEY);
    } catch (e) {}

    // Migrate any existing local accounts with untouched 25000 chips to 100
    let mapChanged = false;
    Object.values(map).forEach(acc => {
      const prevChips = acc.chips;
      ensureAccountIntegrity(acc);
      if (acc.chips !== prevChips) mapChanged = true;
    });
    if (mapChanged) saveAccountsMap(map);

    const urlParams = new URLSearchParams(window.location.search);
    const forceNewPlayer = urlParams.get('newplayer') === '1';

    if (!forceNewPlayer && tabAccId && map[tabAccId]) {
      S.user = ensureAccountIntegrity(map[tabAccId]);
    } else if (!forceNewPlayer && lastAccId && map[lastAccId]) {
      S.user = ensureAccountIntegrity(map[lastAccId]);
      try { sessionStorage.setItem(TAB_ACCOUNT_KEY, S.user.id); } catch (e) {}
    } else {
      const existingIds = Object.keys(map);
      if (!forceNewPlayer && existingIds.length > 0) {
        S.user = ensureAccountIntegrity(map[existingIds[0]]);
        saveCurrentUser(true, false);
      } else {
        const num = existingIds.length + 1;
        const defAv = AVATARS[(num - 1) % AVATARS.length].id;
        S.user = createDefaultAccount(`Piloto ${num}`, defAv);
        saveCurrentUser(!forceNewPlayer, false);
      }
    }

    S.profileDraftName = S.user.name;
    S.profileDraftAvatar = S.user.avatarId;

    // Register / sync all local accounts with backend so Admin can see all registered players
    Object.values(loadAccountsMap()).forEach(acc => {
      syncPlayerWithBackend(acc);
    });

    // Restore admin token if saved in sessionStorage
    try {
      const savedToken = sessionStorage.getItem(ADMIN_TOKEN_KEY);
      if (savedToken) {
        S.admin.token = savedToken;
        fetchAdminPlayers(true);
      }
    } catch (e) {}

    try {
      const gh = JSON.parse(localStorage.getItem(GLOBAL_HISTORY_KEY) || 'null');
      if (gh) {
        S.history = gh.history || [];
        S.champ = gh.champ || { d: {}, t: {}, n: 0 };
      }
    } catch (e) {}
  }

  function saveGlobalHistory() {
    try {
      localStorage.setItem(GLOBAL_HISTORY_KEY, JSON.stringify({
        history: S.history.slice(0, 40),
        champ: S.champ
      }));
    } catch (e) {}
  }

  function recordFinancialTx(txId, type, title, detail, signedAmount) {
    if (!S.user) return false;
    ensureAccountIntegrity(S.user);
    if (S.user.cashbox.financialHistory.some(x => x.txId === txId)) {
      return false;
    }
    S.user.cashbox.financialHistory.unshift({
      txId,
      type,
      title,
      detail,
      amount: r2(signedAmount),
      balanceAfter: r2(S.user.chips),
      date: new Date().toLocaleString('pt-BR')
    });
    if (S.user.cashbox.financialHistory.length > 100) {
      S.user.cashbox.financialHistory.length = 100;
    }
    return true;
  }

  function updateProfile(name, avatarId) {
    const clean = (name || '').trim();
    if (!clean) return toast('Digite um nome de login válido');
    const map = loadAccountsMap();

    const existingByName = Object.values(map).find(
      a => a.name.toLowerCase() === clean.toLowerCase() && a.id !== S.user.id
    );

    if (existingByName) {
      S.user = ensureAccountIntegrity(existingByName);
      if (avatarId) S.user.avatarId = avatarId;
    } else {
      S.user.name = clean;
      S.user.avatarId = avatarId || S.user.avatarId;
    }

    saveCurrentUser(true, true);
    S.profileModalOpen = false;

    if (S.room) {
      syncMyPlayerInRoom();
    }
    toast(`Perfil salvo: ${S.user.name}`, 'ok');
    render();
  }

  function createOrSwitchAccount(accId) {
    const map = loadAccountsMap();
    if (accId === 'NEW') {
      const count = Object.keys(map).length + 1;
      const av = AVATARS[(count - 1) % AVATARS.length].id;
      const newAcc = createDefaultAccount(`Piloto ${count}`, av);
      map[newAcc.id] = newAcc;
      saveAccountsMap(map);
      S.user = newAcc;
      saveCurrentUser(true, true);
    } else if (map[accId]) {
      S.user = ensureAccountIntegrity(map[accId]);
      saveCurrentUser(true, true);
    }
    S.profileDraftName = S.user.name;
    S.profileDraftAvatar = S.user.avatarId;
    S.profileModalOpen = false;
    if (S.room) {
      syncMyPlayerInRoom();
    }
    toast(`Conectado como ${S.user.name}`, 'ok');
    render();
  }

  /* =====================================================================
   * 2. ADMINISTRATOR PANEL (SERVER-VALIDATED AUTH & BALANCE CONTROLS)
   * ===================================================================== */
  /**
   * Helper to perform Admin API requests with graceful fallback
   * when running on static hosts (like GitHub Pages) where Python/Node backend is not running.
   */
  const FALLBACK_ADMIN_USER = 'LN';
  const FALLBACK_ADMIN_PASS = 'jairo';

  function getLocalPlayersForAdmin() {
    const map = loadAccountsMap();
    const list = Object.values(map).map(p => ({
      id: p.id,
      name: p.name,
      avatarId: p.avatarId,
      chips: r2(p.chips || 0),
      balanceVersion: p.balanceVersion || 1,
      lastSeen: p.lastSeen || Date.now()
    }));

    // Sincronizar todos os jogadores da sala multiplayer ativa atual
    if (S.room && Array.isArray(S.room.players)) {
      for (const rp of S.room.players) {
        const found = list.find(x => x.id === rp.id);
        if (found) {
          found.chips = r2(rp.chips);
          found.name = rp.name;
        } else {
          list.push({
            id: rp.id,
            name: rp.name,
            avatarId: rp.avatarId,
            chips: r2(rp.chips || 0),
            balanceVersion: rp.balanceVersion || 1,
            lastSeen: Date.now()
          });
        }
      }
    }

    if (S.user && !list.find(x => x.id === S.user.id)) {
      list.push({
        id: S.user.id,
        name: S.user.name,
        avatarId: S.user.avatarId,
        chips: r2(S.user.chips || 0),
        balanceVersion: S.user.balanceVersion || 1,
        lastSeen: Date.now()
      });
    }
    return list;
  }

  async function adminLogin(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    const loginEl = $('#admin-login-input');
    const passEl = $('#admin-pass-input');
    const login = (loginEl ? loginEl.value : '').trim();
    const password = (passEl ? passEl.value : '').trim();

    if (!login || !password) {
      return toast('Preencha o login e a senha de administrador.');
    }

    // 1. Verificação direta (case-insensitive para login "LN", "ln", "Ln")
    const isLocalAdmin = (login.toLowerCase() === FALLBACK_ADMIN_USER.toLowerCase() && password === FALLBACK_ADMIN_PASS);

    // 2. Se for o administrador autorizado, autentica imediatamente
    if (isLocalAdmin) {
      const localToken = 'admin-token-gh-' + Date.now();
      S.admin.token = localToken;
      S.admin.authenticated = true;
      S.admin.loginName = FALLBACK_ADMIN_USER;
      S.admin.players = getLocalPlayersForAdmin();
      try { sessionStorage.setItem(ADMIN_TOKEN_KEY, localToken); } catch (e) {}
      toast(`Painel Administrativo autenticado (${FALLBACK_ADMIN_USER})!`, 'ok');
      render();

      // Também avisa o servidor em segundo plano (se estiver rodando)
      try {
        fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login, password })
        }).then(r => r.json()).then(data => {
          if (data && data.ok && data.token) {
            S.admin.token = data.token;
            if (data.players && data.players.length) {
              S.admin.players = data.players;
              if (S.view === 'admin') render();
            }
          }
        }).catch(() => {});
      } catch (e) {}
      return;
    }

    // 3. Tentar servidor backend se outro usuário/token estiver configurado no servidor
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ok) {
          S.admin.token = data.token;
          S.admin.authenticated = true;
          S.admin.loginName = data.admin || login;
          S.admin.players = data.players || [];
          try { sessionStorage.setItem(ADMIN_TOKEN_KEY, data.token); } catch (e) {}
          toast(`Painel Administrativo autenticado (${S.admin.loginName})!`, 'ok');
          render();
          return;
        }
      }
    } catch (e) {}

    return toast('Credenciais de administrador inválidas. (Use login: LN / senha: jairo)');
  }

  async function adminLogout() {
    const token = S.admin.token;
    S.admin.token = null;
    S.admin.authenticated = false;
    S.admin.players = [];
    try { sessionStorage.removeItem(ADMIN_TOKEN_KEY); } catch (e) {}

    if (token && !token.startsWith('admin-token-gh-')) {
      try {
        await fetch('/api/admin/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ token })
        });
      } catch (e) {}
    }
    toast('Sessão administrativa encerrada.');
    render();
  }

  async function fetchAdminPlayers(silent = false) {
    if (!S.admin.token) return;

    if (S.admin.token.startsWith('admin-token-gh-')) {
      S.admin.authenticated = true;
      S.admin.players = getLocalPlayersForAdmin();
      if (S.view === 'admin') render();
      return;
    }

    try {
      const res = await fetch('/api/admin/players', {
        headers: { 'Authorization': 'Bearer ' + S.admin.token },
        cache: 'no-store'
      });
      if (res.status === 401) {
        S.admin.token = null;
        S.admin.authenticated = false;
        try { sessionStorage.removeItem(ADMIN_TOKEN_KEY); } catch (e) {}
        if (!silent) render();
        return;
      }
      const data = await res.json();
      if (res.ok && data.ok) {
        S.admin.authenticated = true;
        S.admin.players = data.players || [];
        if (S.view === 'admin') render();
      }
    } catch (e) {
      // Fallback to local accounts list
      S.admin.players = getLocalPlayersForAdmin();
      if (S.view === 'admin') render();
    }
  }

  async function adminModifyBalance(playerId, operation) {
    if (!S.admin.authenticated || !S.admin.token) {
      return toast('Acesso negado: faça login como administrador.');
    }
    const inputEl = document.getElementById(`adm-amt-${playerId}`);
    const amount = r2(+(inputEl ? inputEl.value : 0));

    if (isNaN(amount) || amount < 0 || (operation !== 'set' && amount <= 0)) {
      return toast('Informe um valor numérico válido para a operação.');
    }

    // Try server update first if not purely offline token
    let serverDone = false;
    if (!S.admin.token.startsWith('admin-token-gh-')) {
      try {
        const res = await fetch('/api/admin/balance', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + S.admin.token
          },
          body: JSON.stringify({
            token: S.admin.token,
            playerId,
            operation,
            amount
          })
        });

        if (res.ok) {
          const data = await res.json();
          if (data.ok) {
            serverDone = true;
            S.admin.players = data.players || S.admin.players;
            const updatedPlayer = data.player;
            if (updatedPlayer) {
              const map = loadAccountsMap();
              if (map[updatedPlayer.id]) {
                map[updatedPlayer.id].chips = r2(updatedPlayer.chips);
                map[updatedPlayer.id].balanceVersion = updatedPlayer.balanceVersion;
                saveAccountsMap(map);
              }
              if (S.user && S.user.id === updatedPlayer.id) {
                applyAuthoritativeServerPlayerRecord(updatedPlayer);
              }
              if (S.room && Array.isArray(S.room.players)) {
                const rp = S.room.players.find(p => p.id === updatedPlayer.id);
                if (rp) {
                  rp.chips = r2(updatedPlayer.chips);
                  rp.balanceVersion = updatedPlayer.balanceVersion;
                }
              }
            }
            const opNames = { add: 'adicionado a', remove: 'removido de', set: 'definido para' };
            toast(`✓ Saldo ${opNames[operation] || 'atualizado:'} ${updatedPlayer ? updatedPlayer.name : playerId} → ${fmt(updatedPlayer.chips)} 🪙`, 'gold');
            render();
            return;
          }
        }
      } catch (e) {
        // Fallback to local mutation below
      }
    }

    // Local Mutation Fallback (GitHub Pages & Peer sync)
    const map = loadAccountsMap();
    let target = map[playerId] || (S.user && S.user.id === playerId ? S.user : null);
    if (!target) {
      // Find in S.admin.players
      const ap = S.admin.players.find(p => p.id === playerId);
      if (ap) {
        target = { id: ap.id, name: ap.name, avatarId: ap.avatarId, chips: ap.chips, balanceVersion: 1 };
        map[playerId] = target;
      }
    }

    if (!target) return toast('Jogador não encontrado.');

    let newChips = target.chips || 0;
    if (operation === 'add') newChips += amount;
    else if (operation === 'remove') newChips = Math.max(0, newChips - amount);
    else if (operation === 'set') newChips = Math.max(0, amount);

    target.chips = r2(newChips);
    target.balanceVersion = (target.balanceVersion || 1) + 1;
    saveAccountsMap(map);

    if (S.user && S.user.id === playerId) {
      S.user.chips = target.chips;
      S.user.balanceVersion = target.balanceVersion;
      saveCurrentUser(true, false);
      const balanceEl = $('#header-balance-val');
      if (balanceEl) balanceEl.textContent = fmt(S.user.chips);
    }

    if (S.room && Array.isArray(S.room.players)) {
      const rp = S.room.players.find(p => p.id === playerId);
      if (rp) {
        rp.chips = target.chips;
        rp.balanceVersion = target.balanceVersion;
      }
      if (isAuthorizedCreator()) {
        MP.broadcastState(S.room);
      } else {
        MP.sendAction({
          type: 'ADMIN_BALANCE_SYNC',
          targetPlayerId: playerId,
          chips: target.chips,
          balanceVersion: target.balanceVersion,
          ts: Date.now()
        });
      }
    }

    S.admin.players = getLocalPlayersForAdmin();
    const opNames = { add: 'adicionado a', remove: 'removido de', set: 'definido para' };
    toast(`✓ Saldo ${opNames[operation] || 'atualizado:'} ${target.name || playerId} → ${fmt(target.chips)} 🪙`, 'gold');
    render();
  }

  /* =====================================================================
   * 3. MULTIPLAYER ROOMS, RACE CREATOR PERMISSION & ANTI-FLICKER SYNC
   * ===================================================================== */
  function genRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () => chars[(Math.random() * chars.length) | 0]).join('');
  }

  function genAutoSeed() {
    const arr = new Uint32Array(2);
    if (window.crypto && crypto.getRandomValues) {
      crypto.getRandomValues(arr);
    } else {
      arr[0] = (Math.random() * 0xffffffff) >>> 0;
      arr[1] = Date.now() >>> 0;
    }
    return 'SEED-' + (arr[0] ^ arr[1]).toString(36).toUpperCase();
  }

  function makePlayerEntry(user, isCreator = false) {
    const av = avObj(user.avatarId);
    return {
      id: user.id,
      name: user.name,
      avatarId: user.avatarId,
      avatarIcon: av.icon,
      color: av.color,
      chips: r2(user.chips),
      balanceVersion: user.balanceVersion || 1,
      wins: user.wins || 0,
      online: true,
      isHost: !!isCreator,
      isCreator: !!isCreator,
      lastSeen: Date.now()
    };
  }

  /**
   * Checks if the current user is the single authorized Race Creator in the room.
   * Only this player can create/configure races, close the betting window, or start the race.
   */
  function isAuthorizedCreator() {
    if (!S.room || !S.user) return false;
    const creatorId = S.room.creatorId || S.room.hostId;
    return creatorId === S.user.id;
  }

  function isRoomHost() {
    return isAuthorizedCreator();
  }

  function getOnlinePlayers(room = S.room) {
    if (!room || !Array.isArray(room.players)) return [];
    return room.players.filter(p => p.online !== false);
  }

  function createRoom() {
    const code = genRoomCode();
    const hostEntry = makePlayerEntry(S.user, true);
    const room = {
      code,
      hostId: S.user.id,
      creatorId: S.user.id, // Single authorized race creator assigned upon entering the lobby
      createdAt: Date.now(),
      circuitId: 'int',
      laps: 15,
      wxMode: 'auto',
      grid: DRIVERS.map(d => d.id),
      players: [hostEntry],
      race: null,
      processedActions: []
    };
    S.room = room;
    try { sessionStorage.setItem(ACTIVE_ROOM_KEY, code); } catch (e) {}
    MP.connectRoom(code, S.user.id, true, room);
    startPresenceLoop();
    toast(`Sala ${code} criada! Você é o Criador Autorizado de corridas desta sala.`, 'ok');
    go('room');
  }

  async function joinRoom(codeInput) {
    const rawCode = (codeInput || ($('#jc') ? $('#jc').value : '') || '').trim().toUpperCase();
    if (rawCode.length < 4) return toast('Digite um código de sala válido');

    const cachedRoom = MP._loadLocalRoomState(rawCode);
    if (cachedRoom && Array.isArray(cachedRoom.players)) {
      const alreadyInRoom = cachedRoom.players.find(p => p.id === S.user.id && p.online);
      const otherTabMarker = sessionStorage.getItem('f1bs_tab_joined_' + rawCode);
      if (alreadyInRoom && !otherTabMarker) {
        const map = loadAccountsMap();
        const otherAcc = Object.values(map).find(a => a.id !== S.user.id && !cachedRoom.players.some(p => p.id === a.id && p.online));
        if (otherAcc) {
          S.user = ensureAccountIntegrity(otherAcc);
          try { sessionStorage.setItem(TAB_ACCOUNT_KEY, S.user.id); } catch (e) {}
        } else {
          const count = Object.keys(map).length + 1;
          const av = AVATARS[(count - 1) % AVATARS.length].id;
          const friendAcc = createDefaultAccount(`Amigo ${count}`, av);
          map[friendAcc.id] = friendAcc;
          saveAccountsMap(map);
          S.user = friendAcc;
          try { sessionStorage.setItem(TAB_ACCOUNT_KEY, S.user.id); } catch (e) {}
        }
        syncPlayerWithBackend(S.user);
        toast(`2ª Aba detectada: conectado como ${S.user.name}`, 'gold');
      }
    }

    try {
      sessionStorage.setItem(ACTIVE_ROOM_KEY, rawCode);
      sessionStorage.setItem('f1bs_tab_joined_' + rawCode, '1');
    } catch (e) {}

    const myEntry = makePlayerEntry(S.user, false);

    if (cachedRoom) {
      S.room = cachedRoom;
      upsertPlayerInRoom(S.room, myEntry);
    } else {
      S.room = {
        code: rawCode,
        hostId: null,
        creatorId: null,
        createdAt: Date.now(),
        circuitId: 'int',
        laps: 15,
        wxMode: 'auto',
        grid: DRIVERS.map(d => d.id),
        players: [myEntry],
        race: null,
        processedActions: []
      };
    }

    const amHost = isAuthorizedCreator();
    await MP.connectRoom(rawCode, S.user.id, amHost, amHost ? S.room : null);

    MP.sendAction({
      type: 'JOIN_ROOM',
      playerId: S.user.id,
      player: myEntry,
      ts: Date.now()
    });

    startPresenceLoop();
    toast(`Conectado ao lobby da sala ${rawCode}!`, 'ok');
    go(S.room.race && !S.room.race.done ? 'race' : 'room');
  }

  function leaveRoom() {
    if (!S.room) return;
    const code = S.room.code;
    stopHostRaceLoop();
    clearInterval(S.presenceTimer);
    MP.sendAction({
      type: 'LEAVE_ROOM',
      playerId: S.user.id,
      playerName: S.user.name,
      ts: Date.now()
    }, true);
    MP.disconnectRoom();
    S.room = null;
    try {
      sessionStorage.removeItem(ACTIVE_ROOM_KEY);
      sessionStorage.removeItem('f1bs_tab_joined_' + code);
    } catch (e) {}
    toast('Você saiu da sala.');
    go('home');
  }

  function upsertPlayerInRoom(room, playerEntry) {
    if (!room || !playerEntry) return;
    room.players = room.players || [];
    const existing = room.players.find(p => p.id === playerEntry.id);

    // Ensure room has a single creatorId assigned to the first authorized player
    if (!room.creatorId && !room.hostId) {
      room.creatorId = playerEntry.id;
      room.hostId = playerEntry.id;
    } else if (!room.creatorId) {
      room.creatorId = room.hostId;
    }

    if (existing) {
      const wasOffline = existing.online === false;
      existing.name = playerEntry.name;
      existing.avatarId = playerEntry.avatarId;
      existing.avatarIcon = playerEntry.avatarIcon;
      existing.color = playerEntry.color;

      const inVer = Number(playerEntry.balanceVersion || 1);
      const exVer = Number(existing.balanceVersion || 1);
      if (inVer >= exVer) {
        existing.chips = r2(playerEntry.chips);
        existing.balanceVersion = inVer;
      }

      existing.wins = playerEntry.wins ?? existing.wins;
      existing.online = true;
      existing.lastSeen = Date.now();
      existing.isHost = (room.creatorId === existing.id);
      existing.isCreator = (room.creatorId === existing.id);
      return { joinedNew: false, reconnected: wasOffline };
    } else {
      if (room.players.length >= 8) return { joinedNew: false, full: true };
      playerEntry.online = true;
      playerEntry.lastSeen = Date.now();
      playerEntry.isHost = (room.creatorId === playerEntry.id);
      playerEntry.isCreator = (room.creatorId === playerEntry.id);
      room.players.push(playerEntry);
      return { joinedNew: true, reconnected: false };
    }
  }

  function syncMyPlayerInRoom() {
    if (!S.room || !S.user) return;
    const myEntry = makePlayerEntry(S.user, isAuthorizedCreator());
    upsertPlayerInRoom(S.room, myEntry);
    if (isAuthorizedCreator()) {
      MP.broadcastState(S.room);
    } else {
      MP.sendAction({
        type: 'PLAYER_SYNC',
        playerId: S.user.id,
        player: myEntry,
        ts: Date.now()
      });
    }
  }

  function startPresenceLoop() {
    clearInterval(S.presenceTimer);
    S.presenceTimer = setInterval(() => {
      if (!S.room || !S.user) return;
      const now = Date.now();
      const myEntry = makePlayerEntry(S.user, isAuthorizedCreator());
      upsertPlayerInRoom(S.room, myEntry);

      if (isAuthorizedCreator()) {
        let changed = false;
        S.room.players.forEach(p => {
          if (p.id === S.user.id) {
            p.online = true;
            p.lastSeen = now;
          } else if (p.online && p.lastSeen && (now - p.lastSeen > 8500)) {
            p.online = false;
            changed = true;
            toast(`⚠️ ${p.name} perdeu a conexão com a sala.`);
          }
        });
        if (changed) {
          MP.broadcastState(S.room);
          refreshUI();
        }
      } else {
        MP.sendAction({
          type: 'HEARTBEAT',
          playerId: S.user.id,
          player: myEntry,
          ts: now
        });
      }
    }, 2400);
  }

  // Incoming state from Authoritative Creator / Server
  MP.onStateUpdate = (newState) => {
    if (!newState || !S.room || newState.code !== S.room.code) return;

    const prevRaceId = S.room.race ? S.room.race.id : null;
    const wasDone = S.room.race ? S.room.race.done : false;
    const prevCreator = S.room.creatorId || S.room.hostId;

    S.room = newState;
    if (!S.room.creatorId) S.room.creatorId = S.room.hostId;

    // Update MultiplayerManager host flag if creator role was assigned to us
    MP.isHost = isAuthorizedCreator();

    if (S.user) {
      const meInRoom = S.room.players.find(p => p.id === S.user.id);
      if (meInRoom) {
        meInRoom.online = true;
        meInRoom.lastSeen = Date.now();
        // Sync server-updated balance if balanceVersion increased or balance is out of sync
        const inVer = Number(meInRoom.balanceVersion || 1);
        const myVer = Number(S.user.balanceVersion || 1);
        if (inVer > myVer || (inVer === myVer && Math.abs(meInRoom.chips - S.user.chips) > 0.01)) {
          S.user.chips = r2(meInRoom.chips);
          S.user.balanceVersion = Math.max(inVer, myVer);
          saveCurrentUser(true, false);
          const balanceEl = $('#header-balance-val');
          if (balanceEl) balanceEl.textContent = fmt(S.user.chips);
        }
      } else {
        const myEntry = makePlayerEntry(S.user, false);
        MP.sendAction({ type: 'JOIN_ROOM', playerId: S.user.id, player: myEntry, ts: Date.now() });
      }
    }

    if (S.room.race && S.room.race.done && (!wasDone || prevRaceId !== S.room.race.id)) {
      settleMyBetsForFinishedRace(S.room.race);
    }

    // If a non-creator was somehow on 'setup' view, redirect them to 'room' or 'race'
    if (S.view === 'setup' && !isAuthorizedCreator()) {
      S.view = (S.room.race && !S.room.race.done) ? 'race' : 'room';
      render();
      return;
    }

    // Auto-switch view to race if creator prepared/started a race while we were in the lobby
    if (S.room.race && !S.room.race.done && S.view === 'room' && prevRaceId !== S.room.race.id) {
      S.view = 'race';
      render();
      return;
    }

    // If creator role changed, update UI cleanly
    if (prevCreator !== (S.room.creatorId || S.room.hostId) && S.view === 'room') {
      render();
      return;
    }

    refreshUI();
  };

  // Incoming actions from Guests
  MP.onActionReceived = (act) => {
    if (!S.room || !act) return;

    if (act.type === 'REQUEST_STATE') {
      if (isAuthorizedCreator()) {
        MP.broadcastState(S.room);
      }
      return;
    }

    if (act.type === 'JOIN_ROOM' && act.player) {
      const res = upsertPlayerInRoom(S.room, act.player);
      if (res.joinedNew) {
        toast(`🟢 ${act.player.name} entrou na sala!`, 'ok');
      } else if (res.reconnected) {
        toast(`🟢 ${act.player.name} reconectou à corrida!`, 'ok');
      }
      if (isAuthorizedCreator()) MP.broadcastState(S.room);
      refreshUI();
      return;
    }

    if ((act.type === 'HEARTBEAT' || act.type === 'PLAYER_SYNC') && act.player) {
      const res = upsertPlayerInRoom(S.room, act.player);
      if (res.reconnected) {
        toast(`🟢 ${act.player.name} reconectou à sala!`, 'ok');
      }
      if (act.type === 'PLAYER_SYNC' && isAuthorizedCreator()) {
        MP.broadcastState(S.room);
      }
      // Do NOT trigger a full DOM re-render on silent heartbeats! Only update targeted elements if needed.
      updateHeaderAndRoomDOM();
      return;
    }

    if (act.type === 'DISCONNECT' && act.playerId) {
      const pl = S.room.players.find(p => p.id === act.playerId);
      if (pl && pl.online) {
        pl.online = false;
        toast(`⚠️ ${pl.name} desconectou.`);
        if (isAuthorizedCreator()) MP.broadcastState(S.room);
        refreshUI();
      }
      return;
    }

    if (act.type === 'LEAVE_ROOM' && act.playerId) {
      const pl = S.room.players.find(p => p.id === act.playerId);
      if (pl) {
        S.room.players = S.room.players.filter(p => p.id !== act.playerId);
        // Reassign creator if the creator left the room
        if (S.room.creatorId === act.playerId && S.room.players.length > 0) {
          const nextCreator = S.room.players.find(p => p.online !== false) || S.room.players[0];
          S.room.creatorId = nextCreator.id;
          S.room.hostId = nextCreator.id;
          S.room.players.forEach(p => {
            p.isHost = (p.id === nextCreator.id);
            p.isCreator = (p.id === nextCreator.id);
          });
          MP.isHost = isAuthorizedCreator();
        }
        toast(`🚪 ${pl.name} saiu da sala.`);
        if (isAuthorizedCreator()) MP.broadcastState(S.room);
        refreshUI();
      }
      return;
    }

    if (act.type === 'PLACE_BET' && act.bet) {
      applyPlaceBetToRoom(act.bet, act.playerChips, act.balanceVersion);
      if (isAuthorizedCreator()) MP.broadcastState(S.room);
      refreshUI();
      return;
    }

    if (act.type === 'ADMIN_BALANCE_SYNC' && act.targetPlayerId) {
      const pl = S.room.players.find(p => p.id === act.targetPlayerId);
      if (pl && typeof act.chips === 'number') {
        const inVer = Number(act.balanceVersion || 1);
        const exVer = Number(pl.balanceVersion || 1);
        if (inVer >= exVer) {
          pl.chips = r2(act.chips);
          pl.balanceVersion = inVer;
        }
      }
      if (S.user && S.user.id === act.targetPlayerId && typeof act.chips === 'number') {
        const inVer = Number(act.balanceVersion || 1);
        const myVer = Number(S.user.balanceVersion || 1);
        if (inVer >= myVer) {
          S.user.chips = r2(act.chips);
          S.user.balanceVersion = inVer;
          saveCurrentUser(true, false);
          toast(`🪙 Seu saldo foi atualizado pelo Administrador: ${fmt(S.user.chips)} fichas!`, 'gold');
        }
      }
      if (isAuthorizedCreator()) MP.broadcastState(S.room);
      refreshUI();
      return;
    }

    if (act.type === 'CANCEL_BET' && act.betId) {
      applyCancelBetToRoom(act.betId, act.playerId, act.playerChips, act.balanceVersion);
      if (isAuthorizedCreator()) MP.broadcastState(S.room);
      refreshUI();
      return;
    }

    if (act.type === 'UPDATE_CONFIG' && act.config) {
      // Strictly reject config updates from non-authorized players
      if (act.playerId && act.playerId !== (S.room.creatorId || S.room.hostId)) {
        return;
      }
      if (act.config.circuitId) S.room.circuitId = act.config.circuitId;
      if (act.config.laps) S.room.laps = act.config.laps;
      if (act.config.wxMode) S.room.wxMode = act.config.wxMode;
      if (act.config.grid) S.room.grid = act.config.grid;
      if (isAuthorizedCreator()) MP.broadcastState(S.room);
      refreshUI();
      return;
    }
  };

  MP.onConnectionStatus = (st) => {
    S.connStatus = st;
  };

  /* =====================================================================
   * 4. AUTHORITATIVE DETERMINISTIC RACE ENGINE (30s PER LAP)
   * ===================================================================== */
  const hashStr = (s) => {
    let h = 2166136261;
    for (const ch of String(s)) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

  const rnd = (r) => {
    r.rs = (r.rs + 0x6D2B79F5) | 0;
    let t = Math.imul(r.rs ^ (r.rs >>> 15), 1 | r.rs);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const gs = (r) => (rnd(r) + rnd(r) + rnd(r) - 1.5) / 1.5;
  const sk = (id) => dv(id).skill ?? 0.05;
  const slickFor = (rem, cur) => {
    const c = rem > 30 ? 'H' : rem > 14 ? 'M' : 'S';
    return c === cur ? (c === 'M' ? 'H' : 'M') : c;
  };

  function recordRealOvertakeEvent(r, lapNum, passerId, passedId, newPosition, sectorLabel = null) {
    if (!r || !passerId || !passedId || passerId === passedId) return null;
    const dPasser = r.drv && r.drv[passerId];
    const dPassed = r.drv && r.drv[passedId];
    // Strictly require both drivers to be actively running on track (no DNF, no DNS)
    if (!dPasser || dPasser.st !== 'run' || !dPassed || dPassed.st !== 'run') return null;

    r.ovSeq = (Number(r.ovSeq) || 0) + 1;
    r.overtakeLog = Array.isArray(r.overtakeLog) ? r.overtakeLog : [];
    const evId = `ov_${r.id}_L${lapNum}_S${r.ovSeq}_${passerId}_${passedId}`;
    if (r.overtakeLog.some(x => x.id === evId)) return null;

    const entry = {
      id: evId,
      seq: r.ovSeq,
      lap: Number(lapNum) || 1,
      passer: passerId,
      passed: passedId,
      position: newPosition,
      sector: sectorLabel,
      cause: 'ON_TRACK',
      realOnTrack: true,
      passedDriverActive: true,
      pitPass: false,
      dnfPass: false,
      penaltyPass: false,
      adminChange: false,
      artificial: false,
      ts: Date.now()
    };
    r.overtakeLog.push(entry);
    dPasser.ov = (Number(dPasser.ov) || 0) + 1;
    return entry;
  }

  function pushEvent(r, lapNum, text, kind) {
    r.seq = (r.seq || 0) + 1;
    r.events.unshift({ id: 'ev_' + r.seq, l: lapNum, t: text, k: kind });
    if (r.events.length > 100) r.events.length = 100;
  }

  function lapT(r, d, id) {
    const y = TYRES[d.tyre] || TYRES.M;
    const w = r.w;
    const wp = d.tyre === 'I' ? Math.abs(w - 0.5) * 5 : d.tyre === 'W' ? (1 - w) * 7 : w * 16;
    const teamCode = dv(id).team;
    return r.circuit.bl + (TEAM_PACE[teamCode] || 0.5) + sk(id) + y.p + y.d * d.age + Math.max(0, d.age - y.l) * 0.25 + wp - 0.03 * r.lap + gs(r) * 0.28;
  }

  function pitCheck(r, d, L) {
    const w = r.w, t = d.tyre, wt = (t === 'I' || t === 'W'), rem = r.total - L, sc = r.sc.type;
    if (rem < 2) return null;
    if (!wt && w > 0.28 && rnd(r) < 0.35) return w > 0.7 ? 'W' : 'I';
    if (t === 'I' && w > 0.78 && rnd(r) < 0.25) return 'W';
    if (t === 'W' && w < 0.62 && rnd(r) < 0.25) return 'I';
    if (wt && w < 0.15 && rnd(r) < 0.3) return slickFor(rem);
    if (!wt) {
      const pl = d.plan.length && L >= d.plan[0];
      if (pl || d.age > TYRES[t].l + 5 || (sc && d.age >= 10 && rnd(r) < 0.4)) {
        if (pl) d.plan.shift();
        return slickFor(rem, t);
      }
    }
    return null;
  }

  function stepWeather(r, ev) {
    const c = r.circuit;
    if (r.wxMode !== 'dry') {
      const p = rnd(r), s = r.ws;
      let n = s;
      if (s === 0 && p < Math.min(0.5, c.rn * 0.15 * (r.wxMode === 'rain' ? 5 : 1))) n = 1;
      else if (s === 1) n = p < 0.08 ? 2 : p < 0.15 ? 0 : 1;
      else if (s === 2 && p < 0.12) n = 1;
      if (n !== s) {
        ev(n === 2 ? 'Chuva forte no circuito!' : n === 1 ? (s === 0 ? 'Começa a chover na pista' : 'A chuva diminui') : 'A chuva para e a pista começa a secar', 'w');
        r.ws = n;
      }
    }
    const tg = [0, 0.5, 1][r.ws];
    r.w = r2(r.w + Math.max(-0.12, Math.min(0.12, tg - r.w)));
  }

  function simCompleteLap(r) {
    const c = r.circuit;
    const L = ++r.lap;
    const sc = r.sc;
    const ev = (t, k) => pushEvent(r, L, t, k);
    const T = (i) => r.drv[i];

    const prevLead = T(r.order[0]);
    r.order.forEach((id, idx) => {
      const d = T(id);
      if (d) {
        d.prevRank = idx;
        d.prevGapSec = prevLead ? Math.max(0, d.t - prevLead.t) : idx * 0.8;
      }
    });

    if (sc.type && --sc.left <= 0) {
      ev((sc.type === 'SC' ? 'Safety Car' : 'Virtual Safety Car') + ' recolhido — Bandeira Verde!', 'g');
      sc.type = null;
    }

    stepWeather(r, ev);
    const ord = r.order.filter(i => T(i).st === 'run');
    const pit = {};
    let trig = null;

    ord.forEach((id, i) => {
      const d = T(id), s = sk(id);
      let loss = 0;
      const pc = pitCheck(r, d, L);
      if (pc) {
        loss = c.pl * (sc.type === 'SC' ? 0.55 : sc.type === 'VSC' ? 0.65 : 1) + rnd(r) * 1.5;
        d.tyre = pc;
        d.age = 0;
        d.stops++;
        d.pitLap = L;
        pit[id] = 1;
        if (i < 12) ev(`${id} faz pit stop → Pneu ${pc}`, 'p');
      }
      const lt = sc.type === 'SC' ? c.bl * 1.45 : lapT(r, d, id) * (sc.type === 'VSC' ? 1.3 : 1);
      const q = sc.type ? 0.1 : 1;
      const sw = /[SMH]/.test(d.tyre) && r.w > 0.3;

      const out = (why, msg) => {
        d.st = 'dnf';
        d.why = why;
        d.lapsDone = L - 1;
        d.dnfTrackPos = r2(0.15 + rnd(r) * 0.7);
        r.dnf.push(id);
        ev(id + msg, 'c');
      };

      if (rnd(r) < c.cr * (1 + s * 2) * (1 + r.w * 1.4 + (sw ? 1.5 : 0)) * (L === 1 ? 2.2 : 1) * q) {
        out('Acidente', ' sofre acidente e abandona a corrida!');
        if (!trig) trig = rnd(r) < 0.6 ? 'SC' : 'VSC';
      } else if (rnd(r) < 0.0008 * (d.age > 26 ? 2 : 1) * q) {
        out('Motor', ' abandona com falha mecânica');
        if (!trig && rnd(r) < 0.4) trig = 'VSC';
      } else if (rnd(r) < 0.004 * (1 + s * 2) * (1 + r.w * 2) * q) {
        loss += 2.5 + rnd(r) * 5;
        ev(`${id} trava rodas na freada e perde tempo`, 'e');
      }

      if (d.st === 'run') {
        d.t += lt + loss;
        d.age++;
        d.lapsDone = L;
      }
    });

    if (trig && !sc.type) {
      sc.type = trig;
      sc.left = trig === 'SC' ? 2 + ((rnd(r) * 2) | 0) : 1;
      ev(trig === 'SC' ? '🚨 SAFETY CAR NA PISTA!' : '⚠️ VIRTUAL SAFETY CAR ATIVADO', 's');
    }

    const act = ord.filter(i => T(i).st === 'run');
    for (let k = 0; k < 30; k++) {
      let ch = false;
      for (let i = 1; i < act.length; i++) {
        const a = act[i - 1], b = act[i], ta = T(a), tb = T(b);
        if (tb.t < ta.t) {
          const dd = ta.t - tb.t;
          const p = sc.type ? 0 : dd > 1.4 || pit[a] ? 1 : Math.min(0.92, Math.max(0.08, (c.ot * 0.6 + dd * 0.25) * (r.w > 0.4 ? 1.15 : 1) * (L === 1 ? 1.4 : 1)));
          if (rnd(r) < p) {
            act[i - 1] = b;
            act[i] = a;
            ch = true;
            if (!pit[a] && !pit[b] && ta.st === 'run' && tb.st === 'run' && dd <= 1.5) {
              recordRealOvertakeEvent(r, L, b, a, i, null);
              if (i < 12) ev(`${b} ultrapassa ${a} na pista e assume a P${i}!`, 'o');
            }
          } else {
            tb.t = ta.t + 0.32;
          }
        }
      }
      if (!ch) break;
    }

    if (sc.type === 'SC') {
      act.forEach((id, i) => { T(id).t = T(act[0]).t + i * 0.65; });
    }

    r.order = act.concat(r.dnf.slice().reverse().sort((a, b) => T(b).lapsDone - T(a).lapsDone));
  }

  function prepareRace() {
    if (!S.room) return toast('Crie ou entre em uma sala primeiro');
    // Strict Creator Permission Check
    if (!isAuthorizedCreator()) {
      return toast('Acesso negado: apenas o Criador Autorizado da sala pode criar e iniciar corridas.');
    }
    if (S.room.race && !S.room.race.done) {
      go('race');
      return toast('Já existe uma corrida em andamento nesta sala');
    }

    const onlineCount = getOnlinePlayers().length;
    if (onlineCount < MIN_PLAYERS_TO_START) {
      return toast(`É necessário pelo menos ${MIN_PLAYERS_TO_START} jogadores conectados na sala para iniciar (atual: ${onlineCount}).`);
    }

    const grid = S.room.grid || [];
    if (grid.length < 3) return toast('Selecione pelo menos 3 pilotos para o grid');

    const c = CIRCUITS.find(x => x.id === S.room.circuitId) || CIRCUITS[0];
    const total = Math.min(MAX_RACE_LAPS, Math.max(MIN_RACE_LAPS, Math.floor(+S.room.laps || c.laps)));
    S.room.laps = total;

    const autoSeed = genAutoSeed();
    const wx = S.room.wxMode || 'auto';

    const r = {
      id: 'race_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      circuit: c,
      total,
      lap: 0,
      lapProgress: 0,
      lapDurationMs: LAP_DURATION_MS,
      lastTickTs: Date.now(),
      seed: autoSeed,
      rs: hashStr(autoSeed + c.id + total),
      wxMode: wx,
      drv: {},
      order: [],
      start: [],
      events: [],
      overtakeLog: [],
      ovSeq: 0,
      exposures: {},
      oddsBook: null,
      dnf: [],
      done: false,
      cancelled: false,
      settled: false,
      settlementId: null,
      started: false,
      running: false,
      bettingOpen: true,
      round: 0,
      bets: [],
      res: {},
      seq: 0,
      ws: 0,
      w: 0,
      sc: { type: null, left: 0 }
    };

    if (wx === 'rain' || (wx === 'auto' && rnd(r) < c.rn * 1.6)) {
      r.ws = 1;
      r.w = 0.5;
    }

    const ids = DRIVERS.map(d => d.id).filter(i => grid.includes(i));
    const q = {};
    ids.forEach(i => { q[i] = (TEAM_PACE[dv(i).team] || 0.5) + sk(i) + gs(r) * 0.3; });
    ids.sort((a, b) => q[a] - q[b]);

    ids.forEach((id, i) => {
      const n = total < 12 ? (rnd(r) < 0.4 ? 1 : 0) : total < 25 ? 1 : rnd(r) < 0.65 ? 2 : 1;
      const p = rnd(r), pl = [];
      for (let k = 1; k <= n; k++) {
        pl.push(Math.max(2, Math.min(total - 1, Math.floor(k * total / (n + 1) + (rnd(r) - 0.5) * 4))));
      }
      r.drv[id] = {
        t: i * 0.28,
        prevRank: i,
        prevGapSec: i * 0.28,
        tyre: r.ws ? 'I' : p < 0.45 ? 'S' : p < 0.82 ? 'M' : 'H',
        age: 0,
        stops: 0,
        plan: pl,
        st: 'run',
        gp: i + 1,
        ov: 0,
        lapsDone: 0
      };
    });

    r.order = ids.slice();
    r.start = ids.slice();
    r.oddsBook = FIN.calculateRaceOdds(r, { catalog: window.F1Tracks, champ: S.champ });
    pushEvent(r, 0, `Grid formado em ${c.name} (${total} voltas). Odds dinâmicas calculadas (1.000 simulações). Janela de apostas ABERTA!`, 'g');

    S.room.race = r;
    if (!r.order.includes(S.selectedBetDriver)) {
      S.selectedBetDriver = r.order[0];
    }
    MP.broadcastState(S.room);
    toast('Grid preparado! Realizem suas apostas antes do encerramento da janela.', 'ok');
    go('race');
  }

  /**
   * Permanently closes the current betting window for this round.
   * Reopening a closed betting window is strictly forbidden and removed!
   */
  function closeBettingWindow() {
    if (!S.room || !S.room.race) return;
    if (!isAuthorizedCreator()) {
      return toast('Apenas o criador autorizado da sala pode encerrar a janela de apostas.');
    }
    const r = S.room.race;
    if (r.running || r.done) return;
    if (!r.bettingOpen) {
      return toast('A janela de apostas já foi encerrada definitivamente para esta rodada.');
    }

    r.bettingOpen = false;
    r.bets.forEach(b => {
      if (!b.cancelled) b.locked = true;
    });
    pushEvent(r, r.lap, `🔒 Janela de apostas encerrada definitivamente (Rodada ${r.round + 1}). Apostas bloqueadas!`, 'g');
    toast('Janela de apostas encerrada! Pronto para a largada.', 'gold');
    MP.broadcastState(S.room);
    refreshUI();
  }

  function startOrResumeRace() {
    if (!S.room || !S.room.race) return;
    if (!isAuthorizedCreator()) {
      return toast('Apenas o criador autorizado da sala pode iniciar/retomar a corrida.');
    }
    const r = S.room.race;
    if (r.done || r.running) return;

    const onlinePlayers = getOnlinePlayers();
    if (onlinePlayers.length < MIN_PLAYERS_TO_START) {
      return toast(`Mínimo de ${MIN_PLAYERS_TO_START} jogadores conectados na sala para iniciar a corrida! (Conectados: ${onlinePlayers.length})`);
    }

    if (!r.total || r.total < MIN_RACE_LAPS) {
      return toast(`A corrida precisa ter no mínimo ${MIN_RACE_LAPS} voltas configuradas.`);
    }

    if (!r.circuit || !r.order || r.order.length < 3) {
      return toast('Informações do circuito ou grid incompletas.');
    }

    if (r.bettingOpen) {
      return toast('Encerre a janela de apostas antes de autorizar a largada!');
    }

    r.bets.forEach(b => {
      if (!b.cancelled) b.locked = true;
    });

    if (!r.started) {
      r.started = true;
      r.lap = 1;
      r.lapProgress = 0;
      pushEvent(r, 1, '🚦 Luzes vermelhas se apagam! LARGADA AUTORIZADA!', 'g');
    } else {
      r.lap = r.lap + 1;
      r.lapProgress = 0;
      pushEvent(r, r.lap, `▶ Corrida retomada para a volta ${r.lap}!`, 'g');
    }

    r.running = true;
    r.lastTickTs = Date.now();
    MP.broadcastState(S.room);
    startHostRaceLoop();
    refreshUI();
  }

  function pauseRace() {
    if (!S.room || !S.room.race || !isAuthorizedCreator()) return;
    const r = S.room.race;
    if (!r.running) return;
    r.running = false;
    stopHostRaceLoop();
    pushEvent(r, r.lap, '⏸ Simulação pausada pelo criador da corrida.', 's');
    MP.broadcastState(S.room);
    refreshUI();
  }

  function startHostRaceLoop() {
    stopHostRaceLoop();
    let tickCounter = 0;
    S.hostTickTimer = setInterval(() => {
      if (!S.room || !S.room.race || !S.room.race.running || !isAuthorizedCreator()) {
        stopHostRaceLoop();
        return;
      }
      const r = S.room.race;
      const now = Date.now();
      const dt = Math.max(0, Math.min(1000, now - (r.lastTickTs || now)));
      r.lastTickTs = now;

      const lapDur = r.lapDurationMs || LAP_DURATION_MS;
      r.lapProgress = (r.lapProgress || 0) + dt / lapDur;

      if (r.lapProgress >= 0.35 && r.lapProgress - dt / lapDur < 0.35) {
        triggerMidLapAction(r, 1);
      } else if (r.lapProgress >= 0.70 && r.lapProgress - dt / lapDur < 0.70) {
        triggerMidLapAction(r, 2);
      }

      if (r.lapProgress >= 1.0) {
        const completedLapNum = r.lap;
        r.lap = completedLapNum - 1;
        simCompleteLap(r);
        r.lapProgress = 0;

        if (r.lap >= r.total) {
          r.running = false;
          r.bettingOpen = false;
          stopHostRaceLoop();
          finishRaceAuthoritative(r);
          MP.broadcastState(S.room);
          refreshUI();
          return;
        }

        if (r.lap % 10 === 0 && r.lap < r.total) {
          r.running = false;
          r.bettingOpen = true;
          r.round = Math.floor(r.lap / 10);
          stopHostRaceLoop();
          pushEvent(
            r,
            r.lap,
            `🔔 ${r.lap} voltas concluídas! Nova rodada de apostas aberta (Multiplicador ${vm(mult(r.lap))}).`,
            'g'
          );
          MP.broadcastState(S.room);
          toast(`Volta ${r.lap} concluída! Nova rodada de apostas aberta!`, 'gold');
          refreshUI();
          return;
        }

        r.lap = r.lap + 1;
        MP.broadcastState(S.room);
        refreshUI();
        return;
      }

      tickCounter++;
      if (tickCounter % 3 === 0) {
        MP.broadcastState(S.room, true);
      }
      updateLiveHUDOnly();
    }, 100);
  }

  function triggerMidLapAction(r, sector) {
    const act = r.order.filter(id => r.drv[id] && r.drv[id].st === 'run');
    if (act.length < 3 || (r.sc && r.sc.type)) return;
    if (rnd(r) < 0.32) {
      const idx = 1 + ((rnd(r) * Math.min(8, act.length - 1)) | 0);
      const ahead = act[idx - 1];
      const behind = act[idx];
      if (ahead && behind && r.drv[ahead] && r.drv[behind]) {
        const posA = r.order.indexOf(ahead);
        const posB = r.order.indexOf(behind);
        if (posA >= 0 && posB === posA + 1) {
          r.order.forEach((id, i) => { r.drv[id].prevRank = i; });
          r.order[posA] = behind;
          r.order[posB] = ahead;
          const tmpT = r.drv[ahead].t;
          r.drv[ahead].t = r.drv[behind].t + 0.18;
          r.drv[behind].t = tmpT;
          recordRealOvertakeEvent(r, r.lap, behind, ahead, posA + 1, sector);
          pushEvent(
            r,
            r.lap,
            `⚔️ Setor ${sector}: ${behind} mergulha por dentro e ultrapassa ${ahead} pela P${posA + 1}!`,
            'o'
          );
        }
      }
    }
  }

  function stopHostRaceLoop() {
    if (S.hostTickTimer) {
      clearInterval(S.hostTickTimer);
      S.hostTickTimer = null;
    }
  }

  /* =====================================================================
   * 5. BETTING SYSTEM (REBALANCED ECONOMY: 10% EXPOSURE, OVERTAKES & PLACEMENT)
   * ===================================================================== */
  function mult(lap) {
    return FIN.getLapMultiplier(lap);
  }

  function posOf(r, id) {
    return r.order.indexOf(id) + 1;
  }

  function getMyRaceExposure(r) {
    if (!S.user) {
      return { initialBalance: 0, maxExposure: 0, committedOvertake: 0, committedPlacement: 0, totalCommitted: 0, remainingExposure: 0 };
    }
    ensureAccountIntegrity(S.user);
    if (!r) {
      const lim = r2(S.user.chips * FIN.EXPOSURE_RATE);
      return {
        initialBalance: S.user.chips,
        maxExposure: lim,
        committedOvertake: 0,
        committedPlacement: 0,
        totalCommitted: 0,
        remainingExposure: lim
      };
    }
    r.exposures = r.exposures || {};
    if (S.user.raceExposures && S.user.raceExposures[r.id] && !r.exposures[S.user.id]) {
      r.exposures[S.user.id] = S.user.raceExposures[r.id];
    }
    const exp = FIN.getOrInitRaceExposure(r, S.user.id, S.user.chips);
    S.user.raceExposures[r.id] = r.exposures[S.user.id];
    return exp;
  }

  function getCommittedChipsInActiveRace(r, pid) {
    if (!r || r.done || r.cancelled || r.settled || !Array.isArray(r.bets)) return 0;
    return r2(
      r.bets
        .filter(b => b && b.pid === pid && !b.cancelled && b.status !== 'VOID')
        .reduce((s, b) => s + (Number(b.amount) || 0), 0)
    );
  }

  function calculateBetPayout(bet, finalPos, isDnf, raceRef) {
    const r = raceRef || (S.room ? S.room.race : null);
    if (r) {
      const outcome = FIN.evaluateTicketForRace(r, bet);
      return outcome ? outcome.ret : 0;
    }
    if (bet.cancelled || isDnf || finalPos <= 0) return 0;
    return 0;
  }

  async function placeBet() {
    if (S.betInFlight) {
      return toast('Aguarde o processamento da aposta anterior.');
    }
    if (!S.room || !S.room.race) return toast('Nenhuma corrida preparada.');
    const r = S.room.race;
    if (r.done || r.cancelled) return toast('A corrida já foi encerrada ou cancelada.');
    if (r.running || !r.bettingOpen) {
      return toast('A janela de apostas já foi encerrada! Não são permitidas novas apostas neste momento.');
    }

    const modality = (S.betTab === 'placement') ? 'placement' : 'overtake';
    if (modality === 'placement' && (r.started || Number(r.lap || 0) > 0)) {
      S.betTab = 'overtake';
      refreshUI();
      return toast('Apostas de colocação final são encerradas antes da largada!');
    }

    const driverId = S.selectedBetDriver;
    if (!driverId || !r.order.includes(driverId)) {
      return toast('Selecione um piloto válido na tabela de apostas.');
    }

    const inputEl = $('#bet-amount-input');
    const amount = r2(+(inputEl ? inputEl.value : S.betAmountInput));

    if (!amount || amount <= 0 || isNaN(amount)) {
      return toast('Informe um valor válido de fichas para apostar.');
    }

    S.betInFlight = true;
    try {
      // Cross-tab synchronize fresh account state before validating
      const freshMap = loadAccountsMap();
      if (freshMap[S.user.id]) {
        const freshAcc = ensureAccountIntegrity(freshMap[S.user.id]);
        if ((freshAcc.balanceVersion || 1) >= (S.user.balanceVersion || 1)) {
          S.user.chips = r2(freshAcc.chips);
          S.user.balanceVersion = freshAcc.balanceVersion;
          S.user.raceExposures = Object.assign({}, S.user.raceExposures || {}, freshAcc.raceExposures || {});
        }
      }

      // Restore any locked exposure from storage so multi-tab / refresh can never reset the 10% limit
      r.exposures = r.exposures || {};
      if (S.user.raceExposures && S.user.raceExposures[r.id]) {
        r.exposures[S.user.id] = S.user.raceExposures[r.id];
      }

      const currentRound = Math.floor((Number(r.lap) || 0) / 10);
      const betId = `bet_${S.user.id}_${r.id}_r${currentRound}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      // If authoritative backend is available, validate & execute transactionally on the server first!
      if (MP.backendAvailable && location.protocol !== 'file:') {
        try {
          const draftBet = {
            id: betId,
            raceId: r.id,
            pid: S.user.id,
            playerName: S.user.name,
            playerAvatar: avObj(S.user.avatarId).icon,
            playerColor: avObj(S.user.avatarId).color,
            modality,
            driver: driverId,
            market: modality === 'placement' ? S.selectedBetMarket : null,
            amount
          };
          const res = await fetch(`/api/room/${encodeURIComponent(S.room.code)}/bet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerId: S.user.id, bet: draftBet })
          });
          const data = await res.json();
          if (!res.ok || !data.ok) {
            return toast(data.error || 'Aposta recusada pelo servidor autoritativo.');
          }
          const srvBet = data.bet;
          if (data.player) {
            S.user.chips = r2(data.player.chips);
            S.user.committedChips = r2(data.player.committedChips || 0);
            S.user.totalBalance = r2(S.user.chips + S.user.committedChips);
            S.user.balanceVersion = data.player.balanceVersion;
            S.user.raceExposures = Object.assign({}, S.user.raceExposures || {}, data.player.raceExposures || {});
            if (data.player.cashbox) {
              S.user.cashbox = data.player.cashbox;
            }
          }
          if (data.exposure && r.exposures) {
            r.exposures[S.user.id] = Object.assign({}, r.exposures[S.user.id] || {}, {
              initialBalance: data.exposure.initialBalance,
              maxExposure: data.exposure.maxExposure
            });
            S.user.raceExposures[r.id] = r.exposures[S.user.id];
          }
          saveCurrentUser(true, false);
          applyPlaceBetToRoom(srvBet, S.user.chips, S.user.balanceVersion);
          if (isAuthorizedCreator()) {
            MP.broadcastState(S.room);
          } else {
            MP.sendAction({
              type: 'PLACE_BET',
              playerId: S.user.id,
              bet: srvBet,
              playerChips: S.user.chips,
              balanceVersion: S.user.balanceVersion,
              ts: Date.now()
            });
          }
          const msg = modality === 'placement'
            ? `✓ Aposta confirmada: ${fmt(srvBet.amount)} 🪙 em ${srvBet.driver} (${srvBet.marketLabel} @ ${srvBet.odd.toFixed(2)}x)!`
            : `✓ Aposta confirmada: ${fmt(srvBet.amount)} 🪙 em ${srvBet.driver} (Exp: ${srvBet.expectedOvertakes} ULTs · Mult ${vm(srvBet.mult)})!`;
          toast(msg, 'ok');
          updateHeaderAndRoomDOM();
          refreshUI();
          return;
        } catch (err) {
          // If network call failed mid-request, fall through only if backend is unreachable
        }
      }

      // Local / P2P Authoritative Validation via F1Finance
      const validation = FIN.validateBetRequest({
        race: r,
        player: S.user,
        modality,
        driverId,
        market: S.selectedBetMarket,
        amount,
        catalog: window.F1Tracks,
        champ: S.champ
      });

      if (!validation.ok) {
        return toast(validation.error);
      }

      const stake = validation.stake;
      S.user.raceExposures[r.id] = r.exposures[S.user.id];
      S.user.chips = r2(S.user.chips - stake);
      S.user.balanceVersion = Number(S.user.balanceVersion || 1) + 1;

      const confirmedEventSeq = Array.isArray(r.overtakeLog) ? r.overtakeLog.length : (Number(r.ovSeq) || 0);
      const betObj = {
        id: betId,
        raceId: r.id,
        pid: S.user.id,
        playerName: S.user.name,
        playerAvatar: avObj(S.user.avatarId).icon,
        playerColor: avObj(S.user.avatarId).color,
        modality,
        driver: driverId,
        amount: stake,
        round: currentRound,
        lap: r.lap,
        startPos: posOf(r, driverId),
        confirmedEventSeq,
        locked: false,
        cancelled: false,
        status: 'ACTIVE',
        modelVersion: validation.modelVersion,
        ts: Date.now()
      };

      if (modality === 'placement') {
        betObj.market = validation.market;
        betObj.marketLabel = validation.marketLabel;
        betObj.odd = validation.odd;
        betObj.probability = validation.probability;
      } else {
        betObj.mult = validation.mult;
        betObj.expectedOvertakes = validation.expectedOvertakes;
        betObj.factorF = validation.factorF;
      }

      ensureAccountIntegrity(S.user);
      applyPlaceBetToRoom(betObj, S.user.chips, S.user.balanceVersion);
      S.user.committedChips = getCommittedChipsInActiveRace(r, S.user.id);
      S.user.totalBalance = r2(S.user.chips + S.user.committedChips);

      S.user.cashbox.totalBet = r2(S.user.cashbox.totalBet + stake);
      S.user.cashbox.betHistory.unshift({
        id: betId,
        raceId: r.id,
        circuit: r.circuit.name,
        modality,
        driver: driverId,
        market: betObj.market || null,
        marketLabel: betObj.marketLabel || null,
        odd: betObj.odd || null,
        probability: betObj.probability || null,
        expectedOvertakes: betObj.expectedOvertakes ?? null,
        amount: stake,
        round: currentRound,
        lap: r.lap,
        mult: betObj.mult || null,
        modelVersion: betObj.modelVersion,
        status: 'active',
        ret: 0,
        net: 0,
        date: new Date().toLocaleString('pt-BR')
      });

      const txTitle = modality === 'placement'
        ? `Aposta de Colocação · ${driverId} (${betObj.marketLabel})`
        : `Aposta de Ultrapassagem · ${driverId} (Exp: ${betObj.expectedOvertakes} ULTs)`;
      const txDetail = modality === 'placement'
        ? `${r.circuit.name} · Odd: ${betObj.odd.toFixed(2)}x (Prob: ${(betObj.probability * 100).toFixed(1)}%)`
        : `${r.circuit.name} · Rodada ${currentRound + 1} (${vm(betObj.mult)})`;

      recordFinancialTx('tx_bet_' + betId, 'BET_PLACED', txTitle, txDetail, -stake);
      saveCurrentUser(true, true);

      if (isAuthorizedCreator()) {
        MP.broadcastState(S.room);
      } else {
        MP.sendAction({
          type: 'PLACE_BET',
          playerId: S.user.id,
          bet: betObj,
          playerChips: S.user.chips,
          balanceVersion: S.user.balanceVersion,
          ts: Date.now()
        });
      }

      const msg = modality === 'placement'
        ? `✓ Aposta confirmada: ${fmt(stake)} 🪙 em ${driverId} (${betObj.marketLabel} @ ${betObj.odd.toFixed(2)}x)!`
        : `✓ Aposta confirmada: ${fmt(stake)} 🪙 em ${driverId} (Exp: ${betObj.expectedOvertakes} ULTs · Mult ${vm(betObj.mult)})!`;
      toast(msg, 'ok');
      updateHeaderAndRoomDOM();
      refreshUI();
    } finally {
      S.betInFlight = false;
    }
  }

  function applyPlaceBetToRoom(betObj, updatedChips, balanceVersion) {
    if (!S.room || !S.room.race || !betObj) return;
    const r = S.room.race;
    if (r.done || r.running || !r.bettingOpen) return;
    if (r.bets.some(b => b.id === betObj.id)) return;
    r.bets.push(betObj);
    // Ensure exposure tracker in race is initialized for this player
    const pl = S.room.players.find(p => p.id === betObj.pid);
    if (pl && typeof updatedChips === 'number') {
      pl.chips = r2(updatedChips);
      if (balanceVersion) pl.balanceVersion = balanceVersion;
    }
    FIN.getOrInitRaceExposure(r, betObj.pid, pl ? pl.chips : 0);
  }

  async function cancelBet(betId) {
    if (!S.room || !S.room.race) return;
    const r = S.room.race;

    if (r.done || r.running || !r.bettingOpen) {
      return toast('Não é possível cancelar: a janela de apostas já foi encerrada!');
    }

    const bet = r.bets.find(b => b.id === betId);
    if (!bet) return toast('Aposta não encontrada.');
    if (bet.pid !== S.user.id) {
      return toast('Você só pode cancelar suas próprias apostas!');
    }
    if (bet.locked) {
      return toast('Esta aposta pertence a uma rodada anterior já encerrada e não pode ser cancelada.');
    }
    if (bet.cancelled) {
      return toast('Esta aposta já foi cancelada.');
    }

    if (MP.backendAvailable && location.protocol !== 'file:') {
      try {
        const res = await fetch(`/api/room/${encodeURIComponent(S.room.code)}/cancel_bet`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId: S.user.id, betId })
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          if (data.player) {
            S.user.chips = r2(data.player.chips);
            S.user.committedChips = r2(data.player.committedChips || 0);
            S.user.totalBalance = r2(S.user.chips + S.user.committedChips);
            S.user.balanceVersion = data.player.balanceVersion;
            if (data.player.cashbox) S.user.cashbox = data.player.cashbox;
          }
          applyCancelBetToRoom(betId, S.user.id, S.user.chips, S.user.balanceVersion);
          saveCurrentUser(true, false);
          if (isAuthorizedCreator()) MP.broadcastState(S.room);
          toast(`Aposta cancelada! +${fmt(bet.amount)} fichas estornadas ao seu saldo.`, 'gold');
          updateHeaderAndRoomDOM();
          refreshUI();
          return;
        }
      } catch (e) {}
    }

    bet.cancelled = true;
    bet.status = 'CANCELLED';
    S.user.chips = r2(S.user.chips + bet.amount);
    S.user.balanceVersion = Number(S.user.balanceVersion || 1) + 1;

    ensureAccountIntegrity(S.user);
    applyCancelBetToRoom(betId, S.user.id, S.user.chips, S.user.balanceVersion);
    S.user.committedChips = getCommittedChipsInActiveRace(r, S.user.id);
    S.user.totalBalance = r2(S.user.chips + S.user.committedChips);
    S.user.cashbox.totalBet = r2(Math.max(0, S.user.cashbox.totalBet - bet.amount));
    const histEntry = S.user.cashbox.betHistory.find(h => h.id === betId);
    if (histEntry) {
      histEntry.status = 'cancelled';
    }
    recordFinancialTx(
      'tx_cancel_' + betId,
      'BET_CANCELLED',
      `Aposta Cancelada (${bet.driver})`,
      `Estorno imediato · ${r.circuit.name}`,
      +bet.amount
    );
    saveCurrentUser(true, true);

    if (isAuthorizedCreator()) {
      MP.broadcastState(S.room);
    } else {
      MP.sendAction({
        type: 'CANCEL_BET',
        playerId: S.user.id,
        betId,
        playerChips: S.user.chips,
        balanceVersion: S.user.balanceVersion,
        ts: Date.now()
      });
    }

    toast(`Aposta cancelada! +${fmt(bet.amount)} fichas estornadas ao seu saldo.`, 'gold');
    updateHeaderAndRoomDOM();
    refreshUI();
  }

  function applyCancelBetToRoom(betId, playerId, updatedChips, balanceVersion) {
    if (!S.room || !S.room.race) return;
    const r = S.room.race;
    if (r.done || r.running || !r.bettingOpen) return;
    const bet = r.bets.find(b => b.id === betId && b.pid === playerId);
    if (bet && !bet.locked) {
      bet.cancelled = true;
      bet.status = 'CANCELLED';
      r.bets = r.bets.filter(b => b.id !== betId);
    }
    const pl = S.room.players.find(p => p.id === playerId);
    if (pl && typeof updatedChips === 'number') {
      pl.chips = r2(updatedChips);
      if (balanceVersion) pl.balanceVersion = balanceVersion;
    }
  }

  /**
   * 9. TRATAMENTO DE SITUAÇÕES EXCEPCIONAIS: Cancelamento de corrida antes da largada (VOID)
   */
  function cancelRaceBeforeStart() {
    if (!S.room || !S.room.race) return;
    if (!isAuthorizedCreator()) {
      return toast('Apenas o criador autorizado da sala pode cancelar a corrida antes da largada.');
    }
    const r = S.room.race;
    if (r.started || r.running || r.done) {
      return toast('A corrida já foi iniciada e não pode mais ser cancelada como pré-largada.');
    }
    r.cancelled = true;
    r.done = true;
    r.running = false;
    r.bettingOpen = false;
    r.settlementId = r.settlementId || `stl_void_${r.id}_${Date.now()}`;
    pushEvent(r, 0, '🚫 Corrida cancelada antes da largada! Todas as apostas confirmadas foram marcadas como VOID e reembolsadas.', 's');

    r.bets.forEach(b => {
      if (b.cancelled) return;
      const outcome = FIN.evaluateTicketForRace(r, b);
      r.res[b.id] = outcome;
      b.status = 'VOID';
    });

    settleMyBetsForFinishedRace(r);
    MP.broadcastState(S.room);
    toast('Corrida cancelada! Apostas anuladas (VOID) e reembolsadas.', 'gold');
    refreshUI();
  }

  function finishRaceAuthoritative(r) {
    if (!r || r.done) return;
    r.done = true;
    r.running = false;
    r.bettingOpen = false;
    r.settlementId = r.settlementId || `stl_${r.id}_${Date.now()}`;
    const w = r.order[0];
    const dt = new Date().toLocaleDateString('pt-BR');

    pushEvent(r, r.total, `🏁 BANDEIRA QUADRICULADA! ${dv(w).name} (${w}) vence o GP de ${r.circuit.name}!`, 'g');

    const summaryRes = [];
    r.bets.forEach(b => {
      if (b.cancelled) return;
      const outcome = FIN.evaluateTicketForRace(r, b);
      if (!outcome) return;
      outcome.settlementId = `stl_${b.id}`;
      r.res[b.id] = outcome;
      b.status = outcome.status;
      summaryRes.push({
        pid: b.pid,
        name: b.playerName,
        modality: b.modality || 'overtake',
        driver: b.driver,
        market: b.market || null,
        amount: b.amount,
        status: outcome.status,
        ret: outcome.ret,
        net: outcome.net
      });
    });

    const PTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
    r.order.filter(i => r.drv[i] && r.drv[i].st === 'run').slice(0, 10).forEach((id, i) => {
      S.champ.d[id] = (S.champ.d[id] || 0) + PTS[i];
      const t = dv(id).team;
      S.champ.t[t] = (S.champ.t[t] || 0) + PTS[i];
    });
    S.champ.n = (S.champ.n || 0) + 1;

    S.history.unshift({
      raceId: r.id,
      settlementId: r.settlementId,
      circuit: r.circuit.name,
      winner: w,
      date: dt,
      res: summaryRes
    });
    saveGlobalHistory();

    settleMyBetsForFinishedRace(r);
  }

  function settleMyBetsForFinishedRace(r) {
    if (!r || (!r.done && !r.cancelled) || !S.user) return;
    // Do not settle without a reliable final classification unless race was cancelled before start
    if (!r.cancelled && (!Array.isArray(r.order) || r.order.length === 0)) return;

    ensureAccountIntegrity(S.user);

    // Reload latest account state from storage first to prevent cross-tab duplicate settlement
    const freshMap = loadAccountsMap();
    if (freshMap[S.user.id] && freshMap[S.user.id].settledBets) {
      S.user.settledBets = Object.assign({}, freshMap[S.user.id].settledBets, S.user.settledBets);
    }

    let anySettled = false;
    let totalNetThisRace = 0;

    r.bets.forEach(b => {
      if (!b || b.cancelled || b.pid !== S.user.id) return;
      if (S.user.settledBets[b.id]) return;

      const outcome = (r.res && r.res[b.id]) ? r.res[b.id] : FIN.evaluateTicketForRace(r, b);
      if (!outcome) return;

      const settlementId = outcome.settlementId || `stl_${b.id}`;
      S.user.settledBets[b.id] = {
        settlementId,
        status: outcome.status,
        ret: outcome.ret,
        net: outcome.net,
        ts: Date.now()
      };
      anySettled = true;

      if (outcome.ret > 0) {
        S.user.chips = r2(S.user.chips + outcome.ret);
        S.user.balanceVersion = Number(S.user.balanceVersion || 1) + 1;
      }

      const histEntry = S.user.cashbox.betHistory.find(h => h.id === b.id);

      if (outcome.voided || outcome.status === 'VOID') {
        S.user.cashbox.totalBet = r2(Math.max(0, S.user.cashbox.totalBet - b.amount));
        if (histEntry) {
          histEntry.status = 'void';
          histEntry.ret = outcome.ret;
          histEntry.net = 0;
        }
        recordFinancialTx(
          'tx_settle_' + b.id,
          'BET_VOID',
          `Aposta Anulada / VOID (${b.driver})`,
          `${r.circuit.name} · Reembolso integral (${outcome.reason === 'DRIVER_DNS' ? 'Piloto DNS' : 'Corrida Cancelada'})`,
          +outcome.ret
        );
      } else if (outcome.won) {
        S.user.wins = (S.user.wins || 0) + 1;
        S.user.cashbox.totalWon = r2(S.user.cashbox.totalWon + outcome.net);
        if (histEntry) {
          histEntry.status = 'won';
          histEntry.fin = outcome.fin;
          histEntry.actualOvertakes = outcome.actualOvertakes;
          histEntry.ret = outcome.ret;
          histEntry.net = outcome.net;
        }
        const winTitle = b.modality === 'placement'
          ? `Vitória em Colocação (${b.driver} · ${b.marketLabel || b.market})`
          : `Vitória em Ultrapassagens (${b.driver} · ${outcome.actualOvertakes} ULTs vs Exp ${outcome.expectedOvertakes})`;
        recordFinancialTx(
          'tx_settle_' + b.id,
          'RACE_WIN',
          winTitle,
          `${r.circuit.name} · Retorno: ${fmt(outcome.ret)} (Lucro Líquido: +${fmt(outcome.net)})`,
          +outcome.ret
        );
      } else {
        S.user.losses = (S.user.losses || 0) + 1;
        const lossAmt = Math.abs(outcome.net);
        S.user.cashbox.totalLost = r2(S.user.cashbox.totalLost + lossAmt);
        if (histEntry) {
          histEntry.status = 'lost';
          histEntry.fin = outcome.fin;
          histEntry.actualOvertakes = outcome.actualOvertakes;
          histEntry.ret = 0;
          histEntry.net = outcome.net;
        }
        const lossTitle = b.modality === 'placement'
          ? `Aposta Perdida · Colocação (${b.driver} · ${b.marketLabel || b.market})`
          : `Aposta Perdida · Ultrapassagens (${b.driver} · ${outcome.actualOvertakes ?? 0}/${outcome.expectedOvertakes ?? 0} ULTs)`;
        recordFinancialTx(
          'tx_settle_' + b.id,
          'RACE_LOSS',
          lossTitle,
          `${r.circuit.name} · Final: ${outcome.isDnf ? 'DNF' : outcome.fin + 'º Lugar'} · Valor apostado: ${fmt(b.amount)}`,
          0
        );
      }

      S.user.cashbox.netProfit = r2(S.user.cashbox.totalWon - S.user.cashbox.totalLost);
      totalNetThisRace = r2(totalNetThisRace + outcome.net);
    });

    S.user.committedChips = 0;
    S.user.totalBalance = r2(S.user.chips);

    if (anySettled) {
      saveCurrentUser(true, true);
      syncMyPlayerInRoom();
      const balanceEl = $('#header-balance-val');
      if (balanceEl) balanceEl.textContent = fmt(S.user.chips);
      updateHeaderAndRoomDOM();
      if (totalNetThisRace > 0) {
        toast(`🏆 Parabéns! Você obteve lucro líquido de +${fmt(totalNetThisRace)} fichas nesta corrida!`, 'gold');
      }
    }
  }

  /* =====================================================================
   * 6. INTERFACE & VIEWS
   * ===================================================================== */
  function go(viewName) {
    if (viewName === 'setup' && S.room && !isAuthorizedCreator()) {
      toast('Apenas o jogador autorizado (Criador da Sala) pode acessar a criação e configuração de corridas.');
      return;
    }
    S.view = viewName;
    if (viewName === 'admin' && S.admin.token) {
      fetchAdminPlayers(true);
    }
    render();
    window.scrollTo(0, 0);
  }

  function renderCircuitMiniSvg(c) {
    const pts = c.pts;
    const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ') + ' Z';
    return `<svg class="circuit-svg-preview" viewBox="-100 -70 200 140" preserveAspectRatio="xMidYMid meet">
      <path d="${pathD}" fill="none" stroke="rgba(225,6,0,0.45)" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"/>
      <path d="${pathD}" fill="none" stroke="#f4f6fb" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${pts[0][0]}" cy="${pts[0][1]}" r="5.5" fill="#ffc83d"/>
    </svg>`;
  }

  function renderHeader() {
    const u = S.user;
    const av = avObj(u.avatarId);
    const R = S.room;
    const amCreator = isAuthorizedCreator();

    const navItems = [
      ['home', 'Início'],
      ['room', 'Sala Multiplayer']
    ];
    // Only show "Criar Corrida / Circuito" tab to the single authorized creator (or when no room exists yet)
    if (!R || amCreator) {
      navItems.push(['setup', 'Circuito & Grid']);
    }
    navItems.push(
      ['race', 'Simulador 3D & Apostas'],
      ['wallet', 'Caixa de Fichas'],
      ['rank', 'Ranking'],
      ['admin', S.admin.authenticated ? '🛡️ Admin (LN)' : '🔒 Admin']
    );

    return `<header class="top-header">
      <div class="header-left">
        <div class="logo" onclick="F1App.go('home')"><i></i>F1 BETTING 3D</div>
        <nav class="main-nav">
          ${navItems.map(([id, label]) => `<button class="${S.view === id ? 'on' : ''}" onclick="F1App.go('${id}')">${label}</button>`).join('')}
        </nav>
      </div>
      <div class="header-right">
        ${R ? `<div class="room-badge mono" id="header-room-badge" onclick="F1App.go('room')" title="Sala Multiplayer Ativa">
          <span class="dot"></span>SALA ${esc(R.code)} · <span id="header-room-online-count">${getOnlinePlayers().length}</span>👤
        </div>` : ''}
        <div class="top-balance-hud" id="top-balance-hud" onclick="F1App.go('wallet')" style="cursor:pointer" title="Abrir Caixa de Fichas">
          <div class="bal-icon">🪙</div>
          <div class="bal-info">
            <span class="bal-label">Seu Saldo</span>
            <span class="bal-value mono" id="header-balance-val">${fmt(u.chips)}</span>
          </div>
        </div>
        <button class="profile-pill" onclick="F1App.openProfileModal()" title="Perfil do Jogador">
          <span class="av" style="background:${av.color};width:28px;height:28px;font-size:14px">${av.icon}</span>
          <b id="header-profile-name">${esc(u.name)}</b>
          <span class="mut" style="font-size:11px">⚙️</span>
        </button>
        <button class="btn ghost sm" onclick="F1App.toggleSpectator(true)" title="Modo Espectador">📺</button>
      </div>
    </header>`;
  }

  function renderProfileModal() {
    if (!S.profileModalOpen) return '';
    const accounts = Object.values(loadAccountsMap());

    return `<div class="modal-backdrop" onclick="if(event.target===this)F1App.closeProfileModal()">
      <div class="modal-card">
        <div class="row" style="justify-content:space-between;margin-bottom:12px">
          <h2>Perfil & Conta do Jogador</h2>
          <button class="btn ghost sm" onclick="F1App.closeProfileModal()">✕</button>
        </div>
        <p class="mut" style="font-size:13px;margin-top:0">Suas informações, avatar, saldo (inicial: 100 fichas) e Caixa de Fichas ficam salvos automaticamente.</p>
        <div style="margin-bottom:12px">
          <small class="mut">Nome de Login</small>
          <input id="prof-name-in" maxlength="18" value="${esc(S.profileDraftName)}" placeholder="Seu nome ou apelido" onkeydown="if(event.key==='Enter')F1App.saveProfileFromModal()">
        </div>
        <div>
          <small class="mut">Escolha seu Avatar</small>
          <div class="avatar-grid">
            ${AVATARS.map(a => `<div class="avatar-choice ${S.profileDraftAvatar === a.id ? 'on' : ''}" onclick="F1App.selectDraftAvatar('${a.id}')">
              <div style="font-size:22px">${a.icon}</div>
              <small style="font-size:10px;color:var(--mu)">${a.label}</small>
            </div>`).join('')}
          </div>
        </div>
        <div class="row" style="justify-content:flex-end;margin-top:10px">
          <button class="btn ghost" onclick="F1App.closeProfileModal()">Cancelar</button>
          <button class="btn ok" onclick="F1App.saveProfileFromModal()">💾 Salvar Perfil</button>
        </div>
        <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
        <h3>Contas Cadastradas neste Dispositivo</h3>
        <div style="display:flex;flex-direction:column;gap:6px;max-height:150px;overflow-y:auto;margin-top:8px">
          ${accounts.map(acc => {
            const av = avObj(acc.avatarId);
            const isCur = acc.id === S.user.id;
            return `<div class="pl" style="padding:6px 8px;background:var(--bg2);border-radius:8px;border:1px solid ${isCur ? 'var(--gold)' : 'var(--line)'}">
              <span class="av" style="background:${av.color};width:26px;height:26px;font-size:13px">${av.icon}</span>
              <div>
                <b>${esc(acc.name)}</b> ${isCur ? '<span class="chip" style="padding:1px 7px;font-size:10px;color:var(--gold)">ATIVA</span>' : ''}
                <small class="mut" style="display:block">ID: ${esc(acc.id.slice(0, 10))} · Saldo: ${fmt(acc.chips)} 🪙</small>
              </div>
              ${!isCur ? `<button class="btn ghost sm" style="margin-left:auto" onclick="F1App.switchAccount('${acc.id}')">Usar Conta</button>` : ''}
            </div>`;
          }).join('')}
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn ghost sm" style="width:100%" onclick="F1App.switchAccount('NEW')">➕ Criar Nova Conta Secundária (Saldo Inicial: 100 🪙)</button>
        </div>
      </div>
    </div>`;
  }

  function renderHomeView() {
    const u = S.user;
    const av = avObj(u.avatarId);
    return `<div class="hero">
      <div class="chip" style="margin-bottom:14px;border-color:var(--red)">🏎️ SIMULADOR 3D EM TEMPO REAL · MULTIPLAYER SINCRONIZADO</div>
      <h1>F1 <span>BETTING</span><br>SIMULATOR 3D</h1>
      <p>Crie sua sala, convide seus amigos por código ou link, acompanhe a corrida em 10 circuitos 3D exclusivos e aposte suas fichas virtuais em tempo real.</p>

      <div class="card gold-edge" style="max-width:580px;margin:0 auto 22px;text-align:left">
        <div class="row" style="justify-content:space-between">
          <div class="dr">
            <span class="av" style="background:${av.color};width:42px;height:42px;font-size:20px">${av.icon}</span>
            <div>
              <small class="mut">BEM-VINDO DE VOLTA</small>
              <div style="font-size:17px;font-weight:900">${esc(u.name)}</div>
            </div>
          </div>
          <div style="text-align:right">
            <small class="mut">SALDO DISPONÍVEL</small>
            <div class="mono" style="font-size:20px;font-weight:900;color:var(--gold)">${fmt(u.chips)} 🪙</div>
          </div>
          <button class="btn ghost sm no-flex" onclick="F1App.openProfileModal()">✏️ Editar Perfil</button>
        </div>
      </div>

      <div class="row row-stack-mobile" style="max-width:580px;margin:auto">
        <button class="btn" style="padding:13px 22px;font-size:14px" onclick="F1App.createRoom()">🏁 Criar Nova Sala</button>
        <input id="jc" placeholder="Código da sala (ex: ABC123)" maxlength="8" style="text-transform:uppercase;font-weight:800;letter-spacing:1.5px" onkeydown="if(event.key==='Enter')F1App.joinRoom()">
        <button class="btn ghost" style="padding:13px 20px" onclick="F1App.joinRoom()">Entrar na Sala</button>
      </div>

      ${S.room ? `<div style="margin-top:16px">
        <button class="btn gold" onclick="F1App.go('${S.room.race && !S.room.race.done ? 'race' : 'room'}')">↩ Voltar para Sala Ativa (${esc(S.room.code)})</button>
      </div>` : ''}

      <div class="stripe"></div>

      <div class="grid g3" style="text-align:left;margin-top:28px">
        <div class="card">
          <h3>🌐 Controle & Multiplayer</h3>
          Apenas o jogador autorizado (Criador da Sala) configura e inicia as corridas, enquanto todos apostam e assistem sincronizados.
        </div>
        <div class="card cyan-edge">
          <h3>🏎️ 10 Circuitos 3D Exclusivos</h3>
          Cada autódromo possui traçado, cores de zebras, vegetação e monumentos 3D próprios (Roda-gigante de Suzuka, Porto de Mônaco, Alpes, etc.).
        </div>
        <div class="card gold-edge">
          <h3>🛡️ Painel Administrativo</h3>
          Gestão completa de saldos autenticada no servidor para consultar, adicionar, remover ou definir fichas de qualquer jogador.
        </div>
      </div>
    </div>`;
  }

  function renderRoomPlayersListHTML(R) {
    const creatorId = R.creatorId || R.hostId;
    return R.players.map(p => {
      const isMe = p.id === S.user.id;
      const isCreator = p.id === creatorId;
      const av = avObj(p.avatarId);
      return `<div class="pl">
        <span class="av" style="background:${p.color || av.color}">${p.avatarIcon || av.icon}</span>
        <div>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <b>${esc(p.name)}</b>
            ${isMe ? '<span class="chip" style="padding:1px 7px;font-size:10px;border-color:var(--gold);color:var(--gold)">VOCÊ</span>' : ''}
            ${isCreator ? '<span class="chip" style="padding:1px 7px;font-size:10px;border-color:var(--ok);color:var(--ok)">👑 CRIADOR AUTORIZADO</span>' : '<span class="chip mut" style="padding:1px 7px;font-size:10px">PARTICIPANTE</span>'}
          </div>
          <small class="mut" style="display:flex;align-items:center;gap:5px;margin-top:2px">
            <span class="status-dot ${p.online !== false ? 'online' : 'offline'}"></span>
            ${p.online !== false ? 'Conectado em tempo real' : 'Desconectado (aguardando retorno)'}
          </small>
        </div>
        <span class="bal mono">${fmt(p.chips)} 🪙</span>
      </div>`;
    }).join('');
  }

  function renderRoomActionButtonsHTML(R) {
    const onlinePlayers = getOnlinePlayers(R);
    const canProceed = onlinePlayers.length >= MIN_PLAYERS_TO_START;
    const amCreator = isAuthorizedCreator();
    const creatorName = (R.players.find(p => p.id === (R.creatorId || R.hostId)) || {}).name || 'Líder';

    if (R.race && !R.race.done) {
      return `<button class="btn ok" onclick="F1App.go('race')">🏎️ Ir para Corrida em Andamento →</button>`;
    }

    if (!amCreator) {
      return `<div class="bet-summary-box" style="width:100%;margin:0;text-align:center">
        <b style="color:var(--gold)">⏳ Aguardando ${esc(creatorName)} (Criador Autorizado) configurar e abrir a corrida...</b>
        <small class="mut" style="display:block;margin-top:3px">Somente o jogador autorizado possui a opção de criar corridas neste lobby. Assim que a corrida for aberta, você será levado automaticamente para apostar e assistir!</small>
      </div>`;
    }

    return `<button class="btn" id="room-go-setup-btn" onclick="F1App.go('setup')" ${!canProceed ? 'disabled title="Conecte pelo menos 2 jogadores para configurar e iniciar a corrida"' : ''}>
      ${canProceed ? '🏁 Criar Corrida & Escolher Circuito →' : `Aguardando 2º Jogador (${onlinePlayers.length}/2)...`}
    </button>`;
  }

  function renderRoomView() {
    const R = S.room;
    if (!R) return renderNoRoomCard();

    const onlinePlayers = getOnlinePlayers(R);
    const canProceed = onlinePlayers.length >= MIN_PLAYERS_TO_START;
    const amCreator = isAuthorizedCreator();
    const creatorName = (R.players.find(p => p.id === (R.creatorId || R.hostId)) || {}).name || 'Host';
    const inviteUrl = `${location.origin}${location.pathname}?room=${encodeURIComponent(R.code)}`;
    const friendTestUrl = `${location.origin}${location.pathname}?room=${encodeURIComponent(R.code)}&newplayer=1`;

    return `<div class="grid g2">
      <div class="card gold-edge">
        <div class="row" style="justify-content:space-between">
          <h2>Lobby da Sala Multiplayer</h2>
          <span class="chip mono" style="color:var(--ok)">● SINCRONIZAÇÃO ATIVA</span>
        </div>
        <p class="mut" style="margin:4px 0 10px">Compartilhe o código ou o link de convite com seu amigo para participarem da mesma corrida:</p>
        <div class="code-box mono" id="room-code-display">${esc(R.code)}</div>
        <div class="row" style="margin-top:12px">
          <button class="btn" onclick="F1App.copyRoomCode()">📋 Copiar Código</button>
          <button class="btn ghost" onclick="F1App.copyInviteLink('${esc(inviteUrl)}')">🔗 Copiar Link de Convite</button>
          <button class="btn ghost" onclick="window.open('${esc(friendTestUrl)}', '_blank')" title="Abre uma 2ª aba já conectada nesta sala com um segundo jogador">👥 Abrir 2ª Aba (Amigo)</button>
        </div>
        <div class="bet-summary-box" style="margin-top:14px">
          <div class="row" style="justify-content:space-between">
            <span>Status do Lobby:</span>
            <b id="room-lobby-status-text" style="color:var(--${canProceed ? 'ok' : 'red2'})">
              ${canProceed ? `✓ ${onlinePlayers.length} jogadores conectados (Pronto!)` : `⏳ Aguardando jogadores (${onlinePlayers.length}/${MIN_PLAYERS_TO_START} conectados)`}
            </b>
          </div>
          <small class="mut" style="display:block;margin-top:4px">
            Permissão de Criação: <b style="color:var(--gold)">${esc(creatorName)}</b> ${amCreator ? '(Você possui autorização para criar corridas)' : '(Participante — você pode apostar e acompanhar)'}
          </small>
        </div>
        <div class="row" style="margin-top:12px;justify-content:space-between">
          <button class="btn ghost sm" onclick="F1App.leaveRoom()">🚪 Sair da Sala</button>
          <small class="mut">Criador Autorizado: <b id="room-creator-name">${esc(creatorName)}</b></small>
        </div>
      </div>

      <div class="card">
        <div class="row" style="justify-content:space-between">
          <h2 id="room-players-heading">Jogadores na Sala (${onlinePlayers.length} online / ${R.players.length} total)</h2>
          <button class="btn ghost sm" onclick="F1App.openProfileModal()">⚙️ Meu Perfil</button>
        </div>
        <div id="room-players-list" style="margin-top:10px">
          ${renderRoomPlayersListHTML(R)}
        </div>

        <div class="row" id="room-action-footer" style="margin-top:18px;justify-content:flex-end">
          ${renderRoomActionButtonsHTML(R)}
        </div>
      </div>
    </div>`;
  }

  function renderSetupView() {
    const R = S.room;
    if (!R) return renderNoRoomCard();

    if (!isAuthorizedCreator()) {
      const creatorName = (R.players.find(p => p.id === (R.creatorId || R.hostId)) || {}).name || 'Criador da Sala';
      return `<div class="card">
        <h2>🔒 Criação de Corridas Restrita</h2>
        <p class="mut">Somente o jogador autorizado (<b>${esc(creatorName)}</b>) tem permissão para criar e configurar corridas nesta sala.</p>
        <button class="btn" onclick="F1App.go('room')">← Voltar ao Lobby da Sala</button>
      </div>`;
    }

    const curCircuit = CIRCUITS.find(c => c.id === R.circuitId) || CIRCUITS[0];
    const onlineCount = getOnlinePlayers(R).length;
    const lapsVal = Math.max(MIN_RACE_LAPS, Math.min(MAX_RACE_LAPS, +(R.laps || curCircuit.laps)));
    const grid = R.grid || [];

    return `<div>
      <div class="row" style="justify-content:space-between;margin-bottom:12px">
        <div>
          <h2>Seleção de Circuito Real (${CIRCUITS.length} Pistas com Ambientação 3D Própria)</h2>
          <p class="mut" style="margin:0;font-size:13px">Você é o Criador Autorizado da sala. Escolha o circuito e configure a corrida.</p>
        </div>
        <span class="chip mono" id="setup-online-chip">Jogadores Conectados: <b style="color:var(--${onlineCount >= 2 ? 'ok' : 'red2'})">${onlineCount}/2 mín.</b></span>
      </div>

      <div class="grid g4" id="setup-circuits-grid">
        ${CIRCUITS.map(c => `<div class="circuit-card ${R.circuitId === c.id ? 'on' : ''}" data-cid="${c.id}" onclick="F1App.selectCircuit('${c.id}')">
          <div class="row" style="justify-content:space-between">
            <b>${c.flag} ${esc(c.name)}</b>
            <span class="chip mono" style="padding:2px 7px;font-size:10.5px">${c.km} km</span>
          </div>
          ${renderCircuitMiniSvg(c)}
          <small class="mut" style="font-size:11.5px;line-height:1.3">${esc(c.desc)}</small>
        </div>`).join('')}
      </div>

      <div class="grid g2" style="margin-top:20px">
        <div class="card">
          <h2>Parâmetros da Corrida</h2>
          <div class="row" style="margin-top:10px">
            <div>
              <small class="mut">Quantidade Total de Voltas (Mínimo: ${MIN_RACE_LAPS} · Máximo: ${MAX_RACE_LAPS})</small>
              <input id="setup-laps-in" type="number" min="${MIN_RACE_LAPS}" max="${MAX_RACE_LAPS}" value="${lapsVal}" onchange="F1App.updateLaps(this.value)" oninput="F1App.updateLaps(this.value)">
            </div>
            <div>
              <small class="mut">Condição Climática</small>
              <select id="setup-wx-select" onchange="F1App.updateWeather(this.value)">
                ${[['auto', '🌦️ Dinâmico / Automático'], ['dry', '☀️ Pista Seca'], ['rain', '🌧️ Chuva']].map(o => `<option value="${o[0]}" ${(R.wxMode || 'auto') === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="bet-summary-box" style="margin-top:12px">
            <div>⏱️ <b>Duração por volta:</b> ~30 segundos (movimentação 3D contínua e sincronizada)</div>
            <div>🔔 <b>Rodadas de apostas:</b> Pré-largada e a cada 10 voltas (encerramento definitivo por rodada)</div>
            <div>🎲 <b>Seed da corrida:</b> Gerada automaticamente de forma única pelo sistema</div>
            <div>👑 <b>Controle exclusivo:</b> Somente você (Criador Autorizado) pode iniciar a corrida</div>
          </div>
        </div>

        <div class="card">
          <div class="row" style="justify-content:space-between">
            <h2 id="setup-grid-count-heading">Pilotos & Equipes no Grid (${grid.length}/${DRIVERS.length})</h2>
            <div class="row no-flex">
              <button class="btn ghost sm" onclick="F1App.selectAllDrivers(true)">Todos (${DRIVERS.length})</button>
              <button class="btn ghost sm" onclick="F1App.selectAllDrivers(false)">Top 10</button>
            </div>
          </div>
          <div class="grid g2" id="setup-drivers-grid" style="max-height:240px;overflow-y:auto;margin-top:8px;gap:7px">
            ${DRIVERS.map(d => {
              const t = TEAMS[d.team];
              const isOn = grid.includes(d.id);
              return `<div class="opt ${isOn ? 'on' : ''}" data-did="${d.id}" style="padding:7px 10px" onclick="F1App.toggleDriver('${d.id}')">
                <div class="dr">
                  <span class="tm" style="background:${t.color};height:22px"></span>
                  <div>
                    <b>${d.id}</b> <span style="font-size:12.5px">${esc(d.name)}</span>
                    <small>${esc(t.name)}</small>
                  </div>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>

      <div class="row" style="margin-top:18px;justify-content:space-between">
        <button class="btn ghost" onclick="F1App.go('room')">← Voltar à Sala</button>
        <button class="btn ok" id="setup-prepare-btn" style="padding:13px 24px;font-size:14px" onclick="F1App.prepareRace()" ${onlineCount < MIN_PLAYERS_TO_START ? 'disabled' : ''}>
          🏁 Preparar Grid & Abrir Janela de Apostas (${lapsVal} Voltas)
        </button>
      </div>
    </div>`;
  }

  /**
   * Betting Driver Cards HTML:
   * Organized strictly according to the CURRENT RACE CLASSIFICATION (from 1st to last place)!
   */
  function renderBetDriverCardsHTML(r) {
    const orderedDrivers = (r.order && r.order.length ? r.order : r.start).slice();
    if (!orderedDrivers.includes(S.selectedBetDriver)) {
      S.selectedBetDriver = orderedDrivers[0];
    }

    if (S.betTab === 'placement' && !r.oddsBook) {
      r.oddsBook = FIN.calculateRaceOdds(r, { catalog: window.F1Tracks, champ: S.champ });
    }

    return orderedDrivers.map((id, idx) => {
      const d = dv(id);
      const t = TEAMS[d.team];
      const drvState = r.drv ? r.drv[id] : null;
      const isDnf = drvState && (drvState.st === 'dnf' || drvState.st === 'dns');
      const posNum = idx + 1;
      const isSel = S.selectedBetDriver === id;

      let subMeta = `<small class="mut" style="font-size:10px">${esc(t.name)}</small>`;
      if (S.betTab === 'placement' && r.oddsBook && r.oddsBook.drivers && r.oddsBook.drivers[id]) {
        const mInfo = r.oddsBook.drivers[id][S.selectedBetMarket];
        if (mInfo && mInfo.enabled) {
          subMeta = `<small class="mono" style="font-size:10.5px;color:var(--gold);font-weight:800">Odd: ${mInfo.odd.toFixed(2)}x · ${(mInfo.probability * 100).toFixed(1)}%</small>`;
        } else {
          subMeta = `<small class="mut" style="font-size:10px;color:var(--red2)">Indisponível (0%)</small>`;
        }
      } else {
        const expOv = FIN.calculateExpectedOvertakes(r, id, window.F1Tracks, S.champ);
        const curOv = drvState ? (drvState.ov || 0) : 0;
        subMeta = `<small class="mono" style="font-size:10px;color:var(--cyan)">Exp: ${expOv} ULTs · Pista: ${curOv}</small>`;
      }

      return `<div class="bet-driver-card ${isSel ? 'selected' : ''}" data-driver="${id}" style="${isDnf ? 'opacity:0.45' : ''}" onclick="F1App.selectBetDriver('${id}')">
        <span class="bet-pos-badge mono ${posNum <= 3 ? 'podium-' + posNum : ''}">${isDnf ? 'OUT' : posNum + 'º'}</span>
        <span class="tm" style="background:${t.color};height:28px"></span>
        <div style="min-width:0;flex:1">
          <div style="font-weight:900;font-size:13px">${id} <span class="mut" style="font-size:11px">#${d.num}</span></div>
          <div style="font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.name)}</div>
          ${subMeta}
        </div>
        ${isSel ? '<span class="sel-check">★</span>' : ''}
      </div>`;
    }).join('');
  }

  function renderPlacementMarketCardsHTML(r, driverId) {
    if (!r.oddsBook) {
      r.oddsBook = FIN.calculateRaceOdds(r, { catalog: window.F1Tracks, champ: S.champ });
    }
    const dOdds = (r.oddsBook.drivers && r.oddsBook.drivers[driverId]) || {};
    return Object.values(FIN.PLACEMENT_MARKETS).map(m => {
      const info = dOdds[m.id] || { enabled: false, odd: 0, probability: 0 };
      const isSel = S.selectedBetMarket === m.id;
      const disabled = !info.enabled || info.probability <= 0;
      return `<div class="market-card ${isSel ? 'selected' : ''} ${disabled ? 'disabled' : ''}" data-market="${m.id}" onclick="${disabled ? '' : `F1App.selectBetMarket('${m.id}')`}">
        <div class="row" style="justify-content:space-between;gap:4px">
          <b style="font-size:12px">${esc(m.shortLabel)}</b>
          <span class="mono" style="font-weight:900;font-size:13px;color:var(--${disabled ? 'mu' : 'gold'})">
            ${disabled ? 'BLOQ' : info.odd.toFixed(2) + 'x'}
          </span>
        </div>
        <div class="row" style="justify-content:space-between;gap:4px">
          <small class="mut" style="font-size:10px">${esc(m.desc)}</small>
          <small class="mono mut" style="font-size:10px">${disabled ? '0,0%' : (info.probability * 100).toFixed(1) + '%'}</small>
        </div>
      </div>`;
    }).join('');
  }

  /**
   * 10. PAINEL FINANCEIRO GERAL (EXIBIDO PERMANENTEMENTE)
   */
  function renderGeneralFinancialPanel(r) {
    const u = S.user;
    ensureAccountIntegrity(u);
    const exp = getMyRaceExposure(r);
    const activeMyBets = r && Array.isArray(r.bets)
      ? r.bets.filter(b => b && b.pid === u.id && !b.cancelled && b.status !== 'VOID')
      : [];
    const committedNow = r && !r.done && !r.cancelled ? exp.totalCommitted : 0;
    const totalBalance = r2(u.chips + committedNow);

    const wonCount = u.cashbox.betHistory.filter(b => b.status === 'won').length;
    const lostCount = u.cashbox.betHistory.filter(b => b.status === 'lost').length;
    const raceTxs = u.cashbox.financialHistory.filter(tx => r && tx.detail && tx.detail.includes(r.circuit.name)).slice(0, 6);

    return `<div class="card cyan-edge" id="general-financial-panel">
      <div class="row" style="justify-content:space-between;margin-bottom:6px">
        <h3>📊 Painel Financeiro Geral & Exposição (10%)</h3>
        <span class="chip mono" style="font-size:10.5px;padding:2px 8px">Fator F: 0,20 · Margem: 6%</span>
      </div>

      <div class="fin-mini-grid">
        <div class="fin-mini-item">
          <small>Saldo Total</small>
          <b class="mono">${fmt(totalBalance)} 🪙</b>
        </div>
        <div class="fin-mini-item">
          <small>Saldo Disponível</small>
          <b class="mono gold-tx">${fmt(u.chips)} 🪙</b>
        </div>
        <div class="fin-mini-item">
          <small>Fichas Comprometidas</small>
          <b class="mono" style="color:var(--cyan)">${fmt(committedNow)} 🪙</b>
        </div>
        <div class="fin-mini-item">
          <small>Limite de Exposição (10%)</small>
          <b class="mono">${fmt(exp.remainingExposure)} / ${fmt(exp.maxExposure)} 🪙</b>
        </div>
        <div class="fin-mini-item">
          <small>Apostado · Ultrapassagens</small>
          <b class="mono">${fmt(exp.committedOvertake)} 🪙</b>
        </div>
        <div class="fin-mini-item">
          <small>Apostado · Colocação</small>
          <b class="mono">${fmt(exp.committedPlacement)} 🪙</b>
        </div>
        <div class="fin-mini-item">
          <small>Apostas (Venc. / Perd.)</small>
          <b class="mono"><span class="ok">${wonCount}V</span> / <span class="bad">${lostCount}D</span></b>
        </div>
        <div class="fin-mini-item">
          <small>Lucro Líquido Acumulado</small>
          <b class="mono ${u.cashbox.netProfit >= 0 ? 'ok' : 'bad'}">${u.cashbox.netProfit >= 0 ? '+' : ''}${fmt(u.cashbox.netProfit)} 🪙</b>
        </div>
      </div>

      <div style="margin-top:10px">
        <small class="mut" style="font-weight:800;font-size:10.5px;text-transform:uppercase">Histórico Financeiro da Corrida (${activeMyBets.length} bilhetes ativos)</small>
        <div style="max-height:125px;overflow-y:auto;margin-top:4px">
          ${raceTxs.length ? raceTxs.map(tx => `<div class="ev" style="display:flex;justify-content:space-between;gap:6px;font-size:11.5px;padding:4px 0">
            <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(tx.title)}</span>
            <b class="mono" style="color:var(--${tx.amount > 0 ? 'ok' : tx.amount < 0 ? 'gold' : 'red2'})">${tx.amount > 0 ? '+' : ''}${fmt(tx.amount)} 🪙</b>
          </div>`).join('') : '<div class="mut" style="font-size:11.5px;padding:4px 0">Nenhuma transação registrada nesta corrida ainda.</div>'}
        </div>
      </div>
    </div>`;
  }

  function renderBettingPanel(r) {
    if (r.done || r.cancelled) return renderGeneralFinancialPanel(r);

    const curMult = mult(r.lap);
    const roundNum = Math.floor(r.lap / 10) + 1;
    const isPreRace = !r.started && Number(r.lap || 0) === 0;

    // Enforce rule Section 4: Final Placement bets are strictly closed after race start
    if (!isPreRace && S.betTab === 'placement') {
      S.betTab = 'overtake';
    }

    if (r.running || !r.bettingOpen) {
      const nextWindowLap = (Math.floor(r.lap / 10) + 1) * 10;
      const hasMoreWindows = nextWindowLap < r.total;
      return `<div class="card">
        <div class="row" style="justify-content:space-between">
          <h3>🔒 Janela de Apostas Encerrada</h3>
          <span class="chip mono">Rodada ${roundNum}</span>
        </div>
        <p class="mut" style="margin:6px 0 0;font-size:13px">
          ${r.running
            ? (hasMoreWindows
                ? `Corrida em andamento! Uma nova rodada de apostas de Ultrapassagens abrirá ao completar a <b>Volta ${nextWindowLap}</b>.`
                : `Corrida no trecho final! As apostas estão bloqueadas até a bandeira quadriculada.`)
            : `O período de apostas desta rodada foi encerrado definitivamente e não pode ser reaberto.`}
        </p>
      </div>
      <div style="margin-top:12px">${renderGeneralFinancialPanel(r)}</div>`;
    }

    const orderedDrivers = (r.order && r.order.length ? r.order : r.start).slice();
    if (!orderedDrivers.includes(S.selectedBetDriver)) {
      S.selectedBetDriver = orderedDrivers[0];
    }
    const selDrv = dv(S.selectedBetDriver);
    const selTeam = TEAMS[selDrv.team];
    const selPos = orderedDrivers.indexOf(S.selectedBetDriver) + 1;
    const exp = getMyRaceExposure(r);
    const maxAllowedBet = Math.max(0, r2(Math.min(S.user.chips, exp.remainingExposure)));
    const amt = r2(Math.max(0, +S.betAmountInput || Math.min(10, maxAllowedBet || 10)));

    return `<div class="card gold-edge" id="betting-form-card">
      <div class="row" style="justify-content:space-between">
        <h3>🪙 Painel de Apostas · Rodada ${roundNum} (${isPreRace ? 'Pré-Largada' : 'Volta ' + r.lap})</h3>
        <span class="chip mono" style="border-color:var(--gold);color:var(--gold)">
          Limite 10%: ${fmt(exp.remainingExposure)} / ${fmt(exp.maxExposure)} 🪙
        </span>
      </div>

      <div class="bet-tabs">
        <button type="button" class="bet-tab-btn ${S.betTab === 'overtake' ? 'on' : ''}" onclick="F1App.setBetTab('overtake')">
          ⚔️ Aba 1 · Ultrapassagens (${vm(curMult)})
        </button>
        <button type="button" class="bet-tab-btn ${S.betTab === 'placement' ? 'on' : ''}" onclick="F1App.setBetTab('placement')" ${!isPreRace ? 'disabled title="Encerrado após a largada"' : ''}>
          🏆 Aba 2 · Colocação Final ${!isPreRace ? '🔒' : ''}
        </button>
      </div>

      <small class="mut" style="display:block;margin-top:2px">
        1. Seleção de Piloto (ordenados pela classificação atual da corrida):
      </small>

      <div class="bet-driver-grid" id="bet-driver-table">
        ${renderBetDriverCardsHTML(r)}
      </div>

      ${S.betTab === 'placement' ? `
        <small class="mut" style="display:block;margin-top:6px">
          2. Seleção de Mercado & Odds Dinâmicas (1.000 simulações · Margem 6%):
        </small>
        <div class="market-grid" id="bet-market-grid">
          ${renderPlacementMarketCardsHTML(r, S.selectedBetDriver)}
        </div>
      ` : ''}

      <div class="bet-summary-box" id="selected-bet-preview">
        ${renderSelectedBetPreviewHTML(r, selDrv, selTeam, selPos, curMult)}
      </div>

      <div>
        <div class="row" style="justify-content:space-between;margin-bottom:4px">
          <small class="mut">${S.betTab === 'placement' ? '3.' : '2.'} Valor da Aposta (Limite Disp. na Corrida: <b class="mono" style="color:var(--cyan)" id="bet-exp-avail">${fmt(exp.remainingExposure)} 🪙</b>)</small>
          <small class="mono" style="color:var(--gold)">Disponível: <span id="bet-panel-balance">${fmt(S.user.chips)}</span> 🪙</small>
        </div>
        <div class="quick-chips">
          ${[1, 2, 5, 10, 25, 50, 100].map(v => `<button type="button" class="quick-chip mono" onclick="F1App.setBetAmount(${v})">${fmt(v)}</button>`).join('')}
          ${exp.remainingExposure > 0 ? `<button type="button" class="quick-chip mono" style="border-color:var(--cyan);color:var(--cyan)" onclick="F1App.setBetAmount(${exp.remainingExposure})">MÁX 10% (${fmt(exp.remainingExposure)})</button>` : ''}
        </div>
        <div class="row" style="margin-top:6px">
          <input id="bet-amount-input" type="number" min="0.5" max="${Math.max(1, exp.maxExposure)}" step="1" value="${amt}" oninput="F1App.onBetAmountInput(this.value)">
          <button class="btn gold" id="confirm-bet-btn" onclick="F1App.placeBet()" ${exp.remainingExposure <= 0 ? 'disabled title="Limite de 10% de exposição atingido nesta corrida"' : ''}>
            ✓ Confirmar Aposta
          </button>
        </div>
      </div>

      <div class="bet-summary-box" id="bet-calc-details" style="margin-top:10px;margin-bottom:0">
        ${renderBetCalculationDetails(amt, curMult, selDrv, selPos, r)}
      </div>
    </div>
    <div style="margin-top:12px">${renderGeneralFinancialPanel(r)}</div>`;
  }

  function renderSelectedBetPreviewHTML(r, selDrv, selTeam, selPos, curMult) {
    const drvState = (r.drv && r.drv[selDrv.id]) || {};
    if (S.betTab === 'placement') {
      if (!r.oddsBook) r.oddsBook = FIN.calculateRaceOdds(r, { catalog: window.F1Tracks, champ: S.champ });
      const mObj = FIN.PLACEMENT_MARKETS[S.selectedBetMarket] || FIN.PLACEMENT_MARKETS.P1;
      const mInfo = (r.oddsBook.drivers && r.oddsBook.drivers[selDrv.id] && r.oddsBook.drivers[selDrv.id][mObj.id]) || { odd: 0, probability: 0, enabled: false };
      return `<div class="row" style="justify-content:space-between">
        <div class="dr">
          <span class="tm" style="background:${selTeam.color};height:28px"></span>
          <div>
            <small class="mut">COLOCAÇÃO FINAL · ${esc(mObj.label.toUpperCase())}</small>
            <div style="font-weight:900;color:var(--gold)">${selDrv.id} · ${esc(selDrv.name)} (${selPos}º no Grid)</div>
          </div>
        </div>
        <div style="text-align:right">
          <span class="chip mono" style="border-color:var(--gold);color:var(--gold)">Odd ${mInfo.enabled ? mInfo.odd.toFixed(2) + 'x' : 'INDISP.'}</span>
          <small class="mut mono" style="display:block;font-size:10px;margin-top:2px">Prob. Estimada: ${(mInfo.probability * 100).toFixed(1)}%</small>
        </div>
      </div>`;
    }

    const expOv = FIN.calculateExpectedOvertakes(r, selDrv.id, window.F1Tracks, S.champ);
    const curOv = Number(drvState.ov || 0);
    return `<div class="row" style="justify-content:space-between">
      <div class="dr">
        <span class="tm" style="background:${selTeam.color};height:28px"></span>
        <div>
          <small class="mut">ULTRAPASSAGENS NA PISTA (${selPos}º COLOCADO)</small>
          <div style="font-weight:900;color:var(--gold)">${selDrv.id} · ${esc(selDrv.name)} (${esc(selTeam.name)})</div>
          <small class="mono" style="color:var(--cyan);font-size:11px">Expectativa (E): <b>${expOv} ULTs</b> · Realizadas na corrida: <b>${curOv} ULTs</b></small>
        </div>
      </div>
      <span class="chip mono" style="border-color:var(--gold);color:var(--gold)">Mult ${vm(curMult)}</span>
    </div>`;
  }

  function renderBetCalculationDetails(amount, curMult, selDrv, selPos, raceRef) {
    const r = raceRef || (S.room ? S.room.race : null);
    const a = r2(Math.max(0, +amount || 0));
    const exp = getMyRaceExposure(r);

    if (S.betTab === 'placement' && r) {
      if (!r.oddsBook) r.oddsBook = FIN.calculateRaceOdds(r, { catalog: window.F1Tracks, champ: S.champ });
      const mObj = FIN.PLACEMENT_MARKETS[S.selectedBetMarket] || FIN.PLACEMENT_MARKETS.P1;
      const mInfo = (r.oddsBook.drivers && r.oddsBook.drivers[selDrv.id] && r.oddsBook.drivers[selDrv.id][mObj.id]) || { odd: 0, probability: 0, enabled: false };
      const potReturn = mInfo.enabled ? r2(a * mInfo.odd) : 0;
      const potProfit = mInfo.enabled ? r2(potReturn - a) : 0;

      return `<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px">
        <span>Valor Apostado: <b class="mono" style="color:var(--gold)">${fmt(a)} 🪙</b></span>
        <span>Mercado: <b>${esc(mObj.shortLabel)}</b></span>
        <span>Odd: <b class="mono" style="color:var(--gold)">${mInfo.enabled ? mInfo.odd.toFixed(2) + 'x' : '—'}</b> (${(mInfo.probability * 100).toFixed(1)}%)</span>
      </div>
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:6px;padding-top:6px;border-top:1px solid var(--line)">
        <span>Retorno Potencial Total: <b class="mono ok">${fmt(potReturn)} 🪙</b></span>
        <span>Lucro Líquido Potencial: <b class="mono ok">+${fmt(potProfit)} 🪙</b></span>
        <span>Se perder: <b class="mono bad">-${fmt(a)} 🪙</b></span>
      </div>`;
    }

    const expOv = r ? FIN.calculateExpectedOvertakes(r, selDrv.id, window.F1Tracks, S.champ) : 2;
    const p1 = FIN.calculateOvertakePayout(a, expOv + 1, expOv, curMult, FIN.OVERTAKE_FACTOR_F);
    const p3 = FIN.calculateOvertakePayout(a, expOv + 3, expOv, curMult, FIN.OVERTAKE_FACTOR_F);
    const p5 = FIN.calculateOvertakePayout(a, expOv + 5, expOv, curMult, FIN.OVERTAKE_FACTOR_F);
    const maxCap = r2(a * FIN.MAX_OVERTAKE_RETURN_MULT);

    return `<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px">
      <span>Valor (S): <b class="mono" style="color:var(--gold)">${fmt(a)} 🪙</b></span>
      <span>Expectativa (E): <b class="mono" style="color:var(--cyan)">${expOv} ULTs</b></span>
      <span>Mult (M): <b>${vm(curMult)}</b> · Fator (F): <b>0,20</b></span>
    </div>
    <div class="mut" style="font-size:11.5px;margin-top:6px;line-height:1.45">
      <div>Fórmula: <b>Lucro = S × max(0, O - E) × 0,20 × M</b> (Vence somente se <b>O &gt; ${expOv}</b>; se O ≤ ${expOv}, retorno = 0):</div>
      <div style="margin-top:3px">
        • <b>${expOv + 1} ULTs (+1 exc.):</b> Retorno <b class="mono ok">${fmt(p1.totalReturn)}</b> (Lucro <b class="mono ok">+${fmt(p1.profit)}</b>) ·
        <b>${expOv + 3} ULTs (+3 exc.):</b> Retorno <b class="mono ok">${fmt(p3.totalReturn)}</b> (Lucro <b class="mono ok">+${fmt(p3.profit)}</b>) ·
        <b>${expOv + 5} ULTs (+5 exc.):</b> Retorno <b class="mono ok">${fmt(p5.totalReturn)}</b> (Lucro <b class="mono ok">+${fmt(p5.profit)}</b>)
      </div>
      <div style="font-size:10.5px;margin-top:2px">Teto máximo por bilhete (5x): <b class="mono">${fmt(maxCap)} 🪙</b> · Limite de exposição disponível: <b class="mono">${fmt(exp.remainingExposure)} 🪙</b></div>
    </div>`;
  }

  function renderBetsList(r) {
    const activeBets = (r.bets || []).filter(b => !b.cancelled);
    if (!activeBets.length) {
      return '<div class="slot">Nenhuma aposta ativa nesta corrida.</div>';
    }
    return activeBets.slice().reverse().map(b => {
      const isMine = b.pid === S.user.id;
      const canCancel = isMine && r.bettingOpen && !r.running && !r.done && !r.cancelled && !b.locked;
      const res = r.res && r.res[b.id];
      const drv = dv(b.driver);
      const team = TEAMS[drv.team];
      const isPlacement = b.modality === 'placement';

      let metaLine = '';
      if (isPlacement) {
        metaLine = `🏆 Colocação: <b>${esc(b.marketLabel || b.market)}</b> · Odd: <b>${Number(b.odd || 1).toFixed(2)}x</b> (${((b.probability || 0) * 100).toFixed(1)}%)`;
      } else {
        const liveOv = FIN.countValidOvertakesForBet(r, b).count;
        metaLine = `⚔️ ULTs (${b.lap ? 'V' + b.lap : 'Largada'}) · Exp (E): <b>${b.expectedOvertakes ?? 0}</b> · Real (O): <b>${res && res.actualOvertakes !== undefined ? res.actualOvertakes : liveOv}</b> · Mult: <b>${vm(b.mult || 1)}</b>`;
      }

      let statusText = '';
      if (res) {
        if (res.status === 'VOID' || res.voided) {
          statusText = ` · <b style="color:var(--gold)">VOID (Reembolsada: ${fmt(res.ret)})</b>`;
        } else {
          statusText = ` · Final: ${res.isDnf ? 'DNF' : res.fin + 'º'} · Retorno: <b>${fmt(res.ret)}</b> (Lucro: ${res.net >= 0 ? '+' : ''}${fmt(res.net)})`;
        }
      } else {
        statusText = (b.locked || !r.bettingOpen) ? ' · 🔒 Confirmada' : ' · 🟢 Confirmada';
      }

      return `<div class="pl" style="gap:8px">
        <span class="av" style="background:${b.playerColor || '#e10600'};width:30px;height:30px;font-size:14px">${b.playerAvatar || '🏎️'}</span>
        <div style="min-width:0;flex:1">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <b>${esc(b.playerName)}</b>
            ${isMine ? '<span class="chip" style="padding:0 6px;font-size:10px;color:var(--gold)">SUA</span>' : ''}
            <span class="mut">→</span>
            <span style="display:inline-flex;align-items:center;gap:4px;font-weight:900">
              <span style="width:4px;height:14px;background:${team.color};display:inline-block;border-radius:2px"></span>
              ${b.driver}
            </span>
          </div>
          <small class="mut" style="display:block;line-height:1.35">
            ${metaLine}${statusText}
          </small>
        </div>
        <div style="text-align:right;display:flex;align-items:center;gap:8px">
          <span class="bal mono" style="${res ? 'color:var(--' + (res.status === 'VOID' ? 'gold' : res.net > 0 ? 'ok' : 'red2') + ')' : ''}">
            ${res ? (res.status === 'VOID' ? 'VOID ' + fmt(res.ret) : (res.net > 0 ? '+' : '') + fmt(res.net)) : fmt(b.amount) + ' 🪙'}
          </span>
          ${canCancel ? `<button class="btn ghost sm" style="border-color:var(--red2);color:var(--red2);padding:4px 8px" onclick="F1App.cancelBet('${b.id}')" title="Retirar aposta e estornar saldo">✕</button>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  function renderClassificationTower(r) {
    const lead = r.drv[r.order[0]];
    return `<div style="overflow-x:auto">
      <table class="tower mono">
        <thead>
          <tr>
            <th>POS</th>
            <th>PILOTO</th>
            <th>PNEU</th>
            <th>+/-</th>
            <th style="text-align:right">DIFERENÇA</th>
          </tr>
        </thead>
        <tbody>
          ${r.order.map((id, i) => {
            const d = r.drv[id];
            const drv = dv(id);
            const t = TEAMS[drv.team];
            const run = d.st === 'run';
            const dl = d.gp - (i + 1);
            const isSel = S.highlightedDriver === id;
            const gap = !run
              ? `<span class="bad">${esc(d.why || 'OUT')}</span>`
              : i === 0
                ? '<b style="color:var(--gold)">LÍDER</b>'
                : `+${Math.max(0.1, d.t - lead.t).toFixed(1)}s`;

            return `<tr class="${isSel ? 'row-selected' : ''}" style="${run ? '' : 'opacity:0.45'}" onclick="F1App.highlightDriver('${id}')" title="Clique para destacar ${esc(drv.name)} no circuito 3D">
              <td class="pos">${String(i + 1).padStart(2, '0')}</td>
              <td>
                <div class="dr">
                  <span class="tm" style="background:${t.color};height:22px"></span>
                  <div>
                    <b>${id}</b> <span class="mut" style="font-size:11.5px">${esc(drv.name.split(' ').pop())}</span>
                    ${isSel ? '<span style="color:var(--gold);font-size:11px;margin-left:4px">★</span>' : ''}
                  </div>
                </div>
              </td>
              <td>${run ? `<span class="tyre-badge t-${d.tyre}">${d.tyre}</span>` : '—'}</td>
              <td style="color:var(--${dl > 0 ? 'ok' : dl < 0 ? 'red2' : 'mu'});font-weight:700">${dl > 0 ? '▲' + dl : dl < 0 ? '▼' + (-dl) : '–'}</td>
              <td style="text-align:right">${gap}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  }

  function renderSelectedDriverTelemetryHUD(r) {
    const selId = S.highlightedDriver;
    if (!selId || !r.drv[selId]) {
      return `<div class="chip" style="background:rgba(10,12,18,0.82);backdrop-filter:blur(6px)">
        💡 Clique em um carrinho ou piloto para destacá-lo na pista 3D
      </div>`;
    }
    const d = r.drv[selId];
    const drv = dv(selId);
    const team = TEAMS[drv.team];
    const pos = posOf(r, selId);
    const lead = r.drv[r.order[0]];
    const gap = d.st !== 'run' ? 'ABANDONOU' : pos === 1 ? 'LÍDER DA CORRIDA' : `+${Math.max(0.1, d.t - lead.t).toFixed(1)}s`;
    const speedKmh = d.st !== 'run' || !r.running ? 0 : Math.round(285 + Math.sin(Date.now() * 0.004 + pos) * 32 - (r.sc.type ? 95 : 0));

    return `<div class="selected-driver-telemetry">
      <span class="tm" style="background:${team.color};height:34px;width:6px"></span>
      <div>
        <div style="font-size:10px;color:var(--gold);font-weight:900;letter-spacing:1px">★ CORREDOR DESTACADO · P${pos}</div>
        <div style="font-size:14.5px;font-weight:900">${drv.id} · ${esc(drv.name)} <span class="mut" style="font-size:12px">(${esc(team.name)})</span></div>
      </div>
      <div class="mono" style="font-size:12px">
        <div>Pneu: <b style="color:var(--gold)">${d.tyre}</b> (${d.age}v)</div>
        <div>Gap: <b>${gap}</b></div>
      </div>
      <div class="mono" style="font-size:13px;font-weight:900;color:var(--cyan)">
        ${speedKmh} km/h
      </div>
      <button class="btn ghost sm" onclick="F1App.setCameraMode('chase')" title="Focar Câmera 3D atrás deste carro">🎥 Seguir</button>
      <button class="btn ghost sm" onclick="F1App.highlightDriver(null)" title="Remover destaque">✕</button>
    </div>`;
  }

  /**
   * Race Controls Bar:
   * - Only the authorized creator can close the betting window or start/resume the race.
   * - Once betting window is closed (`!r.bettingOpen`), there is NO button or option to reopen it!
   */
  function renderRaceControlsBar(r) {
    const onlineCount = getOnlinePlayers().length;
    const amCreator = isAuthorizedCreator();
    const hasEnoughPlayers = onlineCount >= MIN_PLAYERS_TO_START;
    const hasValidLaps = r.total >= MIN_RACE_LAPS;
    const windowClosed = !r.bettingOpen;

    if (!amCreator) {
      return `<div class="card" style="margin-top:12px;padding:12px 16px">
        <div class="row" style="justify-content:space-between">
          <span>Status da Sessão Multiplayer:</span>
          <b style="color:var(--gold)">
            ${r.running ? '🟢 Corrida em andamento (Sincronizada em Tempo Real)' : r.bettingOpen ? '🪙 Janela de apostas aberta — Faça suas apostas!' : '🔒 Apostas encerradas — Aguardando o criador iniciar a largada'}
          </b>
        </div>
      </div>`;
    }

    return `<div class="card" style="margin-top:12px;padding:14px 16px">
      <div class="row" style="justify-content:space-between;margin-bottom:10px">
        <div>
          <h3 style="margin:0;color:var(--tx)">Painel de Controle da Corrida (Criador Autorizado)</h3>
          <small class="mut">O encerramento das apostas é definitivo para a rodada atual:</small>
        </div>
        <div class="row no-flex" style="gap:6px">
          <span class="chip" style="border-color:var(--${hasEnoughPlayers ? 'ok' : 'red2'});color:var(--${hasEnoughPlayers ? 'ok' : 'red2'})">
            ${hasEnoughPlayers ? '✓' : '✗'} ${onlineCount}/2 Jogadores Online
          </span>
          <span class="chip" style="border-color:var(--${hasValidLaps ? 'ok' : 'red2'});color:var(--${hasValidLaps ? 'ok' : 'red2'})">
            ${hasValidLaps ? '✓' : '✗'} ${r.total} Voltas (Mín. 5)
          </span>
          <span class="chip" style="border-color:var(--${windowClosed ? 'ok' : 'gold'});color:var(--${windowClosed ? 'ok' : 'gold'})">
            ${windowClosed ? '🔒 Apostas Encerradas' : '🟢 Apostas Abertas'}
          </span>
        </div>
      </div>

      <div class="row">
        ${r.running
          ? `<button class="btn ghost" onclick="F1App.pauseRace()">⏸ Pausar Simulação</button>`
          : r.bettingOpen
            ? `<button class="btn gold" id="close-betting-btn" onclick="F1App.closeBettingWindow()">🔒 1. Encerrar Apostas Definitivamente</button>
               <button class="btn" id="start-race-btn" disabled title="Encerre o período de apostas primeiro antes de iniciar a largada">🚦 2. ${!r.started ? 'Autorizar Largada' : 'Retomar Corrida'}</button>
               ${!r.started ? `<button class="btn ghost sm" style="border-color:var(--red2);color:var(--red2)" onclick="F1App.cancelRaceBeforeStart()" title="Cancela a corrida antes da largada e estorna apostas como VOID">🚫 Cancelar Corrida (VOID)</button>` : ''}`
            : `<button class="btn ok" id="start-race-btn" onclick="F1App.startOrResumeRace()" ${(!hasEnoughPlayers || !hasValidLaps) ? 'disabled' : ''}>
                 🚦 ${!r.started ? 'Autorizar Largada (Iniciar Corrida 3D)' : `Retomar Corrida (Volta ${r.lap + 1})`}
               </button>
               ${!r.started ? `<button class="btn ghost sm" style="border-color:var(--red2);color:var(--red2)" onclick="F1App.cancelRaceBeforeStart()">🚫 Cancelar Corrida (VOID)</button>` : ''}`
        }
      </div>
    </div>`;
  }

  function renderRaceView() {
    const R = S.room;
    if (!R) return renderNoRoomCard();
    const r = R.race;
    if (!r) {
      const amCreator = isAuthorizedCreator();
      return `<div class="card">
        <h2>Simulador de Corridas 3D</h2>
        <p class="mut">${amCreator ? 'Nenhuma corrida preparada ainda nesta sala. Configure o circuito e as voltas para abrir o grid.' : 'Aguardando o criador autorizado da sala configurar e iniciar a próxima corrida.'}</p>
        ${amCreator ? `<button class="btn" onclick="F1App.go('setup')">Configurar Corrida →</button>` : `<button class="btn ghost" onclick="F1App.go('room')">← Voltar ao Lobby</button>`}
      </div>`;
    }

    if (r.done) {
      return renderRaceResultView(r);
    }

    const totalPct = Math.min(100, ((Math.max(0, r.lap - (r.running ? 1 : 0)) + (r.lapProgress || 0)) / r.total) * 100);
    const remSec = Math.max(0, Math.ceil(((1 - (r.lapProgress || 0)) * (r.lapDurationMs || LAP_DURATION_MS)) / 1000));
    const camMode = SIM3D.cameraMode || 'panorama';

    // Reset cache signatures on fresh race view render
    S._lastEventsSig = getEventsSignature(r);
    S._lastTowerSig = '';
    S._lastBetsSig = '';
    S._lastBetDriverOrderSig = (r.order || []).join(',');

    return `<div class="race-workspace">
      <div>
        <div class="sim3d-stage-card">
          <div class="sim3d-topbar">
            <div class="sim3d-title-group">
              <div>
                <div style="font-size:11px;font-weight:800;color:var(--red2);letter-spacing:1.2px;text-transform:uppercase">
                  ${r.running ? '<span class="live"></span>SIMULAÇÃO 3D AO VIVO' : r.bettingOpen ? '🪙 JANELA DE APOSTAS ABERTA' : '🚦 APOSTAS ENCERRADAS · PRONTO PARA LARGADA'}
                </div>
                <h2 style="margin:0;font-size:22px">${r.circuit.flag || '🏁'} ${esc(r.circuit.name)} <span class="mut" style="font-size:13px;font-weight:600">· ${r.circuit.km} km</span></h2>
              </div>
              <span class="chip" id="race-wx-badge">${wxBadge(r)}</span>
            </div>

            <div class="row no-flex" style="gap:12px">
              <div style="text-align:right">
                <small class="mut" style="display:block;font-size:10.5px">TEMPO DA VOLTA (~30s)</small>
                <b class="mono" id="lap-timer-label" style="font-size:13.5px;color:var(--cyan)">
                  ${r.running ? `Próxima volta em 0:${String(remSec).padStart(2, '0')}` : 'Aguardando largada'}
                </b>
              </div>
              <div class="sim3d-lap-counter mono">
                <span class="lap-num" id="race-lap-num">${r.lap}</span>
                <span class="lap-tot">/ ${r.total} VOLTAS</span>
              </div>
            </div>
          </div>

          <div class="bar" style="border-radius:0;border:0;height:6px">
            <b id="race-progress-bar" style="width:${totalPct.toFixed(1)}%"></b>
          </div>

          <div class="sim3d-viewport">
            <div id="sim3d-mount" style="width:100%;height:100%"></div>

            <div class="sim3d-hud-overlay">
              <div class="sim3d-hud-top">
                <div class="cam-toolbar">
                  <button class="cam-btn ${camMode === 'panorama' ? 'on' : ''}" onclick="F1App.setCameraMode('panorama')">🏟️ Panorâmica 3D</button>
                  <button class="cam-btn ${camMode === 'chase' ? 'on' : ''}" onclick="F1App.setCameraMode('chase')">🏎️ Perseguição</button>
                  <button class="cam-btn ${camMode === 'heli' ? 'on' : ''}" onclick="F1App.setCameraMode('heli')">🚁 Helicóptero</button>
                  <button class="cam-btn ${camMode === 'top' ? 'on' : ''}" onclick="F1App.setCameraMode('top')">🛰️ Aérea</button>
                </div>
                <div class="chip mono" style="background:rgba(10,12,18,0.85)">
                  👥 <span id="race-sync-players-count">${getOnlinePlayers().length}</span> Jogadores Sincronizados
                </div>
              </div>

              <div class="sim3d-hud-bottom">
                <div id="selected-driver-hud">${renderSelectedDriverTelemetryHUD(r)}</div>
              </div>
            </div>
          </div>

          <div class="driver-selector-strip" id="driver-highlight-strip">
            <small class="mut" style="white-space:nowrap;font-weight:800;margin-right:4px">DESTACAR CORREDOR:</small>
            <button class="drv-pill ${!S.highlightedDriver ? 'on' : ''}" onclick="F1App.highlightDriver(null)">Todos</button>
            ${r.order.map(id => {
              const t = TEAMS[dv(id).team];
              const isOn = S.highlightedDriver === id;
              return `<button class="drv-pill ${isOn ? 'on' : ''}" onclick="F1App.highlightDriver('${id}')">
                <span style="width:4px;height:12px;background:${t.color};border-radius:2px;display:inline-block"></span>
                ${id}
              </button>`;
            }).join('')}
          </div>
        </div>

        <div id="race-controls-bar-wrap">${renderRaceControlsBar(r)}</div>

        <div class="grid g2" style="margin-top:14px">
          <div class="card">
            <div class="row" style="justify-content:space-between">
              <h3 id="race-bets-heading">Apostas Registradas (${(r.bets || []).filter(b => !b.cancelled).length})</h3>
              <small class="mut">${r.bettingOpen && !r.running ? 'Cancelamento liberado' : 'Apostas bloqueadas'}</small>
            </div>
            <div id="race-bets-list" style="max-height:260px;overflow-y:auto;margin-top:6px">
              ${renderBetsList(r)}
            </div>
          </div>

          <div class="card">
            <h3>Acontecimentos da Corrida</h3>
            <div id="race-events-list" style="max-height:260px;overflow-y:auto;margin-top:6px">
              ${renderEventsList(r)}
            </div>
          </div>
        </div>
      </div>

      <div class="grid" style="gap:14px">
        <div id="race-betting-panel">${renderBettingPanel(r)}</div>

        <div class="card">
          <div class="row" style="justify-content:space-between;margin-bottom:6px">
            <h3>Classificação Ao Vivo</h3>
            <small class="mut">Clique no piloto para destacar em 3D</small>
          </div>
          <div id="race-tower-wrap">
            ${renderClassificationTower(r)}
          </div>
        </div>
      </div>
    </div>`;
  }

  function renderRaceResultView(r) {
    const w = r.order[0];
    const wDrv = dv(w);
    const wTeam = TEAMS[wDrv.team];
    const ov = Object.entries(r.drv).sort((a, b) => b[1].ov - a[1].ov);
    const totOv = ov.reduce((s, x) => s + x[1].ov, 0);
    const amCreator = isAuthorizedCreator();

    return `<div>
      <div class="card gold-edge">
        <div class="row" style="justify-content:space-between">
          <div>
            <span class="chip" style="border-color:var(--gold);color:var(--gold);margin-bottom:6px">🏁 CORRIDA FINALIZADA · RESULTADO OFICIAL SINCRONIZADO</span>
            <h2 style="font-size:26px">🏆 ${esc(wDrv.name)} (${w}) vence em ${esc(r.circuit.name)}!</h2>
            <small class="mut">Equipe ${esc(wTeam.name)} · ${r.total} voltas concluídas</small>
          </div>
          <div class="row no-flex">
            ${amCreator ? `<button class="btn ok" onclick="F1App.startNewRaceSetup()">🏎️ Configurar Nova Corrida</button>` : `<span class="chip">Aguardando o criador iniciar nova corrida</span>`}
            <button class="btn ghost" onclick="F1App.go('wallet')">🪙 Ver Caixa de Fichas</button>
          </div>
        </div>
        <div style="margin-top:14px">${renderClassificationTower(r)}</div>
      </div>

      <div class="grid g2" style="margin-top:14px">
        <div class="card">
          <h3>Resultado das Apostas da Sala</h3>
          ${renderBetsList(r)}
        </div>
        <div class="card">
          <h3>Estatísticas da Corrida · Ultrapassagens (${totOv})</h3>
          ${ov.slice(0, 6).map(([id, d]) => `<div class="pl">
            <span><b>${id}</b> · ${esc(dv(id).name)}</span>
            <span class="bal">${d.ov} ultrapassagens</span>
          </div>`).join('')}
          <h3 style="margin-top:14px">Abandonos (${r.dnf.length})</h3>
          ${r.dnf.map(id => `<div class="ev"><b>${id}</b> Volta ${r.drv[id].lapsDone} · ${esc(r.drv[id].why)}</div>`).join('') || '<div class="slot">Nenhum abandono nesta corrida.</div>'}
        </div>
      </div>
    </div>`;
  }

  /**
   * 7. CAIXA DE FICHAS (PERSISTENT FINANCIAL DASHBOARD)
   */
  function renderWalletView() {
    const u = S.user;
    ensureAccountIntegrity(u);
    const cb = u.cashbox;
    const av = avObj(u.avatarId);

    const activeBetsInRace = (S.room && S.room.race && !S.room.race.done)
      ? S.room.race.bets.filter(b => b.pid === u.id && !b.cancelled)
      : [];
    const inPlayAmount = r2(activeBetsInRace.reduce((sum, b) => sum + b.amount, 0));

    return `<div>
      <div class="row" style="justify-content:space-between;margin-bottom:14px">
        <div>
          <h2>🪙 Caixa de Fichas & Resultados Financeiros</h2>
          <p class="mut" style="margin:0;font-size:13px">Saldo inicial padrão: 100 fichas. Registro persistente de todas as suas apostas, ganhos e perdas.</p>
        </div>
        <div class="dr no-flex">
          <span class="av" style="background:${av.color}">${av.icon}</span>
          <div>
            <b>${esc(u.name)}</b>
            <small class="mut" style="display:block">Conta Persistente Salva</small>
          </div>
        </div>
      </div>

      <div class="grid g4">
        <div class="card gold-edge">
          <h3>Saldo Total / Disponível</h3>
          <div class="stat mono gold-tx">${fmt(u.chips)} 🪙</div>
          <small class="mut">Total: ${fmt(r2(u.chips + inPlayAmount))} 🪙 · Comprometido: ${fmt(inPlayAmount)} 🪙</small>
        </div>
        <div class="card">
          <h3>Total de Fichas Apostadas</h3>
          <div class="stat mono">${fmt(cb.totalBet)} 🪙</div>
          <small class="mut">${cb.betHistory.filter(b => b.status !== 'cancelled' && b.status !== 'void').length} apostas válidas</small>
        </div>
        <div class="card ok-edge">
          <h3>Total de Lucros (Vencedoras)</h3>
          <div class="stat mono ok">+${fmt(cb.totalWon)} 🪙</div>
          <small class="mut">Bilhetes vencedores: ${cb.betHistory.filter(b => b.status === 'won').length}</small>
        </div>
        <div class="card">
          <h3>Total de Perdas (Perdedoras)</h3>
          <div class="stat mono bad">-${fmt(cb.totalLost)} 🪙</div>
          <small class="mut">Lucro Líquido: <b class="${cb.netProfit >= 0 ? 'ok' : 'bad'}">${cb.netProfit >= 0 ? '+' : ''}${fmt(cb.netProfit)} 🪙</b></small>
        </div>
      </div>

      <div class="grid g2" style="margin-top:14px">
        <div class="card">
          <h3>Histórico de Apostas (${cb.betHistory.length})</h3>
          <div style="max-height:360px;overflow-y:auto">
            ${cb.betHistory.length ? cb.betHistory.map(b => {
              const badge = b.status === 'won'
                ? `<span class="chip ok" style="padding:2px 8px;font-size:11px">+${fmt(b.net)} 🪙 (GANHOU)</span>`
                : b.status === 'lost'
                  ? `<span class="chip bad" style="padding:2px 8px;font-size:11px">-${fmt(b.amount)} 🪙 (PERDEU)</span>`
                  : b.status === 'void'
                    ? `<span class="chip gold-tx" style="padding:2px 8px;font-size:11px">VOID (REEMBOLSADA)</span>`
                    : b.status === 'cancelled'
                      ? `<span class="chip mut" style="padding:2px 8px;font-size:11px">CANCELADA (ESTORNADA)</span>`
                      : `<span class="chip gold-tx" style="padding:2px 8px;font-size:11px">${fmt(b.amount)} 🪙 (EM JOGO)</span>`;
              const modDesc = b.modality === 'placement'
                ? `Colocação (${b.marketLabel || b.market} @ ${Number(b.odd || 1).toFixed(2)}x)`
                : `Ultrapassagens (Exp: ${b.expectedOvertakes ?? 0} · Mult: ${vm(b.mult || 1)})`;
              return `<div class="pl">
                <div>
                  <b>${esc(b.driver)} · ${esc(dv(b.driver).name)}</b>
                  <small class="mut" style="display:block">${esc(b.circuit)} · ${esc(modDesc)} · Valor: ${fmt(b.amount)} · ${esc(b.date)}</small>
                </div>
                <div style="margin-left:auto">${badge}</div>
              </div>`;
            }).join('') : '<div class="slot">Nenhuma aposta realizada ainda.</div>'}
          </div>
        </div>

        <div class="card">
          <h3>Histórico de Ganhos, Perdas e Movimentações (${cb.financialHistory.length})</h3>
          <div style="max-height:360px;overflow-y:auto">
            ${cb.financialHistory.length ? cb.financialHistory.map(tx => {
              const col = tx.type === 'RACE_WIN' || tx.type === 'BET_CANCELLED' ? 'ok' : tx.type === 'BET_PLACED' ? 'gold-tx' : 'bad';
              return `<div class="pl">
                <div>
                  <b>${esc(tx.title)}</b>
                  <small class="mut" style="display:block">${esc(tx.detail)} · ${esc(tx.date)}</small>
                </div>
                <div style="margin-left:auto;text-align:right" class="mono">
                  <div class="${col}" style="font-weight:800">${tx.amount > 0 ? '+' : ''}${fmt(tx.amount)} 🪙</div>
                  <small class="mut">Saldo: ${fmt(tx.balanceAfter)}</small>
                </div>
              </div>`;
            }).join('') : '<div class="slot">Nenhuma movimentação financeira registrada.</div>'}
          </div>
        </div>
      </div>
    </div>`;
  }

  /**
   * 8. PAINEL ADMINISTRATIVO (AUTHENTICATED VIEW)
   */
  function renderAdminView() {
    if (!S.admin.authenticated || !S.admin.token) {
      return `<div style="max-width:440px;margin:36px auto">
        <div class="card gold-edge">
          <div class="row" style="justify-content:space-between;margin-bottom:8px">
            <h2>🔒 Painel Administrativo</h2>
            <span class="chip mono">Acesso Restrito</span>
          </div>
          <p class="mut" style="font-size:13px;margin-top:0">
            Autenticação validada no servidor para gerenciamento de jogadores e saldos.
          </p>
          <form onsubmit="F1App.adminLogin(event)">
            <div style="margin-bottom:12px">
              <small class="mut">Login do Administrador</small>
              <input id="admin-login-input" placeholder="Login" autocomplete="username" required>
            </div>
            <div style="margin-bottom:16px">
              <small class="mut">Senha</small>
              <input id="admin-pass-input" type="password" placeholder="••••••" autocomplete="current-password" required>
            </div>
            <button type="submit" class="btn gold" style="width:100%;padding:12px">🛡️ Entrar no Painel Administrativo</button>
          </form>
        </div>
      </div>`;
    }

    const q = (S.admin.searchQuery || '').trim().toLowerCase();
    const allPlayers = S.admin.players || [];
    const filtered = q
      ? allPlayers.filter(p => (p.name || '').toLowerCase().includes(q) || (p.id || '').toLowerCase().includes(q))
      : allPlayers;
    const totalChipsInCirculation = r2(allPlayers.reduce((sum, p) => sum + (+p.chips || 0), 0));

    return `<div>
      <div class="row" style="justify-content:space-between;margin-bottom:16px">
        <div>
          <span class="chip" style="border-color:var(--gold);color:var(--gold);margin-bottom:6px">🛡️ ADMINISTRADOR AUTENTICADO: ${esc(S.admin.loginName || 'LN')}</span>
          <h2>Painel Administrativo · Gestão de Jogadores e Saldos</h2>
          <p class="mut" style="margin:0;font-size:13px">Consulte, adicione, remova ou defina manualmente o saldo de qualquer jogador cadastrado no servidor.</p>
        </div>
        <div class="row no-flex">
          <button class="btn ghost sm" onclick="F1App.refreshAdminPlayers()">🔄 Atualizar Lista</button>
          <button class="btn ghost sm" style="border-color:var(--red2);color:var(--red2)" onclick="F1App.adminLogout()">🚪 Sair do Admin</button>
        </div>
      </div>

      <div class="grid g3" style="margin-bottom:16px">
        <div class="card gold-edge">
          <h3>Jogadores Cadastrados</h3>
          <div class="stat mono">${allPlayers.length}</div>
          <small class="mut">Contas sincronizadas com o servidor</small>
        </div>
        <div class="card ok-edge">
          <h3>Total de Fichas em Circulação</h3>
          <div class="stat mono gold-tx">${fmt(totalChipsInCirculation)} 🪙</div>
          <small class="mut">Soma dos saldos de todos os jogadores</small>
        </div>
        <div class="card cyan-edge">
          <h3>Saldo Inicial Padrão</h3>
          <div class="stat mono">${fmt(INITIAL_CHIPS)} 🪙</div>
          <small class="mut">Aplicado automaticamente a novos jogadores</small>
        </div>
      </div>

      <div class="card">
        <div class="row" style="justify-content:space-between;margin-bottom:14px">
          <h3>Jogadores Cadastrados & Controle de Saldo (${filtered.length})</h3>
          <div style="max-width:300px;width:100%">
            <input id="admin-search-in" placeholder="🔍 Filtrar jogador por nome ou ID..." value="${esc(S.admin.searchQuery)}" oninput="F1App.onAdminSearch(this.value)">
          </div>
        </div>

        <div style="overflow-x:auto">
          <table class="tower" id="admin-players-table">
            <thead>
              <tr>
                <th>JOGADOR</th>
                <th>ID DA CONTA</th>
                <th>SALDO ATUAL</th>
                <th>VALOR (FICHAS)</th>
                <th style="text-align:right">AÇÕES ADMINISTRATIVAS</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.length ? filtered.map(p => {
                const av = avObj(p.avatarId);
                const isMe = S.user && p.id === S.user.id;
                return `<tr>
                  <td>
                    <div class="dr">
                      <span class="av" style="background:${av.color};width:30px;height:30px;font-size:14px">${av.icon}</span>
                      <div>
                        <b>${esc(p.name)}</b>
                        ${isMe ? '<span class="chip" style="padding:0 6px;font-size:10px;color:var(--gold)">VOCÊ</span>' : ''}
                        <small class="mut" style="display:block">Vitórias: ${p.wins || 0}</small>
                      </div>
                    </div>
                  </td>
                  <td class="mono mut" style="font-size:12px">${esc(p.id)}</td>
                  <td class="mono" style="font-size:15px;font-weight:900;color:var(--gold)">${fmt(p.chips)} 🪙</td>
                  <td style="width:150px">
                    <input id="adm-amt-${esc(p.id)}" type="number" min="0" step="10" value="100" style="padding:6px 10px;font-size:13px" class="mono">
                  </td>
                  <td style="text-align:right">
                    <div class="row no-flex" style="justify-content:flex-end;gap:6px">
                      <button class="btn ok sm" onclick="F1App.adminModifyBalance('${esc(p.id)}', 'add')" title="Adicionar valor ao saldo do jogador">➕ Adicionar</button>
                      <button class="btn sm" onclick="F1App.adminModifyBalance('${esc(p.id)}', 'remove')" title="Remover valor do saldo do jogador">➖ Remover</button>
                      <button class="btn gold sm" onclick="F1App.adminModifyBalance('${esc(p.id)}', 'set')" title="Definir manualmente o saldo exato do jogador">✏️ Definir Saldo</button>
                    </div>
                  </td>
                </tr>`;
              }).join('') : `<tr><td colspan="5"><div class="slot">Nenhum jogador encontrado.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
  }

  function renderRankView() {
    const players = S.room ? S.room.players : [makePlayerEntry(S.user, true)];
    const sorted = [...players].sort((a, b) => b.chips - a.chips);
    const ch = S.champ || { d: {}, t: {}, n: 0 };
    const renderChampList = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v], i) =>
      `<div class="pl"><b class="mono mut">${i + 1}</b><span>${esc(k)}</span><span class="bal">${v} pts</span></div>`
    ).join('') || '<div class="slot">Nenhuma corrida concluída ainda.</div>';

    return `<div class="grid g2">
      <div class="card gold-edge">
        <h2>Ranking de Jogadores</h2>
        ${sorted.map((p, i) => `<div class="pl">
          <b class="mono mut" style="width:22px">${i + 1}º</b>
          <span class="av" style="background:${p.color}">${p.avatarIcon || '🏎️'}</span>
          <div>
            <b>${esc(p.name)}</b>
            <small class="mut" style="display:block">Vitórias em apostas: ${p.wins || 0}</small>
          </div>
          <span class="bal mono">${fmt(p.chips)} 🪙</span>
        </div>`).join('')}
      </div>

      <div class="card">
        <h2>Histórico de Corridas</h2>
        ${S.history.length ? S.history.map(h => `<div class="pl" style="flex-direction:column;align-items:flex-start;gap:4px">
          <div><b>${esc(h.circuit)}</b> <span class="mut">· ${esc(h.date)}</span> · 🏆 Vencedor: <b>${esc(h.winner)}</b></div>
          <small class="mut">${(h.res || []).map(x => `${esc(x.name)} (${x.driver}: ${x.net >= 0 ? '+' : ''}${fmt(x.net)})`).join(' · ') || 'Sem apostas'}</small>
        </div>`).join('') : '<div class="slot">Nenhuma corrida finalizada ainda.</div>'}
      </div>

      <div class="card">
        <h3>Campeonato de Pilotos (${ch.n} corr.)</h3>
        ${renderChampList(ch.d)}
      </div>

      <div class="card">
        <h3>Campeonato de Construtores</h3>
        ${renderChampList(ch.t)}
      </div>
    </div>`;
  }

  function renderNoRoomCard() {
    return `<div class="card">
      <h2>Nenhuma Sala Conectada</h2>
      <p class="mut">Crie uma sala multiplayer ou entre com o código do seu amigo para acessar esta aba.</p>
      <div class="row no-flex">
        <button class="btn" onclick="F1App.createRoom()">🏁 Criar Sala Agora</button>
        <button class="btn ghost" onclick="F1App.go('home')">Voltar ao Início</button>
      </div>
    </div>`;
  }

  const ICO = { c: '💥', g: '🟢', p: '🔧', e: '↩️', o: '⚔️', s: '🚨', w: '🌧️' };
  function renderEventsList(r) {
    return (r.events || []).slice(0, 18).map(e => `<div class="ev">${ICO[e.k] || '•'} <b>V${e.l}</b> ${esc(e.t)}</div>`).join('');
  }

  function getEventsSignature(r) {
    if (!r || !Array.isArray(r.events) || r.events.length === 0) return 'empty';
    const top = r.events[0];
    return `${r.events.length}_${top.id || ''}_${top.l}_${top.t}`;
  }

  function wxBadge(r) {
    return `${['☀️ Pista Seca', '🌦️ Chuva Leve', '🌧️ Chuva Forte'][r.ws || 0]} · ${Math.round((r.w || 0) * 100)}% molhada${r.sc && r.sc.type ? ` · <b style="color:var(--gold)">🚨 ${r.sc.type === 'SC' ? 'SAFETY CAR' : 'VSC'}</b>` : ''}`;
  }

  function renderSpectatorOverlay() {
    if (!S.spectator) return '';
    const r = S.room ? S.room.race : null;
    const R = S.room;
    const camMode = SIM3D.cameraMode || 'panorama';
    const totalPct = r ? Math.min(100, ((Math.max(0, r.lap - (r.running ? 1 : 0)) + (r.lapProgress || 0)) / r.total) * 100) : 0;
    const remSec = r ? Math.max(0, Math.ceil(((1 - (r.lapProgress || 0)) * (r.lapDurationMs || LAP_DURATION_MS)) / 1000)) : 0;

    return `<div class="spec">
      <div class="top">
        <div class="big"><span class="live"></span>F1 BROADCAST · MODO ESPECTADOR AO VIVO</div>
        <div class="row no-flex" style="gap:10px">
          <span class="chip mono" style="background:var(--card)">SALA ${R ? esc(R.code) : '—'}</span>
          <button class="btn ghost sm" onclick="F1App.toggleSpectator(false)">✕ Fechar (Esc)</button>
        </div>
      </div>

      ${r ? `
      <div class="sim3d-stage-card" style="margin-bottom:14px">
        <div class="sim3d-topbar">
          <div class="sim3d-title-group">
            <div>
              <div style="font-size:11px;font-weight:800;color:var(--red2);letter-spacing:1.2px;text-transform:uppercase">
                ${r.running ? '<span class="live"></span>TRANSMISSÃO 3D EM TEMPO REAL' : '🚦 AGUARDANDO LARGADA'}
              </div>
              <h2 style="margin:0;font-size:22px">${r.circuit.flag || '🏁'} ${esc(r.circuit.name)} <span class="mut" style="font-size:13px;font-weight:600">· ${r.circuit.km} km</span></h2>
            </div>
            <span class="chip" id="spec-race-wx-badge">${wxBadge(r)}</span>
          </div>

          <div class="row no-flex" style="gap:12px">
            <div style="text-align:right">
              <small class="mut" style="display:block;font-size:10.5px">TEMPO DA VOLTA (~30s)</small>
              <b class="mono" id="spec-lap-timer-label" style="font-size:13.5px;color:var(--cyan)">
                ${r.running ? `Próxima volta em 0:${String(remSec).padStart(2, '0')}` : 'Aguardando largada'}
              </b>
            </div>
            <div class="sim3d-lap-counter mono">
              <span class="lap-num" id="spec-race-lap-num">${r.lap}</span>
              <span class="lap-tot">/ ${r.total} VOLTAS</span>
            </div>
          </div>
        </div>

        <div class="bar" style="border-radius:0;border:0;height:6px">
          <b id="spec-race-progress-bar" style="width:${totalPct.toFixed(1)}%"></b>
        </div>

        <div class="sim3d-viewport" style="height:clamp(400px, 55vh, 620px)">
          <div id="sim3d-mount-spec" style="width:100%;height:100%"></div>

          <div class="sim3d-hud-overlay">
            <div class="sim3d-hud-top">
              <div class="cam-toolbar">
                <button class="cam-btn ${camMode === 'panorama' ? 'on' : ''}" onclick="F1App.setCameraMode('panorama')">🏟️ Panorâmica 3D</button>
                <button class="cam-btn ${camMode === 'chase' ? 'on' : ''}" onclick="F1App.setCameraMode('chase')">🏎️ Perseguição</button>
                <button class="cam-btn ${camMode === 'heli' ? 'on' : ''}" onclick="F1App.setCameraMode('heli')">🚁 Helicóptero</button>
                <button class="cam-btn ${camMode === 'top' ? 'on' : ''}" onclick="F1App.setCameraMode('top')">🛰️ Aérea</button>
              </div>
              <div class="chip mono" style="background:rgba(10,12,18,0.85)">
                👥 <span id="spec-race-sync-players-count">${getOnlinePlayers().length}</span> Espectadores Conectados
              </div>
            </div>

            <div class="sim3d-hud-bottom">
              <div id="spec-selected-driver-hud">${renderSelectedDriverTelemetryHUD(r)}</div>
            </div>
          </div>
        </div>

        <div class="driver-selector-strip" id="spec-driver-highlight-strip">
          <small class="mut" style="white-space:nowrap;font-weight:800;margin-right:4px">DESTACAR NA PISTA:</small>
          <button class="drv-pill ${!S.highlightedDriver ? 'on' : ''}" onclick="F1App.highlightDriver(null)">Todos</button>
          ${r.order.map(id => {
            const t = TEAMS[dv(id).team];
            const isOn = S.highlightedDriver === id;
            return `<button class="drv-pill ${isOn ? 'on' : ''}" onclick="F1App.highlightDriver('${id}')">
              <span style="width:4px;height:12px;background:${t.color};border-radius:2px;display:inline-block"></span>
              <b>${id}</b>
            </button>`;
          }).join('')}
        </div>
      </div>

      <div class="grid g2" style="align-items:start">
        <div class="card">
          <h3>Classificação Ao Vivo (Torre F1)</h3>
          <div id="spec-tower-wrap">${renderClassificationTower(r)}</div>
        </div>
        <div class="grid" style="gap:14px">
          <div class="card">
            <h3>Acontecimentos da Corrida</h3>
            <div id="spec-events-list" style="max-height:280px;overflow-y:auto;margin-top:6px">
              ${renderEventsList(r)}
            </div>
          </div>
          <div class="card">
            <h3>Apostas Registradas na Sala</h3>
            <div id="spec-bets-list" style="max-height:280px;overflow-y:auto;margin-top:6px">
              ${renderBetsList(r)}
            </div>
          </div>
        </div>
      </div>
      ` : '<div class="card" style="text-align:center;padding:40px"><h2>Aguardando configuração da corrida pelo Criador...</h2><p class="mut">Assim que o líder preparar a largada, a pista 3D e a transmissão aparecerão aqui.</p></div>'}
    </div>`;
  }

  function render() {
    try {
      // Auto-reparo de circuito caso a sala estivesse com id antigo removido (ex: 'nur')
      if (S.room && S.room.race && S.room.race.circuit) {
        if (!CIRCUITS.find(c => c.id === S.room.race.circuit.id)) {
          S.room.race.circuit = CIRCUITS[0];
          S.room.circuitId = CIRCUITS[0].id;
        }
      }
      if (S.room && S.room.circuitId && !CIRCUITS.find(c => c.id === S.room.circuitId)) {
        S.room.circuitId = CIRCUITS[0].id;
      }

      let mainContent = '';
      if (S.view === 'home') mainContent = renderHomeView();
      else if (S.view === 'room') mainContent = renderRoomView();
      else if (S.view === 'setup') mainContent = renderSetupView();
      else if (S.view === 'race') mainContent = renderRaceView();
      else if (S.view === 'wallet') mainContent = renderWalletView();
      else if (S.view === 'rank') mainContent = renderRankView();
      else if (S.view === 'admin') mainContent = renderAdminView();

      const appEl = $('#app');
      if (appEl) {
        appEl.innerHTML = `${renderHeader()}<main>${mainContent}</main>${renderProfileModal()}${renderSpectatorOverlay()}`;
      }

      if (S.spectator && S.room && S.room.race && !S.room.race.done) {
        const mountSpecEl = $('#sim3d-mount-spec');
        if (mountSpecEl) {
          SIM3D.mount(mountSpecEl, S.room.race, S.highlightedDriver, (drvId) => {
            S.highlightedDriver = drvId;
            updateDriverHighlightUI();
          });
        }
      } else if (S.view === 'race' && S.room && S.room.race && !S.room.race.done) {
        const mountEl = $('#sim3d-mount');
        if (mountEl) {
          SIM3D.mount(mountEl, S.room.race, S.highlightedDriver, (drvId) => {
            S.highlightedDriver = drvId;
            updateDriverHighlightUI();
          });
        }
      }
    } catch (err) {
      console.error('Render error:', err);
      // Fallback seguro caso ocorra qualquer erro em tela
      const appEl = $('#app');
      if (appEl) {
        appEl.innerHTML = `${renderHeader()}<main><div class="card" style="text-align:center;padding:30px">
          <h2>Recarregando Simulador...</h2>
          <p class="mut">Atualizando circuitos e sincronizando sala.</p>
          <button class="btn ok" onclick="localStorage.removeItem('f1bs_active_room_code_v2');sessionStorage.clear();location.reload()">Limpar Cache e Recarregar</button>
        </div></main>`;
      }
    }
  }

  /**
   * Surgical, zero-flicker DOM updates for Header, Room Lobby, and Setup views.
   * Never replaces `#app.innerHTML` when already inside the view!
   */
  function updateHeaderAndRoomDOM() {
    const balanceEl = $('#header-balance-val');
    if (balanceEl && S.user) balanceEl.textContent = fmt(S.user.chips);

    const betBalEl = $('#bet-panel-balance');
    if (betBalEl && S.user) betBalEl.textContent = fmt(S.user.chips);

    if (S.room) {
      const onlineCount = getOnlinePlayers(S.room).length;
      const hdrOnline = $('#header-room-online-count');
      if (hdrOnline) hdrOnline.textContent = String(onlineCount);

      if (S.view === 'room') {
        const R = S.room;
        const canProceed = onlineCount >= MIN_PLAYERS_TO_START;
        const statusTxt = $('#room-lobby-status-text');
        if (statusTxt) {
          statusTxt.style.color = `var(--${canProceed ? 'ok' : 'red2'})`;
          statusTxt.textContent = canProceed
            ? `✓ ${onlineCount} jogadores conectados (Pronto!)`
            : `⏳ Aguardando jogadores (${onlineCount}/${MIN_PLAYERS_TO_START} conectados)`;
        }
        const headingEl = $('#room-players-heading');
        if (headingEl) {
          headingEl.textContent = `Jogadores na Sala (${onlineCount} online / ${R.players.length} total)`;
        }
        const pListEl = $('#room-players-list');
        if (pListEl) {
          const newHtml = renderRoomPlayersListHTML(R);
          if (S._lastRoomPlayersSig !== newHtml) {
            S._lastRoomPlayersSig = newHtml;
            pListEl.innerHTML = newHtml;
          }
        }
        const footerEl = $('#room-action-footer');
        if (footerEl) {
          const newFooter = renderRoomActionButtonsHTML(R);
          if (footerEl.innerHTML !== newFooter) {
            footerEl.innerHTML = newFooter;
          }
        }
      } else if (S.view === 'setup') {
        const onlineChip = $('#setup-online-chip');
        if (onlineChip) {
          onlineChip.innerHTML = `Jogadores Conectados: <b style="color:var(--${onlineCount >= 2 ? 'ok' : 'red2'})">${onlineCount}/2 mín.</b>`;
        }
        const prepBtn = $('#setup-prepare-btn');
        if (prepBtn) {
          prepBtn.disabled = onlineCount < MIN_PLAYERS_TO_START;
        }
      }
    }
  }

  /**
   * Targeted DOM update during live race ticks:
   * - Never touches `#race-events-list` unless a new event was actually added (`S._lastEventsSig` check)!
   * - Never touches `#race-tower-wrap` unless classification / gaps actually changed!
   * - Keeps betting driver list sorted by current classification when betting window is open!
   */
  function updateLiveHUDOnly() {
    const balanceEl = $('#header-balance-val');
    if (balanceEl && S.user) balanceEl.textContent = fmt(S.user.chips);

    if (S.view !== 'race' || !S.room || !S.room.race || S.room.race.done) return;
    const r = S.room.race;

    const lapNumEl = $('#race-lap-num');
    if (lapNumEl) lapNumEl.textContent = String(r.lap);

    const totalPct = Math.min(100, ((Math.max(0, r.lap - (r.running ? 1 : 0)) + (r.lapProgress || 0)) / r.total) * 100);
    const progBar = $('#race-progress-bar');
    if (progBar) progBar.style.width = totalPct.toFixed(1) + '%';

    const remSec = Math.max(0, Math.ceil(((1 - (r.lapProgress || 0)) * (r.lapDurationMs || LAP_DURATION_MS)) / 1000));
    const timerEl = $('#lap-timer-label');
    if (timerEl) {
      timerEl.textContent = r.running ? `Próxima volta em 0:${String(remSec).padStart(2, '0')}` : 'Aguardando largada';
    }

    const wxEl = $('#race-wx-badge');
    if (wxEl) {
      const newWx = wxBadge(r);
      if (wxEl.innerHTML !== newWx) wxEl.innerHTML = newWx;
    }

    const syncCountEl = $('#race-sync-players-count');
    if (syncCountEl) syncCountEl.textContent = String(getOnlinePlayers().length);

    // Only update Classification Tower DOM if its content actually changed
    const towerEl = $('#race-tower-wrap');
    if (towerEl) {
      const newTowerHtml = renderClassificationTower(r);
      if (S._lastTowerSig !== newTowerHtml) {
        S._lastTowerSig = newTowerHtml;
        towerEl.innerHTML = newTowerHtml;
      }
    }

    // Only update Events List DOM when a new event actually occurred (eliminates 10Hz event flickering!)
    const evEl = $('#race-events-list');
    if (evEl) {
      const evSig = getEventsSignature(r);
      if (S._lastEventsSig !== evSig) {
        S._lastEventsSig = evSig;
        evEl.innerHTML = renderEventsList(r);
      }
    }

    // If betting panel is open and classification order changed, keep betting cards sorted 1st -> Last
    const betTableEl = $('#bet-driver-table');
    if (betTableEl && r.bettingOpen && !r.running) {
      const orderSig = (r.order || []).join(',') + '|' + S.selectedBetDriver;
      if (S._lastBetDriverOrderSig !== orderSig) {
        S._lastBetDriverOrderSig = orderSig;
        betTableEl.innerHTML = renderBetDriverCardsHTML(r);
      }
    }

    const selHud = $('#selected-driver-hud');
    if (selHud && S.highlightedDriver) {
      selHud.innerHTML = renderSelectedDriverTelemetryHUD(r);
    }

    // Support Spectator Mode Live HUD Updates
    if (S.spectator) {
      const specLapEl = $('#spec-race-lap-num');
      if (specLapEl) specLapEl.textContent = String(r.lap);

      const specProgBar = $('#spec-race-progress-bar');
      if (specProgBar) specProgBar.style.width = totalPct.toFixed(1) + '%';

      const specTimerEl = $('#spec-lap-timer-label');
      if (specTimerEl) {
        specTimerEl.textContent = r.running ? `Próxima volta em 0:${String(remSec).padStart(2, '0')}` : 'Aguardando largada';
      }

      const specWxEl = $('#spec-race-wx-badge');
      if (specWxEl) {
        const newWx = wxBadge(r);
        if (specWxEl.innerHTML !== newWx) specWxEl.innerHTML = newWx;
      }

      const specTowerEl = $('#spec-tower-wrap');
      if (specTowerEl) {
        const newTowerHtml = renderClassificationTower(r);
        if (S._lastSpecTowerSig !== newTowerHtml) {
          S._lastSpecTowerSig = newTowerHtml;
          specTowerEl.innerHTML = newTowerHtml;
        }
      }

      const specEvEl = $('#spec-events-list');
      if (specEvEl) {
        const evSig = getEventsSignature(r);
        if (S._lastSpecEvSig !== evSig) {
          S._lastSpecEvSig = evSig;
          specEvEl.innerHTML = renderEventsList(r);
        }
      }

      const specBetsEl = $('#spec-bets-list');
      if (specBetsEl) {
        const betsHtml = renderBetsList(r);
        if (S._lastSpecBetsSig !== betsHtml) {
          S._lastSpecBetsSig = betsHtml;
          specBetsEl.innerHTML = betsHtml;
        }
      }

      const specSelHud = $('#spec-selected-driver-hud');
      if (specSelHud) {
        specSelHud.innerHTML = renderSelectedDriverTelemetryHUD(r);
      }
    }
  }

  function refreshUI() {
    updateHeaderAndRoomDOM();

    if (S.view === 'room' || S.view === 'setup') {
      // If a race just started while in room, switch to race view
      if (S.room && S.room.race && !S.room.race.done && S.view === 'room') {
        render();
      }
      return;
    }

    if (S.spectator && S.room && S.room.race && !S.room.race.done) {
      updateLiveHUDOnly();
      return;
    }

    if (S.view === 'race' && S.room && S.room.race && !S.room.race.done && ($('#sim3d-mount') || $('#sim3d-mount-spec'))) {
      updateLiveHUDOnly();
      const r = S.room.race;

      const betsEl = $('#race-bets-list');
      if (betsEl) {
        const newBetsHtml = renderBetsList(r);
        if (S._lastBetsSig !== newBetsHtml) {
          S._lastBetsSig = newBetsHtml;
          betsEl.innerHTML = newBetsHtml;
        }
      }
      const betsHeading = $('#race-bets-heading');
      if (betsHeading) {
        betsHeading.textContent = `Apostas Registradas (${(r.bets || []).filter(b => !b.cancelled).length})`;
      }

      const controlsWrap = $('#race-controls-bar-wrap');
      if (controlsWrap) {
        const newCtrlHtml = renderRaceControlsBar(r);
        if (controlsWrap.innerHTML !== newCtrlHtml) {
          controlsWrap.innerHTML = newCtrlHtml;
        }
      }

      // Check if betting form open/closed state changed or update general financial panel
      const hasBetForm = !!$('#betting-form-card');
      const shouldHaveBetForm = r.bettingOpen && !r.running;
      if (hasBetForm !== shouldHaveBetForm) {
        const betPanelWrap = $('#race-betting-panel');
        if (betPanelWrap) {
          betPanelWrap.innerHTML = renderBettingPanel(r);
        }
      } else {
        const genFinEl = $('#general-financial-panel');
        if (genFinEl) {
          genFinEl.outerHTML = renderGeneralFinancialPanel(r);
        }
        const expAvailEl = $('#bet-exp-avail');
        if (expAvailEl) {
          const exp = getMyRaceExposure(r);
          expAvailEl.textContent = fmt(exp.remainingExposure) + ' 🪙';
        }
      }
      return;
    }

    render();
  }

  function updateDriverHighlightUI() {
    SIM3D.setSelectedDriver(S.highlightedDriver);
    if (S.room && S.room.race) {
      const selHud = $('#selected-driver-hud');
      if (selHud) selHud.innerHTML = renderSelectedDriverTelemetryHUD(S.room.race);
      const towerEl = $('#race-tower-wrap');
      if (towerEl) {
        const newTowerHtml = renderClassificationTower(S.room.race);
        S._lastTowerSig = newTowerHtml;
        towerEl.innerHTML = newTowerHtml;
      }
      const strip = $('#driver-highlight-strip');
      if (strip) {
        strip.querySelectorAll('.drv-pill').forEach(btn => {
          const txt = btn.textContent.trim();
          btn.classList.toggle('on', (!S.highlightedDriver && txt === 'Todos') || txt === S.highlightedDriver);
        });
      }
    }
  }

  /* =====================================================================
   * 9. PUBLIC API & EVENT HANDLERS
   * ===================================================================== */
  window.F1App = {
    go,
    createRoom,
    joinRoom,
    leaveRoom,
    prepareRace,
    closeBettingWindow,
    startOrResumeRace,
    pauseRace,
    cancelRaceBeforeStart,
    placeBet,
    cancelBet,
    adminLogin,
    adminLogout,
    adminModifyBalance,
    refreshAdminPlayers: () => fetchAdminPlayers(false),
    onAdminSearch(val) {
      S.admin.searchQuery = val || '';
      render();
      const searchIn = $('#admin-search-in');
      if (searchIn) {
        searchIn.focus();
        searchIn.setSelectionRange(searchIn.value.length, searchIn.value.length);
      }
    },
    getRaceState: () => (S.room ? S.room.race : null),
    getState: () => S,

    openProfileModal() {
      S.profileDraftName = S.user.name;
      S.profileDraftAvatar = S.user.avatarId;
      S.profileModalOpen = true;
      render();
    },
    closeProfileModal() {
      S.profileModalOpen = false;
      render();
    },
    selectDraftAvatar(avId) {
      const nameIn = $('#prof-name-in');
      if (nameIn) S.profileDraftName = nameIn.value;
      S.profileDraftAvatar = avId;
      document.querySelectorAll('.avatar-choice').forEach(el => {
        el.classList.toggle('on', el.getAttribute('onclick').includes(`'${avId}'`));
      });
    },
    saveProfileFromModal() {
      const nameIn = $('#prof-name-in');
      if (nameIn) S.profileDraftName = nameIn.value;
      updateProfile(S.profileDraftName, S.profileDraftAvatar);
    },
    switchAccount(accId) {
      createOrSwitchAccount(accId);
    },

    copyRoomCode() {
      if (!S.room) return;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(S.room.code).then(() => toast('Código copiado: ' + S.room.code, 'ok')).catch(() => {});
      }
    },
    copyInviteLink(url) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => toast('Link de convite copiado!', 'ok')).catch(() => {});
      }
    },

    selectCircuit(cid) {
      if (!S.room || !isAuthorizedCreator()) return;
      if (S.room.race && S.room.race.started && !S.room.race.done) {
        return toast('Não é possível alterar o circuito com uma corrida em andamento.');
      }
      const c = CIRCUITS.find(x => x.id === cid) || CIRCUITS[0];
      S.room.circuitId = c.id;
      if (!S.room.laps || S.room.laps < MIN_RACE_LAPS) S.room.laps = c.laps;
      this._syncConfig();
      // Surgical DOM update on setup screen (no full page flash!)
      document.querySelectorAll('#setup-circuits-grid .circuit-card').forEach(el => {
        el.classList.toggle('on', el.getAttribute('data-cid') === c.id);
      });
    },
    updateLaps(val) {
      if (!S.room || !isAuthorizedCreator()) return;
      if (S.room.race && S.room.race.started && !S.room.race.done) {
        return toast('A quantidade de voltas não pode ser alterada após o início da corrida!');
      }
      const n = Math.max(MIN_RACE_LAPS, Math.min(MAX_RACE_LAPS, Math.floor(+val || MIN_RACE_LAPS)));
      S.room.laps = n;
      const prepBtn = $('#setup-prepare-btn');
      if (prepBtn) {
        prepBtn.textContent = `🏁 Preparar Grid & Abrir Janela de Apostas (${n} Voltas)`;
      }
      this._syncConfig();
    },
    updateWeather(wx) {
      if (!S.room || !isAuthorizedCreator()) return;
      S.room.wxMode = wx;
      this._syncConfig();
    },
    toggleDriver(id) {
      if (!S.room || !isAuthorizedCreator()) return;
      const g = S.room.grid || [];
      const idx = g.indexOf(id);
      if (idx >= 0) {
        if (g.length <= 3) return toast('Mínimo de 3 pilotos no grid.');
        g.splice(idx, 1);
      } else {
        g.push(id);
      }
      this._syncConfig();
      // Surgical DOM toggle on setup screen (no flicker!)
      const cardEl = document.querySelector(`#setup-drivers-grid .opt[data-did="${id}"]`);
      if (cardEl) cardEl.classList.toggle('on', g.includes(id));
      const hEl = $('#setup-grid-count-heading');
      if (hEl) hEl.textContent = `Pilotos & Equipes no Grid (${g.length}/${DRIVERS.length})`;
    },
    selectAllDrivers(all) {
      if (!S.room || !isAuthorizedCreator()) return;
      S.room.grid = all ? DRIVERS.map(d => d.id) : DRIVERS.slice(0, 10).map(d => d.id);
      this._syncConfig();
      document.querySelectorAll('#setup-drivers-grid .opt').forEach(el => {
        const did = el.getAttribute('data-did');
        el.classList.toggle('on', S.room.grid.includes(did));
      });
      const hEl = $('#setup-grid-count-heading');
      if (hEl) hEl.textContent = `Pilotos & Equipes no Grid (${S.room.grid.length}/${DRIVERS.length})`;
    },
    _syncConfig() {
      if (!S.room || !isAuthorizedCreator()) return;
      MP.broadcastState(S.room);
    },

    setBetTab(tab) {
      const r = S.room ? S.room.race : null;
      if (tab === 'placement' && r && (r.started || Number(r.lap || 0) > 0)) {
        return toast('Apostas de colocação final são permitidas apenas antes da largada!');
      }
      S.betTab = (tab === 'placement') ? 'placement' : 'overtake';
      const betPanelWrap = $('#race-betting-panel');
      if (betPanelWrap && r) {
        betPanelWrap.innerHTML = renderBettingPanel(r);
      } else {
        refreshUI();
      }
    },
    selectBetMarket(marketId) {
      if (!FIN.PLACEMENT_MARKETS[marketId]) return;
      S.selectedBetMarket = marketId;
      const r = S.room ? S.room.race : null;
      if (r) {
        const mGrid = $('#bet-market-grid');
        if (mGrid) mGrid.innerHTML = renderPlacementMarketCardsHTML(r, S.selectedBetDriver);
        const table = $('#bet-driver-table');
        if (table) table.innerHTML = renderBetDriverCardsHTML(r);
        const selDrv = dv(S.selectedBetDriver);
        const selTeam = TEAMS[selDrv.team];
        const curMult = mult(r.lap);
        const selPos = posOf(r, S.selectedBetDriver);
        const prev = $('#selected-bet-preview');
        if (prev) prev.innerHTML = renderSelectedBetPreviewHTML(r, selDrv, selTeam, selPos, curMult);
        const calc = $('#bet-calc-details');
        if (calc) calc.innerHTML = renderBetCalculationDetails(S.betAmountInput, curMult, selDrv, selPos, r);
      }
    },
    selectBetDriver(driverId) {
      S.selectedBetDriver = driverId;
      this.highlightDriver(driverId);
      const table = $('#bet-driver-table');
      if (table) {
        table.querySelectorAll('.bet-driver-card').forEach(el => {
          const isSel = el.getAttribute('data-driver') === driverId;
          el.classList.toggle('selected', isSel);
        });
      }
      const r = S.room ? S.room.race : null;
      if (r) {
        const selDrv = dv(driverId);
        const selTeam = TEAMS[selDrv.team];
        const curMult = mult(r.lap);
        const selPos = posOf(r, driverId);
        if (S.betTab === 'placement') {
          const mGrid = $('#bet-market-grid');
          if (mGrid) mGrid.innerHTML = renderPlacementMarketCardsHTML(r, driverId);
        }
        const prev = $('#selected-bet-preview');
        if (prev) {
          prev.innerHTML = renderSelectedBetPreviewHTML(r, selDrv, selTeam, selPos, curMult);
        }
        const calc = $('#bet-calc-details');
        if (calc) {
          calc.innerHTML = renderBetCalculationDetails(S.betAmountInput, curMult, selDrv, selPos, r);
        }
      }
    },
    setBetAmount(val) {
      const r = S.room ? S.room.race : null;
      const exp = getMyRaceExposure(r);
      const maxCap = exp.maxExposure > 0 ? exp.remainingExposure : MAX_BET_AMOUNT;
      S.betAmountInput = r2(Math.min(MAX_BET_AMOUNT, Math.max(0.5, Math.min(val, maxCap > 0 ? maxCap : val))));
      const inputEl = $('#bet-amount-input');
      if (inputEl) inputEl.value = S.betAmountInput;
      this.onBetAmountInput(S.betAmountInput);
    },
    onBetAmountInput(val) {
      S.betAmountInput = +val || 0;
      const r = S.room ? S.room.race : null;
      const calc = $('#bet-calc-details');
      if (r && calc) {
        calc.innerHTML = renderBetCalculationDetails(
          S.betAmountInput,
          mult(r.lap),
          dv(S.selectedBetDriver),
          posOf(r, S.selectedBetDriver),
          r
        );
      }
    },

    highlightDriver(driverId) {
      S.highlightedDriver = driverId;
      updateDriverHighlightUI();
    },
    setCameraMode(mode) {
      SIM3D.setCameraMode(mode);
      document.querySelectorAll('.cam-btn').forEach(b => {
        b.classList.toggle('on', b.getAttribute('onclick').includes(`'${mode}'`));
      });
    },
    startNewRaceSetup() {
      if (!S.room || !isAuthorizedCreator()) return;
      stopHostRaceLoop();
      S.room.race = null;
      MP.broadcastState(S.room);
      go('setup');
    },
    toggleSpectator(on) {
      S.spectator = !!on;
      render();
    }
  };

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (S.spectator) {
        S.spectator = false;
        render();
      } else if (S.profileModalOpen) {
        S.profileModalOpen = false;
        render();
      }
    }
  });

  // Initialize Auth, Auto-Reconnect to Active Room or URL Invite Link (`?room=CODE`)
  initUserAuth();

  const urlParams = new URLSearchParams(window.location.search);
  const urlRoom = urlParams.get('room');
  const savedRoom = (() => {
    try { return sessionStorage.getItem(ACTIVE_ROOM_KEY); } catch (e) { return null; }
  })();

  if (urlRoom) {
    render();
    setTimeout(() => joinRoom(urlRoom), 80);
  } else if (savedRoom) {
    const cached = MP._loadLocalRoomState(savedRoom);
    if (cached) {
      S.room = cached;
      if (!S.room.creatorId) S.room.creatorId = S.room.hostId;
      upsertPlayerInRoom(S.room, makePlayerEntry(S.user, isAuthorizedCreator()));
      MP.connectRoom(savedRoom, S.user.id, isAuthorizedCreator(), S.room);
      startPresenceLoop();
      if (S.room.race && S.room.race.running && isAuthorizedCreator()) {
        startHostRaceLoop();
      }
      S.view = S.room.race && !S.room.race.done ? 'race' : 'room';
    }
    render();
  } else {
    render();
  }
})();
