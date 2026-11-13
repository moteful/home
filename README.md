[🇨🇳 中文](README.zh-CN.md) · [🇺🇸 English](README.md)

# Moteful

A **privacy-first image toolkit** that runs entirely in your browser.
Your images are processed locally and **never leave your device** — no upload, no server, no tracking.

> Status: **v2.1.6** · 25 pages · trilingual (中文 / English / Español)

---

## ✨ Features

- **100% in-browser** — pure client-side processing, privacy by design.
- **Zero build step** — vanilla HTML/CSS/JS, no `node_modules`, no bundler.
- **Trilingual UI** — 中文 / English / Español, switchable at runtime, with no language flash on reload.
- **Consistent design** — enforced by a built-in governance suite (lint + spec assertions + template injection).
- **Share & SEO ready** — share panel with config-preset links / QR codes (v1.4), compare-result cards, social footer row, OG/Twitter/canonical/hreflang/JSON-LD tags (v1.4.4).
- **Icon toolbox (v1.5)** — SVG icon editor: recolor, stroke, scale, rotate/flip, custom color picker, multi-size export & one-click ZIP; tool pages cross-recommend each other.
- **Image tool upgrades (v1.6)** — target-size compression (50KB–1MB, JPG/WebP), clipboard paste import, HEIC import (export as PNG/JPG/WebP), edit panel always visible.
- **ID photo tool (v1.7)** — 12 built-in photo specs (DPI adjustable), crop-composition guide, multi-photo layout, spec-named export (single / ZIP), all local.
- **NEW / HOT tags (v1.7.1)** — solid mini tags across navigation corner badges, menu labels and tool cards; ID photo joins the cross-recommend network with a NEW badge.
- **PNG compression (v1.8)** — in-browser PNG compressor: palette quantization (perceptual weighted + adaptive bit-depth), three presets (Balanced / High / Extreme), lossless pass-through for photos, batch import & ZIP export, download/export triggers in-page recommendations.
- **Icon tool v1.9** — ICO/ICNS import & export: decode BMP/PNG ICO entries and ICNS PNG blocks into the editor, export multi-size container files (ICO 16–256 / ICNS 16–512); system-icon workflow on Windows & macOS.
- **Image cropper v2.0** — original-image processing, free viewfinder, ratio/custom-ratio cropping, even grid splitting, transparent trim, fixed-size output, rotate/flip, batch import and ZIP export.
- **Word counter (v2.0.5)** — in-browser text stats: Chinese characters, English words, characters, paragraphs and lines; draft autosaves and a `.txt` file can be dropped in. Same round fixed mobile layout (labels never split from controls, ≥44px touch targets).
- **Home toolbox refresh (v2.0.6)** — the whole tool card is clickable, and a pre-paint language guard stops the reload flash that briefly showed English before your language.
- **Spanish & trilingual SEO (v2.0.7)** — full Español dictionary (three dictionaries, identical key order), trilingual changelog, localized title/description on all 22 pages, and Open Graph + Twitter share cards on every registered page.
- **Timestamp converter (v2.1.0)** — bidirectional Unix timestamp ↔ date conversion, 52 city timezones with search, DST-aware, custom date-time picker, full keyboard support.
- **UI polish (v2.1.1)** — timestamp input labels aligned with the result panel, JSON tool icon switched to file-braces, support-related icons unified to heart-handshake, shorter cropper menu label.
- **Markdown editor (v2.1.2)** — split edit/preview with headings, bold, italic, strikethrough, underline, lists, alignment, quotes, code, links, images and tables; undo / redo / reset, preview code blocks with language labels plus one-click copy and collapse, and locally saved drafts that restore on reopen.
- **Dark by default (v2.1.3)** — the site opens in dark mode and remembers your toggle; the UI language follows your system language (English when unmatched) and newly added language packs are picked up automatically. NEW badges were retired from the image line.
- **Markdown editor upgrades (v2.1.4)** — an outline panel with click-to-jump, importing `.md` files (up to 1 MB), exporting HTML, and synchronized scrolling between editor and preview.
- **Base64 converter (v2.1.5–v2.1.6)** — text ↔ Base64 in both directions with automatic detection of plain text, Base64, Data URI and JWT; plain Base64 or Data URI output with line wrapping, URL-safe alphabet and padding control; encode files up to 5 MB and decode Base64 back into a download, with paste preview and one-click `img` / CSS snippet copy.
- **Canonical URLs aligned (v2.1.6)** — canonical tags, `og:url`, structured data and the sitemap now point at the extensionless addresses the host actually serves, so search engines stop treating the site's own pages as duplicates.
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
| `tools/png-compressor.html` | PNG compressor (palette quantization / presets / batch export) |
| `tools/crop-tool.html` | Image cropper (free / ratio / grid / transparent trim / fixed size) |
| `tools/annotate.html` | Image annotation |
| `tools/qrcode.html` | QR code generator |
| `tools/icon-tool.html` | Icon tool (SVG edit / ICO / ICNS import & export) |
| `tools/id-photo-tool.html` | ID photo tool (spec crop / layout / export) |
| `dev/json.html` | JSON formatter / minifier / validator |
| `dev/regex.html` | Regex tester (Worker-driven) |
| `dev/word-counter.html` | Word counter (Chinese characters / English words / paragraphs & lines) |
| `dev/timestamp.html` | Timestamp converter (Unix ↔ date / 52 timezones / DST) |
| `dev/markdown.html` | Markdown editor (split preview / formatting toolbar / outline / import & export / draft recovery) |
| `dev/base64.html` | Base64 converter (text ↔ Base64 / Data URI / file encode & decode) |
| `games/block-clear.html` | Block Clear (relaxing puzzle) |
| `games/snake.html` | Snake |
| `games/sudoku.html` | Sudoku |
| `404.html` | Not-found page |

---

## 🛠 Tech stack

- **Frontend:** vanilla HTML + CSS + JavaScript, no framework, no build step.
- **i18n:** `assets/i18n/{zh,en,es}.js` (dictionary-driven, strict 1:1 key-order parity across all three languages) plus `assets/i18n/update/{zh,en,es}.js` for the in-page changelog.
- **Core styles/scripts** (`moteful.css` / `moteful.js` / `template.html`) are **read-only contracts** — see `_governance/CONTRACT.md`.
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
node _governance/inject_site.mjs --check   # drift check across 25 pages (must be 0)
node _governance/lint.mjs                  # style/lint (must have 0 errors)
node _governance/assert_spec.mjs           # spec assertions (requires Playwright)
```

---

## 📁 Project structure

```
moteful/
├── index.html, support.html, 404.html
├── tools/            # image tools (image-tool, stitch, png-compressor, crop-tool, annotate, qrcode, icon-tool, id-photo-tool)
├── dev/              # developer tools (json, regex, word-counter, timestamp, markdown, base64)
├── games/            # mini-games (block-clear, snake, sudoku)
├── legal/            # about / contact / credits / privacy / terms
├── assets/
│   ├── css/          # moteful.css (read-only) + module css (rec- namespace)
│   ├── js/           # moteful.js (read-only) + modules (recommend.js, qrcode-core.js …)
│   └── i18n/         # zh.js / en.js / es.js + update/ (changelog)
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

See `_governance/USER_PROMPT.md` for the full onboarding guide.

---

## ™️ Brand & Support

- Brand: **Moteful** (the repository and core files use `moteful`, e.g. `moteful.css` / `moteful.js`).
- Tip the author: PayPal → `paypal.com/ncp/payment/EMH4YJBBK5L3C`.
- **If you fork this repo, please replace the brand name and point the tip link to your own.**

---

## 📜 License

Released under the **MIT License**. See the [LICENSE](LICENSE) file for the full text.

