/* Moteful Design System · moteful.js · v0905-r10
   行为唯一事实源 + 内置内联 SVG 图标（零外部请求）。只读，禁止手改。 */
(function(){
'use strict';
var $=function(s,c){return (c||document).querySelector(s)};
var $$=function(s,c){return Array.prototype.slice.call((c||document).querySelectorAll(s))};
var on=function(el,ev,fn,opt){if(el)el.addEventListener(ev,fn,opt)};

/* ========== 内置图标库（24 视窗 · 1.8 线性 · 圆角端点） ========== */
var ICONS={
'zap':'<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
'sun':'<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
'moon':'<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
'globe':'<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
'chevron-down':'<path d="m6 9 6 6 6-6"/>','chevron-up':'<path d="m18 15-6-6-6 6"/>',
'chevron-left':'<path d="m15 18-6-6 6-6"/>','chevron-right':'<path d="m9 18 6-6-6-6"/>',
'arrow-left':'<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
'arrow-up':'<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
'x':'<path d="M18 6 6 18"/><path d="m6 6 12 12"/>','check':'<path d="M20 6 9 17l-5-5"/>',
'check-circle':'<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
'x-circle':'<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
'alert-triangle':'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
'alert-circle':'<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
'info':'<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
'plus':'<path d="M5 12h14"/><path d="M12 5v14"/>','minus':'<path d="M5 12h14"/>',
'copy':'<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
'download':'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
'upload':'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
'upload-cloud':'<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/>',
'trash-2':'<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
'settings':'<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
'search':'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
'images':'<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
'image':'<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
'code':'<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
'star':'<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
'mail':'<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
'github':'<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
'message-circle':'<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
'lock':'<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
'link':'<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
'refresh-cw':'<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
'clock':'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
'folder':'<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
'folder-open':'<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
'file-plus':'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M12 18v-6"/>',
'pencil':'<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
'eye':'<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
'share-2':'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98"/><path d="m15.41 6.51-6.82 3.98"/>',
'more-horizontal':'<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
'list':'<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
'layout-grid':'<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
'home':'<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
'user':'<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
'heart':'<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 3.99 3 5.5l7 7Z"/>',
'panel-right':'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
'panel-bottom':'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 15h18"/>',
'sliders-horizontal':'<path d="M21 4h-7"/><path d="M10 4H3"/><path d="M21 12h-9"/><path d="M8 12H3"/><path d="M21 20h-5"/><path d="M12 20H3"/><path d="M14 2v4"/><path d="M8 10v4"/><path d="M16 18v4"/>',
'loader-2':'<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
'shield-check':'<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
'sparkles':'<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>',
'maximize-2':'<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>',
'menu':'<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
'layers':'<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',
'droplet':'<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
'regex':'<path d="M17 3v10"/><path d="m12.67 5.5 8.66 5"/><path d="m12.67 10.5 8.66-5"/><path d="M9 17a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2z"/>',
'binary':'<rect x="14" y="14" width="4" height="6" rx="2"/><rect x="6" y="4" width="4" height="6" rx="2"/><path d="M6 20h4"/><path d="M14 10h4"/><path d="M6 14h2v6"/><path d="M14 4h2v6"/>',
'palette':'<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>'
,'gamepad-2':'<line x1="6" x2="10" y1="11" y2="11" /><line x1="8" x2="8" y1="9" y2="13" /><line x1="15" x2="15.01" y1="12" y2="12" /><line x1="18" x2="18.01" y1="10" y2="10" /><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z" />',
'worm':'<path d="m19 12-1.5 3"/><path d="M19.63 18.81 22 20"/><path d="M6.47 8.23a1.68 1.68 0 0 1 2.44 1.93l-.64 2.08a6.76 6.76 0 0 0 10.16 7.67l.42-.27a1 1 0 1 0-2.73-4.21l-.42.27a1.76 1.76 0 0 1-2.63-1.99l.64-2.08A6.66 6.66 0 0 0 3.94 3.9l-.7.4a1 1 0 1 0 2.55 4.34z"/>',
'grid-3x3':'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>'
};
function renderIcons(){
  $$('[data-lucide]').forEach(function(el){
    if(el.tagName.toLowerCase()==='svg')return;
    var name=el.getAttribute('data-lucide');
    var svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24');
    svg.setAttribute('fill','none');
    svg.setAttribute('stroke','currentColor');
    svg.setAttribute('stroke-width','1.8');
    svg.setAttribute('stroke-linecap','round');
    svg.setAttribute('stroke-linejoin','round');
    svg.setAttribute('data-lucide',name);
    svg.setAttribute('aria-hidden','true');
    var cls=el.getAttribute('class');if(cls)svg.setAttribute('class',cls);
    svg.innerHTML=ICONS[name]||'<circle cx="12" cy="12" r="9" stroke-dasharray="2 3"/>';
    el.replaceWith(svg);
  });
}
var refreshIcons=renderIcons;

/* ========== 主题 ========== */
function applyThemeUI(){var t=document.documentElement.dataset.theme;
  $$('.sw-btn').forEach(function(b){b.classList.toggle('on',b.dataset.setTheme===t)});}
function setTheme(t){document.documentElement.dataset.theme=t;
  try{localStorage.setItem('moteful-theme',t);localStorage.setItem('mf-theme',t)}catch(e){}
  applyThemeUI();}

/* ========== Toast ========== */
function toast(msg,type){type=type||'info';
  var ic={success:'check-circle',danger:'x-circle',warning:'alert-triangle',info:'info'}[type]||'info';
  var host=$('#toasts');
  if(!host){host=document.createElement('div');host.id='toasts';document.body.appendChild(host);}
  var t=document.createElement('div');t.className='toast t-'+type;
  t.innerHTML='<i data-lucide="'+ic+'"></i><span>'+msg+'</span>';
  host.appendChild(t);refreshIcons();
  requestAnimationFrame(function(){requestAnimationFrame(function(){t.classList.add('in')})});
  setTimeout(function(){t.classList.remove('in');t.classList.add('out');setTimeout(function(){t.remove()},260)},3200);}

/* ========== 弹层 / 模态 / 抽屉 ========== */
function closePops(){$$('.pop.open').forEach(function(p){p.classList.remove('open')})}
function openModal(id){var m=$('#'+id);if(m){m.classList.add('open');document.body.style.overflow='hidden'}}
function closeModal(m){m.classList.remove('open');document.body.style.overflow=''}
function openDrawer(id){var d=$('#'+id);if(d){d.classList.add('open');document.body.style.overflow='hidden'}}
function closeDrawer(d){d.classList.remove('open');document.body.style.overflow=''}
function setP(v,bar,num){var b=bar||$('#pBar'),n=num||$('#pNum');
  if(b){b.style.setProperty('--p',v+'%');b.style.width=v+'%'}if(n)n.textContent=v+'%';}
function copyText(t,btn){var label=btn&&btn.querySelector('.copy-label');var old=label?label.textContent:'';
  var done=function(){if(label){label.textContent='已复制 ✓';setTimeout(function(){label.textContent=old},1400)}};
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(done,done)}
  else{var ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();
    try{document.execCommand('copy')}catch(e){}ta.remove();done();}}

/* ========== 语种切换 ========== */
var LANG_KEYS=['moteful-lang','mf-lang','lang','language','locale','i18n-lang'];
function readLang(){var v=null;
  try{for(var i=0;i<LANG_KEYS.length;i++){v=localStorage.getItem(LANG_KEYS[i]);if(v)break;}}catch(e){}
  if(!v)v=(document.documentElement.lang==='en')?'en':'zh';
  return v;}
function saveLang(code){try{for(var i=0;i<LANG_KEYS.length;i++)localStorage.setItem(LANG_KEYS[i],code);}catch(e){}}
function callI18N(code){
  var cands=[
    window.I18N&&window.I18N.setLang, window.i18n&&window.i18n.setLang,
    window.applyLang, window.setLang, window.switchLang, window.changeLang
  ];
  for(var i=0;i<cands.length;i++){
    if(typeof cands[i]==='function'){try{cands[i](code);return true}catch(e){}}
  }
  return false;}
function setLang(code){
  saveLang(code);
  document.documentElement.lang=(code==='zh'?'zh':'en');
  $$('.lang-label').forEach(function(lb){lb.textContent=(code==='en'?'English':'简体中文')});
  if(!callI18N(code)){location.reload();}
}

/* ================= 自动绑定 ================= */
$$('.sw-btn').forEach(function(b){on(b,'click',function(){setTheme(b.dataset.setTheme)})});
$$('[data-pop]').forEach(function(btn){on(btn,'click',function(e){e.stopPropagation();
  var w=btn.closest('.pop'),was=w.classList.contains('open');
  closePops();if(!was)w.classList.add('open');})});
on(document,'click',closePops);
$$('.select-list li').forEach(function(li){on(li,'click',function(){
  var sel=li.closest('.select');
  $$('.select-list li',sel).forEach(function(x){x.classList.remove('on')});
  li.classList.add('on');
  var lb=$('.select-label',sel);if(lb)lb.textContent=li.textContent.trim();
  sel.classList.remove('open');})});
$$('.lang-item').forEach(function(li){on(li,'click',function(){
  var pop=li.closest('.pop');pop.classList.remove('open');
  setLang(li.dataset.lang||'zh');})});
$$('.lang-label').forEach(function(lb){lb.textContent=(readLang()==='en'?'English':'简体中文')});
$$('.exp-head').forEach(function(h){on(h,'click',function(){
  var c=h.closest('.exp-card');h.setAttribute('aria-expanded',c.classList.toggle('open'));})});
$$('.modal [data-close]').forEach(function(b){on(b,'click',function(e){closeModal(e.target.closest('.modal'))})});
$$('[data-dclose]').forEach(function(b){on(b,'click',function(e){closeDrawer(e.target.closest('.drawer'))})});
on(document,'keydown',function(e){if(e.key==='Escape'){
  $$('.modal.open').forEach(closeModal);$$('.drawer.open').forEach(closeDrawer);closePops();}});
$$('[data-tabs]').forEach(function(t){var bs=$$('.tab',t);
  bs.forEach(function(b){on(b,'click',function(){bs.forEach(function(x){x.classList.remove('on')});b.classList.add('on');})})});
$$('[data-pager]').forEach(function(p){var bs=$$('.pg',p);
  bs.forEach(function(b){on(b,'click',function(){if(b.querySelector('svg'))return;
    bs.forEach(function(x){x.classList.remove('on')});b.classList.add('on');})})});
$$('.step').forEach(function(s){var out=$('.step-val',s),min=+(s.dataset.min||0),max=+(s.dataset.max||99);
  $$('.step-btn',s).forEach(function(b){on(b,'click',function(){
    out.textContent=Math.max(min,Math.min(max,+out.textContent+(+b.dataset.step)));})})});
$$('.slider').forEach(function(sl){on(sl,'input',function(){
  sl.style.setProperty('--p',sl.value+'%');
  var out=$('#'+(sl.dataset.out||''))||sl.parentElement.querySelector('.slider-out');
  if(out)out.textContent=(sl.dataset.label||'value')+': '+sl.value;})});
$$('.dropzone').forEach(function(dz){
  ['dragenter','dragover'].forEach(function(ev){on(dz,ev,function(e){e.preventDefault();dz.classList.add('drag')})});
  ['dragleave','drop'].forEach(function(ev){on(dz,ev,function(e){e.preventDefault();dz.classList.remove('drag')})});
  on(dz,'drop',function(){toast('已接收文件 · 本地处理','success')});
  on(dz,'keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();dz.click();}})});
$$('.alert-x').forEach(function(b){on(b,'click',function(){
  var a=b.closest('.alert');a.classList.add('gone');setTimeout(function(){a.remove()},220);})});
$$('.copy-btn').forEach(function(b){on(b,'click',function(){
  var box=b.closest('.codebox');var code=box&&box.querySelector('.code-body');
  if(code)copyText(code.innerText,b);})});
var toTop=$('#toTop');
if(toTop){on(window,'scroll',function(){toTop.classList.toggle('show',scrollY>600)},{passive:true});
  on(toTop,'click',function(){scrollTo({top:0,behavior:'smooth'})});}
$$('.dock').forEach(function(dock){var canvas=dock.closest('.float-canvas');if(!canvas)return;
  var S=48,drag=false;
  if(!dock.style.left){var r0=canvas.getBoundingClientRect();
    dock.style.left=(r0.width-S-8)+'px';dock.style.top=((r0.height-S)/2)+'px';}
  on(dock,'pointerdown',function(e){drag=true;dock.setPointerCapture(e.pointerId);dock.classList.add('drag')});
  on(dock,'pointermove',function(e){if(!drag)return;var r=canvas.getBoundingClientRect();
    dock.style.left=Math.max(0,Math.min(r.width-S,e.clientX-r.left-S/2))+'px';
    dock.style.top=Math.max(0,Math.min(r.height-S,e.clientY-r.top-S/2))+'px';});
  var drop=function(){if(!drag)return;drag=false;dock.classList.remove('drag');
    var r=canvas.getBoundingClientRect(),x=parseFloat(dock.style.left)||0;
    dock.style.transition='left var(--dur-slow) var(--spring)';
    dock.style.left=(x<r.width/2?8:r.width-S-8)+'px';
    setTimeout(function(){dock.style.transition=''},350);};
  on(dock,'pointerup',drop);on(dock,'pointercancel',drop);});
var cio=new IntersectionObserver(function(es){es.forEach(function(e){if(!e.isIntersecting)return;
  cio.unobserve(e.target);var b=e.target,end=+b.dataset.count,t0=performance.now(),D=900;
  (function f(t){var k=Math.min(1,(t-t0)/D);
    b.textContent=Math.round(end*(1-Math.pow(1-k,3))).toLocaleString();
    if(k<1)requestAnimationFrame(f)})(t0);})},{threshold:.6});
$$('b[data-count]').forEach(function(b){cio.observe(b)});
var sio=new IntersectionObserver(function(es){es.forEach(function(e){
    if(e.isIntersecting){e.target.classList.add('go');sio.unobserve(e.target)}})},{threshold:.2});
$$('[data-stagger]').forEach(function(el){sio.observe(el)});
$$('[data-year]').forEach(function(el){el.textContent=new Date().getFullYear()});

window.MF={toast:toast,openModal:openModal,closeModal:closeModal,openDrawer:openDrawer,
  closeDrawer:closeDrawer,setTheme:setTheme,setLang:setLang,setP:setP,refreshIcons:refreshIcons,copyText:copyText,ICONS:ICONS};
window.toast=toast;window.openModal=openModal;window.openDrawer=openDrawer;
window.closeDrawer=closeDrawer;window.setP=setP;window.setTheme=setTheme;window.setLang=setLang;

applyThemeUI();renderIcons();
})();