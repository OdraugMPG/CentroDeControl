// Vistas y permisos (las claves son las de backend/src/lib/permisos.js, que además los aplica en la API).
// Una vista puede pedir una lista de permisos: basta con tener uno.
// Una vista puede tener un 4.º elemento: permisos que la abren desde un enlace de otro módulo sin mostrarla en el menú.
// Datos, Cargas sale en el menú solo con da.cargas; quien pueda cargar algún archivo de su módulo la abre desde el botón
// "(en Datos)" de ese módulo y ve solo sus tarjetas (cada tarjeta pide el suyo).
const CARGAS = ['da.cargas', 'gd.asignacion.base', 'gd.conciliacion', 'gd.abc', 'gd.config', 'gd.osr', 'gd.participacion', 'gd.slow', 'co.inventario.cargar'];
export const MODULOS = [
  ['ctl', 'Operación', [
    ['/', 'Resumen', 'op.resumen'], ['/almacenamiento', 'Por almacenar', 'op.almacenamiento'], ['/recepcion', 'Almacenado', 'op.recepcion'],
    ['/pedidos', 'Flujo de pedidos', 'op.pedidos'], ['/control', 'Control por hora', 'op.control'], ['/cierre', 'Cierre de turno', 'op.cierre'],
    ['/mapa', 'Pedidos por región', 'op.mapa'], ['/olas', 'Simulador de olas', 'op.olas']]],
  ['gd', 'Gestión diaria', [
    ['/gestion', 'Asignación del día', 'gd.asignacion'], ['/gestion/tareas', 'Tareas', 'gd.tareas'], ['/gestion/conciliacion', 'Conciliación', 'gd.conciliacion'],
    ['/gestion/turno', 'Mi turno', 'gd.turno'], ['/gestion/cierre', 'Cierre por tareas', 'gd.cierre']]],
  // Sloting: las vistas siguen en /gestion y con sus permisos de Gestión diaria
  ['slot', 'Sloting', [
    ['/gestion/slow', 'Slow moving', 'gd.slow'], ['/gestion/abc', 'ABC / XYZ', 'gd.abc'], ['/gestion/optimizacion', 'Optimización ABC', 'gd.optimizacion'],
    ['/gestion/osr', 'Abastecimiento OSR', 'gd.osr'], ['/gestion/participacion', 'Participación por CD', 'gd.participacion']]],
  ['cont', 'Continuidad', [
    ['/continuidad', 'Panel', 'co.panel'], ['/continuidad/turno', 'Mi turno', 'co.turno'], ['/continuidad/calendario', 'Calendario', 'co.calendario'],
    ['/continuidad/asignar', 'Asignar', 'co.asignar'], ['/continuidad/equipo', 'Equipo', 'co.equipo'], ['/continuidad/dotacion', 'Dotación', 'co.dotacion'],
    ['/continuidad/indicadores', 'Indicadores', 'co.indicadores']]],
  ['inv', 'Gestión de inventario', [
    ['/inventario/dashboard', 'Dashboard', 'co.inventario.dashboard'], ['/inventario/validacion', 'Validación de la toma', 'co.inventario.validacion'],
    ['/inventario/comparacion', 'Toma CE vs operación', 'co.inventario.comparacion'],
    ['/inventario', 'Inventario CD', 'co.inventario'], ['/inventario/calendario', 'Calendario de planificación', 'co.inventario.calendario']]],
  ['cfg', 'Datos', [['/cargas', 'Cargas de archivos', 'da.cargas', CARGAS], ['/configuracion', 'Metas y calendario', 'da.configuracion']]],
  ['adm', 'Administración', [['/admin/usuarios', 'Usuarios', 'ad.usuarios'], ['/admin/roles', 'Roles y permisos', 'ad.usuarios'],
    // la configuración de Gestión diaria (CD, operarios, reservadas, parámetros) se administra aquí; su ruta sigue en /gestion
    ['/gestion/config', 'Configuración', 'gd.config']]]
];

export const puede = (u, ...permisos) => !!u && permisos.flat().some(p => u.permisos?.includes(p));
export const vistasDe = (u, modulo) => MODULOS.find(m => m[0] === modulo)[2].filter(v => puede(u, v[2]));
export const abreVista = (u, v) => puede(u, v[3] || v[2]);

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
