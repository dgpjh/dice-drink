/**
 * 大话骰 - 规则集（RuleSet）
 *
 * 提供多种玩法预设，支持创房时选择。单骰行为独立配置。
 */

/**
 * 规则预设定义
 *
 * 字段说明：
 *   hasFlyZhai        - 是否启用飞/斋模式（guo1 为 false）
 *   oneAsWildMode     - 1 点癞子规则
 *     'always'        : 飞模式下 1 始终为癞子（经典）
 *     'beforeCalled1' : 叫 1 之前 1 当癞；有人叫过 "N个1" 后 1 不再当癞（过1不癞）
 *   conversion.zhaiToFly - 斋转飞数量变化： 'plus2' (+2) | 'times2' (×2)
 *   conversion.flyToZhai - 飞转斋数量变化： 'minus1' (-1) | 'halvePlus1' (÷2向上取整 +1)
 *   oneCallResetQuantity - guo1 模式下，叫 "N个1" 是否可以作为"重置叫数"的起叫点（解锁独立起叫数）
 */
const PRESETS = {
  classic: {
    id: 'classic',
    name: '经典飞斋',
    shortDesc: '+2/-1，1点飞时为癞',
    detail: [
      '飞模式下 1 点当万能癞子',
      '斋模式下 1 点只是 1',
      '斋→飞：数量 +2',
      '飞→斋：数量 -1',
      '叫 1 点自动变斋'
    ],
    hasFlyZhai: true,
    oneAsWildMode: 'always',
    conversion: {
      zhaiToFly: 'plus2',
      flyToZhai: 'minus1'
    }
  },

  guo1: {
    id: 'guo1',
    name: '过1不癞',
    shortDesc: '无飞斋，叫过1后1不再当癞',
    detail: [
      '没有飞斋之分，所有叫法都是"X 个 Y"',
      '点数大小：2 < 3 < 4 < 5 < 6 < 1（1 最大）',
      '默认 1 点当万能癞子',
      '起叫："N 个 1"需 N=玩家数起叫（2人→2个1，3人→3个1，4人→4个1）',
      '起叫：2~6 点需 2×玩家数-1 起叫（2人→3个，3人→5个，4人→7个）',
      '叫 1 是"升华叫法"：任何时候都可直接用起叫数重新开叫',
      '一旦有人叫过"N个1"，之后全局 1 不再当癞子（只能按纯点数算）',
      '叫 1 之后仍可继续叫 1，但 1 不再当癞'
    ],
    hasFlyZhai: false,
    oneAsWildMode: 'beforeCalled1',
    oneCallResetQuantity: true,
    conversion: null
  },

  northern: {
    id: 'northern',
    name: '北派倍率',
    shortDesc: '斋→飞×2，飞→斋÷2+1',
    detail: [
      '飞模式下 1 点当万能癞子',
      '斋→飞：数量 ×2（例如 3个斋 → 至少 6个飞）',
      '飞→斋：数量 ÷2 向上取整后 +1（例如 6个飞 → 至少 4个斋）',
      '叫 1 点自动变斋'
    ],
    hasFlyZhai: true,
    oneAsWildMode: 'always',
    conversion: {
      zhaiToFly: 'times2',
      flyToZhai: 'halvePlus1'
    }
  }
};

/**
 * 单骰行为选项（独立配置，和预设正交）
 *
 *   zero   : 单骰直接判骰子归零（当前默认）
 *   normal : 单骰当普通牌处理，按点数正常计数（不归零、不触发豹子）
 *   reroll : 单骰重摇；连续 N 次单骰者直接判负
 */
const SINGLE_BEHAVIORS = {
  zero: {
    id: 'zero',
    name: '归零',
    desc: '单骰直接归零，这 5 颗骰子不算数'
  },
  normal: {
    id: 'normal',
    name: '正常',
    desc: '单骰按普通牌算，点数照常计数'
  },
  reroll: {
    id: 'reroll',
    name: '重摇',
    desc: '单骰重新摇，连续 3 次单骰判负'
  }
};

const DEFAULT_SINGLE_REROLL_MAX_STREAK = 3;

/**
 * 根据预设 id + 单骰行为构造完整 RuleSet
 * @param {string} presetId
 * @param {string} singleBehavior
 * @returns {object} RuleSet
 */
function createRuleSet(presetId = 'classic', singleBehavior = 'zero') {
  const preset = PRESETS[presetId] || PRESETS.classic;
  const behavior = SINGLE_BEHAVIORS[singleBehavior] ? singleBehavior : 'zero';

  return {
    preset: preset.id,
    presetName: preset.name,
    presetDetail: preset.detail,
    hasFlyZhai: preset.hasFlyZhai !== false,
    oneAsWildMode: preset.oneAsWildMode,
    oneCallResetQuantity: preset.oneCallResetQuantity === true,
    conversion: preset.conversion ? { ...preset.conversion } : null,
    singleBehavior: behavior,
    singleBehaviorName: SINGLE_BEHAVIORS[behavior].name,
    singleRerollMaxStreak: DEFAULT_SINGLE_REROLL_MAX_STREAK
  };
}

/**
 * 获取所有预设的简要列表（给前端下拉用）
 */
function listPresets() {
  return Object.values(PRESETS).map(p => ({
    id: p.id,
    name: p.name,
    shortDesc: p.shortDesc,
    detail: p.detail
  }));
}

/**
 * 获取所有单骰行为（给前端下拉用）
 */
function listSingleBehaviors() {
  return Object.values(SINGLE_BEHAVIORS);
}

module.exports = {
  PRESETS,
  SINGLE_BEHAVIORS,
  createRuleSet,
  listPresets,
  listSingleBehaviors,
  DEFAULT_SINGLE_REROLL_MAX_STREAK
};
