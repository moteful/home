/*!
 * Moteful 二维码生成器 - 交互层（DOM）
 * 读取表单 → 调 MotefulQREncoder（核心）→ canvas 渲染 / PNG / SVG 导出。
 * 全部本地完成，零外部请求。
 */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }

  // 配色档
  var PALETTES = {
    classic: { fg: '#0F172A', bg: '#FFFFFF' },
    brand: { fg: '#0878B4', bg: '#FFFFFF' }
  };

  function themeColors() {
    var dark = document.documentElement.dataset.theme === 'dark';
    return dark ? { fg: '#F2FAFF', bg: '#0F172A' } : { fg: '#0F172A', bg: '#FFFFFF' };
  }

  function getChecked(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }

  // 按类型组装要编码的文本
  function assemble() {
    var type = getChecked('qrType') || 'text';
    if (type === 'text') return $('qrText').value;
    if (type === 'url') {
      var u = $('qrUrl').value.trim();
      if (!u) return '';
      if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
      return u;
    }
    if (type === 'wifi') {
      var ssid = $('qrSsid').value;
      var enc = getChecked('qrEnc') || 'WPA';
      var pass = $('qrPass').value;
      if (!ssid) return '';
      if (enc === 'nopass') return 'WIFI:T:nopass;S:' + esc(ssid) + ';H:false;;';
      return 'WIFI:T:' + enc + ';S:' + esc(ssid) + ';P:' + esc(pass) + ';H:false;;';
    }
    if (type === 'vcard') {
      var lines = ['BEGIN:VCARD', 'VERSION:3.0'];
      if ($('qrName').value) lines.push('FN:' + $('qrName').value);
      if ($('qrTel').value) lines.push('TEL:' + $('qrTel').value);
      if ($('qrEmail').value) lines.push('EMAIL:' + $('qrEmail').value);
      lines.push('END:VCARD');
      return lines.join('\n');
    }
    return '';
  }

  function esc(s) { return String(s).replace(/([\\;,:"'])/g, '\\$1'); }

  function palette() {
    var mode = getChecked('qrColor') || 'classic';
    if (mode === 'classic') return PALETTES.classic;
    if (mode === 'brand') return PALETTES.brand;
    if (mode === 'custom') {
      var fg = document.querySelector('.qr-swatch[data-fg].is-on');
      var bg = document.querySelector('.qr-swatch[data-bg].is-on');
      return { fg: fg ? fg.getAttribute('data-fg') : '#0F172A', bg: bg ? bg.getAttribute('data-bg') : '#FFFFFF' };
    }
    return themeColors(); // auto
  }

  // 类型切换：显示对应 pane
  function switchPane() {
    var type = getChecked('qrType') || 'text';
    document.querySelectorAll('[data-qr-pane]').forEach(function (p) {
      p.hidden = p.getAttribute('data-qr-pane') !== type;
    });
    document.querySelector('[data-qr-custom]').hidden = getChecked('qrColor') !== 'custom';
  }

  var lastResult = null;
  var lastText = '';

  function update() {
    switchPane();
    var text = assemble();
    var empty = !text.trim();
    var result = empty ? null : window.MotefulQREncoder.encode(text, getChecked('qrEcc') || 'M');

    var hasQr = result && !result.error;
    $('qrCanvas').hidden = !hasQr;
    $('qrEmpty').hidden = !!hasQr;
    $('qrPng').disabled = !hasQr;
    $('qrSvg').disabled = !hasQr;
    $('qrMeta').hidden = !hasQr;

    if (!hasQr) { lastResult = null; lastText = ''; return; }

    lastResult = result; lastText = text;
    var pal = palette();
    var quiet = 4; // 安静区模块数
    var size = result.size + quiet * 2;
    var outPx = parseInt(getChecked('qrSize'), 10) || 512;
    var cell = outPx / size;

    var canvas = $('qrCanvas');
    canvas.width = outPx; canvas.height = outPx;
    canvas.style.width = '100%';
    canvas.style.maxWidth = outPx + 'px';
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, outPx, outPx);
    ctx.fillStyle = pal.fg;
    for (var r = 0; r < result.size; r++) for (var c = 0; c < result.size; c++) {
      if (result.modules[r][c]) {
        ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }

    // meta：版本 / 模块数 / 纠错 / 字节
    var meta = document.querySelector('[data-i18n="qr_meta"]');
    var t = (window.MOTEFUL_I18N && window.MOTEFUL_I18N[document.documentElement.lang === 'en' ? 'en' : 'zh'] &&
      window.MOTEFUL_I18N[document.documentElement.lang === 'en' ? 'en' : 'zh'].qr_meta) || '版本 {v} · {n}×{n} 模块 · 纠错 {ecc} · {bytes} 字节';
    $('qrMeta').textContent = t.replace('{v}', result.version).replace(/{n}/g, result.size)
      .replace('{ecc}', getChecked('qrEcc')).replace('{bytes}', result.byteLen);
  }

  function download(blob, name) {
    var a = document.createElement('a');
    a.style.display = 'none';
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function exportPng() {
    if (!lastResult) return;
    $('qrCanvas').toBlob(function (b) { download(b, 'moteful-qrcode.png'); if (window.Moteful && Moteful.recommend) Moteful.recommend.show({ actionKey: 'rec_download' }); });
  }

  function exportSvg() {
    if (!lastResult) return;
    var pal = palette();
    var quiet = 4, n = lastResult.size + quiet * 2;
    var parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + n + '" height="' + n + '" viewBox="0 0 ' + n + ' ' + n + '">'];
    parts.push('<rect width="' + n + '" height="' + n + '" fill="' + pal.bg + '"/>');
    for (var r = 0; r < lastResult.size; r++) for (var c = 0; c < lastResult.size; c++) {
      if (lastResult.modules[r][c]) parts.push('<rect x="' + (c + quiet) + '" y="' + (r + quiet) + '" width="1" height="1"/>');
    }
    parts.push('</svg>');
    var svg = parts.join('').replace(/<\/?rect/g, function (m, i, s) {
      return m;
    });
    // 前景色统一设上（合并 fill）
    svg = parts.join('').replace(/<rect x=/g, '<rect fill="' + pal.fg + '" x=');
    download(new Blob([svg], { type: 'image/svg+xml' }), 'moteful-qrcode.svg'); if (window.Moteful && Moteful.recommend) Moteful.recommend.show({ actionKey: 'rec_download' });
  }

  /* ---------- 配置记忆（localStorage） ----------
     记住用户上次的参数设置，下次打开自动恢复。
     存储键名：moteful.qrcode.config
     存储内容：编码类型、纠错等级、尺寸、配色、自定义前景/背景色
     保存策略：参数变化后防抖300ms保存 */
  var CONFIG_KEY = 'moteful.qrcode.config';
  var CONFIG_VERSION = 1;
  var saveTimer = 0;

  function loadConfig() {
    try {
      var raw = localStorage.getItem(CONFIG_KEY);
      if (!raw) return false;
      var cfg = JSON.parse(raw);
      if (!cfg || cfg.__version !== CONFIG_VERSION) return false;
      // 恢复编码类型
      if (cfg.qrType) {
        var el = document.querySelector('input[name="qrType"][value="' + cfg.qrType + '"]');
        if (el) el.checked = true;
      }
      // 恢复纠错等级
      if (cfg.qrEcc) {
        var el = document.querySelector('input[name="qrEcc"][value="' + cfg.qrEcc + '"]');
        if (el) el.checked = true;
      }
      // 恢复尺寸
      if (cfg.qrSize) {
        var el = document.querySelector('input[name="qrSize"][value="' + cfg.qrSize + '"]');
        if (el) el.checked = true;
      }
      // 恢复配色
      if (cfg.qrColor) {
        var el = document.querySelector('input[name="qrColor"][value="' + cfg.qrColor + '"]');
        if (el) el.checked = true;
      }
      // 恢复自定义色
      if (cfg.fg) {
        var sw = document.querySelector('.qr-swatch[data-fg="' + cfg.fg + '"]');
        if (sw) {
          document.querySelectorAll('.qr-swatch[data-fg]').forEach(function(s){s.classList.remove('is-on')});
          sw.classList.add('is-on');
        }
      }
      if (cfg.bg) {
        var sw = document.querySelector('.qr-swatch[data-bg="' + cfg.bg + '"]');
        if (sw) {
          document.querySelectorAll('.qr-swatch[data-bg]').forEach(function(s){s.classList.remove('is-on')});
          sw.classList.add('is-on');
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function saveConfigNow() {
    try {
      var fgEl = document.querySelector('.qr-swatch[data-fg].is-on');
      var bgEl = document.querySelector('.qr-swatch[data-bg].is-on');
      var cfg = {
        __version: CONFIG_VERSION,
        qrType: getChecked('qrType'),
        qrEcc: getChecked('qrEcc'),
        qrSize: getChecked('qrSize'),
        qrColor: getChecked('qrColor'),
        fg: fgEl ? fgEl.getAttribute('data-fg') : null,
        bg: bgEl ? bgEl.getAttribute('data-bg') : null
      };
      localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    } catch (e) {}
  }

  function scheduleSaveConfig() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveConfigNow, 300);
  }

  function bind() {
    loadConfig(); // 页面加载时恢复上次配置
    document.querySelectorAll('input[name], #qrText, #qrUrl, #qrSsid, #qrPass, #qrName, #qrTel, #qrEmail')
      .forEach(function (el) {
        el.addEventListener('input', function(){ update(); scheduleSaveConfig(); });
        el.addEventListener('change', function(){ update(); scheduleSaveConfig(); });
      });
    document.querySelectorAll('.qr-swatch').forEach(function (sw) {
      sw.addEventListener('click', function () {
        var grp = sw.parentNode.querySelectorAll('.qr-swatch');
        grp.forEach(function (s) { s.classList.remove('is-on'); });
        sw.classList.add('is-on');
        update();
        scheduleSaveConfig();
      });
    });
    $('qrPng').addEventListener('click', exportPng);
    $('qrSvg').addEventListener('click', exportSvg);
    update();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
