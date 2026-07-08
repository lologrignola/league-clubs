import { showToast } from './toast.js'

const CDN_BASE = 'https://cdn.jsdelivr.net/gh/lologrignola/league-clubs@main'
const CHECK_INTERVAL_MS = 60 * 1000

let checkTimer = null
let remoteRev = null

function parseRev(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function getLoadedRev() {
  const fromLoader = window.__penguClubsRev
  if (fromLoader != null && fromLoader !== '') return String(fromLoader)
  return sessionStorage.getItem('pengu-clubs-loaded-rev') ?? ''
}

export function markSessionLoaded() {
  const rev = getLoadedRev()
  if (rev) sessionStorage.setItem('pengu-clubs-loaded-rev', rev)
}

async function fetchRemoteVersion() {
  const res = await fetch(`${CDN_BASE}/version.json`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`version.json ${res.status}`)
  const data = await res.json()
  return {
    rev: String(data.rev ?? data.version ?? ''),
    version: data.version ? String(data.version) : '',
  }
}

function getUpdateButton() {
  return document.querySelector('#pengu-clubs-panel .pc-update-btn')
}

function setUpdateVisible(visible, versionLabel = '') {
  const btn = getUpdateButton()
  if (!btn) return
  btn.classList.toggle('pc-hidden', !visible)
  if (versionLabel) {
    const label = btn.querySelector('.pc-update-label')
    if (label) label.textContent = versionLabel
  }
  const toggleBadge = document.querySelector('#pengu-clubs-toggle .pc-update-dot')
  toggleBadge?.classList.toggle('pc-hidden', !visible)
}

export async function checkForUpdate() {
  try {
    const remote = await fetchRemoteVersion()
    remoteRev = remote.rev
    const loaded = getLoadedRev()
    if (!remote.rev || !loaded) {
      setUpdateVisible(false)
      return false
    }
    const available = parseRev(remote.rev) > parseRev(loaded)
    const label = remote.version ? `Update ${remote.version}` : 'New update'
    setUpdateVisible(available, label)
    return available
  } catch (err) {
    console.warn('[pengu-clubs] update check failed:', err.message)
    return false
  }
}

export function applyUpdate() {
  if (typeof window.reloadClient === 'function') {
    showToast('Reloading client…', 'info', 2000)
    window.reloadClient()
    return
  }
  showToast('Close and reopen the League client to update', 'info', 5000)
}

export function startUpdateCheck() {
  checkForUpdate()
  if (checkTimer) clearInterval(checkTimer)
  checkTimer = setInterval(() => checkForUpdate(), CHECK_INTERVAL_MS)
}

export function stopUpdateCheck() {
  if (checkTimer) clearInterval(checkTimer)
  checkTimer = null
}
