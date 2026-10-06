#!/usr/bin/env node
/**
 * inject_site.mjs — 站点导航/页脚/抽屉统一下发脚本（rev6.1 治理体系）
 *
 * 用法：
 *   node inject_site.mjs          下发模式：按 site-config.json + site-blocks/ 模板重写 8 页区块
 *   node inject_site.mjs --check  校验模式：只比对不写入，有漂移退出码 1（供门禁/回归调用）
 *
 * 规则：
 *  - 内容层（品牌/主体/版本/版权）改 site-config.json；结构层（菜单/排版）改 site-blocks/*.html
 *  - 模板内占位符：{{BRAND}} {{LOGO_ICON}} {{TAGLINE}} {{OPERATOR}} {{COPYRIGHT}} {{FOOTER_RIGHT}}
 *  - 子目录页（legal/ tools/）自动加 ../ 路径前缀（纯相对路径铁律）
 *  - 顺带同步 assets/i18n/{zh,en}.js 的 foot_version 到 config.version
 *  - 只写 8 个页面与词表的 foot_version，绝不触碰 moteful.css / moteful.js / template.html（只读铁律）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOV = path.join(ROOT, '_governance');
const cfg = JSON.parse(fs.readFileSync(path.join(GOV, 'site-config.json'), 'utf8'));
const tpl = {};
for (const n of ['topbar', 'drawer', 'footer']) {
  tpl[n] = fs.readFileSync(path.join(GOV, 'site-blocks', n + '.html'), 'utf8').replace(/\n$/, '');
}

const CHECK = process.argv.includes('--check');
const linkRe = /(href|src)="((?:index|support)\.html|tools\/[^"]*|legal\/[^"]*|dev\/[^"]*|games\/[^"]*|assets\/[^"]*)"/g;

function renderBlock(block, page, name) {
  const rightMode = (cfg.footerRight.overrides || {})[page] || cfg.footerRight.default || 'version';
  const right =
    rightMode === 'version'
      ? `<span data-i18n="foot_version">${cfg.version}</span>`
      : `<span>${cfg.designSystemLabel}</span>`;
  let out = block
    .replaceAll('{{COPYRIGHT}}', cfg.copyright)
    .replaceAll('{{OPERATOR}}', cfg.operator)
    .replaceAll('{{TAGLINE}}', cfg.tagline)
    .replaceAll('{{FOOTER_RIGHT}}', right)
    .replaceAll('{{BRAND}}', cfg.brand)
    .replaceAll('{{LOGO_ICON}}', cfg.logoIcon);
  const dir = path.dirname(page);
  // 先统一成"从站点根出发"的标准形：剥掉模板里任意层级的 ../（模板可能提取自子目录页）
  out = out.replace(/(href|src)="(?:\.\.\/)+((?:index|support)\.html|tools\/[^"]*|legal\/[^"]*|dev\/[^"]*|games\/[^"]*|assets\/[^"]*)"/g, '$1="$2"');
  // 再按页面所在层级加回正确前缀（纯相对路径铁律）
  if (dir !== '.') {
    out = out.replace(linkRe, (_, attr, target) => `${attr}="../${target}"`);
  }
  // 导航下拉"当前页高亮"：按 navMenuActive 配置给对应菜单项加 on
  // （data-i18n 在菜单项内部的 span 上，故按行匹配：同行同时含 menu-item 与目标键）
  const activeKey = (cfg.navMenuActive || {})[page];
  if (activeKey) {
    out = out
      .split('\n')
      .map((line) =>
        line.includes('class="menu-item"') && line.includes(`data-i18n="${activeKey}"`)
          ? line.replace('class="menu-item"', 'class="menu-item on"')
          : line
      )
      .join('\n');
  }
  // 抽屉菜单"当前页高亮"：drawer.html 各项以 data-nav-page 声明匹配串
  // （空格分隔多个；以 / 结尾视为目录前缀，如 tools/ 覆盖该目录全部页面）。
  // 注意 data-nav-page 不在 href/src 里，故不受上方相对路径前缀改写影响，--check 幂等。
  if (name === 'drawer') {
    out = out
      .split('\n')
      .map((line) => {
        const m = line.match(/data-nav-page="([^"]*)"/);
        if (!m) return line;
        const hit = m[1]
          .split(/\s+/)
          .filter(Boolean)
          .some((t) => (t.endsWith('/') ? page.startsWith(t) : page === t));
        return hit ? line.replace(/^(\s*)<a\b/, '$1<a class="on"') : line;
      })
      .join('\n');
  }
  return out;
}

const blocks = [
  ['topbar', /<header class="topbar">[\s\S]*?<\/header>/],
  ['drawer', /<div class="drawer" id="drawerNav"[\s\S]*?<\/aside>\s*<\/div>/],
  ['footer', /<footer class="footer">[\s\S]*?<\/footer>/],
];

// 缺口样式表：全站加载 _governance/missing_styles_proposal.css，使导航悬停蓝边等缺口规则生效
// 内联推荐（V1.1）：读取配置 + 弹窗模板
const REC_CFG = JSON.parse(fs.readFileSync(path.join(GOV, 'recommend-config.json'), 'utf8'));
const recTpl = fs.readFileSync(path.join(GOV, 'site-blocks', 'recommend-popup.html'), 'utf8').replace(/\n$/, '');
const REC_CSS = 'assets/css/recommend.css';
const REC_JS = 'assets/js/recommend.js';
// 分享体系（V1.4 / V1.4.2）：全站加载 share.css / share.js（页脚分享图标为全局入口；qrcode-core 仅工具页直接引用，其余页由 share.js 点击懒加载）
const SHARE_CSS = 'assets/css/share.css';
const SHARE_JS = 'assets/js/share.js';
function renderRecBlock(page) {
  const cfg = (REC_CFG.pages || {})[page];
  if (!cfg) return null;
  const meta = REC_CFG.pageMeta || {};
  const cards = (cfg.recs || []).map(function (t) {
    const m = meta[t] || { icon: 'star', labelKey: t, label: t };
    const label = m.new
      ? '<span class="rec-label"><span data-i18n="' + m.labelKey + '">' + (m.label || t) + '</span><span class="tag tag-new tag-sm" data-i18n="tag_new">NEW</span></span>'
      : '<span data-i18n="' + m.labelKey + '">' + (m.label || t) + '</span>';
    return '    <a class="rec-card" href="' + t + '">\n      <i data-lucide="' + m.icon + '"></i>\n      ' + label + '\n    </a>';
  }).join('\n');
  let block = recTpl.replace('{{RECS}}', cards);
  if (path.dirname(page) !== '.') block = block.replace(linkRe, function (_, attr, target) { return attr + '="../' + target + '"'; });
  return block;
}
const GAP_CSS = 'assets/css/missing_styles_proposal.css';
const OLD_GAP_CSS = '_governance/missing_styles_proposal.css';
const gapHref = (page) => (path.dirname(page) === '.' ? GAP_CSS : '../' + GAP_CSS);
const hasGapCss = (html) =>
  new RegExp('<link[^>]+href=["\'][^"\']*' + GAP_CSS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\']').test(html);

// 站点图标（rev2·内联加固）：主图标把 16×16 PNG 转成 data URI 直接写进 <head>，
// 不再发起任何外部请求 —— 彻底绕开「浏览器缓存旧图标 / file:// 协议 / 国产浏览器内核差异 / 子目录相对路径」四类失效场景。
// 兜底保留 favicon.ico（16/32/48 多尺寸实体文件）：IE 等老内核只认 shortcut icon 指向实体文件。
const FAVICON_B64 = fs.readFileSync(path.join(ROOT, 'favicon.png')).toString('base64');
const FAVICON_MARK = 'data:image/png;base64,' + FAVICON_B64.slice(0, 40);
const ICON_LINE_RE = /^[ \t]*<link[^>]+rel=["'](?:shortcut\s+)?icon["'][^>]*>[ \t]*\r?\n?/gim;
const hasFavicon = (html) => html.includes(FAVICON_MARK);
const faviconLinks = (page) => {
  const pre = path.dirname(page) === '.' ? '' : '../';
  return `  <link rel="icon" type="image/png" href="data:image/png;base64,${FAVICON_B64}">\n  <link rel="shortcut icon" href="${pre}favicon.ico">\n</head>`;
};

let drifted = [];
for (const page of cfg.pages) {
  const file = path.join(ROOT, page);
  let html = fs.readFileSync(file, 'utf8');
  let changed = [];
  for (const [name, re] of blocks) {
    const rendered = renderBlock(tpl[name], page, name);
    const m = html.match(re);
    if (!m) { console.error(`✗ ${page}: 找不到 ${name} 区块`); process.exit(1); }
    if (m[0] !== rendered) {
      drifted.push(page);
      if (!CHECK) { html = html.replace(re, () => rendered); changed.push(name); }
      else changed.push(name + '(漂移)');
    }
  }
  // 站点图标声明统一重写（幂等：先清掉历史写法——favicon.svg / 外部 favicon.png 等，再注入内联 data URI 版）
  if (!hasFavicon(html)) {
    drifted.push(page);
    if (!CHECK) {
      html = html.replace(ICON_LINE_RE, '').replace('</head>', faviconLinks(page));
      changed.push('favicon');
    } else changed.push('favicon(缺失)');
  }

  // 缺口样式表：先清理历史 _governance/ 写法（文件已迁出），再按新路径注入（幂等：已存在则跳过）
  if (html.includes(OLD_GAP_CSS)) {
    html = html.replace(new RegExp('<link[^>]+href=["\'][^"\']*?' + OLD_GAP_CSS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\'][^>]*>\\s*'), '');
    if (!CHECK) changed.push('gap-css(清理旧路径)');
  }
  if (!hasGapCss(html)) {
    drifted.push(page);
    if (!CHECK) {
      html = html.replace('</head>', `  <link rel="stylesheet" href="${gapHref(page)}">\n</head>`);
      changed.push('gap-css');
    } else changed.push('gap-css(缺失)');
  }
  // 站点分享 URL 事实源（V1.4.1）：siteUrl + 页面路径注入 head，share.js 读取构造正式分享链接（https://moteful.app/tools/image-tool）
  const siteMeta = '  <meta name="moteful-siteurl" content="' + (cfg.siteUrl || 'https://moteful.app') + '">\n  <meta name="moteful-pagepath" content="' + (path.dirname(page) === '.' ? '' : page.replace(/\.html$/, '')) + '">\n';
  if (!html.includes('name="moteful-siteurl"')) {
    drifted.push(page);
    if (!CHECK) {
      html = html.replace('</head>', siteMeta + '</head>');
      changed.push('share-meta');
    } else changed.push('share-meta(缺失)');
  }
  // 内联推荐（V1.1）：注入 rec.css / rec.js / 弹窗块（受 recommend-config.json 驱动）
  const recPre = path.dirname(page) === '.' ? '' : '../';
  const recCssHref = recPre + REC_CSS;
  const recJsHref = recPre + REC_JS;
  const recCssTag = '<link rel="stylesheet" href="' + recCssHref + '">';
  const recJsTag = '<script src="' + recJsHref + '" defer></script>';
  // 仅对配置了内联推荐的页面（工具页）下发 rec.css / rec.js / 弹窗块
  const hasRec = !!(REC_CFG.pages || {})[page];
  if (hasRec) {
    // 锚点直接匹配页面真实 <link rel=stylesheet href=*moteful.css> 与 <script src=*moteful.js>
    // 兼容根目录与子目录（../ 前缀）两种写法；第 4 字母是 e，勿写成第 4 字母为 i 的错拼（已踩坑）
    if (html.indexOf(recCssTag) < 0) {
      // 锚点 = 页面首个 rel=stylesheet 链接（即站点主样式，自动兼容根目录/子目录 ../ 前缀）
      const cssAnchorRe = /<link[^>]+rel="stylesheet"[^>]+href="[^"]+"[^>]*>/i;
      const m = html.match(cssAnchorRe);
      if (!m) { console.error('✗ ' + page + ': 找不到 rel=stylesheet 链接锚点'); process.exit(1); }
      drifted.push(page);
      if (!CHECK) { html = html.replace(cssAnchorRe, m[0] + '\n  ' + recCssTag); changed.push('rec-css'); }
      else changed.push('rec-css(缺失)');
    }
    if (html.indexOf(recJsTag) < 0) {
      // 锚点 = 页面首个带 src 的 <script>（即站点主脚本，其他脚本在其后加载）
      const jsAnchorRe = /<script[^>]+src="[^"]+"[^>]*>\s*<\/script>/i;
      const m = html.match(jsAnchorRe);
      if (!m) { console.error('✗ ' + page + ': 找不到 script 锚点'); process.exit(1); }
      drifted.push(page);
      if (!CHECK) { html = html.replace(jsAnchorRe, m[0] + '\n  ' + recJsTag); changed.push('rec-js'); }
      else changed.push('rec-js(缺失)');
    }
  }
  const recRendered = renderRecBlock(page);
  const recRe = /<div id="rec-popup"[\s\S]*?<\/div>\s*<\/body>/;
  if (recRendered) {
    if (!recRe.test(html)) {
      drifted.push(page);
      if (!CHECK) { html = html.replace('</body>', recRendered + '\n</body>'); changed.push('rec-block'); }
      else changed.push('rec-block(缺失)');
    } else {
      const cur = html.match(recRe)[0];
      if (cur !== recRendered + '\n</body>') { drifted.push(page); if (!CHECK) { html = html.replace(recRe, recRendered + '\n</body>'); changed.push('rec-block'); } else changed.push('rec-block(漂移)'); }
    }
  } else if (recRe.test(html)) {
    drifted.push(page);
    if (!CHECK) { html = html.replace(recRe, '</body>'); changed.push('rec-remove'); }
    else changed.push('rec-block(应移除)');
  }
  // 分享体系（V1.4.2）：share.css / share.js 全站下发（页脚分享图标全局入口；4 工具页已手写引用 → 幂等跳过）
  // 幂等判断用宽松正则（匹配 href/src 的任意属性写法，如 defer / async / 无属性），避免注入双份
  const sharePre = path.dirname(page) === '.' ? '' : '../';
  const shareCssTag = '<link rel="stylesheet" href="' + sharePre + SHARE_CSS + '">';
  const shareJsTag = '<script src="' + sharePre + SHARE_JS + '" defer></script>';
  const hasShareCss = new RegExp('<link[^>]+href=["\']' + sharePre + SHARE_CSS + '["\']').test(html);
  const hasShareJs = new RegExp('<script[^>]+src=["\']' + sharePre + SHARE_JS + '["\']').test(html);
  if (!hasShareCss) {
    const cssAnchorRe2 = /<link[^>]+rel="stylesheet"[^>]+href="[^"]+"[^>]*>/i;
    const m = html.match(cssAnchorRe2);
    if (!m) { console.error('✗ ' + page + ': 找不到 rel=stylesheet 链接锚点（share-css）'); process.exit(1); }
    drifted.push(page);
    if (!CHECK) { html = html.replace(cssAnchorRe2, m[0] + '\n  ' + shareCssTag); changed.push('share-css'); }
    else changed.push('share-css(缺失)');
  }
  if (!hasShareJs) {
    const jsAnchorRe2 = /<script[^>]+src="[^"]+"[^>]*>\s*<\/script>/i;
    const m = html.match(jsAnchorRe2);
    if (!m) { console.error('✗ ' + page + ': 找不到 script 锚点（share-js）'); process.exit(1); }
    drifted.push(page);
    if (!CHECK) { html = html.replace(jsAnchorRe2, m[0] + '\n  ' + shareJsTag); changed.push('share-js'); }
    else changed.push('share-js(缺失)');
  }
  if (!CHECK && changed.length) fs.writeFileSync(file, html);
  console.log(`${changed.length ? (CHECK ? '△' : '✓') : '·'} ${page}${changed.length ? ' → ' + changed.join(', ') : ''}`);
}

// 品牌全局换名：prevBrand ≠ brand 时，把 8 页正文 + 中英语言包里的旧品牌名（含全大写形式）
// 全部替换成新名，完成后回写 config 的 prevBrand=brand（B/C 类品牌文案全部纳入配置管理）
if (!CHECK && cfg.prevBrand && cfg.prevBrand !== cfg.brand) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const reMix = new RegExp(esc(cfg.prevBrand), 'g');
  const reUp = new RegExp(esc(cfg.prevBrand.toUpperCase()), 'g');
  const files = [...cfg.pages.map((p) => path.join(ROOT, p)),
                 path.join(ROOT, 'assets', 'i18n', 'zh.js'),
                 path.join(ROOT, 'assets', 'i18n', 'en.js')];
  let total = 0;
  for (const f of files) {
    let s = fs.readFileSync(f, 'utf8');
    const n = (s.match(reMix) || []).length + (s.match(reUp) || []).length;
    if (!n) continue;
    s = s.replace(reUp, cfg.brand.toUpperCase()).replace(reMix, cfg.brand);
    fs.writeFileSync(f, s);
    total += n;
    console.log(`✓ ${path.relative(ROOT, f)}: 品牌换名 ${n} 处`);
  }
  cfg.prevBrand = cfg.brand;
  const cfgFile = path.join(GOV, 'site-config.json');
  fs.writeFileSync(cfgFile, fs.readFileSync(cfgFile, 'utf8').replace(/("prevBrand"\s*:\s*")[^"]*(")/, `$1${cfg.brand}$2`));
  console.log(`✓ 品牌换名完成：${cfg.prevBrand} 全站 ${total} 处（含语言包与页面正文），prevBrand 已回写`);
}

  // 词表 foot_version / foot_operator 同步（页面可见文案以词表为准，只改 HTML 静态兜底不生效）
  if (!CHECK) {
    for (const lang of ['zh', 'en']) {
      const f = path.join(ROOT, 'assets', 'i18n', lang + '.js');
      let s = fs.readFileSync(f, 'utf8');
      const before = s;
      // 版本号
      s = s.replace(/("(?:foot_version)"\s*:\s*")[^"]*(")/, `$1${cfg.version}$2`);
      // 主体名：整条 foot_operator 按语言替换为全量文案（zh/operatorZh、en/operatorEn）
      const op = lang === 'zh' ? (cfg.operatorZh || cfg.operator) : (cfg.operatorEn || cfg.operator);
      s = s.replace(/("foot_operator"\s*:\s*")[^"]*(")/, `$1${op}$2`);
      if (s !== before) { fs.writeFileSync(f, s); console.log(`✓ assets/i18n/${lang}.js: foot_version → ${cfg.version} / foot_operator → ${op}`); }
    }
  }

if (CHECK && drifted.length) {
  console.error(`\n✗ 一致性校验失败：${drifted.join(', ')} 与模板/配置不一致（可能被绕过配置直接手改）。请跑 node _governance/inject_site.mjs 重新下发。`);
  process.exit(1);
}
console.log(CHECK ? `\n校验通过：${cfg.pages.length} 页与配置/模板一致` : `\n下发完成：${cfg.pages.length} 页`);
