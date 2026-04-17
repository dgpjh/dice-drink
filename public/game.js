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

  // 计时器
  timerInterval: null,
  timerRemaining: 30,

  // 等房间计时
  roomTimerInterval: null,
  roomCreatedAt: null
};

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
      localStorage.setItem('liars_dice_player_id', data.playerId);
      showWaitingPage(data);
      break;

    case 'room_joined':
      state.playerId = data.playerId;
      state.roomCode = data.roomCode;
      state.nickname = data.nickname;
      state.maxPlayers = data.roomInfo?.maxPlayers || 2;
      localStorage.setItem('liars_dice_player_id', data.playerId);
      showWaitingPage(data);
      break;

    case 'player_info':
      state.opponent = data.opponent;
      state.stats = data.stats;
      if (data.playerOrder) {
        state.playerOrder = data.playerOrder;
        state.maxPlayers = data.maxPlayers || state.maxPlayers;
      }
      updateWaitingPlayerList();
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
      if (data.playerOrder) {
        state.playerOrder = data.playerOrder;
      }
      showGamePage(data);
      break;

    case 'bid_made':
      state.bids = data.bids;
      state.lastBid = data.bid;
      state.currentTurn = data.currentTurn;
      state.isMyTurn = data.currentTurn === state.playerId;
      updateBidHistory(data);
      updateActionArea();
      resetTimer();
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
      break;

    case 'game_settled':
      state.phase = 'settlement';
      state.stats = data.stats;
      if (data.playerOrder) {
        state.playerOrder = data.playerOrder;
      }
      clearTimer();
      showSettlementPage(data);
      break;

    case 'play_again_request':
      showToast(`${data.nickname} 想再来一局！（${data.readyCount}/${data.totalPlayers}）`, 'success');
      const playAgainBtn = document.getElementById('btn-play-again');
      playAgainBtn.disabled = false;
      playAgainBtn.textContent = `🎲 ${data.readyCount}/${data.totalPlayers} 已准备，点击开始！`;
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

// =============== 首页操作 ===============
let pendingAction = null;

// 创建房间 → 先选人数
document.getElementById('btn-create-room').addEventListener('click', () => {
  console.log('[UI] 点击创建房间，弹出选人数弹窗');
  state.selectedMaxPlayers = 2;
  // 重置人数选择器
  document.querySelectorAll('.count-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.count === '2');
  });
  document.getElementById('total-dice-hint').textContent = '场上共 10 颗骰子';
  showModal('modal-create');
});

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

  console.log('[创建房间]', { nickname, maxPlayers: state.maxPlayers, connected: state.connected });

  if (!state.connected) {
    connectWS();
    let attempts = 0;
    const checkConnection = setInterval(() => {
      attempts++;
      if (state.connected) {
        clearInterval(checkConnection);
        sendMsg('create_room', { nickname, playerId: state.playerId, maxPlayers: state.maxPlayers });
      } else if (attempts > 50) {
        clearInterval(checkConnection);
        showToast('连接服务器失败，请刷新页面重试', 'error');
      }
    }, 100);
  } else {
    sendMsg('create_room', { nickname, playerId: state.playerId, maxPlayers: state.maxPlayers });
  }
}

function handleJoinRoom() {
  const nickname = document.getElementById('input-nickname').value.trim() || `玩家${Math.floor(Math.random() * 9000) + 1000}`;
  state.nickname = nickname;
  hideAllModals();

  if (!state.connected) {
    connectWS();
    const checkConnection = setInterval(() => {
      if (state.connected) {
        clearInterval(checkConnection);
        sendMsg('join_room', { roomCode: state.roomCode, nickname, playerId: state.playerId });
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
      div.className = `player-item ${isMe ? 'you' : 'other'}`;
      div.innerHTML = `
        <span class="player-status">✅</span>
        <span class="player-name">${p.nickname}${isMe ? '（你）' : ''}</span>
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

// =============== 对局页面 ===============
function showGamePage(data) {
  showPage('game');
  clearRoomCountdown();

  // 设置己方名和得分
  document.getElementById('game-my-name').textContent = state.nickname;
  updateScoreDisplay();

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
  state.selectedQuantity = 3;
  state.selectedValue = 2;
  state.selectedMode = 'fly';
  updateSelectors();
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

  setTimeout(() => {
    myDiceEl.querySelectorAll('.die').forEach(d => d.classList.remove('shaking'));
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
    for (let i = 0; i < 5; i++) {
      const die = document.createElement('div');
      if (revealed && allDice && allDice[op.id]) {
        const dice = allDice[op.id].dice || allDice[op.id];
        die.className = 'die revealed';
        die.dataset.value = dice[i];
        die.innerHTML = createDiceDots(dice[i]);
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
    const modeName = bid.mode === 'fly' ? '飞' : '斋';
    const modeClass = bid.mode === 'fly' ? 'mode-tag-fly' : 'mode-tag-zhai';
    item.innerHTML = `
      <div class="bid-player">${bid.nickname}</div>
      <div class="bid-content">${bid.quantity}个${bid.value} ${bid.value === 1 ? '' : `<span class="${modeClass}">${modeName}</span>`}</div>
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
      waitingText.textContent = `⚡ 等待劈骰结果...`;
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
  } else {
    biddingArea.style.display = 'none';
    challengedArea.style.display = 'none';
    waitingArea.style.display = 'block';
    waitingText.textContent = `🍺 等待 ${getCurrentTurnName()} 叫骰...`;
  }
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

function getMinQuantity(value, mode, lastBid) {
  let baseMin;
  if (value === 1) {
    baseMin = 2;
  } else {
    baseMin = 3;
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
    const minFlyQuantity = prev.quantity + 2;
    ruleMin = minFlyQuantity;
  } else if (prev.mode === 'fly' && nextMode === 'zhai') {
    const minZhaiQuantity = prev.quantity - 1;
    ruleMin = minZhaiQuantity;
  } else {
    ruleMin = baseMin;
  }

  return Math.max(baseMin, ruleMin);
}

function getAvailableValues(quantity, mode, lastBid) {
  const available = [];
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
  const testMode = (value === 1) ? 'zhai' : mode;
  let baseMin = (value === 1) ? 2 : 3;
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
    const minFlyQuantity = prev.quantity * 2 - 1;
    return quantity >= minFlyQuantity;
  }
  if (prev.mode === 'fly' && testMode === 'zhai') {
    const minZhaiQuantity = Math.ceil((prev.quantity + 1) / 2);
    return quantity >= minZhaiQuantity;
  }
  return false;
}

function updateSelectors() {
  const lastBid = state.lastBid;

  if (state.selectedValue === 1) {
    state.selectedMode = 'zhai';
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
    if (state.selectedValue === 1) state.selectedMode = 'zhai';
    updateSelectors();
    return;
  }

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
  if (state.selectedValue === 1) state.selectedMode = 'zhai';
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

  ['timer-fill', 'timer-fill-challenge', 'timer-fill-waiting'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.width = `${pct}%`;
  });

  ['timer-text', 'timer-text-challenge', 'timer-text-waiting'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  });
}

// =============== 结算页面 ===============
function showSettlementPage(data) {
  showPage('settlement');

  // 标题
  const titleEl = document.getElementById('settlement-title');
  if (data.type === 'surrender') {
    titleEl.textContent = '🏳️ 认输';
  } else if (data.type === 'timeout') {
    titleEl.textContent = '⏱ 超时';
  } else if (data.type === 'disconnect') {
    titleEl.textContent = '📡 掉线';
  } else {
    titleEl.textContent = '🎲 开骰！';
  }

  // 所有玩家骰子
  const diceArea = document.getElementById('settlement-dice-area');
  diceArea.innerHTML = '';

  if (data.allDice) {
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
  }

  // 结算详情
  const detailsEl = document.getElementById('settlement-details');
  detailsEl.innerHTML = '';

  if (data.type === 'open' && data.lastBid) {
    const modeName = data.lastBid.mode === 'fly' ? '飞' : '斋';
    const modeClass = data.lastBid.mode === 'fly' ? 'mode-tag-fly' : 'mode-tag-zhai';
    const modeTag = data.lastBid.value === 1 ? '' : `<span class="${modeClass}">${modeName}</span>`;
    
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
  }

  // 胜负结果
  const resultEl = document.getElementById('settlement-result');
  const isWinner = data.winner === state.playerId;
  const loserStats = data.stats && data.loser ? data.stats[data.loser] : null;
  const isRekt = loserStats && loserStats.streak >= 3 && loserStats.totalScore >= 5;
  let loseText = '😢 你输了';
  let winText = '🏆 你赢了！';
  if (isRekt) {
    if (!isWinner) {
      loseText = '🥴 菜就多练';
    } else {
      winText = `🏆 你赢了！${data.loserNickname || '对面'}菜就多练`;
    }
  }

  // 非参与者（多人模式中的旁观者）
  const isInvolved = data.winner === state.playerId || data.loser === state.playerId;
  let resultText;
  if (isInvolved) {
    resultText = isWinner ? winText : loseText;
  } else {
    resultText = `${data.winnerNickname || '???'} 赢了，${data.loserNickname || '???'} 输了`;
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
  playAgainBtn.textContent = '再来一局';
  playAgainBtn.classList.remove('btn-glow');

  // 战绩统计
  const statsEl = document.getElementById('settlement-stats');
  statsEl.innerHTML = '<div class="stats-title">🍻 今晚战绩</div>';
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
    document.getElementById('game-my-name').textContent = state.nickname;

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
    showSettlementPage({ type: 'reconnect', stats: data.stats, playerOrder: data.playerOrder });
  }
}

// =============== 工具函数 ===============
function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
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

let danmakuLane = 0;
function showDanmaku(data) {
  const container = document.getElementById('danmaku-container');
  if (!container) return;

  const item = document.createElement('div');
  const isMine = data.playerId === state.playerId;
  item.className = `danmaku-item ${isMine ? 'mine' : 'theirs'}`;
  item.textContent = `${data.nickname}: ${data.text}`;

  const laneHeight = 36;
  const maxLanes = Math.floor(200 / laneHeight);
  const lane = danmakuLane % maxLanes;
  danmakuLane++;

  item.style.top = `${lane * laneHeight}px`;

  container.appendChild(item);

  item.addEventListener('animationend', () => {
    item.remove();
  });
}

// =============== 初始化 ===============
function init() {
  console.log('[Init] 页面加载，playerId:', state.playerId);
  connectWS();

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
