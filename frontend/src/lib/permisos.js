// Vistas y permisos (las claves son las de backend/src/lib/permisos.js, que además los aplica en la API)
export const MODULOS = [
  ['ctl', 'Operación', [
    ['/', 'Resumen', 'op.resumen'], ['/recepcion', 'Recepción', 'op.recepcion'], ['/almacenamiento', 'Almacenamiento', 'op.almacenamiento'],
    ['/pedidos', 'Flujo de pedidos', 'op.pedidos'], ['/control', 'Control por hora', 'op.control'], ['/cierre', 'Cierre de turno', 'op.cierre'],
    ['/mapa', 'Pedidos por región', 'op.mapa'], ['/olas', 'Simulador de olas', 'op.olas']]],
  ['gd', 'Gestión diaria', [
    ['/gestion', 'Asignación del día', 'gd.asignacion'], ['/gestion/tareas', 'Tareas', 'gd.tareas'], ['/gestion/conciliacion', 'Conciliación', 'gd.conciliacion'],
    ['/gestion/turno', 'Mi turno', 'gd.turno'], ['/gestion/cierre', 'Cierre por tareas', 'gd.cierre'], ['/gestion/slow', 'Slow moving', 'gd.slow'],
    ['/gestion/abc', 'ABC / XYZ', 'gd.abc'], ['/gestion/optimizacion', 'Optimización ABC', 'gd.optimizacion'], ['/gestion/osr', 'Abastecimiento OSR', 'gd.osr'], ['/gestion/participacion', 'Participación por CD', 'gd.participacion'], ['/gestion/config', 'Configuración', 'gd.config']]],
  ['cont', 'Continuidad', [
    ['/continuidad', 'Panel', 'co.panel'], ['/continuidad/turno', 'Mi turno', 'co.turno'], ['/continuidad/calendario', 'Calendario', 'co.calendario'],
    ['/continuidad/asignar', 'Asignar', 'co.asignar'], ['/continuidad/equipo', 'Equipo', 'co.equipo'], ['/continuidad/dotacion', 'Dotación', 'co.dotacion'],
    ['/continuidad/inventario', 'Inventario CD', 'co.inventario'], ['/continuidad/indicadores', 'Indicadores', 'co.indicadores']]],
  ['cfg', 'Datos', [['/cargas', 'Cargas de extracciones', 'da.cargas'], ['/configuracion', 'Metas y calendario', 'da.configuracion']]],
  ['adm', 'Administración', [['/admin/usuarios', 'Usuarios', 'ad.usuarios'], ['/admin/roles', 'Roles y permisos', 'ad.usuarios']]]
];

export const puede = (u, ...permisos) => !!u && permisos.some(p => u.permisos?.includes(p));
export const vistasDe = (u, modulo) => MODULOS.find(m => m[0] === modulo)[2].filter(v => puede(u, v[2]));

// Módulo y vista de una ruta (la más específica que coincide)
export function vistaDe(ruta) {
  let mejor = null;
  for (const [mod, , vistas] of MODULOS) for (const v of vistas) {
    const ok = v[0] === '/' ? ruta === '/' : ruta === v[0] || ruta.startsWith(v[0] + '/');
    if (ok && (!mejor || v[0].length > mejor.vista[0].length)) mejor = { modulo: mod, vista: v };
  }
  return mejor;
}

export const primeraRuta = u => MODULOS.flatMap(m => m[2]).find(v => puede(u, v[2]))?.[0] || null;
