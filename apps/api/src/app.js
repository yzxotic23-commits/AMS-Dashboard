import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import v1Router from './routes/v1/index.js';

const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '8mb' }));

app.use('/api/v1', v1Router);

app.use((err, _req, res, _next) => {
  console.error('[API Error]', err.message);
  const status = err.status || err.statusCode || (err.code === 'PGRST116' ? 404 : 500);
  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

export default app;
