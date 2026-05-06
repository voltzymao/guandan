// 游戏常量定义

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// 牌面大小顺序（索引越大越大）
const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// 等级顺序
const LEVELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// 牌型枚举
const HAND_TYPES = {
    SINGLE: 'single',
    PAIR: 'pair',
    TRIPLE: 'triple',
    STRAIGHT: 'straight',
    FLUSH_PAIR: 'flush_pair',       // 连对
    FULL_HOUSE: 'full_house',       // 三带二
    BOMB: 'bomb',
    STRAIGHT_FLUSH: 'straight_flush',
    JOKER_BOMB: 'joker_bomb',
};

// 游戏阶段
const GAME_PHASES = {
    WAITING: 'waiting',
    DEALING: 'dealing',
    TRIBUTE: 'tribute',
    RETURN_TRIBUTE: 'return_tribute',
    PLAYING: 'playing',
    ROUND_END: 'round_end',
    GAME_END: 'game_end',
};

// 段位
const RANK_TIERS = [
    { name: 'bronze', label: '青铜', minRating: 0 },
    { name: 'silver', label: '白银', minRating: 1200 },
    { name: 'gold', label: '黄金', minRating: 1500 },
    { name: 'diamond', label: '钻石', minRating: 1800 },
    { name: 'master', label: '大师', minRating: 2100 },
];

// 出牌超时时间（秒）
const TURN_TIMEOUT = 30;

// 断线重连等待时间（秒）
const RECONNECT_TIMEOUT = 60;

// 快速匹配等待时间（秒）
const MATCHMAKING_TIMEOUT = 120;

module.exports = {
    SUITS,
    RANKS,
    RANK_ORDER,
    LEVELS,
    HAND_TYPES,
    GAME_PHASES,
    RANK_TIERS,
    TURN_TIMEOUT,
    RECONNECT_TIMEOUT,
    MATCHMAKING_TIMEOUT,
};
