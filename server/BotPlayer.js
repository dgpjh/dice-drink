/**
 * 大话骰 - AI 机器人玩家
 * 提供自动叫数、开骰、劈骰等决策逻辑
 */
const GameEngine = require('./gameEngine');

const BOT_NAMES = ['骰神', '赌侠', '老千', '酒鬼', '骰霸', '千王', '牛哥', '赌仙'];

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
   *   - phase: 'bidding' | 'challenging'
   *   - challenge: object | null 劈骰信息
   * @returns {{ action: string, data?: object }}
   */
  decide(context) {
    const { phase, challenge } = context;

    if (phase === 'challenging') {
      return this.decideChallenge(context);
    }

    return this.decideBidding(context);
  }

  /**
   * 叫数阶段决策
   */
  decideBidding(context) {
    const { myDice, lastBid, totalDice } = context;

    // 第一次叫数
    if (!lastBid) {
      return { action: 'bid', data: this.makeFirstBid(myDice, totalDice) };
    }

    // 分析上家叫数的可信度
    const credibility = this.assessBidCredibility(myDice, lastBid, totalDice);

    // 根据可信度决策
    if (credibility < 0.2) {
      // 非常不可信 → 有概率劈或开
      const rand = Math.random();
      if (rand < 0.3 + this.style * 0.1) {
        return { action: 'challenge' };
      }
      return { action: 'open' };
    }

    if (credibility < 0.4) {
      // 不太可信 → 可能开骰
      if (Math.random() < 0.4 + this.style * 0.1) {
        return { action: 'open' };
      }
    }

    // 尝试继续叫数
    const nextBid = this.makeNextBid(myDice, lastBid, totalDice);
    if (nextBid) {
      return { action: 'bid', data: nextBid };
    }

    // 无法合理叫数，开骰
    return { action: 'open' };
  }

  /**
   * 劈骰阶段决策（被劈后）
   */
  decideChallenge(context) {
    const { myDice, lastBid, totalDice, challenge } = context;

    if (!challenge) return { action: 'challenge_open' };

    const credibility = this.assessBidCredibility(myDice, lastBid, totalDice);

    // 如果倍数已经很高或已达上限，更倾向开骰
    if (challenge.count >= 3 || challenge.multiplier >= 8) {
      if (credibility > 0.5) {
        // 叫数可信，开骰对自己不利 → 认输
        return { action: 'surrender' };
      }
      return { action: 'challenge_open' };
    }

    // 根据可信度和风格决策
    if (credibility > 0.6) {
      // 叫数很可能成立
      if (this.style === 0) {
        return { action: 'surrender' }; // 保守认输
      }
      if (Math.random() < 0.5) {
        return { action: 'surrender' };
      }
      return { action: 'challenge_open' };
    }

    if (credibility < 0.3) {
      // 叫数不太可信 → 反劈或开
      if (this.style >= 1 && Math.random() < 0.4) {
        return { action: 'counter_challenge' };
      }
      return { action: 'challenge_open' };
    }

    // 中等可信度
    const rand = Math.random();
    if (rand < 0.3) return { action: 'counter_challenge' };
    if (rand < 0.7) return { action: 'challenge_open' };
    return { action: 'surrender' };
  }

  /**
   * 评估叫数的可信度 (0~1, 越高越可信)
   */
  assessBidCredibility(myDice, bid, totalDice) {
    if (!bid) return 1;

    const { quantity, value, mode } = bid;

    // 自己手里有多少
    const myResult = GameEngine.countDice(myDice, value, mode);
    const myCount = myResult.count;

    // 其他人骰子数
    const otherDice = totalDice - 5;

    // 期望值：飞模式下每颗骰子有 2/6 概率命中(目标值+1), 斋模式下 1/6
    let prob;
    if (mode === 'fly' && value !== 1) {
      prob = 2 / 6; // 飞模式下 1 也算
    } else {
      prob = 1 / 6; // 斋模式
    }

    const expectedFromOthers = otherDice * prob;
    const expectedTotal = myCount + expectedFromOthers;

    // 叫的数量 vs 期望值
    if (quantity <= expectedTotal * 0.8) return 0.9; // 非常可信
    if (quantity <= expectedTotal) return 0.7;
    if (quantity <= expectedTotal * 1.2) return 0.5;
    if (quantity <= expectedTotal * 1.5) return 0.3;
    return 0.1; // 非常不可信
  }

  /**
   * 第一次叫数
   */
  makeFirstBid(myDice, totalDice) {
    // 统计自己骰子
    const counts = {};
    for (const d of myDice) {
      counts[d] = (counts[d] || 0) + 1;
    }

    // 找自己最多的点数（优先非1）
    let bestValue = 2;
    let bestCount = 0;
    for (let v = 2; v <= 6; v++) {
      if ((counts[v] || 0) > bestCount) {
        bestCount = counts[v] || 0;
        bestValue = v;
      }
    }

    // 基于自己手牌叫一个合理的数
    // 飞模式下加上1的数量
    const onesCount = counts[1] || 0;
    const myTotal = bestCount + onesCount;

    // 期望其他人也有一些
    const otherDice = totalDice - 5;
    const expectedOthers = Math.floor(otherDice * 2 / 6); // 飞模式期望

    let quantity = Math.max(3, myTotal + Math.floor(expectedOthers * 0.5));
    // 加一点随机性
    quantity += (Math.random() < 0.3 ? 1 : 0);
    quantity = Math.max(3, Math.min(quantity, totalDice));

    return {
      quantity,
      value: bestValue,
      mode: 'fly'
    };
  }

  /**
   * 继续叫数（比上一次更大）
   */
  makeNextBid(myDice, lastBid, totalDice) {
    const counts = {};
    for (const d of myDice) {
      counts[d] = (counts[d] || 0) + 1;
    }

    const onesCount = counts[1] || 0;

    // 策略1: 同模式加数量
    const candidates = [];

    // 尝试同模式加 1
    const sameModeBid = {
      quantity: lastBid.quantity + 1,
      value: lastBid.value,
      mode: lastBid.mode
    };
    if (this.isBidReasonable(myDice, sameModeBid, totalDice)) {
      candidates.push(sameModeBid);
    }

    // 尝试同数量更大点数
    const sortedValues = [2, 3, 4, 5, 6, 1];
    for (const v of sortedValues) {
      if (GameEngine.diceRank(v) > GameEngine.diceRank(lastBid.value)) {
        const bid = {
          quantity: lastBid.quantity,
          value: v,
          mode: v === 1 ? 'zhai' : lastBid.mode
        };
        const validation = GameEngine.validateBid(lastBid, bid);
        if (validation.valid && this.isBidReasonable(myDice, bid, totalDice)) {
          candidates.push(bid);
        }
      }
    }

    // 尝试叫自己手上多的点数（加数量）
    for (let v = 2; v <= 6; v++) {
      const myCount = (counts[v] || 0) + onesCount;
      if (myCount >= 2) {
        const bid = {
          quantity: lastBid.quantity + 1,
          value: v,
          mode: 'fly'
        };
        const validation = GameEngine.validateBid(lastBid, bid);
        if (validation.valid && this.isBidReasonable(myDice, bid, totalDice)) {
          candidates.push(bid);
        }
      }
    }

    if (candidates.length === 0) return null;

    // 从候选中随机选一个
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  /**
   * 判断叫数是否合理（不会太离谱）
   */
  isBidReasonable(myDice, bid, totalDice) {
    const credibility = this.assessBidCredibility(myDice, bid, totalDice);
    // 保守风格要 credibility > 0.4，激进可以低到 0.2
    const threshold = 0.4 - this.style * 0.1;
    return credibility >= threshold;
  }
}

module.exports = BotPlayer;
