/**
 * 大话骰 - 房间管理
 * 包含：房间创建/加入、游戏状态机、超时处理、断线重连
 */
const GameEngine = require('./gameEngine');

// 游戏阶段
const PHASE = {
  WAITING: 'waiting',      // 等待对手
  ROLLING: 'rolling',      // 摇骰阶段
  BIDDING: 'bidding',      // 叫数阶段
  CHALLENGING: 'challenging', // 劈骰阶段
  SETTLING: 'settling',    // 结算阶段
  FINISHED: 'finished'     // 结束
};

class Room {
  constructor(roomCode, hostPlayerId) {
    this.roomCode = roomCode;
    this.createdAt = Date.now();
    this.phase = PHASE.WAITING;

    // 玩家
    this.players = {};  // { playerId: { id, nickname, ws, dice, connected, disconnectedAt } }
    this.playerOrder = []; // [playerId1, playerId2]

    // 对局状态
    this.currentGame = null;

    // 战绩
    this.stats = {};  // { playerId: { wins, losses, totalScore } }

    // 超时计时器
    this.roomTimeoutTimer = null;
    this.turnTimeoutTimer = null;
    this.disconnectTimers = {};  // { playerId: timer }

    // 房间10分钟超时
    this.startRoomTimeout();
  }

  // =============== 房间管理 ===============

  startRoomTimeout() {
    this.roomTimeoutTimer = setTimeout(() => {
      if (this.phase === PHASE.WAITING) {
        this.broadcast('room_expired', { message: '房间已超时关闭（10分钟无人加入）' });
        this.cleanup();
      }
    }, 10 * 60 * 1000);
  }

  clearRoomTimeout() {
    if (this.roomTimeoutTimer) {
      clearTimeout(this.roomTimeoutTimer);
      this.roomTimeoutTimer = null;
    }
  }

  addPlayer(playerId, nickname, ws) {
    if (this.playerOrder.length >= 2) {
      return { success: false, reason: '房间已满' };
    }

    this.players[playerId] = {
      id: playerId,
      nickname: nickname || `玩家${this.playerOrder.length + 1}`,
      ws,
      dice: [],
      connected: true,
      disconnectedAt: null
    };
    this.playerOrder.push(playerId);
    this.stats[playerId] = { wins: 0, losses: 0, totalScore: 0, streak: 0 };

    // 两人到齐，清除房间超时
    if (this.playerOrder.length === 2) {
      this.clearRoomTimeout();
      // 通知双方玩家信息
      this.broadcastPlayerInfo();
    }

    return { success: true };
  }

  removePlayer(playerId) {
    if (this.players[playerId]) {
      delete this.players[playerId];
      this.playerOrder = this.playerOrder.filter(id => id !== playerId);
    }
  }

  getOpponent(playerId) {
    return this.playerOrder.find(id => id !== playerId);
  }

  broadcastPlayerInfo() {
    for (const pid of this.playerOrder) {
      const opId = this.getOpponent(pid);
      const player = this.players[pid];
      const opponent = opId ? this.players[opId] : null;
      this.sendTo(pid, 'player_info', {
        you: { id: pid, nickname: player.nickname },
        opponent: opponent ? { id: opId, nickname: opponent.nickname } : null,
        stats: this.stats
      });
    }
  }

  // =============== 游戏流程 ===============

  startGame() {
    if (this.playerOrder.length !== 2) return;

    this.phase = PHASE.ROLLING;

    // 摇骰
    const dice = {};
    for (const pid of this.playerOrder) {
      dice[pid] = GameEngine.rollDice(5);
      this.players[pid].dice = dice[pid];
    }

    // 决定先手
    let firstPlayer;
    if (!this.currentGame || !this.currentGame.loser) {
      // 首局随机
      firstPlayer = this.playerOrder[Math.random() < 0.5 ? 0 : 1];
    } else {
      // 后续局：输家先叫
      firstPlayer = this.currentGame.loser;
    }

    this.currentGame = {
      dice,
      bids: [],
      currentTurn: firstPlayer,
      lastBidder: null,
      lastBid: null,
      // 劈骰状态
      challenge: null,  // { initiator, target, multiplier, count }
      // 结果
      result: null,
      winner: null,
      loser: null,
      score: 0
    };

    this.phase = PHASE.BIDDING;

    // 通知各玩家自己的骰子
    for (const pid of this.playerOrder) {
      this.sendTo(pid, 'game_start', {
        yourDice: dice[pid],
        firstPlayer,
        currentTurn: firstPlayer,
        phase: this.phase,
        stats: this.stats
      });
    }

    // 开始回合计时
    this.startTurnTimeout();
  }

  /**
   * 玩家叫数
   */
  handleBid(playerId, bid) {
    if (this.phase !== PHASE.BIDDING) {
      return { success: false, reason: '当前不是叫数阶段' };
    }
    if (this.currentGame.currentTurn !== playerId) {
      return { success: false, reason: '不是你的回合' };
    }

    // 叫1默认斋
    if (bid.value === 1) {
      bid.mode = 'zhai';
    }

    // 验证叫数合法性
    const validation = GameEngine.validateBid(this.currentGame.lastBid, bid);
    if (!validation.valid) {
      return { success: false, reason: validation.reason };
    }

    // 记录叫数
    this.currentGame.bids.push({
      playerId,
      nickname: this.players[playerId].nickname,
      ...bid,
      timestamp: Date.now()
    });
    this.currentGame.lastBid = bid;
    this.currentGame.lastBidder = playerId;

    // 切换回合
    const nextPlayer = this.getOpponent(playerId);
    this.currentGame.currentTurn = nextPlayer;

    // 广播叫数
    this.broadcast('bid_made', {
      playerId,
      nickname: this.players[playerId].nickname,
      bid,
      bids: this.currentGame.bids,
      currentTurn: nextPlayer,
      phase: this.phase
    });

    // 重置回合计时
    this.startTurnTimeout();

    return { success: true };
  }

  /**
   * 玩家开骰（普通开，×1倍）
   */
  handleOpen(playerId) {
    if (this.phase !== PHASE.BIDDING) {
      return { success: false, reason: '当前不是叫数阶段' };
    }
    if (this.currentGame.currentTurn !== playerId) {
      return { success: false, reason: '不是你的回合' };
    }
    if (!this.currentGame.lastBid) {
      return { success: false, reason: '还没有人叫数，不能开骰' };
    }

    this.clearTurnTimeout();
    return this.resolveGame(playerId, 'open', 1);
  }

  /**
   * 玩家劈骰
   */
  handleChallenge(playerId) {
    if (this.phase !== PHASE.BIDDING) {
      return { success: false, reason: '当前不是叫数阶段' };
    }
    if (this.currentGame.currentTurn !== playerId) {
      return { success: false, reason: '不是你的回合' };
    }
    if (!this.currentGame.lastBid) {
      return { success: false, reason: '还没有人叫数，不能劈' };
    }

    this.clearTurnTimeout();
    this.phase = PHASE.CHALLENGING;

    const target = this.currentGame.lastBidder;
    this.currentGame.challenge = {
      initiator: playerId,
      target: target,
      multiplier: 2,
      count: 1,
      currentTurn: target  // 被劈的人做选择
    };

    this.broadcast('challenge_started', {
      challenger: playerId,
      challengerNickname: this.players[playerId].nickname,
      target: target,
      targetNickname: this.players[target].nickname,
      multiplier: 2,
      count: 1,
      currentTurn: target,
      phase: this.phase
    });

    this.startTurnTimeout();
    return { success: true };
  }

  /**
   * 被劈后的操作：开骰
   */
  handleChallengeOpen(playerId) {
    if (this.phase !== PHASE.CHALLENGING) {
      return { success: false, reason: '当前不是劈骰阶段' };
    }
    if (this.currentGame.challenge.currentTurn !== playerId) {
      return { success: false, reason: '不是你的回合' };
    }

    this.clearTurnTimeout();
    const multiplier = this.currentGame.challenge.multiplier;
    return this.resolveGame(playerId, 'open', multiplier);
  }

  /**
   * 被劈后的操作：反劈
   */
  handleCounterChallenge(playerId) {
    if (this.phase !== PHASE.CHALLENGING) {
      return { success: false, reason: '当前不是劈骰阶段' };
    }
    const challenge = this.currentGame.challenge;
    if (challenge.currentTurn !== playerId) {
      return { success: false, reason: '不是你的回合' };
    }
    if (challenge.count >= 3) {
      return { success: false, reason: '已达劈骰上限（3次），只能开或认输' };
    }

    this.clearTurnTimeout();

    // 倍数翻倍
    challenge.multiplier *= 2;
    challenge.count += 1;
    // 踢回给对方
    const opponent = this.getOpponent(playerId);
    challenge.currentTurn = opponent;

    this.broadcast('counter_challenge', {
      player: playerId,
      playerNickname: this.players[playerId].nickname,
      target: opponent,
      targetNickname: this.players[opponent].nickname,
      multiplier: challenge.multiplier,
      count: challenge.count,
      maxReached: challenge.count >= 3,
      currentTurn: opponent,
      phase: this.phase
    });

    this.startTurnTimeout();
    return { success: true };
  }

  /**
   * 被劈后的操作：认输
   */
  handleSurrender(playerId) {
    if (this.phase !== PHASE.CHALLENGING) {
      return { success: false, reason: '当前不是劈骰阶段' };
    }
    if (this.currentGame.challenge.currentTurn !== playerId) {
      return { success: false, reason: '不是你的回合' };
    }

    this.clearTurnTimeout();
    const multiplier = this.currentGame.challenge.multiplier;
    const score = GameEngine.calculateScore('surrender', multiplier);
    const winner = this.getOpponent(playerId);

    this.currentGame.winner = winner;
    this.currentGame.loser = playerId;
    this.currentGame.score = score;
    this.currentGame.result = {
      type: 'surrender',
      multiplier,
      loserScore: score
    };

    // 更新战绩
    this.stats[winner].wins += 1;
    this.stats[playerId].losses += 1;
    this.stats[playerId].totalScore += score;
    // 连败追踪
    this.stats[playerId].streak = (this.stats[playerId].streak || 0) + 1;
    this.stats[winner].streak = 0;

    this.phase = PHASE.SETTLING;

    // 广播认输结算
    this.broadcast('game_settled', {
      type: 'surrender',
      surrenderPlayer: playerId,
      surrenderNickname: this.players[playerId].nickname,
      winner,
      winnerNickname: this.players[winner].nickname,
      loser: playerId,
      loserNickname: this.players[playerId].nickname,
      multiplier,
      score,
      // 揭示所有骰子
      allDice: {
        [this.playerOrder[0]]: {
          dice: this.players[this.playerOrder[0]].dice,
          pattern: GameEngine.detectPattern(this.players[this.playerOrder[0]].dice)
        },
        [this.playerOrder[1]]: {
          dice: this.players[this.playerOrder[1]].dice,
          pattern: GameEngine.detectPattern(this.players[this.playerOrder[1]].dice)
        }
      },
      lastBid: this.currentGame.lastBid,
      bids: this.currentGame.bids,
      stats: this.stats,
      phase: this.phase
    });

    return { success: true };
  }

  /**
   * 开骰结算
   */
  resolveGame(openerPlayerId, resultType, multiplier) {
    const lastBid = this.currentGame.lastBid;
    const lastBidder = this.currentGame.lastBidder;

    const pidA = this.playerOrder[0];
    const pidB = this.playerOrder[1];

    const result = GameEngine.resolveBid(
      this.players[pidA].dice,
      this.players[pidB].dice,
      lastBid
    );

    // 判定输赢
    let winner, loser;
    if (result.bidEstablished) {
      // 叫数成立 → 开的人输
      loser = openerPlayerId;
      winner = this.getOpponent(openerPlayerId);
    } else {
      // 叫数不成立 → 叫的人输
      loser = lastBidder;
      winner = this.getOpponent(lastBidder);
    }

    const score = GameEngine.calculateScore(resultType, multiplier);

    this.currentGame.winner = winner;
    this.currentGame.loser = loser;
    this.currentGame.score = score;
    this.currentGame.result = {
      type: resultType,
      multiplier,
      ...result,
      loserScore: score
    };

    // 更新战绩
    this.stats[winner].wins += 1;
    this.stats[loser].losses += 1;
    this.stats[loser].totalScore += score;
    // 连败追踪
    this.stats[loser].streak = (this.stats[loser].streak || 0) + 1;
    this.stats[winner].streak = 0;

    this.phase = PHASE.SETTLING;

    // 广播结算
    this.broadcast('game_settled', {
      type: 'open',
      opener: openerPlayerId,
      openerNickname: this.players[openerPlayerId].nickname,
      lastBidder,
      lastBidderNickname: this.players[lastBidder].nickname,
      winner,
      winnerNickname: this.players[winner].nickname,
      loser,
      loserNickname: this.players[loser].nickname,
      multiplier,
      score,
      bidEstablished: result.bidEstablished,
      totalCount: result.totalCount,
      bidQuantity: result.bidQuantity,
      lastBid,
      allDice: {
        [pidA]: {
          dice: this.players[pidA].dice,
          nickname: this.players[pidA].nickname,
          pattern: result.playerAResult.pattern
        },
        [pidB]: {
          dice: this.players[pidB].dice,
          nickname: this.players[pidB].nickname,
          pattern: result.playerBResult.pattern
        }
      },
      countDetails: {
        [pidA]: result.playerAResult.count,
        [pidB]: result.playerBResult.count
      },
      bids: this.currentGame.bids,
      stats: this.stats,
      phase: this.phase
    });

    return { success: true };
  }

  /**
   * 再来一局
   */
  handlePlayAgain(playerId) {
    if (!this.currentGame) return;
    if (!this.currentGame._playAgain) {
      this.currentGame._playAgain = new Set();
    }
    this.currentGame._playAgain.add(playerId);

    const opId = this.getOpponent(playerId);
    this.sendTo(opId, 'play_again_request', {
      playerId,
      nickname: this.players[playerId].nickname
    });

    // 双方都确认
    if (this.currentGame._playAgain.size === 2) {
      this.startGame();
    }
  }

  // =============== 超时处理 ===============

  startTurnTimeout() {
    this.clearTurnTimeout();
    this.turnTimeoutTimer = setTimeout(() => {
      this.handleTurnTimeout();
    }, 30 * 1000);

    // 广播倒计时开始
    this.broadcast('timer_start', {
      duration: 30,
      startTime: Date.now()
    });
  }

  clearTurnTimeout() {
    if (this.turnTimeoutTimer) {
      clearTimeout(this.turnTimeoutTimer);
      this.turnTimeoutTimer = null;
    }
  }

  handleTurnTimeout() {
    let timeoutPlayer;
    if (this.phase === PHASE.BIDDING) {
      timeoutPlayer = this.currentGame.currentTurn;
    } else if (this.phase === PHASE.CHALLENGING) {
      timeoutPlayer = this.currentGame.challenge.currentTurn;
    } else {
      return;
    }

    const winner = this.getOpponent(timeoutPlayer);
    const multiplier = this.currentGame.challenge ? this.currentGame.challenge.multiplier : 1;
    const score = multiplier;

    this.currentGame.winner = winner;
    this.currentGame.loser = timeoutPlayer;
    this.currentGame.score = score;

    this.stats[winner].wins += 1;
    this.stats[timeoutPlayer].losses += 1;
    this.stats[timeoutPlayer].totalScore += score;

    this.phase = PHASE.SETTLING;

    this.broadcast('game_settled', {
      type: 'timeout',
      timeoutPlayer,
      timeoutNickname: this.players[timeoutPlayer].nickname,
      winner,
      winnerNickname: this.players[winner].nickname,
      loser: timeoutPlayer,
      loserNickname: this.players[timeoutPlayer].nickname,
      multiplier,
      score,
      allDice: {
        [this.playerOrder[0]]: {
          dice: this.players[this.playerOrder[0]].dice,
          nickname: this.players[this.playerOrder[0]].nickname,
          pattern: GameEngine.detectPattern(this.players[this.playerOrder[0]].dice)
        },
        [this.playerOrder[1]]: {
          dice: this.players[this.playerOrder[1]].dice,
          nickname: this.players[this.playerOrder[1]].nickname,
          pattern: GameEngine.detectPattern(this.players[this.playerOrder[1]].dice)
        }
      },
      lastBid: this.currentGame.lastBid,
      bids: this.currentGame.bids,
      stats: this.stats,
      phase: this.phase
    });
  }

  // =============== 断线重连 ===============

  handleDisconnect(playerId) {
    const player = this.players[playerId];
    if (!player) return;

    player.connected = false;
    player.disconnectedAt = Date.now();
    player.ws = null;

    // 通知对方
    const opId = this.getOpponent(playerId);
    if (opId) {
      this.sendTo(opId, 'opponent_disconnected', {
        nickname: player.nickname,
        message: '对方网络异常，等待重连...'
      });
    }

    // 30秒断线计时
    this.disconnectTimers[playerId] = setTimeout(() => {
      this.handleDisconnectTimeout(playerId);
    }, 30 * 1000);
  }

  handleReconnect(playerId, ws) {
    const player = this.players[playerId];
    if (!player) return false;

    // 清除断线计时器
    if (this.disconnectTimers[playerId]) {
      clearTimeout(this.disconnectTimers[playerId]);
      delete this.disconnectTimers[playerId];
    }

    player.connected = true;
    player.disconnectedAt = null;
    player.ws = ws;

    // 通知对方
    const opId = this.getOpponent(playerId);
    if (opId) {
      this.sendTo(opId, 'opponent_reconnected', {
        nickname: player.nickname
      });
    }

    // 推送完整游戏状态
    this.sendGameState(playerId);
    return true;
  }

  handleDisconnectTimeout(playerId) {
    if (!this.players[playerId]) return;
    if (this.players[playerId].connected) return; // 已重连

    const winner = this.getOpponent(playerId);
    if (!winner) return;

    // 如果在游戏中，判断线方负
    if (this.phase === PHASE.BIDDING || this.phase === PHASE.CHALLENGING) {
      const multiplier = this.currentGame.challenge ? this.currentGame.challenge.multiplier : 1;
      const score = multiplier;

      this.currentGame.winner = winner;
      this.currentGame.loser = playerId;
      this.currentGame.score = score;

      this.stats[winner].wins += 1;
      this.stats[playerId].losses += 1;
      this.stats[playerId].totalScore += score;

      this.clearTurnTimeout();
    }

    this.phase = PHASE.SETTLING;

    this.broadcast('game_settled', {
      type: 'disconnect',
      disconnectedPlayer: playerId,
      disconnectedNickname: this.players[playerId].nickname,
      winner,
      winnerNickname: this.players[winner].nickname,
      loser: playerId,
      loserNickname: this.players[playerId].nickname,
      message: '对方已掉线，你赢了',
      stats: this.stats,
      phase: this.phase
    });
  }

  /**
   * 推送完整游戏状态（用于重连）
   */
  sendGameState(playerId) {
    const state = {
      roomCode: this.roomCode,
      phase: this.phase,
      you: {
        id: playerId,
        nickname: this.players[playerId].nickname,
        dice: this.players[playerId].dice
      },
      stats: this.stats
    };

    const opId = this.getOpponent(playerId);
    if (opId) {
      state.opponent = {
        id: opId,
        nickname: this.players[opId].nickname,
        connected: this.players[opId].connected
      };
    }

    if (this.currentGame) {
      state.game = {
        bids: this.currentGame.bids,
        lastBid: this.currentGame.lastBid,
        lastBidder: this.currentGame.lastBidder,
        currentTurn: this.currentGame.currentTurn,
        challenge: this.currentGame.challenge,
        result: this.currentGame.result
      };
    }

    this.sendTo(playerId, 'game_state', state);
  }

  // =============== 通信 ===============

  sendTo(playerId, type, data) {
    const player = this.players[playerId];
    if (!player || !player.ws) return;
    try {
      player.ws.send(JSON.stringify({ type, data }));
    } catch (e) {
      // 发送失败，可能已断线
    }
  }

  broadcast(type, data) {
    for (const pid of this.playerOrder) {
      this.sendTo(pid, type, data);
    }
  }

  // =============== 清理 ===============

  cleanup() {
    this.clearRoomTimeout();
    this.clearTurnTimeout();
    for (const timer of Object.values(this.disconnectTimers)) {
      clearTimeout(timer);
    }
    this.disconnectTimers = {};
    this.phase = PHASE.FINISHED;
  }

  /**
   * 获取房间信息（给前端展示用）
   */
  getRoomInfo() {
    return {
      roomCode: this.roomCode,
      phase: this.phase,
      players: this.playerOrder.map(pid => ({
        id: pid,
        nickname: this.players[pid].nickname,
        connected: this.players[pid].connected
      })),
      stats: this.stats,
      createdAt: this.createdAt
    };
  }
}

Room.PHASE = PHASE;

module.exports = Room;
