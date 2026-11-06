/**
 * Moteful 更新日志卡片渲染脚本
 *
 * 功能：
 * 1. 根据当前语言选择对应数据（CHANGELOG_ZH / CHANGELOG_EN / CHANGELOG_ES）
 * 2. 语种降级：本语种数据缺失时，中文地区用中文，其余用英文（英文是站点默认语言）
 * 3. 只显示最近 3 个版本，每个版本最多 3 条要点
 */

(function () {
  'use strict';

  /**
   * 获取当前站点语言（与全站 i18n 保持一致）
   * i18n.js 是同步脚本，先于本脚本跑完判定（预置结果 → localStorage → 浏览器语言），
   * 所以这里直接复用它的口径，避免两套判定互相不一致。
   */
  function getCurrentLang() {
    var v = window.currentLang || window.MF_LANG;
    if (typeof window.normLang === 'function') return window.normLang(v);
    if (v === 'zh' || v === 'es') return v;
    if (v === 'en') return 'en';
    var saved = localStorage.getItem('moteful-lang');
    if (saved === 'zh' || saved === 'es') return saved;
    if (saved === 'en') return 'en';
    var nav = (navigator.language || '').toLowerCase();
    return nav.indexOf('zh') >= 0 ? 'zh' : (nav.indexOf('es') === 0 ? 'es' : 'en');
  }

  /**
   * 根据语言获取更新日志数据（缺本语种数据时按地区降级）
   */
  function getChangelogData(lang) {
    if (lang === 'es' && typeof CHANGELOG_ES !== 'undefined') return CHANGELOG_ES;
    if (lang === 'zh' && typeof CHANGELOG_ZH !== 'undefined') return CHANGELOG_ZH;
    if (lang === 'en' && typeof CHANGELOG_EN !== 'undefined') return CHANGELOG_EN;

    // 降级：中文地区用中文，其余一律用英文（英文为站点默认语言）
    if (navigator.language && navigator.language.toLowerCase().indexOf('zh') === 0 && typeof CHANGELOG_ZH !== 'undefined') return CHANGELOG_ZH;
    if (typeof CHANGELOG_EN !== 'undefined') return CHANGELOG_EN;
    if (typeof CHANGELOG_ZH !== 'undefined') return CHANGELOG_ZH;

    return []; // 都没有就返回空
  }

  /**
   * 渲染更新日志到首页卡片
   */
  function renderChangelog(changelog) {
    var container = document.getElementById('changelog-list');
    if (!container) return;

    // 只取最近 3 个版本（数据已经按时间倒序排列）
    var recent = changelog.slice(0, 3);
    if (recent.length === 0) {
      container.style.display = 'none'; // 空状态不显示
      return;
    }

    var html = '';
    recent.forEach(function (item, idx) {
      // 渲染版本头：版本标签 + 日期
      html += '' +
        '<div class="version-item">' +
        '  <span class="tag t-blue mono">' + item.version + '</span>' +
        '  <span class="muted" style="margin-left:8px">' + item.date + '</span>';

      // 渲染各个分类（新增 / 优化 / 站点搭建 等）
      if (item.sections && item.sections.length > 0) {
        item.sections.forEach(function (section, sIdx) {
          var points = section.points || [];
          var pointsHtml = points.map(function (p) {
            return '<li>' + p + '</li>';
          }).join('');

          var marginTop = sIdx === 0 ? 'margin-top:6px' : 'margin-top:12px';

          html += '' +
            '  <div style="' + marginTop + ';font-weight:500">' + section.title + '</div>' +
            '  <ul class="version-points" style="margin-top:4px;padding-left:20px">' +
                 pointsHtml +
            '  </ul>';
        });
      }

      html += '</div>';

      // 不是最后一个就加分隔线
      if (idx < recent.length - 1) {
        html += '<hr class="divider">';
      }
    });

    container.innerHTML = html;
  }

  /**
   * 初始化
   */
  function init() {
    var lang = getCurrentLang();
    var changelog = getChangelogData(lang);
    renderChangelog(changelog);
  }

  // DOM 加载完成后执行
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 监听站点语言切换事件，切换时重新渲染更新日志
  document.addEventListener('moteful:langchange', function (e) {
    var lang = (e.detail && e.detail.lang) || getCurrentLang();
    var changelog = getChangelogData(lang);
    renderChangelog(changelog);
  });
})();
