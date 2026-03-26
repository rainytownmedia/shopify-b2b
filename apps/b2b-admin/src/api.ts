// Use same-origin proxy path to avoid CORS issues.
// Vite dev server proxies /api/admin → BACKEND_PORT (set via env when running npm run dev)
const BASE_URL = '/api/admin';

async function handleResponse(response: Response) {
  if (response.status === 401) {
    localStorage.removeItem('adminAuth');
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    const text = await response.text();
    throw new Error(text ? JSON.parse(text)?.error : 'Unauthorized');
  }

  const text = await response.text();
  if (!text) throw new Error('Empty response from server');

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Server returned invalid JSON. Check backend is running.');
  }

  if (!response.ok) throw new Error(data?.error || 'Request failed');
  return data;
}

export const api = {
  get: async (endpoint: string) => {
    const response = await fetch(`${BASE_URL}${endpoint}`);
    return handleResponse(response);
  },
  post: async (endpoint: string, body: any) => {
    const isFormData = body instanceof FormData;
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: isFormData ? {} : { 'Content-Type': 'application/json' },
      body: isFormData ? body : JSON.stringify(body),
    });
    return handleResponse(response);
  },
  patch: async (endpoint: string, body: any) => {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return handleResponse(response);
  },
  delete: async (endpoint: string, body?: any) => {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return handleResponse(response);
  },
};
