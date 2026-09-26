/*!
 * Moteful 分享体系（V1.4）— 通用分享面板 + 参数 URL 序列化/解析
 * 纯前端、零外部请求、零上传。复用 moteful.js 的 drawer / toast / data-lucide 图标。
 *
 * 功能（对应设计文档 F-01…F-13）：
 *   - 三层入口：结果区主入口（data-share-open）、顶栏次入口（data-share-topbar）、
 *     移动端抽屉入口（data-share-entry），全部条件显示，share.js 加载页自动生效
 *   - 分享面板：底部抽屉（≤768px）→ 居中 modal（≥768px），复用 drawer 组件
 *   - 动作：系统分享（navigator.share，不支持隐藏）/ 复制链接 / 复制带配置链接 /
 *     生成二维码（复用 qrcode-core.js 的 MotefulQREncoder）
 *   - 参数 URL：页面注册 schema（PARAMS）+ 钩子（register）后，
 *     序列化当前参数到 query string，打开链接自动套用并提示
 *
 * 安全红线（8.2.1）：URL 参数一律视为不可信输入——数值范围校验、枚举白名单、
 * 文本类参数 base64 传递，渲染统一走 textContent / input.value，禁止拼接 innerHTML。
 */
(function () {
  'use strict';

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  /* ---------- i18n（复用 i18n.js 的 window.t；未就绪时降级为键名） ---------- */
  function tr(key) {
    if (typeof window.t === 'function') {
      var s = window.t(key);
      if (s !== key) return s;
    }
    var d = (window.MOTEFUL_I18N || {})[(window.currentLang === 'zh' ? 'zh' : 'en')] || {};
    return (d[key] != null) ? d[key] : key;
  }

  /* ---------- base64url（文本参数超长安全传递；URL 安全字符集，去 = 填充） ---------- */
  function b64UrlEncode(s) {
    try {
      var b = btoa(unescape(encodeURIComponent(String(s))));
      return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    } catch (e) { return ''; }
  }
  function b64UrlDecode(s) {
    if (!s) return null;
    try {
      var b = String(s).replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      return decodeURIComponent(escape(atob(b)));
    } catch (e) { return null; }
  }

  /* ---------- 参数 schema（F-06 序列化 / F-07 解析） ----------
     type: int（范围校验）| enum（白名单）| str（base64）
     core: 序列化结果超过 200 字符时优先保留的键（按数组顺序） */
  var PARAMS = {
    'image-tool': {
      q: { type: 'int', min: 1, max: 100 },
      f: { type: 'enum', values: ['keep', 'jpeg', 'png', 'webp'] },
      s: { type: 'enum', values: ['none', 'percent', 'longest', 'exact'] },
      p: { type: 'int', min: 1, max: 400 },
      l: { type: 'int', min: 1, max: 20000 },
      w: { type: 'int', min: 1, max: 20000 },
      h: { type: 'int', min: 1, max: 20000 },
      r: { type: 'int', min: 0, max: 270 },
      fh: { type: 'int', min: 0, max: 1 },
      fv: { type: 'int', min: 0, max: 1 },
      c: { type: 'enum', values: ['none', 'ratio', 'free'] },
      cr: { type: 'enum', values: ['1:1', '4:3', '3:2', '16:9'] },
      mt: { type: 'int', min: 0, max: 20000 },
      mb: { type: 'int', min: 0, max: 20000 },
      ml: { type: 'int', min: 0, max: 20000 },
      mr: { type: 'int', min: 0, max: 20000 },
      core: ['q', 'f', 'w', 'h']
    },
    'stitch': {
      d: { type: 'enum', values: ['vertical', 'horizontal'] },
      g: { type: 'int', min: 0, max: 100 },
      bg: { type: 'enum', values: ['#ffffff', '#000000', 'transparent'] },
      core: ['d', 'g', 'bg']
    },
    'annotate': {
      wm: { type: 'str' },
      b: { type: 'int', min: 4, max: 40 },
      core: ['wm', 'b']
    },
    'qrcode': {
      ec: { type: 'enum', values: ['L', 'M', 'Q', 'H'] },
      s: { type: 'enum', values: ['256', '512', '1024'] },
      c: { type: 'enum', values: ['classic', 'custom'] },
      core: ['ec', 's', 'c']
    }
  };

  var URL_LIMIT = 200;      // 8.2 URL 长度限制
  var STR_LIMIT = 500;      // 文本参数解码后上限，防注入超长 payload

  /* 当前页面对应的 schema 名（按路径匹配） */
  function currentPage() {
    var p = location.pathname || '';
    if (/image-tool\.html/i.test(p)) return 'image-tool';
    if (/stitch\.html/i.test(p)) return 'stitch';
    if (/annotate\.html/i.test(p)) return 'annotate';
    if (/qrcode\.html/i.test(p)) return 'qrcode';
    return '';
  }

  function encodeVal(def, v) {
    if (def.type === 'str') return b64UrlEncode(v);
    return String(v);
  }

  /* ---------- 解析：读取 URL 参数 → 校验 → {had, params} ---------- */
  function parseUrlParams(name) {
    var schema = PARAMS[name];
    var params = {};
    var had = false;
    if (!schema || !location.search) return { had: had, params: params };
    var usp;
    try { usp = new URLSearchParams(location.search); } catch (e) { return { had: had, params: params }; }
    Object.keys(schema).forEach(function (k) {
      if (k === 'core') return;
      var v = usp.get(k);
      if (v == null || v === '') return;
      var def = schema[k], val = null;
      if (def.type === 'int') {
        var n = parseInt(v, 10);
        if (isFinite(n) && n >= def.min && n <= def.max) val = n;
      } else if (def.type === 'enum') {
        if (def.values.indexOf(v) >= 0) val = v;
      } else if (def.type === 'str') {
        var s = b64UrlDecode(v);
        if (s !== null && s.length <= STR_LIMIT) val = s;
      }
      if (val !== null) { params[k] = val; had = true; }
    });
    return { had: had, params: params };
  }

  /* ---------- 站点正式 URL（V1.4.1：分享链接用 https://moteful.app/...，禁用 file:///本地路径） ---------- */
  function metaContent(name) {
    var m = document.querySelector('meta[name="' + name + '"]');
    return (m && m.content) ? String(m.content) : '';
  }
  function siteBase() {
    var b = metaContent('moteful-siteurl').replace(/\/+$/, '');
    if (b) return b;
    // 兜底：线上用 origin；file:// 本地预览时给站点正式域名
    return location.protocol === 'file:' ? 'https://moteful.app' : location.origin;
  }
  function pagePath() {
    return metaContent('moteful-pagepath').replace(/^\/+|\/+$/g, '');
  }
  function pageBase() {
    var b = siteBase(), p = pagePath();
    return p ? b + '/' + p : b;
  }

  /* ---------- 序列化：拼"当前分享 URL"（F-05 与 F-08 同源） ---------- */
  function buildShareUrl(name, limit) {
    var schema = PARAMS[name];
    var hook = hooks[name] || {};
    var base = pageBase();
    function collect(keys) {
      var pairs = [];
      keys.forEach(function (k) {
        if (k === 'core') return;
        var v = (hook.getParams && hook.getParams()) ? hook.getParams()[k] : null;
        if (v == null || v === '') return;
        pairs.push(k + '=' + encodeURIComponent(encodeVal(schema[k], v)));
      });
      return pairs;
    }
    var keys = Object.keys(schema || {});
    var pairs = collect(keys);
    var qs = pairs.join('&');
    if (qs.length > (limit || URL_LIMIT)) {
      pairs = collect((schema && schema.core) || []);
      qs = pairs.join('&');
    }
    return qs ? base + '?' + qs : base;
  }

  /* ---------- 页面钩子注册 ---------- */
  var hooks = {};
  function register(name, h) { hooks[name] = h || {}; }

  /* ---------- 可分享状态（顶栏次入口条件高亮） ---------- */
  var shareable = true;
  function setShareable(v) {
    shareable = !!v;
    $$('[data-share-topbar]').forEach(function (b) {
      b.classList.toggle('share-on', shareable);
      b.setAttribute('aria-disabled', shareable ? 'false' : 'true');
    });
  }

  /* ---------- 面板 DOM（复用 drawer 组件，禁止自造平行组件） ---------- */
  var panel = null;
  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.className = 'drawer bottom share-drawer';
    panel.id = 'sharePanel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', tr('share_title'));
    panel.innerHTML =
      '<div class="drawer-mask" data-share-close></div>' +
      '<div class="drawer-panel">' +
        '<div class="drawer-head">' +
          '<h3 data-i18n="share_title">' + escHtml(tr('share_title')) + '</h3>' +
          '<button type="button" class="btn btn-icon btn-sm" data-share-close aria-label="close"><i data-lucide="x"></i></button>' +
        '</div>' +
        '<div class="drawer-body share-body">' +
          '<button type="button" class="btn btn-primary share-native" data-share-native hidden><i data-lucide="share-2"></i><span data-i18n="share_native">' + escHtml(tr('share_native')) + '</span></button>' +
          '<div class="row share-2col">' +
            '<button type="button" class="btn btn-secondary" data-share-copy><i data-lucide="link"></i><span data-i18n="share_copy_link">' + escHtml(tr('share_copy_link')) + '</span></button>' +
            '<button type="button" class="btn btn-secondary" data-share-copycfg><i data-lucide="settings"></i><span data-i18n="share_copy_config">' + escHtml(tr('share_copy_config')) + '</span></button>' +
          '</div>' +
          '<button type="button" class="btn btn-ghost btn-sm share-qr-btn" data-share-qr hidden><i data-lucide="qr-code"></i><span data-i18n="share_generate_qrcode">' + escHtml(tr('share_generate_qrcode')) + '</span></button>' +
          '<div class="share-qr-wrap" data-share-qr-wrap hidden>' +
            '<canvas class="share-qr-canvas" data-share-qr-canvas></canvas>' +
            '<p class="share-qr-tip" data-i18n="share_qrcode">' + escHtml(tr('share_qrcode')) + '</p>' +
          '</div>' +
          '<input class="share-link-input" data-share-link type="text" readonly hidden aria-label="' + escHtml(tr('share_copy_link')) + '">' +
        '</div>' +
      '</div>';
    document.body.appendChild(panel);
    // 关闭：mask / 关闭按钮 / Esc（Esc 由 moteful.js 全局处理，面板 class 移除即复位）
    $$('[data-share-close]', panel).forEach(function (b) {
      b.addEventListener('click', close);
    });
    // 系统分享（不支持时保持隐藏）
    if (canNativeShare()) {
      $('[data-share-native]', panel).hidden = false;
    }
    // 二维码：仅在 qrcode-core.js 已加载时可用
    if (window.MotefulQREncoder) {
      $('[data-share-qr]', panel).hidden = false;
    }
    // 面板动作
    $('[data-share-native]', panel).addEventListener('click', nativeShare);
    $('[data-share-copy]', panel).addEventListener('click', function () { copyUrl(false); });
    $('[data-share-copycfg]', panel).addEventListener('click', function () { copyUrl(true); });
    $('[data-share-qr]', panel).addEventListener('click', generateQr);
    // 初始文案（i18n.js 的 applyLang 会随语言切换刷新 [data-i18n]）
    if (window.MF && MF.refreshIcons) MF.refreshIcons();
    return panel;
  }

  /* HTML 实体转义（安全红线：禁止把不可信文本拼接进 innerHTML） */
  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function open() {
    ensurePanel();
    resetQr();
    panel.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function close() {
    if (!panel) return;
    panel.classList.remove('open');
    document.body.style.overflow = '';
  }

  /* 面板每次打开重置为状态 A（二维码未生成） */
  function resetQr() {
    if (!panel) return;
    var wrap = $('[data-share-qr-wrap]', panel);
    if (wrap) wrap.hidden = true;
    var link = $('[data-share-link]', panel);
    if (link) { link.hidden = true; link.value = ''; }
  }

  /* ---------- 复制（F-04 / F-08，含降级） ---------- */
  function copyText(text, okKey) {
    function done(ok) {
      toast(ok ? tr(okKey) : tr('share_copy_fallback'), ok ? 'success' : 'warning');
    }
    function fallback() {
      var inp = panel && $('[data-share-link]', panel);
      if (inp) { inp.value = text; inp.hidden = false; inp.select(); }
      done(false);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else {
      fallback();
    }
  }
  function copyUrl(withConfig) {
    var name = currentPage();
    var url = withConfig ? buildShareUrl(name) : pageBase();
    copyText(url, withConfig ? 'share_copied_config' : 'share_copied');
  }

  /* ---------- 系统分享（F-03） ---------- */
  function canNativeShare() {
    return !!(navigator.share && typeof navigator.share === 'function');
  }
  function nativeShare() {
    var name = currentPage();
    var hook = hooks[name] || {};
    var text = (hook.shareText && hook.shareText()) || '';
    var url = buildShareUrl(name);
    navigator.share({ title: tr('share_title'), text: text, url: url })['catch'](function () {});
  }

  /* ---------- 二维码（F-05：编码 = 含参完整 URL，与 F-08 同源） ---------- */
  function generateQr() {
    if (!window.MotefulQREncoder) return;
    var url = buildShareUrl(currentPage(), 90);  // 二维码专用限长：超 90 字符降级 core 参数，保证版本低、模块大可扫
    var res = window.MotefulQREncoder.encode(url, 'M');
    if (!res || res.error) { toast(tr('share_copy_fallback'), 'warning'); return; }
    var wrap = $('[data-share-qr-wrap]', panel);
    var canvas = $('[data-share-qr-canvas]', panel);
    if (!wrap || !canvas) return;
    var quiet = 4;
    var n = res.size + quiet * 2;
    var outPx = 512;  // 高像素输出：截图/保存场景清晰，屏幕显示由 CSS 控制
    var cell = outPx / n;
    canvas.width = outPx; canvas.height = outPx;
    canvas.setAttribute('aria-label', tr('share_qrcode'));
    canvas.setAttribute('alt', tr('share_qrcode'));
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, outPx, outPx);
    ctx.fillStyle = '#0F172A';
    for (var r = 0; r < res.size; r++) for (var c = 0; c < res.size; c++) {
      if (res.modules[r][c]) {
        ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
    wrap.hidden = false;
    toast(tr('share_generate_qrcode'), 'success');
  }

  /* ---------- URL 参数套用（F-07 / F-13，DOM 事件驱动，无需侵入页面状态） ----------
     打开带参链接时自动套用配置并轻提示"已应用分享的配置"。 */
  var APPLY = {
    'stitch': function (p) {
      if (p.d) {
        var d = $('input[name="stitchDir"][value="' + p.d + '"]');
        if (d && !d.checked) d.click();
      }
      if (p.g != null) {
        var g = $('#stitchGap');
        if (g) {
          g.value = String(p.g);
          g.dispatchEvent(new Event('input', { bubbles: true }));
          g.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      if (p.bg) {
        var b = $('input[name="stitchBg"][value="' + p.bg + '"]');
        if (b && !b.checked) b.click();
      }
    },
    'annotate': function (p) {
      if (p.wm != null) {
        var m = $('input[name="annotateMode"][value="wm"]');
        if (m && !m.checked) m.click();
        var wm = $('#annotateWmContent');
        if (wm) {
          wm.value = p.wm;
          wm.dispatchEvent(new Event('input', { bubbles: true }));
          wm.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      if (p.b != null) {
        var m2 = $('input[name="annotateMode"][value="ms"]');
        if (m2 && !m2.checked) m2.click();
        var blk = $('#annotateMsBlockSlider');
        if (blk) {
          blk.value = String(p.b);
          blk.style.setProperty('--p', Math.max(0, Math.min(100, ((p.b - 4) / 36) * 100)) + '%');
          blk.dispatchEvent(new Event('input', { bubbles: true }));
          blk.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    },
    'qrcode': function (p) {
      if (p.ec) {
        var e = $('input[name="qrEcc"][value="' + p.ec + '"]');
        if (e && !e.checked) e.click();
      }
      if (p.s) {
        var sz = $('input[name="qrSize"][value="' + p.s + '"]');
        if (sz && !sz.checked) sz.click();
      }
      if (p.c) {
        var c = $('input[name="qrColor"][value="' + p.c + '"]');
        if (c && !c.checked) c.click();
      }
    }
  };

  function domApply() {
    var page = currentPage();
    if (!page) return;
    var sp = parseUrlParams(page);
    if (!sp.had) return;
    var app = APPLY[page];
    if (app) {
      app(sp.params);
      toast(tr('share_applied_config'), 'success');
    }
  }

  function notifyApplied() {
    toast(tr('share_applied_config'), 'success');
  }

  /* ---------- 入口绑定 ---------- */
  function bindEntries() {
    // 仅工具页（有分享配置 schema）显示顶栏/抽屉分享入口；非工具页保持隐藏
    var shareablePage = (currentPage() in PARAMS);
    // 顶栏次入口（≤480px 由 share.css 隐藏，收进抽屉；V1.4.1 未操作时也可分享当前网址）
    $$('[data-share-topbar]').forEach(function (b) {
      b.hidden = !shareablePage;
      b.addEventListener('click', function () { open(); });
    });
    // 移动端抽屉入口
    $$('[data-share-entry]').forEach(function (b) {
      b.hidden = !shareablePage;
      b.addEventListener('click', open);
    });
    // 结果区主入口
    $$('[data-share-open]').forEach(function (b) {
      b.addEventListener('click', open);
    });
    setShareable(shareable);
  }

  /* ---------- 初始化 ---------- */
  function init() {
    bindEntries();
    document.addEventListener('DOMContentLoaded', domApply);
    // 语言切换：i18n.js 的 applyLang 会刷新面板 [data-i18n] 文案，无需重复绑定
  }

  window.MotefulShare = {
    PARAMS: PARAMS,
    open: open,
    close: close,
    register: register,
    parseUrlParams: parseUrlParams,
    buildShareUrl: buildShareUrl,
    setShareable: setShareable,
    notifyApplied: notifyApplied,
    copyUrl: copyUrl,
    tr: tr
  };

  init();
})();
