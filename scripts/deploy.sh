#!/bin/bash
# ============================================================
# 一键部署/更新掼蛋游戏
# 用法：
#   首次部署：bash scripts/deploy.sh
#   更新重部署：bash scripts/deploy.sh
#   指定域名：CLIENT_URL=https://your-domain.com bash scripts/deploy.sh
# ============================================================
set -e
cd "$(dirname "$0")/.."

echo "=== 检查 Docker ==="
docker compose version &>/dev/null || { echo "请先运行 scripts/setup.sh"; exit 1; }

# ---- 生成 .env ----
if [ ! -f .env ]; then
    JWT_SECRET=$(openssl rand -hex 64)
    CLIENT_URL=${CLIENT_URL:-http://localhost}
    cat > .env <<ENVEOF
JWT_SECRET=${JWT_SECRET}
CLIENT_URL=${CLIENT_URL}
NODE_ENV=production
JWT_EXPIRES_IN=7d
RATE_LIMIT_MAX=200
ENVEOF
    echo "[deploy] .env 已生成（JWT_SECRET 已随机生成）"
else
    echo "[deploy] 使用已有 .env"
fi

# ---- 拉取最新代码 ----
if [ -d .git ]; then
    echo "=== 拉取代码 ==="
    git pull origin main 2>/dev/null || git pull origin master 2>/dev/null || echo "[deploy] git pull 跳过（可能不在分支上）"
fi

# ---- 构建镜像 ----
echo "=== 构建镜像 ==="
docker compose build --pull

# ---- 启动服务 ----
echo "=== 启动服务 ==="
docker compose up -d

# ---- 等待就绪 ----
echo "=== 等待服务就绪 ==="
for i in $(seq 1 12); do
    if curl -sf http://localhost/health >/dev/null 2>&1; then
        echo "[deploy] 服务已就绪"
        break
    fi
    sleep 5
done

# ---- 显示访问地址 ----
IP=$(curl -s --max-time 3 ifconfig.me 2>/dev/null || echo "your-server-ip")
echo ""
echo "========================================"
echo "  部署完成！"
echo "  访问地址：http://${IP}"
echo "  健康检查：http://${IP}/health"
echo "========================================"
