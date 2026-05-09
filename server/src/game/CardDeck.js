/**
 * CardDeck - 掼蛋牌组管理
 * 108张牌：2副标准扑克（含大小王）
 */

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

class CardDeck {
    /**
     * 创建108张牌（2副）
     */
    static createDeck() {
        const cards = [];
        for (let deck = 0; deck < 2; deck++) {
            for (const suit of SUITS) {
                for (const rank of RANKS) {
                    cards.push({ suit, rank, deck });
                }
            }
            cards.push({ suit: 'joker', rank: 'black_joker', deck });
            cards.push({ suit: 'joker', rank: 'red_joker', deck });
        }
        return cards;
    }

    /**
     * Fisher-Yates 洗牌
     */
    static shuffle(cards) {
        const arr = [...cards];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    /**
     * 发牌：4人各27张
     */
    static deal(shuffledDeck) {
        const hands = [[], [], [], []];
        for (let i = 0; i < shuffledDeck.length; i++) {
            hands[i % 4].push(shuffledDeck[i]);
        }
        return hands;
    }

    /**
     * 手牌排序
     */
    static sortHand(hand, wildRank) {
        return [...hand].sort((a, b) => {
            if (a.suit === 'joker' && b.suit === 'joker') {
                return a.rank === 'red_joker' ? 1 : -1;
            }
            if (a.suit === 'joker') return 1;
            if (b.suit === 'joker') return -1;

            const aIsWild = a.suit === 'hearts' && a.rank === wildRank;
            const bIsWild = b.suit === 'hearts' && b.rank === wildRank;
            if (aIsWild && !bIsWild) return 1;
            if (!aIsWild && bIsWild) return -1;

            const rankDiff = RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank);
            if (rankDiff !== 0) return rankDiff;

            const suitOrder = ['clubs', 'diamonds', 'hearts', 'spades'];
            return suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
        });
    }

    /**
     * 检查手牌是否包含指定牌
     */
    static containsCards(hand, cards) {
        const handCopy = [...hand];
        for (const card of cards) {
            const idx = handCopy.findIndex(c => c.suit === card.suit && c.rank === card.rank);
            if (idx === -1) return false;
            handCopy.splice(idx, 1);
        }
        return true;
    }

    /**
     * 从手牌移除指定牌
     */
    static removeCards(hand, cards) {
        const result = [...hand];
        for (const card of cards) {
            const idx = result.findIndex(c => c.suit === card.suit && c.rank === card.rank);
            if (idx !== -1) result.splice(idx, 1);
        }
        return result;
    }

    /**
     * 获取手牌中用于进贡的最大牌
     * 规则：进贡当前手牌中最大的牌（逢人配除外）
     * 特殊情况：没有大小王，且只有一张逢人配，且最大牌是级牌 → 找次一级的非级牌
     */
    static getBestTributeCard(hand, wildRank) {
        // 排除逢人配（红桃级牌）
        const eligible = hand.filter(c => !(c.suit === 'hearts' && c.rank === wildRank));

        // 排序：王牌 > 级牌 > A > K > ... > 2
        const sorted = eligible.sort((a, b) => {
            // 王牌之间比较
            if (a.suit === 'joker' && b.suit === 'joker') return a.rank === 'red_joker' ? 1 : -1;
            if (a.suit === 'joker') return 1;
            if (b.suit === 'joker') return -1;

            // 级牌（非逢人配）仅次于王牌
            const aIsLevel = a.rank === wildRank;
            const bIsLevel = b.rank === wildRank;
            if (aIsLevel && !bIsLevel) return 1;
            if (!aIsLevel && bIsLevel) return -1;

            // 普通牌按自然顺序
            return RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank);
        });

        const maxCard = sorted[sorted.length - 1];

        // 特殊情况：没有大小王，只有一张逢人配，最大牌是级牌 → 不选级牌
        const hasJoker = eligible.some(c => c.suit === 'joker');
        const wildHeartsCount = hand.filter(c => c.suit === 'hearts' && c.rank === wildRank).length;

        if (!hasJoker && wildHeartsCount === 1 && maxCard.rank === wildRank) {
            const nonLevelCards = eligible.filter(c => c.rank !== wildRank && c.suit !== 'joker');
            if (nonLevelCards.length > 0) {
                const nonLevelSorted = nonLevelCards.sort((a, b) => RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank));
                return nonLevelSorted[nonLevelSorted.length - 1];
            }
        }

        return maxCard;
    }
}

module.exports = CardDeck;
