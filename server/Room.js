/**
 * 大话骰 - 房间管理（支持2-4人）
 * 包含：房间创建/加入、游戏状态机、超时处理、断线重连
 */
const GameEngine = require('./gameEngine');

// 游戏阶段
const PHASE = {
  WAITING: 'waiting',      // 等待玩家
  ROLLING: 'rolling',      // 摇骰阶段
  BIDDING: 'bidding',      // 叫数阶段
  CHALLENGING: 'challenging', // 劈骰阶段
  SETTLING: 'settling',    // 结算阶段
  FINISHED: 'finished'     // 结束
};

class Room {
  constructor(roomCode, hostPlayerId, maxPlayers = 2) {
    this.roomCode = roomCode;
    this.createdAt = Date.now();
    this.phase = PHASE.WAITING;
    this.maxPlayers = Math.min(Math.max(maxPlayers, 2), 4); // 限制2-4人

    // 玩家
    this.players = {};  // { playerId: { id, nickname, ws, dice, connected, disconnectedAt } }
    this.playerOrder = []; // [playerId1, playerId2, ...] 座位顺序

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
    if (this.playerOrder.length >= this.maxPlayers) {
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

    // 人满，清除房间超时
    if (this.playerOrder.length === this.maxPlayers) {
      this.clearRoomTimeout();
    }

    // 通知所有玩家信息更新
    this.broadcastPlayerInfo();

    return { success: true };
  }

  removePlayer(playerId) {
    if (this.players[playerId]) {
      delete this.players[playerId];
      this.playerOrder = this.playerOrder.filter(id => id !== playerId);
    }
  }

  /**
   * 获取下一个玩家（按座位顺序轮转）
   */
  getNextPlayer(currentPlayerId) {
    const idx = this.playerOrder.indexOf(currentPlayerId);
    if (idx === -1) return null;
    const nextIdx = (idx + 1) % this.playerOrder.length;
    return this.playerOrder[nextIdx];
  }

  /**
   * 获取除指定玩家外的所有其他玩家
   */
  getOtherPlayers(playerId) {
    return this.playerOrder.filter(id => id !== playerId);
  }

  /**
   * 获取对手（2人模式兼容）
   */
  getOpponent(playerId) {
    return this.playerOrder.find(id => id !== playerId);
  }

  broadcastPlayerInfo() {
    for (const pid of this.playerOrder) {
      const player = this.players[pid];
      const others = this.getOtherPlayers(pid).map(opId => ({
        id: opId,
        nickname: this.players[opId].nickname,
        connected: this.players[opId].connected
      }));

      this.sendTo(pid, 'player_info', {
        you: { id: pid, nickname: player.nickname },
        // 兼容旧版：2人模式仍提供 opponent 字段
        opponent: others.length === 1 ? { id: others[0].id, nickname: others[0].nickname } : null,
        others,
        playerOrder: this.playerOrder.map(id => ({
          id,
          nickname: this.players[id].nickname,
          connected: this.players[id].connected
        })),
        maxPlayers: this.maxPlayers,
        stats: this.stats
      });
    }
  }

  // =============== 游戏流程 ===============

  startGame() {
    if (this.playerOrder.length < 2) return;

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
      const randomIdx = Math.floor(Math.random() * this.playerOrder.length);
      firstPlayer = this.playerOrder[randomIdx];
    } else {
      // 后续局：输家先叫
      firstPlayer = this.currentGame.loser;
      // 如果输家不在列表中（可能断线被移除），随机选
      if (!this.playerOrder.includes(firstPlayer)) {
        firstPlayer = this.playerOrder[Math.floor(Math.random() * this.playerOrder.length)];
      }
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
        stats: this.stats,
        playerOrder: this.playerOrder.map(id => ({
          id,
          nickname: this.players[id].nickname
        })),
        totalDice: this.playerOrder.length * 5,
        minBidRules: GameEngine.getMinBidByPlayerCount(this.playerOrder.length)
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

    // 验证叫数合法性（传入玩家人数）
    const validation = GameEngine.validateBid(this.currentGame.lastBid, bid, this.playerOrder.length);
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

    // 切换到下一位玩家
    const nextPlayer = this.getNextPlayer(playerId);
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
    // 踢回给对方（劈骰始终在两人之间）
    const opponent = (playerId === challenge.initiator) ? challenge.target : challenge.initiator;
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

    // 认输者的对手（劈骰发起者或被反劈者）
    const challenge = this.currentGame.challenge;
    const winner = (playerId === challenge.initiator) ? challenge.target : challenge.initiator;

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

    // 构建所有玩家骰子信息
    const allDice = {};
    for (const pid of this.playerOrder) {
      allDice[pid] = {
        dice: this.players[pid].dice,
        nickname: this.players[pid].nickname,
        pattern: GameEngine.detectPattern(this.players[pid].dice)
      };
    }

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
      allDice,
      lastBid: this.currentGame.lastBid,
      bids: this.currentGame.bids,
      stats: this.stats,
      phase: this.phase,
      playerOrder: this.playerOrder.map(id => ({
        id,
        nickname: this.players[id].nickname
      }))
    });

    return { success: true };
  }

  /**
   * 开骰结算（支持多人）
   */
  resolveGame(openerPlayerId, resultType, multiplier) {
    const lastBid = this.currentGame.lastBid;
    const lastBidder = this.currentGame.lastBidder;

    // 收集所有玩家的骰子
    const allPlayerDice = {};
    for (const pid of this.playerOrder) {
      allPlayerDice[pid] = this.players[pid].dice;
    }

    const result = GameEngine.resolveBid(allPlayerDice, lastBid);

    // 判定输赢（开的人 vs 上一位叫数者）
    let winner, loser;
    if (result.bidEstablished) {
      // 叫数成立 → 开的人输
      loser = openerPlayerId;
      winner = lastBidder;
    } else {
      // 叫数不成立 → 叫的人输
      loser = lastBidder;
      winner = openerPlayerId;
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

    // 构建所有玩家骰子信息
    const allDice = {};
    const countDetails = {};
    for (const pid of this.playerOrder) {
      const playerResult = result.playerResults[pid];
      allDice[pid] = {
        dice: this.players[pid].dice,
        nickname: this.players[pid].nickname,
        pattern: playerResult ? playerResult.pattern : GameEngine.detectPattern(this.players[pid].dice)
      };
      countDetails[pid] = playerResult ? playerResult.count : 0;
    }

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
      allDice,
      countDetails,
      bids: this.currentGame.bids,
      stats: this.stats,
      phase: this.phase,
      playerOrder: this.playerOrder.map(id => ({
        id,
        nickname: this.players[id].nickname
      }))
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

    // 通知其他所有人
    for (const pid of this.playerOrder) {
      if (pid !== playerId) {
        this.sendTo(pid, 'play_again_request', {
          playerId,
          nickname: this.players[playerId].nickname,
          readyCount: this.currentGame._playAgain.size,
          totalPlayers: this.playerOrder.length
        });
      }
    }

    // 所有人都确认
    if (this.currentGame._playAgain.size === this.playerOrder.length) {
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

    // 确定赢家：劈骰阶段是劈骰对手，叫数阶段选上一位叫数者或下一位
    let winner;
    if (this.phase === PHASE.CHALLENGING) {
      const challenge = this.currentGame.challenge;
      winner = (timeoutPlayer === challenge.initiator) ? challenge.target : challenge.initiator;
    } else {
      // 叫数阶段超时，上家赢（如果有），否则下一位
      winner = this.currentGame.lastBidder || this.getNextPlayer(timeoutPlayer);
    }

    const multiplier = this.currentGame.challenge ? this.currentGame.challenge.multiplier : 1;
    const score = multiplier;

    this.currentGame.winner = winner;
    this.currentGame.loser = timeoutPlayer;
    this.currentGame.score = score;

    this.stats[winner].wins += 1;
    this.stats[timeoutPlayer].losses += 1;
    this.stats[timeoutPlayer].totalScore += score;

    this.phase = PHASE.SETTLING;

    // 构建所有玩家骰子信息
    const allDice = {};
    for (const pid of this.playerOrder) {
      allDice[pid] = {
        dice: this.players[pid].dice,
        nickname: this.players[pid].nickname,
        pattern: GameEngine.detectPattern(this.players[pid].dice)
      };
    }

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
      allDice,
      lastBid: this.currentGame.lastBid,
      bids: this.currentGame.bids,
      stats: this.stats,
      phase: this.phase,
      playerOrder: this.playerOrder.map(id => ({
        id,
        nickname: this.players[id].nickname
      }))
    });
  }

  // =============== 断线重连 ===============

  handleDisconnect(playerId) {
    const player = this.players[playerId];
    if (!player) return;

    player.connected = false;
    player.disconnectedAt = Date.now();
    player.ws = null;

    // 通知其他所有人
    for (const pid of this.playerOrder) {
      if (pid !== playerId) {
        this.sendTo(pid, 'opponent_disconnected', {
          playerId,
          nickname: player.nickname,
          message: `${player.nickname} 网络异常，等待重连...`
        });
      }
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

    // 通知其他所有人
    for (const pid of this.playerOrder) {
      if (pid !== playerId) {
        this.sendTo(pid, 'opponent_reconnected', {
          playerId,
          nickname: player.nickname
        });
      }
    }

    // 推送完整游戏状态
    this.sendGameState(playerId);
    return true;
  }

  handleDisconnectTimeout(playerId) {
    if (!this.players[playerId]) return;
    if (this.players[playerId].connected) return; // 已重连

    // 如果在游戏中，判断线方负
    if (this.phase === PHASE.BIDDING || this.phase === PHASE.CHALLENGING) {
      // 确定赢家
      let winner;
      if (this.phase === PHASE.CHALLENGING) {
        const challenge = this.currentGame.challenge;
        winner = (playerId === challenge.initiator) ? challenge.target : challenge.initiator;
      } else {
        // 选一个在线的玩家作为赢家
        winner = this.playerOrder.find(pid => pid !== playerId && this.players[pid].connected);
      }

      if (!winner) return;

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

    // 找一个在线的赢家
    const winner = this.playerOrder.find(pid => pid !== playerId && this.players[pid].connected);
    if (!winner) return;

    this.broadcast('game_settled', {
      type: 'disconnect',
      disconnectedPlayer: playerId,
      disconnectedNickname: this.players[playerId].nickname,
      winner,
      winnerNickname: this.players[winner].nickname,
      loser: playerId,
      loserNickname: this.players[playerId].nickname,
      message: `${this.players[playerId].nickname} 已掉线`,
      stats: this.stats,
      phase: this.phase,
      playerOrder: this.playerOrder.map(id => ({
        id,
        nickname: this.players[id].nickname
      }))
    });
  }

  /**
   * 推送完整游戏状态（用于重连）
   */
  sendGameState(playerId) {
    const state = {
      roomCode: this.roomCode,
      phase: this.phase,
      maxPlayers: this.maxPlayers,
      you: {
        id: playerId,
        nickname: this.players[playerId].nickname,
        dice: this.players[playerId].dice
      },
      stats: this.stats,
      playerOrder: this.playerOrder.map(id => ({
        id,
        nickname: this.players[id].nickname,
        connected: this.players[id].connected
      }))
    };

    // 兼容旧版 opponent 字段
    const others = this.getOtherPlayers(playerId);
    if (others.length === 1) {
      state.opponent = {
        id: others[0],
        nickname: this.players[others[0]].nickname,
        connected: this.players[others[0]].connected
      };
    }
    state.others = others.map(opId => ({
      id: opId,
      nickname: this.players[opId].nickname,
      connected: this.players[opId].connected
    }));

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
      maxPlayers: this.maxPlayers,
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
