/**
 * 大厅视图 — 房间列表、好友、战绩
 */
const LobbyView = {
    _refreshTimer: null,
    _matchmaking: false,   // 是否正在匹配中
    _historyPage: 1,

    init() {
        // 导航切换
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => this._switchPanel(btn.dataset.panel));
        });

        // 退出登录
        document.getElementById('btn-logout').addEventListener('click', () => this._logout());

        // 创建房间
        document.getElementById('btn-create-room').addEventListener('click', () => this._createRoom());

        // 加入房间
        document.getElementById('btn-join-room').addEventListener('click', () => this._joinRoom());
        document.getElementById('input-room-code').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._joinRoom();
        });

        // 快速匹配
        document.getElementById('btn-quick-match').addEventListener('click', () => this._toggleMatch());

        // 签到
        document.getElementById('btn-checkin').addEventListener('click', () => this._doCheckin());

        // 好友搜索
        document.getElementById('btn-search-user').addEventListener('click', () => this._searchUser());
        document.getElementById('input-search-user').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._searchUser();
        });

        // Socket 事件
        socketManager.on('lobby:rooms', (rooms) => this._renderRooms(rooms));
        socketManager.on('lobby:room_created', (room) => {
            store.setRoom(room);
            App.showView('room');
            RoomView.enter(room);
        });

        // 快速匹配 Socket 事件
        socketManager.on('matchmaking:queued', ({ position }) => {
            this._setMatchStatus(true, `匹配中... (${position} 人等待)`);
        });
        socketManager.on('matchmaking:found', ({ roomCode, players }) => {
            this._setMatchStatus(false);
            toast.success('匹配成功！即将开始游戏');
            // 服务端会自动开始游戏，前端等待 game:start 事件
            // 先切换到游戏视图
            store.setRoom({ code: roomCode, players });
            this.leave();
            App.showView('game');
            GameView.enter({ roomCode });
        });
        socketManager.on('matchmaking:timeout', () => {
            this._setMatchStatus(false);
            toast.warning('匹配超时，请重试');
        });
        socketManager.on('matchmaking:cancelled', () => {
            this._setMatchStatus(false);
        });
    },

    async enter() {
        const user = store.user;
        document.getElementById('lobby-username').textContent = user.username;
        const ratingEl = document.getElementById('lobby-rating');
        const rankLabel = ({ bronze: '🥉', silver: '🥈', gold: '🥇', diamond: '💎', master: '👑' })[user.rank_tier] || '';
        ratingEl.textContent = `Lv.${user.current_level || '2'} · ${rankLabel} ${user.rating || 1000}分`;
        this._updateCoinDisplay(user.coins || 0);

        // 连接 Socket
        socketManager.connect(api.getToken());

        // 加载房间列表
        this._loadRooms();
        this._refreshTimer = setInterval(() => this._loadRooms(), 5000);

        // 默认显示房间面板
        this._switchPanel('rooms');

        // 自动检查签到状态和任务红点
        await this._checkDailyStatus();
    },

    _updateCoinDisplay(coins) {
        const el = document.getElementById('lobby-coins');
        el.textContent = `🪙 ${coins}`;
        el.classList.add('coin-pop');
        setTimeout(() => el.classList.remove('coin-pop'), 300);
    },

    async _checkDailyStatus() {
        try {
            const [checkinData, tasksData] = await Promise.all([
                api.getCheckinStatus(),
                api.getTasks(),
            ]);

            let hasPending = false;

            // 未签到则弹出提示
            if (checkinData.canCheckin) {
                hasPending = true;
                toast.info(`📅 今日尚未签到，点击「任务」领取 +${checkinData.nextReward} 🪙`, 6000);
            }

            // 检查是否有可领取的任务
            const tasks = tasksData.tasks || [];
            const hasClaimable = tasks.some(t => t.progress >= t.target && !t.claimed);
            if (hasClaimable) {
                hasPending = true;
                toast.success('🎁 有任务奖励可领取，点击「任务」查看', 5000);
            }

            // 更新任务按钮红点
            const taskBtn = document.querySelector('.nav-btn[data-panel="tasks"]');
            if (taskBtn) {
                taskBtn.classList.toggle('has-badge', hasPending);
            }
        } catch (e) {
            // 静默失败
        }
    },

    leave() {
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }
        // 离开时取消匹配
        if (this._matchmaking) {
            socketManager.emit('matchmaking:cancel');
            this._setMatchStatus(false);
        }
    },

    _switchPanel(panel) {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.panel === panel));
        document.querySelectorAll('.panel').forEach(p => {
            p.classList.toggle('active', p.id === `panel-${panel}`);
            p.classList.toggle('hidden', p.id !== `panel-${panel}`);
        });

        if (panel === 'friends') this._loadFriends();
        if (panel === 'history') { this._historyPage = 1; this._loadHistory(); }
        if (panel === 'tasks') this._loadTasks();
    },

    async _loadRooms() {
        try {
            const data = await api.getRooms();
            this._renderRooms(data.rooms || []);
        } catch (e) {
            // 静默失败
        }
    },

    _renderRooms(rooms) {
        const list = document.getElementById('room-list');
        if (!rooms || rooms.length === 0) {
            list.innerHTML = '<p class="empty-hint">暂无房间，创建一个吧</p>';
            return;
        }
        list.innerHTML = '';
        rooms.forEach(room => {
            const card = document.createElement('div');
            card.className = 'room-card';
            const isPlaying = room.status === 'playing';
            card.innerHTML = `
                <div class="room-card-name">${this._esc(room.name)}</div>
                <div class="room-card-code">${room.code}</div>
                <div class="room-card-players">${room.playerCount}/4</div>
                <div class="room-card-status ${isPlaying ? 'playing' : 'waiting'}">${isPlaying ? '游戏中' : '等待中'}</div>
            `;
            if (!isPlaying && room.playerCount < 4) {
                card.addEventListener('click', () => this._joinRoomByCode(room.code));
            }
            list.appendChild(card);
        });
    },

    async _createRoom() {
        try {
            const data = await api.createRoom(`${store.user.username}的房间`);
            store.setRoom(data.room);
            this.leave();
            App.showView('room');
            RoomView.enter(data.room);
        } catch (err) {
            toast.error(err.message || '创建房间失败');
        }
    },

    async _joinRoom() {
        const code = document.getElementById('input-room-code').value.trim().toUpperCase();
        if (!code) return toast.warning('请输入房间码');
        await this._joinRoomByCode(code);
    },

    async _joinRoomByCode(code) {
        try {
            const data = await api.joinRoom(code);
            store.setRoom(data.room);
            this.leave();
            App.showView('room');
            RoomView.enter(data.room);
        } catch (err) {
            toast.error(err.message || '加入房间失败');
        }
    },

    // ==================== 快速匹配 ====================

    _toggleMatch() {
        if (this._matchmaking) {
            socketManager.emit('matchmaking:cancel');
        } else {
            socketManager.emit('matchmaking:join');
        }
    },

    _setMatchStatus(active, label) {
        this._matchmaking = active;
        const btn = document.getElementById('btn-quick-match');
        if (!btn) return;
        if (active) {
            btn.textContent = label || '取消匹配';
            btn.classList.add('btn-danger');
            btn.classList.remove('btn-primary');
        } else {
            btn.textContent = '快速匹配';
            btn.classList.remove('btn-danger');
            btn.classList.add('btn-primary');
        }
    },

    // ==================== 好友 ====================

    async _searchUser() {
        const q = document.getElementById('input-search-user').value.trim();
        if (!q) return;
        try {
            const data = await api.searchUsers(q);
            this._renderSearchResults(data.users || []);
        } catch (err) {
            toast.error('搜索失败');
        }
    },

    _renderSearchResults(users) {
        const container = document.getElementById('search-results');
        container.classList.remove('hidden');
        container.innerHTML = '';
        if (users.length === 0) {
            container.innerHTML = '<p class="empty-hint">未找到用户</p>';
            return;
        }
        users.forEach(u => {
            const item = document.createElement('div');
            item.className = 'user-item';
            item.innerHTML = `
                <div class="user-item-name">${this._esc(u.username)}</div>
                <button class="btn btn-secondary btn-sm" data-uid="${u.id}">加好友</button>
            `;
            item.querySelector('button').addEventListener('click', () => this._addFriend(u.id));
            container.appendChild(item);
        });
    },

    async _loadFriends() {
        try {
            const data = await api.getFriends();
            const list = document.getElementById('friend-list');
            const friends = data.friends || [];
            if (friends.length === 0) {
                list.innerHTML = '<p class="empty-hint">暂无好友</p>';
                return;
            }
            list.innerHTML = '';
            friends.forEach(f => {
                const item = document.createElement('div');
                item.className = 'user-item';
                item.innerHTML = `
                    <div class="user-item-name">${this._esc(f.username)}</div>
                    <div class="user-item-status ${f.online ? 'online' : ''}">${f.online ? '在线' : '离线'}</div>
                `;
                list.appendChild(item);
            });
        } catch (e) {}
    },

    async _addFriend(userId) {
        try {
            await api.addFriend(userId);
            toast.success('好友请求已发送');
        } catch (err) {
            toast.error(err.message || '发送失败');
        }
    },

    // ==================== 任务 & 签到 ====================

    async _loadTasks() {
        try {
            const [checkinData, tasksData] = await Promise.all([
                api.getCheckinStatus(),
                api.getTasks(),
            ]);
            this._renderCheckin(checkinData);
            this._renderTasks(tasksData.tasks || []);
        } catch (e) {
            document.getElementById('task-list').innerHTML = '<p class="empty-hint">加载失败</p>';
        }
    },

    _renderCheckin(data) {
        const statusEl = document.getElementById('checkin-status');
        const rewardEl = document.getElementById('checkin-reward');
        const btn = document.getElementById('btn-checkin');

        if (data.canCheckin) {
            statusEl.textContent = `连续签到：${data.dayStreak} 天 → 第 ${data.nextStreak} 天奖励`;
            btn.classList.remove('hidden');
            btn.textContent = `每日签到 (+${data.nextReward})`;
            btn.disabled = false;
            rewardEl.classList.add('hidden');
        } else {
            statusEl.textContent = `今日已签到 ✓ （连续 ${data.dayStreak} 天）`;
            btn.classList.add('hidden');
            rewardEl.classList.remove('hidden');
            rewardEl.textContent = `今日获得 +${data.todayRecord?.coins_rewarded || 0} 🪙`;
        }
    },

    _renderTasks(tasks) {
        const list = document.getElementById('task-list');
        if (tasks.length === 0) {
            list.innerHTML = '<p class="empty-hint">暂无任务</p>';
            return;
        }
        list.innerHTML = '';
        tasks.forEach(t => {
            const done = t.progress >= t.target;
            const pct = Math.min(100, (t.progress / t.target) * 100);

            const item = document.createElement('div');
            item.className = `task-item ${t.claimed ? 'claimed' : ''}`;
            item.innerHTML = `
                <div class="task-info">
                    <div class="task-desc">${this._esc(t.description)} (${t.progress}/${t.target})</div>
                    <div class="task-progress-bar">
                        <div class="task-progress-fill ${done ? 'done' : ''}" style="width:${pct}%"></div>
                    </div>
                </div>
                <span class="task-reward">+${t.reward} 🪙</span>
                ${t.claimed
                    ? '<span class="btn btn-ghost btn-sm">已领取</span>'
                    : (done
                        ? '<button class="btn btn-primary btn-task" data-task="' + t.key + '">领取</button>'
                        : '<span class="btn btn-ghost btn-sm">未完成</span>')
                }
            `;

            const claimBtn = item.querySelector('.btn-task');
            if (claimBtn) {
                claimBtn.addEventListener('click', () => this._claimTask(t.key));
            }
            list.appendChild(item);
        });
    },

    async _doCheckin() {
        const btn = document.getElementById('btn-checkin');
        btn.disabled = true;
        try {
            const data = await api.doCheckin();
            this._updateCoinDisplay(data.coins);
            toast.success(`签到成功！+${data.reward} 🪙（连续 ${data.dayStreak} 天）`);
            this._loadTasks();
            // 签到后检查是否还有任务可领，决定红点
            this._updateTaskBadgeAfterClaim();
        } catch (err) {
            toast.error(err.message || '签到失败');
            btn.disabled = false;
        }
    },

    async _claimTask(taskKey) {
        try {
            const data = await api.claimTask(taskKey);
            this._updateCoinDisplay(data.coins);
            toast.success(`任务奖励 +${data.reward} 🪙`);
            this._loadTasks();
            this._updateTaskBadgeAfterClaim();
        } catch (err) {
            toast.error(err.message || '领取失败');
        }
    },

    async _updateTaskBadgeAfterClaim() {
        try {
            const tasksData = await api.getTasks();
            const tasks = tasksData.tasks || [];
            const hasClaimable = tasks.some(t => t.progress >= t.target && !t.claimed);
            const taskBtn = document.querySelector('.nav-btn[data-panel="tasks"]');
            if (taskBtn) {
                taskBtn.classList.toggle('has-badge', hasClaimable);
            }
        } catch (e) {
            // 静默失败
        }
    },

    // ==================== 战绩 ====================

    async _loadHistory() {
        const list = document.getElementById('history-list');
        list.innerHTML = '<p class="empty-hint">加载中...</p>';
        try {
            const data = await api.getHistory(this._historyPage);
            const records = data.history || [];
            if (records.length === 0 && this._historyPage === 1) {
                list.innerHTML = '<p class="empty-hint">暂无战绩</p>';
                return;
            }
            if (this._historyPage === 1) list.innerHTML = '';
            records.forEach(r => this._appendHistoryItem(list, r));

            // 加载更多按钮
            const existing = document.getElementById('btn-load-more-history');
            if (existing) existing.remove();
            if (records.length >= 20) {
                const btn = document.createElement('button');
                btn.id = 'btn-load-more-history';
                btn.className = 'btn btn-secondary';
                btn.textContent = '加载更多';
                btn.addEventListener('click', () => {
                    this._historyPage++;
                    btn.remove();
                    this._loadHistory();
                });
                list.appendChild(btn);
            }
        } catch (e) {
            list.innerHTML = '<p class="empty-hint">加载失败</p>';
        }
    },

    _appendHistoryItem(list, r) {
        const myTeam = r.team;  // 1 = teamA, 2 = teamB
        const won = r.winner_team === myTeam;
        const delta = r.rating_delta;
        const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
        const date = new Date(r.started_at).toLocaleDateString('zh-CN');
        const duration = r.finished_at
            ? Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 60000) + '分钟'
            : '-';

        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `
            <div class="history-result ${won ? 'win' : 'lose'}">${won ? '胜' : '负'}</div>
            <div class="history-levels">
                <span class="level-badge ${myTeam === 1 ? 'my-team' : ''}">A队 ${this._esc(r.team_a_level)}</span>
                <span class="vs">vs</span>
                <span class="level-badge ${myTeam === 2 ? 'my-team' : ''}">B队 ${this._esc(r.team_b_level)}</span>
            </div>
            <div class="history-meta">
                <span class="rating-delta ${delta >= 0 ? 'positive' : 'negative'}">${deltaStr}</span>
                <span class="history-duration">${duration}</span>
                <span class="history-date">${date}</span>
            </div>
            <button class="btn btn-sm btn-ghost replay-btn" data-game-id="${r.id}">回放</button>
        `;
        item.querySelector('.replay-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this._openReplay(r.id);
        });
        list.appendChild(item);
    },

    // ==================== 回放 ====================

    async _openReplay(gameId) {
        try {
            const data = await api.getReplay(gameId);
            const rounds = data.rounds || [];
            if (rounds.length === 0) return toast.warning('暂无回放数据');
            this._showReplayModal(gameId, rounds);
        } catch (e) {
            toast.error('加载回放失败');
        }
    },

    _showReplayModal(gameId, rounds) {
        // 移除旧弹窗
        document.getElementById('replay-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'replay-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal replay-modal">
                <div class="modal-header">
                    <h3>对局回放</h3>
                    <button class="btn-close" id="replay-close">✕</button>
                </div>
                <div class="replay-rounds">
                    ${rounds.map((r, i) => `
                        <button class="btn btn-sm ${i === 0 ? 'btn-primary' : 'btn-secondary'} round-tab"
                                data-round-id="${r.id}" data-game-id="${gameId}">
                            第${r.round_number}局
                        </button>
                    `).join('')}
                </div>
                <div id="replay-content" class="replay-content">
                    <p class="empty-hint">选择回合查看回放</p>
                </div>
                <div class="replay-controls hidden" id="replay-controls">
                    <button class="btn btn-secondary" id="replay-prev">◀ 上一步</button>
                    <span id="replay-step-info">0 / 0</span>
                    <button class="btn btn-secondary" id="replay-next">下一步 ▶</button>
                    <button class="btn btn-primary" id="replay-auto">自动播放</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('#replay-close').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

        // 回合切换
        modal.querySelectorAll('.round-tab').forEach(btn => {
            btn.addEventListener('click', async () => {
                modal.querySelectorAll('.round-tab').forEach(b => {
                    b.classList.remove('btn-primary');
                    b.classList.add('btn-secondary');
                });
                btn.classList.add('btn-primary');
                btn.classList.remove('btn-secondary');
                await this._loadRoundReplay(modal, btn.dataset.gameId, btn.dataset.roundId);
            });
        });

        // 自动加载第一局
        const firstTab = modal.querySelector('.round-tab');
        if (firstTab) this._loadRoundReplay(modal, gameId, firstTab.dataset.roundId);
    },

    async _loadRoundReplay(modal, gameId, roundId) {
        const content = modal.querySelector('#replay-content');
        const controls = modal.querySelector('#replay-controls');
        content.innerHTML = '<p class="empty-hint">加载中...</p>';
        controls.classList.add('hidden');

        try {
            const data = await api.getReplayRound(gameId, roundId);
            const round = data.replay;
            if (!round || !round.move_sequence) {
                content.innerHTML = '<p class="empty-hint">暂无出牌记录</p>';
                return;
            }

            const moves = round.move_sequence;
            let step = 0;

            const render = () => {
                content.innerHTML = '';
                const info = document.createElement('div');
                info.className = 'replay-round-info';
                info.innerHTML = `
                    <span>A队等级: <strong>${this._esc(round.team_a_level_before)}</strong></span>
                    <span>B队等级: <strong>${this._esc(round.team_b_level_before)}</strong></span>
                    <span>完成顺序: ${(round.finish_order || []).map(id => `<span class="player-tag">${id}</span>`).join(' → ')}</span>
                `;
                content.appendChild(info);

                const timeline = document.createElement('div');
                timeline.className = 'replay-timeline';

                moves.slice(0, step + 1).forEach((move, i) => {
                    const row = document.createElement('div');
                    row.className = `replay-move ${i === step ? 'current' : ''}`;
                    const cards = move.cards && move.cards.length > 0
                        ? move.cards.map(c => `<span class="mini-card">${this._cardLabel(c)}</span>`).join('')
                        : '<span class="pass-label">过</span>';
                    row.innerHTML = `
                        <span class="move-player">玩家${move.playerId}</span>
                        <span class="move-cards">${cards}</span>
                        ${move.handType ? `<span class="move-type">${move.handType}</span>` : ''}
                    `;
                    timeline.appendChild(row);
                });

                content.appendChild(timeline);
                modal.querySelector('#replay-step-info').textContent = `${step + 1} / ${moves.length}`;
            };

            controls.classList.remove('hidden');
            render();

            // 上一步
            modal.querySelector('#replay-prev').onclick = () => {
                if (step > 0) { step--; render(); }
            };
            // 下一步
            modal.querySelector('#replay-next').onclick = () => {
                if (step < moves.length - 1) { step++; render(); }
            };
            // 自动播放
            let autoTimer = null;
            const autoBtn = modal.querySelector('#replay-auto');
            autoBtn.onclick = () => {
                if (autoTimer) {
                    clearInterval(autoTimer);
                    autoTimer = null;
                    autoBtn.textContent = '自动播放';
                } else {
                    autoBtn.textContent = '暂停';
                    autoTimer = setInterval(() => {
                        if (step < moves.length - 1) {
                            step++;
                            render();
                        } else {
                            clearInterval(autoTimer);
                            autoTimer = null;
                            autoBtn.textContent = '自动播放';
                        }
                    }, 800);
                }
            };

        } catch (e) {
            content.innerHTML = '<p class="empty-hint">加载失败</p>';
        }
    },

    _cardLabel(card) {
        const suitMap = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
        if (card.suit === 'joker') return card.rank === 'red_joker' ? '大王' : '小鬼';
        return `${suitMap[card.suit] || card.suit}${card.rank}`;
    },

    // ==================== 通用 ====================

    _logout() {
        store.clearUser ? store.clearUser() : (store.user = null);
        api.setToken(null);
        socketManager.disconnect();
        this.leave();
        App.showView('auth');
    },

    _esc(str) {
        return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    },
};
