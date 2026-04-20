/**
 * 大话骰 - 音效模块
 * 使用 Web Audio API 合成音效，无需外部音频文件
 */
(function () {
  'use strict';

  let ctx = null;
  let enabled = localStorage.getItem('liars_dice_sound') !== 'off';

  /** 懒加载 AudioContext（需要用户交互后才能创建） */
  function getCtx() {
    if (!ctx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      } catch (e) {
        return null;
      }
    }
    // iOS Safari 需要 resume
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  /** 播放一个基础音调 */
  function beep({ freq = 440, duration = 0.15, type = 'sine', volume = 0.3, freqEnd = null, delay = 0 }) {
    if (!enabled) return;
    const c = getCtx();
    if (!c) return;

    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const gain = c.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t0 + duration);
    }

    // ADSR 简化：快速起音 + 指数衰减
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  /** 播放白噪声（用于骰子碰撞、沙沙声） */
  function noise({ duration = 0.3, volume = 0.2, filterFreq = 2000, delay = 0 }) {
    if (!enabled) return;
    const c = getCtx();
    if (!c) return;

    const t0 = c.currentTime + delay;
    const bufSize = c.sampleRate * duration;
    const buf = c.createBuffer(1, bufSize, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const src = c.createBufferSource();
    src.buffer = buf;

    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;

    const gain = c.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(c.destination);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  // =============== 具体音效 ===============

  /** 摇骰子：连续的骰子碰撞沙沙声 */
  function playShake() {
    // 用多段带调制的噪声模拟骰子在杯里翻滚
    noise({ duration: 0.15, volume: 0.18, filterFreq: 1500, delay: 0 });
    noise({ duration: 0.12, volume: 0.15, filterFreq: 2500, delay: 0.18 });
    noise({ duration: 0.18, volume: 0.2, filterFreq: 1800, delay: 0.38 });
    noise({ duration: 0.14, volume: 0.17, filterFreq: 2200, delay: 0.62 });
    noise({ duration: 0.2, volume: 0.22, filterFreq: 1600, delay: 0.85 });
    noise({ duration: 0.15, volume: 0.16, filterFreq: 2400, delay: 1.12 });
    // 最后一记 "啪" 落桌
    beep({ freq: 180, freqEnd: 60, duration: 0.12, type: 'triangle', volume: 0.3, delay: 1.35 });
  }

  /** 骰子揭示：清脆的 "叮" */
  function playDiceReveal() {
    beep({ freq: 1200, duration: 0.08, type: 'sine', volume: 0.2 });
    beep({ freq: 1600, duration: 0.08, type: 'sine', volume: 0.15, delay: 0.05 });
  }

  /** 叫数：短促 "tick" */
  function playBid() {
    beep({ freq: 600, freqEnd: 400, duration: 0.08, type: 'square', volume: 0.15 });
  }

  /** 劈骰：低音 boom + 上行警报 */
  function playChallenge() {
    beep({ freq: 80, freqEnd: 200, duration: 0.2, type: 'sawtooth', volume: 0.3 });
    beep({ freq: 400, freqEnd: 800, duration: 0.25, type: 'square', volume: 0.2, delay: 0.15 });
  }

  /** 反劈：双 boom */
  function playCounter() {
    beep({ freq: 100, freqEnd: 300, duration: 0.15, type: 'sawtooth', volume: 0.3 });
    beep({ freq: 100, freqEnd: 400, duration: 0.2, type: 'sawtooth', volume: 0.35, delay: 0.18 });
    beep({ freq: 600, freqEnd: 1000, duration: 0.2, type: 'square', volume: 0.2, delay: 0.4 });
  }

  /** 开骰：下行扫频 "嗖——" */
  function playOpen() {
    beep({ freq: 800, freqEnd: 150, duration: 0.35, type: 'triangle', volume: 0.3 });
    noise({ duration: 0.3, volume: 0.12, filterFreq: 1000, delay: 0.05 });
  }

  /** 胜利：上行三音 */
  function playWin() {
    beep({ freq: 523, duration: 0.12, type: 'triangle', volume: 0.25 });          // C5
    beep({ freq: 659, duration: 0.12, type: 'triangle', volume: 0.25, delay: 0.12 }); // E5
    beep({ freq: 784, duration: 0.25, type: 'triangle', volume: 0.3, delay: 0.24 });  // G5
  }

  /** 失败：下行三音 */
  function playLose() {
    beep({ freq: 494, duration: 0.15, type: 'sine', volume: 0.25 });           // B4
    beep({ freq: 392, duration: 0.15, type: 'sine', volume: 0.25, delay: 0.15 }); // G4
    beep({ freq: 262, duration: 0.35, type: 'sine', volume: 0.3, delay: 0.3 });   // C4
  }

  /** 认输：叹气下行 */
  function playSurrender() {
    beep({ freq: 400, freqEnd: 150, duration: 0.4, type: 'triangle', volume: 0.25 });
  }

  /** 按钮点击反馈 */
  function playClick() {
    beep({ freq: 800, duration: 0.04, type: 'square', volume: 0.1 });
  }

  /** Air Horn - DJ 喊麦气笛音效（劈骰/反劈专用） */
  function playAirHorn() {
    // 三段气笛：一段长 + 两段短
    beep({ freq: 320, freqEnd: 280, duration: 0.35, type: 'sawtooth', volume: 0.22 });
    beep({ freq: 480, freqEnd: 440, duration: 0.35, type: 'square', volume: 0.18 });
    beep({ freq: 640, freqEnd: 600, duration: 0.35, type: 'sawtooth', volume: 0.12 });
    // 短 stab
    beep({ freq: 320, freqEnd: 280, duration: 0.12, type: 'sawtooth', volume: 0.2, delay: 0.45 });
    beep({ freq: 480, freqEnd: 440, duration: 0.12, type: 'square', volume: 0.16, delay: 0.45 });
    beep({ freq: 320, freqEnd: 280, duration: 0.12, type: 'sawtooth', volume: 0.2, delay: 0.62 });
    beep({ freq: 480, freqEnd: 440, duration: 0.12, type: 'square', volume: 0.16, delay: 0.62 });
  }

  /** 欢呼 - 鼓掌 + "哦耶" 感（赢下回合触发） */
  function playCheer() {
    // 白噪声模拟掌声
    noise({ duration: 0.6, volume: 0.14, filterFreq: 3000, delay: 0 });
    noise({ duration: 0.5, volume: 0.12, filterFreq: 3500, delay: 0.15 });
    // 叠加一个上行三连音（类似 "woo-hoo"）
    beep({ freq: 523, duration: 0.1, type: 'triangle', volume: 0.22, delay: 0.1 });
    beep({ freq: 659, duration: 0.1, type: 'triangle', volume: 0.22, delay: 0.22 });
    beep({ freq: 880, duration: 0.22, type: 'triangle', volume: 0.28, delay: 0.35 });
  }

  /** 哀嚎 - 下行哀怨（输下回合触发，和 lose 叠加） */
  function playGroan() {
    beep({ freq: 380, freqEnd: 120, duration: 0.7, type: 'sawtooth', volume: 0.22 });
    beep({ freq: 250, freqEnd: 80, duration: 0.55, type: 'triangle', volume: 0.18, delay: 0.15 });
  }

  /** 中大奖 - 豹子 / 纯豹 */
  function playJackpot() {
    // 上行琶音 + 铃铛感
    const notes = [523, 659, 784, 1047, 1319]; // C5 E5 G5 C6 E6
    notes.forEach((f, i) => {
      beep({ freq: f, duration: 0.12, type: 'triangle', volume: 0.24, delay: i * 0.07 });
    });
    // 最后一记高音 + 泛音
    beep({ freq: 1568, duration: 0.4, type: 'sine', volume: 0.3, delay: 0.38 });
    beep({ freq: 3136, duration: 0.3, type: 'sine', volume: 0.12, delay: 0.4 });
  }

  /** 单骰 - 失望"鸭鸭鸭"音 */
  function playSingle() {
    beep({ freq: 300, freqEnd: 200, duration: 0.18, type: 'square', volume: 0.2 });
    beep({ freq: 280, freqEnd: 180, duration: 0.18, type: 'square', volume: 0.2, delay: 0.18 });
    beep({ freq: 250, freqEnd: 150, duration: 0.25, type: 'square', volume: 0.2, delay: 0.36 });
  }

  /** 心跳 - 倒计时最后 5 秒循环调用 */
  function playHeartbeat() {
    beep({ freq: 60, duration: 0.08, type: 'sine', volume: 0.35 });
    beep({ freq: 50, duration: 0.12, type: 'sine', volume: 0.3, delay: 0.12 });
  }

  /** 入场欢呼 - 房间满员 / 开局 */
  function playGameStart() {
    beep({ freq: 392, duration: 0.15, type: 'triangle', volume: 0.25 });
    beep({ freq: 523, duration: 0.15, type: 'triangle', volume: 0.25, delay: 0.12 });
    beep({ freq: 659, duration: 0.2, type: 'triangle', volume: 0.28, delay: 0.24 });
    beep({ freq: 784, duration: 0.3, type: 'triangle', volume: 0.32, delay: 0.38 });
  }

  // =============== 公共接口 ===============

  window.Sound = {
    shake: playShake,
    reveal: playDiceReveal,
    bid: playBid,
    challenge: playChallenge,
    counter: playCounter,
    open: playOpen,
    win: playWin,
    lose: playLose,
    surrender: playSurrender,
    click: playClick,
    airhorn: playAirHorn,
    cheer: playCheer,
    groan: playGroan,
    jackpot: playJackpot,
    single: playSingle,
    heartbeat: playHeartbeat,
    gameStart: playGameStart,

    /** 切换开关 */
    toggle() {
      enabled = !enabled;
      localStorage.setItem('liars_dice_sound', enabled ? 'on' : 'off');
      return enabled;
    },

    isEnabled() {
      return enabled;
    },

    /** 首次用户交互时调用一次，确保 AudioContext 激活（iOS 需要） */
    unlock() {
      getCtx();
    }
  };
})();
