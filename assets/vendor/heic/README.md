# HEIC 解码库（本地化 vendor）

## 文件
- `heic2any.min.js` — heic2any v0.0.4（libheif wasm 以 base64 内嵌于单文件，无需外部 .wasm 请求）

## 来源与许可证
- 项目：heic2any — https://github.com/alexcorvi/heic2any
- 许可证：**MIT**（heic2any 封装层）
- 底层解码器：**libheif**（LGPL-3.0，wasm 编译内嵌）— https://github.com/strukturag/libheif
- 下载源：https://unpkg.com/heic2any@0.0.4/dist/heic2any.min.js （2026-10-01 获取，校验：含 libheif/wasm 特征，1,351,840 bytes）

## 使用约定（Moteful 铁律）
1. **仅作输入格式**：HEIC 只允许导入，导出出口限 JPG/PNG/WebP；导入即提示"不支持导出 HEIC"。
2. **懒加载**：页面检测到 HEIC 文件才动态注入本脚本；无 HEIC 时首屏零请求（加载效率铁律）。
3. 许可证文本随仓库公开（LICENSE 文件），不得引入闭源变体。

## 性能
- 文件约 1.35MB（含内嵌 wasm），仅在需要时加载；解码走 `heic2any()`（Blob → PNG Blob 中间态）。
