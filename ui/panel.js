import * as api from '../api.js'
import * as chat from './chat.js'
import { startPresenceLoop, setMembersRefreshCallback, setPresenceRefreshCallback, setClubListSyncCallback } from '../presence.js'
import { showToast } from './toast.js'
import { isConfigured } from '../config.js'
import * as notify from './notify.js'
import { mountFormView, openForm, closeForm, submitForm, ensureFormView } from './forms.js'
import { startUpdateCheck, applyUpdate, checkForUpdate } from './updates.js'
import { refreshTagCache, setOwnMainTag } from './tags.js'

const PANEL_WIDTH = 760
const PANEL_HEIGHT = 500
const PANEL_GAP = 8

const PANEL_STYLE = [
  'position:fixed',
  'bottom:82px',
  'right:20px',
  'z-index:2147483647',
  `width:${PANEL_WIDTH}px`,
  `height:${PANEL_HEIGHT}px`,
  'display:none',
  'flex-direction:column',
  'pointer-events:auto',
  'overflow:hidden',
].join(';')

const PANEL_STYLE_FALLBACK = PANEL_STYLE

let panelEl = null
let clubListEl = null
let discoverPanelEl = null
let panelEventsBound = false
/** @type {Map<string, object>} */
const clubsCache = new Map()
/** @type {Map<string, object>} */
const discoverCache = new Map()

const PANEL_VERSION = '13'

let socialMountBound = false
let socialMountPoll = null
/** @type {MutationObserver | null} */
let socialMountObserver = null
let panelAnchorTimer = null
let toggleSyncTimer = null

function isOwnToggleMutationNode(node) {
  if (node.nodeType !== 1) return true
  const el = /** @type {Element} */ (node)
  return el.id === 'pengu-clubs-toggle' || el.id === 'pengu-clubs-social-slot' || !!el.querySelector?.('#pengu-clubs-toggle')
}

function queueToggleSync() {
  clearTimeout(toggleSyncTimer)
  toggleSyncTimer = setTimeout(() => {
    syncTogglePlacement()
    queuePanelAnchor()
  }, 50)
}

function findSocialBar() {
  return document.querySelector('.alpha-version-panel')
}

function findChatSlot() {
  const bar = findSocialBar()
  if (!bar) return null
  return bar.querySelector('.lol-social-chat-toggle-button, .chat-toggle-button')
}

function toggleButtonMarkup() {
  return `
    <span class="pc-toggle-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" data-pc-icon="community">
        <path fill="currentColor" d="M9 10.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Zm7.25-.75a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM3.75 19v-.15c0-2.9 2.35-5.25 5.25-5.25s5.25 2.35 5.25 5.25V19H3.75Zm9.75 0v-.15c0-2.07 1.35-3.82 3.22-4.43a4.9 4.9 0 0 0-.97-.1c-1.93 0-3.5 1.57-3.5 3.5V19h1.25Z"/>
      </svg>
    </span>
    <span class="pc-toggle-badge pc-hidden" aria-label="Unread messages"></span>
    <span class="pc-update-dot pc-hidden" aria-hidden="true" title="Update available"></span>
  `
}

function refreshToggleMarkup(btn) {
  const badgeVisible = !btn.querySelector('.pc-toggle-badge')?.classList.contains('pc-hidden')
  const dotVisible = !btn.querySelector('.pc-update-dot')?.classList.contains('pc-hidden')
  btn.innerHTML = toggleButtonMarkup()
  if (badgeVisible) btn.querySelector('.pc-toggle-badge')?.classList.remove('pc-hidden')
  if (dotVisible) btn.querySelector('.pc-update-dot')?.classList.remove('pc-hidden')
}

function ensureToggleButton() {
  let btn = document.getElementById('pengu-clubs-toggle')
  if (!btn) {
    btn = document.createElement('button')
    btn.id = 'pengu-clubs-toggle'
    btn.className = 'pc-toggle-btn'
    btn.type = 'button'
    btn.innerHTML = toggleButtonMarkup()
    btn.title = 'Clubs'
    btn.setAttribute('aria-label', 'Toggle Clubs panel')
    return btn
  }

  if (btn.querySelector('.pc-toggle-icon svg')?.dataset.pcIcon !== 'community') {
    refreshToggleMarkup(btn)
  }

  return btn
}

function findVoiceSlot() {
  const bar = findSocialBar()
  if (!bar) return null

  for (const selector of [
    '.lol-social-voice-toggle-button',
    '.voice-toggle-button',
    '.lol-social-voice-button',
  ]) {
    const el = bar.querySelector(selector)
    if (el?.parentElement === bar) return el
  }

  return null
}

function resolveToggleAnchor(bar, chatSlot) {
  const voiceSlot = findVoiceSlot()
  return voiceSlot ?? chatSlot
}

function findSocialButtonFrame() {
  const bar = findSocialBar()
  if (!bar) return null
  return bar.querySelector('.lol-social-chat-toggle-button, .chat-toggle-button, .lol-social-voice-toggle-button, .voice-toggle-button')
}

function findChatButton() {
  const bar = findSocialBar()
  if (!bar) return null
  return bar.querySelector('.lol-social-chat-toggle-button .chat-button, .chat-toggle-button .chat-button, .chat-button')
}

function clearTogglePosition(btn) {
  btn.style.position = ''
  btn.style.left = ''
  btn.style.top = ''
  btn.style.zIndex = ''
  btn.style.width = ''
  btn.style.minWidth = ''
  btn.style.height = ''
}

function clearToggleIconColor(btn) {
  btn.querySelector('.pc-toggle-icon')?.style.removeProperty('color')
}

function syncToggleChromeFromChat() {
  const btn = document.getElementById('pengu-clubs-toggle')
  const bar = findSocialBar()
  const chatSlot = findChatSlot()
  const chatBtn = findChatButton()
  if (!btn || !bar || !chatSlot || !btn.classList.contains('pc-toggle-native')) return

  const anchor = resolveToggleAnchor(bar, chatSlot)
  clearTogglePosition(btn)

  if (btn.parentElement !== bar || btn.nextElementSibling !== anchor) {
    bar.insertBefore(btn, anchor)
  }

  const frame = findSocialButtonFrame() ?? chatSlot
  const frameCs = getComputedStyle(frame)
  const chatCs = chatBtn ? getComputedStyle(chatBtn) : frameCs

  btn.style.backgroundColor = ''
  btn.style.backgroundImage = ''
  btn.style.color = ''

  if (frameCs.borderWidth !== '0px') {
    btn.style.border = frameCs.border
  } else if (chatCs.borderWidth !== '0px') {
    btn.style.border = chatCs.border
  } else {
    btn.style.border = ''
  }

  btn.style.boxShadow = frameCs.boxShadow !== 'none' ? frameCs.boxShadow : chatCs.boxShadow
  btn.style.borderRadius = frameCs.borderRadius !== '0px' ? frameCs.borderRadius : chatCs.borderRadius

  btn.querySelector('.pc-toggle-icon')?.style.removeProperty('color')

  if (isPanelVisible()) queuePanelAnchor()
}

function mountToggleInSocialBar() {
  const bar = findSocialBar()
  const chatSlot = findChatSlot()
  if (!bar || !chatSlot) return false

  document.getElementById('pengu-clubs-social-slot')?.remove()

  const btn = ensureToggleButton()
  btn.classList.remove('pc-toggle-fallback', 'pc-toggle-bubble')
  btn.classList.add('pc-toggle-native')
  syncToggleChromeFromChat()
  return true
}

function mountToggleFallback() {
  const btn = ensureToggleButton()
  if (btn.closest('.alpha-version-panel')) return

  const root = getMountRoot()
  if (btn.parentElement !== root) root.appendChild(btn)

  btn.classList.remove('pc-toggle-native', 'pc-toggle-bubble')
  btn.classList.add('pc-toggle-fallback')
  clearToggleIconColor(btn)
  btn.style.cssText = ''
}

function syncTogglePlacement() {
  if (!mountToggleInSocialBar()) mountToggleFallback()
}

function findSocialSidebar() {
  return document.querySelector('.lol-social-sidebar, .rcp-fe-viewport-sidebar .social-plugin-home')
}

function getPanelAnchorRects() {
  const toggle = document.getElementById('pengu-clubs-toggle')
  const bar = findSocialBar()
  const sidebar = findSocialSidebar()

  return {
    toggle: toggle?.getBoundingClientRect(),
    bar: bar?.getBoundingClientRect(),
    sidebar: sidebar?.getBoundingClientRect(),
  }
}

function resolvePanelAnchor(rects) {
  const { toggle, bar, sidebar } = rects
  const railTop = bar?.height > 0 ? bar.top : toggle?.height > 0 ? toggle.top : null
  if (railTop == null) return null

  let right = 20
  if (sidebar?.width > 0) {
    right = Math.max(16, window.innerWidth - sidebar.left + PANEL_GAP)
  } else if (toggle?.width > 0) {
    right = Math.max(16, window.innerWidth - toggle.right)
  } else if (bar?.width > 0) {
    right = Math.max(16, window.innerWidth - bar.right)
  }

  const bottom = Math.max(16, window.innerHeight - railTop + PANEL_GAP)
  const maxHeight = Math.max(280, Math.min(PANEL_HEIGHT, railTop - 24))
  const maxWidth = Math.min(PANEL_WIDTH, window.innerWidth - right - 16)
  const width = Math.max(320, maxWidth)
  const height = Math.max(280, Math.min(maxHeight, PANEL_HEIGHT))

  return { bottom, right, width, height }
}

function applyPanelLayout(el, { visible = isPanelVisible() } = {}) {
  if (!el) return

  const anchor = resolvePanelAnchor(getPanelAnchorRects())
  const display = visible ? 'display:flex!important' : 'display:none'

  if (!anchor) {
    el.style.cssText = `${PANEL_STYLE_FALLBACK};${display}`
    return
  }

  el.style.cssText = [
    'position:fixed',
    `bottom:${anchor.bottom}px`,
    `right:${anchor.right}px`,
    `width:${anchor.width}px`,
    `height:${anchor.height}px`,
    'z-index:2147483647',
    display,
    'flex-direction:column',
    'pointer-events:auto',
    'overflow:hidden',
  ].join(';')
}

function syncPanelAnchor() {
  const el = getPanel()
  if (!el) return
  applyPanelLayout(el, { visible: isPanelVisible() })
}

function queuePanelAnchor() {
  clearTimeout(panelAnchorTimer)
  panelAnchorTimer = setTimeout(syncPanelAnchor, 0)
}

function bindSocialMount() {
  if (socialMountBound) return
  socialMountBound = true

  syncTogglePlacement()
  window.addEventListener('resize', () => {
    queuePanelAnchor()
    syncToggleChromeFromChat()
  })

  socialMountPoll = setInterval(() => {
    const btn = document.getElementById('pengu-clubs-toggle')
    const bar = findSocialBar()
    const chatSlot = findChatSlot()
    if (!btn || !bar || !chatSlot || !btn.classList.contains('pc-toggle-native')) {
      syncTogglePlacement()
      return
    }

    const anchor = resolveToggleAnchor(bar, chatSlot)
    if (btn.parentElement !== bar || btn.nextElementSibling !== anchor) {
      syncTogglePlacement()
    }

    if (isPanelVisible()) queuePanelAnchor()
  }, 4000)

  socialMountObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue

      const touchedExternal = [...mutation.addedNodes, ...mutation.removedNodes].some((node) => !isOwnToggleMutationNode(node))
      if (!touchedExternal) continue

      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue
        const el = /** @type {Element} */ (node)
        if (
          el.matches?.('.alpha-version-panel, .lol-social-chat-toggle-button, .chat-toggle-button, .lol-social-voice-toggle-button, .voice-toggle-button') ||
          el.querySelector?.('.alpha-version-panel, .lol-social-chat-toggle-button, .chat-toggle-button, .lol-social-voice-toggle-button, .voice-toggle-button')
        ) {
          queueToggleSync()
          return
        }
      }
    }
  })
  socialMountObserver.observe(document.body, { childList: true, subtree: true })
}

export function mountClubsPanel() {
  dedupePanels()

  const existing = document.getElementById('pengu-clubs-panel')
  if (existing && existing.dataset.pcVersion !== PANEL_VERSION) {
    existing.remove()
    panelEl = null
    clubListEl = null
    discoverPanelEl = null
    panelEventsBound = false
  }

  syncPanelRefs()

  try {
    if (!panelEl) createPanel()
    else mountFormView(panelEl)
    bindPanelEvents()
    wireMembershipSync()
    createToggleButton()
    bindSocialMount()
    startUpdateCheck()
    window.openPenguClubs = toggleClubsPanel
  } catch (err) {
    console.error('[pengu-clubs] mount failed:', err)
    showToast(`Clubs failed to load: ${err.message}`)
  }

  waitForSessionThenInit()
}

function getMountRoot() {
  return document.body ?? document.documentElement
}

function syncPanelRefs() {
  const el = document.getElementById('pengu-clubs-panel')
  if (!el) return false
  panelEl = el
  if (!panelEl.style.position) panelEl.style.cssText = PANEL_STYLE
  clubListEl = panelEl.querySelector('.pc-club-list')
  discoverPanelEl = panelEl.querySelector('.pc-discover')
  return true
}

function dedupePanels() {
  const panels = [...document.querySelectorAll('#pengu-clubs-panel')]
  if (panels.length <= 1) {
    if (panels[0]) panelEl = panels[0]
    return
  }
  const keeper = panels[panels.length - 1]
  for (const node of panels) {
    if (node !== keeper) node.remove()
  }
  panelEl = keeper
  panelEventsBound = false
}

function getPanel() {
  syncPanelRefs()
  return panelEl
}

function ensurePanelInDom() {
  const el = getPanel()
  if (!el) return
  const root = getMountRoot()
  if (!root.contains(el)) root.appendChild(el)
}

function setToggleOpen(open) {
  document.getElementById('pengu-clubs-toggle')?.classList.toggle('pc-toggle-active', open)
}

function createToggleButton() {
  ensureToggleButton()
  syncTogglePlacement()

  if (window.CommandBar?.addAction) {
    window.CommandBar.addAction({
      id: 'pengu-clubs-open',
      label: 'Open Clubs',
      group: 'Pengu Clubs',
      perform: () => toggleClubsPanel(),
    })
    window.CommandBar.addAction({
      id: 'pengu-clubs-discover',
      label: 'Discover Clubs',
      group: 'Pengu Clubs',
      perform: () => {
        showPanel()
        showDiscover()
      },
    })
  }
}

function resetPanelBindings() {
  panelEventsBound = false
}

function createPanel() {
  if (syncPanelRefs() && panelEl?.dataset.pcVersion === PANEL_VERSION) {
    mountFormView(panelEl)
    return
  }

  panelEl = document.createElement('div')
  panelEl.id = 'pengu-clubs-panel'
  panelEl.dataset.pcVersion = PANEL_VERSION
  panelEl.className = 'pc-panel pc-hidden'
  panelEl.style.cssText = `${PANEL_STYLE};position:fixed`
  panelEl.innerHTML = `
    <header class="pc-header">
      <div class="pc-header-left">
        <h2>Clubs</h2>
        <button type="button" class="pc-update-btn pc-hidden" data-action="apply-update" title="New update available — reload client">
          <span class="pc-update-dot" aria-hidden="true"></span>
          <span class="pc-update-label">Update</span>
        </button>
      </div>
      <button class="pc-close" aria-label="Close">×</button>
    </header>
    <div class="pc-config-banner pc-hidden"></div>
    <div class="pc-body">
      <aside class="pc-sidebar">
        <div class="pc-actions">
          <button type="button" class="pc-btn" data-action="create">+ Create</button>
          <button type="button" class="pc-btn" data-action="join">Join</button>
          <button type="button" class="pc-btn" data-action="discover">Find</button>
        </div>
        <ul class="pc-club-list"></ul>
        <div class="pc-discover pc-hidden">
          <input type="text" class="pc-discover-input" placeholder="Search tag or name…" maxlength="32" />
          <ul class="pc-discover-results"></ul>
        </div>
      </aside>
      <main class="pc-main">
        <div class="pc-empty">Select or create a club</div>
        <div class="pc-form-view pc-hidden">
          <h3 class="pc-form-title"></h3>
          <div class="pc-form-fields"></div>
          <p class="pc-form-error pc-hidden"></p>
          <div class="pc-form-actions">
            <button type="button" class="pc-btn" data-action="form-cancel">Cancel</button>
            <button type="button" class="pc-btn" data-action="form-submit">Confirm</button>
          </div>
        </div>
        <div class="pc-chat pc-hidden">
          <div class="pc-chat-header">
            <div class="pc-club-title-row">
              <div class="pc-club-title"></div>
              <div class="pc-club-title-actions">
                <button type="button" class="pc-btn-small pc-btn-main" data-action="toggle-main-club">Set as main</button>
                <button type="button" class="pc-btn-small pc-btn-danger pc-hidden" data-action="leave-club">Leave</button>
              </div>
            </div>
            <div class="pc-motd-row">
              <div class="pc-motd"></div>
              <button class="pc-btn-small pc-hidden" data-action="edit-motd">Edit MOTD</button>
            </div>
            <div class="pc-invite-row">
              <span class="pc-invite-label">Invite:</span>
              <button type="button" class="pc-invite-code" data-action="copy-invite" title="Click to copy">—</button>
              <button type="button" class="pc-btn-small" data-action="regen-invite">New code</button>
            </div>
          </div>
          <div class="pc-chat-body">
            <div class="pc-thread-wrap">
            <button type="button" class="pc-load-more pc-hidden" data-action="load-older">Load older messages</button>
              <div class="pc-thread"></div>
            </div>
            <aside class="pc-members-wrap">
              <h4>Members</h4>
              <ul class="pc-members"></ul>
            </aside>
          </div>
          <form class="pc-compose">
            <input type="text" class="pc-input" placeholder="Message your club…" maxlength="500" autocomplete="off" />
            <button type="submit" class="pc-btn" data-action="send-message">Send</button>
          </form>
        </div>
      </main>
    </div>
  `

  getMountRoot().appendChild(panelEl)
  clubListEl = panelEl.querySelector('.pc-club-list')
  discoverPanelEl = panelEl.querySelector('.pc-discover')
  mountFormView(panelEl)
  updateConfigBanner()
}

function bindPanelEvents() {
  if (!panelEl || panelEventsBound) return
  panelEventsBound = true
  const discoverInput = panelEl.querySelector('.pc-discover-input')
  let discoverTimer = null
  discoverInput?.addEventListener('input', () => {
    clearTimeout(discoverTimer)
    discoverTimer = setTimeout(() => runDiscoverSearch(discoverInput.value), 300)
  })

  chat.bindChatElements({
    thread: panelEl.querySelector('.pc-thread'),
    input: panelEl.querySelector('.pc-input'),
    members: panelEl.querySelector('.pc-members'),
    motd: panelEl.querySelector('.pc-motd'),
    invite: panelEl.querySelector('.pc-invite-code'),
    motdEdit: panelEl.querySelector('[data-action="edit-motd"]'),
    loadMore: panelEl.querySelector('.pc-load-more'),
  })

  setMembersRefreshCallback(() => {
    if (chat.activeClubId) chat.loadMembers({ silent: true })
  })

  setPresenceRefreshCallback(() => {
    if (chat.activeClubId) chat.refreshMemberPresence()
  })
}

function wireMembershipSync() {
  chat.setMembershipLostCallback((clubId) => {
    handleRemovedFromClub(clubId, 'You were removed from this club')
    syncClubList({ silent: true })
  })
  setClubListSyncCallback(() => syncClubList({ silent: true }))
}

function handleRemovedFromClub(clubId, message = 'You are no longer a member of this club') {
  if (!clubId) return

  const wasInList = clubsCache.has(clubId)
  const wasActive = chat.activeClubId === clubId
  const wasMain = clubsCache.get(clubId)?.is_main
  if (!wasInList && !wasActive) return

  clubsCache.delete(clubId)
  notify.clearUnread(clubId)

  if (wasActive) {
    chat.closeClub()
    panelEl?.querySelector('.pc-chat')?.classList.add('pc-hidden')
    panelEl?.querySelector('.pc-empty')?.classList.remove('pc-hidden')
  }

  if (wasMain) setOwnMainTag('')
  refreshTagCache()
  showToast(message, 'info', 5000)
}

function renderClubList(clubs) {
  if (!clubListEl) return
  clubListEl.innerHTML = ''
  clubsCache.clear()

  if (!clubs?.length) {
    clubListEl.innerHTML = '<li class="pc-empty-item">No clubs yet</li>'
    notify.syncClubs([])
    return
  }

  for (const club of clubs) {
    clubsCache.set(club.id, club)
    const li = document.createElement('li')
    li.className = 'pc-club-item'
    if (club.is_main) li.classList.add('pc-club-is-main')
    li.dataset.id = club.id
    li.innerHTML = `<span class="pc-club-item-name"><span class="pc-tag">[${club.tag}]</span> ${club.name}</span>${club.is_main ? '<span class="pc-main-badge" title="Main club">MAIN</span>' : ''}`
    clubListEl.appendChild(li)
  }

  notify.syncClubs(clubs)
  notify.updateClubListBadges()
}

async function syncClubList({ silent = false } = {}) {
  if (!isConfigured()) return
  syncPanelRefs()
  if (!clubListEl) return

  try {
    const clubs = await api.getMyClubs()
    const list = clubs ?? []
    const remoteIds = new Set(list.map((c) => c.id))

    for (const id of [...clubsCache.keys()]) {
      if (!remoteIds.has(id)) {
        handleRemovedFromClub(id, 'You were removed from this club')
      }
    }

    if (!silent) clubListEl.innerHTML = '<li class="pc-loading">Loading clubs…</li>'
    renderClubList(list)
    if (chat.activeClub) {
      const fresh = clubsCache.get(chat.activeClub.id)
      if (fresh) {
        chat.activeClub.is_main = Boolean(fresh.is_main)
        updateMainClubButton(chat.activeClub)
      }
    }
  } catch (err) {
    if (!silent) {
      clubListEl.innerHTML = `<li class="pc-error">${err.message}</li>`
      showToast(err.message)
    }
  }
}

async function refreshClubList() {
  await syncClubList({ silent: false })
}

function updateConfigBanner() {
  const banner = panelEl?.querySelector('.pc-config-banner')
  if (!banner) return

  if (isConfigured()) {
    banner.classList.add('pc-hidden')
    return
  }

  banner.classList.remove('pc-hidden')
  banner.textContent = 'Supabase not configured — edit plugins/pengu-clubs/config.js'
}

async function waitForSessionThenInit() {
  const poll = async () => {
    if (!api.isSessionReady()) {
      setTimeout(poll, 1000)
      return
    }
    try {
      await api.fetchIdentity()
      if (isConfigured()) {
        const joinedDefault = await api.ensureDefaultClubJoin().catch((err) => {
          console.warn('[pengu-clubs] default club join failed:', err.message)
          return false
        })
        await refreshClubList()
        if (joinedDefault) showToast('Joined League Clubs', 'success', 3500)
        startPresenceLoop()
        refreshTagCache()
      }
    } catch {
      setTimeout(poll, 2000)
    }
  }
  poll()
}

export function onSessionReady() {
  api.setSessionReady(true)
}

function isPanelVisible() {
  const el = getPanel()
  return Boolean(el && !el.classList.contains('pc-hidden') && el.style.display !== 'none')
}

export function toggleClubsPanel() {
  if (isPanelVisible()) hidePanel()
  else showPanel()
}

function showPanel() {
  if (!getPanel()) {
    try {
      createPanel()
    } catch (err) {
      console.error('[pengu-clubs] createPanel failed:', err)
      showToast(`Failed to open Clubs: ${err.message}`)
      return
    }
  }

  ensurePanelInDom()
  ensureFormView(panelEl)
  panelEl.classList.remove('pc-hidden', 'pc-panel-open')
  applyPanelLayout(panelEl, { visible: true })
  requestAnimationFrame(() => {
    panelEl?.classList.add('pc-panel-open')
  })
  updateConfigBanner()
  setToggleOpen(true)
  queuePanelAnchor()

  if (isConfigured()) {
    refreshClubList().catch((err) => showToast(err.message))
  }

  checkForUpdate()
}

function hidePanel() {
  const el = getPanel()
  if (!el) return
  el.classList.remove('pc-panel-open')
  el.classList.add('pc-hidden')
  el.style.display = 'none'
  setToggleOpen(false)
  hideDiscover()
  checkForUpdate()
}

function showDiscover() {
  clubListEl?.classList.add('pc-hidden')
  discoverPanelEl?.classList.remove('pc-hidden')
  panelEl.querySelector('.pc-discover-input')?.focus()
}

function hideDiscover() {
  clubListEl?.classList.remove('pc-hidden')
  discoverPanelEl?.classList.add('pc-hidden')
}

async function runDiscoverSearch(query) {
  const resultsEl = panelEl.querySelector('.pc-discover-results')
  if (!resultsEl) return

  if (!query || query.trim().length < 2) {
    resultsEl.innerHTML = '<li class="pc-empty-item">Type 2+ chars to search</li>'
    return
  }

  if (!isConfigured()) {
    resultsEl.innerHTML = '<li class="pc-error">Configure Supabase first</li>'
    return
  }

  resultsEl.innerHTML = '<li class="pc-loading">Searching…</li>'

  try {
    const results = await api.searchClubs(query)
    resultsEl.innerHTML = ''
    discoverCache.clear()

    if (!results?.length) {
      resultsEl.innerHTML = '<li class="pc-empty-item">No clubs found</li>'
      return
    }

    for (const club of results) {
      discoverCache.set(club.id, club)
      const li = document.createElement('li')
      li.className = 'pc-discover-item'
      li.dataset.id = club.id
      li.innerHTML = `
        <span class="pc-tag">[${club.tag}]</span>
        <span class="pc-discover-name">${club.name}</span>
        <span class="pc-discover-meta">${club.member_count ?? 0} members</span>
      `
      li.title = club.motd || 'No MOTD'
      resultsEl.appendChild(li)
    }
  } catch (err) {
    resultsEl.innerHTML = `<li class="pc-error">${err.message}</li>`
    showToast(err.message)
  }
}

function selectClub(club) {
  hideDiscover()
  closeForm()
  chat.closeClub()
  notify.clearUnread(club.id)
  syncPanelRefs()

  chat.bindChatElements({
    thread: panelEl.querySelector('.pc-thread'),
    input: panelEl.querySelector('.pc-compose .pc-input'),
    members: panelEl.querySelector('.pc-members'),
    motd: panelEl.querySelector('.pc-motd'),
    invite: panelEl.querySelector('.pc-invite-code'),
    motdEdit: panelEl.querySelector('[data-action="edit-motd"]'),
    loadMore: panelEl.querySelector('.pc-load-more'),
  })

  panelEl.querySelector('.pc-empty')?.classList.add('pc-hidden')
  const chatEl = panelEl.querySelector('.pc-chat')
  chatEl?.classList.remove('pc-hidden')

  panelEl.querySelector('.pc-club-title').textContent = `[${club.tag}] ${club.name}`
  clubListEl.querySelectorAll('.pc-club-item').forEach((el) => {
    el.classList.toggle('pc-active', el.dataset.id === club.id)
  })
  updateMainClubButton(club)

  chat.openClub(club)
}

function updateMainClubButton(club) {
  const btn = panelEl?.querySelector('[data-action="toggle-main-club"]')
  if (!btn || !club) return
  const isMain = Boolean(club.is_main)
  btn.textContent = isMain ? 'Clear main' : 'Set as main'
  btn.classList.toggle('pc-main-active', isMain)
  btn.title = isMain
    ? 'Remove club tag from your nickname'
    : 'Show this club tag after your nickname'
}

async function toggleMainClub() {
  const club = chat.activeClub
  if (!club?.id) return

  try {
    if (club.is_main) {
      await api.clearMainClub()
      for (const c of clubsCache.values()) c.is_main = false
      club.is_main = false
      setOwnMainTag('')
      showToast('Main club cleared', 'success')
    } else {
      const result = await api.setMainClub(club.id)
      for (const c of clubsCache.values()) c.is_main = c.id === club.id
      club.is_main = true
      setOwnMainTag(result?.tag || club.tag)
      showToast(`Main club set to ${club.tag}`, 'success')
    }
    updateMainClubButton(club)
    renderClubList([...clubsCache.values()])
    clubListEl?.querySelectorAll('.pc-club-item').forEach((el) => {
      el.classList.toggle('pc-active', el.dataset.id === club.id)
    })
    refreshTagCache()
  } catch (err) {
    showToast(err.message)
  }
}

function leaveActiveClub() {
  const id = chat.activeClubId
  const left = id ? clubsCache.get(id) : null
  chat.closeClub()
  if (id) clubsCache.delete(id)
  panelEl?.querySelector('.pc-chat')?.classList.add('pc-hidden')
  panelEl?.querySelector('.pc-empty')?.classList.remove('pc-hidden')
  if (left?.is_main) setOwnMainTag('')
  syncClubList({ silent: true })
  refreshTagCache()
  showToast('Left club', 'success')
}

export function handlePanelAction(action, payload) {
  syncPanelRefs()

  switch (action) {
    case 'close':
      hidePanel()
      break
    case 'create':
      showCreateForm()
      break
    case 'join':
      showJoinForm()
      break
    case 'discover':
      showDiscover()
      break
    case 'apply-update':
      applyUpdate()
      break
    case 'form-cancel':
      closeForm()
      break
    case 'form-submit':
      submitForm()
      break
    case 'send-message':
      chat.handleSend()
      break
    case 'copy-invite':
      chat.handleCopyInvite()
      break
    case 'load-older':
      chat.handleLoadOlder()
      break
    case 'select-club': {
      const club = clubsCache.get(payload)
      if (club) selectClub(club)
      break
    }
    case 'select-discover': {
      const joined = clubsCache.get(payload)
      if (joined) {
        selectClub(joined)
      } else {
        const found = discoverCache.get(payload)
        showToast(
          found ? `Join with invite code to enter [${found.tag}]` : 'Join with invite code to enter this club',
          'info',
          5000,
        )
      }
      break
    }
    case 'regen-invite':
      chat.handleRegenerateInvite((code) => {
        const club = clubsCache.get(chat.activeClubId)
        if (club) club.invite_code = code
      })
      break
    case 'edit-motd':
      chat.handleEditMotd()
      break
    case 'leave-club':
      chat.handleLeaveClub(() => leaveActiveClub())
      break
    case 'toggle-main-club':
      toggleMainClub()
      break
    case 'kick-member':
      if (payload) chat.handleKickMember(payload)
      break
    default:
      break
  }
}

function showCreateForm() {
  if (!isConfigured()) {
    showToast('Configure Supabase in config.js first')
    return
  }

  syncPanelRefs()
  panelEl?.querySelector('.pc-empty')?.classList.add('pc-hidden')
  panelEl?.querySelector('.pc-chat')?.classList.add('pc-hidden')

  try {
    openForm({
      title: 'Create Club',
      fields: [
        { id: 'tag', label: 'Tag (3–5 letters/numbers)', placeholder: 'ABC', maxLength: 5 },
        { id: 'name', label: 'Club name', placeholder: 'My Club', maxLength: 50 },
        { id: 'motd', label: 'MOTD (optional)', placeholder: 'Welcome!', maxLength: 200 },
      ],
      onSubmit: async (values) => {
        if (!values.tag || !values.name) throw new Error('Tag and name are required')
        const club = await api.createClub(values.tag, values.name, values.motd ?? '')
        club.role = 'owner'
        clubsCache.set(club.id, club)
        await refreshClubList()
        selectClub(club)
        showToast('Club created', 'success')
      },
    })
  } catch (err) {
    showToast(err.message)
    panelEl?.querySelector('.pc-empty')?.classList.remove('pc-hidden')
  }
}

function showJoinForm() {
  if (!isConfigured()) {
    showToast('Configure Supabase in config.js first')
    return
  }

  syncPanelRefs()
  panelEl?.querySelector('.pc-empty')?.classList.add('pc-hidden')
  panelEl?.querySelector('.pc-chat')?.classList.add('pc-hidden')

  try {
    openForm({
      title: 'Join Club',
      fields: [
        { id: 'code', label: 'Invite code', placeholder: 'ABCD1234', maxLength: 12 },
      ],
      onSubmit: async (values) => {
        if (!values.code) throw new Error('Invite code is required')
        const club = await api.joinClub(values.code)
        club.role = 'member'
        await refreshClubList()
        selectClub(club)
        showToast(`Joined [${club.tag}]`, 'success')
      },
    })
  } catch (err) {
    showToast(err.message)
    panelEl?.querySelector('.pc-empty')?.classList.remove('pc-hidden')
  }
}
