/**
 * TributeSystem - 掼蛋进贡/还贡逻辑
 *
 * 进贡规则：
 * - 上一局末游（最后出完牌的人）需要向头游（第一个出完牌的人）进贡
 * - 双下（两个末游都是同一队）：两人各进贡一张最大牌，头游还贡两张任意牌
 * - 单下：末游进贡一张最大牌，头游还贡一张任意牌
 * - 抗贡：如果末游手里有两张大王，可以抗贡（不需要进贡）
 */

const CardDeck = require('./CardDeck');

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/**
 * 比较两张进贡牌的大小（用于双下时决定谁先出牌）
 * @returns {number} >0 表示 card1 更大，<0 表示 card2 更大，0 表示一样大
 */
function compareTributeCards(card1, card2) {
    if (card1.suit === 'joker' && card2.suit === 'joker') {
        return card1.rank === 'red_joker' ? 1 : (card2.rank === 'red_joker' ? -1 : 0);
    }
    if (card1.suit === 'joker') return 1;
    if (card2.suit === 'joker') return -1;
    return RANKS.indexOf(card1.rank) - RANKS.indexOf(card2.rank);
}

class TributeSystem {
    /**
     * 计算进贡情况
     * @param {Array} finishOrder 出完牌的顺序 [playerId, ...]
     * @param {Object} teams { teamA: [id1, id2], teamB: [id3, id4] }
     * @param {Object} hands 各玩家手牌 { playerId: cards[] }
     * @param {string} teamALevel A队当前等级
     * @param {string} teamBLevel B队当前等级
     * @returns {Object} 进贡信息
     */
    static calculate(finishOrder, teams, hands, teamALevel, teamBLevel) {
        const [first, second, third, fourth] = finishOrder;

        const getTeam = (id) => {
            if (teams.teamA.includes(id)) return 'A';
            if (teams.teamB.includes(id)) return 'B';
            return null;
        };

        const getWildRank = (id) => {
            return getTeam(id) === 'A' ? teamALevel : teamBLevel;
        };

        const firstTeam = getTeam(first);
        const secondTeam = getTeam(second);

        // 双下：头游和二游同队
        const isDoubleDown = firstTeam === secondTeam;

        if (isDoubleDown) {
            // 检查末游是否可以抗贡（有两张大王）
            const fourthBigJokers = (hands[fourth] || []).filter(c => c.suit === 'joker' && c.rank === 'red_joker');
            const thirdBigJokers = (hands[third] || []).filter(c => c.suit === 'joker' && c.rank === 'red_joker');
            if (fourthBigJokers.length >= 2 || thirdBigJokers.length >= 2) {
                const resisterId = fourthBigJokers.length >= 2 ? fourth : third;
                return { type: 'resist', resisterId, firstPlayer: first };
            }

            const tributeFromFourth = CardDeck.getBestTributeCard(hands[fourth] || [], getWildRank(fourth));
            const tributeFromThird = CardDeck.getBestTributeCard(hands[third] || [], getWildRank(third));

            // 进贡牌大的先出，一样大则随机
            const cmp = compareTributeCards(tributeFromFourth, tributeFromThird);
            const firstPlayer = cmp > 0 ? fourth : (cmp < 0 ? third : (Math.random() < 0.5 ? third : fourth));

            return {
                type: 'double_down',
                tributes: [
                    { from: fourth, to: first, card: tributeFromFourth },
                    { from: third, to: second, card: tributeFromThird },
                ],
                pendingReturns: [first, second],
                firstPlayer,
            };
        }

        // 单下：末游进贡给头游
        const fourthBigJokers = (hands[fourth] || []).filter(c => c.suit === 'joker' && c.rank === 'red_joker');
        if (fourthBigJokers.length >= 2) {
            return { type: 'resist', resisterId: fourth, firstPlayer: first };
        }

        const tributeCard = CardDeck.getBestTributeCard(hands[fourth] || [], getWildRank(fourth));

        return {
            type: 'single_down',
            tributes: [
                { from: fourth, to: first, card: tributeCard },
            ],
            pendingReturns: [first],
            firstPlayer: fourth,
        };
    }

    /**
     * 验证进贡牌是否合法
     * 必须是手牌中最大的非级牌非王牌（逢人配不可进贡）
     */
    static validateTribute(card, hand, wildRank) {
        if (!card) return { valid: false, error: '没有选择牌' };
        if (card.suit === 'hearts' && card.rank === wildRank) {
            return { valid: false, error: '逢人配不能进贡' };
        }
        if (!CardDeck.containsCards(hand, [card])) {
            return { valid: false, error: '你没有这张牌' };
        }
        // 必须是最大牌
        const best = CardDeck.getBestTributeCard(hand, wildRank);
        if (card.rank !== best.rank) {
            return { valid: false, error: `必须进贡最大的牌（${best.rank}）` };
        }
        return { valid: true };
    }

    /**
     * 验证还贡牌点数是否合法
     * 只能还 ≤10 的牌
     */
    static validateReturnRank(card, wildRank) {
        if (!card) return { valid: false, error: '没有选择牌' };
        const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
        const idx = RANKS.indexOf(card.rank);
        const tenIdx = RANKS.indexOf('10');
        if (idx === -1 || idx > tenIdx) {
            return { valid: false, error: '还贡牌必须 ≤10' };
        }
        return { valid: true };
    }

    /**
     * 验证还贡牌是否合法
     */
    static validateReturn(card, hand, wildRank) {
        if (!card) return false;
        if (card.rank === wildRank) return false;
        if (card.suit === 'joker' && card.rank === 'red_joker') return false;
        return CardDeck.containsCards(hand, [card]);
    }

    /**
     * 执行进贡和还贡，返回更新后的手牌
     */
    static execute(tributeInfo, hands, returnCards = {}) {
        const newHands = {};
        for (const [id, hand] of Object.entries(hands)) {
            newHands[id] = [...hand];
        }

        // 执行进贡
        for (const tribute of tributeInfo.tributes) {
            const { from, to, card } = tribute;
            newHands[from] = CardDeck.removeCards(newHands[from], [card]);
            newHands[to] = [...newHands[to], card];
        }

        // 执行还贡
        for (const [fromId, card] of Object.entries(returnCards)) {
            const tribute = tributeInfo.tributes.find(t => t.to === fromId);
            if (tribute && card) {
                newHands[fromId] = CardDeck.removeCards(newHands[fromId], [card]);
                newHands[tribute.from] = [...newHands[tribute.from], card];
            }
        }

        return newHands;
    }
}

module.exports = TributeSystem;
