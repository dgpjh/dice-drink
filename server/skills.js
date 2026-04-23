/**
 * 大话骰 - 角色技能定义
 *
 * 共 6 个技能：4 主动 + 2 被动
 *   主动：peek（透视）/ reroll（换骰）/ bigReroll（大换骰）/ silencer（封口）
 *   被动：axeman（斧头帮）/ lucky（好运姐）
 *
 * 每人每场 1 个技能：
 *   - 主动技能每场可用 1 次
 *   - 被动技能整场一直生效
 */

const SKILLS = {
  peek: {
    id: 'peek',
    name: '透视',
    icon: '👁️',
    type: 'active',
    desc: '偷看指定玩家的 1 颗骰子',
    tip: '本局开始后使用，选择一位对手',
    maxUsePerGame: 1,
    timing: 'myTurn',          // 只能在自己回合使用
    needTarget: true           // 需要选择目标玩家
  },
  reroll: {
    id: 'reroll',
    name: '换骰',
    icon: '🎲',
    type: 'active',
    desc: '换掉自己 1 颗骰子',
    tip: '只能在自己本局第一次叫数前使用',
    maxUsePerGame: 1,
    timing: 'myFirstTurnBeforeBid',  // 自己第一个回合、自己还没叫过数时
    needDiceIndex: true              // 需要选择骰子索引
  },
  bigReroll: {
    id: 'bigReroll',
    name: '大换骰',
    icon: '🎲🎲',
    type: 'active',
    desc: '全部 5 颗骰子重摇',
    tip: '只能在自己本局第一次叫数前使用',
    maxUsePerGame: 1,
    timing: 'myFirstTurnBeforeBid'
  },
  silencer: {
    id: 'silencer',
    name: '封口',
    icon: '🔒',
    type: 'active',
    desc: '自己叫数后，强制下家只能"劈"或"认输"',
    tip: '在叫数前激活，下一次叫数生效',
    maxUsePerGame: 1,
    timing: 'myTurnBeforeBid'  // 叫数前激活（和叫数一起生效）
  },
  axeman: {
    id: 'axeman',
    name: '斧头帮',
    icon: '🪓',
    type: 'passive',
    desc: '自己喊"劈"时，被劈方不能认输',
    tip: '被动生效，整场比赛都触发'
  },
  lucky: {
    id: 'lucky',
    name: '好运姐',
    icon: '🍀',
    type: 'passive',
    desc: '摇骰时，摇到 1 的概率 1/6 → 1/5',
    tip: '被动生效，整场比赛都触发'
  }
};

const SKILL_ORDER = ['peek', 'reroll', 'bigReroll', 'silencer', 'axeman', 'lucky'];

/**
 * 人设 → 技能 绑定（对应 BotPlayer 里的 BOT_NAMES）
 * 绑定思路：名字的人格 or 标签 匹配技能调性
 */
const NICKNAME_TO_SKILL = {
  'Tom Dwan':    'peek',       // 扑克之王，当然要看对手的牌
  '周润发':       'axeman',     // 赌神气场 → 喊劈禁认输
  '卢本伟':       'bigReroll',  // 5 5 开，重摇人生
  '陈刀仔':       'lucky',      // 我只靠一双手，运气够用
  '乌兹':         'silencer',   // 沉默寡言老 u 锁喉
  '布兰妮':       'reroll',     // Oops!…I Did It Again，换一颗
  '臧书奴':       'peek',       // 读书人博闻强记，偷窥情报
  '雷军':         'reroll',     // Are you OK? 再来一颗
  '童锦程':       'silencer',   // 老六话不多，叫完就封
  '新疆炒米粉':    'lucky',      // 抖音御姐天选
  'Tan Xuan':    'axeman',     // 极限斧头帮
  '酱酱萌萌嘎':    'bigReroll'   // 啊啊啊不要了重来
};

/**
 * 根据昵称（不含🤖前缀）获取人设技能，找不到返回 null
 */
function getSkillByNickname(nicknameNoEmoji) {
  return NICKNAME_TO_SKILL[nicknameNoEmoji] || null;
}

/**
 * 获取所有技能定义（给前端拉取）
 */
function listSkills() {
  return SKILL_ORDER.map(id => ({
    id,
    name: SKILLS[id].name,
    icon: SKILLS[id].icon,
    type: SKILLS[id].type,
    desc: SKILLS[id].desc,
    tip: SKILLS[id].tip
  }));
}

/**
 * 随机挑一个技能
 */
function randomSkillId() {
  return SKILL_ORDER[Math.floor(Math.random() * SKILL_ORDER.length)];
}

/**
 * 给玩家创建技能状态对象（存入 player.skill）
 */
function createSkillState(skillId) {
  if (!skillId || !SKILLS[skillId]) return null;
  const def = SKILLS[skillId];
  return {
    id: skillId,
    name: def.name,
    icon: def.icon,
    type: def.type,
    desc: def.desc,
    used: false,
    // 封口激活状态：叫数时激活 → 下家必须劈/认输 → 下家处理完清除
    pendingSilencer: false
  };
}

/**
 * 摇骰时根据好运姐技能做概率偏置
 * 好运姐：每颗骰子有 1/5 概率是 1，其他 4/5 均分到 2-6
 * @param {number} count
 * @param {boolean} isLucky
 * @returns {number[]}
 */
function rollDiceWithSkill(count, isLucky) {
  const dice = [];
  for (let i = 0; i < count; i++) {
    if (isLucky) {
      // 1/5 概率出 1；4/5 概率出 2-6 各 1/5（= 4/25）
      const r = Math.random();
      if (r < 1 / 5) {
        dice.push(1);
      } else {
        dice.push(2 + Math.floor(Math.random() * 5));
      }
    } else {
      dice.push(1 + Math.floor(Math.random() * 6));
    }
  }
  return dice.sort((a, b) => a - b);
}

module.exports = {
  SKILLS,
  SKILL_ORDER,
  NICKNAME_TO_SKILL,
  getSkillByNickname,
  listSkills,
  randomSkillId,
  createSkillState,
  rollDiceWithSkill
};
