/**
 * 应用入口 — 视图路由 + 初始化
 */
const App = {
    _views: {
        auth: 'view-auth',
        lobby: 'view-lobby',
        room: 'view-room',
        game: 'view-game',
    },

    init() {
        // 预加载所有牌面图片（异步，不阻塞初始化）
        Card.preloadAll();

        // 初始化各视图
        AuthView.init();
        LobbyView.init();
        RoomView.init();
        GameView.init();

        // 连接状态指示器
        this._initConnectionStatus();

        // 检查本地 token，尝试自动登录
        const token = api.getToken();
        if (token) {
            this._autoLogin(token);
        } else {
            this.showView('auth');
        }

        // 全局错误处理
        socketManager.on('error', (data) => {
            toast.error(data.message || '操作失败');
        });
    },

    _initConnectionStatus() {
        const el = document.getElementById('connection-status');
        const setStatus = (cls, text) => {
            el.className = cls;
            el.textContent = text;
        };
        socketManager.on('connect', () => {
            setStatus('connected', '已连接');
        });
        socketManager.on('disconnect', (reason) => {
            setStatus('disconnected', `连接断开${reason ? ': ' + reason : ''}`);
        });
        socketManager.on('connect_error', () => {
            setStatus('reconnecting', '正在重连...');
        });
    },

    showView(name) {
        Object.entries(this._views).forEach(([key, id]) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (key === name) {
                el.classList.remove('hidden');
                el.classList.add('active');
            } else {
                el.classList.add('hidden');
                el.classList.remove('active');
            }
        });
    },

    async _autoLogin(token) {
        try {
            const data = await api.getProfile();
            store.setUser(data.user);
            this.showView('lobby');
            LobbyView.enter();
        } catch (err) {
            // token 失效，清除并显示登录页
            api.setToken(null);
            this.showView('auth');
        }
    },
};

// DOM 加载完成后启动
document.addEventListener('DOMContentLoaded', () => App.init());
