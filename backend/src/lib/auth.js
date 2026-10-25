// Autenticación: contraseñas (scrypt), sesiones en cookie httpOnly y control de permisos por petición.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { q } from '../db.js';
import { CLAVES, permisoRequerido } from './permisos.js';

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'cc_sesion';
const DURACION_MS = 12 * 3600 * 1000;      // una sesión dura 12 h y se renueva mientras se use
const MAX_INTENTOS = 5, BLOQUEO_MIN = 15;  // 5 claves erradas bloquean la cuenta 15 minutos
export const CLAVE_MIN = 8;

export async function hashClave(clave) {
  const sal = crypto.randomBytes(16);
  const h = await scrypt(clave, sal, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${sal.toString('base64')}$${h.toString('base64')}`;
}

export async function verificarClave(clave, guardado) {
  const [alg, N, r, p, sal, hash] = String(guardado).split('$');
  if (alg !== 'scrypt') return false;
  const esperado = Buffer.from(hash, 'base64');
  const h = await scrypt(clave, Buffer.from(sal, 'base64'), esperado.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(h, esperado);
}

export function validarClave(clave) {
  if (typeof clave !== 'string' || clave.length < CLAVE_MIN) return `La contraseña debe tener al menos ${CLAVE_MIN} caracteres.`;
  if (clave.length > 200) return 'La contraseña es demasiado larga.';
  return null;
}

const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const leerCookie = req => {
  for (const par of (req.get('cookie') || '').split(';')) {
    const i = par.indexOf('=');
    if (i > 0 && par.slice(0, i).trim() === COOKIE) return decodeURIComponent(par.slice(i + 1).trim());
  }
  return null;
};
const opcionesCookie = req => {
  const segura = process.env.COOKIE_SECURE === 'true' || req.secure;
  return `Path=/; HttpOnly; SameSite=Lax${segura ? '; Secure' : ''}`;
};

export async function abrirSesion(req, res, usuarioId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await q('INSERT INTO sesiones (token_hash, usuario_id, expira, ip, agente) VALUES ($1,$2,$3,$4,$5)',
    [sha(token), usuarioId, new Date(Date.now() + DURACION_MS), req.ip, String(req.get('user-agent') || '').slice(0, 200)]);
  await q('UPDATE usuarios SET ultimo_acceso = now(), intentos = 0, bloqueado_hasta = NULL WHERE id = $1', [usuarioId]);
  q('DELETE FROM sesiones WHERE expira < now()').catch(() => {});
  res.set('Set-Cookie', `${COOKIE}=${token}; ${opcionesCookie(req)}; Max-Age=${DURACION_MS / 1000}`);
}

export async function cerrarSesion(req, res) {
  const t = leerCookie(req);
  if (t) await q('DELETE FROM sesiones WHERE token_hash = $1', [sha(t)]);
  res.set('Set-Cookie', `${COOKIE}=; ${opcionesCookie(req)}; Max-Age=0`);
}

// Intento de inicio de sesión. Devuelve el id o lanza un error genérico (no revela si el usuario existe).
export async function comprobarCredenciales(usuario, clave) {
  const malo = () => Object.assign(new Error('Usuario o contraseña incorrectos.'), { status: 401 });
  const { rows: [u] } = await q('SELECT id, clave_hash, activo, intentos, bloqueado_hasta FROM usuarios WHERE lower(usuario) = lower($1)', [String(usuario || '').trim()]);
  if (!u) { await verificarClave(String(clave), `scrypt$16384$8$1$${'A'.repeat(24)}$${'A'.repeat(88)}`).catch(() => {}); throw malo(); }
  if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date())
    throw Object.assign(new Error(`Cuenta bloqueada por intentos fallidos. Intenta de nuevo después de las ${new Date(u.bloqueado_hasta).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} h.`), { status: 429 });
  if (!(await verificarClave(String(clave || ''), u.clave_hash))) {
    const n = u.intentos + 1;
    await q('UPDATE usuarios SET intentos = $2, bloqueado_hasta = $3 WHERE id = $1',
      [u.id, n >= MAX_INTENTOS ? 0 : n, n >= MAX_INTENTOS ? new Date(Date.now() + BLOQUEO_MIN * 60000) : null]);
    throw malo();
  }
  if (!u.activo) throw Object.assign(new Error('Tu cuenta está desactivada. Habla con el administrador.'), { status: 403 });
  return u.id;
}

// Usuario de la sesión, con su rol, permisos y la persona del Equipo vinculada
async function usuarioDeSesion(req) {
  const t = leerCookie(req);
  if (!t) return null;
  const { rows: [u] } = await q(`SELECT s.expira, u.id, u.usuario, u.nombre, u.cambiar_clave, u.persona_id,
      r.nombre AS rol, r.sistema, r.permisos, p.rol AS persona_rol, p.turno_id AS persona_turno
    FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id JOIN roles r ON r.id = u.rol_id
    LEFT JOIN personas p ON p.id = u.persona_id AND p.activo
    WHERE s.token_hash = $1 AND s.expira > now() AND u.activo`, [sha(t)]);
  if (!u) return null;
  // Renovación: si quedan menos de 6 h, la sesión se extiende otras 12 h
  if (new Date(u.expira) - Date.now() < DURACION_MS / 2) await q('UPDATE sesiones SET expira = $2 WHERE token_hash = $1', [sha(t), new Date(Date.now() + DURACION_MS)]);
  return {
    id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, sistema: u.sistema, cambiarClave: u.cambiar_clave,
    permisos: new Set(u.sistema ? CLAVES : u.permisos.filter(c => CLAVES.has(c))),
    persona: u.persona_rol ? { id: u.persona_id, rol: u.persona_rol, turno_id: u.persona_turno } : null
  };
}

export const publico = u => ({ ...u, permisos: [...u.permisos] });
export const puede = (u, ...permisos) => !!u && permisos.some(p => u.permisos.has(p));

const LIBRES = new Set(['/api/salud', '/api/auth/estado', '/api/auth/login', '/api/auth/primer-admin']);
const SOLO_CUENTA = /^\/api\/auth\//;   // con clave temporal solo se puede cambiar la clave o salir

// Middleware: exige sesión en toda la API y el permiso de la vista en cada modificación
export function proteger() {
  return async (req, res, next) => {
    try {
      const ruta = req.path;
      if (!ruta.startsWith('/api/')) return next();
      const modifica = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      // Defensa contra CSRF: las modificaciones deben traer el encabezado X-CC, que otro sitio no puede
      // agregar sin pasar el control de CORS (además la cookie es SameSite=Lax)
      if (modifica && req.get('x-cc') !== '1') return res.status(403).json({ error: 'Solicitud no autorizada.' });
      if (LIBRES.has(ruta)) return next();
      req.usuario = await usuarioDeSesion(req);
      req.sesion = req.usuario && sha(leerCookie(req));
      if (!req.usuario) return res.status(401).json({ error: 'Inicia sesión para continuar.', sesion: false });
      if (req.usuario.cambiarClave && !SOLO_CUENTA.test(ruta))
        return res.status(403).json({ error: 'Debes cambiar tu contraseña temporal antes de continuar.', cambiarClave: true });
      if (!modifica || SOLO_CUENTA.test(ruta)) return next();
      if (ruta.startsWith('/api/admin/')) return puede(req.usuario, 'ad.usuarios') ? next() : res.status(403).json({ error: 'No tienes permiso para administrar usuarios.' });
      const req_ = permisoRequerido(req.method, ruta);
      if (!req_) { console.warn(`Modificación sin regla de permisos: ${req.method} ${ruta}`); return res.status(403).json({ error: 'Operación no permitida.' }); }
      if (!puede(req.usuario, ...req_)) return res.status(403).json({ error: 'Tu rol no tiene permiso para esta acción.' });
      next();
    } catch (e) { next(e); }
  };
}
