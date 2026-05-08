/**
 * CardEvaluator - 掼蛋牌型判断与比较
 *
 * 支持牌型：
 * - 单张、对子、三张
 * - 顺子（5张+连续）
 * - 连对（3对+连续对子）
 * - 三带二
 * - 炸弹（4张+相同）
 * - 同花顺（5张+同花色连续）
 * - 双王炸（最大）
 *
 * 逢人配（wildRank）：当前级别牌可替代任意牌
 */

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const HAND_TYPES = {
    SINGLE: 'single',
    PAIR: 'pair',
    TRIPLE: 'triple',
    STRAIGHT: 'straight',
    TRIPLE_STRAIGHT: 'triple_straight',
    FLUSH_PAIR: 'flush_pair',
    FULL_HOUSE: 'full_house',
    BOMB: 'bomb',
    STRAIGHT_FLUSH: 'straight_flush',
    JOKER_BOMB: 'joker_bomb',
};

// 牌型权重（炸弹类型权重更高）
const TYPE_WEIGHT = {
    single: 1, pair: 2, triple: 3, straight: 4,
    triple_straight: 5, flush_pair: 6, full_house: 7,
    bomb: 10, straight_flush: 11, joker_bomb: 99,
};

function rankValue(rank, wildRank) {
    if (rank === 'red_joker') return 17;
    if (rank === 'black_joker') return 16;
    if (rank === wildRank) return 15;  // 级牌最大（打2时2>A，打5时5>A）
    const idx = RANKS.indexOf(rank);
    return idx === -1 ? 0 : idx + 2;
}

// 自然序数值，用于顺子/同花顺/连对的连续检测（级牌保持原位）
function seqValue(rank) {
    const idx = RANKS.indexOf(rank);
    return idx === -1 ? 0 : idx + 2;
}

function isWild(card, wildRank) {
    return card.suit === 'hearts' && card.rank === wildRank;
}

class CardEvaluator {
    /**
     * 分析牌型
     * @param {Array} cards 出的牌
     * @param {string} wildRank 当前级别
     * @returns {{ type, rank, length, valid }}
     */
    static evaluate(cards, wildRank) {
        if (!cards || cards.length === 0) return { type: null, valid: false };

        const n = cards.length;
        const jokers = cards.filter(c => c.suit === 'joker');
        const wilds = cards.filter(c => isWild(c, wildRank));
        const normals = cards.filter(c => c.suit !== 'joker' && !isWild(c, wildRank));

        // 天王炸（4张王：2大王+2小王）
        if (n === 4 && jokers.length === 4) {
            return { type: HAND_TYPES.JOKER_BOMB, rank: 99, length: 4, valid: true };
        }

        // 三带二（5张，必须在炸弹前检测，避免含逢人配时被误判为炸弹）
        if (n === 5) {
            const fh = _checkFullHouse(cards, wildRank, wilds, normals);
            if (fh) return fh;
        }

        // 炸弹（4张+相同，可含逢人配）
        const bomb = _checkBomb(cards, wildRank, jokers, wilds, normals);
        if (bomb) return bomb;

        // 同花顺（固定5张同花色连续，可含逢人配）
        if (n === 5) {
            const sf = _checkStraightFlush(cards, wildRank, wilds, normals);
            if (sf) return sf;
        }

        // 单张
        if (n === 1) {
            const card = cards[0];
            const rv = card.suit === 'joker'
                ? (card.rank === 'red_joker' ? 17 : 16)
                : (isWild(card, wildRank) ? 15 : rankValue(card.rank, wildRank));
            return { type: HAND_TYPES.SINGLE, rank: rv, length: 1, valid: true };
        }

        // 对子
        if (n === 2) {
            // 对王：两个相同的大王或两个相同的小王
            if (jokers.length === 2) {
                if (cards[0].rank === cards[1].rank) {
                    return { type: HAND_TYPES.PAIR, rank: cards[0].rank === 'red_joker' ? 18 : 17, length: 2, valid: true };
                }
                return { type: null, valid: false }; // 一大一小不是合法牌型
            }
            const r = _checkPair(cards, wildRank, wilds, normals);
            return r || { type: null, valid: false };
        }

        // 三张
        if (n === 3) {
            const r = _checkTriple(cards, wildRank, wilds, normals);
            return r || { type: null, valid: false };
        }

        // 顺子（固定5张连续单张）
        if (n === 5) {
            const st = _checkStraight(cards, wildRank, wilds, normals);
            if (st) return st;
        }

        // 双飞/钢板（固定6张，2连三）如 333+444
        if (n === 6) {
            const ts = _checkTripleStraight(cards, wildRank, wilds, normals);
            if (ts) return ts;
        }

        // 连对（固定6张，3连对）
        if (n === 6) {
            const fp = _checkFlushPair(cards, wildRank, wilds, normals);
            if (fp) return fp;
        }

        return { type: null, valid: false };
    }

    /**
     * 比较两手牌
     * @returns {number} 1=eval1更大, -1=eval2更大, 0=不可比
     */
    static compare(eval1, eval2) {
        if (!eval1.valid || !eval2.valid) return 0;

        if (eval1.type === HAND_TYPES.JOKER_BOMB) return 1;
        if (eval2.type === HAND_TYPES.JOKER_BOMB) return -1;

        const isBomb1 = TYPE_WEIGHT[eval1.type] >= TYPE_WEIGHT[HAND_TYPES.BOMB];
        const isBomb2 = TYPE_WEIGHT[eval2.type] >= TYPE_WEIGHT[HAND_TYPES.BOMB];

        if (isBomb1 && !isBomb2) return 1;
        if (!isBomb1 && isBomb2) return -1;

        if (isBomb1 && isBomb2) {
            // 大炸弹(6张+) > 同花顺 > 小炸弹(4-5张)
            const isBigBomb1 = eval1.type === HAND_TYPES.BOMB && eval1.length >= 6;
            const isBigBomb2 = eval2.type === HAND_TYPES.BOMB && eval2.length >= 6;
            const isSmallBomb1 = eval1.type === HAND_TYPES.BOMB && eval1.length < 6;
            const isSmallBomb2 = eval2.type === HAND_TYPES.BOMB && eval2.length < 6;
            const isSF1 = eval1.type === HAND_TYPES.STRAIGHT_FLUSH;
            const isSF2 = eval2.type === HAND_TYPES.STRAIGHT_FLUSH;

            if (isBigBomb1 && isSF2) return 1;
            if (isSF1 && isBigBomb2) return -1;
            if (isSF1 && isSmallBomb2) return 1;
            if (isSmallBomb1 && isSF2) return -1;

            // 同类型：先比张数，再比点数
            if (eval1.length !== eval2.length) return eval1.length > eval2.length ? 1 : -1;
            return eval1.rank > eval2.rank ? 1 : eval1.rank < eval2.rank ? -1 : 0;
        }

        // 非炸弹：必须同类型同长度
        if (eval1.type !== eval2.type || eval1.length !== eval2.length) return 0;
        return eval1.rank > eval2.rank ? 1 : eval1.rank < eval2.rank ? -1 : 0;
    }

    /**
     * 判断cards能否压过lastCards
     */
    static canBeat(cards, lastCards, wildRank) {
        const e1 = CardEvaluator.evaluate(cards, wildRank);
        const e2 = CardEvaluator.evaluate(lastCards, wildRank);
        if (!e1.valid || !e2.valid) return false;
        return CardEvaluator.compare(e1, e2) > 0;
    }
}

// ==================== 私有辅助函数 ====================

function _checkPair(cards, wildRank, wilds, normals) {
    const wc = wilds.length;
    const nc = normals.length;

    if (nc === 2 && wc === 0) {
        if (normals[0].rank === normals[1].rank) {
            return { type: HAND_TYPES.PAIR, rank: rankValue(normals[0].rank, wildRank), length: 2, valid: true };
        }
    }
    if (nc === 1 && wc === 1) {
        return { type: HAND_TYPES.PAIR, rank: rankValue(normals[0].rank, wildRank), length: 2, valid: true };
    }
    if (nc === 0 && wc === 2) {
        return { type: HAND_TYPES.PAIR, rank: 15, length: 2, valid: true };
    }
    return null;
}

function _checkTriple(cards, wildRank, wilds, normals) {
    const wc = wilds.length;
    const nc = normals.length;

    if (nc === 3 && wc === 0 && normals.every(c => c.rank === normals[0].rank)) {
        return { type: HAND_TYPES.TRIPLE, rank: rankValue(normals[0].rank, wildRank), length: 3, valid: true };
    }
    if (nc === 2 && wc === 1 && normals[0].rank === normals[1].rank) {
        return { type: HAND_TYPES.TRIPLE, rank: rankValue(normals[0].rank, wildRank), length: 3, valid: true };
    }
    if (nc === 1 && wc === 2) {
        return { type: HAND_TYPES.TRIPLE, rank: rankValue(normals[0].rank, wildRank), length: 3, valid: true };
    }
    if (nc === 0 && wc === 3) {
        return { type: HAND_TYPES.TRIPLE, rank: 15, length: 3, valid: true };
    }
    return null;
}

function _checkBomb(cards, wildRank, jokers, wilds, normals) {
    const n = cards.length;
    if (n < 4) return null;

    const wc = wilds.length;
    const nc = normals.length;

    // 纯逢人配炸弹
    if (nc === 0 && jokers.length === 0) {
        return { type: HAND_TYPES.BOMB, rank: 15, length: n, valid: true };
    }

    // 普通牌全同点数
    if (nc > 0 && jokers.length === 0) {
        const ranks = normals.map(c => c.rank);
        if (new Set(ranks).size === 1) {
            return { type: HAND_TYPES.BOMB, rank: rankValue(ranks[0], wildRank), length: n, valid: true };
        }
    }

    return null;
}

function _checkStraight(cards, wildRank, wilds, normals) {
    const n = cards.length;
    if (n !== 5) return null;
    if (normals.some(c => c.suit === 'joker')) return null;

    const wc = wilds.length;

    // 尝试 A 作为 14（默认）
    const result1 = _tryStraight(normals, wc, n, wildRank, false);
    if (result1) return result1;

    // 如果有 A，再尝试 A 作为 1（A2345）
    if (normals.some(c => c.rank === 'A')) {
        const result2 = _tryStraight(normals, wc, n, wildRank, true);
        if (result2) return result2;
    }

    return null;
}

function _tryStraight(normals, wc, n, wildRank, aAsOne) {
    const normalVals = normals.map(c => {
        if (c.rank === 'A') return aAsOne ? 1 : seqValue(c.rank);
        return seqValue(c.rank);
    }).sort((a, b) => a - b);

    if (new Set(normalVals).size !== normalVals.length) return null;
    if (normalVals.length === 0) return null;

    const minV = normalVals[0];
    const maxV = normalVals[normalVals.length - 1];
    const range = maxV - minV + 1;
    const gaps = range - normalVals.length;

    if (gaps <= wc) {
        const extra = wc - gaps;
        const newMax = maxV + extra;
        if (newMax - minV + 1 === n && newMax <= 14) {
            const topRank = RANKS[newMax - 2];
            return { type: HAND_TYPES.STRAIGHT, rank: seqValue(topRank), length: n, valid: true };
        }
        const newMin = minV - extra;
        if (maxV - newMin + 1 === n && newMin >= 2) {
            const topRank = RANKS[maxV - 2];
            return { type: HAND_TYPES.STRAIGHT, rank: seqValue(topRank), length: n, valid: true };
        }
    }

    return null;
}

function _checkFlushPair(cards, wildRank, wilds, normals) {
    const n = cards.length;
    if (n !== 6) return null;
    if (normals.some(c => c.suit === 'joker')) return null;

    const rankCounts = {};
    for (const c of normals) rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;

    if (Object.values(rankCounts).some(v => v > 2)) return null;

    const pairs = Object.entries(rankCounts).filter(([, v]) => v === 2).map(([r]) => r);
    const singles = Object.entries(rankCounts).filter(([, v]) => v === 1).map(([r]) => r);
    const wc = wilds.length;

    if (singles.length > wc) return null;

    const allPairRanks = [...pairs, ...singles.slice(0, wc)];
    if (allPairRanks.length !== n / 2) return null;

    const pairVals = allPairRanks.map(r => seqValue(r)).sort((a, b) => a - b);

    for (let i = 1; i < pairVals.length; i++) {
        if (pairVals[i] - pairVals[i - 1] !== 1) return null;
    }

    const topRank = RANKS[pairVals[pairVals.length - 1] - 2];
    return { type: HAND_TYPES.FLUSH_PAIR, rank: seqValue(topRank), length: n, valid: true };
}

function _checkFullHouse(cards, wildRank, wilds, normals) {
    if (cards.length !== 5) return null;
    if (normals.some(c => c.suit === 'joker')) return null;

    const wc = wilds.length;
    const rankCounts = {};
    for (const c of normals) rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;

    const entries = Object.entries(rankCounts);
    const counts = entries.map(([, v]) => v).sort((a, b) => b - a);

    // 找三张的点数（三带二中三张的点数决定大小）
    const findTripleRank = () => {
        if (wc === 0) {
            if (counts[0] === 3 && counts[1] === 2) return entries.find(([, v]) => v === 3)[0];
        } else if (wc === 1) {
            if (counts[0] === 3 && counts[1] === 1) return entries.find(([, v]) => v === 3)[0];
            if (counts[0] === 2 && counts[1] === 2) {
                // 逢人配补成三张，取较大的对子
                const pairRanks = entries.filter(([, v]) => v === 2).map(([r]) => r);
                return pairRanks.reduce((a, b) => rankValue(a, wildRank) > rankValue(b, wildRank) ? a : b);
            }
        } else if (wc === 2) {
            if (counts[0] === 3) return entries.find(([, v]) => v === 3)[0];
            if (counts[0] === 2 && counts[1] === 1) return entries.find(([, v]) => v === 2)[0];
        } else if (wc === 3) {
            if (counts[0] === 2) return entries.find(([, v]) => v === 2)[0];
            if (entries.length === 2) return entries.reduce((a, b) => rankValue(a[0], wildRank) > rankValue(b[0], wildRank) ? a : b)[0];
        } else if (wc === 4) {
            if (entries.length === 1) return entries[0][0];
        } else if (wc === 5) {
            return wildRank;
        }
        return null;
    };

    const tripleRank = findTripleRank();
    if (!tripleRank) return null;

    return { type: HAND_TYPES.FULL_HOUSE, rank: seqValue(tripleRank), length: 5, valid: true };
}

// 双飞/钢板：连续三张（如 333+444，6张=2连三；333+444+555，9张=3连三）
function _checkTripleStraight(cards, wildRank, wilds, normals) {
    const n = cards.length;
    if (n !== 6) return null;
    if (normals.some(c => c.suit === 'joker')) return null;

    const k = n / 3; // 连续三张的组数
    const wc = wilds.length;

    // 统计各点数张数
    const rankCounts = {};
    for (const c of normals) {
        rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;
    }

    // 任一普通牌点超过3张则不可能组成双飞
    for (const count of Object.values(rankCounts)) {
        if (count > 3) return null;
    }

    // 取所有有点数的 rank，按 seq 排序
    const sortedRanks = Object.keys(rankCounts).sort((a, b) => seqValue(a) - seqValue(b));
    if (sortedRanks.length < k) return null;

    // 尝试每个起始位置
    for (let start = 0; start <= sortedRanks.length - k; start++) {
        const firstSeq = seqValue(sortedRanks[start]);
        let neededWilds = 0;
        let valid = true;

        for (let i = 0; i < k; i++) {
            const rank = sortedRanks[start + i];
            if (seqValue(rank) !== firstSeq + i) { valid = false; break; }
            const count = rankCounts[rank] || 0;
            neededWilds += 3 - count;
        }

        if (valid && neededWilds <= wc) {
            const topRank = sortedRanks[start + k - 1];
            return {
                type: HAND_TYPES.TRIPLE_STRAIGHT,
                rank: seqValue(topRank),
                length: n,
                valid: true,
            };
        }
    }

    // 全逢人配双飞（所有牌都是逢人配）
    if (normals.length === 0 && wc === n) {
        return { type: HAND_TYPES.TRIPLE_STRAIGHT, rank: seqValue(wildRank), length: n, valid: true };
    }

    return null;
}

function _checkStraightFlush(cards, wildRank, wilds, normals) {
    const n = cards.length;
    if (n !== 5) return null;
    if (normals.some(c => c.suit === 'joker')) return null;

    const suits = [...new Set(normals.map(c => c.suit))];
    if (suits.length > 1) return null;

    const wc = wilds.length;

    // 尝试 A 作为 14（默认）
    const result1 = _tryStraightFlush(normals, wc, n, wildRank, false);
    if (result1) return result1;

    // 如果有 A，再尝试 A 作为 1（A2345同花顺）
    if (normals.some(c => c.rank === 'A')) {
        const result2 = _tryStraightFlush(normals, wc, n, wildRank, true);
        if (result2) return result2;
    }

    return null;
}

function _tryStraightFlush(normals, wc, n, wildRank, aAsOne) {
    const normalVals = normals.map(c => {
        if (c.rank === 'A') return aAsOne ? 1 : seqValue(c.rank);
        return seqValue(c.rank);
    }).sort((a, b) => a - b);

    if (new Set(normalVals).size !== normalVals.length) return null;
    if (normalVals.length === 0) return null;

    const minV = normalVals[0];
    const maxV = normalVals[normalVals.length - 1];
    const range = maxV - minV + 1;
    const gaps = range - normalVals.length;

    if (gaps <= wc) {
        const extra = wc - gaps;
        const newMax = maxV + extra;
        if (newMax - minV + 1 === n && newMax <= 14) {
            const topRank = RANKS[newMax - 2];
            return { type: HAND_TYPES.STRAIGHT_FLUSH, rank: seqValue(topRank), length: n, valid: true };
        }
        const newMin = minV - extra;
        if (maxV - newMin + 1 === n && newMin >= 2) {
            const topRank = RANKS[maxV - 2];
            return { type: HAND_TYPES.STRAIGHT_FLUSH, rank: seqValue(topRank), length: n, valid: true };
        }
    }

    return null;
}

module.exports = { CardEvaluator, HAND_TYPES, isWild };
