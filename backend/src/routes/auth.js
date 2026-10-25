// Cuenta propia: inicio y cierre de sesión, primer administrador y cambio de contraseña.
import { Router } from 'express';
import { q, tx } from '../db.js';
import { abrirSesion, cerrarSesion, comprobarCredenciales, hashClave, verificarClave, validarClave, publico } from '../lib/auth.js';
import { ah, bad, texto } from './util.js';

const r = Router();

// ¿Hay cuentas? Si no, el frontend muestra la creación del primer administrador.
r.get('/estado', ah(async (req, res) => {
  const { rows: [x] } = await q('SELECT count(*) AS n FROM usuarios');
  res.json({ configurado: x.n > 0 });
}));

// Solo funciona mientras no exista ninguna cuenta
r.post('/primer-admin', ah(async (req, res) => {
  const usuario = texto(req.body.usuario, 60), nombre = texto(req.body.nombre, 120), clave = req.body.clave;
  if (!usuario || !nombre) throw bad('Completa el usuario y el nombre.');
  const err = validarClave(clave); if (err) throw bad(err);
  const hash = await hashClave(clave);
  const id = await tx(async c => {
    await c.query('LOCK TABLE usuarios IN EXCLUSIVE MODE');
    if ((await c.query('SELECT 1 FROM usuarios LIMIT 1')).rowCount) throw bad('Ya hay cuentas creadas: inicia sesión.', 409);
    const { rows: [rol] } = await c.query('SELECT id FROM roles WHERE sistema LIMIT 1');
    return (await c.query('INSERT INTO usuarios (usuario, nombre, clave_hash, rol_id) VALUES ($1,$2,$3,$4) RETURNING id', [usuario, nombre, hash, rol.id])).rows[0].id;
  });
  await abrirSesion(req, res, id);
  res.status(201).json({ ok: true });
}));

r.post('/login', ah(async (req, res) => {
  const id = await comprobarCredenciales(req.body?.usuario, req.body?.clave);
  await abrirSesion(req, res, id);
  res.json({ ok: true });
}));

r.post('/logout', ah(async (req, res) => { await cerrarSesion(req, res); res.json({ ok: true }); }));

r.get('/yo', ah(async (req, res) => { res.set('Cache-Control', 'no-store').json(publico(req.usuario)); }));

r.post('/clave', ah(async (req, res) => {
  const { actual, nueva } = req.body || {};
  const err = validarClave(nueva); if (err) throw bad(err);
  const { rows: [u] } = await q('SELECT clave_hash FROM usuarios WHERE id = $1', [req.usuario.id]);
  if (!(await verificarClave(String(actual || ''), u.clave_hash))) throw bad('La contraseña actual no es correcta.');
  if (actual === nueva) throw bad('La nueva contraseña debe ser distinta de la actual.');
  await q('UPDATE usuarios SET clave_hash = $2, cambiar_clave = false WHERE id = $1', [req.usuario.id, await hashClave(nueva)]);
  // Cierra las otras sesiones abiertas con la clave anterior
  await q('DELETE FROM sesiones WHERE usuario_id = $1 AND token_hash <> $2', [req.usuario.id, req.sesion]);
  res.json({ ok: true });
}));

export default r;
