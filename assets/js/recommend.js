(function () {
  'use strict';
  function tr(key) {
    var d = (window.DICT && window.DICT[window.currentLang]) || {};
    return (d[key] != null) ? d[key] : key;
  }
  var popup = null, msg = null, lastAction = null;

  /* 弹窗内静态文案「自持翻译」。
     为什么必须自己来：站点 i18n 引擎（assets/i18n/i18n.js）是无 defer 的同步脚本，
     且位置在弹窗节点之前，它执行 applyLang() 扫描 [data-i18n] 时 #rec-popup 还没进 DOM，
     于是弹窗内所有 data-i18n 永远停在 HTML 兜底文案（表现为卡片显示页面路径、赞助提示为空）。
     这里在弹窗首次取用时补一次、每次 show() 前补一次、语言切换时再补一次，保证文案始终正确。 */
  function applyText() {
    if (!popup) return;
    var d = (window.DICT && window.DICT[window.currentLang]) || {};
    popup.querySelectorAll('[data-i18n]').forEach(function (el) {
      if (el === msg) return; /* 成功标题要拼 {action}，由 show() 动态设置，不做静态覆盖 */
      var k = el.getAttribute('data-i18n');
      if (d[k] != null) el.textContent = d[k];
    });
    popup.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      var k = el.getAttribute('data-i18n-aria');
      if (d[k] != null) el.setAttribute('aria-label', d[k]);
    });
    setMsg();
  }

  /* 成功标题：动词由 show() 传入的行动键决定，语言切换时同步刷新。
     注意 recMsg 带着 data-i18n="rec_done"，其值是 "{action}成功" 模板；
     语言切换时 i18n 引擎会把占位符字面量写进标题，所以这里必须再纠正一次。 */
  function setMsg() {
    if (msg && lastAction) msg.textContent = tr('rec_done').replace('{action}', tr(lastAction));
  }

  function els() {
    if (popup) return popup;
    popup = document.getElementById('rec-popup');
    if (!popup) return null;
    msg = document.getElementById('recMsg');
    popup.querySelectorAll('[data-rec-close]').forEach(function (b) { b.addEventListener('click', hide); });
    var mask = popup.querySelector('.rec-mask'); if (mask) mask.addEventListener('click', hide);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && popup.getAttribute('aria-hidden') === 'false') hide();
    });
    document.addEventListener('moteful:langchange', applyText);
    applyText();
    return popup;
  }
  function show(opts) {
    var p = els(); if (!p) return;
    if (p.getAttribute('aria-hidden') === 'false') return; // 已打开则不重复弹（防单张连续下载刷屏）
    opts = opts || {};
    lastAction = opts.actionKey || 'rec_export';
    applyText();
    setMsg();
    p.setAttribute('aria-hidden', 'false');
    p.classList.add('rec-open');
  }
  function hide() {
    var p = els(); if (!p) return;
    p.setAttribute('aria-hidden', 'true');
    p.classList.remove('rec-open');
  }
  window.Moteful = window.Moteful || {};
  window.Moteful.recommend = { show: show, hide: hide };
})();
