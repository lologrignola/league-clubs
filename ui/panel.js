import * as api from '../api.js'
import * as chat from './chat.js'
import { startPresenceLoop, setMembersRefreshCallback, setPresenceRefreshCallback } from '../presence.js'
import { showToast } from './toast.js'
import { isConfigured } from '../config.js'
import * as notify from './notify.js'
import { mountFormView, openForm, closeForm, submitForm, ensureFormView } from './forms.js'

const PANEL_STYLE = [
  'position:fixed',
  'bottom:72px',
  'right:24px',
  'z-index:2147483647',
  'width:760px',
  'height:500px',
  'display:none',
  'flex-direction:column',
  'pointer-events:auto',
  'overflow:hidden',
].join(';')

const BTN_STYLE = [
  'position:fixed',
  'bottom:24px',
  'right:24px',
  'z-index:2147483646',
  'pointer-events:auto',
].join(';')

let panelEl = null
let clubListEl = null
let discoverPanelEl = null
let panelEventsBound = false
/** @type {Map<string, object>} */
const clubsCache = new Map()
/** @type {Map<string, object>} */
const discoverCache = new Map()

const PANEL_VERSION = '8'

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
    createToggleButton()
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

function setToggleLabel(text) {
  const btn = document.getElementById('pengu-clubs-toggle')
  const label = btn?.querySelector('.pc-toggle-label')
  if (label) label.textContent = text
}

function createToggleButton() {
  let btn = document.getElementById('pengu-clubs-toggle')
  if (!btn) {
    btn = document.createElement('button')
    btn.id = 'pengu-clubs-toggle'
    btn.className = 'pc-toggle-btn'
    btn.type = 'button'
    btn.style.cssText = BTN_STYLE
    btn.innerHTML = `
      <span class="pc-toggle-label">Clubs</span>
      <span class="pc-toggle-badge pc-hidden" aria-label="Unread messages"></span>
    `
    btn.title = 'Toggle Clubs panel'
    getMountRoot().appendChild(btn)
  } else {
    btn.style.cssText = BTN_STYLE
    if (!btn.querySelector('.pc-toggle-label')) {
      btn.innerHTML = `
        <span class="pc-toggle-label">Clubs</span>
        <span class="pc-toggle-badge pc-hidden" aria-label="Unread messages"></span>
      `
    }
  }

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
      <h2>Clubs</h2>
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
              <button type="button" class="pc-btn-small pc-btn-danger pc-hidden" data-action="leave-club">Leave</button>
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
  panelEl.classList.remove('pc-hidden')
  panelEl.style.cssText = `${PANEL_STYLE};display:flex!important`
  updateConfigBanner()

  const btn = document.getElementById('pengu-clubs-toggle')
  if (btn) setToggleLabel('Clubs ▲')

  if (isConfigured()) {
    refreshClubList().catch((err) => showToast(err.message))
  }
}

function hidePanel() {
  const el = getPanel()
  if (!el) return
  el.classList.add('pc-hidden')
  el.style.display = 'none'
  const btn = document.getElementById('pengu-clubs-toggle')
  if (btn) setToggleLabel('Clubs')
  hideDiscover()
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

async function refreshClubList() {
  if (!clubListEl || !isConfigured()) return
  clubListEl.innerHTML = '<li class="pc-loading">Loading clubs…</li>'

  try {
    const clubs = await api.getMyClubs()
    clubListEl.innerHTML = ''
    clubsCache.clear()

    if (!clubs?.length) {
      clubListEl.innerHTML = '<li class="pc-empty-item">No clubs yet</li>'
      return
    }

    for (const club of clubs) {
      clubsCache.set(club.id, club)
      const li = document.createElement('li')
      li.className = 'pc-club-item'
      li.dataset.id = club.id
      li.innerHTML = `<span class="pc-club-item-name"><span class="pc-tag">[${club.tag}]</span> ${club.name}</span>`
      clubListEl.appendChild(li)
    }

    notify.syncClubs(clubs)
    notify.updateClubListBadges()
  } catch (err) {
    clubListEl.innerHTML = `<li class="pc-error">${err.message}</li>`
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

  chat.openClub(club)
}

function leaveActiveClub() {
  const id = chat.activeClubId
  chat.closeClub()
  if (id) clubsCache.delete(id)
  panelEl?.querySelector('.pc-chat')?.classList.add('pc-hidden')
  panelEl?.querySelector('.pc-empty')?.classList.remove('pc-hidden')
  refreshClubList()
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
