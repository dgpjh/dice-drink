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

// 房间分享链接 - 动态注入 meta 标签 + 确保 UTF-8 编码
app.get('/room/:roomCode', (req, res) => {
  const roomCode = req.params.roomCode.toUpperCase();
  const fs = require('fs');
  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  
  fs.readFile(htmlPath, 'utf8', (err, html) => {
    if (err) {
      return res.sendFile(htmlPath);
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
      `<meta property="og:title" content="🎲 大话骰 - 邀你对战！房间号 ${roomCode}">`
    );
    html = html.replace(
      '<meta property="og:description" content="邀请你来一局大话骰对战！摇骰子、叫数、开骰，经典酒桌游戏线上版 🎲">',
      `<meta property="og:description" content="你的朋友邀请你来一局大话骰！点击链接直接加入房间 ${roomCode}，一起摇骰子对战 🎲">`
    );
    html = html.replace(
      '<meta name="twitter:title" content="🎲 大话骰 - 来战！">',
      `<meta name="twitter:title" content="🎲 大话骰 - 邀你对战！房间号 ${roomCode}">`
    );
    html = html.replace(
      '<meta name="twitter:description" content="邀请你来一局大话骰对战！摇骰子、叫数、开骰，经典酒桌游戏线上版 🎲">',
      `<meta name="twitter:description" content="你的朋友邀请你来一局大话骰！点击链接直接加入房间 ${roomCode} 🎲">`
    );
    html = html.replace(
      '<meta itemprop="name" content="🎲 大话骰 - 来战！">',
      `<meta itemprop="name" content="🎲 大话骰 - 邀你对战！房间号 ${roomCode}">`
    );
    html = html.replace(
      '<meta itemprop="description" content="邀请你来一局大话骰对战！摇骰子、叫数、开骰，经典酒桌游戏线上版 🎲">',
      `<meta itemprop="description" content="你的朋友邀请你来一局大话骰！点击链接加入房间 ${roomCode} 🎲">`
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
      '<title>🎲 大话骰 - 双人在线对战</title>',
      `<title>🎲 大话骰 - 房间 ${roomCode} 邀你对战！</title>`
    );
    
    // ★ 关键：明确设置 Content-Type 为 UTF-8，防止浏览器/QQ/微信乱码
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });
});

app.get('*', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
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
        const roomCode = generateRoomCode();
        const room = new Room(roomCode, playerId);
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
            roomInfo: room.getRoomInfo()
          }
        }));
        console.log(`[Room] ${nickname} 创建房间 ${roomCode}`);
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

        // 双人到齐，自动开始
        if (room.playerOrder.length === 2) {
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

        const opId = room.getOpponent(playerId);
        if (opId) {
          room.sendTo(opId, 'opponent_left', {
            nickname: room.players[playerId].nickname,
            message: '对方已离开房间'
          });
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
