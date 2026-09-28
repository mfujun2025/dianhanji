#!/usr/bin/env node
/**
 * 电焊机.cn — 文章索引自动生成脚本
 *
 * 用途：扫描 docs/articles/*.md（排除 index.md），读取 frontmatter，
 *       自动重写 docs/articles/index.md 中的文章卡片区块。
 *
 * frontmatter 约定（放在 .md 文件最顶部）：
 *   ---
 *   title: 文章标题
 *   desc:  一句话摘要（用于卡片描述）
 *   cat:   分类（选型与参数 | 焊接工艺 | 使用与维护 | 行业动态）
 *   date:  2026-09-28
 *   ---
 *
 * 用法：
 *   node scripts/build-articles.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const ART_DIR = path.join(ROOT, 'docs', 'articles')
const INDEX = path.join(ART_DIR, 'index.md')
const START = '<!-- ARTICLES:START -->'
const END = '<!-- ARTICLES:END -->'

const CAT_ORDER = ['选型与参数', '焊接工艺', '使用与维护', '行业动态']
const CAT_ANCHOR = {
  选型与参数: '#选型与参数',
  焊接工艺: '#焊接工艺',
  使用与维护: '#使用与维护',
  行业动态: '#行业动态',
}

function parseFront(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return {}
  const out = {}
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i < 0) continue
    const k = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1)
    out[k] = v
  }
  return out
}

const files = fs.readdirSync(ART_DIR).filter((f) => f.endsWith('.md') && f !== 'index.md')
const arts = []
for (const f of files) {
  const text = fs.readFileSync(path.join(ART_DIR, f), 'utf8')
  const fm = parseFront(text)
  if (!fm.title) {
    console.warn('  [跳过] 缺少 frontmatter.title:', f)
    continue
  }
  const slug = f.replace(/\.md$/, '')
  // 若正文没有 H1，说明已有标题行 —— 用 frontmatter 标题
  const wc = text.replace(/```[\s\S]*?```/g, '').replace(/[#>*`|\-\s]/g, '').length
  arts.push({
    file: f,
    slug,
    title: fm.title,
    desc: fm.desc || '',
    cat: CAT_ORDER.includes(fm.cat) ? fm.cat : '行业动态',
    date: fm.date || '',
    words: wc,
  })
}

arts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug)))

const groups = CAT_ORDER.map((c) => ({ cat: c, items: arts.filter((a) => a.cat === c) }))

let block = START + '\n\n## 按主题浏览\n\n'
block += '| 主题分类 | 内容范围 | 当前篇数 |\n|---------|---------|---------|\n'
const CAT_DESC = {
  选型与参数: '机型对比、参数解读、按工况选型',
  焊接工艺: '工艺要点、常见缺陷与对策',
  使用与维护: '日常保养、故障排查、安全规范',
  行业动态: '技术趋势、能耗与自动化',
}
for (const g of groups) {
  block += `| [${g.cat}](${CAT_ANCHOR[g.cat]}) | ${CAT_DESC[g.cat]} | ${g.items.length} |\n`
}

for (const g of groups) {
  block += `\n---\n\n## ${g.cat}\n\n`
  if (!g.items.length) {
    block += '暂无内容，敬请期待。\n'
    continue
  }
  block += '<div class="dhj-cards">\n\n'
  for (const a of g.items) {
    block += `<a class="dhj-card" href="/articles/${a.slug}">\n`
    block += `  <p class="t">${a.title}</p>\n`
    block += `  <p class="d">${a.desc}</p>\n`
    block += `  <p class="m">${a.date} · ${a.cat} · 约 ${a.words} 字 →</p>\n`
    block += '</a>\n\n'
  }
  block += '</div>\n'
}
block += '\n' + END

let idx = fs.readFileSync(INDEX, 'utf8')
if (!idx.includes(START) || !idx.includes(END)) {
  console.error('  [错误] index.md 缺少 ' + START + ' / ' + END + ' 标记')
  process.exit(1)
}
idx = idx.replace(new RegExp(START + '[\\s\\S]*?' + END), block)
fs.writeFileSync(INDEX, idx, 'utf8')

console.log('  ✓ 文章索引已更新：共 ' + arts.length + ' 篇')
for (const g of groups) console.log('     · ' + g.cat + '：' + g.items.length + ' 篇')
const total = arts.reduce((s, a) => s + a.words, 0)
console.log('  ✓ 正文合计约 ' + total + ' 字')
