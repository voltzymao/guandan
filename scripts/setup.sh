#!/bin/bash
# ============================================================
# VPS 首次初始化：安装 Docker + 配置防火墙 + 设置 swap
# 适用：Ubuntu 20.04+ / Debian 11+
# 用法：bash scripts/setup.sh
# ============================================================
set -e

echo "=== 更新系统包 ==="
apt-get update && apt-get upgrade -y

echo "=== 安装基础工具 ==="
apt-get install -y curl ufw git

echo "=== 安装 Docker ==="
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
fi
docker --version

echo "=== 安装 Docker Compose ==="
if ! docker compose version &>/dev/null; then
    apt-get install -y docker-compose-plugin
fi
docker compose version

echo "=== 配置防火墙 ==="
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose

echo "=== 配置 swap（2GB）==="
if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "swap 已创建"
fi

echo ""
echo "=== 初始化完成 ==="
echo "下一步：bash scripts/deploy.sh"
