/**
 * 房间等待视图 — 座位、准备、聊天
 */
const RoomView = {
    _isReady: false,
    _unsubs: [],
    _currentRoom: null,

    init() {
        document.getElementById('btn-leave-room').addEventListener('click', () => this._leaveRoom());
        document.getElementById('btn-copy-code').addEventListener('click', () => this._copyCode());
        document.getElementById('btn-ready').addEventListener('click', () => this._toggleReady());
        document.getElementById('btn-add-bot').addEventListener('click', () => this._addBot());

        document.getElementById('btn-room-chat-send').addEventListener('click', () => this._sendChat());
        document.getElementById('room-chat-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._sendChat();
        });
    },

    enter(room) {
        this._isReady = false;
        this._currentRoom = null;
        const btn = document.getElementById('btn-ready');
        btn.textContent = '准备';
        btn.classList.remove('btn-ready-active');
        document.getElementById('room-chat-messages').innerHTML = '';

        if (room) {
            document.getElementById('room-code-display').textContent = room.code;
            store.setRoom(room);
            this._currentRoom = room;
            if (room.players) this._renderSeats(room.players, room.hostId);
            this._updateBotButton(room);
        }

        // 先注册事件监听，再发送 room:join，避免 race condition 丢失 room:update
        this._unsubs = [
            socketManager.on('room:update', (data) => this._onRoomUpdate(data)),
            socketManager.on('chat:message', (data) => this._onChat(data)),
            socketManager.on('game:start', (data) => this._onGameStart(data)),
            socketManager.on('room:kicked', () => {
                toast.warning('你被踢出了房间');
                this.leave();
                App.showView('lobby');
                LobbyView.enter();
            }),
        ];

        socketManager.joinRoom(store.room.code);
    },

    leave() {
        this._unsubs.forEach(fn => fn && fn());
        this._unsubs = [];
        this._currentRoom = null;
    },

    _onRoomUpdate(data) {
        const room = data.code ? data : (data.room || data);
        this._currentRoom = room;
        if (room.players) this._renderSeats(room.players, room.hostId);
        if (room.code) document.getElementById('room-code-display').textContent = room.code;
        this._updateBotButton(room);
    },

    _renderSeats(players, hostId) {
        for (let i = 0; i < 4; i++) {
            const seat = document.getElementById(`seat-${i}`);
            if (!seat) continue;
            const player = players[i];
            const nameEl = seat.querySelector('.seat-name');
            const statusEl = seat.querySelector('.seat-status');

            if (player) {
                seat.className = 'seat occupied';
                if (player.isAI) seat.classList.add('ai');
                if (player.id === store.user?.id) seat.classList.add('self');
                if (player.ready || player.isAI) seat.classList.add('ready');

                const isHost = player.id === hostId;
                nameEl.textContent = player.username + (isHost ? ' 👑' : '') + (player.isAI ? ' 🤖' : '');
                statusEl.textContent = player.isAI ? 'AI' : (player.ready ? '已准备' : '未准备');
                statusEl.className = `seat-status ${(player.ready || player.isAI) ? 'ready' : ''}`;

                // 房主可以点击 AI 座位来移除
                const iAmHost = store.user?.id === hostId;
                if (iAmHost && player.isAI) {
                    seat.style.cursor = 'pointer';
                    seat.title = '点击移除机器人';
                    seat.onclick = () => socketManager.removeBot(player.id, store.room?.code);
                } else {
                    seat.style.cursor = '';
                    seat.title = '';
                    seat.onclick = null;
                }
            } else {
                seat.className = 'seat';
                seat.style.cursor = '';
                seat.title = '';
                seat.onclick = null;
                nameEl.textContent = '等待玩家...';
                statusEl.textContent = '';
                statusEl.className = 'seat-status';
            }
        }
    },

    _updateBotButton(room) {
        const btn = document.getElementById('btn-add-bot');
        if (!btn) return;
        const iAmHost = store.user?.id === room.hostId;
        const hasEmpty = (room.players || []).length < 4;
        const isWaiting = room.status === 'waiting';
        if (iAmHost && hasEmpty && isWaiting) {
            btn.classList.remove('hidden');
        } else {
            btn.classList.add('hidden');
        }
    },

    _addBot() {
        socketManager.addBot(store.room?.code);
    },

    _onChat(data) {
        const msgs = document.getElementById('room-chat-messages');
        const el = document.createElement('div');
        el.className = 'chat-msg';
        el.innerHTML = `<span class="chat-sender">${this._esc(data.username)}</span>: ${this._esc(data.message)}`;
        msgs.appendChild(el);
        msgs.scrollTop = msgs.scrollHeight;
    },

    _onGameStart(data) {
        this.leave();
        App.showView('game');
        GameView.enter(data);
    },

    _toggleReady() {
        this._isReady = !this._isReady;
        const btn = document.getElementById('btn-ready');
        btn.textContent = this._isReady ? '取消准备' : '准备';
        btn.classList.toggle('btn-ready-active', this._isReady);
        socketManager.setReady(this._isReady, store.room?.code);
    },

    _sendChat() {
        const input = document.getElementById('room-chat-input');
        const msg = input.value.trim();
        if (!msg) return;
        socketManager.sendChat(msg, store.room?.code);
        input.value = '';
    },

    _leaveRoom() {
        socketManager.leaveRoom(store.room?.code);
        this.leave();
        App.showView('lobby');
        LobbyView.enter();
    },

    _copyCode() {
        const code = store.room?.code;
        if (!code) return;
        navigator.clipboard.writeText(code).then(() => toast.success('房间码已复制'));
    },

    _esc(str) {
        return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    },
};
