/*!
 * Moteful QR Code Encoder（自研零依赖，方案 A）
 * 纯算法、无 DOM、不引用任何外部库。字节模式(UTF-8)，版本 1-10。
 * 暴露 window.MotefulQREncoder.encode(text, ecLevel) -> { version, size, modules, byteLen }
 *   modules: size×size 二维布尔表（true=深色模块）。
 * 说明：全部运算在浏览器本地完成。
 */
(function (global) {
  'use strict';

  /* ---- GF(256)，本原多项式 0x11D ---- */
  var EXP = new Array(256), LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 256; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
  })();
  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[(LOG[a] + LOG[b]) % 255];
  }
  function gfPow(a, n) { return EXP[(LOG[a] * n) % 255]; }

  /* ---- Reed-Solomon 生成多项式 / 编码 ---- */
  function rsGenerator(degree) {
    var poly = [1];
    for (var i = 0; i < degree; i++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], gfPow(2, i));
      }
      poly = next;
    }
    return poly;
  }
  function rsEncode(data, ecLen) {
    var gen = rsGenerator(ecLen);
    var buf = data.slice().concat(new Array(ecLen).fill(0));
    for (var i = 0; i < data.length; i++) {
      var coef = buf[i];
      if (coef !== 0) {
        for (var j = 0; j < gen.length; j++) buf[i + j] ^= gfMul(gen[j], coef);
      }
    }
    return buf.slice(data.length);
  }

  /* ---- 版本/纠错块表（ISO/IEC 18004，版本 1-10，字节模式）----
   * 每级：{ ec: 每块纠错码字数, groups:[[该组块数, 每块数据码字数]...] }
   * 总数据码字数 = Σ(组块数 × 每块数据码字数)。
   */
  var BLOCKS = [
    /* v1 */ { L: { ec: 7,  g: [[1, 19]] }, M: { ec: 10, g: [[1, 14]] }, Q: { ec: 13, g: [[1, 11]] }, H: { ec: 17, g: [[1, 9]] } },
    /* v2 */ { L: { ec: 10, g: [[1, 34]] }, M: { ec: 16, g: [[1, 26]] }, Q: { ec: 22, g: [[1, 20]] }, H: { ec: 28, g: [[1, 16]] } },
    /* v3 */ { L: { ec: 15, g: [[1, 55]] }, M: { ec: 26, g: [[1, 42]] }, Q: { ec: 18, g: [[2, 15]] }, H: { ec: 22, g: [[2, 13]] } },
    /* v4 */ { L: { ec: 20, g: [[1, 80]] }, M: { ec: 18, g: [[2, 18]] }, Q: { ec: 16, g: [[4, 20]] }, H: { ec: 26, g: [[4, 9]] } },
    /* v5 */ { L: { ec: 26, g: [[1, 106]] }, M: { ec: 24, g: [[2, 24]] }, Q: { ec: 18, g: [[2, 15], [2, 16]] }, H: { ec: 24, g: [[2, 11], [2, 12]] } },
    /* v6 */ { L: { ec: 18, g: [[2, 68]] }, M: { ec: 16, g: [[4, 18]] }, Q: { ec: 24, g: [[4, 19]] }, H: { ec: 18, g: [[4, 15]] } },
    /* v7 */ { L: { ec: 20, g: [[2, 78]] }, M: { ec: 18, g: [[4, 19]] }, Q: { ec: 18, g: [[2, 14], [4, 15]] }, H: { ec: 18, g: [[4, 13], [1, 14]] } },
    /* v8 */ { L: { ec: 24, g: [[2, 97]] }, M: { ec: 22, g: [[2, 14], [2, 15]] }, Q: { ec: 18, g: [[4, 18], [2, 19]] }, H: { ec: 14, g: [[4, 14], [2, 15]] } },
    /* v9 */ { L: { ec: 30, g: [[2, 116]] }, M: { ec: 22, g: [[4, 16], [2, 17]] }, Q: { ec: 18, g: [[4, 21], [2, 22]] }, H: { ec: 18, g: [[4, 16], [2, 17]] } },
    /* v10*/ { L: { ec: 18, g: [[2, 68], [2, 69]] }, M: { ec: 26, g: [[4, 19], [1, 20]] }, Q: { ec: 18, g: [[6, 21], [2, 22]] }, H: { ec: 18, g: [[6, 18], [2, 19]] } }
  ];
  // 对齐模式中心坐标（版本>=2），v1 为空
  var ALIGN = [
    [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]
  ];

  function capacity(v, ec) {
    var blk = BLOCKS[v - 1][ec];
    var data = 0;
    blk.g.forEach(function (gr) { data += gr[0] * gr[1]; });
    return data;
  }

  /* UTF-8 编码 */
  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F)); }
      else if (c >= 0xD800 && c <= 0xDBFF) {
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c & 0x3FF) << 10) + (c2 & 0x3FF);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
      } else {
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      }
    }
    return out;
  }

  /* 选择版本：找到能装下数据 + 模式头的最小版本 */
  function pickVersion(byteLen, ec) {
    for (var v = 1; v <= 10; v++) {
      // 字节模式：4 位模式 + 字符计数指示位 + 8*byteLen 位
      var countBits = (v <= 9) ? 8 : 16;
      var needBits = 4 + countBits + byteLen * 8;
      if (needBits <= capacity(v, ec) * 8) return v;
    }
    return -1; // 超长
  }

  /* 数据位流组装 → 码字（含终止符、补零、填充字节） */
  function buildCodewords(v, ec, byteLen, bytes) {
    var countBits = (v <= 9) ? 8 : 16;
    var dataCap = capacity(v, ec);
    var bits = [];
    function push(b, n) { for (var i = n - 1; i >= 0; i--) bits.push((b >> i) & 1); }
    push(0x4, 4);           // 字节模式指示
    push(byteLen, countBits);
    bytes.forEach(function (b) { push(b, 8); });
    // 终止符（最多 4 个 0）
    var term = Math.min(4, dataCap * 8 - bits.length);
    for (var t = 0; t < term; t++) bits.push(0);
    // 字节对齐
    while (bits.length % 8 !== 0) bits.push(0);
    // 转码字
    var codewords = [];
    for (var i = 0; i < bits.length; i += 8) {
      var byte = 0;
      for (var j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
      codewords.push(byte);
    }
    // 填充字节 0xEC 0x11 交替
    var pad = [0xEC, 0x11];
    var k = 0;
    while (codewords.length < dataCap) codewords.push(pad[k++ % 2]);
    return codewords;
  }

  /* 按块拆分 → 每块 RS 编码 → 交错 */
  function interleave(v, ec, dataCw) {
    var blk = BLOCKS[v - 1][ec];
    var blocks = [];
    var idx = 0;
    blk.g.forEach(function (gr) {
      var count = gr[0], dlen = gr[1];
      for (var i = 0; i < count; i++) {
        var d = dataCw.slice(idx, idx + dlen);
        idx += dlen;
        blocks.push({ d: d, e: rsEncode(d, blk.ec) });
      }
    });
    // 交错：先交错数据（按列），再交错纠错
    var out = [];
    var maxD = 0;
    blocks.forEach(function (b) { if (b.d.length > maxD) maxD = b.d.length; });
    for (var c = 0; c < maxD; c++) {
      blocks.forEach(function (b) { if (c < b.d.length) out.push(b.d[c]); });
    }
    var maxE = blocks[0].e.length;
    for (var c = 0; c < maxE; c++) {
      blocks.forEach(function (b) { out.push(b.e[c]); });
    }
    return out;
  }

  /* 矩阵绘制 */
  function makeMatrix(v) {
    var size = 17 + 4 * v;
    var m = [];
    for (var r = 0; r < size; r++) { m.push(new Array(size).fill(null)); }
    function set(r, c, dark) { m[r][c] = dark; }
    function inRange(r, c) { return r >= 0 && r < size && c >= 0 && c < size; }
    // 定位图案
    function finder(row, col) {
      for (var r = -1; r <= 7; r++) for (var c = -1; c <= 7; c++) {
        var rr = row + r, cc = col + c;
        if (!inRange(rr, cc)) continue;
        var dark;
        if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
          dark = (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        } else dark = false; // 分隔线
        set(rr, cc, dark);
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    // 时序图案
    for (var i = 8; i < size - 8; i++) {
      if (m[6][i] === null) set(6, i, i % 2 === 0);
      if (m[i][6] === null) set(i, 6, i % 2 === 0);
    }
    // 暗模块
    set(size - 8, 8, true);
    // 对齐图案（跳过与三个 finder 角重叠的位置）
    var ap = ALIGN[v - 1];
    for (var i = 0; i < ap.length; i++) for (var j = 0; j < ap.length; j++) {
      var row = ap[i], col = ap[j];
      if (v === 1) continue;
      var inTL = row <= 8 && col <= 8;
      var inTR = row <= 8 && col >= size - 8;
      var inBL = row >= size - 8 && col <= 8;
      if (inTL || inTR || inBL) continue;
      for (var r = -2; r <= 2; r++) for (var c = -2; c <= 2; c++) {
        var dark = (Math.max(Math.abs(r), Math.abs(c)) !== 1);
        set(row + r, col + c, dark);
      }
    }
    // 预留格式信息位置（占位，placeData 跳过，否则数据错位）
    var fiL = [ [8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],
                [7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8] ];
    for (var k = 0; k < fiL.length; k++) {
      var fr = fiL[k][0], fc = fiL[k][1];
      if (m[fr][fc] === null) m[fr][fc] = false;
    }
    for (var k2 = 0; k2 < 7; k2++) {
      if (m[8][size-1-k2] === null) m[8][size-1-k2] = false;
      if (m[size-1-k2][8] === null) m[size-1-k2][8] = false;
    }
    return m;
  }

  /* 格式信息位放置（mask 未定时先用占位，最终统一画） */
  function placeFormat(m, size, mask, ecBits) {
    function put(r, c, dark) { m[r][c] = dark; }
    // ecBits: L=01,M=00,Q=11,H=10（格式信息用的纠错指示）
    var fmt = (ecBits << 3) | mask;
    var bch = fmt << 10;
    var g = 0x537; // 多项式 10100111
    for (var i = 14; i >= 10; i--) {
      if ((bch >> i) & 1) bch ^= g << (i - 10);
    }
    var bits = ((fmt << 10) | bch) ^ 0x5412; // 掩码 101010000010010
    // 沿垂直/水平边放置 15 位
    for (var i = 0; i <= 5; i++) put(8, i, ((bits >> i) & 1) === 1);
    put(8, 7, ((bits >> 6) & 1) === 1);
    put(8, 8, ((bits >> 7) & 1) === 1);
    put(7, 8, ((bits >> 8) & 1) === 1);
    for (var i = 9; i < 15; i++) put(14 - i, 8, ((bits >> i) & 1) === 1);
    for (var i = 0; i < 8; i++) put(8, size - 1 - i, ((bits >> i) & 1) === 1);
    for (var i = 8; i < 15; i++) put(size - 15 + i, 8, ((bits >> i) & 1) === 1);
  }

  /* 数据位蛇形放置 */
  function placeData(m, size, codewords) {
    var bit = 0, total = codewords.length * 8;
    var upward = true;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--; // 跳过竖时序线
      for (var i = 0; i < size; i++) {
        var row = upward ? size - 1 - i : i;
        for (var c = 0; c < 2; c++) {
          var cc = col - c;
          if (m[row][cc] === null) {
            var dark = false;
            if (bit < total) dark = ((codewords[bit >> 3] >> (7 - (bit & 7))) & 1) === 1;
            m[row][cc] = dark;
            bit++;
          }
        }
      }
      upward = !upward;
    }
  }

  /* 掩码惩罚分 */
  function penalty(m, size) {
    var score = 0;
    function rowScan(get) {
      for (var i = 0; i < size; i++) {
        var prev = -1, run = 0;
        for (var j = 0; j < size; j++) {
          var d = get(i, j);
          if (d === prev) run++;
          else { if (run >= 5) score += (run - 2); run = 1; }
          prev = d;
        }
        if (run >= 5) score += (run - 2);
      }
    }
    rowScan(function (r, c) { return m[r][c]; });
    rowScan(function (r, c) { return m[c][r]; });
    // 同色块 2x2
    for (var r = 0; r < size - 1; r++) for (var c = 0; c < size - 1; c++) {
      var d = m[r][c];
      if (m[r][c + 1] === d && m[r + 1][c] === d && m[r + 1][c + 1] === d) score += 3;
    }
    // finder 状色块行/列（简化：对 1011101 间 4 白模式各计分）
    function pattern(line) {
      var p = [1, 0, 1, 1, 1, 0, 1];
      for (var s = 0; s + 7 <= size; s++) {
        var hit = true;
        for (var k = 0; k < 7; k++) if (line[s + k] !== p[k]) { hit = false; break; }
        if (hit) {
          var left = s - 4, right = s + 7;
          if (left >= 0 && line[left] === 0 && line[left - 1] === 0 && line[left - 2] === 0 && line[left - 3] === 0) score += 40;
          if (right <= size - 1 && line[right] === 0 && line[right + 1] === 0 && line[right + 2] === 0 && line[right + 3] === 0) score += 40;
        }
      }
    }
    for (var r = 0; r < size; r++) { var row = m[r].slice(); pattern(row); }
    for (var c = 0; c < size; c++) { var col = []; for (var r = 0; r < size; r++) col.push(m[r][c]); pattern(col); }
    // 深色比例
    var dark = 0;
    for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) if (m[r][c]) dark++;
    var ratio = dark / (size * size);
    var t = Math.floor(Math.abs(ratio * 100 - 50) / 5);
    score += t * 10;
    return score;
  }

  var EC_BITS = { L: 0x01, M: 0x00, Q: 0x03, H: 0x02 };

  function encode(text, ec) {
    ec = ec || 'M';
    var bytes = utf8Bytes(text == null ? '' : String(text));
    var v = pickVersion(bytes.length, ec);
    if (v < 0) return { error: 'too-long' };
    var dataCw = buildCodewords(v, ec, bytes.length, bytes);
    var cw = interleave(v, ec, dataCw);
    var size = 17 + 4 * v;
    // 预计算对齐图案中心（掩码时需排除其 5x5 区域）
    var apList = [];
    var apAll = ALIGN[v - 1];
    for (var ai = 0; ai < apAll.length; ai++) for (var aj = 0; aj < apAll.length; aj++) {
      var ar = apAll[ai], ac = apAll[aj];
      if ((ar <= 8 && ac <= 8) || (ar <= 8 && ac >= size - 8) || (ar >= size - 8 && ac <= 8)) continue;
      apList.push([ar, ac]);
    }
    function isReserved(r, c, size) {
      if ((r < 9 && c < 9) || (r < 9 && c >= size - 8) || (r >= size - 8 && c < 9)) return true;
      if (r === 6 || c === 6) return true;
      for (var k = 0; k < apList.length; k++) {
        if (Math.abs(r - apList[k][0]) <= 2 && Math.abs(c - apList[k][1]) <= 2) return true;
      }
      return false;
    }
    var best = null;
    for (var mask = 0; mask < 8; mask++) {
      var m = makeMatrix(v);
      placeData(m, size, cw);
      // 应用掩码
      for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) {
        if (m[r][c] === null) continue;
        if (!isReserved(r, c, size)) {
          var flip;
          switch (mask) {
            case 0: flip = (r + c) % 2 === 0; break;
            case 1: flip = r % 2 === 0; break;
            case 2: flip = c % 3 === 0; break;
            case 3: flip = (r + c) % 3 === 0; break;
            case 4: flip = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; break;
            case 5: flip = ((r * c) % 2) + ((r * c) % 3) === 0; break;
            case 6: flip = (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; break;
            case 7: flip = (((r * c) % 3) + ((r + c) % 2)) % 2 === 0; break;
          }
          if (flip) m[r][c] = !m[r][c];
        }
      }
      placeFormat(m, size, mask, EC_BITS[ec]);
      var sc = penalty(m, size);
      if (!best || sc < best.score) best = { m: m, score: sc, mask: mask };
    }
    return { version: v, size: size, modules: best.m, byteLen: bytes.length, mask: best.mask };
  }

  global.MotefulQREncoder = { encode: encode, capacity: capacity, pickVersion: pickVersion };
})(window);
