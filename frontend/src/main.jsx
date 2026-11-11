import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './styles.css';
import { AppProvider } from './lib/contexto.jsx';
import { aplicarTema, leerTema } from './lib/tema.js';
import Layout from './components/Layout.jsx';
import Resumen from './pages/control/Resumen.jsx';
import Recepcion from './pages/control/Recepcion.jsx';
import Almacenamiento from './pages/control/Almacenamiento.jsx';
import Pedidos from './pages/control/Pedidos.jsx';
import ControlHora from './pages/control/ControlHora.jsx';
import Cierre from './pages/control/Cierre.jsx';
import Mapa from './pages/control/Mapa.jsx';
import SimuladorOlas from './pages/control/SimuladorOlas.jsx';
import PanelCont from './pages/continuidad/Panel.jsx';
import MiTurno from './pages/continuidad/MiTurno.jsx';
import Calendario from './pages/continuidad/Calendario.jsx';
import Asignar from './pages/continuidad/Asignar.jsx';
import Equipo from './pages/continuidad/Equipo.jsx';
import Dotacion from './pages/continuidad/Dotacion.jsx';
import Inventario from './pages/continuidad/Inventario.jsx';
import InventarioCalendario from './pages/continuidad/InventarioCalendario.jsx';
import InventarioDashboard from './pages/continuidad/InventarioDashboard.jsx';
import InventarioValidacion from './pages/continuidad/InventarioValidacion.jsx';
import InventarioComparacion from './pages/continuidad/InventarioComparacion.jsx';
import InventarioMovimientos from './pages/continuidad/InventarioMovimientos.jsx';
import Indicadores from './pages/continuidad/Indicadores.jsx';
import Gerencial from './pages/gerencial/Gerencial.jsx';
import Cargas from './pages/config/Cargas.jsx';
import Configuracion from './pages/config/Configuracion.jsx';
import Gestion from './pages/gestion/Gestion.jsx';
import Usuarios from './pages/admin/Usuarios.jsx';
import Roles from './pages/admin/Roles.jsx';

aplicarTema(leerTema());

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Resumen />} />
            <Route path="recepcion" element={<Recepcion />} />
            <Route path="almacenamiento" element={<Almacenamiento />} />
            <Route path="pedidos" element={<Pedidos />} />
            <Route path="control" element={<ControlHora />} />
            <Route path="cierre" element={<Cierre />} />
            <Route path="mapa" element={<Mapa />} />
            <Route path="olas" element={<SimuladorOlas />} />
            <Route path="continuidad" element={<PanelCont />} />
            <Route path="continuidad/turno" element={<MiTurno />} />
            <Route path="continuidad/calendario" element={<Calendario />} />
            <Route path="continuidad/asignar" element={<Asignar />} />
            <Route path="continuidad/equipo" element={<Equipo />} />
            <Route path="continuidad/dotacion" element={<Dotacion />} />
            <Route path="inventario" element={<Inventario />} />
            <Route path="inventario/calendario" element={<InventarioCalendario />} />
            <Route path="inventario/dashboard" element={<InventarioDashboard />} />
            <Route path="inventario/validacion" element={<InventarioValidacion />} />
            <Route path="inventario/comparacion" element={<InventarioComparacion />} />
            <Route path="inventario/movimientos" element={<InventarioMovimientos />} />
            <Route path="continuidad/inventario" element={<Navigate to="/inventario" replace />} />
            <Route path="continuidad/indicadores" element={<Indicadores />} />
            <Route path="gestion/:vista?" element={<Gestion />} />
            <Route path="gerencial" element={<Gerencial />} />
            <Route path="cargas" element={<Cargas />} />
            <Route path="configuracion" element={<Configuracion />} />
            <Route path="admin/usuarios" element={<Usuarios />} />
            <Route path="admin/roles" element={<Roles />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>
);
