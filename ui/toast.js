let container = null

function ensureContainer() {
  if (container) return container
  container = document.createElement('div')
  container.id = 'pc-toast-container'
  container.className = 'pc-toast-container'
  document.body.appendChild(container)
  return container
}

/**
 * @param {string} message
 * @param {'error'|'success'|'info'} [type]
 * @param {number} [durationMs]
 */
export function showToast(message, type = 'error', durationMs = 4000) {
  const root = ensureContainer()
  const toast = document.createElement('div')
  toast.className = `pc-toast pc-toast-${type}`
  toast.textContent = message
  root.appendChild(toast)

  requestAnimationFrame(() => toast.classList.add('pc-toast-visible'))

  const remove = () => {
    toast.classList.remove('pc-toast-visible')
    setTimeout(() => toast.remove(), 200)
  }

  const timer = setTimeout(remove, durationMs)
  toast.addEventListener('click', () => {
    clearTimeout(timer)
    remove()
  })
}

export function parseRpcError(raw) {
  if (!raw) return 'Something went wrong'
  try {
    const parsed = JSON.parse(raw)
    return parsed.message ?? parsed.error ?? parsed.hint ?? raw
  } catch {
    return raw.replace(/^.*?"message"\s*:\s*"([^"]+)".*$/, '$1') || raw
  }
}
