/* ===== Timestamp Converter · 纯函数内核（P0 F-01~F-07） =====
   口径唯一依据：V2.1.0时间戳转换工具-设计文档 第 4 章 / 8.2。
   零依赖、无 DOM（EEE 的本地化只走 Intl）；可单独在 Node 下跑 fixture 断言。
   明确不做（P1+）：batch / humanize / diff / convert。 */
(function (root) {
  'use strict';

  var DAY_MS = 86400000;
  var DATE_LIMIT = 8.64e15;   // JS Date 可表示上限（4.8）

  var ZONES = [
    { id: 'local', iana: '', labelKey: 'ts_zone_local' },
    { id: 'UTC', iana: 'UTC', labelKey: 'ts_zone_utc' },
    { id: 'Asia/Shanghai', iana: 'Asia/Shanghai', labelKey: 'ts_zone_beijing' },
    { id: 'Asia/Tokyo', iana: 'Asia/Tokyo', labelKey: 'ts_zone_tokyo' },
    { id: 'Asia/Seoul', iana: 'Asia/Seoul', labelKey: 'ts_zone_seoul' },
    { id: 'Asia/Singapore', iana: 'Asia/Singapore', labelKey: 'ts_zone_singapore' },
    { id: 'Asia/Dubai', iana: 'Asia/Dubai', labelKey: 'ts_zone_dubai' },
    { id: 'Europe/London', iana: 'Europe/London', labelKey: 'ts_zone_london' },
    { id: 'America/New_York', iana: 'America/New_York', labelKey: 'ts_zone_newyork' },
    { id: 'America/Los_Angeles', iana: 'America/Los_Angeles', labelKey: 'ts_zone_la' }
  ];

  var PATTERNS = [
    { id: 'std', pattern: 'yyyy-MM-dd HH:mm:ss', labelKey: 'ts_pattern_std' },
    { id: 'iso', pattern: 'yyyy-MM-ddTHH:mm:ss.SSSZ', labelKey: 'ts_pattern_iso' },
    { id: 'slash', pattern: 'yyyy/MM/dd HH:mm', labelKey: 'ts_pattern_slash' },
    { id: 'rfc', pattern: 'EEE, dd MM yyyy HH:mm:ss ZZ', labelKey: 'ts_pattern_rfc' },
    { id: 'epoch', pattern: 'X / x', labelKey: 'ts_pattern_epoch' },
    { id: 'custom', pattern: '', labelKey: 'ts_pattern_custom' }
  ];

  /* ---------- 格式化器缓存（8.3：按 zone + 用途做 Map，单页最多 10 个） ---------- */
  var dtfCache = {};
  var wdCache = {};

  function zoneKey(zone) { return (zone && zone !== 'local') ? zone : 'local'; }
  function localeTag(lang) {
    if (lang === 'zh') return 'zh-CN';
    if (lang === 'es') return 'es';
    if (lang === 'en') return 'en-US';
    return undefined;
  }

  function dtf(zone) {
    var key = zoneKey(zone);
    if (dtfCache[key]) return dtfCache[key];
    var opts = {
      /* era 必须带上：Intl 不带 era 时把公元 0 年（ISO 0000）输出成「1」，
         回读会错位一整年，反向换算被误判成 DST 缺口 */
      era: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23'
    };
    if (key !== 'local') opts.timeZone = key;
    var fmt = new Intl.DateTimeFormat('en-CA', opts);
    dtfCache[key] = fmt;
    return fmt;
  }

  function rawParts(t, zone) {
    var arr = dtf(zone).formatToParts(t), o = {}, era = '';
    for (var i = 0; i < arr.length; i++) {
      var p = arr[i];
      if (p.type === 'year') o.y = +p.value;
      else if (p.type === 'month') o.m = +p.value;
      else if (p.type === 'day') o.d = +p.value;
      else if (p.type === 'hour') o.H = +p.value;
      else if (p.type === 'minute') o.M = +p.value;
      else if (p.type === 'second') o.S = +p.value;
      else if (p.type === 'era') era = p.value;
    }
    /* 公元前年份换回 ISO 天文年（1 BC = 0000） */
    if (era && /^B/i.test(era) && o.y != null) o.y = 1 - o.y;
    return o;
  }

  function weekdayShort(t, zone) {
    var key = zoneKey(zone) + '|en';
    if (!wdCache[key]) {
      var opts = { weekday: 'short' };
      if (zoneKey(zone) !== 'local') opts.timeZone = zoneKey(zone);
      wdCache[key] = new Intl.DateTimeFormat('en-US', opts);
    }
    return wdCache[key].format(t);
  }

  function weekdayLabel(t, zone, lang) {
    var loc = localeTag(lang) || 'en-US';
    var key = zoneKey(zone) + '|' + loc;
    if (!wdCache[key]) {
      var opts = { weekday: 'short' };
      if (zoneKey(zone) !== 'local') opts.timeZone = zoneKey(zone);
      wdCache[key] = new Intl.DateTimeFormat(loc, opts);
    }
    return wdCache[key].format(t);
  }

  /* ---------- 4.1 精度识别 ---------- */
  function detect(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (s === '') return { kind: 'invalid', reason: 'empty', digits: 0, badIndex: -1 };
    var sign = 0;
    if (s.charAt(0) === '+' || s.charAt(0) === '-') sign = 1;
    for (var i = sign; i < s.length; i++) {
      var c = s.charAt(i);
      if (c < '0' || c > '9') {
        return { kind: 'invalid', reason: 'non-digit', digits: 0, badIndex: i };
      }
    }
    var digits = s.length - sign;
    if (digits === 0) return { kind: 'invalid', reason: 'non-digit', digits: 0, badIndex: sign ? 0 : -1 };
    var value = Number(s);
    if (digits === 10) return { kind: 's', reason: 'ok', digits: digits, badIndex: -1, value: value };
    if (digits === 13) return { kind: 'ms', reason: 'ok', digits: digits, badIndex: -1, value: value };
    /* 极小值（|v| < 1000）按秒与按毫秒都可解释且差异可忽略，直接按秒，避免 0 / -1 这类
       基准值被弹「歧义」；其余非 10 / 13 位一律歧义（含 4.1 的负值口径）。 */
    if (Math.abs(value) < 1000) {
      return { kind: 's', reason: 'small', digits: digits, badIndex: -1, value: value };
    }
    return {
      kind: 'ambiguous',
      reason: digits >= 14 ? 'too-many' : 'digits',
      digits: digits, badIndex: -1, value: value
    };
  }

  /* ---------- 4.2 正向：epoch → 某时区字段 ---------- */
  function toDateParts(t, zone) {
    var p = rawParts(t, zone);
    var ms = ((t % 1000) + 1000) % 1000;
    return {
      y: p.y, m: p.m, d: p.d, H: p.H, M: p.M, S: p.S, ms: ms,
      weekday: weekdayShort(t, zone),
      offsetMinutes: zoneOffset(t, zone)
    };
  }

  /* 精确偏移（毫秒）：1880 年代前的 LMT 偏移带秒（纽约 −4:56:02），
     取整到分钟会让回读差 2 秒，反向换算被误判成 DST 缺口 */
  function offsetExact(t, key) {
    var p = rawParts(t, key);
    var wall = utcMs(p.y, p.m, p.d, p.H, p.M, p.S);
    var ms = ((t % 1000) + 1000) % 1000;
    return wall + ms - t;
  }

  function zoneOffset(t, zone) {
    var key = zoneKey(zone);
    if (key === 'UTC') return 0;
    return Math.round(offsetExact(t, key) / 60000);
  }

  /* 以 UTC 字段拼毫秒；手动 setUTCFullYear 规避 Date.UTC 把 0-99 映射到 1900+ */
  function utcMs(y, m, d, H, M, S) {
    var dt = new Date(0);
    dt.setUTCFullYear(y, m - 1, d);
    dt.setUTCHours(H, M, S, 0);
    return dt.getTime();
  }

  function partsValid(p) {
    if (!p) return false;
    var y = +p.y, m = +p.m, d = +p.d, H = +p.H, M = +p.M, S = +p.S, ms = +(p.ms || 0);
    if (!isFinite(y) || !isFinite(m) || !isFinite(d) || !isFinite(H) ||
        !isFinite(M) || !isFinite(S) || !isFinite(ms)) return false;
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    if (H < 0 || H > 23 || M < 0 || M > 59 || S < 0 || S > 59 || ms < 0 || ms > 999) return false;
    var t = utcMs(y, m, d, H, M, S);
    if (!isFinite(t) || Math.abs(t) > DATE_LIMIT) return false;
    var dt = new Date(t);
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  /* ---------- 4.3 反向：某时区本地时间 → epoch ---------- */
  var PROBES = [-7200000, -3600000, -1800000, 1800000, 3600000, 7200000];

  function toEpoch(parts, zone) {
    if (!partsValid(parts)) return { ok: false, kind: 'invalid' };
    var key = zoneKey(zone);
    var y = +parts.y, mo = +parts.m, d = +parts.d, H = +parts.H, Mi = +parts.M, S = +parts.S;
    var ms = +(parts.ms || 0);
    var t0 = utcMs(y, mo, d, H, Mi, S);

    function wall(t) {
      var p = rawParts(t, key);
      return utcMs(p.y, p.m, p.d, p.H, p.M, p.S);
    }

    var off0 = offsetExact(t0, key);
    var t1 = t0 - off0;
    var off1 = offsetExact(t1, key);
    var t2 = (off1 !== off0) ? t0 - off1 : t1;

    var w1 = wall(t1), hit = null;
    if (w1 === t0) hit = t1;
    else {
      var w2 = wall(t2);
      if (w2 === t0) hit = t2;
      else {
        var before = (w1 < t0) ? t1 : t2;
        var after = (w1 < t0) ? t2 : t1;
        return {
          ok: false, kind: 'dst-gap',
          before: before, after: after,
          gapMin: Math.round((after - before) / 60000)
        };
      }
    }

    /* 秋季回拨：两个合法候选回读相同，必须显式按偏移去重探测（探针含 ±30min） */
    var seen = {}, cands = [];
    function push(c) {
      var off = zoneOffset(c, key);
      if (seen[off] != null) return;
      seen[off] = true;
      cands.push({ t: c + ms, offsetMinutes: off });
    }
    push(hit);
    for (var i = 0; i < PROBES.length; i++) {
      var c = hit + PROBES[i];
      if (wall(c) === t0) push(c);
    }
    if (cands.length > 1) {
      cands.sort(function (a, b) { return b.offsetMinutes - a.offsetMinutes; });
      return { ok: false, kind: 'dst-overlap', candidates: cands };
    }
    return { ok: true, kind: 'ok', t: hit + ms };
  }

  /* ---------- 4.4 模板渲染（白名单 token，不 eval） ---------- */
  var TOKENS = ['yyyy', 'yy', 'SSS', 'MM', 'M', 'dd', 'd', 'HH', 'H', 'mm', 'ss', 'EEE', 'ZZ', 'Z', 'X', 'x'];

  function pad(n, w) {
    var s = String(Math.abs(n));
    while (s.length < w) s = '0' + s;
    return (n < 0 ? '-' : '') + s;
  }

  function offsetText(min, colon) {
    var sign = min < 0 ? '-' : '+';
    var a = Math.abs(min);
    var h = Math.floor(a / 60), m = a % 60;
    return sign + pad(h, 2) + (colon ? ':' : '') + pad(m, 2);
  }

  function format(t, zone, pattern, lang) {
    var p = toDateParts(t, zone);
    var pat = String(pattern == null ? '' : pattern);
    var out = '', unknown = [], i = 0;
    function tokenAt(pos) {
      for (var k = 0; k < TOKENS.length; k++) {
        var tk = TOKENS[k];
        if (pat.substr(pos, tk.length) === tk) return tk;
      }
      return null;
    }
    while (i < pat.length) {
      var ch = pat.charAt(i);
      if (!/[A-Za-z]/.test(ch)) { out += ch; i++; continue; }
      var tk = tokenAt(i);
      if (tk) {
        if (tk === 'yyyy') out += pad(p.y, 4);
        else if (tk === 'yy') out += pad(p.y % 100, 2);
        else if (tk === 'SSS') out += pad(p.ms, 3);
        else if (tk === 'MM') out += pad(p.m, 2);
        else if (tk === 'M') out += String(p.m);
        else if (tk === 'dd') out += pad(p.d, 2);
        else if (tk === 'd') out += String(p.d);
        else if (tk === 'HH') out += pad(p.H, 2);
        else if (tk === 'H') out += String(p.H);
        else if (tk === 'mm') out += pad(p.M, 2);
        else if (tk === 'ss') out += pad(p.S, 2);
        else if (tk === 'EEE') out += weekdayLabel(t, zone, lang);
        else if (tk === 'ZZ') out += offsetText(p.offsetMinutes, false);
        else if (tk === 'Z') out += offsetText(p.offsetMinutes, true);
        else if (tk === 'X') out += String(Math.floor(t / 1000));
        else if (tk === 'x') out += String(t);
        i += tk.length;
        continue;
      }
      /* 连续未知字母：单字母视为字面量（ISO 的 T），两字母以上才提示未知 token */
      var j = i;
      while (j < pat.length && /[A-Za-z]/.test(pat.charAt(j)) && !tokenAt(j)) j++;
      var run = pat.slice(i, j);
      out += run;
      if (run.length > 1 && unknown.indexOf(run) < 0) unknown.push(run);
      i = j;
    }
    return { text: out, unknownTokens: unknown };
  }

  /* ---------- 6 / 4.8 手输日期解析 ---------- */
  var DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/;

  function parseDate(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (s === '') return { ok: false, reason: 'empty' };
    var m = DATE_RE.exec(s);
    if (!m) return { ok: false, reason: 'format' };
    var parts = {
      y: +m[1], m: +m[2], d: +m[3],
      H: m[4] != null ? +m[4] : 0,
      M: m[5] != null ? +m[5] : 0,
      S: m[6] != null ? +m[6] : 0,
      ms: m[7] != null ? +(m[7] + '00').slice(0, 3) : 0
    };
    if (!partsValid(parts)) return { ok: false, reason: 'date', parts: parts };
    var t = utcMs(parts.y, parts.m, parts.d, parts.H, parts.M, parts.S);
    if (Math.abs(t) > DATE_LIMIT) return { ok: false, reason: 'range', parts: parts };
    return { ok: true, parts: parts };
  }

  var api = {
    detect: detect,
    toDateParts: toDateParts,
    toEpoch: toEpoch,
    format: format,
    parseDate: parseDate,
    zoneOffset: zoneOffset,
    weekdayLabel: weekdayLabel,
    ZONES: ZONES,
    PATTERNS: PATTERNS,
    DATE_LIMIT: DATE_LIMIT
  };
  root.TimestampCore = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof self !== 'undefined' ? self : this);
