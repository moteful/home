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
  function applyLang(l) {
    currentLang = l; window.currentLang = l;
    document.documentElement.lang = (l === 'zh') ? 'zh-CN' : 'en';
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
    var titleEl = document.querySelector('title[data-i18n]');
    if (titleEl) { var tk = titleEl.getAttribute('data-i18n'); if (d[tk] != null) titleEl.textContent = d[tk]; }
    refreshThemeLabel();
    var langLabel = document.getElementById('langLabel');
    if (langLabel) langLabel.textContent = d[l === 'zh' ? 'lang_to_en' : 'lang_to_zh'];
    try { localStorage.setItem('moteful-lang', l); } catch (e) {}
    /* 通知各页面语言已切换（动态生成的内容可监听此事件重新渲染） */
    try { document.dispatchEvent(new CustomEvent('moteful:langchange', { detail: { lang: l } })); } catch (e) {}
  }
  window.applyLang = applyLang;
  /* 语种优先取 head 预置脚本的结果（window.MF_LANG，首帧前已判定）；预置脚本缺失时回退原本判定逻辑 */
  var savedLang = window.MF_LANG;
  if (savedLang !== 'zh' && savedLang !== 'en') {
    try { savedLang = localStorage.getItem('moteful-lang'); } catch (e) {}
    if (!savedLang) { savedLang = (navigator.language && navigator.language.toLowerCase().indexOf('zh') >= 0) ? 'zh' : 'en'; }
  }
  applyLang(savedLang === 'zh' ? 'zh' : 'en');
  /* 换词完成，解除 head 预置脚本挂的「待译暂遮」标记（配套样式见 assets/css/missing_styles_proposal.css） */
  document.documentElement.removeAttribute('data-i18n-pending');
  var langBtn = document.getElementById('langBtn');
  if (langBtn) {
    langBtn.addEventListener('click', function () {
      var cur = document.documentElement.lang === 'zh-CN' ? 'zh' : 'en';
      applyLang(cur === 'zh' ? 'en' : 'zh');
    });
  }
})();
