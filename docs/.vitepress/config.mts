import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

const SITE = 'https://xn--nqv61tpnd.cn'
const NAME = '电焊机.cn'
const DESC = '电焊机.cn — 电焊机产品选型、技术参数与行业解决方案服务商'

/**
 * 部署路径前缀。
 * - 绑定自有域名（电焊机.cn）时为空，站点挂根目录。
 * - 走 GitHub Pages 默认地址 mfujun2025.github.io/dianhanji/ 时必须为 '/dianhanji/'，
 *   否则 VitePress 会输出 /assets/... 这类根相对路径，在子路径下必然 404。
 * CI 里通过环境变量 DEPLOY_BASE 注入，本地默认为空（对应自有域名）。
 */
const BASE = process.env.DEPLOY_BASE || '/'

/** 为每个页面自动输出 <link rel="canonical">（VitePress transformHead 钩子） */
function canonicalTags(pageData) {
  const rel = (pageData && pageData.relativePath) || 'index.md'
  let p = rel.replace(/index\.md$/, '').replace(/\.md$/, '')
  return [['link', { rel: 'canonical', href: SITE + '/' + p }]]
}

/**
 * 把 markdown / HTML 里的 @BASE@ 占位符在构建时替换为真实 base 前缀。
 *
 * 背景：VitePress 只重写 markdown 语法链接（[文本](/path)），
 * 对 markdown 中内嵌的 raw HTML（<a href="/products/xxx">）不做处理。
 * 子路径部署时这些链接会指向站点根目录而 404。
 *
 * 在源码里写 href="@BASE@/products/xxx"，由本插件在内存中替换，
 * 不修改磁盘上的源文件，本地 dev / 自有域名 / Pages 子路径三种场景都正确。
 */
function basePlaceholderPlugin(base: string) {
  const prefix = base.replace(/\/+$/, '') // '/' → '' ; '/dianhanji/' → '/dianhanji'
  return {
    name: 'dhj-base-placeholder',
    transform(code: string, id: string) {
      if (!code.includes('@BASE@')) return null
      return { code: code.replaceAll('@BASE@', prefix), map: null }
    },
  }
}

export default withMermaid(
  defineConfig({
    title: NAME,
    description: DESC,
    lang: 'zh-CN',
    base: BASE,
    cleanUrls: true,
    vite: {
      plugins: [basePlaceholderPlugin(BASE)],
    },
    sitemap: { hostname: SITE },
    transformHead: ({ pageData }) => canonicalTags(pageData),
    head: [
      ['meta', { name: 'viewport', content: 'width=device-width,initial-scale=1' }],
      ['meta', { name: 'keywords', content: '电焊机,逆变焊机,二保焊机,氩弧焊机,等离子切割机,焊接设备,电焊机厂家' }],
      ['meta', { name: 'author', content: NAME }],
      ['meta', { name: 'theme-color', content: '#C0392B' }],
      ['link', { rel: 'icon', href: BASE + 'favicon.svg', type: 'image/svg+xml' }],
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:site_name', content: NAME }],
      ['meta', { property: 'og:locale', content: 'zh_CN' }],
      ['meta', { property: 'og:title', content: NAME + ' — 电焊机产品与技术方案' }],
      ['meta', { property: 'og:description', content: DESC }],
      ['meta', { property: 'og:url', content: SITE + '/' }],
      ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
      ['script', { type: 'application/ld+json' }, JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: NAME,
        url: SITE,
        email: 'mfujun@agent.qq.com',
        description: DESC,
        address: { '@type': 'PostalAddress', addressLocality: '上海', addressRegion: '上海市', addressCountry: 'CN' },
      })],
    ],
    themeConfig: {
      siteTitle: NAME,
      nav: [
        { text: '首页', link: '/' },
        { text: '产品中心', link: '/products/' },
        { text: '文章资讯', link: '/articles/' },
        { text: '解决方案', link: '/solutions/' },
        { text: '关于我们', link: '/about' },
        { text: '联系我们', link: '/contact' },
      ],
      sidebar: {
        '/products/': [
          {
            text: '产品中心',
            items: [
              { text: '产品总览', link: '/products/' },
              { text: '逆变直流手工焊机', link: '/products/mma-inverter' },
              { text: '二氧化碳气保焊机', link: '/products/mig-mag' },
              { text: '氩弧焊机（TIG）', link: '/products/tig' },
              { text: '等离子切割机', link: '/products/plasma-cutter' },
              { text: '便携式家用焊机', link: '/products/portable' },
            ],
          },
        ],
        '/articles/': [
          {
            text: '文章资讯',
            items: [
              { text: '全部文章', link: '/articles/' },
              { text: '选型与参数', link: '/articles/#选型与参数' },
              { text: '焊接工艺', link: '/articles/#焊接工艺' },
              { text: '使用与维护', link: '/articles/#使用与维护' },
              { text: '行业动态', link: '/articles/#行业动态' },
            ],
          },
        ],
        '/solutions/': [
          {
            text: '行业解决方案',
            items: [
              { text: '全部方案', link: '/solutions/' },
              { text: '钢结构加工厂焊接方案', link: '/solutions/steel-structure' },
              { text: '压力容器与管道焊接方案', link: '/solutions/pressure-vessel' },
              { text: '汽车维修改装焊接方案', link: '/solutions/auto-repair' },
              { text: '装修与门窗加工焊接方案', link: '/solutions/decoration' },
            ],
          },
        ],
      },
      outline: { level: [2, 3], label: '本页目录' },
      search: { provider: 'local' },
      docFooter: { prev: '上一篇', next: '下一篇' },
      lastUpdated: { text: '最后更新于' },
      darkModeSwitchLabel: '深色模式',
      sidebarMenuLabel: '目录',
      returnToTopLabel: '回到顶部',
      footer: {
        message: '电焊机.cn — 焊接设备选型与技术内容平台',
        copyright: 'Copyright © 2026 电焊机.cn | 联系邮箱：mfujun@agent.qq.com',
      },
    },
  })
)
