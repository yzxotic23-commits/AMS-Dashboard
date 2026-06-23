import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

if (!process.env.VERCEL) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
}
