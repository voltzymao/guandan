# 掼蛋 Online

基于 Node.js + Socket.IO 的网络掼蛋游戏，支持 4 人实时对战、快速匹配、好友系统和对局回放。

## 功能特性

- **实时对战** — Socket.IO 驱动，延迟低，断线自动重连
- **完整规则** — 单张、对子、三张、顺子、连对、三带二、炸弹、同花顺、天王炸
- **等级系统** — 2 → A 升级，双升、四升等特殊规则
- **进贡/还贡** — 上局输家向赢家进贡，支持抗贡
- **快速匹配** — 自动凑 4 人开局，120 秒超时
- **好友系统** — 添加好友、查看在线状态、邀请入房
- **战绩回放** — 逐步回放每局每轮出牌记录
- **积分排名** — ELO 风格积分，青铜→大师段位

## 技术栈

| 层 | 技术 |
|---|---|
| 服务端 | Node.js 20, Express 4, Socket.IO 4 |
| 数据库 | SQLite (better-sqlite3) |
| 认证 | JWT + bcryptjs |
| 前端 | 原生 HTML/CSS/JS（无框架） |
| 部署 | Docker + Nginx |

## 目录结构

```
guandan/
├── client/                 # 前端静态文件
│   ├── index.html
│   ├── css/
│   └── js/
│       ├── views/          # 页面视图（auth, lobby, room, game）
│       ├── components/     # 可复用组件（Card, Hand, Timer）
│       └── utils/          # 工具（api, socket, store, toast）
├── server/                 # 服务端
│   ├── src/
│   │   ├── config/         # 数据库、环境变量配置
│   │   ├── models/         # 数据模型（User, Room, Game, Friend）
│   │   ├── routes/         # REST API 路由
│   │   ├── middleware/     # 认证、错误处理中间件
│   │   ├── socket/         # Socket.IO 事件处理
│   │   └── game/           # 游戏引擎（发牌、牌型判断、出牌逻辑）
│   ├── migrations/         # SQL 迁移脚本
│   └── package.json
├── data/                   # SQLite 数据库文件（不提交到 git）
├── nginx/                  # Nginx 配置
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## 快速开始

### 本地开发

**前置要求：** Node.js 18+

```bash
# 1. 克隆项目
git clone <repo-url>
cd guandan

# 2. 安装服务端依赖
cd server
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，至少设置 JWT_SECRET

# 4. 启动开发服务器（含热重载）
npm run dev
```

服务器启动后：
- API 服务：`http://localhost:3001`
- 前端页面：用浏览器直接打开 `client/index.html`，或配置 `CLIENT_URL=http://localhost:3000` 后用任意静态服务器 serve `client/` 目录

### Docker 部署

```bash
# 1. 复制并填写环境变量
cp server/.env.example .env
# 必须设置：JWT_SECRET（生产环境用随机长字符串）
# 可选设置：CLIENT_URL（你的域名）

# 2. 构建并启动
docker compose up -d

# 3. 查看日志
docker compose logs -f server
```

服务启动后访问 `http://your-server-ip`。

### 生成 JWT_SECRET

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `NODE_ENV` | `development` | 运行环境 |
| `PORT` | `3001` | 服务端口 |
| `CLIENT_URL` | `http://localhost:3000` | 前端地址（CORS 白名单） |
| `JWT_SECRET` | — | **必填**，生产环境必须设置 |
| `JWT_EXPIRES_IN` | `7d` | Token 有效期 |
| `DB_PATH` | `../data/guandan.db` | 数据库文件路径 |
| `RATE_LIMIT_MAX` | `200` | 每 15 分钟最大 API 请求数 |
| `TURN_TIMEOUT` | `30` | 出牌超时（秒） |
| `RECONNECT_TIMEOUT` | `60` | 断线重连等待（秒） |
| `MATCHMAKING_TIMEOUT` | `120` | 快速匹配超时（秒） |

## API 文档

详见 [docs/API.md](docs/API.md)。

## Socket.IO 事件

详见 [docs/SOCKET.md](docs/SOCKET.md)。

## 数据库

使用 SQLite，首次启动自动执行 `migrations/001_schema.sql` 建表。

主要表：`users`、`user_stats`、`rooms`、`games`、`game_rounds`、`game_participants`、`friendships`

## 部署说明

### Nginx + SSL

1. 将 SSL 证书放到 `nginx/ssl/fullchain.pem` 和 `nginx/ssl/privkey.pem`
2. 编辑 `nginx/nginx.conf`，取消 HTTPS 相关注释，填写域名
3. `docker compose up -d`

### 数据持久化

数据库文件通过 Docker volume `guandan-data` 持久化到 `/app/data/guandan.db`。备份命令：

```bash
docker compose exec server sqlite3 /app/data/guandan.db ".backup /app/data/backup.db"
docker compose cp server:/app/data/backup.db ./backup.db
```

## 开发脚本

```bash
# 开发模式（nodemon 热重载）
npm run dev

# 生产模式
npm start

# 手动执行数据库迁移
npm run migrate
```
