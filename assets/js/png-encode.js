/* Moteful · png-encode.js · v1.8.0（位深自适应）
 * 自研调色板 PNG 编码器（color type 3：IHDR / PLTE / tRNS / IDAT / IEND）。
 * deflate 由本地 pako（assets/vendor/pako/pako.min.js）完成，懒加载由调用方保证；
 * CRC32 查表（标准多项式 0xEDB88320，与 zip.js 同款实现）；
 * 滤波：None / Sub / Up / Average / Paeth 逐行试算，取绝对值总和最小者。
 * 位深自适应：按实际用色数选 1/2/4/8 bit（≤2→1bit、≤4→2bit、≤16→4bit、否则 8bit），
 * 打包索引为最小位深字节流（高位在前），滤波在打包字节上按 bpp=1 进行（PNG spec）。
 *
 * 用法（前提 window.pako 已加载）：
 *   var bytes = PNGEncode.encode({
 *     width: w, height: h,
 *     colors: n, palette: Uint8Array(n*4, RGBA), indices: Uint8Array(w*h)
 *   });
 *   // bytes 为完整 PNG 文件（Uint8Array）
 */
(function () {
  'use strict';
  var root = (typeof window !== 'undefined') ? window : globalThis;

  /* ========== CRC32 查表（与 zip.js 同款，独立实现不依赖 zip.js） ========== */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256), n, c, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var crc = 0xFFFFFFFF, i;
    for (i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /* ========== PNG chunk ========== */
  function chunk(type, data) {
    var len = data.length;
    var out = new Uint8Array(8 + len + 4);
    var dv = new DataView(out.buffer);
    dv.setUint32(0, len, false);
    for (var i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + len, crc32(out.subarray(4, 8 + len)), false);
    return out;
  }

  /* ========== Paeth 预测器 ========== */
  function paeth(a, b, c) {
    var p = a + b - c;
    var pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  }

  /* 行滤波选优：返回带滤波字节的整行（bpp = 字节/像素，此处恒为 1） */
  function filterLine(prev, curr, bpp) {
    var len = curr.length;
    var bestBytes = null, bestSum = Infinity, i, x, v;

    /* None */
    var nf = new Uint8Array(len + 1);
    nf.set(curr, 1);
    var s = 0;
    for (i = 0; i < len; i++) s += Math.abs(curr[i]);
    if (s < bestSum) { bestSum = s; bestBytes = nf; }

    /* Sub */
    var sf = new Uint8Array(len + 1);
    sf[0] = 1;
    s = 0;
    for (x = 0; x < len; x++) {
      v = x < bpp ? curr[x] : curr[x] - curr[x - bpp];
      sf[x + 1] = v & 255;
      s += v < 0 ? -v : v;
    }
    if (s < bestSum) { bestSum = s; bestBytes = sf; }

    /* Up */
    var uf = new Uint8Array(len + 1);
    uf[0] = 2;
    s = 0;
    for (x = 0; x < len; x++) {
      v = curr[x] - prev[x];
      uf[x + 1] = v & 255;
      s += v < 0 ? -v : v;
    }
    if (s < bestSum) { bestSum = s; bestBytes = uf; }

    /* Average */
    var af = new Uint8Array(len + 1);
    af[0] = 3;
    s = 0;
    for (x = 0; x < len; x++) {
      var l = x < bpp ? 0 : curr[x - bpp];
      v = curr[x] - ((l + prev[x]) >> 1);
      af[x + 1] = v & 255;
      s += v < 0 ? -v : v;
    }
    if (s < bestSum) { bestSum = s; bestBytes = af; }

    /* Paeth */
    var pf = new Uint8Array(len + 1);
    pf[0] = 4;
    s = 0;
    for (x = 0; x < len; x++) {
      var pl = x < bpp ? 0 : curr[x - bpp];
      var pu = prev[x];
      var pul = x < bpp ? 0 : prev[x - bpp];
      v = curr[x] - paeth(pl, pu, pul);
      pf[x + 1] = v & 255;
      s += v < 0 ? -v : v;
    }
    if (s < bestSum) { bestSum = s; bestBytes = pf; }

    return bestBytes;
  }

  /* ========== 编码主入口 ========== */
  function encode(opts) {
    if (!root.pako) throw new Error('pako 未加载，无法完成 PNG 编码');
    var w = opts.width, h = opts.height;

    /* ---- 真彩分支（color type 2 RGB / type 6 RGBA）：raw = Uint8Array(w*h*4) RGBA，无损压缩 ----
     * 用于「高质量」预设、256 色档与渐变/照片类图（均衡自动判档高估），跳过调色板量化、像素零丢失。
     * 全不透明 → type 2（RGB，每像素取前 3 字节）；含透明 → type 6（RGBA 全保留）。 */
    if (opts.raw) {
      var needA = false;
      for (var ai = 3; ai < opts.raw.length; ai += 4) { if (opts.raw[ai] !== 255) { needA = true; break; } }
      var chan = needA ? 4 : 3;
      var srcW = w * chan;
      var ihdr2 = new Uint8Array(13);
      var dv2 = new DataView(ihdr2.buffer);
      dv2.setUint32(0, w, false);
      dv2.setUint32(4, h, false);
      ihdr2[8] = 8;   /* bit depth */
      ihdr2[9] = needA ? 6 : 2;   /* color type: 真彩 RGBA / RGB */
      ihdr2[10] = 0; ihdr2[11] = 0; ihdr2[12] = 0;
      var chunks2 = [chunk('IHDR', ihdr2)];
      var rawLine = new Uint8Array(srcW);
      var rawBytes = new Uint8Array((srcW + 1) * h);
      var prev3 = new Uint8Array(srcW);
      for (var y3 = 0; y3 < h; y3++) {
        var base3 = y3 * w * 4;
        if (needA) {
          rawLine.set(opts.raw.subarray(base3, base3 + srcW));
        } else {
          for (var x3 = 0; x3 < w; x3++) {
            rawLine[x3 * 3] = opts.raw[base3 + x3 * 4];
            rawLine[x3 * 3 + 1] = opts.raw[base3 + x3 * 4 + 1];
            rawLine[x3 * 3 + 2] = opts.raw[base3 + x3 * 4 + 2];
          }
        }
        var line3 = filterLine(prev3, rawLine, chan);
        rawBytes.set(line3, y3 * (srcW + 1));
        prev3.set(rawLine);
      }
      var comp3 = root.pako.deflate(rawBytes, { level: (opts.level === undefined ? 6 : opts.level) });
      chunks2.push(chunk('IDAT', comp3));
      chunks2.push(chunk('IEND', new Uint8Array(0)));
      var total2 = 8;
      for (var i2 = 0; i2 < chunks2.length; i2++) total2 += chunks2[i2].length;
      var out2 = new Uint8Array(total2);
      out2[0] = 0x89; out2[1] = 0x50; out2[2] = 0x4E; out2[3] = 0x47;
      out2[4] = 0x0D; out2[5] = 0x0A; out2[6] = 0x1A; out2[7] = 0x0A;
      var off2 = 8;
      for (i2 = 0; i2 < chunks2.length; i2++) { out2.set(chunks2[i2], off2); off2 += chunks2[i2].length; }
      return out2;
    }

    /* ---- 调色板分支（color type 3）：colors ≤ 256 有损量化后编码 ---- */
    var colors = opts.colors;
    var palette = opts.palette, indices = opts.indices;

    /* 实际用色数 → 最小位深（打包后 IDAT 数据量大幅下降） */
    var used = new Uint8Array(colors), usedCount = 0, ui;
    for (ui = 0; ui < indices.length; ui++) {
      if (!used[indices[ui]]) { used[indices[ui]] = 1; usedCount++; }
    }
    var bits = usedCount <= 2 ? 1 : (usedCount <= 4 ? 2 : (usedCount <= 16 ? 4 : 8));

    /* IHDR */
    var ihdr = new Uint8Array(13);
    var dv = new DataView(ihdr.buffer);
    dv.setUint32(0, w, false);
    dv.setUint32(4, h, false);
    ihdr[8] = bits;  /* bit depth：按实际用色自适应 1/2/4/8 */
    ihdr[9] = 3;   /* color type: 调色板 */
    ihdr[10] = 0;  /* compression */
    ihdr[11] = 0;  /* filter */
    ihdr[12] = 0;  /* interlace */
    var chunks = [chunk('IHDR', ihdr)];

    /* PLTE */
    var plte = new Uint8Array(colors * 3);
    for (var i = 0; i < colors; i++) {
      plte[i * 3] = palette[i * 4];
      plte[i * 3 + 1] = palette[i * 4 + 1];
      plte[i * 3 + 2] = palette[i * 4 + 2];
    }
    chunks.push(chunk('PLTE', plte));

    /* tRNS：仅当存在 alpha < 255 */
    var needTrns = false;
    for (i = 0; i < colors; i++) {
      if (palette[i * 4 + 3] < 255) { needTrns = true; break; }
    }
    if (needTrns) {
      var trns = new Uint8Array(colors);
      for (i = 0; i < colors; i++) trns[i] = palette[i * 4 + 3];
      chunks.push(chunk('tRNS', trns));
    }

    /* IDAT：索引按最小位深打包 + 逐行滤波选优 + pako deflate（zlib） */
    var per = 8 / bits;
    var bw = Math.ceil(w / per);   /* 每行打包后字节数 */
    var mask = (1 << bits) - 1;
    var raw = new Uint8Array((bw + 1) * h);
    var prev = new Uint8Array(bw);
    var line = new Uint8Array(bw);
    for (var y = 0; y < h; y++) {
      line.fill(0);
      var rowBase = y * w;
      for (var x = 0; x < w; x++) {
        var idx = indices[rowBase + x];
        line[(x / per) | 0] |= (idx & mask) << ((per - 1 - (x % per)) * bits);
      }
      var fl = filterLine(prev, line, 1);
      raw.set(fl, y * (bw + 1));
      prev.set(line);
    }
    var compressed = root.pako.deflate(raw, { level: (opts.level === undefined ? 6 : opts.level) });
    chunks.push(chunk('IDAT', compressed));
    chunks.push(chunk('IEND', new Uint8Array(0)));

    /* 拼装 */
    var total = 8;
    for (i = 0; i < chunks.length; i++) total += chunks[i].length;
    var out = new Uint8Array(total);
    out[0] = 0x89; out[1] = 0x50; out[2] = 0x4E; out[3] = 0x47;
    out[4] = 0x0D; out[5] = 0x0A; out[6] = 0x1A; out[7] = 0x0A;
    var off = 8;
    for (i = 0; i < chunks.length; i++) { out.set(chunks[i], off); off += chunks[i].length; }
    return out;
  }

  root.PNGEncode = { encode: encode, crc32: crc32 };
})();
