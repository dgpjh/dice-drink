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

  // ========== 人设专属文案（按昵称匹配）==========
  // 仅覆盖高频分类，其它分类 fallback 到通用 LINES
  // 混排策略：命中专属池时，60% 用专属、40% 用通用，避免角色感过于重复
  const PERSONAL_LINES = {
    'Tom Dwan': {
      myBid: ['这把我 all in', '让你看看什么叫 durrrr', '深夜高额桌的感觉回来了'],
      otherBid: ['你这手牌我猜到了', '算我头上，下次还', '你的 range 太窄了'],
      meWinOpen: ['三条在这把其实是弱牌', '就知道你在诈我', '这波该我赢'],
      meLoseOpen: ['欠条一张，改天还', '这把算我欠你的'],
      otherLose: ['下次来高额桌找我', '这点筹码还不够我塞牙缝'],
      leopard: ['这种牌面我见太多了', '高额桌天天上演'],
    },
    '周润发': {
      myBid: ['小意思，发哥从不 bluff', '一手烂牌也能打到最后', '发哥出手，必见血'],
      otherBid: ['运气这种东西，是要还的', '你还差了点火候', '赌场无父子'],
      meWinOpen: ['我赢的不是钱，是面子', '5 点也能变 9 点', '朱古力还有吗？'],
      meLoseOpen: ['愿赌服输，下一局', '发哥今天手气不顺'],
      otherLose: ['慢慢喝，别呛着', '这点酒算什么'],
      leopard: ['赌神附体', '该我发威了'],
    },
    '卢本伟': {
      myBid: ['我没开挂！', '芜湖～起飞', '这把是我演的'],
      otherBid: ['你这操作有点迷啊', '兄弟心态崩了？', '这把你听我的'],
      meWinOpen: ['看见没，真本事', '芜湖！', '这就叫五五开'],
      meLoseOpen: ['我真没开挂啊兄弟', '这把是故意让你的'],
      otherLose: ['菜就多练', '下次别送了'],
      leopard: ['这运气让我想起当年', '稳得一批'],
      streak: ['兄弟心态要稳', '深呼吸，下一把'],
    },
    '陈刀仔': {
      myBid: ['我用 10 蚊赢你 1000 万', '搏一搏，单车变摩托', '天无绝人之路'],
      otherBid: ['你这牌我早看穿了', '赌就要赌到底', '怕就别上桌'],
      meWinOpen: ['10 蚊博 1000 万，稳赚', '刀仔出手，从不落空', '这波赢麻了'],
      meLoseOpen: ['输就输，江湖再见', '下把我翻倍回来'],
      otherLose: ['认命啦兄弟', '输钱莫怨天'],
      myCounter: ['搏大细啊喂', '翻倍翻倍！'],
    },
    '乌兹': {
      myBid: ['稳住，我们能赢', '这波我来 carry', '上等马对下等马'],
      otherBid: ['你这操作有点 menace', '心态别崩', '这把团战让我'],
      meWinOpen: ['我还能再战十年', '小狗永不退役', '稳得一批'],
      meLoseOpen: ['这把团队没跟上', '下一把继续'],
      otherLose: ['菜，是原罪', '下次练练再来'],
      myCounter: ['团战开启', '跟我上！'],
      streak: ['心态要稳，小狗', '别浪，稳扎稳打'],
    },
    '布兰妮': {
      myBid: ['GTO 告诉我这里该叫', 'EV 是正的就对了', 'range 很宽，但我很稳'],
      otherBid: ['你这打法偏离 GTO 了', '底池赔率不对啊', '这手牌 EV 为负'],
      meWinOpen: ['solver 早就算好了', '数学不会骗人', '按 frequency 该我赢'],
      meLoseOpen: ['方差而已，长期看我是赢的', '样本太少，不说明问题'],
      otherLose: ['建议回去看看 GTO Wizard', 'solver 你学一下'],
      leopard: ['概率学的胜利', '符合分布'],
    },
    '臧书奴': {
      myBid: ['这把不能输', '让我算一下', '已经在脑海里走了三遍'],
      otherBid: ['你这思路不对', '再想想？', '没这么简单吧'],
      meWinOpen: ['计算无误', '一切尽在掌握', '细节决定成败'],
      meLoseOpen: ['有个变量没算进去', '下把调整'],
      otherLose: ['基本功不够', '回去多练'],
      timerWarn: ['快做决定', '别犹豫'],
    },
    '雷军': {
      myBid: ['Are you OK?', '这把性价比很高', '厚道的人不会输'],
      otherBid: ['Are you OK?', '这个价格有点贵了', '兄弟你没跑分吧'],
      meWinOpen: ['性价比之王', '感谢米粉支持', 'Are you OK？我 OK'],
      meLoseOpen: ['这把我请客', '下次发布会见'],
      otherLose: ['喝酒要讲性价比', '来，米粉陪你一杯'],
      leopard: ['这叫工业设计的胜利', '细节堆出来的'],
    },
    '童锦程': {
      myBid: ['兄弟们我爱你们', '这把我来，不能让兄弟失望', '冲冲冲'],
      otherBid: ['兄弟你这叫得有点虚', '心疼兄弟一秒', '稳住别慌'],
      meWinOpen: ['兄弟们这波不亏', '爱你们哦', '干就完了'],
      meLoseOpen: ['兄弟们对不起', '下把我扛'],
      otherLose: ['来兄弟，哥请你', '喝一杯，兄弟情深'],
      myCounter: ['兄弟们看我的', '这把必须硬刚'],
      mySurrender: ['兄弟我扛不住了', '这杯我喝，不让兄弟为难'],
    },
    '新疆炒米粉': {
      myBid: ['姐姐我叫这么多，你敢跟吗', '小朋友，姐带你玩', '喊这个数，给你留点面子'],
      otherBid: ['弟弟你在抖什么？', '就这点胆子也敢上桌', '姐姐笑了，你继续'],
      meWinOpen: ['姐姐从不输', '乖，叫声姐姐', '这把该你叫爸爸了'],
      meLoseOpen: ['输给你也是给你面子', '下一把，姐姐认真的'],
      otherLose: ['乖，喝了这杯叫姐姐', '弟弟不行啊', '姐姐敬你一杯，慢慢喝'],
      otherChallenged: ['有点意思，我看看谁先怂', '姐姐坐稳了看戏'],
      leopard: ['姐姐的牌运，你学不来', '这叫气场'],
      myCounter: ['就这？姐姐给你翻倍', '敢惹我，就玩到底'],
      mySurrender: ['这杯姐姐喝，给弟弟留点颜面', '今晚不跟你一般见识'],
    },
    'Tan Xuan': {
      myBid: ['底池赔率合适', '这手牌价值很明显', '深筹码时要谨慎'],
      otherBid: ['你这 sizing 有问题', '线路不太合理', '读牌读偏了'],
      meWinOpen: ['value bet 精准', '价值榨干', 'EPT 冠军的手感'],
      meLoseOpen: ['hero call 失败', '下把调整线路'],
      otherLose: ['基本功问题', '建议复盘一下'],
      myCounter: ['反加是必须的', '这里必须施压'],
    },
    '酱酱萌萌嘎': {
      myBid: ['嘤嘤嘤，哥哥让让嘛', '人家就叫这么多嘛～', '萌新第一次玩'],
      otherBid: ['哥哥你好凶哦', '萌萌哒，不想喝酒酒', '可是人家不相信嘛'],
      meWinOpen: ['嘻嘻，萌新的胜利～', '哥哥认输吧～', '运气好好哦'],
      meLoseOpen: ['呜呜呜人家输了', '哥哥欺负我', '喝酒酒～'],
      otherLose: ['哥哥喝酒酒啦～', '不要哭嘛～', '下次萌新陪你'],
      mySurrender: ['人家认输啦～', '嘤嘤嘤不打了'],
    },
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

  function pickLine(category, nickname) {
    const commonArr = LINES[category];
    const personalArr = (nickname && PERSONAL_LINES[nickname] && PERSONAL_LINES[nickname][category]) || null;

    // 有专属池：60% 走专属、40% 走通用（混排，避免角色感过于重复）
    if (personalArr && personalArr.length > 0) {
      const usePersonal = Math.random() < 0.6 || !commonArr || commonArr.length === 0;
      const arr = usePersonal ? personalArr : commonArr;
      return arr[Math.floor(Math.random() * arr.length)];
    }

    // 无专属池：走通用
    if (!commonArr || commonArr.length === 0) return null;
    return commonArr[Math.floor(Math.random() * commonArr.length)];
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

    // 先确定发言者（决定台词是走专属池还是通用池）
    const sp = opts.speaker || pickSpeaker(true);
    if (!sp) return;

    const line = pickLine(category, sp.nickname);
    if (!line) return;

    // 延迟触发，更像真人反应（300-1200ms）
    const delay = opts.delay ?? (300 + Math.random() * 900);
    setTimeout(() => {
      showLocalDanmaku(line, sp);
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
