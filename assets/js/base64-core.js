/* ===== base64-core.js · Base64 编解码纯计算内核（V2.1.5 P0） =====
   无 DOM、无存储、无网络：只用 btoa / atob / TextEncoder / TextDecoder（浏览器与 Node 均为全局）。
   口径见设计文档 §4：编码先 UTF-8 字节化再分块 btoa；解码六步清洗 + fatal TextDecoder + 文本性双条件。
   错误统一抛 { code, position, detail }，code ∈ char | len | pad | binary。 */
(function (root) {
  'use strict';

  var CHUNK = 0x8000;
  var RE_WS = /\s/;
  var RE_BODY = /[A-Za-z0-9+\/]/;

  /* 一次遍历同时数码点与 UTF-8 字节（与 TextEncoder 对合法文本一致；孤立代理按 3 字节替换符计） */
  function measure(s) {
    var chars = 0, bytes = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        var c2 = s.charCodeAt(i + 1);
        if (c2 >= 0xDC00 && c2 <= 0xDFFF) { chars++; bytes += 4; i++; continue; }
      }
      chars++;
      bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
    }
    return { chars: chars, bytes: bytes };
  }

  function toUrlSafe(b64, stripPad) {
    var s = b64.replace(/\+/g, '-').replace(/\//g, '_');
    if (stripPad) s = s.replace(/=+$/, '');
    return s;
  }
  function fromUrlSafe(b64) { return b64.replace(/-/g, '+').replace(/_/g, '/'); }

  function wrap(b64, width) {
    if (!width || width <= 0) return b64;
    var out = '';
    for (var i = 0; i < b64.length; i += width) {
      out += b64.slice(i, i + width);
      if (i + width < b64.length) out += '\n';
    }
    return out;
  }

  /* §4.2.1 六步清洗（顺序写死）。返回 { clean(已补齐), error }；error 为 null 或 { code, position, detail }。
     position 一律按「清洗前原文」1 起定位。 */
  function normalize(raw) {
    var clean = '', map = [];
    for (var i = 0; i < raw.length; i++) {
      var ch = raw.charAt(i);
      if (RE_WS.test(ch)) continue;
      var c = ch === '-' ? '+' : ch === '_' ? '/' : ch;
      clean += c; map.push(i);
    }
    // 3) 填充符 = 之后仍有正文字符
    var eq = clean.indexOf('=');
    if (eq >= 0) {
      for (var j = eq + 1; j < clean.length; j++) {
        if (clean.charAt(j) !== '=') {
          return { clean: '', error: { code: 'pad', position: map[j] + 1, detail: 'content after padding' } };
        }
      }
    }
    // 4) 清洗后长度 % 4 == 1 → 非法
    if (clean.length % 4 === 1) {
      return { clean: '', error: { code: 'len', position: 0, detail: 'length % 4 == 1' } };
    }
    // 6) 字符表校验（先于补齐定位非法字符，保证 position 指向原文）
    var bodyEnd = eq >= 0 ? eq : clean.length;
    for (var k = 0; k < bodyEnd; k++) {
      if (!RE_BODY.test(clean.charAt(k))) {
        return { clean: '', error: { code: 'char', position: map[k] + 1, detail: 'illegal character' } };
      }
    }
    if (eq >= 0 && clean.length - eq > 2) {
      return { clean: '', error: { code: 'char', position: map[eq + 2] + 1, detail: 'too much padding' } };
    }
    // 5) 用 = 补齐到 % 4 == 0
    var pad = (4 - (clean.length % 4)) % 4;
    if (pad) clean += new Array(pad + 1).join('=');
    return { clean: clean, error: null };
  }

  /* 文本性双条件：不含 U+FFFD(0xFFFD)，且控制字符（\t \n \r 之外）占比 < 5% */
  function isText(s) {
    if (s.length === 0) return true;
    var ctrl = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c === 0xFFFD) return false;
      if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) ctrl++;
    }
    return ctrl / s.length < 0.05;
  }

  function decodeBytes(clean) {
    var bin = atob(clean), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  /* §4.2.2 解码。失败抛 { code, position, detail }。解码不受 wrap/urlSafe/pad 影响（清洗步自动归一与补齐）。 */
  function decode(raw) {
    var n = normalize(raw);
    if (n.error) throw n.error;
    if (n.clean === '') return { text: '', bytesOut: 0, charsOut: 0 };
    var bytes = decodeBytes(n.clean);
    var text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (e) { throw { code: 'binary', position: 0, detail: 'invalid utf-8' }; }
    if (!isText(text)) throw { code: 'binary', position: 0, detail: 'non-text content' };
    var m = measure(text);
    return { text: text, bytesOut: bytes.length, charsOut: m.chars };
  }

  /* §4.1 编码：TextEncoder → 分块 String.fromCharCode → btoa → urlSafe / pad / wrap */
  function encode(text, opts) {
    opts = opts || {};
    var bytes = new TextEncoder().encode(text);
    var parts = [];
    for (var i = 0; i < bytes.length; i += CHUNK) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
    }
    var b64 = btoa(parts.join(''));
    if (opts.urlSafe) b64 = b64.replace(/\+/g, '-').replace(/\//g, '_');
    if (opts.pad === false) b64 = b64.replace(/=+$/, '');
    b64 = wrap(b64, opts.wrap || 0);
    var m = measure(text);
    return { b64: b64, bytesIn: bytes.length, charsIn: m.chars, outLen: b64.length, ratio: bytes.length ? b64.length / bytes.length : 0 };
  }

  function isBase64UrlSeg(seg) {
    return seg.length > 0 && /^[A-Za-z0-9_-]+$/.test(seg);
  }

  /* §4.3 方向判定（自上而下首个命中即停）。
     注：row4 文档写「长度 ≥ 8」，但 F-03 与夹具明确要求 5Lit(4)→中、test(4)→encode；
     test/hello 的误判已分别由「文本性双条件」与「长度合法性」兜住，故阈值取一个完整量子 ≥ 4，
     既满足 5Lit→中，又拒绝 2~3 字符碎片。 */
  function detect(raw) {
    var stripped = raw.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if (stripped === '') return 'empty';
    var trimmed = raw.replace(/^\s+|\s+$/g, '');
    if (/^data:[^;,]+;base64,/i.test(trimmed)) return 'datauri';
    var segs = trimmed.split('.');
    if (segs.length === 3 && isBase64UrlSeg(segs[0]) && isBase64UrlSeg(segs[1]) && isBase64UrlSeg(segs[2])) return 'jwt';
    var n = normalize(raw);
    if (!n.error && stripped.length >= 4) {
      try { decode(raw); return 'base64'; }
      catch (e) { return e.code === 'binary' ? 'binary' : 'plain'; }
    }
    return 'plain';
  }

  /* ===== V2.1.6 P1：Data URI / MIME / 文件字节（仍无 DOM、无存储、无网络） ===== */
  var RE_DATA = /^data:([^;,]*)((?:;[^;,]*)*),([\s\S]*)$/i;

  /* 解析 Data URI；不是 Data URI 返回 null。payload 不在这里清洗，交给 normalize。 */
  function parseDataUri(raw) {
    var m = RE_DATA.exec(String(raw).replace(/^\s+|\s+$/g, ''));
    if (!m) return null;
    return {
      mime: (m[1] || 'text/plain').toLowerCase(),
      isBase64: /(^|;)base64(;|$)/i.test(m[2] || ''),
      payload: m[3]
    };
  }
  function buildDataUri(mime, b64) {
    return 'data:' + (mime || 'application/octet-stream') + ';base64,' + String(b64).replace(/\s/g, '');
  }

  /* 解码到原始字节：只做 §4.2.1 清洗，不做 UTF-8 文本性判定（P1 文件下载用） */
  function decodeToBytes(raw) {
    var n = normalize(raw);
    if (n.error) throw n.error;
    return n.clean === '' ? new Uint8Array(0) : decodeBytes(n.clean);
  }
  function bytesToBase64(bytes) {
    var parts = [];
    for (var i = 0; i < bytes.length; i += CHUNK) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
    }
    return btoa(parts.join(''));
  }

  var EXT_BY_MIME = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
    'image/svg+xml': '.svg', 'image/bmp': '.bmp', 'image/x-icon': '.ico', 'image/avif': '.avif',
    'text/plain': '.txt', 'text/html': '.html', 'text/css': '.css', 'text/xml': '.xml',
    'text/javascript': '.js', 'application/javascript': '.js', 'application/json': '.json',
    'application/xml': '.xml', 'application/pdf': '.pdf', 'application/zip': '.zip',
    'application/gzip': '.gz', 'application/x-gzip': '.gz', 'application/x-tar': '.tar',
    'application/wasm': '.wasm', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'font/woff': '.woff', 'font/woff2': '.woff2',
    'font/ttf': '.ttf', 'font/otf': '.otf', 'application/octet-stream': '.bin'
  };
  var MIME_BY_EXT = {};
  for (var mk in EXT_BY_MIME) { if (Object.prototype.hasOwnProperty.call(EXT_BY_MIME, mk)) MIME_BY_EXT[EXT_BY_MIME[mk].slice(1)] = mk; }

  function extForMime(mime) {
    var m = String(mime || '').toLowerCase().split(';')[0].replace(/^\s+|\s+$/g, '');
    if (EXT_BY_MIME[m]) return EXT_BY_MIME[m];
    if (/^text\//.test(m)) return '.txt';
    return '';
  }
  function mimeForExt(ext) {
    var e = String(ext || '').toLowerCase().replace(/^\./, '').replace(/^\s+|\s+$/g, '');
    return MIME_BY_EXT[e] || '';
  }

  /* 纯 Base64（无 Data URI MIME）时按魔数猜类型；认不出返回空串 */
  function sniffMime(b) {
    if (!b || !b.length) return '';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
    if (b[0] === 0x42 && b[1] === 0x4D) return 'image/bmp';
    if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return 'image/x-icon';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45) return 'audio/wav';
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
    if (b[0] === 0x50 && b[1] === 0x4B && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)) return 'application/zip';
    if (b[0] === 0x1F && b[1] === 0x8B) return 'application/gzip';
    if (b[0] === 0x77 && b[1] === 0x4F && b[2] === 0x46 && b[3] === 0x46) return 'font/woff';
    if (b[0] === 0x77 && b[1] === 0x4F && b[2] === 0x46 && b[3] === 0x32) return 'font/woff2';
    if (b[0] === 0x4F && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'audio/ogg';
    if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'audio/mpeg';
    if (b[0] === 0x00 && b[1] === 0x61 && b[2] === 0x73 && b[3] === 0x6D) return 'application/wasm';
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'video/mp4';
    return '';
  }

  function fmtSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }

  var api = {
    encode: encode, decode: decode, detect: detect, normalize: normalize,
    wrap: wrap, toUrlSafe: toUrlSafe, fromUrlSafe: fromUrlSafe, measure: measure, isText: isText,
    parseDataUri: parseDataUri, buildDataUri: buildDataUri, decodeToBytes: decodeToBytes,
    bytesToBase64: bytesToBase64, sniffMime: sniffMime, extForMime: extForMime,
    mimeForExt: mimeForExt, fmtSize: fmtSize
  };
  root.MFBase64 = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof self !== 'undefined' ? self : this);