// Cliente HTTP del backend. Envía el nombre del usuario actual para auditoría.
// VITE_API_URL: dirección del backend (ej. http://servidor:3000/api). Vacío = /api del mismo origen,
// que en desarrollo Vite reenvía al backend (ver vite.config.js).
export const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
export function usuarioActual() {
  try { return JSON.parse(localStorage.getItem('cc-usuario') || 'null'); } catch { return null; }
}

async function req(method, url, body, opts = {}) {
  const u = usuarioActual();
  const headers = {};
  if (u?.nombre) headers['x-usuario'] = encodeURIComponent(u.nombre);
  let payload = body;
  if (body !== undefined && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(API_URL + url, { method, headers, body: payload, cache: 'no-store', signal: opts.signal });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && data.error) || `Error ${res.status}`);
  return data;
}

export const api = {
  get: (u, o) => req('GET', u, undefined, o),
  post: (u, b) => req('POST', u, b ?? {}),
  put: (u, b) => req('PUT', u, b),
  patch: (u, b) => req('PATCH', u, b),
  del: u => req('DELETE', u)
};

export const qs = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
