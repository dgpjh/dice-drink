# 🎲 大话骰 - 酒吧在线对战

> 经典酒桌游戏线上版！支持 2-4 人在线对战，摇骰子、叫数、开骰，输了就得喝 🍺

**当前版本：v2.7.2**

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
| v2.7.2 | 2026-04-29 | **🔥 重大规则 BUG 修复（劈骰链开骰判定错误）+ 赛制 4 项继续优化**：① **核心 BUG**：劈骰链中"偶数次反劈"后由叫数方（lastBidder/target）开骰时，旧代码按"opener 始终赌不成立"推导胜负，把 target 当成押"不成立"判反！典型场景：A 叫 4 个 5（target=A），B 不信 → B 劈（initiator=B）→ A 反劈 → B 再反劈（×8 上限）→ A 必须 open/surrender。A 选 open，真值有 4 个 5 叫数成立，按规则应「劈方 B 输 8 杯」，但旧代码用 opener=A + bidEstablished=true → 判 loser=A（错！）。**所有"偶数次反劈后 lastBidder open"的局都被判反了**。修复：劈骰链 open 完全不看 opener 是谁，只看叫数本身——成立则 initiator(劈方)输、不成立则 target(叫数方)输（**reflects 押注方向永远不变**，反劈只是踢回赌注 + 提高倍数）。同步在 RULES.md 新增「劈骰链开骰胜负判定」章节明确规则。② **机器人 AI 同步修正**：BotPlayer.decideChallenge 之前不区分自己角色一律按 credibility 决策（旧 BUG 下错错相消看不出问题）；现根据 `myPlayerId === challenge.initiator` 区分押注方向，target 在 credibility 高时主动 open（赢面大）而非保守 surrender，让 bot 决策更合理。③ **`_checkMatchEnd` 加 pendingFinish 守卫**：防御异常 broadcastSettled 重入导致 roundsPlayed 多 +1。④ **定时间到 + SETTLING 路径补 pendingFinish**：v2.7.1 仅在 `_checkMatchEnd` 路径设 `pendingFinish`，但定时间到的 4 秒延迟 finish 路径漏了，4 秒内机器人 play_again 凑齐仍会触发 startGame BUG；现在该路径也立即设 `pendingFinish=true` + 同步广播 progress 让前端按钮立即置灰。⑤ **重连恢复 finalRanking 用时虚高**：v2.7.1 重连时 `durationMs` 用 `Date.now() - startedAt` 计算，赛制结束 N 分钟后重连会显示用时多 N 分钟；现 `_finishMatch` 缓存 `finishedAt + matchDurationMs`，重连直接用缓存值。⑥ **重连恢复时钟偏差**：v2.7.1 仅在 `match_started` 下发 `durationMs` 修了客户端时钟偏差，重连场景 `_getMatchProgress` 仍用服务器 endsAt 没修；现 `match_progress` 加 `remainingMs` 字段，前端 handleGameStateRestore 重连时用「Date.now() + remainingMs」算本地 endsAt。 |
| v2.7.1 | 2026-04-29 | **🏁 赛制系统体验 8 项优化**（v2.7.0 上线后自查 + 用户反馈）：① **关键并发 BUG 修复**：定时间/局数/找菜比/总杯模式触发整场结束时，服务端用 1500ms 延迟广播 `match_finished` 让结算页先展示，但这 1.5s 内机器人会自动调 `play_again` 凑齐人数触发 `startGame` 开新局，新局 BIDDING 后才执行 `_finishMatch` 把 phase 改成 FINISHED → 前端卡死；现新增 `matchState.pendingFinish` 抢占式标记，1.5s 缓冲期内 `startGame`/`handlePlayAgain` 全部拒绝；② **"再来一局"按钮反馈**：最后一局结算页用户秒点"再来一局"会被服务端静默 return 没反馈；现新增 `play_again_blocked` 消息推送 + `match_progress.pendingFinish` 字段同步，前端立刻把按钮置灰显示「🏁 等待最终排名...」；③ **客户端时钟偏差修复**：定时间模式倒计时基于服务端 `endsAt`，但客户端时钟偏差大（手机时间不准）会导致剩余时间错乱；现服务端 `match_started` 同时下发 `durationMs`，前端用「收到消息时刻 + durationMs」算本地 endsAt，并在后续 `match_progress` 中沿用首次算好的 endsAt 不被覆盖；④ **定时间模式时间到 + 结算页同时发生 → "共打 N 局"少 1 局**：原代码在 SETTLING 时立即 `_finishMatch`，跳过了当前局的 `_checkMatchEnd` 计数；现改为延迟 4 秒（够前端 toast 提示用户"即将公布最终排名"），让当前局先走完 `_checkMatchEnd` +1 计数再结束；⑤ **进度条/弹幕容器重叠**：进度条 `top:4px z-index:60` 和弹幕容器 `top:4px z-index:40 height:76px` 重叠导致进度条遮挡弹幕第一行；现 game-container 加 `.has-match-bar` 联动类，赛制激活时弹幕容器自动下移 32px（top 4→36, height 76→64）；⑥ **房间资源泄露兜底**：用户在最终排名页关闭浏览器/不点"回首页"，服务端房间永远不被销毁；现 `_finishMatch` 后 5 分钟自动 `_onFinishCleanup()` 销毁房间（5 分钟内重连还能看到 finalRanking）；⑦ **结束原因加图标 + 用时精确化**：排名页 `final-reason` 前缀加 ⏱/🔢/🎯/🍺 emoji；用时显示从「约 N 分钟」（30秒显示 1 分钟太粗）改为「N 秒」(<1分钟) / 「N 分 M 秒」 / 「N 分钟」（整分），更精准；⑧ **等待页加赛制徽章**：原本只在游戏页才显示当前赛制，新加入的玩家在等待页看不到「这房间是定时间 5 分钟」还是「找菜比 10 杯」；现等待页加橙色 `.match-mode-badge`，非自由模式自动显示「🏁 赛制：定时间 5 分钟」；⑨ **进度条文案纠偏**：定局数模式当 `roundsPlayed=target` 即 pendingFinish 状态时，旧代码显示「第 5/5 局」误导用户以为还有一局，现改为「已完成 5/5 局」+ urgent 红色脉冲。**实现要点**：服务端 `_getMatchProgress` 统一带上 `currentMax/currentTotal/pendingFinish/serverNow` 全量字段，前端各模式都能混用；`maxLoss/totalLoss` 模式 `match_started` 也带初始值 0 让进度条秒出。 |
| v2.7.0 | 2026-04-28 | **🏁 赛制系统（4 种房间模式 + 最终排名页）**：创房新增「赛制模式」选择，可选 5 种之一：① **自由模式**（默认）：不限时间和局数，沿用以前"再来一局"的玩法；② **⏱ 定时间**（2~10 分钟）：服务端 setTimeout 全局倒计时，前端顶部进度条每秒刷新「剩余 M:SS」，时间到后当前局结束才公布排名（`match_time_up` 提示），最后 30s 进度条变红脉冲；③ **🔢 定局数**（3~20 局）：每局结束 +1，到达上限即结束；④ **🎯 找菜比**（3~30 杯封顶）：任一玩家欠杯达到上限即结束，触发那把可能超杯（如上限 30 杯，玩家已欠 29 杯，被劈再输 2 杯，实际结算展示 31 杯，符合用户要求的边界规则）；⑤ **🍺 定总杯**（3~100 杯封顶）：所有玩家欠杯总和达到上限即结束（同样允许超杯结算）。**最终排名页**：赛制结束后弹出 `🏆 比赛结束！` 全屏页，按总欠杯数升序排名（同分并列），冠军 🥇 / 亚军 🥈 / 季军 🥉 / 末名"菜比"红框高亮，自己一行金边强调；展示战绩（X 胜 Y 负 / 胜率 / 总欠杯数）+ 比赛信息（共打 N 局 / 用时约 M 分钟 / 结束原因）。**实现要点**：① 服务端 `Room.matchConfig + matchState`（`_normalizeMatchConfig` 限定范围 + `_startMatchIfNeeded` 启动 setTimeout + `_checkMatchEnd` 在 `broadcastSettled` 钩子里挂 4 种结束判定 + `_finishMatch` 计算排名+广播 `match_finished`）；② 前端 `match_started/match_progress/match_time_up/match_finished` 4 个新消息处理；③ 顶部 `.match-progress-bar` + 5 个文案模板（time/rounds/maxLoss/totalLoss）；④ 重连恢复：`sendGameState` 附带 `matchConfig + matchProgress + matchFinished` 快照，重连到已结束的房间直接显示排名页；⑤ HTML 新增 `#page-final-ranking`（trophy + reason + meta + ranking-list + 回首页按钮），CSS 加金/银/铜/末名/is-me 5 种排名样式 + trophy 弹跳动画 + 标题金渐变 |
| v2.6.6 | 2026-04-27 | **UI 遮挡 6 项修复**（用户反复反馈）：① **规则 📖 按钮挪位**：从 `top:110px right:10px` 移到 `bottom:60px right:8px`，缩小到 32px + 半透明 + backdrop-filter，彻底不再遮挡第二个对手卡片的「🍺 欠杯：X」分数；② **弹幕容器限高**：从 `top:80px height:200px`（覆盖整个对手区+叫骰记录区）压到 `top:4px height:76px`（仅顶部 2 条 lane），同时 `z-index 50→40` 让位给规则按钮；前端 `showDanmaku` 同步把 `maxLanes` 改为读容器实际高度，避免硬编码 200 失配；③ **弹幕单条限宽**：`max-width:70% + ellipsis`，避免长昵称+长聊天在 360 屏飞出可视区；④ **player-header 长昵称溢出**：加 `gap:8px / min-width:0`，name 加 `flex:1 + ellipsis`，score 加 `flex:0 0 auto + nowrap`，8 字昵称 + 3 位欠杯不再换行/挤出布局；⑤ **bid-item 长昵称溢出**：`.bid-player` 加 ellipsis，`.bid-content` 加 `word-break:break-word`；⑥ **toast 多行 + 提层级**：加 `white-space:pre-line` 让规则预设说明 `\n` 真正换行展示，`z-index 2000→3500` 让断线遮罩中也能看到提示 |
| v2.6.5 | 2026-04-27 | **服务端 6 项稳健性修复**（深度自查后）：① **斧头帮反劈判定修正**：`handleSurrender` 原判断发起劈骰方是不是斧头帮，但反劈后 `currentTurn` 会在 initiator/target 间切换，实际应查"当前认输者的对手"是不是斧头帮，否则会出现 A 斧头帮发劈→B 反劈→A 反劈→B 认输，错误放行的情况；② **超时判负缺连败/单骰计数重置**：`handleTurnTimeout` 结算后未更新 `streak` 与 `singleStreak`，导致超时输的人连败/连续单骰数据错乱；③ **断线超时结算双 winner 作用域污染**：`handleDisconnectTimeout` 有两个 `winner` 变量（if 内与 if 外），CHALLENGING 场景下 if 外的 winner 可能取到劈骰之外的第三人，导致 stats 加给 A、广播赢家是 B；同时补充 SETTLING/WAITING 阶段不做结算、全员掉线时不广播的边界；④ **handleBid 防御客户端伪造数据**：`bid=null / "abc"` 直接访问 `bid.value` 会崩，现加 `typeof`、`quantity/value/mode` 合法性校验；⑤ **handlePlayAgain 加 phase 校验**：之前任意阶段都能累积 `_playAgain`，BIDDING 时被恶意打的请求可能直接把计数凑满触发提前 `startGame`，现限制只能在 `SETTLING` 阶段；⑥ **认输/普通结算补 singleStreak 重置**：与连续单骰判负/超时/断线路径对齐，输家的连续单骰计数在每次"真正输"后都清零 |
| v2.6.4 | 2026-04-27 | **C端体验 9 连修**：① 透视骰子持久化（renderAllOpponentDice 恢复 peekedMap）；② 劈骰等待文案（"B 正在劈 A"）；③ 认输/超时/断线/连摇单骰结算页（noRevealTypes 隐藏骰子区改占位）；④ 封口 pending 徽章（updateSkillBar 渲染 🔒 待触发）；⑤ 重连恢复封口状态（silencerBy/Target + pendingSilencer）；⑥ 再来一局按钮闪烁（playAgainClicked 标记）；⑦ 同名玩家自动加后缀；⑧ 弹幕 lane 占用表替代 lane++；⑨ unlockSound once:true + 房间码输入框实时规范化 |
| v2.6.3 | 2026-04-24 | **断线重连全面修复 + 封口退款**：① 前端 `handleGameStateRestore` 重连时补读 `data.skillMode` 和 `data.you.skill`，此前断线重连后技能栏消失、自选模式技能模式徽章错乱；② 重连到结算阶段时服务端附带 `lastSettlement` 快照，前端据此渲染完整结算页（胜负/骰子/开骰结果），此前只能看到空白统计页；③ 封口技能激活后若本人当即开骰/劈骰（未走叫数路径），现在会撤销 `used` 标记（封口"退款"），本局还能再用一次 |
| v2.5.7 | 2026-04-21 | **机器人体验优化**：1) 同房间机器人昵称去重（`server/index.js` 过滤 `existingNames` 时 strip 🤖 前缀，修复 `BotPlayer.getRandomName` 永远失效的 bug，避免"2个同名机器人"）；2) 弹幕发言者仅限机器人（`public/trashTalk.js` 新增 `isBot/pickBotSpeaker`，`fire()` 只在场上机器人中挑 speaker，真人玩家不再"自言自语"；无机器人时静默不发） |
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
| `skill_used` | 某人使用了技能的公开广播（v2.6） |
| `skill_peek_result` | 透视结果（仅发给使用者，含骰子值）（v2.6） |
| `skill_reroll_result` | 换骰/大换骰结果（仅发给使用者）（v2.6） |
| `skill_peeked` | 被透视提示（仅发给被看者）（v2.6） |
| `skill_choose_progress` | 自选模式：某人选/改技能的进度广播（v2.6.1） |
| `skill_choose_waiting` | 自选模式：满员但仍有人未选时的等待提示（v2.6.1） |
| `play_again_blocked` | 整场比赛即将结束（pendingFinish）时拒绝"再来一局"的反馈（v2.7.1） |

> **v2.7.2 紧急修复（劈骰链开骰判定 + 赛制 4 项）**：🔥 **重大规则 BUG**：劈骰链中"偶数次反劈"后由叫数方（lastBidder/target）开骰时，旧代码用 `opener=A` 推导胜负，把"赌成立的人"当成"赌不成立的人"判反！举例：A 叫 4 个 5 → B 劈 → A 反劈 → B 再反劈（×8）→ A 必须 open，真值 4 个 5 ≥ 4 叫数成立，按规则**应 B 输**，但旧代码判 A 输。修复：劈骰链 open 完全不看 opener，只按"叫数成立 → initiator(劈方)输 / 不成立 → target(叫数方)输"判定（见 RULES.md 新增「劈骰链开骰胜负判定」章节）。同步修 BotPlayer.decideChallenge：根据自己是 initiator/target 区分押注方向，credibility 高时 target 应 open（赢面大）而非 surrender。**赛制 4 项**：① `_checkMatchEnd` 加 `pendingFinish` 守卫防御异常重入导致 roundsPlayed 多 +1；② 定时间到 + SETTLING 路径也设 `pendingFinish=true`（v2.7.1 仅修了 `_checkMatchEnd` 路径，定时间到的 4 秒延迟内机器人 play_again 凑齐仍会触发 startGame BUG）+ 同步广播一次 progress 让前端按钮立即置灰；③ `_finishMatch` 缓存 `finishedAt + matchDurationMs`，重连时 finalRanking 用缓存值（不用"重连时刻 - startedAt"反算导致用时虚高）；④ `_getMatchProgress` 加 `remainingMs`，前端重连时用「Date.now() + remainingMs」算本地 endsAt（v2.7.1 仅在 match_started 修了时钟偏差，重连场景仍有问题）。

> **v2.7.1 修复（赛制系统体验 8 项）**：① 抢占式 `pendingFinish` 标记修复 1.5s 缓冲期内机器人触发 `startGame` 导致前端卡死的并发 BUG；② 最后一局结算页"再来一局"按钮服务端推 `play_again_blocked` + 前端立即置灰显示「等待最终排名」；③ 客户端时钟偏差修复（`match_started.durationMs` 让前端基于"收到时刻"算 endsAt）；④ 定时间 + 结算页同时发生时延迟 4 秒 finish 让局数 +1 计入；⑤ 进度条/弹幕容器重叠修复（`.has-match-bar` 类联动弹幕容器下移）；⑥ 房间资源泄露兜底（最终排名后 5 分钟自动 cleanup）；⑦ 排名页结束原因加 emoji + 用时改为「N 秒/N 分 M 秒/N 分钟」更精准；⑧ 等待页加赛制徽章「🏁 赛制：定时间 5 分钟」。

> **v2.7.0 新功能（赛制系统）**：创房新增 4 种结束模式 + 自由模式：① 定时间（2-10 分钟，到点本局结束后公布排名，最后 30s 进度条变红）；② 定局数（3-20 局）；③ 找菜比（任一玩家欠杯达 3-30 杯结束）；④ 定总杯（全员欠杯总和达 3-100 杯结束）。比赛结束后弹出 🏆 最终排名页，按总欠杯升序排名（金/银/铜/末名 4 种样式 + 自己金边高亮 + 比赛信息）。新消息：`match_started` / `match_progress` / `match_time_up` / `match_finished`。重连恢复完整赛制状态（含已结束直接跳排名页）。

> **v2.6.5 修复（服务端稳健性）**：① 斧头帮反劈判定从 initiator 改为"当前认输者的对手"；② 超时判负补 streak/singleStreak 重置；③ 断线超时结算统一 winner 选择逻辑，避免 stats/广播不一致；④ handleBid 校验 bid 数据合法性（防御客户端伪造）；⑤ handlePlayAgain 限制在 SETTLING 阶段；⑥ 认输与普通开骰结算补 singleStreak 重置。

> **v2.6.4 修复**：① 透视骰子被重绘刷白（恢复 peekedMap）；② 劈骰等待文案显示"B 正在劈 A"；③ 认输/超时结算页隐藏骰子区改占位文案；④ 封口 pending 徽章常驻；⑤ 重连恢复封口状态（silencerBy/Target/pendingSilencer）；⑥ "再来一局"按钮闪烁；⑦ 同名玩家自动加后缀；⑧ 弹幕 lane 占用表防覆盖；⑨ unlockSound once:true + 房间码输入框实时规范化。

> **v2.6.3 修复**：① 断线重连前端补读 `skillMode` 和 `mySkill`（否则自选模式重连后技能栏消失）；② `game_state` 在 phase=settling 时新增 `lastSettlement` 字段（上一局结算完整快照），前端断线瞬间恰逢结算也能看到胜负/骰子/倍数；③ 封口激活后若本人直接开/劈，服务端撤销技能 `used` 标记（封口不再白用）。

> **v2.6.2 修复**：① **劈骰胜负判定 bug**：反劈偶数次后 opener 可能等于 lastBidder，旧代码会同时把同一个人当 winner 和 loser，导致结果页胜负错乱。现改为劈骰分支下用 `challenge.initiator ↔ target` 两人对决（参考 `resolveGame`）。② **后加入玩家无法选技能**：非房主用户没点过"创建房间"弹窗，前端 `state.skillsCatalog` 为空。现在 `updateSkillChoosePanel` 内部兜底调用 `ensureRulesCatalog()`。③ **换骰技能禁用条件修正**：前端把"全场有任何叫数"当禁用条件，导致非先手玩家永远用不了；现改为"自己本局已叫过数"才禁用（和服务端一致）。④ 好运姐 1 点概率从 1/5 上调至 **1/4**（其他点数各 3/20）。

> **v2.6.1 调整**：① 换骰/大换骰改为仅能在自己**本局第一次叫数前**使用（之前是"本局还没有任何叫数"）；② 自选模式下所有玩家选完技能才会开局，期间在 waiting 页实时展示选人进度；③ 机器人使用主动技能的概率下调（透视 35→17%，换骰 60→30%，大换骰 70→35%，封口 40→20%）。

> v2.6 起，`room_created` / `room_joined` / `player_info` / `game_start` / `game_state` 均携带 `skillMode` 字段（`none` / `random` / `choose`），以及 `you.skill` / `playerOrder[].skill` 的技能信息（含 `id/name/icon/type/desc/used`）。`bid_made` 新增 `silencerOn / silencerBy / silencerTarget` 字段，前端据此禁用被封口玩家的叫数按钮。

> v2.5 起，`room_created` / `room_joined` / `player_info` / `game_start` / `game_state` 均携带 `ruleSet` 字段（含 `preset`、`singleBehavior`、`oneAsWildMode`、`zhaiToFly`、`flyToZhai` 等），前端据此动态渲染规则徽章与叫数合法性。`bid_made` 新增 `onesCalled` 标志，用于"过1不癞"模式下切换 1 是否当癞。`game_settled` 新增 `type: 'singleStreak'` 分支，用于单骰重摇模式下连续 3 次单骰直接判负。

---

## 🌐 HTTP 端点

| 路径 | 方法 | 说明 |
|------|------|------|
| `/` | GET | 首页（静态） |
| `/room/:roomCode` | GET | 房间分享链接（动态 meta 标签） |
| `/api/rules` | GET | 返回所有可选玩法预设与单骰行为：`{ presets, singleBehaviors }` |
