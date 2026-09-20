/*
 * MotefulZip — 零依赖纯前端 ZIP 构建器（Store 模式，无损打包）
 * 不引用任何 CDN / 第三方库，符合零外部请求铁律。
 * 图片本身已是压缩格式，Store（不压缩）打包体积接近原图，且完全无损。
 *
 * 用法：
 *   var blob = window.MotefulZip.build([
 *     { name: 'a.jpg', data: Uint8Array },
 *     { name: 'b.png', data: Uint8Array }
 *   ]);
 *   // blob 为 application/zip，可直接用于下载
 */
(function () {
  'use strict';
  var root = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined' ? globalThis : this);

  // CRC32 查表（标准多项式 0xEDB88320）
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
  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new Uint8Array(new TextEncoder().encode(str));
    var s = unescape(encodeURIComponent(str)), out = new Uint8Array(s.length), i;
    for (i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function build(files) {
    if (!files || !files.length) return null;
    var locals = [], centrals = [], offset = 0, i, nameBytes, data, crc, size;

    for (i = 0; i < files.length; i++) {
      nameBytes = utf8(files[i].name);
      data = (files[i].data instanceof Uint8Array) ? files[i].data : new Uint8Array(files[i].data);
      crc = crc32(data);
      size = data.length;

      // 本地文件头 Local File Header（30 字节 + 文件名）
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);  // 签名
      lh.setUint16(4, 20, true);          // version needed
      lh.setUint16(6, 0x0800, true);      // flags：UTF-8 文件名
      lh.setUint16(8, 0, true);           // method：0 = stored（不压缩）
      lh.setUint16(10, 0, true);          // mod time
      lh.setUint16(12, 0, true);          // mod date
      lh.setUint32(14, crc, true);        // crc32
      lh.setUint32(18, size, true);       // compressed size
      lh.setUint32(22, size, true);       // uncompressed size
      lh.setUint16(26, nameBytes.length, true);
      lh.setUint16(28, 0, true);          // extra length

      // 中央目录头 Central Directory Header（46 字节 + 文件名）
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);  // 签名
      ch.setUint16(4, 20, true);          // version made by
      ch.setUint16(6, 20, true);          // version needed
      ch.setUint16(8, 0x0800, true);      // flags
      ch.setUint16(10, 0, true);          // method
      ch.setUint16(12, 0, true);          // mod time
      ch.setUint16(14, 0, true);          // mod date
      ch.setUint32(16, crc, true);        // crc32
      ch.setUint32(20, size, true);       // compressed size
      ch.setUint32(24, size, true);       // uncompressed size
      ch.setUint16(28, nameBytes.length, true);
      ch.setUint16(30, 0, true);          // extra length
      ch.setUint16(32, 0, true);          // comment length
      ch.setUint16(34, 0, true);          // disk number
      ch.setUint16(36, 0, true);          // internal attrs
      ch.setUint32(38, 0, true);          // external attrs
      ch.setUint32(42, offset, true);     // 本地头偏移

      locals.push(new Uint8Array(lh.buffer), nameBytes, data);
      centrals.push(new Uint8Array(ch.buffer), nameBytes);
      offset += 30 + nameBytes.length + size;
    }

    // 中央目录总大小与偏移
    var cdSize = 0;
    for (i = 0; i < centrals.length; i++) cdSize += centrals[i].length;
    var cdOffset = offset;

    // 结尾记录 End of Central Directory（22 字节）
    var eo = new DataView(new ArrayBuffer(22));
    eo.setUint32(0, 0x06054b50, true);   // 签名
    eo.setUint16(4, 0, true);            // 当前磁盘
    eo.setUint16(6, 0, true);            // 含中央目录的磁盘
    eo.setUint16(8, files.length, true); // 本磁盘条目数
    eo.setUint16(10, files.length, true);// 总条目数
    eo.setUint32(12, cdSize, true);      // 中央目录大小
    eo.setUint32(16, cdOffset, true);    // 中央目录偏移
    eo.setUint16(20, 0, true);           // 注释长度

    var parts = locals.concat(centrals, [eo.buffer]);
    return new Blob(parts, { type: 'application/zip' });
  }

  root.MotefulZip = { build: build };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MotefulZip;
})();
