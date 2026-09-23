/**
 * Moteful 更新日志卡片渲染脚本
 *
 * 功能：
 * 1. 根据当前语言选择对应数据（CHANGELOG_ZH / CHANGELOG_EN）
 * 2. 语种降级：中文地区缺文件用中文，非中文地区缺文件用英文
 * 3. 只显示最近 3 个版本，每个版本最多 3 条要点
 */

(function () {
  'use strict';

  /**
   * 获取当前站点语言（与全站 i18n 保持一致）
   */
  function getCurrentLang() {
    // 优先用 i18n.js 设置的全局变量
    if (window.currentLang === 'zh' || window.currentLang === 'en') return window.currentLang;
    // 其次从 localStorage 读取
    var saved = localStorage.getItem('moteful-lang');
    if (saved === 'zh' || saved === 'en') return saved;
    // 默认跟随浏览器语言
    return navigator.language && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }

  /**
   * 根据语言获取更新日志数据
   * 降级规则：
   * - 当前语言有数据就用
   * - 中文地区（zh-CN / zh-TW / zh-HK）缺英文文件时用中文
   * - 非中文地区缺中文文件时用英文
   */
  function getChangelogData(lang) {
    // 当前语言有数据就用
    if (lang === 'zh' && typeof CHANGELOG_ZH !== 'undefined') return CHANGELOG_ZH;
    if (lang === 'en' && typeof CHANGELOG_EN !== 'undefined') return CHANGELOG_EN;

    // 降级：判断用户地区
    var isChineseRegion = navigator.language && navigator.language.toLowerCase().startsWith('zh');
    if (isChineseRegion && typeof CHANGELOG_ZH !== 'undefined') return CHANGELOG_ZH;
    if (!isChineseRegion && typeof CHANGELOG_EN !== 'undefined') return CHANGELOG_EN;

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
      // 每个版本最多显示 3 条要点
      var points = item.points.slice(0, 3);
      var pointsHtml = points.map(function (p) {
        return '<li>' + p + '</li>';
      }).join('');

      html += '' +
        '<div class="version-item">' +
        '  <span class="tag t-blue mono">' + item.version + '</span>' +
        '  <span class="muted" style="margin-left:8px">' + item.date + '</span>' +
        '  <div style="margin-top:4px;font-weight:500">' + item.title + '</div>' +
        '  <ul class="version-points" style="margin-top:6px;padding-left:20px">' +
             pointsHtml +
        '  </ul>' +
        '</div>';

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
