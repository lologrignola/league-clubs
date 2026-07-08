import * as api from '../api.js'

/** @type {string|null} */
let activeClubId = null
/** @type {((record: object) => void)|null} */
let activeClubListener = null
/** @type {(() => void)|null} */
let activeClubUnsub = null
/** @type {Map<string, () => void>} */
const backgroundSubs = new Map()
/** @type {Map<string, number>} */
const unreadByClub = new Map()
/** @type {string[]} */
let clubIds = []

let audioCtx = null

function isPanelOpen() {
  const panel = document.getElementById('pengu-clubs-panel')
  return Boolean(panel && !panel.classList.contains('pc-hidden') && panel.style.display !== 'none')
}

function isViewingClub(clubId) {
  return isPanelOpen() && activeClubId === clubId
}

function playMessageSound() {
  try {
    if (!audioCtx) audioCtx = new AudioContext()
    const ctx = audioCtx
    if (ctx.state === 'suspended') ctx.resume()

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 740
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.15)
  } catch {
    // audio blocked or unavailable
  }
}

function totalUnread() {
  let total = 0
  for (const count of unreadByClub.values()) total += count
  return total
}

export function updateToggleBadge() {
  const btn = document.getElementById('pengu-clubs-toggle')
  const badge = btn?.querySelector('.pc-toggle-badge')
  if (!badge) return

  const total = totalUnread()
  if (total > 0) {
    badge.textContent = total > 99 ? '99+' : String(total)
    badge.classList.remove('pc-hidden')
    btn.classList.add('pc-toggle-has-unread')
  } else {
    badge.textContent = ''
    badge.classList.add('pc-hidden')
    btn.classList.remove('pc-toggle-has-unread')
  }
}

export function updateClubListBadges() {
  const list = document.querySelector('#pengu-clubs-panel .pc-club-list')
  if (!list) return

  for (const item of list.querySelectorAll('.pc-club-item')) {
    const id = item.dataset.id
    const count = unreadByClub.get(id) || 0
    let badge = item.querySelector('.pc-club-unread')

    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span')
        badge.className = 'pc-club-unread'
        item.appendChild(badge)
      }
      badge.textContent = count > 9 ? '9+' : String(count)
      item.classList.add('pc-club-has-unread')
    } else {
      badge?.remove()
      item.classList.remove('pc-club-has-unread')
    }
  }
}

function bumpUnread(clubId) {
  unreadByClub.set(clubId, (unreadByClub.get(clubId) || 0) + 1)
  updateToggleBadge()
  updateClubListBadges()
}

export function clearUnread(clubId) {
  if (!clubId) return
  if (!unreadByClub.has(clubId)) return
  unreadByClub.delete(clubId)
  updateToggleBadge()
  updateClubListBadges()
}

function handleIncoming(clubId, record, fromActiveChannel) {
  const me = api.getIdentity()
  if (me?.puuid && record.puuid === me.puuid) {
    if (fromActiveChannel && isViewingClub(clubId)) {
      activeClubListener?.(record)
    }
    return
  }

  if (fromActiveChannel && activeClubListener) {
    activeClubListener(record)
  }

  if (!isViewingClub(clubId)) {
    bumpUnread(clubId)
    playMessageSound()
  }
}

function syncBackgroundSubs() {
  const needed = new Set(clubIds.filter((id) => id !== activeClubId))

  for (const [id, unsub] of backgroundSubs) {
    if (!needed.has(id)) {
      unsub()
      backgroundSubs.delete(id)
    }
  }

  for (const id of needed) {
    if (backgroundSubs.has(id)) continue
    const sub = api.subscribeToMessages(id, (record) => handleIncoming(id, record, false))
    backgroundSubs.set(id, sub.unsubscribe)
  }
}

export function syncClubs(clubs) {
  clubIds = (clubs ?? []).map((c) => c.id)
  syncBackgroundSubs()
}

export function setActiveClub(clubId, onMessage) {
  if (activeClubUnsub) {
    activeClubUnsub()
    activeClubUnsub = null
  }

  activeClubId = clubId
  activeClubListener = onMessage ?? null

  if (clubId) {
    const sub = api.subscribeToMessages(clubId, (record) => handleIncoming(clubId, record, true))
    activeClubUnsub = sub.unsubscribe
  }

  syncBackgroundSubs()
}

export function stopAll() {
  setActiveClub(null, null)
  for (const unsub of backgroundSubs.values()) unsub()
  backgroundSubs.clear()
  clubIds = []
}
