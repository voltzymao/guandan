/**
 * Socket.IO 事件处理器
 */

const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');
const { GameState, PHASES } = require('../game/GameState');
const LevelManager = require('../game/LevelManager');
const AIPlayer = require('../game/AIPlayer');
const Room = require('../models/Room');
const User = require('../models/User');
const Game = require('../models/Game');
const { TURN_TIMEOUT, RECONNECT_TIMEOUT, MATCHMAKING_TIMEOUT } = require('../config/constants');

// 内存中的游戏状态
const rooms = new Map();        // roomCode -> RoomData
const games = new Map();        // gameId -> GameState
const playerRooms = new Map();  // userId -> roomCode
const turnTimers = new Map();   // gameId -> timer
const reconnectTimers = new Map(); // userId -> timer

// 快速匹配队列
const matchQueue = [];          // [{ userId, username, socketId, rating, joinedAt }]
const matchTimers = new Map();  // userId -> timeout handle

// AI 玩家 ID 前缀（负数，不会与真实用户冲突）
let aiIdCounter = -1;
function newAiId() { return aiIdCounter--; }

const AI_NAMES = ['机器人小明', '机器人小红', '机器人小刚', '机器人小丽'];

function setupSocketHandlers(io) {
    // 认证中间件
    io.use((socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) return next(new Error('未授权'));
        try {
            const payload = jwt.verify(token, JWT_SECRET);
            socket.userId = payload.id;
            socket.username = payload.username;
            next();
        } catch {
            next(new Error('Token无效'));
        }
    });

    io.on('connection', (socket) => {
        console.log(`[Socket] 连接: ${socket.username}(${socket.userId})`);

        // ==================== 房间事件 ====================

        socket.on('room:join', ({ roomCode }) => {
            const code = (roomCode || '').toUpperCase();
            console.log(`[Room] join: ${socket.username} -> ${code}`);
            const dbRoom = Room.findByCode(code);
            if (!dbRoom) {
                socket.emit('error', { message: '房间不存在' });
                return;
            }

            if (!rooms.has(code)) {
                rooms.set(code, {
                    code,
                    hostId: dbRoom.host_id,
                    players: [],
                    gameId: null,
                    status: 'waiting',
                });
            }

            const room = rooms.get(code);

            const existing = room.players.find(p => p.id === socket.userId);
            if (existing) {
                existing.socketId = socket.id;
                existing.connected = true;
                clearReconnectTimer(socket.userId);
            } else {
                const humanCount = room.players.filter(p => !p.isAI).length;
                if (humanCount >= 4) {
                    socket.emit('error', { message: '房间已满' });
                    return;
                }
                // 如果有 AI 占位，替换第一个 AI
                const aiSlot = room.players.findIndex(p => p.isAI);
                const newPlayer = {
                    id: socket.userId,
                    username: socket.username,
                    socketId: socket.id,
                    connected: true,
                    ready: false,
                    isAI: false,
                };
                if (aiSlot !== -1) {
                    room.players.splice(aiSlot, 1, newPlayer);
                } else {
                    if (room.players.length >= 4) {
                        socket.emit('error', { message: '房间已满' });
                        return;
                    }
                    room.players.push(newPlayer);
                }
            }

            playerRooms.set(socket.userId, code);
            socket.join(code);

            if (room.gameId) {
                const gameState = games.get(room.gameId);
                if (gameState) {
                    socket.emit('game:state', gameState.getStateForPlayer(socket.userId));
                }
            }

            io.to(code).emit('room:update', getRoomInfo(code));
        });

        socket.on('room:leave', ({ roomCode }) => {
            const code = (roomCode || '').toUpperCase();
            socket.leave(code);
            handlePlayerLeave(io, socket.userId, code);
        });

        socket.on('room:ready', ({ roomCode, ready }) => {
            const code = (roomCode || '').toUpperCase();
            console.log(`[Room] ready: ${socket.username} ready=${ready} room=${code}`);
            const room = rooms.get(code);
            if (!room) { console.log(`[Room] ready FAIL: room ${code} not in memory`); return; }

            const player = room.players.find(p => p.id === socket.userId);
            if (player) player.ready = !!ready;

            io.to(code).emit('room:update', getRoomInfo(code));

            checkAndStartGame(io, code);
        });

        socket.on('room:kick', ({ roomCode, targetUserId }) => {
            const code = (roomCode || '').toUpperCase();
            const room = rooms.get(code);
            if (!room || room.hostId !== socket.userId) {
                socket.emit('error', { message: '只有房主可以踢人' });
                return;
            }
            handlePlayerLeave(io, targetUserId, code);
            io.to(code).emit('room:kicked', { userId: targetUserId });
        });

        // 房主添加 AI 机器人
        socket.on('room:add_bot', ({ roomCode }) => {
            const code = (roomCode || '').toUpperCase();
            const room = rooms.get(code);
            if (!room) return;
            if (room.hostId !== socket.userId) {
                socket.emit('error', { message: '只有房主可以添加机器人' });
                return;
            }
            if (room.players.length >= 4) {
                socket.emit('error', { message: '房间已满' });
                return;
            }
            if (room.status !== 'waiting') return;

            const aiId = newAiId();
            const aiName = AI_NAMES[(room.players.filter(p => p.isAI).length) % AI_NAMES.length];
            room.players.push({
                id: aiId,
                username: aiName,
                socketId: null,
                connected: true,
                ready: true,
                isAI: true,
            });

            io.to(code).emit('room:update', getRoomInfo(code));
            checkAndStartGame(io, code);
        });

        // 房主移除 AI 机器人
        socket.on('room:remove_bot', ({ roomCode, botId }) => {
            const code = (roomCode || '').toUpperCase();
            const room = rooms.get(code);
            if (!room || room.hostId !== socket.userId) return;
            if (room.status !== 'waiting') return;

            room.players = room.players.filter(p => !(p.isAI && p.id === botId));
            io.to(code).emit('room:update', getRoomInfo(code));
        });

        // ==================== 游戏事件 ====================

        socket.on('game:play', ({ gameId, cards }) => {
            handlePlay(io, socket, gameId, socket.userId, cards || []);
        });

        socket.on('game:pass', ({ gameId }) => {
            handlePlay(io, socket, gameId, socket.userId, []);
        });

        socket.on('game:tribute', ({ gameId, card }) => {
            handleTribute(io, socket, gameId, socket.userId, card);
        });

        socket.on('game:return_tribute', ({ gameId, card }) => {
            handleReturnTribute(io, socket, gameId, socket.userId, card);
        });

        socket.on('game:request_state', ({ gameId }) => {
            const gameState = games.get(gameId);
            if (gameState) {
                socket.emit('game:state', gameState.getStateForPlayer(socket.userId));
            }
        });

        socket.on('game:hint', ({ gameId }) => {
            const gameState = games.get(gameId);
            if (!gameState || gameState.currentPlayer !== socket.userId) return;
            const suggested = AIPlayer.suggest(gameState, socket.userId);
            socket.emit('game:hint', { cards: suggested });
        });

        // ==================== 聊天 ====================

        socket.on('chat:message', ({ roomCode, message }) => {
            if (!message || !message.trim()) return;
            const code = (roomCode || '').toUpperCase();
            io.to(code).emit('chat:message', {
                userId: socket.userId,
                username: socket.username,
                message: message.trim().slice(0, 200),
                timestamp: Date.now(),
            });
        });

        // ==================== 快速匹配 ====================

        socket.on('matchmaking:join', () => {
            if (playerRooms.has(socket.userId)) {
                socket.emit('error', { message: '请先离开当前房间再匹配' });
                return;
            }
            if (matchQueue.some(p => p.userId === socket.userId)) return;

            const stats = User.getStats(socket.userId);
            matchQueue.push({
                userId: socket.userId,
                username: socket.username,
                socketId: socket.id,
                rating: stats ? stats.rating : 1000,
                joinedAt: Date.now(),
            });

            socket.emit('matchmaking:queued', { position: matchQueue.length });
            console.log(`[Matchmaking] ${socket.username} 加入队列，当前 ${matchQueue.length} 人`);

            const timer = setTimeout(() => {
                removeFromQueue(socket.userId);
                socket.emit('matchmaking:timeout');
            }, MATCHMAKING_TIMEOUT * 1000);
            matchTimers.set(socket.userId, timer);

            tryMatch(io);
        });

        socket.on('matchmaking:cancel', () => {
            removeFromQueue(socket.userId);
            socket.emit('matchmaking:cancelled');
        });

        // ==================== 断线 ====================

        socket.on('disconnect', () => {
            console.log(`[Socket] 断线: ${socket.username}(${socket.userId})`);

            removeFromQueue(socket.userId);

            const roomCode = playerRooms.get(socket.userId);
            if (!roomCode) return;

            const room = rooms.get(roomCode);
            if (!room) return;

            const player = room.players.find(p => p.id === socket.userId);
            if (player) player.connected = false;

            io.to(roomCode).emit('room:player_disconnected', { userId: socket.userId });

            // 如果断线玩家是房间最后一个真人，立即清理（无需等待重连）
            const otherHumans = room.players.filter(p => !p.isAI && p.id !== socket.userId);
            if (otherHumans.length === 0) {
                handlePlayerLeave(io, socket.userId, roomCode);
                return;
            }

            const timer = setTimeout(() => {
                handlePlayerLeave(io, socket.userId, roomCode);
            }, RECONNECT_TIMEOUT * 1000);
            reconnectTimers.set(socket.userId, timer);
        });
    });
}

// ==================== 游戏逻辑 ====================

function checkAndStartGame(io, roomCode) {
    const room = rooms.get(roomCode);
    if (!room) { console.log(`[Game] checkStart FAIL: room ${roomCode} not found`); return; }
    if (room.status !== 'waiting') { console.log(`[Game] checkStart FAIL: status=${room.status}`); return; }
    if (room.players.length !== 4) { console.log(`[Game] checkStart FAIL: players=${room.players.length}, ready=${room.players.map(p=>p.ready)}`); return; }
    if (!room.players.every(p => p.ready || p.isAI)) { console.log(`[Game] checkStart FAIL: not all ready`); return; }
    console.log(`[Game] checkStart OK -> starting game in room ${roomCode}`);
    startGame(io, roomCode);
}

async function startGame(io, roomCode) {
    console.log(`[Game] startGame: ${roomCode}`);
    const room = rooms.get(roomCode);
    if (!room || room.players.length !== 4) { console.log(`[Game] startGame FAIL: room or players invalid`); return; }

    room.status = 'playing';

    const playerIds = room.players.map(p => p.id);
    const teams = {
        teamA: [playerIds[0], playerIds[2]],
        teamB: [playerIds[1], playerIds[3]],
    };

    const dbRoom = Room.findByCode(roomCode);
    const gameId = Game.create({
        roomId: dbRoom ? dbRoom.id : null,
        teamAIds: teams.teamA,
        teamBIds: teams.teamB,
    });

    for (const [i, player] of room.players.entries()) {
        if (player.isAI) continue; // AI 不记录到 DB
        const stats = User.getStats(player.id);
        Game.addParticipant({
            gameId,
            userId: player.id,
            team: i % 2 === 0 ? 1 : 2,
            ratingBefore: stats ? stats.rating : 1000,
        });
    }

    room.gameId = gameId;

    const playerMeta = {};
    for (const p of room.players) {
        playerMeta[p.id] = { username: p.username, isAI: p.isAI };
    }

    const gameState = new GameState({ gameId, players: playerIds, teams, playerMeta });
    gameState.startRound();
    games.set(gameId, gameState);

    io.to(roomCode).emit('game:start', { gameId, teams });

    for (const player of room.players) {
        if (player.isAI) continue;
        const playerSocket = io.sockets.sockets.get(player.socketId);
        if (playerSocket) {
            playerSocket.emit('game:state', gameState.getStateForPlayer(player.id));
        }
    }

    if (gameState.phase === PHASES.TRIBUTE || gameState.phase === PHASES.RETURN_TRIBUTE) {
        scheduleAITribute(io, gameId, roomCode, gameState);
    } else if (isAIPlayer(roomCode, gameState.currentPlayer)) {
        scheduleAIPlay(io, gameId, roomCode, gameState);
    } else {
        startTurnTimer(io, gameId, roomCode, gameState.currentPlayer);
    }
}

function handlePlay(io, socket, gameId, userId, cards) {
    const gameState = games.get(gameId);
    if (!gameState) {
        socket.emit('error', { message: '游戏不存在' });
        return;
    }

    const result = gameState.playCards(userId, cards);
    if (!result.success) {
        socket.emit('error', { message: result.error });
        return;
    }

    const roomCode = getRoomCodeByGameId(gameId);
    if (!roomCode) return;

    for (const event of result.events) {
        io.to(roomCode).emit(`game:${event.type}`, event);
    }

    broadcastState(io, roomCode, gameState);
    afterPlay(io, gameId, roomCode, gameState);
}

function afterPlay(io, gameId, roomCode, gameState) {
    if (gameState.phase === PHASES.GAME_END) {
        handleGameEnd(io, gameId, roomCode, gameState);
        return;
    }
    if (gameState.phase === PHASES.ROUND_END) {
        handleRoundEnd(io, gameId, roomCode, gameState);
        return;
    }

    clearTurnTimer(gameId);

    // 如果下一个是 AI，立即调度 AI 出牌
    if (isAIPlayer(roomCode, gameState.currentPlayer)) {
        scheduleAIPlay(io, gameId, roomCode, gameState);
    } else {
        startTurnTimer(io, gameId, roomCode, gameState.currentPlayer);
    }
}

function handleTribute(io, socket, gameId, userId, card) {
    const gameState = games.get(gameId);
    if (!gameState) return;

    const result = gameState.tribute(userId, card);
    if (!result.success) {
        socket.emit('error', { message: result.error });
        return;
    }

    const roomCode = getRoomCodeByGameId(gameId);
    if (!roomCode) return;

    io.to(roomCode).emit('game:tribute_completed', { userId });
    broadcastState(io, roomCode, gameState);

    if (gameState.phase === PHASES.RETURN_TRIBUTE) {
        scheduleAITribute(io, gameId, roomCode, gameState);
    } else if (gameState.phase === PHASES.TRIBUTE) {
        scheduleAITribute(io, gameId, roomCode, gameState);
    }
}

function handleReturnTribute(io, socket, gameId, userId, card) {
    const gameState = games.get(gameId);
    if (!gameState) return;

    const result = gameState.returnTribute(userId, card);
    if (!result.success) {
        socket.emit('error', { message: result.error });
        return;
    }

    const roomCode = getRoomCodeByGameId(gameId);
    if (!roomCode) return;

    io.to(roomCode).emit('game:tribute_returned', { userId });
    broadcastState(io, roomCode, gameState);

    if (gameState.phase === PHASES.PLAYING) {
        if (isAIPlayer(roomCode, gameState.currentPlayer)) {
            scheduleAIPlay(io, gameId, roomCode, gameState);
        } else {
            startTurnTimer(io, gameId, roomCode, gameState.currentPlayer);
        }
    } else if (gameState.phase === PHASES.RETURN_TRIBUTE) {
        scheduleAITribute(io, gameId, roomCode, gameState);
    }
}

function handleRoundEnd(io, gameId, roomCode, gameState) {
    clearTurnTimer(gameId);

    Game.saveRound({
        gameId,
        roundNumber: gameState.roundNumber,
        finishOrder: gameState.finishOrder,
        moveSequence: gameState.moveHistory,
        initialHands: gameState.initialHands,
        teamALevel: gameState.teamALevel,
        teamBLevel: gameState.teamBLevel,
    });

    setTimeout(() => {
        const room = rooms.get(roomCode);
        if (!room) return;

        const newGameState = new GameState({
            gameId,
            players: gameState.players,
            teams: gameState.teams,
            playerMeta: gameState.playerMeta,
            teamALevel: gameState.teamALevel,
            teamBLevel: gameState.teamBLevel,
            roundNumber: gameState.roundNumber + 1,
            lastFinishOrder: gameState.finishOrder,
        });

        newGameState.startRound();
        games.set(gameId, newGameState);

        io.to(roomCode).emit('game:new_round', {
            roundNumber: newGameState.roundNumber,
            teamALevel: newGameState.teamALevel,
            teamBLevel: newGameState.teamBLevel,
        });

        broadcastState(io, roomCode, newGameState);

        if (newGameState.phase === PHASES.TRIBUTE || newGameState.phase === PHASES.RETURN_TRIBUTE) {
            scheduleAITribute(io, gameId, roomCode, newGameState);
        } else {
            if (isAIPlayer(roomCode, newGameState.currentPlayer)) {
                scheduleAIPlay(io, gameId, roomCode, newGameState);
            } else {
                startTurnTimer(io, gameId, roomCode, newGameState.currentPlayer);
            }
        }
    }, 3000);
}

function handleGameEnd(io, gameId, roomCode, gameState) {
    clearTurnTimer(gameId);

    const levelResult = LevelManager.calculateLevelChange(
        gameState.finishOrder,
        gameState.teams,
        gameState.teamALevel,
        gameState.teamBLevel
    );

    Game.updateStatus(gameId, 'finished', {
        winnerTeam: levelResult.winnerTeam === 'A' ? 1 : 2,
        finishedAt: true,
    });

    const room = rooms.get(roomCode);
    if (room) {
        for (const player of room.players) {
            if (player.isAI) continue;
            const isWinner = gameState.teams[levelResult.winnerTeam === 'A' ? 'teamA' : 'teamB'].includes(player.id);
            const ratingDelta = isWinner ? 20 : -15;
            const stats = User.getStats(player.id);
            if (stats) {
                User.updateStats(player.id, {
                    games_played: stats.games_played + 1,
                    games_won: stats.games_won + (isWinner ? 1 : 0),
                    rating: Math.max(0, stats.rating + ratingDelta),
                });
            }
        }
    }

    io.to(roomCode).emit('game:end', {
        winnerTeam: levelResult.winnerTeam,
        finishOrder: gameState.finishOrder,
    });

    games.delete(gameId);
    if (room) {
        room.gameId = null;
        room.status = 'waiting';
        room.players.forEach(p => { p.ready = false; });
    }
}

// ==================== AI 调度 ====================

function isAIPlayer(roomCode, userId) {
    const room = rooms.get(roomCode);
    if (!room) return false;
    const player = room.players.find(p => p.id === userId);
    return player ? player.isAI : false;
}

/**
 * 延迟 1~2 秒后执行 AI 出牌，模拟思考
 */
function scheduleAIPlay(io, gameId, roomCode, gameState) {
    const currentPlayer = gameState.currentPlayer;
    const delay = 800 + Math.random() * 1200; // 0.8~2s

    const timer = setTimeout(() => {
        const gs = games.get(gameId);
        if (!gs || gs.currentPlayer !== currentPlayer) return;
        if (!isAIPlayer(roomCode, currentPlayer)) return;

        const cards = AIPlayer.decidePlay(gs, currentPlayer);
        const result = gs.playCards(currentPlayer, cards || []);

        if (result.success) {
            for (const event of result.events) {
                io.to(roomCode).emit(`game:${event.type}`, event);
            }
            broadcastState(io, roomCode, gs);
            afterPlay(io, gameId, roomCode, gs);
        } else {
            // 出牌失败则过牌
            const passResult = gs.playCards(currentPlayer, []);
            if (passResult.success) {
                for (const event of passResult.events) {
                    io.to(roomCode).emit(`game:${event.type}`, event);
                }
                broadcastState(io, roomCode, gs);
                afterPlay(io, gameId, roomCode, gs);
            }
        }
    }, delay);

    turnTimers.set(gameId, timer);
}

/**
 * 处理 AI 的进贡/还贡
 */
function scheduleAITribute(io, gameId, roomCode, gameState) {
    if (gameState.phase === PHASES.TRIBUTE) {
        // AI 进贡：自动选最大牌
        for (const [tributerId, card] of Object.entries(gameState.pendingTributes)) {
            if (card !== null) continue;
            const tribId = Number(tributerId);
            if (!isAIPlayer(roomCode, tribId)) continue;

            setTimeout(() => {
                const gs = games.get(gameId);
                if (!gs || gs.phase !== PHASES.TRIBUTE) return;
                if (gs.pendingTributes[tribId] !== null) return;

                const tributeCard = AIPlayer.decideTribute(gs.hands[tribId]);
                const result = gs.tribute(tribId, tributeCard);

                if (result.success) {
                    io.to(roomCode).emit('game:tribute_completed', { userId: tribId });
                    broadcastState(io, roomCode, gs);

                    if (gs.phase === PHASES.RETURN_TRIBUTE) {
                        scheduleAITribute(io, gameId, roomCode, gs);
                    } else if (gs.phase === PHASES.TRIBUTE) {
                        scheduleAITribute(io, gameId, roomCode, gs);
                    }
                }
            }, 600 + Math.random() * 800);
        }
    }

    if (gameState.phase === PHASES.RETURN_TRIBUTE) {
        // 找出需要还贡的 AI
        for (const [returnerId, card] of Object.entries(gameState.pendingReturns)) {
            if (card !== null) continue; // 已还贡
            const retId = Number(returnerId);
            if (!isAIPlayer(roomCode, retId)) continue;

            setTimeout(() => {
                const gs = games.get(gameId);
                if (!gs || gs.phase !== PHASES.RETURN_TRIBUTE) return;
                if (gs.pendingReturns[retId] !== null) return;

                const wildRank = gs.getPlayerWildRank(retId);
                const returnCard = AIPlayer.decideReturnTribute(gs.hands[retId], wildRank);
                const result = gs.returnTribute(retId, returnCard);

                if (result.success) {
                    io.to(roomCode).emit('game:tribute_returned', { userId: retId });
                    broadcastState(io, roomCode, gs);

                    if (gs.phase === PHASES.PLAYING) {
                        if (isAIPlayer(roomCode, gs.currentPlayer)) {
                            scheduleAIPlay(io, gameId, roomCode, gs);
                        } else {
                            startTurnTimer(io, gameId, roomCode, gs.currentPlayer);
                        }
                    } else if (gs.phase === PHASES.RETURN_TRIBUTE) {
                        scheduleAITribute(io, gameId, roomCode, gs);
                    }
                }
            }, 600 + Math.random() * 800);
        }
    }
}

// ==================== 辅助函数 ====================

function broadcastState(io, roomCode, gameState) {
    const room = rooms.get(roomCode);
    if (!room) return;
    for (const player of room.players) {
        if (player.isAI) continue;
        const playerSocket = io.sockets.sockets.get(player.socketId);
        if (playerSocket) {
            playerSocket.emit('game:state', gameState.getStateForPlayer(player.id));
        }
    }
}

function startTurnTimer(io, gameId, roomCode, currentPlayer) {
    clearTurnTimer(gameId);
    const timer = setTimeout(() => {
        const gameState = games.get(gameId);
        if (!gameState || gameState.currentPlayer !== currentPlayer) return;

        const result = gameState.playCards(currentPlayer, []);
        if (result.success) {
            for (const event of result.events) {
                io.to(roomCode).emit(`game:${event.type}`, event);
            }
            broadcastState(io, roomCode, gameState);
            afterPlay(io, gameId, roomCode, gameState);
        }
    }, TURN_TIMEOUT * 1000);
    turnTimers.set(gameId, timer);
}

function clearTurnTimer(gameId) {
    const timer = turnTimers.get(gameId);
    if (timer) {
        clearTimeout(timer);
        turnTimers.delete(gameId);
    }
}

function clearReconnectTimer(userId) {
    const timer = reconnectTimers.get(userId);
    if (timer) {
        clearTimeout(timer);
        reconnectTimers.delete(userId);
    }
}

function handlePlayerLeave(io, userId, roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;

    playerRooms.delete(userId);
    clearReconnectTimer(userId);

    if (room.gameId) {
        const gameState = games.get(room.gameId);
        if (gameState) {
            io.to(roomCode).emit('game:abandoned', { reason: '玩家离开' });
            clearTurnTimer(room.gameId);
            games.delete(room.gameId);
            Game.updateStatus(room.gameId, 'abandoned');
        }
    }

    room.players = room.players.filter(p => p.id !== userId);

    if (room.players.filter(p => !p.isAI).length === 0) {
        // 没有真实玩家了，销毁房间
        rooms.delete(roomCode);
        const dbRoom = Room.findByCode(roomCode);
        if (dbRoom) Room.delete(dbRoom.id);
        console.log(`[Room] 房间 ${roomCode} 已销毁（无玩家）`);
        return;
    }

    // 转移房主
    if (room.hostId === userId) {
        const nextHuman = room.players.find(p => !p.isAI);
        if (nextHuman) room.hostId = nextHuman.id;
    }

    io.to(roomCode).emit('room:update', getRoomInfo(roomCode));
}

// ==================== 快速匹配 ====================

function removeFromQueue(userId) {
    const idx = matchQueue.findIndex(p => p.userId === userId);
    if (idx >= 0) matchQueue.splice(idx, 1);
    const timer = matchTimers.get(userId);
    if (timer) {
        clearTimeout(timer);
        matchTimers.delete(userId);
    }
}

async function tryMatch(io) {
    if (matchQueue.length < 4) return;

    const matched = matchQueue.splice(0, 4);
    matched.forEach(p => {
        const timer = matchTimers.get(p.userId);
        if (timer) { clearTimeout(timer); matchTimers.delete(p.userId); }
    });

    console.log(`[Matchmaking] 凑局成功: ${matched.map(p => p.username).join(', ')}`);

    const roomCode = 'MM' + Date.now().toString(36).toUpperCase().slice(-4);
    const playerIds = matched.map(p => p.userId);
    const teams = {
        teamA: [playerIds[0], playerIds[2]],
        teamB: [playerIds[1], playerIds[3]],
    };

    rooms.set(roomCode, {
        code: roomCode,
        hostId: playerIds[0],
        players: matched.map(p => ({
            id: p.userId,
            username: p.username,
            socketId: p.socketId,
            connected: true,
            ready: true,
            isAI: false,
        })),
        gameId: null,
        status: 'waiting',
        isMatchmade: true,
    });

    for (const p of matched) {
        const sock = io.sockets.sockets.get(p.socketId);
        if (sock) {
            sock.join(roomCode);
            playerRooms.set(p.userId, roomCode);
        }
    }

    io.to(roomCode).emit('matchmaking:found', {
        roomCode,
        players: matched.map(p => ({ id: p.userId, username: p.username })),
    });

    setTimeout(() => startGame(io, roomCode), 2000);
}

function getRoomInfo(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return null;
    return {
        code: room.code,
        hostId: room.hostId,
        players: room.players.map(p => ({
            id: p.id,
            username: p.username,
            connected: p.connected,
            ready: p.ready,
            isAI: p.isAI || false,
        })),
        status: room.status,
    };
}

function getRoomCodeByGameId(gameId) {
    for (const [code, room] of rooms.entries()) {
        if (room.gameId === gameId) return code;
    }
    return null;
}

module.exports = { setupSocketHandlers };
