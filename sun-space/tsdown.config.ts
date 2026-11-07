import { defineConfig } from 'tsdown'

/**
 * sun-space 构建配置：四个宿主插件入口各自打包为 lib/*.js（ESM，external cordis）。
 * npx 安装的 @deepseek-ai/dsh 不带 tsx，插件必须以构建后的 JS 加载（对齐官方原型发布形态）。
 * client.js（浏览器半）是纯 JS，由宿主 client-modules 系统直接 serve，不参与此构建。
 */
export default defineConfig([
  { entry: 'src/index.ts', outDir: 'lib', format: 'esm', platform: 'node', external: ['@deepseek-ai/cordis'] },
  { entry: 'src/router-tools.ts', outDir: 'lib', format: 'esm', platform: 'node', external: ['@deepseek-ai/cordis'] },
  { entry: 'src/worker-guard.ts', outDir: 'lib', format: 'esm', platform: 'node', external: ['@deepseek-ai/cordis'] },
  { entry: 'src/worker-vault.ts', outDir: 'lib', format: 'esm', platform: 'node', external: ['@deepseek-ai/cordis'] },
])
