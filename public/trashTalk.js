/**
 * 大话骰 - 损友吐槽系统
 * 事件驱动，本地自动生成弹幕，营造酒吧损友互怼氛围
 */
(function () {
  'use strict';

  // ========== 文案库 ==========
  const LINES = {
    // 我叫数后（自嗨式）
    myBid: [
      '就这？随便叫叫',
      '别怂啊兄弟',
      '这波稳了',
      '闭眼都能中',
      '不信？来开啊',
      '让我瞅瞅手气',
    ],
    // 别人叫数后（群嘲）
    otherBid: [
      '你这叫得太虚了吧',
      '吹牛不打草稿的吗',
      '真有这么多？',
      '我不信，就不信',
      '这 bluff 能骗到谁',
      '酒劲上来了？',
      '你是不是摇了两次',
      '哎哟喂，大胆啊',
    ],
    // 我被劈
    meChallenged: [
      '来啊，互相伤害啊',
      '劈就劈，谁怕谁',
      '我今天就是要和你耗上',
      '再加倍！我奉陪到底',
      '🍺 这杯迟早是你的',
    ],
    // 别人被劈（看戏）
    otherChallenged: [
      '哎哟，有好戏看了',
      '谁输谁喝啊',
      '这一下可大了',
      '上倍数了，上倍数了',
      '让我备好酒',
    ],
    // 我反劈
    myCounter: [
      '翻倍翻倍再翻倍！',
      '敢劈就敢反',
      '今天喝到吐谁怕谁',
      '牌运在我这呢',
    ],
    // 我开骰赢
    meWinOpen: [
      '哎我就说你在吹🐮',
      '自古真情留不住，总是 bluff 得人心',
      '送分题你也能做错？',
      '这酒我代你喝？不可能的',
      '🍺 走你，三杯起步',
    ],
    // 我开骰输
    meLoseOpen: [
      '我去，看走眼了',
      '这把算我输行了吧',
      '下回一定，下回一定',
      '就当请兄弟们喝杯酒',
      '酒劲上头了，怪酒不怪我',
    ],
    // 别人赢（损 winner）
    otherWin: [
      '哟，今天运气不错嘛',
      '别得瑟，还早呢',
      '脸有点红啊，牌运不错',
      '这一局就当让你',
      '下一局看我的',
    ],
    // 别人输（群嘲 loser）
    otherLose: [
      '菜！是真的菜',
      '🍺 喝好喝满啊兄弟',
      '这一杯，敬你的牌技',
      '看来今晚你得打车回去了',
      '慢慢品，别急',
      '脸上写着"我要输了"',
    ],
    // 出豹子/纯豹
    leopard: [
      '卧槽？这运气是充钱了？',
      '再摇一次给我看看',
      '这骰子是焊死的？',
      '手气不错啊老六',
    ],
    // 单骰（归零）
    single: [
      '哈哈哈哈全花了',
      '这把等于白摇',
      '骰子都不想帮你',
      '运气被你花光了',
    ],
    // 连败 3 局以上
    streak: [
      '🍺 这杯我替你喝？不，你自己喝',
      '兄弟你脸都喝绿了',
      '别打了，认输吧',
      '醒醒，你在酒吧，不是赌场',
      '建议今晚退出群聊',
    ],
    // 快到点（倒计时 <= 5s）
    timerWarn: [
      '快啊！别磨叽',
      '老板，再来一杯定定神',
      '想啥呢想啥呢',
      '30秒都不够你用？',
    ],
    // 认输
    mySurrender: [
      '好好好我喝我喝还不行吗',
      '认怂了，下把回来',
      '这杯我扛',
    ],
    // 别人认输
    otherSurrender: [
      '哟怂了怂了',
      '就这？',
      '🍺 喝完这杯再说',
      '早就该认了',
    ],
  };

  // 机器人发言用的"其他玩家"昵称（从 playerOrder 里随机挑一个非自己的）
  function pickSpeaker(excludeMe = true) {
    if (!window.state) return null;
    const all = window.state.playerOrder || [];
    const candidates = excludeMe
      ? all.filter(p => p.id !== window.state.playerId)
      : all;
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function pickLine(category) {
    const arr = LINES[category];
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /**
   * 伪造一条本地弹幕（不走服务器，避免打扰真实聊天）
   * speaker: { id, nickname } 可选，没传就随机
   */
  function showLocalDanmaku(text, speaker) {
    if (!text) return;
    const sp = speaker || pickSpeaker(true);
    if (!sp) return;

    if (typeof window.showDanmaku === 'function') {
      window.showDanmaku({
        playerId: sp.id,
        nickname: sp.nickname,
        text,
      });
    }
  }

  // ========== 触发节流（避免一下喷太多）==========
  let lastFireAt = 0;
  const MIN_INTERVAL = 800; // 两次吐槽最小间隔（ms）

  function fire(category, opts = {}) {
    const now = Date.now();
    if (now - lastFireAt < MIN_INTERVAL && !opts.force) return;

    // 概率控制，不是每次都喷，避免烦躁
    const prob = opts.probability ?? 0.65;
    if (Math.random() > prob) return;

    const line = pickLine(category);
    if (!line) return;

    // 延迟触发，更像真人反应（300-1200ms）
    const delay = opts.delay ?? (300 + Math.random() * 900);
    setTimeout(() => {
      showLocalDanmaku(line, opts.speaker);
    }, delay);

    lastFireAt = now;
  }

  // ========== 事件接口 ==========
  window.TrashTalk = {
    onMyBid() {
      fire('myBid', { probability: 0.25, speaker: { id: window.state?.playerId, nickname: window.state?.nickname } });
    },
    onOtherBid(bidderId) {
      // 让"非叫数者"中的人来吐槽
      const all = window.state?.playerOrder || [];
      const candidates = all.filter(p => p.id !== bidderId);
      if (candidates.length === 0) return;
      const sp = candidates[Math.floor(Math.random() * candidates.length)];
      fire('otherBid', { probability: 0.4, speaker: sp });
    },
    onMeChallenged() {
      fire('meChallenged', { probability: 0.7 });
    },
    onOtherChallenged() {
      fire('otherChallenged', { probability: 0.6 });
    },
    onMyCounter() {
      fire('myCounter', { probability: 0.5, speaker: { id: window.state?.playerId, nickname: window.state?.nickname } });
    },
    onMeWinOpen() {
      fire('meWinOpen', { probability: 0.75, speaker: { id: window.state?.playerId, nickname: window.state?.nickname }, delay: 800 });
    },
    onMeLoseOpen() {
      fire('meLoseOpen', { probability: 0.75, speaker: { id: window.state?.playerId, nickname: window.state?.nickname }, delay: 800 });
    },
    onOtherWin(winnerId) {
      const all = window.state?.playerOrder || [];
      const candidates = all.filter(p => p.id !== winnerId);
      if (candidates.length === 0) return;
      const sp = candidates[Math.floor(Math.random() * candidates.length)];
      fire('otherWin', { probability: 0.7, speaker: sp, delay: 1000 });
    },
    onOtherLose(loserId) {
      const all = window.state?.playerOrder || [];
      const candidates = all.filter(p => p.id !== loserId);
      if (candidates.length === 0) return;
      const sp = candidates[Math.floor(Math.random() * candidates.length)];
      fire('otherLose', { probability: 0.85, speaker: sp, delay: 1500, force: true });
    },
    onLeopard(playerId) {
      fire('leopard', { probability: 0.9, delay: 2000, force: true });
    },
    onSingle(playerId) {
      fire('single', { probability: 0.8, delay: 2000, force: true });
    },
    onStreak(loserId) {
      const all = window.state?.playerOrder || [];
      const candidates = all.filter(p => p.id !== loserId);
      if (candidates.length === 0) return;
      const sp = candidates[Math.floor(Math.random() * candidates.length)];
      fire('streak', { probability: 1.0, speaker: sp, delay: 2500, force: true });
    },
    onTimerWarn() {
      fire('timerWarn', { probability: 0.5 });
    },
    onMySurrender() {
      fire('mySurrender', { probability: 0.8, speaker: { id: window.state?.playerId, nickname: window.state?.nickname } });
    },
    onOtherSurrender(surrenderId) {
      const all = window.state?.playerOrder || [];
      const candidates = all.filter(p => p.id !== surrenderId);
      if (candidates.length === 0) return;
      const sp = candidates[Math.floor(Math.random() * candidates.length)];
      fire('otherSurrender', { probability: 0.75, speaker: sp });
    },
  };
})();
