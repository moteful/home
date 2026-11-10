/* ===== markdown-core.js · Markdown 安全子集解析内核（V2.1.2 P0） =====
   两段式：parse() 逐行状态机切块 + 行内分词；render() 逐元素建 DOM。
   安全契约（设计文档 4.4）：零 innerHTML；用户文字只进文本节点；
   属性白名单 a→href/title、img→src/alt/title；协议白名单 http/https/mailto/相对路径。
   零 DOM 依赖：render/renderHTML 可传 doc 参数，Node 下用 shim 直测。 */
(function (root) {
  'use strict';

  /* ---------- 协议白名单：decode → 去控制字符 → trim → 小写 → 比对 ---------- */
  function decodeEntities(s) {
    return s
      .replace(/&#x([0-9a-f]+);?/gi, function (_, h) { var c = parseInt(h, 16); return c > 0 && c < 1114112 ? String.fromCodePoint(c) : ''; })
      .replace(/&#(\d+);?/g, function (_, d) { var c = parseInt(d, 10); return c > 0 && c < 1114112 ? String.fromCodePoint(c) : ''; })
      .replace(/&colon;/gi, ':').replace(/&tab;/gi, '\t').replace(/&newline;/gi, '\n');
  }
  function safeHref(raw) {
    var v = decodeEntities(String(raw == null ? '' : raw));
    var clean = v.replace(/[\x00-\x1f\x7f]/g, '').trim();
    var m = clean.toLowerCase().match(/^([a-z][a-z0-9+.-]*):/);
    if (m && m[1] !== 'http' && m[1] !== 'https' && m[1] !== 'mailto') return { ok: false, value: clean };
    return { ok: true, value: clean };
  }
  /* ---------- 行内分词：代码先吃，强调先粗后斜，链接/图片走白名单 ---------- */
  function findClose(src, from, marker) {
    var ch = marker[0], idx = src.indexOf(marker, from);
    while (idx !== -1) {
      if ((ch === '*' || ch === '_' || ch === '~') && (src[idx - 1] === ch || src[idx + marker.length] === ch)) {
        idx = src.indexOf(marker, idx + 1); continue;
      }
      return idx;
    }
    return -1;
  }
  function parseLink(src, start, stats, isImg) {
    var n = src.length, i = start, depth = 0, textEnd = -1;
    for (; i < n; i++) {
      if (src[i] === '\\') { i++; continue; }
      if (src[i] === '[') depth++;
      else if (src[i] === ']') { depth--; if (depth === 0) { textEnd = i; break; } }
    }
    if (textEnd === -1 || src[textEnd + 1] !== '(') return null;
    var j = textEnd + 2, pdepth = 1;
    while (src[j] === ' ') j++;
    var hrefStart = j;
    for (; j < n; j++) {
      var ch = src[j];
      if (ch === '\\') { j++; continue; }
      if (ch === '(') pdepth++;
      else if (ch === ')') { pdepth--; if (pdepth === 0) break; }
    }
    if (pdepth !== 0) return null;
    var inner = src.slice(hrefStart, j), title = null, href;
    var tm = inner.match(/\s+("([^"]*)"|'([^']*)')\s*$/);
    if (tm) { title = tm[2] != null ? tm[2] : tm[3]; href = inner.slice(0, tm.index); }
    else href = inner;
    href = href.trim().replace(/\\([\\`*_\[\]()])/g, '$1');
    var rawText = src.slice(start + 1, textEnd);
    stats.total++;
    var chk = safeHref(href);
    if (!chk.ok) return { token: { t: 'text', v: src.slice(isImg ? start - 1 : start, j + 1) }, next: j + 1 };
    stats.safe++;
    if (isImg) return { token: { t: 'img', src: chk.value, alt: rawText, title: title }, next: j + 1 };
    return { token: { t: 'link', href: chk.value, title: title, c: tokenizeInline(rawText, stats) }, next: j + 1 };
  }
  function tokenizeInline(src, stats) {
    var tokens = [], i = 0, n = src.length, buf = '';
    function flush() { if (buf) { tokens.push({ t: 'text', v: buf }); buf = ''; } }
    while (i < n) {
      var c = src[i];
      if (c === '\\') {
        if (src[i + 1] === '\n') { flush(); tokens.push({ t: 'br' }); i += 2; continue; }
        var nx = src[i + 1];
        if (nx && /[\\`*_{}\[\]()#+\-.!|~>]/.test(nx)) { buf += nx; i += 2; continue; }
        buf += c; i++; continue;
      }
      if (c === ' ' && src[i + 1] === ' ') {
        var j = i; while (src[j] === ' ') j++;
        if (src[j] === '\n') { flush(); tokens.push({ t: 'br' }); i = j + 1; continue; }
        buf += src.slice(i, j); i = j; continue;
      }
      if (c === '`') {
        var run = 1; while (src[i + run] === '`') run++;
        var close = src.indexOf('`'.repeat(run), i + run);
        while (close !== -1 && (src[close - 1] === '`' || src[close + run] === '`')) close = src.indexOf('`'.repeat(run), close + 1);
        if (close !== -1) {
          flush();
          var code = src.slice(i + run, close);
          if (/^ .* $/.test(code) && code.trim() !== '') code = code.slice(1, -1);
          tokens.push({ t: 'code', v: code.replace(/\n/g, ' ') });
          i = close + run; continue;
        }
        buf += src.slice(i, i + run); i += run; continue;
      }
      if (c === '!' && src[i + 1] === '[') {
        var img = parseLink(src, i + 1, stats, true);
        if (img) { flush(); tokens.push(img.token); i = img.next; continue; }
        buf += c; i++; continue;
      }
      if (c === '[') {
        var lnk = parseLink(src, i, stats, false);
        if (lnk) { flush(); tokens.push(lnk.token); i = lnk.next; continue; }
        buf += c; i++; continue;
      }
      if (c === '*' || c === '_') {
        var erun = 1; while (src[i + erun] === c) erun++;
        var done = false;
        for (var k = Math.min(erun, 3); k >= 1; k--) {
          var marker = c.repeat(k);
          var ec = findClose(src, i + k, marker);
          if (ec <= i + k) continue;
          // _ 不在词中作强调（snake_case 原样保留）
          if (c === '_' && /\w/.test(src[i - 1] || '') && /\w/.test(src[ec + k] || '')) continue;
          flush();
          tokens.push({ t: k === 3 ? 'strongem' : k === 2 ? 'strong' : 'em', c: tokenizeInline(src.slice(i + k, ec), stats) });
          i = ec + k; done = true; break;
        }
        if (!done) { var skip = Math.min(erun, 3); buf += src.slice(i, i + skip); i += skip; }
        continue;
      }
      if (c === '~' && src[i + 1] === '~') {
        var dc = findClose(src, i + 2, '~~');
        if (dc > i + 2) { flush(); tokens.push({ t: 'del', c: tokenizeInline(src.slice(i + 2, dc), stats) }); i = dc + 2; continue; }
        buf += '~~'; i += 2; continue;
      }
      // ++文本++ → 下划线（本工具扩展语法，输出 <ins>）
      if (c === '+' && src[i + 1] === '+') {
        var uc = findClose(src, i + 2, '++');
        if (uc > i + 2) { flush(); tokens.push({ t: 'ins', c: tokenizeInline(src.slice(i + 2, uc), stats) }); i = uc + 2; continue; }
        buf += '++'; i += 2; continue;
      }
      buf += c; i++;
    }
    flush();
    return tokens;
  }
  function plainText(tokens) {
    var out = '';
    tokens.forEach(function (t) {
      if (t.t === 'text' || t.t === 'code') out += t.v;
      else if (t.t === 'img') out += t.alt;
      else if (t.t === 'br') out += ' ';
      else if (t.c) out += plainText(t.c);
    });
    return out;
  }
  /* ---------- 块级：逐行状态机 ---------- */
  function splitRow(line) {
    var SENT = String.fromCharCode(0);
    var cells = line.replace(/\\\|/g, SENT).split('|').map(function (s) { return s.trim(); });
    if (cells.length && cells[0] === '') cells.shift();
    if (cells.length && cells[cells.length - 1] === '') cells.pop();
    return cells.map(function (s) { return s.split(SENT).join('|'); });
  }
  function isTableSep(line) {
    if (line.indexOf('|') === -1) return false;
    var cells = splitRow(line);
    return cells.length > 0 && cells.every(function (s) { return /^:?-+:?$/.test(s); });
  }
  var RE = {
    fence: /^\s{0,3}(`{3,}|~{3,})(.*)$/,
    hr: /^\s{0,3}([-*_])(\s*\1){2,}\s*$/,
    head: /^\s{0,3}(#{1,6})\s+(.+?)\s*$/,
    quote: /^\s{0,3}>/,
    item: /^(\s*)([-*+]|\d+\.)\s+(.*)$/,
    /* 本工具扩展语法：行首 {left|center|right|justify} 指定该段（或标题）对齐 */
    align: /^\s{0,3}\{(left|center|right|justify)\}\s*/
  };
  function isBlockStart(line, next) {
    return RE.fence.test(line) || RE.hr.test(line) || RE.head.test(line) ||
      RE.quote.test(line) || RE.item.test(line) || RE.align.test(line) ||
      (line.indexOf('|') !== -1 && next != null && isTableSep(next));
  }
  function parseList(lines, i, stats, headings) {
    var n = lines.length;
    var m0 = lines[i].match(RE.item);
    var base = m0[1].length, ordered = /\d/.test(m0[2][0]);
    var items = [], cur = null;
    while (i < n) {
      var L = lines[i];
      if (L.trim() === '') {
        var j = i + 1; while (j < n && lines[j].trim() === '') j++;
        var cont = false;
        if (j < n) {
          var ind = lines[j].match(/^\s*/)[0].length;
          var im2 = lines[j].match(RE.item);
          cont = ind >= base + 2 || (im2 && ind === base && /\d/.test(im2[2][0]) === ordered);
        }
        if (!cont) { i = j; break; }
        if (cur) cur.content.push('');
        i = j; continue;
      }
      var im = L.match(RE.item), ind2 = L.match(/^\s*/)[0].length;
      if (im && ind2 <= base) {
        if (ind2 < base) break;
        if (/\d/.test(im[2][0]) !== ordered) break;
        cur = { content: [im[3]] }; items.push(cur); i++; continue;
      }
      if (cur && ind2 >= base + 2) { cur.content.push(L.slice(base + 2)); i++; continue; }
      if (cur && ind2 > base) { cur.content.push(L.slice(base)); i++; continue; }
      if (cur && !isBlockStart(L, lines[i + 1])) { cur.content.push(L.trim()); i++; continue; }
      break;
    }
    items.forEach(function (it) {
      var tm = it.content[0] ? it.content[0].match(/^\[([ xX])\]\s+(.*)$/) : null;
      if (tm) { it.task = true; it.checked = tm[1] !== ' '; it.content[0] = tm[2]; }
      it.blocks = parseBlocks(it.content, stats, headings);
    });
    return { block: { type: 'list', ordered: ordered, items: items }, next: i };
  }
  function parseBlocks(lines, stats, headings) {
    var blocks = [], i = 0, n = lines.length, alignFor = null;
    while (i < n) {
      var line = lines[i];
      if (line.trim() === '') { alignFor = null; i++; continue; }
      var am = alignFor === null ? line.match(RE.align) : null;
      if (am) {
        alignFor = am[1];
        lines[i] = line.slice(am[0].length);
        if (lines[i].trim() === '') { i++; continue; }
        continue;
      }
      var align = alignFor; alignFor = null;
      var fm = line.match(RE.fence);
      if (fm) {
        var ch = fm[1][0], len = fm[1].length, lang = fm[2].trim(), buf = [];
        i++;
        while (i < n) {
          var t = lines[i].trim(), k = 0;
          while (t[k] === ch) k++;
          if (k >= len && t.slice(k).trim() === '') { i++; break; }
          buf.push(lines[i]); i++;
        }
        blocks.push({ type: 'code', lang: lang, text: buf.join('\n') });
        continue;
      }
      if (RE.hr.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }
      var hm = line.match(RE.head);
      if (hm) {
        var text = hm[2].replace(/\s+#+\s*$/, '');
        var level = hm[1].length, toks = tokenizeInline(text, stats);
        headings.push({ level: level, text: plainText(toks) });
        blocks.push({ type: 'h', level: level, inline: toks, align: align });
        i++; continue;
      }
      if (RE.quote.test(line)) {
        var qbuf = [];
        while (i < n && RE.quote.test(lines[i])) { qbuf.push(lines[i].replace(/^\s{0,3}>\s?/, '')); i++; }
        blocks.push({ type: 'quote', children: parseBlocks(qbuf, stats, headings), align: align });
        continue;
      }
      if (line.indexOf('|') !== -1 && i + 1 < n && isTableSep(lines[i + 1])) {
        var head = splitRow(line), coln = head.length, rows = [];
        /* 列对齐取自分隔行：`:---:` 居中、`---:` 右；左对齐即默认，不落属性 */
        var colAlign = splitRow(lines[i + 1]).map(function (s) {
          var l = s.charAt(0) === ':', r = s.charAt(s.length - 1) === ':';
          return l && r ? 'center' : r ? 'right' : null;
        });
        i += 2;
        while (i < n && lines[i].trim() !== '' && lines[i].indexOf('|') !== -1 && !isBlockStart(lines[i], lines[i + 1])) {
          var r = splitRow(lines[i]);
          while (r.length < coln) r.push('');
          rows.push(r.slice(0, coln)); i++;
        }
        var tk = function (s) { return tokenizeInline(s, stats); };
        blocks.push({ type: 'table', head: head.map(tk), rows: rows.map(function (row) { return row.map(tk); }), aligns: colAlign });
        continue;
      }
      if (RE.item.test(line)) {
        var res = parseList(lines, i, stats, headings);
        /* 对齐标记只作用于它所在的那一个列表项，不整串列表跟着变 */
        if (align && res.block.items.length) res.block.items[0].align = align;
        blocks.push(res.block); i = res.next; continue;
      }
      var pbuf = [line]; i++;
      while (i < n && lines[i].trim() !== '' && !isBlockStart(lines[i], lines[i + 1])) { pbuf.push(lines[i]); i++; }
      if (pbuf.length >= 2 && pbuf[0].indexOf('|') !== -1 && pbuf[1].indexOf('|') !== -1 && !isTableSep(pbuf[1])) stats.tablesDegraded++;
      blocks.push({ type: 'p', inline: tokenizeInline(pbuf.join('\n'), stats), align: align });
    }
    return blocks;
  }
  /* ---------- 入口：parse(md) → {blocks, headings, links, tablesDegraded} ---------- */
  function parse(md) {
    var stats = { total: 0, safe: 0, tablesDegraded: 0 };
    var headings = [];
    var src = String(md == null ? '' : md).replace(/\r\n?/g, '\n').replace(/\x00/g, '');
    var blocks = parseBlocks(src.split('\n'), stats, headings);
    return { blocks: blocks, headings: headings, links: { total: stats.total, safe: stats.safe }, tablesDegraded: stats.tablesDegraded };
  }
  /* ---------- 渲染：只 createElement / createTextNode，绝不 innerHTML ---------- */
  function el(doc, tag) { return doc.createElement(tag); }
  /* 对齐值只可能来自 RE.align 的四个枚举，不存在注入面 */
  function setAlign(node, align) { if (align) node.setAttribute('style', 'text-align:' + align); }
  function appendInline(doc, parent, tokens) {
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i], node = null;
      if (t.t === 'text') parent.appendChild(doc.createTextNode(t.v));
      else if (t.t === 'code') { node = el(doc, 'code'); node.appendChild(doc.createTextNode(t.v)); }
      else if (t.t === 'br') node = el(doc, 'br');
      else if (t.t === 'strong') { node = el(doc, 'strong'); appendInline(doc, node, t.c); }
      else if (t.t === 'em') { node = el(doc, 'em'); appendInline(doc, node, t.c); }
      else if (t.t === 'del') { node = el(doc, 'del'); appendInline(doc, node, t.c); }
      else if (t.t === 'ins') { node = el(doc, 'ins'); appendInline(doc, node, t.c); }
      else if (t.t === 'strongem') { node = el(doc, 'strong'); var emn = el(doc, 'em'); appendInline(doc, emn, t.c); node.appendChild(emn); }
      else if (t.t === 'link') { node = el(doc, 'a'); node.setAttribute('href', t.href); if (t.title) node.setAttribute('title', t.title); appendInline(doc, node, t.c); }
      else if (t.t === 'img') { node = el(doc, 'img'); node.setAttribute('src', t.src); node.setAttribute('alt', t.alt); if (t.title) node.setAttribute('title', t.title); }
      if (node) parent.appendChild(node);
    }
  }
  function renderBlock(doc, b, parent) {
    if (b.type === 'p') { var p = el(doc, 'p'); setAlign(p, b.align); appendInline(doc, p, b.inline); parent.appendChild(p); return; }
    if (b.type === 'h') { var h = el(doc, 'h' + b.level); setAlign(h, b.align); appendInline(doc, h, b.inline); parent.appendChild(h); return; }
    if (b.type === 'hr') { parent.appendChild(el(doc, 'hr')); return; }
    if (b.type === 'code') {
      var pre = el(doc, 'pre'), cd = el(doc, 'code');
      /* CommonMark 惯例：语言落在 class="language-xxx"，复制出的 HTML 也能被高亮器识别 */
      if (b.lang) cd.setAttribute('class', 'language-' + b.lang.split(/\s+/)[0]);
      cd.appendChild(doc.createTextNode(b.text)); pre.appendChild(cd); parent.appendChild(pre); return;
    }
    if (b.type === 'quote') { var q = el(doc, 'blockquote'); setAlign(q, b.align); renderBlocks(doc, b.children, q); parent.appendChild(q); return; }
    if (b.type === 'list') {
      var ul = el(doc, b.ordered ? 'ol' : 'ul');
      for (var i = 0; i < b.items.length; i++) {
        var it = b.items[i], li = el(doc, 'li');
        setAlign(li, it.align);
        if (it.task) {
          var box = el(doc, 'input');
          box.setAttribute('type', 'checkbox'); box.setAttribute('disabled', 'disabled');
          if (it.checked) box.setAttribute('checked', 'checked');
          li.appendChild(box); li.appendChild(doc.createTextNode(' '));
        }
        renderBlocks(doc, it.blocks, li, true);
        ul.appendChild(li);
      }
      parent.appendChild(ul); return;
    }
    if (b.type === 'table') {
      var tb = el(doc, 'table'), thead = el(doc, 'thead'), htr = el(doc, 'tr');
      var ca = b.aligns || [];
      for (var c = 0; c < b.head.length; c++) { var th = el(doc, 'th'); setAlign(th, ca[c]); appendInline(doc, th, b.head[c]); htr.appendChild(th); }
      thead.appendChild(htr); tb.appendChild(thead);
      var tbody = el(doc, 'tbody');
      for (var r = 0; r < b.rows.length; r++) {
        var tr = el(doc, 'tr');
        for (var cc = 0; cc < b.rows[r].length; cc++) { var td = el(doc, 'td'); setAlign(td, ca[cc]); appendInline(doc, td, b.rows[r][cc]); tr.appendChild(td); }
        tbody.appendChild(tr);
      }
      tb.appendChild(tbody); parent.appendChild(tb); return;
    }
  }
  function renderBlocks(doc, blocks, parent, unwrapOneP) {
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (unwrapOneP && blocks.length === 1 && b.type === 'p') {
        /* 紧凑列表项会把这一段摊平进 li，对齐标记随之落到 li 上，不能丢 */
        if (b.align) setAlign(parent, b.align);
        appendInline(doc, parent, b.inline); return;
      }
      renderBlock(doc, b, parent);
    }
  }
  function render(blocks, doc) {
    var frag = doc.createDocumentFragment();
    renderBlocks(doc, blocks || [], frag, false);
    return frag;
  }
  /* ---------- 序列化：从已构建的 DOM 反推 HTML 文本（复制 HTML 用） ---------- */
  var VOID = { br: 1, hr: 1, img: 1, input: 1 };
  function escText(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escAttr(s) { return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
  function serializeNode(node) {
    if (node.nodeType === 3) return escText(node.nodeValue == null ? node.textContent : node.nodeValue);
    var tag = node.tagName.toLowerCase(), out = '<' + tag, a = node.attributes, i;
    for (i = 0; i < a.length; i++) out += ' ' + a[i].name + '="' + escAttr(a[i].value) + '"';
    out += '>';
    if (VOID[tag]) return out;
    var kids = node.childNodes;
    for (i = 0; i < kids.length; i++) out += serializeNode(kids[i]);
    return out + '</' + tag + '>';
  }
  function renderHTML(blocks, doc) {
    var holder = doc.createElement('div');
    holder.appendChild(render(blocks, doc));
    var kids = holder.childNodes, out = '';
    for (var i = 0; i < kids.length; i++) out += serializeNode(kids[i]);
    return out;
  }
  var api = { parse: parse, render: render, renderHTML: renderHTML, safeHref: safeHref };
  root.MarkdownCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);