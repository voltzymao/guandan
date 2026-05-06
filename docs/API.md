# API 文档

所有 API 均以 `/api` 为前缀，返回 JSON。

## 认证

除注册/登录外，所有接口需在请求头携带 JWT Token：

```
Authorization: Bearer <token>
```

---

## 认证接口 `/api/auth`

### 注册

```
POST /api/auth/register
```

**请求体**

```json
{
  "username": "player1",
  "password": "secret123",
  "email": "player1@example.com"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `username` | string | 是 | 2-32 字符，唯一 |
| `password` | string | 是 | 6-128 字符 |
| `email` | string | 否 | 邮箱地址 |

**响应 201**

```json
{
  "token": "eyJhbGci...",
  "user": {
    "id": 1,
    "username": "player1",
    "rating": 1000,
    "rank_tier": "bronze"
  }
}
```

---

### 登录

```
POST /api/auth/login
```

**请求体**

```json
{
  "username": "player1",
  "password": "secret123"
}
```

**响应 200**

```json
{
  "token": "eyJhbGci...",
  "user": {
    "id": 1,
    "username": "player1",
    "rating": 1050,
    "rank_tier": "bronze",
    "games_played": 5,
    "games_won": 3
  }
}
```

---

### 游客登录

```
POST /api/auth/guest
```

无需请求体，自动生成游客账号。

**响应 200**

```json
{
  "token": "eyJhbGci...",
  "user": {
    "id": 42,
    "username": "Guest_a3f2",
    "is_guest": true
  }
}
```

---

### 获取当前用户信息

```
GET /api/auth/me
```

需要认证。

**响应 200**

```json
{
  "id": 1,
  "username": "player1",
  "rating": 1050,
  "rank_tier": "bronze",
  "games_played": 5,
  "games_won": 3,
  "current_level": "3",
  "win_streak": 2
}
```

---

## 大厅接口 `/api/lobby`

### 获取房间列表

```
GET /api/lobby/rooms
```

需要认证。

**响应 200**

```json
{
  "rooms": [
    {
      "id": 1,
      "room_code": "ABC123",
      "name": "欢乐局",
      "host_id": 1,
      "host_name": "player1",
      "status": "waiting",
      "player_count": 2,
      "max_players": 4,
      "is_private": false
    }
  ]
}
```

---

### 创建房间

```
POST /api/lobby/rooms
```

需要认证。

**请求体**

```json
{
  "name": "欢乐局",
  "is_private": false,
  "password": ""
}
```

**响应 201**

```json
{
  "room": {
    "id": 1,
    "room_code": "ABC123",
    "name": "欢乐局"
  }
}
```

---

### 加入房间

```
POST /api/lobby/rooms/:roomCode/join
```

需要认证。

**请求体（私密房间）**

```json
{
  "password": "1234"
}
```

**响应 200**

```json
{
  "room": {
    "id": 1,
    "room_code": "ABC123",
    "name": "欢乐局"
  }
}
```

---

## 好友接口 `/api/friends`

### 获取好友列表

```
GET /api/friends
```

需要认证。

**响应 200**

```json
{
  "friends": [
    {
      "id": 2,
      "username": "player2",
      "rating": 1100,
      "rank_tier": "silver",
      "online": true,
      "friendship_id": 5,
      "status": "accepted"
    }
  ],
  "pending": [
    {
      "id": 3,
      "username": "player3",
      "friendship_id": 6,
      "direction": "incoming"
    }
  ]
}
```

---

### 发送好友申请

```
POST /api/friends/request
```

需要认证。

**请求体**

```json
{
  "username": "player2"
}
```

**响应 200**

```json
{ "message": "好友申请已发送" }
```

---

### 处理好友申请

```
POST /api/friends/:friendshipId/respond
```

需要认证。

**请求体**

```json
{
  "action": "accept"
}
```

`action` 可选值：`accept` | `reject`

**响应 200**

```json
{ "message": "已接受好友申请" }
```

---

### 删除好友

```
DELETE /api/friends/:friendshipId
```

需要认证。

**响应 200**

```json
{ "message": "已删除好友" }
```

---

## 战绩接口 `/api/history`

### 获取战绩列表

```
GET /api/history?page=1&limit=20
```

需要认证。

**查询参数**

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `page` | number | 1 | 页码 |
| `limit` | number | 20 | 每页条数（最大 50） |

**响应 200**

```json
{
  "games": [
    {
      "id": 10,
      "started_at": "2024-01-15T10:30:00Z",
      "finished_at": "2024-01-15T11:05:00Z",
      "winner_team": 1,
      "team_a_level": "5",
      "team_b_level": "3",
      "my_team": 1,
      "rating_delta": 25,
      "rounds_played": 3,
      "players": ["player1", "player3", "player2", "player4"]
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

---

## 回放接口 `/api/replay`

### 获取对局回放数据

```
GET /api/replay/:gameId
```

需要认证。只能查看自己参与的对局。

**响应 200**

```json
{
  "game": {
    "id": 10,
    "started_at": "2024-01-15T10:30:00Z",
    "finished_at": "2024-01-15T11:05:00Z",
    "winner_team": 1,
    "players": [
      { "id": 1, "username": "player1", "team": 1 },
      { "id": 2, "username": "player2", "team": 2 },
      { "id": 3, "username": "player3", "team": 1 },
      { "id": 4, "username": "player4", "team": 2 }
    ]
  },
  "rounds": [
    {
      "round_number": 1,
      "team_a_level_before": "2",
      "team_b_level_before": "2",
      "finish_order": [1, 3, 2, 4],
      "move_sequence": [
        {
          "player_id": 1,
          "cards": ["A♠", "A♥"],
          "type": "pair",
          "timestamp": 1705312200000
        },
        {
          "player_id": 2,
          "cards": [],
          "type": "pass",
          "timestamp": 1705312215000
        }
      ]
    }
  ]
}
```

---

## 错误响应

所有错误均返回统一格式：

```json
{
  "error": "错误描述信息"
}
```

| HTTP 状态码 | 含义 |
|---|---|
| 400 | 请求参数错误 |
| 401 | 未认证或 Token 无效 |
| 403 | 无权限 |
| 404 | 资源不存在 |
| 409 | 冲突（如用户名已存在） |
| 429 | 请求过于频繁 |
| 500 | 服务器内部错误 |
