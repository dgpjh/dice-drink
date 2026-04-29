/**
 * 大话骰 - 房间管理（支持2-4人）
 * 包含：房间创建/加入、游戏状态机、超时处理、断线重连、可配置规则集
 */
const GameEngine = require('./gameEngine');
const { createRuleSet } = require('./rules');
const { SKILLS, createSkillState, rollDiceWithSkill, randomSkillId } = require('./skills');

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
  constructor(roomCode, hostPlayerId, maxPlayers = 2, ruleSet = null, skillMode = 'none', matchConfig = null) {
    this.roomCode = roomCode;
    this.createdAt = Date.now();
    this.phase = PHASE.WAITING;
    this.maxPlayers = Math.min(Math.max(maxPlayers, 2), 4); // 限制2-4人

    // 规则集
    this.ruleSet = ruleSet || createRuleSet();

    // 技能模式：'none'（无技能）/ 'random'（随机发）/ 'choose'（自选）
    this.skillMode = skillMode || 'none';

    // v2.7.0：赛制模式（不选 = 'free' 自由模式，无终结条件）
    // mode: 'free' | 'time' | 'rounds' | 'maxLoss' | 'totalLoss'
    // target: time(分钟2-10) | rounds(局数3-20) | maxLoss(杯数3-30) | totalLoss(杯数3-100)
    this.matchConfig = this._normalizeMatchConfig(matchConfig);
    this.matchState = {
      startedAt: null,           // 第一局开始时间
      roundsPlayed: 0,           // 已完成局数
      timeUpFlag: false,         // 定时间模式：时间到的标记
      finished: false,           // 整场已结束
      finishReason: null,        // 'time'/'rounds'/'maxLoss'/'totalLoss'
      finalRanking: null         // 最终排名快照
    };
    this.matchTimer = null;      // 定时间模式的总倒计时

    // 玩家
    this.players = {};  // { playerId: { id, nickname, ws, dice, connected, disconnectedAt } }
    this.playerOrder = []; // [playerId1, playerId2, ...] 座位顺序

    // 对局状态
    this.currentGame = null;

    // 上一局结算快照（用于断线重连到 settling 阶段时复原结算页）
    this.lastSettlement = null;

    // 战绩
    this.stats = {};  // { playerId: { wins, losses, totalScore } }

    // 超时计时器
    this.roomTimeoutTimer = null;
    this.turnTimeoutTimer = null;
    this.disconnectTimers = {};  // { playerId: timer }

    // 房间10分钟超时
    this.startRoomTimeout();
  }

  // =============== 赛制（v2.7.0） ===============

  /**
   * 规范化赛制配置
   * @param {object} cfg - { mode, target }
   * @returns {object} { mode, target, label }
   */
  _normalizeMatchConfig(cfg) {
    const def = { mode: 'free', target: 0, label: '自由模式' };
    if (!cfg || typeof cfg !== 'object') return def;
    const mode = cfg.mode;
    const target = parseInt(cfg.target, 10);

    switch (mode) {
      case 'time': {
        // 2~10 分钟
        const t = Math.min(Math.max(Number.isFinite(target) ? target : 5, 2), 10);
        return { mode: 'time', target: t, label: `定时间 ${t} 分钟` };
      }
      case 'rounds': {
        const t = Math.min(Math.max(Number.isFinite(target) ? target : 5, 3), 20);
        return { mode: 'rounds', target: t, label: `定局数 ${t} 局` };
      }
      case 'maxLoss': {
        const t = Math.min(Math.max(Number.isFinite(target) ? target : 10, 3), 30);
        return { mode: 'maxLoss', target: t, label: `找菜比 ${t} 杯封顶` };
      }
      case 'totalLoss': {
        const t = Math.min(Math.max(Number.isFinite(target) ? target : 30, 3), 100);
        return { mode: 'totalLoss', target: t, label: `定总杯数 ${t} 杯封顶` };
      }
      default:
        return def;
    }
  }

  /**
   * 启动赛制（在第一局 startGame 时调用一次）
   */
  _startMatchIfNeeded() {
    if (this.matchConfig.mode === 'free') return;
    if (this.matchState.startedAt) return; // 已启动
    this.matchState.startedAt = Date.now();

    // 定时间模式：启动总倒计时
    if (this.matchConfig.mode === 'time') {
      const ms = this.matchConfig.target * 60 * 1000;
      this.matchTimer = setTimeout(() => {
        this.matchState.timeUpFlag = true;
        // 时间到时正在游戏中：当前局结束后会在 _checkMatchEnd 触发结束
        // 时间到时正在结算页：等用户看完结算再 finish（延迟 4 秒，匹配前端 toast 提示）
        // 时间到时正在等待/结束：直接结束（理论上不会，因为开局才启动定时器）
        if (this.phase === PHASE.SETTLING) {
          // v2.7.2: 立即抢占 pendingFinish,阻止 4 秒延迟内机器人 play_again 凑齐触发 startGame
          this.matchState.pendingFinish = true;
          this.broadcast('match_time_up', {
            message: '⏱ 比赛时间已到，即将公布最终排名'
          });
          // v2.7.2: 同步广播一次 progress 让前端进度条立刻进入 pendingFinish 状态(置灰再来一局按钮)
          this.broadcast('match_progress', this._getMatchProgress());
          setTimeout(() => this._finishMatch('time'), 4000);
        } else if (this.phase === PHASE.WAITING || this.phase === PHASE.FINISHED) {
          this._finishMatch('time');
        } else {
          // 通知前端"时间已到，本局结束后整场结束"
          this.broadcast('match_time_up', {
            message: '⏱ 比赛时间已到，本局结束后将公布最终排名'
          });
        }
      }, ms);

      // v2.7.1: 同步广播开始时间 + 持续时间(用 durationMs 让前端基于"收到时间"算剩余,避免客户端时钟偏差)
      this.broadcast('match_started', {
        matchConfig: this.matchConfig,
        startedAt: this.matchState.startedAt,
        endsAt: this.matchState.startedAt + ms,
        durationMs: ms,
        // v2.7.1: 初始进度,前端进度条立即可显示
        currentMax: 0,
        currentTotal: 0,
        roundsPlayed: 0
      });
    } else {
      this.broadcast('match_started', {
        matchConfig: this.matchConfig,
        startedAt: this.matchState.startedAt,
        // v2.7.1: 初始进度
        currentMax: 0,
        currentTotal: 0,
        roundsPlayed: 0
      });
    }
  }

  /**
   * 每次 broadcastSettled 后调用，检查是否触发整场结束
   */
  _checkMatchEnd() {
    if (this.matchConfig.mode === 'free') return false;
    if (this.matchState.finished) return false;
    // v2.7.2: pendingFinish 期间禁止重复 +1（防御异常 broadcastSettled 重入）
    if (this.matchState.pendingFinish) return false;

    this.matchState.roundsPlayed += 1;

    let shouldEnd = false;
    let reason = null;

    switch (this.matchConfig.mode) {
      case 'time':
        if (this.matchState.timeUpFlag) {
          shouldEnd = true;
          reason = 'time';
        }
        break;
      case 'rounds':
        if (this.matchState.roundsPlayed >= this.matchConfig.target) {
          shouldEnd = true;
          reason = 'rounds';
        }
        break;
      case 'maxLoss': {
        const maxLoss = Math.max(...Object.values(this.stats).map(s => s.totalScore || 0));
        if (maxLoss >= this.matchConfig.target) {
          shouldEnd = true;
          reason = 'maxLoss';
        }
        break;
      }
      case 'totalLoss': {
        const totalLoss = Object.values(this.stats).reduce((sum, s) => sum + (s.totalScore || 0), 0);
        if (totalLoss >= this.matchConfig.target) {
          shouldEnd = true;
          reason = 'totalLoss';
        }
        break;
      }
    }

    // 广播每局后的赛制进度（无论是否结束）
    this.broadcast('match_progress', this._getMatchProgress());

    if (shouldEnd) {
      // v2.7.1: 立即抢占,阻止机器人 play_again 在 1.5s 间隙内触发 startGame
      this.matchState.pendingFinish = true;
      // 延迟一点点让结算页先展示
      setTimeout(() => this._finishMatch(reason), 1500);
    }
    return shouldEnd;
  }

  /**
   * 结束整场比赛，下发最终排名
   */
  _finishMatch(reason) {
    if (this.matchState.finished) return;
    this.matchState.finished = true;
    this.matchState.finishReason = reason;

    // 清理定时器
    if (this.matchTimer) {
      clearTimeout(this.matchTimer);
      this.matchTimer = null;
    }
    this.clearTurnTimeout();

    // 计算排名：按 totalScore 升序（输得少的排前面），并列同名次
    const ranking = this.playerOrder.map(pid => {
      const s = this.stats[pid] || { wins: 0, losses: 0, totalScore: 0 };
      return {
        playerId: pid,
        nickname: this.players[pid]?.nickname || '???',
        totalScore: s.totalScore || 0,
        wins: s.wins || 0,
        losses: s.losses || 0,
        isBot: !!this.players[pid]?.isBot
      };
    });
    ranking.sort((a, b) => a.totalScore - b.totalScore);
    // 标记名次（同分并列）
    let lastScore = -1, lastRank = 0;
    ranking.forEach((r, i) => {
      if (r.totalScore !== lastScore) {
        lastRank = i + 1;
        lastScore = r.totalScore;
      }
      r.rank = lastRank;
    });

    this.matchState.finalRanking = ranking;
    this.phase = PHASE.FINISHED;

    // v2.7.2: 缓存真实的"结束时刻"和"比赛时长",避免后续重连时用 Date.now() 反算导致用时虚高
    this.matchState.finishedAt = Date.now();
    this.matchState.matchDurationMs = this.matchState.finishedAt - (this.matchState.startedAt || this.matchState.finishedAt);

    this.broadcast('match_finished', {
      matchConfig: this.matchConfig,
      reason,
      reasonText: this._getFinishReasonText(reason),
      ranking,
      roundsPlayed: this.matchState.roundsPlayed,
      durationMs: this.matchState.matchDurationMs
    });

    // v2.7.1: 5 分钟后自动清理房间(防止用户不点"回首页"导致房间泄露)
    // 重连时若房间还在,可以再看到 finalRanking;5 分钟后只能新建房间
    if (typeof this._onFinishCleanup === 'function') {
      setTimeout(() => {
        try { this._onFinishCleanup(); } catch (e) {}
      }, 5 * 60 * 1000);
    }
  }

  _getFinishReasonText(reason) {
    switch (reason) {
      case 'time': return `比赛时长 ${this.matchConfig.target} 分钟已到`;
      case 'rounds': return `已完成 ${this.matchConfig.target} 局`;
      case 'maxLoss': return `有玩家欠杯达到 ${this.matchConfig.target} 杯`;
      case 'totalLoss': return `总欠杯数达到 ${this.matchConfig.target} 杯`;
      default: return '比赛结束';
    }
  }

  /**
   * 获取赛制进度（用于广播 + 重连状态）
   */
  _getMatchProgress() {
    const cfg = this.matchConfig;
    const st = this.matchState;
    const progress = {
      mode: cfg.mode,
      target: cfg.target,
      label: cfg.label,
      roundsPlayed: st.roundsPlayed,
      finished: st.finished,
      pendingFinish: !!st.pendingFinish  // v2.7.1: 即将结束(1.5s 缓冲期)
    };
    if (cfg.mode === 'time' && st.startedAt) {
      progress.startedAt = st.startedAt;
      progress.endsAt = st.startedAt + cfg.target * 60 * 1000;
      progress.timeUpFlag = st.timeUpFlag;
      progress.serverNow = Date.now(); // v2.7.1: 让前端基于服务器时间算剩余,避免客户端时钟偏差
      // v2.7.2: 同时给 remainingMs,前端用「Date.now() + remainingMs」算本地 endsAt(尤其重连场景)
      progress.remainingMs = Math.max(0, progress.endsAt - Date.now());
    }
    // v2.7.1: 所有非 free 模式都带上 currentMax/currentTotal,方便前端混合显示
    progress.currentMax = Math.max(0, ...Object.values(this.stats).map(s => s.totalScore || 0));
    progress.currentTotal = Object.values(this.stats).reduce((sum, s) => sum + (s.totalScore || 0), 0);
    return progress;
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

  addPlayer(playerId, nickname, ws, opts = {}) {
    if (this.playerOrder.length >= this.maxPlayers) {
      return { success: false, reason: '房间已满' };
    }

    // 分配技能（根据 skillMode）
    let skillId = null;
    if (this.skillMode === 'random') {
      skillId = randomSkillId();
    } else if (this.skillMode === 'choose') {
      // 真人：先给个空，等 chooseSkill 更新；机器人：用人设绑定，没绑定就随机兜底
      if (opts.isBot) {
        skillId = opts.presetSkill || randomSkillId();
      } else {
        skillId = opts.presetSkill || null;
      }
    }
    // 机器人可以强制用人设绑定的技能（opts.presetSkill）
    if (opts.presetSkill && this.skillMode !== 'none') {
      skillId = opts.presetSkill;
    }

    this.players[playerId] = {
      id: playerId,
      nickname: (() => {
        // v2.6.4：昵称去重，若已有同名玩家则自动加数字后缀
        let n = nickname || `玩家${this.playerOrder.length + 1}`;
        const existingNames = new Set(this.playerOrder.map(pid => this.players[pid].nickname));
        if (existingNames.has(n)) {
          let i = 2;
          while (existingNames.has(`${n} ${i}`)) i++;
          n = `${n} ${i}`;
        }
        return n;
      })(),
      ws,
      dice: [],
      connected: true,
      disconnectedAt: null,
      skill: this.skillMode === 'none' ? null : createSkillState(skillId),
      isBot: !!opts.isBot
    };
    this.playerOrder.push(playerId);
    this.stats[playerId] = { wins: 0, losses: 0, totalScore: 0, streak: 0, singleStreak: 0 };

    // 人满，清除房间超时
    if (this.playerOrder.length === this.maxPlayers) {
      this.clearRoomTimeout();
    }

    // 通知所有玩家信息更新
    this.broadcastPlayerInfo();

    return { success: true };
  }

  /**
   * 玩家在 waiting 阶段选择/更换技能（仅 skillMode='choose' 时）
   */
  chooseSkill(playerId, skillId) {
    if (this.skillMode !== 'choose') {
      return { success: false, reason: '当前房间不支持自选技能' };
    }
    if (this.phase !== PHASE.WAITING) {
      return { success: false, reason: '游戏已开始，无法更换技能' };
    }
    if (!SKILLS[skillId]) {
      return { success: false, reason: '未知技能' };
    }
    const player = this.players[playerId];
    if (!player) return { success: false, reason: '玩家不存在' };

    player.skill = createSkillState(skillId);
    this.broadcastPlayerInfo();

    // 广播进度（给前端"玩家A 选择了斧头帮"这种提示用）
    this.broadcast('skill_choose_progress', {
      playerId,
      nickname: player.nickname,
      skillId: player.skill.id,
      skillName: player.skill.name,
      skillIcon: player.skill.icon,
      progress: this.playerOrder.map(pid => ({
        id: pid,
        nickname: this.players[pid].nickname,
        skillId: this.players[pid].skill ? this.players[pid].skill.id : null,
        skillName: this.players[pid].skill ? this.players[pid].skill.name : null,
        skillIcon: this.players[pid].skill ? this.players[pid].skill.icon : null,
        chosen: !!(this.players[pid].skill && this.players[pid].skill.id)
      })),
      allChosen: this.allHumansChoseSkill()
    });

    return { success: true, allChosen: this.allHumansChoseSkill() };
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
        connected: this.players[opId].connected,
        // 其他玩家的技能对所有人公开（信息透明）
        skill: this.publicSkill(this.players[opId].skill)
      }));

      this.sendTo(pid, 'player_info', {
        you: {
          id: pid,
          nickname: player.nickname,
          skill: this.publicSkill(player.skill)  // 自己的技能
        },
        // 兼容旧版：2人模式仍提供 opponent 字段
        opponent: others.length === 1 ? { id: others[0].id, nickname: others[0].nickname } : null,
        others,
        playerOrder: this.playerOrder.map(id => ({
          id,
          nickname: this.players[id].nickname,
          connected: this.players[id].connected,
          skill: this.publicSkill(this.players[id].skill)
        })),
        maxPlayers: this.maxPlayers,
        ruleSet: this.ruleSet,
        skillMode: this.skillMode,
        matchConfig: this.matchConfig,
        stats: this.stats
      });
    }
  }

  /**
   * 技能对外展示（不暴露 pendingSilencer 这种内部状态）
   */
  publicSkill(skill) {
    if (!skill) return null;
    return {
      id: skill.id,
      name: skill.name,
      icon: skill.icon,
      type: skill.type,
      desc: skill.desc,
      used: !!skill.used
    };
  }

  // =============== 游戏流程 ===============

  /**
   * 所有真人玩家是否都已选好技能（仅在 skillMode='choose' 时有意义）
   */
  allHumansChoseSkill() {
    if (this.skillMode !== 'choose') return true;
    for (const pid of this.playerOrder) {
      const p = this.players[pid];
      if (!p) continue;
      // 机器人由 presetSkill 兜底，理论上不会为空
      if (!p.skill || !p.skill.id) return false;
    }
    return true;
  }

  startGame() {
    if (this.playerOrder.length < 2) return;

    // v2.7.0：整场已结束，禁止再开新局
    if (this.matchState.finished) return;
    // v2.7.1：抢占式守卫——_checkMatchEnd 已判定即将结束,1.5s 缓冲期内禁止开新局
    if (this.matchState.pendingFinish) return;

    // 自选模式下，所有玩家都必须已选技能才能开局
    if (this.skillMode === 'choose' && !this.allHumansChoseSkill()) {
      // 广播一条提示，等所有人选完后再由 chooseSkill 尝试触发 startGame
      this.broadcast('skill_choose_waiting', {
        message: '还有玩家未选择技能，等待中...',
        progress: this.playerOrder.map(pid => ({
          id: pid,
          nickname: this.players[pid].nickname,
          skillId: this.players[pid].skill ? this.players[pid].skill.id : null,
          skillName: this.players[pid].skill ? this.players[pid].skill.name : null,
          skillIcon: this.players[pid].skill ? this.players[pid].skill.icon : null,
          chosen: !!(this.players[pid].skill && this.players[pid].skill.id)
        }))
      });
      return;
    }

    this.phase = PHASE.ROLLING;

    // 开新局清理上一局结算快照
    this.lastSettlement = null;

    // v2.7.0：第一局开始时启动赛制（含定时间倒计时）
    this._startMatchIfNeeded();

    // 每一局开始重置主动技能使用次数 + 封口激活状态
    for (const pid of this.playerOrder) {
      const p = this.players[pid];
      if (p && p.skill && p.skill.type === 'active') {
        p.skill.used = false;
        p.skill.pendingSilencer = false;
      }
    }

    // 摇骰（含单骰重摇逻辑 + 好运姐被动偏置）
    const dice = {};
    const rerollEvents = [];        // 广播给客户端做提示
    let singleLoser = null;          // 连续单骰判负的玩家
    const maxStreak = this.ruleSet.singleRerollMaxStreak || 3;

    for (const pid of this.playerOrder) {
      const p = this.players[pid];
      const isLucky = !!(p.skill && p.skill.id === 'lucky');
      let rolled = rollDiceWithSkill(5, isLucky);

      if (this.ruleSet.singleBehavior === 'reroll') {
        // 单骰重摇：每次摇到单骰累加 singleStreak，到上限判负；本局最终非单骰则重置
        while (GameEngine.detectPattern(rolled).type === 'single') {
          this.stats[pid].singleStreak = (this.stats[pid].singleStreak || 0) + 1;
          rerollEvents.push({
            playerId: pid,
            nickname: this.players[pid].nickname,
            streak: this.stats[pid].singleStreak,
            maxStreak
          });
          if (this.stats[pid].singleStreak >= maxStreak) {
            singleLoser = pid;
            break;
          }
          rolled = rollDiceWithSkill(5, isLucky);
        }
        // 本局最终未单骰 → 重置连续计数
        if (!singleLoser && GameEngine.detectPattern(rolled).type !== 'single') {
          this.stats[pid].singleStreak = 0;
        }
      }

      dice[pid] = rolled;
      this.players[pid].dice = rolled;

      if (singleLoser) break;  // 有人连续单骰判负，后面的人不用摇了
    }

    // 决定先手
    let firstPlayer;
    if (!this.currentGame || !this.currentGame.loser) {
      const randomIdx = Math.floor(Math.random() * this.playerOrder.length);
      firstPlayer = this.playerOrder[randomIdx];
    } else {
      firstPlayer = this.currentGame.loser;
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
      onesCalled: false,  // 本局是否叫过1点（过1不癞规则用）
      challenge: null,
      result: null,
      winner: null,
      loser: null,
      score: 0,
      rerollEvents
    };

    // 若有人连续单骰达到上限，直接判负结算
    if (singleLoser) {
      this.handleSingleStreakLoss(singleLoser, rerollEvents);
      return;
    }

    this.phase = PHASE.BIDDING;

    // 通知各玩家自己的骰子
    for (const pid of this.playerOrder) {
      this.sendTo(pid, 'game_start', {
        yourDice: dice[pid],
        yourSkill: this.publicSkill(this.players[pid].skill),
        firstPlayer,
        currentTurn: firstPlayer,
        phase: this.phase,
        stats: this.stats,
        ruleSet: this.ruleSet,
        skillMode: this.skillMode,
        rerollEvents,
        playerOrder: this.playerOrder.map(id => ({
          id,
          nickname: this.players[id].nickname,
          skill: this.publicSkill(this.players[id].skill)
        })),
        totalDice: this.playerOrder.length * 5,
        minBidRules: GameEngine.getMinBidByPlayerCount(this.playerOrder.length)
      });
    }

    this.startTurnTimeout();
  }

  // =============== 技能使用 ===============

  /**
   * 玩家使用主动技能
   * @param {string} playerId
   * @param {string} skillId
   * @param {object} payload - { targetId?, diceIndex? }
   */
  handleUseSkill(playerId, skillId, payload = {}) {
    const player = this.players[playerId];
    if (!player) return { success: false, reason: '玩家不存在' };
    if (!player.skill || player.skill.id !== skillId) {
      return { success: false, reason: '你没有这个技能' };
    }
    if (player.skill.used) {
      return { success: false, reason: '本局技能已使用' };
    }
    const def = SKILLS[skillId];
    if (!def || def.type !== 'active') {
      return { success: false, reason: '该技能不是主动技能' };
    }
    if (this.phase !== PHASE.BIDDING) {
      return { success: false, reason: '当前阶段不能使用技能' };
    }

    // 时机校验：多数技能要求在自己回合
    if (def.timing === 'myTurn' || def.timing === 'myFirstTurnBeforeBid' || def.timing === 'myTurnBeforeBid') {
      if (this.currentGame.currentTurn !== playerId) {
        return { success: false, reason: '请在自己回合使用技能' };
      }
    }
    if (def.timing === 'myFirstTurnBeforeBid') {
      // 换骰/大换骰：只能在自己「本局第一次叫数前」使用
      // 即：自己还没叫过数（bids 中没有自己的记录）
      const myBids = (this.currentGame.bids || []).filter(b => b.playerId === playerId);
      if (myBids.length > 0) {
        return { success: false, reason: '你已叫过数，此技能只能在自己本局首次叫数前使用' };
      }
    }

    // 分派到具体技能处理
    let result;
    switch (skillId) {
      case 'peek':
        result = this._skillPeek(playerId, payload);
        break;
      case 'reroll':
        result = this._skillReroll(playerId, payload);
        break;
      case 'bigReroll':
        result = this._skillBigReroll(playerId);
        break;
      case 'silencer':
        result = this._skillSilencer(playerId);
        break;
      default:
        return { success: false, reason: '未知技能' };
    }

    if (result && result.success) {
      player.skill.used = true;
      // 广播"某某用了某技能"（不含私密数据）
      this.broadcast('skill_used', {
        playerId,
        nickname: player.nickname,
        skillId,
        skillName: player.skill.name,
        skillIcon: player.skill.icon,
        publicData: result.publicData || null
      });
    }
    return result;
  }

  /**
   * 透视：偷看指定玩家 1 颗骰子
   */
  _skillPeek(playerId, payload) {
    const { targetId } = payload;
    if (!targetId || !this.players[targetId]) {
      return { success: false, reason: '请选择合法的目标玩家' };
    }
    if (targetId === playerId) {
      return { success: false, reason: '不能偷看自己' };
    }
    const targetDice = this.players[targetId].dice || [];
    if (targetDice.length === 0) {
      return { success: false, reason: '目标玩家还未摇骰' };
    }
    // 随机偷看 1 颗
    const idx = Math.floor(Math.random() * targetDice.length);
    const peekedValue = targetDice[idx];

    // 只推给使用者
    this.sendTo(playerId, 'skill_peek_result', {
      targetId,
      targetNickname: this.players[targetId].nickname,
      diceIndex: idx,
      diceValue: peekedValue
    });
    // 提示被看者（不告诉是谁看的）
    this.sendTo(targetId, 'skill_peeked', {
      message: `💀 有人偷看了你的一颗骰子`
    });

    return {
      success: true,
      publicData: {
        targetId,
        targetNickname: this.players[targetId].nickname
      }
    };
  }

  /**
   * 换骰：换自己 1 颗骰子
   */
  _skillReroll(playerId, payload) {
    const { diceIndex } = payload;
    const player = this.players[playerId];
    const dice = player.dice || [];
    if (typeof diceIndex !== 'number' || diceIndex < 0 || diceIndex >= dice.length) {
      return { success: false, reason: '请选择要换的骰子' };
    }
    // 重摇 1 颗（不受好运姐影响，保持简单）
    const newVal = 1 + Math.floor(Math.random() * 6);
    const oldVal = dice[diceIndex];
    dice[diceIndex] = newVal;
    dice.sort((a, b) => a - b);
    player.dice = dice;

    // 推送新骰子给本人
    this.sendTo(playerId, 'skill_reroll_result', {
      newDice: dice,
      oldValue: oldVal,
      newValue: newVal
    });

    return {
      success: true,
      publicData: { changedCount: 1 }
    };
  }

  /**
   * 大换骰：全部 5 颗重摇
   */
  _skillBigReroll(playerId) {
    const player = this.players[playerId];
    const isLucky = !!(player.skill && player.skill.id === 'lucky'); // 不可能（大换骰 != 好运姐）
    const newDice = rollDiceWithSkill(5, isLucky);
    player.dice = newDice;

    this.sendTo(playerId, 'skill_reroll_result', {
      newDice,
      bigReroll: true
    });

    return {
      success: true,
      publicData: { changedCount: 5 }
    };
  }

  /**
   * 封口：激活后下一次叫数生效，下家只能"劈"或"认输"
   */
  _skillSilencer(playerId) {
    const player = this.players[playerId];
    if (!player.skill) return { success: false, reason: '技能不存在' };
    // 标记：下次 handleBid 时，给 currentGame 设置 silencerActive
    player.skill.pendingSilencer = true;

    return {
      success: true,
      publicData: { message: '封口已激活，你下次叫数后下家只能劈或认输' }
    };
  }

  /**
   * v2.6.3：若玩家激活了封口但没机会叫数就直接开/劈，
   * 撤销技能的"已使用"标记，让玩家下局还能用。
   */
  _refundUnusedSilencer(playerId) {
    const player = this.players[playerId];
    if (!player || !player.skill) return;
    if (player.skill.id !== 'silencer') return;
    if (player.skill.pendingSilencer) {
      player.skill.pendingSilencer = false;
      player.skill.used = false;
    }
  }

  /**
   * 连续单骰达到上限判负
   */
  handleSingleStreakLoss(loserPlayerId, rerollEvents) {
    const winners = this.playerOrder.filter(pid => pid !== loserPlayerId);
    const winner = winners[0]; // 多人情况下第一个作为胜方（战绩上其他人都是"未输"）
    const score = 1;

    this.currentGame.winner = winner;
    this.currentGame.loser = loserPlayerId;
    this.currentGame.score = score;
    this.currentGame.result = {
      type: 'singleStreak',
      loserScore: score
    };

    // 更新战绩：输家 +1 负，每位未输玩家都 +1 胜（和普通结算对齐，只加给 winner 一人避免重复计胜）
    this.stats[winner].wins += 1;
    this.stats[loserPlayerId].losses += 1;
    this.stats[loserPlayerId].totalScore += score;
    this.stats[loserPlayerId].streak = (this.stats[loserPlayerId].streak || 0) + 1;
    this.stats[winner].streak = 0;
    // 重置输家的连续单骰计数，下一局重新来
    this.stats[loserPlayerId].singleStreak = 0;

    this.phase = PHASE.SETTLING;

    const allDice = {};
    for (const pid of this.playerOrder) {
      allDice[pid] = {
        dice: this.players[pid].dice,
        nickname: this.players[pid].nickname,
        pattern: GameEngine.detectPattern(this.players[pid].dice)
      };
    }

    this.broadcastSettled({
      type: 'singleStreak',
      loser: loserPlayerId,
      loserNickname: this.players[loserPlayerId].nickname,
      winner,
      winnerNickname: this.players[winner].nickname,
      maxStreak: this.ruleSet.singleRerollMaxStreak || 3,
      rerollEvents,
      score,
      allDice,
      stats: this.stats,
      phase: this.phase,
      playerOrder: this.playerOrder.map(id => ({
        id,
        nickname: this.players[id].nickname
      }))
    });
  }

  /**
   * 广播 game_settled 并保存快照（用于断线重连）
   * v2.7.0：结算后检查赛制结束条件
   */
  broadcastSettled(payload) {
    // v2.7.0：附带赛制进度（前端实时更新顶部进度条）
    if (this.matchConfig.mode !== 'free') {
      payload.matchProgress = this._getMatchProgress();
    }
    this.lastSettlement = payload;
    this.broadcast('game_settled', payload);
    // 检查整场是否结束（异步发 match_finished）
    this._checkMatchEnd();
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
    // v2.6.5：防御客户端伪造数据
    if (!bid || typeof bid !== 'object') {
      return { success: false, reason: '叫数数据异常' };
    }
    const q = parseInt(bid.quantity, 10);
    const v = parseInt(bid.value, 10);
    if (!Number.isFinite(q) || q < 1 || q > this.playerOrder.length * 5) {
      return { success: false, reason: '叫数数量非法' };
    }
    if (!Number.isFinite(v) || v < 1 || v > 6) {
      return { success: false, reason: '点数非法' };
    }
    bid.quantity = q;
    bid.value = v;
    if (bid.mode && !['fly', 'zhai', 'guo1'].includes(bid.mode)) {
      bid.mode = 'fly';
    }
    // 封口：如果你是被封口的下家，不能叫数
    if (this.currentGame.silencerTarget === playerId) {
      return { success: false, reason: '🔒 你被封口了！只能劈或认输' };
    }

    // 飞斋规则下：叫1默认斋；无飞斋规则下：强制 mode='guo1'
    if (this.ruleSet.hasFlyZhai === false) {
      bid.mode = 'guo1';
    } else if (bid.value === 1) {
      bid.mode = 'zhai';
    }

    // 验证叫数合法性（传入玩家人数 + 规则集 + onesCalled 上下文）
    const validation = GameEngine.validateBid(
      this.currentGame.lastBid,
      bid,
      this.playerOrder.length,
      this.ruleSet,
      { onesCalled: this.currentGame.onesCalled }
    );
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

    // 过1不癞规则：
    //   - hasFlyZhai=false (guo1): 叫过1后 1 不再当癞
    //   - 其他 afterCalled1（兼容历史）：叫过1后 1 才当癞
    if (bid.value === 1) {
      this.currentGame.onesCalled = true;
    }

    // 切换到下一位玩家
    const nextPlayer = this.getNextPlayer(playerId);
    this.currentGame.currentTurn = nextPlayer;

    // 技能：封口 —— 如果本次叫数者激活了封口，下家只能 challenge/surrender
    const bidder = this.players[playerId];
    let silencerOn = false;
    if (bidder && bidder.skill && bidder.skill.pendingSilencer) {
      silencerOn = true;
      bidder.skill.pendingSilencer = false; // 消耗激活
      this.currentGame.silencerBy = playerId;       // 谁锁的
      this.currentGame.silencerTarget = nextPlayer; // 锁谁
    } else {
      this.currentGame.silencerBy = null;
      this.currentGame.silencerTarget = null;
    }

    // 广播叫数
    this.broadcast('bid_made', {
      playerId,
      nickname: this.players[playerId].nickname,
      bid,
      bids: this.currentGame.bids,
      currentTurn: nextPlayer,
      onesCalled: this.currentGame.onesCalled,
      phase: this.phase,
      silencerOn,
      silencerBy: silencerOn ? playerId : null,
      silencerTarget: silencerOn ? nextPlayer : null
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

    // v2.6.3：若本人激活了封口但没机会叫数就直接开骰，撤销封口的"已使用"标记
    this._refundUnusedSilencer(playerId);

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

    // v2.6.3：若本人激活了封口但没机会叫数就直接劈，撤销封口的"已使用"标记
    this._refundUnusedSilencer(playerId);

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

    // 斧头帮被动：反劈链中「当前认输者」的对手若是斧头帮，则不能认输。
    // 反劈后 currentTurn 会在 initiator 与 target 间轮换，不能固定用 initiator。
    const chg = this.currentGame.challenge;
    const opponent = (playerId === chg.initiator) ? chg.target : chg.initiator;
    const opponentPlayer = this.players[opponent];
    if (opponentPlayer && opponentPlayer.skill && opponentPlayer.skill.id === 'axeman') {
      return { success: false, reason: '🪓 对方是斧头帮，不能认输！' };
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
    // v2.6.5：重置输家的连续单骰计数，和其他结算路径对齐
    this.stats[playerId].singleStreak = 0;

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
    this.broadcastSettled({
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
   *
   * 胜负判定规则：
   *   - 普通开（非劈骰阶段）：opener 与 lastBidder 对决
   *       opener 主动开骰 = 赌"叫数不成立"
   *       叫数成立(true)  → opener 输（多开了）
   *       叫数不成立(false) → lastBidder 输（骗叫）
   *   - 劈骰后开（由 handleChallengeOpen 进入）：
   *       ⚠️ v2.7.2 修复重大 BUG：劈骰链中的"open"是被反劈到无路可走时的被动选择，
   *           opener 的押注方向 ≠ 普通开骰里"opener 赌不成立"的语义！
   *       劈骰本质是 initiator(劈方,赌"不成立") ↔ target(叫数方,赌"成立") 两人博弈，
   *       反劈只是踢回赌注、提高倍数，**不改变两人各自押注的方向**。
   *       因此最终判定与"谁 open"完全无关，只看叫数是否成立：
   *         - 叫数成立(true)  → initiator(劈方)输，target(叫数方)赢
   *         - 叫数不成立(false) → target(叫数方)输，initiator(劈方)赢
   *       【BUG 现场举例】A 叫 4 个 5（target=A），B 劈（initiator=B），
   *           A 反劈，B 再反劈（count=3 达上限）→ A 必须 open。
   *           真值≥4 叫数成立 → 应该 B 输。但旧代码用 opener=A 推导成 A 输（错！）
   *           v2.7.1 之前所有"偶数次反劈后 lastBidder open"的局都判反了。
   */
  resolveGame(openerPlayerId, resultType, multiplier) {
    const lastBid = this.currentGame.lastBid;
    const lastBidder = this.currentGame.lastBidder;

    // 收集所有玩家的骰子
    const allPlayerDice = {};
    for (const pid of this.playerOrder) {
      allPlayerDice[pid] = this.players[pid].dice;
    }

    const result = GameEngine.resolveBid(
      allPlayerDice,
      lastBid,
      this.ruleSet,
      { onesCalled: this.currentGame.onesCalled }
    );

    // 判定输赢
    let winner, loser;
    const challenge = this.currentGame.challenge;
    if (challenge && resultType === 'open') {
      // v2.7.2: 劈骰后开骰 → 完全按 initiator/target 押注方向判定，不看 opener
      if (result.bidEstablished) {
        // 叫数成立 → 劈方(initiator)输（他赌不成立但实际成立）
        loser = challenge.initiator;
        winner = challenge.target;
      } else {
        // 叫数不成立 → 叫数方(target)输（他叫数虚、被劈方逮到）
        loser = challenge.target;
        winner = challenge.initiator;
      }
    } else {
      // 普通开骰（非劈骰分支）：opener vs lastBidder
      if (result.bidEstablished) {
        loser = openerPlayerId;
        winner = lastBidder;
      } else {
        loser = lastBidder;
        winner = openerPlayerId;
      }
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
    // v2.6.5：重置输家连续单骰（与其他路径对齐）
    this.stats[loser].singleStreak = 0;

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
    this.broadcastSettled({
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
    // v2.6.5：只允许在结算阶段确认"再来一局"，避免 BIDDING 中污染状态
    if (this.phase !== PHASE.SETTLING) return;
    // v2.7.0：整场比赛已结束，不能再来一局
    if (this.matchState.finished) return;
    // v2.7.1：即将结束(1.5s 缓冲期),通知前端"等待最终排名"而不是静默忽略
    if (this.matchState.pendingFinish) {
      this.sendTo(playerId, 'play_again_blocked', {
        reason: 'matchEnding',
        message: '🏁 本局已是最后一局，正在结算最终排名...'
      });
      return;
    }
    if (!this.players[playerId]) return;
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
    // v2.6.5：连败追踪 & 重置输家的连续单骰计数，和其他结算路径保持一致
    this.stats[timeoutPlayer].streak = (this.stats[timeoutPlayer].streak || 0) + 1;
    this.stats[winner].streak = 0;
    this.stats[timeoutPlayer].singleStreak = 0;

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

    this.broadcastSettled({
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

    // v2.6.5：结算阶段/等待阶段断线超时，不做任何结算（只把玩家状态留着）
    if (this.phase !== PHASE.BIDDING && this.phase !== PHASE.CHALLENGING) {
      return;
    }

    // 1) 先选赢家（统一一次，供 stats 和 broadcast 共用）
    let winner;
    if (this.phase === PHASE.CHALLENGING && this.currentGame.challenge) {
      const chg = this.currentGame.challenge;
      const opponent = (playerId === chg.initiator) ? chg.target : chg.initiator;
      // 对手必须在线
      if (opponent && this.players[opponent] && this.players[opponent].connected) {
        winner = opponent;
      } else {
        winner = this.playerOrder.find(pid => pid !== playerId && this.players[pid]?.connected);
      }
    } else {
      // BIDDING 阶段：任意一位在线玩家（优先 lastBidder 如果还在线）
      const lastBidder = this.currentGame?.lastBidder;
      if (lastBidder && lastBidder !== playerId && this.players[lastBidder]?.connected) {
        winner = lastBidder;
      } else {
        winner = this.playerOrder.find(pid => pid !== playerId && this.players[pid]?.connected);
      }
    }

    // 全员都掉线，无人可结算，清理即可
    if (!winner) {
      this.clearTurnTimeout();
      return;
    }

    // 2) 更新战绩
    const multiplier = this.currentGame.challenge ? this.currentGame.challenge.multiplier : 1;
    const score = multiplier;

    this.currentGame.winner = winner;
    this.currentGame.loser = playerId;
    this.currentGame.score = score;

    this.stats[winner].wins += 1;
    this.stats[playerId].losses += 1;
    this.stats[playerId].totalScore += score;
    this.stats[playerId].streak = (this.stats[playerId].streak || 0) + 1;
    this.stats[winner].streak = 0;
    this.stats[playerId].singleStreak = 0;

    this.clearTurnTimeout();
    this.phase = PHASE.SETTLING;

    this.broadcastSettled({
      type: 'disconnect',
      disconnectedPlayer: playerId,
      disconnectedNickname: this.players[playerId].nickname,
      winner,
      winnerNickname: this.players[winner].nickname,
      loser: playerId,
      loserNickname: this.players[playerId].nickname,
      multiplier,
      score,
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
      ruleSet: this.ruleSet,
      skillMode: this.skillMode,
      you: {
        id: playerId,
        nickname: this.players[playerId].nickname,
        dice: this.players[playerId].dice,
        skill: this.publicSkill(this.players[playerId].skill)
      },
      stats: this.stats,
      playerOrder: this.playerOrder.map(id => ({
        id,
        nickname: this.players[id].nickname,
        connected: this.players[id].connected,
        skill: this.publicSkill(this.players[id].skill)
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
        onesCalled: this.currentGame.onesCalled || false,
        challenge: this.currentGame.challenge,
        result: this.currentGame.result,
        // v2.6.4：重连恢复封口状态
        silencerBy: this.currentGame.silencerBy || null,
        silencerTarget: this.currentGame.silencerTarget || null
      };
      // v2.6.4：重连恢复自己的 pending 封口（已激活但未生效）
      const me = this.players[playerId];
      if (me && me.skill && me.skill.id === 'silencer' && me.skill.pendingSilencer) {
        state.you.pendingSilencer = true;
      }
    }

    // v2.6.3：重连到结算阶段时，附带上一局结算快照
    if (this.phase === PHASE.SETTLING && this.lastSettlement) {
      state.lastSettlement = this.lastSettlement;
    }

    // v2.7.0：附带赛制配置 + 进度（前端重连恢复顶部进度条/最终排名）
    state.matchConfig = this.matchConfig;
    if (this.matchConfig.mode !== 'free') {
      state.matchProgress = this._getMatchProgress();
    }
    if (this.matchState.finished && this.matchState.finalRanking) {
      state.matchFinished = {
        reason: this.matchState.finishReason,
        reasonText: this._getFinishReasonText(this.matchState.finishReason),
        ranking: this.matchState.finalRanking,
        roundsPlayed: this.matchState.roundsPlayed,
        // v2.7.2: 用缓存的真实比赛时长,而不是"重连时刻 - startedAt"(后者会越拖越虚高)
        durationMs: this.matchState.matchDurationMs || (Date.now() - (this.matchState.startedAt || Date.now()))
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
    if (this.matchTimer) {
      clearTimeout(this.matchTimer);
      this.matchTimer = null;
    }
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
      ruleSet: this.ruleSet,
      skillMode: this.skillMode,
      matchConfig: this.matchConfig,
      players: this.playerOrder.map(pid => ({
        id: pid,
        nickname: this.players[pid].nickname,
        connected: this.players[pid].connected,
        skill: this.publicSkill(this.players[pid].skill)
      })),
      stats: this.stats,
      createdAt: this.createdAt
    };
  }
}

Room.PHASE = PHASE;

module.exports = Room;
