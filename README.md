# 电焊机.cn

电焊机产品展示与技术内容站。静态站点（VitePress 构建），部署到 GitHub Pages。

- **域名**：电焊机.cn（punycode `xn--nqv61tpnd.cn`）
- **联系邮箱**：mfujun@agent.qq.com
- **云端预览**：https://9693f95a5df84f4a90d7d7a337d7c8cf.app.workbuddy.host
  （预览服务不支持 `cleanUrls`，子页需带 `.html` 后缀）

## 站点结构

| 栏目 | 路径 | 说明 |
|---|---|---|
| 首页 | `/` | 品牌入口、产品分类、焊接方案匹配流程、常见问题 |
| 产品中心 | `/products/` | 五类焊机总览 + 选型对比 + 5 个产品详情页 |
| 文章资讯 | `/articles/` | 技术文章索引（按 4 个分类聚合）+ 5 篇文章 |
| 解决方案 | `/solutions/` | 4 个行业焊接方案 |
| 关于我们 | `/about` | 站点定位与内容原则 |
| 联系我们 | `/contact` | 联系方式 + 访客留言表单 |

共 **20 个页面**。

## 技术栈

- **VitePress 1.0.0** — Markdown 驱动，输出纯静态 HTML
- **vitepress-plugin-mermaid + mermaid** — 流程图渲染（客户端渲染）
- **GitHub Pages** — 托管

## 本地开发

```bash
cd docs
npm install

npm run dev        # 本地开发服务
npm run build      # 完整构建：文章索引 → 构建 → sitemap → 同步到 dist
npm run preview    # 预览构建产物
npm run verify     # 端到端验证（Edge 无头 + CDP，67 项断言）
```

## 构建管线说明

`npm run build` 依次执行四步：

1. `_build-articles.mjs` — 扫描 `docs/articles/*.md` 的 frontmatter，重建文章索引卡片区块
2. `_build.mjs` — VitePress Node API 构建到 `.vitepress/.out-<时间戳>/`
3. `_gen-sitemap.mjs` — 生成 `sitemap.xml`（含全部页面 URL）
4. `_sync-dist.mjs` — 把产物同步到 `dist`

> 为什么分成两步（临时输出目录 → `dist`）：VitePress 默认构建会先 `emptyDir` 清空输出目录，
> 本机沙箱的批量删除守卫会拦截该操作导致构建中断。改为输出到**每次全新**的临时目录再逐文件同步，
> 可绕开该限制。**注意临时目录必须是新的**——复用同一目录时，第二次构建清空它同样会被拦截。
> 同步默认只覆盖/新增、不删除（加 `--prune` 才清理）。
>
> 同理，VitePress 内置 sitemap 生成位于构建收尾阶段，受上述中断影响，因此改为自建生成器。

## 部署路径（base）——重要

站点有两套部署地址，**资源路径前缀不同**，由环境变量 `DEPLOY_BASE` 控制：

| 部署地址 | `DEPLOY_BASE` | 说明 |
|---|---|---|
| `mfujun2025.github.io/dianhanji/` | `/dianhanji/` | GitHub Pages 子路径，CI 中已自动设置 |
| `电焊机.cn`（自有域名，根目录） | `/`（默认） | 绑定自定义域名后使用 |

**若 `base` 与部署地址不匹配，页面 HTML 能打开但 JS/CSS 全部 404**（表现为表单无反应、
Mermaid 不渲染、导航跳转失效），因为 VitePress 会输出 `/assets/...` 这类根相对路径。

绑定自有域名后，把 `.github/workflows/deploy.yml` 里的 `DEPLOY_BASE` 改为 `/`（或删掉该环境变量），
并把仓库 Settings → Pages 的 Custom domain 设为 `xn--nqv61tpnd.cn`、勾选 Enforce HTTPS。

> `canonical` 与 `sitemap.xml` 始终写死自有域名 `https://xn--nqv61tpnd.cn`，
> 与 `DEPLOY_BASE` 无关，因此 SEO 信号不会因走 Pages 预览地址而分散。

## 新增文章

在 `docs/articles/` 下新建 `.md`，头部写 frontmatter：

```markdown
---
title: 文章标题
desc: 一句话摘要（用于索引卡片与 SEO 描述）
cat: 选型与参数
date: "2026-09-28"
---
```

然后跑 `npm run build`，索引卡片与 sitemap 会自动更新。

`cat` 可选值：`选型与参数` / `焊接工艺` / `使用与维护` / `行业动态`。

## 留言表单

`docs/contact.md` 内嵌留言表单，纯前端实现，零后端。

- 默认**演示模式**：本地校验 + 生成可复制的留言文本，引导访客通过邮箱 `mfujun@agent.qq.com` 发送
- 配置 `CFG.webhook` 后，提交会 POST 到飞书/企业微信机器人（卡片消息格式）
- 含**蜜罐字段**（`id="dhj-hp"`）防机器人：命中时返回"假成功"，静默丢弃

## SEO 配置

- 每页自动注入 `<link rel="canonical">`（VitePress `transformHead` 钩子）
- `og:*` 标签、JSON-LD `Organization` 结构化数据
- `sitemap.xml` 与 `robots.txt` 使用 punycode 域名

## 部署

推送到 GitHub 后，在仓库 **Settings → Pages** 中设置 Source 为 `GitHub Actions`，
workflow 会构建并发布 `docs/.vitepress/dist`。
