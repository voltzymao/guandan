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
    _tributeMode: null, // 'tribute' | 'return_tribute' | null
    _unsubs: [],
    _arranged: true,  // 默认使用理牌模式
    _selectedGroup: false,  // 选中牌左侧纵向堆叠
    _arrangePlans: [],
    _arrangePlanIndex: 0,
    _dragActive: false, // 拖拽刷选中，避免中途重渲
    _lastResistRound: null,

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
        this._tributeMode = null;
        this._tributeSelected = null;
        this._lastResistRound = null;
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
        console.log('[Game] state.phase=', state.phase, 'levelRank=', state.levelRank, 'teamA=', state.teamALevel, 'teamB=', state.teamBLevel);

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

        // 兜底：如果 hand-bottom 为空但有手牌数据，强制渲染
        const handEl = document.getElementById('hand-bottom');
        if (handEl && handEl.children.length === 0 && state.myHand && state.myHand.length > 0) {
            store.setHand(state.myHand);
            this._renderHand();
        }

        // 进贡阶段
        if (state.phase === 'tribute' || state.phase === 'return_tribute') {
            this._handleTributePhase(state);
        } else if (this._tributeMode) {
            // 阶段结束，清除进贡模式
            this._clearTributeMode();
        }

        // 抗贡：不在进贡阶段但有 tributeInfo 且为 resist
        if (state.tributeInfo?.type === 'resist' && state.roundNumber !== this._lastResistRound) {
            this._lastResistRound = state.roundNumber;
            const ri = state.tributeInfo;
            const resister = state.players?.find(p => p.id === ri.resisterId);
            const resisterName = resister ? resister.username : '某玩家';
            const fp = state.players?.find(p => p.id === ri.firstPlayer);
            const fpName = fp ? fp.username : '';
            toast.info(`抗贡！${resisterName} 手握双大王，${fpName} 先出牌`, 5000);
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
            // 清除提示选中的牌
            store.clearSelection();
            document.querySelectorAll('#hand-bottom .card').forEach(el => el.classList.remove('selected'));
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

        // 清空上一局的所有出牌区和进贡区
        ['bottom', 'top', 'left', 'right'].forEach(dir => {
            const el = document.getElementById(`played-${dir}`);
            if (el) el.innerHTML = '';
        });
        document.getElementById('last-play-cards').innerHTML = '';
        document.getElementById('last-play-info').textContent = '';
        document.getElementById('tribute-display').innerHTML = '';
        document.getElementById('tribute-display').classList.add('hidden');

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

    /** 在中央区域展示进贡/还贡信息 */
    _updateTributeDisplay() {
        const info = this._state?.tributeInfo;
        if (!info || !info.tributes) return;

        const container = document.getElementById('tribute-display');
        container.innerHTML = '';

        info.tributes.forEach(t => {
            const fromPlayer = this._state?.players?.find(p => p.id === t.from);
            const toPlayer = this._state?.players?.find(p => p.id === t.to);
            const fromName = fromPlayer?.username || '';
            const toName = toPlayer?.username || '';

            const div = document.createElement('div');
            div.className = 'tribute-item';

            if (t.card) {
                // 已完成的进贡/还贡
                const cardName = this._cardName(t.card);
                const returnT = info.tributes.find(rt => rt.from === t.to && rt.to === t.from);
                const isReturned = returnT && returnT.card;
                div.innerHTML = `
                    <span class="tribute-from">${fromName}</span>
                    <span class="tribute-arrow">→</span>
                    <span class="tribute-card">${cardName}</span>
                    <span class="tribute-arrow">→</span>
                    <span class="tribute-to">${toName}</span>
                    ${isReturned ? `<span class="tribute-return">(已还${this._cardName(returnT.card)})</span>` : ''}
                `;
            } else {
                // 待进贡
                div.innerHTML = `
                    <span class="tribute-from">${fromName}</span>
                    <span class="tribute-arrow">等待进贡→</span>
                    <span class="tribute-to">${toName}</span>
                `;
            }
            container.appendChild(div);
        });

        if (container.children.length > 0) {
            container.classList.remove('hidden');
        }
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
        // 用 String 比较避免服务端/客户端 ID 类型不一致
        const idStr = String(myId);
        const needsTribute = state.phase === 'tribute' && info.pendingTributes?.some(id => String(id) === idStr);
        const needsReturn = state.phase === 'return_tribute' && info.pendingReturns?.some(id => String(id) === idStr);
        if (!needsTribute && !needsReturn) return;

        this._tributePhase = state.phase;
        this._tributeMode = needsTribute ? 'tribute' : 'return_tribute';
        this._tributeSelected = null;
        store.clearSelection();
        document.querySelectorAll('#hand-bottom .card').forEach(el => el.classList.remove('selected'));

        // 更新按钮：隐藏出牌/不出/提示，显示确认
        const playBtn = document.getElementById('btn-play');
        const passBtn = document.getElementById('btn-pass');
        const hintBtn = document.getElementById('btn-hint');
        playBtn.textContent = needsTribute ? '确认进贡' : '确认还贡';
        playBtn.disabled = true;
        passBtn.classList.add('hidden');
        hintBtn.classList.add('hidden');

        // 自动选中默认牌（进贡最大牌 / 还贡最小<=10的牌）
        const eligible = store.myHand.filter(c => this._isTributeEligible(c));
        if (eligible.length > 0) {
            const autoCard = needsTribute
                ? eligible[eligible.length - 1] // 进贡选最大的
                : eligible[0]; // 还贡选最小的
            this._toggleCard(autoCard);
        }

        // 显示进贡/还贡信息（info 已在上方声明）
        if (needsReturn) {
            // 还贡阶段：显示谁进贡给了我
            const myTribute = info.tributes.find(t => t.to === myId);
            if (myTribute && myTribute.card) {
                const fromPlayer = state.players.find(p => p.id === myTribute.from);
                const fromName = fromPlayer ? fromPlayer.username : '对方';
                toast.info(`收到 ${fromName} 的进贡：${this._cardName(myTribute.card)}`, 5000);
            }
        }

        // 显示谁先出牌
        const firstPlayer = info.firstPlayer;
        const fp = state.players.find(p => p.id === firstPlayer);
        const fpName = fp ? fp.username : '';
        const firstMsg = info.type === 'resist' ? `抗贡！${fpName} 先出牌`
            : info.type === 'double_down' ? `双进贡，进贡大者 ${fpName} 先出牌`
            : `单进贡，${fpName} 先出牌`;
        toast.info(firstMsg, 5000);

        // 标记不可选牌
        this._markTributeDisabled();
    },

    /** 获取牌的显示名称 */
    _cardName(card) {
        if (!card) return '';
        if (card.suit === 'joker') return card.rank === 'red_joker' ? '大王' : '小王';
        const suitNames = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
        return (suitNames[card.suit] || card.suit) + card.rank;
    },

    /** 清除进贡/还贡模式，恢复出牌按钮 */
    _clearTributeMode() {
        this._tributeMode = null;
        this._tributeSelected = null;
        store.clearSelection();
        const playBtn = document.getElementById('btn-play');
        const passBtn = document.getElementById('btn-pass');
        const hintBtn = document.getElementById('btn-hint');
        playBtn.textContent = '出牌';
        playBtn.disabled = true;
        passBtn.classList.remove('hidden');
        hintBtn.classList.remove('hidden');
        document.querySelectorAll('#hand-bottom .card.tribute-disabled').forEach(el => {
            el.classList.remove('tribute-disabled');
            el.style.pointerEvents = '';
            el.style.opacity = '';
            el.style.filter = '';
        });
    },

    _confirmTribute() {
        if (!this._tributeSelected) return;
        if (this._tributePhase === 'tribute') {
            socketManager.sendTribute(this._tributeSelected, this._gameId);
        } else {
            socketManager.returnTribute(this._tributeSelected, this._gameId);
        }
        // 不在这里清除进贡模式，等服务器返回 game:state 后再由 _onState 处理
        document.getElementById('btn-play').disabled = true;
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

        // 当前轮次（进贡/还贡阶段由 _handleTributePhase 控制按钮）
        if (state.currentPlayer && state.phase !== 'tribute' && state.phase !== 'return_tribute') {
            this._updateTurnIndicator(state.currentPlayer);
            const isMyTurn = state.currentPlayer === store.user?.id;
            document.getElementById('player-bottom').classList.toggle('my-turn', isMyTurn);
            document.getElementById('btn-play').disabled = !isMyTurn || store.selectedCards.length === 0;
            document.getElementById('btn-pass').disabled = !isMyTurn;
            if (isMyTurn) Timer.start(30, () => socketManager.passCards(this._gameId));
        }
    },

    // ===== 操作 =====

    _toggleCard(card) {
        // 进贡/还贡阶段：只允许选择可选的牌
        if (this._tributeMode) {
            const key = store._cardKey(card);
            const isEligible = this._isTributeEligible(card);
            if (!isEligible) return;
            // 单选模式：清除其他选中，只选当前
            store.clearSelection();
            document.querySelectorAll('#hand-bottom .card').forEach(el => el.classList.remove('selected'));
            store.selectedCards.push(card);
            this._updateCardSelection(card);
            this._tributeSelected = card;
            document.getElementById('btn-play').disabled = false;
            return;
        }
        store.toggleCard(card);
        this._updateCardSelection(card);
        document.getElementById('btn-play').disabled = store.selectedCards.length === 0;
    },

    /** 判断一张牌在当前进贡/还贡阶段是否可选 */
    _isTributeEligible(card) {
        if (!this._tributeMode || !this._state) return false;
        const levelRank = this._state.levelRank;
        // 逢人配（红桃级牌）不可选
        if (card.suit === 'hearts' && card.rank === levelRank) return false;

        if (this._tributeMode === 'tribute') {
            // 进贡：进贡当前手牌中最大的牌（逢人配除外）
            const eligible = store.myHand.filter(c => !(c.suit === 'hearts' && c.rank === levelRank));

            const RANK_ORDER = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

            // 排序找最大：王牌 > 级牌 > A > K > ... > 2
            const sorted = [...eligible].sort((a, b) => {
                if (a.suit === 'joker' && b.suit === 'joker') return a.rank === 'red_joker' ? 1 : -1;
                if (a.suit === 'joker') return 1;
                if (b.suit === 'joker') return -1;

                const aIsLevel = a.rank === levelRank;
                const bIsLevel = b.rank === levelRank;
                if (aIsLevel && !bIsLevel) return 1;
                if (!aIsLevel && bIsLevel) return -1;

                return RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank);
            });

            const maxCard = sorted[sorted.length - 1];

            // 检查是否有大小王
            const hasJoker = eligible.some(c => c.suit === 'joker');
            // 检查手牌中逢人配数量
            const heartsLevelCount = store.myHand.filter(c => c.suit === 'hearts' && c.rank === levelRank).length;

            // 特殊情况：没有大小王，只有一张逢人配，最大牌是级牌 → 找次一级的非级牌
            if (!hasJoker && heartsLevelCount === 1 && maxCard.rank === levelRank) {
                const nonLevelCards = eligible.filter(c => c.rank !== levelRank && c.suit !== 'joker');
                if (nonLevelCards.length > 0) {
                    const nonLevelSorted = [...nonLevelCards].sort((a, b) =>
                        RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank)
                    );
                    const subMaxRank = nonLevelSorted[nonLevelSorted.length - 1].rank;
                    return card.rank === subMaxRank;
                }
            }

            return card.rank === maxCard.rank;
        }
        if (this._tributeMode === 'return_tribute') {
            // 还贡：只能选 <= 10 的牌
            const RANK_ORDER = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
            const idx = RANK_ORDER.indexOf(card.rank);
            return idx >= 0 && idx <= RANK_ORDER.indexOf('10');
        }
        return false;
    },

    /** 获取一组牌中的最大点数 */
    _getMaxRank(cards) {
        const RANK_ORDER = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
        let maxIdx = -1;
        let maxRank = null;
        for (const c of cards) {
            const idx = RANK_ORDER.indexOf(c.rank);
            if (idx > maxIdx) {
                maxIdx = idx;
                maxRank = c.rank;
            }
        }
        return maxRank;
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
                // 拖拽生命周期：开始时暂停重渲，结束时只更新按钮（DOM 已在拖动时即时更新）
                () => { this._dragActive = true; },
                (changedCards) => { this._dragActive = false; document.getElementById('btn-play').disabled = store.selectedCards.length === 0; this._updateGroupSelectedBtn(); }
            );
        }
        this._updateGroupSelectedBtn();
        // 进贡/还贡阶段：标记不可选牌
        this._markTributeDisabled();
    },

    /** 进贡/还贡阶段：用 CSS 类标记不可选牌 */
    _markTributeDisabled() {
        if (!this._tributeMode) return;
        document.querySelectorAll('#hand-bottom .card').forEach(el => {
            const key = el.dataset.cardId;
            const card = store.myHand.find(c => store._cardKey(c) === key);
            if (card && !this._isTributeEligible(card)) {
                el.classList.add('tribute-disabled');
            } else {
                el.classList.remove('tribute-disabled');
            }
        });
    },

    /** 清除进贡/还贡模式，恢复出牌按钮 */
    _clearTributeMode() {
        this._tributeMode = null;
        this._tributeSelected = null;
        store.clearSelection();
        const playBtn = document.getElementById('btn-play');
        const passBtn = document.getElementById('btn-pass');
        const hintBtn = document.getElementById('btn-hint');
        playBtn.textContent = '出牌';
        playBtn.disabled = true;
        passBtn.classList.remove('hidden');
        hintBtn.classList.remove('hidden');
        document.querySelectorAll('#hand-bottom .card.tribute-disabled').forEach(el => {
            el.classList.remove('tribute-disabled');
        });
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
            // 拖拽生命周期：只在真正扫过牌才刷新
            () => { this._dragActive = true; },
            (changedCards) => { this._dragActive = false; document.getElementById('btn-play').disabled = store.selectedCards.length === 0; this._updateGroupSelectedBtn(); }
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
        // 进贡/还贡阶段：标记不可选牌
        this._markTributeDisabled();
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
        if (this._tributeMode) {
            this._confirmTribute();
            return;
        }
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
        store.clearSelection();
        this._renderHand();
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
