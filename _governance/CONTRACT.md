# Moteful 样式治理契约（给 AI 执行者）

版本：治理 v2.0 重建版 · 2026-09-05
适用仓库：`moteful/`（rev6.1 设计规范体系）

## 一、唯一事实源（改任何 UI 前先读）

| 文件 | 角色 | 权限 |
|------|------|------|
| `assets/css/moteful.css` | 样式唯一事实源 | 页面**只许引用**；改它须经用户批准并走本契约检查 |
| `assets/js/moteful.js` | 行为唯一事实源（主题/语种/抽屉/图标渲染自动绑定） | 页面**只许引用**，禁止重写行为 |
| `template.html` | 页面外壳模板（topbar/抽屉/footer） | 新页/重构页必须套用 |
| `_governance/lint.config.json` | 门禁配置（页面清单、规范数值） | 新规范**只改这里和 spec_rules.csv** |
| `_governance/spec_rules.csv` | 可测试规范条目表（110 条） | 新规范**只改这里和 lint.config.json** |
| `_governance/lint.mjs` / `assert_spec.mjs` | 门禁引擎 | **严禁修改**——新规范永不改引擎 |

## 二、硬性铁律

1. **两态主题**：只有 `light`/`dark`；`data-theme="system"` 已退役，出现即违规（页面、CSS、JS 均不许复活三态）。
2. **零外部请求**：字体/图标/库全部本地；`data-lucide` 图标由 moteful.js 内置库渲染，缺图标走"缺失清单"流程，不许引 CDN。
3. **纯相对路径**：根级页 `assets/…`，子目录页 `../assets/…`；禁止 `href="/"`。
4. **令牌优先**：颜色/圆角/字号/间距/动效一律用 CSS 变量（`--surface`、`--r-sm`…），禁止新写硬编码色值。
5. **字号阶梯**：只用 12/13/14/15/22/32px；**圆角四档**：6/10/16/999（50% 用于圆形）；**间距 4 的倍数**；动效只动 transform+opacity。
6. **新架构页禁内联 `<style>` 块**；小布局内联属性（如外壳 logo 尺寸）属债务，只许变少不许新增。
7. **i18n**：文案走 `assets/i18n/{en,zh}.js` 键，页面用 `data-i18n/-title/-aria` 三属性挂钩。

## 三、改动后必做（不绿不许报完成）

1. 双击或执行 `_governance/一键检查样式规范.bat`（或分别跑 `node inject_site.mjs --check`、`node lint.mjs`、`node assert_spec.mjs`）。
2. **贴出三关报告原文**：下发一致性须 0 漂移；静态门禁须 `error=0`；运行时断言须 `must 失败 0`。
3. warn 基线只许变小不许变大（当前基线：**error 0 / warn 190**，2026-09-16 复核：games/snake、games/sudoku 补入 newArchPages，dev/json、dev/regex 补入 legacyPages，404.html 补入 newArchPages 与 spec_rules.csv）。
4. 改完**立即 git 提交**（普通 commit；**严禁 `git merge`**，同步 main 用 `git branch -f main dev`）。
5. 运行时断言已内置动效冻结；**新增页面必须同时登记三处**：`lint.config.json`（newArchPages 或 legacyPages）、`spec_rules.csv` 的适用页面列、`site-config.json` 的 `pages`。**漏登记 = 该页免检**。

## 四、重构四步法（旧页迁移标准流程）

1. **外壳替换**：`<head>` 引三件套 + 两态主题预置；header/footer/抽屉照抄 template.html（id 对齐，如 `drawerNav`）；删旧内联 `<style>`、SVG sprite、内联主题脚本、三态残留。
2. **样式映射**：正文只用 moteful.css 白名单 class（`.page/.panel/.sec-title/.muted/.tool-card/.tag/.divider/.stack/.row/.footer*`…）；缺失样式**注释标出**，不擅自造。
3. **交互接管**：主题/语种/抽屉/图标全交 moteful.js 自动绑定，删全部内联脚本。
4. **文本与翻译**：保留原文案；i18n 缺键先补 `assets/i18n/` 两语言文件。
