/*
 * Moteful 标注工具 · 纯计算模块（V0.6）
 * 职责：水印单元测量与坐标换算、平铺行列计算、马赛克块计算、EXIF 拍摄时间解析、
 *       打码区域的归一化坐标映射。全部为纯函数（除显式传入 ctx 的测量/绘制助手外不触 DOM）。
 * 零外部请求，所有计算在浏览器本地完成。
 *
 * 依赖：无。挂载 window.MFAnnotateCore，便于浏览器内自测与未来单测。
 *
 * 术语：
 *   - 归一化坐标：相对原图的 0~1 比例，用于跨不同尺寸图片等比映射（批量套用不跑偏）。
 *   - 缩放基准：短边 1000px 对应参数设定值；字号 / 边距 / 平铺间距均按此基准等比缩放，
 *     保证同一组参数在不同尺寸图片上的观感一致（设计文档「水印坐标口径」）。
 */
(function () {
  'use strict';

  var BASE_SIDE = 1000;      // 缩放基准短边
  var MIN_FONT = 8;          // 字号下限，避免小图上文字不可辨
  var MIN_GAP = 24;          // 平铺间距下限
  var MIN_MARGIN = 0;

  /* ---------- 基础 ---------- */

  // 短边比例因子：短边 1000 → 1.0
  function scaleFor(imgW, imgH) {
    var s = Math.min(Math.abs(imgW) || 0, Math.abs(imgH) || 0) / BASE_SIDE;
    return s > 0 ? s : 1;
  }

  function clamp(v, min, max) {
    v = +v;
    if (isNaN(v)) v = min;
    return Math.max(min, Math.min(max, v));
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  /* ---------- 1. 水印单元测量 ---------- */

  // 字号：按短边比例换算，带下限
  function fontSize(size, imgW, imgH) {
    return Math.max(MIN_FONT, (+size || 0) * scaleFor(imgW, imgH));
  }

  // 边距：按短边比例换算
  function marginPx(margin, imgW, imgH) {
    return Math.max(MIN_MARGIN, (+margin || 0) * scaleFor(imgW, imgH));
  }

  // 平铺间距：按短边比例换算，带下限
  function tileGapPx(gap, imgW, imgH) {
    return Math.max(MIN_GAP, (+gap || 0) * scaleFor(imgW, imgH));
  }

  /*
   * 测量文字水印单元尺寸。ctx 由调用方提供（需已设置好 font）。
   * 返回 { w, h, fontSize, ascent, descent }，h 为单行高度。
   */
  function measureTextUnit(ctx, text, fontPx, opt) {
    opt = opt || {};
    var lines = String(text == null ? '' : text).split('\n');
    var lineH = fontPx * (opt.lineHeight || 1.25);
    var maxW = 0;
    for (var i = 0; i < lines.length; i++) {
      var m = ctx.measureText(lines[i] || ' ').width;
      if (m > maxW) maxW = m;
    }
    return {
      w: maxW,
      h: lineH * Math.max(1, lines.length),
      lineHeight: lineH,
      lines: lines,
      fontSize: fontPx
    };
  }

  // 图片水印单元尺寸：按原图宽度的百分比缩放（size 视为宽度百分比 5~100，映射为 5%~100%）
  function measureImageUnit(srcW, srcH, size, imgW) {
    var pct = clamp(size, 5, 100) / 100;
    var w = imgW * pct;
    var h = srcH && srcW ? w * (srcH / srcW) : w;
    return { w: w, h: h };
  }

  /* ---------- 2. 九宫格锚点 → 坐标 ---------- */

  /*
   * anchor: { x:'left'|'center'|'right', y:'top'|'middle'|'bottom' }
   * 返回水印单元左上角坐标 { x, y }（相对原图像素）。
   */
  function anchorToXY(anchor, margin, unitW, unitH, imgW, imgH) {
    var m = marginPx(margin, imgW, imgH);
    var ax = (anchor && anchor.x) || 'right';
    var ay = (anchor && anchor.y) || 'bottom';
    var x, y;

    if (ax === 'left') x = m;
    else if (ax === 'right') x = imgW - unitW - m;
    else x = (imgW - unitW) / 2;

    if (ay === 'top') y = m;
    else if (ay === 'bottom') y = imgH - unitH - m;
    else y = (imgH - unitH) / 2;

    return { x: x, y: y };
  }

  /* ---------- 3. 平铺行列计算 ---------- */

  /*
   * 按水印单元外接盒（考虑旋转）+ 间距计算铺满整图所需的单元列表。
   * 起点退到画布外一格，保证旋转后四角不留白。
   * 返回 [{ x, y, rot }]（rot 为角度，供绘制时旋转）。
   */
  function tilingGrid(unitW, unitH, gap, angle, imgW, imgH) {
    var rot = (+angle || 0) * Math.PI / 180;
    var absCos = Math.abs(Math.cos(rot));
    var absSin = Math.abs(Math.sin(rot));
    // 旋转后的外接盒
    var bw = unitW * absCos + unitH * absSin;
    var bh = unitW * absSin + unitH * absCos;

    var stepX = Math.max(1, bw + gap);
    var stepY = Math.max(1, bh + gap);
    var startX = -stepX;
    var startY = -stepY;
    var cols = Math.ceil((imgW + 2 * stepX) / stepX);
    var rows = Math.ceil((imgH + 2 * stepY) / stepY);

    var items = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var x = startX + c * stepX;
        var y = startY + r * stepY;
        // 只要与画布有交叠就保留（单元中心或外接盒任一边界落入画布）
        if (x + bw < 0 || x > imgW || y + bh < 0 || y > imgH) continue;
        items.push({ x: x, y: y, rot: +angle || 0, boxW: bw, boxH: bh });
      }
    }
    return items;
  }

  /* ---------- 4. 马赛克像素化 ---------- */

  /*
   * 把 ctx 画布上 (sx,sy,sw,sh) 区域按 block 像素块大小像素化。
   * 做法：降采样到小 canvas → 关闭 imageSmoothing 放大回原区域，
   * 不逐像素遍历，耗时与块大小解耦。
   * block 需已按当前画布分辨率换算（预览降分辨率时调用方负责换算）。
   */
  function mosaicRect(ctx, sx, sy, sw, sh, block) {
    var cw = ctx.canvas.width, ch = ctx.canvas.height;
    sx = Math.round(sx); sy = Math.round(sy);
    sw = Math.round(sw); sh = Math.round(sh);
    if (sx < 0) { sw += sx; sx = 0; }
    if (sy < 0) { sh += sy; sy = 0; }
    if (sx + sw > cw) sw = cw - sx;
    if (sy + sh > ch) sh = ch - sy;
    if (sw < 1 || sh < 1) return false;

    var b = Math.max(1, Math.round(block));
    var bw = Math.max(1, Math.round(sw / b));
    var bh = Math.max(1, Math.round(sh / b));

    var small = document.createElement('canvas');
    small.width = bw; small.height = bh;
    var sctx = small.getContext('2d');
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(ctx.canvas, sx, sy, sw, sh, 0, 0, bw, bh);

    var prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, bw, bh, sx, sy, sw, sh);
    ctx.imageSmoothingEnabled = prev;
    return true;
  }

  /*
   * 画笔路径：把折线按 brush 直径步长降采样成点集，供逐点 pixelate。
   * 返回 [{x, y}]，两点间距不小于 step。
   */
  function resamplePath(points, step) {
    if (!points || points.length === 0) return [];
    step = Math.max(1, +step || 1);
    var out = [{ x: points[0].x, y: points[0].y }];
    for (var i = 1; i < points.length; i++) {
      var a = out[out.length - 1];
      var b = points[i];
      var dx = b.x - a.x, dy = b.y - a.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < step) continue;                 // 不足一步，并入下一段继续累积
      var n = Math.floor(d / step);           // 相隔约 step 的等分点
      for (var k = 1; k <= n; k++) {
        var t = (k * step) / d;
        out.push({ x: a.x + dx * t, y: a.y + dy * t });
      }
    }
    return out;
  }

  /* ---------- 5. 归一化坐标（批量映射） ---------- */

  // 像素矩形 → 归一化（0~1）
  function rectToNorm(rect, imgW, imgH) {
    return {
      x: rect.x / (imgW || 1),
      y: rect.y / (imgH || 1),
      w: rect.w / (imgW || 1),
      h: rect.h / (imgH || 1)
    };
  }

  // 归一化 → 目标尺寸像素
  function normToRect(n, imgW, imgH) {
    return {
      x: n.x * imgW,
      y: n.y * imgH,
      w: n.w * imgW,
      h: n.h * imgH
    };
  }

  // 笔迹点集 → 归一化
  function pathToNorm(points, imgW, imgH) {
    return (points || []).map(function (p) {
      return { x: p.x / (imgW || 1), y: p.y / (imgH || 1) };
    });
  }

  // 归一化 → 笔迹点集
  function normToPath(pts, imgW, imgH) {
    return (pts || []).map(function (p) {
      return { x: p.x * imgW, y: p.y * imgH };
    });
  }

  /* ---------- 6. 自动颜色（按背景亮度选黑白） ---------- */

  // 平均亮度（0~255），data 为 ImageData.data
  function avgLuma(data) {
    if (!data || !data.length) return 128;
    var sum = 0, n = 0;
    // 步长采样，大图不必逐像素
    var stride = Math.max(4, Math.floor(data.length / 4000 / 4) * 4);
    for (var i = 0; i < data.length; i += stride) {
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      n++;
    }
    return n ? sum / n : 128;
  }

  // 亮背景用黑字，暗背景用白字
  function autoColor(luma, threshold) {
    var t = threshold == null ? 140 : threshold;
    return luma > t ? 'black' : 'white';
  }

  /* ---------- 7. EXIF 拍摄时间解析（轻量，仅 JPEG APP1） ---------- */

  function parseExifDate(arrayBuffer) {
    try {
      var view = new DataView(arrayBuffer);
      if (view.byteLength < 12) return null;
      if (view.getUint16(0) !== 0xFFD8) return null;   // 非 SOI
      var off = 2, len = view.byteLength;
      while (off < len - 4) {
        if (view.getUint8(off) !== 0xFF) { off++; continue; }
        var marker = view.getUint8(off + 1);
        if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { off += 2; continue; }
        if (marker === 0xDA || marker === 0xD9) break;  // SOS / EOI
        var segLen = view.getUint16(off + 2);
        if (marker === 0xE1) {
          var start = off + 4;
          if (start + 6 <= len &&
              view.getUint32(start) === 0x45786966 &&      // 'Exif'
              view.getUint16(start + 4) === 0x0000) {
            var d = readTiffDate(view, start + 6, len);
            if (d) return d;
          }
        }
        off += 2 + segLen;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function readTiffDate(view, base, len) {
    if (base + 8 > len) return null;
    var order = view.getUint16(base);
    var little;
    if (order === 0x4949) little = true;         // 'II'
    else if (order === 0x4D4D) little = false;   // 'MM'
    else return null;

    function u16(o) { return view.getUint16(o, little); }
    function u32(o) { return view.getUint32(o, little); }

    if (u16(base + 2) !== 42) return null;
    var ifd0 = base + u32(base + 4);
    if (ifd0 + 2 > len) return null;

    var exifPtr = findTag(view, ifd0, len, u16, u32, 0x8769);
    if (!exifPtr) return null;
    var exifIFD = base + exifPtr;
    if (exifIFD + 2 > len) return null;

    var dtOff = findTag(view, exifIFD, len, u16, u32, 0x9003);  // DateTimeOriginal
    if (!dtOff) return null;

    var sOff = base + dtOff;
    if (sOff + 19 > len) return null;
    var s = '';
    for (var i = 0; i < 19; i++) {
      var ch = view.getUint8(sOff + i);
      if (ch === 0) break;
      s += String.fromCharCode(ch);
    }
    var m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }

  function findTag(view, ifdOff, len, u16, u32, tag) {
    var n = u16(ifdOff);
    if (n <= 0 || n > 512) return 0;
    for (var i = 0; i < n; i++) {
      var e = ifdOff + 2 + i * 12;
      if (e + 12 > len) return 0;
      if (u16(e) === tag) {
        var type = u16(e + 2);
        var count = u32(e + 4);
        // ASCII(2) 或 UNDEFINED(7)：值超过 4 字节时 e+8 存的是偏移
        if ((type === 2 || type === 7) && count > 4) return u32(e + 8);
        return u32(e + 8);
      }
    }
    return 0;
  }

  /* ---------- 8. 时间格式化 ---------- */

  var TIME_FORMATS = {
    date: function (d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); },
    slash: function (d) { return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()); },
    datetime: function (d) {
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
        pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    },
    full: function (d) {
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
        pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    }
  };

  function formatDate(date, fmt) {
    var f = TIME_FORMATS[fmt] || TIME_FORMATS.date;
    return f(date || new Date());
  }

  /* ---------- 导出 ---------- */

  window.MFAnnotateCore = {
    BASE_SIDE: BASE_SIDE,
    scaleFor: scaleFor,
    clamp: clamp,
    fontSize: fontSize,
    marginPx: marginPx,
    tileGapPx: tileGapPx,
    measureTextUnit: measureTextUnit,
    measureImageUnit: measureImageUnit,
    anchorToXY: anchorToXY,
    tilingGrid: tilingGrid,
    mosaicRect: mosaicRect,
    resamplePath: resamplePath,
    rectToNorm: rectToNorm,
    normToRect: normToRect,
    pathToNorm: pathToNorm,
    normToPath: normToPath,
    avgLuma: avgLuma,
    autoColor: autoColor,
    parseExifDate: parseExifDate,
    formatDate: formatDate,
    TIME_FORMATS: TIME_FORMATS
  };
})();
