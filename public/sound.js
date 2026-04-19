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
