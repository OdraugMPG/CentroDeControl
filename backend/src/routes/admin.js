// Administración: cuentas de usuario y roles con sus permisos por vista. Exige el permiso ad.usuarios.
import { Router } from 'express';
import { q, tx } from '../db.js';
import { hashClave, validarClave, puede } from '../lib/auth.js';
import { PERMISOS, CLAVES } from '../lib/permisos.js';
import { ah, bad, texto } from './util.js';

const r = Router();
r.use((req, res, next) => puede(req.usuario, 'ad.usuarios') ? next() : res.status(403).json({ error: 'No tienes permiso para administrar usuarios.' }));

const persona = async id => {
  if (id == null || id === '') return null;
  const { rows: [p] } = await q('SELECT id FROM personas WHERE id = $1 AND activo', [+id]);
  if (!p) throw bad('La persona del Equipo no existe o está dada de baja.');
  return p.id;
};
const rol = async id => {
  const { rows: [x] } = await q('SELECT id, sistema FROM roles WHERE id = $1', [+id]);
  if (!x) throw bad('Rol no encontrado.');
  return x;
};
// Siempre debe quedar al menos un administrador activo
async function quedaAdmin(c, sinUsuario) {
  const { rows: [x] } = await c.query(`SELECT count(*) AS n FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE r.sistema AND u.activo AND u.id <> $1`, [sinUsuario]);
  if (!x.n) throw bad('Debe quedar al menos un administrador activo.', 409);
}
const duplicado = e => { if (e.code === '23505') throw bad('Ese nombre de usuario ya existe.', 409); throw e; };

r.get('/permisos', ah(async (req, res) => res.json(PERMISOS)));

// ---------- Usuarios ----------
r.get('/usuarios', ah(async (req, res) => {
  res.json((await q(`SELECT u.id, u.usuario, u.nombre, u.rol_id, r.nombre AS rol, r.sistema, u.persona_id, p.nombre AS persona,
      p.rol AS persona_rol, p.turno_id AS persona_turno, u.activo, u.cambiar_clave, u.ultimo_acceso, u.creado_en,
      (u.bloqueado_hasta > now()) AS bloqueado
    FROM usuarios u JOIN roles r ON r.id = u.rol_id LEFT JOIN personas p ON p.id = u.persona_id
    ORDER BY u.activo DESC, u.nombre`)).rows);
}));

r.post('/usuarios', ah(async (req, res) => {
  const b = req.body || {};
  const usuario = texto(b.usuario, 60), nombre = texto(b.nombre, 120);
  if (!usuario || !/^[\w.@-]+$/.test(usuario)) throw bad('El usuario solo admite letras, números, punto, guion, guion bajo y @.');
  if (!nombre) throw bad('Ingresa el nombre.');
  const err = validarClave(b.clave); if (err) throw bad(err);
  const ro = await rol(b.rol_id), per = await persona(b.persona_id);
  try {
    const { rows: [u] } = await q(`INSERT INTO usuarios (usuario, nombre, clave_hash, rol_id, persona_id, cambiar_clave)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [usuario, nombre, await hashClave(b.clave), ro.id, per, b.cambiar_clave !== false]);
    res.status(201).json(u);
  } catch (e) { duplicado(e); }
}));

r.patch('/usuarios/:id', ah(async (req, res) => {
  const id = +req.params.id, b = req.body || {};
  await tx(async c => {
    const { rows: [u] } = await c.query('SELECT * FROM usuarios WHERE id = $1 FOR UPDATE', [id]);
    if (!u) throw bad('Usuario no encontrado.', 404);
    const nuevo = {
      nombre: b.nombre !== undefined ? texto(b.nombre, 120) : u.nombre,
      usuario: b.usuario !== undefined ? texto(b.usuario, 60) : u.usuario,
      rol_id: b.rol_id !== undefined ? (await rol(b.rol_id)).id : u.rol_id,
      persona_id: b.persona_id !== undefined ? await persona(b.persona_id) : u.persona_id,
      activo: b.activo !== undefined ? !!b.activo : u.activo
    };
    if (!nuevo.nombre || !nuevo.usuario || !/^[\w.@-]+$/.test(nuevo.usuario)) throw bad('Revisa el usuario y el nombre.');
    const { rows: [rn] } = await c.query('SELECT sistema FROM roles WHERE id = $1', [nuevo.rol_id]);
    if (!rn.sistema || !nuevo.activo) await quedaAdmin(c, id);
    try {
      await c.query('UPDATE usuarios SET nombre=$2, usuario=$3, rol_id=$4, persona_id=$5, activo=$6, intentos = CASE WHEN $6 THEN 0 ELSE intentos END, bloqueado_hasta = CASE WHEN $6 THEN NULL ELSE bloqueado_hasta END WHERE id=$1',
        [id, nuevo.nombre, nuevo.usuario, nuevo.rol_id, nuevo.persona_id, nuevo.activo]);
    } catch (e) { duplicado(e); }
    if (!nuevo.activo) await c.query('DELETE FROM sesiones WHERE usuario_id = $1', [id]);
  });
  res.json({ ok: true });
}));

// Contraseña temporal: la persona debe cambiarla al entrar. Cierra sus sesiones abiertas.
r.post('/usuarios/:id/clave', ah(async (req, res) => {
  const err = validarClave(req.body?.clave); if (err) throw bad(err);
  const { rowCount } = await q('UPDATE usuarios SET clave_hash = $2, cambiar_clave = true, intentos = 0, bloqueado_hasta = NULL WHERE id = $1',
    [+req.params.id, await hashClave(req.body.clave)]);
  if (!rowCount) throw bad('Usuario no encontrado.', 404);
  await q('DELETE FROM sesiones WHERE usuario_id = $1 AND token_hash <> $2', [+req.params.id, req.sesion]);
  res.json({ ok: true });
}));

// ---------- Roles ----------
const limpiar = ps => [...new Set((Array.isArray(ps) ? ps : []).filter(p => CLAVES.has(p)))];

r.get('/roles', ah(async (req, res) => {
  res.json((await q(`SELECT r.*, (SELECT count(*) FROM usuarios u WHERE u.rol_id = r.id AND u.activo) AS usuarios FROM roles r ORDER BY r.sistema DESC, r.nombre`)).rows
    .map(x => x.sistema ? { ...x, permisos: [...CLAVES] } : x));
}));

r.post('/roles', ah(async (req, res) => {
  const nombre = texto(req.body.nombre, 60); if (!nombre) throw bad('Ingresa el nombre del rol.');
  try {
    const { rows: [x] } = await q('INSERT INTO roles (nombre, descripcion, permisos) VALUES ($1,$2,$3) RETURNING *',
      [nombre, texto(req.body.descripcion, 300) || '', limpiar(req.body.permisos)]);
    res.status(201).json(x);
  } catch (e) { if (e.code === '23505') throw bad('Ya existe un rol con ese nombre.', 409); throw e; }
}));

r.put('/roles/:id', ah(async (req, res) => {
  const x = await rol(req.params.id);
  if (x.sistema) throw bad('El rol Admin tiene siempre todos los permisos y no se modifica.', 409);
  const nombre = texto(req.body.nombre, 60); if (!nombre) throw bad('Ingresa el nombre del rol.');
  try {
    await q('UPDATE roles SET nombre = $2, descripcion = $3, permisos = $4 WHERE id = $1',
      [x.id, nombre, texto(req.body.descripcion, 300) || '', limpiar(req.body.permisos)]);
  } catch (e) { if (e.code === '23505') throw bad('Ya existe un rol con ese nombre.', 409); throw e; }
  res.json({ ok: true });
}));

r.delete('/roles/:id', ah(async (req, res) => {
  const x = await rol(req.params.id);
  if (x.sistema) throw bad('El rol Admin no se puede eliminar.', 409);
  const { rows: [n] } = await q('SELECT count(*) AS n FROM usuarios WHERE rol_id = $1', [x.id]);
  if (n.n) throw bad(`Hay ${n.n} usuario(s) con este rol: cámbialos de rol antes de eliminarlo.`, 409);
  await q('DELETE FROM roles WHERE id = $1', [x.id]);
  res.json({ ok: true });
}));

export default r;
