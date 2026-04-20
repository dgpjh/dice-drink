/**
 * 大话骰 - 核心游戏引擎
 * 包含：摇骰、叫数规则、飞斋转换、特殊牌型、开骰判定、劈骰、计分
 *
 * 支持可配置 RuleSet：
 *   - hasFlyZhai: true | false（guo1 为 false，无飞斋）
 *   - oneAsWildMode: 'always' | 'beforeCalled1'
 *   - conversion.zhaiToFly: 'plus2' | 'times2'
 *   - conversion.flyToZhai: 'minus1' | 'halvePlus1'
 *   - oneCallResetQuantity: boolean（叫 N个1 可作为起叫点重置）
 *   - singleBehavior: 'zero' | 'normal' | 'reroll'
 */

const { createRuleSet } = require('./rules');

class GameEngine {
  /**
   * 点数大小排序值：2<3<4<5<6<1（1最大）
   */
  static diceRank(value) {
    if (value === 1) return 7;
    return value;
  }

  /**
   * 根据玩家人数获取起叫限制
   * 2人: 飞起叫3个, 斋起叫3个, 1点起叫2个
   * 3人: 飞起叫5个, 斋起叫4个, 1点起叫3个
   * 4人: 飞起叫7个, 斋起叫5个, 1点起叫4个
   *
   * guo1（无飞斋）起叫限制（独立字段）：
   *   1点起叫 = 玩家数（2人2个1，3人3个1，4人4个1）
   *   非1点起叫 = 2×玩家数-1（2人3个，3人5个，4人7个）
   */
  static getMinBidByPlayerCount(playerCount) {
    const rules = {
      2: { fly: 3, zhai: 3, one: 2, guo1One: 2, guo1Other: 3 },
      3: { fly: 5, zhai: 4, one: 3, guo1One: 3, guo1Other: 5 },
      4: { fly: 7, zhai: 5, one: 4, guo1One: 4, guo1Other: 7 }
    };
    return rules[playerCount] || rules[2];
  }

  /**
   * 生成随机骰子
   */
  static rollDice(count = 5) {
    const dice = [];
    for (let i = 0; i < count; i++) {
      dice.push(Math.floor(Math.random() * 6) + 1);
    }
    return dice.sort((a, b) => a - b);
  }

  /**
   * 检测特殊牌型
   * @returns {{ type: 'single'|'pureLeopard'|'leopard'|'normal', detail: object }}
   */
  static detectPattern(dice) {
    const counts = {};
    for (const d of dice) {
      counts[d] = (counts[d] || 0) + 1;
    }

    const uniqueValues = Object.keys(counts).map(Number);

    // 单骰：5颗点数全部不同
    if (uniqueValues.length === 5) {
      return { type: 'single', detail: { description: '单骰！骰子归零' } };
    }

    // 纯豹：5颗完全相同
    if (uniqueValues.length === 1) {
      const val = uniqueValues[0];
      return {
        type: 'pureLeopard',
        detail: { value: val, count: 7, description: `纯豹！${val}点算7个` }
      };
    }

    // 豹子：含1凑成5颗相同（非纯豹）
    const onesCount = counts[1] || 0;
    for (let n = 2; n <= 6; n++) {
      const nCount = counts[n] || 0;
      if (nCount + onesCount === 5 && nCount > 0 && onesCount > 0) {
        return {
          type: 'leopard',
          detail: { value: n, count: 6, description: `豹子！${n}点算6个` }
        };
      }
    }

    return { type: 'normal', detail: { description: '普通牌型' } };
  }

  /**
   * 判断当前语境下 1 是否应当作为万能癞子
   * @param {string} mode - 'fly' | 'zhai' | 'guo1'（guo1 模式下使用）
   * @param {number} targetValue - 目标点数
   * @param {object} ruleSet
   * @param {object} context - { onesCalled: boolean } 本局是否叫过1
   */
  static isOneWild(mode, targetValue, ruleSet, context = {}) {
    // 目标就是1，永远不算癞子
    if (targetValue === 1) return false;

    const rs = ruleSet || createRuleSet();

    // 无飞斋模式（guo1）：按 oneAsWildMode 'beforeCalled1' 语义
    if (rs.hasFlyZhai === false) {
      if (rs.oneAsWildMode === 'beforeCalled1') {
        return !context.onesCalled;
      }
      // 其他模式在无飞斋下默认：未叫过1时当癞
      return !context.onesCalled;
    }

    // 有飞斋模式
    // 斋模式下 1 永远不是癞
    if (mode !== 'fly') return false;

    const wildMode = rs.oneAsWildMode || 'always';
    if (wildMode === 'always') return true;
    if (wildMode === 'beforeCalled1') {
      return !context.onesCalled;
    }
    // 兼容旧字段 afterCalled1（若存在，只有叫过1才当癞）
    if (wildMode === 'afterCalled1') {
      return !!context.onesCalled;
    }
    return true;
  }

  /**
   * 统计骰子中某点数的实际数量（考虑飞/斋、特殊牌型、规则集）
   * @param {number[]} dice
   * @param {number} targetValue
   * @param {string} mode - 'fly' | 'zhai'
   * @param {object} ruleSet
   * @param {object} context - { onesCalled: boolean }
   */
  static countDice(dice, targetValue, mode, ruleSet = null, context = {}) {
    const rs = ruleSet || createRuleSet();
    const pattern = this.detectPattern(dice);
    const oneIsWild = this.isOneWild(mode, targetValue, rs, context);

    // 单骰
    if (pattern.type === 'single') {
      if (rs.singleBehavior === 'zero') {
        return { count: 0, pattern };
      }
      // 'normal' / 'reroll'：reroll 理应在摇骰阶段就已重摇，走到这里按普通处理兜底
      const counts = {};
      for (const d of dice) counts[d] = (counts[d] || 0) + 1;
      let total = counts[targetValue] || 0;
      if (oneIsWild) total += (counts[1] || 0);
      return { count: total, pattern };
    }

    // 纯豹
    if (pattern.type === 'pureLeopard') {
      if (pattern.detail.value === targetValue) {
        return { count: 7, pattern };
      }
      // 纯豹1当万能（需满足"1在当前语境下可当癞"）
      if (pattern.detail.value === 1 && oneIsWild) {
        return { count: 7, pattern };
      }
      return { count: 0, pattern };
    }

    // 豹子（含1凑5同）
    if (pattern.type === 'leopard') {
      if (pattern.detail.value === targetValue) {
        return { count: 6, pattern };
      }
      // 叫其他点数时，豹子加成不触发，回归普通癞子规则
      const counts = {};
      for (const d of dice) counts[d] = (counts[d] || 0) + 1;
      let total = counts[targetValue] || 0;
      if (oneIsWild) total += (counts[1] || 0);
      return { count: total, pattern };
    }

    // 普通牌型
    const counts = {};
    for (const d of dice) counts[d] = (counts[d] || 0) + 1;
    let total = counts[targetValue] || 0;
    if (oneIsWild) total += (counts[1] || 0);
    return { count: total, pattern };
  }

  /**
   * 开骰判定：统计所有玩家骰子总数（支持2-4人 + ruleSet）
   * @param {Object.<string, number[]>} allPlayerDice
   * @param {object} lastBid - { quantity, value, mode }
   * @param {object} ruleSet
   * @param {object} context - { onesCalled: boolean }
   */
  static resolveBid(allPlayerDice, lastBid, ruleSet = null, context = {}) {
    const rs = ruleSet || createRuleSet();
    const { quantity, value, mode } = lastBid;
    const playerResults = {};
    let totalCount = 0;

    for (const [pid, dice] of Object.entries(allPlayerDice)) {
      const result = this.countDice(dice, value, mode, rs, context);
      playerResults[pid] = result;
      totalCount += result.count;
    }

    return {
      totalCount,
      bidQuantity: quantity,
      bidEstablished: totalCount >= quantity,
      playerResults
    };
  }

  /**
   * 计算斋→飞的最小数量（根据 ruleSet）
   */
  static minQuantityZhaiToFly(prevQuantity, ruleSet) {
    const rule = (ruleSet && ruleSet.conversion && ruleSet.conversion.zhaiToFly) || 'plus2';
    if (rule === 'times2') return prevQuantity * 2;
    return prevQuantity + 2; // plus2
  }

  /**
   * 计算飞→斋的最小数量（根据 ruleSet）
   */
  static minQuantityFlyToZhai(prevQuantity, ruleSet) {
    const rule = (ruleSet && ruleSet.conversion && ruleSet.conversion.flyToZhai) || 'minus1';
    if (rule === 'halvePlus1') return Math.ceil(prevQuantity / 2) + 1;
    return prevQuantity - 1; // minus1
  }

  /**
   * 验证叫数是否合法
   * @param {object|null} prevBid
   * @param {object} newBid
   * @param {number} playerCount
   * @param {object} ruleSet
   * @param {object} context - { onesCalled: boolean } 本局是否叫过1（guo1用）
   */
  static validateBid(prevBid, newBid, playerCount = 2, ruleSet = null, context = {}) {
    const rs = ruleSet || createRuleSet();

    if (newBid.quantity < 1) {
      return { valid: false, reason: '数量必须大于0' };
    }

    if (newBid.value < 1 || newBid.value > 6) {
      return { valid: false, reason: '点数必须在1-6之间' };
    }

    const minBid = this.getMinBidByPlayerCount(playerCount);

    // ============ 无飞斋（guo1）模式 ============
    if (rs.hasFlyZhai === false) {
      // 强制 mode 为 'guo1'（或无 mode）
      newBid.mode = 'guo1';

      const isCallingOne = newBid.value === 1;

      // 起叫限制
      if (isCallingOne) {
        if (newBid.quantity < minBid.guo1One) {
          return { valid: false, reason: `叫${newBid.value}点最少${minBid.guo1One}个起` };
        }
      } else {
        if (newBid.quantity < minBid.guo1Other) {
          return { valid: false, reason: `叫${newBid.value}点最少${minBid.guo1Other}个起` };
        }
      }

      // 没有上家 → 仅需满足起叫下限
      if (!prevBid) {
        return { valid: true, reason: '' };
      }

      // 叫 1 是"升华叫法"：只要是第一次叫 1（onesCalled === false），
      // 即可用起叫数（guo1One）重新开叫，不受上家数量/点数约束
      if (isCallingOne && rs.oneCallResetQuantity && !context.onesCalled) {
        // 已在上面校验 quantity >= minBid.guo1One，此处直接合法
        return { valid: true, reason: '' };
      }

      // 普通递增判定：数量更大，或同数量但点数更大（1 > 6）
      if (newBid.quantity > prevBid.quantity) return { valid: true, reason: '' };
      if (
        newBid.quantity === prevBid.quantity &&
        this.diceRank(newBid.value) > this.diceRank(prevBid.value)
      ) {
        return { valid: true, reason: '' };
      }
      return {
        valid: false,
        reason: `需要数量更大，或同数量下点数更大（当前：${prevBid.quantity}个${prevBid.value}）`
      };
    }

    // ============ 有飞斋（classic / northern）模式 ============
    // 叫1点时必须是斋
    if (newBid.value === 1 && newBid.mode === 'fly') {
      return { valid: false, reason: '叫1点时必须是斋模式' };
    }

    // 起叫限制
    if (newBid.value === 1) {
      if (newBid.quantity < minBid.one) {
        return { valid: false, reason: `叫1点最少${minBid.one}个起` };
      }
    } else if (newBid.mode === 'zhai') {
      if (newBid.quantity < minBid.zhai) {
        return { valid: false, reason: `斋模式最少${minBid.zhai}个起` };
      }
    } else {
      if (newBid.quantity < minBid.fly) {
        return { valid: false, reason: `飞模式最少${minBid.fly}个起` };
      }
    }

    if (!prevBid) {
      return { valid: true, reason: '' };
    }

    const prev = { ...prevBid };
    const next = { ...newBid };
    if (prev.value === 1) prev.mode = 'zhai';
    if (next.value === 1) next.mode = 'zhai';

    // 同模式
    if (prev.mode === next.mode) {
      if (next.quantity > prev.quantity) return { valid: true, reason: '' };
      if (next.quantity === prev.quantity && this.diceRank(next.value) > this.diceRank(prev.value)) {
        return { valid: true, reason: '' };
      }
      return {
        valid: false,
        reason: `同模式下需要数量更大或同数量点数更大（当前：${prev.quantity}个${prev.value}${prev.mode === 'fly' ? '飞' : '斋'}）`
      };
    }

    // 斋→飞
    if (prev.mode === 'zhai' && next.mode === 'fly') {
      const minFlyQuantity = this.minQuantityZhaiToFly(prev.quantity, rs);
      if (next.quantity >= minFlyQuantity) return { valid: true, reason: '' };
      return {
        valid: false,
        reason: `斋转飞需要数量至少${minFlyQuantity}个`
      };
    }

    // 飞→斋
    if (prev.mode === 'fly' && next.mode === 'zhai') {
      const minZhaiQuantity = this.minQuantityFlyToZhai(prev.quantity, rs);
      if (next.quantity >= minZhaiQuantity) return { valid: true, reason: '' };
      return {
        valid: false,
        reason: `飞转斋需要数量至少${minZhaiQuantity}个`
      };
    }

    return { valid: false, reason: '未知的模式转换' };
  }

  /**
   * 计算得分
   */
  static calculateScore(resultType, multiplier = 1) {
    if (resultType === 'surrender') {
      return Math.floor(multiplier / 2) || 1;
    }
    return multiplier;
  }
}

module.exports = GameEngine;
