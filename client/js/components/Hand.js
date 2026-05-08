/**
 * Hand 组件 — 渲染手牌区域，支持选牌交互、鼠标框选、理牌竖排堆叠
 */
const Hand = {
    /**
     * 渲染自己的手牌（正面，可点击选牌 + 拖拽框选）
     * @param {boolean} selectedGroup - 是否将选中牌理牌到左侧竖向堆叠
     */
    renderFront(container, cards, selectedCards, onToggle, levelRank, onMultiSelect, selectedGroup, onDragStart, onDragEnd) {
        container.innerHTML = '';
        const selectedKeys = new Set(selectedCards.map(c => HandAnalyzer.cardKey(c)));

        let displayCards = cards;

        // 理牌模式：选中牌纵向堆叠在左侧
        if (selectedGroup && selectedCards.length > 0) {
            const stackEl = this._createSelectedGroup(selectedCards, selectedKeys, onToggle, levelRank);
            container.appendChild(stackEl);
            displayCards = cards.filter(c => !selectedKeys.has(HandAnalyzer.cardKey(c)));
        }

        const cardW = 72;
        const count = displayCards.length;
        const maxHandW = Math.min(window.innerWidth * 0.55, 950);
        let visible = 32;
        if (count > 1 && maxHandW > cardW) {
            visible = (maxHandW - cardW) / (count - 1);
            visible = Math.max(20, Math.min(visible, cardW - 4));
        }
        const overlap = visible - cardW;
        container.style.setProperty('--card-hand-overlap', overlap + 'px');

        displayCards.forEach((card, i) => {
            const key = HandAnalyzer.cardKey(card);
            const isSelected = selectedKeys.has(key);
            const el = Card.create(card, { selected: isSelected, levelRank });
            el.style.zIndex = i;
            el.addEventListener('click', () => onToggle(card));
            el.classList.add('anim-deal');
            container.appendChild(el);
        });

        if (onToggle) this._setupDragSelect(container, cards, onToggle, onDragStart, onDragEnd);
    },

    /**
     * 创建选中牌的纵向堆叠（理牌按钮触发）
     */
    _createSelectedGroup(selectedCards, selectedKeys, onToggle, levelRank) {
        const wrapper = document.createElement('div');
        wrapper.className = 'card-stack selected-group';

        const cardsEl = document.createElement('div');
        cardsEl.className = 'card-stack-cards';

        selectedCards.forEach((card, i) => {
            const key = HandAnalyzer.cardKey(card);
            const isSelected = selectedKeys.has(key);
            const el = Card.create(card, { selected: isSelected, levelRank });
            if (i > 0) el.classList.add('stack-selected');
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                onToggle(card);
            });
            cardsEl.appendChild(el);
        });

        wrapper.appendChild(cardsEl);
        return wrapper;
    },

    /**
     * 设置拖拽刷选：按住鼠标拖动，经过的牌切换选中状态
     * @param {Function} onDragStart - 拖拽开始时调用
     * @param {Function} onDragEnd - 拖拽结束时调用（传入 changed 的 cards + toggledKey set）
     */
    _setupDragSelect(container, cards, onToggle, onDragStart, onDragEnd) {
        if (container._dragCleanup) container._dragCleanup();

        let dragState = null;
        let suppressClickFlag = false;
        const toggledKeys = new Set();
        const changedCards = [];

        const getCardFromPoint = (e) => {
            const el = document.elementFromPoint(e.clientX, e.clientY);
            if (!el) return null;
            const cardEl = el.closest('.card');
            if (!cardEl || !container.contains(cardEl)) return null;
            return cardEl;
        };

        const onMouseDown = (e) => {
            if (e.button !== 0) return;
            dragState = { dragging: false, startX: e.clientX, startY: e.clientY };
            toggledKeys.clear();
            changedCards.length = 0;
            container.style.userSelect = 'none';
            if (onDragStart) onDragStart();
        };

        const onMouseMove = (e) => {
            if (!dragState) return;
            const dx = e.clientX - dragState.startX;
            const dy = e.clientY - dragState.startY;

            if (!dragState.dragging && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
                dragState.dragging = true;
            }

            if (dragState.dragging) {
                const cardEl = getCardFromPoint(e);
                if (cardEl) {
                    const cardId = cardEl.dataset.cardId;
                    if (cardId && !toggledKeys.has(cardId)) {
                        toggledKeys.add(cardId);
                        const card = cards.find(c => HandAnalyzer.cardKey(c) === cardId);
                        if (card) {
                            onToggle(card);
                            changedCards.push(card);
                            // _toggleCard 中的 _updateCardSelection 已负责 DOM 更新
                        }
                    }
                }
            }
        };

        const onMouseUp = () => {
            if (!dragState) return;
            container.style.userSelect = '';
            const wasDragging = dragState.dragging;
            dragState = null;
            // 只在真正拖动并扫过卡片时才 suppress click 和触发 onDragEnd
            if (wasDragging && changedCards.length > 0) {
                suppressClickFlag = true;
                setTimeout(() => { suppressClickFlag = false; }, 0);
                if (onDragEnd) onDragEnd(changedCards, toggledKeys);
            }
        };

        const suppressClick = (e) => {
            if (suppressClickFlag) {
                e.stopPropagation();
                e.preventDefault();
            }
        };
        container.addEventListener('click', suppressClick, true);

        container.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        container._dragCleanup = () => {
            container.removeEventListener('click', suppressClick, true);
            container.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            container.style.userSelect = '';
            dragState = null;
        };
    },

    /**
     * 渲染理牌模式：竖排堆叠（王牌/炸弹/同花顺） + 单张水平排列
     * 左侧：王牌→级牌→炸弹→同花顺 竖排堆叠
     * 右侧：剩余牌 按花色分组水平排列
     */
    renderArranged(container, arranged, selectedCards, onToggle, onSelectStack, levelRank, onDragStart, onDragEnd) {
        container.innerHTML = '';
        const selectedKeys = new Set(selectedCards.map(c => HandAnalyzer.cardKey(c)));

        if (!arranged || !arranged.items || arranged.items.length === 0) return;

        const cardW = 72;
        const totalItems = arranged.items.length;
        const maxTotalW = Math.min(window.innerWidth * 0.6, 1000);
        let visible = 32;
        if (totalItems > 1 && maxTotalW > cardW) {
            visible = (maxTotalW - cardW) / (totalItems - 1);
            visible = Math.max(18, Math.min(visible, cardW - 4));
        }
        const overlap = visible - cardW;
        container.style.setProperty('--card-hand-overlap', overlap + 'px');

        // 收集所有卡片用于框选
        const allCards = [];
        arranged.items.forEach(item => { allCards.push(...item.cards); });

        let z = 0;
        arranged.items.forEach((item, idx) => {
            let el;
            if (item.type === 'stack') {
                el = this._createStack(item, selectedKeys, onToggle, onSelectStack, levelRank);
            } else {
                // single
                const card = item.cards[0];
                const key = HandAnalyzer.cardKey(card);
                const isSelected = selectedKeys.has(key);
                el = Card.create(card, { selected: isSelected, levelRank });
                el.addEventListener('click', () => onToggle(card));
            }
            el.style.zIndex = z++;
            el.classList.add('anim-deal');
            if (idx === 0) el.style.marginLeft = '0';
            container.appendChild(el);
        });

        // 框选（支持拖拽刷选）
        this._setupDragSelect(container, allCards, onToggle, onDragStart, onDragEnd);
    },

    /**
     * 创建竖排堆叠组
     * 多张牌垂直叠放，下方带标签；不同类型有不同光晕
     */
    _createStack(item, selectedKeys, onToggle, onSelectStack, levelRank) {
        const wrapper = document.createElement('div');
        wrapper.className = 'card-stack';

        // 类别样式
        const clsMap = {
            bomb: 'stack-bomb', straight_flush: 'stack-flush',
            joker: 'stack-joker', wild: 'stack-wild',
        };
        if (clsMap[item.category]) wrapper.classList.add(clsMap[item.category]);

        const cardsEl = document.createElement('div');
        cardsEl.className = 'card-stack-cards';

        const allSelected = item.cards.every(c => selectedKeys.has(HandAnalyzer.cardKey(c)));
        if (allSelected) wrapper.classList.add('selected');

        item.cards.forEach((card, i) => {
            const key = HandAnalyzer.cardKey(card);
            const isSelected = selectedKeys.has(key);
            const opts = { selected: allSelected || isSelected, levelRank };
            if (item.isWild) opts.wild = true;
            const el = Card.create(card, opts);
            if (i > 0) el.classList.add('stacked');
            if (item.isWild) el.classList.add('wild-card');
            else if (item.isBomb || item.isFlush) el.classList.add('level-card');
            // 单击选中/取消单张牌
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                onToggle(card);
            });
            cardsEl.appendChild(el);
        });

        wrapper.appendChild(cardsEl);

        // 标签
        if (item.label) {
            const label = document.createElement('span');
            label.className = 'card-stack-label';
            const lblMap = {
                bomb: 'label-bomb', straight_flush: 'label-flush',
                wild: 'label-wild',
            };
            if (lblMap[item.category]) label.classList.add(lblMap[item.category]);
            label.textContent = item.label;
            // 点击标签全选/取消整组
            label.addEventListener('click', (e) => {
                e.stopPropagation();
                onSelectStack(item.cards);
            });
            wrapper.appendChild(label);
        }

        return wrapper;
    },

    // ──── 其他渲染 ────

    renderBack(container, count, vertical = false) {
        container.innerHTML = '';
        const max = Math.min(count, 14);
        for (let i = 0; i < max; i++) {
            const el = Card.createBack();
            if (vertical) el.classList.add('vertical');
            container.appendChild(el);
        }
    },

    renderPlayed(container, cards, levelRank) {
        container.innerHTML = '';
        if (!cards || cards.length === 0) return;
        cards.forEach(card => {
            const el = Card.create(card, { small: true, display: true, levelRank });
            container.appendChild(el);
        });
    },

    renderTribute(container, cards, onSelect, selectedKey) {
        container.innerHTML = '';
        cards.forEach(card => {
            const key = HandAnalyzer.cardKey(card);
            const el = Card.create(card, { selected: key === selectedKey });
            el.addEventListener('click', () => onSelect(card));
            container.appendChild(el);
        });
    },
};
