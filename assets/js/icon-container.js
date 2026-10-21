/* =========================================================================
   Moteful 图标容器编解码（icon-container.js）
   零依赖、纯前端、Big-endian/Little-endian 均按规范处理。
   ICO（Windows 图标，多尺寸 PNG 条目，Vista+ 兼容）
   ICNS（macOS 图标，PNG 块，10.7+ 兼容）
   导出 window.MotefulIconContainer = { decodeIco, decodeIcns, encodeIco, encodeIcns }
   ========================================================================= */
(function () {
  'use strict';

  /* ---- 基础工具 ---- */
  function u16le(dv, o) { return dv.getUint16(o, true); }
  function u32le(dv, o) { return dv.getUint32(o, true); }
  function u32be(dv, o) { return dv.getUint32(o, false); }
  function isPng(dv, o) { return dv.getUint32(o, false) === 0x89504E47; }
  function bytesToDataURL(bytes, mime) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return 'data:' + (mime || 'image/png') + ';base64,' + btoa(bin);
  }

  /* 位掩码取色：按掩码位移 + 位宽归一化到 0-255 */
  function maskChannel(v, mask) {
    if (!mask) return 0;
    var lsb = 0, m = mask;
    while (!(m & 1)) { m >>>= 1; lsb++; }
    var bits = 0, mm = mask >>> lsb;
    while (mm) { bits++; mm >>>= 1; }
    var raw = (v & mask) >>> lsb;
    return bits >= 8 ? raw : Math.round(raw * 255 / ((1 << bits) - 1));
  }

  /* ---- BMP 解码（ICO 内嵌位图条目，BITMAPINFOHEADER，1/4/8/24/32bpp，无压缩 / BI_BITFIELDS）
     hasMask=true：ICO 上下文，biHeight 含 AND mask 行（像素行 = 高度/2） */
  function decodeBmp(slice, hasMask) {
    var dv = new DataView(slice);
    if (slice.byteLength < 40) throw new Error('bmp header');
    var off = 0;
    var biSize = u32le(dv, off); off += 4;
    if (biSize < 40) throw new Error('bmp info');
    var w = u32le(dv, off);
    var hRaw = dv.getInt32(off + 4, true); off += 8;
    off += 2;                                    /* planes */
    var bpp = u16le(dv, off); off += 2;
    var comp = u32le(dv, off); off += 4;         /* 0=RGB 3=BI_BITFIELDS */
    off += 4;                                    /* biSizeImage */
    off += 4;                                    /* biXPelsPerMeter */
    off += 4;                                    /* biYPelsPerMeter */
    var palCount = u32le(dv, off); off += 4;     /* biClrUsed */
    off += 4;                                    /* biClrImportant */
    var topDown = hRaw < 0;
    var h = Math.abs(hRaw);
    if (hasMask) h = Math.floor(h / 2);          /* ICO：高度含 AND mask 行 */
    if (w < 1 || h < 1 || w > 1024 || h > 1024) throw new Error('bmp dims');
    if (bpp !== 1 && bpp !== 4 && bpp !== 8 && bpp !== 24 && bpp !== 32) throw new Error('bmp bpp ' + bpp);

    /* 调色板 */
    var pal = null;
    if (bpp <= 8) {
      var palN = palCount || (1 << bpp);
      pal = [];
      for (var p = 0; p < palN; p++) {
        pal.push([dv.getUint8(off + p * 4), dv.getUint8(off + p * 4 + 1), dv.getUint8(off + p * 4 + 2), dv.getUint8(off + p * 4 + 3)]);
      }
      off += palN * 4;
    }

    /* BI_BITFIELDS 掩码（仅 comp=3；BI_RGB 32bpp 直接 BGRA，无掩码） */
    var rMask = 0, gMask = 0, bMask = 0, aMask = 0;
    if (comp === 3 && slice.byteLength >= off + 12 && bpp >= 24) {
      rMask = u32le(dv, off); gMask = u32le(dv, off + 4); bMask = u32le(dv, off + 8);
      off += 12;
      if (slice.byteLength >= off + 4) { aMask = u32le(dv, off); off += 4; }
    }

    var rowSize = Math.ceil((w * bpp) / 8);
    var stride = Math.ceil(rowSize / 4) * 4;
    var pxOff = off;
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    var img = ctx.createImageData(w, h);
    var d = img.data;
    var x, y, v, pe;
    for (y = 0; y < h; y++) {
      var srcRow = topDown ? y : (h - 1 - y);
      var rowStart = pxOff + srcRow * stride;
      for (x = 0; x < w; x++) {
        var idx = (y * w + x) * 4;
        var byteOff = rowStart + ((x * bpp) >> 3);
        var r, g, b, a = 255;
        if (bpp === 32) {
          v = dv.getUint32(byteOff, true);
          if (rMask) {
            r = maskChannel(v, rMask); g = maskChannel(v, gMask); b = maskChannel(v, bMask);
            a = aMask ? maskChannel(v, aMask) : 255;
          } else {
            b = v & 0xFF; g = (v >>> 8) & 0xFF; r = (v >>> 16) & 0xFF; a = (v >>> 24) & 0xFF;
          }
        } else if (bpp === 24) {
          r = dv.getUint8(byteOff + 2); g = dv.getUint8(byteOff + 1); b = dv.getUint8(byteOff);
        } else if (bpp === 8) {
          v = dv.getUint8(byteOff); pe = pal[v] || [0, 0, 0, 255]; r = pe[0]; g = pe[1]; b = pe[2]; a = pe[3];
        } else if (bpp === 4) {
          v = dv.getUint8(byteOff); v = (x % 2 === 0) ? (v >> 4) : (v & 0xF);
          pe = pal[v] || [0, 0, 0, 255]; r = pe[0]; g = pe[1]; b = pe[2]; a = pe[3];
        } else {
          v = dv.getUint8(byteOff); v = (v >> (7 - (x % 8))) & 1;
          pe = pal[v] || [0, 0, 0, 255]; r = pe[0]; g = pe[1]; b = pe[2]; a = pe[3];
        }
        d[idx] = r; d[idx + 1] = g; d[idx + 2] = b; d[idx + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);
    return { w: w, h: h, dataURL: canvas.toDataURL('image/png') };
  }

  /* ================= ICO ================= */
  /* ICONDIR: reserved(2)=0 type(2)=1 count(2)
     条目 16B: w(1) h(1) colors(1) reserved(1) planes(2) bitCount(2) bytesInRes(4) offset(4)
     w/h=0 → 256。条目数据为 PNG 或 BMP。 */
  function decodeIco(buf) {
    var dv = new DataView(buf);
    if (buf.byteLength < 6) return null;
    if (u16le(dv, 0) !== 0 || u16le(dv, 2) !== 1) return null;
    var count = u16le(dv, 4);
    if (count < 1 || count > 60) return null;
    var entries = [];
    for (var i = 0; i < count; i++) {
      var o = 6 + i * 16;
      if (o + 16 > buf.byteLength) break;
      var w = dv.getUint8(o) || 256;
      var h = dv.getUint8(o + 1) || 256;
      var len = u32le(dv, o + 8);
      var off = u32le(dv, o + 12);
      if (off + len > buf.byteLength) continue;
      entries.push({ w: w, h: h, len: len, off: off });
    }
    if (!entries.length) return null;
    entries.sort(function (a, b) { return (b.w * b.h) - (a.w * a.h); });
    for (var j = 0; j < entries.length; j++) {
      var e = entries[j];
      var slice = buf.slice(e.off, e.off + e.len);
      var res = null;
      if (slice.byteLength >= 8 && isPng(new DataView(slice), 0)) {
        res = { w: e.w, h: e.h, dataURL: bytesToDataURL(new Uint8Array(slice), 'image/png') };
      } else {
        try { res = decodeBmp(slice, true); } catch (err) { res = null; }
      }
      if (res) {
        return { width: res.w, height: res.h, dataURL: res.dataURL, size: Math.max(e.w, e.h) };
      }
    }
    return null;
  }

  /* 编码：全 PNG 条目（Vista+ 支持 PNG 压缩 ICO；256 及以上必须 PNG）。
     pngs: [{ size:Number, data:Uint8Array }] */
  function encodeIco(pngs) {
    if (!pngs || !pngs.length) return null;
    var total = 6 + pngs.length * 16;
    for (var i = 0; i < pngs.length; i++) total += pngs[i].data.length;
    var buf = new ArrayBuffer(total);
    var dv = new DataView(buf);
    var u8 = new Uint8Array(buf);
    dv.setUint16(0, 0, true);
    dv.setUint16(2, 1, true);
    dv.setUint16(4, pngs.length, true);
    var off = 6 + pngs.length * 16;
    for (var j = 0; j < pngs.length; j++) {
      var p = pngs[j];
      var o = 6 + j * 16;
      dv.setUint8(o, p.size >= 256 ? 0 : p.size);
      dv.setUint8(o + 1, p.size >= 256 ? 0 : p.size);
      dv.setUint8(o + 2, 0);
      dv.setUint8(o + 3, 0);
      dv.setUint16(o + 4, 1, true);
      dv.setUint16(o + 6, 32, true);
      dv.setUint32(o + 8, p.data.length, true);
      dv.setUint32(o + 12, off, true);
      u8.set(p.data, off);
      off += p.data.length;
    }
    return buf;
  }

  /* ================= ICNS ================= */
  /* 头部: 'icns'(4, 大端) + totalLength(4, 大端)
     块:   type(4 字符, 大端) + length(4, 大端, 含 8B 头) + data
     PNG 块类型（10.7+）：icp4=16 icp5=32 icp6=64 ic07=128 ic08=256 ic09=512 ic10=1024 */
  var ICNS_PNG_TYPES = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512 };
  var ICNS_SIZE_TYPES = { 16: 'icp4', 32: 'icp5', 64: 'icp6', 128: 'ic07', 256: 'ic08', 512: 'ic09', 1024: 'ic10' };

  function decodeIcns(buf) {
    var dv = new DataView(buf);
    if (buf.byteLength < 8) return null;
    if (u32be(dv, 0) !== 0x69636E73) return null;   /* 'icns' */
    var best = null;
    var off = 8;
    while (off + 8 <= buf.byteLength) {
      var t4 = u32be(dv, off);
      var len = u32be(dv, off + 4);
      if (len < 8 || off + len > buf.byteLength) break;
      var type = String.fromCharCode((t4 >>> 24) & 0xFF, (t4 >>> 16) & 0xFF, (t4 >>> 8) & 0xFF, t4 & 0xFF);
      var size = ICNS_PNG_TYPES[type] || 0;
      if (size) {
        var slice = buf.slice(off + 8, off + len);
        if (slice.byteLength >= 8 && isPng(new DataView(slice), 0)) {
          var score = size * size;
          if (!best || score > best.score) {
            best = { score: score, w: size, h: size, dataURL: bytesToDataURL(new Uint8Array(slice), 'image/png') };
          }
        }
      }
      off += len;
    }
    if (!best) return null;
    return { width: best.w, height: best.h, dataURL: best.dataURL, size: best.w };
  }

  function encodeIcns(pngs) {
    if (!pngs || !pngs.length) return null;
    var blocks = [];
    for (var i = 0; i < pngs.length; i++) {
      var type = ICNS_SIZE_TYPES[pngs[i].size];
      if (type) blocks.push({ type: type, data: pngs[i].data });
    }
    if (!blocks.length) return null;
    var total = 8;
    for (var j = 0; j < blocks.length; j++) total += 8 + blocks[j].data.length;
    var buf = new ArrayBuffer(total);
    var dv = new DataView(buf);
    var u8 = new Uint8Array(buf);
    dv.setUint32(0, 0x69636E73, false);   /* 'icns' */
    dv.setUint32(4, total, false);
    var off = 8;
    for (var k = 0; k < blocks.length; k++) {
      var b = blocks[k];
      var t = (b.type.charCodeAt(0) << 24) | (b.type.charCodeAt(1) << 16) | (b.type.charCodeAt(2) << 8) | b.type.charCodeAt(3);
      dv.setUint32(off, t, false);
      dv.setUint32(off + 4, 8 + b.data.length, false);
      u8.set(b.data, off + 8);
      off += 8 + b.data.length;
    }
    return buf;
  }

  window.MotefulIconContainer = {
    decodeIco: decodeIco,
    decodeIcns: decodeIcns,
    encodeIco: encodeIco,
    encodeIcns: encodeIcns
  };
})();
