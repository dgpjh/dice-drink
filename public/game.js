/**
 * 大话骰 - 前端游戏逻辑
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

  // 游戏状态
  phase: 'home',
  myDice: [],
  bids: [],
  lastBid: null,
  isMyTurn: false,
  currentTurn: null,
  challenge: null,
  stats: {},
  opponent: null,

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
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}`;

  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
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
    handleMessage(msg);
  };

  state.ws.onclose = () => {
    state.connected = false;
    if (state.phase !== 'home' && state.roomCode) {
      showDisconnectOverlay();
      attemptReconnect();
    }
  };

  state.ws.onerror = () => {};
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

// =============== 消息处理 ===============
function handleMessage(msg) {
  const { type, data } = msg;

  switch (type) {
    case 'room_created':
      state.playerId = data.playerId;
      state.roomCode = data.roomCode;
      state.nickname = data.nickname;
      localStorage.setItem('liars_dice_player_id', data.playerId);
      showWaitingPage(data);
      break;

    case 'room_joined':
      state.playerId = data.playerId;
      state.roomCode = data.roomCode;
      state.nickname = data.nickname;
      localStorage.setItem('liars_dice_player_id', data.playerId);
      showWaitingPage(data);
      break;

    case 'player_info':
      state.opponent = data.opponent;
      state.stats = data.stats;
      if (data.opponent) {
        updateWaitingPlayerInfo(data);
      }
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
        currentTurn: data.currentTurn
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
        currentTurn: data.currentTurn
      };
      state.isMyTurn = data.currentTurn === state.playerId;
      updateChallengeUI(data);
      resetTimer();
      break;

    case 'game_settled':
      state.phase = 'settlement';
      state.stats = data.stats;
      clearTimer();
      showSettlementPage(data);
      break;

    case 'play_again_request':
      showToast(`${data.nickname} 想再来一局！`, 'success');
      // 高亮"再来一局"按钮，提示对方已准备
      const playAgainBtn = document.getElementById('btn-play-again');
      playAgainBtn.disabled = false;
      playAgainBtn.textContent = '🎲 对方已准备，点击开始！';
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

document.getElementById('btn-create-room').addEventListener('click', () => {
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

document.getElementById('btn-join-room').addEventListener('click', () => {
  // 检查 URL 里是否有房间码
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
  hideAllModals();

  if (!state.connected) {
    connectWS();
    // 等连接后再发
    const checkConnection = setInterval(() => {
      if (state.connected) {
        clearInterval(checkConnection);
        sendMsg('create_room', { nickname, playerId: state.playerId });
      }
    }, 100);
  } else {
    sendMsg('create_room', { nickname, playerId: state.playerId });
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

  document.getElementById('waiting-player1').textContent = `${state.nickname}（你）`;
  document.getElementById('waiting-player2').textContent = '等待中...';

  // 房间倒计时
  state.roomCreatedAt = Date.now();
  startRoomCountdown();
}

function updateWaitingPlayerInfo(data) {
  if (data.opponent) {
    document.getElementById('waiting-player2').textContent = data.opponent.nickname;
    const statusEl = document.querySelector('.player-item.opponent .player-status');
    if (statusEl) statusEl.textContent = '✅';
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
  // 确保链接包含完整的协议、主机名和端口
  const protocol = location.protocol;
  const host = location.hostname;
  const port = location.port;
  const portPart = port ? `:${port}` : '';
  const link = `${protocol}//${host}${portPart}/room/${state.roomCode}`;
  copyToClipboard(link);
  showToast('邀请链接已复制：' + link, 'success');
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

  // 设置玩家名和得分
  document.getElementById('game-my-name').textContent = state.nickname;
  document.getElementById('game-opponent-name').textContent = state.opponent?.nickname || '对手';
  updateScoreDisplay();

  // 显示摇骰动画，然后揭示骰子
  showDiceAnimation(() => {
    renderMyDice(data.yourDice);
    renderOpponentDice(false);
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

function showDiceAnimation(callback) {
  // 骰子摇动动画
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

function renderOpponentDice(revealed, dice) {
  const container = document.getElementById('opponent-dice');
  container.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const die = document.createElement('div');
    if (revealed && dice) {
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

function getDiceDisplay(value) {
  return createDiceDots(value);
}

function getDiceEmoji(value) {
  return createDiceDots(value);
}

/**
 * 创建骰子圆点 HTML
 * @param {number} value - 骰子点数 1-6
 * @returns {string} 包含圆点的 HTML
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
  const opStats = state.opponent ? (state.stats[state.opponent.id] || { totalScore: 0 }) : { totalScore: 0 };
  document.getElementById('game-my-score').textContent = `得分：${myStats.totalScore}`;
  document.getElementById('game-opponent-score').textContent = `得分：${opStats.totalScore}`;
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
    indicator.textContent = `← 等待 ${state.opponent?.nickname || '对方'} 操作`;
    indicator.style.color = 'var(--text-muted)';
  }
}

function updateActionArea() {
  const biddingArea = document.getElementById('action-bidding');
  const challengedArea = document.getElementById('action-challenged');
  const waitingArea = document.getElementById('action-waiting');

  if (state.phase === 'challenging') {
    if (state.isMyTurn) {
      biddingArea.style.display = 'none';
      challengedArea.style.display = 'block';
      waitingArea.style.display = 'none';
    } else {
      biddingArea.style.display = 'none';
      challengedArea.style.display = 'none';
      waitingArea.style.display = 'block';
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
  }
}

// =============== 叫数选择器 ===============

/**
 * 点数大小排序值：2<3<4<5<6<1（1最大）
 */
function diceRank(value) {
  if (value === 1) return 7; // 1是最大的
  return value; // 2=2, 3=3, 4=4, 5=5, 6=6
}

/**
 * 比较两个点数大小，返回 true 如果 a > b（1最大，2最小）
 */
function isValueGreater(a, b) {
  return diceRank(a) > diceRank(b);
}

/**
 * 获取按大小排序的所有点数（从小到大：2,3,4,5,6,1）
 */
function getSortedValues() {
  return [2, 3, 4, 5, 6, 1];
}

/**
 * 计算当前选择下的最小合法数量
 * 规则：
 *  - 飞模式(value!=1): 最低3个
 *  - 斋模式(value!=1): 最低3个
 *  - 叫1点(斋): 最低2个
 *  - 如果有上家叫数，还需满足加码规则
 */
function getMinQuantity(value, mode, lastBid) {
  // 基础最低数量
  let baseMin;
  if (value === 1) {
    baseMin = 2; // 叫1最低2个
  } else {
    baseMin = 3; // 飞或斋最低3个
  }

  if (!lastBid) return baseMin;

  const prev = { ...lastBid };
  if (prev.value === 1) prev.mode = 'zhai';
  const nextMode = (value === 1) ? 'zhai' : mode;

  let ruleMin;
  if (prev.mode === nextMode) {
    // 同模式：数量>=prev.quantity，同数量时点数>prev.value
    if (isValueGreater(value, prev.value)) {
      ruleMin = prev.quantity;
    } else {
      ruleMin = prev.quantity + 1;
    }
  } else if (prev.mode === 'zhai' && nextMode === 'fly') {
    // 斋→飞：跨模式只需满足数量或点数其中一个条件
    // 最低数量：如果点数更大，可以同数量；否则需要数量+1
    if (isValueGreater(value, prev.value)) {
      ruleMin = prev.quantity;
    } else {
      ruleMin = prev.quantity + 1;
    }
  } else if (prev.mode === 'fly' && nextMode === 'zhai') {
    // 飞→斋：跨模式切换，允许数量减少
    // 最低就是 baseMin（基础最低值）
    ruleMin = baseMin;
  } else {
    ruleMin = baseMin;
  }

  return Math.max(baseMin, ruleMin);
}

/**
 * 获取指定数量下可选的点数列表
 */
function getAvailableValues(quantity, mode, lastBid) {
  const available = [];
  for (let v = 1; v <= 6; v++) {
    const testMode = (v === 1) ? 'zhai' : mode;
    const minQ = getMinQuantity(v, testMode, lastBid);
    if (quantity >= minQ) {
      // 还需检查：同模式同数量时，点数需要>prev.value
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

/**
 * 获取指定数量和点数下可选的模式
 */
function getAvailableModes(quantity, value, lastBid) {
  if (value === 1) return ['zhai']; // 叫1只能斋

  const modes = [];
  for (const m of ['fly', 'zhai']) {
    const minQ = getMinQuantity(value, m, lastBid);
    if (quantity >= minQ) {
      // 还需检查同模式同数量的点数约束
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

/**
 * 检查一个叫数组合是否完全合法
 */
function isBidValid(quantity, value, mode, lastBid) {
  const testMode = (value === 1) ? 'zhai' : mode;
  // 基本最低数量
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
    // 斋→飞：数量更大，或同数量点数更大
    if (quantity > prev.quantity) return true;
    if (quantity === prev.quantity && isValueGreater(value, prev.value)) return true;
    return false;
  }
  if (prev.mode === 'fly' && testMode === 'zhai') {
    // 飞→斋：允许数量减少，只要不低于基础最低值就行
    return quantity >= baseMin;
  }
  return false;
}

function updateSelectors() {
  const lastBid = state.lastBid;

  // 叫1默认斋
  if (state.selectedValue === 1) {
    state.selectedMode = 'zhai';
  }

  // === 1. 计算当前模式和点数下的最小数量 ===
  const minQ = getMinQuantity(state.selectedValue, state.selectedMode, lastBid);
  const maxQ = 20;

  // 调整数量到合法范围
  if (state.selectedQuantity < minQ) {
    state.selectedQuantity = minQ;
  }

  // === 2. 更新数量显示 ===
  document.getElementById('quantity-value').textContent = state.selectedQuantity;

  // 减号按钮：如果已经是最小值则禁用
  const downBtn = document.querySelector('#quantity-selector .sel-btn[data-dir="down"]');
  const upBtn = document.querySelector('#quantity-selector .sel-btn[data-dir="up"]');
  if (downBtn) downBtn.disabled = (state.selectedQuantity <= minQ);
  if (upBtn) upBtn.disabled = (state.selectedQuantity >= maxQ);

  // === 3. 更新点数按钮状态 ===
  const availableValues = getAvailableValues(state.selectedQuantity, state.selectedMode, lastBid);
  document.querySelectorAll('.dice-val-btn').forEach(btn => {
    const val = parseInt(btn.dataset.val);
    const isAvailable = availableValues.includes(val);
    btn.classList.toggle('active', val === state.selectedValue);
    btn.classList.toggle('disabled', !isAvailable);
    btn.disabled = !isAvailable;
  });

  // 如果当前选中的点数不在可用列表中，自动选择第一个可用的
  if (!availableValues.includes(state.selectedValue) && availableValues.length > 0) {
    state.selectedValue = availableValues[0];
    if (state.selectedValue === 1) state.selectedMode = 'zhai';
    // 递归更新
    updateSelectors();
    return;
  }

  // === 4. 更新模式按钮状态 ===
  const availableModes = getAvailableModes(state.selectedQuantity, state.selectedValue, lastBid);
  document.querySelectorAll('.mode-btn').forEach(btn => {
    const m = btn.dataset.mode;
    const isAvailable = availableModes.includes(m);
    btn.classList.toggle('active', m === state.selectedMode);
    btn.classList.toggle('disabled', !isAvailable);
    btn.disabled = !isAvailable;
  });

  // 如果当前模式不可用，切换到可用的
  if (!availableModes.includes(state.selectedMode) && availableModes.length > 0) {
    state.selectedMode = availableModes[0];
    updateSelectors();
    return;
  }

  // === 5. 叫数按钮是否可用 ===
  const bidValid = isBidValid(state.selectedQuantity, state.selectedValue, state.selectedMode, lastBid);
  document.getElementById('btn-bid').disabled = !bidValid;
}

// 数量加减
document.getElementById('quantity-selector').addEventListener('click', (e) => {
  const btn = e.target.closest('.sel-btn');
  if (!btn || btn.disabled) return;
  const minQ = getMinQuantity(state.selectedValue, state.selectedMode, state.lastBid);
  if (btn.dataset.dir === 'up') {
    state.selectedQuantity = Math.min(14, state.selectedQuantity + 1);
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

  // 更新所有计时条
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

  // 双方骰子
  const diceArea = document.getElementById('settlement-dice-area');
  diceArea.innerHTML = '';

  if (data.allDice) {
    for (const [pid, info] of Object.entries(data.allDice)) {
      const playerName = info.nickname || (pid === state.playerId ? state.nickname : state.opponent?.nickname || '对手');
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
    
    // 构建每位玩家的贡献详情
    let countDetailsHtml = '';
    if (data.countDetails) {
      for (const [pid, count] of Object.entries(data.countDetails)) {
        const name = pid === state.playerId ? state.nickname + '（你）' : (state.opponent?.nickname || '对手');
        countDetailsHtml += `
          <div class="detail-row">
            <span class="detail-label">${name}</span>
            <span class="detail-value">贡献 ${count} 个 ${data.lastBid.value}</span>
          </div>
        `;
      }
    }
    
    detailsEl.innerHTML = `
      <div class="detail-row">
        <span class="detail-label">最后叫骰</span>
        <span class="detail-value">${data.lastBid.quantity}个${data.lastBid.value} ${modeTag}</span>
      </div>
      ${data.multiplier > 1 ? `<div class="detail-row"><span class="detail-label">劈骰倍数</span><span class="detail-value">×${data.multiplier}</span></div>` : ''}
      ${countDetailsHtml}
      <div class="detail-row">
        <span class="detail-label">实际总数</span>
        <span class="detail-value">${data.totalCount} 个 ${data.lastBid.value}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">判定结果</span>
        <span class="detail-value">${data.bidEstablished ? `${data.totalCount} ≥ ${data.bidQuantity} 叫骰成立` : `${data.totalCount} < ${data.bidQuantity} 叫骰不成立`}</span>
      </div>
    `;
  } else if (data.type === 'surrender') {
    detailsEl.innerHTML = `
      <div class="detail-row">
        <span class="detail-label">结算方式</span>
        <span class="detail-value">认输（倍数 ×${data.multiplier}）</span>
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
  // 判断输家是否连输3把且欠杯数>=5
  const loserStats = data.stats && data.loser ? data.stats[data.loser] : null;
  const isRekt = loserStats && loserStats.streak >= 3 && loserStats.totalScore >= 5;
  let loseText = '😢 你输了';
  let winText = '🏆 你赢了！';
  if (isRekt) {
    if (!isWinner) {
      loseText = '🥴 菜就多练';
    } else {
      winText = '🏆 你赢了！对面菜就多练';
    }
  }
  resultEl.innerHTML = `
    <div class="result-winner" style="color: ${isWinner ? 'var(--success)' : 'var(--danger)'}">
      ${isWinner ? winText : loseText}
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
  statsEl.innerHTML = '<div class="stats-title">当前战绩</div>';
  if (data.stats) {
    for (const [pid, stat] of Object.entries(data.stats)) {
      const name = pid === state.playerId ? state.nickname : (state.opponent?.nickname || '对手');
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
  showToast('等待对方确认...');
  document.getElementById('btn-play-again').disabled = true;
  document.getElementById('btn-play-again').textContent = '等待对方确认...';
});

// 退出
document.getElementById('btn-leave-game').addEventListener('click', () => {
  sendMsg('leave_room');
  state.roomCode = '';
  state.opponent = null;
  state.bids = [];
  showPage('home');
});

// =============== 重连恢复状态 ===============
function handleGameStateRestore(data) {
  state.roomCode = data.roomCode;
  state.nickname = data.you.nickname;
  state.myDice = data.you.dice;
  state.stats = data.stats;

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
    showWaitingPage({ roomCode: data.roomCode });
  } else if (data.phase === 'bidding' || data.phase === 'challenging') {
    state.isMyTurn = (data.game?.currentTurn === state.playerId) ||
                     (data.game?.challenge?.currentTurn === state.playerId);
    state.phase = data.phase === 'challenging' ? 'challenging' : 'game';
    showPage('game');
    renderMyDice(data.you.dice);
    renderOpponentDice(false);
    updateScoreDisplay();
    document.getElementById('game-my-name').textContent = state.nickname;
    document.getElementById('game-opponent-name').textContent = state.opponent?.nickname || '对手';

    // 恢复叫数记录
    if (state.bids.length > 0) {
      updateBidHistory({ bids: state.bids });
    }
    updateActionArea();

    if (data.phase === 'challenging' && state.isMyTurn && data.game.challenge) {
      showChallengeUI({
        challengerNickname: '对方',
        multiplier: data.game.challenge.multiplier,
        count: data.game.challenge.count,
        currentTurn: data.game.challenge.currentTurn
      });
    }
  } else if (data.phase === 'settling') {
    showSettlementPage({ type: 'reconnect', stats: data.stats });
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

/**
 * 显示弹幕
 */
let danmakuLane = 0;
function showDanmaku(data) {
  const container = document.getElementById('danmaku-container');
  if (!container) return;

  const item = document.createElement('div');
  const isMine = data.playerId === state.playerId;
  item.className = `danmaku-item ${isMine ? 'mine' : 'theirs'}`;
  item.textContent = `${data.nickname}: ${data.text}`;

  // 分配弹幕轨道（避免重叠）
  const laneHeight = 36;
  const maxLanes = Math.floor(200 / laneHeight);
  const lane = danmakuLane % maxLanes;
  danmakuLane++;

  item.style.top = `${lane * laneHeight}px`;

  container.appendChild(item);

  // 动画结束后移除
  item.addEventListener('animationend', () => {
    item.remove();
  });
}

// =============== 初始化 ===============
function init() {
  connectWS();

  // 检查 URL 是否包含房间码（链接直达）
  const roomCode = getRoomCodeFromURL();
  if (roomCode) {
    state.roomCode = roomCode;
    // 直接弹出昵称设置然后加入
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
