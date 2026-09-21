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
    if (mode === 'custom') return { fg: $('qrFg').value, bg: $('qrBg').value };
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
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function exportPng() {
    if (!lastResult) return;
    $('qrCanvas').toBlob(function (b) { download(b, 'moteful-qrcode.png'); });
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
    download(new Blob([svg], { type: 'image/svg+xml' }), 'moteful-qrcode.svg');
  }

  function bind() {
    document.querySelectorAll('input[name], #qrText, #qrUrl, #qrSsid, #qrPass, #qrName, #qrTel, #qrEmail, #qrFg, #qrBg')
      .forEach(function (el) {
        el.addEventListener('input', update);
        el.addEventListener('change', update);
      });
    $('qrPng').addEventListener('click', exportPng);
    $('qrSvg').addEventListener('click', exportSvg);
    update();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
