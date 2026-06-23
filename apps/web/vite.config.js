import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env dari root monorepo (AMS Project/.env)
const envDir = path.resolve(__dirname, '../..');

export default defineConfig({
  plugins: [react()],
  envDir,
  server: {
    port: 3000,
    strictPort: true,
  },
});
