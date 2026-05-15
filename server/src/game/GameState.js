/**
 * GameState - 掼蛋游戏状态机
 *
 * 管理单局游戏的完整状态，包括：
 * - 手牌管理
 * - 出牌顺序
 * - 进贡/还贡
 * - 等级升降
 * - 游戏结束判断
 */

const CardDeck = require('./CardDeck');
const { CardEvaluator, HAND_TYPES } = require('./CardEvaluator');
const TributeSystem = require('./TributeSystem');
const LevelManager = require('./LevelManager');

const PHASES = {
    WAITING: 'waiting',
    TRIBUTE: 'tribute',
    RETURN_TRIBUTE: 'return_tribute',
    PLAYING: 'playing',
    ROUND_END: 'round_end',
    GAME_END: 'game_end',
};

class GameState {
    constructor({ gameId, players, teams, playerMeta, teamALevel = '2', teamBLevel = '2', currentLevel = null, roundNumber = 1, lastFinishOrder = null, teamAFailA = 0, teamBFailA = 0 }) {
        this.gameId = gameId;
        this.players = players; // [userId, userId, userId, userId] 座位顺序
        this.teams = teams;     // { teamA: [id, id], teamB: [id, id] }
        this.playerMeta = playerMeta || {}; // { userId: { username, isAI } }
        this.teamALevel = teamALevel;
        this.teamBLevel = teamBLevel;
        // 每局只有一个统一的级别牌（胜利队伍的当前级别）
        this.currentLevel = currentLevel || teamALevel;
        this.roundNumber = roundNumber;
        this.lastFinishOrder = lastFinishOrder;
        this.teamAFailA = teamAFailA;
        this.teamBFailA = teamBFailA;

        this.phase = PHASES.WAITING;
        this.hands = {};
        this.currentPlayer = null;
        this.lastPlay = null;
        this.lastPlayerId = null;
        this.passCount = 0;
        this.finishOrder = [];
        this.moveHistory = [];
        this.initialHands = {};

        this.tributeInfo = null;
        this.pendingTributes = {};
        this.pendingReturns = {};
    }

    /**
     * 开始新一局：发牌
     */
    startRound() {
        const deck = CardDeck.shuffle(CardDeck.createDeck());
        const dealtHands = CardDeck.deal(deck);
        this.players.forEach((id, i) => {
            this.hands[id] = dealtHands[i];
        });

        // 保存初始手牌（用于回放）
        for (const [id, hand] of Object.entries(this.hands)) {
            this.initialHands[id] = [...hand];
        }

        // 判断是否需要进贡
        if (this.roundNumber > 1 && this.lastFinishOrder) {
            this._setupTribute();
        } else {
            this.phase = PHASES.PLAYING;
            this.currentPlayer = this._findFirstPlayer();
        }

        return this;
    }

    /**
     * 设置进贡
     */
    _setupTribute() {
        const tributeInfo = TributeSystem.calculate(
            this.lastFinishOrder,
            this.teams,
            this.hands,
            this.teamALevel,
            this.teamBLevel
        );

        this.tributeInfo = tributeInfo;

        if (tributeInfo.type === 'resist') {
            this.phase = PHASES.PLAYING;
            this.currentPlayer = tributeInfo.firstPlayer || this.lastFinishOrder[0];
            return;
        }

        this.phase = PHASES.TRIBUTE;

        // 初始化待进贡列表，等待玩家手动选牌
        this.pendingTributes = {};
        for (const tribute of tributeInfo.tributes) {
            tribute.card = null;
            this.pendingTributes[tribute.from] = null;
        }
    }

    /**
     * 执行进贡（玩家手动选牌后调用）
     * @param {string} userId 进贡者
     * @param {Object} card 进贡的牌
     * @returns {{ success, error }}
     */
    tribute(userId, card) {
        if (this.phase !== PHASES.TRIBUTE) {
            return { success: false, error: '当前不是进贡阶段' };
        }
        if (!(userId in this.pendingTributes)) {
            return { success: false, error: '你不需要进贡' };
        }
        if (this.pendingTributes[userId] !== null) {
            return { success: false, error: '你已经进贡了' };
        }

        if (!this.hands[userId].some(c => c.suit === card.suit && c.rank === card.rank)) {
            return { success: false, error: '你没有这张牌' };
        }

        // 验证进贡牌合法性：必须是最大的非级牌非王牌（逢人配不可进贡）
        const wildRank = this.currentLevel;
        const validation = TributeSystem.validateTribute(card, this.hands[userId], wildRank);
        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        const tribute = this.tributeInfo.tributes.find(t => t.from === userId);
        if (!tribute) return { success: false, error: '找不到对应的进贡关系' };

        // 执行进贡
        this.hands[userId] = CardDeck.removeCards(this.hands[userId], [card]);
        this.hands[tribute.to] = [...this.hands[tribute.to], card];
        this.pendingTributes[userId] = card;
        tribute.card = card;

        // 所有进贡完成 → 进入还贡阶段
        const allTributed = Object.values(this.pendingTributes).every(c => c !== null);
        if (allTributed) {
            this.phase = PHASES.RETURN_TRIBUTE;
            for (const returnerId of this.tributeInfo.pendingReturns) {
                this.pendingReturns[returnerId] = null;
            }
        }

        return { success: true };
    }

    /**
     * 执行还贡
     * @param {string} userId 还贡者
     * @param {Object} card 还贡的牌
     * @returns {{ success, error }}
     */
    returnTribute(userId, card) {
        if (this.phase !== PHASES.RETURN_TRIBUTE) {
            return { success: false, error: '当前不是还贡阶段' };
        }
        if (!(userId in this.pendingReturns)) {
            return { success: false, error: '你不需要还贡' };
        }
        if (this.pendingReturns[userId] !== null) {
            return { success: false, error: '你已经还贡了' };
        }

        const wildRank = this.currentLevel;
        if (!TributeSystem.validateReturn(card, this.hands[userId], wildRank)) {
            return { success: false, error: '还贡牌不合法（不能还级牌或大王）' };
        }
        // 还贡牌必须 ≤10
        const returnValidation = TributeSystem.validateReturnRank(card, wildRank);
        if (!returnValidation.valid) {
            return { success: false, error: returnValidation.error };
        }

        const tribute = this.tributeInfo.tributes.find(t => t.to === userId);
        if (!tribute) return { success: false, error: '找不到对应的进贡关系' };

        this.hands[userId] = CardDeck.removeCards(this.hands[userId], [card]);
        this.hands[tribute.from] = [...this.hands[tribute.from], card];
        this.pendingReturns[userId] = card;

        const allReturned = Object.values(this.pendingReturns).every(c => c !== null);
        if (allReturned) {
            this.phase = PHASES.PLAYING;
            this.currentPlayer = this.tributeInfo.firstPlayer || this.lastFinishOrder[0];
        }

        return { success: true };
    }

    /**
     * 出牌
     * @param {string} userId 出牌玩家
     * @param {Array} cards 出的牌（空数组=过牌）
     * @returns {{ success, error, events }}
     */
    playCards(userId, cards) {
        if (this.phase !== PHASES.PLAYING) {
            return { success: false, error: '当前不是出牌阶段' };
        }
        if (userId !== this.currentPlayer) {
            return { success: false, error: '还没轮到你出牌' };
        }

        const events = [];

        // 过牌
        if (!cards || cards.length === 0) {
            if (!this.lastPlay) {
                return { success: false, error: '你是第一个出牌，不能过牌' };
            }
            if (this.lastPlayerId === userId) {
                return { success: false, error: '你是上一个出牌的人，不能过牌' };
            }

            this.passCount++;
            this.moveHistory.push({ userId, cards: [], type: 'pass', timestamp: Date.now() });
            events.push({ type: 'pass', userId });

            const activePlayers = this.players.filter(id => !this.finishOrder.includes(id));
            if (this.passCount >= activePlayers.length - 1) {
                // 所有其他人都过牌，清空桌面，最后由出牌人继续出牌
                this.lastPlay = null;
                this.passCount = 0;
                // 如果最后出牌人已出完，对家接风
                if (this.finishOrder.includes(this.lastPlayerId)) {
                    const teammate = this._getTeammate(this.lastPlayerId);
                    if (teammate && !this.finishOrder.includes(teammate)) {
                        this.currentPlayer = teammate;
                        events.push({ type: 'jie_feng', userId: teammate, fromUser: this.lastPlayerId });
                    } else {
                        this.currentPlayer = this._nextActivePlayer(this.lastPlayerId);
                    }
                } else {
                    this.currentPlayer = this.lastPlayerId;
                }
                this.lastPlayerId = null;
                events.push({ type: 'clear_table', nextPlayer: this.currentPlayer });
            } else {
                this.currentPlayer = this._nextActivePlayer(userId);
                events.push({ type: 'next_turn', nextPlayer: this.currentPlayer });
            }

            return { success: true, events };
        }

        // 验证手牌
        if (!CardDeck.containsCards(this.hands[userId], cards)) {
            return { success: false, error: '你没有这些牌' };
        }

        // 判断牌型
        const wildRank = this.currentLevel;
        const evalResult = CardEvaluator.evaluate(cards, wildRank);
        if (!evalResult.valid) {
            return { success: false, error: '无效的牌型' };
        }

        // 检查是否能压过上家
        if (this.lastPlay) {
            const lastEval = CardEvaluator.evaluate(this.lastPlay, this.currentLevel);
            if (CardEvaluator.compare(evalResult, lastEval) <= 0) {
                return { success: false, error: '出的牌不够大' };
            }
        }

        // 执行出牌
        this.hands[userId] = CardDeck.removeCards(this.hands[userId], cards);
        this.lastPlay = cards;
        this.lastPlayerId = userId;
        this.passCount = 0;

        this.moveHistory.push({
            userId,
            cards: [...cards],
            type: evalResult.type,
            evalResult,
            timestamp: Date.now(),
        });

        events.push({ type: 'play', userId, cards, evalResult });

        // 检查是否出完牌
        if (this.hands[userId].length === 0) {
            this.finishOrder.push(userId);
            events.push({ type: 'finish', userId, position: this.finishOrder.length });

            // 双下检测：头游和二游同队 → 剩余两人自动结束，直接进入回合结算
            if (this.finishOrder.length === 2) {
                const t1 = this.teams.teamA.includes(this.finishOrder[0]) ? 'A' : 'B';
                const t2 = this.teams.teamA.includes(this.finishOrder[1]) ? 'A' : 'B';
                if (t1 === t2) {
                    const remaining = this.players.filter(id => !this.finishOrder.includes(id));
                    for (const id of remaining) {
                        this.finishOrder.push(id);
                        events.push({ type: 'finish', userId: id, position: this.finishOrder.length });
                    }
                    this.phase = PHASES.ROUND_END;
                    const levelResult = LevelManager.calculateLevelChange(
                        this.finishOrder,
                        this.teams,
                        this.teamALevel,
                        this.teamBLevel,
                        this.teamAFailA,
                        this.teamBFailA
                    );
                    this.teamALevel = levelResult.teamALevel;
                    this.teamBLevel = levelResult.teamBLevel;
                    this.teamAFailA = levelResult.teamAFailA;
                    this.teamBFailA = levelResult.teamBFailA;
                    events.push({ type: 'round_end', finishOrder: this.finishOrder, levelResult });
                    if (levelResult.isGameOver) {
                        this.phase = PHASES.GAME_END;
                        events.push({ type: 'game_end', winnerTeam: levelResult.winnerTeam });
                    }
                    return { success: true, events };
                }
            }

            const activePlayers = this.players.filter(id => !this.finishOrder.includes(id));

            if (activePlayers.length <= 1) {
                if (activePlayers.length === 1) {
                    this.finishOrder.push(activePlayers[0]);
                    events.push({ type: 'finish', userId: activePlayers[0], position: 4 });
                }

                this.phase = PHASES.ROUND_END;
                const levelResult = LevelManager.calculateLevelChange(
                    this.finishOrder,
                    this.teams,
                    this.teamALevel,
                    this.teamBLevel,
                    this.teamAFailA,
                    this.teamBFailA
                );

                this.teamALevel = levelResult.teamALevel;
                this.teamBLevel = levelResult.teamBLevel;
                this.teamAFailA = levelResult.teamAFailA;
                this.teamBFailA = levelResult.teamBFailA;

                events.push({ type: 'round_end', finishOrder: this.finishOrder, levelResult });

                if (levelResult.isGameOver) {
                    this.phase = PHASES.GAME_END;
                    events.push({ type: 'game_end', winnerTeam: levelResult.winnerTeam });
                }

                return { success: true, events };
            }
        }

        this.currentPlayer = this._nextActivePlayer(userId);
        events.push({ type: 'next_turn', nextPlayer: this.currentPlayer });

        return { success: true, events };
    }

    /**
     * 获取玩家的队友
     */
    _getTeammate(userId) {
        if (this.teams.teamA.includes(userId)) {
            return this.teams.teamA.find(id => id !== userId);
        }
        if (this.teams.teamB.includes(userId)) {
            return this.teams.teamB.find(id => id !== userId);
        }
        return null;
    }

    /**
     * 获取下一个活跃玩家
     */
    _nextActivePlayer(currentId) {
        const activePlayers = this.players.filter(id => !this.finishOrder.includes(id));
        if (activePlayers.length === 0) return null;

        const currentIdx = this.players.indexOf(currentId);
        let nextIdx = (currentIdx + 1) % this.players.length;

        while (this.finishOrder.includes(this.players[nextIdx])) {
            nextIdx = (nextIdx + 1) % this.players.length;
        }

        return this.players[nextIdx];
    }

    /**
     * 找到第一局的先手玩家（持有2♠的玩家）
     */
    _findFirstPlayer() {
        for (const [userId, hand] of Object.entries(this.hands)) {
            if (hand.some(c => c.rank === '2' && c.suit === 'spades')) {
                return isNaN(userId) ? userId : Number(userId);
            }
        }
        return this.players[0];
    }

    /**
     * 获取玩家可见的游戏状态（隐藏其他玩家手牌）
     */
    getStateForPlayer(userId) {
        const handCounts = {};
        for (const [id, hand] of Object.entries(this.hands)) {
            handCounts[id] = hand.length;
        }

        const players = this.players.map(id => ({
            id,
            username: this.playerMeta[id]?.username || `玩家${id}`,
            team: this.teams.teamA.includes(id) ? 'A' : 'B',
        }));

        return {
            gameId: this.gameId,
            phase: this.phase,
            roundNumber: this.roundNumber,
            teamALevel: this.teamALevel,
            teamBLevel: this.teamBLevel,
            teamAFailA: this.teamAFailA,
            teamBFailA: this.teamBFailA,
            currentPlayer: this.currentPlayer,
            lastPlay: this.lastPlay,
            lastPlayerId: this.lastPlayerId,
            finishOrder: this.finishOrder,
            players,
            myHand: CardDeck.sortHand(this.hands[userId] || [], this.currentLevel),
            handCounts,
            levelRank: this.currentLevel,
            tributeInfo: this.tributeInfo ? {
                type: this.tributeInfo.type,
                tributes: (this.tributeInfo.tributes || []).map(t => ({
                    from: t.from,
                    to: t.to,
                    card: t.card,
                })),
                pendingTributes: this.pendingTributes ? Object.keys(this.pendingTributes).map(Number) : [],
                pendingReturns: this.tributeInfo.pendingReturns || [],
                resisterId: this.tributeInfo.resisterId,
                firstPlayer: this.tributeInfo.firstPlayer,
                returns: Object.entries(this.pendingReturns || {}).map(([returnerId, card]) => ({
                    from: Number(returnerId),
                    card,
                })),
            } : null,
        };
    }

    /**
     * 序列化（用于存储/传输）
     */
    serialize() {
        return {
            gameId: this.gameId,
            players: this.players,
            teams: this.teams,
            teamALevel: this.teamALevel,
            teamBLevel: this.teamBLevel,
            teamAFailA: this.teamAFailA,
            teamBFailA: this.teamBFailA,
            roundNumber: this.roundNumber,
            phase: this.phase,
            hands: this.hands,
            currentPlayer: this.currentPlayer,
            lastPlay: this.lastPlay,
            lastPlayerId: this.lastPlayerId,
            passCount: this.passCount,
            finishOrder: this.finishOrder,
            moveHistory: this.moveHistory,
            tributeInfo: this.tributeInfo,
            pendingReturns: this.pendingReturns,
            initialHands: this.initialHands,
        };
    }
}

module.exports = { GameState, PHASES };
