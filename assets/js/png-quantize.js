/* Moteful · png-quantize.js · v1.8.0（感知加权优化）
 * 中位切分量化（Median Cut）+ Floyd-Steinberg 抖动，RGBA 四通道。
 * 优化（对齐 pngquant 思路）：
 *   - 感知加权直方图：alpha 加权（不透明像素优先）+ 局部方差降权（噪点区权重低，调色板名额让给大面积/平滑区）
 *   - 预乘 alpha：palette 均值按 r·a 加权，透明像素不污染颜色（防黑边/白边）
 *   - 透明优先：透明像素直接映射最透明调色板色，不抢名额、不参与误差扩散
 * 内置 Worker（Blob URL 内嵌，零外部请求）；Worker 不可用时自动降级主线程。
 *
 * 用法：
 *   PNGQuant.quantize(imageData, { colors: 128, dither: true })
 *     .then(function (res) {
 *       // res = { palette: Uint8Array(colors*4, RGBA), indices: Uint8Array(w*h), colors }
 *     });
 *   PNGQuant.quantizeSync(...)  // 主线程同步版（Worker 降级路径 / 测试用）
 */
(function () {
  'use strict';
  var root = (typeof window !== 'undefined') ? window
    : (typeof self !== 'undefined' ? self : globalThis);

  /* =====================================================================
     纯算法工厂：Worker 与主线程共用同一份实现（函数序列化嵌入 Worker）
     ===================================================================== */
  function quantizeFactory() {
    'use strict';

    /* 感知权重：alpha 加权（不透明优先）+ 局部方差降权（噪点区权重低）。
       返回 { w: Uint8Array(1-255), total: Float64 } */
    function computeWeights(data, w, h) {
      var n = w * h;
      var wgt = new Uint8Array(n);
      var total = 0;
      var i, o, a, r, g, b, rl, gl, bl, ru, gu, bu, dl, du, v, wa, wi;
      var MAXV = 2 * 195075; /* 2·(3·255²)，与上/左两邻居归一化 */
      for (i = 0; i < n; i++) {
        o = i * 4;
        a = data[o + 3];
        r = data[o]; g = data[o + 1]; b = data[o + 2];
        if (i % w > 0) { rl = data[o - 4]; gl = data[o - 3]; bl = data[o - 2]; }
        else { rl = r; gl = g; bl = b; }
        if (i >= w) { ru = data[o - w * 4]; gu = data[o - w * 4 + 1]; bu = data[o - w * 4 + 2]; }
        else { ru = r; gu = g; bu = b; }
        dl = (rl - r) * (rl - r) + (gl - g) * (gl - g) + (bl - b) * (bl - b);
        du = (ru - r) * (ru - r) + (gu - g) * (gu - g) + (bu - b) * (bu - b);
        v = (dl + du) / MAXV; /* 归一化 0-1 */
        wa = 0.15 + 0.85 * (a / 255) * (a / 255); /* 不透明像素权重高，透明像素低 */
        wi = 255 * wa / (1 + v * 10); /* 噪点区（v 高）降权 */
        if (wi < 1) wi = 1; else if (wi > 255) wi = 255;
        wi = (wi + 0.5) | 0;
        wgt[i] = wi;
        total += wi;
      }
      return { w: wgt, total: total };
    }

    /* 中位切分：RGBA 四通道参与统计，选跨度最大通道、计数排序、带权中位切分；
       palette 均值按预乘 alpha 加权（透明像素不污染颜色，防黑边/白边） */
    function medianCut(data, w, h, colors, weight, totalW) {
      var n = w * h;
      var idx = new Uint32Array(n);
      for (var i = 0; i < n; i++) idx[i] = i;
      var buckets = [{ px: idx, count: n, wsum: totalW }];
      var target = Math.min(colors, n);
      var b, k, o, r, g, bl, a, v;
      var mnR, mxR, mnG, mxG, mnB, mxB, mnA, mxA, sR, sG, sB, sA;

      while (buckets.length < target) {
        var bi = -1, ch = 0, span = -1;
        for (b = 0; b < buckets.length; b++) {
          var px = buckets[b].px, cnt = buckets[b].count;
          if (cnt < 2) continue;
          mnR = 255; mxR = 0; mnG = 255; mxG = 0; mnB = 255; mxB = 0; mnA = 255; mxA = 0;
          for (k = 0; k < cnt; k++) {
            o = px[k] * 4;
            r = data[o]; g = data[o + 1]; bl = data[o + 2]; a = data[o + 3];
            if (r < mnR) mnR = r; if (r > mxR) mxR = r;
            if (g < mnG) mnG = g; if (g > mxG) mxG = g;
            if (bl < mnB) mnB = bl; if (bl > mxB) mxB = bl;
            if (a < mnA) mnA = a; if (a > mxA) mxA = a;
          }
          sR = mxR - mnR; sG = mxG - mnG; sB = mxB - mnB; sA = mxA - mnA;
          var sc, sp;
          if (sR >= sG && sR >= sB && sR >= sA) { sc = sR; sp = 0; }
          else if (sG >= sB && sG >= sA) { sc = sG; sp = 1; }
          else if (sB >= sA) { sc = sB; sp = 2; }
          else { sc = sA; sp = 3; }
          if (sc > span) { span = sc; bi = b; ch = sp; }
        }
        if (bi < 0 || span <= 0) break;
        var bucket = buckets[bi];
        var arr = bucket.px, cnt = bucket.count;
        var keyFn = ch === 0 ? function (o) { return data[o * 4]; }
          : ch === 1 ? function (o) { return data[o * 4 + 1]; }
          : ch === 2 ? function (o) { return data[o * 4 + 2]; }
          : function (o) { return data[o * 4 + 3]; };
        /* 计数排序（通道值 0-255） */
        var counts = new Uint32Array(256);
        for (k = 0; k < cnt; k++) counts[keyFn(arr[k])]++;
        var pos = new Uint32Array(257);
        for (v = 0; v < 256; v++) pos[v + 1] = pos[v] + counts[v];
        var sorted = new Uint32Array(cnt);
        for (k = 0; k < cnt; k++) { var kv = keyFn(arr[k]); sorted[pos[kv]++] = arr[k]; }
        /* 带权中位：按累计权重找切分点（高权重像素主导切分方向） */
        var midPos = cnt >> 1;
        if (weight && bucket.wsum > 0) {
          var wcum = 0, half = bucket.wsum / 2;
          for (k = 0; k < cnt; k++) {
            wcum += weight[sorted[k]];
            if (wcum >= half) { midPos = k + 1; break; }
          }
          if (midPos <= 0) midPos = 1;
          if (midPos >= cnt) midPos = cnt - 1;
        }
        var leftW = 0;
        if (weight) for (k = 0; k < midPos; k++) leftW += weight[sorted[k]];
        buckets.splice(bi, 1);
        buckets.push({ px: sorted.subarray(0, midPos), count: midPos, wsum: leftW });
        buckets.push({ px: sorted.subarray(midPos), count: cnt - midPos, wsum: (bucket.wsum - leftW) });
      }

      var colors2 = buckets.length;
      var palette = new Uint8Array(colors2 * 4);
      var sr, sg, sb, sa;
      for (b = 0; b < colors2; b++) {
        var pxb = buckets[b].px, cntb = buckets[b].count;
        sr = 0; sg = 0; sb = 0; sa = 0;
        for (k = 0; k < cntb; k++) {
          o = pxb[k] * 4;
          a = data[o + 3];
          sr += data[o] * a; sg += data[o + 1] * a; sb += data[o + 2] * a; sa += a;
        }
        var div = cntb || 1, adiv = sa || 1;
        palette[b * 4] = (sr / adiv) | 0;
        palette[b * 4 + 1] = (sg / adiv) | 0;
        palette[b * 4 + 2] = (sb / adiv) | 0;
        palette[b * 4 + 3] = (sa / div) | 0;
      }
      return { palette: palette, colors: colors2 };
    }

    /* 最近色查找 LUT：RGB 高 5 位 → 索引（无抖动快速路径，仅不透明像素用） */
    function buildLUT(palette, colors) {
      var lut = new Uint8Array(32768);
      for (var ir = 0; ir < 32; ir++) {
        for (var ig = 0; ig < 32; ig++) {
          for (var ib = 0; ib < 32; ib++) {
            var r = (ir << 3) | 4, g = (ig << 3) | 4, b = (ib << 3) | 4;
            var best = 0, bd = Infinity;
            for (var c = 0; c < colors; c++) {
              var dr = r - palette[c * 4], dg = g - palette[c * 4 + 1], db = b - palette[c * 4 + 2];
              var d2 = dr * dr + dg * dg + db * db;
              if (d2 < bd) { bd = d2; best = c; }
            }
            lut[(ir << 10) | (ig << 5) | ib] = best;
          }
        }
      }
      return lut;
    }

    /* alpha 最小的调色板色（透明像素映射目标） */
    function transparentIndex(palette, colors) {
      var best = 0, ba = 255;
      for (var c = 0; c < colors; c++) {
        if (palette[c * 4 + 3] < ba) { ba = palette[c * 4 + 3]; best = c; }
      }
      return best;
    }

    /* palette 预乘值（r·a/256 近似 r·a/255），半透明匹配用 */
    function premult(palette, colors) {
      var pr = new Int16Array(colors), pg = new Int16Array(colors), pb = new Int16Array(colors);
      for (var c = 0; c < colors; c++) {
        var a = palette[c * 4 + 3];
        pr[c] = (palette[c * 4] * a) >> 8;
        pg[c] = (palette[c * 4 + 1] * a) >> 8;
        pb[c] = (palette[c * 4 + 2] * a) >> 8;
      }
      return { pr: pr, pg: pg, pb: pb };
    }

    /* 无抖动：不透明走 LUT；透明走最透明色；半透明走预乘距离逐像素 */
    function fastIndex(data, w, h, palette, colors) {
      var n = w * h;
      var indices = new Uint8Array(n);
      var lut = buildLUT(palette, colors);
      var ti = transparentIndex(palette, colors);
      var pm = premult(palette, colors);
      for (var i = 0; i < n; i++) {
        var o = i * 4;
        var a = data[o + 3];
        if (a === 0) { indices[i] = ti; continue; }
        if (a === 255) {
          indices[i] = lut[((data[o] >> 3) << 10) | ((data[o + 1] >> 3) << 5) | (data[o + 2] >> 3)];
          continue;
        }
        /* 半透明：预乘距离（alpha 也参与） */
        var rp = (data[o] * a) >> 8, gp = (data[o + 1] * a) >> 8, bp = (data[o + 2] * a) >> 8;
        var best = 0, bd = Infinity;
        for (var c = 0; c < colors; c++) {
          var dr = rp - pm.pr[c], dg = gp - pm.pg[c], db = bp - pm.pb[c], da = a - palette[c * 4 + 3];
          var d2 = dr * dr + dg * dg + db * db + da * da;
          if (d2 < bd) { bd = d2; best = c; }
        }
        indices[i] = best;
      }
      return indices;
    }

    /* Floyd-Steinberg 抖动：误差扩散（只扩散 RGB；透明像素直映最透明色且不扩散；半透明预乘匹配不扩散） */
    function ditherIndex(data, w, h, palette, colors) {
      var n = w * h;
      var indices = new Uint8Array(n);
      var errR = new Float32Array(n), errG = new Float32Array(n), errB = new Float32Array(n);
      var x, y, i, o, r, g, b, a, c, dr, dg, db, d2, best, bd, er, eg, eb, d;
      var ti = transparentIndex(palette, colors);
      var pm = premult(palette, colors);
      for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
          i = y * w + x;
          o = i * 4;
          a = data[o + 3];
          if (a === 0) { indices[i] = ti; continue; } /* 透明不参与量化与扩散 */
          r = data[o] + errR[i]; g = data[o + 1] + errG[i]; b = data[o + 2] + errB[i];
          if (r < 0) r = 0; else if (r > 255) r = 255;
          if (g < 0) g = 0; else if (g > 255) g = 255;
          if (b < 0) b = 0; else if (b > 255) b = 255;
          if (a < 255) {
            /* 半透明：预乘距离匹配，不扩散误差（避免透明边缘被错误色污染） */
            var rp = (r * a) >> 8, gp = (g * a) >> 8, bp = (b * a) >> 8;
            best = 0; bd = Infinity;
            for (c = 0; c < colors; c++) {
              dr = rp - pm.pr[c]; dg = gp - pm.pg[c]; db = bp - pm.pb[c]; d2 = dr * dr + dg * dg + db * db;
              var da = a - palette[c * 4 + 3];
              d2 += da * da;
              if (d2 < bd) { bd = d2; best = c; }
            }
            indices[i] = best;
            continue;
          }
          best = 0; bd = Infinity;
          for (c = 0; c < colors; c++) {
            dr = r - palette[c * 4]; dg = g - palette[c * 4 + 1]; db = b - palette[c * 4 + 2];
            d2 = dr * dr + dg * dg + db * db;
            if (d2 < bd) { bd = d2; best = c; }
          }
          indices[i] = best;
          er = r - palette[best * 4]; eg = g - palette[best * 4 + 1]; eb = b - palette[best * 4 + 2];
          if (x + 1 < w) {
            errR[i + 1] += er * 0.4375; errG[i + 1] += eg * 0.4375; errB[i + 1] += eb * 0.4375;
          }
          if (y + 1 < h) {
            d = i + w;
            errR[d] += er * 0.3125; errG[d] += eg * 0.3125; errB[d] += eb * 0.3125;
            if (x > 0) { errR[d - 1] += er * 0.1875; errG[d - 1] += eg * 0.1875; errB[d - 1] += eb * 0.1875; }
            if (x + 1 < w) { errR[d + 1] += er * 0.0625; errG[d + 1] += eg * 0.0625; errB[d + 1] += eb * 0.0625; }
          }
        }
      }
      return indices;
    }

    /* 调色板亮度排序：使空间相邻像素的索引值相近（渐变/平滑区索引连续），
       提升行滤波与 Deflate 的可压缩性（pngquant/TinyPNG 同款思路） */
    function sortPalette(palette, indices, colors) {
      var order = new Array(colors);
      for (var c = 0; c < colors; c++) {
        var r = palette[c * 4], g = palette[c * 4 + 1], b = palette[c * 4 + 2], a = palette[c * 4 + 3];
        order[c] = { i: c, l: (0.2126 * r + 0.7152 * g + 0.0722 * b) | 0, a: a };
      }
      order.sort(function (x, y) {
        if (x.l !== y.l) return x.l - y.l;
        return x.i - y.i;
      });
      var map = new Uint8Array(colors);
      var np = new Uint8Array(colors * 4);
      for (var k = 0; k < colors; k++) {
        map[order[k].i] = k;
        np[k * 4] = palette[order[k].i * 4];
        np[k * 4 + 1] = palette[order[k].i * 4 + 1];
        np[k * 4 + 2] = palette[order[k].i * 4 + 2];
        np[k * 4 + 3] = palette[order[k].i * 4 + 3];
      }
      for (var i = 0; i < indices.length; i++) indices[i] = map[indices[i]];
      palette.set(np);
    }

    /* 同步总入口：data 为 Uint8Array/Uint8ClampedArray（RGBA） */
    function quantizeSync(data, w, h, colors, dither) {
      var wm = computeWeights(data, w, h);
      var mc = medianCut(data, w, h, colors, wm.w, wm.total);
      var indices = dither
        ? ditherIndex(data, w, h, mc.palette, mc.colors)
        : fastIndex(data, w, h, mc.palette, mc.colors);
      sortPalette(mc.palette, indices, mc.colors); /* 亮度排序：提升编码可压缩性 */
      return { palette: mc.palette, indices: indices, colors: mc.colors };
    }

    return {
      quantizeSync: quantizeSync,
      medianCut: medianCut,
      fastIndex: fastIndex,
      ditherIndex: ditherIndex,
      computeWeights: computeWeights,
      sortPalette: sortPalette
    };
  }

  /* ========== Worker 内嵌源码（零外部请求，Blob URL） ========== */
  var WORKER_SRC = '(function(){var F=(' + quantizeFactory.toString() + ')();' +
    'self.onmessage=function(e){try{' +
    'var m=e.data;var data=new Uint8Array(m.data);' +
    'var r=F.quantizeSync(data,m.w,m.h,m.colors,!!m.dither);' +
    'postMessage({ok:true,palette:r.palette,indices:r.indices,colors:r.colors});' +
    '}catch(err){postMessage({ok:false,err:String((err&&err.message)||err)});}};})();';

  /* ========== 对外接口 ========== */
  /* 工厂实例缓存：quantizeSync 是工厂闭包局部，顶层函数必须经同一实例调用（否则 ReferenceError） */
  var QF = quantizeFactory();

  function quantize(imageData, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var runMain = function () {
        try {
          resolve(QF.quantizeSync(imageData.data, imageData.width, imageData.height,
            opts.colors, !!opts.dither));
        } catch (err) { reject(err); }
      };
      if (opts.useWorker !== false && root.Worker && root.Blob && root.URL) {
        var worker = null, url = null;
        try {
          url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'application/javascript' }));
          worker = new Worker(url);
        } catch (e) { runMain(); return; }
        var settled = false, timer = null;
        var cleanup = function () {
          if (timer) { clearTimeout(timer); timer = null; }
          if (url) { try { URL.revokeObjectURL(url); } catch (e) {} }
          if (worker) { try { worker.terminate(); } catch (e) {} }
        };
        /* 评审吸收⑥（补充）：Worker 构造成功但长时间不回消息（如 file:// 下
           Blob Worker 挂起）→ 超时降级主线程，杜绝 promise 永久 pending 卡死 UI */
        timer = setTimeout(function () {
          if (settled) return;
          settled = true; cleanup();
          runMain();
        }, 5000);
        worker.onmessage = function (e) {
          if (settled) return;
          settled = true; cleanup();
          if (e.data && e.data.ok) {
            resolve({
              palette: e.data.palette,
              indices: e.data.indices,
              colors: e.data.colors
            });
          } else {
            reject(new Error((e.data && e.data.err) || 'quantize worker failed'));
          }
        };
        worker.onerror = function () {
          if (settled) return;
          settled = true; cleanup();
          runMain(); /* 评审吸收⑥：Worker 失败 → 主线程降级，不报错不白屏 */
        };
        try {
          worker.postMessage({
            data: imageData.data.buffer,
            w: imageData.width,
            h: imageData.height,
            colors: opts.colors,
            dither: !!opts.dither
          });
        } catch (e) {
          if (!settled) { settled = true; cleanup(); runMain(); }
        }
        return;
      }
      runMain();
    });
  }

  root.PNGQuant = {
    quantize: quantize,
    quantizeSync: QF.quantizeSync
  };
})();
