/**
 * API 工具 — 封装 fetch，统一处理 token 和错误
 */
const API_BASE = window.location.origin + '/api';

const api = {
    _token: null,

    setToken(token) {
        this._token = token;
        if (token) localStorage.setItem('gd_token', token);
        else localStorage.removeItem('gd_token');
    },

    getToken() {
        if (!this._token) this._token = localStorage.getItem('gd_token');
        return this._token;
    },

    async _request(method, path, body) {
        const headers = { 'Content-Type': 'application/json' };
        const token = this.getToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const opts = { method, headers };
        if (body) opts.body = JSON.stringify(body);

        const res = await fetch(`${API_BASE}${path}`, opts);
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            const err = new Error(data.error || data.message || `HTTP ${res.status}`);
            err.status = res.status;
            throw err;
        }
        return data;
    },

    get(path) { return this._request('GET', path); },
    post(path, body) { return this._request('POST', path, body); },
    put(path, body) { return this._request('PUT', path, body); },
    delete(path) { return this._request('DELETE', path); },

    // 认证
    login(username, password) { return this.post('/auth/login', { username, password }); },
    register(username, password, email) { return this.post('/auth/register', { username, password, email }); },
    loginGuest() { return this.post('/auth/guest'); },
    getProfile() { return this.get('/auth/me'); },

    // 大厅（房间）
    getRooms() { return this.get('/lobby'); },
    createRoom(name) { return this.post('/lobby', { name }); },
    joinRoom(code) { return this.get(`/lobby/${code}`); }, // 获取房间信息，加入通过 Socket

    // 好友
    searchUsers(q) { return this.get(`/auth/search?q=${encodeURIComponent(q)}`); },
    getFriends() { return this.get('/friends'); },
    addFriend(userId) { return this.post('/friends/request', { userId }); },
    acceptFriend(requestId) { return this.post(`/friends/${requestId}/accept`); },

    // 战绩
    getHistory(page = 1) { return this.get(`/history?page=${page}`); },
    getHistoryDetail(gameId) { return this.get(`/history/${gameId}`); },
    getReplay(gameId) { return this.get(`/replay/${gameId}`); },
    getReplayRound(gameId, roundId) { return this.get(`/replay/${gameId}/${roundId}`); },
};
