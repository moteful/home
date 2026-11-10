(function () {
  var M = window.MOTEFUL_I18N || { en: {}, zh: {} };
  window.DICT = M;
  var currentLang = 'en';
  window.currentLang = currentLang;
  /* JS 提示文案统一走 t(key, vars)：vars 用 {name} 占位替换 */
  window.t = function (key, vars) {
    var d = (M && M[currentLang]) || M.en || {};
    var s = d[key] != null ? d[key] : key;
    if (vars) { for (var k in vars) { s = s.split('{' + k + '}').join(vars[k]); } }
    return s;
  };
  function getThemeLabel(t) { var d = (M && M[currentLang]) || {}; return d['theme_state_' + t] || t; }
  window.getThemeLabel = getThemeLabel;
  function refreshThemeLabel() {
    var themeText = document.getElementById('themeText');
    if (themeText) { var cur = document.documentElement.getAttribute('data-theme') || 'system'; themeText.textContent = getThemeLabel(cur); }
  }
  window.refreshThemeLabel = refreshThemeLabel;
  /* 三语支持（V2.0.7 加西语）：语种码 → html lang 属性；下拉触发器上的当前语种名用母语自称 */
  var LANG_ATTR = { zh: 'zh-CN', en: 'en', es: 'es' };
  var LANG_NATIVE = { zh: '简体中文', en: 'English', es: 'Español' };
  function normLang(v) { return (v === 'zh' || v === 'es') ? v : 'en'; }
  window.normLang = normLang;
  function paintLangLabels() {
    var lb = document.querySelectorAll('.lang-label');
    for (var i = 0; i < lb.length; i++) lb[i].textContent = LANG_NATIVE[currentLang] || currentLang;
  }
  function applyLang(l) {
    l = normLang(l);
    currentLang = l; window.currentLang = l;
    document.documentElement.lang = LANG_ATTR[l];
    var d = (M && M[l]) || M.en || {};
    var els = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) { var k = els[i].getAttribute('data-i18n'); if (d[k] != null) els[i].textContent = d[k]; }
    // 悬停提示 title（铁律①：禁止硬编码，统一走集中源）
    var tEls = document.querySelectorAll('[data-i18n-title]');
    for (var j = 0; j < tEls.length; j++) { var tk = tEls[j].getAttribute('data-i18n-title'); if (d[tk] != null) tEls[j].setAttribute('title', d[tk]); }
    // 无障碍 aria-label（V0.2.2：与 title 同理走集中源）
    var aEls = document.querySelectorAll('[data-i18n-aria]');
    for (var a = 0; a < aEls.length; a++) { var ak = aEls[a].getAttribute('data-i18n-aria'); if (d[ak] != null) aEls[a].setAttribute('aria-label', d[ak]); }
    // 占位符 placeholder（输入提示，与 textContent 同理走集中源）
    var pEls = document.querySelectorAll('[data-i18n-ph]');
    for (var p = 0; p < pEls.length; p++) { var pk = pEls[p].getAttribute('data-i18n-ph'); if (d[pk] != null) pEls[p].setAttribute('placeholder', d[pk]); }
    // meta 标签 content（SEO 描述等，与 placeholder 同理走集中源）
    var cEls = document.querySelectorAll('[data-i18n-content]');
    for (var c = 0; c < cEls.length; c++) { var ck = cEls[c].getAttribute('data-i18n-content'); if (d[ck] != null) cEls[c].setAttribute('content', d[ck]); }
    var titleEl = document.querySelector('title[data-i18n]');
    if (titleEl) { var tk = titleEl.getAttribute('data-i18n'); if (d[tk] != null) titleEl.textContent = d[tk]; }
    refreshThemeLabel();
    paintLangLabels();
    try { localStorage.setItem('moteful-lang', l); } catch (e) {}
    /* 通知各页面语言已切换（动态生成的内容可监听此事件重新渲染） */
    try { document.dispatchEvent(new CustomEvent('moteful:langchange', { detail: { lang: l } })); } catch (e) {}
  }
  window.applyLang = applyLang;
  /* 语种优先取 head 预置脚本的结果（window.MF_LANG，首帧前已判定）；预置脚本缺失时回退原本判定逻辑 */
  var savedLang = window.MF_LANG;
  if (savedLang !== 'zh' && savedLang !== 'en' && savedLang !== 'es') {
    try { savedLang = localStorage.getItem('moteful-lang'); } catch (e) {}
    if (!savedLang) {
      var nav = (navigator.language || '').toLowerCase();
      savedLang = nav.indexOf('zh') >= 0 ? 'zh' : (nav.indexOf('es') === 0 ? 'es' : 'en');
    }
  }
  applyLang(savedLang);
  /* 换词完成，解除 head 预置脚本挂的「待译暂遮」标记（配套样式见 assets/css/missing_styles_proposal.css） */
  document.documentElement.removeAttribute('data-i18n-pending');
  /* moteful.js 是 defer 脚本，会在本脚本之后用「zh|en 二元」写法覆写 .lang-label；
     DOMContentLoaded 在所有 defer 脚本之后触发，这里复核一次，保证三语标签正确（不改只读的 moteful.js） */
  document.addEventListener('DOMContentLoaded', paintLangLabels);
})();
