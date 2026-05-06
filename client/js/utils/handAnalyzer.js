/**
 * HandAnalyzer — 手牌分析，理牌核心
 *
 * 竖排堆叠（左侧，按优先级）：
 *   1. 炸弹（>=4张同点）-> 标签 "四炸"..."八炸"
 *   2. 同花顺（>=5张同花连，逢人配可补空）-> 标签 "同花顺 ♥"
 *
 * 其余牌：同点数竖排堆叠（对子/三张），大小鬼始终单张
 */
const HandAnalyzer = (function() {
    var RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    var SUIT_ORDER = { spades: 0, hearts: 1, clubs: 2, diamonds: 3 };
    var SUIT_SYM  = { spades: '♠', hearts: '♥', clubs: '♣', diamonds: '♦' };
    var BOMB_NUM  = { 4: '四炸', 5: '五炸', 6: '六炸', 7: '七炸', 8: '八炸' };

    function cardKey(card) {
        return card.id || card.suit + '_' + card.rank + '_' + (card.deck != null ? card.deck : '');
    }

    function rankVal(rank, wildRank) {
        if (rank === 'red_joker') return 17;
        if (rank === 'black_joker') return 16;
        if (rank === wildRank) return 15;
        var idx = RANKS.indexOf(rank);
        return idx === -1 ? 0 : idx + 2;
    }

    function seqVal(rank) {
        var idx = RANKS.indexOf(rank);
        return idx === -1 ? 0 : idx + 2;
    }

    function isWild(card, wildRank) {
        return card.suit === 'hearts' && card.rank === wildRank;
    }

    function sortDesc(cards, wildRank) {
        cards.sort(function(a, b) {
            var rv = rankVal(b.rank, wildRank) - rankVal(a.rank, wildRank);
            if (rv !== 0) return rv;
            return (SUIT_ORDER[a.suit] != null ? SUIT_ORDER[a.suit] : 99) - (SUIT_ORDER[b.suit] != null ? SUIT_ORDER[b.suit] : 99);
        });
    }

    function arrange(hand, wildRank) {
        if (!hand || hand.length === 0) return { items: [] };

        var used = new Set();
        function mark(c) { used.add(cardKey(c)); }
        function unused() { return hand.filter(function(c) { return !used.has(cardKey(c)); }); }

        var items = [];
        var powerItems = [];

        // 1. 炸弹（>=4张同点，纯天然，不含逢人配）
        var byRank = {};
        unused().forEach(function(c) {
            if (!byRank[c.rank]) byRank[c.rank] = [];
            byRank[c.rank].push(c);
        });
        var bombs = [];
        Object.keys(byRank).forEach(function(rank) {
            var cards = byRank[rank];
            if (cards.length >= 4) bombs.push({ rank: rank, cards: cards.slice(), len: cards.length });
        });
        bombs.sort(function(a, b) {
            if (b.len !== a.len) return b.len - a.len;
            return rankVal(b.rank, wildRank) - rankVal(a.rank, wildRank);
        });
        bombs.forEach(function(b) {
            sortDesc(b.cards, wildRank);
            b.cards.forEach(mark);
            powerItems.push({ type: 'stack', cards: b.cards, label: BOMB_NUM[b.len] || (b.len + '炸'), category: 'bomb', isBomb: true, len: b.len, rank: b.rank });
        });

        // 2. 取出逢人配（暂不标记，留给同花顺当补牌）
        var wildCards = unused().filter(function(c) { return isWild(c, wildRank); });
        var availWilds = wildCards.slice(); // 可用逢人配副本

        // 剩余天然牌（不含逢人配）
        var naturals = unused().filter(function(c) { return !isWild(c, wildRank); });

        // 3. 同花顺（>=5张同花连，逢人配补空）
        var usedWildKeys = [];
        var sfResult = _findStraightFlushes(naturals, availWilds, wildRank);
        sfResult.sfs.forEach(function(sf) {
            sortDesc(sf.cards, wildRank);
            sf.cards.forEach(mark);
            // 标记用掉的逢人配
            sf.usedWilds.forEach(function(w) {
                mark(w);
                usedWildKeys.push(cardKey(w));
            });
            powerItems.push({ type: 'stack', cards: sf.cards, label: '同花顺 ' + SUIT_SYM[sf.suit], category: 'straight_flush', isFlush: true, len: sf.len, rank: sf.topRank });
        });

        // 按威力排序：同花顺威力介于六炸和五炸之间
        powerItems.sort(function(a, b) {
            function weight(item) {
                if (item.isBomb) return item.len;
                if (item.isFlush) return 5.5;
                return 0;
            }
            var w = weight(b) - weight(a);
            if (w !== 0) return w;
            if (b.len !== a.len) return b.len - a.len;
            return rankVal(b.rank, wildRank) - rankVal(a.rank, wildRank);
        });
        powerItems.forEach(function(item) { items.push(item); });

        // 6. 剩余牌：同点数竖排堆叠（对子/三张），大小鬼始终单张
        var remaining = unused();
        sortDesc(remaining, wildRank);

        // 按点数分组
        var rankGroups = {};
        remaining.forEach(function(c) {
            if (!rankGroups[c.rank]) rankGroups[c.rank] = [];
            rankGroups[c.rank].push(c);
        });

        // 按点数降序输出各组
        var sortedRanks = Object.keys(rankGroups).sort(function(a, b) {
            return rankVal(b, wildRank) - rankVal(a, wildRank);
        });

        sortedRanks.forEach(function(rank) {
            var group = rankGroups[rank];
            sortDesc(group, wildRank);
            if (group.length >= 2) {
                items.push({ type: 'stack', cards: group, category: 'same-rank' });
            } else {
                items.push({ type: 'single', cards: group, category: 'single' });
            }
        });

        return { items: items };
    }

    /**
     * 从天然牌 + 逢人配中找出所有同花顺
     * 逢人配可填补序列中的空缺（每个缺位消耗1张逢人配）
     */
    function _findStraightFlushes(naturals, wilds, wildRank) {
        var bySuit = { spades: [], hearts: [], clubs: [], diamonds: [] };
        naturals.forEach(function(c) {
            if (bySuit[c.suit]) bySuit[c.suit].push(c);
        });

        var allSfs = [];

        ['spades', 'hearts', 'clubs', 'diamonds'].forEach(function(suit) {
            var cards = bySuit[suit];
            if (!cards.length) return;

            // 按点数分组
            var rankMap = {};
            var ranks = [];
            cards.forEach(function(c) {
                if (!rankMap[c.rank]) { rankMap[c.rank] = []; ranks.push(c.rank); }
                rankMap[c.rank].push(c);
            });
            ranks.sort(function(a, b) { return seqVal(a) - seqVal(b); });

            // 尝试所有可能的连续区间 [i, j]，gap 用逢人配填补
            for (var i = 0; i < ranks.length; i++) {
                // 从 i 开始尽力向后扩展
                var avail = wilds.length;
                var rangeCards = [];
                var usedW = [];
                var j = i;
                var expectSeq = seqVal(ranks[i]);

                while (j < ranks.length) {
                    var curSeq = seqVal(ranks[j]);
                    // 跳过 gap（用逢人配补）
                    while (curSeq > expectSeq && avail > 0) {
                        avail--;
                        expectSeq++;
                    }
                    if (curSeq !== expectSeq) break; // 补不上，断连

                    // 收集该点位一张牌（同花顺每点位最多一张）
                    rangeCards.push(rankMap[ranks[j]][0]);
                    j++;
                    expectSeq++;
                }

                // 仅当不足5张时，用剩余的逢人配向高端扩展补到5张
                while (avail > 0 && expectSeq <= 14 && (expectSeq - seqVal(ranks[i])) < 5) {
                    avail--;
                    expectSeq++;
                }

                var len = expectSeq - seqVal(ranks[i]);
                var usedWildCount = wilds.length - avail;

                // 纯天然连续长度>5：生成所有5-card滑动窗口作为备选
                if (usedWildCount === 0 && len > 5) {
                    for (var w = 0; w <= len - 5; w++) {
                        var winCards = [];
                        for (var r = w; r < w + 5; r++) {
                            winCards.push(rankMap[ranks[i + r]][0]);
                        }
                        var winTopSeq = seqVal(ranks[i + w + 4]);
                        allSfs.push({
                            suit: suit,
                            cards: winCards,
                            usedWilds: [],
                            len: 5,
                            topRank: RANKS[winTopSeq - 2],
                            runKey: suit + '_' + ranks[i],
                            windowIndex: w
                        });
                    }
                } else if (len === 5 && usedWildCount <= wilds.length) {
                    var sfUsed = wilds.slice(0, usedWildCount);
                    allSfs.push({
                        suit: suit,
                        cards: rangeCards.concat(sfUsed),
                        usedWilds: sfUsed,
                        len: len,
                        topRank: RANKS[expectSeq - 3],
                        runKey: suit + '_' + ranks[i],
                        windowIndex: 0
                    });
                }
            }
        });

        // 去重：相同 suit + 相同 cards 的只保留最长
        allSfs.sort(function(a, b) {
            if (b.len !== a.len) return b.len - a.len;
            // 同长时优先用逢人配少的（天然的优先）
            var aWilds = a.usedWilds.length;
            var bWilds = b.usedWilds.length;
            if (aWilds !== bWilds) return aWilds - bWilds;
            return rankVal(b.topRank, wildRank) - rankVal(a.topRank, wildRank);
        });

        // 防止重叠：优先保留又长又大的，标记已被使用的 natural + wild cards
        var usedNatKeys = new Set();
        var usedWildKeys = new Set();
        var finalSfs = [];
        var alternatives = {};
        allSfs.forEach(function(sf) {
            var natKeys = [];
            sf.cards.forEach(function(c) {
                if (!isWild(c, wildRank)) natKeys.push(cardKey(c));
            });
            var wildKeys = sf.usedWilds.map(function(w) { return cardKey(w); });
            var conflict = natKeys.some(function(k) { return usedNatKeys.has(k); })
                        || wildKeys.some(function(k) { return usedWildKeys.has(k); });
            if (!conflict) {
                natKeys.forEach(function(k) { usedNatKeys.add(k); });
                wildKeys.forEach(function(k) { usedWildKeys.add(k); });
                finalSfs.push(sf);
            } else if (sf.runKey) {
                if (!alternatives[sf.runKey]) alternatives[sf.runKey] = [];
                alternatives[sf.runKey].push(sf);
            }
        });

        return { sfs: finalSfs, alternatives: alternatives };
    }

    /**
     * 根据选定炸弹和同花顺构建完整理牌 items（含剩余牌）
     */
    function _buildPlanFromSelections(hand, wildRank, bombItems, chosenSfs) {
        var used = new Set();

        bombItems.forEach(function(item) {
            item.cards.forEach(function(c) { used.add(cardKey(c)); });
        });

        var sfItems = [];
        chosenSfs.forEach(function(sf) {
            sortDesc(sf.cards, wildRank);
            sf.cards.forEach(function(c) { used.add(cardKey(c)); });
            (sf.usedWilds || []).forEach(function(w) { used.add(cardKey(w)); });
            sfItems.push({
                type: 'stack',
                cards: sf.cards,
                label: '同花顺 ' + SUIT_SYM[sf.suit],
                category: 'straight_flush',
                isFlush: true,
                len: sf.len,
                rank: sf.topRank
            });
        });

        var powerItems = bombItems.concat(sfItems);
        powerItems.sort(function(a, b) {
            function weight(item) {
                if (item.isBomb) return item.len;
                if (item.isFlush) return 5.5;
                return 0;
            }
            var w = weight(b) - weight(a);
            if (w !== 0) return w;
            if (b.len !== a.len) return b.len - a.len;
            return rankVal(b.rank, wildRank) - rankVal(a.rank, wildRank);
        });

        var items = [];
        powerItems.forEach(function(item) { items.push(item); });

        var remaining = hand.filter(function(c) { return !used.has(cardKey(c)); });
        sortDesc(remaining, wildRank);

        var rankGroups = {};
        remaining.forEach(function(c) {
            if (!rankGroups[c.rank]) rankGroups[c.rank] = [];
            rankGroups[c.rank].push(c);
        });

        var sortedRanks = Object.keys(rankGroups).sort(function(a, b) {
            return rankVal(b, wildRank) - rankVal(a, wildRank);
        });

        sortedRanks.forEach(function(rank) {
            var group = rankGroups[rank];
            sortDesc(group, wildRank);
            if (group.length >= 2) {
                items.push({ type: 'stack', cards: group, category: 'same-rank' });
            } else {
                items.push({ type: 'single', cards: group, category: 'single' });
            }
        });

        return { items: items };
    }

    function _cartesianProduct(arrays) {
        if (arrays.length === 0) return [[]];
        var rest = _cartesianProduct(arrays.slice(1));
        var result = [];
        arrays[0].forEach(function(item) {
            rest.forEach(function(combo) {
                result.push([item].concat(combo));
            });
        });
        return result;
    }

    /**
     * 生成所有理牌备选方案（长连续同花产生多方案）
     * 返回 { plans: [{ items }], defaultIndex }
     * plans[defaultIndex] 等价于 arrange() 的默认输出
     */
    function arrangeAlternatives(hand, wildRank) {
        if (!hand || hand.length === 0) return { plans: [{ items: [] }], defaultIndex: 0 };

        var used = new Set();
        function mark(c) { used.add(cardKey(c)); }
        function unused() { return hand.filter(function(c) { return !used.has(cardKey(c)); }); }

        // 1. 炸弹
        var byRank = {};
        unused().forEach(function(c) {
            if (!byRank[c.rank]) byRank[c.rank] = [];
            byRank[c.rank].push(c);
        });
        var bombs = [];
        Object.keys(byRank).forEach(function(rank) {
            var bc = byRank[rank];
            if (bc.length >= 4) bombs.push({ rank: rank, cards: bc.slice(), len: bc.length });
        });
        bombs.sort(function(a, b) {
            if (b.len !== a.len) return b.len - a.len;
            return rankVal(b.rank, wildRank) - rankVal(a.rank, wildRank);
        });
        var bombItems = [];
        bombs.forEach(function(b) {
            sortDesc(b.cards, wildRank);
            b.cards.forEach(mark);
            bombItems.push({ type: 'stack', cards: b.cards, label: BOMB_NUM[b.len] || (b.len + '炸'), category: 'bomb', isBomb: true, len: b.len, rank: b.rank });
        });

        // 2. 逢人配 + 天然牌
        var wildCards = unused().filter(function(c) { return isWild(c, wildRank); });
        var availWilds = wildCards.slice();
        var naturals = unused().filter(function(c) { return !isWild(c, wildRank); });

        // 3. 找所有同花顺（含备选）
        var sfResult = _findStraightFlushes(naturals, availWilds, wildRank);

        // 4. 构建方案列表
        var altGroups = [];
        Object.keys(sfResult.alternatives || {}).forEach(function(runKey) {
            var alts = sfResult.alternatives[runKey];
            var defaultSf = sfResult.sfs.find(function(sf) { return sf.runKey === runKey; });
            if (defaultSf && alts.length > 0) {
                var allOpts = [defaultSf].concat(alts);
                allOpts.sort(function(a, b) { return (b.windowIndex || 0) - (a.windowIndex || 0); });
                altGroups.push({ runKey: runKey, options: allOpts });
            }
        });

        if (altGroups.length === 0) {
            var singlePlan = _buildPlanFromSelections(hand, wildRank, bombItems, sfResult.sfs);
            return { plans: [singlePlan], defaultIndex: 0 };
        }

        var combos = _cartesianProduct(altGroups.map(function(g) { return g.options; }));

        var plans = [];
        combos.forEach(function(comboChoices) {
            var chosenMap = {};
            comboChoices.forEach(function(sf) { chosenMap[sf.runKey] = sf; });
            var planSfs = sfResult.sfs.map(function(sf) {
                return chosenMap[sf.runKey] || sf;
            });
            plans.push(_buildPlanFromSelections(hand, wildRank, bombItems, planSfs));
        });

        return { plans: plans, defaultIndex: 0 };
    }

    return {
        arrange: arrange,
        arrangeAlternatives: arrangeAlternatives,
        rankValue: rankVal,
        seqValue: seqVal,
        isWild: isWild,
        cardKey: cardKey
    };
})();
