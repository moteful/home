[🇨🇳 中文](README.zh-CN.md) · [🇺🇸 English](README.md)

# Moteful

一个**隐私优先的图片工具站**，完全运行在你的浏览器里。
图片在本地处理，**永远不会离开你的设备**——不上传、无服务器、无跟踪。

> 状态：**v2.1.1** · 23 个页面 · 三语（中文 / English / Español）

---

## ✨ 功能特性

- **100% 浏览器内运行**——纯客户端处理，隐私内建于设计。
- **零构建步骤**——原生 HTML/CSS/JS，无 `node_modules`、无打包器。
- **三语界面**——中文 / English / Español，运行时可切换，刷新不再闪英文。
- **一致的设计**——由内置治理套件强制保障（lint + 规范断言 + 模板注入）。
- **分享与 SEO 就绪**——分享面板（带配置链接 / 二维码，v1.4）、成果对比卡片、页脚社交行、OG/Twitter/canonical/hreflang/JSON-LD 标签（v1.4.4）。
- **图标工具箱（v1.5）**——SVG 图标编辑：改色、描边、缩放、旋转翻转、自定义色板，多尺寸导出与一键 ZIP；工具页之间互相推荐。
- **图片工具升级（v1.6）**——目标大小压缩（50KB–1MB，JPG/WebP）、剪贴板粘贴导入、HEIC 导入（导出为 PNG/JPG/WebP）、编辑区常显。
- **证件照工具（v1.7）**——内置 12 种规格（DPI 可调）、裁剪构图、多张排版、按规格命名导出（单张 / ZIP），全部本地处理。
- **NEW / HOT 标签（v1.7.1）**——导航角标、菜单标签、工具卡片的实心迷你标签；证件照加入站内互推网络并带 NEW 标识。
- **PNG 压缩（v1.8）**——浏览器内 PNG 压缩：感知加权调色板量化 + 位深自适应，均衡 / 高质量 / 极限三档预设，照片类无损直通，批量导入与 ZIP 导出，下载/导出后弹站内推荐。
- **图标工具二期（v1.9）**——ICO/ICNS 导入导出：解码 BMP/PNG 条目 ICO 与 ICNS PNG 块进编辑链，导出多尺寸容器文件（ICO 16–256 / ICNS 16–512）；打通 Windows / macOS 系统图标工作流。
- **图片裁切工具（v2.0）**——原图处理、自由取景、比例/自定义比例裁剪、网格等分切图、去透明像素、指定尺寸输出；支持旋转翻转、批量导入与 ZIP 导出。
- **字数统计工具（v2.0.5）**——浏览器内统计汉字数、英文词数、字符与段落行数；草稿自动保存，可直接拖入 txt 文件计数；同轮完成移动端排版修复（标签与控件不拆行、点按热区 ≥44px）。
- **首页工具箱改版（v2.0.6）**——工具卡整卡可点直达；新增首帧语种防闪（head 预置脚本全站下发）。
- **西班牙语与三语 SEO（v2.0.7）**——完整 Español 语言包（三套字典键序严格一致）、更新日志三语、22 页标题与描述随语种切换、全站注册页补齐 Open Graph / Twitter 分享卡片。
- **时间戳转换工具（v2.1.0）**——Unix 时间戳与日期双向换算、52 个城市时区带搜索、夏令时感知、自定义日期时间选择器、全键盘操作。
- **界面细节优化（v2.1.1）**——时间戳页小标题与结果区内文对齐、JSON 工具图标换 file-braces、支持类图标统一 heart-handshake、导航「裁切工具」简化为「裁切」并同步首页卡片。
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
| `tools/png-compressor.html` | PNG 压缩（调色板量化 / 三档预设 / 批量导出） |
| `tools/crop-tool.html` | 图片裁切（自由 / 比例 / 网格 / 去透明 / 指定尺寸） |
| `tools/annotate.html` | 图片标注 |
| `tools/qrcode.html` | 二维码生成器 |
| `tools/icon-tool.html` | 图标工具（SVG 编辑 / ICO / ICNS 导入导出） |
| `tools/id-photo-tool.html` | 证件照工具（规格裁剪 / 排版 / 导出） |
| `dev/json.html` | JSON 格式化 / 压缩 / 校验 |
| `dev/regex.html` | 正则测试（Worker 驱动） |
| `dev/word-counter.html` | 字数统计（汉字 / 英文词 / 字符 / 段落行数） |
| `dev/timestamp.html` | 时间戳转换（Unix ↔ 日期 / 52 时区 / 夏令时） |
| `games/block-clear.html` | 方块消除（休闲解谜） |
| `games/snake.html` | 贪吃蛇 |
| `games/sudoku.html` | 数独 |
| `404.html` | 未找到页面 |

---

## 🛠 技术栈

- **前端**：原生 HTML + CSS + JavaScript，无框架、无构建步骤。
- **国际化**：`assets/i18n/{zh,en,es}.js`（字典驱动，中 / 英 / 西三套字典键序严格 1:1 对齐）；站内更新日志见 `assets/i18n/update/{zh,en,es}.js`。
- **核心样式/脚本**（`moteful.css` / `moteful.js` / `template.html`）是**只读契约**——详见 `_governance/CONTRACT.md`。
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
node _governance/inject_site.mjs --check   # 23 页漂移检查（必须为 0）
node _governance/lint.mjs                  # 样式/lint（错误数必须为 0）
node _governance/assert_spec.mjs           # 规范断言（需要 Playwright）
```

---

## 📁 项目结构

```
moteful/
├── index.html, support.html, 404.html
├── tools/            # 图片工具（image-tool、stitch、png-compressor、crop-tool、annotate、qrcode、icon-tool、id-photo-tool）
├── dev/              # 开发者工具（json、regex、word-counter、timestamp）
├── games/            # 小游戏（block-clear、snake、sudoku）
├── legal/            # about / contact / credits / privacy / terms
├── assets/
│   ├── css/          # moteful.css（只读）+ 模块 css（rec- 命名空间）
│   ├── js/           # moteful.js（只读）+ 模块（recommend.js、qrcode-core.js …）
│   └── i18n/         # zh.js / en.js / es.js + update/（更新日志）
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

完整的上手指南见 `_governance/USER_PROMPT.md`。

---

## ™️ 品牌与支持

- 品牌名：**Moteful**（仓库与核心文件使用 `moteful`，例如 `moteful.css` / `moteful.js`）。
- 请作者喝咖啡：PayPal → `paypal.com/ncp/payment/EMH4YJBBK5L3C`。
- **如果你 fork 本仓库，请替换品牌名，并把打赏链接改成你自己的。**

---

## 📜 许可证

基于 **MIT 许可证**发布。完整文本见 [LICENSE](LICENSE) 文件。

