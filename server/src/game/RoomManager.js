/**
 * RoomManager - 内存中的房间状态管理
 * 管理等待中的房间和玩家连接
 */

class RoomManager {
    constructor() {
        // roomCode -> RoomState
        this.rooms = new Map();
        // userId -> socketId
        this.userSockets = new Map();
        // socketId -> userId
        this.socketUsers = new Map();
    }

    registerSocket(userId, socketId) {
        const oldSocketId = this.userSockets.get(userId);
        if (oldSocketId && oldSocketId !== socketId) {
            this.socketUsers.delete(oldSocketId);
        }
        this.userSockets.set(userId, socketId);
        this.socketUsers.set(socketId, userId);
    }

    unregisterSocket(socketId) {
        const userId = this.socketUsers.get(socketId);
        if (userId) {
            this.userSockets.delete(userId);
            this.socketUsers.delete(socketId);
        }
        return userId;
    }

    getSocketId(userId) {
        return this.userSockets.get(userId);
    }

    getUserId(socketId) {
        return this.socketUsers.get(socketId);
    }

    createRoom(roomCode, hostId, hostName) {
        const room = {
            code: roomCode,
            hostId,
            players: [{ id: hostId, name: hostName, ready: false, seat: 0 }],
            status: 'waiting',
            createdAt: Date.now(),
        };
        this.rooms.set(roomCode, room);
        return room;
    }

    getRoom(roomCode) {
        return this.rooms.get(roomCode);
    }

    joinRoom(roomCode, userId, username) {
        const room = this.rooms.get(roomCode);
        if (!room) return { success: false, error: '房间不存在' };
        if (room.status !== 'waiting') return { success: false, error: '游戏已开始' };
        if (room.players.length >= 4) return { success: false, error: '房间已满' };

        const existing = room.players.find(p => p.id === userId);
        if (existing) return { success: true, room };

        const seat = room.players.length;
        room.players.push({ id: userId, name: username, ready: false, seat });
        return { success: true, room };
    }

    leaveRoom(roomCode, userId) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;

        room.players = room.players.filter(p => p.id !== userId);

        if (room.players.length === 0) {
            this.rooms.delete(roomCode);
            return null;
        }

        if (room.hostId === userId) {
            room.hostId = room.players[0].id;
        }

        return room;
    }

    setReady(roomCode, userId, ready) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;
        const player = room.players.find(p => p.id === userId);
        if (player) player.ready = ready;
        return room;
    }

    isAllReady(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room || room.players.length < 4) return false;
        return room.players.every(p => p.ready);
    }

    setRoomStatus(roomCode, status) {
        const room = this.rooms.get(roomCode);
        if (room) room.status = status;
    }

    deleteRoom(roomCode) {
        this.rooms.delete(roomCode);
    }
}

module.exports = new RoomManager();
