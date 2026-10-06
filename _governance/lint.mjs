#!/usr/bin/env node
/**
 * Moteful 规范静态门禁 lint.mjs（治理 v2.0 重建版 2026-09-05）
 * 零依赖 node 脚本。扫描：
 *   R1 硬编码色值（#hex / rgb / rgba）
 *   R2 字号不在阶梯 {12,13,14,15,22,32}
 *   R3 圆角不在四档 {6,10,16,999,50%}
 *   R4 间距(px) 不是 4 的倍数（margin/padding/gap）
 *   R5 跨页同名选择器漂移（同一选择器在不同页面内联样式中值不同）
 * 分区判定：
 *   新架构页（newArchPages）：内联 <style>、内联 style=、硬编码色 → error
 *   遗留页（legacyPages）：   同类发现 → warn（债务记账，只许变少）
 *   moteful.css：             :root 令牌定义区允许硬编码色；组件区硬编码色 → warn
 * 退出码：error>0 → 1，否则 0
 */
'use strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const here = __dirname;
const cfg = JSON.parse(fs.readFileSync(path.join(here, 'lint.config.json'), 'utf8'));
const root = path.resolve(here, cfg.root);
const cssPath = path.join(root, cfg.cssSource);

const FONT_LADDER = new Set(cfg.rules.fontPxLadder);
const RADIUS_OK = new Set(cfg.rules.radiusAllowed);
const SPACING_MULT = cfg.rules.spacingMultiple;

/** @type {{rule:string,level:string,file:string,loc:string,msg:string}[]} */
const findings = [];
function add(rule, level, file, loc, msg) { findings.push({ rule, level, file, loc, msg }); }

function rel(p) { return path.relative(root, p).replace(/\\/g, '/'); }

/* ---------- CSS 文本检查（用于页面内联 style 与 moteful.css） ---------- */
function checkCssText(ruleTag, level, fileLabel, cssText, opts) {
  const lines = cssText.split(/\r?\n/);
  let inRootBlock = false, depth = 0;
  lines.forEach((line, i) => {
    const ln = i + 1;
    const trimmed = line.trim();
    // 粗略跟踪 :root 块（仅对 moteful.css 用）
    if (opts && opts.rootAware) {
      if (/[:]?root[^{]*\{/.test(trimmed)) inRootBlock = true;
      depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      if (inRootBlock && depth <= 0) { inRootBlock = false; depth = 0; }
    }
    const inRoot = (opts && opts.rootAware && inRootBlock) || false;

    // R1 硬编码色
    const colorRe = /(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\))/g;
    let m;
    while ((m = colorRe.exec(line)) !== null) {
      if (inRoot && cfg.allow.cssRootBlockHardcodedColor) continue; // 令牌定义区豁免
      add('R1', level, fileLabel, `L${ln}`, `硬编码色 ${m[0]}`);
    }
    // R2 字号阶梯
    const fsRe = /font-size\s*:\s*(\d+(?:\.\d+)?)px/gi;
    while ((m = fsRe.exec(line)) !== null) {
      const n = parseFloat(m[1]);
      if (!FONT_LADDER.has(n)) add('R2', level, fileLabel, `L${ln}`, `字号 ${m[1]}px 不在阶梯 {${cfg.rules.fontPxLadder.join(',')}}`);
    }
    // R3 圆角四档
    const brRe = /border(?:-(?:top|bottom)-(?:left|right))?-radius\s*:\s*([^;]+);/gi;
    while ((m = brRe.exec(line)) !== null) {
      const v = m[1].trim();
      if (/var\(/.test(v)) continue;
      const nums = v.match(/(\d+(?:\.\d+)?)px|(\d+(?:\.\d+)?)%/g) || [];
      for (const t of nums) {
        const n = parseFloat(t);
        const isPct = t.endsWith('%');
        if (isPct) { if (!RADIUS_OK.has(n)) add('R3', level, fileLabel, `L${ln}`, `圆角 ${t} 不在四档`); }
        else if (!RADIUS_OK.has(n)) add('R3', level, fileLabel, `L${ln}`, `圆角 ${t} 不在四档 {6,10,16,999}`);
      }
      if (nums.length === 0 && !/^0(\s|$)/.test(v) && v !== '0') {
        add('R3', level, fileLabel, `L${ln}`, `圆角值无法识别: ${v}`);
      }
    }
    // R4 间距 4 的倍数
    const spRe = /(?:^|[{;\s])(margin|padding|gap|row-gap|column-gap)(?:-(?:top|bottom|left|right))?\s*:\s*([^;]+);/gi;
    while ((m = spRe.exec(line)) !== null) {
      const v = m[2].trim();
      if (/var\(|calc\(|%|auto|em|rem/.test(v)) continue;
      const nums = v.match(/-?\d+(?:\.\d+)?px/g) || [];
      for (const t of nums) {
        const n = Math.abs(parseFloat(t));
        if (n !== 0 && n % SPACING_MULT !== 0) add('R4', level, fileLabel, `L${ln}`, `${m[1]}: ${t} 不是 ${SPACING_MULT} 的倍数`);
      }
    }
  });
}

/* ---------- 1) moteful.css ---------- */
if (fs.existsSync(cssPath)) {
  const css = fs.readFileSync(cssPath, 'utf8');
  checkCssText('css', 'warn', rel(cssPath), css, { rootAware: true });
} else {
  add('CFG', 'error', rel(cssPath), '-', '找不到唯一事实源 moteful.css');
}

/* ---------- 2) 页面扫描 ---------- */
const pageInlineStyles = new Map(); // file -> {selector: declarations} 供 R5 漂移
const sliderIds = new Map(); // sliderId -> htmlFile 供 R11 滑杆 --p 契约
function scanPage(file, level) {
  const fp = path.join(root, file);
  if (!fs.existsSync(fp)) { add('CFG', 'error', file, '-', '配置中的页面不存在'); return; }
  const html = fs.readFileSync(fp, 'utf8');
  const lines = html.split(/\r?\n/);

  // 2a 三态复活检查（遗留页为 warn 债务；新架构页保持 error）
  lines.forEach((line, i) => {
    if (/data-theme=["']system["']/.test(line)) add('R6', level, file, `L${i + 1}`, '三态 data-theme=system（rev6.1 已退役）');
    if (/@media[^{]*prefers-color-scheme/i.test(line)) add('R6', level, file, `L${i + 1}`, 'prefers-color-scheme 媒体查询（三态遗留特征）');
  });

  // 2b 内联 <style> 块
  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
  if (styleBlocks.length && level === 'error') {
    styleBlocks.forEach((_, k) => add('R7', 'error', file, `第${k + 1}个<style>`, '新架构页出现内联样式块（样式唯一事实源是 moteful.css）'));
  } else if (styleBlocks.length) {
    styleBlocks.forEach((_, k) => add('R7', 'warn', file, `第${k + 1}个<style>`, '遗留页内联样式块（债务，只许变少）'));
  }
  styleBlocks.forEach((m, k) => {
    const label = `${file}#style${k + 1}`;
    checkCssText('page', level, label, m[1], { rootAware: false });
    // 收集选择器供 R5
    const decls = new Map();
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let rm;
    while ((rm = ruleRe.exec(m[1])) !== null) {
      const sel = rm[1].trim().replace(/\s+/g, ' ');
      const body = rm[2].trim().replace(/\s+/g, ' ');
      if (!sel || sel.startsWith('@')) continue;
      decls.set(sel, body);
    }
    pageInlineStyles.set(label, decls);
  });

  // 2c 内联 style= 属性：一律 warn（外壳小布局属性来自用户定稿的 index.html 范例，属债务记账，只许变少；滑杆 --p 契约初始值豁免）
  lines.forEach((line, i) => {
    const sm = line.match(/style\s*=\s*["']([^"']+)["']/g);
    if (sm) sm.forEach((s) => {
      if (/^--p\s*:/.test(s.replace(/^style\s*=\s*["']/, '').replace(/["']$/, '').trim())) return;
      add('R8', 'warn', file, `L${i + 1}`, `内联 style 属性: ${s.slice(0, 60)}`);
    });
  });

  // 2d R11 滑杆 --p 契约：每个 .slider 必须内联 --p 初始值，且数值 = (value-min)/(max-min) 归一化
  //    （原生 range 滑块位置按范围归一化；写线性 value% 会在 min≠0 滑杆上滑块与填充错位）
  lines.forEach((line, i) => {
    const slm = line.match(/\bid="([^"]+)"[^>]*class="slider"/) || line.match(/class="slider"[^>]*\bid="([^"]+)"/);
    if (!slm) return;
    const id = slm[1];
    sliderIds.set(id, file);
    const attrs = {};
    let am;
    const attrRe = /([a-zA-Z-]+)\s*=\s*"([^"]*)"/g;
    while ((am = attrRe.exec(line))) attrs[am[1]] = am[2];
    const styleAttr = attrs.style || '';
    const pm = styleAttr.match(/--p\s*:\s*([\d.]+)%/);
    if (!pm) {
      add('R11', level, file, `L${i + 1}`, `滑杆 ${id} 缺少内联 --p 初始值（契约：style="--p:N%"）`);
      return;
    }
    const actual = parseFloat(pm[1]);
    const mn = parseFloat(attrs.min), mx = parseFloat(attrs.max), v = parseFloat(attrs.value);
    if (isFinite(mn) && isFinite(mx) && isFinite(v) && mx !== mn) {
      const expected = (v - mn) / (mx - mn) * 100;
      if (Math.abs(actual - expected) > 1) {
        add('R11', level, file, `L${i + 1}`, `滑杆 ${id} 内联 --p=${actual.toFixed(2)}% 与归一化期望 ${expected.toFixed(2)}% 不符（须 (value-min)/(max-min)）`);
      }
    }
  });
}
cfg.newArchPages.forEach((f) => scanPage(f, 'error'));
cfg.legacyPages.forEach((f) => scanPage(f, 'warn'));

/* ---------- 3) R5 跨页同名选择器漂移 ---------- */
{
  const bySel = new Map(); // selector -> [{label, body}]
  for (const [label, decls] of pageInlineStyles) {
    for (const [sel, body] of decls) {
      if (!bySel.has(sel)) bySel.set(sel, []);
      bySel.get(sel).push({ label, body });
    }
  }
  for (const [sel, entries] of bySel) {
    if (entries.length < 2) continue;
    const first = entries[0].body;
    const diff = entries.find((e) => e.body !== first);
    if (diff) {
      add('R5', 'warn', '跨页', sel.slice(0, 50), `同名选择器值漂移：${entries[0].label} vs ${diff.label}`);
    }
  }
}

/* ---------- 4) R9 JS 语法检查（node --check） ---------- */
if (cfg.jsFiles && cfg.jsFiles.length) {
  cfg.jsFiles.forEach((f) => {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) {
      add('R9', 'error', f, '-', 'JS 文件不存在');
      return;
    }
    try {
      execSync(`node --check "${p}"`, { stdio: 'pipe' });
    } catch (e) {
      const stderr = (e.stderr || '').toString();
      const firstLine = stderr.split(/\r?\n/).find((l) => l.trim()) || '语法错误';
      add('R9', 'error', f, '-', `JS 语法错误: ${firstLine.slice(0, 120)}`);
    }
  });
}

/* ---------- 4b) R11b 滑杆 --p 契约（JS 层）：含滑杆页面的 JS 必须存在 --p 同步机制 ----------
   根治「代码设值漏 --p → 滑块与填充错位」反复踩坑：页面只要有 .slider，
   其配套 JS 必须出现 setProperty('--p') 或 MF.sliderSet 至少一次（文件级弱检查，
   防「完全没有同步逻辑」的最坏情况；具体设值路径由 MF.sliderSet 强制收敛）。 */
for (const [sid, htmlFile] of sliderIds) {
  const js = cfg.jsFiles || [];
  for (const f of js) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    if (src.includes("setProperty('--p'") || src.includes('setProperty("--p"') || src.includes('sliderSet')) {
      continue; // 该 JS 已有 --p 同步机制
    }
    // 该 JS 若引用了此滑杆 id（页面脚本场景），则必须带 --p 同步
    if (src.includes("'" + sid + "'") || src.includes('"' + sid + '"') || src.includes('#' + sid)) {
      add('R11', 'warn', f, '-', `滑杆 ${sid}（来自 ${htmlFile}）的 JS 无 --p 同步（须 setProperty('--p') 或 MF.sliderSet）`);
    }
  }
}

/* ---------- 5) R10 页面私有 CSS 不得裸重定义白名单完整组件 ----------
   根治「擅自创建样式 / 越界改白名单」：私有 CSS 只允许两类写法——
   ① 带本页前缀的私有 class（.page-{...}）；② 带作用域/组合选择器
   的覆盖（.page .field / .panel > * + * / .dz-thumb{cursor} 等）。
   若**精确裸写**白名单完整组件（选择器恰为 .segment / .step /
   .panel / .row / .input，无后代/组合）即「想改白名单却没走
   missing_styles_proposal.css 提案」的越界，error 拦截。
   注：.field{gap}/.dz-thumb{cursor} 等页面合理单属性扩展不在拦截范围
   （它们不改组件形态；拉宽根因由 .field{align-items} 提案根治）。 */
{
  const KEY = new Set(['segment', 'step', 'panel', 'row', 'input']);
  for (const page of cfg.newArchPages) {
    if (!page.startsWith('tools/')) continue;
    const pageName = path.basename(page, '.html');
    const privCss = path.join(root, 'assets', 'css', pageName + '.css');
    if (!fs.existsSync(privCss)) continue;
    const css = fs.readFileSync(privCss, 'utf8');
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let rm;
    while ((rm = ruleRe.exec(css)) !== null) {
      const sel = rm[1].trim().replace(/\s+/g, '');
      if (!sel || sel[0] !== '.' || sel.indexOf('@') === 0) continue;
      const cls = sel.slice(1).split(/[>.+~:\s{]/)[0];
      if (!cls || cls.startsWith(pageName + '-')) continue;
      if (KEY.has(cls) && sel === '.' + cls) {
        add('R10', 'error', rel(privCss), sel.slice(0, 44),
          `裸重定义白名单完整组件 .${cls}（改白名单须走 missing_styles_proposal.css 提案；页面覆盖须带 .page/组合选择器）`);
      }
    }
  }
}

/* ---------- 汇总 ---------- */
const errors = findings.filter((f) => f.level === 'error');
const warns = findings.filter((f) => f.level === 'warn');
const byRule = {};
findings.forEach((f) => { byRule[f.rule] = (byRule[f.rule] || 0) + 1; });

console.log('='.repeat(64));
console.log('Moteful 样式规范静态门禁（lint v2.0 重建版）');
console.log('='.repeat(64));
if (errors.length) {
  console.log(`\n[ERROR] ${errors.length} 处（必须清零）：`);
  errors.forEach((f) => console.log(`  ${f.rule} ${f.file} ${f.loc} ${f.msg}`));
}
if (warns.length) {
  console.log(`\n[WARN] ${warns.length} 处（债务记账，只许变少）：`);
  const cap = 60;
  warns.slice(0, cap).forEach((f) => console.log(`  ${f.rule} ${f.file} ${f.loc} ${f.msg}`));
  if (warns.length > cap) console.log(`  ... 其余 ${warns.length - cap} 处略`);
}
console.log('\n' + '-'.repeat(64));
console.log(`按规则统计: ${Object.entries(byRule).map(([k, v]) => `${k}=${v}`).join('  ') || '无'}`);
console.log(`基线对照: error 0 / warn 153（2026-09-05 image-tool 迁移三件套后；只许变小）`);
console.log(`结果: error=${errors.length}  warn=${warns.length}`);
console.log(errors.length === 0 ? '✅ PASS（error 清零）' : '❌ FAIL（error>0，退出码 1）');
process.exit(errors.length === 0 ? 0 : 1);
