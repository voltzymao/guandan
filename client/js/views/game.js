/**
 * 游戏视图 — 核心游戏界面
 *
 * 服务端 game:state 数据结构:
 * {
 *   gameId, phase, roundNumber,
 *   teamALevel, teamBLevel,
 *   currentPlayer: userId,
 *   lastPlay: Card[],
 *   lastPlayerId: userId,
 *   finishOrder: userId[],
 *   myHand: Card[],
 *   handCounts: { [userId]: number },
 *   tributeInfo: { type, tributes, pendingReturns } | null,
 *   players: [{ id, username, team }]  // 按座位顺序
 * }
 *
 * Card 结构: { suit: 'spades'|'hearts'|'diamonds'|'clubs', rank: '2'~'A'|'red_joker'|'black_joker' }
 *
 * 座位映射（以自己为 bottom）:
 *   offset 0 = bottom（自己）
 *   offset 1 = right
 *   offset 2 = top（队友）
 *   offset 3 = left
 */
const GameView = {
    _state: null,
    _gameId: null,
    _myIndex: -1,
    _tributeSelected: null,
    _tributePhase: null,
    _unsubs: [],
    _arranged: true,  // 默认使用理牌模式
    _selectedGroup: false,  // 选中牌左侧纵向堆叠
    _arrangePlans: [],
    _arrangePlanIndex: 0,
    _dragActive: false, // 拖拽刷选中，避免中途重渲

    _DIRS: ['bottom', 'right', 'top', 'left'],

    init() {
        document.getElementById('btn-play').addEventListener('click', () => this._play());
        document.getElementById('btn-pass').addEventListener('click', () => this._pass());
        document.getElementById('btn-hint').addEventListener('click', () => this._hint());
        document.getElementById('btn-arrange').addEventListener('click', () => this._toggleArrange());
        document.getElementById('btn-cycle-arrange').addEventListener('click', () => this._cycleArrange());
        document.getElementById('btn-group-selected').addEventListener('click', () => this._toggleSelectedGroup());

        document.getElementById('btn-toggle-chat').addEventListener('click', () => {
            document.getElementById('game-chat').classList.toggle('collapsed');
        });
        document.getElementById('btn-game-chat-send').addEventListener('click', () => this._sendChat());
        document.getElementById('game-chat-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._sendChat();
        });

        document.getElementById('btn-confirm-tribute').addEventListener('click', () => this._confirmTribute());
        document.getElementById('btn-round-continue').addEventListener('click', () => {
            document.getElementById('modal-round-end').classList.add('hidden');
        });
        document.getElementById('btn-play-again').addEventListener('click', () => this._backToLobby());
        document.getElementById('btn-back-lobby').addEventListener('click', () => this._backToLobby());
    },

    enter(startData) {
        this._state = null;
        this._myIndex = -1;
        this._tributeSelected = null;
        this._tributePhase = null;
        this._gameId = startData?.gameId || null;
        this._arranged = true;
        this._selectedGroup = false;
        this._arrangePlans = [];
        this._arrangePlanIndex = 0;
        store.clearSelection();

        const arrangeBtn = document.getElementById('btn-arrange');
        if (arrangeBtn) { arrangeBtn.textContent = '普通'; arrangeBtn.classList.add('active'); }

        document.getElementById('game-chat-messages').innerHTML = '';
        document.getElementById('game-chat').classList.add('collapsed');
        document.getElementById('modal-round-end').classList.add('hidden');
        document.getElementById('modal-game-end').classList.add('hidden');
        document.getElementById('modal-tribute').classList.add('hidden');

        // 订阅 Socket 事件
        this._unsubs = [
            socketManager.on('game:start', (d) => {
                this._gameId = d.gameId || this._gameId;
            }),
            socketManager.on('game:state', (s) => this._onState(s)),
            socketManager.on('game:play', (d) => this._onPlay(d)),
            socketManager.on('game:pass', (d) => this._onPass(d)),
            socketManager.on('game:next_turn', (d) => this._onNextTurn(d)),
            socketManager.on('game:clear_table', (d) => this._onClearTable(d)),
            socketManager.on('game:finish', (d) => this._onFinish(d)),
            socketManager.on('game:round_end', (d) => this._onRoundEnd(d)),
            socketManager.on('game:new_round', (d) => this._onNewRound(d)),
            socketManager.on('game:end', (d) => this._onGameEnd(d)),
            socketManager.on('game:abandoned', (d) => this._onAbandoned(d)),
            socketManager.on('game:tribute_completed', (d) => this._onTributeCompleted(d)),
            socketManager.on('game:tribute_returned', (d) => this._onTributeReturned(d)),
            socketManager.on('game:hint', (d) => this._onHint(d)),
            socketManager.on('chat:message', (d) => this._onChat(d)),
        ];

        // 请求初始状态
        if (this._gameId) {
            socketManager.requestState(this._gameId);
        }
    },

    leave() {
        this._unsubs.forEach(fn => fn && fn());
        this._unsubs = [];
        Timer.stop();
    },

    // ===== Socket 事件处理 =====

    _onState(state) {
        this._state = state;
        this._gameId = state.gameId || this._gameId;
        store.setGame(state);

        // 确定自己的索引
        if (this._myIndex < 0 && store.user && state.players) {
            this._myIndex = state.players.findIndex(p => p.id === store.user.id);
        }

        // 只在手牌内容真正变化时才重置并重新渲染
        if (state.myHand) {
            const newKey = state.myHand.map(c => store._cardKey(c)).sort().join(',');
            const oldKey = store.myHand.map(c => store._cardKey(c)).sort().join(',');
            if (newKey !== oldKey) {
                store.setHand(state.myHand);
                this._renderHand();
            }
        }

        this._renderAll(state);

        // 进贡阶段
        if (state.phase === 'tribute' || state.phase === 'return_tribute') {
            this._handleTributePhase(state);
        }
    },

    _onPlay(data) {
        // data: { userId, cards, evalResult }
        const dir = this._getDir(data.userId);
        const playedEl = document.getElementById(`played-${dir}`);
        if (playedEl) Hand.renderPlayed(playedEl, data.cards, this._state?.levelRank);

        // 更新手牌数
        if (this._state && this._state.handCounts) {
            this._state.handCounts[data.userId] = (this._state.handCounts[data.userId] || 0) - data.cards.length;
            const countEl = document.getElementById(`count-${dir}`);
            if (countEl) countEl.textContent = `${this._state.handCounts[data.userId]}张`;
        }

        // 更新背面手牌
        if (dir !== 'bottom') {
            const handEl = document.getElementById(`hand-${dir}`);
            const cnt = this._state?.handCounts?.[data.userId] || 0;
            if (handEl) Hand.renderBack(handEl, cnt, dir === 'left' || dir === 'right');
        }

        // 炸弹特效
        const type = data.evalResult?.type;
        if (type === 'bomb' || type === 'joker_bomb') {
            document.getElementById('game-center').classList.add('anim-bomb');
            setTimeout(() => document.getElementById('game-center').classList.remove('anim-bomb'), 600);
            toast.info('💣 炸弹！', 2000);
        }

        // 更新中央出牌区
        Hand.renderPlayed(document.getElementById('last-play-cards'), data.cards, this._state?.levelRank);
        const player = this._state?.players?.find(p => p.id === data.userId);
        document.getElementById('last-play-info').textContent = player ? `${player.username} 出牌` : '';
    },

    _onPass(data) {
        // data: { userId }
        const dir = this._getDir(data.userId);
        this._showPlayerMessage(dir, '不出');
    },

    _onNextTurn(data) {
        // data: { nextPlayer: userId }
        this._updateTurnIndicator(data.nextPlayer);
        const isMyTurn = data.nextPlayer === store.user?.id;
        document.getElementById('player-bottom').classList.toggle('my-turn', isMyTurn);
        document.getElementById('btn-play').disabled = !isMyTurn;
        document.getElementById('btn-pass').disabled = !isMyTurn;

        if (isMyTurn) {
            Timer.start(30, () => socketManager.passCards(this._gameId));
            toast.info('轮到你出牌了', 2000);
        } else {
            Timer.stop();
        }
    },

    _onClearTable(data) {
        // 清空所有出牌区
        ['bottom', 'top', 'left', 'right'].forEach(dir => {
            const el = document.getElementById(`played-${dir}`);
            if (el) el.innerHTML = '';
        });
        document.getElementById('last-play-cards').innerHTML = '';
        document.getElementById('last-play-info').textContent = '';

        // 下一个出牌
        if (data.nextPlayer) this._onNextTurn({ nextPlayer: data.nextPlayer });
    },

    _onFinish(data) {
        // data: { userId, position }
        const player = this._state?.players?.find(p => p.id === data.userId);
        const name = player?.username || '玩家';
        const pos = ['头游', '二游', '三游', '末游'][data.position - 1] || `第${data.position}名`;
        toast.info(`${name} ${pos}！`, 3000);
    },

    _onRoundEnd(data) {
        Timer.stop();
        const modal = document.getElementById('modal-round-end');
        const winTeam = data.levelResult?.winTeam || data.winTeam;
        document.getElementById('round-end-title').textContent = winTeam ? `${winTeam}队获胜！` : '本局结束';

        const orderEl = document.getElementById('round-end-order');
        orderEl.innerHTML = '<h4>出完顺序</h4>';
        if (data.finishOrder && this._state?.players) {
            data.finishOrder.forEach((uid, rank) => {
                const p = this._state.players.find(pl => pl.id === uid);
                const div = document.createElement('div');
                div.textContent = `第${rank + 1}名: ${p?.username || uid}`;
                orderEl.appendChild(div);
            });
        }

        const levelsEl = document.getElementById('round-end-levels');
        levelsEl.innerHTML = `<div>A队: ${data.levelResult?.teamALevel || data.teamALevel || '?'} | B队: ${data.levelResult?.teamBLevel || data.teamBLevel || '?'}</div>`;

        modal.classList.remove('hidden');
    },

    _onNewRound(data) {
        // 更新等级显示
        document.getElementById('level-team-a').textContent = `A队: ${data.teamALevel}`;
        document.getElementById('level-team-b').textContent = `B队: ${data.teamBLevel}`;
        toast.info(`第${data.roundNumber}局开始`, 2000);
    },

    _onGameEnd(data) {
        Timer.stop();
        const modal = document.getElementById('modal-game-end');
        const myTeam = this._getMyTeam();
        const won = data.winnerTeam === myTeam;
        const myId = store.user?.id;

        // 查找我的金币变化
        let coinHtml = '';
        if (data.coinResults && myId) {
            const myCoin = data.coinResults.find(r => r.userId === myId);
            if (myCoin) {
                const deltaStr = myCoin.coinDelta >= 0 ? `+${myCoin.coinDelta}` : `${myCoin.coinDelta}`;
                const cls = myCoin.coinDelta >= 0 ? 'coin-result' : 'coin-result negative';
                coinHtml = `<div class="${cls}">金币变化: ${deltaStr} 🪙（余额: ${myCoin.coins}）</div>`;
                // 更新大厅金币显示
                if (store.user) store.user.coins = myCoin.coins;
            }
        }

        document.getElementById('game-end-title').textContent = won ? '🏆 恭喜获胜！' : '😔 很遗憾，失败了';
        document.getElementById('game-end-stats').innerHTML = `
            <div>获胜队伍: ${data.winnerTeam}队${data.isDoubleDown ? '（双下）' : ''}</div>
            ${coinHtml}
        `;
        modal.classList.remove('hidden');
    },

    _onAbandoned(data) {
        Timer.stop();
        toast.error(data.reason || '游戏已结束（玩家离开）', 5000);
        setTimeout(() => this._backToLobby(), 3000);
    },

    _onTributeCompleted(data) {
        const player = this._state?.players?.find(p => p.id === data.userId);
        if (player) toast.info(`${player.username} 完成进贡`);
    },

    _onTributeReturned(data) {
        const player = this._state?.players?.find(p => p.id === data.userId);
        if (player) toast.info(`${player.username} 完成还贡`);
    },

    _onChat(data) {
        const container = document.getElementById('game-chat-messages');
        const el = document.createElement('div');
        el.className = 'chat-msg';
        el.innerHTML = `<span class="chat-sender">${this._esc(data.username)}</span>: ${this._esc(data.message)}`;
        container.appendChild(el);
        container.scrollTop = container.scrollHeight;
    },

    // ===== 进贡处理 =====

    _handleTributePhase(state) {
        if (!state.tributeInfo) return;
        const myId = store.user?.id;
        const info = state.tributeInfo;
        const isTributePhase = state.phase === 'tribute';
        const isReturnPhase = state.phase === 'return_tribute';

        const needsTribute = isTributePhase && info.pendingTributes?.includes(myId);
        const needsReturn = isReturnPhase && info.pendingReturns?.includes(myId);
        if (!needsTribute && !needsReturn) return;

        this._tributePhase = state.phase;
        const modal = document.getElementById('modal-tribute');
        const leftArea = document.getElementById('tribute-left-area');
        const rightArea = document.getElementById('tribute-right-area');
        const confirmBtn = document.getElementById('btn-confirm-tribute');
        this._tributeSelected = null;
        confirmBtn.disabled = true;

        if (needsTribute) {
            document.getElementById('tribute-title').textContent = '进贡';
            document.getElementById('tribute-desc').textContent = '请选择一张牌进贡给对方';

            Hand.renderTribute(leftArea, store.myHand,
                (card) => {
                    this._tributeSelected = card;
                    confirmBtn.disabled = false;
                    Hand.renderTribute(leftArea, store.myHand,
                        (c) => { this._tributeSelected = c; confirmBtn.disabled = false; },
                        HandAnalyzer.cardKey(card)
                    );
                }, null
            );

            rightArea.innerHTML = '<div class="tribute-placeholder">对方将退还一张牌给你</div>';
        } else if (needsReturn) {
            document.getElementById('tribute-title').textContent = '还贡';
            document.getElementById('tribute-desc').textContent = '请选择一张牌还给对方';

            // 左栏：展示收到的进贡牌
            const myTribute = info.tributes.find(t => t.to === myId);
            if (myTribute && myTribute.card) {
                Card.renderDisplay(leftArea, [myTribute.card]);
            } else {
                leftArea.innerHTML = '<div class="tribute-placeholder">对方未进贡</div>';
            }

            // 右栏：选择还贡牌
            Hand.renderTribute(rightArea, store.myHand,
                (card) => {
                    this._tributeSelected = card;
                    confirmBtn.disabled = false;
                    Hand.renderTribute(rightArea, store.myHand,
                        (c) => { this._tributeSelected = c; confirmBtn.disabled = false; },
                        HandAnalyzer.cardKey(card)
                    );
                }, null
            );
        }

        modal.classList.remove('hidden');
    },

    _confirmTribute() {
        if (!this._tributeSelected) return;

        if (this._tributePhase === 'tribute') {
            socketManager.sendTribute(this._tributeSelected, this._gameId);
        } else {
            socketManager.returnTribute(this._tributeSelected, this._gameId);
        }

        document.getElementById('modal-tribute').classList.add('hidden');
        this._tributeSelected = null;
    },

    // ===== 渲染 =====

    _renderAll(state) {
        if (!state || !state.players) return;

        // 等级
        document.getElementById('level-team-a').textContent = `A队: ${state.teamALevel || 2}`;
        document.getElementById('level-team-b').textContent = `B队: ${state.teamBLevel || 2}`;

        // 各玩家
        state.players.forEach((player, idx) => {
            const dir = this._getDir(player.id);
            const nameEl = document.getElementById(`name-${dir}`);
            const countEl = document.getElementById(`count-${dir}`);
            if (nameEl) nameEl.textContent = player.username;

            const cnt = dir === 'bottom'
                ? (state.myHand?.length || 0)
                : (state.handCounts?.[player.id] || 0);
            if (countEl) countEl.textContent = `${cnt}张`;

            const handEl = document.getElementById(`hand-${dir}`);
            if (handEl && dir !== 'bottom') {
                Hand.renderBack(handEl, cnt, dir === 'left' || dir === 'right');
            }
        });

        // 最后出牌
        if (state.lastPlay && state.lastPlay.length > 0) {
            Hand.renderPlayed(document.getElementById('last-play-cards'), state.lastPlay, state.levelRank);
            const lastPlayer = state.players.find(p => p.id === state.lastPlayerId);
            document.getElementById('last-play-info').textContent = lastPlayer ? `${lastPlayer.username} 出牌` : '';
        }

        // 当前轮次
        if (state.currentPlayer) {
            this._updateTurnIndicator(state.currentPlayer);
            const isMyTurn = state.currentPlayer === store.user?.id;
            document.getElementById('player-bottom').classList.toggle('my-turn', isMyTurn);
            document.getElementById('btn-play').disabled = !isMyTurn;
            document.getElementById('btn-pass').disabled = !isMyTurn;
            if (isMyTurn) Timer.start(30, () => socketManager.passCards(this._gameId));
        }
    },

    // ===== 操作 =====

    _toggleCard(card) {
        store.toggleCard(card);
        this._updateCardSelection(card);
        document.getElementById('btn-play').disabled = store.selectedCards.length === 0;
    },

    /** 直接更新 DOM 中对应卡片的选中状态，避免整手重渲 */
    _updateCardSelection(card) {
        const key = store._cardKey(card);
        const isSelected = store.selectedCards.some(c => store._cardKey(c) === key);
        document.querySelectorAll('#hand-bottom .card').forEach(el => {
            if (el.dataset.cardId === key) {
                el.classList.toggle('selected', isSelected);
            }
        });
    },

    /** 框选回调：批量添加选中的牌 */
    _selectCards(cards) {
        cards.forEach(c => {
            const key = store._cardKey(c);
            const already = store.selectedCards.some(s => store._cardKey(s) === key);
            if (!already) {
                store.selectedCards.push(c);
                this._updateCardSelection(c);
            }
        });
        document.getElementById('btn-play').disabled = store.selectedCards.length === 0;
    },

    _renderHand() {
        const handEl = document.getElementById('hand-bottom');
        if (!handEl) return;
        if (this._arranged) {
            this._renderArrangedHand(handEl);
        } else {
            Hand.renderFront(
                handEl, store.myHand, store.selectedCards,
                (c) => this._toggleCard(c),
                this._state?.levelRank,
                (cards) => this._selectCards(cards),
                this._selectedGroup,
                // 拖拽生命周期：开始时暂停重渲，结束时一次性刷新
                () => { this._dragActive = true; },
                () => { this._dragActive = false; this._renderHand(); }
            );
        }
        this._updateGroupSelectedBtn();
    },

    _renderArrangedHand(handEl) {
        const result = HandAnalyzer.arrangeAlternatives(store.myHand, this._state?.levelRank || '2');
        this._arrangePlans = result.plans;
        this._arrangePlanIndex = result.defaultIndex;
        const plan = this._arrangePlans[this._arrangePlanIndex];
        Hand.renderArranged(
            handEl, plan, store.selectedCards,
            (c) => this._toggleCard(c),
            (cards) => this._selectStack(cards),
            this._state?.levelRank,
            // 拖拽生命周期
            () => { this._dragActive = true; },
            () => { this._dragActive = false; this._renderHand(); }
        );
        // 切换按钮显隐
        const cycleBtn = document.getElementById('btn-cycle-arrange');
        if (cycleBtn) {
            if (this._arrangePlans.length > 1) {
                cycleBtn.classList.remove('hidden');
                cycleBtn.textContent = '↻ ' + (this._arrangePlanIndex + 1);
            } else {
                cycleBtn.classList.add('hidden');
            }
        }
    },

    /** 点击整组牌：全选则取消，否则添加 */
    _selectStack(cards) {
        const allSelected = cards.every(c => {
            const key = store._cardKey(c);
            return store.selectedCards.some(s => store._cardKey(s) === key);
        });
        if (allSelected) {
            const keys = new Set(cards.map(c => store._cardKey(c)));
            store.selectedCards = store.selectedCards.filter(s => !keys.has(store._cardKey(s)));
            cards.forEach(c => this._updateCardSelection(c));
        } else {
            cards.forEach(c => {
                const key = store._cardKey(c);
                const already = store.selectedCards.some(s => store._cardKey(s) === key);
                if (!already) {
                    store.selectedCards.push(c);
                    this._updateCardSelection(c);
                }
            });
        }
        document.getElementById('btn-play').disabled = store.selectedCards.length === 0;
    },

    /** 切换理牌/普通模式 */
    _toggleArrange() {
        this._arranged = !this._arranged;
        const btn = document.getElementById('btn-arrange');
        btn.textContent = this._arranged ? '普通' : '理牌';
        btn.classList.toggle('active', this._arranged);
        this._renderHand();
    },

    /** 循环切换同花顺排列方案 */
    _cycleArrange() {
        if (!this._arranged || this._arrangePlans.length <= 1) return;
        this._arrangePlanIndex = (this._arrangePlanIndex + 1) % this._arrangePlans.length;
        this._renderHand();
    },

    /** 切换选中牌理牌（左侧纵向堆叠） */
    _toggleSelectedGroup() {
        if (store.selectedCards.length === 0) return;
        this._selectedGroup = !this._selectedGroup;
        this._renderHand();
    },

    _updateGroupSelectedBtn() {
        const btn = document.getElementById('btn-group-selected');
        if (!btn) return;
        const hasSelected = store.selectedCards.length > 0;
        if (hasSelected && !this._arranged) {
            btn.classList.remove('hidden');
            btn.textContent = this._selectedGroup ? '取消理牌' : '理牌';
        } else {
            btn.classList.add('hidden');
            this._selectedGroup = false;
        }
    },

    _play() {
        if (store.selectedCards.length === 0) {
            toast.warning('请先选择要出的牌');
            return;
        }
        socketManager.playCards(store.selectedCards, this._gameId);
        store.clearSelection();
        this._renderHand();
    },

    _pass() {
        socketManager.passCards(this._gameId);
    },

    _hint() {
        socketManager.requestHint(this._gameId);
    },

    _onHint(data) {
        const cards = data.cards;
        store.clearSelection();
        document.querySelectorAll('#hand-bottom .card').forEach(el => el.classList.remove('selected'));
        if (cards && cards.length > 0) {
            cards.forEach(c => {
                store.toggleCard(c);
                this._updateCardSelection(c);
            });
            document.getElementById('btn-play').disabled = false;
            toast.info('已选中建议的牌');
        } else {
            document.getElementById('btn-play').disabled = true;
            toast.info('建议过牌');
        }
    },

    _sendChat() {
        const input = document.getElementById('game-chat-input');
        const msg = input.value.trim();
        if (!msg) return;
        socketManager.sendChat(msg, store.room?.code);
        input.value = '';
    },

    _backToLobby() {
        document.getElementById('modal-game-end').classList.add('hidden');
        socketManager.emit('room:leave', { roomCode: store.room?.code });
        this.leave();
        App.showView('lobby');
        LobbyView.enter();
    },

    // ===== 工具 =====

    _getDir(userId) {
        if (!this._state?.players || this._myIndex < 0) return 'bottom';
        const idx = this._state.players.findIndex(p => p.id === userId);
        if (idx < 0) return 'bottom';
        const offset = (idx - this._myIndex + 4) % 4;
        return this._DIRS[offset];
    },

    _getMyTeam() {
        if (!this._state?.players || this._myIndex < 0) return null;
        return this._state.players[this._myIndex]?.team;
    },

    _updateTurnIndicator(userId) {
        document.querySelectorAll('.turn-indicator').forEach(el => el.classList.remove('active'));
        const dir = this._getDir(userId);
        const indicator = document.getElementById(`turn-${dir}`);
        if (indicator) indicator.classList.add('active');
    },

    _showMessage(msg) {
        const el = document.getElementById('game-message');
        el.textContent = msg;
        el.classList.remove('hidden');
        clearTimeout(this._msgTimer);
        this._msgTimer = setTimeout(() => el.classList.add('hidden'), 2000);
    },

    _showPlayerMessage(dir, msg) {
        const area = document.getElementById(`player-${dir}`);
        if (!area) return;
        const bubble = document.createElement('div');
        bubble.className = 'game-message anim-slide-up';
        bubble.textContent = msg;
        bubble.style.position = 'absolute';
        bubble.style.zIndex = '10';
        area.style.position = 'relative';
        area.appendChild(bubble);
        setTimeout(() => bubble.remove(), 1500);
    },

    _esc(str) {
        return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    },
};
