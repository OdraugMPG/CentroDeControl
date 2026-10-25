import './env.js';
import express from 'express';
import { pool } from './db.js';
import { seed } from './seed.js';
import { autoTraspaso } from './services/continuidad.js';
import ops from './routes/ops.js';
import continuidad from './routes/continuidad.js';
import config from './routes/config.js';
import olas from './routes/olas.js';
import gestion from './routes/gestion.js';
import auth from './routes/auth.js';
import admin from './routes/admin.js';
import { proteger } from './lib/auth.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');   // detrás de Nginx/IIS en el mismo servidor: IP y https reales
app.use(express.json({ limit: '5mb' }));

// CORS: el frontend corre en otro origen (otra carpeta, otro puerto u otro servidor)
const origenes = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim()).filter(Boolean);
app.use((req, res, next) => {
  const o = req.get('origin');
  if (o && (origenes.includes('*') || origenes.includes(o))) {
    res.set('Access-Control-Allow-Origin', o);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-CC');
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Access-Control-Expose-Headers', 'Content-Disposition');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Toda la API exige sesión (salvo salud e inicio de sesión) y cada modificación, el permiso de su vista
app.use(proteger());

app.get('/api/salud', async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true, hora: new Date().toISOString(), zona: process.env.TZ });
});
app.use('/api/auth', auth);
app.use('/api/admin', admin);
app.use('/api', ops);
app.use('/api/continuidad', continuidad);
app.use('/api/config', config);
app.use('/api/olas', olas);
app.use('/api/gestion', gestion);
app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Error interno del servidor' : err.message });
});

const port = +process.env.PORT || 3000;
seed()   // aplica migraciones pendientes y catálogos base
  .then(() => {
    app.listen(port, () => console.log(`API del centro de control en http://localhost:${port}/api (zona ${process.env.TZ}, CORS: ${origenes.join(', ')})`));
    // Traspaso automático de tareas pendientes cada 5 minutos
    const tick = () => autoTraspaso().catch(e => console.error('Traspaso automático:', e.message));
    tick(); setInterval(tick, 5 * 60 * 1000);
  })
  .catch(e => { console.error('No se pudo preparar la base de datos:', e.message); process.exit(1); });
