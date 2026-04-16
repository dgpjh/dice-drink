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

// 静态文件
app.use(express.static(path.join(__dirname, '..', 'public')));

// 所有路由指向 index.html（SPA）
app.get('/room/:roomCode', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('*', (req, res) => {
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
