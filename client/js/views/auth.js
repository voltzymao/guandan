/**
 * 认证视图 — 登录 / 注册 / 游客
 */
const AuthView = {
    init() {
        // Tab 切换
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => this._switchTab(tab.dataset.tab));
        });

        // 登录表单
        document.getElementById('form-login').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this._login();
        });

        // 注册表单
        document.getElementById('form-register').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this._register();
        });

        // 游客登录
        document.getElementById('btn-guest').addEventListener('click', () => this._loginGuest());
    },

    _switchTab(tab) {
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        document.getElementById('form-login').classList.toggle('hidden', tab !== 'login');
        document.getElementById('form-register').classList.toggle('hidden', tab !== 'register');
        this._clearError();
    },

    _showError(msg) {
        const el = document.getElementById('auth-error');
        el.textContent = msg;
        el.classList.remove('hidden');
    },

    _clearError() {
        document.getElementById('auth-error').classList.add('hidden');
    },

    async _login() {
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;
        if (!username || !password) return this._showError('请填写用户名和密码');

        try {
            const data = await api.login(username, password);
            api.setToken(data.token);
            store.setUser(data.user);
            App.showView('lobby');
            LobbyView.enter();
        } catch (err) {
            this._showError(err.message || '登录失败');
        }
    },

    async _register() {
        const username = document.getElementById('reg-username').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-password').value;

        if (!username || !password) return this._showError('请填写用户名和密码');
        if (username.length < 3) return this._showError('用户名至少3位');
        if (password.length < 6) return this._showError('密码至少6位');

        try {
            const data = await api.register(username, password, email || undefined);
            api.setToken(data.token);
            store.setUser(data.user);
            App.showView('lobby');
            LobbyView.enter();
        } catch (err) {
            this._showError(err.message || '注册失败');
        }
    },

    async _loginGuest() {
        try {
            const data = await api.loginGuest();
            api.setToken(data.token);
            store.setUser(data.user);
            App.showView('lobby');
            LobbyView.enter();
        } catch (err) {
            this._showError(err.message || '游客登录失败');
        }
    },
};
