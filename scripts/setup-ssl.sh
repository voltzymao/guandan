#!/bin/bash
# ============================================================
# 配置 HTTPS（Let's Encrypt + Certbot）
# 前提：域名已解析到本机 IP，80/443 端口已开放
# 用法：bash scripts/setup-ssl.sh your-domain.com
# ============================================================
set -e

DOMAIN="${1:?请提供域名，用法: bash scripts/setup-ssl.sh your-domain.com}"
EMAIL="${2:-admin@${DOMAIN}}"

echo "=== 安装 Certbot ==="
apt-get update && apt-get install -y certbot

echo "=== 停止 Nginx（释放 80 端口供验证）==="
docker compose stop nginx 2>/dev/null || true

echo "=== 签发证书 ==="
certbot certonly --standalone \
    -d "${DOMAIN}" \
    --email "${EMAIL}" \
    --agree-tos \
    --non-interactive

echo "=== 部署证书到 Nginx ==="
mkdir -p nginx/ssl
cp /etc/letsencrypt/live/${DOMAIN}/fullchain.pem nginx/ssl/fullchain.pem
cp /etc/letsencrypt/live/${DOMAIN}/privkey.pem   nginx/ssl/privkey.pem
chmod 644 nginx/ssl/fullchain.pem
chmod 600 nginx/ssl/privkey.pem

echo "=== 更新 Nginx 配置（启用 HTTPS）==="
sed -i "s/# server_name _;/server_name ${DOMAIN};/" nginx/nginx.conf
# 取消注释 HTTPS 监听
sed -i 's|# listen 443 ssl http2;|listen 443 ssl http2;|' nginx/nginx.conf
sed -i 's|# ssl_certificate|ssl_certificate|' nginx/nginx.conf
sed -i 's|# ssl_certificate_key|ssl_certificate_key|' nginx/nginx.conf
sed -i 's|# ssl_protocols|ssl_protocols|' nginx/nginx.conf
sed -i 's|# ssl_ciphers|ssl_ciphers|' nginx/nginx.conf

echo "=== 更新 .env 的 CLIENT_URL ==="
sed -i "s|CLIENT_URL=.*|CLIENT_URL=https://${DOMAIN}|" .env

echo "=== 重新部署 ==="
bash scripts/deploy.sh

echo "=== 配置证书自动续期（cron 每月一次）==="
CRON_CMD="0 3 1 * * certbot renew --quiet --pre-hook 'cd $(pwd) && docker compose stop nginx' --post-hook 'cd $(pwd) && cp /etc/letsencrypt/live/${DOMAIN}/fullchain.pem nginx/ssl/fullchain.pem && cp /etc/letsencrypt/live/${DOMAIN}/privkey.pem nginx/ssl/privkey.pem && docker compose start nginx'"
(crontab -l 2>/dev/null | grep -v certbot; echo "$CRON_CMD") | crontab -

echo ""
echo "=== SSL 配置完成 ==="
echo "访问地址：https://${DOMAIN}"
