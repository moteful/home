/* 数独 / Sudoku —— 游戏逻辑（V0.8.2）
   抽取自源文件，整体包 IIFE；文案统一走 t(key)（window.t 由 i18n.js 提供，支持 {name} 占位）；
   配色变量前缀 su-；覆盖层类统一 su-overlay。画布 / 音频 / 生成算法 / 输入逻辑保持原样。 */
(function(){
'use strict';

/* ①配置 */
const ART = { colors: { panel: '#2b1c40', line: '#45336a', accent: '#c9f24b', text: '#f3eefb', dim: '#a99ac6', conflict: '#ff6f91' }, boardBg: '#170e24' };
const DIFFS = { easy: { clues: 44, key: 'su_diff_easy' }, med: { clues: 36, key: 'su_diff_med' }, hard: { clues: 28, key: 'su_diff_hard' } };
const MAX_LEVELS = 10;
const MAX_HINTS = 3;
const fontDisplay = getComputedStyle(document.documentElement).getPropertyValue('--su-font-display').trim() || 'ui-monospace, monospace';

/* ②画布 */
const cv = document.getElementById('board');
const ctx = cv.getContext('2d');
let cellSize = 40;
function fit() {
    const box = document.getElementById('board-box');
    const rect = box.getBoundingClientRect();
    const size = Math.min(rect.width - 24, rect.height - 24);
    if (size <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = size * dpr; cv.height = size * dpr;
    cv.style.width = size + 'px'; cv.style.height = size + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); cellSize = size / 9; drawBoard();
}
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', () => setTimeout(fit, 100));

/* ③音频 */
let audioCtx, musicGain, sfxGain, musicTimer;
const MELODY = [
    220.00, 261.63, 329.63, 392.00, 440.00,
    174.61, 220.00, 261.63, 329.63, 349.23,
    130.81, 164.81, 196.00, 246.94, 261.63,
    196.00, 246.94, 293.66, 392.00, 440.00
];
const BASS = [
    110.00, 110.00, 110.00, 110.00, 110.00,
    87.31,  87.31,  87.31,  87.31,  87.31,
    65.41,  65.41,  65.41,  65.41,  65.41,
    98.00,  98.00,  98.00,  98.00,  98.00
];
function ensureAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        musicGain = audioCtx.createGain(); musicGain.gain.value = 0.45; musicGain.connect(audioCtx.destination);
        sfxGain = audioCtx.createGain(); sfxGain.gain.value = 0.25; sfxGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
}
function playSfx(type) {
    if (!cfg.sfx || !audioCtx) return;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.connect(g); g.connect(sfxGain);
    const t = audioCtx.currentTime;
    if (type === 'tap') { osc.type = 'sine'; osc.frequency.setValueAtTime(800, t); g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.1); osc.start(t); osc.stop(t + 0.1); }
    else if (type === 'erase') { osc.type = 'triangle'; osc.frequency.setValueAtTime(400, t); osc.frequency.exponentialRampToValueAtTime(100, t + 0.15); g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15); osc.start(t); osc.stop(t + 0.15); }
    else if (type === 'error') { osc.type = 'square'; osc.frequency.setValueAtTime(150, t); g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); osc.start(t); osc.stop(t + 0.3); }
    else if (type === 'hint') { osc.type = 'sine'; osc.frequency.setValueAtTime(600, t); osc.frequency.linearRampToValueAtTime(1200, t + 0.2); g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); osc.start(t); osc.stop(t + 0.3); }
    else if (type === 'win') {
        [523, 659, 784, 1046].forEach((f, i) => {
            const o = audioCtx.createOscillator(), gg = audioCtx.createGain();
            o.connect(gg); gg.connect(sfxGain); o.type = 'sine'; o.frequency.value = f;
            gg.gain.setValueAtTime(0.15, t + i*0.15); gg.gain.exponentialRampToValueAtTime(0.001, t + i*0.15 + 0.4);
            o.start(t + i*0.15); o.stop(t + i*0.15 + 0.4);
        });
    }
}
function startMusic() {
    if (!cfg.mus || !audioCtx || musicTimer) return;
    let step = 0;
    const interval = (60 / 65) * 1000;
    musicTimer = setInterval(() => {
        const mNote = MELODY[step % 20], bNote = BASS[step % 20];
        const t = audioCtx.currentTime;
        const oscM = audioCtx.createOscillator(), gM = audioCtx.createGain();
        oscM.connect(gM); gM.connect(musicGain); oscM.type = 'sine';
        oscM.frequency.value = mNote;
        gM.gain.setValueAtTime(0.35, t); gM.gain.exponentialRampToValueAtTime(0.02, t + 0.85);
        oscM.start(t); oscM.stop(t + 0.9);
        const oscB = audioCtx.createOscillator(), gB = audioCtx.createGain();
        oscB.connect(gB); gB.connect(musicGain); oscB.type = 'triangle';
        oscB.frequency.value = bNote;
        gB.gain.setValueAtTime(0.45, t); gB.gain.exponentialRampToValueAtTime(0.05, t + 0.85);
        oscB.start(t); oscB.stop(t + 0.9);
        step++;
    }, interval);
}
function stopMusic() { clearInterval(musicTimer); musicTimer = null; }

/* ④定义 */
const BASE_BOARD = [
    [1,2,3,4,5,6,7,8,9],[4,5,6,7,8,9,1,2,3],[7,8,9,1,2,3,4,5,6],
    [2,3,1,5,6,4,8,9,7],[5,6,4,8,9,7,2,3,1],[8,9,7,2,3,1,5,6,4],
    [3,1,2,6,4,5,9,7,8],[6,4,5,9,7,8,3,1,2],[9,7,8,3,1,2,6,4,5]
];
function mulberry32(a) {
    return function() {
        var t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
function getSeed(diff, level) {
    let str = diff + "_" + level; let hash = 0;
    for(let i=0; i<str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; }
    return Math.abs(hash);
}
function shuffleBoard(base, rng) {
    let b = base.map(r => [...r]);
    let map = [0,1,2,3,4,5,6,7,8,9];
    for(let i=9; i>1; i--) { let j = 1 + Math.floor(rng() * i); [map[i], map[j]] = [map[j], map[i]]; }
    for(let i=0; i<9; i++) for(let j=0; j<9; j++) b[i][j] = map[b[i][j]];
    for(let band=0; band<3; band++) for(let i=0; i<3; i++) { let r1 = band*3 + i, r2 = band*3 + Math.floor(rng() * 3); [b[r1], b[r2]] = [b[r2], b[r1]]; }
    for(let i=0; i<3; i++) { let b1 = i, b2 = Math.floor(rng() * 3); for(let r=0; r<3; r++) [b[b1*3+r], b[b2*3+r]] = [b[b2*3+r], b[b1*3+r]]; }
    for(let band=0; band<3; band++) for(let i=0; i<3; i++) { let c1 = band*3 + i, c2 = band*3 + Math.floor(rng() * 3); for(let r=0; r<9; r++) [b[r][c1], b[r][c2]] = [b[r][c2], b[r][c1]]; }
    for(let i=0; i<3; i++) { let b1 = i, b2 = Math.floor(rng() * 3); for(let c=0; c<3; c++) for(let r=0; r<9; r++) [b[r][b1*3+c], b[r][b2*3+c]] = [b[r][b2*3+c], b[r][b1*3+c]]; }
    return b;
}
function solveCount(board, limit) {
    let minOpts = 10, r = -1, c = -1;
    for(let i=0; i<9; i++) for(let j=0; j<9; j++) if(board[i][j] === 0) {
        let opts = 0, row = board[i], col = board.map(x=>x[j]);
        let br = Math.floor(i/3)*3, bc = Math.floor(j/3)*3, box = [];
        for(let x=br; x<br+3; x++) for(let y=bc; y<bc+3; y++) box.push(board[x][y]);
        for(let num=1; num<=9; num++) if(!row.includes(num) && !col.includes(num) && !box.includes(num)) opts++;
        if(opts < minOpts) { minOpts = opts; r = i; c = j; }
    }
    if(r === -1) return 1; if(minOpts === 0) return 0;
    let count = 0, row = board[r], col = board.map(x=>x[c]);
    let br = Math.floor(r/3)*3, bc = Math.floor(c/3)*3, box = [];
    for(let x=br; x<br+3; x++) for(let y=bc; y<bc+3; y++) box.push(board[x][y]);
    for(let num=1; num<=9; num++) if(!row.includes(num) && !col.includes(num) && !box.includes(num)) {
        board[r][c] = num; count += solveCount(board, limit - count);
        if(count >= limit) { board[r][c] = 0; return count; }
    }
    board[r][c] = 0; return count;
}
function digHoles(fullBoard, clues, rng) {
    let puzzle = fullBoard.map(r => [...r]);
    let cells = []; for(let i=0; i<9; i++) for(let j=0; j<9; j++) cells.push([i,j]);
    for(let i=80; i>0; i--) { let j = Math.floor(rng() * (i+1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
    let holes = 81 - clues, dug = 0;
    for(let k=0; k<81 && dug < holes; k++) {
        let [r, c] = cells[k], temp = puzzle[r][c]; puzzle[r][c] = 0;
        let copy = puzzle.map(row => [...row]);
        if(solveCount(copy, 2) === 1) dug++; else puzzle[r][c] = temp;
    }
    return puzzle;
}

/* ⑤状态 */
let state = 'idle', diff = 'easy', currentLevel = 1, time = 0, errors = 0, hintsUsed = 0, noteMode = false;
let board = [], originalBoard = [], solution = [], notes = [], conflicts = [];
let selR = -1, selC = -1, undoStack = [];
let timerInterval;
let cfg = { sfx: true, mus: true, smartNotes: true };
try { const c = JSON.parse(localStorage.getItem('sudoku_cfg')); if(c) cfg = c; } catch(e){}
function saveCfg() { try { localStorage.setItem('sudoku_cfg', JSON.stringify(cfg)); } catch(e){} }

/* ⑥逻辑 */
function updateConflicts() {
    conflicts = Array(9).fill().map(() => Array(9).fill(false));
    for(let i=0; i<9; i++) for(let j=0; j<9; j++) {
        if(board[i][j] === 0) continue;
        let val = board[i][j];
        for(let c=0; c<9; c++) if(c !== j && board[i][c] === val) { conflicts[i][j] = true; conflicts[i][c] = true; }
        for(let r=0; r<9; r++) if(r !== i && board[r][j] === val) { conflicts[i][j] = true; conflicts[r][j] = true; }
        let br = Math.floor(i/3)*3, bc = Math.floor(j/3)*3;
        for(let r=br; r<br+3; r++) for(let c=bc; c<bc+3; c++) if((r !== i || c !== j) && board[r][c] === val) { conflicts[i][j] = true; conflicts[r][c] = true; }
    }
}
function clearRelatedNotes(r, c, val) {
    if(!cfg.smartNotes) return;
    for(let i=0; i<9; i++) { notes[r][i] &= ~(1 << (val-1)); notes[i][c] &= ~(1 << (val-1)); }
    let br = Math.floor(r/3)*3, bc = Math.floor(c/3)*3;
    for(let i=br; i<br+3; i++) for(let j=bc; j<bc+3; j++) notes[i][j] &= ~(1 << (val-1));
}
function pushUndo(r, c, oldVal, oldNotes) {
    undoStack.push({r, c, oldVal, oldNotes, newVal: board[r][c], newNotes: notes[r][c]});
}
function handleInput(val) {
    if(state !== 'playing' || selR === -1 || originalBoard[selR][selC] !== 0) return;
    let oldVal = board[selR][selC], oldNotes = notes[selR][selC];
    if(val === 0) {
        if(oldVal === 0 && oldNotes === 0) return;
        pushUndo(selR, selC, oldVal, oldNotes);
        board[selR][selC] = 0; notes[selR][selC] = 0; playSfx('erase');
    } else {
        if(noteMode) {
            if(oldVal !== 0) return;
            pushUndo(selR, selC, oldVal, oldNotes);
            notes[selR][selC] ^= (1 << (val-1)); playSfx('tap');
        } else {
            if(oldVal === val) return;
            pushUndo(selR, selC, oldVal, oldNotes);
            board[selR][selC] = val; notes[selR][selC] = 0;
            clearRelatedNotes(selR, selC, val);
            if(val !== solution[selR][selC]) { errors++; playSfx('error'); document.getElementById('board-box').classList.add('su-shake'); setTimeout(()=>document.getElementById('board-box').classList.remove('su-shake'), 300); }
            else playSfx('tap');
        }
    }
    updateConflicts(); drawBoard(); updateHUD(); checkWin();
}
function undo() {
    if(state !== 'playing' || undoStack.length === 0) return;
    let act = undoStack.pop();
    board[act.r][act.c] = act.oldVal; notes[act.r][act.c] = act.oldNotes;
    updateConflicts(); drawBoard(); updateHUD();
}
function useHint() {
    if(state !== 'playing' || selR === -1 || hintsUsed >= MAX_HINTS) return;
    let correctVal = solution[selR][selC];
    if(board[selR][selC] !== correctVal) {
        pushUndo(selR, selC, board[selR][selC], notes[selR][selC]);
        board[selR][selC] = correctVal; notes[selR][selC] = 0; hintsUsed++; playSfx('hint');
        updateConflicts(); drawBoard(); updateHUD(); checkWin();
    }
}
function checkWin() {
    for(let i=0; i<9; i++) for(let j=0; j<9; j++) if(board[i][j] !== solution[i][j]) return;
    state = 'over'; clearInterval(timerInterval); stopMusic(); playSfx('win'); updatePauseUI();
    let bestKey = `sudoku_best_${diff}`, winKey = `sudoku_win_${diff}`;
    let best = 99999; try { best = parseInt(localStorage.getItem(bestKey) || 99999); } catch(e){}
    let isRecord = time < best;
    if(isRecord) try { localStorage.setItem(bestKey, time); } catch(e){}
    try { localStorage.setItem(winKey, (parseInt(localStorage.getItem(winKey) || 0) + 1).toString()); } catch(e){}
    document.getElementById('ov-time').textContent = formatTime(time);
    document.getElementById('ov-err').textContent = errors;
    document.getElementById('ov-diff').textContent = t('su_ov_over_diff', { diff: t(DIFFS[diff].key), level: currentLevel });
    document.getElementById('ov-badge-wrap').innerHTML = isRecord ? '<div class="su-badge">' + t('su_badge_record') + '</div>' : '';
    document.getElementById('btn-next').style.display = currentLevel >= MAX_LEVELS ? 'none' : 'block';
    showOverlay('ov-over');
}
function drawBoard() {
    if (!board.length) return; // 开局前棋盘为空：跳过绘制，避免读取空数组抛错
    const size = cellSize;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = ART.boardBg; ctx.fillRect(0, 0, size*9, size*9);
    if(selR !== -1 && selC !== -1) {
        let sameVal = board[selR][selC];
        for(let i=0; i<9; i++) for(let j=0; j<9; j++) {
            if(i === selR || j === selC || (Math.floor(i/3) === Math.floor(selR/3) && Math.floor(j/3) === Math.floor(selC/3))) {
                ctx.fillStyle = ART.colors.line + '66'; ctx.fillRect(j*size, i*size, size, size);
            }
            if(sameVal > 0 && board[i][j] === sameVal && !(i === selR && j === selC)) {
                ctx.fillStyle = ART.colors.accent + '26'; ctx.fillRect(j*size, i*size, size, size);
            }
        }
        ctx.fillStyle = ART.colors.accent + '4d'; ctx.fillRect(selC*size, selR*size, size, size);
    }
    ctx.strokeStyle = ART.colors.line; ctx.lineWidth = 1;
    for(let i=1; i<9; i++) { ctx.beginPath(); ctx.moveTo(i*size, 0); ctx.lineTo(i*size, 9*size); ctx.moveTo(0, i*size); ctx.lineTo(9*size, i*size); ctx.stroke(); }
    ctx.strokeStyle = ART.colors.accent; ctx.lineWidth = 3;
    for(let i=3; i<=6; i+=3) { ctx.beginPath(); ctx.moveTo(i*size, 0); ctx.lineTo(i*size, 9*size); ctx.moveTo(0, i*size); ctx.lineTo(9*size, i*size); ctx.stroke(); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for(let i=0; i<9; i++) for(let j=0; j<9; j++) {
        let val = board[i][j], note = notes[i][j], isOriginal = originalBoard[i][j] !== 0, isError = conflicts[i][j];
        if(val > 0) {
            ctx.font = `bold ${size * 0.6}px ${fontDisplay}`;
            ctx.fillStyle = isError ? ART.colors.conflict : (isOriginal ? ART.colors.text : ART.colors.accent);
            ctx.fillText(val, j*size + size/2, i*size + size/2);
            if(isError) {
                ctx.fillStyle = ART.colors.conflict; ctx.beginPath();
                ctx.moveTo(j*size + size - 12, i*size + 4); ctx.lineTo(j*size + size - 4, i*size + 4); ctx.lineTo(j*size + size - 8, i*size + 12); ctx.fill();
            }
        } else if(note > 0) {
            ctx.font = `${size * 0.2}px ${fontDisplay}`; ctx.fillStyle = ART.colors.dim;
            for(let n=1; n<=9; n++) if(note & (1 << (n-1))) {
                let nx = (n-1)%3, ny = Math.floor((n-1)/3);
                ctx.fillText(n, j*size + size*0.15 + nx * size*0.35 + size*0.15, i*size + size*0.15 + ny * size*0.35 + size*0.15);
            }
        }
    }
}

/* ⑧HUD */
function formatTime(s) { return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }
function updateHUD() {
    document.getElementById('hud-diff').textContent = t(DIFFS[diff].key);
    updateDiffUI();
    document.getElementById('hud-level').textContent = currentLevel; document.getElementById('hud-level-m').textContent = currentLevel;
    document.getElementById('hud-time').textContent = formatTime(time); document.getElementById('hud-time-m').textContent = formatTime(time);
    document.getElementById('hud-err').textContent = errors; document.getElementById('hud-err-m').textContent = errors;
    document.getElementById('hud-hint').textContent = MAX_HINTS - hintsUsed;
    ['easy','med','hard'].forEach(k => {  // 无纪录时显示占位符，别把 99999 秒格式化成 1666:39
        const raw = localStorage.getItem('sudoku_best_' + k);
        document.getElementById('best-' + k).textContent = raw ? formatTime(parseInt(raw)) : '--:--';
    });
}

/* ⑨输入 */
document.addEventListener('keydown', e => {
    if(e.repeat) return;
    if(state === 'playing') {
        if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
            e.preventDefault();
            if(selR === -1) { selR = 0; selC = 0; }
            else {
                if(e.key === 'ArrowUp') selR = (selR + 8) % 9;
                if(e.key === 'ArrowDown') selR = (selR + 1) % 9;
                if(e.key === 'ArrowLeft') selC = (selC + 8) % 9;
                if(e.key === 'ArrowRight') selC = (selC + 1) % 9;
            }
            drawBoard();
        } else if(e.key >= '1' && e.key <= '9') handleInput(parseInt(e.key));
        else if(e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') handleInput(0);
        else if(e.key.toLowerCase() === 'n') toggleNoteMode();
        else if(e.key.toLowerCase() === 'u') undo();
        else if(e.key.toLowerCase() === 'h') useHint();
        else if(e.key.toLowerCase() === 'p' || e.key === ' ') togglePause();
    } else if(state === 'paused' && (e.key.toLowerCase() === 'p' || e.key === ' ')) togglePause();
});
cv.addEventListener('pointerdown', e => {
    ensureAudio();
    if(state !== 'playing') return;
    const rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    selC = Math.floor(x / (rect.width / 9)); selR = Math.floor(y / (rect.height / 9));
    if(selR < 0 || selR > 8 || selC < 0 || selC > 8) { selR = -1; selC = -1; }
    drawBoard();
});
function toggleNoteMode() {
    noteMode = !noteMode;
    document.querySelectorAll('[data-act="note"]').forEach(b => b.classList.toggle('active', noteMode));
}
function updatePauseUI() {
    const on = state === 'paused';
    document.querySelectorAll('[data-pause-btn]').forEach(b => {
        b.textContent = t(on ? b.dataset.pauseOn : b.dataset.pauseOff);
        b.classList.toggle('on', on);
    });
}
function togglePause() {
    if(state === 'playing') { state = 'paused'; clearInterval(timerInterval); stopMusic(); }
    else if(state === 'paused') { state = 'playing'; startTimer(); startMusic(); }
    else return;
    updatePauseUI();
}
document.addEventListener('visibilitychange', () => { if(document.hidden && state === 'playing') togglePause(); });
window.addEventListener('blur', () => { if(state === 'playing') togglePause(); });

/* ⑩启动 / 覆盖层 */
function showOverlay(id) { document.querySelectorAll('.su-overlay').forEach(o => o.classList.add('hidden')); document.getElementById(id).classList.remove('hidden'); }
function hideOverlay(id) { document.getElementById(id).classList.add('hidden'); }
function startTimer() { clearInterval(timerInterval); timerInterval = setInterval(() => { if(state === 'playing') { time++; updateHUD(); } }, 1000); }
function startGame(d, level) {
    ensureAudio(); diff = d; currentLevel = level || 1; state = 'generating'; showOverlay('ov-gen');
    setTimeout(() => {
        const seed = getSeed(diff, currentLevel);
        const rng = mulberry32(seed);
        solution = shuffleBoard(BASE_BOARD, rng);
        originalBoard = digHoles(solution, DIFFS[diff].clues, rng);
        board = originalBoard.map(r => [...r]);
        notes = Array(9).fill().map(() => Array(9).fill(0));
        conflicts = Array(9).fill().map(() => Array(9).fill(false));
        time = 0; errors = 0; hintsUsed = 0; undoStack = []; selR = -1; selC = -1; noteMode = false;
        document.querySelectorAll('[data-act="note"]').forEach(b => b.classList.remove('active'));
        updateConflicts(); drawBoard(); updateHUD();
        hideOverlay('ov-gen'); state = 'playing'; startTimer(); startMusic(); updatePauseUI();
    }, 50);
}
/* 难度入口：桌面右栏按钮组 + 移动端 HUD 难度项（启动遮罩取消后常驻） */
const DIFF_ORDER = ['easy', 'med', 'hard'];
function updateDiffUI() {
    document.querySelectorAll('[data-diff]').forEach(b => b.classList.toggle('on', b.dataset.diff === diff));
    const dm = document.getElementById('hud-diff-m');
    if (dm) dm.textContent = t(DIFFS[diff].key);
}
document.querySelectorAll('[data-diff]').forEach(b => b.addEventListener('click', () => startGame(b.dataset.diff, 1)));
document.getElementById('btn-diff-m').addEventListener('click', () => {
    ensureAudio();
    startGame(DIFF_ORDER[(DIFF_ORDER.indexOf(diff) + 1) % DIFF_ORDER.length], 1);
});
document.getElementById('btn-pause-d').addEventListener('click', togglePause);
document.getElementById('btn-retry').addEventListener('click', () => { hideOverlay('ov-over'); startGame(diff, currentLevel); });
document.getElementById('btn-next').addEventListener('click', () => { hideOverlay('ov-over'); startGame(diff, currentLevel + 1); });
document.getElementById('btn-reset').addEventListener('click', () => { if(state === 'playing') startGame(diff, currentLevel); });
document.getElementById('btn-pause-m').addEventListener('click', togglePause);
document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
    ensureAudio();
    if(b.dataset.act === 'erase') handleInput(0);
    else if(b.dataset.act === 'note') toggleNoteMode();
    else if(b.dataset.act === 'undo') undo();
    else if(b.dataset.act === 'hint') useHint();
}));
const numpad = document.getElementById('numpad');
for(let i=1; i<=9; i++) {
    const b = document.createElement('button'); b.textContent = i; b.dataset.num = i;
    b.addEventListener('click', () => { ensureAudio(); handleInput(i); });
    numpad.appendChild(b);
}
document.querySelectorAll('.su-tgl').forEach(t => {
    if(cfg[t.dataset.cfg]) t.classList.add('on'); else t.classList.remove('on');
    t.addEventListener('click', () => {
        cfg[t.dataset.cfg] = !cfg[t.dataset.cfg];
        t.classList.toggle('on', cfg[t.dataset.cfg]);
        saveCfg();
        if(t.dataset.cfg === 'mus') { if(cfg.mus && state === 'playing') startMusic(); else stopMusic(); }
    });
});
/* 语言切换：重渲染难度等动态文案 */
document.addEventListener('moteful:langchange', function () {
    updatePauseUI();
    document.getElementById('hud-diff').textContent = t(DIFFS[diff].key);
    updateDiffUI();
    if (state === 'over') {
        document.getElementById('ov-diff').textContent = t('su_ov_over_diff', { diff: t(DIFFS[diff].key), level: currentLevel });
    }
});

/* 页面加载即自动开局（已取消「选择难度」遮罩）；首次交互解锁音频上下文 */
document.addEventListener('pointerdown', function unlockAudioOnce() {
    ensureAudio();
    if (state === 'playing' && cfg.mus) startMusic();
}, { once: true });
fit(); updateHUD(); updatePauseUI(); startGame('easy', 1);
})();
