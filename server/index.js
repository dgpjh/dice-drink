/**
 * 大话骰 - 服务端入口
 * Express + WebSocket
 */
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Room = require('./Room');
const BotPlayer = require('./BotPlayer');
const { createRuleSet, listPresets, listSingleBehaviors } = require('./rules');
const { listSkills, getSkillByNickname } = require('./skills');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// 静态文件 - 设置正确的 charset，防止中文乱码
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, filePath) => {
    // 为 HTML、CSS、JS 文件设置 UTF-8 编码
    if (filePath.endsWith('.html')) {
      res.set('Content-Type', 'text/html; charset=utf-8');
    } else if (filePath.endsWith('.css')) {
      res.set('Content-Type', 'text/css; charset=utf-8');
    } else if (filePath.endsWith('.js')) {
      res.set('Content-Type', 'application/javascript; charset=utf-8');
    }
  }
}));

// 规则预设列表（前端创房时拉取）
app.get('/api/rules', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    presets: listPresets(),
    singleBehaviors: listSingleBehaviors(),
    skills: listSkills()
  }));
});

// 编码诊断端点（部署后可通过 /debug-encoding 检查编码是否正常）
app.get('/debug-encoding', (req, res) => {
  const fs = require('fs');
  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  
  fs.readFile(htmlPath, (err, buf) => {
    const info = {
      fileExists: !err,
      fileSize: buf ? buf.length : 0,
      firstThreeBytes: buf ? [buf[0], buf[1], buf[2]].map(b => '0x' + b.toString(16)) : null,
      hasBOM: buf ? (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) : false,
      nodeVersion: process.version,
      platform: process.platform,
      encoding: 'UTF-8 test: 你好世界 🎲 大话骰',
      headers: req.headers
    };
    
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(info, null, 2));
  });
});

// 房间分享链接 - 动态注入 meta 标签 + 确保 UTF-8 编码
app.get('/room/:roomCode', (req, res) => {
  const roomCode = req.params.roomCode.toUpperCase();
  const fs = require('fs');
  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  
  // ★ 用 Buffer 方式读取，完全避免 Node.js 内部编码转换问题
  fs.readFile(htmlPath, (err, buf) => {
    if (err) {
      return res.sendFile(htmlPath);
    }
    
    // 将 Buffer 转为 UTF-8 字符串进行替换
    let html = buf.toString('utf8');
    
    // 如果文件有 BOM，去掉
    if (html.charCodeAt(0) === 0xFEFF) {
      html = html.slice(1);
    }
    
    // 获取当前请求的完整基础 URL
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers.host || req.hostname;
    const baseUrl = `${protocol}://${host}`;
    const fullUrl = `${baseUrl}/room/${roomCode}`;
    const ogImageUrl = `${baseUrl}/og-image.svg`;
    
    // 动态替换 meta 标签，让每个房间链接都有独特的预览信息
    html = html.replace(
      '<meta property="og:title" content="🎲 大话骰 - 来战！">',
      `<meta property="og:title" content="🎲 菜就多练！房间号 ${roomCode}，来摇骰子！">`
    );
    html = html.replace(
      '<meta property="og:description" content="邀请你来一局大话骰对战！摇骰子、叫数、开骰，经典酒桌游戏线上版 🎲 支持2-4人！">',
      `<meta property="og:description" content="朋友喊你来酒吧摇骰子！房间 ${roomCode}，输了就得喝 🍺">`
    );
    html = html.replace(
      '<meta name="twitter:title" content="🎲 大话骰 - 来战！">',
      `<meta name="twitter:title" content="🎲 菜就多练！房间号 ${roomCode}，来摇骰子！">`
    );
    html = html.replace(
      '<meta name="twitter:description" content="邀请你来一局大话骰对战！摇骰子、叫数、开骰，经典酒桌游戏线上版 🎲 支持2-4人！">',
      `<meta name="twitter:description" content="朋友喊你来酒吧摇骰子！房间 ${roomCode}，输了就得喝 🍺">`
    );
    html = html.replace(
      '<meta itemprop="name" content="🎲 菜就多练！摇把骰子！">',
      `<meta itemprop="name" content="🎲 菜就多练！房间号 ${roomCode}，来摇骰子！">`
    );
    html = html.replace(
      '<meta itemprop="description" content="酒吧大话骰在线版！摇骰子、叫数、开骰，输了就得喝 🍺 2-4人对战！">',
      `<meta itemprop="description" content="朋友喊你来酒吧摇骰子！房间 ${roomCode}，输了就得喝 🍺">`
    );
    
    // 添加 og:url
    html = html.replace(
      '<meta property="og:site_name" content="大话骰">',
      `<meta property="og:url" content="${fullUrl}">\n  <meta property="og:site_name" content="大话骰">`
    );
    
    // 动态替换 og:image 为完整 URL
    html = html.replace(/content="\/og-image\.svg"/g, `content="${ogImageUrl}"`);
    
    // 更新 title
    html = html.replace(
      '<title>🎲 大话骰 - 酒吧在线对战</title>',
      `<title>🎲 菜就多练！房间 ${roomCode} 等你来摇！</title>`
    );
    
    // ★ 关键：将修改后的 HTML 字符串转为 UTF-8 Buffer 再发送
    // 使用 writeHead + end(buffer) 确保编码不被任何中间层覆盖
    const resultBuffer = Buffer.from(html, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': resultBuffer.length,
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(resultBuffer);
  });
});

app.get('*', (req, res) => {
  const fs = require('fs');
  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  fs.readFile(htmlPath, (err, buf) => {
    if (err) {
      res.status(500).send('Internal Server Error');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': buf.length,
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(buf);
  });
});

// =============== 房间管理 ===============

const rooms = {};  // { roomCode: Room }
const playerRooms = {};  // { playerId: roomCode }
const bots = {};   // { playerId: BotPlayer }
const botTimers = {}; // { playerId: timer } Bot 延迟操作计时器

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms[code]);
  return code;
}

function cleanupRoom(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  room.cleanup();
  // 清理玩家映射和 Bot
  for (const pid of room.playerOrder) {
    delete playerRooms[pid];
    if (bots[pid]) {
      if (botTimers[pid]) {
        clearTimeout(botTimers[pid]);
        delete botTimers[pid];
      }
      delete bots[pid];
    }
  }
  delete rooms[roomCode];
  console.log(`[Room] 房间 ${roomCode} 已销毁`);
}

// =============== Bot 自动操作 ===============

/**
 * 检查当前回合是否轮到 Bot，如果是则自动执行操作
 */
function scheduleBotAction(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  let currentPlayerId;
  if (room.phase === 'bidding') {
    currentPlayerId = room.currentGame?.currentTurn;
  } else if (room.phase === 'challenging') {
    currentPlayerId = room.currentGame?.challenge?.currentTurn;
  } else {
    return;
  }

  if (!currentPlayerId || !bots[currentPlayerId]) return;

  const bot = bots[currentPlayerId];
  const delay = 1500 + Math.floor(Math.random() * 2000); // 1.5~3.5秒延迟，模拟思考

  // 清除之前的计时器
  if (botTimers[currentPlayerId]) {
    clearTimeout(botTimers[currentPlayerId]);
  }

  botTimers[currentPlayerId] = setTimeout(() => {
    delete botTimers[currentPlayerId];
    executeBotAction(roomCode, currentPlayerId);
  }, delay);
}

/**
 * 执行 Bot 的操作
 */
function executeBotAction(roomCode, botPlayerId) {
  const room = rooms[roomCode];
  if (!room || !bots[botPlayerId]) return;

  const bot = bots[botPlayerId];
  const player = room.players[botPlayerId];
  if (!player) return;

  const context = {
    myDice: player.dice || [],
    lastBid: room.currentGame?.lastBid || null,
    bids: room.currentGame?.bids || [],
    totalDice: room.playerOrder.length * 5,
    playerCount: room.playerOrder.length,
    phase: room.phase,
    challenge: room.currentGame?.challenge || null,
    ruleSet: room.ruleSet,
    onesCalled: !!(room.currentGame && room.currentGame.onesCalled),
    mySkill: player.skill || null,
    myPlayerId: botPlayerId,
    allPlayers: room.playerOrder.map(pid => ({
      id: pid,
      nickname: room.players[pid].nickname,
      isBot: !!room.players[pid].isBot
    }))
  };

  const decision = bot.decide(context);
  console.log(`[Bot] ${bot.nickname} 决策:`, decision.action, decision.data || '');

  let result;
  switch (decision.action) {
    case 'use_skill':
      result = room.handleUseSkill(botPlayerId, decision.data.skillId, decision.data);
      if (!result.success) {
        console.log(`[Bot] ${bot.nickname} 技能使用失败(${result.reason})，继续正常决策`);
      }
      // 技能用完继续思考 —— 再调一次（短延迟）
      setTimeout(() => executeBotAction(roomCode, botPlayerId), 600);
      return;

    case 'bid':
      result = room.handleBid(botPlayerId, {
        quantity: decision.data.quantity,
        value: decision.data.value,
        mode: decision.data.mode || 'fly'
      });
      if (!result.success) {
        // 叫数失败，改为开骰
        console.log(`[Bot] ${bot.nickname} 叫数失败(${result.reason})，改为开骰`);
        if (room.currentGame?.lastBid) {
          room.handleOpen(botPlayerId);
        }
      }
      break;

    case 'open':
      result = room.handleOpen(botPlayerId);
      if (!result.success) {
        // 开骰失败（可能没人叫过），尝试叫数
        const firstBid = bot.makeFirstBid(player.dice, room.playerOrder.length * 5);
        room.handleBid(botPlayerId, firstBid);
      }
      break;

    case 'challenge':
      result = room.handleChallenge(botPlayerId);
      if (!result.success) {
        room.handleOpen(botPlayerId);
      }
      break;

    case 'challenge_open':
      room.handleChallengeOpen(botPlayerId);
      break;

    case 'counter_challenge':
      result = room.handleCounterChallenge(botPlayerId);
      if (!result.success) {
        room.handleChallengeOpen(botPlayerId);
      }
      break;

    case 'surrender':
      room.handleSurrender(botPlayerId);
      break;
  }

  // 操作后检查是否轮到下一个 Bot
  setTimeout(() => scheduleBotAction(roomCode), 200);
}

/**
 * Bot 自动点"再来一局"
 */
function scheduleBotPlayAgain(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  for (const pid of room.playerOrder) {
    if (bots[pid]) {
      const delay = 1000 + Math.floor(Math.random() * 2000);
      setTimeout(() => {
        if (rooms[roomCode] && room.phase === 'settling') {
          room.handlePlayAgain(pid);
        }
      }, delay);
    }
  }
}

/**
 * 处理 Bot 通过 fakeWs 收到的消息
 */
function handleBotMessage(roomCode, botId, msg) {
  const { type, data } = msg;

  switch (type) {
    case 'game_start':
      // 游戏开始，检查是否轮到 Bot
      setTimeout(() => scheduleBotAction(roomCode), 500);
      break;

    case 'bid_made':
      // 有人叫数了，检查下一个是否是 Bot
      setTimeout(() => scheduleBotAction(roomCode), 200);
      break;

    case 'challenge_started':
    case 'counter_challenge':
      // 劈骰相关，检查是否轮到 Bot
      setTimeout(() => scheduleBotAction(roomCode), 200);
      break;

    case 'game_settled':
      // 结算了，Bot 自动"再来一局"
      scheduleBotPlayAgain(roomCode);
      break;

    case 'timer_start':
      // 计时器开始，确保 Bot 在超时前操作
      setTimeout(() => scheduleBotAction(roomCode), 300);
      break;
  }
}

// =============== WebSocket ===============

wss.on('connection', (ws) => {
  let playerId = null;
  let currentRoomCode = null;

  // 心跳
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }

    const { type, data } = msg;

    switch (type) {
      case 'create_room': {
        playerId = data.playerId || uuidv4();
        const nickname = data.nickname || '玩家1';
        const maxPlayers = Math.min(Math.max(parseInt(data.maxPlayers) || 2, 2), 4);
        const presetId = data.preset || 'classic';
        const singleBehavior = data.singleBehavior || 'zero';
        const skillMode = ['none', 'random', 'choose'].includes(data.skillMode) ? data.skillMode : 'none';
        const ruleSet = createRuleSet(presetId, singleBehavior);
        const roomCode = generateRoomCode();
        const room = new Room(roomCode, playerId, maxPlayers, ruleSet, skillMode);
        rooms[roomCode] = room;
        room.addPlayer(playerId, nickname, ws);
        playerRooms[playerId] = roomCode;
        currentRoomCode = roomCode;

        ws.send(JSON.stringify({
          type: 'room_created',
          data: {
            roomCode,
            playerId,
            nickname,
            maxPlayers,
            ruleSet,
            skillMode,
            roomInfo: room.getRoomInfo()
          }
        }));
        console.log(`[Room] ${nickname} 创建房间 ${roomCode}（${maxPlayers}人, ${ruleSet.presetName}, 单骰:${ruleSet.singleBehaviorName}, 技能模式:${skillMode}）`);
        break;
      }

      case 'join_room': {
        const roomCode = (data.roomCode || '').toUpperCase();
        const room = rooms[roomCode];

        if (!room) {
          ws.send(JSON.stringify({
            type: 'error',
            data: { message: '房间不存在或已关闭' }
          }));
          return;
        }

        if (room.phase !== Room.PHASE.WAITING) {
          // 检查是否是重连
          if (data.playerId && room.players[data.playerId]) {
            playerId = data.playerId;
            currentRoomCode = roomCode;
            room.handleReconnect(playerId, ws);
            playerRooms[playerId] = roomCode;
            console.log(`[Room] ${room.players[playerId].nickname} 重连到房间 ${roomCode}`);
            return;
          }
          ws.send(JSON.stringify({
            type: 'error',
            data: { message: '房间已在游戏中' }
          }));
          return;
        }

        playerId = data.playerId || uuidv4();
        const nickname = data.nickname || '玩家2';
        const result = room.addPlayer(playerId, nickname, ws);

        if (!result.success) {
          ws.send(JSON.stringify({
            type: 'error',
            data: { message: result.reason }
          }));
          return;
        }

        playerRooms[playerId] = roomCode;
        currentRoomCode = roomCode;

        ws.send(JSON.stringify({
          type: 'room_joined',
          data: {
            roomCode,
            playerId,
            nickname,
            roomInfo: room.getRoomInfo()
          }
        }));

        console.log(`[Room] ${nickname} 加入房间 ${roomCode}`);

        // 人满，自动开始
        if (room.playerOrder.length === room.maxPlayers) {
          setTimeout(() => {
            room.startGame();
            // 游戏开始后检查是否轮到 Bot
            setTimeout(() => scheduleBotAction(roomCode), 500);
          }, 2000);
        }
        break;
      }

      case 'bid': {
        const room = rooms[currentRoomCode];
        if (!room) return;
        const result = room.handleBid(playerId, {
          quantity: data.quantity,
          value: data.value,
          mode: data.mode || 'fly'
        });
        if (!result.success) {
          ws.send(JSON.stringify({
            type: 'error',
            data: { message: result.reason }
          }));
        }
        break;
      }

      case 'open': {
        const room = rooms[currentRoomCode];
        if (!room) return;
        const result = room.handleOpen(playerId);
        if (!result.success) {
          ws.send(JSON.stringify({
            type: 'error',
            data: { message: result.reason }
          }));
        }
        break;
      }

      case 'challenge': {
        const room = rooms[currentRoomCode];
        if (!room) return;
        const result = room.handleChallenge(playerId);
        if (!result.success) {
          ws.send(JSON.stringify({
            type: 'error',
            data: { message: result.reason }
          }));
        }
        break;
      }

      case 'challenge_open': {
        const room = rooms[currentRoomCode];
        if (!room) return;
        const result = room.handleChallengeOpen(playerId);
        if (!result.success) {
          ws.send(JSON.stringify({
            type: 'error',
            data: { message: result.reason }
          }));
        }
        break;
      }

      case 'counter_challenge': {
        const room = rooms[currentRoomCode];
        if (!room) return;
        const result = room.handleCounterChallenge(playerId);
        if (!result.success) {
          ws.send(JSON.stringify({
            type: 'error',
            data: { message: result.reason }
          }));
        }
        break;
      }

      case 'surrender': {
        const room = rooms[currentRoomCode];
        if (!room) return;
        const result = room.handleSurrender(playerId);
        if (!result.success) {
          ws.send(JSON.stringify({
            type: 'error',
            data: { message: result.reason }
          }));
        }
        break;
      }

      case 'play_again': {
        const room = rooms[currentRoomCode];
        if (!room) return;
        room.handlePlayAgain(playerId);
        break;
      }

      case 'use_skill': {
        const room = rooms[currentRoomCode];
        if (!room) return;
        const result = room.handleUseSkill(playerId, data.skillId, {
          targetId: data.targetId,
          diceIndex: data.diceIndex
        });
        if (!result.success) {
          ws.send(JSON.stringify({ type: 'error', data: { message: result.reason } }));
        }
        break;
      }

      case 'choose_skill': {
        const room = rooms[currentRoomCode];
        if (!room) return;
        const result = room.chooseSkill(playerId, data.skillId);
        if (!result.success) {
          ws.send(JSON.stringify({ type: 'error', data: { message: result.reason } }));
        }
        break;
      }

      case 'leave_room': {
        const room = rooms[currentRoomCode];
        if (!room) return;

        // 通知所有其他玩家
        for (const pid of room.playerOrder) {
          if (pid !== playerId) {
            room.sendTo(pid, 'opponent_left', {
              playerId,
              nickname: room.players[playerId].nickname,
              message: `${room.players[playerId].nickname} 已离开房间`
            });
          }
        }

        cleanupRoom(currentRoomCode);
        currentRoomCode = null;
        break;
      }

      case 'chat': {
        const room = rooms[currentRoomCode];
        if (!room || !playerId) return;
        const chatText = (data.text || '').trim().substring(0, 30);
        if (!chatText) return;
        // 广播给房间内所有人
        room.broadcast('chat_message', {
          playerId,
          nickname: room.players[playerId]?.nickname || '???',
          text: chatText,
          timestamp: Date.now()
        });
        break;
      }

      case 'reconnect': {
        const pid = data.playerId;
        const rc = playerRooms[pid];
        if (rc && rooms[rc]) {
          playerId = pid;
          currentRoomCode = rc;
          rooms[rc].handleReconnect(pid, ws);
          console.log(`[Room] ${rooms[rc].players[pid]?.nickname} 重连到房间 ${rc}`);
        } else {
          ws.send(JSON.stringify({
            type: 'reconnect_failed',
            data: { message: '房间已不存在' }
          }));
        }
        break;
      }

      case 'add_bot': {
        const room = rooms[currentRoomCode];
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', data: { message: '房间不存在' } }));
          return;
        }
        if (room.phase !== Room.PHASE.WAITING) {
          ws.send(JSON.stringify({ type: 'error', data: { message: '游戏已开始，无法添加机器人' } }));
          return;
        }
        if (room.playerOrder.length >= room.maxPlayers) {
          ws.send(JSON.stringify({ type: 'error', data: { message: '房间已满' } }));
          return;
        }

        // 获取已有机器人昵称（去掉 🤖 前缀后再比对，避免重名）
        const existingNames = room.playerOrder
          .map(pid => room.players[pid].nickname || '')
          .map(n => n.replace(/^🤖/, ''));
        const botId = 'bot_' + uuidv4().substring(0, 8);
        const botNameRaw = BotPlayer.getRandomName(existingNames);
        const botNickname = '🤖' + botNameRaw;
        const bot = new BotPlayer(botId, botNickname);
        bots[botId] = bot;

        // 机器人的技能 = 人设绑定（NICKNAME_TO_SKILL）；仅在 skillMode !== 'none' 时生效
        const presetSkill = room.skillMode === 'none' ? null : getSkillByNickname(botNameRaw);

        // 用一个假的 ws（Bot 不需要真正的 WebSocket）
        const fakeWs = {
          send: (msg) => {
            // Bot 收到的消息可以触发后续操作
            try {
              const parsed = JSON.parse(msg);
              handleBotMessage(currentRoomCode, botId, parsed);
            } catch (e) {}
          },
          readyState: 1 // WebSocket.OPEN
        };

        const result = room.addPlayer(botId, botNickname, fakeWs, {
          isBot: true,
          presetSkill
        });
        if (!result.success) {
          ws.send(JSON.stringify({ type: 'error', data: { message: result.reason } }));
          delete bots[botId];
          return;
        }

        playerRooms[botId] = currentRoomCode;
        console.log(`[Bot] ${botNickname} 加入房间 ${currentRoomCode}${presetSkill ? `（技能: ${presetSkill}）` : ''}`);

        // 如果房间满了，2秒后自动开始
        if (room.playerOrder.length === room.maxPlayers) {
          setTimeout(() => {
            room.startGame();
            // 游戏开始后检查是否轮到 Bot
            setTimeout(() => scheduleBotAction(currentRoomCode), 500);
          }, 2000);
        }
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    if (playerId && currentRoomCode) {
      const room = rooms[currentRoomCode];
      if (room && room.players[playerId]) {
        room.handleDisconnect(playerId);
        console.log(`[Room] ${room.players[playerId].nickname} 断线`);
      }
    }
  });
});

// 心跳检测（每5秒）
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 5000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎲 大话骰服务器启动: http://localhost:${PORT}`);
});
