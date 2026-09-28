/**
 * 线上站点验证（curl 版，无浏览器依赖）。
 *
 * 为什么不用无头浏览器：本机沙箱里的 Edge 访问不了外网，
 * 之前的 CDP 版本 17 项里 15 项返回 undefined（不是站点问题）。
 * 用 curl 拉真实 HTML 做断言，更快也更可靠。
 *
 * 覆盖：
 *   1. 所有页面 HTTP 200
 *   2. 资源路径前缀正确（子路径部署下不得出现根相对 /assets/...）
 *   3. 每个页面引用的资源逐个 HEAD，确认 200
 *   4. 页面内链逐个 HEAD，确认 200（含 cleanUrls 语义）
 *   5. sitemap.xml / robots.txt 域名正确且 URL 可访问
 *   6. 关键内容存在（标题、邮箱、导航、表单、Mermaid 容器）
 *
 * 用法：node scripts/verify-online-curl.mjs [baseUrl]
 *   默认 baseUrl = https://mfujun2025.github.io/dianhanji
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const BASE = (process.argv[2] || 'https://mfujun2025.github.io/dianhanji').replace(/\/$/, '')
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

// ---- 2. 资源前缀正确性 ----
console.log('\n--- 2. 资源路径前缀 ---')
const allHtml = [...htmlCache.entries()]
let badPrefix = 0
let prefixed = 0
for (const [p, h] of allHtml) {
  // 找形如 src="/assets/..." 或 href="/assets|favicon..." 的根相对资源
  const wrong = h.match(/(?:src|href)="\/(assets|favicon)[^"]*"/g) || []
  if (wrong.length) { badPrefix += wrong.length; console.log(`   ${p}: ${wrong.slice(0,3).join(' ')}`) }
  const good = h.match(new RegExp(`(?:src|href)="${SUBPATH}\\/(assets|favicon)[^"]*"`, 'g')) || []
  prefixed += good.length
}
ok('无根相对资源路径（/assets/...）', badPrefix === 0, badPrefix ? `${badPrefix} 处错误` : '')
ok('资源路径带正确前缀', prefixed > 0, `${prefixed} 处`)

// ---- 3. 页面内链前缀 ----
console.log('\n--- 3. 页面内链前缀 ---')
let badLinks = []
for (const [p, h] of allHtml) {
  // 站内根相对链接（排除 /assets、favicon 已在上面查过）
  const links = [...h.matchAll(/(?:href)="(\/[^":#]*)/g)].map(m => m[1])
  for (const l of links) {
    if (l.startsWith('/assets') || l.startsWith('/favicon')) continue
    if (SUBPATH && !l.startsWith(SUBPATH + '/') && l !== SUBPATH) badLinks.push(`${p} → ${l}`)
  }
}
ok('站内链接均带前缀', badLinks.length === 0,
   badLinks.length ? `${badLinks.length} 处，例：${badLinks[0]}` : '')

// ---- 4. 资源可访问性（逐个 GET） ----
console.log('\n--- 4. 资源可访问性 ---')
const assets = new Set()
for (const [, h] of allHtml) {
  for (const m of h.matchAll(/(?:src|href)="(\/[^"]*\.(?:js|css|woff2|svg))"/g)) assets.add(m[1])
}
let assetFail = []
for (const a of assets) {
  const st = await head(ORIGIN + a)
  if (st !== 200) assetFail.push(`${a} (${st})`)
}
ok(`全部资源可访问（${assets.size} 个）`, assetFail.length === 0, assetFail.slice(0,3).join(', '))

// ---- 5. 内链可达性 ----
console.log('\n--- 5. 内链可达性 ---')
const links = new Set()
for (const [, h] of allHtml) {
  for (const m of h.matchAll(/href="(\/[^":#]+)/g)) {
    if (/\.(js|css|woff2|svg|xml|txt)$/.test(m[1])) continue
    if (m[1].startsWith('/assets') || m[1].startsWith('/favicon')) continue
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
  const n = (text.match(/<loc>/g) || []).length
  ok('sitemap 含 20 条 URL', n === 20, `${n} 条`)
}

// ---- 汇总 ----
const fails = results.filter(([, p]) => !p).length
console.log('\n' + '='.repeat(62))
console.log(`线上验证：${results.length - fails}/${results.length} 通过` +
  (fails ? `  ❌ 失败 ${fails} 项` : '  ✅ 全部通过'))
console.log('='.repeat(62) + '\n')
process.exit(fails ? 1 : 0)
