# WeFlow HTTP API / Push 文档

WeFlow 提供本地 HTTP API（已支持GET 和 POST请求），便于外部脚本或工具读取聊天记录、会话、联系人、群成员和导出的媒体文件；也支持在检测到新消息后通过固定 SSE 地址主动推送消息事件。

## 启用方式

在应用设置页启用 `API 服务`。

- 默认监听地址：`127.0.0.1`
- 默认端口：`5031`
- 基础地址：`http://127.0.0.1:5031`
- 可选开启 `主动推送`，检测到新收到的消息后会通过 `GET /api/v1/push/messages` 推送给 SSE 订阅端

**状态记忆**：API 服务和主动推送的状态及端口会自动保存，重启 WeFlow 后会自动恢复运行。

## 鉴权规范

**鉴权规范 (Access Token)** 除健康检查接口外，所有 `/api/v1/*` 接口均受 Token 保护。支持三种传参方式（任选其一）：

1. **HTTP Header (推荐)**: `Authorization: Bearer <您的Token>`
2. **Query 参数**: `?access_token=<您的Token>`（SSE 长连接推荐此方式）
3. **JSON Body**: `{"access_token": "<您的Token>"}`（仅限 POST 请求）

## 接口列表

- `GET|POST /health`
- `GET|POST /api/v1/health`
- `GET|POST /api/v1/push/messages`
- `GET|POST /api/v1/messages`
- `GET|POST /api/v1/sessions`
- `GET /api/v1/sessions/:id/messages` (ChatLab Pull)
- `GET|POST /api/v1/contacts`
- `GET|POST /api/v1/group-members`
- `GET|POST /api/v1/media/*`
- `GET /api/v1/telegram/sources`
- `GET|POST /api/v1/telegram/sources/:sourceId/sessions`
- `GET|POST /api/v1/telegram/sources/:sourceId/messages`
- `GET /api/v1/telegram/sources/:sourceId/sessions/:id/messages` (ChatLab Pull)

---

## 1. 健康检查

**请求**

```http
GET /health
```

或

```http
GET /api/v1/health
```

**响应**

```json
{
  "status": "ok"
}
```

---

## 2. 主动推送

通过 SSE 长连接接收新消息事件，端口与 HTTP API 共用。

**请求**

```http
GET /api/v1/push/messages
```

### 说明

- 需要先在设置页开启 `HTTP API 服务`
- 同时需要开启 `主动推送`
- 响应类型为 `text/event-stream`
- 事件名包含 `message.new` 和 `message.revoke`
- 建议接收端按 `event + rawid` 去重

### 事件字段

- `event`
- `sessionId`
- `rawid`
- `avatarUrl`
- `sourceName`
- `groupName`（仅群聊）
- `content`
- `timestamp`（消息时间，秒级 Unix 时间戳）

### 示例

```bash
curl -N "http://127.0.0.1:5031/api/v1/push/messages?access_token=YOUR_TOKEN
```

示例事件：

```text
event: message.new
data: {"event":"message.new","sessionId":"xxx@chatroom","sessionType":"group","rawid":"1234567890123456789","avatarUrl":"https://example.com/group.jpg","sourceName":"李四","groupName":"项目群","content":"[图片]","timestamp":1760000123}
```

撤回事件示例：

```text
event: message.revoke
data: {"event":"message.revoke","sessionId":"wxid_xxx","sessionType":"other","rawid":"1234567890123456789","avatarUrl":"https://example.com/avatar.jpg","sourceName":"张三","content":"对方撤回了一条消息（rawid：1234567890123456789） 内容为“你好”","timestamp":1760000180}
```

---

## 3. 获取消息

> 当使用 POST 时，请将参数放在 JSON Body 中（Content-Type: application/json）

读取指定会话的消息，支持原始 JSON 和 ChatLab 格式。

**请求**

```http
GET /api/v1/messages
```

### 参数

| 参数      | 类型   | 必填 | 说明                                                  |
| --------- | ------ | ---- | ----------------------------------------------------- |
| `talker`  | string | 是   | 会话 ID。私聊通常是对方 `wxid`，群聊是 `xxx@chatroom` |
| `limit`   | number | 否   | 返回条数，默认 `100`，范围 `1~10000`                  |
| `offset`  | number | 否   | 分页偏移，默认 `0`                                    |
| `start`   | string | 否   | 开始时间，支持 `YYYYMMDD` 或时间戳                    |
| `end`     | string | 否   | 结束时间，支持 `YYYYMMDD` 或时间戳                    |
| `keyword` | string | 否   | 基于消息显示文本过滤                                  |
| `chatlab` | string | 否   | `1/true` 时输出 ChatLab 格式                          |
| `format`  | string | 否   | `json` 或 `chatlab`                                   |
| `media`   | string | 否   | `1/true` 时导出媒体并返回媒体地址，兼容别名 `meiti`   |
| `image`   | string | 否   | 在 `media=1` 时控制图片导出，兼容别名 `tupian`        |
| `voice`   | string | 否   | 在 `media=1` 时控制语音导出，兼容别名 `vioce`         |
| `video`   | string | 否   | 在 `media=1` 时控制视频导出                           |
| `emoji`   | string | 否   | 在 `media=1` 时控制表情导出                           |

### 示例

```bash
curl "http://127.0.0.1:5031/api/v1/messages?talker=wxid_xxx&limit=20"
curl "http://127.0.0.1:5031/api/v1/messages?talker=xxx@chatroom&chatlab=1"
curl "http://127.0.0.1:5031/api/v1/messages?talker=wxid_xxx&start=20260101&end=20260131"
curl "http://127.0.0.1:5031/api/v1/messages?talker=xxx@chatroom&media=1&image=1&voice=0&video=0&emoji=0"
```

### JSON 响应字段

顶层字段：

- `success`
- `talker`
- `count`
- `hasMore`
- `media.enabled`
- `media.exportPath`
- `media.count`
- `messages`

单条消息字段：

- `localId`
- `serverId`
- `localType`
- `createTime`
- `isSend`
- `senderUsername`
- `content`
- `rawContent`
- `parsedContent`
- `replyToMessageId`（引用回复目标消息的 `serverId`，仅引用消息返回）
- `quote`（引用消息快照，包含被引用消息的 ID、发送者、内容和类型）
- `mediaType`
- `mediaFileName`
- `mediaUrl`
- `mediaLocalPath`

**示例响应**

```json
{
  "success": true,
  "talker": "xxx@chatroom",
  "count": 3,
  "hasMore": true,
  "media": {
    "enabled": true,
    "exportPath": "C:\\Users\\Alice\\Documents\\WeFlow\\api-media",
    "count": 1
  },
  "messages": [
    {
      "localId": 123,
      "serverId": "6116895530414915131",
      "localType": 1,
      "createTime": 1738713600,
      "isSend": 0,
      "senderUsername": "wxid_member",
      "content": "你好",
      "rawContent": "你好",
      "parsedContent": "你好"
    },
    {
      "localId": 125,
      "serverId": "6116895530414915133",
      "localType": 244813135921,
      "createTime": 1738713700,
      "isSend": 0,
      "senderUsername": "wxid_member",
      "content": "收到",
      "rawContent": "<msg>...</msg>",
      "parsedContent": "收到",
      "replyToMessageId": "6116895530414915131",
      "quote": {
        "platformMessageId": "6116895530414915131",
        "sender": "wxid_other",
        "accountName": "张三",
        "content": "你好",
        "type": 0
      }
    },
    {
      "localId": 124,
      "localType": 3,
      "createTime": 1738713660,
      "isSend": 0,
      "senderUsername": "wxid_member",
      "content": "[图片]",
      "mediaType": "image",
      "mediaFileName": "abc123.jpg",
      "mediaUrl": "http://127.0.0.1:5031/api/v1/media/xxx@chatroom/images/abc123.jpg",
      "mediaLocalPath": "C:\\Users\\Alice\\Documents\\WeFlow\\api-media\\xxx@chatroom\\images\\abc123.jpg"
    }
  ]
}
```

### ChatLab 响应

当 `chatlab=1` 或 `format=chatlab` 时，返回 ChatLab 结构：

- `chatlab.version`
- `chatlab.exportedAt`
- `chatlab.generator`
- `meta.name`
- `meta.platform`
- `meta.type`
- `meta.groupId`
- `meta.groupAvatar`
- `meta.ownerId`
- `members[].platformId`
- `members[].accountName`
- `members[].groupNickname`
- `members[].avatar`
- `messages[].sender`
- `messages[].accountName`
- `messages[].groupNickname`
- `messages[].timestamp`
- `messages[].type`
- `messages[].content`
- `messages[].platformMessageId`
- `messages[].replyToMessageId`
- `messages[].mediaPath`

群聊里 `groupNickname` 会优先来自群成员群昵称；若源数据缺失，则回退为空或展示名。

---

## 4. 获取会话列表

> 当使用 POST 时，请将参数放在 JSON Body 中（Content-Type: application/json）

**请求**

```http
GET /api/v1/sessions
```

### 参数

| 参数      | 类型   | 必填 | 说明                             |
| --------- | ------ | ---- | -------------------------------- |
| `keyword` | string | 否   | 匹配 `username` 或 `displayName` |
| `limit`   | number | 否   | 默认 `100`                       |

### 响应字段

- `success`
- `count`
- `sessions[].username`
- `sessions[].displayName`
- `sessions[].type`
- `sessions[].lastTimestamp`
- `sessions[].unreadCount`

**示例响应**

```json
{
  "success": true,
  "count": 1,
  "sessions": [
    {
      "username": "xxx@chatroom",
      "displayName": "项目群",
      "type": 2,
      "lastTimestamp": 1738713600,
      "unreadCount": 0
    }
  ]
}
```

---

## 4.1 获取会话列表（ChatLab 格式）

当 `format=chatlab` 时，返回微信与 Telegram 已缓存会话的 ChatLab Pull 协议兼容列表。普通 JSON 格式保持微信专用。

**请求**

```http
GET /api/v1/sessions?format=chatlab
```

### 参数

| 参数      | 类型   | 必填 | 说明                             |
| --------- | ------ | ---- | -------------------------------- |
| `format`  | string | 是   | 设为 `chatlab`                   |
| `keyword` | string | 否   | 匹配会话 ID/名称；单独输入 `wechat` 或 `telegram` 时按平台搜索 |
| `platform` | string | 否  | `wechat` 或 `telegram`；可与名称关键词组合，仅 ChatLab 格式有效 |
| `limit`   | number | 否   | 每页条数，默认 `100`，最大 `10000` |
| `cursor`  | string | 否   | 上一页 `page.nextCursor`，须与相同的搜索条件一起使用 |

### 响应

```json
{
  "sessions": [
    {
      "id": "xxx@chatroom",
      "name": "项目群",
      "platform": "wechat",
      "type": "group",
      "messageCount": 58000,
      "lastMessageAt": 1738713600
    },
    {
      "id": "tg.live.MTIz",
      "name": "Telegram 群",
      "platform": "telegram",
      "type": "group",
      "messageCount": 120,
      "lastMessageAt": 1738713600,
      "complete": true
    }
  ],
  "page": { "hasMore": false }
}
```

| 字段            | 说明                                |
| --------------- | ----------------------------------- |
| `id`            | 微信 username；Telegram 为带来源的 `tg.<sourceId>.<编码会话ID>` |
| `name`          | 会话显示名称                        |
| `platform`      | `wechat` 或 `telegram`              |
| `type`          | `group`（群聊）、`private`（私聊）、`channel`（频道）或 `other` |
| `messageCount`  | 微信为估算值；Telegram 为本地缓存条数 |
| `lastMessageAt` | 最后消息的秒级 Unix 时间戳          |
| `complete`      | Telegram 会话历史是否已完整同步；微信不返回 |

按最新消息时间倒序返回。当 `page.hasMore=true` 时，使用 `page.nextCursor` 和相同的 `keyword`、`platform` 请求下一页；无效游标或平台返回 400。普通 JSON 会话列表不使用此分页协议。

在 ChatLab 的订阅管理搜索框输入 `telegram` 或 `wechat` 后点击“搜索”，可只查看对应平台；有后续页面时点击“加载更多”。例如直接请求 `GET /api/v1/sessions?format=chatlab&platform=telegram&keyword=项目&limit=200` 可在 Telegram 会话中按名称搜索。ChatLab 当前版本会隐藏 `channel` 和 `other` 类型的会话；WeFlow 仍按真实类型返回它们，不会将频道冒充群聊。

---

## 4.2 拉取会话消息（ChatLab Pull）

返回 ChatLab 标准格式的聊天数据，支持增量拉取和分页。

**请求**

```http
GET /api/v1/sessions/:id/messages
```

### 参数

| 参数     | 类型   | 必填 | 说明                                     |
| -------- | ------ | ---- | ---------------------------------------- |
| `:id`    | string | 是   | 会话 ID（Path 参数）                     |
| `since`  | number | 否   | 秒级 Unix 时间戳，仅返回此时间之后的消息 |
| `end`    | number | 否   | 秒级 Unix 时间戳，时间上界               |
| `limit`  | number | 否   | 单次返回上限，默认且最大 `5000`          |
| `offset` | number | 否   | 分页偏移，默认 `0`                       |

### 响应

返回 ChatLab 标准 JSON 格式，外加 `sync` 分页块：

```json
{
  "chatlab": {
    "version": "0.0.2",
    "exportedAt": 1738713600,
    "generator": "WeFlow"
  },
  "meta": {
    "name": "项目群",
    "platform": "wechat",
    "type": "group",
    "groupId": "xxx@chatroom",
    "ownerId": "wxid_xxx"
  },
  "members": [
    {
      "platformId": "wxid_a",
      "accountName": "张三",
      "groupNickname": "产品",
      "avatar": "https://example.com/avatar.jpg"
    }
  ],
  "messages": [
    {
      "sender": "wxid_a",
      "accountName": "张三",
      "timestamp": 1738713600,
      "type": 0,
      "content": "你好",
      "platformMessageId": "123456"
    }
  ],
  "sync": {
    "hasMore": true,
    "nextSince": 1738713600,
    "nextOffset": 5000,
    "watermark": 1738714000
  }
}
```

### sync 块

| 字段         | 说明                             |
| ------------ | -------------------------------- |
| `hasMore`    | 是否还有更多数据                 |
| `nextSince`  | 下次请求的 `since` 值            |
| `nextOffset` | 下次请求的 `offset` 值           |
| `watermark`  | 本次拉取的时间上界（秒级时间戳） |

**ChatLab 对接方式**：在 ChatLab 设置中添加远程数据源，`baseUrl` 填 `http://127.0.0.1:5031/api/v1`，Token 填 WeFlow 中配置的 API Token。Telegram 须先在 WeFlow 中同步或导入消息；无需配置微信。ChatLab 从此根地址发现所有已缓存的来源，按 `platform` 区分微信与 Telegram。

---

## 5. 获取联系人列表

> 当使用 POST 时，请将参数放在 JSON Body 中（Content-Type: application/json）

**请求**

```http
GET /api/v1/contacts
```

### 参数

| 参数      | 类型   | 必填 | 说明                                                 |
| --------- | ------ | ---- | ---------------------------------------------------- |
| `keyword` | string | 否   | 匹配 `username`、`nickname`、`remark`、`displayName` |
| `limit`   | number | 否   | 默认 `100`                                           |

### 响应字段

- `success`
- `count`
- `contacts[].username`
- `contacts[].displayName`
- `contacts[].remark`
- `contacts[].nickname`
- `contacts[].alias`
- `contacts[].avatarUrl`
- `contacts[].type`

**示例响应**

```json
{
  "success": true,
  "count": 1,
  "contacts": [
    {
      "username": "wxid_xxx",
      "displayName": "张三",
      "remark": "客户张三",
      "nickname": "张三",
      "alias": "zhangsan",
      "avatarUrl": "https://example.com/avatar.jpg",
      "type": "friend"
    }
  ]
}
```

---

## 6. 获取群成员列表

> 当使用 POST 时，请将参数放在 JSON Body 中（Content-Type: application/json）

返回群成员的 `wxid`、群昵称、备注、微信号等信息。

**请求**

```http
GET /api/v1/group-members
```

### 参数

| 参数                   | 类型   | 必填 | 说明                            |
| ---------------------- | ------ | ---- | ------------------------------- |
| `chatroomId`           | string | 是   | 群 ID，兼容使用 `talker` 传入   |
| `includeMessageCounts` | string | 否   | `1/true` 时附带成员发言数       |
| `withCounts`           | string | 否   | `includeMessageCounts` 的别名   |
| `forceRefresh`         | string | 否   | `1/true` 时跳过内存缓存强制刷新 |

### 响应字段

- `success`
- `chatroomId`
- `count`
- `fromCache`
- `updatedAt`
- `members[].wxid`
- `members[].displayName`
- `members[].nickname`
- `members[].remark`
- `members[].alias`
- `members[].groupNickname`
- `members[].avatarUrl`
- `members[].isOwner`
- `members[].isFriend`
- `members[].messageCount`

**示例请求**

```bash
curl "http://127.0.0.1:5031/api/v1/group-members?chatroomId=xxx@chatroom"
curl "http://127.0.0.1:5031/api/v1/group-members?chatroomId=xxx@chatroom&includeMessageCounts=1&forceRefresh=1"
```

**示例响应**

```json
{
  "success": true,
  "chatroomId": "xxx@chatroom",
  "count": 2,
  "fromCache": false,
  "updatedAt": 1760000000000,
  "members": [
    {
      "wxid": "wxid_member_a",
      "displayName": "客户A",
      "nickname": "阿甲",
      "remark": "客户A",
      "alias": "kehua",
      "groupNickname": "甲方",
      "avatarUrl": "https://example.com/a.jpg",
      "isOwner": true,
      "isFriend": true,
      "messageCount": 128
    },
    {
      "wxid": "wxid_member_b",
      "displayName": "李四",
      "nickname": "李四",
      "remark": "",
      "alias": "",
      "groupNickname": "",
      "avatarUrl": "",
      "isOwner": false,
      "isFriend": false,
      "messageCount": 0
    }
  ]
}
```

说明：

- `displayName` 是当前应用内的主展示名。
- `groupNickname` 是成员在该群里的群昵称。
- `remark` 是你对该联系人的备注。
- `alias` 是微信号。
- 当微信源数据里没有群昵称时，`groupNickname` 会为空。

---

## 7. 朋友圈接口

### 7.1 获取朋友圈时间线

```http
GET /api/v1/sns/timeline
```

参数：

| 参数        | 类型   | 必填 | 说明                                                         |
| ----------- | ------ | ---- | ------------------------------------------------------------ |
| `limit`     | number | 否   | 返回数量，默认 20，范围 `1~200`                              |
| `offset`    | number | 否   | 偏移量，默认 0                                               |
| `usernames` | string | 否   | 发布者过滤，逗号分隔，如 `wxid_a,wxid_b`                     |
| `keyword`   | string | 否   | 关键词过滤（正文）                                           |
| `start`     | string | 否   | 开始时间，支持 `YYYYMMDD` 或秒/毫秒时间戳                    |
| `end`       | string | 否   | 结束时间，支持 `YYYYMMDD` 或秒/毫秒时间戳                    |
| `media`     | number | 否   | 是否返回可直接访问的媒体地址，默认 `1`                       |
| `replace`   | number | 否   | `media=1` 时，是否用解析地址覆盖 `media.url/thumb`，默认 `1` |
| `inline`    | number | 否   | `media=1` 时，是否内联返回 `data:` URL，默认 `0`             |

示例：

```bash
curl "http://127.0.0.1:5031/api/v1/sns/timeline?limit=5"
curl "http://127.0.0.1:5031/api/v1/sns/timeline?usernames=wxid_a,wxid_b&keyword=旅行"
curl "http://127.0.0.1:5031/api/v1/sns/timeline?limit=3&media=1&replace=1"
curl "http://127.0.0.1:5031/api/v1/sns/timeline?limit=3&media=1&inline=1"
```

媒体字段说明（`media=1`）：

- `media[].url/thumb`：你应该优先直接使用的字段。
- `replace=1`（默认）时，`media[].url/thumb` 会直接被替换成可访问地址，等价于 `resolvedUrl/resolvedThumbUrl`。
- `replace=0` 时，`media[].url/thumb` 仍保留微信原始地址；这时再结合下面的 `raw/proxy/resolved` 字段自己决定用哪一个。
- `media[].rawUrl/rawThumb`：原始朋友圈地址
- `media[].proxyUrl/proxyThumbUrl`：可直接访问的代理地址
- `media[].resolvedUrl/resolvedThumbUrl`：最终可用地址（`inline=1` 时可能是 `data:` URL）
- `media[].token/key/encIdx`：微信源数据里的访问/解密参数。通常不需要你自己处理；如果你手动调用 `/api/v1/sns/media/proxy`，把当前条目的 `url` 和 `key` 原样传回即可。
- `media[].livePhoto`：实况图的视频部分。外层 `media[].url/thumb` 仍是封面图，`livePhoto` 内部会再提供一组自己的 `url/thumb/raw*/proxy*/resolved*` 字段。
- `media=0` 时，不会补充 `raw*/proxy*/resolved*`，接口只返回原始 `url/thumb` 以及源字段（如 `key/token/encIdx`）。

### 7.2 获取朋友圈发布者

```http
GET /api/v1/sns/usernames
```

### 7.3 获取朋友圈导出统计

```http
GET /api/v1/sns/export/stats
```

参数：

| 参数   | 类型   | 必填 | 说明                         |
| ------ | ------ | ---- | ---------------------------- |
| `fast` | number | 否   | `1` 使用快速统计（优先缓存） |

### 7.4 朋友圈媒体代理

```http
GET /api/v1/sns/media/proxy
```

参数：

| 参数  | 类型          | 必填 | 说明                     |
| ----- | ------------- | ---- | ------------------------ |
| `url` | string        | 是   | 媒体原始 URL             |
| `key` | string/number | 否   | 解密 key（部分资源需要） |

### 7.5 导出朋友圈

```http
POST /api/v1/sns/export
Content-Type: application/json
```

Body 示例：

```json
{
  "outputDir": "C:\\Users\\Alice\\Desktop\\sns-export",
  "format": "json",
  "usernames": "wxid_a,wxid_b",
  "keyword": "旅行",
  "exportMedia": true,
  "exportImages": true,
  "exportLivePhotos": true,
  "exportVideos": true,
  "start": "20250101",
  "end": "20251231"
}
```

`format` 支持：`json`、`html`、`arkmejson`（兼容写法：`arkme-json`）、`markdown`（兼容写法：`md`）。

### 7.6 朋友圈防删开关

```http
GET  /api/v1/sns/block-delete/status
POST /api/v1/sns/block-delete/install
POST /api/v1/sns/block-delete/uninstall
```

### 7.7 删除单条朋友圈

```http
DELETE /api/v1/sns/post/{postId}
```

---

## 8. 访问导出媒体

> 当使用 POST 时，请将参数放在 JSON Body 中（Content-Type: application/json）

通过消息接口启用 `media=1` 后，接口会先把图片、语音、视频、表情导出到本地缓存目录，再返回可访问的 HTTP 地址。

**请求**

```http
GET /api/v1/media/{relativePath}
```

### 示例

```bash
curl "http://127.0.0.1:5031/api/v1/media/xxx@chatroom/images/abc123.jpg"
curl "http://127.0.0.1:5031/api/v1/media/xxx@chatroom/voices/voice_100.wav"
curl "http://127.0.0.1:5031/api/v1/media/xxx@chatroom/videos/video_200.mp4"
curl "http://127.0.0.1:5031/api/v1/media/xxx@chatroom/emojis/emoji_300.gif"
```

### 支持的 Content-Type

| 扩展名           | Content-Type |
| ---------------- | ------------ |
| `.png`           | `image/png`  |
| `.jpg` / `.jpeg` | `image/jpeg` |
| `.gif`           | `image/gif`  |
| `.webp`          | `image/webp` |
| `.wav`           | `audio/wav`  |
| `.mp3`           | `audio/mpeg` |
| `.mp4`           | `video/mp4`  |

常见错误响应：

```json
{
  "error": "Media not found"
}
```

---

## 9. 使用示例

### PowerShell

```powershell
$headers = @{ "Authorization" = "Bearer YOUR_TOKEN" }
$body = @{ talker = "wxid_xxx"; limit = 10 } | ConvertTo-Json

Invoke-RestMethod -Uri "http://127.0.0.1:5031/api/v1/messages" -Method POST -Headers $headers -Body $body -ContentType "application/json"
```

### cURL

```bash
# GET 带 Token Header
curl -H "Authorization: Bearer YOUR_TOKEN" "http://127.0.0.1:5031/api/v1/messages?talker=wxid_xxx"

# POST 带 JSON Body
curl -X POST http://127.0.0.1:5031/api/v1/messages \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"talker": "xxx@chatroom", "chatlab": true}'
```

### Python

```python
import requests

BASE_URL = "http://127.0.0.1:5031"
headers = {"Authorization": "Bearer YOUR_TOKEN", "Content-Type": "application/json"}

# POST 方式获取消息
messages = requests.post(
    f"{BASE_URL}/api/v1/messages",
    json={"talker": "xxx@chatroom", "limit": 50},
    headers=headers
).json()

# GET 方式获取群成员
members = requests.get(
    f"{BASE_URL}/api/v1/group-members",
    params={"chatroomId": "xxx@chatroom", "includeMessageCounts": 1},
    headers=headers
).json()
```

---

## 10. 读取 Telegram 数据

Telegram 接口沿用上方的 Access Token，无需连接微信数据库。它们只读取 WeFlow 已同步或已导入的缓存（包括经 Desktop `tdata` 授权后联网同步的在线缓存）；请求不会触发 Telegram 登录、远端历史同步或媒体下载。普通 JSON `/api/v1/sessions` 与 `/api/v1/messages` 保持微信默认行为；`format=chatlab` 的根会话列表包含 Telegram，使用该列表返回的 `tg.` 会话 ID 即可从根 Pull 或查询消息。

在 ChatLab 中填写 `http://127.0.0.1:5031/api/v1` 作为远程数据源地址和 WeFlow 的 API Token，无需手动拼接 Telegram 来源 ID。例如根会话列表返回 `tg.live.MTIz` 时，ChatLab 将请求 `/api/v1/sessions/tg.live.MTIz/messages?format=chatlab`。同一个聊天出现在不同 Telegram 来源时，ID 仍各自独立。ChatLab 当前界面只提供私聊/群聊筛选；API 返回的频道会话可能不在其可选列表中。

先获取可用数据源：

```http
GET /api/v1/telegram/sources
```

响应中的 `sources[].id` 为在线账号的 `live` 或 JSON 导入生成的 `import-...`；每项还包含 `label`、`kind`（`account` / `import`）和 `chatCount`。若没有在线缓存或导入文件，返回空数组。

选择一个数据源后，使用以下资源根：

```text
http://127.0.0.1:5031/api/v1/telegram/sources/{sourceId}
```

### 查询会话

```http
GET /api/v1/telegram/sources/{sourceId}/sessions?limit=100&keyword=项目
GET /api/v1/telegram/sources/{sourceId}/sessions?format=chatlab
```

支持 `GET` 和 `POST`（POST 参数放在 JSON Body 中）。默认 JSON 返回 `success`、`sourceId`、`count`、`sessions`，每个会话包含 `id`、`title`、`kind`、`lastMessageAt`、`unreadCount`、`messageCount` 和 `complete`。`format=chatlab` 返回 ChatLab 会话列表，`platform` 为 `telegram`；`messageCount` 仅统计本地缓存，`complete=false` 表示该会话历史尚未全部同步。

### 查询缓存消息

```http
GET /api/v1/telegram/sources/{sourceId}/messages?talker={chatId}&limit=100&offset=0
GET /api/v1/telegram/sources/{sourceId}/messages?talker={chatId}&format=chatlab
```

同样支持 `GET` 和 `POST`。`talker` 必填，值是会话 `id`；使用 URL 路径时请对 ID 进行编码。可选 `keyword`、`start`、`end`、`limit`（默认 100，最大 10000）、`offset`，日期格式与微信消息接口一致。默认按时间倒序返回 `messages`，并附带 `hasMore` 与 `complete`。单条消息包含 `id`、`date`、`sender`、`text`、`kind`、`outgoing`；不会返回本机媒体绝对路径。`format=chatlab` 或 `chatlab=1` 返回 ChatLab 结构。

### ChatLab 增量拉取

```http
GET /api/v1/telegram/sources/{sourceId}/sessions/{chatId}/messages?limit=5000&offset=0
```

此接口只支持 `GET`，返回按时间正序排列的 ChatLab 消息和 `sync` 块。支持 `since`、`end`、`limit`（默认和最大 5000）、`offset`；`since` 是含边界的时间下限。有下一页时仅返回 `sync.nextOffset`，最后一页才返回 `sync.nextSince`；同一轮翻页应保持 `since` 不变并传入 `nextOffset`，避免同秒消息重复。`sync.hasMore` 仅表示**缓存中**是否还有下一页，`sync.complete` 表示会话历史是否已完整同步。

上述深层资源根适用于只需单个 Telegram 来源的 API 客户端；ChatLab 推荐使用统一 `/api/v1` 根地址。JSON 导入源是静态快照；在线源的缓存会随应用中的同步更新，但 HTTP API 本身不主动发起同步。Telegram 暂不支持 HTTP 媒体导出或 SSE 主动推送；请求 `media=1` 会得到 400。发送者仅有缓存中的名称，没有稳定的 Telegram 用户 ID。

错误码：401 表示缺少或无效 Token；400 表示无效源 ID、缺少会话 ID、无效格式或不支持的媒体参数；404 表示数据源或会话不存在；405 表示方法不支持。

## 11. 注意事项

1. API 仅监听本机 `127.0.0.1`，不对外网开放。
2. 微信接口使用前需要连接微信数据库；Telegram 接口无需微信配置，但需要已有在线缓存或 JSON 导入数据。
3. `start` 和 `end` 支持 `YYYYMMDD` 与时间戳；纯 `YYYYMMDD` 的 `end` 会扩展到当天 `23:59:59`。
4. 群成员的 `groupNickname` 依赖微信源数据；源数据缺失时不会自动补出。
5. 媒体访问链接只有在对应消息已经通过 `media=1` 导出后才可访问。
