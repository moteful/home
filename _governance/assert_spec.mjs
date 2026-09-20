#!/usr/bin/env node
/**
 * Moteful 规范运行时断言 assert_spec.mjs（治理 v2.0 重建版 2026-09-05）
 * 读取 spec_rules.csv，用 Playwright(chromium) 逐页逐条 getComputedStyle 实测比对。
 * 铁律：断言前必须冻结动效（addStyleTag 关 transition/animation），防读到过渡中间值。
 * 判定：must 级失败 → 退出码 1；should 级失败只记账；元素缺失按「未命中」列 skip/fail。
 * 运行（依赖 WebTool/_pwtest 的 playwright）：
 *   NODE_PATH=<root>/_pwtest/node_modules node assert_spec.mjs
 */
'use strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const here = __dirname;
const root = path.resolve(here, '..');
const csvPath = path.join(here, 'spec_rules.csv');

/* ---------- CSV 解析（支持引号包裹、"" 转义逗号） ---------- */
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 去 BOM
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.filter((r) => r.length >= header.length && r[0].trim())
    .map((r) => {
      const o = {};
      header.forEach((h, i) => { o[h.trim()] = (r[i] || '').trim(); });
      return o;
    });
}

const rules = parseCsv(fs.readFileSync(csvPath, 'utf8'));

/* ---------- 按页分组 ---------- */
const byPage = new Map();
for (const r of rules) {
  for (const page of r['适用页面'].split('|')) {
    if (!byPage.has(page)) byPage.set(page, []);
    byPage.get(page).push(r);
  }
}

(async () => {
  // 定位 playwright：优先 WebTool/_pwtest/node_modules（ESM 不认 NODE_PATH，须显式解析）
  let playwright = null;
  const candidates = [
    path.resolve(root, '..', '_pwtest', 'node_modules'),
    path.resolve(root, '_pwtest', 'node_modules'),
  ];
  for (const dir of candidates) {
    try {
      const req = createRequire(path.join(dir, '_probe.js'));
      playwright = req('playwright');
      break;
    } catch (_) { /* 试下一个 */ }
  }
  if (!playwright) {
    try { playwright = createRequire(import.meta.url)('playwright'); }
    catch (e) {
      console.error('❌ 找不到 playwright。请确认 WebTool/_pwtest/node_modules 存在。');
      process.exit(2);
    }
  }
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  // 注意：addStyleTag 的 content 必须是纯 CSS（不能再包 <style> 标签，否则整条规则失效、冻结落空）
  const FREEZE = `*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}`;

  let pass = 0, fail = 0, skip = 0;
  const mustFails = [], shouldFails = [];

  for (const [pageFile, pageRules] of byPage) {
    const url = 'file:///' + path.join(root, pageFile).replace(/\\/g, '/');
    let ok = true;
    try { await page.goto(url, { waitUntil: 'load', timeout: 15000 }); }
    catch (e) {
      console.log(`\n[页面] ${pageFile} —— 加载失败：${e.message.split('\n')[0]}`);
      fail += pageRules.length;
      pageRules.forEach((r) => (r['级别'] === 'must' ? mustFails : shouldFails).push(`${pageFile} ${r['规则ID']}(页面加载失败)`));
      continue;
    }
    await page.addStyleTag({ content: FREEZE });
    await page.waitForTimeout(120);

    console.log(`\n[页面] ${pageFile}（${pageRules.length} 条）`);
    for (const r of pageRules) {
      const id = r['规则ID'], lv = r['级别'], desc = r['说明'];
      // 前置动作
      if (r['前置动作'] && r['前置动作'] !== 'none') {
        const pm = r['前置动作'].match(/^theme:(light|dark)$/);
        if (pm) {
          await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, pm[1]);
          await page.waitForTimeout(60);
        }
      }
      let result;
      if (r['选择器'] === '-') {
        // js 规则约定：表达式在「属性」列，比较目标在「期望值」列（字符串比较）
        const expr = r['属性'];
        const target = r['期望值'];
        try {
          const val = await page.evaluate(`(${expr})`);
          const got = String(val);
          result = got === target ? 'pass' : 'fail';
          if (result === 'fail') console.log(`  ${lv === 'must' ? '✗' : '!'} ${id} 期望 ${target} 实得 ${got} —— ${desc}`);
        } catch (e) {
          result = 'fail';
          console.log(`  ${lv === 'must' ? '✗' : '!'} ${id} 表达式执行异常：${String(e.message).split('\n')[0]} —— ${desc}`);
        }
      } else {
        const el = await page.$(r['选择器']);
        if (!el) {
          result = r['未命中'] === 'skip' ? 'skip' : 'fail';
          if (result === 'skip') { skip++; console.log(`  - ${id} 元素缺失跳过（${r['选择器']}）`); }
          else console.log(`  ${lv === 'must' ? '✗' : '!'} ${id} 元素缺失且未命中=fail —— ${desc}`);
        } else {
          const got = await el.evaluate((e, prop) => getComputedStyle(e)[prop], r['属性']);
          const want = r['期望值'];
          result = got === want ? 'pass' : 'fail';
          if (result === 'fail') console.log(`  ${lv === 'must' ? '✗' : '!'} ${id} ${r['选择器']}.${r['属性']} 期望 ${want} 实得 ${got} —— ${desc}`);
        }
      }
      if (result === 'pass') pass++;
      else if (result === 'skip') skip++;
      else { fail++; (lv === 'must' ? mustFails : shouldFails).push(`${pageFile} ${id}`); }
    }
    void ok;
  }

  await browser.close();
  console.log('\n' + '='.repeat(64));
  console.log(`运行时断言结果：共 ${pass + fail + skip} 条 → 通过 ${pass} / 跳过 ${skip} / 失败 ${fail}`);
  console.log(`  must 失败：${mustFails.length}${mustFails.length ? ' → ' + mustFails.join('；') : ''}`);
  console.log(`  should 失败：${shouldFails.length}${shouldFails.length ? ' → ' + shouldFails.join('；') : ''}`);
  console.log(mustFails.length === 0 ? '✅ PASS（must 清零）' : '❌ FAIL（must>0，退出码 1）');
  process.exit(mustFails.length === 0 ? 0 : 1);
})();
