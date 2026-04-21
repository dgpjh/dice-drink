/**
 * 大话骰 - AI 机器人玩家
 * 提供自动叫数、开骰、劈骰等决策逻辑
 */
const GameEngine = require('./gameEngine');

// 机器人昵称池 - 扑克/娱乐/电竞/热梗混合
const BOT_NAMES = [
  'Tom Dwan',
  '周润发',
  '卢本伟',
  '陈刀仔',
  '乌兹',
  '布兰妮',
  '臧书奴',
  '雷军',
  '童锦程',
  '新疆炒米粉',
  'Tan Xuan',
  '酱酱萌萌嘎',
];

class BotPlayer {
  /**
   * @param {string} playerId - 机器人的 playerId
   * @param {string} nickname - 机器人昵称
   */
  constructor(playerId, nickname) {
    this.playerId = playerId;
    this.nickname = nickname;
    this.isBot = true;
    // 决策风格: 0=保守, 1=普通, 2=激进
    this.style = Math.floor(Math.random() * 3);
  }

  /**
   * 获取一个随机 Bot 昵称
   */
  static getRandomName(existingNames = []) {
    const available = BOT_NAMES.filter(n => !existingNames.includes(n));
    if (available.length === 0) {
      return `Bot${Math.floor(Math.random() * 9000) + 1000}`;
    }
    return available[Math.floor(Math.random() * available.length)];
  }

  /**
   * AI 决定下一步操作
   * @param {object} context - 当前游戏上下文
   *   - myDice: number[] 自己的5颗骰子
   *   - lastBid: { quantity, value, mode } | null 上一次叫数
   *   - bids: array 所有叫数历史
   *   - totalDice: number 场上总骰子数
   *   - playerCount: number 玩家人数
   *   - phase: 'bidding' | 'challenging'
   *   - challenge: object | null 劈骰信息
   *   - mySkill: { id, used, type } | null 我的技能
   *   - allPlayers: [{ id, isBot }] 全场玩家（用于 peek 选目标）
   *   - myPlayerId: string 我的 id（用于 peek 排除自己）
   * @returns {{ action: string, data?: object }}
   */
  decide(context) {
    const { phase } = context;

    if (phase === 'challenging') {
      return this.decideChallenge(context);
    }

    // 叫数阶段：先看要不要先用主动技能
    const skillAction = this.maybeUseSkill(context);
    if (skillAction) return skillAction;

    return this.decideBidding(context);
  }

  /**
   * 叫数阶段：考虑是否先用主动技能（在自己回合时）
   * 返回一个 use_skill action，或 null 表示不用
   */
  maybeUseSkill(context) {
    const { mySkill, myDice, lastBid, allPlayers, myPlayerId } = context;
    if (!mySkill || mySkill.used || mySkill.type !== 'active') return null;

    const id = mySkill.id;

    // peek：本局自己第一次操作时，30% 概率偷看一个真人对手（优先真人，没真人就挑机器人）
    if (id === 'peek') {
      if (Math.random() < 0.35) {
        const candidates = (allPlayers || []).filter(p => p.id !== myPlayerId);
        if (candidates.length === 0) return null;
        // 优先挑真人
        const humans = candidates.filter(p => !p.isBot);
        const pool = humans.length ? humans : candidates;
        const target = pool[Math.floor(Math.random() * pool.length)];
        return { action: 'use_skill', data: { skillId: 'peek', targetId: target.id } };
      }
      return null;
    }

    // reroll / bigReroll：仅在本局第一次叫数前使用（lastBid 为 null）
    if (id === 'reroll' || id === 'bigReroll') {
      if (lastBid) return null;
      // 评估自己的手牌好坏
      const counts = {};
      for (const d of myDice) counts[d] = (counts[d] || 0) + 1;
      const maxSame = Math.max(...Object.values(counts));
      const uniq = Object.keys(counts).length;
      // 单骰或散牌（5种全不同 / 最多2同）更可能换
      if (id === 'reroll') {
        // 找到最稀有的单颗骰子
        if (uniq >= 4 && Math.random() < 0.6) {
          // 找出现次数最少的骰子
          let worstIdx = 0, worstVal = myDice[0], worstCount = counts[myDice[0]];
          for (let i = 0; i < myDice.length; i++) {
            if (counts[myDice[i]] < worstCount) {
              worstCount = counts[myDice[i]];
              worstVal = myDice[i];
              worstIdx = i;
            }
          }
          return { action: 'use_skill', data: { skillId: 'reroll', diceIndex: worstIdx } };
        }
      } else {
        // bigReroll：只在明显劣势手牌（uniq=5 单骰 or maxSame<=1）时用
        if (uniq === 5 && Math.random() < 0.7) {
          return { action: 'use_skill', data: { skillId: 'bigReroll' } };
        }
      }
      return null;
    }

    // silencer：在自己要叫数时，40% 概率提前激活
    if (id === 'silencer') {
      if (Math.random() < 0.4) {
        return { action: 'use_skill', data: { skillId: 'silencer' } };
      }
      return null;
    }

    return null;
  }

  /**
   * 叫数阶段决策
   */
  decideBidding(context) {
    const { myDice, lastBid, totalDice, playerCount, ruleSet, onesCalled } = context;

    // 第一次叫数
    if (!lastBid) {
      return { action: 'bid', data: this.makeFirstBid(myDice, totalDice, playerCount, ruleSet, onesCalled) };
    }

    // 分析上家叫数的可信度
    const credibility = this.assessBidCredibility(myDice, lastBid, totalDice, ruleSet, onesCalled);

    // 根据可信度决策
    if (credibility < 0.2) {
      const rand = Math.random();
      if (rand < 0.3 + this.style * 0.1) {
        return { action: 'challenge' };
      }
      return { action: 'open' };
    }

    if (credibility < 0.4) {
      if (Math.random() < 0.4 + this.style * 0.1) {
        return { action: 'open' };
      }
    }

    // 尝试继续叫数
    const nextBid = this.makeNextBid(myDice, lastBid, totalDice, playerCount, ruleSet, onesCalled);
    if (nextBid) {
      return { action: 'bid', data: nextBid };
    }

    return { action: 'open' };
  }

  /**
   * 劈骰阶段决策（被劈后）
   */
  decideChallenge(context) {
    const { myDice, lastBid, totalDice, challenge, ruleSet, onesCalled } = context;

    if (!challenge) return { action: 'challenge_open' };

    const credibility = this.assessBidCredibility(myDice, lastBid, totalDice, ruleSet, onesCalled);

    if (challenge.count >= 3 || challenge.multiplier >= 8) {
      if (credibility > 0.5) {
        return { action: 'surrender' };
      }
      return { action: 'challenge_open' };
    }

    if (credibility > 0.6) {
      if (this.style === 0) {
        return { action: 'surrender' };
      }
      if (Math.random() < 0.5) {
        return { action: 'surrender' };
      }
      return { action: 'challenge_open' };
    }

    if (credibility < 0.3) {
      if (this.style >= 1 && Math.random() < 0.4) {
        return { action: 'counter_challenge' };
      }
      return { action: 'challenge_open' };
    }

    const rand = Math.random();
    if (rand < 0.3) return { action: 'counter_challenge' };
    if (rand < 0.7) return { action: 'challenge_open' };
    return { action: 'surrender' };
  }

  /**
   * 评估叫数的可信度 (0~1, 越高越可信)
   */
  assessBidCredibility(myDice, bid, totalDice, ruleSet = null, onesCalled = false) {
    if (!bid) return 1;

    const { quantity, value, mode } = bid;

    // 自己手里有多少（按 ruleSet 正确计数）
    const effectiveMode = (ruleSet && ruleSet.hasFlyZhai === false) ? 'guo1' : mode;
    const myResult = GameEngine.countDice(myDice, value, effectiveMode, ruleSet, { onesCalled });
    const myCount = myResult.count;

    const otherDice = totalDice - 5;

    // 1 是否在当前语境下充当万能（决定期望概率）
    const oneWild = GameEngine.isOneWild(effectiveMode, value, ruleSet || {}, { onesCalled });

    let prob;
    if (oneWild) {
      prob = 2 / 6; // 1 + 目标点
    } else {
      prob = 1 / 6;
    }

    const expectedFromOthers = otherDice * prob;
    const expectedTotal = myCount + expectedFromOthers;

    if (quantity <= expectedTotal * 0.8) return 0.9;
    if (quantity <= expectedTotal) return 0.7;
    if (quantity <= expectedTotal * 1.2) return 0.5;
    if (quantity <= expectedTotal * 1.5) return 0.3;
    return 0.1;
  }

  /**
   * 第一次叫数
   */
  makeFirstBid(myDice, totalDice, playerCount, ruleSet = null, onesCalled = false) {
    const counts = {};
    for (const d of myDice) {
      counts[d] = (counts[d] || 0) + 1;
    }

    const pc = playerCount || 2;
    const minBid = GameEngine.getMinBidByPlayerCount(pc);

    let bestValue = 2;
    let bestCount = 0;
    for (let v = 2; v <= 6; v++) {
      if ((counts[v] || 0) > bestCount) {
        bestCount = counts[v] || 0;
        bestValue = v;
      }
    }

    // ==== guo1 无飞斋模式 ====
    if (ruleSet && ruleSet.hasFlyZhai === false) {
      const oneWild = GameEngine.isOneWild('guo1', bestValue, ruleSet, { onesCalled });
      const onesCount = oneWild ? (counts[1] || 0) : 0;
      const myTotal = bestCount + onesCount;

      const otherDice = totalDice - 5;
      const expectedOthers = Math.floor(otherDice * (oneWild ? 2 : 1) / 6);

      let quantity = Math.max(minBid.guo1Other, myTotal + Math.floor(expectedOthers * 0.5));
      quantity += (Math.random() < 0.3 ? 1 : 0);
      quantity = Math.max(minBid.guo1Other, Math.min(quantity, totalDice));

      return {
        quantity,
        value: bestValue,
        mode: 'guo1'
      };
    }

    // ==== 有飞斋模式 ====
    // 飞模式下，根据规则决定 1 是否当癞子
    const oneWild = GameEngine.isOneWild('fly', bestValue, ruleSet || {}, { onesCalled });
    const onesCount = oneWild ? (counts[1] || 0) : 0;
    const myTotal = bestCount + onesCount;

    const otherDice = totalDice - 5;
    const expectedOthers = Math.floor(otherDice * (oneWild ? 2 : 1) / 6);

    let quantity = Math.max(minBid.fly, myTotal + Math.floor(expectedOthers * 0.5));
    quantity += (Math.random() < 0.3 ? 1 : 0);
    quantity = Math.max(minBid.fly, Math.min(quantity, totalDice));

    return {
      quantity,
      value: bestValue,
      mode: 'fly'
    };
  }

  /**
   * 继续叫数（比上一次更大）
   */
  makeNextBid(myDice, lastBid, totalDice, playerCount, ruleSet = null, onesCalled = false) {
    const counts = {};
    for (const d of myDice) {
      counts[d] = (counts[d] || 0) + 1;
    }

    const pc = playerCount || 2;
    const candidates = [];
    const ctx = { onesCalled };

    // ==== guo1 无飞斋模式 ====
    if (ruleSet && ruleSet.hasFlyZhai === false) {
      const minBid = GameEngine.getMinBidByPlayerCount(pc);

      // 策略A：数量+1，同点数
      const plusOneBid = {
        quantity: lastBid.quantity + 1,
        value: lastBid.value,
        mode: 'guo1'
      };
      const v1 = GameEngine.validateBid(lastBid, plusOneBid, pc, ruleSet, ctx);
      if (v1.valid && this.isBidReasonable(myDice, plusOneBid, totalDice, ruleSet, onesCalled)) {
        candidates.push(plusOneBid);
      }

      // 策略B：同数量，更大点数（2<3<4<5<6<1）
      const sortedValues = [2, 3, 4, 5, 6, 1];
      for (const v of sortedValues) {
        if (GameEngine.diceRank(v) > GameEngine.diceRank(lastBid.value)) {
          const bid = {
            quantity: lastBid.quantity,
            value: v,
            mode: 'guo1'
          };
          const val = GameEngine.validateBid(lastBid, bid, pc, ruleSet, ctx);
          if (val.valid && this.isBidReasonable(myDice, bid, totalDice, ruleSet, onesCalled)) {
            candidates.push(bid);
          }
        }
      }

      // 策略C：叫自己手上多的点数（数量+1）
      for (let v = 2; v <= 6; v++) {
        const oneWild = GameEngine.isOneWild('guo1', v, ruleSet, ctx);
        const myCount = (counts[v] || 0) + (oneWild ? (counts[1] || 0) : 0);
        if (myCount >= 2) {
          const bid = {
            quantity: lastBid.quantity + 1,
            value: v,
            mode: 'guo1'
          };
          const val = GameEngine.validateBid(lastBid, bid, pc, ruleSet, ctx);
          if (val.valid && this.isBidReasonable(myDice, bid, totalDice, ruleSet, onesCalled)) {
            candidates.push(bid);
          }
        }
      }

      // 策略D：叫 1 重置（若 onesCalled 尚未触发 且 手里 1 多 且 起叫数不太离谱）
      if (!onesCalled && ruleSet.oneCallResetQuantity && (counts[1] || 0) >= 2) {
        const bid = {
          quantity: minBid.guo1One,
          value: 1,
          mode: 'guo1'
        };
        const val = GameEngine.validateBid(lastBid, bid, pc, ruleSet, ctx);
        if (val.valid && this.isBidReasonable(myDice, bid, totalDice, ruleSet, onesCalled)) {
          candidates.push(bid);
        }
      }

      if (candidates.length === 0) return null;
      return candidates[Math.floor(Math.random() * candidates.length)];
    }

    // ==== 有飞斋模式 ====
    // 同模式加 1
    const sameModeBid = {
      quantity: lastBid.quantity + 1,
      value: lastBid.value,
      mode: lastBid.mode
    };
    if (this.isBidReasonable(myDice, sameModeBid, totalDice, ruleSet, onesCalled)) {
      const validation = GameEngine.validateBid(lastBid, sameModeBid, pc, ruleSet, ctx);
      if (validation.valid) {
        candidates.push(sameModeBid);
      }
    }

    // 同数量更大点数
    const sortedValues = [2, 3, 4, 5, 6, 1];
    for (const v of sortedValues) {
      if (GameEngine.diceRank(v) > GameEngine.diceRank(lastBid.value)) {
        const bid = {
          quantity: lastBid.quantity,
          value: v,
          mode: v === 1 ? 'zhai' : lastBid.mode
        };
        const validation = GameEngine.validateBid(lastBid, bid, pc, ruleSet, ctx);
        if (validation.valid && this.isBidReasonable(myDice, bid, totalDice, ruleSet, onesCalled)) {
          candidates.push(bid);
        }
      }
    }

    // 叫自己手上多的点数
    for (let v = 2; v <= 6; v++) {
      const oneWild = GameEngine.isOneWild('fly', v, ruleSet || {}, ctx);
      const myCount = (counts[v] || 0) + (oneWild ? (counts[1] || 0) : 0);
      if (myCount >= 2) {
        const bid = {
          quantity: lastBid.quantity + 1,
          value: v,
          mode: 'fly'
        };
        const validation = GameEngine.validateBid(lastBid, bid, pc, ruleSet, ctx);
        if (validation.valid && this.isBidReasonable(myDice, bid, totalDice, ruleSet, onesCalled)) {
          candidates.push(bid);
        }
      }
    }

    if (candidates.length === 0) return null;

    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  /**
   * 判断叫数是否合理（不会太离谱）
   */
  isBidReasonable(myDice, bid, totalDice, ruleSet = null, onesCalled = false) {
    const credibility = this.assessBidCredibility(myDice, bid, totalDice, ruleSet, onesCalled);
    const threshold = 0.4 - this.style * 0.1;
    return credibility >= threshold;
  }
}

module.exports = BotPlayer;
