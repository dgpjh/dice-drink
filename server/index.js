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
  // 清理玩家映射
  for (const pid of room.playerOrder) {
    delete playerRooms[pid];
  }
  delete rooms[roomCode];
  console.log(`[Room] 房间 ${roomCode} 已销毁`);
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
        const roomCode = generateRoomCode();
        const room = new Room(roomCode, playerId, maxPlayers);
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
            roomInfo: room.getRoomInfo()
          }
        }));
        console.log(`[Room] ${nickname} 创建房间 ${roomCode}（${maxPlayers}人）`);
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
