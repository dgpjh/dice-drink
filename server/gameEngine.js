/**
 * 大话骰 - 核心游戏引擎
 * 包含：摇骰、叫数规则、飞斋转换、特殊牌型、开骰判定、劈骰、计分
 */

class GameEngine {
  /**
   * 点数大小排序值：2<3<4<5<6<1（1最大）
   */
  static diceRank(value) {
    if (value === 1) return 7;
    return value;
  }

  /**
   * 生成随机骰子
   * @param {number} count - 骰子数量
   * @returns {number[]} 骰子数组
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
   * @param {number[]} dice - 5颗骰子
   * @returns {{ type: string, detail: object }}
   *   type: 'single' | 'pureLeopard' | 'leopard' | 'normal'
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
   * 统计骰子中某点数的实际数量（考虑飞/斋和特殊牌型）
   * @param {number[]} dice - 5颗骰子
   * @param {number} targetValue - 目标点数(1-6)
   * @param {string} mode - 'fly'(飞) 或 'zhai'(斋)
   * @returns {{ count: number, pattern: object }}
   */
  static countDice(dice, targetValue, mode) {
    const pattern = this.detectPattern(dice);

    // 单骰：所有骰子归零
    if (pattern.type === 'single') {
      return { count: 0, pattern };
    }

    // 纯豹
    if (pattern.type === 'pureLeopard') {
      if (pattern.detail.value === targetValue) {
        return { count: 7, pattern };
      }
      // 飞模式下，纯豹的1点可以当万能
      if (mode === 'fly' && pattern.detail.value === 1) {
        return { count: 7, pattern };
      }
      return { count: 0, pattern };
    }

    // 豹子
    if (pattern.type === 'leopard') {
      if (pattern.detail.value === targetValue) {
        return { count: 6, pattern };
      }
      // 豹子是由1凑成的，如果目标不是豹子的点数
      // 飞模式下1当万能，但豹子的特殊计数只对匹配的点数生效
      if (mode === 'fly' && targetValue !== 1) {
        // 豹子内的1已经被用来凑豹子了，不重复统计
        // 但目标点数可能在骰子中有其他出现
        // 实际上豹子只有一种点数+1组成，所以不会有其他点数
        return { count: 0, pattern };
      }
      return { count: 0, pattern };
    }

    // 普通牌型：正常统计
    const counts = {};
    for (const d of dice) {
      counts[d] = (counts[d] || 0) + 1;
    }

    let total = counts[targetValue] || 0;
    // 飞模式下，1当万能（除非目标就是1）
    if (mode === 'fly' && targetValue !== 1) {
      total += (counts[1] || 0);
    }

    return { count: total, pattern };
  }

  /**
   * 开骰判定：统计双方骰子总数
   * @param {number[]} diceA - 玩家A的骰子
   * @param {number[]} diceB - 玩家B的骰子
   * @param {object} lastBid - 最后的叫数 { quantity, value, mode }
   * @returns {{ 
   *   totalCount: number, 
   *   bidQuantity: number,
   *   bidEstablished: boolean,
   *   playerAResult: object,
   *   playerBResult: object 
   * }}
   */
  static resolveBid(diceA, diceB, lastBid) {
    const { quantity, value, mode } = lastBid;
    const resultA = this.countDice(diceA, value, mode);
    const resultB = this.countDice(diceB, value, mode);
    const totalCount = resultA.count + resultB.count;

    return {
      totalCount,
      bidQuantity: quantity,
      bidEstablished: totalCount >= quantity,
      playerAResult: resultA,
      playerBResult: resultB
    };
  }

  /**
   * 验证叫数是否合法（是否比上一次叫数更大）
   * @param {object|null} prevBid - 上一次叫数 { quantity, value, mode }
   * @param {object} newBid - 新的叫数 { quantity, value, mode }
   * @returns {{ valid: boolean, reason: string }}
   */
  static validateBid(prevBid, newBid) {
    // 叫1点时必须是斋
    if (newBid.value === 1 && newBid.mode === 'fly') {
      return { valid: false, reason: '叫1点时必须是斋模式' };
    }

    if (newBid.quantity < 1) {
      return { valid: false, reason: '数量必须大于0' };
    }

    if (newBid.value < 1 || newBid.value > 6) {
      return { valid: false, reason: '点数必须在1-6之间' };
    }

    // 最低起叫数量限制
    if (newBid.value === 1) {
      // 叫1点（斋）最低2个
      if (newBid.quantity < 2) {
        return { valid: false, reason: '叫1点最少2个起' };
      }
    } else {
      // 飞或斋最低3个
      if (newBid.quantity < 3) {
        return { valid: false, reason: '叫数最少3个起（叫1点最少2个起）' };
      }
    }

    // 第一次叫数，任何合法叫数都行
    if (!prevBid) {
      return { valid: true, reason: '' };
    }

    const prev = { ...prevBid };
    const next = { ...newBid };

    // 处理叫1点默认斋的情况
    if (prev.value === 1) prev.mode = 'zhai';
    if (next.value === 1) next.mode = 'zhai';

    // 同模式比较
    if (prev.mode === next.mode) {
      if (next.quantity > prev.quantity) {
        return { valid: true, reason: '' };
      }
      if (next.quantity === prev.quantity && this.diceRank(next.value) > this.diceRank(prev.value)) {
        return { valid: true, reason: '' };
      }
      return {
        valid: false,
        reason: `同模式下需要数量更大或同数量点数更大（当前：${prev.quantity}个${prev.value}${prev.mode === 'fly' ? '飞' : '斋'}）`
      };
    }

    // 跨模式：斋→飞
    // 规则：数量 +2，无额外点数约束
    if (prev.mode === 'zhai' && next.mode === 'fly') {
      const minFlyQuantity = prev.quantity + 2;
      if (next.quantity >= minFlyQuantity) {
        return { valid: true, reason: '' };
      }
      return {
        valid: false,
        reason: `斋转飞需要数量至少${minFlyQuantity}个`
      };
    }

    // 跨模式：飞→斋
    // 规则：数量 -1，无额外点数约束
    if (prev.mode === 'fly' && next.mode === 'zhai') {
      const minZhaiQuantity = prev.quantity - 1;
      if (next.quantity >= minZhaiQuantity) {
        return { valid: true, reason: '' };
      }
      return {
        valid: false,
        reason: `飞转斋需要数量至少${minZhaiQuantity}个`
      };
    }

    return { valid: false, reason: '未知的模式转换' };
  }

  /**
   * 计算得分
   * @param {string} resultType - 'open'(开骰) | 'surrender'(认输)
   * @param {number} multiplier - 倍数（1=普通开，2/4/8=劈骰）
   * @returns {number} 得分
   */
  static calculateScore(resultType, multiplier = 1) {
    if (resultType === 'surrender') {
      return Math.floor(multiplier / 2) || 1;
    }
    return multiplier;
  }
}

module.exports = GameEngine;
