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

  var api = {
    encode: encode, decode: decode, detect: detect, normalize: normalize,
    wrap: wrap, toUrlSafe: toUrlSafe, fromUrlSafe: fromUrlSafe, measure: measure, isText: isText
  };
  root.MFBase64 = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof self !== 'undefined' ? self : this);