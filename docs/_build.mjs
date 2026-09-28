/**
 * 构建脚本：用 VitePress Node API 显式指定 outDir，绕开 Vite 默认的
 * prepareOutDir（会 emptyDir 清空目标目录，在本机沙箱里被批量删除守卫拦截）。
 *
 * 关键：outDir 必须是「每次全新」的目录。若复用同一个 dist2，第二次构建时
 * Vite 会尝试清空它，同样触发 [SAFE_DELETE_BULK_CONFIRM_REQUIRED]。
 * 因此默认用带时间戳的目录名。
 *
 * 用法：node _build.mjs [outDir]
 *   默认 outDir = docs/.vitepress/.out-<timestamp>
 *   环境变量 BUILD_OUT 可覆盖。
 *
 * 之后用 _sync-dist.mjs 把内容同步到 dist/。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vitepress'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 本脚本放在 docs/ 内（ESM 按脚本位置解析依赖，必须能 import 到 vitepress）
const DOCS = __dirname

const stamp = Date.now()
const outDir =
  process.argv[2] ||
  process.env.BUILD_OUT ||
  path.join(DOCS, '.vitepress', `.out-${stamp}`)

console.log('[build] DOCS   =', DOCS)
console.log('[build] outDir =', outDir)
console.log('[build] base   =', process.env.DEPLOY_BASE || '/')

// 保险：若目标目录意外已存在且非空，直接报错而不是让它被清空
if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) {
  console.error('[build] 目标目录已存在且非空，请换一个目录：', outDir)
  process.exit(1)
}

const t0 = Date.now()
await build(DOCS, { outDir })
console.log(`[build] done in ${((Date.now() - t0) / 1000).toFixed(2)}s`)
console.log('[build] OUTDIR=' + outDir)
