/**
 * Socket 工具 — 封装 Socket.IO 连接，提供事件总线
 *
 * 服务端事件名（已对齐）:
 *   客户端发送: room:join, room:leave, room:ready, game:play, game:pass,
 *               game:return_tribute, game:request_state, game:hint, chat:message
 *   服务端发送: room:update, room:kicked, game:start, game:state,
 *               game:play, game:pass, game:next_turn, game:clear_table,
 *               game:finish, game:round_end, game:new_round, game:end,
 *               game:abandoned, game:tribute_returned, game:hint, chat:message, error
 */
const socketManager = {
    _socket: null,
    _handlers: {},
    _pendingJoin: null, // 待重连后加入的房间码

    connect(token) {
        if (this._socket) this.disconnect();

        this._socket = io(window.location.origin, {
            auth: { token },
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
        });

        this._socket.on('connect', () => {
            console.log('[Socket] 已连接:', this._socket.id);
            this._emit('connect');
            // 重连后自动重新加入房间
            const code = this._pendingJoin || (window.store?.room?.code);
            if (code) {
                console.log('[Socket] 重连后自动加入房间:', code);
                this._socket.emit('room:join', { roomCode: code });
            }
        });

        this._socket.on('disconnect', (reason) => {
            console.log('[Socket] 断开:', reason);
            this._emit('disconnect', reason);
        });

        this._socket.on('connect_error', (err) => {
            console.error('[Socket] 连接错误:', err.message);
            this._emit('connect_error', err);
        });

        // 转发所有服务器事件到内部总线
        const events = [
            'room:update', 'room:kicked', 'room:player_disconnected',
            'game:start', 'game:state',
            'game:play', 'game:pass', 'game:next_turn', 'game:clear_table',
            'game:finish', 'game:round_end', 'game:new_round', 'game:end',
            'game:abandoned', 'game:tribute_returned', 'game:hint',
            'chat:message',
            'error',
        ];
        events.forEach(ev => {
            this._socket.on(ev, (data) => this._emit(ev, data));
        });
    },

    disconnect() {
        this._pendingJoin = null;
        if (this._socket) {
            this._socket.disconnect();
            this._socket = null;
        }
    },

    emit(event, data) {
        if (!this._socket) {
            console.warn(`[Socket] emit '${event}' FAIL: no socket`);
            return;
        }
        if (!this._socket.connected) {
            console.warn(`[Socket] emit '${event}' warning: socket not connected`);
        }
        this._socket.emit(event, data);
    },

    on(event, handler) {
        if (!this._handlers[event]) this._handlers[event] = [];
        this._handlers[event].push(handler);
        return () => this.off(event, handler);
    },

    off(event, handler) {
        if (!this._handlers[event]) return;
        this._handlers[event] = this._handlers[event].filter(h => h !== handler);
    },

    offAll(event) {
        if (event) delete this._handlers[event];
        else this._handlers = {};
    },

    _emit(event, data) {
        const handlers = this._handlers[event] || [];
        handlers.forEach(h => { try { h(data); } catch(e) { console.error('[Socket handler error]', e); } });
    },

    isConnected() {
        return this._socket && this._socket.connected;
    },

    // ===== 房间操作 =====
    joinRoom(roomCode) {
        this._pendingJoin = roomCode;
        this.emit('room:join', { roomCode });
    },
    leaveRoom(roomCode) {
        this._pendingJoin = null;
        this.emit('room:leave', { roomCode: roomCode || (window.store?.room?.code) });
    },
    setReady(ready, roomCode) {
        this.emit('room:ready', { roomCode: roomCode || (window.store?.room?.code), ready });
    },
    addBot(roomCode) { this.emit('room:add_bot', { roomCode: roomCode || store.room?.code }); },
    removeBot(botId, roomCode) { this.emit('room:remove_bot', { roomCode: roomCode || store.room?.code, botId }); },

    // ===== 游戏操作 =====
    playCards(cards, gameId) {
        this.emit('game:play', { gameId: gameId || store.game?.gameId, cards });
    },
    passCards(gameId) {
        this.emit('game:pass', { gameId: gameId || store.game?.gameId });
    },
    sendTribute(card, gameId) {
        this.emit('game:tribute', { gameId: gameId || store.game?.gameId, card });
    },
    returnTribute(card, gameId) {
        this.emit('game:return_tribute', { gameId: gameId || store.game?.gameId, card });
    },
    requestState(gameId) {
        this.emit('game:request_state', { gameId: gameId || store.game?.gameId });
    },
    requestHint(gameId) {
        this.emit('game:hint', { gameId: gameId || store.game?.gameId });
    },

    // ===== 聊天 =====
    sendChat(message, roomCode) {
        this.emit('chat:message', { roomCode: roomCode || store.room?.code, message });
    },
};
