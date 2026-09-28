/**
 * 生成 sitemap.xml。
 *
 * 为什么自己生成：VitePress 内置的 sitemap 生成发生在构建收尾阶段，
 * 本机沙箱的删除守卫会让收尾步骤中断，导致 sitemap.xml 缺失。
 * 自建生成器同时带来一个好处：新增文章后 sitemap 自动包含，无需人工维护。
 *
 * 用法：node scripts/gen-sitemap.mjs [outDir]
 *   默认 outDir = docs/.vitepress/dist2（与 build.mjs 保持一致）
 *   环境变量 BUILD_OUT 可覆盖。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DOCS = path.join(ROOT, 'docs')
const OUT = process.argv[2] || process.env.BUILD_OUT || path.join(DOCS, '.vitepress', 'dist2')

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
