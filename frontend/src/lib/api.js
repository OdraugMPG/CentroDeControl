// Cliente HTTP del backend. La sesión viaja en una cookie httpOnly (credentials: 'include').
// Un 401 avisa a la aplicación que la sesión terminó (evento cc:sin-sesion).
// VITE_API_URL: dirección del backend (ej. http://servidor:3000/api). Vacío = /api del mismo origen,
// que en desarrollo Vite reenvía al backend (ver vite.config.js).
export const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
export const sinSesion = () => window.dispatchEvent(new Event('cc:sin-sesion'));

async function req(method, url, body, opts = {}) {
  const headers = { 'X-CC': '1' };   // exigido por el backend en toda modificación (defensa contra CSRF)
  let payload = body;
  if (body !== undefined && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(API_URL + url, { method, headers, body: payload, cache: 'no-store', credentials: 'include', signal: opts.signal });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (res.status === 401 && !url.startsWith('/auth/')) sinSesion();
  if (!res.ok) throw Object.assign(new Error((data && data.error) || `Error ${res.status}`), { status: res.status, data });
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
