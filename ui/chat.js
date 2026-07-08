import * as api from '../api.js'
import { mergeMemberPresence, fetchLocalStatus, startMemberRefreshLoop, stopMemberRefreshLoop, reportPresenceToClubs } from '../presence.js'
import { showToast } from './toast.js'
import { openForm } from './forms.js'
import { copyText } from './clipboard.js'

/** @type {string|null} */
export let activeClubId = null
/** @type {object|null} */
export let activeClub = null
/** @type {(() => void)|null} */
let realtimeUnsub = null
/** @type {string|null} */
let oldestMessageAt = null
let hasMoreMessages = true
const PAGE_SIZE = 50
/** @type {object[]} */
let cachedMembers = []
/** @type {string|null} */
let myPuuid = null

const els = {
  thread: null,
  input: null,
  members: null,
  motd: null,
  invite: null,
  motdEdit: null,
  loadMore: null,
  leaveBtn: null,
}

export function bindChatElements(elements) {
  Object.assign(els, elements)
}

function panelRoot() {
  return document.getElementById('pengu-clubs-panel')
}

function ensureChatElements() {
  const panel = panelRoot()
  if (!panel) return false

  els.thread = panel.querySelector('.pc-thread')
  els.input = panel.querySelector('.pc-compose .pc-input')
  els.members = panel.querySelector('.pc-members')
  els.motd = panel.querySelector('.pc-motd')
  els.invite = panel.querySelector('.pc-invite-code')
  els.motdEdit = panel.querySelector('[data-action="edit-motd"]')
  els.loadMore = panel.querySelector('.pc-load-more')
  els.leaveBtn = panel.querySelector('[data-action="leave-club"]')

  return Boolean(els.thread && els.input && els.members)
}

export async function openClub(club) {
  if (realtimeUnsub) realtimeUnsub()

  ensureChatElements()

  activeClubId = club.id
  activeClub = club
  oldestMessageAt = null
  hasMoreMessages = true

  const me = await api.fetchIdentity()
  myPuuid = me.puuid

  renderMotd(club)
  renderInvite(club)
  updateClubChrome(club)

  await reportPresenceToClubs()
  await Promise.all([loadMessages(), loadMembers()])

  const sub = api.subscribeToMessages(club.id, (record) => {
    appendMessage(record, true)
  })
  realtimeUnsub = sub.unsubscribe

  startMemberRefreshLoop()
}

export function closeClub() {
  if (realtimeUnsub) realtimeUnsub()
  realtimeUnsub = null
  stopMemberRefreshLoop()
  activeClubId = null
  activeClub = null
  myPuuid = null
  oldestMessageAt = null
  hasMoreMessages = true
  cachedMembers = []
  if (els.thread) els.thread.innerHTML = ''
  if (els.members) els.members.innerHTML = ''
  if (els.loadMore) els.loadMore.classList.add('pc-hidden')
}

function renderMotd(club) {
  if (!els.motd) return
  els.motd.textContent = club.motd ? `MOTD: ${club.motd}` : 'No MOTD set.'
}

function renderInvite(club) {
  ensureChatElements()
  const code = club.invite_code ?? ''
  if (!els.invite) return
  els.invite.textContent = code || '—'
  els.invite.dataset.code = code
  els.invite.title = code ? 'Click to copy invite code' : ''
}

function updateMotdEditVisibility(club) {
  if (!els.motdEdit) return
  const canEdit = club.role === 'owner' || club.role === 'admin'
  els.motdEdit.classList.toggle('pc-hidden', !canEdit)
}

function updateClubChrome(club) {
  updateMotdEditVisibility(club)
  if (!els.leaveBtn) return
  els.leaveBtn.classList.toggle('pc-hidden', club.role === 'owner')
}

function canKickMember(m) {
  return activeClub?.role === 'owner' && m.role !== 'owner' && m.puuid !== myPuuid
}

async function loadMessages() {
  ensureChatElements()
  if (!els.thread || !activeClubId) return
  els.thread.innerHTML = '<div class="pc-loading">Loading messages…</div>'
  if (els.loadMore) els.loadMore.classList.add('pc-hidden')

  try {
    const messages = await api.getMessages(activeClubId, PAGE_SIZE)
    els.thread.innerHTML = ''

    const list = messages ?? []
    hasMoreMessages = list.length >= PAGE_SIZE
    if (list.length) oldestMessageAt = list[0].created_at

    for (const msg of list) appendMessage(msg, false)
    els.thread.scrollTop = els.thread.scrollHeight
    updateLoadMoreVisibility()
  } catch (err) {
    els.thread.innerHTML = `<div class="pc-error">${err.message}</div>`
    showToast(err.message)
  }
}

async function loadOlderMessages() {
  if (!els.thread || !activeClubId || !oldestMessageAt || !hasMoreMessages) return

  const btn = els.loadMore
  if (btn) {
    btn.disabled = true
    btn.textContent = 'Loading…'
  }

  const prevHeight = els.thread.scrollHeight

  try {
    const messages = await api.getMessages(activeClubId, PAGE_SIZE, oldestMessageAt)
    const list = messages ?? []
    hasMoreMessages = list.length >= PAGE_SIZE

    if (list.length) {
      oldestMessageAt = list[0].created_at
      for (const msg of list) prependMessage(msg)
      els.thread.scrollTop = els.thread.scrollHeight - prevHeight
    } else {
      hasMoreMessages = false
    }

    updateLoadMoreVisibility()
  } catch (err) {
    showToast(err.message)
  } finally {
    if (btn) {
      btn.disabled = false
      btn.textContent = 'Load older messages'
    }
  }
}

function updateLoadMoreVisibility() {
  if (!els.loadMore) return
  els.loadMore.classList.toggle('pc-hidden', !hasMoreMessages)
}

async function loadMembers({ silent = false } = {}) {
  ensureChatElements()
  if (!els.members || !activeClubId) return

  if (!silent) {
    els.members.innerHTML = '<li class="pc-loading">Loading…</li>'
  }

  try {
    const [members, presence, local, me] = await Promise.all([
      api.getClubMembers(activeClubId),
      api.getClubPresence(activeClubId).catch(() => []),
      fetchLocalStatus(),
      api.fetchIdentity(),
    ])

    cachedMembers = members ?? []
    const merged = mergeMemberPresence(cachedMembers, presence, local.friends, local, me.puuid)
    renderMembers(merged)
  } catch (err) {
    if (!silent) {
      els.members.innerHTML = `<li class="pc-error">${err.message}</li>`
      showToast(err.message)
    }
  }
}

export async function refreshMemberPresence() {
  ensureChatElements()
  if (!els.members || !activeClubId) return

  if (!cachedMembers.length) {
    await loadMembers({ silent: true })
    return
  }

  try {
    const [presence, local, me] = await Promise.all([
      api.getClubPresence(activeClubId).catch(() => []),
      fetchLocalStatus(),
      api.fetchIdentity(),
    ])

    const merged = mergeMemberPresence(cachedMembers, presence, local.friends, local, me.puuid)
    renderMembers(merged)
  } catch {
    // background refresh — keep current list visible
  }
}

function createMemberRow(m) {
  const li = document.createElement('li')
  li.className = 'pc-member'
  li.dataset.puuid = m.puuid
  li.dataset.status = m.status
  if (m.role === 'owner') li.dataset.role = 'owner'

  const dot = document.createElement('span')
  dot.className = 'pc-status-dot'
  dot.title = m.detail || m.status

  const top = document.createElement('div')
  top.className = 'pc-member-top'

  const name = document.createElement('span')
  name.className = 'pc-member-name'
  name.textContent = `${m.game_name}#${m.game_tag}`
  top.append(name)

  if (canKickMember(m)) top.append(createKickButton(m))

  const status = document.createElement('span')
  status.className = 'pc-member-status'
  status.textContent = m.detail || statusLabel(m.status)

  li.append(dot, top, status)
  return li
}

function createKickButton(m) {
  const kick = document.createElement('button')
  kick.type = 'button'
  kick.className = 'pc-member-kick pc-btn-small'
  kick.dataset.action = 'kick-member'
  kick.dataset.puuid = m.puuid
  kick.title = 'Remove from club'
  kick.textContent = '×'
  return kick
}

function syncKickButton(li, m) {
  const top = li.querySelector('.pc-member-top') ?? li
  let kick = li.querySelector('.pc-member-kick')

  if (canKickMember(m)) {
    if (!kick) {
      top.append(createKickButton(m))
    } else {
      kick.dataset.puuid = m.puuid
    }
    return
  }

  kick?.remove()
}

function updateMemberRow(li, m) {
  const status = m.status || 'offline'
  const label = m.detail || statusLabel(status)

  if (li.dataset.status !== status) li.dataset.status = status
  if (m.role === 'owner') li.dataset.role = 'owner'
  else delete li.dataset.role

  const dot = li.querySelector('.pc-status-dot')
  if (dot) dot.title = label

  const name = li.querySelector('.pc-member-name')
  if (name) name.textContent = `${m.game_name}#${m.game_tag}`

  const statusEl = li.querySelector('.pc-member-status')
  if (statusEl && statusEl.textContent !== label) statusEl.textContent = label

  syncKickButton(li, m)
}

function renderMembers(merged) {
  if (!els.members) return

  if (!merged.length) {
    els.members.innerHTML = '<li class="pc-empty-item">No members found</li>'
    return
  }

  els.members.querySelectorAll('.pc-loading, .pc-error, .pc-empty-item').forEach((el) => el.remove())

  const existing = new Map()
  for (const li of els.members.querySelectorAll('.pc-member')) {
    if (li.dataset.puuid) existing.set(li.dataset.puuid, li)
  }

  for (const m of merged) {
    const row = existing.get(m.puuid)
    if (row) {
      updateMemberRow(row, m)
      existing.delete(m.puuid)
      els.members.appendChild(row)
    } else {
      els.members.appendChild(createMemberRow(m))
    }
  }

  for (const [, row] of existing) row.remove()
}

function statusLabel(status) {
  const labels = { online: 'Online', ingame: 'In Game', away: 'Away', offline: 'Offline' }
  return labels[status] ?? 'Offline'
}

export { loadMembers }

function appendMessage(msg, scroll) {
  ensureChatElements()
  if (!els.thread || !msg) return
  if (els.thread.querySelector(`[data-id="${msg.id}"]`)) return

  const loading = els.thread.querySelector('.pc-loading')
  if (loading) loading.remove()

  const row = buildMessageRow(msg)
  els.thread.appendChild(row)

  if (scroll) els.thread.scrollTop = els.thread.scrollHeight
}

function prependMessage(msg) {
  if (!els.thread || !msg) return
  if (els.thread.querySelector(`[data-id="${msg.id}"]`)) return
  els.thread.insertBefore(buildMessageRow(msg), els.thread.firstChild)
}

function buildMessageRow(msg) {
  const row = document.createElement('div')
  row.className = 'pc-message'
  row.dataset.id = msg.id

  const meta = document.createElement('div')
  meta.className = 'pc-message-meta'

  const author = document.createElement('span')
  author.className = 'pc-message-author'
  author.textContent = `${msg.game_name}#${msg.game_tag}`
  author.title = `${msg.game_name}#${msg.game_tag}`

  const time = document.createElement('span')
  time.className = 'pc-message-time'
  time.textContent = formatTime(msg.created_at)

  const body = document.createElement('div')
  body.className = 'pc-message-body'
  body.textContent = msg.body

  meta.append(author, time)
  row.append(meta, body)
  return row
}

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export async function handleSend() {
  ensureChatElements()
  if (!activeClubId || !els.input) {
    showToast('Chat not ready — re-open club')
    return
  }

  const body = els.input.value.trim()
  if (!body) return

  els.input.value = ''
  els.input.disabled = true

  try {
    const msg = await api.sendMessage(activeClubId, body)
    appendMessage(msg, true)
  } catch (err) {
    els.input.value = body
    showToast(err.message)
  } finally {
    els.input.disabled = false
    els.input.focus()
  }
}

export async function handleCopyInvite() {
  ensureChatElements()
  const code = els.invite?.dataset.code || activeClub?.invite_code || els.invite?.textContent
  await copyText(code?.trim())
}

export async function handleRegenerateInvite(onUpdate) {
  if (!activeClubId) return
  try {
    const code = await api.regenerateInvite(activeClubId)
    if (activeClub) activeClub.invite_code = code
    renderInvite(activeClub ?? { invite_code: code })
    onUpdate?.(code)
    await copyText(code)
  } catch (err) {
    showToast(err.message)
  }
}

export async function handleEditMotd() {
  if (!activeClubId || !activeClub) return

  openForm({
    title: 'Edit MOTD',
    fields: [
      { id: 'motd', label: 'Message of the day', placeholder: 'Welcome to our club!', maxLength: 200 },
    ],
    onSubmit: async (values) => {
      const updated = await api.updateMotd(activeClubId, values.motd ?? '')
      activeClub.motd = updated.motd
      renderMotd(activeClub)
      showToast('MOTD updated', 'success')
    },
  })
}

export function handleLoadOlder() {
  loadOlderMessages()
}

export function handleLeaveClub(onLeft) {
  if (!activeClubId || !activeClub) return

  if (activeClub.role === 'owner') {
    showToast('Club owner cannot leave')
    return
  }

  openForm({
    title: `Leave [${activeClub.tag}] ${activeClub.name}?`,
    fields: [],
    submitLabel: 'Leave',
    onSubmit: async () => {
      await api.leaveClub(activeClubId)
      onLeft?.()
    },
  })
}

export function handleKickMember(targetPuuid) {
  if (!activeClubId || activeClub?.role !== 'owner' || !targetPuuid) return

  const member = cachedMembers.find((m) => m.puuid === targetPuuid)
  const label = member ? `${member.game_name}#${member.game_tag}` : 'this member'

  openForm({
    title: `Remove ${label} from the club?`,
    fields: [],
    submitLabel: 'Remove',
    onSubmit: async () => {
      await api.kickMember(activeClubId, targetPuuid)
      cachedMembers = cachedMembers.filter((m) => m.puuid !== targetPuuid)
      await loadMembers({ silent: true })
      showToast('Member removed', 'success')
    },
  })
}
