// Thin wrappers around the backend API.
//
// By default paths are relative ("/api/..."), which works behind Vite's dev
// proxy and when FastAPI serves the built site itself. When the frontend is
// hosted elsewhere (e.g. Vercel), set VITE_API_BASE at build time to the
// backend's public URL, e.g. https://api.example.com (no trailing slash).
const BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')
const url = (path) => BASE + path

async function request(method, path, body) {
  let res
  try {
    res = await fetch(url(path), {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error("Can't reach the server. Check your connection.")
  }
  let data = null
  try { data = await res.json() } catch { /* empty or non-JSON body */ }
  if (!res.ok) {
    // FastAPI puts messages in `detail`; validation errors make it an array.
    const detail = data?.detail
    const msg = Array.isArray(detail) ? detail.map((d) => d.msg).join(', ') : detail
    throw new Error(msg || `Request failed (${res.status})`)
  }
  return data
}

export const getInfo = (url) => request('POST', '/api/info', { url })
export const startDownload = (payload) => request('POST', '/api/download', payload)
export const cancelJob = (jobId) => request('DELETE', `/api/job/${jobId}`)
export const retryJob = (jobId) => request('POST', `/api/job/${jobId}/retry`)
export const getJob = (jobId) => request('GET', `/api/job/${jobId}`)
export const progressUrl = (jobId) => url(`/api/progress/${jobId}`)
export const fileUrl = (jobId) => url(`/api/file/${jobId}`)

export const createBatch = (items) => request('POST', '/api/batch', { items })
export const getBatch = (batchId) => request('GET', `/api/batch/${batchId}`)
export const cancelBatch = (batchId) => request('DELETE', `/api/batch/${batchId}`)
export const batchProgressUrl = (batchId) => url(`/api/batch/${batchId}/progress`)
export const batchZipUrl = (batchId) => url(`/api/batch/${batchId}/zip`)
