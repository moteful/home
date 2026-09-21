/* ============================================================
   Moteful - tools/qrcode.html encoder core
   Based on kazuhikoarase/qrcode-generator (MIT License)
   Zero dependency, pure frontend, localized
   ============================================================ */
(function (window) {
  'use strict';

  var EXP = new Array(256), LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    EXP[255] = EXP[0];
  })();
  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[(LOG[a] + LOG[b]) % 255];
  }

  function rsGenerator(degree) {
    var poly = [1];
    for (var i = 0; i < degree; i++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], EXP[i]);
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

  var TOTAL_CW = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
  var BLOCKS = [
    0,
    { L: 1, M: 1, Q: 1, H: 1 },
    { L: 1, M: 1, Q: 1, H: 1 },
    { L: 1, M: 1, Q: 2, H: 2 },
    { L: 1, M: 2, Q: 2, H: 4 },
    { L: 1, M: 2, Q: 4, H: 4 },
    { L: 2, M: 4, Q: 4, H: 4 },
    { L: 2, M: 4, Q: 6, H: 5 },
    { L: 2, M: 4, Q: 6, H: 6 },
    { L: 2, M: 5, Q: 8, H: 8 },
    { L: 4, M: 5, Q: 8, H: 8 }
  ];
  var EC_CW = [
    0,
    { L: 7, M: 10, Q: 13, H: 17 },
    { L: 10, M: 16, Q: 22, H: 28 },
    { L: 15, M: 26, Q: 36, H: 44 },
    { L: 20, M: 36, Q: 52, H: 64 },
    { L: 26, M: 48, Q: 72, H: 88 },
    { L: 36, M: 64, Q: 96, H: 112 },
    { L: 40, M: 72, Q: 108, H: 130 },
    { L: 48, M: 88, Q: 132, H: 156 },
    { L: 60, M: 110, Q: 160, H: 192 },
    { L: 72, M: 130, Q: 192, H: 224 }
  ];
  var ALIGN = [
    [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]
  ];

  function splitBlocks(v, ec) {
    var total = TOTAL_CW[v];
    var ecTotal = EC_CW[v][ec];
    var dataTotal = total - ecTotal;
    var nBlocks = BLOCKS[v][ec];
    var g2 = total % nBlocks;
    var g1 = nBlocks - g2;
    var cwG1 = Math.floor(total / nBlocks);
    var dataG1 = Math.floor(dataTotal / nBlocks);
    var dataG2 = dataG1 + 1;
    var ecLen = cwG1 - dataG1;
    var blocks = [];
    for (var i = 0; i < g1; i++) blocks.push({ data: dataG1, ec: ecLen });
    for (var i = 0; i < g2; i++) blocks.push({ data: dataG2, ec: ecLen });
    return blocks;
  }

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

  function buildCodewords(v, ec, byteLen, bytes) {
    var countBits = (v <= 9) ? 8 : 16;
    var dataCap = 0;
    splitBlocks(v, ec).forEach(function (b) { dataCap += b.data; });
    var bits = [];
    function push(b, n) { for (var i = n - 1; i >= 0; i--) bits.push((b >> i) & 1); }
    push(0x4, 4);
    push(byteLen, countBits);
    bytes.forEach(function (b) { push(b, 8); });
    var term = Math.min(4, dataCap * 8 - bits.length);
    for (var t = 0; t < term; t++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);
    var codewords = [];
    for (var i = 0; i < bits.length; i += 8) {
      var byte = 0;
      for (var j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
      codewords.push(byte);
    }
    var pad = [0xEC, 0x11];
    var k = 0;
    while (codewords.length < dataCap) codewords.push(pad[k++ % 2]);
    return codewords;
  }

  function interleave(v, ec, dataCw) {
    var spec = splitBlocks(v, ec);
    var blocks = [];
    var idx = 0;
    spec.forEach(function (b) {
      var d = dataCw.slice(idx, idx + b.data);
      idx += b.data;
      blocks.push({ d: d, e: rsEncode(d, b.ec) });
    });
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

  function makeMatrix(v) {
    var size = 17 + 4 * v;
    var m = [];
    for (var r = 0; r < size; r++) m.push(new Array(size).fill(null));
    function set(r, c, dark) { m[r][c] = dark; }
    function inRange(r, c) { return r >= 0 && r < size && c >= 0 && c < size; }

    function finder(row, col) {
      for (var r = -1; r <= 7; r++) for (var c = -1; c <= 7; c++) {
        var rr = row + r, cc = col + c;
        if (!inRange(rr, cc)) continue;
        var dark;
        if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
          dark = (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        } else dark = false;
        set(rr, cc, dark);
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    for (var i = 8; i < size - 8; i++) {
      if (m[6][i] === null) set(6, i, i % 2 === 0);
      if (m[i][6] === null) set(i, 6, i % 2 === 0);
    }

    set(size - 8, 8, true);

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

    var fiL = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
    var fiR = [[8,size-1],[8,size-2],[8,size-3],[8,size-4],[8,size-5],[8,size-6],[8,size-7],[8,size-8],
               [size-1,8],[size-2,8],[size-3,8],[size-4,8],[size-5,8],[size-6,8],[size-7,8]];
    fiL.concat(fiR).forEach(function (p) { if (m[p[0]][p[1]] === null) set(p[0], p[1], false); });

    return m;
  }

  function placeData(m, size, codewords) {
    var row = size - 1, inc = -1, bitIndex = 7, byteIndex = 0;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      while (true) {
        for (var c = 0; c < 2; c++) {
          if (m[row][col - c] === null) {
            var dark = false;
            if (byteIndex < codewords.length) {
              dark = (((codewords[byteIndex] >>> bitIndex) & 1) === 1);
            }
            m[row][col - c] = dark;
            bitIndex--;
            if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
          }
        }
        row += inc;
        if (row < 0 || size <= row) { row -= inc; inc = -inc; break; }
      }
    }
  }

  var EC_BITS = { L: 0x01, M: 0x00, Q: 0x03, H: 0x02 };
  function placeFormat(m, size, mask, ecBits) {
    var fmt = (ecBits << 3) | mask;
    var bch = fmt << 10;
    var g = 0x537;
    for (var i = 14; i >= 10; i--) {
      if ((bch >> i) & 1) bch ^= g << (i - 10);
    }
    var bits = ((fmt << 10) | bch) ^ 0x5412;

    for (var i = 0; i < 15; i++) {
      var mod = ((bits >> i) & 1) === 1;
      if (i < 6) m[i][8] = mod;
      else if (i < 8) m[i + 1][8] = mod;
      else m[size - 15 + i][8] = mod;
      if (i < 8) m[8][size - i - 1] = mod;
      else if (i < 9) m[8][15 - i - 1 + 1] = mod;
      else m[8][15 - i - 1] = mod;
    }
  }

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
    for (var r = 0; r < size - 1; r++) for (var c = 0; c < size - 1; c++) {
      var d = m[r][c];
      if (m[r][c + 1] === d && m[r + 1][c] === d && m[r + 1][c + 1] === d) score += 3;
    }
    function pattern(line) {
      var p = [1, 0, 1, 1, 1, 0, 1];
      for (var s = 0; s + 7 <= size; s++) {
        var hit = true;
        for (var k = 0; k < 7; k++) if (line[s + k] !== p[k]) { hit = false; break; }
        if (hit) score += 40;
      }
    }
    for (var r = 0; r < size; r++) pattern(m[r]);
    for (var c = 0; c < size; c++) {
      var col = [];
      for (var r = 0; r < size; r++) col.push(m[r][c]);
      pattern(col);
    }
    var dark = 0;
    for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) if (m[r][c]) dark++;
    var ratio = Math.abs(dark * 20 - size * size * 10) / (size * size * 10);
    score += Math.floor(ratio) * 10;
    return score;
  }

  function pickVersion(byteLen, ec) {
    for (var v = 1; v <= 10; v++) {
      var countBits = (v <= 9) ? 8 : 16;
      var needBits = 4 + countBits + byteLen * 8;
      var dataCap = 0;
      splitBlocks(v, ec).forEach(function (b) { dataCap += b.data; });
      if (needBits <= dataCap * 8) return v;
    }
    return -1;
  }

  function encode(text, ec) {
    ec = ec || 'M';
    var bytes = utf8Bytes(text == null ? '' : String(text));
    var v = pickVersion(bytes.length, ec);
    if (v < 0) return { error: 'too-long' };
    var dataCw = buildCodewords(v, ec, bytes.length, bytes);
    var cw = interleave(v, ec, dataCw);
    var size = 17 + 4 * v;

    var apList = [];
    var apAll = ALIGN[v - 1];
    for (var ai = 0; ai < apAll.length; ai++) for (var aj = 0; aj < apAll.length; aj++) {
      var ar = apAll[ai], ac = apAll[aj];
      if ((ar <= 8 && ac <= 8) || (ar <= 8 && ac >= size - 8) || (ar >= size - 8 && ac <= 8)) continue;
      apList.push([ar, ac]);
    }
    function isReserved(r, c) {
      if ((r < 9 && c < 9) || (r < 9 && c >= size - 8) || (r >= size - 8 && c < 8)) return true;
      if (r === size - 8 && c === 8) return true; // dark module
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
      for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) {
        if (m[r][c] === null) continue;
        if (!isReserved(r, c)) {
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

  window.MotefulQREncoder = { encode: encode, pickVersion: pickVersion };
})(window);
