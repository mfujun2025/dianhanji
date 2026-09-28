/**
 * 电焊机.cn — 端到端验证（Edge 无头 + CDP）
 *
 * 用法：node scripts/verify.mjs
 *
 * 为什么用 CDP 而不是 --dump-dom：
 *   --dump-dom 在 hydration 完成前就快照，Vue 组件（含 onMounted 里的表单逻辑）
 *   拿不到运行时状态。CDP 可以「先等挂载、再 Runtime.evaluate」，结果可靠。
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'docs', '.vitepress', 'dist')
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = 8797
const CDP_PORT = 9333
const BASE = `http://127.0.0.1:${PORT}`

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png',
}

// ---------- 静态服务 ----------
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0])
  let fp = path.join(DIST, p)
  if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) fp = path.join(fp, 'index.html')
  if (!fs.existsSync(fp) && fs.existsSync(fp + '.html')) fp = fp + '.html'
  if (!fs.existsSync(fp)) { res.writeHead(404); res.end('404'); return }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' })
  fs.createReadStream(fp).pipe(res)
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))

// ---------- CDP 客户端 ----------
const PROFILE = path.join(os.tmpdir(), 'dhj-verify-profile-' + Date.now())
let browser = null
let ws = null
let msgId = 0
const pending = new Map()

async function launchBrowser() {
  browser = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-extensions', '--no-first-run', '--disable-background-networking',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] })

  // 等 CDP 就绪
  let ver = null
  for (let i = 0; i < 60; i++) {
    await sleep(300)
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      ver = await r.json()
      if (ver.webSocketDebuggerUrl) break
    } catch { /* retry */ }
  }
  if (!ver || !ver.webSocketDebuggerUrl) throw new Error('无法连接 CDP')

  const { WebSocket } = await import('ws')
  ws = new WebSocket(ver.webSocketDebuggerUrl, { perMessageDeflate: false })
  await new Promise((res, rej) => {
    ws.on('open', res)
    ws.on('error', rej)
  })
  ws.on('message', (raw) => {
    let m
    try { m = JSON.parse(raw.toString()) } catch { return }
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      if (m.error) reject(new Error(JSON.stringify(m.error)))
      else resolve(m.result)
    }
  })
}

function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++msgId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('CDP 超时: ' + method)) }
    }, 45000)
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 打开页面 → 等待条件 → 求值 → 关闭 */
async function evaluate(url, waitExpr, evalExpr, { timeout = 30000, width = 1280, height = 900 } = {}) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })

  try {
    await send('Page.enable', {}, sessionId)
    await send('Runtime.enable', {}, sessionId)
    await send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: width < 600,
    }, sessionId)

    await send('Page.navigate', { url }, sessionId)

    // 等待条件
    let ok = false
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      await sleep(400)
      try {
        const r = await send('Runtime.evaluate', {
          expression: `(()=>{ try { return !!(${waitExpr}) } catch(e){ return false } })()`,
          returnByValue: true,
        }, sessionId)
        if (r.result && r.result.value === true) { ok = true; break }
      } catch { /* retry */ }
    }

    const res = await send('Runtime.evaluate', {
      expression: `(async()=>{ ${evalExpr} })()`,
      awaitPromise: true, returnByValue: true,
    }, sessionId)

    if (res.exceptionDetails) {
      return { waitOk: ok, error: res.exceptionDetails.text || 'eval 异常', value: null }
    }
    return { waitOk: ok, error: null, value: res.result ? res.result.value : null }
  } finally {
    try { await send('Target.closeTarget', { targetId }) } catch {}
  }
}

try {
  await launchBrowser()
} catch (e) {
  console.error('浏览器启动失败：', e.message)
  server.close()
  process.exit(1)
}

// ---------- 断言收集 ----------
const results = { http: [], content: [], form: [], render: [] }
const ok = (arr, name, pass) => arr.push([name, !!pass])

// ---------- 1. HTTP ----------
const pages = [
  '/', '/products/', '/products/mma-inverter', '/products/mig-mag', '/products/tig',
  '/products/plasma-cutter', '/products/portable',
  '/articles/', '/articles/how-to-choose-welder', '/articles/welder-parameters',
  '/articles/weld-defects', '/articles/maintenance-guide', '/articles/inverter-trend',
  '/solutions/', '/solutions/steel-structure', '/solutions/pressure-vessel',
  '/solutions/auto-repair', '/solutions/decoration', '/about', '/contact',
  '/robots.txt', '/sitemap.xml', '/favicon.svg',
]
for (const p of pages) {
  const r = await fetch(BASE + p)
  const ct = (r.headers.get('content-type') || '').split(';')[0]
  const isHtmlPage = p.endsWith('/') || /^\/(about|contact|products\/[a-z-]+|articles\/[a-z-]+|solutions\/[a-z-]+)$/.test(p)
  const pass = r.status === 200 && (isHtmlPage ? ct === 'text/html' : ct !== 'text/html')
  ok(results.http, `${p} → 200 ${ct}`, pass)
}

// ---------- 2. 内容 / SEO ----------
const getText = async (p) => await (await fetch(BASE + p)).text()
{
  const h = await getText('/')
  ok(results.content, '首页含品牌名', h.includes('电焊机.cn'))
  ok(results.content, '首页含产品卡片', h.includes('dhj-card'))
  ok(results.content, '首页含 canonical', /rel="canonical"/.test(h))
  ok(results.content, 'canonical 为 punycode 主域', /canonical" href="https:\/\/xn--nqv61tpnd\.cn\/"/.test(h))
  ok(results.content, '首页含 og:title', h.includes('og:title'))
  ok(results.content, '首页 og:url == canonical 域名', /og:url" content="https:\/\/xn--nqv61tpnd\.cn\//.test(h))
  ok(results.content, '首页 JSON-LD Organization', /"@type":"Organization"/.test(h))
}
{
  // 全站 canonical 覆盖：抽 4 个不同路径核对
  const map = {
    '/': 'https://xn--nqv61tpnd.cn/',
    '/about': 'https://xn--nqv61tpnd.cn/about',
    '/contact': 'https://xn--nqv61tpnd.cn/contact',
    '/products/mma-inverter': 'https://xn--nqv61tpnd.cn/products/mma-inverter',
  }
  let pass = true
  for (const [p, want] of Object.entries(map)) {
    const h = await getText(p)
    const m = /<link rel="canonical" href="([^"]+)"/.exec(h)
    if (!m || m[1] !== want) { pass = false; console.log('    canonical 不符:', p, m && m[1], '≠', want) }
  }
  ok(results.content, '各页 canonical 指向自身 URL', pass)
}
{
  const h = await getText('/contact')
  ok(results.content, '联系页含邮箱 mfujun@agent.qq.com', h.includes('mfujun@agent.qq.com'))
  ok(results.content, '联系页含表单', h.includes('id="dhj-form"'))
  ok(results.content, '联系页含蜜罐 id=dhj-hp', h.includes('id="dhj-hp"'))
  ok(results.content, '联系页含提交/复制按钮', h.includes('id="dhj-submit"') && h.includes('id="dhj-copy"'))
}
{
  const h = await getText('/articles/')
  const n = (h.match(/class="dhj-card"/g) || []).length
  ok(results.content, `文章索引含 ${n} 篇卡片`, n >= 5)
  ok(results.content, '文章索引含 4 个分类', ['选型与参数', '焊接工艺', '使用与维护', '行业动态'].every((c) => h.includes(c)))
}
{
  const h = await getText('/sitemap.xml')
  const n = (h.match(/<url>/g) || []).length
  ok(results.content, `sitemap 含 ${n} 条 URL`, n >= 18)
  ok(results.content, 'sitemap 用 punycode 域名', h.includes('xn--nqv61tpnd.cn'))
}
{
  const h = await getText('/robots.txt')
  ok(results.content, 'robots 指向 punycode sitemap', h.includes('xn--nqv61tpnd.cn/sitemap.xml'))
}

// ---------- 3. 联系表单端到端（CDP 真浏览器） ----------
const CONTACT = BASE + '/contact'
const WAIT_FORM = `window.__DHJ__ && typeof window.__DHJ__.submit === 'function'`

async function formCase(label, fn) {
  const r = await evaluate(CONTACT, WAIT_FORM, fn, { timeout: 30000 })
  if (!r.waitOk) return { error: '表单脚本未挂载（hydration 失败）', value: null }
  return { error: r.error, value: r.value }
}

{
  // 场景 A：正常提交（演示模式 → 应提示未配置接收端 + 已生成留言）
  const c = await formCase('正常提交', `
    var out={};
    document.getElementById('f-name').value='张工';
    document.getElementById('f-contact').value='13800138000';
    document.getElementById('f-material').value='碳钢 / 低合金钢';
    document.getElementById('f-message').value='加工6-12mm碳钢板，日焊4小时，车间有380V，想了解气保焊机怎么选。';
    window.__DHJ__.submit();
    await new Promise(function(s){setTimeout(s,600)});
    var el=document.getElementById('dhj-status');
    out.status=el.className; out.text=el.innerText;
    out.honeypotEmpty=document.getElementById('dhj-hp').value==='';
    var d=window.__DHJ__.collect();
    out.collected=d;
    return out;
  `)
  const v = c.value
  ok(results.form, '正常提交 → 有反馈（成功或演示模式）', v && (/ok|info/.test(v.status) && v.status !== 'err'))
  ok(results.form, '正常提交 → 反馈含邮箱兜底指引', v && /mfujun@agent\.qq\.com/.test(v.text || ''))
  ok(results.form, '正常提交 → 字段收集完整', v && v.collected && v.collected.name === '张工' && v.collected.contact === '13800138000')
  ok(results.form, '正常提交 → 蜜罐默认值为空', v && v.honeypotEmpty === true)
  ok(results.form, '正常提交 → 无 JS 异常', !c.error)
}
{
  // 场景 B：必填缺失 → 必须拦截
  const c = await formCase('必填缺失', `
    var out={};
    ['f-name','f-contact','f-message'].forEach(function(id){document.getElementById(id).value=''});
    window.__DHJ__.submit();
    await new Promise(function(s){setTimeout(s,600)});
    var el=document.getElementById('dhj-status');
    out.status=el.className; out.text=el.innerText;
    out.errs=[].slice.call(document.querySelectorAll('.dhj-err')).map(function(e){return e.textContent}).filter(Boolean);
    return out;
  `)
  const v = c.value
  ok(results.form, '必填缺失 → 失败态拦截', v && /err/.test(v.status || ''))
  ok(results.form, '必填缺失 → 3 条字段级提示', v && v.errs && v.errs.length === 3)
  ok(results.form, '必填缺失 → 未误报成功', v && !/提交成功/.test(v.text || ''))
}
{
  // 场景 C：蜜罐命中 → 假成功（不得真提交）
  const c = await formCase('蜜罐命中', `
    var out={};
    document.getElementById('f-name').value='机器人';
    document.getElementById('f-contact').value='13800138000';
    document.getElementById('f-message').value='这是垃圾留言垃圾留言垃圾留言';
    document.getElementById('dhj-hp').value='http://spam.example.com';
    window.__DHJ__.submit();
    await new Promise(function(s){setTimeout(s,600)});
    var el=document.getElementById('dhj-status');
    out.status=el.className; out.text=el.innerText;
    return out;
  `)
  const v = c.value
  ok(results.form, '蜜罐命中 → 假成功（静默拦截）', v && /ok/.test(v.status || '') && /提交成功/.test(v.text || ''))
  ok(results.form, '蜜罐命中 → 无 JS 异常', !c.error)
}
{
  // 场景 D：复制留言内容
  const c = await formCase('复制留言', `
    var out={};
    document.getElementById('f-name').value='李工';
    document.getElementById('f-contact').value='test@example.com';
    document.getElementById('f-message').value='测试复制功能，请忽略此条留言。';
    out.plain=window.__DHJ__.copy ? 'has-copy' : 'no-copy';
    window.__DHJ__.copy();
    await new Promise(function(s){setTimeout(s,600)});
    var el=document.getElementById('dhj-status');
    out.status=el.className; out.text=el.innerText;
    out.collected=window.__DHJ__.collect();
    return out;
  `)
  const v = c.value
  ok(results.form, '复制 → 提示已复制', v && /已复制/.test(v.text || ''))
  ok(results.form, '复制 → 内容含邮箱', v && v.collected && v.collected.contact === 'test@example.com')
  ok(results.form, '复制 → 内容含称呼与留言', v && v.collected && v.collected.name === '李工' && /测试复制/.test(v.collected.message || ''))
}

// ---------- 4. 渲染 / 响应式 ----------
const PROBE_READY = `document.querySelector('.VPNavBar') && document.querySelectorAll('.dhj-card').length > 0`
const PROBE_JS = `
  var out={
    cards: document.querySelectorAll('.dhj-card').length,
    navText: [].slice.call(document.querySelectorAll('.VPNavBar a')).map(function(a){return a.innerText.trim()}).filter(Boolean),
    heroName: (document.querySelector('.VPHero .name .clip')||{}).innerText||'',
    title: document.title,
    canonical: (document.querySelector('link[rel=canonical]')||{}).href||'',
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    mermaidTotal: document.querySelectorAll('.mermaid').length,
    mermaidSvg: document.querySelectorAll('.mermaid svg, svg[id^="mermaid"]').length,
  };
  return out;
`
{
  // 产品详情页 Mermaid 渲染（该页确有 mermaid 图；/products/ 总览页本身无图）
  const r = await evaluate(BASE + '/products/mma-inverter', PROBE_READY, PROBE_JS, { timeout: 35000 })
  const v = r.value
  ok(results.render, 'Mermaid 渲染为 SVG', v && v.mermaidSvg >= 1)
  ok(results.render, 'Mermaid 无未处理残留', v && v.mermaidTotal >= 1 && v.mermaidSvg >= v.mermaidTotal)
  if (!v || v.mermaidSvg < 1) {
    const d = await evaluate(BASE + '/products/mma-inverter', 'document.readyState === "complete"', `
      var nodes = document.querySelectorAll('.mermaid');
      var out = {
        nodeCount: nodes.length,
        firstHTML: nodes[0] ? nodes[0].innerHTML.slice(0, 400) : '(no node)',
        firstClass: nodes[0] ? nodes[0].className : '',
        hasGraphAttr: nodes[0] ? nodes[0].hasAttribute('graph') : false,
        graphPreview: nodes[0] ? String(nodes[0].getAttribute('graph')).slice(0, 120) : '',
        mermaidGlobal: typeof window.mermaid,
        svgAnywhere: document.querySelectorAll('svg').length,
        appMounted: !!document.querySelector('[data-v-app], .VPNavBar'),
      };
      return out;
    `, { timeout: 35000 })
    console.log('\n[Mermaid 诊断] ' + JSON.stringify(d.value, null, 2) + '\n')
  }
}
{
  // 首页桌面
  const r = await evaluate(BASE + '/', PROBE_READY, PROBE_JS, { width: 1440, height: 900, timeout: 35000 })
  const v = r.value
  for (const nav of ['产品中心', '文章资讯', '解决方案', '关于我们', '联系我们']) {
    ok(results.render, `桌面导航含「${nav}」`, v && v.navText.some((t) => t.includes(nav)))
  }
  ok(results.render, '首页 Hero 品牌名渲染', v && /电焊机/.test(v.heroName || ''))
  ok(results.render, '首页产品卡片 ≥6', v && v.cards >= 6)
  ok(results.render, '桌面端无横向溢出', v && v.overflow === false)
  ok(results.render, '浏览器 DOM 含 canonical', v && /xn--nqv61tpnd\.cn/.test(v.canonical || ''))
}
{
  // 首页移动端
  const r = await evaluate(BASE + '/', PROBE_READY, PROBE_JS, { width: 390, height: 844, timeout: 35000 })
  const v = r.value
  ok(results.render, '移动端(390px)无横向溢出', v && v.overflow === false)
  ok(results.render, '移动端卡片仍可见', v && v.cards >= 6)
  ok(results.render, '移动端导航可用', v && v.navText.length > 0)
}

// ---------- 清理 ----------
try { ws && ws.close() } catch {}
try { browser && browser.kill() } catch {}
server.close()
await sleep(500)
try { fs.rmSync(PROFILE, { recursive: true, force: true }) } catch {}

// ---------- 输出 ----------
console.log('\n电焊机.cn 端到端验证\n' + '='.repeat(56))
let fails = 0
for (const [title, arr] of [
  ['HTTP / Content-Type', results.http],
  ['内容与 SEO', results.content],
  ['联系表单端到端（CDP 真浏览器）', results.form],
  ['渲染 / 响应式', results.render],
]) {
  console.log(`\n--- ${title} ---`)
  for (const [n, p] of arr) {
    console.log(`  ${p ? '✓' : '✗'} ${n}`)
    if (!p) fails++
  }
}
const total = Object.values(results).reduce((s, a) => s + a.length, 0)
console.log('\n' + '='.repeat(56))
console.log(`合计 ${total - fails}/${total} 通过` + (fails ? `  ❌ 失败 ${fails} 项` : '  ✅ 全部通过'))
console.log('='.repeat(56) + '\n')
process.exit(fails === 0 ? 0 : 1)
