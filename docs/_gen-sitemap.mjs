/**
 * 生成 sitemap.xml。
 *
 * 为什么自己生成：VitePress 内置的 sitemap 生成发生在构建收尾阶段，
 * 本机沙箱的删除守卫会让收尾步骤中断，导致 sitemap.xml 缺失。
 * 自建生成器同时带来一个好处：新增文章后 sitemap 自动包含，无需人工维护。
 *
 * 用法：node _gen-sitemap.mjs [outDir]
 *   默认取 .vitepress 下最新的构建输出目录（.out-<timestamp> / dist2）
 *   环境变量 BUILD_OUT 可覆盖。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOCS = __dirname
const VP = path.join(DOCS, '.vitepress')

/** 定位最新构建输出目录 */
function resolveOut() {
  if (process.argv[2]) return path.resolve(process.argv[2])
  if (process.env.BUILD_OUT) return path.resolve(process.env.BUILD_OUT)
  const c = []
  for (const e of fs.readdirSync(VP, { withFileTypes: true })) {
    if (e.isDirectory() && (e.name === 'dist2' || e.name.startsWith('.out-'))) {
      c.push(path.join(VP, e.name))
    }
  }
  c.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  return c[0]
}

const OUT = resolveOut()
if (!OUT) {
  console.error('[sitemap] 找不到构建产物目录，请先运行 node _build.mjs')
  process.exit(1)
}

const SITE = 'https://xn--nqv61tpnd.cn'

/** 递归收集 docs 下所有 .md，排除 VitePress 内部目录 */
function collectMarkdown(dir, base = DOCS) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'public') continue
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...collectMarkdown(abs, base))
    else if (e.name.endsWith('.md')) out.push(path.relative(base, abs).replace(/\\/g, '/'))
  }
  return out
}

/** md 相对路径 → 站点 URL 路径（cleanUrls 语义） */
function toUrlPath(rel) {
  let p = rel.replace(/\.md$/, '')
  if (p === 'index') return '/'
  if (p.endsWith('/index')) return '/' + p.slice(0, -'/index'.length) + '/'
  return '/' + p
}

const files = collectMarkdown(DOCS).sort()
const urls = files
  .filter((f) => f !== '404.md')
  .map((f) => SITE + toUrlPath(f))
  .sort()

const body =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
  urls.map((u) => `<url><loc>${u}</loc></url>`).join('') +
  '</urlset>'

fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'sitemap.xml'), body, 'utf8')

console.log(`[sitemap] 写入 ${urls.length} 条 URL → ${path.join(OUT, 'sitemap.xml')}`)
for (const u of urls) console.log('   ' + u)
