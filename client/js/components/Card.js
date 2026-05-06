/**
 * Card 组件 — 创建扑克牌 DOM 元素
 *
 * 服务端 card 格式: { suit: 'spades'|'hearts'|'diamonds'|'clubs', rank: '2'~'A'|'red_joker'|'black_joker' }
 * id 字段可选，用于选牌追踪
 */
const CardComponent = {
    SUIT_NAMES: {
        spades: 'Spade',
        hearts: 'Heart',
        diamonds: 'Diamond',
        clubs: 'Club',
    },

    /**
     * 获取牌面对应的图片路径
     */
    getImagePath(card) {
        if (card.suit === 'joker') {
            return `img/cards/${card.rank === 'red_joker' ? 'JOKER-A' : 'JOKER-B'}.png`;
        }
        const suitName = this.SUIT_NAMES[card.suit] || card.suit;
        return `img/cards/${suitName}${card.rank}.png`;
    },

    /**
     * 创建一张正面牌的 DOM 元素
     * @param {object} card - { suit, rank, id? }
     * @param {object} opts - { selected, small, display, levelRank }
     */
    create(card, opts = {}) {
        const el = document.createElement('div');
        el.className = 'card';

        if (opts.small) el.classList.add('sm');
        if (opts.display) el.classList.add('display');
        if (opts.selected) el.classList.add('selected');
        if (opts.levelRank && card.rank === opts.levelRank && card.suit === 'hearts') {
            el.classList.add('wild-card');
        } else if (opts.levelRank && card.rank === opts.levelRank) {
            el.classList.add('level-card');
        }

        const img = document.createElement('img');
        img.src = this.getImagePath(card);
        img.alt = card.rank;
        img.draggable = false;
        el.appendChild(img);

        // 存储牌标识
        const cardId = card.id || `${card.suit}_${card.rank}_${card.deck ?? ''}`;
        el.dataset.cardId = cardId;
        return el;
    },

    /**
     * 创建一张背面牌
     */
    createBack() {
        const el = document.createElement('div');
        el.className = 'card-back';
        const img = document.createElement('img');
        img.src = 'img/cards/Background.png';
        img.alt = '';
        img.draggable = false;
        el.appendChild(img);
        return el;
    },

    /**
     * 渲染一组正面牌到容器（出牌区展示）
     */
    renderDisplay(container, cards, opts = {}) {
        container.innerHTML = '';
        if (!cards) return;
        cards.forEach(card => {
            const el = this.create(card, { ...opts, display: true });
            container.appendChild(el);
        });
    },

    /**
     * 预加载所有牌面图片到浏览器缓存
     */
    preloadAll() {
        const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
        const suits = ['Spade','Heart','Club','Diamond'];
        const urls = ['img/cards/Background.png', 'img/cards/JOKER-A.png', 'img/cards/JOKER-B.png'];
        suits.forEach(function(s) {
            ranks.forEach(function(r) { urls.push('img/cards/' + s + r + '.png'); });
        });
        urls.forEach(function(src) {
            var img = new Image();
            img.src = src;
        });
    },
};

// 别名，供 Hand.js 使用
const Card = CardComponent;
