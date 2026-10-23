import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

// GitHub Pages 项目站部署在 /<repo>/ 子路径；用户站（<user>.github.io）才是 /。
// 部署工作流通过 VITE_BASE 注入，本地 dev / preview 保持根路径不变。
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    // Editors write atomic-save temp dirs next to the target file; watching
    // them on Windows throws EBUSY and kills the dev server.
    watch: { ignored: ['**/.*.tmpdir/**', '**/*.tmp', '**/.npm-cache/**', '**/dist/**'] },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
    // CI runners are ~4x slower than a dev box. Several solvability tests run
    // the greedy bot over every contract level, which is tens of seconds of
    // uninterrupted synchronous work per test.
    pool: 'forks',
    poolOptions: {
      forks: { maxForks: 2, minForks: 1 },
    },
    // The bot tests are legitimately slow; per-test budgets already exist, but
    // keep the hook budget generous so a cold runner never trips it.
    hookTimeout: 120_000,
  },
});
