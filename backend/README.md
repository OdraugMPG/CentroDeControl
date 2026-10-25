# Backend: centro de control del CD

API Node.js + Express sobre PostgreSQL. Expone los datos del centro de control (recepción, almacenamiento, flujo de pedidos, control por hora, cierre de turno y simulador de olas), de Gestión Diaria (proyecto GestionOperaciones) y de Continuidad Operacional.

## Requisitos

- Node.js 20 o superior
- PostgreSQL 14 o superior

## Instalación

```bash
npm install
cp .env.example .env     # completa DATABASE_URL y CORS_ORIGIN
npm run db:demo          # opcional: crea tablas y carga datos de demostración
npm run dev              # desarrollo, se reinicia al guardar
npm start                # producción
```

Al arrancar, el servidor aplica las migraciones pendientes y carga los catálogos base (turnos, calendario, etapas, metas, causas y parámetros), sin pisar lo que ya esté configurado.

| Script | Qué hace |
|---|---|
| `npm run db:migrate` | Aplica las migraciones de `migrations/` |
| `npm run db:seed` | Migraciones + catálogos base |
| `npm run db:demo` | Datos de demostración en una base vacía (`-- --borrar` para reemplazar los existentes) |

## Variables de entorno

| Variable | Ejemplo | Uso |
|---|---|---|
| `PORT` | `3000` | Puerto de la API |
| `DATABASE_URL` | `postgres://usuario:clave@localhost:5432/centro_control` | Conexión a PostgreSQL |
| `TZ` | `America/Santiago` | Zona horaria de turnos y días operativos |
| `CORS_ORIGIN` | `http://localhost:5173` | Orígenes del frontend autorizados, separados por coma |

## Estructura

```
migrations/001_esquema.sql     Tablas
src/index.js                   Express, CORS, traspaso automático de tareas cada 5 min
src/lib/turnos.js              Día operativo, calendario, turno actual y siguiente
src/lib/catalogos.js           Caché de turnos, etapas, metas, causas y parámetros
src/import/                    Lectura de extracciones .xlsx/.csv y plantillas
src/services/control.js        Control por hora (producción contra meta)
src/services/cierre.js         Informe de cierre, causas, Pareto y evidencia
src/services/continuidad.js    Estado de tareas, traspaso e indicadores
src/services/snapshot.js       Foto en vivo para el panel
src/routes/                    Rutas de la API
src/gestion/                   Gestión Diaria: motor (engine/) y servicios, con su propio pool sobre el esquema "gestion"
data/muestra/                  Extracción real usada en la demostración (no se versiona: contiene datos reales)
```

## API principal

| Ruta | Descripción |
|---|---|
| `GET /api/salud` | Estado del servidor y la base |
| `GET /api/meta` | Catálogos y turno en curso |
| `GET /api/ops/snapshot` | Foto completa del panel (el frontend la pide cada 5 min) |
| `GET /api/control?fecha=&turno=` | Producción por etapa y hora (`turno=dia` para el día completo) |
| `GET /api/cierres/:fecha/:turno` | Informe de cierre de un turno |
| `PUT /api/cierres/:fecha/:turno/causas` | Registrar causas de desvío |
| `POST /api/cierres/:fecha/:turno/cerrar` | Cerrar el turno (valida jefe y causas) |
| `GET /api/cierres/pareto?desde=&hasta=` | Causas acumuladas por turno y jefe |
| `POST /api/cargas/:tipo` | Subir extracción: `pedidos`, `recepcion`, `almacenamiento` u `olas` (campo `archivo`) |
| `GET /api/olas` | Simulador de olas: carga vigente, campos y valores de cada segmentador |
| `POST /api/olas/pivot` | Tabla dinámica `{filtros: {campo: [valores]}, filas, columnas, medida}` con totales; `medida`: `qty`, `lineas`, `od` o `sku` |
| `POST /api/olas/detalle` | Líneas que cumplen `{filtros}` (máximo 500) |
| `GET /api/cargas/plantilla/:tipo` | Plantilla Excel de recepción o almacenamiento |
| `/api/gestion/*` | Gestión Diaria: Base de stock, asignación diaria, tareas, conciliación, cierre por tareas, slow moving, ABC/XYZ, optimización y configuración (mismas rutas del proyecto original, bajo `/api/gestion`) |
| `/api/continuidad/*` | Personas, tareas, entregas de turno, dotación, asistencia, inventario e indicadores |
| `/api/config/*` | Metas, calendario, causas y parámetros |

El encabezado `x-usuario` (nombre codificado con `encodeURIComponent`) queda registrado en cierres, cargas y tareas.

## Reglas de negocio

**Turnos.** AM 06–14, PM 14–22, Noche 22–06. La Noche pertenece a la fecha en que empieza. Lunes a viernes tres turnos, sábado AM y PM, domingo sin operación (editable en `turno_calendario`).

**Control por hora desde extracciones.** Cada extracción de pedidos es una foto del WIP. Al cargar una nueva, se compara con la anterior por orden + ítem y se registran en `movimientos_etapa` las unidades que salieron de cada etapa, con la `F_MOD` de la etapa nueva como hora. Lo que desaparece del flujo cuenta como salida de la última etapa. Se rechazan extracciones con corte igual o anterior a la última. Para conectar el WMS directamente basta con poblar `movimientos_etapa`, `pedido_tareas`, `recepcion_citas` y las tablas `alm_*` desde un proceso programado.

**Cierre de turno.** Cada hora en que una etapa queda bajo `umbralDesvio` (85%) exige una causa. No se puede cerrar sin jefe ni con causas pendientes; se puede cerrar desde `minAntesCierre` minutos antes del término.

**Continuidad.** Una tarea abierta pasa al turno siguiente cuando ese turno confirma la entrega, o cuando el siguiente también termina sin confirmación. La original queda como `traspasada` y se crea una copia con prioridad alta, para que cada turno conserve su cumplimiento. Un jefe de turno activo por turno.

**Gestión Diaria.** Sus tablas están en el esquema `gestion` de la misma base (migración `003_gestion_diaria.sql`), porque `cargas`, `parametros` y `tareas` ya existen en el centro de control con otra estructura. `src/gestion/db.js` abre un pool con `search_path=gestion`, así que el motor y los servicios se copiaron sin cambios desde GestionOperaciones. Lee Excel con `xlsx` 0.20.3 (desde cdn.sheetjs.com: la 0.18.5 de npm tiene vulnerabilidades conocidas). Sus turnos siguen siendo 1, 2 y 3, con sus propios horarios en la configuración del módulo.

## Seguridad

No hay autenticación todavía: antes de exponer la API fuera de la red interna, agrega inicio de sesión y limita `CORS_ORIGIN` a los dominios reales.
