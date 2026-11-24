/**
 * F1 Betting Simulator - Real-Time Multi-Transport Multiplayer Engine
 *
 * Transports (active simultaneously for maximum reliability):
 *  1. Local Authoritative Backend API (/api/room/<code>) when running via server.py or server.js
 *  2. BroadcastChannel + localStorage storage events (0ms multi-tab/multi-window sync)
 *  3. PeerJS WebRTC DataChannel (cross-device internet P2P on Netlify/Vercel/GitHub Pages)
 *  4. Public WebSocket Relay (ntfy.sh JSON pub/sub over WSS) as firewall-proof fallback
 */
(function () {
  const BC_NAME = 'f1bs_mp_channel_v2';
  const ROOM_STORAGE_PREFIX = 'f1bs_room_state_';
  const ACTION_STORAGE_PREFIX = 'f1bs_room_act_';
  const PEER_PREFIX = 'f1bs-v2-host-';

  class MultiplayerManager {
    constructor() {
      this.roomCode = null;
      this.playerId = null;
      this.isHost = false;
      this.isSpectator = false;
      this.backendAvailable = false;
      this.peerConnected = false;
      this.wsConnected = false;

      this.bc = null;
      this.peer = null;
      this.hostConn = null;
      this.guestConns = new Map(); // peerId -> DataConnection
      this.ws = null;

      this.pollTimer = null;
      this.heartbeatTimer = null;
      this.seenActionIds = new Set();

      this.onStateUpdate = null;   // (state, source) => void
      this.onActionReceived = null; // (action) => void
      this.onConnectionStatus = null; // (statusObj) => void
      this.onServerMeUpdate = null; // (meRecord) => void

      this._initLocalTransports();
      this._checkBackend();
    }

    async _checkBackend() {
      if (location.protocol === 'file:') {
        this.backendAvailable = false;
        return;
      }
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          this.backendAvailable = !!(data && data.ok);
          this._emitStatus();
        }
      } catch (e) {
        this.backendAvailable = false;
      }
    }

    _initLocalTransports() {
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          this.bc = new BroadcastChannel(BC_NAME);
          this.bc.onmessage = (ev) => this._handleEnvelope(ev.data, 'bc');
        }
      } catch (e) {}

      window.addEventListener('storage', (ev) => {
        if (!this.roomCode) return;
        if (ev.key === ROOM_STORAGE_PREFIX + this.roomCode && ev.newValue) {
          try {
            const parsed = JSON.parse(ev.newValue);
            this._handleEnvelope({ type: 'STATE', code: this.roomCode, state: parsed.state, senderId: parsed.senderId }, 'storage');
          } catch (e) {}
        } else if (ev.key === ACTION_STORAGE_PREFIX + this.roomCode && ev.newValue) {
          try {
            const parsed = JSON.parse(ev.newValue);
            this._handleEnvelope({ type: 'ACTION', code: this.roomCode, action: parsed.action, senderId: parsed.senderId }, 'storage');
          } catch (e) {}
        }
      });

      window.addEventListener('beforeunload', () => {
        if (this.roomCode && this.playerId && !this.isSpectator) {
          this.sendAction({
            id: 'act_disc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            type: 'DISCONNECT',
            playerId: this.playerId,
            ts: Date.now()
          }, true);
        }
      });
    }

    _emitStatus() {
      if (typeof this.onConnectionStatus === 'function') {
        this.onConnectionStatus({
          backend: this.backendAvailable,
          webrtc: this.peerConnected,
          ws: this.wsConnected,
          local: true
        });
      }
    }

    _handleEnvelope(env, source) {
      if (!env || env.code !== this.roomCode) return;
      if (env.senderId && env.senderId === this.playerId && source !== 'api') return;

      if (env.type === 'STATE' && env.state) {
        if (typeof this.onStateUpdate === 'function') {
          this.onStateUpdate(env.state, source);
        }
      } else if (env.type === 'ACTION' && env.action) {
        const act = env.action;
        if (act.id && this.seenActionIds.has(act.id)) return;
        if (act.id) {
          this.seenActionIds.add(act.id);
          if (this.seenActionIds.size > 500) {
            const first = this.seenActionIds.values().next().value;
            this.seenActionIds.delete(first);
          }
        }
        if (typeof this.onActionReceived === 'function') {
          this.onActionReceived(act, source);
        }
      } else if (env.type === 'REQUEST_STATE') {
        if (this.isHost && typeof this.onActionReceived === 'function') {
          this.onActionReceived({ type: 'REQUEST_STATE', playerId: env.senderId }, source);
        }
      }
    }

    async connectRoom(code, playerId, isHost, initialState = null, isSpectator = false) {
      this.disconnectRoom();
      this.roomCode = String(code).trim().toUpperCase();
      this.playerId = playerId;
      this.isHost = !isSpectator && !!isHost;
      this.isSpectator = !!isSpectator;

      if (this.isHost && initialState && !this.isSpectator) {
        this._saveLocalRoomState(initialState);
        if (this.backendAvailable) {
          try {
            await fetch(`/api/room/${this.roomCode}/state`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ state: initialState, pid: this.playerId })
            });
          } catch (e) {}
        }
      }

      this._connectPeerJS();
      this._connectWebSocketRelay();
      this._startPollingAndHeartbeat();

      // If joining as guest or spectator, immediately check local storage & backend
      if (!this.isHost) {
        const cached = this._loadLocalRoomState(this.roomCode);
        if (cached && typeof this.onStateUpdate === 'function') {
          this.onStateUpdate(cached, 'local_cache');
        }
        this._broadcastEnvelope({ type: 'REQUEST_STATE', code: this.roomCode, senderId: this.playerId, isSpectator: this.isSpectator });
      }
    }

    disconnectRoom() {
      clearInterval(this.pollTimer);
      clearInterval(this.heartbeatTimer);
      this.pollTimer = null;
      this.heartbeatTimer = null;

      if (this.hostConn) {
        try { this.hostConn.close(); } catch (e) {}
        this.hostConn = null;
      }
      for (const conn of this.guestConns.values()) {
        try { conn.close(); } catch (e) {}
      }
      this.guestConns.clear();
      if (this.peer) {
        try { this.peer.destroy(); } catch (e) {}
        this.peer = null;
      }
      if (this.ws) {
        try { this.ws.close(); } catch (e) {}
        this.ws = null;
      }
      this.peerConnected = false;
      this.wsConnected = false;
      this.isSpectator = false;
      this.roomCode = null;
    }

    _saveLocalRoomState(state) {
      if (!this.roomCode || !state) return;
      try {
        localStorage.setItem(ROOM_STORAGE_PREFIX + this.roomCode, JSON.stringify({
          state,
          senderId: this.playerId,
          ts: Date.now()
        }));
      } catch (e) {}
    }

    _loadLocalRoomState(code) {
      try {
        const raw = localStorage.getItem(ROOM_STORAGE_PREFIX + code);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && parsed.state ? parsed.state : null;
      } catch (e) {
        return null;
      }
    }

    _connectPeerJS() {
      if (typeof Peer === 'undefined' || !this.roomCode) return;
      try {
        const hostPeerId = PEER_PREFIX + this.roomCode;
        const myPeerId = this.isHost
          ? hostPeerId
          : `${PEER_PREFIX}${this.roomCode}-g-${this.playerId}-${Math.random().toString(36).slice(2, 6)}`;

        this.peer = new Peer(myPeerId, { debug: 0 });

        this.peer.on('open', () => {
          this.peerConnected = true;
          this._emitStatus();

          if (!this.isHost) {
            this._connectToHostPeer(hostPeerId);
          }
        });

        this.peer.on('connection', (conn) => {
          conn.on('open', () => {
            this.guestConns.set(conn.peer, conn);
            // Send latest state to newly connected guest
            if (typeof this.onActionReceived === 'function') {
              this.onActionReceived({ type: 'REQUEST_STATE', playerId: conn.peer }, 'webrtc');
            }
          });
          conn.on('data', (data) => {
            this._handleEnvelope(data, 'webrtc');
            // Relay guest actions to other guests too if needed
            if (this.isHost && data && data.type === 'ACTION') {
              for (const [pid, gConn] of this.guestConns.entries()) {
                if (pid !== conn.peer && gConn.open) {
                  try { gConn.send(data); } catch (e) {}
                }
              }
            }
          });
          conn.on('close', () => {
            this.guestConns.delete(conn.peer);
          });
        });

        this.peer.on('error', (err) => {
          // If host ID is already taken (e.g. second tab or reconnect), connect as client peer to it
          if (this.isHost && err && err.type === 'unavailable-id') {
            try { this.peer.destroy(); } catch (e) {}
            const fallbackId = `${PEER_PREFIX}${this.roomCode}-h2-${Math.random().toString(36).slice(2, 6)}`;
            this.peer = new Peer(fallbackId, { debug: 0 });
            this.peer.on('open', () => {
              this.peerConnected = true;
              this._emitStatus();
              this._connectToHostPeer(hostPeerId);
            });
          }
        });
      } catch (e) {}
    }

    _connectToHostPeer(hostPeerId) {
      if (!this.peer || !this.roomCode) return;
      try {
        const conn = this.peer.connect(hostPeerId, { reliable: true });
        this.hostConn = conn;
        conn.on('open', () => {
          this.peerConnected = true;
          this._emitStatus();
          conn.send({ type: 'REQUEST_STATE', code: this.roomCode, senderId: this.playerId });
        });
        conn.on('data', (data) => {
          this._handleEnvelope(data, 'webrtc');
        });
      } catch (e) {}
    }

    _connectWebSocketRelay() {
      if (!this.roomCode || typeof WebSocket === 'undefined') return;
      try {
        const topic = `f1bs_v2_sync_${this.roomCode}`;
        const ws = new WebSocket(`wss://ntfy.sh/${topic}/ws`);
        this.ws = ws;
        ws.onopen = () => {
          this.wsConnected = true;
          this._emitStatus();
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg && msg.event === 'message' && msg.message) {
              const env = JSON.parse(msg.message);
              this._handleEnvelope(env, 'ws_relay');
            }
          } catch (e) {}
        };
        ws.onclose = () => {
          this.wsConnected = false;
          this._emitStatus();
        };
        ws.onerror = () => {
          this.wsConnected = false;
        };
      } catch (e) {}
    }

    _publishWebSocketRelay(env) {
      if (!this.roomCode || !this.wsConnected) return;
      // Only publish important state transitions & actions over public relay to avoid rate limits
      if (env.type === 'STATE' && env.tickOnly) return;
      try {
        const topic = `f1bs_v2_sync_${this.roomCode}`;
        fetch(`https://ntfy.sh/${topic}`, {
          method: 'POST',
          body: JSON.stringify(env)
        }).catch(() => {});
      } catch (e) {}
    }

    _startPollingAndHeartbeat() {
      // Poll local backend API & storage every 350ms
      this.pollTimer = setInterval(async () => {
        if (!this.roomCode) return;
        if (this.backendAvailable) {
          try {
            const specFlag = this.isSpectator ? '&spectator=1' : '';
            const res = await fetch(`/api/room/${this.roomCode}?pid=${encodeURIComponent(this.playerId)}&host=${this.isHost ? '1' : '0'}${specFlag}`, {
              cache: 'no-store'
            });
            if (res.ok) {
              const data = await res.json();
              if (data && data.ok) {
                if (!this.isSpectator && data.me && typeof this.onServerMeUpdate === 'function') {
                  this.onServerMeUpdate(data.me);
                }
                if (!this.isSpectator && Array.isArray(data.actions)) {
                  for (const act of data.actions) {
                    this._handleEnvelope({ type: 'ACTION', code: this.roomCode, action: act, senderId: act.playerId }, 'api');
                  }
                }
                if ((!this.isHost || this.isSpectator) && data.state) {
                  this._handleEnvelope({ type: 'STATE', code: this.roomCode, state: data.state }, 'api');
                }
              }
            }
          } catch (e) {}
        }
      }, 350);
    }

    broadcastState(state, tickOnly = false) {
      if (!this.roomCode || !state || this.isSpectator) return;
      this._saveLocalRoomState(state);

      const env = {
        type: 'STATE',
        code: this.roomCode,
        state,
        senderId: this.playerId,
        tickOnly: !!tickOnly,
        ts: Date.now()
      };

      this._broadcastEnvelope(env);

      if (this.backendAvailable) {
        fetch(`/api/room/${this.roomCode}/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state, pid: this.playerId })
        }).then(async (r) => {
          if (r.ok) {
            const d = await r.json();
            if (d && Array.isArray(d.actions)) {
              for (const act of d.actions) {
                this._handleEnvelope({ type: 'ACTION', code: this.roomCode, action: act, senderId: act.playerId }, 'api');
              }
            }
          }
        }).catch(() => {});
      }
    }

    sendAction(action, isUnload = false) {
      if (!this.roomCode || !action || this.isSpectator) return;
      if (!action.id) {
        action.id = 'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      }
      this.seenActionIds.add(action.id);

      const env = {
        type: 'ACTION',
        code: this.roomCode,
        action,
        senderId: this.playerId,
        ts: Date.now()
      };

      try {
        localStorage.setItem(ACTION_STORAGE_PREFIX + this.roomCode, JSON.stringify({
          action,
          senderId: this.playerId,
          ts: Date.now()
        }));
      } catch (e) {}

      this._broadcastEnvelope(env);

      if (this.backendAvailable) {
        const url = `/api/room/${this.roomCode}/action`;
        const body = JSON.stringify({ action });
        if (isUnload && navigator.sendBeacon) {
          navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
        } else {
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: !!isUnload
          }).catch(() => {});
        }
      }
    }

    _broadcastEnvelope(env) {
      if (this.bc) {
        try { this.bc.postMessage(env); } catch (e) {}
      }
      if (this.hostConn && this.hostConn.open) {
        try { this.hostConn.send(env); } catch (e) {}
      }
      for (const conn of this.guestConns.values()) {
        if (conn && conn.open) {
          try { conn.send(env); } catch (e) {}
        }
      }
      if (!env.tickOnly) {
        this._publishWebSocketRelay(env);
      }
    }
  }

  window.F1Multiplayer = new MultiplayerManager();
})();
