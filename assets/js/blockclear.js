
'use strict';
/* ════════════════════════════════════════════════════════════
   ① 美术资源配置中心 —— 想换素材，只改这里
   （替换时请使用自有或已获授权的资源）
   ════════════════════════════════════════════════════════════ */
const ART = {
  /* 方块颜色（未配置贴图时使用，原创配色） */
  colors:{ I:'#48cae4', O:'#ffd670', T:'#57cc99', S:'#ff6f91', Z:'#9d7bff', J:'#ff9e40', L:'#e9e9f2' },

  /* 方块贴图：每种一块透明 PNG（正方形，URL 相对 games/block-clear.html，命中 games/assets/ 资源目录） */
  skins:{
    I: 'assets/b_i.png',
    O: 'assets/b_o.png',
    T: 'assets/b_t.png',
    S: 'assets/b_s.png',
    Z: 'assets/b_z.png',
    J: 'assets/b_j.png',
    L: 'assets/b_l.png'
  },

  boardBg:'',   // 棋盘背景图（比例 1:2，如 640×1280），留空 = 内置深色渐变
  pageBg :'',   // 整页背景图 URL，留空 = 内置配色（设置后自动隐藏飘落方块装饰）
  logo   :'',   // 顶部 Logo 图 URL，设置后替换文字 Logo

  /* 音效文件（留空 = 内置合成音效）。键名：move/rotate/lock/hold/harddrop/clear/quad/levelup/gameover */
  sfx:{ move:'', rotate:'', lock:'', hold:'', harddrop:'', clear:'', quad:'', levelup:'', gameover:'' },

  music:''      // 背景音乐 URL（自动循环）；'off' = 关闭音乐；留空 = 内置原创芯片音循环
};

const RULES = { DAS:150, ARR:40, LOCK_DELAY:500, MAX_RESET:15, NEXT_COUNT:3,
                SOFT_MS:35, PTS:[0,100,300,500,800], HIDDEN:4, CLEAR_MS:320 };

/* ════════════ ② 工具与画布 ════════════ */
const $=id=>document.getElementById(id);
const CELL=32, COLS=10, ROWS=20, HID=RULES.HIDDEN, TOT=ROWS+HID, BW=COLS*CELL, BH=ROWS*CELL;
function fit(cv,w,h){const d=Math.min(2,window.devicePixelRatio||1);cv.width=w*d;cv.height=h*d;
  const x=cv.getContext('2d');x.setTransform(d,0,0,d,0,0);return x;}
const bctx=fit($('board'),BW,BH), hctx=fit($('hold'),120,72),
      nctx=fit($('next'),150,210), nsctx=fit($('nextStrip'),210,64);

/* ════════════ ③ 音频引擎（暂停/结束时暂停音乐，继续续播、重开重播） ════════════ */
const A=(()=>{ let c=null,mg=null,sfxOn=true,musOn=true,custom={},seq=null,mi=0,nt=0,el=null;
  const AC=()=>{ if(!c){const K=window.AudioContext||window.webkitAudioContext;if(!K)return null;
    c=new K();mg=c.createGain();mg.gain.value=.42;mg.connect(c.destination);}
    if(c.state==='suspended')c.resume(); return c; };
  function init(){ for(const k in ART.sfx) if(ART.sfx[k]){const a=new Audio(ART.sfx[k]);a.preload='auto';custom[k]=a;} }
  function tone(f,d,type,v,f2){ if(!sfxOn)return;const x=AC();if(!x)return;
    const o=x.createOscillator(),g=x.createGain(),t=x.currentTime;o.type=type||'square';
    o.frequency.setValueAtTime(f,t); if(f2)o.frequency.exponentialRampToValueAtTime(f2,t+d);
    g.gain.setValueAtTime(v||.12,t); g.gain.exponentialRampToValueAtTime(.0001,t+d);
    o.connect(g);g.connect(x.destination);o.start(t);o.stop(t+d+.03); }
  function noise(d,v){ if(!sfxOn)return;const x=AC();if(!x)return;
    const n=x.createBufferSource(),b=x.createBuffer(1,x.sampleRate*d,x.sampleRate),ch=b.getChannelData(0);
    for(let i=0;i<ch.length;i++)ch[i]=(Math.random()*2-1)*(1-i/ch.length);
    n.buffer=b;const g=x.createGain();g.gain.value=v||.15;const f=x.createBiquadFilter();f.type='lowpass';f.frequency.value=900;
    n.connect(f);f.connect(g);g.connect(x.destination);n.start(); }
  const synth={ move:()=>tone(210,.045,'square',.05), rotate:()=>tone(330,.06,'triangle',.1,430),
    lock:()=>{tone(140,.08,'square',.12);noise(.06,.08)}, hold:()=>tone(520,.07,'triangle',.1,660),
    harddrop:()=>{noise(.1,.22);tone(90,.1,'square',.16)},
    clear:()=>[523,659,784].forEach((f,i)=>setTimeout(()=>tone(f,.09,'square',.12),i*70)),
    quad:()=>[523,659,784,1046,1318].forEach((f,i)=>setTimeout(()=>tone(f,.11,'square',.14),i*80)),
    levelup:()=>tone(300,.4,'sawtooth',.1,900), gameover:()=>tone(400,.7,'sawtooth',.12,60) };
  function sfx(n){ try{ if(custom[n]){ if(sfxOn){const a=custom[n].cloneNode();a.volume=.6;a.play().catch(()=>{});} return; }
    if(synth[n])synth[n](); }catch(e){} }
  /* 内置背景音乐：原创芯片音循环乐句（非任何游戏原声） */
  const NOTE={C5:523.25,D5:587.33,E5:659.25,F5:698.46,G5:783.99,A5:880,B5:987.77,C6:1046.5};
  const MEL=[['C5',1],['E5',.5],['G5',.5],['A5',1],['G5',.5],['E5',.5],
    ['D5',1],['F5',.5],['A5',.5],['G5',1.5],['E5',.5],
    ['C5',1],['E5',.5],['G5',.5],['A5',1],['C6',.5],['B5',.5],
    ['A5',1],['G5',1],['E5',1],[0,1],
    ['F5',1],['A5',.5],['C6',.5],['B5',1],['G5',.5],['E5',.5],
    ['D5',1],['E5',.5],['F5',.5],['G5',1.5],['E5',.5],
    ['C5',1],['E5',.5],['G5',.5],['A5',1],['C6',.5],['B5',.5],
    ['A5',1],['G5',1],['C5',1],[0,1]].map(p=>[p[0]?NOTE[p[0]]:0,p[1]]);
  const BEAT=.34;
  function note(f,t,d,v,type){ const o=c.createOscillator(),g=c.createGain();o.type=type||'square';o.frequency.value=f;
    g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(v,t+.012);g.gain.setValueAtTime(v,t+d*.6);
    g.gain.linearRampToValueAtTime(.0001,t+d*.95);o.connect(g);g.connect(mg);o.start(t);o.stop(t+d); }
  function tick(){ const x=AC();if(!x)return; if(!musOn){nt=x.currentTime;return;}
    if(nt<x.currentTime)nt=x.currentTime;
    while(nt<x.currentTime+.25){ const[f,b]=MEL[mi],d=b*BEAT;
      if(f){note(f,nt,d*.92,.045);note(f/2,nt,d*.92,.035,'triangle');}
      nt+=d; mi=(mi+1)%MEL.length; } }
  function startMusic(){ if(ART.music==='off')return;
    if(ART.music){ if(!el){el=new Audio(ART.music);el.loop=true;el.volume=.35;} el.currentTime=0; el.play().catch(()=>{}); return; }
    AC(); if(seq)return; nt=(c?c.currentTime:0)+.1; mi=0; seq=setInterval(tick,80); }
  function pauseMusic(){ if(ART.music==='off')return;
    if(ART.music){ if(el)el.pause(); return; }
    if(seq){clearInterval(seq);seq=null;} }
  function resumeMusic(){ if(ART.music==='off'||!musOn)return;
    if(ART.music){ if(el)el.play().catch(()=>{}); return; }
    AC(); if(seq)return; nt=(c?c.currentTime:0)+.05; seq=setInterval(tick,80); }
  function setSfx(v){sfxOn=v}
  function setMus(v){ musOn=v;
    if(ART.music&&ART.music!=='off'){ if(el){ v?el.play().catch(()=>{}):el.pause(); } return; }
    if(!v){ if(seq){clearInterval(seq);seq=null;} return; }
    if(state==='playing'&&!seq){ AC(); nt=(c?c.currentTime:0)+.05; seq=setInterval(tick,80); } }
  return {init,sfx,startMusic,pauseMusic,resumeMusic,setSfx,setMus,get sfxOn(){return sfxOn},get musOn(){return musOn}};
})();

/* ════════════ ④ 方块定义与旋转踢墙 ════════════ */
const BASE={
  I:[[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
  J:[[1,0,0],[1,1,1],[0,0,0]], L:[[0,0,1],[1,1,1],[0,0,0]],
  O:[[1,1],[1,1]], S:[[0,1,1],[1,1,0],[0,0,0]],
  T:[[0,1,0],[1,1,1],[0,0,0]], Z:[[1,1,0],[0,1,1],[0,0,0]] };
const rotCW =m=>m[0].map((_,x)=>m.map(r=>r[x]).reverse());
const rotCCW=m=>rotCW(rotCW(rotCW(m)));
const KICK_JLSTZ={'0>1':[[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],'1>0':[[0,0],[1,0],[1,-1],[0,2],[1,2]],
 '1>2':[[0,0],[1,0],[1,-1],[0,2],[1,2]],'2>1':[[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
 '2>3':[[0,0],[1,0],[1,1],[0,-2],[1,-2]],'3>2':[[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
 '3>0':[[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],'0>3':[[0,0],[1,0],[1,1],[0,-2],[1,-2]]};
const KICK_I={'0>1':[[0,0],[-2,0],[1,0],[-2,-1],[1,2]],'1>0':[[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
 '1>2':[[0,0],[-1,0],[2,0],[-1,2],[2,-1]],'2>1':[[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
 '2>3':[[0,0],[2,0],[-1,0],[2,1],[-1,-2]],'3>2':[[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
 '3>0':[[0,0],[1,0],[-2,0],[1,-2],[-2,1]],'0>3':[[0,0],[-1,0],[2,0],[-1,2],[2,-1]]};

/* ════════════ ⑤ 游戏状态 ════════════ */
let grid=Array.from({length:TOT},()=>Array(COLS).fill(0));
let bag=[],queue=[],cur=null,holdType=null,canHold=true;
let score=0,lines=0,level=1,combo=-1,b2b=-1,hi=0,newRecord=false;
let state='idle',dropTimer=0,lockTimer=0,lockResets=0,grounded=false;
let clearRows=[],clearT=0,particles=[],overT=0,overShown=false;
let leftHeld=0,rightHeld=0;
const key={dir:0,dasT:0,arrT:0,down:false};
const settings={ghost:true,grid:true};
const skinIm={}, boardIm=new Image();

function loadHi(){try{return +localStorage.getItem('blockclear_hi')||0}catch(e){return 0}}
function saveHi(v){try{localStorage.setItem('blockclear_hi',v)}catch(e){}}
function refill(){ const t=['I','J','L','O','S','T','Z'];
  for(let i=t.length-1;i>0;i--){const j=(Math.random()*(i+1))|0;[t[i],t[j]]=[t[j],t[i]];} bag.push(...t); }
function nextType(){ if(bag.length<7)refill(); return bag.shift(); }
function makePiece(t){ const m=BASE[t].map(r=>r.slice());
  return {t,m,x:((COLS-m[0].length)/2)|0,y:HID-2,rot:0}; }
function collides(m,x,y){ for(let r=0;r<m.length;r++)for(let c=0;c<m[r].length;c++){
  if(!m[r][c])continue; const gx=x+c,gy=y+r;
  if(gx<0||gx>=COLS||gy>=TOT)return true; if(gy>=0&&grid[gy][gx])return true; } return false; }
function gravMs(lv){ const tb=[1000,793,618,473,355,262,190,135,94,64,43,28,18,12,8];
  if(lv<=tb.length)return tb[lv-1]; return Math.max(16,Math.pow(0.8-(lv-1)*0.007,lv-1)*1000); }

/* ════════════ ⑥ 核心逻辑 ════════════ */
function tryMove(dx,dy){ if(state!=='playing'||!cur)return false;
  if(collides(cur.m,cur.x+dx,cur.y+dy))return false;
  cur.x+=dx;cur.y+=dy;
  if(dy===0&&grounded&&lockResets<RULES.MAX_RESET){lockTimer=0;lockResets++;}
  return true; }
function tryRotate(dir){ if(state!=='playing'||!cur)return;
  if(cur.t==='O'){A.sfx('rotate');return;}
  const m=dir>0?rotCW(cur.m):rotCCW(cur.m), to=(cur.rot+dir+4)%4;
  const tb=(cur.t==='I'?KICK_I:KICK_JLSTZ)[cur.rot+'>'+to]||[[0,0]];
  for(const[kx,ky]of tb){ const nx=cur.x+kx,ny=cur.y-ky;
    if(!collides(m,nx,ny)){ cur.m=m;cur.x=nx;cur.y=ny;cur.rot=to;
      if(grounded&&lockResets<RULES.MAX_RESET){lockTimer=0;lockResets++;}
      A.sfx('rotate');return; } } }
function ghostY(){ let gy=cur.y; while(!collides(cur.m,cur.x,gy+1))gy++; return gy; }
function pressDir(d){ key.dir=d;key.dasT=0;key.arrT=0; if(tryMove(d,0))A.sfx('move'); }
function releaseDir(){ key.dir=rightHeld?1:(leftHeld?-1:0); key.dasT=0;key.arrT=0; }
function handleDAS(dt){ if(!key.dir)return; key.dasT+=dt;
  if(key.dasT<RULES.DAS)return; key.arrT+=dt;
  while(key.arrT>=RULES.ARR){key.arrT-=RULES.ARR; if(tryMove(key.dir,0))A.sfx('move');} }

function lockPiece(){ let top=false;
  cur.m.forEach((row,r)=>row.forEach((v,c)=>{ if(!v)return;
    const gy=cur.y+r,gx=cur.x+c; if(gy<HID)top=true; else grid[gy][gx]=cur.t; }));
  A.sfx('lock');
  if(top){gameOver();return;}
  const full=[]; for(let r=0;r<TOT;r++) if(grid[r].every(v=>v)) full.push(r);
  canHold=true; cur=null;
  if(full.length){
    const n=full.length, wasB2B=n===4&&b2b>=1;
    b2b=n===4?b2b+1:-1; combo++;
    let pts=RULES.PTS[n]*level; if(wasB2B)pts=Math.floor(pts*1.5);
    if(combo>=1)pts+=50*combo*level;
    score+=pts; lines+=n;
    popup(t('bc_combo_'+['','single','double','triple','four'][n])+(wasB2B?(' '+t('bc_combo_b2b')):''), n===4?'big':'');
    if(combo>=1)popup(t('bc_combo_label')+' ×'+combo,'combo');
    burstRows(full);
    if(n===4){A.sfx('quad');shake();}else A.sfx('clear');
    const nl=Math.floor(lines/10)+1;
    if(nl>level){level=nl;A.sfx('levelup');popup(t('bc_level_up')+' '+level,'big');glow();}
    clearRows=full; clearT=0;
  }else{ combo=-1; spawnNext(); }
  hud(); }
function finishClear(){ clearRows.forEach(r=>{grid.splice(r,1);grid.unshift(Array(COLS).fill(0));});
  clearRows=[]; spawnNext(); }
function spawnNext(){ cur=makePiece(queue.shift()); queue.push(nextType());
  dropTimer=0;lockTimer=0;lockResets=0;
  if(collides(cur.m,cur.x,cur.y))gameOver(); }
function doHold(){ if(state!=='playing'||!cur||!canHold||clearRows.length)return;
  A.sfx('hold'); const t=cur.t;
  if(holdType){ cur=makePiece(holdType); holdType=t;
    if(collides(cur.m,cur.x,cur.y)){gameOver();return;}
    dropTimer=0;lockTimer=0;lockResets=0; }
  else{ holdType=t; spawnNext(); }
  canHold=false; }
function hardDrop(){ if(state!=='playing'||!cur||clearRows.length)return;
  const gy=ghostY(); score+=(gy-cur.y)*2;
  cur.m.forEach((row,r)=>row.forEach((v,c)=>{ if(!v)return;
    particles.push({x:(cur.x+c)*CELL+8,y:(gy+r-HID)*CELL,vx:0,vy:-.18,life:260,max:260,s:5,col:ART.colors[cur.t]}); }));
  cur.y=gy; A.sfx('harddrop'); shake(); lockPiece(); hud(); }
function gameOver(){ state='over'; overT=0; overShown=false; A.pauseMusic(); A.sfx('gameover');
  if(score>hi){hi=score;saveHi(hi);newRecord=true;}else newRecord=false;
  hud(); }
function showOver(){ $('ovScore').textContent=score; $('ovLines').textContent=lines;
  $('ovLevel').textContent=level; $('ovBadge').hidden=!newRecord; show($('ovOver')); }

function startGame(){ [$('ovStart'),$('ovPause'),$('ovOver')].forEach(hide);
  grid=Array.from({length:TOT},()=>Array(COLS).fill(0));
  bag=[];queue=[]; for(let i=0;i<RULES.NEXT_COUNT;i++)queue.push(nextType());
  holdType=null;canHold=true;score=0;lines=0;level=1;combo=-1;b2b=-1;
  particles=[];clearRows=[];dropTimer=0;lockTimer=0;lockResets=0;
  spawnNext(); state='playing'; A.startMusic();
  popup(t('bc_ready'),'big'); $('btnStart').textContent=t('bc_btn_restart'); hud(); }
function togglePause(){ if(state==='playing'){state='paused';A.pauseMusic();show($('ovPause'));$('btnPause').textContent=t('bc_btn_resume');}
  else if(state==='paused'){state='playing';A.resumeMusic();hide($('ovPause'));$('btnPause').textContent=t('bc_btn_pause');} }

function update(dt){
  if(state==='playing'){
    if(clearRows.length){ clearT+=dt; if(clearT>=RULES.CLEAR_MS)finishClear(); return; }
    if(!cur)return;
    handleDAS(dt);
    dropTimer+=dt;
    const iv=key.down?RULES.SOFT_MS:gravMs(level);
    while(dropTimer>=iv){ dropTimer-=iv;
      if(collides(cur.m,cur.x,cur.y+1)){dropTimer=0;break;}
      cur.y++; if(key.down){score++;hudScore();} }
    if(collides(cur.m,cur.x,cur.y+1)){ grounded=true; lockTimer+=dt;
      if(lockTimer>=RULES.LOCK_DELAY){lockPiece();return;} }
    else{ grounded=false; lockTimer=0; }
  }else if(state==='over'){ overT+=dt;
    if(overT>ROWS*34+350&&!overShown){overShown=true;showOver();} }
}

/* ════════════ ⑦ 绘制 ══════════ */
function drawCell(x,t,px,py,cs){ const im=skinIm[t];
  if(im&&im.complete&&im.naturalWidth){x.drawImage(im,px,py,cs,cs);return;}
  const col=ART.colors[t]||'#fff';
  x.fillStyle=col; x.fillRect(px,py,cs,cs);
  const b=Math.max(2,cs*.14);
  x.fillStyle='rgba(255,255,255,.32)'; x.fillRect(px,py,cs,b); x.fillRect(px,py,b,cs);
  x.fillStyle='rgba(0,0,0,.30)'; x.fillRect(px,py+cs-b,cs,b); x.fillRect(px+cs-b,py,b,cs);
  x.fillStyle='rgba(255,255,255,.16)'; x.fillRect(px+b+cs*.08,py+b+cs*.08,cs*.24,cs*.24); }
function drawPieceAt(x,t,cx,cy,cs,al){ const m=BASE[t];
  let a=9,b=-9,c=9,d=-9;
  m.forEach((row,r)=>row.forEach((v,cc)=>{if(v){a=Math.min(a,cc);b=Math.max(b,cc);c=Math.min(c,r);d=Math.max(d,r);}}));
  const ox=cx-(b-a+1)*cs/2-a*cs, oy=cy-(d-c+1)*cs/2-c*cs;
  x.globalAlpha=al;
  m.forEach((row,r)=>row.forEach((v,cc)=>{if(v)drawCell(x,t,ox+cc*cs,oy+r*cs,cs);}));
  x.globalAlpha=1; }
function drawBoard(dt){
  bctx.clearRect(0,0,BW,BH);
  if(boardIm.complete&&boardIm.naturalWidth)bctx.drawImage(boardIm,0,0,BW,BH);
  else{const g=bctx.createLinearGradient(0,0,0,BH);g.addColorStop(0,'#251738');g.addColorStop(1,'#140c1f');
    bctx.fillStyle=g;bctx.fillRect(0,0,BW,BH);}
  if(settings.grid){ bctx.strokeStyle='rgba(201,180,255,.09)';bctx.lineWidth=1;bctx.beginPath();
    for(let c=1;c<COLS;c++){bctx.moveTo(c*CELL+.5,0);bctx.lineTo(c*CELL+.5,BH);}
    for(let r=1;r<ROWS;r++){bctx.moveTo(0,r*CELL+.5);bctx.lineTo(BW,r*CELL+.5);} bctx.stroke(); }
  let danger=ROWS; for(let r=HID;r<TOT;r++) if(grid[r].some(v=>v)){danger=r-HID;break;}
  if(danger<=4&&state==='playing'){ bctx.fillStyle=`rgba(255,90,110,${danger<=2?.14:.08})`; bctx.fillRect(0,0,BW,(danger+1)*CELL); }
  for(let r=HID;r<TOT;r++)for(let c=0;c<COLS;c++){ const v=grid[r][c];
    if(v&&!clearRows.includes(r))drawCell(bctx,v,c*CELL,(r-HID)*CELL,CELL); }
  if(clearRows.length){ const p=clearT/RULES.CLEAR_MS, w=CELL*(1-p);
    clearRows.forEach(r=>{const y=(r-HID)*CELL; bctx.fillStyle='#fff';
      for(let c=0;c<COLS;c++)bctx.fillRect(c*CELL+(CELL-w)/2,y,w,CELL);}); }
  if(state==='playing'&&cur){
    if(settings.ghost){ const gy=ghostY();
      cur.m.forEach((row,r)=>row.forEach((v,c)=>{ if(!v)return; const Y=gy+r; if(Y<HID)return;
        const px=(cur.x+c)*CELL,py=(Y-HID)*CELL;
        bctx.globalAlpha=.14;bctx.fillStyle=ART.colors[cur.t];bctx.fillRect(px+1,py+1,CELL-2,CELL-2);
        bctx.globalAlpha=.7;bctx.strokeStyle=ART.colors[cur.t];bctx.lineWidth=2;
        bctx.strokeRect(px+2,py+2,CELL-4,CELL-4);bctx.globalAlpha=1; })); }
    cur.m.forEach((row,r)=>row.forEach((v,c)=>{ if(!v)return; const Y=cur.y+r; if(Y<HID)return;
      drawCell(bctx,cur.t,(cur.x+c)*CELL,(Y-HID)*CELL,CELL); })); }
  particles=particles.filter(p=>{ p.life-=dt; if(p.life<=0)return false;
    p.x+=p.vx*dt; p.y+=p.vy*dt; p.vy+=.0015*dt;
    bctx.globalAlpha=Math.max(0,p.life/p.max); bctx.fillStyle=p.col; bctx.fillRect(p.x,p.y,p.s,p.s);
    bctx.globalAlpha=1; return true; });
  if(state==='over'){ const rows=Math.min(ROWS,overT/34);
    bctx.fillStyle='rgba(70,58,106,.85)';
    for(let r=0;r<rows;r++)bctx.fillRect(0,r*CELL,BW,CELL); } }
function drawHold(){ hctx.clearRect(0,0,120,72);
  if(holdType)drawPieceAt(hctx,holdType,60,36,17,canHold?1:.4); }
function drawNext(x,w,h,vert){ x.clearRect(0,0,w,h); const n=RULES.NEXT_COUNT;
  for(let i=0;i<n;i++){ const t=queue[i]; if(!t)continue;
    const cx=vert?w/2:(i+.5)*(w/n), cy=vert?(i+.5)*(h/n):h/2;
    drawPieceAt(x,t,cx,cy,vert?19:13,1); } }
function burstRows(rows){ rows.forEach(r=>{ for(let c=0;c<COLS;c++){ const col=ART.colors[grid[r][c]]||'#fff';
    particles.push({x:c*CELL+6,y:(r-HID)*CELL+6,vx:(Math.random()-.5)*.3,vy:-(.1+Math.random()*.25),
      life:500+Math.random()*250,max:700,s:4+Math.random()*5,col}); } }); }

/* ════════════ ⑧ HUD / 特效 ════════════ */
function setVal(el,v){ v=String(v); if(el.textContent!==v){el.textContent=v;
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');} }
function hudScore(){ setVal($('scScore'),score); $('hiTop').textContent=Math.max(hi,score); }
function hud(){ hudScore(); setVal($('scHi'),hi); setVal($('scLevel'),level);
  setVal($('scLines'),lines); setVal($('scCombo'),combo>=1?'×'+combo:'—');
  $('btnPause').disabled=!(state==='playing'||state==='paused'); }
function popup(txt,cls){ const d=document.createElement('div');
  d.className='pop'+(cls?' '+cls:''); d.textContent=txt;
  d.style.left=(28+Math.random()*30)+'%'; d.style.top=(cls==='big'?'40%':'30%');
  $('popLayer').appendChild(d); d.addEventListener('animationend',()=>d.remove()); }
function shake(){ const b=$('board'); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); }
function glow(){ const b=$('bezel'); b.classList.add('glow'); setTimeout(()=>b.classList.remove('glow'),720); }
const show=o=>o.classList.remove('hidden'), hide=o=>o.classList.add('hidden');

/* ════════════ ⑨ 输入 ═══════════ */
window.addEventListener('keydown',e=>{
  const c=e.code;
  if(['ArrowLeft','ArrowRight','ArrowDown','ArrowUp','Space'].includes(c))e.preventDefault();
  if(e.repeat)return;
  if(c==='Enter'){ if(state==='idle'||state==='over')startGame(); return; }
  if(c==='KeyP'||c==='Escape'){ togglePause(); return; }
  if(c==='KeyR'){ startGame(); return; }
  if(c==='KeyM'){ const t=$('tglSfx'); t.classList.toggle('on'); A.setSfx(t.classList.contains('on')); return; }
  if(state!=='playing')return;
  switch(c){
    case 'ArrowLeft': leftHeld=1; pressDir(-1); break;
    case 'ArrowRight': rightHeld=1; pressDir(1); break;
    case 'ArrowDown': key.down=true; dropTimer=RULES.SOFT_MS; break;
    case 'ArrowUp': case 'KeyX': tryRotate(1); break;
    case 'KeyZ': tryRotate(-1); break;
    case 'Space': hardDrop(); break;
    case 'KeyC': case 'ShiftLeft': case 'ShiftRight': doHold(); break;
  } });
window.addEventListener('keyup',e=>{
  if(e.code==='ArrowLeft'){leftHeld=0;releaseDir();}
  if(e.code==='ArrowRight'){rightHeld=0;releaseDir();}
  if(e.code==='ArrowDown')key.down=false; });
window.addEventListener('blur',()=>{ if(state==='playing')togglePause(); });
document.addEventListener('visibilitychange',()=>{ if(document.hidden&&state==='playing')togglePause(); });

$('btnStart').onclick=e=>{e.target.blur();startGame();};
$('btnRe').onclick=e=>{e.target.blur();startGame();};
$('btnPause').onclick=e=>{e.target.blur();togglePause();};
$('btnGo').onclick=()=>startGame();
$('btnAgain').onclick=()=>startGame();
$('btnResume').onclick=()=>togglePause();
$('ovStart').addEventListener('click',e=>{ if(e.target.id!=='btnGo')startGame(); });
$('board').addEventListener('pointerdown',()=>{ if(state==='idle'||state==='over')startGame(); });
function bindTgl(id,fn){ const t=$(id); t.onclick=()=>{t.classList.toggle('on');fn(t.classList.contains('on'));t.blur();}; }
bindTgl('tglSfx',v=>A.setSfx(v));
bindTgl('tglMus',v=>A.setMus(v));
bindTgl('tglGhost',v=>settings.ghost=v);

/* 触屏 */
function bindHold(el,dn,up){ el.addEventListener('pointerdown',e=>{e.preventDefault();
  el.setPointerCapture(e.pointerId);dn();});
  ['pointerup','pointercancel'].forEach(ev=>el.addEventListener(ev,up)); }
function bindTap(el,fn){ el.addEventListener('pointerdown',e=>{e.preventDefault();fn();}); }
bindHold($('tpL'),()=>{leftHeld=1;pressDir(-1);},()=>{leftHeld=0;releaseDir();});
bindHold($('tpR'),()=>{rightHeld=1;pressDir(1);},()=>{rightHeld=0;releaseDir();});
bindHold($('tpD'),()=>{key.down=true;},()=>{key.down=false;});
bindTap($('tpCCW'),()=>tryRotate(-1));
bindTap($('tpCW'),()=>tryRotate(1));
bindTap($('tpHD'),()=>hardDrop());
bindTap($('tpH'),()=>doHold());
$('touchpad').addEventListener('contextmenu',e=>e.preventDefault());

/* 手机滑动手势：棋盘上 左/右滑=移动，下滑=软降，快速下滑=硬降，轻点=顺时针旋转 */
(function(){
  const bz=$('bezel'); if(!bz)return;
  let sx=0,sy=0,lastX=0,lastY=0,st=0,moved=0; const TH=20;
  bz.addEventListener('touchstart',e=>{
    const t=e.changedTouches[0]; sx=lastX=t.clientX; sy=lastY=t.clientY; st=Date.now(); moved=0;
  },{passive:true});
  bz.addEventListener('touchmove',e=>{
    if(state!=='playing')return;
    const t=e.changedTouches[0];
    const dx=t.clientX-lastX, dy=t.clientY-lastY;
    if(Math.abs(dx)>=TH){ pressDir(dx>0?1:-1); lastX=t.clientX; moved=1; }
    else if(dy>=TH){ key.down=true; dropTimer=RULES.SOFT_MS; lastY=t.clientY; moved=1; }
    if(e.cancelable)e.preventDefault();
  },{passive:false});
  bz.addEventListener('touchend',e=>{
    if(state!=='playing')return;
    const t=e.changedTouches[0];
    const dx=t.clientX-sx, dy=t.clientY-sy, dt=Date.now()-st;
    key.down=false;
    if(!moved && dt<260 && Math.abs(dx)<14 && Math.abs(dy)<14) tryRotate(1);
    else if(dy>64 && dt<260) hardDrop();
  },{passive:true});
})();

/* ════════════ ⑩ 装饰与启动 ════════════ */
(function decor(){
  const SH={I:[[0,0],[1,0],[2,0],[3,0]],O:[[0,0],[1,0],[0,1],[1,1]],
    T:[[0,0],[1,0],[2,0],[1,1]],S:[[1,0],[2,0],[0,1],[1,1]],
    Z:[[0,0],[1,0],[1,1],[2,1]],J:[[0,0],[0,1],[1,1],[2,1]],L:[[2,0],[0,1],[1,1],[2,1]]};
  const TS=Object.keys(SH), sky=$('sky');
  for(let i=0;i<16;i++){ const t=TS[i%7], d=document.createElement('div'); d.className='fp';
    const cs=10+Math.random()*14;
    SH[t].forEach(([x,y])=>{ const s=document.createElement('span');
      s.style.cssText=`left:${x*cs}px;top:${y*cs}px;width:${cs-1}px;height:${cs-1}px;background:${ART.colors[t]}`;
      d.appendChild(s); });
    d.style.left=Math.random()*100+'vw';
    d.style.animationDuration=(16+Math.random()*22)+'s';
    d.style.animationDelay=(-Math.random()*30)+'s';
    d.style.setProperty('--spin',((Math.random()<.5?-1:1)*(180+Math.random()*360))+'deg');
    sky.appendChild(d); }
})();
(function loadArt(){
  for(const k in ART.skins) if(ART.skins[k]){const im=new Image();im.src=ART.skins[k];skinIm[k]=im;}
  if(ART.boardBg)boardIm.src=ART.boardBg;
  if(ART.pageBg){ document.body.style.backgroundImage=`url(${ART.pageBg})`;
    document.body.style.backgroundSize='cover'; document.body.style.backgroundAttachment='fixed';
    $('sky').style.display='none'; }
  A.init();
})();

hi=loadHi(); hud();
let last=0;
function frame(t){ const dt=Math.min(50,t-last); last=t;
  update(dt); drawBoard(dt); drawHold();
  drawNext(nctx,150,210,true); drawNext(nsctx,210,64,false);
  requestAnimationFrame(frame); }
requestAnimationFrame(frame);
