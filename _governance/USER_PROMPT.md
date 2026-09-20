# Moteful 样式治理 · 用户操作手册（给人用）

版本：治理 v2.0 重建版 · 2026-09-05

## 这套东西是干什么的

用**机器**而不是靠 AI 自觉来守住设计规范。五层防御：

1. **下发一致性** `inject_site.mjs --check`：页面导航/页脚/抽屉有没有被绕过配置手改（16 页逐项比对）。
2. **静态门禁** `lint.mjs`：扫所有页面和 moteful.css，抓硬编码色、违规字号/圆角/间距、三态复活、内联样式块。
3. **运行时断言** `assert_spec.mjs`：真实打开浏览器逐页实测 400+ 条规范（读 `spec_rules.csv`），比肉眼看截图可靠。
4. **规范条目表** `spec_rules.csv`：每条规范一行（页面/选择器/期望值/级别），**规范内容都在这张表里**。
5. **契约** `CONTRACT.md`：给 AI 的硬规矩，开工前让 AI 先读。

## 您只需要记三件事

**① 每次改完样式，双击 `一键检查样式规范.bat`**
看到**三行**都是 **PASS** 才算完（1 下发一致性 / 2 静态规范 / 3 运行时断言）；出现 FAIL 把窗口内容发给 AI 修。

**② 新增/调整规范，只改两个文件（别动引擎）**
- `_governance/lint.config.json`（页面清单、字号阶梯这类数值）
- `_governance/spec_rules.csv`（加一行 = 加一条可检查的规范）

**③ AI 说"做完了"但没贴检查报告 = 没做完**
直接回它："跑一键检查并贴报告，不绿不许报完成。"

## 文件都在哪

```
moteful/_governance/
  一键检查样式规范.bat   ← 双击运行
  inject_site.mjs        ← 导航/页脚/抽屉下发与校验（勿改）
  site-config.json       ← 站点配置唯一源：品牌/版本/页面登记/导航高亮（可改）
  lint.mjs               ← 静态门禁引擎（勿改）
  assert_spec.mjs        ← 运行时断言引擎（勿改）
  lint.config.json       ← 门禁配置：页面分区/规范数值（可改）
  spec_rules.csv         ← 规范条目表（可改）
  CONTRACT.md            ← 给 AI 的契约
```

## 顺手提给 AI 的开工提示词（可直接粘贴）

> 请先读 moteful/_governance/CONTRACT.md 和 spec_rules.csv，再开始改样式。改完必须运行 _governance/一键检查样式规范.bat 并把三关报告原文贴给我：下发一致性 0 漂移、静态门禁 error=0、运行时断言 must 失败 0 才算完成，warn 只许变少。改完立即 git 提交（禁止 git merge）。

## 当前基线（2026-09-16 复核）

- 下发一致性：16 页与配置/模板 0 漂移
- 静态门禁：error 0 / warn 190（债务记账：moteful.css 组件区旧值、各页内联 style 属性、dev 两页内联样式块）
- 运行时断言：465 条 → 通过 375 / 跳过 90 / 失败 0（含 games/snake、games/sudoku 的导航断言；404.html 已纳入 28 条规则覆盖）
