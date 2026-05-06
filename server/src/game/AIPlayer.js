/**
 * AIPlayer - 掼蛋 AI 决策引擎
 *
 * 策略（由弱到强）：
 * 1. 优先出能压过上家的最小合法牌型
 * 2. 先手时优先出最小单张/对子，保留炸弹
 * 3. 进贡时自动选最大非级牌非王
 * 4. 还贡时自动选最小合法牌
 */

const CardDeck = require('./CardDeck');
const { CardEvaluator, isWild } = require('./CardEvaluator');

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function rankValue(card, wildRank) {
    if (card.suit === 'joker') return card.rank === 'red_joker' ? 17 : 16;
    if (card.rank === wildRank) return 15;  // 级牌最大（打2时2最大，打5时5最大）
    const idx = RANKS.indexOf(card.rank);
    return idx === -1 ? 0 : idx + 2;
}

class AIPlayer {
    /**
     * 提示出牌建议（用于客户端"提示"按钮）
     * @param {object} gameState  GameState 实例
     * @param {string} userId     请求提示的玩家
     * @returns {Array}  建议出的牌数组，空数组=建议过牌
     */
    static suggest(gameState, userId) {
        const hand = gameState.hands[userId];
        if (!hand || hand.length === 0) return [];

        const wildRank = gameState.getPlayerWildRank(userId);
        const lastPlay = gameState.lastPlay;
        const lastPlayerId = gameState.lastPlayerId;

        if (!lastPlay || lastPlayerId === userId) {
            return AIPlayer._leadPlay(hand, wildRank);
        }

        const lastEval = CardEvaluator.evaluate(lastPlay, gameState.getPlayerWildRank(lastPlayerId));
        const beat = AIPlayer._findBeat(hand, wildRank, lastEval);
        return beat || [];
    }

    /**
     * 决定出牌
     * @param {object} gameState  GameState 实例
     * @param {string} userId     AI 玩家 ID
     * @returns {Array|null}  要出的牌数组，null 表示过牌
     */
    static decidePlay(gameState, userId) {
        const hand = gameState.hands[userId];
        if (!hand || hand.length === 0) return null;

        const wildRank = gameState.getPlayerWildRank(userId);
        const lastPlay = gameState.lastPlay;
        const lastPlayerId = gameState.lastPlayerId;

        // 先手（桌面无牌，或上一个出牌的是自己）
        if (!lastPlay || lastPlayerId === userId) {
            return AIPlayer._leadPlay(hand, wildRank);
        }

        // 跟牌：尝试找能压过的最小牌型
        const lastEval = CardEvaluator.evaluate(lastPlay, gameState.getPlayerWildRank(lastPlayerId));
        const beat = AIPlayer._findBeat(hand, wildRank, lastEval);
        return beat; // null = 过牌
    }

    /**
     * 先手出牌策略：出最小的非炸弹牌型
     */
    static _leadPlay(hand, wildRank) {
        const sorted = [...hand].sort((a, b) => rankValue(a, wildRank) - rankValue(b, wildRank));

        // 优先出最小单张（非王、非逢人配）
        const singles = sorted.filter(c => c.suit !== 'joker' && !isWild(c, wildRank));
        if (singles.length > 0) {
            return [singles[0]];
        }

        // 只剩级牌或王，出最小的
        return [sorted[0]];
    }

    /**
     * 跟牌策略：找能压过 lastEval 的最小合法牌型
     */
    static _findBeat(hand, wildRank, lastEval) {
        const { type, length } = lastEval;

        // 双王炸无法被压
        if (type === 'joker_bomb') return null;

        const candidates = AIPlayer._generateCandidates(hand, wildRank, type, length);

        // 过滤出能压过的
        const beatable = candidates.filter(cards => {
            const eval_ = CardEvaluator.evaluate(cards, wildRank);
            return eval_.valid && CardEvaluator.compare(eval_, lastEval) > 0;
        });

        if (beatable.length === 0) return null;

        // 选最小的（按主牌rank排序）
        beatable.sort((a, b) => {
            const ea = CardEvaluator.evaluate(a, wildRank);
            const eb = CardEvaluator.evaluate(b, wildRank);
            // 先按类型权重，再按rank
            const typeWeightA = _typeWeight(ea.type);
            const typeWeightB = _typeWeight(eb.type);
            if (typeWeightA !== typeWeightB) return typeWeightA - typeWeightB;
            return (ea.rank || 0) - (eb.rank || 0);
        });

        return beatable[0];
    }

    /**
     * 生成候选牌组合
     */
    static _generateCandidates(hand, wildRank, targetType, targetLength) {
        const candidates = [];

        // 同类型候选
        const sametype = AIPlayer._candidatesOfType(hand, wildRank, targetType, targetLength);
        candidates.push(...sametype);

        // 炸弹（可以压任何非炸弹）
        const bombs = AIPlayer._candidatesOfType(hand, wildRank, 'bomb', null);
        candidates.push(...bombs);

        // 同花顺
        const sfs = AIPlayer._candidatesOfType(hand, wildRank, 'straight_flush', null);
        candidates.push(...sfs);

        // 天王炸（需要4张王）
        const jokers = hand.filter(c => c.suit === 'joker');
        if (jokers.length >= 4) {
            candidates.push(jokers.slice(0, 4));
        }

        return candidates;
    }

    /**
     * 生成指定类型的候选牌
     */
    static _candidatesOfType(hand, wildRank, type, length) {
        const results = [];
        const sorted = [...hand].sort((a, b) => rankValue(a, wildRank) - rankValue(b, wildRank));

        switch (type) {
            case 'single': {
                for (const card of sorted) {
                    results.push([card]);
                }
                break;
            }
            case 'pair': {
                const groups = _groupByRank(sorted, wildRank);
                for (const [rank, cards] of Object.entries(groups)) {
                    if (cards.length >= 2) results.push(cards.slice(0, 2));
                }
                // 对王：两个相同的大王或两个相同的小王
                const bigJokers = sorted.filter(c => c.suit === 'joker' && c.rank === 'red_joker');
                const smallJokers = sorted.filter(c => c.suit === 'joker' && c.rank === 'black_joker');
                if (bigJokers.length >= 2) results.push(bigJokers.slice(0, 2));
                if (smallJokers.length >= 2) results.push(smallJokers.slice(0, 2));
                // 含逢人配的对子（仅红桃级牌可当配）
                const wilds = sorted.filter(c => isWild(c, wildRank));
                if (wilds.length >= 1) {
                    const normals = sorted.filter(c => c.suit !== 'joker' && !isWild(c, wildRank));
                    const normalGroups = _groupByRank(normals, null);
                    for (const [rank, cards] of Object.entries(normalGroups)) {
                        if (cards.length === 1) results.push([cards[0], wilds[0]]);
                    }
                }
                break;
            }
            case 'triple': {
                const groups = _groupByRank(sorted, wildRank);
                for (const [rank, cards] of Object.entries(groups)) {
                    if (cards.length >= 3) results.push(cards.slice(0, 3));
                }
                break;
            }
            case 'bomb': {
                const groups = _groupByRank(sorted, wildRank);
                for (const [rank, cards] of Object.entries(groups)) {
                    if (cards.length >= 4) {
                        // 4张、5张、6张炸弹
                        for (let n = 4; n <= cards.length; n++) {
                            results.push(cards.slice(0, n));
                        }
                    }
                }
                break;
            }
            case 'straight': {
                // 找5张+顺子
                const normalSorted = sorted.filter(c => c.suit !== 'joker' && !isWild(c, wildRank));
                const rankSet = [...new Set(normalSorted.map(c => c.rank))];
                const rankVals = rankSet.map(r => RANKS.indexOf(r)).filter(v => v >= 0).sort((a, b) => a - b);

                for (let start = 0; start < rankVals.length - 4; start++) {
                    const seq = [rankVals[start]];
                    for (let i = start + 1; i < rankVals.length && seq.length < 8; i++) {
                        if (rankVals[i] === seq[seq.length - 1] + 1) seq.push(rankVals[i]);
                        else break;
                    }
                    if (seq.length >= 5) {
                        const cards = seq.map(v => normalSorted.find(c => RANKS.indexOf(c.rank) === v));
                        results.push(cards);
                    }
                }
                break;
            }
            case 'straight_flush': {
                const suits = ['spades', 'hearts', 'diamonds', 'clubs'];
                for (const suit of suits) {
                    const suitCards = sorted.filter(c => c.suit === suit);
                    const rankVals = suitCards.map(c => RANKS.indexOf(c.rank)).sort((a, b) => a - b);
                    for (let start = 0; start < rankVals.length - 4; start++) {
                        const seq = [rankVals[start]];
                        for (let i = start + 1; i < rankVals.length && seq.length < 8; i++) {
                            if (rankVals[i] === seq[seq.length - 1] + 1) seq.push(rankVals[i]);
                            else break;
                        }
                        if (seq.length >= 5) {
                            const cards = seq.map(v => suitCards.find(c => RANKS.indexOf(c.rank) === v));
                            results.push(cards);
                        }
                    }
                }
                break;
            }
            case 'full_house': {
                const groups = _groupByRank(sorted, wildRank);
                const triples = Object.entries(groups).filter(([, c]) => c.length >= 3);
                const pairs = Object.entries(groups).filter(([, c]) => c.length >= 2);
                for (const [tr, tc] of triples) {
                    for (const [pr, pc] of pairs) {
                        if (tr !== pr) results.push([...tc.slice(0, 3), ...pc.slice(0, 2)]);
                    }
                }
                break;
            }
            case 'flush_pair': {
                // 连对：3对+连续
                const groups = _groupByRank(sorted, wildRank);
                const pairRanks = Object.entries(groups)
                    .filter(([, c]) => c.length >= 2)
                    .map(([r]) => RANKS.indexOf(r))
                    .filter(v => v >= 0)
                    .sort((a, b) => a - b);

                for (let start = 0; start < pairRanks.length - 2; start++) {
                    const seq = [pairRanks[start]];
                    for (let i = start + 1; i < pairRanks.length; i++) {
                        if (pairRanks[i] === seq[seq.length - 1] + 1) seq.push(pairRanks[i]);
                        else break;
                    }
                    if (seq.length >= 3) {
                        const cards = seq.flatMap(v => {
                            const rank = RANKS[v];
                            return groups[rank].slice(0, 2);
                        });
                        results.push(cards);
                    }
                }
                break;
            }
            case 'triple_straight': {
                // 双飞/钢板：连续三张（如 333+444）
                const groups = _groupByRank(sorted, wildRank);
                const tripleRanks = Object.entries(groups)
                    .filter(([, c]) => c.length >= 2) // 至少2张，可用逢人配补
                    .map(([r]) => RANKS.indexOf(r))
                    .filter(v => v >= 0)
                    .sort((a, b) => a - b);

                for (let start = 0; start < tripleRanks.length - 1; start++) {
                    const seq = [tripleRanks[start]];
                    for (let i = start + 1; i < tripleRanks.length; i++) {
                        if (tripleRanks[i] === seq[seq.length - 1] + 1) seq.push(tripleRanks[i]);
                        else break;
                    }
                    if (seq.length >= 2) {
                        const cards = seq.flatMap(v => {
                            const rank = RANKS[v];
                            return groups[rank].slice(0, 3);
                        });
                        results.push(cards);
                    }
                }
                break;
            }
        }

        return results;
    }

    /**
     * 进贡：选最大的非级牌非王
     */
    static decideTribute(hand, wildRank) {
        return CardDeck.getBestTributeCard(hand, wildRank);
    }

    /**
     * 还贡：选最小的合法牌（非级牌、非王）
     */
    static decideReturnTribute(hand, wildRank) {
        const eligible = hand
            .filter(c => c.suit !== 'joker' && c.rank !== wildRank)
            .sort((a, b) => rankValue(a, wildRank) - rankValue(b, wildRank));
        return eligible.length > 0 ? eligible[0] : hand[0];
    }
}

function _groupByRank(cards, wildRank) {
    const groups = {};
    for (const card of cards) {
        if (card.suit === 'joker') continue;
        if (isWild(card, wildRank)) continue;
        if (!groups[card.rank]) groups[card.rank] = [];
        groups[card.rank].push(card);
    }
    return groups;
}

function _typeWeight(type) {
    const weights = {
        single: 1, pair: 2, triple: 3, straight: 4,
        triple_straight: 5, flush_pair: 6, full_house: 7,
        bomb: 10, straight_flush: 11, joker_bomb: 99,
    };
    return weights[type] || 0;
}

module.exports = AIPlayer;
