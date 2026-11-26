import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    publicDir: false as const,
    plugins: [
      {
        name: 'copy-static-library-assets',
        apply: 'build' as const,
        closeBundle(error?: Error): void {
          if (error) return;
          const distDir = path.resolve(__dirname, 'dist');
          const folders = ['css', 'js', 'data', 'public/ebooks', 'src/assets'];
          for (const folder of folders) {
            const srcPath = path.resolve(__dirname, folder);
            const destPath = path.resolve(distDir, folder);
            if (fs.existsSync(distDir) && fs.existsSync(srcPath)) {
              fs.cpSync(srcPath, destPath, { recursive: true, force: true });
            }
          }
        },
      },
    ],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
