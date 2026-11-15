// "Recent downloads" list kept in this browser only (localStorage). Purely a
// convenience: the server deletes files after 1 hour, so expired entries are
// dropped. Every access is wrapped in try/catch (private mode, blocked storage).

const KEY = 'reeltube.recent'
const MAX = 8

export function loadRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]')
    const now = Date.now() / 1000
    return Array.isArray(list) ? list.filter((e) => e && e.expires_at > now) : []
  } catch {
    return []
  }
}

export function addRecent(job) {
  if (!job?.job_id || job.status !== 'done') return
  const entry = {
    job_id: job.job_id,
    filename: job.filename,
    filesize: job.filesize,
    title: job.title,
    thumbnail: job.thumbnail,
    platform: job.platform,
    expires_at: job.expires_at,
  }
  try {
    const list = loadRecent().filter((e) => e.job_id !== entry.job_id)
    localStorage.setItem(KEY, JSON.stringify([entry, ...list].slice(0, MAX)))
    window.dispatchEvent(new Event('reeltube:recent'))
  } catch { /* storage unavailable */ }
}

/** Drop one entry (e.g. the server no longer has the file). */
export function removeRecent(jobId) {
  try {
    const list = loadRecent().filter((e) => e.job_id !== jobId)
    localStorage.setItem(KEY, JSON.stringify(list))
    window.dispatchEvent(new Event('reeltube:recent'))
  } catch { /* storage unavailable */ }
}

export function clearRecent() {
  try {
    localStorage.removeItem(KEY)
    window.dispatchEvent(new Event('reeltube:recent'))
  } catch { /* storage unavailable */ }
}
