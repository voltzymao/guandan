# ============================================================
# 掼蛋游戏服务端 Dockerfile
# 多阶段构建：builder 安装依赖，runner 运行服务
# ============================================================

# ---- 依赖安装阶段 ----
FROM node:20-alpine AS builder

WORKDIR /app/server

# 先复制 package 文件，利用 Docker 层缓存
COPY server/package*.json ./

# 只安装生产依赖（better-sqlite3 需要编译，alpine 需要 python3/make/g++）
RUN apk add --no-cache python3 make g++ \
    && npm ci --omit=dev

# ---- 运行阶段 ----
FROM node:20-alpine AS runner

# 创建非 root 用户
RUN addgroup -S guandan && adduser -S guandan -G guandan

WORKDIR /app

# 从 builder 复制依赖
COPY --from=builder /app/server/node_modules ./server/node_modules

# 复制源码
COPY server/src ./server/src
COPY server/migrations ./server/migrations
COPY server/package.json ./server/package.json

# 复制前端静态文件
COPY client ./client

# 创建数据目录并设置权限（/data 挂载 volume 给 SQLite 用）
RUN mkdir -p /data && chown -R guandan:guandan /app /data

USER guandan

# 数据库文件挂载点
VOLUME ["/data"]

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health',r=>{process.exit(r.statusCode===200?0:1)})"

CMD ["node", "server/src/index.js"]
