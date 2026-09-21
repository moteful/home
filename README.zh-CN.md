[🇨🇳 中文](README.zh-CN.md) · [🇺🇸 English](README.md)

# Moteful

一个**零依赖、隐私优先的图片工具站**，完全运行在你的浏览器里。
图片在本地处理，**永远不会离开你的设备**——不上传、无服务器、无跟踪。

> 状态：**v1.2.5** · 17 个页面 · 双语（中文 / English）

---

## ✨ 功能特性

- **100% 浏览器内运行**——纯客户端处理，隐私内建于设计。
- **零构建步骤**——原生 HTML/CSS/JS，无 `node_modules`、无打包器。
- **双语界面**——中文 / English，运行时可切换。
- **一致的设计**——由内置治理套件强制保障（lint + 规范断言 + 模板注入）。
- **设计即开放**——对隐私工具而言，代码本身就是信任信号。

---

## 📄 页面

| 路径 | 说明 |
|------|------|
| `index.html` | 首页 / 落地页 |
| `support.html` | 支持与常见问题 |
| `legal/about.html` | 关于 |
| `legal/contact.html` | 联系我们 |
| `legal/credits.html` | 致谢 / 第三方声明 |
| `legal/privacy.html` | 隐私政策 |
| `legal/terms.html` | 服务条款 |
| `tools/image-tool.html` | 图片工具（压缩 / 调整尺寸 / 格式转换） |
| `tools/stitch.html` | 图片拼接（长图合并） |
| `tools/annotate.html` | 图片标注 |
| `tools/qrcode.html` | 二维码生成器 |
| `dev/json.html` | JSON 格式化 / 压缩 / 校验 |
| `dev/regex.html` | 正则测试（Worker 驱动） |
| `games/block-clear.html` | 方块消除（休闲解谜） |
| `games/snake.html` | 贪吃蛇 |
| `games/sudoku.html` | 数独 |
| `404.html` | 未找到页面 |

---

## 🛠 技术栈

- **前端**：原生 HTML + CSS + JavaScript（ES 模块），无框架。
- **国际化**：`assets/i18n/{zh,en}.js`（字典驱动，中英文键严格 1:1 对齐）。
- **核心样式/脚本**（`moteful.css` / `moteful.js` / `template.html`）是**只读契约**——详见 `CONTRACT.md`。
- **治理套件**（`_governance/`）：保证所有页面 UI 一致且可自检。

---

## 🚀 本地开发

任意静态文件服务器均可。在仓库根目录执行：

```bash
python3 -m http.server 8000
# 然后打开 http://localhost:8000
```

### 质量门禁（提交前运行）

```bash
node _governance/inject_site.mjs --check   # 16 页漂移检查（必须为 0）
node _governance/lint.mjs                  # 样式/lint（错误数必须为 0）
node _governance/assert_spec.mjs           # 规范断言（需要 Playwright）
```

---

## 📁 项目结构

```
moteful/
├── index.html, support.html, 404.html
├── tools/            # 图片工具（image-tool、stitch、annotate、qrcode）
├── dev/              # 开发者工具（json、regex）
├── games/            # 小游戏（block-clear、snake、sudoku）
├── legal/            # about / contact / credits / privacy / terms
├── assets/
│   ├── css/          # moteful.css（只读）+ 模块 css（rec- 命名空间）
│   ├── js/           # moteful.js（只读）+ 模块（recommend.js、qrcode-core.js …）
│   └── i18n/         # zh.js / en.js
├── _governance/      # inject_site.mjs、lint.mjs、assert_spec.mjs、配置
└── template.html     # 只读页面骨架
```

---

## 🤝 贡献

欢迎参与贡献！

无论是修复 bug、新增工具，还是改进治理套件，都欢迎：

**新页面清单（强制）**：每个新页面必须在**三处**登记，否则会被质量门禁静默跳过：

1. `site-config.json` → `pages`
2. `lint.config.json` → 页面列表
3. `spec_rules.csv` → 适用页面列

完整的上手指南见 `USER_PROMPT.md`。

---

## ™️ 品牌与支持

- 品牌名：**Moteful**（仓库与核心文件使用 `moteful`，例如 `moteful.css` / `moteful.js`）。
- 请作者喝咖啡：PayPal → `paypal.com/ncp/payment/EMH4YJBBK5L3C`。
- **如果你 fork 本仓库，请替换品牌名，并把打赏链接改成你自己的。**

---

## 📜 许可证

基于 **MIT 许可证**发布。完整文本见 [LICENSE](LICENSE) 文件。

