import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { ZodError } from 'zod';
import v1Router from './routes/v1/index.js';
import { ipAllowlistGate } from './lib/ipAllowlist.js';

const app = express();

app.use(helmet());
const defaultOrigins = ['http://localhost:3000', 'http://localhost:5173'];
const vercelOrigin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
const corsOrigins = process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()).filter(Boolean)
  || (vercelOrigin ? [...defaultOrigins, vercelOrigin] : defaultOrigins);

app.use(cors({
  origin: corsOrigins,
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '8mb' }));

app.use('/api/v1', ipAllowlistGate, v1Router);

app.use((err, _req, res, _next) => {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const field = first?.path?.length ? first.path.join('.') : 'input';
    const message = first?.message || 'Validation failed';
    return res.status(400).json({ error: `${field}: ${message}` });
  }
  console.error('[API Error]', err.message);
  const status = err.status || err.statusCode || (err.code === 'PGRST116' ? 404 : 500);
  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

export default app;
