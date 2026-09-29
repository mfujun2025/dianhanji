/**
 * 线上站点验证（curl 版，无浏览器依赖）。
 *
 * 为什么不用无头浏览器：本机沙箱里的 Edge 访问不了外网，
 * 之前的 CDP 版本 17 项里 15 项返回 undefined（不是站点问题）。
 * 用 curl 拉真实 HTML 做断言，更快也更可靠。
 *
 * 覆盖：
 *   0. **CSS/JS 是否真的能加载**（最关键：路径前缀与部署地址不匹配时页面只剩裸 HTML）
 *   1. 所有页面 HTTP 200
 *   2. 资源路径前缀正确
 *   3. 每个页面引用的资源逐个 HEAD，确认 200
 *   4. 页面内链逐个 HEAD，确认 200（含 cleanUrls 语义）
 *   5. sitemap.xml / robots.txt 域名正确且 URL 可访问
 *   6. 关键内容存在（标题、邮箱、导航、表单、Mermaid 容器）
 *
 * 用法：node scripts/verify-online-curl.mjs [baseUrl]
 *   默认 baseUrl = https://xn--nqv61tpnd.cn （已绑定的自有域名）
 *   走 Pages 子路径时传 https://mfujun2025.github.io/dianhanji
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const BASE = (process.argv[2] || 'https://xn--nqv61tpnd.cn').replace(/\/$/, '')
const ORIGIN = new URL(BASE).origin
const SUBPATH = new URL(BASE).pathname.replace(/\/$/, '') // '' 或 '/dianhanji'
const SITE = 'https://xn--nqv61tpnd.cn'

const PAGES = [
  '/', '/about', '/contact',
  '/products/', '/products/mma-inverter', '/products/mig-mag', '/products/tig',
  '/products/plasma-cutter', '/products/portable',
  '/articles/', '/articles/how-to-choose-welder', '/articles/welder-parameters',
  '/articles/weld-defects', '/articles/maintenance-guide', '/articles/inverter-trend',
  '/solutions/', '/solutions/steel-structure', '/solutions/pressure-vessel',
  '/solutions/auto-repair', '/solutions/decoration',
]

const results = []
const ok = (name, pass, extra = '') => {
  results.push([name, !!pass])
  console.log(`  ${pass ? '✓' : '✗'} ${name}${extra ? '  → ' + extra : ''}`)
}

async function get(url) {
  const r = await fetch(url, { redirect: 'follow' })
  return { status: r.status, text: await r.text() }
}
async function head(url) {
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow' })
    return r.status
  } catch { return 0 }
}

console.log('\n线上验证（curl，无浏览器）')
console.log('目标：' + BASE)
console.log('='.repeat(62))

// ---- 0. 最关键：CSS/JS 是否真的能加载（裸 HTML 检测）----
// 这一项专门拦「页面能打开但样式全丢」的故障：
// base 配置与部署地址不匹配时（如绑了自有域名却仍用 /dianhanji/ 前缀），
// HTML 照常返回 200，但它引用的 CSS/JS 全部 404 → 用户看到的是浏览器默认样式的裸页面。
console.log('\n--- 0. 样式与脚本能否加载（裸 HTML 检测）---')
{
  let html
  try { html = (await get(BASE + '/')).text } catch { html = '' }
  const cssRefs = [...(html || '').matchAll(/href="([^"]+\.css)"/g)].map((m) => m[1])
  const jsRefs = [...(html || '').matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1])

  ok('首页引用了 CSS', cssRefs.length > 0, `${cssRefs.length} 个`)
  ok('首页引用了 JS', jsRefs.length > 0, `${jsRefs.length} 个`)

  const toAbs = (r) => (/^https?:/.test(r) ? r : ORIGIN + r)
  const deadCss = []
  for (const r of cssRefs) {
    const st = await head(toAbs(r))
    if (st !== 200) deadCss.push(`${r} → ${st}`)
  }
  const deadJs = []
  for (const r of jsRefs) {
    const st = await head(toAbs(r))
    if (st !== 200) deadJs.push(`${r} → ${st}`)
  }
  ok(`首页 CSS 全部可加载（${cssRefs.length} 个）`, deadCss.length === 0, deadCss.slice(0, 2).join(', '))
  ok(`首页 JS 全部可加载（${jsRefs.length} 个）`, deadJs.length === 0, deadJs.slice(0, 2).join(', '))

  // 若绑定了自有域名，同时确认 Pages 的 CNAME 文件还在（否则下次部署会掉域名绑定）
  if (new URL(BASE).hostname === 'xn--nqv61tpnd.cn') {
    const st = await head(BASE + '/CNAME')
    ok('CNAME 文件已随产物部署（防域名绑定被覆盖）', st === 200, `HTTP ${st}`)
  }
}

// ---- 1. 页面可达性 + 基本内容 ----
console.log('\n--- 1. 页面可达性与内容 ---')
const htmlCache = new Map()
for (const p of PAGES) {
  const url = BASE + p
  try {
    const { status, text } = await get(url)
    htmlCache.set(p, text)
    ok(`${p} → HTTP 200`, status === 200, status === 200 ? '' : `HTTP ${status}`)
  } catch (e) {
    ok(`${p} → 可访问`, false, e.message)
  }
}

// ---- 2. 资源路径前缀正确性（随部署模式变化）----
// 根目录部署（自有域名 / 用户站点仓库）：资源应为 /assets/...
// 子路径部署（github.io/<repo>/）：资源应为 /<repo>/assets/...
// 判据：资源实际能 200 才算对；这里先做形式检查，真正的把关在第 0 节与第 4 节。
console.log('\n--- 2. 资源路径前缀 ---')
const allHtml = [...htmlCache.entries()]
let wrongPrefix = []
let rightPrefix = 0
for (const [p, h] of allHtml) {
  // 抓出所有引用（src/href 的路径部分），再筛出含 /assets/ 的
  const refs = [...h.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1])
  for (const r of refs) {
    if (!r.includes('/assets/')) continue
    const expected = (SUBPATH || '') + '/assets/'
    if (r.startsWith(expected)) rightPrefix++
    else wrongPrefix.push(`${p}: ${r}`)
  }
}
const mode = SUBPATH ? `子路径 ${SUBPATH}` : '根目录（自有域名）'
ok(`资源前缀与部署模式匹配（${mode}）`, wrongPrefix.length === 0,
   wrongPrefix.length ? `${wrongPrefix.length} 处不符，例：${wrongPrefix[0]}` : `${rightPrefix} 处正确`)

// ---- 3. 页面内链前缀 ----
console.log('\n--- 3. 页面内链前缀 ---')
// Cloudflare 等代理会往 HTML 注入自己的脚本/链接（如 /cdn-cgi/*），不是站内链接，必须排除
const EXTERNAL_PREFIXES = ['/cdn-cgi/', '/assets/', '/favicon', '/BingSiteAuth', '/baidu_verify', '/CNAME']
let badLinks = []
for (const [p, h] of allHtml) {
  const links = [...h.matchAll(/(?:href)="(\/[^":#]*)/g)].map((m) => m[1])
  for (const l of links) {
    if (EXTERNAL_PREFIXES.some((x) => l.startsWith(x))) continue
    if (SUBPATH && !l.startsWith(SUBPATH + '/') && l !== SUBPATH) badLinks.push(`${p} → ${l}`)
  }
}
ok('站内链接前缀与部署模式匹配', badLinks.length === 0,
   badLinks.length ? `${badLinks.length} 处，例：${badLinks[0]}` : '')

// ---- 4. 资源可访问性（逐个 GET） ----
console.log('\n--- 4. 资源可访问性 ---')
const assets = new Set()
for (const [, h] of allHtml) {
  for (const m of h.matchAll(/(?:src|href)="(\/[^"]*\.(?:js|css|woff2|svg))"/g)) assets.add(m[1])
}
let assetFail = []
for (const a of assets) {
  // HEAD 在 Cloudflare/GitHub Pages 上对 chunk 偶尔不稳，落在小体积分块时会被误判
  // 先用 HEAD，非 200 再用 GET 复核；两次都失败才算真失败
  let st = await head(ORIGIN + a)
  if (st !== 200) {
    try {
      const r = await fetch(ORIGIN + a)
      st = r.status
    } catch { /* 保留 HEAD 的状态码 */ }
  }
  if (st !== 200) assetFail.push(`${a} (${st})`)
}
ok(`全部资源可访问（${assets.size} 个）`, assetFail.length === 0, assetFail.slice(0,3).join(', '))

// ---- 5. 内链可达性 ----
console.log('\n--- 5. 内链可达性 ---')
const links = new Set()
for (const [, h] of allHtml) {
  for (const m of h.matchAll(/href="(\/[^":#]+)/g)) {
    if (/\.(js|css|woff2|svg|xml|txt)$/.test(m[1])) continue
    // 排除静态资源、验证文件，以及代理注入的路径（Cloudflare 邮件保护会插 /cdn-cgi/...）
    if (EXTERNAL_PREFIXES.some((x) => m[1].startsWith(x))) continue
    links.add(m[1])
  }
}
let linkFail = []
for (const l of links) {
  const st = await head(ORIGIN + l)
  if (st !== 200) linkFail.push(`${l} (${st})`)
}
ok(`全部内链可达（${links.size} 条）`, linkFail.length === 0, linkFail.slice(0,3).join(', '))

// ---- 6. 关键内容 ----
console.log('\n--- 6. 关键内容 ---')
{
  const home = htmlCache.get('/') || ''
  ok('首页标题为「电焊机.cn」', /<title>电焊机\.cn<\/title>/.test(home))
  ok('首页导航 5 栏目齐全',
     ['产品中心','文章资讯','解决方案','关于我们','联系我们'].every(n => home.includes(n)))
  ok('首页产品卡片 ≥6', (home.match(/class="dhj-card"/g) || []).length >= 6,
     String((home.match(/class="dhj-card"/g) || []).length))
  ok('首页 Mermaid 容器存在', home.includes('class="mermaid"'))
  ok('canonical 指向自有域名', home.includes(`rel="canonical" href="${SITE}/"`))

  const contact = htmlCache.get('/contact') || ''
  ok('联系页含邮箱 mfujun@agent.qq.com', contact.includes('mfujun@agent.qq.com'))
  ok('联系页含留言表单', contact.includes('id="dhj-form"'))
  ok('联系页含蜜罐字段', contact.includes('dhj-hp'))

  // 表单逻辑写在 <script setup> 里，由 Vite 编译进 contact 页的 chunk，
  // 服务端 HTML 里不含 __DHJ__。要确认逻辑真的上线，得拉那个 chunk。
  // chunk 名带 hash：未显式指定时，自动从「最新构建目录」取（不要从 dist 取，
  // dist 是只增不删的累积目录，会残留旧 hash 导致误判）。
  let knownChunk = process.env.CONTACT_CHUNK
  if (!knownChunk) {
    try {
      const vp = path.join(ROOT, 'docs', '.vitepress')
      const dirs = fs.readdirSync(vp, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name.startsWith('.out-'))
        .map((e) => ({ p: path.join(vp, e.name), m: fs.statSync(path.join(vp, e.name)).mtimeMs }))
        .sort((a, b) => b.m - a.m)
      if (dirs[0]) {
        knownChunk = fs.readdirSync(path.join(dirs[0].p, 'assets'))
          .filter((f) => /^contact\.md\.[A-Za-z0-9_-]+\.js$/.test(f) && !f.includes('lean'))[0]
      }
    } catch {}
  }
  if (knownChunk) {
    const url = `${ORIGIN}${SUBPATH}/assets/${knownChunk}`
    const st = await head(url)
    let jsOk = false
    if (st === 200) {
      const js = await (await fetch(url)).text()
      jsOk = js.includes('__DHJ__') && js.includes('dhj-hp') && js.includes('mfujun@agent.qq.com')
    }
    ok('联系页表单逻辑 chunk 已部署且完整', jsOk,
       `${knownChunk} → HTTP ${st}${jsOk ? '，含 __DHJ__/蜜罐/邮箱' : ''}`)
  } else {
    console.log('  - 跳过表单 chunk 深检（设 CONTACT_CHUNK=<文件名> 启用）')
  }

  const prod = htmlCache.get('/products/mma-inverter') || ''
  ok('产品详情页含 Mermaid 图容器', prod.includes('class="mermaid"'))
}

// ---- 7. SEO 文件 ----
console.log('\n--- 7. SEO 文件 ---')
for (const [label, p, expect] of [
  ['sitemap.xml', '/sitemap.xml', 'xn--nqv61tpnd.cn'],
  ['robots.txt', '/robots.txt', 'xn--nqv61tpnd.cn'],
]) {
  try {
    const { status, text } = await get(BASE + p)
    ok(`${label} 可访问且域名正确`, status === 200 && text.includes(expect),
       `HTTP ${status}, ${text.length} 字节`)
  } catch (e) { ok(`${label} 可访问`, false, e.message) }
}
{
  const { text } = await get(BASE + '/sitemap.xml')
  const locs = [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  const n = locs.length
  // 站点会持续加文章，条数只增不减；断言用「下限 + 去重 + 域名正确」而非硬编码具体数字
  const uniq = new Set(locs).size
  const wrongHost = locs.filter((l) => !l.startsWith(SITE)).length
  const dup = locs.length !== uniq ? `，有 ${locs.length - uniq} 条重复` : ''
  ok(`sitemap 条数合理且无重复（${n} 条）`,
     n >= 20 && uniq === n && wrongHost === 0,
     `${n} 条${dup}${wrongHost ? `，${wrongHost} 条域名不符` : ''}`)
}

// ---- 汇总 ----
const fails = results.filter(([, p]) => !p).length
console.log('\n' + '='.repeat(62))
console.log(`线上验证：${results.length - fails}/${results.length} 通过` +
  (fails ? `  ❌ 失败 ${fails} 项` : '  ✅ 全部通过'))
console.log('='.repeat(62) + '\n')
process.exit(fails ? 1 : 0)
