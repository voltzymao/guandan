/**
 * Timer 组件 — 出牌倒计时条
 */
const Timer = {
    _interval: null,
    _remaining: 0,
    _total: 0,

    /**
     * 启动计时条
     * @param {number} seconds - 总秒数
     * @param {Function} onExpire - 超时回调
     */
    start(seconds, onExpire) {
        this.stop();
        this._total = seconds;
        this._remaining = seconds;

        const bar = document.getElementById('turn-timer-bar');
        const fill = document.getElementById('turn-timer-fill');
        if (!bar || !fill) return;

        bar.classList.remove('hidden');
        fill.style.width = '100%';
        fill.className = '';

        this._interval = setInterval(() => {
            this._remaining--;
            const pct = (this._remaining / this._total) * 100;
            fill.style.width = `${Math.max(0, pct)}%`;

            if (pct <= 30) fill.className = 'danger';
            else if (pct <= 60) fill.className = 'warning';

            if (this._remaining <= 0) {
                this.stop();
                if (onExpire) onExpire();
            }
        }, 1000);
    },

    stop() {
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
        const bar = document.getElementById('turn-timer-bar');
        const fill = document.getElementById('turn-timer-fill');
        if (bar) bar.classList.add('hidden');
        if (fill) { fill.style.width = '0%'; fill.className = ''; }
    },

    reset() {
        this.stop();
    },
};
