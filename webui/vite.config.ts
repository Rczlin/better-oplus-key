import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

// 产物直接输出到模块目录 module/webroot，供 KSU 管理器 WebView 加载。
// base 为相对路径：页面由本地文件加载，不能依赖根路径。
// target 与 Tailwind v4 的最低浏览器要求一致（Chrome 111）。
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: '../module/webroot',
    emptyOutDir: true,
    target: 'chrome111',
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
  },
})
