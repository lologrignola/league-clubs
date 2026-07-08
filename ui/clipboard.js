import { showToast } from './toast.js'

export async function copyText(text) {
  if (!text) {
    showToast('Nothing to copy')
    return false
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      showToast('Copied to clipboard', 'success')
      return true
    }
  } catch {
    // fallback below
  }

  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()

  if (ok) showToast('Copied to clipboard', 'success')
  else showToast(`Copy manually: ${text}`, 'info', 8000)
  return ok
}
