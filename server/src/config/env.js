/**
 * 环境变量配置
 * 统一从 process.env 读取，提供类型转换和默认值
 */

// 开发环境自动加载 .env 文件（生产环境由宿主机/容器注入）
if (process.env.NODE_ENV !== 'production') {
    try {
        require('dotenv').config();
    } catch {
        // dotenv 未安装时静默跳过（生产环境不需要）
    }
}

const env = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: parseInt(process.env.PORT, 10) || 3001,
    CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:3000',

    JWT_SECRET: process.env.JWT_SECRET || 'dev_secret_change_in_production',
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',

    DB_PATH: process.env.DB_PATH || '../data/guandan.db',

    RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX, 10) || 200,

    TURN_TIMEOUT: parseInt(process.env.TURN_TIMEOUT, 10) || 30,
    RECONNECT_TIMEOUT: parseInt(process.env.RECONNECT_TIMEOUT, 10) || 60,
    MATCHMAKING_TIMEOUT: parseInt(process.env.MATCHMAKING_TIMEOUT, 10) || 120,

    get isProduction() { return this.NODE_ENV === 'production'; },
    get isDevelopment() { return this.NODE_ENV === 'development'; },
};

// 生产环境强制检查关键配置
if (env.isProduction && env.JWT_SECRET === 'dev_secret_change_in_production') {
    console.error('[Config] 错误：生产环境必须设置 JWT_SECRET 环境变量');
    process.exit(1);
}

module.exports = env;
