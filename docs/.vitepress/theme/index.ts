// VitePress 主题入口
//
// 说明：vitepress-plugin-mermaid 通过「字符串匹配 patch vitepress 内部 app/index.js」
// 来全局注册 <Mermaid> 组件。该做法对 VitePress 版本敏感，实测在 v1.0.0 下
// 注入未生效 → markdown 里的 <Mermaid> 被当作未知标签丢弃，图不渲染。
// 因此这里改为在主题层「显式注册」该组件，稳定且与插件版本解耦。
import DefaultTheme from 'vitepress/theme'
import Mermaid from 'vitepress-plugin-mermaid/Mermaid.vue'
import './index.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Mermaid', Mermaid)
  },
}
