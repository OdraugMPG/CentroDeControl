# Centro de control del CD + Continuidad Operacional

Dos proyectos independientes:

```
centro-control-cd/
  backend/    API Node + Express + PostgreSQL (puerto 3000)
  frontend/   Aplicación React + Vite (puerto 5173 en desarrollo)
```

Cada carpeta tiene su propio `package.json`, `.env` y README. Se instalan, ejecutan y despliegan por separado.

## Arranque rápido (dos terminales)

```bash
# Terminal 1: backend
cd backend
npm install
cp .env.example .env        # completa DATABASE_URL
npm run db:demo             # opcional: tablas + datos de demostración
npm run dev                 # http://localhost:3000/api

# Terminal 2: frontend
cd frontend
npm install
cp .env.example .env
npm run dev                 # http://localhost:5173
```

## Cómo se comunican

- En desarrollo, Vite reenvía `/api` al backend (`BACKEND_URL` en `frontend/.env`).
- En producción hay dos opciones:
  1. **Mismo dominio**: publica `frontend/dist` y haz que tu servidor web (Nginx, IIS) envíe `/api` al backend. `VITE_API_URL` queda vacío.
  2. **Dominios distintos**: define `VITE_API_URL=https://api.tu-dominio.cl/api` antes de `npm run build`, y en el backend `CORS_ORIGIN=https://tu-dominio.cl`.

Gestión diaria (plan diario, asignación, conciliación con stock, slow moving y ABC/XYZ) es un módulo más: ver `docs/gestion-diaria.md`.

Ver `backend/README.md` para la API, la base de datos y las reglas de negocio, y `frontend/README.md` para las vistas.
