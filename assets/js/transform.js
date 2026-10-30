/*
 * Moteful V0.2 图像变换管线（纯计算，无文案，符合铁律①）
 * 管线顺序：裁剪 → 旋转/翻转 → 缩放
 *
 * 零依赖、纯前端。导出 window.MotefulTransform：
 *   apply(img, opts)            -> canvas   执行完整变换
 *   previewSize(iw, ih, opts)   -> {w, h}   仅计算输出尺寸，供 UI 预览（不解码图片）
 *   RATIOS                      -> 比例预设表
 *
 * opts 字段：
 *   cropMode   'none' | 'ratio' | 'free'
 *   cropRatio  '1:1' | '4:3' | '3:2' | '16:9'   （cropMode='ratio' 时生效，居中裁出最大区域）
 *   margins    {top,right,bottom,left} 单位 px  （cropMode='free' 时生效）
 *   rotate     0 | 90 | 180 | 270
 *   flipH      布尔，水平翻转（左右镜像）
 *   flipV      布尔，垂直翻转（上下镜像）
 *   sizeMode   'none' | 'percent' | 'longest' | 'exact'
 *   percent    1-400         （sizeMode='percent'）
 *   longest    1-20000 px    （sizeMode='longest'，最长边缩放到该值）
 *   width/height 1-20000 px  （sizeMode='exact'）
 *   keepRatio  布尔          （sizeMode='exact' 时按 contain 等比，否则强制拉伸）
 */
(function () {
  'use strict';

  var RATIOS = { '1:1': 1, '4:3': 4 / 3, '3:2': 3 / 2, '16:9': 16 / 9 };

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function num(v, dflt) { var n = parseFloat(v); return isFinite(n) ? n : dflt; }
  function quarter(rotate) {
    var r = ((parseInt(rotate, 10) || 0) % 360 + 360) % 360;
    return Math.round(r / 90) % 4;   // 0 / 1 / 2 / 3
  }

  /* ---------- 1. 裁剪：算出源矩形 ---------- */
  function cropRect(iw, ih, o) {
    var mode = o.cropMode || 'none';

    if (mode === 'ratio') {
      var r = RATIOS[o.cropRatio] || 1;
      var sw, sh;
      if (iw / ih > r) { sh = ih; sw = Math.round(ih * r); }   // 原图偏宽 → 裁左右
      else { sw = iw; sh = Math.round(iw / r); }                // 原图偏高 → 裁上下
      sw = clamp(sw, 1, iw); sh = clamp(sh, 1, ih);
      // 居中
      return { sx: Math.round((iw - sw) / 2), sy: Math.round((ih - sh) / 2), sw: sw, sh: sh };
    }

    if (mode === 'free') {
      var m = o.margins || {};
      var top = clamp(Math.round(num(m.top, 0)), 0, Math.max(0, ih - 1));
      var left = clamp(Math.round(num(m.left, 0)), 0, Math.max(0, iw - 1));
      var bottom = clamp(Math.round(num(m.bottom, 0)), 0, Math.max(0, ih - 1));
      var right = clamp(Math.round(num(m.right, 0)), 0, Math.max(0, iw - 1));
      var sw = iw - left - right, sh = ih - top - bottom;
      // 边距合计过大时保底留 1px，取中间区域，避免画布非法
      if (sw < 1) { sw = 1; left = Math.floor((iw - 1) / 2); right = iw - 1 - left; }
      if (sh < 1) { sh = 1; top = Math.floor((ih - 1) / 2); bottom = ih - 1 - top; }
      return { sx: left, sy: top, sw: sw, sh: sh };
    }

    return { sx: 0, sy: 0, sw: iw, sh: ih };
  }

  /* ---------- 2. 旋转 + 翻转 ----------
   * 变换叠加顺序：先旋转、再翻转（即"用户看到旋转后的图，再做左右/上下镜像"）。
   * canvas 变换是后调用的先作用于图像，因此代码顺序为 scale(翻转) → rotate → drawImage。
   */
  function rotateFlip(img, rect, o) {
    var q = quarter(o.rotate);
    var swap = (q === 1 || q === 3);               // 90/270 度时宽高互换
    var cw = swap ? rect.sh : rect.sw;
    var ch = swap ? rect.sw : rect.sh;

    var c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    var ctx = c.getContext('2d');
    ctx.translate(cw / 2, ch / 2);
    if (o.flipH || o.flipV) ctx.scale(o.flipH ? -1 : 1, o.flipV ? -1 : 1);
    if (q) ctx.rotate(q * Math.PI / 2);
    ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh,
                  -rect.sw / 2, -rect.sh / 2, rect.sw, rect.sh);
    return c;
  }

  /* ---------- 3. 缩放：算出目标尺寸 ---------- */
  function targetSize(w, h, o) {
    var mode = o.sizeMode || 'none';

    if (mode === 'percent') {
      var p = clamp(num(o.percent, 100), 1, 400);
      return { w: Math.max(1, Math.round(w * p / 100)), h: Math.max(1, Math.round(h * p / 100)) };
    }

    if (mode === 'longest') {
      var L = clamp(num(o.longest, Math.max(w, h)), 1, 20000);
      var s = L / Math.max(w, h);
      return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
    }

    if (mode === 'exact') {
      var tw = clamp(Math.round(num(o.width, w)), 1, 20000);
      var th = clamp(Math.round(num(o.height, h)), 1, 20000);
      if (o.keepRatio) {
        var k = Math.min(tw / w, th / h);          // contain：等比装入指定框内，不拉伸不裁剪
        return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
      }
      return { w: tw, h: th };                     // 强制拉伸
    }

    return { w: w, h: h };
  }

  /* ---------- 对外：完整变换 ---------- */
  function apply(img, opts) {
    opts = opts || {};
    var iw = img.width || img.naturalWidth;
    var ih = img.height || img.naturalHeight;
    if (!iw || !ih) throw new Error('MotefulTransform: invalid image size');

    var rect = cropRect(iw, ih, opts);
    var mid = rotateFlip(img, rect, opts);
    var t = targetSize(mid.width, mid.height, opts);

    if (t.w === mid.width && t.h === mid.height) return mid;   // 无需缩放，直接返回

    var out = document.createElement('canvas');
    out.width = t.w; out.height = t.h;
    var ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(mid, 0, 0, t.w, t.h);
    return out;
  }

  /* ---------- 对外：仅算尺寸（供 UI 预览，不解码图片） ---------- */
  function previewSize(iw, ih, opts) {
    opts = opts || {};
    if (!iw || !ih) return { w: 0, h: 0 };
    var rect = cropRect(iw, ih, opts);
    var swap = (quarter(opts.rotate) === 1 || quarter(opts.rotate) === 3);
    return targetSize(swap ? rect.sh : rect.sw, swap ? rect.sw : rect.sh, opts);
  }

  /* ---------- 对外：判断是否真的需要变换（避免无谓重绘） ---------- */
  function isNoop(opts) {
    opts = opts || {};
    return (opts.cropMode || 'none') === 'none'
      && !quarter(opts.rotate)
      && !opts.flipH && !opts.flipV
      && (opts.sizeMode || 'none') === 'none';
  }

  /* ---------- PS「两次立方（较锐利）缩减」重采样 ----------
     缩小模糊的根源是混叠；PS Bicubic Sharper 的做法分两阶段：
     ① 级联 2× 面积平均降采样（抗混叠，信息保留）；
     ② 最后一跳用锐利 bicubic 核（a = -0.75）分离卷积从中间尺寸缩到目标。
     仅缩小生效（目标 < 源尺寸）；放大/等大原样返回。 */
  function bicubicKernel(t, a) {
    var x = Math.abs(t), y;
    if (x <= 1) { y = ((a + 2) * x - (a + 3)) * x * x + 1; }
    else if (x < 2) { y = (((x - 5) * x + 8) * x - 4) * a; }
    else { y = 0; }
    return y;
  }
  function bicubicDown(src, ow, oh) {
    var iw = src.width, ih = src.height;
    var a = -0.75;
    var srcCtx = src.getContext('2d');
    var srcData = srcCtx.getImageData(0, 0, iw, ih).data;
    /* 分离卷积：先水平 iw×ih → ow×ih，再垂直 ow×ih → ow×oh */
    var mid = new Uint8ClampedArray(ow * ih * 4);
    var out = new Uint8ClampedArray(ow * oh * 4);
    var x, y, c, k;
    /* 水平 */
    for (y = 0; y < ih; y++) {
      for (x = 0; x < ow; x++) {
        var sx = (x + 0.5) * iw / ow - 0.5;
        var x0 = Math.floor(sx) - 1;
        var wts = [];
        var wsum = 0;
        for (k = 0; k < 4; k++) {
          var xx = x0 + k, t = sx - xx;
          xx = Math.max(0, Math.min(iw - 1, xx));
          var w = bicubicKernel(t, a);
          wts.push([xx, w]);
          wsum += w;
        }
        if (wsum !== 0) {
          for (k = 0; k < 4; k++) wts[k][1] /= wsum;
        }
        var r = 0, g = 0, b = 0, al = 0;
        for (k = 0; k < 4; k++) {
          var srcIdx = (y * iw + wts[k][0]) * 4, ww = wts[k][1];
          r += srcData[srcIdx] * ww; g += srcData[srcIdx + 1] * ww;
          b += srcData[srcIdx + 2] * ww; al += srcData[srcIdx + 3] * ww;
        }
        var mIdx = (y * ow + x) * 4;
        mid[mIdx] = r; mid[mIdx + 1] = g; mid[mIdx + 2] = b; mid[mIdx + 3] = al;
      }
    }
    /* 垂直 */
    for (y = 0; y < oh; y++) {
      for (x = 0; x < ow; x++) {
        var sy = (y + 0.5) * ih / oh - 0.5;
        var y0 = Math.floor(sy) - 1;
        var wts2 = [];
        var wsum2 = 0;
        for (k = 0; k < 4; k++) {
          var yy = y0 + k, t2 = sy - yy;
          yy = Math.max(0, Math.min(ih - 1, yy));
          var w2 = bicubicKernel(t2, a);
          wts2.push([yy, w2]);
          wsum2 += w2;
        }
        if (wsum2 !== 0) {
          for (k = 0; k < 4; k++) wts2[k][1] /= wsum2;
        }
        var r2 = 0, g2 = 0, b2 = 0, al2 = 0;
        for (k = 0; k < 4; k++) {
          var mIdx2 = (wts2[k][0] * ow + x) * 4, ww2 = wts2[k][1];
          r2 += mid[mIdx2] * ww2; g2 += mid[mIdx2 + 1] * ww2;
          b2 += mid[mIdx2 + 2] * ww2; al2 += mid[mIdx2 + 3] * ww2;
        }
        var oIdx = (y * ow + x) * 4;
        out[oIdx] = r2; out[oIdx + 1] = g2; out[oIdx + 2] = b2; out[oIdx + 3] = al2;
      }
    }
    var oc = document.createElement('canvas');
    oc.width = ow; oc.height = oh;
    oc.getContext('2d').putImageData(new ImageData(out, ow, oh), 0, 0);
    return oc;
  }
  function smartDownscale(src, targetW, targetH) {
    targetW = Math.max(1, Math.round(targetW));
    targetH = Math.max(1, Math.round(targetH));
    var sw = src.width, sh = src.height;
    if (targetW >= sw && targetH >= sh) return src;
    /* ① 级联 2× 面积平均（imageSmoothingQuality=low 即盒式滤波），中间画布面积护栏避免巨中间层 */
    var cur = src;
    var tmpA = document.createElement('canvas'), tmpB = document.createElement('canvas');
    while (sw > targetW * 2 && sh > targetH * 2) {
      var nw = Math.max(1, Math.round(sw / 2)), nh = Math.max(1, Math.round(sh / 2));
      if (nw * nh <= 8000000) { /* 中间层 ≤800 万像素（4000×2000 级），面积平均代价 O(面积) 可控 */
        var dst = (cur === src || cur === tmpA) ? tmpB : tmpA; /* ping-pong：禁止画自己到自己 */
        dst.width = nw; dst.height = nh;
        var t = dst.getContext('2d');
        t.imageSmoothingEnabled = true;
        t.imageSmoothingQuality = 'low';
        t.drawImage(cur, 0, 0, nw, nh);
        cur = dst; sw = nw; sh = nh;
      } else break;
    }
    /* ② 分离 bicubic 锐利核最后一跳 */
    return bicubicDown(cur, targetW, targetH);
  }

  window.MotefulTransform = {
    apply: apply,
    previewSize: previewSize,
    isNoop: isNoop,
    RATIOS: RATIOS,
    rotateFlip: rotateFlip,
    cropRect: cropRect,
    downscale: smartDownscale
  };
})();
