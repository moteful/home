'use strict';
/* 贪吃蛇 / Snake Run —— 游戏分区脚本（V0.8.1）
   作用域：IIFE 包裹，避免污染全局；i18n 走 window.t()，飘字/按钮文案带中文回退。 */
(function () {
  'use strict';

  /* 安全取词：i18n 未就绪时回退到中文文案 */
  const _t = (k, fb) => (typeof window !== 'undefined' && window.t ? window.t(k) : fb);

  /* 暂停/播放图标：站点图标库无 pause/play，游戏内自行内联 SVG（不污染 moteful.js） */
  const SVG_PAUSE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
  const SVG_PLAY = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>';

  /* ============================================================
     ① 配置（换素材只改这里）
     ============================================================ */
  const ART = {
    skins: { head: '', body: '', food: '' },   // 方形透明 PNG，如 'assets/s_head.png'
    colors: { head: '#c9f24b', tail: '#3f5d13', food: '#ff6f91', leaf: '#57cc99', star: '#ffd670' },
    boardBg: ['#251738', '#140c1f'],
    pageBg: '', logo: '', sfx: {},
    music: ''                                // '' 内置芯片曲 | 'off' 关闭 | URL 外部音乐
  };
  ART.img = {}; ART.ok = {};
  function loadArt() {
    ['head', 'body', 'food'].forEach(k => {
      const p = ART.skins[k]; if (!p) return;
      const im = new Image();
      im.onload = () => { ART.ok[k] = true; };
      im.onerror = () => { ART.ok[k] = false; };
      im.src = p; ART.img[k] = im;
    });
  }

  /* 形态判定：手机/触屏 = 手游壳；?web=1 可强制网页形态 */
  const SHELL = matchMedia('(max-width:860px), (pointer:coarse)').matches &&
    !location.search.includes('web=1');
  /* 手感参数：网格数与速度按平台分离（改数字即可调手感） */
  const IS_SMALL = matchMedia('(max-width:560px)').matches ||
    (matchMedia('(pointer:coarse)').matches && Math.min(screen.width, screen.innerHeight) < 560);
  const GRID_PC = 20, GRID_MO = 12;          // PC 20×20 / 手机 12×12，可独立调
  const COLS = IS_SMALL ? GRID_MO : GRID_PC, ROWS = COLS, CELL = 24;
  const BASE_MS = IS_SMALL ? 165 : 150;          // 手机初速略慢：格数少、横穿快，需补偿反应时间
  const STEP_DEC = IS_SMALL ? 6 : 7, MIN_MS = IS_SMALL ? 75 : 66;
  const FOODS_PER_LV = 5;
  const SPECIAL_EVERY = 5, SPECIAL_MS = 7000;
  const KEY = IS_SMALL ? 'snake_hi_m' : 'snake_hi'; // 平台分键存档，网格不同不互染
  /* 摇杆参数 */
  const STICK_TRAVEL = 30, STICK_DEAD = 12;

  /* ============================================================
     ② 画布
     ============================================================ */
  const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
  const W = COLS * CELL, H = ROWS * CELL;
  function fit(c, w, h) {
    const d = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * d); c.height = Math.round(h * d);
    c.style.aspectRatio = w + ' / ' + h;
    ctx.setTransform(d, 0, 0, d, 0, 0);
  }
  /* 手游壳：棋盘取可用区域的最大正方形 */
  const boardBox = document.getElementById('boardBox'), bezelEl = document.getElementById('bezel');
  function layoutBoard() {
    if (!SHELL) { bezelEl.style.width = ''; bezelEl.style.height = ''; return; }
    bezelEl.style.width = ''; bezelEl.style.height = '';
    const s = Math.max(200, Math.min(boardBox.clientWidth, boardBox.clientHeight));
    bezelEl.style.width = s + 'px'; bezelEl.style.height = s + 'px';
  }
  window.addEventListener('resize', () => { fit(cv, W, H); layoutBoard(); });
  window.addEventListener('orientationchange', () => setTimeout(() => { fit(cv, W, H); layoutBoard(); }, 80));

  /* ============================================================
     ③ 音频引擎 A（合成音效 + 原创芯片循环；外部音乐可选）
     ============================================================ */
  const AE = (function () {
    let ac = null, gSfx = null, gMus = null, noiseBuf = null;
    let sfxOn = true, musOn = true, useExt = false, extEl = null;
    let timer = null, step = 0, nextT = 0, playing = false;
    const BPM = 116, DT = 60 / BPM / 4;

    /* 原创循环：A 小调五声，64 步（4 小节），和声进行 Am–F–C–G */
    const MEL = [
      69, 0, 72, 0, 76, 0, 72, 0, 69, 0, 72, 76, 79, 0, 76, 0,
      76, 0, 74, 0, 72, 0, 69, 0, 67, 69, 72, 0, 69, 0, 0, 0,
      76, 0, 79, 0, 81, 0, 79, 0, 76, 0, 74, 72, 74, 0, 76, 0,
      72, 0, 74, 0, 76, 0, 72, 0, 69, 0, 67, 64, 69, 0, 0, 0];
    const BASS = new Array(64).fill(0);
    [45, 41, 48, 43].forEach((r, b) => { for (let k = 0; k < 4; k++) BASS[b * 16 + k * 2] = (k === 3 ? r + 7 : r); });

    function ensure() {
      if (ac) return true;
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return false;
      ac = new C();
      gSfx = ac.createGain(); gSfx.gain.value = .9; gSfx.connect(ac.destination);
      gMus = ac.createGain(); gMus.gain.value = .55; gMus.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.3, ac.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      if (typeof ART.music === 'string' && ART.music && ART.music !== 'off') {
        useExt = true; extEl = new Audio(ART.music); extEl.loop = true; extEl.volume = .6;
      }
      return true;
    }
    const m2f = m => 440 * Math.pow(2, (m - 69) / 12);
    function tone(o) {
      const t0 = (o.t != null) ? o.t : ac.currentTime;
      const os = ac.createOscillator(), g = ac.createGain();
      os.type = o.type || 'square';
      os.frequency.setValueAtTime(o.f, t0);
      if (o.slide) os.frequency.exponentialRampToValueAtTime(Math.max(1, o.slide), t0 + o.d);
      g.gain.setValueAtTime(o.v || .2, t0);
      g.gain.exponentialRampToValueAtTime(.0001, t0 + o.d);
      os.connect(g); g.connect(o.out || gSfx);
      os.start(t0); os.stop(t0 + o.d + .05);
    }
    function noise(t, d, v, fq, ftype, out) {
      const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
      const f = ac.createBiquadFilter(); f.type = ftype || 'highpass'; f.frequency.value = fq || 6000;
      const g = ac.createGain(); g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(.0001, t + d);
      s.connect(f); f.connect(g); g.connect(out || gSfx);
      s.start(t); s.stop(t + d + .05);
    }
    function sfx(n) {
      if (!sfxOn || !ensure()) return;
      if (ac.state === 'suspended') ac.resume();
      const t = ac.currentTime;
      switch (n) {
        case 'eat': tone({ f: 620, t, d: .06, v: .14 }); tone({ f: 930, t: t + .05, d: .09, v: .14 }); break;
        case 'star': [880, 1174.66, 1318.51, 1760].forEach((f, i) => tone({ f, t: t + i * .055, d: .14, v: .13 })); break;
        case 'level': [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone({ f, t: t + i * .07, d: .15, v: .14 })); break;
        case 'go': [392, 523.25, 659.25, 784].forEach((f, i) => tone({ f, t: t + i * .09, d: .16, v: .15 })); break;
        case 'spawn': tone({ f: 1046.5, t, d: .08, type: 'triangle', v: .12 }); tone({ f: 1568, t: t + .07, d: .12, type: 'triangle', v: .12 }); break;
        case 'die': tone({ f: 300, slide: 55, t, d: .5, type: 'sawtooth', v: .2 }); noise(t, .45, .2, 420, 'lowpass'); break;
        case 'pause': tone({ f: 520, slide: 360, t, d: .13, v: .12 }); break;
        case 'resume': tone({ f: 360, slide: 540, t, d: .13, v: .12 }); break;
        case 'click': tone({ f: 480, t, d: .05, type: 'triangle', v: .1 }); break;
      }
    }
    function schedStep(i, t) {
      const mi = i % 64, s = i % 16;
      const m = MEL[mi]; if (m) tone({ f: m2f(m), t, d: DT * 1.8, v: .12, out: gMus });
      const b = BASS[mi]; if (b) tone({ f: m2f(b), t, d: DT * 3.6, type: 'triangle', v: .26, out: gMus });
      if (s === 0 || s === 8) tone({ f: 150, slide: 50, t, d: .12, type: 'sine', v: .45, out: gMus });
      if (s === 4 || s === 12) noise(t, .09, .22, 1800, 'bandpass', gMus);
      if (i % 2 === 0) noise(t, .035, .045, 8000, 'highpass', gMus);
    }
    function tick() {
      if (!playing) return;
      while (nextT < ac.currentTime + 0.12) { schedStep(step, nextT); step = (step + 1) % 64; nextT += DT; }
    }
    function startMusic() {
      if (!musOn || ART.music === 'off') return; if (!ensure()) return;
      if (ac.state === 'suspended') ac.resume();
      if (useExt) { extEl.currentTime = 0; extEl.play().catch(() => { }); return; }
      if (timer) return;
      step = 0; nextT = ac.currentTime + .08; playing = true; timer = setInterval(tick, 40);
    }
    function pauseMusic() {
      if (useExt) { if (extEl) extEl.pause(); return; }
      playing = false; if (timer) { clearInterval(timer); timer = null; }
    }
    function resumeMusic() {
      if (!musOn || ART.music === 'off') return;
      if (useExt) { if (extEl) extEl.play().catch(() => { }); return; }
      if (timer) return; if (!ensure()) return;
      if (ac.state === 'suspended') ac.resume();
      playing = true; nextT = ac.currentTime + .08; timer = setInterval(tick, 40);   // 断点续播
    }
    function setSfx(b) { sfxOn = b; }
    function setMus(b) {
      musOn = b;
      if (!b) pauseMusic();
      else if (typeof state !== 'undefined' && state === 'playing') resumeMusic();
    }
    return { sfx, startMusic, pauseMusic, resumeMusic, setSfx, setMus, ensure };
  })();

  /* ============================================================
     ④ 定义（工具 / 方向 / 绑定 / 特效）
     ============================================================ */
  const $ = id => document.getElementById(id);
  const U = { x: 0, y: -1 }, D = { x: 0, y: 1 }, L = { x: -1, y: 0 }, R = { x: 1, y: 0 };

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
  function mix(a, b, t) {
    const pa = hex(a), pb = hex(b);
    return 'rgb(' + Math.round(pa[0] + (pb[0] - pa[0]) * t) + ',' + Math.round(pa[1] + (pb[1] - pa[1]) * t) + ',' + Math.round(pa[2] + (pb[2] - pa[2]) * t) + ')';
  }
  function fmt(ms) { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
  function starPath(cx, cy, Rr, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rad = (i % 2) ? r : Rr;
      const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  }
  function setVal(el, v, bump) {
    const s = String(v);
    if (el.textContent === s) return;
    el.textContent = s;
    if (bump !== false) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  }
  function setAll(attr, v, bump) {
    document.querySelectorAll('[data-hud="' + attr + '"]').forEach(el => setVal(el, v, bump));
  }
  function pop(txt, cx, cy, cls) {
    const d = document.createElement('div');
    d.className = 'sn-pop' + (cls ? ' ' + cls : '');
    d.textContent = txt;
    d.style.left = ((cx + 0.5) / COLS * 100) + '%';
    d.style.top = ((cy + 0.5) / ROWS * 100) + '%';
    popLayer.appendChild(d);
    setTimeout(() => d.remove(), 900);
  }
  const parts = [];
  function burst(x, y, color, n) {
    for (let i = 0; i < (n || 12); i++) {
      parts.push({
        x: (x + .5) * CELL, y: (y + .5) * CELL,
        vx: (Math.random() - .5) * 230, vy: (Math.random() - .5) * 230 - 40, g: 320,
        t: 0, life: .45 + Math.random() * .3, c: color, s: 2 + Math.random() * 3
      });
    }
  }
  function bindTap(el, fn) {
    el.addEventListener('pointerdown', e => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (_) { } fn(); });
    el.addEventListener('contextmenu', e => e.preventDefault());
  }
  function bindHold(el, fn, ms) {
    let t = null;
    el.addEventListener('pointerdown', e => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (_) { } fn(); t = setInterval(fn, ms || 200); });
    const stop = () => { if (t) { clearInterval(t); t = null; } };
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
    el.addEventListener('lostpointercapture', stop);
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  /* ============================================================
     ⑤ 状态
     ============================================================ */
  let state = 'idle';                 // idle | playing | paused | over
  let snake = [], dir = R, queue = [], grow = 0;
  let food = null, special = null, sinceSpecial = 0;
  let score = 0, foods = 0, level = 1, stepMs = BASE_MS, tAcc = 0, playMs = 0, flashT = 0;
  let gridOn = true, wrapOn = false, isNewBest = false;
  let hi = 0;

  const popLayer = $('popLayer'), bezel = $('bezel');
  const ovStart = $('ovStart'), ovPause = $('ovPause'), ovOver = $('ovOver');

  /* ============================================================
     ⑥ 逻辑
     ============================================================ */
  function loadHi() { try { return parseInt(localStorage.getItem(KEY) || '0', 10) || 0; } catch (e) { return 0; } }
  function saveHi(v) { try { localStorage.setItem(KEY, String(v)); } catch (e) { } }

  function resetGame() {
    const cx = (COLS / 2) | 0, cy = (ROWS / 2) | 0;
    snake = [{ x: cx, y: cy }, { x: cx - 1, y: cy }, { x: cx - 2, y: cy }];
    dir = R; queue = []; grow = 0;
    score = 0; foods = 0; level = 1; stepMs = BASE_MS; tAcc = 0; playMs = 0;
    sinceSpecial = 0; special = null; flashT = 0; parts.length = 0;
    food = { x: cx + 5, y: cy };
    updateHUD(false);
  }
  function freeCell() {
    const occ = new Set(snake.map(s => s.x + ',' + s.y));
    if (food) occ.add(food.x + ',' + food.y);
    if (special) occ.add(special.x + ',' + special.y);
    let x = 0, y = 0, tries = 0;
    do { x = (Math.random() * COLS) | 0; y = (Math.random() * ROWS) | 0; tries++; }
    while (occ.has(x + ',' + y) && tries < 500);
    if (occ.has(x + ',' + y)) {
      for (let i = 0; i < COLS * ROWS; i++) {
        const xx = i % COLS, yy = (i / COLS) | 0;
        if (!occ.has(xx + ',' + yy)) return { x: xx, y: yy };
      }
      return null;
    }
    return { x, y };
  }
  function spawnFood() { const c = freeCell(); if (c) food = c; }
  function spawnSpecial() {
    const c = freeCell(); if (!c) return;
    special = { x: c.x, y: c.y, tLeft: SPECIAL_MS };
    pop(_t('sn_pop_star', '★ 限时星果!'), c.x, c.y, 'big');
    AE.sfx('spawn');
  }
  function queueDir(d) {
    const last = queue.length ? queue[queue.length - 1] : dir;
    if (d.x === last.x && d.y === last.y) return;        // 同向忽略
    if (d.x === -last.x && d.y === -last.y) return;      // 禁 180° 反向
    if (queue.length < 3) queue.push(d);
  }
  function bezelGlow() { bezel.classList.remove('glow'); void bezel.offsetWidth; bezel.classList.add('glow'); }

  function step() {
    if (queue.length) dir = queue.shift();
    const h = snake[0];
    let nx = h.x + dir.x, ny = h.y + dir.y;
    if (wrapOn) { nx = (nx + COLS) % COLS; ny = (ny + ROWS) % ROWS; }
    else if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return die();

    const ateF = (nx === food.x && ny === food.y);
    const ateS = !!special && nx === special.x && ny === special.y;
    const tailFrees = (grow === 0 && !ateF && !ateS);
    const lim = tailFrees ? snake.length - 1 : snake.length;
    for (let i = 0; i < lim; i++) { if (snake[i].x === nx && snake[i].y === ny) return die(); }

    snake.unshift({ x: nx, y: ny });
    if (ateF) {
      const pts = 10 + (level - 1) * 2;
      score += pts; grow += 1; foods++; sinceSpecial++;
      pop('+' + pts, nx, ny); burst(nx, ny, ART.colors.food, 12); AE.sfx('eat');
      const nl = 1 + Math.floor(foods / FOODS_PER_LV);
      if (nl > level) {
        level = nl; stepMs = Math.max(MIN_MS, BASE_MS - (level - 1) * STEP_DEC);
        pop(_t('sn_pop_lvup', 'LV.{n} 提速!').replace('{n}', level), nx, ny, 'big');
        bezelGlow(); AE.sfx('level');
      }
      if (!special && sinceSpecial >= SPECIAL_EVERY) { spawnSpecial(); sinceSpecial = 0; }
      spawnFood();
    } else if (ateS) {
      const pts = 50 + (level - 1) * 5;
      score += pts; grow += 2; special = null;
      pop('+' + pts + ' ★', nx, ny, 'big'); burst(nx, ny, ART.colors.star, 20);
      bezelGlow(); AE.sfx('star');
    }
    if (grow > 0) grow--; else snake.pop();
    updateHUD();
  }

  function closeSheet() { document.body.classList.remove('sn-sheet-open'); $('scrim').hidden = true; }
  function startGame() {
    resetGame(); state = 'playing'; hideOv(); refreshBtn(); closeSheet(); document.body.classList.add('sn-playing'); showStick();
    AE.startMusic(); AE.sfx('go');
  }
  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused'; showOv(ovPause); refreshBtn(); document.body.classList.remove('sn-playing'); hideStick();
    AE.pauseMusic(); AE.sfx('pause');
  }
  function resumeGame() {
    if (state !== 'paused') return;
    state = 'playing'; hideOv(); refreshBtn(); document.body.classList.add('sn-playing'); showStick();
    AE.resumeMusic(); AE.sfx('resume');
  }
  function die() {
    if (state !== 'playing') return;
    state = 'over'; document.body.classList.remove('sn-playing'); hideStick();
    AE.pauseMusic(); AE.sfx('die');
    try { if (navigator.vibrate) navigator.vibrate(120); } catch (_) { }   // 移动端震感
    bezel.classList.remove('glow'); void bezel.offsetWidth; bezel.classList.add('shake');
    setTimeout(() => bezel.classList.remove('shake'), 420);
    flashT = 450;
    isNewBest = score > hi;
    if (isNewBest) { hi = score; saveHi(hi); }
    setAll('hi', hi); refreshBtn();
    setTimeout(showOver, 420);
  }
  function showOver() {
    $('fScore').textContent = score; $('fHi').textContent = hi;
    $('fLen').textContent = snake.length; $('fFood').textContent = foods;
    $('fTime').textContent = fmt(playMs);
    $('ovBadge').classList.toggle('sn-hidden', !isNewBest);
    showOv(ovOver);
  }
  function act() {
    if (state === 'idle' || state === 'over') startGame();
    else if (state === 'playing') pauseGame();
    else resumeGame();
  }

  function update(dt) {
    if (flashT > 0) flashT -= dt;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.t += dt / 1000;
      if (p.t >= p.life) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; p.vy += p.g * dt / 1000;
    }
    if (state !== 'playing') return;
    playMs += dt;
    if (special) {
      special.tLeft -= dt;
      if (special.tLeft <= 0) {
        pop(_t('sn_pop_stargone', '★ 溜走了'), special.x, special.y, 'combo');
        burst(special.x, special.y, ART.colors.star, 8);
        special = null;
      }
    }
    tAcc += dt;
    let guard = 0;
    while (tAcc >= stepMs && state === 'playing' && guard++ < 4) { tAcc -= stepMs; step(); }
  }

  /* ============================================================
     ⑦ 绘制（全部按 CELL 比例，缩放后依然粗壮可读）
     ============================================================ */
  function draw(t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, ART.boardBg[0]); g.addColorStop(1, ART.boardBg[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(255,255,255,.016)';
    for (let y = 0; y < ROWS; y++) for (let x = (y & 1); x < COLS; x += 2) ctx.fillRect(x * CELL, y * CELL, CELL, CELL);

    if (gridOn) {
      ctx.strokeStyle = 'rgba(243,238,251,.05)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 1; i < COLS; i++) { ctx.moveTo(i * CELL + .5, 0); ctx.lineTo(i * CELL + .5, H); }
      for (let j = 1; j < ROWS; j++) { ctx.moveTo(0, j * CELL + .5); ctx.lineTo(W, j * CELL + .5); }
      ctx.stroke();
    }
    drawFood(t);
    if (special) drawStar(t);
    drawSnake(t);
    for (const p of parts) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.c; ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    if (flashT > 0) { ctx.fillStyle = 'rgba(255,80,110,' + (flashT / 450 * .32) + ')'; ctx.fillRect(0, 0, W, H); }
  }
  function drawFood(t) {
    const cx = (food.x + .5) * CELL, cy = (food.y + .5) * CELL;
    const pu = 1 + Math.sin(t / 170) * .08;
    if (ART.ok.food) { const s = (CELL - 2) * pu; ctx.drawImage(ART.img.food, cx - s / 2, cy - s / 2, s, s); return; }
    ctx.save();
    ctx.shadowColor = 'rgba(255,111,145,.8)'; ctx.shadowBlur = CELL * 0.45;
    ctx.fillStyle = ART.colors.food;
    ctx.beginPath(); ctx.arc(cx, cy + CELL * 0.04, CELL * 0.36 * pu, 0, 7); ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.beginPath(); ctx.arc(cx - CELL * 0.11, cy - CELL * 0.07, CELL * 0.10, 0, 7); ctx.fill();
    ctx.fillStyle = ART.colors.leaf;
    ctx.beginPath(); ctx.ellipse(cx + CELL * 0.13, cy - CELL * 0.36 * pu, CELL * 0.14, CELL * 0.08, -.6, 0, 7); ctx.fill();
  }
  function drawStar(t) {
    const cx = (special.x + .5) * CELL, cy = (special.y + .5) * CELL;
    const frac = Math.max(0, special.tLeft / SPECIAL_MS);
    const blink = special.tLeft < 2000 ? (.4 + .6 * Math.abs(Math.sin(t / 95))) : 1;
    ctx.save();
    ctx.globalAlpha = blink;
    ctx.translate(cx, cy); ctx.rotate(t / 850);
    ctx.shadowColor = 'rgba(255,214,112,.9)'; ctx.shadowBlur = CELL * 0.5;
    ctx.fillStyle = ART.colors.star;
    starPath(0, 0, CELL * 0.42, CELL * 0.19); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = .9; ctx.strokeStyle = ART.colors.star; ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, CELL * 0.62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.stroke();
    ctx.restore();
  }
  function drawSnake(t) {
    const L = snake.length;
    for (let i = L - 1; i >= 0; i--) {
      const s = snake[i];
      const f = L > 1 ? i / (L - 1) : 0;
      const col = mix(ART.colors.head, ART.colors.tail, f * .92);
      if (i < L - 1) {                                  /* 体节连接桥 */
        const n = snake[i + 1];
        if (Math.abs(s.x - n.x) <= 1 && Math.abs(s.y - n.y) <= 1) {
          ctx.fillStyle = col;
          if (s.x !== n.x) ctx.fillRect(Math.min(s.x, n.x) * CELL + CELL / 2, s.y * CELL + CELL * 0.19, CELL, CELL * 0.62);
          else ctx.fillRect(s.x * CELL + CELL * 0.19, Math.min(s.y, n.y) * CELL + CELL / 2, CELL * 0.62, CELL);
        }
      }
      if (i === 0) {
        if (ART.ok.head) ctx.drawImage(ART.img.head, s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2);
        else {
          ctx.fillStyle = col;
          rr(s.x * CELL + CELL * 0.08, s.y * CELL + CELL * 0.08, CELL * 0.84, CELL * 0.84, CELL * 0.30); ctx.fill();
          eyes(s);
        }
      } else {
        if (ART.ok.body) ctx.drawImage(ART.img.body, s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2);
        else { ctx.fillStyle = col; rr(s.x * CELL + CELL * 0.12, s.y * CELL + CELL * 0.12, CELL * 0.76, CELL * 0.76, CELL * 0.26); ctx.fill(); }
      }
    }
  }
  function eyes(h) {
    const cx = (h.x + .5) * CELL, cy = (h.y + .5) * CELL;
    const px = -dir.y, py = dir.x;
    for (const sd of [1, -1]) {
      const ex = cx + dir.x * CELL * 0.16 + px * CELL * 0.19 * sd, ey = cy + dir.y * CELL * 0.16 + py * CELL * 0.19 * sd;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, ey, CELL * 0.115, 0, 7); ctx.fill();
      ctx.fillStyle = '#17102a'; ctx.beginPath(); ctx.arc(ex + dir.x * CELL * 0.05, ey + dir.y * CELL * 0.05, CELL * 0.06, 0, 7); ctx.fill();
    }
  }

  /* ============================================================
     ⑧ HUD（桌面侧栏 + 移动顶栏共用 data-hud 同步）
     ============================================================ */
  function updateHUD(bump) {
    setAll('score', score, bump); setAll('len', snake.length, bump);
    setAll('lvl', level, bump); setAll('food', foods, bump);
    setAll('hi', hi, bump);
  }
  function showOv(el) { [ovStart, ovPause, ovOver].forEach(o => o.classList.toggle('sn-hidden', o !== el)); }
  function hideOv() { [ovStart, ovPause, ovOver].forEach(o => o.classList.add('sn-hidden')); }
  function refreshBtn() {
    $('btnMain').textContent =
      state === 'playing' ? _t('sn_btn_pause', '暂停') :
      state === 'paused' ? _t('sn_btn_resume', '继续') :
      state === 'over' ? _t('sn_btn_again', '再来一局') : _t('sn_btn_start', '开始游戏');
    const isPlaying = state === 'playing';
    const ic = isPlaying ? SVG_PAUSE : SVG_PLAY;
    $('btnPauseM').innerHTML = ic;
    $('btnPauseR').innerHTML = ic;
    const tpC = $('tpC'); if (tpC) tpC.innerHTML = ic;
    const aria = isPlaying ? _t('sn_btn_pause', '暂停') : _t('sn_btn_resume', '继续');
    $('btnPauseM').setAttribute('aria-label', aria);
    $('btnPauseR').setAttribute('aria-label', aria);
    if (tpC) tpC.setAttribute('aria-label', aria);
  }
  function wireTgl(el, init, fn) {
    let on = init;
    el.addEventListener('click', e => {
      on = !on; el.className = 'sn-tgl ' + (on ? 'on' : 'off');
      fn(on); AE.sfx('click'); e.currentTarget.blur();
    });
  }

  /* ============================================================
     ⑨ 输入
     ============================================================ */
  const KEYD = { ArrowUp: U, KeyW: U, ArrowDown: D, KeyS: D, ArrowLeft: L, KeyA: L, ArrowRight: R, KeyD: R };
  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    const k = e.code;
    if (KEYD[k] || k === 'Space') e.preventDefault();
    if (KEYD[k]) { if (state === 'playing') queueDir(KEYD[k]); return; }
    if (k === 'Space' || k === 'Enter') { act(); return; }
    if (k === 'KeyP' || k === 'Escape') { if (state === 'playing') pauseGame(); else if (state === 'paused') resumeGame(); return; }
    if (k === 'KeyR') startGame();
  });
  window.addEventListener('blur', () => { if (state === 'playing') pauseGame(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') pauseGame(); });

  /* 画布滑动（与摇杆并存） */
  let swId = null, sx = 0, sy = 0;
  cv.addEventListener('pointerdown', e => { swId = e.pointerId; sx = e.clientX; sy = e.clientY; try { cv.setPointerCapture(e.pointerId); } catch (_) { } });
  cv.addEventListener('pointermove', e => {
    if (swId !== e.pointerId || state !== 'playing') return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
    queueDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? R : L) : (dy > 0 ? D : U));
    sx = e.clientX; sy = e.clientY;                     /* 一次触摸可连续变向 */
  });
  ['pointerup', 'pointercancel'].forEach(ev => cv.addEventListener(ev, () => { swId = null; }));
  cv.addEventListener('contextmenu', e => e.preventDefault());

  /* 虚拟摇杆：数字四向（死区 + 象限吸附），输出进同一输入缓冲队列 */
  const screenWrap = $('screenWrap'), stickEl = $('stick'), knobEl = $('stickKnob'), stickLayer = $('stickLayer');
  let sId = null, sCx = 0, sCy = 0, sDir = null;
  function knobTo(dx, dy) {
    const len = Math.hypot(dx, dy) || 1, cl = Math.min(len, STICK_TRAVEL);
    knobEl.style.transform = 'translate(' + (dx / len * cl) + 'px,' + (dy / len * cl) + 'px)';
  }
  function stickMove(e) {
    if (e.pointerId !== sId) return;
    const dx = e.clientX - sCx, dy = e.clientY - sCy;
    knobTo(dx, dy);
    if (Math.hypot(dx, dy) < STICK_DEAD) return;        // 死区：不回弹误触
    const d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? R : L) : (dy > 0 ? D : U);
    if (!sDir || d.x !== sDir.x || d.y !== sDir.y) { sDir = d; if (state === 'playing') queueDir(d); }
  }
  // 虚拟摇杆：游戏进行中默认常显；手指按屏幕任意处即在该点重新生成并跟随，松开保持可见
  function stickVisible() {
    return state === 'playing' && !document.body.classList.contains('sn-ctl-pad')
      && window.matchMedia('(max-width:860px),(pointer:coarse)').matches;
  }
  function showStick() {
    if (!stickVisible()) { stickEl.classList.remove('on'); return; }
    if (!stickEl.classList.contains('on')) {
      const r = screenWrap.getBoundingClientRect(); // 默认落在游戏区左下角，之后跟随手指
      sCx = r.left + 80; sCy = r.bottom - 90;
      stickEl.style.left = sCx + 'px'; stickEl.style.top = sCy + 'px';
      stickEl.classList.add('on');
    }
  }
  function hideStick() { stickEl.classList.remove('on'); }
  stickLayer.addEventListener('pointerdown', e => {
    if (state !== 'playing') return;
    e.preventDefault(); sId = e.pointerId;
    try { stickLayer.setPointerCapture(e.pointerId); } catch (_) { }
    sCx = e.clientX; sCy = e.clientY;                    // 按下点 = 摇杆中心（跟手，重新生成）
    stickEl.style.left = sCx + 'px'; stickEl.style.top = sCy + 'px';
    stickEl.classList.add('on'); knobEl.style.transform = ''; sDir = null;
    stickMove(e);
  });
  stickLayer.addEventListener('pointermove', stickMove);
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev =>
    stickLayer.addEventListener(ev, () => { sId = null; sDir = null; knobEl.style.transform = ''; /* 松开保持可见，不消失 */ }));
  stickLayer.addEventListener('contextmenu', e => e.preventDefault());

  /* 按钮与开关 */
  $('btnMain').addEventListener('click', e => { act(); e.currentTarget.blur(); });
  $('btnRestart').addEventListener('click', e => { AE.sfx('click'); startGame(); e.currentTarget.blur(); });
  $('btnPauseM').addEventListener('click', e => { act(); e.currentTarget.blur(); });
  $('btnPauseR').addEventListener('click', e => { act(); e.currentTarget.blur(); });
  $('btnGear').addEventListener('click', e => {
    if (state === 'playing') pauseGame();              // 手游惯例：开设置即暂停
    const open = !document.body.classList.contains('sn-sheet-open');
    document.body.classList.toggle('sn-sheet-open', open);
    $('scrim').hidden = !open;
    e.currentTarget.blur();
  });
  $('scrim').addEventListener('click', closeSheet);
  ovStart.addEventListener('click', () => { if (state === 'idle') startGame(); });
  ovPause.addEventListener('click', () => { if (state === 'paused') resumeGame(); });
  ovOver.addEventListener('click', () => { if (state === 'over') startGame(); });

  wireTgl($('tSfx'), true, v => AE.setSfx(v));
  wireTgl($('tMus'), true, v => AE.setMus(v));
  wireTgl($('tGrid'), true, v => { gridOn = v; });
  wireTgl($('tWrap'), false, v => { wrapOn = v; });
  if (ART.music === 'off') $('rowMus').classList.add('sn-hidden');

  /* 摇杆/十字键切换（存档记忆） */
  let ctlPad = false;
  try { ctlPad = localStorage.getItem('snake_ctl') === 'pad'; } catch (e) { }
  if (ctlPad) document.body.classList.add('sn-ctl-pad');
  wireTgl($('tStick'), !ctlPad, v => {
    document.body.classList.toggle('sn-ctl-pad', !v); showStick();
    try { localStorage.setItem('snake_ctl', v ? 'stick' : 'pad'); } catch (e) { }
    layoutBoard();                                  // 操作区高度变化，重算棋盘
  });

  /* 触屏十字键（备选操作） */
  bindHold($('tpU'), () => { if (state === 'playing') queueDir(U); });
  bindHold($('tpD'), () => { if (state === 'playing') queueDir(D); });
  bindHold($('tpL'), () => { if (state === 'playing') queueDir(L); });
  bindHold($('tpR'), () => { if (state === 'playing') queueDir(R); });
  bindTap($('tpC'), () => act());

  /* ============================================================
     ⑩ 启动
     ============================================================ */
  const LIGHTS = ['#48cae4', '#ffd670', '#57cc99', '#ff6f91', '#9d7bff', '#ff9e40', '#e9e9f2'];
  (function deco() {
    const lights = $('lights');
    if (lights) lights.innerHTML = LIGHTS.concat(LIGHTS)
      .map((c, i) => '<span class="dot" style="background:' + c + ';box-shadow:0 0 8px ' + c + ';animation-delay:' + (i % 7) * 0.18 + 's"></span>').join('');
    const sky = $('sky');
    for (let i = 0; i < 18; i++) {
      const d = document.createElement('div'); d.className = 'sn-fp';
      const s = 6 + Math.random() * 10;
      d.style.width = d.style.height = s + 'px';
      d.style.left = Math.random() * 100 + 'vw';
      d.style.background = LIGHTS[i % 7];
      d.style.opacity = .14 + Math.random() * .2;
      d.style.animationDuration = (14 + Math.random() * 18) + 's';
      d.style.animationDelay = (-Math.random() * 20) + 's';
      sky.appendChild(d);
    }
  })();

  loadArt();
  hi = loadHi();
  resetGame();
  refreshBtn();
  layoutBoard();
  fit(cv, W, H);

  let last = performance.now();
  function loop(ts) {
    requestAnimationFrame(loop);
    const dt = Math.min(50, ts - last || 16); last = ts;
    update(dt); draw(ts);
  }
  requestAnimationFrame(loop);
})();
