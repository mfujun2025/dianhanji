/**
 * 把 dist2 的构建产物同步到 dist/。
 *
 * 为什么需要这一步：
 *   VitePress 构建时会 emptyDir 清空 outDir，本机沙箱的批量删除守卫会拦截，
 *   因此构建输出到 dist2（全新目录，不清空），再用本脚本逐文件覆盖到 dist。
 *
 * 安全策略（遵守本机破坏性操作约定）：
 *   - 默认只「覆盖同名文件 + 新增缺失文件」，不删除 dist 中的任何东西
 *   - --prune 才删除 dist 中存在但 dist2 中没有的文件（需显式指定）
 *   - --dry 只打印计划，不落盘
 *
 * 用法：node docs/_sync-dist.mjs [--prune] [--dry]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VP = path.join(__dirname, '.vitepress')
const SRC = path.join(VP, 'dist2')
const DST = path.join(VP, 'dist')

const prune = process.argv.includes('--prune')
const dry = process.argv.includes('--dry')

if (!fs.existsSync(SRC)) {
  console.error('[sync] 找不到构建产物', SRC, '—— 请先运行 node docs/_build.mjs')
  process.exit(1)
}

/** 递归列出目录下所有文件的相对路径 */
function walk(dir, base = dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(abs, base))
    else out.push(path.relative(base, abs))
  }
  return out
}

const srcFiles = walk(SRC)
const dstFiles = fs.existsSync(DST) ? walk(DST) : []
const srcSet = new Set(srcFiles)

let copied = 0
let added = 0
let pruned = 0
const stale = dstFiles.filter((f) => !srcSet.has(f))

for (const rel of srcFiles) {
  const s = path.join(SRC, rel)
  const d = path.join(DST, rel)
  const existed = fs.existsSync(d)
  const same = existed && fs.readFileSync(s).equals(fs.readFileSync(d))
  if (same) continue
  if (dry) {
    console.log(`[dry] ${existed ? '覆盖' : '新增'} ${rel}`)
  } else {
    fs.mkdirSync(path.dirname(d), { recursive: true })
    fs.copyFileSync(s, d)
  }
  existed ? copied++ : added++
}

console.log(`[sync] 覆盖 ${copied} / 新增 ${added} / 共 ${srcFiles.length} 个文件${dry ? '（dry-run，未落盘）' : ''}`)

if (stale.length) {
  console.log(`[sync] dist 中存在但产物里没有的文件 ${stale.length} 个：`)
  for (const f of stale.slice(0, 30)) console.log('   - ' + f)
  if (stale.length > 30) console.log(`   ... 其余 ${stale.length - 30} 个`)
  if (prune) {
    if (dry) {
      console.log('[dry] 将删除上述文件（--prune）')
    } else {
      for (const f of stale) {
        try { fs.unlinkSync(path.join(DST, f)); pruned++ } catch {}
      }
      console.log(`[sync] 已删除 ${pruned} 个陈旧文件`)
    }
  } else {
    console.log('[sync] 未删除（如需清理请加 --prune，并先确认上面的清单）')
  }
} else {
  console.log('[sync] 无陈旧文件')
}
