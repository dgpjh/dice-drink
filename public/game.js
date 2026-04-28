/**
 * 大话骰 - 前端游戏逻辑（支持2-4人）
 */

// =============== 状态管理 ===============
const state = {
  playerId: localStorage.getItem('liars_dice_player_id') || null,
  nickname: '',
  roomCode: '',
  ws: null,
  connected: false,
  reconnectAttempts: 0,
  maxReconnectAttempts: 15,
  reconnectTimer: null,

  // 房间设置
  maxPlayers: 2,
  selectedMaxPlayers: 2,

  // 规则集
  ruleSet: null,             // 当前房间规则（创房后由服务端下发）
  selectedPreset: 'classic', // 创房时选中的预设
  selectedSingleBehavior: 'zero', // 创房时选中的单骰行为
  rulesCatalog: null,        // 拉取到的预设/单骰行为列表缓存
  onesCalled: false,         // 本局是否已有人叫过1（过1不癞规则用）

  // 起叫规则（根据人数动态设置）
  minBidRules: { fly: 3, zhai: 3, one: 2 },

  // 游戏状态
  phase: 'home',
  myDice: [],
  bids: [],
  lastBid: null,
  isMyTurn: false,
  currentTurn: null,
  challenge: null,
  stats: {},

  // 多人玩家信息
  playerOrder: [],  // [{ id, nickname, connected }]
  opponent: null,   // 兼容2人模式

  // 叫数选择器
  selectedQuantity: 1,
  selectedValue: 2,
  selectedMode: 'fly',

  // 技能系统
  skillMode: 'none',           // 当前房间的技能模式 none/random/choose
  selectedSkillMode: 'none',   // 创房时选中的技能模式
  mySkill: null,               // 我的技能 { id, name, icon, type, desc, used }
  silencerTarget: null,        // 被封口的目标玩家id（下家不能叫数）
  silencerBy: null,            // 封口发起者
  myPendingSilencer: false,    // v2.6.4：我已激活封口，等待下次叫数生效
  peekedMap: {},               // 透视过的骰子缓存 { targetId: { idx, value, nickname } }
  skillsCatalog: [],           // 所有技能定义（给"自选"模式用）

  // 计时器
  timerInterval: null,
  timerRemaining: 30,

  // 等房间计时
  roomTimerInterval: null,
  roomCreatedAt: null,

  // v2.7.0：赛制系统
  matchConfig: null,                // 当前房间赛制配置 { mode, target, label }
  selectedMatchMode: 'free',        // 创房选中模式 free/time/rounds/maxLoss/totalLoss
  selectedMatchTarget: 5,           // 创房选中数值
  matchProgress: null,              // 实时进度 { roundsPlayed, maxLoss, totalLoss, timeLeftSec }
  matchCountdownTimer: null,        // 定时间倒计时定时器
  matchFinished: null               // 最终排名快照 { reason, ranking, rounds, ... }
};

// 暴露给 trashTalk.js 使用
window.state = state;

// =============== WebSocket ===============
function connectWS() {
  // 如果已有连接且处于 OPEN 或 CONNECTING 状态，不重复创建
  if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
    console.log('[WS] 已有连接，跳过');
    return;
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}`;
  console.log('[WS] 正在连接:', wsUrl);

  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    console.log('[WS] 连接成功');
    state.connected = true;
    state.reconnectAttempts = 0;
    hideDisconnectOverlay();

    // 如果有 playerId 且之前在房间中，尝试重连
    if (state.playerId && state.roomCode && state.phase !== 'home') {
      state.ws.send(JSON.stringify({
        type: 'reconnect',
        data: { playerId: state.playerId }
      }));
    }
  };

  state.ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    console.log('[WS] 收到:', msg.type, msg.data);
    handleMessage(msg);
  };

  state.ws.onclose = () => {
    console.log('[WS] 连接关闭');
    state.connected = false;
    if (state.phase !== 'home' && state.roomCode) {
      showDisconnectOverlay();
      attemptReconnect();
    }
  };

  state.ws.onerror = (err) => {
    console.error('[WS] 错误:', err);
  };
}

function attemptReconnect() {
  if (state.reconnectAttempts >= state.maxReconnectAttempts) {
    showToast('重连失败，请刷新页面', 'error');
    return;
  }
  state.reconnectTimer = setTimeout(() => {
    state.reconnectAttempts++;
    connectWS();
  }, 2000);
}

function sendMsg(type, data = {}) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type, data }));
  }
}

// =============== 辅助函数 ===============

/**
 * 根据玩家人数更新起叫规则
 * 2人: 飞3个, 斋3个, 1点2个；guo1：1→2, 非1→3
 * 3人: 飞5个, 斋4个, 1点3个；guo1：1→3, 非1→5
 * 4人: 飞7个, 斋5个, 1点4个；guo1：1→4, 非1→7
 */
function updateMinBidRules(playerCount) {
  const rules = {
    2: { fly: 3, zhai: 3, one: 2, guo1One: 2, guo1Other: 3 },
    3: { fly: 5, zhai: 4, one: 3, guo1One: 3, guo1Other: 5 },
    4: { fly: 7, zhai: 5, one: 4, guo1One: 4, guo1Other: 7 }
  };
  state.minBidRules = rules[playerCount] || rules[2];
}

// 判断当前是否 guo1 无飞斋模式
function isGuo1Mode() {
  return state.ruleSet && state.ruleSet.hasFlyZhai === false;
}

/**
 * 根据 playerId 获取玩家昵称
 */
function getPlayerName(pid) {
  if (pid === state.playerId) return state.nickname;
  const p = state.playerOrder.find(p => p.id === pid);
  return p ? p.nickname : '???';
}

/**
 * 获取当前操作者的昵称
 */
function getCurrentTurnName() {
  if (!state.currentTurn) return '???';
  if (state.currentTurn === state.playerId) return '你';
  return getPlayerName(state.currentTurn);
}

// =============== 消息处理 ===============
function handleMessage(msg) {
  const { type, data } = msg;

  switch (type) {
    case 'room_created':
      state.playerId = data.playerId;
      state.roomCode = data.roomCode;
      state.nickname = data.nickname;
      state.maxPlayers = data.maxPlayers || 2;
      if (data.ruleSet) state.ruleSet = data.ruleSet;
      if (data.skillMode) state.skillMode = data.skillMode;
      if (data.roomInfo?.skillMode) state.skillMode = data.roomInfo.skillMode;
      if (data.matchConfig) state.matchConfig = data.matchConfig;
      if (data.roomInfo?.matchConfig) state.matchConfig = data.roomInfo.matchConfig;
      localStorage.setItem('liars_dice_player_id', data.playerId);
      showWaitingPage(data);
      break;

    case 'room_joined':
      state.playerId = data.playerId;
      state.roomCode = data.roomCode;
      state.nickname = data.nickname;
      state.maxPlayers = data.roomInfo?.maxPlayers || 2;
      if (data.roomInfo?.ruleSet) state.ruleSet = data.roomInfo.ruleSet;
      if (data.roomInfo?.skillMode) state.skillMode = data.roomInfo.skillMode;
      if (data.roomInfo?.matchConfig) state.matchConfig = data.roomInfo.matchConfig;
      localStorage.setItem('liars_dice_player_id', data.playerId);
      showWaitingPage(data);
      break;

    case 'player_info':
      state.opponent = data.opponent;
      state.stats = data.stats;
      if (data.ruleSet) state.ruleSet = data.ruleSet;
      if (data.skillMode) state.skillMode = data.skillMode;
      if (data.matchConfig) state.matchConfig = data.matchConfig;
      if (data.you && data.you.skill !== undefined) state.mySkill = data.you.skill;
      if (data.playerOrder) {
        state.playerOrder = data.playerOrder;
        state.maxPlayers = data.maxPlayers || state.maxPlayers;
        // 根据实际人数更新起叫规则
        updateMinBidRules(data.playerOrder.length);
      }
      updateWaitingPlayerList();
      updateSkillChoosePanel();
      break;

    case 'game_start':
      state.myDice = data.yourDice;
      state.currentTurn = data.currentTurn;
      state.isMyTurn = data.currentTurn === state.playerId;
      state.bids = [];
      state.lastBid = null;
      state.challenge = null;
      state.phase = 'game';
      state.stats = data.stats;
      state.onesCalled = false;
      state.silencerTarget = null;
      state.silencerBy = null;
      state.myPendingSilencer = false;
      state.peekedMap = {};
      if (data.ruleSet) state.ruleSet = data.ruleSet;
      if (data.skillMode) state.skillMode = data.skillMode;
      if (data.yourSkill !== undefined) state.mySkill = data.yourSkill;
      if (data.playerOrder) {
        state.playerOrder = data.playerOrder;
      }
      if (data.minBidRules) {
        state.minBidRules = data.minBidRules;
      }
      // 显示本局摇骰阶段的单骰重摇事件
      if (data.rerollEvents && data.rerollEvents.length) {
        showRerollBanner(data.rerollEvents);
      }
      showGamePage(data);
      break;

    case 'bid_made':
      state.bids = data.bids;
      state.lastBid = data.bid;
      state.currentTurn = data.currentTurn;
      state.isMyTurn = data.currentTurn === state.playerId;
      if (typeof data.onesCalled === 'boolean') state.onesCalled = data.onesCalled;
      // 封口状态
      if (data.silencerOn) {
        state.silencerBy = data.silencerBy;
        state.silencerTarget = data.silencerTarget;
        // v2.6.4：如果是自己激活的封口已被消耗，清除 pending 徽章
        if (data.silencerBy === state.playerId) {
          state.myPendingSilencer = false;
        }
        const byName = getPlayerName(data.silencerBy);
        const tgtName = data.silencerTarget === state.playerId ? '你' : getPlayerName(data.silencerTarget);
        showToast(`🔒 ${byName} 激活封口！${tgtName} 只能劈或认输`, 'success');
      } else {
        state.silencerBy = null;
        state.silencerTarget = null;
      }
      updateBidHistory(data);
      updateActionArea();
      updateSkillBar();
      resetTimer();
      if (window.Sound) window.Sound.bid();
      // 损友吐槽
      if (window.TrashTalk) {
        const bidderId = data.bid && data.bid.playerId;
        if (bidderId === state.playerId) window.TrashTalk.onMyBid();
        else window.TrashTalk.onOtherBid(bidderId);
      }
      break;

    case 'challenge_started':
      state.challenge = {
        multiplier: data.multiplier,
        count: data.count,
        currentTurn: data.currentTurn,
        challenger: data.challenger,
        target: data.target
      };
      state.isMyTurn = data.currentTurn === state.playerId;
      state.phase = 'challenging';
      showChallengeUI(data);
      resetTimer();
      if (window.Sound) {
        window.Sound.challenge();
        window.Sound.airhorn();
      }
      // 损友吐槽
      if (window.TrashTalk) {
        if (data.target === state.playerId) window.TrashTalk.onMeChallenged();
        else window.TrashTalk.onOtherChallenged();
      }
      break;

    case 'counter_challenge':
      state.challenge = {
        multiplier: data.multiplier,
        count: data.count,
        maxReached: data.maxReached,
        currentTurn: data.currentTurn,
        player: data.player,
        target: data.target
      };
      state.isMyTurn = data.currentTurn === state.playerId;
      updateChallengeUI(data);
      resetTimer();
      if (window.Sound) {
        window.Sound.counter();
        window.Sound.airhorn();
      }
      // 损友吐槽
      if (window.TrashTalk) {
        if (data.player === state.playerId) window.TrashTalk.onMyCounter();
        else window.TrashTalk.onOtherChallenged();
      }
      break;

    case 'game_settled':
      state.phase = 'settlement';
      state.stats = data.stats;
      if (data.playerOrder) {
        state.playerOrder = data.playerOrder;
      }
      // v2.6.4：一局结束，清理 pending 状态
      state.myPendingSilencer = false;
      state.silencerTarget = null;
      state.silencerBy = null;
      clearTimer();
      // 震屏 + 闪白
      triggerOpenEffects();
      showSettlementPage(data);
      if (window.Sound) {
        // 先开骰声，再根据胜负响胜负音
        window.Sound.open();
        const isWinner = data.winner === state.playerId;
        const isLoser = data.loser === state.playerId;
        setTimeout(() => {
          if (isWinner) { window.Sound.win(); window.Sound.cheer(); }
          else if (isLoser) { window.Sound.lose(); window.Sound.groan(); }
        }, 500);
        // 检测豹子/纯豹/单骰，触发中奖/失望音
        if (data.allDice) {
          let hasJackpot = false;
          let hasSingle = false;
          let jackpotPid = null;
          let singlePid = null;
          Object.keys(data.allDice).forEach(pid => {
            const info = data.allDice[pid];
            if (!info || !info.pattern) return;
            if (info.pattern.type === 'leopard' || info.pattern.type === 'pureLeopard') {
              hasJackpot = true;
              jackpotPid = pid;
            }
            if (info.pattern.type === 'single') {
              hasSingle = true;
              singlePid = pid;
            }
          });
          if (hasJackpot) {
            setTimeout(() => window.Sound.jackpot(), 1200);
            if (window.TrashTalk) window.TrashTalk.onLeopard(jackpotPid);
          }
          if (hasSingle) {
            setTimeout(() => window.Sound.single(), 1400);
            if (window.TrashTalk) window.TrashTalk.onSingle(singlePid);
          }
        }
      }
      // 胜负损友吐槽
      if (window.TrashTalk) {
        if (data.winner === state.playerId) window.TrashTalk.onMeWinOpen();
        else if (data.loser === state.playerId) window.TrashTalk.onMeLoseOpen();
        if (data.loser) window.TrashTalk.onOtherLose(data.loser);
        if (data.winner && data.winner !== state.playerId) window.TrashTalk.onOtherWin(data.winner);
        // 连败
        const loserStats = data.stats && data.loser ? data.stats[data.loser] : null;
        if (loserStats && loserStats.streak >= 3) {
          window.TrashTalk.onStreak(data.loser);
        }
      }
      break;

    case 'play_again_request':
      showToast(`${data.nickname} 想再整一局！（${data.readyCount}/${data.totalPlayers}）`, 'success');
      const playAgainBtn = document.getElementById('btn-play-again');
      // v2.6.4：如果是自己发的请求，保持 disabled 状态避免闪烁
      const isMyRequest = data.playerId === state.playerId || data.nickname === state.nickname;
      if (!isMyRequest && !state.playAgainClicked) {
        playAgainBtn.disabled = false;
      }
      playAgainBtn.textContent = state.playAgainClicked
        ? `等其他人续杯...（${data.readyCount}/${data.totalPlayers}）`
        : `🎲 ${data.readyCount}/${data.totalPlayers} 已就位，速进！`;
      playAgainBtn.classList.add('btn-glow');
      break;

    case 'opponent_disconnected':
      showToast(data.message, 'error');
      break;

    case 'opponent_reconnected':
      showToast(`${data.nickname} 已重连`, 'success');
      break;

    case 'opponent_left':
      showToast(data.message, 'error');
      setTimeout(() => showPage('home'), 2000);
      break;

    case 'room_expired':
      showToast(data.message, 'error');
      setTimeout(() => showPage('home'), 2000);
      break;

    case 'game_state':
      handleGameStateRestore(data);
      break;

    case 'reconnect_failed':
      showToast(data.message, 'error');
      showPage('home');
      break;

    case 'timer_start':
      startTimer(data.duration);
      break;

    case 'error':
      showToast(data.message, 'error');
      break;

    case 'chat_message':
      showDanmaku(data);
      break;

    case 'skill_used':
      handleSkillUsedBroadcast(data);
      break;

    case 'skill_peek_result':
      handleSkillPeekResult(data);
      break;

    case 'skill_reroll_result':
      handleSkillRerollResult(data);
      break;

    case 'skill_peeked':
      showToast(data.message || '💀 有人偷看了你的骰子', 'error');
      break;

    case 'skill_choose_progress':
      handleSkillChooseProgress(data);
      break;

    case 'skill_choose_waiting':
      handleSkillChooseWaiting(data);
      break;

    // ============== v2.7.0：赛制系统 ==============
    case 'match_started':
      if (data.matchConfig) state.matchConfig = data.matchConfig;
      state.matchProgress = {
        mode: data.matchConfig?.mode,
        target: data.matchConfig?.target,
        label: data.matchConfig?.label,
        startedAt: data.startedAt,
        endsAt: data.endsAt,
        roundsPlayed: 0,
        finished: false
      };
      startMatchCountdownIfNeeded();
      updateMatchProgressBar();
      if (data.matchConfig?.label) {
        showToast(`🏁 赛制启动：${data.matchConfig.label}`, 'success');
      }
      break;

    case 'match_progress':
      state.matchProgress = data;
      updateMatchProgressBar();
      break;

    case 'match_time_up':
      if (state.matchProgress) state.matchProgress.timeUpFlag = true;
      stopMatchCountdown();
      updateMatchProgressBar();
      showToast(data.message || '⏱ 比赛时间已到，本局结束后公布排名', 'success');
      break;

    case 'match_finished':
      stopMatchCountdown();
      state.matchFinished = data;
      if (state.matchProgress) state.matchProgress.finished = true;
      showFinalRankingPage(data);
      break;
  }
}

// =============== 页面控制 ===============
function showPage(pageName) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${pageName}`).classList.add('active');
  state.phase = pageName;
}

function showModal(modalId) {
  document.getElementById(modalId).classList.add('active');
}

function hideModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

function hideAllModals() {
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
}

// 更新对局界面的规则徽章
function updateRulesetBadge() {
  const container = document.querySelector('#page-game .game-container');
  if (!container || !state.ruleSet) return;
  let badge = document.getElementById('ruleset-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'ruleset-badge';
    badge.className = 'ruleset-badge';
    badge.title = '点击查看规则详情';
    badge.addEventListener('click', () => {
      const rs = state.ruleSet;
      if (!rs) return;
      const lines = (rs.presetDetail || []).map(d => `• ${d}`).join('\n');
      showToast(`${rs.presetName} · 单骰:${rs.singleBehaviorName}\n${lines}`, 'success');
    });
    container.insertBefore(badge, container.firstChild);
  }
  const rs = state.ruleSet;
  badge.innerHTML = `<span class="badge-icon">📜</span> ${rs.presetName} · 单骰${rs.singleBehaviorName}`;
}

// 显示单骰重摇 banner
function showRerollBanner(events) {
  if (!events || !events.length) return;
  const latest = events[events.length - 1];
  const name = latest.playerId === state.playerId ? '你' : (latest.nickname || '有人');
  const banner = document.createElement('div');
  banner.className = 'reroll-banner';
  banner.textContent = `🎯 ${name} 摇到单骰！重摇中（${latest.streak}/${latest.maxStreak}）`;
  document.body.appendChild(banner);
  setTimeout(() => {
    banner.style.transition = 'opacity 0.5s';
    banner.style.opacity = '0';
    setTimeout(() => banner.remove(), 500);
  }, 2200);
}

// =============== 首页操作 ===============
let pendingAction = null;

// 创建房间 → 先选人数 + 玩法
document.getElementById('btn-create-room').addEventListener('click', async () => {
  console.log('[UI] 点击创建房间，弹出选人数/玩法弹窗');
  state.selectedMaxPlayers = 2;
  // 重置人数选择器
  document.querySelectorAll('.count-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.count === '2');
  });

  // 拉取规则预设（有缓存就用缓存）
  await ensureRulesCatalog();
  renderPresetSelector();
  renderSingleBehaviorSelector();
  renderSkillModeSelector();
  renderMatchModeSelector();

  showModal('modal-create');
});

// 拉取规则目录（仅一次）
async function ensureRulesCatalog() {
  if (state.rulesCatalog) return;
  try {
    const resp = await fetch('/api/rules');
    state.rulesCatalog = await resp.json();
    if (state.rulesCatalog.skills) {
      state.skillsCatalog = state.rulesCatalog.skills;
    }
  } catch (e) {
    console.error('[Rules] 拉取失败，使用兜底', e);
    state.rulesCatalog = {
      presets: [
        { id: 'classic', name: '深圳斋飞', shortDesc: '斋飞 +2 -1', detail: [] }
      ],
      singleBehaviors: [
        { id: 'zero', name: '归零', desc: '单骰直接归零' },
        { id: 'normal', name: '正常', desc: '单骰按普通牌算' },
        { id: 'reroll', name: '重摇', desc: '单骰重摇，连续3次判负' }
      ]
    };
  }
}

function renderPresetSelector() {
  const container = document.getElementById('preset-selector');
  const detail = document.getElementById('preset-detail');
  if (!container) return;

  container.innerHTML = state.rulesCatalog.presets.map(p => `
    <button class="preset-btn ${p.id === state.selectedPreset ? 'active' : ''}" data-preset="${p.id}">
      <span class="preset-name">${p.name}</span>
      <span class="preset-short">${p.shortDesc}</span>
    </button>
  `).join('');

  updatePresetDetail();

  container.onclick = (e) => {
    const btn = e.target.closest('.preset-btn');
    if (!btn) return;
    state.selectedPreset = btn.dataset.preset;
    container.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updatePresetDetail();
  };

  function updatePresetDetail() {
    const p = state.rulesCatalog.presets.find(x => x.id === state.selectedPreset);
    if (!p || !detail) return;
    detail.innerHTML = p.detail && p.detail.length
      ? `<ul>${p.detail.map(d => `<li>${d}</li>`).join('')}</ul>`
      : `<div>${p.shortDesc}</div>`;
  }
}

function renderSingleBehaviorSelector() {
  const container = document.getElementById('single-behavior-selector');
  const detail = document.getElementById('single-behavior-detail');
  if (!container) return;

  container.innerHTML = state.rulesCatalog.singleBehaviors.map(b => `
    <button class="sb-btn ${b.id === state.selectedSingleBehavior ? 'active' : ''}" data-sb="${b.id}">
      <span class="sb-name">${b.name}</span>
    </button>
  `).join('');

  updateDetail();

  container.onclick = (e) => {
    const btn = e.target.closest('.sb-btn');
    if (!btn) return;
    state.selectedSingleBehavior = btn.dataset.sb;
    container.querySelectorAll('.sb-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateDetail();
  };

  function updateDetail() {
    const b = state.rulesCatalog.singleBehaviors.find(x => x.id === state.selectedSingleBehavior);
    if (!b || !detail) return;
    detail.textContent = b.desc;
  }
}

// =============== 技能模式选择器（创房） ===============
function renderSkillModeSelector() {
  const container = document.getElementById('skill-mode-selector');
  const detail = document.getElementById('skill-mode-detail');
  if (!container) return;

  const descMap = {
    none: '不使用技能，原汁原味',
    random: '开局每人随机发 1 个技能，命由天定',
    choose: '进房后每人自己挑 1 个技能，看谁最骚'
  };

  // 初始化 UI 状态
  container.querySelectorAll('.sm-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === state.selectedSkillMode);
  });
  if (detail) detail.textContent = descMap[state.selectedSkillMode] || '';

  container.onclick = (e) => {
    const btn = e.target.closest('.sm-btn');
    if (!btn) return;
    state.selectedSkillMode = btn.dataset.mode;
    container.querySelectorAll('.sm-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (detail) detail.textContent = descMap[state.selectedSkillMode] || '';
  };
}

// =============== v2.7.0：赛制模式选择器（创房） ===============
const MATCH_MODE_META = {
  free:      { unit: '',     label: '',         min: 0,  max: 0,   def: 0,  desc: '自由模式：不限时间和局数，每局结束可"再来一局"' },
  time:      { unit: '分钟', label: '游戏时长', min: 2,  max: 10,  def: 5,  desc: '⏱ 定时间：到时间后当前局结束后整把游戏结束' },
  rounds:    { unit: '局',   label: '总局数',   min: 3,  max: 20,  def: 5,  desc: '🔢 定局数：打满预定局数后整把结束' },
  maxLoss:   { unit: '杯',   label: '封顶杯数', min: 3,  max: 30,  def: 10, desc: '🎯 找菜比：任一玩家欠杯达到上限即结束（最菜的人喝爆）' },
  totalLoss: { unit: '杯',   label: '总杯上限', min: 3,  max: 100, def: 20, desc: '🍺 定总杯：所有玩家欠杯总和达到上限即结束' }
};

function renderMatchModeSelector() {
  const container = document.getElementById('match-mode-selector');
  const targetWrap = document.getElementById('match-mode-target');
  const labelEl = document.getElementById('match-target-label');
  const valueEl = document.getElementById('match-target-value');
  const unitEl = document.getElementById('match-target-unit');
  const detail = document.getElementById('match-mode-detail');
  if (!container) return;

  // 初始化 UI
  container.querySelectorAll('.mm-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === state.selectedMatchMode);
  });
  syncMatchTargetUI();

  container.onclick = (e) => {
    const btn = e.target.closest('.mm-btn');
    if (!btn) return;
    state.selectedMatchMode = btn.dataset.mode;
    // 切换模式时把 target 重置成该模式默认值
    const meta = MATCH_MODE_META[state.selectedMatchMode];
    if (meta) state.selectedMatchTarget = meta.def;
    container.querySelectorAll('.mm-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    syncMatchTargetUI();
  };

  // 数值选择器（只在该选择器内部触发）
  if (targetWrap) {
    targetWrap.onclick = (e) => {
      const btn = e.target.closest('.match-target-selector .sel-btn');
      if (!btn) return;
      const meta = MATCH_MODE_META[state.selectedMatchMode];
      if (!meta) return;
      // 步长：定总杯模式 5 步，时间/局数/找菜比 1 步
      const step = state.selectedMatchMode === 'totalLoss' ? 5 : 1;
      let next = state.selectedMatchTarget + (btn.dataset.dir === 'up' ? step : -step);
      if (next < meta.min) next = meta.min;
      if (next > meta.max) next = meta.max;
      state.selectedMatchTarget = next;
      syncMatchTargetUI();
    };
  }

  function syncMatchTargetUI() {
    const mode = state.selectedMatchMode;
    const meta = MATCH_MODE_META[mode];
    if (!meta) return;
    if (mode === 'free') {
      if (targetWrap) targetWrap.style.display = 'none';
    } else {
      if (targetWrap) targetWrap.style.display = '';
      if (labelEl) labelEl.textContent = meta.label;
      // 防越界
      if (state.selectedMatchTarget < meta.min || state.selectedMatchTarget > meta.max) {
        state.selectedMatchTarget = meta.def;
      }
      if (valueEl) valueEl.textContent = String(state.selectedMatchTarget);
      if (unitEl) unitEl.textContent = meta.unit;
    }
    if (detail) detail.textContent = meta.desc;
  }
}

// 人数选择器
document.getElementById('player-count-selector').addEventListener('click', (e) => {
  const btn = e.target.closest('.count-btn');
  if (!btn) return;
  state.selectedMaxPlayers = parseInt(btn.dataset.count);
  console.log('[UI] 选择人数:', state.selectedMaxPlayers);
  document.querySelectorAll('.count-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('total-dice-hint').textContent = `场上共 ${state.selectedMaxPlayers * 5} 颗骰子`;
});

// 确认创建 → 设置昵称
document.getElementById('btn-confirm-create-room').addEventListener('click', () => {
  console.log('[UI] 点击下一步，选择人数:', state.selectedMaxPlayers);
  hideModal('modal-create');
  pendingAction = 'create';
  document.getElementById('input-nickname').value = '';
  document.getElementById('nickname-action-area').innerHTML = `
    <button class="btn btn-primary" id="btn-confirm-create">创建房间</button>
    <button class="btn btn-ghost" id="btn-cancel-nickname">取消</button>
  `;
  showModal('modal-nickname');
  document.getElementById('btn-confirm-create').addEventListener('click', handleCreateRoom);
  document.getElementById('btn-cancel-nickname').addEventListener('click', () => hideModal('modal-nickname'));
});

document.getElementById('btn-cancel-create').addEventListener('click', () => hideModal('modal-create'));

document.getElementById('btn-join-room').addEventListener('click', () => {
  const urlRoom = getRoomCodeFromURL();
  if (urlRoom) {
    document.getElementById('input-room-code').value = urlRoom;
  } else {
    document.getElementById('input-room-code').value = '';
  }
  showModal('modal-join');
});

document.getElementById('btn-confirm-join').addEventListener('click', () => {
  const roomCode = document.getElementById('input-room-code').value.trim().toUpperCase();
  if (!roomCode || roomCode.length !== 6) {
    showToast('请输入6位房间码', 'error');
    return;
  }
  hideModal('modal-join');
  pendingAction = 'join';
  state.roomCode = roomCode;
  document.getElementById('input-nickname').value = '';
  document.getElementById('nickname-action-area').innerHTML = `
    <button class="btn btn-primary" id="btn-confirm-join-nickname">加入房间</button>
    <button class="btn btn-ghost" id="btn-cancel-nickname2">取消</button>
  `;
  showModal('modal-nickname');
  document.getElementById('btn-confirm-join-nickname').addEventListener('click', handleJoinRoom);
  document.getElementById('btn-cancel-nickname2').addEventListener('click', () => hideModal('modal-nickname'));
});

document.getElementById('btn-cancel-join').addEventListener('click', () => hideModal('modal-join'));

document.getElementById('btn-rules').addEventListener('click', () => showPage('rules'));
document.getElementById('btn-back-home').addEventListener('click', () => showPage('home'));

function handleCreateRoom() {
  const nickname = document.getElementById('input-nickname').value.trim() || `玩家${Math.floor(Math.random() * 9000) + 1000}`;
  state.nickname = nickname;
  state.maxPlayers = state.selectedMaxPlayers;
  hideAllModals();

  const matchConfig = state.selectedMatchMode && state.selectedMatchMode !== 'free'
    ? { mode: state.selectedMatchMode, target: state.selectedMatchTarget }
    : null;

  const payload = {
    nickname,
    playerId: state.playerId,
    maxPlayers: state.maxPlayers,
    preset: state.selectedPreset,
    singleBehavior: state.selectedSingleBehavior,
    skillMode: state.selectedSkillMode || 'none',
    matchConfig
  };

  console.log('[创建房间]', payload);

  if (!state.connected) {
    connectWS();
    let attempts = 0;
    const checkConnection = setInterval(() => {
      attempts++;
      if (state.connected) {
        clearInterval(checkConnection);
        sendMsg('create_room', payload);
      } else if (attempts > 50) {
        clearInterval(checkConnection);
        showToast('连接服务器失败，请刷新页面重试', 'error');
      }
    }, 100);
  } else {
    sendMsg('create_room', payload);
  }
}

function handleJoinRoom() {
  const nickname = document.getElementById('input-nickname').value.trim() || `玩家${Math.floor(Math.random() * 9000) + 1000}`;
  state.nickname = nickname;
  hideAllModals();

  if (!state.connected) {
    connectWS();
    let attempts = 0;
    const checkConnection = setInterval(() => {
      attempts++;
      if (state.connected) {
        clearInterval(checkConnection);
        sendMsg('join_room', { roomCode: state.roomCode, nickname, playerId: state.playerId });
      } else if (attempts > 50) {
        clearInterval(checkConnection);
        showToast('连接服务器失败，请刷新页面重试', 'error');
      }
    }, 100);
  } else {
    sendMsg('join_room', { roomCode: state.roomCode, nickname, playerId: state.playerId });
  }
}

// =============== 等待房间 ===============
function showWaitingPage(data) {
  showPage('waiting');
  const digits = document.getElementById('room-code-digits');
  digits.innerHTML = '';
  for (const ch of data.roomCode) {
    const span = document.createElement('span');
    span.className = 'code-digit';
    span.textContent = ch;
    digits.appendChild(span);
  }

  // 如果有 roomInfo，更新玩家列表
  if (data.roomInfo) {
    state.maxPlayers = data.roomInfo.maxPlayers || 2;
    state.playerOrder = data.roomInfo.players || [];
  }

  updateWaitingPlayerList();

  // 房间倒计时
  state.roomCreatedAt = Date.now();
  startRoomCountdown();
}

function updateWaitingPlayerList() {
  const container = document.getElementById('waiting-player-list');
  container.innerHTML = '';

  // 已加入的玩家
  const players = state.playerOrder || [];
  for (let i = 0; i < state.maxPlayers; i++) {
    const div = document.createElement('div');
    if (i < players.length) {
      const p = players[i];
      const isMe = p.id === state.playerId;
      const isBot = (p.id && p.id.startsWith('bot_')) || (p.nickname && p.nickname.startsWith('🤖'));
      div.className = `player-item ${isMe ? 'you' : (isBot ? 'bot' : 'other')}`;
      // 技能标签（仅在 skillMode != 'none' 时展示）
      let skillTag = '';
      if (state.skillMode && state.skillMode !== 'none') {
        if (p.skill) {
          skillTag = `<span class="player-skill-tag" title="${p.skill.desc || ''}">${p.skill.icon || '🎭'} ${p.skill.name}</span>`;
        } else {
          skillTag = `<span class="player-skill-tag empty">未选</span>`;
        }
      }
      div.innerHTML = `
        <span class="player-status">${isBot ? '🤖' : '✅'}</span>
        <span class="player-name">${p.nickname}${isMe ? '（你）' : ''}</span>
        ${skillTag}
      `;
    } else {
      div.className = 'player-item empty';
      div.innerHTML = `
        <span class="player-status">⏳</span>
        <span class="player-name">等待中...</span>
      `;
    }
    container.appendChild(div);
  }

  updateAddBotButton();
  updateSkillModeBadge();
}

// 显示"随机/自选"技能模式徽章
function updateSkillModeBadge() {
  const badge = document.getElementById('skill-mode-badge');
  if (!badge) return;
  if (!state.skillMode || state.skillMode === 'none') {
    badge.style.display = 'none';
    return;
  }
  const textMap = {
    random: '🎭 技能模式：随机发牌（开局揭晓）',
    choose: '🎭 技能模式：自选技能'
  };
  badge.textContent = textMap[state.skillMode] || '';
  badge.style.display = 'block';
}

// waiting 页面的技能自选面板
async function updateSkillChoosePanel() {
  const panel = document.getElementById('skill-choose-panel');
  const grid = document.getElementById('skill-choose-grid');
  if (!panel || !grid) return;

  if (state.skillMode !== 'choose') {
    panel.style.display = 'none';
    return;
  }

  // 后加入的玩家没点过「创建房间」弹窗，skillsCatalog 可能是空的，这里兜底拉一次
  if (!state.skillsCatalog || !state.skillsCatalog.length) {
    await ensureRulesCatalog();
  }

  const skills = state.skillsCatalog || [];
  if (!skills.length) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  const currentId = state.mySkill && state.mySkill.id;

  grid.innerHTML = skills.map(s => `
    <button class="skill-choose-card ${s.id === currentId ? 'active' : ''}" data-skill="${s.id}">
      <div class="skill-card-head">
        <span class="skill-card-icon">${s.icon}</span>
        <span class="skill-card-name">${s.name}</span>
        <span class="skill-card-type ${s.type}">${s.type === 'active' ? '主动' : '被动'}</span>
      </div>
      <div class="skill-card-desc">${s.desc}</div>
    </button>
  `).join('');

  grid.onclick = (e) => {
    const btn = e.target.closest('.skill-choose-card');
    if (!btn) return;
    const skillId = btn.dataset.skill;
    sendMsg('choose_skill', { skillId });
    // 乐观更新（服务端会通过 player_info 覆盖）
    grid.querySelectorAll('.skill-choose-card').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  };

  // 初次/每次更新时根据 state.playerOrder 渲染一次进度
  renderSkillChooseProgress(state.playerOrder || []);
}

/**
 * 渲染自选进度（服务端 skill_choose_progress / skill_choose_waiting 也会调用）
 */
function renderSkillChooseProgress(progress) {
  const list = document.getElementById('skill-choose-progress-list');
  const hint = document.getElementById('skill-choose-progress-hint');
  const wrap = document.getElementById('skill-choose-progress');
  if (!list || !wrap) return;

  if (!progress || !progress.length) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'block';

  const total = progress.length;
  const chosenCount = progress.filter(p => p.chosen || (p.skill && p.skill.id)).length;

  list.innerHTML = progress.map(p => {
    // 兼容两种字段：player_info 推来的 { skill:{...} } 和 skill_choose_progress 推来的 { skillIcon, skillName, chosen }
    const skillIcon = p.skillIcon || (p.skill && p.skill.icon) || '';
    const skillName = p.skillName || (p.skill && p.skill.name) || '';
    const chosen = p.chosen || !!(p.skill && p.skill.id);
    const isMe = p.id === state.playerId;
    return `
      <div class="skill-progress-item ${chosen ? 'done' : 'pending'}">
        <span class="skill-progress-status">${chosen ? '✅' : '⏳'}</span>
        <span class="skill-progress-name">${p.nickname}${isMe ? '（你）' : ''}</span>
        <span class="skill-progress-skill">${chosen ? `${skillIcon} ${skillName}` : '选择中...'}</span>
      </div>
    `;
  }).join('');

  if (hint) {
    if (chosenCount === total) {
      hint.textContent = '✨ 所有玩家已就绪，即将开始！';
      hint.classList.add('ready');
    } else {
      hint.textContent = `等待中... ${chosenCount} / ${total}`;
      hint.classList.remove('ready');
    }
  }
}

/**
 * 服务端推送：某人选/改了技能
 */
function handleSkillChooseProgress(data) {
  if (!data) return;
  // 提示（非自己）
  if (data.playerId !== state.playerId) {
    showToast(`${data.nickname} 选择了 ${data.skillIcon || ''} ${data.skillName || ''}`, 'success');
  }
  renderSkillChooseProgress(data.progress || []);
}

/**
 * 服务端推送：满员但仍有人未选，等待中
 */
function handleSkillChooseWaiting(data) {
  if (!data) return;
  renderSkillChooseProgress(data.progress || []);
}

function startRoomCountdown() {
  clearRoomCountdown();
  const deadline = state.roomCreatedAt + 10 * 60 * 1000;
  state.roomTimerInterval = setInterval(() => {
    const remaining = Math.max(0, deadline - Date.now());
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    document.getElementById('room-countdown').textContent =
      `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    if (remaining <= 0) clearRoomCountdown();
  }, 1000);
}

function clearRoomCountdown() {
  if (state.roomTimerInterval) {
    clearInterval(state.roomTimerInterval);
    state.roomTimerInterval = null;
  }
}

// 复制房间码
document.getElementById('btn-copy-code').addEventListener('click', () => {
  copyToClipboard(state.roomCode);
  showToast('房间码已复制', 'success');
});

// 复制邀请链接
document.getElementById('btn-copy-link').addEventListener('click', () => {
  const protocol = location.protocol;
  const host = location.hostname;
  const port = location.port;
  const portPart = port ? `:${port}` : '';
  const link = `${protocol}//${host}${portPart}/room/${state.roomCode}`;
  const playerCount = state.maxPlayers > 2 ? `（${state.maxPlayers}人局）` : '';
  const shareText = `🎲 菜就多练！摇把骰子！${playerCount}\n房间号：${state.roomCode}\n点击链接直接加入👇\n${link}`;
  copyToClipboard(shareText);
  showToast('邀请消息已复制，发给朋友吧！', 'success');
});

document.getElementById('btn-leave-waiting').addEventListener('click', () => {
  sendMsg('leave_room');
  clearRoomCountdown();
  showPage('home');
});

// 添加机器人
document.getElementById('btn-add-bot').addEventListener('click', () => {
  console.log('[UI] 点击添加机器人');
  sendMsg('add_bot');
});

function updateAddBotButton() {
  const btn = document.getElementById('btn-add-bot');
  const currentCount = (state.playerOrder || []).length;
  const remaining = state.maxPlayers - currentCount;
  if (remaining <= 0) {
    btn.style.display = 'none';
  } else {
    btn.style.display = 'inline-flex';
    btn.textContent = '';
    btn.innerHTML = `<span class="btn-icon">🤖</span> 添加机器人（还差${remaining}人）`;
  }
}

// =============== 对局页面 ===============
function showGamePage(data) {
  showPage('game');
  clearRoomCountdown();

  // 设置己方名和得分
  document.getElementById('game-my-name').textContent = state.nickname;
  updateScoreDisplay();

  // 更新规则徽章
  updateRulesetBadge();

  // v2.7.0：刷新赛制进度条
  updateMatchProgressBar();

  // 渲染对手区域
  renderOpponentsArea();

  // 显示摇骰动画，然后揭示骰子
  showDiceAnimation(() => {
    renderMyDice(data.yourDice);
    // 对手骰子隐藏
    renderAllOpponentDice(false);
    updateActionArea();
  });

  // 清空叫数记录
  document.getElementById('bid-list').innerHTML = '';

  // 重置选择器到合法初始值
  if (isGuo1Mode()) {
    state.selectedQuantity = state.minBidRules.guo1Other;
    state.selectedValue = 2;
    state.selectedMode = 'guo1';
  } else {
    state.selectedQuantity = state.minBidRules.fly;
    state.selectedValue = 2;
    state.selectedMode = 'fly';
  }
  updateSelectors();

  // 刷新技能栏
  updateSkillBar();
}

/**
 * 渲染对手区域（支持1-3个对手）
 */
function renderOpponentsArea() {
  const container = document.getElementById('opponents-area');
  container.innerHTML = '';

  const opponents = state.playerOrder.filter(p => p.id !== state.playerId);

  for (const op of opponents) {
    const div = document.createElement('div');
    div.className = 'opponent-area';
    div.dataset.playerId = op.id;

    const opStats = state.stats[op.id] || { totalScore: 0 };
    div.innerHTML = `
      <div class="player-header">
        <span class="player-name">${op.nickname}</span>
        <span class="player-score">🍺 欠杯：${opStats.totalScore}</span>
      </div>
      <div class="dice-row opponent-dice" id="opponent-dice-${op.id}">
        ${Array(5).fill('<div class="die hidden">?</div>').join('')}
      </div>
    `;
    container.appendChild(div);
  }
}

function showDiceAnimation(callback) {
  const myDiceEl = document.getElementById('my-dice');
  myDiceEl.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const die = document.createElement('div');
    die.className = 'die shaking';
    die.textContent = '?';
    myDiceEl.appendChild(die);
  }

  // 音效：摇骰子
  if (window.Sound) window.Sound.shake();

  setTimeout(() => {
    myDiceEl.querySelectorAll('.die').forEach(d => d.classList.remove('shaking'));
    // 音效：骰子揭示
    if (window.Sound) window.Sound.reveal();
    if (callback) callback();
  }, 1500);
}

function renderMyDice(dice) {
  const container = document.getElementById('my-dice');
  container.innerHTML = '';
  for (const val of dice) {
    const die = document.createElement('div');
    die.className = 'die revealed';
    die.dataset.value = val;
    die.innerHTML = createDiceDots(val);
    container.appendChild(die);
  }
}

/**
 * 渲染所有对手的骰子（隐藏或揭示）
 */
function renderAllOpponentDice(revealed, allDice) {
  const opponents = state.playerOrder.filter(p => p.id !== state.playerId);
  for (const op of opponents) {
    const container = document.getElementById(`opponent-dice-${op.id}`);
    if (!container) continue;
    container.innerHTML = '';
    // v2.6.4：恢复已透视过的骰子，避免被后续重绘刷白
    const peeked = state.peekedMap && state.peekedMap[op.id];
    for (let i = 0; i < 5; i++) {
      const die = document.createElement('div');
      if (revealed && allDice && allDice[op.id]) {
        const dice = allDice[op.id].dice || allDice[op.id];
        die.className = 'die revealed';
        die.dataset.value = dice[i];
        die.innerHTML = createDiceDots(dice[i]);
      } else if (!revealed && peeked && peeked.idx === i) {
        // 已透视过的那一颗，保持显示
        die.className = 'die peeked';
        die.dataset.value = peeked.value;
        die.innerHTML = createDiceDots(peeked.value);
      } else {
        die.className = 'die hidden';
        die.textContent = '?';
      }
      container.appendChild(die);
    }
  }
}

function getDiceDisplay(value) {
  return createDiceDots(value);
}

function getDiceEmoji(value) {
  return createDiceDots(value);
}

/**
 * 创建骰子圆点 HTML
 */
function createDiceDots(value) {
  const dotPositions = {
    1: ['center'],
    2: ['top-right', 'bottom-left'],
    3: ['top-right', 'center', 'bottom-left'],
    4: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
    5: ['top-left', 'top-right', 'center', 'bottom-left', 'bottom-right'],
    6: ['top-left', 'top-right', 'mid-left', 'mid-right', 'bottom-left', 'bottom-right']
  };
  const positions = dotPositions[value] || [];
  return positions.map(pos => `<span class="dot ${pos}"></span>`).join('');
}

function updateScoreDisplay() {
  const myStats = state.stats[state.playerId] || { totalScore: 0 };
  document.getElementById('game-my-score').textContent = `🍺 欠杯：${myStats.totalScore}`;

  // 更新所有对手得分
  const opponents = state.playerOrder.filter(p => p.id !== state.playerId);
  for (const op of opponents) {
    const opArea = document.querySelector(`.opponent-area[data-player-id="${op.id}"]`);
    if (opArea) {
      const scoreEl = opArea.querySelector('.player-score');
      const opStats = state.stats[op.id] || { totalScore: 0 };
      if (scoreEl) scoreEl.textContent = `🍺 欠杯：${opStats.totalScore}`;
    }
  }
}

function updateBidHistory(data) {
  const bidList = document.getElementById('bid-list');
  bidList.innerHTML = '';
  for (const bid of data.bids) {
    const item = document.createElement('div');
    item.className = `bid-item ${bid.playerId === state.playerId ? 'mine' : 'theirs'}`;
    // guo1 模式或 mode=guo1 → 不显示飞/斋标签
    const isGuo1Bid = bid.mode === 'guo1' || isGuo1Mode();
    let modeTagHtml = '';
    if (!isGuo1Bid && bid.value !== 1) {
      const modeName = bid.mode === 'fly' ? '飞' : '斋';
      const modeClass = bid.mode === 'fly' ? 'mode-tag-fly' : 'mode-tag-zhai';
      modeTagHtml = `<span class="${modeClass}">${modeName}</span>`;
    }
    item.innerHTML = `
      <div class="bid-player">${bid.nickname}</div>
      <div class="bid-content">${bid.quantity}个${bid.value} ${modeTagHtml}</div>
    `;
    bidList.appendChild(item);
  }
  bidList.scrollTop = bidList.scrollHeight;

  // 回合指示
  const indicator = document.getElementById('turn-indicator');
  if (state.isMyTurn) {
    indicator.textContent = '← 轮到你了';
    indicator.style.color = 'var(--primary-light)';
  } else {
    indicator.textContent = `← 等待 ${getCurrentTurnName()} 操作`;
    indicator.style.color = 'var(--text-muted)';
  }
}

function updateActionArea() {
  const biddingArea = document.getElementById('action-bidding');
  const challengedArea = document.getElementById('action-challenged');
  const waitingArea = document.getElementById('action-waiting');
  const waitingText = document.getElementById('waiting-text');

  if (state.phase === 'challenging') {
    if (state.isMyTurn) {
      biddingArea.style.display = 'none';
      challengedArea.style.display = 'block';
      waitingArea.style.display = 'none';
    } else {
      biddingArea.style.display = 'none';
      challengedArea.style.display = 'none';
      waitingArea.style.display = 'block';
      // v2.6.4：显示劈者 → 被劈者，避免旁观者不清楚谁在劈谁
      let waitingMsg = '⚡ 等待劈骰结果...';
      const ch = state.challenge;
      if (ch && (ch.challenger || ch.currentTurn)) {
        const challengerId = ch.challenger || ch.player;
        const targetId = ch.target || ch.currentTurn;
        if (challengerId && targetId) {
          const chName = getPlayerName(challengerId);
          const tgName = targetId === state.playerId ? '你' : getPlayerName(targetId);
          waitingMsg = `⚡ ${chName} 正在劈 ${tgName}... ×${ch.multiplier || 1}`;
        }
      }
      waitingText.textContent = waitingMsg;
    }
    return;
  }

  if (state.isMyTurn) {
    biddingArea.style.display = 'block';
    challengedArea.style.display = 'none';
    waitingArea.style.display = 'none';

    // 开和劈按钮状态
    const hasLastBid = state.bids.length > 0;
    document.getElementById('btn-open').disabled = !hasLastBid;
    document.getElementById('btn-challenge').disabled = !hasLastBid;

    // 被封口：禁用叫骰按钮（只能开或劈）
    const silenced = state.silencerTarget === state.playerId;
    document.getElementById('btn-bid').disabled = silenced || document.getElementById('btn-bid').disabled;
    if (silenced) {
      const hint = document.getElementById('silencer-hint');
      if (!hint) {
        const h = document.createElement('div');
        h.id = 'silencer-hint';
        h.className = 'silencer-hint';
        h.textContent = '🔒 你被封口了！只能劈或开';
        biddingArea.insertBefore(h, biddingArea.firstChild);
      }
    } else {
      const hint = document.getElementById('silencer-hint');
      if (hint) hint.remove();
    }
  } else {
    biddingArea.style.display = 'none';
    challengedArea.style.display = 'none';
    waitingArea.style.display = 'block';
    waitingText.textContent = `🍺 等 ${getCurrentTurnName()} 叫骰，磨叽啥呢...`;
  }

  // 我方回合视觉脉冲
  const myArea = document.querySelector('.my-area');
  if (myArea) myArea.classList.toggle('my-turn', !!state.isMyTurn);
  [biddingArea, challengedArea].forEach(el => {
    if (el) el.classList.toggle('my-turn-active', !!state.isMyTurn);
  });
}

// =============== 叫数选择器 ===============

function diceRank(value) {
  if (value === 1) return 7;
  return value;
}

function isValueGreater(a, b) {
  return diceRank(a) > diceRank(b);
}

function getSortedValues() {
  return [2, 3, 4, 5, 6, 1];
}

// 根据 ruleSet 计算斋→飞最小数量
function minQuantityZhaiToFly(prevQuantity) {
  const rule = state.ruleSet?.conversion?.zhaiToFly || 'plus2';
  if (rule === 'times2') return prevQuantity * 2;
  return prevQuantity + 2;
}

// 根据 ruleSet 计算飞→斋最小数量
function minQuantityFlyToZhai(prevQuantity) {
  const rule = state.ruleSet?.conversion?.flyToZhai || 'minus1';
  if (rule === 'halvePlus1') return Math.ceil(prevQuantity / 2) + 1;
  return prevQuantity - 1;
}

function getMinQuantity(value, mode, lastBid) {
  const rules = state.minBidRules;

  // ==== guo1 无飞斋模式 ====
  if (isGuo1Mode()) {
    const baseMin = value === 1 ? rules.guo1One : rules.guo1Other;
    if (!lastBid) return baseMin;
    // 叫 1 的升华规则：onesCalled=false 时可直接用 guo1One 起叫（不受上家数量约束）
    if (value === 1 && !state.onesCalled) {
      return baseMin;
    }
    // 普通递增：更大数量 OR 同数量更大点数
    if (isValueGreater(value, lastBid.value)) {
      return Math.max(baseMin, lastBid.quantity);
    }
    return Math.max(baseMin, lastBid.quantity + 1);
  }

  // ==== 有飞斋模式 ====
  let baseMin;
  if (value === 1) {
    baseMin = rules.one;
  } else if (mode === 'zhai') {
    baseMin = rules.zhai;
  } else {
    baseMin = rules.fly;
  }

  if (!lastBid) return baseMin;

  const prev = { ...lastBid };
  if (prev.value === 1) prev.mode = 'zhai';
  const nextMode = (value === 1) ? 'zhai' : mode;

  let ruleMin;
  if (prev.mode === nextMode) {
    if (isValueGreater(value, prev.value)) {
      ruleMin = prev.quantity;
    } else {
      ruleMin = prev.quantity + 1;
    }
  } else if (prev.mode === 'zhai' && nextMode === 'fly') {
    ruleMin = minQuantityZhaiToFly(prev.quantity);
  } else if (prev.mode === 'fly' && nextMode === 'zhai') {
    ruleMin = minQuantityFlyToZhai(prev.quantity);
  } else {
    ruleMin = baseMin;
  }

  return Math.max(baseMin, ruleMin);
}

function getAvailableValues(quantity, mode, lastBid) {
  const available = [];

  // ==== guo1 无飞斋模式 ====
  if (isGuo1Mode()) {
    for (let v = 1; v <= 6; v++) {
      const minQ = getMinQuantity(v, 'guo1', lastBid);
      if (quantity < minQ) continue;
      if (lastBid) {
        // 叫 1 升华规则：onesCalled=false 时，叫 1 直接合法（只要起叫数>=guo1One）
        if (v === 1 && !state.onesCalled) {
          available.push(v);
          continue;
        }
        // 不能与上家相同（quantity+value）
        if (quantity === lastBid.quantity && !isValueGreater(v, lastBid.value)) continue;
      }
      available.push(v);
    }
    return available;
  }

  // ==== 有飞斋模式 ====
  for (let v = 1; v <= 6; v++) {
    const testMode = (v === 1) ? 'zhai' : mode;
    const minQ = getMinQuantity(v, testMode, lastBid);
    if (quantity >= minQ) {
      if (lastBid) {
        const prev = { ...lastBid };
        if (prev.value === 1) prev.mode = 'zhai';
        if (prev.mode === testMode && quantity === prev.quantity && !isValueGreater(v, prev.value)) {
          continue;
        }
      }
      available.push(v);
    }
  }
  return available;
}

function getAvailableModes(quantity, value, lastBid) {
  // guo1 模式没有飞/斋
  if (isGuo1Mode()) return ['guo1'];

  if (value === 1) return ['zhai'];

  const modes = [];
  for (const m of ['fly', 'zhai']) {
    const minQ = getMinQuantity(value, m, lastBid);
    if (quantity >= minQ) {
      if (lastBid) {
        const prev = { ...lastBid };
        if (prev.value === 1) prev.mode = 'zhai';
        if (prev.mode === m && quantity === prev.quantity && !isValueGreater(value, prev.value)) {
          continue;
        }
      }
      modes.push(m);
    }
  }
  return modes;
}

function isBidValid(quantity, value, mode, lastBid) {
  // ==== guo1 无飞斋模式 ====
  if (isGuo1Mode()) {
    const rules = state.minBidRules;
    const baseMin = value === 1 ? rules.guo1One : rules.guo1Other;
    if (quantity < baseMin) return false;
    if (!lastBid) return true;
    // 升华叫 1（onesCalled=false）：满足起叫下限即可
    if (value === 1 && !state.onesCalled) return true;
    // 普通递增
    if (quantity > lastBid.quantity) return true;
    if (quantity === lastBid.quantity && isValueGreater(value, lastBid.value)) return true;
    return false;
  }

  // ==== 有飞斋模式 ====
  const testMode = (value === 1) ? 'zhai' : mode;
  const rules = state.minBidRules;
  let baseMin;
  if (value === 1) {
    baseMin = rules.one;
  } else if (testMode === 'zhai') {
    baseMin = rules.zhai;
  } else {
    baseMin = rules.fly;
  }
  if (quantity < baseMin) return false;

  if (!lastBid) return true;

  const prev = { ...lastBid };
  if (prev.value === 1) prev.mode = 'zhai';

  if (prev.mode === testMode) {
    if (quantity > prev.quantity) return true;
    if (quantity === prev.quantity && isValueGreater(value, prev.value)) return true;
    return false;
  }
  if (prev.mode === 'zhai' && testMode === 'fly') {
    return quantity >= minQuantityZhaiToFly(prev.quantity);
  }
  if (prev.mode === 'fly' && testMode === 'zhai') {
    return quantity >= minQuantityFlyToZhai(prev.quantity);
  }
  return false;
}

function updateSelectors() {
  const lastBid = state.lastBid;
  const guo1 = isGuo1Mode();

  // guo1 模式：强制 mode='guo1'；有飞斋模式下，叫 1 强制斋
  if (guo1) {
    state.selectedMode = 'guo1';
  } else if (state.selectedValue === 1) {
    state.selectedMode = 'zhai';
  }

  // 飞斋按钮组在 guo1 模式下隐藏
  const modeToggle = document.getElementById('mode-toggle');
  if (modeToggle) {
    modeToggle.style.display = guo1 ? 'none' : '';
  }

  const minQ = getMinQuantity(state.selectedValue, state.selectedMode, lastBid);
  const maxQ = 20;

  if (state.selectedQuantity < minQ) {
    state.selectedQuantity = minQ;
  }

  document.getElementById('quantity-value').textContent = state.selectedQuantity;

  const downBtn = document.querySelector('#quantity-selector .sel-btn[data-dir="down"]');
  const upBtn = document.querySelector('#quantity-selector .sel-btn[data-dir="up"]');
  if (downBtn) downBtn.disabled = (state.selectedQuantity <= minQ);
  if (upBtn) upBtn.disabled = (state.selectedQuantity >= maxQ);

  const availableValues = getAvailableValues(state.selectedQuantity, state.selectedMode, lastBid);
  document.querySelectorAll('.dice-val-btn').forEach(btn => {
    const val = parseInt(btn.dataset.val);
    const isAvailable = availableValues.includes(val);
    btn.classList.toggle('active', val === state.selectedValue);
    btn.classList.toggle('disabled', !isAvailable);
    btn.disabled = !isAvailable;
  });

  if (!availableValues.includes(state.selectedValue) && availableValues.length > 0) {
    state.selectedValue = availableValues[0];
    if (!guo1 && state.selectedValue === 1) state.selectedMode = 'zhai';
    updateSelectors();
    return;
  }

  // guo1 模式跳过飞斋按钮联动
  if (!guo1) {
    const availableModes = getAvailableModes(state.selectedQuantity, state.selectedValue, lastBid);
    document.querySelectorAll('.mode-btn').forEach(btn => {
      const m = btn.dataset.mode;
      const isAvailable = availableModes.includes(m);
      btn.classList.toggle('active', m === state.selectedMode);
      btn.classList.toggle('disabled', !isAvailable);
      btn.disabled = !isAvailable;
    });

    if (!availableModes.includes(state.selectedMode) && availableModes.length > 0) {
      state.selectedMode = availableModes[0];
      updateSelectors();
      return;
    }
  }

  const bidValid = isBidValid(state.selectedQuantity, state.selectedValue, state.selectedMode, lastBid);
  document.getElementById('btn-bid').disabled = !bidValid;
}

// 数量加减
document.getElementById('quantity-selector').addEventListener('click', (e) => {
  const btn = e.target.closest('.sel-btn');
  if (!btn || btn.disabled) return;
  const minQ = getMinQuantity(state.selectedValue, state.selectedMode, state.lastBid);
  if (btn.dataset.dir === 'up') {
    state.selectedQuantity = Math.min(20, state.selectedQuantity + 1);
  } else {
    state.selectedQuantity = Math.max(minQ, state.selectedQuantity - 1);
  }
  updateSelectors();
});

// 点数选择
document.getElementById('value-selector').addEventListener('click', (e) => {
  const btn = e.target.closest('.dice-val-btn');
  if (!btn || btn.disabled) return;
  state.selectedValue = parseInt(btn.dataset.val);
  if (!isGuo1Mode() && state.selectedValue === 1) state.selectedMode = 'zhai';
  updateSelectors();
});

// 飞斋切换
document.getElementById('mode-toggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.mode-btn');
  if (!btn || btn.disabled) return;
  state.selectedMode = btn.dataset.mode;
  updateSelectors();
});

// 叫数按钮
document.getElementById('btn-bid').addEventListener('click', () => {
  sendMsg('bid', {
    quantity: state.selectedQuantity,
    value: state.selectedValue,
    mode: state.selectedMode
  });
});

// 开骰
document.getElementById('btn-open').addEventListener('click', () => {
  sendMsg('open');
});

// 劈
document.getElementById('btn-challenge').addEventListener('click', () => {
  sendMsg('challenge');
});

// 被劈后操作
document.getElementById('btn-challenge-open').addEventListener('click', () => {
  sendMsg('challenge_open');
});

document.getElementById('btn-counter-challenge').addEventListener('click', () => {
  sendMsg('counter_challenge');
});

document.getElementById('btn-surrender').addEventListener('click', () => {
  if (window.Sound) window.Sound.surrender();
  if (window.TrashTalk) window.TrashTalk.onMySurrender();
  sendMsg('surrender');
});

// =============== 劈骰 UI ===============
function showChallengeUI(data) {
  if (state.isMyTurn) {
    document.getElementById('action-bidding').style.display = 'none';
    document.getElementById('action-challenged').style.display = 'block';
    document.getElementById('action-waiting').style.display = 'none';
    document.getElementById('challenge-text').textContent =
      `你被${data.challengerNickname}劈了！当前倍数：×${data.multiplier}`;
    document.getElementById('btn-counter-challenge').disabled = false;
  } else {
    document.getElementById('action-bidding').style.display = 'none';
    document.getElementById('action-challenged').style.display = 'none';
    document.getElementById('action-waiting').style.display = 'block';
    document.getElementById('waiting-text').textContent = `⚡ ${data.challengerNickname} 劈了 ${data.targetNickname}！`;
  }

  showToast(`⚡ ${data.challengerNickname} 劈了！倍数×${data.multiplier}`);
}

function updateChallengeUI(data) {
  if (state.isMyTurn) {
    document.getElementById('action-bidding').style.display = 'none';
    document.getElementById('action-challenged').style.display = 'block';
    document.getElementById('action-waiting').style.display = 'none';
    document.getElementById('challenge-text').textContent =
      `被反劈！当前倍数：×${data.multiplier}`;
    document.getElementById('btn-counter-challenge').disabled = data.maxReached;
  } else {
    document.getElementById('action-bidding').style.display = 'none';
    document.getElementById('action-challenged').style.display = 'none';
    document.getElementById('action-waiting').style.display = 'block';
    document.getElementById('waiting-text').textContent = `⚡ ${data.playerNickname} 反劈！倍数×${data.multiplier}`;
  }

  showToast(`⚡ ${data.playerNickname} 反劈！倍数×${data.multiplier}`);
}

// =============== 计时器 ===============
function startTimer(duration) {
  clearTimer();
  state.timerRemaining = duration;
  updateTimerDisplay();

  state.timerInterval = setInterval(() => {
    state.timerRemaining--;
    updateTimerDisplay();
    if (state.timerRemaining <= 0) {
      clearTimer();
    }
  }, 1000);
}

function clearTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

function resetTimer() {
  // Timer is reset by server's timer_start message
}

function updateTimerDisplay() {
  const pct = (state.timerRemaining / 30) * 100;
  const text = `⏱ ${state.timerRemaining}秒`;
  const danger = state.timerRemaining <= 5 && state.timerRemaining > 0;

  ['timer-fill', 'timer-fill-challenge', 'timer-fill-waiting'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.width = `${pct}%`;
  });

  ['timer-text', 'timer-text-challenge', 'timer-text-waiting'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  });

  // 倒计时危险状态样式（红闪+心跳）
  ['timer-bar', 'timer-bar-challenge', 'timer-bar-waiting'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('danger', danger);
  });

  // 最后 5 秒心跳音（只在轮到自己时响）
  if (danger && state.isMyTurn && window.Sound) {
    window.Sound.heartbeat();
  }

  // 轮到我 + 剩 5 秒，触发一次损友吐槽
  if (state.timerRemaining === 5 && state.isMyTurn && window.TrashTalk) {
    window.TrashTalk.onTimerWarn();
  }
}

// =============== 开骰全屏特效 ===============
function triggerOpenEffects() {
  // 震屏
  const app = document.getElementById('app');
  if (app) {
    app.classList.remove('shake-screen');
    // 触发 reflow 重启动画
    void app.offsetWidth;
    app.classList.add('shake-screen');
    setTimeout(() => app.classList.remove('shake-screen'), 500);
  }
  // 闪白
  const flash = document.createElement('div');
  flash.className = 'flash-overlay';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 450);
}

// =============== 结算页面 ===============
function showSettlementPage(data) {
  showPage('settlement');

  // 标题
  const titleEl = document.getElementById('settlement-title');
  if (data.type === 'surrender') {
    titleEl.textContent = '🏳️ 怂了怂了';
  } else if (data.type === 'timeout') {
    titleEl.textContent = '⏱ 磨叽啥呢！';
  } else if (data.type === 'disconnect') {
    titleEl.textContent = '📡 跑路了？';
  } else if (data.type === 'singleStreak') {
    titleEl.textContent = '🎯 连摇单骰，判负！';
  } else {
    titleEl.textContent = '🎲 开！！！';
  }

  // 所有玩家骰子
  const diceArea = document.getElementById('settlement-dice-area');
  diceArea.innerHTML = '';

  // v2.6.4：认输/超时/断线/连摇单骰场景未开牌，不展示骰子区，改为提示文案
  const noRevealTypes = ['surrender', 'timeout', 'disconnect', 'singleStreak', 'reconnect'];
  const shouldReveal = !noRevealTypes.includes(data.type);

  if (shouldReveal && data.allDice) {
    // 按 playerOrder 排序展示
    const orderedPids = (data.playerOrder || state.playerOrder || []).map(p => p.id || p);
    const displayPids = orderedPids.length > 0 ? orderedPids : Object.keys(data.allDice);

    for (const pid of displayPids) {
      const info = data.allDice[pid];
      if (!info) continue;
      const playerName = info.nickname || getPlayerName(pid);
      const isMe = pid === state.playerId;

      const div = document.createElement('div');
      div.className = 'settlement-player-dice';

      let patternTag = '';
      if (info.pattern) {
        const patternMap = {
          single: { class: 'single', text: '单骰！归零' },
          leopard: { class: 'leopard', text: `豹子！${info.pattern.detail?.value || ''}点算6个` },
          pureLeopard: { class: 'pureLeopard', text: `纯豹！${info.pattern.detail?.value || ''}点算7个` },
          normal: { class: 'normal', text: '普通' }
        };
        const pt = patternMap[info.pattern.type] || patternMap.normal;
        patternTag = `<span class="pattern-tag ${pt.class}">${pt.text}</span>`;
      }

      div.innerHTML = `
        <div class="player-label">
          <span>${playerName}${isMe ? '（你）' : ''}</span>
          ${patternTag}
        </div>
        <div class="dice-row">
          ${(info.dice || []).map(v => `<div class="die revealed" data-value="${v}">${createDiceDots(v)}</div>`).join('')}
        </div>
      `;
      diceArea.appendChild(div);
    }
  } else if (!shouldReveal) {
    // v2.6.4：未开牌场景给个提示占位
    const tipMap = {
      surrender: '🏳️ 未开牌 · 认输直接结算',
      timeout: '⏱ 未开牌 · 超时直接判负',
      disconnect: '📡 未开牌 · 断线超时判负',
      singleStreak: '🎯 未开牌 · 连摇单骰判负',
      reconnect: '🔄 结算信息已过期'
    };
    const tip = document.createElement('div');
    tip.className = 'settlement-no-reveal';
    tip.style.cssText = 'text-align:center;padding:24px 12px;color:var(--text-secondary);font-size:14px;opacity:.85;';
    tip.textContent = tipMap[data.type] || '未开牌';
    diceArea.appendChild(tip);
  }

  // 结算详情
  const detailsEl = document.getElementById('settlement-details');
  detailsEl.innerHTML = '';

  if (data.type === 'open' && data.lastBid) {
    const isGuo1Bid = data.lastBid.mode === 'guo1';
    let modeTag = '';
    if (!isGuo1Bid && data.lastBid.value !== 1) {
      const modeName = data.lastBid.mode === 'fly' ? '飞' : '斋';
      const modeClass = data.lastBid.mode === 'fly' ? 'mode-tag-fly' : 'mode-tag-zhai';
      modeTag = `<span class="${modeClass}">${modeName}</span>`;
    }
    const openerName = data.opener === state.playerId ? state.nickname + '（你）' : (data.openerNickname || getPlayerName(data.opener));
    const lastBidderName = data.lastBidder === state.playerId ? state.nickname + '（你）' : (data.lastBidderNickname || getPlayerName(data.lastBidder));
    
    // 每位玩家的贡献详情
    let countDetailsHtml = '';
    if (data.countDetails) {
      const orderedPids = (data.playerOrder || state.playerOrder || []).map(p => p.id || p);
      const displayPids = orderedPids.length > 0 ? orderedPids : Object.keys(data.countDetails);
      for (const pid of displayPids) {
        if (data.countDetails[pid] === undefined) continue;
        const name = pid === state.playerId ? state.nickname + '（你）' : getPlayerName(pid);
        countDetailsHtml += `
          <div class="detail-row">
            <span class="detail-label">${name}</span>
            <span class="detail-value">贡献 ${data.countDetails[pid]} 个 ${data.lastBid.value}</span>
          </div>
        `;
      }
    }
    
    detailsEl.innerHTML = `
      <div class="detail-row">
        <span class="detail-label">开骰方</span>
        <span class="detail-value" style="color: var(--danger)">${openerName} 开了 ${lastBidderName}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">最后叫骰</span>
        <span class="detail-value">${lastBidderName}：${data.lastBid.quantity}个${data.lastBid.value} ${modeTag}</span>
      </div>
      ${data.multiplier > 1 ? `<div class="detail-row"><span class="detail-label">劈骰倍数</span><span class="detail-value">×${data.multiplier}</span></div>` : ''}
      ${countDetailsHtml}
      <div class="detail-row">
        <span class="detail-label">实际总数</span>
        <span class="detail-value">${data.totalCount} 个 ${data.lastBid.value}（${state.playerOrder.length}人×5骰）</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">判定结果</span>
        <span class="detail-value">${data.bidEstablished ? `${data.totalCount} ≥ ${data.bidQuantity} 叫骰成立` : `${data.totalCount} < ${data.bidQuantity} 叫骰不成立`}</span>
      </div>
    `;
  } else if (data.type === 'surrender') {
    const surrenderName = data.surrenderPlayer === state.playerId ? state.nickname + '（你）' : (data.surrenderNickname || getPlayerName(data.surrenderPlayer));
    detailsEl.innerHTML = `
      <div class="detail-row">
        <span class="detail-label">结算方式</span>
        <span class="detail-value">${surrenderName} 认输（倍数 ×${data.multiplier}）</span>
      </div>
    `;
  } else if (data.type === 'timeout') {
    detailsEl.innerHTML = `
      <div class="detail-row">
        <span class="detail-label">结算方式</span>
        <span class="detail-value">${data.timeoutNickname} 操作超时</span>
      </div>
    `;
  } else if (data.type === 'disconnect') {
    detailsEl.innerHTML = `
      <div class="detail-row">
        <span class="detail-label">结算方式</span>
        <span class="detail-value">${data.disconnectedNickname} 断线超时</span>
      </div>
    `;
  } else if (data.type === 'singleStreak') {
    const loserName = data.loser === state.playerId ? state.nickname + '（你）' : (data.loserNickname || getPlayerName(data.loser));
    const eventsHtml = (data.rerollEvents || []).map(ev => {
      const n = ev.playerId === state.playerId ? state.nickname + '（你）' : ev.nickname;
      return `<div class="detail-row"><span class="detail-label">第${ev.streak}次单骰</span><span class="detail-value">${n}</span></div>`;
    }).join('');
    detailsEl.innerHTML = `
      <div class="detail-row">
        <span class="detail-label">结算方式</span>
        <span class="detail-value">${loserName} 连续 ${data.maxStreak} 次摇到单骰</span>
      </div>
      ${eventsHtml}
    `;
  }

  // 胜负结果
  const resultEl = document.getElementById('settlement-result');
  const isWinner = data.winner === state.playerId;
  const loserStats = data.stats && data.loser ? data.stats[data.loser] : null;
  const isRekt = loserStats && loserStats.streak >= 3 && loserStats.totalScore >= 5;

  // 随机骚话
  const winLines = [
    '🏆 赢麻了！',
    '🏆 就这？',
    '🏆 稳如老狗',
    '🏆 技术性碾压'
  ];
  const loseLines = [
    '😵 走了走了，喝酒去',
    '😩 这把不算，下把来',
    '🥴 算你运气好',
    '😭 我不服，再来'
  ];
  const rektLoseLines = [
    '🥴 菜就多练，练就多菜',
    '🫠 今晚车费我出',
    '💀 建议明早再战',
    '🍺 喝到天明就对了'
  ];
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  let loseText = pick(loseLines);
  let winText = pick(winLines);
  if (isRekt) {
    if (!isWinner) {
      loseText = pick(rektLoseLines);
    } else {
      winText = `🏆 赢！${data.loserNickname || '对面'}别哭`;
    }
  }

  // 非参与者（多人模式中的旁观者）
  const isInvolved = data.winner === state.playerId || data.loser === state.playerId;
  let resultText;
  if (isInvolved) {
    resultText = isWinner ? winText : loseText;
  } else {
    resultText = `🎭 ${data.winnerNickname || '???'} 赢了 · ${data.loserNickname || '???'} 喝酒`;
  }

  resultEl.innerHTML = `
    <div class="result-winner" style="color: ${isWinner ? 'var(--success)' : (isInvolved ? 'var(--danger)' : 'var(--text-secondary)')}">
      ${resultText}
    </div>
    <div class="result-score">
      ${data.loserNickname || ''} 本局欠杯：+${data.score || 0} 杯${data.multiplier > 1 ? `（×${data.multiplier}倍）` : ''}
    </div>
  `;

  // 重置"再来一局"按钮
  const playAgainBtn = document.getElementById('btn-play-again');
  playAgainBtn.disabled = false;
  playAgainBtn.textContent = '速进！再整一局';
  playAgainBtn.classList.remove('btn-glow');
  state.playAgainClicked = false;  // v2.6.4：新局重置标记

  // 战绩统计
  const statsEl = document.getElementById('settlement-stats');
  statsEl.innerHTML = '<div class="stats-title">🍻 今晚谁喝多了</div>';
  if (data.stats) {
    const orderedPids = (data.playerOrder || state.playerOrder || []).map(p => p.id || p);
    const displayPids = orderedPids.length > 0 ? orderedPids : Object.keys(data.stats);
    for (const pid of displayPids) {
      const stat = data.stats[pid];
      if (!stat) continue;
      const name = getPlayerName(pid);
      const isMe = pid === state.playerId;
      statsEl.innerHTML += `
        <div class="stats-row">
          <span class="stat-name">${name}${isMe ? '（你）' : ''}</span>
          <span class="stat-detail">${stat.wins}胜${stat.losses}负 · 欠杯数：${stat.totalScore}</span>
        </div>
      `;
    }
  }
}

// 再来一局
document.getElementById('btn-play-again').addEventListener('click', () => {
  sendMsg('play_again');
  const total = state.playerOrder.length;
  state.playAgainClicked = true;  // v2.6.4：标记已点击
  showToast(`等其他人续杯...（1/${total}）`);
  document.getElementById('btn-play-again').disabled = true;
  document.getElementById('btn-play-again').textContent = `等其他人续杯...（1/${total}）`;
});

// 退出
document.getElementById('btn-leave-game').addEventListener('click', () => {
  sendMsg('leave_room');
  state.roomCode = '';
  state.opponent = null;
  state.playerOrder = [];
  state.bids = [];
  showPage('home');
});

// =============== 重连恢复状态 ===============
function handleGameStateRestore(data) {
  state.roomCode = data.roomCode;
  state.nickname = data.you.nickname;
  state.myDice = data.you.dice;
  state.stats = data.stats;
  state.maxPlayers = data.maxPlayers || 2;
  if (data.ruleSet) state.ruleSet = data.ruleSet;
  // v2.6.3：重连时恢复技能模式 + 自己的技能（否则技能栏消失）
  if (data.skillMode) state.skillMode = data.skillMode;
  if (data.you && data.you.skill !== undefined) state.mySkill = data.you.skill;

  if (data.playerOrder) {
    state.playerOrder = data.playerOrder;
  }

  if (data.opponent) {
    state.opponent = data.opponent;
  }

  if (data.game) {
    state.bids = data.game.bids || [];
    state.lastBid = data.game.lastBid;
    state.challenge = data.game.challenge;
    state.currentTurn = data.game.currentTurn;
    state.onesCalled = !!data.game.onesCalled;
    // v2.6.4：恢复封口状态
    state.silencerBy = data.game.silencerBy || null;
    state.silencerTarget = data.game.silencerTarget || null;
  }
  // v2.6.4：恢复自己激活未生效的封口
  state.myPendingSilencer = !!(data.you && data.you.pendingSilencer);

  // v2.7.0：恢复赛制状态
  if (data.matchConfig) state.matchConfig = data.matchConfig;
  if (data.matchProgress) {
    state.matchProgress = data.matchProgress;
    startMatchCountdownIfNeeded();
  }
  if (data.matchFinished) {
    state.matchFinished = data.matchFinished;
    showFinalRankingPage(data.matchFinished);
    return; // 已结束 → 直接进入排名页，不再继续渲染游戏页
  }

  if (data.phase === 'waiting') {
    showWaitingPage({ roomCode: data.roomCode, roomInfo: { maxPlayers: data.maxPlayers, players: data.playerOrder } });
  } else if (data.phase === 'bidding' || data.phase === 'challenging') {
    state.isMyTurn = (data.game?.currentTurn === state.playerId) ||
                     (data.game?.challenge?.currentTurn === state.playerId);
    state.phase = data.phase === 'challenging' ? 'challenging' : 'game';
    showPage('game');
    renderOpponentsArea();
    renderMyDice(data.you.dice);
    renderAllOpponentDice(false);
    updateScoreDisplay();
    updateSkillBar();  // v2.6.3：刷新技能栏
    document.getElementById('game-my-name').textContent = state.nickname;
    updateMatchProgressBar(); // v2.7.0

    // 恢复叫数记录
    if (state.bids.length > 0) {
      updateBidHistory({ bids: state.bids });
    }
    updateActionArea();

    if (data.phase === 'challenging' && state.isMyTurn && data.game.challenge) {
      showChallengeUI({
        challengerNickname: '对方',
        targetNickname: '你',
        multiplier: data.game.challenge.multiplier,
        count: data.game.challenge.count,
        currentTurn: data.game.challenge.currentTurn
      });
    }
  } else if (data.phase === 'settling') {
    // v2.6.3：重连到结算阶段 —— 服务端附带 lastSettlement 快照时，直接复原完整结算页
    if (data.lastSettlement) {
      showSettlementPage({
        ...data.lastSettlement,
        stats: data.stats,
        playerOrder: data.playerOrder
      });
    } else {
      // 兜底：信息不全时简化展示
      showSettlementPage({ type: 'reconnect', stats: data.stats, playerOrder: data.playerOrder });
    }
  }
}

// =============== v2.7.0：赛制 UI ===============

/**
 * 启动定时间倒计时（每秒刷新进度条）
 */
function startMatchCountdownIfNeeded() {
  stopMatchCountdown();
  const mp = state.matchProgress;
  if (!mp || mp.mode !== 'time' || !mp.endsAt) return;
  state.matchCountdownTimer = setInterval(() => {
    if (!state.matchProgress || state.matchProgress.finished) {
      stopMatchCountdown();
      return;
    }
    updateMatchProgressBar();
  }, 1000);
}

function stopMatchCountdown() {
  if (state.matchCountdownTimer) {
    clearInterval(state.matchCountdownTimer);
    state.matchCountdownTimer = null;
  }
}

/**
 * 更新游戏页顶部的赛制进度条
 */
function updateMatchProgressBar() {
  const bar = document.getElementById('match-progress-bar');
  const iconEl = document.getElementById('mp-icon');
  const textEl = document.getElementById('mp-text');
  if (!bar || !iconEl || !textEl) return;

  const cfg = state.matchConfig;
  const mp = state.matchProgress;
  if (!cfg || cfg.mode === 'free' || !mp) {
    bar.style.display = 'none';
    bar.classList.remove('urgent');
    return;
  }

  bar.style.display = '';
  bar.classList.remove('urgent');

  switch (cfg.mode) {
    case 'time': {
      iconEl.textContent = '⏱';
      if (mp.timeUpFlag) {
        textEl.textContent = '时间已到，本局结束后公布排名';
        bar.classList.add('urgent');
      } else if (mp.endsAt) {
        const left = Math.max(0, Math.ceil((mp.endsAt - Date.now()) / 1000));
        const m = Math.floor(left / 60);
        const s = left % 60;
        textEl.textContent = `剩余 ${m}:${String(s).padStart(2, '0')} · 已打 ${mp.roundsPlayed || 0} 局`;
        if (left <= 30) bar.classList.add('urgent');
      } else {
        textEl.textContent = `定时间 ${cfg.target} 分钟`;
      }
      break;
    }
    case 'rounds': {
      iconEl.textContent = '🔢';
      const cur = mp.roundsPlayed || 0;
      textEl.textContent = `第 ${Math.min(cur + 1, cfg.target)} / ${cfg.target} 局`;
      if (cfg.target - cur <= 1) bar.classList.add('urgent');
      break;
    }
    case 'maxLoss': {
      iconEl.textContent = '🎯';
      const cur = mp.currentMax != null ? mp.currentMax : 0;
      textEl.textContent = `最菜玩家 ${cur} / ${cfg.target} 杯`;
      if (cur >= cfg.target * 0.8) bar.classList.add('urgent');
      break;
    }
    case 'totalLoss': {
      iconEl.textContent = '🍺';
      const cur = mp.currentTotal != null ? mp.currentTotal : 0;
      textEl.textContent = `总欠杯 ${cur} / ${cfg.target} 杯`;
      if (cur >= cfg.target * 0.8) bar.classList.add('urgent');
      break;
    }
  }
}

/**
 * 显示最终排名页（赛制结束）
 */
function showFinalRankingPage(data) {
  showPage('final-ranking');
  stopMatchCountdown();

  const reasonEl = document.getElementById('final-reason');
  const metaEl = document.getElementById('final-meta');
  const listEl = document.getElementById('final-ranking-list');
  if (!listEl) return;

  if (reasonEl) reasonEl.textContent = data.reasonText || '比赛结束';
  if (metaEl) {
    const rounds = data.roundsPlayed || 0;
    const durMin = data.durationMs ? Math.max(1, Math.round(data.durationMs / 60000)) : 0;
    metaEl.textContent = `🎲 共打 ${rounds} 局 · ⏱ 用时约 ${durMin} 分钟`;
  }

  const ranking = (data.ranking || []).slice();
  const medalMap = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const lastRank = ranking.length > 0 ? Math.max(...ranking.map(r => r.rank)) : 0;

  listEl.innerHTML = ranking.map(r => {
    const isMe = r.playerId === state.playerId;
    const medal = medalMap[r.rank] || `第${r.rank}名`;
    let cls = `rank-row rank-${r.rank}`;
    if (r.rank === lastRank && ranking.length > 1) cls += ' rank-last';
    if (isMe) cls += ' is-me';
    const winRate = (r.wins + r.losses) > 0
      ? Math.round(r.wins / (r.wins + r.losses) * 100)
      : 0;
    return `
      <div class="${cls}">
        <div class="rank-medal">${medal}</div>
        <div class="rank-info">
          <div class="rank-name">${r.nickname}${isMe ? '（你）' : ''}${r.isBot ? ' 🤖' : ''}</div>
          <div class="rank-stats">${r.wins}胜 ${r.losses}负 · 胜率 ${winRate}%</div>
        </div>
        <div class="rank-score">
          <span class="rank-score-num">${r.totalScore}</span>
          <span class="rank-score-unit">杯</span>
        </div>
      </div>
    `;
  }).join('') || '<div class="rank-empty">暂无战绩</div>';

  if (window.Sound) {
    // 自己拿名次给点反馈
    const me = ranking.find(r => r.playerId === state.playerId);
    if (me) {
      if (me.rank === 1) { window.Sound.win && window.Sound.win(); window.Sound.cheer && window.Sound.cheer(); }
      else if (me.rank === lastRank && ranking.length > 1) { window.Sound.lose && window.Sound.lose(); }
    }
  }
}

// 最终排名页"回到首页"
const btnFinalBackHome = document.getElementById('btn-final-back-home');
if (btnFinalBackHome) {
  btnFinalBackHome.addEventListener('click', () => {
    sendMsg('leave_room');
    state.roomCode = '';
    state.opponent = null;
    state.playerOrder = [];
    state.bids = [];
    state.matchConfig = null;
    state.matchProgress = null;
    state.matchFinished = null;
    showPage('home');
  });
}

// =============== 工具函数 ===============
function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.innerText = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => {
    toast.className = 'toast';
  }, 3000);
}

function copyToClipboard(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

function showDisconnectOverlay() {
  document.getElementById('disconnect-overlay').style.display = 'flex';
}

function hideDisconnectOverlay() {
  document.getElementById('disconnect-overlay').style.display = 'none';
}

function getRoomCodeFromURL() {
  const match = location.pathname.match(/\/room\/([A-Za-z0-9]+)/);
  return match ? match[1].toUpperCase() : null;
}

// =============== 规则速查弹窗 ===============
document.getElementById('btn-rules-float').addEventListener('click', () => {
  showModal('modal-rules-quick');
});

document.getElementById('btn-close-rules-quick').addEventListener('click', () => {
  hideModal('modal-rules-quick');
});

// =============== 聊天 & 弹幕 ===============
document.getElementById('btn-chat-send').addEventListener('click', () => {
  sendChatMessage();
});

document.getElementById('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendChatMessage();
  }
});

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  sendMsg('chat', { text });
  input.value = '';
}

// v2.6.4：弹幕 lane 占用表，避免多人同时发言时覆盖
const danmakuLaneBusy = [];
function showDanmaku(data) {
  const container = document.getElementById('danmaku-container');
  if (!container) return;

  const item = document.createElement('div');
  const isMine = data.playerId === state.playerId;
  item.className = `danmaku-item ${isMine ? 'mine' : 'theirs'}`;
  item.textContent = `${data.nickname}: ${data.text}`;

  const laneHeight = 32;
  // v2.6.6：根据容器实际高度计算 lane 数（容器高度从 200 缩到 76）
  const containerH = container.clientHeight || 76;
  const maxLanes = Math.max(1, Math.floor(containerH / laneHeight));
  // 找第一个空闲 lane；若全满则随机选一个（降级避免丢弹幕）
  let lane = -1;
  for (let i = 0; i < maxLanes; i++) {
    if (!danmakuLaneBusy[i]) { lane = i; break; }
  }
  if (lane === -1) lane = Math.floor(Math.random() * maxLanes);
  danmakuLaneBusy[lane] = true;

  item.style.top = `${lane * laneHeight}px`;

  container.appendChild(item);

  item.addEventListener('animationend', () => {
    item.remove();
    danmakuLaneBusy[lane] = false;
  });
}

// =============== 初始化 ===============
function init() {
  console.log('[Init] 页面加载，playerId:', state.playerId);
  connectWS();

  // v2.6.4：房间码输入框实时大写 + 过滤空格/中文标点
  const roomInput = document.getElementById('input-room-code');
  if (roomInput) {
    roomInput.addEventListener('input', () => {
      const cleaned = roomInput.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6);
      if (roomInput.value !== cleaned) roomInput.value = cleaned;
    });
  }

  // 音效开关按钮
  const soundBtn = document.getElementById('btn-sound-toggle');
  if (soundBtn && window.Sound) {
    const updateIcon = () => {
      const on = window.Sound.isEnabled();
      soundBtn.textContent = on ? '🔊' : '🔇';
      soundBtn.classList.toggle('muted', !on);
      soundBtn.title = on ? '音效：开（点击关闭）' : '音效：关（点击开启）';
    };
    updateIcon();
    soundBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.Sound.unlock();
      const on = window.Sound.toggle();
      updateIcon();
      if (on) window.Sound.click();
    });
  }

  // 首次用户交互时解锁 AudioContext（iOS/Safari 要求）
  // v2.6.4：修正为 once: true，解锁一次后自动移除监听
  const unlockSound = () => {
    if (window.Sound) window.Sound.unlock();
  };
  document.addEventListener('click', unlockSound, { once: true });
  document.addEventListener('touchstart', unlockSound, { once: true });

  // 检查 URL 是否包含房间码（链接直达）
  const roomCode = getRoomCodeFromURL();
  if (roomCode) {
    console.log('[Init] URL中发现房间码:', roomCode);
    state.roomCode = roomCode;
    pendingAction = 'join';
    document.getElementById('input-nickname').value = '';
    document.getElementById('nickname-action-area').innerHTML = `
      <p style="color: var(--text-secondary); font-size: 14px; margin-bottom: 12px;">你正在加入房间 <strong>${roomCode}</strong></p>
      <button class="btn btn-primary" id="btn-confirm-direct-join">加入房间</button>
    `;
    showModal('modal-nickname');
    document.getElementById('btn-confirm-direct-join').addEventListener('click', () => {
      handleJoinRoom();
    });
  }
}

init();

// =============== 技能系统 - UI ===============
function updateSkillBar() {
  const bar = document.getElementById('skill-bar');
  if (!bar) return;

  if (!state.skillMode || state.skillMode === 'none' || !state.mySkill) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }

  const s = state.mySkill;
  const isPassive = s.type === 'passive';
  const used = !!s.used;

  // 按钮禁用时机判断
  let disabled = used || isPassive;
  let timingHint = '';
  if (!disabled) {
    // 主动技能：参照服务端时机定义
    const needMyTurn = ['peek', 'silencer', 'reroll', 'bigReroll'].includes(s.id);
    if (needMyTurn && !state.isMyTurn) {
      disabled = true;
      timingHint = '仅自己回合可用';
    }
    // 换骰/大换骰：只要自己本局还没叫过数就能用（即使别人已经叫过）
    if (s.id === 'reroll' || s.id === 'bigReroll') {
      const bids = state.bids || [];
      const myBids = bids.filter(b => b.playerId === state.playerId);
      if (myBids.length > 0) {
        disabled = true;
        timingHint = '你已叫过数';
      }
    }
  }

  const stateLabel = isPassive
    ? '<span class="skill-state passive">被动生效</span>'
    : (used ? '<span class="skill-state used">本局已用</span>' : `<span class="skill-state ready">可用</span>`);

  // v2.6.4：封口待生效徽章
  const pendingSilencerBadge = (s.id === 'silencer' && state.myPendingSilencer)
    ? '<span class="skill-state pending" style="background:rgba(255,193,7,.2);color:#ffc107;border:1px solid rgba(255,193,7,.4);">🔒 待触发</span>'
    : '';

  bar.style.display = 'flex';
  bar.innerHTML = `
    <div class="skill-info">
      <span class="skill-icon">${s.icon || '🎭'}</span>
      <div class="skill-text">
        <div class="skill-name-line">${s.name}${stateLabel}${pendingSilencerBadge}</div>
        <div class="skill-desc-line">${(s.id === 'silencer' && state.myPendingSilencer) ? '下次叫数生效，下家只能劈或认输' : (s.desc || '')}</div>
      </div>
    </div>
    ${isPassive ? '' : `
      <button class="btn btn-primary btn-skill-use" id="btn-use-skill" ${disabled ? 'disabled' : ''}>
        ${used ? '已用' : (timingHint ? timingHint : '使用')}
      </button>
    `}
  `;

  const btn = document.getElementById('btn-use-skill');
  if (btn && !disabled) {
    btn.onclick = () => triggerSkillUse();
  }
}

function triggerSkillUse() {
  const s = state.mySkill;
  if (!s || s.type === 'passive' || s.used) return;

  if (s.id === 'peek') {
    showSkillTargetModal('peek');
    return;
  }
  if (s.id === 'reroll') {
    showSkillDiceModal();
    return;
  }
  if (s.id === 'bigReroll') {
    // 直接确认
    if (!confirm('确认放弃当前 5 颗骰子，全部重摇？')) return;
    sendMsg('use_skill', { skillId: 'bigReroll' });
    return;
  }
  if (s.id === 'silencer') {
    if (!state.isMyTurn) {
      showToast('封口需要在自己回合激活', 'error');
      return;
    }
    sendMsg('use_skill', { skillId: 'silencer' });
    state.myPendingSilencer = true;  // v2.6.4：记录待生效状态
    showToast('🔒 封口已激活，下次叫数后下家只能劈或认输', 'success');
    updateSkillBar();
    return;
  }
}

// 选目标玩家（透视）
function showSkillTargetModal(skillId) {
  const list = document.getElementById('skill-target-list');
  const title = document.getElementById('skill-target-title');
  if (!list) return;

  title.textContent = skillId === 'peek' ? '👁️ 偷看谁的骰子？' : '选一位玩家';

  const candidates = state.playerOrder.filter(p => p.id !== state.playerId);
  list.innerHTML = candidates.map(p => `
    <button class="skill-target-btn" data-target="${p.id}">
      <span class="target-name">${p.nickname}</span>
      <span class="target-arrow">→</span>
    </button>
  `).join('');

  list.onclick = (e) => {
    const btn = e.target.closest('.skill-target-btn');
    if (!btn) return;
    const targetId = btn.dataset.target;
    hideModal('modal-skill-target');
    sendMsg('use_skill', { skillId, targetId });
  };

  showModal('modal-skill-target');
}

// 选要换的骰子（换骰）
function showSkillDiceModal() {
  const list = document.getElementById('skill-dice-list');
  if (!list) return;

  list.innerHTML = (state.myDice || []).map((v, i) => `
    <button class="skill-dice-btn" data-idx="${i}">
      <div class="die revealed" data-value="${v}">${createDiceDots(v)}</div>
      <div class="dice-idx">第${i + 1}颗</div>
    </button>
  `).join('');

  list.onclick = (e) => {
    const btn = e.target.closest('.skill-dice-btn');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    hideModal('modal-skill-dice');
    sendMsg('use_skill', { skillId: 'reroll', diceIndex: idx });
  };

  showModal('modal-skill-dice');
}

document.getElementById('btn-cancel-skill-target').addEventListener('click', () => hideModal('modal-skill-target'));
document.getElementById('btn-cancel-skill-dice').addEventListener('click', () => hideModal('modal-skill-dice'));

// 收到"某人用了某技能"广播
function handleSkillUsedBroadcast(data) {
  const isMe = data.playerId === state.playerId;
  const name = isMe ? '你' : data.nickname;

  let text = `${data.skillIcon || '🎭'} ${name} 使用了【${data.skillName}】`;
  if (data.publicData) {
    if (data.publicData.targetNickname) {
      text += ` → ${data.publicData.targetNickname}`;
    } else if (data.publicData.changedCount) {
      text += `（换了 ${data.publicData.changedCount} 颗骰子）`;
    } else if (data.publicData.message) {
      text = `${data.skillIcon || '🎭'} ${name}：${data.publicData.message}`;
    }
  }
  showToast(text, 'success');

  // 如果是自己，更新本地 used 状态
  if (isMe && state.mySkill) {
    state.mySkill.used = true;
  }
  updateSkillBar();
}

// 收到"透视结果"——只发给使用者
function handleSkillPeekResult(data) {
  state.peekedMap[data.targetId] = {
    idx: data.diceIndex,
    value: data.diceValue,
    nickname: data.targetNickname
  };
  showToast(`👁️ ${data.targetNickname} 的第 ${data.diceIndex + 1} 颗是【${data.diceValue}】`, 'success');

  // 在该对手的骰子区高亮那一颗
  const container = document.getElementById(`opponent-dice-${data.targetId}`);
  if (container) {
    const dice = container.querySelectorAll('.die');
    const die = dice[data.diceIndex];
    if (die) {
      die.classList.remove('hidden');
      die.classList.add('peeked');
      die.dataset.value = data.diceValue;
      die.innerHTML = createDiceDots(data.diceValue);
    }
  }
}

// 收到"换骰结果"——只发给使用者
function handleSkillRerollResult(data) {
  state.myDice = data.newDice;
  renderMyDice(data.newDice);
  if (data.bigReroll) {
    showToast(`🎲🎲 5 颗骰子已全部重摇`, 'success');
  } else {
    showToast(`🎲 ${data.oldValue} → ${data.newValue}`, 'success');
  }
  if (window.Sound) window.Sound.shake();
  updateSkillBar();
}
