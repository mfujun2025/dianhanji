/**
 * 构建脚本：用 VitePress Node API 显式指定 outDir，绕开 Vite 默认的
 * prepareOutDir（会 emptyDir 清空目标目录，在本机沙箱里被批量删除守卫拦截）。
 *
 * 用法：node scripts/build.mjs [outDir]
 *   默认 outDir = docs/.vitepress/dist2
 *   环境变量 BUILD_OUT 可覆盖。
 *
 * 之后用 scripts/swap-dist.mjs 把内容同步到 dist/（仅覆盖同名文件）。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vitepress'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DOCS = path.join(ROOT, 'docs')

const outDir = process.argv[2] || process.env.BUILD_OUT || path.join(DOCS, '.vitepress', 'dist2')

console.log('[build] root   =', DOCS)
console.log('[build] outDir =', outDir)

const t0 = Date.now()
await build(DOCS, { outDir })
console.log(`[build] done in ${((Date.now() - t0) / 1000).toFixed(2)}s`)
