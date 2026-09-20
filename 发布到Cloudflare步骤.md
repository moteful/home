# Moteful 上传到 Cloudflare Pages 步骤（大白话版）

> 你的站是纯前端（只有网页+样式+脚本，不需要服务器），用 Cloudflare Pages 最合适。
> 域名 `moteful.app` 已绑 Cloudflare，所以上线后绑定自定义域名几乎是自动的。

## 一、已经帮你做好的事

- **干净发布目录**：`D:\AI\WorkBuddyfile\Claw\OPC\WebTool\moteful\publish`
  - 里面只有运行要用的文件（16 个网页 + 样式 + 脚本 + 图标 + robots.txt + sitemap.xml）
  - **不含**内部治理脚本（`_governance`）、`.git`、测试目录、母版文件、备份文件
- **sitemap.xml 已生成**：告诉搜索引擎你的站点有哪些页面（robots.txt 里声明过，之前缺失）

## 二、上传步骤（在 Cloudflare 网站点几下）

### 第 1 步｜进后台
1. 浏览器打开 `dash.cloudflare.com` ，登录你的 Cloudflare 账号
2. 左侧菜单点 **「Workers 和 Pages」**（英文界面叫 Workers & Pages）

### 第 2 步｜建 Pages 项目并上传
1. 点右上角 **「创建」(Create)** → 选 **「Pages」**
2. 上传方式选 **「直接上传」(Direct Upload)** —— 不是连 Git 那种
3. 项目名称填 `moteful`（随便起，比如 moteful-site 也行）
4. 点「创建项目」后会出现选文件夹的框 —— **把 `moteful\publish` 这个文件夹拖进去**（或点「选择文件夹」选中它）
   - ⚠️ 是拖 `publish` 这一个文件夹，不是整个 `moteful` 文件夹（整个会暴露内部文件）
5. 上传完成后点 **「部署」(Deploy)**

### 第 3 步｜绑定你的域名 moteful.app
1. 部署成功后，进入这个项目 → 点 **「自定义域」(Custom domains)**
2. 输入 `moteful.app` ，点「继续 / 添加」
3. Cloudflare 会**自动**在你的 DNS 里加一条 CNAME 记录（因为域名已在 Cloudflare，不用你手动加）
4. 建议同样再加一个 `www.moteful.app`（让带 www 的网址也能打开）
5. 等状态变成 **「活跃」(Active)** —— DNS 生效通常要几分钟到几小时，不是立刻就能开

### 第 4 步｜设置 404 页面（建议做）
- 项目「设置」里找「自定义错误页面」，指向 `404.html`（你的发布目录里已经有这个文件）

## 三、验证上线成功

- 浏览器访问 `https://moteful.app` → 应看到站点首页
- 看浏览器标签页最左边 → 应是**蓝色三角标**（不是问号）
- 访问 `https://moteful.app/tools/image-tool.html` 等子页面也应正常

## 四、以后改了代码怎么重新上传

1. 告诉我「重新打包发布」，我会跑发布准备脚本更新 `publish` 目录
2. 你回到 Cloudflare → 这个项目 → 「部署」→ 重新上传 `publish` 文件夹
3. Cloudflare 会覆盖旧版本（也可以开「自动部署」，但当前是手动上传方式）

## 五、常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 打开 moteful.app 显示「站点未配置」 | DNS 还没生效 | 等几分钟到几小时再试 |
| 标签页还是问号 | 浏览器图标缓存顽固 | 关掉整个浏览器重开，或按 Ctrl+F5 强刷 |
| 页面样式缺一块 | 上传了整个 moteful 而非 publish | 重新上传 `publish` 文件夹 |
| 子页面 404 | 路径问题 | 确认上传的是 publish 整文件夹，index.html 在根 |

## 六、重要提醒

- **上传的是 `publish` 文件夹，不是整个 `moteful` 文件夹**
- 第一次访问要等 DNS 生效（几分钟到几小时），不是马上就能开
- 不要手改 `publish` 里的文件，要改就在 `moteful` 源里改，然后让我重新打包
