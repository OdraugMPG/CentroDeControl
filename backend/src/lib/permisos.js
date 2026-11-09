// Catálogo de permisos (uno por vista, más algunas acciones), roles iniciales y reglas de la API.
// El frontend usa las mismas claves para mostrar u ocultar vistas; aquí se aplican en el servidor.

export const PERMISOS = [
  ['Operación', [
    ['op.resumen', 'Resumen'], ['op.almacenamiento', 'Por almacenar'], ['op.recepcion', 'Almacenado'],
    ['op.pedidos', 'Flujo de pedidos'], ['op.control', 'Control por hora'], ['op.cierre', 'Cierre de turno (ver)'],
    ['op.cierre.registrar', 'Cierre de turno: registrar causas y cerrar'], ['op.cierre.reabrir', 'Cierre de turno: reabrir un turno cerrado'], ['op.mapa', 'Pedidos por región'], ['op.olas', 'Simulador de olas']]],
  ['Gestión diaria', [
    ['gd.asignacion', 'Asignación del día (ver)'], ['gd.asignacion.config', 'Asignación del día: ver configuración (CD activos y reservadas)'],
    ['gd.asignacion.base', 'Asignación del día: cargar Base del inicio de la jornada'], ['gd.asignacion.generar', 'Asignación del día: generar y regenerar la asignación'], ['gd.tareas', 'Tareas'], ['gd.conciliacion', 'Conciliación'],
    ['gd.turno', 'Mi turno'], ['gd.cierre', 'Cierre por tareas'], ['gd.slow', 'Slow moving'], ['gd.abc', 'ABC / XYZ'],
    ['gd.optimizacion', 'Optimización ABC'], ['gd.osr', 'Abastecimiento OSR'], ['gd.participacion', 'Participación por CD']]],
  ['Continuidad', [
    ['co.panel', 'Panel'], ['co.turno', 'Mi turno'], ['co.calendario', 'Calendario'], ['co.asignar', 'Asignar y gestionar tareas'],
    ['co.equipo', 'Equipo'], ['co.dotacion', 'Dotación'], ['co.indicadores', 'Indicadores']]],
  ['Gestión de inventario', [
    ['co.inventario', 'Inventario CD (ver)'],
    ['co.inventario.cargar', 'Inventario CD: cargar programación de CE y resultado de la toma'], ['co.inventario.asignar', 'Inventario CD: asignar jefe de turno de la empresa y supervisor'],
    ['co.inventario.calendario', 'Inventario CD: ver programación y avance'], ['co.inventario.resultados', 'Inventario CD: ver resultados ERI / ERU y diferencias'],
    ['co.inventario.planificar', 'Calendario de planificación: reprogramar y quitar ubicaciones'],
    ['co.inventario.dashboard', 'Dashboard de inventario: ERI / ERU, resultado neto y absoluto, top de SKU y ABC / XYZ'],
    ['co.inventario.validacion', 'Validación de la toma: primera, segunda y tercera pasada']]],
  ['Datos', [['da.cargas', 'Cargas de extracciones'], ['da.configuracion', 'Metas, calendario y causas']]],
  ['Administración', [['ad.usuarios', 'Usuarios y roles'], ['gd.config', 'Configuración (CD, operarios, ubicaciones reservadas y parámetros de Gestión diaria)']]]
].map(([grupo, items]) => ({ grupo, items: items.map(([clave, nombre]) => ({ clave, nombre })) }));

export const CLAVES = new Set(PERMISOS.flatMap(g => g.items.map(i => i.clave)));
const de = pref => [...CLAVES].filter(c => c.startsWith(pref));

// Roles iniciales (editables en Administración, salvo Admin, que siempre tiene todo)
export const ROLES_BASE = [
  ['Admin', 'Administra usuarios y roles. Tiene acceso a todo.', [...CLAVES], true],
  ['Jefe de Operaciones', 'Opera y configura el CD: todas las vistas, sin administrar usuarios.', [...CLAVES].filter(c => c !== 'ad.usuarios'), false],
  ['Supervisor', 'Opera su turno: control, cierre, mi turno, inventario y cargas de extracciones.',
    [...de('op.'), 'gd.turno', 'gd.cierre', 'co.panel', 'co.turno', 'co.calendario', ...de('co.inventario'), 'da.cargas'].filter(c => c !== 'op.cierre.reabrir'), false],
  ['Gerente', 'Consulta resultados e indicadores, sin cargar ni modificar la operación.',
    [...de('op.'), 'gd.cierre', 'gd.slow', 'gd.abc', 'gd.optimizacion', 'gd.osr', 'gd.participacion', 'co.panel', 'co.calendario', 'co.indicadores'].filter(c => !['op.cierre.registrar', 'op.cierre.reabrir'].includes(c)), false]
];

// Reglas para las operaciones que modifican datos: [método, ruta, permisos (basta uno)].
// Las lecturas (GET) solo exigen sesión. Una modificación sin regla se rechaza.
const R = (metodo, ruta, ...permisos) => [metodo, new RegExp(`^/api${ruta}$`), permisos];
export const REGLAS = [
  // Operación
  R('PUT', '/cierres/[^/]+/[^/]+/(causas|jefe)', 'op.cierre.registrar'),
  R('POST', '/cierres/[^/]+/[^/]+/cerrar', 'op.cierre.registrar'),
  R('POST', '/cierres/[^/]+/[^/]+/reabrir', 'op.cierre.reabrir'),
  R('POST', '/cargas/olas', 'da.cargas', 'op.olas'),
  R('POST', '/cargas/[^/]+', 'da.cargas'),
  R('DELETE', '/cargas/[^/]+', 'da.cargas'),
  R('POST', '/olas/(pivot|detalle|consumo)', 'op.olas'),          // consultas con filtros en el cuerpo
  // Datos: metas, calendario, causas y parámetros
  R('(PUT|POST|PATCH)', '/config/.*', 'da.configuracion'),
  // Continuidad
  R('(POST|DELETE)', '/continuidad/personas(/[^/]+)?', 'co.equipo'),
  R('POST', '/continuidad/tareas(/grupo)?', 'co.asignar'),
  R('PATCH', '/continuidad/tareas/[^/]+', 'co.asignar', 'co.turno', 'co.panel'),
  R('DELETE', '/continuidad/tareas/[^/]+', 'co.asignar'),
  R('POST', '/continuidad/handovers', 'co.turno'),
  R('POST', '/continuidad/handovers/[^/]+/confirmar', 'co.turno', 'co.panel'),
  R('PUT', '/continuidad/dotacion', 'co.dotacion'),
  R('PUT', '/continuidad/asistencia', 'co.turno', 'co.dotacion'),
  R('POST', '/continuidad/inventario/importar', 'co.inventario.cargar'),
  R('PUT', '/continuidad/inventario/asignacion', 'co.inventario.asignar'),
  R('POST', '/continuidad/inventario/(reprogramar|quitar|restaurar)', 'co.inventario.planificar'),
  // Gestión diaria
  R('POST', '/gestion/cargas/inicio', 'gd.asignacion.base', 'da.cargas'),
  R('POST', '/gestion/asignaciones', 'gd.asignacion.generar'),
  R('POST', '/gestion/cargas/cierre', 'gd.conciliacion', 'da.cargas'),
  R('POST', '/gestion/avances/importar', 'gd.conciliacion'),
  R('PATCH', '/gestion/tareas/[^/]+', 'gd.tareas', 'gd.turno'),
  R('(POST|DELETE)', '/gestion/slow/.*', 'gd.slow'),
  R('(POST|DELETE)', '/gestion/abcxyz(/.*)?', 'gd.abc'),
  R('POST', '/gestion/participacion/.*', 'gd.participacion'),
  R('POST', '/gestion/optimizacion/(osr|abastecimiento|eventos)/.*', 'gd.osr'),
  R('POST', '/gestion/optimizacion/.*', 'gd.optimizacion'),
  R('(POST|PUT|DELETE)', '/gestion/config/.*', 'gd.config')
];

export function permisoRequerido(metodo, ruta) {
  for (const [m, re, permisos] of REGLAS) if (new RegExp(`^(${m})$`).test(metodo) && re.test(ruta)) return permisos;
  return null;
}
