import { mountClubsPanel, onSessionReady, toggleClubsPanel, handlePanelAction } from './ui/panel.js'
import { bindPresenceObservers } from './presence.js'
import { isConfigured } from './config.js'

function injectStyles() {
  const id = 'pengu-clubs-styles'
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = new URL('./styles.css', import.meta.url).href
  document.head.appendChild(link)
}

let globalUiBound = false

function bindGlobalUi() {
  if (globalUiBound) return
  globalUiBound = true

  document.addEventListener('click', (e) => {
    if (e.target.closest('#pengu-clubs-toggle')) {
      e.preventDefault()
      e.stopPropagation()
      toggleClubsPanel()
      return
    }

    const panel = e.target.closest('#pengu-clubs-panel')
    if (!panel) return

    if (e.target.closest('.pc-close')) {
      e.preventDefault()
      e.stopPropagation()
      handlePanelAction('close')
      return
    }

    const clubItem = e.target.closest('.pc-club-item')
    if (clubItem) {
      e.preventDefault()
      e.stopPropagation()
      handlePanelAction('select-club', clubItem.dataset.id)
      return
    }

    const discoverItem = e.target.closest('.pc-discover-item')
    if (discoverItem) {
      e.preventDefault()
      e.stopPropagation()
      handlePanelAction('select-discover', discoverItem.dataset.id)
      return
    }

    const actionEl = e.target.closest('[data-action]')
    if (!actionEl || !panel.contains(actionEl)) return

    const action = actionEl.dataset.action
    if (!action) return

    e.preventDefault()
    e.stopPropagation()
    handlePanelAction(action, actionEl.dataset.puuid)
  }, true)

  document.addEventListener('mousedown', (e) => {
    if (e.target.closest('#pengu-clubs-toggle, #pengu-clubs-panel')) {
      e.stopPropagation()
    }
  }, true)

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    const input = e.target.closest('#pengu-clubs-panel .pc-compose .pc-input')
    if (!input) return
    e.preventDefault()
    e.stopPropagation()
    handlePanelAction('send-message')
  }, true)

  document.addEventListener('submit', (e) => {
    const form = e.target.closest('#pengu-clubs-panel form')
    if (!form) return
    e.preventDefault()
    e.stopPropagation()
    if (form.classList.contains('pc-compose')) {
      handlePanelAction('send-message')
    }
  }, true)
}

function bindGlobalToggle() {
  bindGlobalUi()
}

export function init({ socket }) {
  if (!socket?.observe) {
    console.warn('[pengu-clubs] LCU socket unavailable — session gate disabled')
    onSessionReady()
    return
  }

  bindPresenceObservers(socket)

  socket.observe('/lol-chat/v1/session', (event) => {
    if (event.eventType === 'Delete') return
    onSessionReady()
  })

  // Fallback if session already exists before observe fires
  fetch('/lol-chat/v1/session')
    .then((r) => (r.ok ? r.json() : null))
    .then((session) => {
      if (session) onSessionReady()
    })
    .catch(() => {})
}

export function load() {
  injectStyles()
  if (!isConfigured()) {
    console.warn('[pengu-clubs] Supabase not configured. Edit plugins/pengu-clubs/config.js')
  }
  bindGlobalToggle()
  mountClubsPanel()
  window.openPenguClubs = toggleClubsPanel
  console.log('[pengu-clubs] Clubs panel loaded — click Clubs or run openPenguClubs()')
}
