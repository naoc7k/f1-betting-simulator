/**
 * F1 Betting Simulator 3D · Full-Stack Multiplayer, Admin Panel, Betting & Cashbox Application
 */
(function () {
  const { TEAMS, DRIVERS, TEAM_PACE, AVATARS, CIRCUITS } = window.F1Tracks;
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
    user: null, // Persistent player profile { id, name, avatarId, chips, balanceVersion, wins, cashbox, settledBets }
    room: null, // Synchronized room { code, hostId, creatorId, circuitId, laps, wxMode, grid, players, race }
    selectedBetDriver: 'VER',
    betAmountInput: 20,
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
    if (typeof acc.chips !== 'number' || isNaN(acc.chips)) {
      acc.chips = INITIAL_CHIPS;
    }
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
    const password = passEl ? passEl.value : '';

    if (!login || !password) {
      return toast('Preencha o login e a senha de administrador.');
    }

    // 1. Try Authoritative Server First
    let serverSuccess = false;
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
          serverSuccess = true;
          return;
        } else {
          return toast(data.error || 'Credenciais de administrador inválidas.');
        }
      }
    } catch (e) {
      // Backend not running on this host (e.g. GitHub Pages or file://)
    }

    // 2. Resilient Static / Peer Fallback (GitHub Pages & Offline Mode)
    if (!serverSuccess) {
      if (login === FALLBACK_ADMIN_USER && password === FALLBACK_ADMIN_PASS) {
        const localToken = 'admin-token-gh-' + Date.now();
        S.admin.token = localToken;
        S.admin.authenticated = true;
        S.admin.loginName = FALLBACK_ADMIN_USER;
        S.admin.players = getLocalPlayersForAdmin();
        try { sessionStorage.setItem(ADMIN_TOKEN_KEY, localToken); } catch (e) {}
        toast(`Painel Administrativo autenticado (${FALLBACK_ADMIN_USER})!`, 'ok');
        render();
      } else {
        toast('Credenciais de administrador inválidas.');
      }
    }
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
      saveLocalUser(S.user);
    }

    if (S.room && Array.isArray(S.room.players)) {
      const rp = S.room.players.find(p => p.id === playerId);
      if (rp) {
        rp.chips = target.chips;
        rp.balanceVersion = target.balanceVersion;
        if (MP.isHost && typeof MP.broadcastRoomState === 'function') {
          MP.broadcastRoomState(S.room);
        }
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
        // Sync server-updated balance if balanceVersion increased
        if (Number(meInRoom.balanceVersion || 1) > Number(S.user.balanceVersion || 1)) {
          S.user.chips = r2(meInRoom.chips);
          S.user.balanceVersion = Number(meInRoom.balanceVersion);
          saveCurrentUser(true, false);
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
            if (!pit[a] && dd <= 1.5) {
              tb.ov++;
              if (i < 12) ev(`${b} ultrapassa ${a} e assume a P${i}!`, 'o');
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
      dnf: [],
      done: false,
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
    pushEvent(r, 0, `Grid formado em ${c.name} (${total} voltas). Janela de apostas ABERTA!`, 'g');

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
          r.drv[behind].ov = (r.drv[behind].ov || 0) + 1;
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
   * 5. BETTING SYSTEM (SORTED BY CURRENT CLASSIFICATION, LOCKED CLOSURE)
   * ===================================================================== */
  function mult(lap) {
    const completedBlocks = Math.floor(Math.max(0, lap) / 10);
    return Math.max(0.2, Math.round((1 - completedBlocks * 0.1) * 10) / 10);
  }

  function posOf(r, id) {
    return r.order.indexOf(id) + 1;
  }

  function calculateBetPayout(bet, finalPos, isDnf) {
    if (bet.cancelled || isDnf || finalPos <= 0) return 0;
    let baseFactor = 0;
    if (finalPos === 1) baseFactor = 3.0;
    else if (finalPos === 2) baseFactor = 2.0;
    else if (finalPos === 3) baseFactor = 1.5;

    const gained = Math.max(0, (bet.startPos || finalPos) - finalPos);
    const gainFactor = gained > 0 ? (1.0 + gained * 0.45) : 0;
    const bestFactor = Math.max(baseFactor, gainFactor);

    return bestFactor > 0 ? r2(bet.amount * bestFactor * (bet.mult || 1)) : 0;
  }

  function placeBet() {
    if (!S.room || !S.room.race) return toast('Nenhuma corrida preparada.');
    const r = S.room.race;
    if (r.done) return toast('A corrida já foi encerrada.');
    if (r.running || !r.bettingOpen) {
      return toast('A janela de apostas já foi encerrada! Não são permitidas novas apostas neste momento.');
    }

    const driverId = S.selectedBetDriver;
    if (!driverId || !r.order.includes(driverId)) {
      return toast('Selecione um corredor na tabela de apostas.');
    }

    const inputEl = $('#bet-amount-input');
    const amount = Math.floor(+(inputEl ? inputEl.value : S.betAmountInput));

    if (!amount || amount < 1) {
      return toast('O valor mínimo de aposta é 1 ficha.');
    }
    if (amount > MAX_BET_AMOUNT) {
      return toast(`Limite máximo excedido! O valor máximo por aposta é de ${fmt(MAX_BET_AMOUNT)} fichas.`);
    }
    if (amount > S.user.chips) {
      return toast(`Saldo insuficiente! Seu saldo atual é de ${fmt(S.user.chips)} fichas.`);
    }

    S.user.chips = r2(S.user.chips - amount);
    S.user.balanceVersion = Number(S.user.balanceVersion || 1) + 1;

    const currentRound = Math.floor(r.lap / 10);
    const curMult = mult(r.lap);
    const betId = `bet_${S.user.id}_${r.id}_r${currentRound}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const betObj = {
      id: betId,
      raceId: r.id,
      pid: S.user.id,
      playerName: S.user.name,
      playerAvatar: avObj(S.user.avatarId).icon,
      playerColor: avObj(S.user.avatarId).color,
      driver: driverId,
      amount,
      round: currentRound,
      lap: r.lap,
      startPos: posOf(r, driverId),
      mult: curMult,
      locked: false,
      cancelled: false,
      ts: Date.now()
    };

    ensureAccountIntegrity(S.user);
    S.user.cashbox.totalBet = r2(S.user.cashbox.totalBet + amount);
    S.user.cashbox.betHistory.unshift({
      id: betId,
      raceId: r.id,
      circuit: r.circuit.name,
      driver: driverId,
      amount,
      round: currentRound,
      lap: r.lap,
      mult: curMult,
      status: 'active',
      ret: 0,
      net: 0,
      date: new Date().toLocaleString('pt-BR')
    });
    recordFinancialTx(
      'tx_bet_' + betId,
      'BET_PLACED',
      `Aposta em ${driverId} (${dv(driverId).name})`,
      `${r.circuit.name} · Rodada ${currentRound + 1} (${vm(curMult)})`,
      -amount
    );
    saveCurrentUser(true, true);

    applyPlaceBetToRoom(betObj, S.user.chips, S.user.balanceVersion);
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

    toast(`Aposta de ${fmt(amount)} fichas confirmada em ${driverId}!`, 'ok');
    refreshUI();
  }

  function applyPlaceBetToRoom(betObj, updatedChips, balanceVersion) {
    if (!S.room || !S.room.race || !betObj) return;
    const r = S.room.race;
    if (r.done || r.running || !r.bettingOpen) return;
    if (r.bets.some(b => b.id === betObj.id)) return;
    r.bets.push(betObj);
    const pl = S.room.players.find(p => p.id === betObj.pid);
    if (pl && typeof updatedChips === 'number') {
      pl.chips = r2(updatedChips);
      if (balanceVersion) pl.balanceVersion = balanceVersion;
    }
  }

  function cancelBet(betId) {
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

    bet.cancelled = true;
    S.user.chips = r2(S.user.chips + bet.amount);
    S.user.balanceVersion = Number(S.user.balanceVersion || 1) + 1;

    ensureAccountIntegrity(S.user);
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

    applyCancelBetToRoom(betId, S.user.id, S.user.chips, S.user.balanceVersion);
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
    refreshUI();
  }

  function applyCancelBetToRoom(betId, playerId, updatedChips, balanceVersion) {
    if (!S.room || !S.room.race) return;
    const r = S.room.race;
    if (r.done || r.running || !r.bettingOpen) return;
    const bet = r.bets.find(b => b.id === betId && b.pid === playerId);
    if (bet && !bet.locked) {
      bet.cancelled = true;
      r.bets = r.bets.filter(b => b.id !== betId);
    }
    const pl = S.room.players.find(p => p.id === playerId);
    if (pl && typeof updatedChips === 'number') {
      pl.chips = r2(updatedChips);
      if (balanceVersion) pl.balanceVersion = balanceVersion;
    }
  }

  function finishRaceAuthoritative(r) {
    if (!r || r.done) return;
    r.done = true;
    r.running = false;
    r.bettingOpen = false;
    const w = r.order[0];
    const dt = new Date().toLocaleDateString('pt-BR');

    pushEvent(r, r.total, `🏁 BANDEIRA QUADRICULADA! ${dv(w).name} (${w}) vence o GP de ${r.circuit.name}!`, 'g');

    const summaryRes = [];
    r.bets.forEach(b => {
      if (b.cancelled) return;
      const fin = posOf(r, b.driver);
      const isDnf = r.drv[b.driver] && r.drv[b.driver].st === 'dnf';
      const ret = calculateBetPayout(b, fin, isDnf);
      const net = r2(ret - b.amount);
      r.res[b.id] = { fin, isDnf, ret, net };
      summaryRes.push({
        pid: b.pid,
        name: b.playerName,
        driver: b.driver,
        amount: b.amount,
        ret,
        net
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
      circuit: r.circuit.name,
      winner: w,
      date: dt,
      res: summaryRes
    });
    saveGlobalHistory();

    settleMyBetsForFinishedRace(r);
  }

  function settleMyBetsForFinishedRace(r) {
    if (!r || !r.done || !S.user) return;
    ensureAccountIntegrity(S.user);

    let anySettled = false;
    let totalNetThisRace = 0;

    r.bets.forEach(b => {
      if (b.cancelled || b.pid !== S.user.id) return;
      if (S.user.settledBets[b.id]) return;

      const outcome = r.res && r.res[b.id]
        ? r.res[b.id]
        : (() => {
            const fin = posOf(r, b.driver);
            const isDnf = r.drv[b.driver] && r.drv[b.driver].st === 'dnf';
            const ret = calculateBetPayout(b, fin, isDnf);
            return { fin, isDnf, ret, net: r2(ret - b.amount) };
          })();

      S.user.settledBets[b.id] = true;
      anySettled = true;

      if (outcome.ret > 0) {
        S.user.chips = r2(S.user.chips + outcome.ret);
        S.user.balanceVersion = Number(S.user.balanceVersion || 1) + 1;
      }

      if (outcome.net > 0) {
        S.user.wins = (S.user.wins || 0) + 1;
        S.user.cashbox.totalWon = r2(S.user.cashbox.totalWon + outcome.net);
        recordFinancialTx(
          'tx_settle_' + b.id,
          'RACE_WIN',
          `Vitória na Aposta (${b.driver} · ${outcome.fin}º Lugar)`,
          `${r.circuit.name} · Retorno: ${fmt(outcome.ret)} (Lucro: +${fmt(outcome.net)})`,
          +outcome.ret
        );
      } else {
        const lossAmt = Math.abs(outcome.net);
        S.user.cashbox.totalLost = r2(S.user.cashbox.totalLost + lossAmt);
        recordFinancialTx(
          'tx_settle_' + b.id,
          'RACE_LOSS',
          `Resultado da Aposta (${b.driver} · ${outcome.isDnf ? 'DNF' : outcome.fin + 'º Lugar'})`,
          `${r.circuit.name} · Valor apostado: ${fmt(b.amount)}`,
          0
        );
      }

      S.user.cashbox.netProfit = r2(S.user.cashbox.totalWon - S.user.cashbox.totalLost);

      const histEntry = S.user.cashbox.betHistory.find(h => h.id === b.id);
      if (histEntry) {
        histEntry.status = outcome.net > 0 ? 'won' : 'lost';
        histEntry.fin = outcome.fin;
        histEntry.ret = outcome.ret;
        histEntry.net = outcome.net;
      }

      totalNetThisRace += outcome.net;
    });

    if (anySettled) {
      saveCurrentUser(true, true);
      syncMyPlayerInRoom();
      if (totalNetThisRace > 0) {
        toast(`🏆 Parabéns! Você lucrou +${fmt(totalNetThisRace)} fichas nesta corrida!`, 'gold');
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

    return orderedDrivers.map((id, idx) => {
      const d = dv(id);
      const t = TEAMS[d.team];
      const drvState = r.drv ? r.drv[id] : null;
      const isDnf = drvState && drvState.st === 'dnf';
      const posNum = idx + 1;
      const isSel = S.selectedBetDriver === id;

      return `<div class="bet-driver-card ${isSel ? 'selected' : ''}" data-driver="${id}" style="${isDnf ? 'opacity:0.45' : ''}" onclick="F1App.selectBetDriver('${id}')">
        <span class="bet-pos-badge mono ${posNum <= 3 ? 'podium-' + posNum : ''}">${isDnf ? 'OUT' : posNum + 'º'}</span>
        <span class="tm" style="background:${t.color};height:28px"></span>
        <div style="min-width:0;flex:1">
          <div style="font-weight:900;font-size:13px">${id} <span class="mut" style="font-size:11px">#${d.num}</span></div>
          <div style="font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.name)}</div>
          <small class="mut" style="font-size:10px">${esc(t.name)}</small>
        </div>
        ${isSel ? '<span class="sel-check">★</span>' : ''}
      </div>`;
    }).join('');
  }

  function renderBettingPanel(r) {
    if (r.done) return '';

    const curMult = mult(r.lap);
    const roundNum = Math.floor(r.lap / 10) + 1;

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
                ? `Corrida em andamento! Uma nova rodada de apostas abrirá ao completar a <b>Volta ${nextWindowLap}</b>.`
                : `Corrida no trecho final! As apostas estão bloqueadas até a bandeira quadriculada.`)
            : `O período de apostas desta rodada foi encerrado definitivamente e não pode ser reaberto.`}
        </p>
      </div>`;
    }

    const orderedDrivers = (r.order && r.order.length ? r.order : r.start).slice();
    if (!orderedDrivers.includes(S.selectedBetDriver)) {
      S.selectedBetDriver = orderedDrivers[0];
    }
    const selDrv = dv(S.selectedBetDriver);
    const selTeam = TEAMS[selDrv.team];
    const selPos = orderedDrivers.indexOf(S.selectedBetDriver) + 1;
    const amt = Math.min(MAX_BET_AMOUNT, Math.max(1, Math.floor(+S.betAmountInput || 20)));

    return `<div class="card gold-edge" id="betting-form-card">
      <div class="row" style="justify-content:space-between">
        <h3>🪙 Fazer Aposta · Rodada ${roundNum} (${r.lap === 0 ? 'Grid de Largada' : 'Após Volta ' + r.lap})</h3>
        <span class="chip mono" style="border-color:var(--gold);color:var(--gold)">Multiplicador ${vm(curMult)}</span>
      </div>

      <small class="mut" style="display:block;margin-top:4px">
        1. Escolha o corredor (organizados pela classificação atual da corrida, do 1º ao último colocado):
      </small>

      <div class="bet-driver-grid" id="bet-driver-table">
        ${renderBetDriverCardsHTML(r)}
      </div>

      <div class="bet-summary-box" id="selected-bet-preview">
        <div class="row" style="justify-content:space-between">
          <div class="dr">
            <span class="tm" style="background:${selTeam.color};height:24px"></span>
            <div>
              <small class="mut">CORREDOR SELECIONADO (${selPos}º COLOCADO)</small>
              <div style="font-weight:900;color:var(--gold)">${selDrv.id} · ${esc(selDrv.name)} (${esc(selTeam.name)})</div>
            </div>
          </div>
          <span class="chip mono">${vm(curMult)}</span>
        </div>
      </div>

      <div>
        <div class="row" style="justify-content:space-between;margin-bottom:4px">
          <small class="mut">2. Valor da Aposta (Máx: ${fmt(MAX_BET_AMOUNT)} fichas)</small>
          <small class="mono" style="color:var(--gold)">Saldo: <span id="bet-panel-balance">${fmt(S.user.chips)}</span> 🪙</small>
        </div>
        <div class="quick-chips">
          ${[10, 25, 50, 100, 500, 1000].map(v => `<button type="button" class="quick-chip mono" onclick="F1App.setBetAmount(${v})">${fmt(v)}</button>`).join('')}
        </div>
        <div class="row" style="margin-top:6px">
          <input id="bet-amount-input" type="number" min="1" max="${MAX_BET_AMOUNT}" step="5" value="${amt}" oninput="F1App.onBetAmountInput(this.value)">
          <button class="btn gold" id="confirm-bet-btn" onclick="F1App.placeBet()">✓ Confirmar Aposta</button>
        </div>
      </div>

      <div class="bet-summary-box" id="bet-calc-details" style="margin-top:10px;margin-bottom:0">
        ${renderBetCalculationDetails(amt, curMult, selDrv, selPos)}
      </div>
    </div>`;
  }

  function renderBetCalculationDetails(amount, curMult, selDrv, selPos) {
    const a = Math.max(0, Math.floor(+amount || 0));
    const win1 = r2(a * 3.0 * curMult);
    const win2 = r2(a * 2.0 * curMult);
    const win3 = r2(a * 1.5 * curMult);
    return `<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px">
      <span>Valor: <b class="mono" style="color:var(--gold)">${fmt(a)} 🪙</b></span>
      <span>Corredor: <b>${selPos ? selPos + 'º · ' : ''}${selDrv.id}</b></span>
      <span>Mult: <b>${vm(curMult)}</b></span>
    </div>
    <div class="mut" style="font-size:11.5px;margin-top:5px">
      Retornos estimados: 🏆 1º Lugar: <b class="ok">${fmt(win1)}</b> · 🥈 2º: <b class="ok">${fmt(win2)}</b> · 🥉 3º: <b class="ok">${fmt(win3)}</b> (ou bônus por posições ganhas).
    </div>`;
  }

  function renderBetsList(r) {
    const activeBets = (r.bets || []).filter(b => !b.cancelled);
    if (!activeBets.length) {
      return '<div class="slot">Nenhuma aposta ativa nesta corrida.</div>';
    }
    return activeBets.slice().reverse().map(b => {
      const isMine = b.pid === S.user.id;
      const canCancel = isMine && r.bettingOpen && !r.running && !r.done && !b.locked;
      const res = r.res && r.res[b.id];
      const drv = dv(b.driver);
      const team = TEAMS[drv.team];

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
          <small class="mut">
            ${b.lap ? 'Volta ' + b.lap : 'Pré-Largada'} (${b.startPos}º) · ${vm(b.mult)}
            ${res ? ` · Final: ${res.isDnf ? 'DNF' : res.fin + 'º'} · Retorno: ${fmt(res.ret)}` : (b.locked || !r.bettingOpen ? ' · 🔒 Bloqueada' : ' · 🟢 Janela Aberta')}
          </small>
        </div>
        <div style="text-align:right;display:flex;align-items:center;gap:8px">
          <span class="bal mono" style="${res ? 'color:var(--' + (res.net > 0 ? 'ok' : 'red2') + ')' : ''}">
            ${res ? (res.net > 0 ? '+' : '') + fmt(res.net) : fmt(b.amount) + ' 🪙'}
          </span>
          ${canCancel ? `<button class="btn ghost sm" style="border-color:var(--red2);color:var(--red2);padding:4px 8px" onclick="F1App.cancelBet('${b.id}')" title="Retirar aposta e estornar saldo">✕ Cancelar</button>` : ''}
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
               <button class="btn" id="start-race-btn" disabled title="Encerre o período de apostas primeiro antes de iniciar a largada">🚦 2. ${!r.started ? 'Autorizar Largada' : 'Retomar Corrida'}</button>`
            : `<button class="btn ok" id="start-race-btn" onclick="F1App.startOrResumeRace()" ${(!hasEnoughPlayers || !hasValidLaps) ? 'disabled' : ''}>
                 🚦 ${!r.started ? 'Autorizar Largada (Iniciar Corrida 3D)' : `Retomar Corrida (Volta ${r.lap + 1})`}
               </button>`
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
          <h3>Saldo Atual Disponível</h3>
          <div class="stat mono gold-tx">${fmt(u.chips)} 🪙</div>
          <small class="mut">Em jogo na corrida atual: ${fmt(inPlayAmount)} 🪙</small>
        </div>
        <div class="card">
          <h3>Total de Fichas Apostadas</h3>
          <div class="stat mono">${fmt(cb.totalBet)} 🪙</div>
          <small class="mut">${cb.betHistory.filter(b => b.status !== 'cancelled').length} apostas confirmadas</small>
        </div>
        <div class="card ok-edge">
          <h3>Total de Fichas Ganhas</h3>
          <div class="stat mono ok">+${fmt(cb.totalWon)} 🪙</div>
          <small class="mut">Vitórias acumuladas: ${u.wins || 0}</small>
        </div>
        <div class="card">
          <h3>Total de Fichas Perdidas</h3>
          <div class="stat mono bad">-${fmt(cb.totalLost)} 🪙</div>
          <small class="mut">Lucro/Prejuízo Líquido: <b class="${cb.netProfit >= 0 ? 'ok' : 'bad'}">${cb.netProfit >= 0 ? '+' : ''}${fmt(cb.netProfit)} 🪙</b></small>
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
                  : b.status === 'cancelled'
                    ? `<span class="chip mut" style="padding:2px 8px;font-size:11px">CANCELADA (ESTORNADA)</span>`
                    : `<span class="chip gold-tx" style="padding:2px 8px;font-size:11px">${fmt(b.amount)} 🪙 (EM JOGO)</span>`;
              return `<div class="pl">
                <div>
                  <b>${esc(b.driver)} · ${esc(dv(b.driver).name)}</b>
                  <small class="mut" style="display:block">${esc(b.circuit)} · ${b.lap ? 'Volta ' + b.lap : 'Pré-Largada'} · Valor: ${fmt(b.amount)} · Mult: ${vm(b.mult)} · ${esc(b.date)}</small>
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
    return `<div class="spec">
      <div class="top">
        <div class="big"><span class="live"></span>F1 BETTING SIMULATOR 3D · TRANSMISSÃO</div>
        <div class="row no-flex">
          <span class="chip mono">SALA ${R ? esc(R.code) : '—'}</span>
          <button class="btn ghost" onclick="F1App.toggleSpectator(false)">Sair (Esc)</button>
        </div>
      </div>
      ${r ? `<div class="row" style="justify-content:space-between;margin-bottom:10px">
        <div class="big">${esc(r.circuit.name)}</div>
        <div class="big mono">VOLTA ${r.lap}/${r.total}</div>
      </div>
      <div class="grid g2">
        <div class="card"><h3>Classificação Ao Vivo</h3>${renderClassificationTower(r)}</div>
        <div class="grid">
          <div class="card"><h3>Apostas Registradas</h3>${renderBetsList(r)}</div>
          <div class="card"><h3>Acontecimentos</h3>${renderEventsList(r)}</div>
        </div>
      </div>` : '<div class="card"><h2>Aguardando início da corrida...</h2></div>'}
    </div>`;
  }

  function render() {
    let mainContent = '';
    if (S.view === 'home') mainContent = renderHomeView();
    else if (S.view === 'room') mainContent = renderRoomView();
    else if (S.view === 'setup') mainContent = renderSetupView();
    else if (S.view === 'race') mainContent = renderRaceView();
    else if (S.view === 'wallet') mainContent = renderWalletView();
    else if (S.view === 'rank') mainContent = renderRankView();
    else if (S.view === 'admin') mainContent = renderAdminView();

    $('#app').innerHTML = `${renderHeader()}<main>${mainContent}</main>${renderProfileModal()}${renderSpectatorOverlay()}`;

    if (S.view === 'race' && S.room && S.room.race && !S.room.race.done) {
      const mountEl = $('#sim3d-mount');
      if (mountEl) {
        SIM3D.mount(mountEl, S.room.race, S.highlightedDriver, (drvId) => {
          S.highlightedDriver = drvId;
          updateDriverHighlightUI();
        });
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

    if (S.view === 'race' && S.room && S.room.race && !S.room.race.done && $('#sim3d-mount')) {
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

      // Check if betting form open/closed state changed -> update only `#race-betting-panel` without touching 3D canvas!
      const hasBetForm = !!$('#betting-form-card');
      const shouldHaveBetForm = r.bettingOpen && !r.running;
      if (hasBetForm !== shouldHaveBetForm) {
        const betPanelWrap = $('#race-betting-panel');
        if (betPanelWrap) {
          betPanelWrap.innerHTML = renderBettingPanel(r);
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
        const prev = $('#selected-bet-preview');
        if (prev) {
          prev.innerHTML = `<div class="row" style="justify-content:space-between">
            <div class="dr">
              <span class="tm" style="background:${selTeam.color};height:24px"></span>
              <div>
                <small class="mut">CORREDOR SELECIONADO (${selPos}º COLOCADO)</small>
                <div style="font-weight:900;color:var(--gold)">${selDrv.id} · ${esc(selDrv.name)} (${esc(selTeam.name)})</div>
              </div>
            </div>
            <span class="chip mono">${vm(curMult)}</span>
          </div>`;
        }
        const calc = $('#bet-calc-details');
        if (calc) {
          calc.innerHTML = renderBetCalculationDetails(S.betAmountInput, curMult, selDrv, selPos);
        }
      }
    },
    setBetAmount(val) {
      S.betAmountInput = Math.min(MAX_BET_AMOUNT, Math.max(1, val));
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
          posOf(r, S.selectedBetDriver)
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
