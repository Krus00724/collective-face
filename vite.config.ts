import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// the artifact is one self-contained page; the public site is an ordinary build on Vercel
export default defineConfig(({ mode }) => {
  const site = mode === 'site';
  return {
    plugins: [react(), ...(site ? [] : [viteSingleFile({ removeViteModuleLoader: true })])],
    publicDir: site ? 'public' : false,
    build: site
      ? { target: 'es2021', chunkSizeWarningLimit: 5000 }
      : { target: 'es2021', assetsInlineLimit: 100_000_000, cssCodeSplit: false, chunkSizeWarningLimit: 5000 },
  };
});
