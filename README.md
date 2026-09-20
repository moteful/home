[🇨🇳 中文](README.zh-CN.md) · [🇺🇸 English](README.md)

# Moteful

A **zero-dependency, privacy-first image toolkit** that runs entirely in your browser.
Your images are processed locally and **never leave your device** — no upload, no server, no tracking.

> Status: **v1.1.1** · 16 pages · bilingual (中文 / English)

---

## ✨ Features

- **100% in-browser** — pure client-side processing, privacy by design.
- **Zero build step** — vanilla HTML/CSS/JS, no `node_modules`, no bundler.
- **Bilingual UI** — 中文 / English, switchable at runtime.
- **Consistent design** — enforced by a built-in governance suite (lint + spec assertions + template injection).
- **Open by design** — for a privacy tool, the code *is* the trust signal.

---

## 📄 Pages

| Path | Description |
|------|-------------|
| `index.html` | Home / landing |
| `support.html` | Support & FAQ |
| `legal/about.html` | About |
| `legal/contact.html` | Contact |
| `legal/credits.html` | Credits / third-party acknowledgements |
| `legal/privacy.html` | Privacy Policy |
| `legal/terms.html` | Terms of Service |
| `tools/image-tool.html` | Image tool (compress / resize / convert) |
| `tools/stitch.html` | Image stitching (long-image merge) |
| `tools/annotate.html` | Image annotation |
| `games/block-clear.html` | Block Clear (relaxing puzzle) |
| `games/snake.html` | Snake |
| `games/sudoku.html` | Sudoku |
| `404.html` | Not-found page |

> The `dev/` pages are local debugging helpers and are **not published** (excluded via `.gitignore`).

---

## 🛠 Tech stack

- **Frontend:** vanilla HTML + CSS + JavaScript (ES modules), no framework.
- **i18n:** `assets/i18n/{zh,en}.js` (dictionary-driven, strict 1:1 key parity).
- **Core styles/scripts** (`moteful.css` / `moteful.js` / `template.html`) are **read-only contracts** — see `CONTRACT.md`.
- **Governance** (`_governance/`): keeps all pages UI-consistent and self-checking.

---

## 🚀 Local development

Any static file server works. From the repository root:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

### Quality gates (run before committing)

```bash
node _governance/inject_site.mjs --check   # drift check across 16 pages (must be 0)
node _governance/lint.mjs                  # style/lint (must have 0 errors)
node _governance/assert_spec.mjs           # spec assertions (requires Playwright)
```

---

## 📁 Project structure

```
moteful/
├── index.html, support.html, 404.html
├── tools/            # image tools (image-tool, stitch, annotate)
├── games/            # mini-games (block-clear, snake, sudoku)
├── legal/            # about / contact / credits / privacy / terms
├── assets/
│   ├── css/          # moteful.css (read-only) + module css (rec- namespace)
│   ├── js/           # moteful.js (read-only) + modules (recommend.js …)
│   └── i18n/         # zh.js / en.js
├── _governance/      # inject_site.mjs, lint.mjs, assert_spec.mjs, configs
└── template.html     # read-only page skeleton
```

---

## 🤝 Contributing

Contributions are welcome!

Whether it's a bug fix, a new tool, or an improvement to the governance suite:

**New-page checklist (mandatory):** every new page must be registered in **three** places,
otherwise it is silently skipped by the quality gates:

1. `site-config.json` → `pages`
2. `lint.config.json` → page list
3. `spec_rules.csv` → applicable-pages column

See `USER_PROMPT.md` for the full onboarding guide.

---

## ™️ Brand & Support

- Brand: **Moteful** (the repository and core files use `moteful`, e.g. `moteful.css` / `moteful.js`).
- Tip the author: PayPal → `paypal.com/ncp/payment/EMH4YJBBK5L3C`.
- **If you fork this repo, please replace the brand name and point the tip link to your own.**

---

## 📜 License

Released under the **MIT License**. See the [LICENSE](LICENSE) file for the full text.

