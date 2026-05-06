/**
 * 全局状态存储
 */
const store = {
    user: null,       // { id, username, rating, isGuest }
    room: null,       // { code, name, players, myIndex }
    game: null,       // 当前游戏状态快照
    myHand: [],       // 自己的手牌
    selectedCards: [], // 已选中的牌

    setUser(user) { this.user = user; },
    setRoom(room) { this.room = room; },
    setGame(state) { this.game = state; },
    setHand(cards) { this.myHand = cards; this.selectedCards = []; },

    _cardKey(card) {
        return card.id || `${card.suit}_${card.rank}_${card.deck ?? ''}`;
    },

    toggleCard(card) {
        const key = this._cardKey(card);
        const idx = this.selectedCards.findIndex(c => this._cardKey(c) === key);
        if (idx >= 0) this.selectedCards.splice(idx, 1);
        else this.selectedCards.push(card);
    },

    clearSelection() { this.selectedCards = []; },

    clearUser() { this.user = null; },

    reset() {
        this.room = null;
        this.game = null;
        this.myHand = [];
        this.selectedCards = [];
    },
};
