# 🎲 大话骰 - 酒吧在线对战

> 经典酒桌游戏线上版！支持 2-4 人在线对战，摇骰子、叫数、开骰，输了就得喝 🍺

**当前版本：v2.5.6**

---

## 📦 技术栈

| 技术 | 用途 |
|------|------|
| **Node.js** | 服务端运行时 |
| **Express** | HTTP 服务、静态文件托管、路由 |
| **WebSocket (ws)** | 实时多人对战通信 |
| **UUID** | 玩家唯一标识生成 |
| **原生 HTML/CSS/JS** | 前端（无框架，纯手写） |

---

## 📁 项目结构

```
liars-dice/
├── package.json          # 项目配置和依赖
├── package-lock.json     # 依赖锁定
├── README.md             # 📌 本文件 - 项目说明
├── RULES.md              # 📖 完整游戏规则
│
├── server/               # === 服务端 ===
│   ├── index.js          # 服务入口：Express + WebSocket + 路由
│   │                     #   - 静态文件托管（UTF-8 编码处理）
│   │                     #   - /room/:roomCode 分享链接（动态 meta 标签）
│   │                     #   - WebSocket 消息路由（create/join/bid/open/challenge...）
│   │                     #   - 房间管理（创建/销毁/心跳检测）
│   │
│   ├── Room.js           # 房间状态机：游戏全生命周期管理
│   │                     #   - 阶段：waiting → rolling → bidding → challenging → settling
│   │                     #   - 功能：叫数、开骰、劈骰/反劈/认输、超时处理
│   │                     #   - 断线重连（30秒超时）、房间倒计时（10分钟）
│   │
│   ├── gameEngine.js     # 核心规则引擎（纯逻辑，无副作用）
│   │                     #   - rollDice()：摇骰
│   │                     #   - detectPattern()：牌型检测（单骰/豹子/纯豹）
│   │                     #   - countDice()：骰子计数（飞/斋模式，按 ruleSet 路由）
│   │                     #   - validateBid()：叫数合法性验证
│   │                     #   - resolveBid()：开骰判定
│   │                     #   - calculateScore()：计分
│   │                     #   - isOneWild()：判定 1 是否为万能（按预设/上下文）
│   │
│   ├── rules.js          # 玩法规则集定义（v2.5 新增）
│   │                     #   - PRESETS：深圳斋飞 / 上海骰 / 标准斋飞
│   │                     #   - SINGLE_BEHAVIORS：归零 / 正常 / 重摇
│   │                     #   - createRuleSet() / listPresets() / listSingleBehaviors()
│   │
│   └── BotPlayer.js      # AI 机器人（按 ruleSet 调整估算）
│
├── public/               # === 前端 ===
│   ├── index.html        # 页面结构（首页/等待/对局/结算/规则 5个页面）
│   │                     #   - 社交分享 meta 标签（微信/QQ/微博卡片预览）
│   │                     #   - 叫数选择器、劈骰操作区、弹幕容器
│   │
│   ├── game.js           # 前端全部逻辑
│   │                     #   - WebSocket 连接与重连
│   │                     #   - 消息处理（20+ 种消息类型）
│   │                     #   - 页面切换与 UI 渲染
│   │                     #   - 叫数选择器（智能合法性过滤）
│   │                     #   - 骰子动画、弹幕系统、计时器
│   │
│   ├── style.css         # 全部样式（暗色主题、响应式、动画）
│   └── og-image.svg      # 社交分享封面图
```

---

## 🏗️ 架构概览

```
┌──────────────────┐     WebSocket      ┌──────────────────┐
│   浏览器 (玩家A)  │◄──────────────────►│                  │
│   game.js        │                    │   server/        │
│   index.html     │                    │   index.js       │
│   style.css      │                    │     ↓            │
└──────────────────┘                    │   Room.js        │
                                        │     ↓            │
┌──────────────────┐     WebSocket      │   gameEngine.js  │
│   浏览器 (玩家B)  │◄──────────────────►│                  │
│   game.js        │                    └──────────────────┘
│   index.html     │
│   style.css      │
└──────────────────┘
```

- **前后端通信**：纯 WebSocket，JSON 格式消息
- **状态管理**：服务端为权威源（Room.js），前端仅做展示
- **规则引擎**：gameEngine.js 是纯函数，方便测试和复用

---

## 🎮 核心功能

- ✅ 2-4人在线实时对战
- ✅ 创建房间时可选人数（2/3/4人）
- ✅ **可配置玩法预设**（v2.5）：深圳斋飞 / 上海骰 / 标准斋飞（×2 / ÷2+1）
- ✅ **单骰行为三选一**（v2.5）：归零 / 正常 / 重摇（连摇 3 次单骰判负）
- ✅ 完整骰子规则（飞/斋、斋飞转换、豹子/纯豹/单骰）
- ✅ 多人轮转叫数 → 开骰 → 结算完整流程
- ✅ 劈骰系统（劈/反劈/认输，最多3次，倍数 ×2/×4/×8）
- ✅ AI 机器人陪玩（支持 2-4 人任意补位）
- ✅ 30秒操作超时自动判负
- ✅ 断线重连（30秒内自动恢复对局状态）
- ✅ 房间分享（6位房间码 + 邀请链接）
- ✅ 社交平台分享卡片（微信/QQ 预览优化）
- ✅ 弹幕聊天
- ✅ 欠杯数统计 + 连败彩蛋
- ✅ 骰子摇动动画 + 3D 翻滚 / 震屏闪白 / AirHorn 音效（v2.4）
- ✅ 损友吐槽系统 + 胜负骚话随机文案（v2.4）

---

## 🚀 本地开发

```bash
# 安装依赖
npm install

# 启动服务
npm start
# 或
node server/index.js

# 访问
# http://localhost:3000
```

---

## 📡 部署（生产环境）

**服务器**：腾讯云轻量（159.75.107.189）
**进程管理**：PM2

```bash
# 服务器上的部署流程
cd /root/dice-drink
git pull origin main
pm2 restart dice-drink

# 首次部署
git clone <repo-url> /root/dice-drink
cd /root/dice-drink
npm install
pm2 start server/index.js --name dice-drink
pm2 save
```

**访问地址**：`http://159.75.107.189:3000`

---

## 📋 版本号规则

| 版本变化 | 场景 | 举例 |
|---------|------|------|
| **x.y.Z**（补丁） | Bug 修复、小调整、文案修改 | 1.2.1 → 1.2.2 |
| **x.Y.0**（功能） | 新功能上线 | 1.2.2 → 1.3.0 |
| **X.0.0**（大版本） | 重大重构、多人模式等 | 1.3.0 → 2.0.0 |

版本号显示在首页左下角，便于确认部署是否生效。

---

## 📝 版本历史

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| v2.5.6 | 2026-04-20 | **弹幕频次下调**：`MIN_INTERVAL` 从 800ms → 1500ms；各事件概率整体下调至约原 50%（myBid 0.25→0.15、otherBid 0.4→0.22、meChallenged 0.7→0.4、otherLose 0.85→0.55、leopard 0.9→0.7 等）；移除 onOtherLose/onLeopard/onSingle/onStreak 的 `force:true`，让节流真正生效。整体约每 2-3 个动作 1 条弹幕，避免刷屏 |
| v2.5.5 | 2026-04-20 | **人设微调**：新疆炒米粉改为抖音御姐美女博主人设（"姐姐我叫这么多你敢跟吗""乖，叫声姐姐""弟弟你在抖什么"），覆盖 myBid/otherBid/meWinOpen/otherLose/leopard/myCounter/mySurrender 等 9 个分类 |
| v2.5.4 | 2026-04-20 | **人设专属弹幕**：为 12 位机器人各配 15+ 条符合人物梗的专属台词（Tom Dwan 高额桌/周润发赌神/卢本伟芜湖/陈刀仔 10 蚊/乌兹团战/布兰妮 GTO/臧书奴计算/雷军 Are you OK/童锦程兄弟们/新疆炒米粉/Tan Xuan EPT/酱酱萌萌嘎嘤嘤嘤）；`trashTalk.js` 新增 `PERSONAL_LINES` 池，`pickLine(category, nickname)` 按 60%/40% 专属/通用混排 |
| v2.5.3 | 2026-04-20 | **文案全面优化**：机器人昵称池更换（Tom Dwan/周润发/卢本伟/陈刀仔/乌兹/布兰妮/臧书奴/雷军/童锦程/新疆炒米粉/Tan Xuan/酱酱萌萌嘎）；主界面副标题 → "菜就多练"；创房页"玩法预设"→"先定规矩"去除问号/去掉场上骰子数提示；深圳/标准斋飞副标题与第一条规则精简（233/345/457）；结算页"今晚谁喝多了"→"结算今晚菜比"；再整一局按钮 "走你"→"速进"；规则悬浮按钮下移避免遮挡杯数 |
| v2.5.2 | 2026-04-20 | **玩法命名与文案精简**：经典飞斋 → **深圳斋飞**；过1不癞 → **上海骰**；北派倍率 → **标准斋飞**；每种玩法的详情文案压缩至 4-5 条核心规则 |
| v2.5.1 | 2026-04-20 | **"上海骰"重做**：改为无飞斋纯数字叫法；叫"N个1"作为升华叫法可重置起叫数；叫 1 后全局 1 不再当癞；前端对 guo1 模式自动隐藏飞斋切换按钮 |
| v2.5.0 | 2026-04-20 | **可配置玩法**：创房可选三种预设；单骰行为独立开关（归零/正常/重摇连3判负）；规则引擎重构（`server/rules.js`）；Bot 按规则集调整估算 |
| v2.4.0 | 2026-04-18 | **00后酒吧损友风**：Y2K 霓虹配色、赛博网格背景、3D骰子翻滚、震屏闪白、AirHorn 音效、损友吐槽系统、胜负骚话随机化 |
| v2.1.0 | 2026-04-17 | AI 机器人（Bot）陪玩：支持 2-4 人任意补位 |
| v2.0.0 | 2026-04-17 | **多人模式**：支持 2-4 人对战，创建房间可选人数，多人轮转叫数 |
| v1.2.1 | 2026-04-17 | 添加 README 和 RULES 文档 |
| v1.0.0 | — | 初始版本：基本双人对战功能 |

---

## 📌 WebSocket 消息协议

### 客户端 → 服务端

| 消息类型 | 说明 | 关键字段 |
|---------|------|---------|
| `create_room` | 创建房间 | `nickname`, `playerId`, `maxPlayers`, `preset`, `singleBehavior` |
| `join_room` | 加入房间 | `roomCode`, `nickname`, `playerId` |
| `bid` | 叫数 | `quantity`, `value`, `mode` |
| `open` | 开骰 | — |
| `challenge` | 劈骰 | — |
| `challenge_open` | 被劈后开骰 | — |
| `counter_challenge` | 反劈 | — |
| `surrender` | 认输 | — |
| `play_again` | 再来一局 | — |
| `leave_room` | 离开房间 | — |
| `chat` | 发送聊天 | `text` |
| `reconnect` | 重连 | `playerId` |

### 服务端 → 客户端

| 消息类型 | 说明 |
|---------|------|
| `room_created` | 房间创建成功 |
| `room_joined` | 加入房间成功 |
| `player_info` | 所有玩家信息 |
| `game_start` | 对局开始（含骰子） |
| `bid_made` | 叫数广播 |
| `challenge_started` | 劈骰开始 |
| `counter_challenge` | 反劈 |
| `game_settled` | 对局结算 |
| `timer_start` | 倒计时开始 |
| `chat_message` | 聊天消息 |
| `opponent_disconnected` / `opponent_reconnected` | 对手断线/重连 |
| `game_state` | 完整状态（重连用，含 `ruleSet`） |
| `error` | 错误提示 |

> v2.5 起，`room_created` / `room_joined` / `player_info` / `game_start` / `game_state` 均携带 `ruleSet` 字段（含 `preset`、`singleBehavior`、`oneAsWildMode`、`zhaiToFly`、`flyToZhai` 等），前端据此动态渲染规则徽章与叫数合法性。`bid_made` 新增 `onesCalled` 标志，用于"过1不癞"模式下切换 1 是否当癞。`game_settled` 新增 `type: 'singleStreak'` 分支，用于单骰重摇模式下连续 3 次单骰直接判负。

---

## 🌐 HTTP 端点

| 路径 | 方法 | 说明 |
|------|------|------|
| `/` | GET | 首页（静态） |
| `/room/:roomCode` | GET | 房间分享链接（动态 meta 标签） |
| `/api/rules` | GET | 返回所有可选玩法预设与单骰行为：`{ presets, singleBehaviors }` |
