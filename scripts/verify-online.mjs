/**
 * 线上站点验证：用 CDP 真浏览器检查 GitHub Pages 上的实际渲染效果。
 * 重点验证客户端渲染的 Mermaid 是否真的画出 SVG（静态抓取看不到）。
 *
 * 用法：node scripts/verify-online.mjs [baseUrl]
 */
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import WebSocket from 'ws'

const BASE = process.argv[2] || 'https://mfujun2025.github.io/dianhanji'
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const CDP_PORT = 9555

const PROFILE = path.join(os.tmpdir(), 'dhj-online-' + Date.now())
const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  '--disable-extensions', '--no-first-run', '--disable-background-networking',
  '--no-proxy-server', '--proxy-bypass-list=*',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'] })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      const j = await r.json()
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl
    } catch {}
    await sleep(300)
  }
  throw new Error('CDP 未就绪')
}

const browserWs = new WebSocket(await getWsUrl())
await new Promise((r) => browserWs.on('open', r))

let id = 0
const send = (method, params = {}, sessionId) =>
  new Promise((resolve) => {
    const mid = ++id
    const onMsg = (raw) => {
      const m = JSON.parse(raw.toString())
      if (m.id === mid) { browserWs.off('message', onMsg); resolve(m) }
    }
    browserWs.on('message', onMsg)
    browserWs.send(JSON.stringify({ id: mid, method, params, sessionId }))
  })

const results = []
const ok = (name, pass, extra = '') => {
  results.push([name, !!pass, extra])
  console.log(`  ${pass ? '✓' : '✗'} ${name}${extra ? '  → ' + extra : ''}`)
}

async function probe(url, waitExpr, evalExpr, { timeout = 40000, width = 1440, height = 900 } = {}) {
  const { result: t } = await send('Target.createTarget', { url: 'about:blank' })
  const { result: s } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })
  const sid = s.sessionId
  try {
    await send('Page.enable', {}, sid)
    await send('Runtime.enable', {}, sid)
    await send('Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: 1, mobile: width < 600 }, sid)
    await send('Page.navigate', { url }, sid)

    let ready = false
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      await sleep(500)
      try {
        const r = await send('Runtime.evaluate', {
          expression: `(()=>{ try { return !!(${waitExpr}) } catch(e){ return false } })()`,
          returnByValue: true,
        }, sid)
        if (r.result && r.result.value === true) { ready = true; break }
      } catch {}
    }

    const res = await send('Runtime.evaluate', {
      expression: `(async()=>{ ${evalExpr} })()`,
      awaitPromise: true, returnByValue: true,
    }, sid)
    return { ready, value: res.result ? res.result.value : null,
             error: res.exceptionDetails ? (res.exceptionDetails.text || 'eval 异常') : null }
  } finally {
    try { await send('Target.closeTarget', { targetId: t.targetId }) } catch {}
  }
}

console.log('\n线上站点验证（GitHub Pages 生产环境）')
console.log('目标：' + BASE)
console.log('='.repeat(60))

// ---- 1. 首页 ----
console.log('\n--- 首页 ---')
{
  const r = await probe(BASE + '/', `document.querySelector('.VPNavBar')`, `
    var out = {
      title: document.title,
      nav: [].slice.call(document.querySelectorAll('.VPNavBar a')).map(function(a){return a.innerText.trim()}).filter(Boolean),
      cards: document.querySelectorAll('.dhj-card').length,
      hero: (document.querySelector('.VPHero .name .clip')||{}).innerText || '',
      canonical: (document.querySelector('link[rel=canonical]')||{}).href || '',
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      email: document.body.innerText.indexOf('mfujun@agent.qq.com') > -1,
    };
    return out;
  `)
  const v = r.value || {}
  ok('首页加载', r.ready)
  ok('标题为「电焊机.cn」', /电焊机/.test(v.title || ''), v.title)
  ok('导航 5 个栏目齐全', ['产品中心','文章资讯','解决方案','关于我们','联系我们'].every(n => (v.nav||[]).some(t => t.includes(n))))
  ok('产品卡片 ≥6', (v.cards || 0) >= 6, String(v.cards))
  ok('桌面无横向溢出', v.overflow === false)
  ok('邮箱露出', v.email === true)
}

// ---- 2. Mermaid 客户端渲染（关键） ----
console.log('\n--- Mermaid 渲染（客户端 JS）---')
for (const [label, p] of [
  ['产品详情页', '/products/mma-inverter'],
  ['首页', '/'],
  ['解决方案页', '/solutions/steel-structure'],
]) {
  const r = await probe(BASE + p, `document.querySelectorAll('svg').length > 0`, `
    await new Promise(function(s){setTimeout(s,2500)});
    var nodes = document.querySelectorAll('.mermaid');
    var svgs = document.querySelectorAll('.mermaid svg, svg[id^="mermaid"]');
    return {
      total: nodes.length,
      rendered: svgs.length,
      firstSvgLen: svgs[0] ? svgs[0].outerHTML.length : 0,
      hasFlowchartText: document.body.innerText.indexOf('确定焊接工艺') > -1
                      || document.body.innerText.indexOf('确认母材') > -1,
    };
  `, { timeout: 45000 })
  const v = r.value || {}
  ok(`${label}：Mermaid 画出 SVG`, (v.rendered || 0) >= 1,
     `节点 ${v.total} / 已渲染 ${v.rendered}` + (v.firstSvgLen ? ` / SVG ${v.firstSvgLen} 字节` : ''))
}

// ---- 3. 联系页表单（真浏览器交互） ----
console.log('\n--- 联系页表单（真浏览器）---')
{
  const r = await probe(BASE + '/contact',
    `window.__DHJ__ && typeof window.__DHJ__.submit === 'function'`, `
    var out = {};
    document.getElementById('f-name').value = '线上验证';
    document.getElementById('f-contact').value = '13800138000';
    document.getElementById('f-message').value = '这是线上环境的功能验证留言，请忽略。';
    window.__DHJ__.submit();
    await new Promise(function(s){setTimeout(s,800)});
    var el = document.getElementById('dhj-status');
    out.status = el.className;
    out.text = el.innerText;
    out.collected = window.__DHJ__.collect();
    // 必填校验
    document.getElementById('f-name').value = '';
    window.__DHJ__.submit();
    await new Promise(function(s){setTimeout(s,600)});
    out.errCount = document.querySelectorAll('.dhj-err').length;
    out.errTexts = [].slice.call(document.querySelectorAll('.dhj-err')).map(function(e){return e.textContent}).filter(Boolean);
    return out;
  `)
  const v = r.value || {}
  ok('表单脚本已挂载（hydration 成功）', r.ready)
  ok('提交后有反馈', /ok|info/.test(v.status || ''), (v.text || '').slice(0, 60))
  ok('字段收集完整', v.collected && v.collected.name === '线上验证')
  ok('必填校验拦截生效', (v.errTexts || []).length >= 2, `${(v.errTexts||[]).length} 条字段级提示`)
}

// ---- 4. 移动端 ----
console.log('\n--- 移动端 390px ---')
{
  const r = await probe(BASE + '/', `document.querySelector('.VPNavBar')`, `
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      cards: document.querySelectorAll('.dhj-card').length,
    };
  `, { width: 390, height: 844 })
  const v = r.value || {}
  ok('移动端无横向溢出', v.overflow === false)
  ok('移动端卡片可见', (v.cards || 0) >= 6)
}

// ---- 5. SEO 文件 ----
console.log('\n--- SEO 文件（线上）---')
for (const [label, p, expect] of [
  ['sitemap.xml', '/sitemap.xml', 'xn--nqv61tpnd.cn'],
  ['robots.txt', '/robots.txt', 'xn--nqv61tpnd.cn'],
]) {
  try {
    const res = await fetch(BASE + p, { redirect: 'follow' })
    const txt = await res.text()
    ok(`${label} 可访问且域名正确`, res.ok && txt.includes(expect),
       `HTTP ${res.status}, ${txt.length} 字节`)
  } catch (e) {
    ok(`${label} 可访问`, false, e.message)
  }
}

// ---- 汇总 ----
const fails = results.filter(([, p]) => !p).length
console.log('\n' + '='.repeat(60))
console.log(`线上验证：${results.length - fails}/${results.length} 通过` +
  (fails ? `  ❌ 失败 ${fails} 项` : '  ✅ 全部通过'))
console.log('='.repeat(60) + '\n')

try { browserWs.close() } catch {}
try { browser.kill() } catch {}
process.exit(0)
