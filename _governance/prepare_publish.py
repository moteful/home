#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
prepare_publish.py — 发布前准备（rev1）

作用：
  1. 生成 sitemap.xml（补 robots.txt 声明的网站地图缺口；404.html 是错误页不收录）
  2. 生成干净的发布目录 publish/（只含运行文件，剔除 _governance/.git/_pwtest/
     母版 template.html/备份 *.bak/已弃用 favicon.svg 等内部文件）
  3. 输出纯净度校验（内部目录残留数、_governance 引用数）

用法（在 moteful 根目录执行）：
  python _governance/prepare_publish.py

说明：
  - 页面清单取自 _governance/site-config.json 的 pages（与 inject 下发范围一致）
  - publish/ 由本脚本生成，已加入 .gitignore，不入库
  - Cloudflare Pages 后台「直接上传」时，拖 publish/ 这个文件夹即可
"""
import os
import json
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # moteful 根
cfg = json.load(open(os.path.join(ROOT, '_governance', 'site-config.json'), encoding='utf-8'))
pages = cfg['pages']
BASE = 'https://moteful.app'
TODAY = '2026-10-01'  # 发版日（v1.5.1），与 sitemap lastmod 保持一致

# ---------- 1) sitemap.xml ----------
sm = [p for p in pages if p != '404.html']


def loc(p):
    return BASE + '/' if p == 'index.html' else BASE + '/' + p


L = ['<?xml version="1.0" encoding="UTF-8"?>',
     '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
for p in sm:
    L += ['  <url>',
          '    <loc>%s</loc>' % loc(p),
          '    <lastmod>%s</lastmod>' % TODAY,
          '    <changefreq>weekly</changefreq>',
          '    <priority>%s</priority>' % ('1.0' if p == 'index.html' else '0.8'),
          '  </url>']
L.append('</urlset>')
open(os.path.join(ROOT, 'sitemap.xml'), 'w', encoding='utf-8').write('\n'.join(L) + '\n')
print('sitemap.xml: %d 个 URL（不含 404.html）' % len(sm))

# ---------- 2) publish/ 干净发布目录 ----------
pub = os.path.join(ROOT, 'publish')
if os.path.isdir(pub):
    shutil.rmtree(pub)
os.makedirs(pub)

# 复制 16 个页面（pages 列表，含 404.html 作为线上错误页；template.html 不在 pages 内故不复制）
for p in pages:
    s = os.path.join(ROOT, p.replace('/', os.sep))
    d = os.path.join(pub, p.replace('/', os.sep))
    os.makedirs(os.path.dirname(d), exist_ok=True)
    shutil.copy2(s, d)

# 复制 assets（排除备份 *.bak）
def ignore(src, names):
    return [n for n in names if n.endswith('.bak') or n == '.git']


shutil.copytree(os.path.join(ROOT, 'assets'), os.path.join(pub, 'assets'), ignore=ignore)

# 复制页面同级的资源目录（如 games/assets/ 方块贴图——漏拷会让游戏退回纯色方块）
for d in ['games/assets', 'tools/assets', 'dev/assets', 'legal/assets']:
    s = os.path.join(ROOT, d.replace('/', os.sep))
    if os.path.isdir(s):
        shutil.copytree(s, os.path.join(pub, d.replace('/', os.sep)), ignore=ignore)
        print('publish/%s: 已复制（%d 个文件）' % (d, sum(len(fn) for _, _, fn in os.walk(os.path.join(pub, d)))))

# 复制根目录运行文件
for f in ['favicon.png', 'favicon.ico', 'robots.txt', 'sitemap.xml']:
    shutil.copy2(os.path.join(ROOT, f), os.path.join(pub, f))

print('publish/: %d 个文件' % sum(len(fn) for _, _, fn in os.walk(pub)))

# ---------- 3) 资源完整性检查（HTML 引用 + JS 内相对路径引用必须都在发布包内） ----------
import re

# 发布包内所有"页面目录"（JS 里的相对路径按 HTML 文档解析，不是按 JS 文件位置）
page_dirs = {dp for dp, _, fn in os.walk(pub) if any(f.endswith('.html') for f in fn)}

missing = set()
for dp, _, fn in os.walk(pub):
    for f in fn:
        if not f.endswith(('.html', '.js')):
            continue
        fp = os.path.join(dp, f)
        for i, ln in enumerate(open(fp, encoding='utf-8', errors='ignore'), 1):
            if f.endswith('.js'):
                ln = ln.split('//')[0]  # 只检查 // 注释前的有效代码
            st = ln.strip()
            if f.endswith('.js') and (st.startswith('//') or st.startswith('/*') or st.startswith('*')):
                continue  # 跳过纯注释行（如 skins 的示例写法）
            pats = [r'(?:href|src)="([^"]+)"'] if f.endswith('.html') else \
                   [r'''['"]((?:\.\./)?[^'"]+?\.(?:png|jpg|jpeg|gif|svg|webp|ico|mp3|ogg|wav|json))['"]''']
            for pat in pats:
                for ref in re.findall(pat, ln):
                    if ref.startswith(('http', 'data:', '#', 'mailto:', 'javascript:')):
                        continue
                    if not os.path.splitext(ref)[1] or ' ' in ref:
                        continue  # 目录引用（如 href="/"）或含空格的界面文案，不查
                    cand = os.path.normpath(os.path.join(dp, *ref.split('/')))
                    if f.endswith('.js'):
                        ok = any(os.path.isfile(os.path.join(pd, *ref.split('/'))) for pd in page_dirs) \
                             or os.path.isfile(cand)
                    else:
                        ok = os.path.isfile(cand)
                    if not ok:
                        missing.add('%s L%d 引用 %s' % (os.path.relpath(fp, pub), i, ref))
print('资源完整性:', ('缺失 %d 项 ✗' % len(missing)) if missing else '全部命中 ✅')
for m in sorted(missing):
    print('   ✗', m)

# ---------- 4) 纯净度校验 ----------
bad = [d for dp, dn, _ in os.walk(pub) for d in dn
       if d in ('_governance', '.git', '_pwtest')]
ref = sum(1 for dp, _, fn in os.walk(pub) for f in fn
          if f.endswith('.html')
          and '_governance' in open(os.path.join(dp, f), encoding='utf-8', errors='ignore').read())
print('内部目录残留:', bad if bad else '无 ✅')
print('_governance 引用:', ('%d 处' % ref) if ref else '0 ✅')
