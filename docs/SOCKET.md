# Socket.IO 事件文档

连接地址：`ws://localhost:3001`

## 连接认证

连接时通过 `auth` 携带 JWT Token：

```javascript
const socket = io('http://localhost:3001', {
  auth: { token: 'eyJhbGci...' }
});
```

Token 无效时服务端会断开连接并发送 `error` 事件。

---

## 房间事件

### 客户端 → 服务端

#### `room:join`
加入房间（进入等待室）

```json
{ "roomCode": "ABC123" }
```

**服务端响应：** `room:state`

---

#### `room:leave`
离开房间

```json
{ "roomCode": "ABC123" }
```

---

#### `room:ready`
切换准备状态

```json
{ "roomCode": "ABC123" }
```

---

#### `room:kick`
踢出玩家（仅房主）

```json
{ "roomCode": "ABC123", "targetId": 2 }
```

---

### 服务端 → 客户端

#### `room:state`
房间完整状态（加入时或状态变化时推送）

```json
{
  "roomCode": "ABC123",
  "name": "欢乐局",
  "hostId": 1,
  "status": "waiting",
  "players": [
    {
      "id": 1,
      "username": "player1",
      "avatarId": 0,
      "isReady": true,
      "isHost": true
    }
  ]
}
```

---

#### `room:player_joined`
有玩家加入

```json
{
  "player": { "id": 2, "username": "player2", "avatarId": 1, "isReady": false }
}
```

---

#### `room:player_left`
有玩家离开

```json
{ "userId": 2, "newHostId": 1 }
```

---

#### `room:ready_changed`
玩家准备状态变化

```json
{ "userId": 2, "isReady": true }
```

---

## 游戏事件

### 客户端 → 服务端

#### `game:play`
出牌

```json
{
  "roomCode": "ABC123",
  "cards": ["3h", "3d"]
}
```

**cards 格式：** `{rank}{suit}`，rank 为 `2-9, 10, J, Q, K, A`，suit 为 `s(黑桃) h(红心) d(方块) c(梅花)`，大小王为 `BJ`（小王）和 `RJ`（大王）

---

#### `game:pass`
不出（过）

```json
{ "roomCode": "ABC123" }
```

---

#### `game:tribute`
进贡

```json
{
  "roomCode": "ABC123",
  "card": "Ah",
  "toUserId": 3
}
```

---

#### `game:return_tribute`
还贡

```json
{
  "roomCode": "ABC123",
  "card": "5s",
  "toUserId": 4
}
```

---

### 服务端 → 客户端

#### `game:state`
游戏完整状态（加入游戏时推送）

```json
{
  "phase": "playing",
  "currentTurn": 1,
  "roundNumber": 1,
  "myHand": ["3h", "3d", "5s", "7c", "..."],
  "players": [
    {
      "id": 1,
      "username": "player1",
      "team": 1,
      "cardCount": 27,
      "isConnected": true,
      "finishPosition": null
    }
  ],
  "teams": {
    "teamA": { "ids": [1, 3], "level": "2" },
    "teamB": { "ids": [2, 4], "level": "2" }
  },
  "lastPlay": null,
  "lastPlayerId": null,
  "turnTimeoutAt": null
}
```

---

#### `game:dealt`
发牌完成，携带本人手牌

```json
{
  "hand": ["3h", "3d", "5s", "..."],
  "players": [
    { "id": 1, "cardCount": 27 }
  ]
}
```

---

#### `game:played`
有玩家出牌

```json
{
  "userId": 1,
  "cards": ["3h", "3d"],
  "type": "pair",
  "nextTurn": 2,
  "timeoutAt": 1704067230000
}
```

---

#### `game:passed`
有玩家过牌

```json
{ "userId": 2, "nextTurn": 3 }
```

---

#### `game:round_clear`
一轮结束（所有人过牌，出牌权回到最后出牌者）

```json
{ "nextTurn": 1 }
```

---

#### `game:player_finished`
有玩家出完手牌

```json
{
  "userId": 1,
  "position": 1,
  "team": 1
}
```

---

#### `game:tribute_required`
需要进贡

```json
{
  "tributeInfo": [
    { "fromUserId": 3, "toUserId": 1, "count": 1 },
    { "fromUserId": 4, "toUserId": 2, "count": 1 }
  ]
}
```

---

#### `game:tribute_received`
进贡完成，收到贡牌

```json
{
  "fromUserId": 3,
  "card": "Ah"
}
```

---

#### `game:return_tribute_required`
需要还贡

```json
{
  "returnInfo": [
    { "fromUserId": 1, "toUserId": 3 }
  ]
}
```

---

#### `game:round_end`
一局结束

```json
{
  "roundNumber": 1,
  "finishOrder": [1, 3, 2, 4],
  "teamALevelBefore": "2",
  "teamBLevelBefore": "2",
  "teamALevelAfter": "4",
  "teamBLevelAfter": "2",
  "nextRound": 2
}
```

---

#### `game:end`
整局游戏结束

```json
{
  "winnerTeam": 1,
  "teamAFinalLevel": "A",
  "teamBFinalLevel": "7",
  "ratings": {
    "1": { "before": 1000, "after": 1025, "delta": 25 },
    "2": { "before": 1050, "after": 1025, "delta": -25 },
    "3": { "before": 980,  "after": 1005, "delta": 25 },
    "4": { "before": 1100, "after": 1075, "delta": -25 }
  }
}
```

---

#### `game:turn_timeout`
出牌超时（服务端自动出最小合法牌或 pass）

```json
{ "userId": 2, "action": "pass" }
```

---

#### `game:player_disconnected`
玩家断线

```json
{ "userId": 2, "reconnectDeadline": 1704067290000 }
```

---

#### `game:player_reconnected`
玩家重连

```json
{ "userId": 2 }
```

---

## 快速匹配事件

### 客户端 → 服务端

#### `matchmaking:join`
加入匹配队列

```json
{}
```

---

#### `matchmaking:cancel`
取消匹配

```json
{}
```

---

### 服务端 → 客户端

#### `matchmaking:queued`
已进入队列

```json
{ "position": 2, "total": 2 }
```

---

#### `matchmaking:found`
匹配成功，即将开始游戏

```json
{
  "roomCode": "MATCH_xxxxxxxx",
  "players": [
    { "id": 1, "username": "player1" },
    { "id": 2, "username": "player2" },
    { "id": 3, "username": "player3" },
    { "id": 4, "username": "player4" }
  ],
  "startsIn": 2000
}
```

---

#### `matchmaking:timeout`
匹配超时

```json
{ "message": "匹配超时，请重试" }
```

---

#### `matchmaking:cancelled`
匹配已取消

```json
{}
```

---

## 通用事件

#### `error`
服务端错误

```json
{ "message": "错误描述" }
```

---

## 牌面编码

| 编码 | 含义 |
|---|---|
| `2s` ~ `As` | 黑桃 2 ~ A |
| `2h` ~ `Ah` | 红心 2 ~ A |
| `2d` ~ `Ad` | 方块 2 ~ A |
| `2c` ~ `Ac` | 梅花 2 ~ A |
| `BJ` | 小王（黑色 Joker） |
| `RJ` | 大王（红色 Joker） |

两副牌共 108 张，编码相同的牌用数组区分（服务端内部用索引，客户端只需关心编码）。
