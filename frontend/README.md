# Frontend: centro de control del CD

Aplicación React 18 + Vite + Chart.js. Consume la API del backend.

## Instalación

```bash
npm install
cp .env.example .env
npm run dev          # http://localhost:5173 (el backend debe estar corriendo)
npm run build        # genera dist/ para publicar
npm run preview      # sirve dist/ en http://localhost:4173 para revisar el build
```

## Variables de entorno

| Variable | Uso |
|---|---|
| `BACKEND_URL` | Solo desarrollo: backend al que Vite reenvía `/api` (por defecto `http://localhost:3000`) |
| `VITE_API_URL` | Producción: URL pública de la API, por ejemplo `https://api.tu-dominio.cl/api`. Vacío = `/api` del mismo dominio |

`VITE_API_URL` se fija al compilar: si cambia, hay que volver a ejecutar `npm run build`. Si la API está en otro dominio, agrega el dominio del frontend en `CORS_ORIGIN` del backend.

## Publicar `dist/`

Es una aplicación de una sola página: el servidor web debe responder `index.html` para cualquier ruta. Ejemplo con Nginx en el mismo dominio que la API:

```nginx
server {
  listen 80;
  root /var/www/centro-control/dist;
  location /api/ { proxy_pass http://localhost:3000; client_max_body_size 60m; }
  location / { try_files $uri /index.html; }
}
```

## Estructura

```
src/main.jsx                  Rutas
src/lib/api.js                Cliente HTTP (usa VITE_API_URL)
src/lib/contexto.jsx          Catálogos, foto en vivo cada 5 min, usuario y avisos
src/lib/ops.jsx               Cálculos del panel y alertas
src/components/               Layout, gráficos, flujo de etapas, mapa de Chile, tareas
src/pages/control/            Resumen, Recepción, Almacenamiento, Pedidos, Control por hora, Cierre, Mapa
src/pages/continuidad/        Panel, Mi turno, Calendario, Asignar, Equipo, Dotación, Inventario, Indicadores
src/pages/config/             Cargas de extracciones, Metas y calendario
src/pages/gestion/            Gestión Diaria (proyecto GestionOperaciones): vistas originales, su cliente de API (/api/gestion)
                              y gestion.css, con los estilos limitados a .gd y los colores del centro de control
src/data/mapaChile.js         Geometría de las 16 regiones
src/styles.css                Estilos (modo claro y oscuro)
```
