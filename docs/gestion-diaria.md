# Gestión diaria

Módulo del Centro de control que reemplaza el flujo diario del libro **Consolidacion_V4.4.xlsm** (proyecto GestionOperaciones, ahora integrado). Usa la misma Base de stock que hoy se pega en la hoja `Base`. Planifica, asigna y mide: las tareas se ejecutan en el WMS.

| En el libro Excel | En el Centro de control |
|---|---|
| Paso 1 · 3D · 5 · 6 · 9 y ASIGNACIÓN DIARIA | **Gestión diaria → Asignación del día**: cargar la Base y generar todo con un clic |
| Hojas `Tareas_Operarios`, `Tareas_Stock_Unitario`, `Tareas_SlowMoving` | **Gestión diaria → Tareas** |
| 10 EXPORTAR TURNO / 11 IMPORTAR AVANCES | `.xlsx` por turno e importación de avances (respaldo) |
| Avance digitado por el supervisor | **Gestión diaria → Conciliación**: el avance sale del stock de cierre de cada turno |
| 12 INFORME DE CIERRE | **Gestión diaria → Cierre por tareas**: KPI por tareas y por unidades contra la meta del 95% |
| SlowMoving_Simulador + GENERAR TAREAS | **Gestión diaria → Slow moving** |
| `Config_Diaria`, `Simulacion_Tiempos`, `Blq_Stk_unit` | **Gestión diaria → Configuración** |

Los archivos de stock también se pueden cargar en **Datos → Cargas de extracciones**, tarjeta *Gestión diaria: stock*, junto con el resto de extracciones.

## Quién ve qué

Cada vista de Gestión diaria tiene su propio permiso. En **Administración → Roles y permisos** se marca qué roles la ven. Los roles iniciales quedan así:

| Rol | Vistas de Gestión diaria |
|---|---|
| Admin y Jefe de Operaciones | Todas: carga de la Base, asignación, tareas, conciliación, configuración y análisis |
| Supervisor | Mi turno y Cierre por tareas (y la carga de stock en Datos) |
| Gerente | Cierre por tareas, Slow moving, ABC / XYZ y Optimización ABC |

Para que «Mi turno» sepa el turno de un supervisor, vincula su cuenta con su persona del Equipo en **Administración → Usuarios**.

## Prueba guiada con datos de ejemplo

Los archivos de ejemplo son inventados y tienen la misma estructura de columnas del libro (3 CD: CD01, CD02 y OSR). Se descargan desde **Datos → Cargas de extracciones** o están en `backend/data/ejemplo-gestion/`.

1. Entra con un usuario de rol **Jefe de Operaciones** o **Admin**. En el selector **Jornada** elige un día hábil (el domingo no tiene turnos).
2. **Gestión diaria → Configuración** → *Cargar Blq_Stk_unit* con `Blq_Stk_unit_ejemplo.xlsx`.
3. **Asignación del día** → *Cargar Base de stock* con `Base_inicio_ejemplo.xlsx`. Los CD se crean solos y OSR queda inactivo.
4. En **Configuración** completa por CD los supervisores T1, T2 y T3, los operarios de consolidación y si hace stock unitario (y en qué turno). *Guardar* en cada fila.
5. Opcional: en **Slow moving** filtra y presiona *Generar tareas*; entran en la asignación.
6. **Asignación del día** → *Generar asignación diaria*. Desde ahí se descarga el archivo para el WMS y el `.xlsx` de cada supervisor.
7. Simula lo que el WMS ejecutó en el turno 1:
   ```
   cd backend
   npm run gestion:ejemplo -- cierre AAAA-MM-DD 1
   ```
   Crea `backend/data/ejemplo-gestion/Stock_cierre_T1_ejemplo.xlsx` con cerca del 85% de las tareas del T1 ejecutadas.
8. **Conciliación** → T1 → *Cargar stock de cierre* con ese archivo (o en Datos, «Stock al cierre del turno T1»). Las tareas pasan a EJECUTADO o PARCIAL sin digitar nada.
9. Con un usuario **Supervisor**, en **Mi turno** marca las zonas de inventario contadas y registra una tarea NO EJECUTADO con su motivo.
10. **Cierre por tareas** muestra el cumplimiento por tareas y por unidades, por CD y proceso, por turno y supervisor.

## Base real

- Se lee la hoja `Base` si existe; si no, la primera hoja. Los encabezados se buscan en las primeras 10 filas, con los mismos alias del libro.
- Obligatorias: **CD, SKU, UBICACION, QTY, PISO, ZONA_PASILLO (o PASILLO), DESC_DEPTO**.
- Opcionales: DESCRIPCION, MARCA, PASILLO, BAHIA, NIVEL; FECHA_ULT_ALMACENAMIENTO, VENTAS, TEMPORADA y COSTO para slow moving; Logística OSR para optimización.
- Si falta una columna, la pantalla dice cuál y muestra los encabezados que leyó.

Primera semana: corre el libro y la web en paralelo con la misma Base y compara movimientos y SKU unitarios.

### Cómo se mide el avance

| Proceso | Regla |
|---|---|
| Consolidación | Baja en la ubicación de origen y sube en la de destino. Cuenta lo menor de ambos. |
| Stock unitario | La unidad aparece en la ubicación reservada y salió del origen. |
| Slow moving | Baja en la ubicación de origen. |
| Inventario | El stock no lo muestra: el supervisor marca la zona como contada. |

Una tarea nunca retrocede de estado. Las tareas NO EJECUTADO exigen motivo. Si un turno no tiene foto de stock, el `.xlsx` del supervisor se completa y se importa como en el libro.

## Diferencias con el libro, a propósito

- **Ubicación repetida en la Base:** si un SKU aparece en varias filas de la misma ubicación, se suman antes de consolidar.
- **Zona de consolidación repartida entre dos turnos:** sus movimientos se reparten según el % de la zona en cada turno, para no repetirlos.
- **Ciclo de inventario:** una zona entra al ciclo cuando todas sus tareas de inventario del día quedan EJECUTADAS y el plan cubría el 100% de la zona. Cuando todo el CD está inventariado, el ciclo se reinicia solo.
- **Pendiente:** plan semanal, hoja `Analisis_Fisico`, informe gerencial de slow moving con historial y unificar los turnos T1/T2/T3 con AM/PM/Noche del Centro de control.

## Para desarrollo

| Comando (en `backend/`) | Qué hace |
|---|---|
| `npm run gestion:ejemplo` | Regenera los archivos de ejemplo |
| `npm run gestion:ejemplo -- cierre AAAA-MM-DD T [tasa]` | Simula el stock al cierre del turno T de esa jornada |
| `npm run gestion:prueba-motor -- [archivo] [fecha]` | Corre el motor (plan, consolidación, stock unitario, slow moving) sin base de datos |

Código: `backend/src/gestion/` (motor y servicios, sin cambios respecto del original), `backend/src/routes/gestion.js` (API en `/api/gestion`), `backend/migrations/003_gestion_diaria.sql` (esquema `gestion`) y `frontend/src/pages/gestion/`.
