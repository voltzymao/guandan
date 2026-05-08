/**
 * AIPlayer - 掼蛋 AI 决策引擎
 *
 * 策略：
 * 1. 先手时优先出组合牌型（顺子/钢板/连对/三带二），保留控制牌
 * 2. 跟牌时：队友出牌尽量不接，对手出牌能压则压最小代价
 * 3. 手牌很少时（<=3张）尽量冲刺
 * 4. 进贡/还贡按规则自动选牌
 */

const CardDeck = require('./CardDeck');
const { CardEvaluator, HAND_TYPES, isWild } = require('./CardEvaluator');

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function rankValue(card, wildRank) {
    if (card.suit === 'joker') return card.rank === 'red_joker' ? 17 : 16;
    if (card.rank === wildRank) return 15;
    const idx = RANKS.indexOf(card.rank);
    return idx === -1 ? 0 : idx + 2;
}

class AIPlayer {
    /**
     * 提示出牌建议（用于客户端"提示"按钮）
     */
    static suggest(gameState, userId) {
        const hand = gameState.hands[userId];
        if (!hand || hand.length === 0) return [];

        const wildRank = gameState.currentLevel;
        const lastPlay = gameState.lastPlay;
        const lastPlayerId = gameState.lastPlayerId;

        if (!lastPlay || lastPlayerId === userId) {
            return AIPlayer._leadPlay(hand, wildRank);
        }

        const lastEval = CardEvaluator.evaluate(lastPlay, wildRank);
        const beat = AIPlayer._findBeat(hand, wildRank, lastEval, false);
        return beat || [];
    }

    /**
     * 决定出牌
     */
    static decidePlay(gameState, userId) {
        const hand = gameState.hands[userId];
        if (!hand || hand.length === 0) return null;

        const wildRank = gameState.currentLevel;
        const lastPlay = gameState.lastPlay;
        const lastPlayerId = gameState.lastPlayerId;
        const teammate = gameState._getTeammate ? gameState._getTeammate(userId) : null;

        // 先手
        if (!lastPlay || lastPlayerId === userId) {
            return AIPlayer._leadPlay(hand, wildRank);
        }

        // 判断上家是不是队友
        const isTeammate = teammate && lastPlayerId === teammate;

        const lastEval = CardEvaluator.evaluate(lastPlay, wildRank);
        const beat = AIPlayer._findBeat(hand, wildRank, lastEval, isTeammate);
        return beat; // null = 过牌
    }

    /**
     * 先手出牌策略：优先出组合牌型，保留炸弹和控制
     */
    static _leadPlay(hand, wildRank) {
        // 分析手中所有可能的出牌
        const allPlays = AIPlayer._analyzeHand(hand, wildRank);

        // 按牌型优先级排序（大牌型优先出，保留单张到最后）
        const typePriority = {
            [HAND_TYPES.STRAIGHT]: 1,
            [HAND_TYPES.TRIPLE_STRAIGHT]: 2,
            [HAND_TYPES.FLUSH_PAIR]: 3,
            [HAND_TYPES.FULL_HOUSE]: 4,
            [HAND_TYPES.TRIPLE]: 5,
            [HAND_TYPES.PAIR]: 6,
            [HAND_TYPES.SINGLE]: 7,
        };

        // 分离炸弹和普通牌型
        const bombs = allPlays.filter(p => p.type === HAND_TYPES.BOMB || p.type === HAND_TYPES.STRAIGHT_FLUSH || p.type === HAND_TYPES.JOKER_BOMB);
        const normals = allPlays.filter(p => p.type !== HAND_TYPES.BOMB && p.type !== HAND_TYPES.STRAIGHT_FLUSH && p.type !== HAND_TYPES.JOKER_BOMB);

        // 优先出普通组合牌型（从小到大）
        normals.sort((a, b) => {
            const pa = typePriority[a.type] || 99;
            const pb = typePriority[b.type] || 99;
            if (pa !== pb) return pa - pb; // 牌型优先级升序（大牌型先出）
            return a.rank - b.rank; // 同类型按rank升序（小牌先出）
        });

        if (normals.length > 0) {
            return normals[0].cards;
        }

        // 只剩炸弹/王炸，出最小单张
        const singles = hand
            .filter(c => c.suit !== 'joker' && !isWild(c, wildRank))
            .sort((a, b) => rankValue(a, wildRank) - rankValue(b, wildRank));
        if (singles.length > 0) return [singles[0]];

        // 只剩级牌/王
        return [hand.sort((a, b) => rankValue(a, wildRank) - rankValue(b, wildRank))[0]];
    }

    /**
     * 跟牌策略
     * @param {boolean} isTeammate - 上家是否是队友
     */
    static _findBeat(hand, wildRank, lastEval, isTeammate) {
        // 双王炸无法被压
        if (lastEval.type === HAND_TYPES.JOKER_BOMB) return null;

        // 队友出牌：除非队友出的是非常小的牌而且自己手牌很少了，否则不接
        if (isTeammate) {
            // 如果自己手牌很少了（剩<=3张），队友如果出的是单张/对子，可以考虑接一下
            if (hand.length <= 3 && (lastEval.type === HAND_TYPES.SINGLE || lastEval.type === HAND_TYPES.PAIR)) {
                const candidates = AIPlayer._generateCandidates(hand, wildRank, lastEval.type, lastEval.length);
                const beatable = candidates.filter(cards => {
                    const eval_ = CardEvaluator.evaluate(cards, wildRank);
                    return eval_.valid && CardEvaluator.compare(eval_, lastEval) > 0;
                });
                if (beatable.length > 0) {
                    beatable.sort((a, b) => {
                        const ea = CardEvaluator.evaluate(a, wildRank);
                        const eb = CardEvaluator.evaluate(b, wildRank);
                        return (ea.rank || 0) - (eb.rank || 0);
                    });
                    return beatable[0];
                }
            }
            // 否则不接队友的牌
            return null;
        }

        // 对手出牌：找能压过的最小牌型
        const candidates = AIPlayer._generateCandidates(hand, wildRank, lastEval.type, lastEval.length);

        const beatable = candidates.filter(cards => {
            const eval_ = CardEvaluator.evaluate(cards, wildRank);
            return eval_.valid && CardEvaluator.compare(eval_, lastEval) > 0;
        });

        if (beatable.length === 0) return null;

        // 选最小的（优先同类型，再用炸弹）
        beatable.sort((a, b) => {
            const ea = CardEvaluator.evaluate(a, wildRank);
            const eb = CardEvaluator.evaluate(b, wildRank);

            // 优先用同类型压（省炸弹）
            const sameTypeA = ea.type === lastEval.type ? 0 : 1;
            const sameTypeB = eb.type === lastEval.type ? 0 : 1;
            if (sameTypeA !== sameTypeB) return sameTypeA - sameTypeB;

            // 再按rank从小到大
            const typeWeightA = _typeWeight(ea.type);
            const typeWeightB = _typeWeight(eb.type);
            if (typeWeightA !== typeWeightB) return typeWeightA - typeWeightB;
            return (ea.rank || 0) - (eb.rank || 0);
        });

        return beatable[0];
    }

    /**
     * 分析手牌中所有可能的出牌组合
     */
    static _analyzeHand(hand, wildRank) {
        const results = [];
        const n = hand.length;
        if (n === 0) return results;

        // 单张
        for (const card of hand) {
            const eval_ = CardEvaluator.evaluate([card], wildRank);
            if (eval_.valid) results.push({ cards: [card], type: eval_.type, rank: eval_.rank, length: 1 });
        }

        // 对子、三张、炸弹（同rank组合）
        const rankGroups = _groupByRank(hand, wildRank);
        const wilds = hand.filter(c => isWild(c, wildRank));
        const wildCount = wilds.length;

        for (const [rank, cards] of Object.entries(rankGroups)) {
            // 对子（2张）
            if (cards.length >= 2) {
                const combo = cards.slice(0, 2);
                const eval_ = CardEvaluator.evaluate(combo, wildRank);
                if (eval_.valid) results.push({ cards: combo, type: eval_.type, rank: eval_.rank, length: 2 });
            }
            // 对王
            const bigJokers = hand.filter(c => c.suit === 'joker' && c.rank === 'red_joker');
            const smallJokers = hand.filter(c => c.suit === 'joker' && c.rank === 'black_joker');
            if (bigJokers.length >= 2) {
                const eval_ = CardEvaluator.evaluate(bigJokers.slice(0, 2), wildRank);
                if (eval_.valid) results.push({ cards: bigJokers.slice(0, 2), type: eval_.type, rank: eval_.rank, length: 2 });
            }
            if (smallJokers.length >= 2) {
                const eval_ = CardEvaluator.evaluate(smallJokers.slice(0, 2), wildRank);
                if (eval_.valid) results.push({ cards: smallJokers.slice(0, 2), type: eval_.type, rank: eval_.rank, length: 2 });
            }
            // 含逢人配的对子
            if (wildCount >= 1 && cards.length >= 1) {
                for (const c of cards) {
                    const combo = [c, wilds[0]];
                    const eval_ = CardEvaluator.evaluate(combo, wildRank);
                    if (eval_.valid) results.push({ cards: combo, type: eval_.type, rank: eval_.rank, length: 2 });
                }
            }

            // 三张（3张）
            if (cards.length >= 3) {
                const combo = cards.slice(0, 3);
                const eval_ = CardEvaluator.evaluate(combo, wildRank);
                if (eval_.valid) results.push({ cards: combo, type: eval_.type, rank: eval_.rank, length: 3 });
            }
            if (wildCount >= 1 && cards.length >= 2) {
                const combo = [cards[0], cards[1], wilds[0]];
                const eval_ = CardEvaluator.evaluate(combo, wildRank);
                if (eval_.valid) results.push({ cards: combo, type: eval_.type, rank: eval_.rank, length: 3 });
            }
            if (wildCount >= 2 && cards.length >= 1) {
                const combo = [cards[0], wilds[0], wilds[1]];
                const eval_ = CardEvaluator.evaluate(combo, wildRank);
                if (eval_.valid) results.push({ cards: combo, type: eval_.type, rank: eval_.rank, length: 3 });
            }

            // 炸弹（4-8张）
            for (let bombSize = 4; bombSize <= 8; bombSize++) {
                if (cards.length + wildCount >= bombSize) {
                    const needWilds = Math.max(0, bombSize - cards.length);
                    if (needWilds <= wildCount) {
                        const combo = [...cards.slice(0, bombSize), ...wilds.slice(0, needWilds)];
                        // 去重，确保不重复用牌
                        const used = new Set();
                        const uniqueCombo = [];
                        for (const c of combo) {
                            const key = `${c.suit}-${c.rank}-${c.deck ?? ''}`;
                            if (!used.has(key)) {
                                used.add(key);
                                uniqueCombo.push(c);
                            }
                        }
                        if (uniqueCombo.length === bombSize) {
                            const eval_ = CardEvaluator.evaluate(uniqueCombo, wildRank);
                            if (eval_.valid) results.push({ cards: uniqueCombo, type: eval_.type, rank: eval_.rank, length: bombSize });
                        }
                    }
                }
            }
        }

        // 纯逢人配炸弹
        if (wildCount >= 4) {
            for (let bombSize = 4; bombSize <= wildCount && bombSize <= 8; bombSize++) {
                const combo = wilds.slice(0, bombSize);
                const eval_ = CardEvaluator.evaluate(combo, wildRank);
                if (eval_.valid) results.push({ cards: combo, type: eval_.type, rank: eval_.rank, length: bombSize });
            }
        }

        // 天王炸（4张王）
        const allJokers = hand.filter(c => c.suit === 'joker');
        if (allJokers.length >= 4) {
            const combo = allJokers.slice(0, 4);
            const eval_ = CardEvaluator.evaluate(combo, wildRank);
            if (eval_.valid) results.push({ cards: combo, type: eval_.type, rank: eval_.rank, length: 4 });
        }

        // 顺子（5张连续）- 尝试所有可能的5张组合
        const normalCards = hand.filter(c => c.suit !== 'joker');
        const straightCandidates = AIPlayer._findStraights(normalCards, wildRank, 5);
        for (const combo of straightCandidates) {
            const eval_ = CardEvaluator.evaluate(combo, wildRank);
            if (eval_.valid && eval_.type === HAND_TYPES.STRAIGHT) {
                results.push({ cards: combo, type: eval_.type, rank: eval_.rank, length: 5 });
            }
        }

        // 同花顺（5张同花色连续）
        const sfCandidates = AIPlayer._findStraightFlushes(normalCards, wildRank);
        for (const combo of sfCandidates) {
            const eval_ = CardEvaluator.evaluate(combo, wildRank);
            if (eval_.valid && eval_.type === HAND_TYPES.STRAIGHT_FLUSH) {
                results.push({ cards: combo, type: eval_.type, rank: eval_.rank, length: 5 });
            }
        }

        // 连对（3对连续，6张）
        const fpCandidates = AIPlayer._findFlushPairs(hand, wildRank);
        for (const combo of fpCandidates) {
            const eval_ = CardEvaluator.evaluate(combo, wildRank);
            if (eval_.valid && eval_.type === HAND_TYPES.FLUSH_PAIR) {
                results.push({ cards: combo, type: eval_.type, rank: eval_.rank, length: 6 });
            }
        }

        // 钢板/双飞（2连三，6张）
        const tsCandidates = AIPlayer._findTripleStraights(hand, wildRank);
        for (const combo of tsCandidates) {
            const eval_ = CardEvaluator.evaluate(combo, wildRank);
            if (eval_.valid && eval_.type === HAND_TYPES.TRIPLE_STRAIGHT) {
                results.push({ cards: combo, type: eval_.type, rank: eval_.rank, length: 6 });
            }
        }

        // 三带二（5张）
        const fhCandidates = AIPlayer._findFullHouses(hand, wildRank);
        for (const combo of fhCandidates) {
            const eval_ = CardEvaluator.evaluate(combo, wildRank);
            if (eval_.valid && eval_.type === HAND_TYPES.FULL_HOUSE) {
                results.push({ cards: combo, type: eval_.type, rank: eval_.rank, length: 5 });
            }
        }

        // 去重
        const seen = new Set();
        const unique = [];
        for (const r of results) {
            const key = r.cards.map(c => `${c.suit}-${c.rank}-${c.deck ?? ''}`).sort().join(',');
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(r);
            }
        }

        return unique;
    }

    /**
     * 找所有可能的顺子（5张连续）
     */
    static _findStraights(cards, wildRank, length) {
        const results = [];
        const normals = cards.filter(c => !isWild(c, wildRank));
        const wilds = cards.filter(c => isWild(c, wildRank));
        const wildCount = wilds.length;

        // 收集所有非王牌非逢人配的点数
        const normalRanks = [...new Set(normals.map(c => c.rank))].filter(r => RANKS.includes(r));
        const normalRankSet = new Set(normalRanks);

        // 尝试所有可能的起始rank
        for (let start = 0; start <= RANKS.length - length; start++) {
            const seq = [];
            const need = [];
            for (let i = 0; i < length; i++) {
                const r = RANKS[start + i];
                if (normalRankSet.has(r)) {
                    seq.push(r);
                } else {
                    need.push(r);
                }
            }
            if (need.length <= wildCount) {
                // 构建牌组合
                const combo = [];
                for (const r of seq) {
                    const c = normals.find(x => x.rank === r);
                    if (c) combo.push(c);
                }
                for (let i = 0; i < need.length; i++) {
                    combo.push(wilds[i]);
                }
                if (combo.length === length) {
                    results.push(combo);
                }
            }
        }

        // 尝试 A 作为 1（A2345）
        if (normalRankSet.has('A')) {
            const aSeq = ['A', '2', '3', '4', '5'];
            const have = aSeq.filter(r => normalRankSet.has(r));
            const need = aSeq.filter(r => !normalRankSet.has(r));
            if (need.length <= wildCount) {
                const combo = [];
                for (const r of have) {
                    const c = normals.find(x => x.rank === r);
                    if (c) combo.push(c);
                }
                for (let i = 0; i < need.length; i++) {
                    combo.push(wilds[i]);
                }
                if (combo.length === 5) results.push(combo);
            }
        }

        return results;
    }

    /**
     * 找所有可能的同花顺
     */
    static _findStraightFlushes(cards, wildRank) {
        const results = [];
        const suits = ['spades', 'hearts', 'diamonds', 'clubs'];
        const wilds = cards.filter(c => isWild(c, wildRank));
        const wildCount = wilds.length;

        for (const suit of suits) {
            const suitCards = cards.filter(c => c.suit === suit && !isWild(c, wildRank));
            const suitRanks = [...new Set(suitCards.map(c => c.rank))].filter(r => RANKS.includes(r));
            const suitRankSet = new Set(suitRanks);

            for (let start = 0; start <= RANKS.length - 5; start++) {
                const have = [];
                const need = [];
                for (let i = 0; i < 5; i++) {
                    const r = RANKS[start + i];
                    if (suitRankSet.has(r)) have.push(r);
                    else need.push(r);
                }
                if (need.length <= wildCount) {
                    const combo = [];
                    for (const r of have) {
                        const c = suitCards.find(x => x.rank === r);
                        if (c) combo.push(c);
                    }
                    for (let i = 0; i < need.length; i++) {
                        combo.push(wilds[i]);
                    }
                    if (combo.length === 5) results.push(combo);
                }
            }

            // A 作为 1
            if (suitRankSet.has('A')) {
                const aSeq = ['A', '2', '3', '4', '5'];
                const have = aSeq.filter(r => suitRankSet.has(r));
                const need = aSeq.filter(r => !suitRankSet.has(r));
                if (need.length <= wildCount) {
                    const combo = [];
                    for (const r of have) {
                        const c = suitCards.find(x => x.rank === r);
                        if (c) combo.push(c);
                    }
                    for (let i = 0; i < need.length; i++) {
                        combo.push(wilds[i]);
                    }
                    if (combo.length === 5) results.push(combo);
                }
            }
        }

        return results;
    }

    /**
     * 找所有可能的连对（3对连续，6张）
     */
    static _findFlushPairs(cards, wildRank) {
        const results = [];
        const normals = cards.filter(c => c.suit !== 'joker' && !isWild(c, wildRank));
        const wilds = cards.filter(c => isWild(c, wildRank));
        const wildCount = wilds.length;

        // 统计每个rank有多少张（普通牌）
        const rankCounts = {};
        for (const c of normals) {
            rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;
        }

        // 尝试所有3连对的起始位置
        for (let start = 0; start <= RANKS.length - 3; start++) {
            const combo = [];
            let needWilds = 0;
            let valid = true;

            for (let i = 0; i < 3; i++) {
                const r = RANKS[start + i];
                const count = rankCounts[r] || 0;
                if (count >= 2) {
                    // 有两张或以上，取两张
                    const rcards = normals.filter(c => c.rank === r).slice(0, 2);
                    combo.push(...rcards);
                } else if (count === 1) {
                    // 只有一张，需要一张逢人配
                    combo.push(normals.find(c => c.rank === r));
                    needWilds++;
                } else {
                    // 没有，需要两张逢人配
                    needWilds += 2;
                }
            }

            if (valid && needWilds <= wildCount) {
                for (let i = 0; i < needWilds; i++) {
                    combo.push(wilds[i]);
                }
                if (combo.length === 6) {
                    results.push(combo);
                }
            }
        }

        return results;
    }

    /**
     * 找所有可能的钢板（2连三，6张）
     */
    static _findTripleStraights(cards, wildRank) {
        const results = [];
        const normals = cards.filter(c => c.suit !== 'joker' && !isWild(c, wildRank));
        const wilds = cards.filter(c => isWild(c, wildRank));
        const wildCount = wilds.length;

        const rankCounts = {};
        for (const c of normals) {
            rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;
        }

        for (let start = 0; start <= RANKS.length - 2; start++) {
            const combo = [];
            let needWilds = 0;

            for (let i = 0; i < 2; i++) {
                const r = RANKS[start + i];
                const count = rankCounts[r] || 0;
                if (count >= 3) {
                    const rcards = normals.filter(c => c.rank === r).slice(0, 3);
                    combo.push(...rcards);
                } else if (count === 2) {
                    combo.push(...normals.filter(c => c.rank === r).slice(0, 2));
                    needWilds++;
                } else if (count === 1) {
                    combo.push(normals.find(c => c.rank === r));
                    needWilds += 2;
                } else {
                    needWilds += 3;
                }
            }

            if (needWilds <= wildCount) {
                for (let i = 0; i < needWilds; i++) {
                    combo.push(wilds[i]);
                }
                if (combo.length === 6) {
                    results.push(combo);
                }
            }
        }

        return results;
    }

    /**
     * 找所有可能的三带二
     */
    static _findFullHouses(cards, wildRank) {
        const results = [];
        const normals = cards.filter(c => c.suit !== 'joker' && !isWild(c, wildRank));
        const wilds = cards.filter(c => isWild(c, wildRank));
        const wildCount = wilds.length;

        const rankCounts = {};
        for (const c of normals) {
            rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;
        }

        const ranks = Object.keys(rankCounts);

        // 尝试每个rank作为三张部分
        for (const tripleRank of ranks) {
            const tripleCount = rankCounts[tripleRank];
            const tripleNeed = Math.max(0, 3 - tripleCount);

            if (tripleNeed > wildCount) continue;

            const tripleCards = normals.filter(c => c.rank === tripleRank).slice(0, 3);
            const tripleWilds = wilds.slice(0, tripleNeed);

            // 找对子部分（不同的rank）
            for (const pairRank of ranks) {
                if (pairRank === tripleRank) continue;
                const pairCount = rankCounts[pairRank];
                const pairNeed = Math.max(0, 2 - pairCount);

                if (tripleNeed + pairNeed > wildCount) continue;

                const pairCards = normals.filter(c => c.rank === pairRank).slice(0, 2);
                const pairWilds = wilds.slice(tripleNeed, tripleNeed + pairNeed);

                const combo = [...tripleCards, ...tripleWilds, ...pairCards, ...pairWilds];
                if (combo.length === 5) {
                    results.push(combo);
                }
            }

            // 如果逢人配够多，可以纯逢人配对子
            if (wildCount - tripleNeed >= 2) {
                const pairWilds = wilds.slice(tripleNeed, tripleNeed + 2);
                const combo = [...tripleCards, ...tripleWilds, ...pairWilds];
                if (combo.length === 5) {
                    results.push(combo);
                }
            }
        }

        // 纯逢人配三张 + 对子
        if (wildCount >= 5) {
            const tripleWilds = wilds.slice(0, 3);
            const pairWilds = wilds.slice(3, 5);
            results.push([...tripleWilds, ...pairWilds]);
        }

        return results;
    }

    /**
     * 生成候选牌组合（跟牌用）
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

        // 天王炸
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
        const allPlays = AIPlayer._analyzeHand(hand, wildRank);

        for (const play of allPlays) {
            if (play.type === type) {
                if (length === null || play.length === length) {
                    results.push(play.cards);
                }
            }
            // 炸弹类型匹配
            if (type === 'bomb' && (play.type === HAND_TYPES.BOMB || play.type === HAND_TYPES.STRAIGHT_FLUSH || play.type === HAND_TYPES.JOKER_BOMB)) {
                results.push(play.cards);
            }
        }

        return results;
    }

    /**
     * 进贡：选最大的牌（逢人配除外）
     */
    static decideTribute(hand, wildRank) {
        return CardDeck.getBestTributeCard(hand, wildRank);
    }

    /**
     * 还贡：选最小的合法牌（<=10）
     */
    static decideReturnTribute(hand, wildRank) {
        const eligible = hand
            .filter(c => {
                // 不能还逢人配
                if (isWild(c, wildRank)) return false;
                // 不能还王牌
                if (c.suit === 'joker') return false;
                // 不能还级牌
                if (c.rank === wildRank) return false;
                return true;
            })
            .sort((a, b) => rankValue(a, wildRank) - rankValue(b, wildRank));

        // 优先选 <= 10 的牌
        const RANK_ORDER = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
        const tenIdx = RANK_ORDER.indexOf('10');
        const smallCards = eligible.filter(c => RANK_ORDER.indexOf(c.rank) <= tenIdx);

        if (smallCards.length > 0) return smallCards[0];
        if (eligible.length > 0) return eligible[0];
        return hand[0];
    }

    /**
     * 找手牌中最小的牌
     */
    static _findLowestCard(hand, wildRank) {
        const sorted = hand.sort((a, b) => rankValue(a, wildRank) - rankValue(b, wildRank));
        return sorted[0];
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
