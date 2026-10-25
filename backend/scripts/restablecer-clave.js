// Recuperación de acceso desde el servidor, por si el administrador olvidó su contraseña o quedó bloqueado:
//   npm run usuarios:clave -- <usuario> <contraseña temporal>
// Deja la contraseña como temporal (se pide cambiarla al entrar), desbloquea y reactiva la cuenta y cierra sus sesiones.
import { pool, q } from '../src/db.js';
import { hashClave, validarClave } from '../src/lib/auth.js';

const [usuario, clave] = process.argv.slice(2);
try {
  if (!usuario || !clave) throw new Error('Uso: npm run usuarios:clave -- <usuario> <contraseña temporal>');
  const err = validarClave(clave); if (err) throw new Error(err);
  const { rows: [u] } = await q(`UPDATE usuarios SET clave_hash = $2, cambiar_clave = true, intentos = 0, bloqueado_hasta = NULL, activo = true
    WHERE lower(usuario) = lower($1) RETURNING id, nombre`, [usuario, await hashClave(clave)]);
  if (!u) {
    const { rows } = await q('SELECT usuario FROM usuarios ORDER BY usuario');
    throw new Error(`No existe el usuario "${usuario}".${rows.length ? ` Usuarios: ${rows.map(r => r.usuario).join(', ')}` : ' Aún no hay cuentas: créalas desde la web.'}`);
  }
  await q('DELETE FROM sesiones WHERE usuario_id = $1', [u.id]);
  console.log(`Contraseña temporal asignada a ${u.nombre}. Deberá cambiarla al entrar.`);
} catch (e) { console.error(e.message); process.exitCode = 1; }
await pool.end();
