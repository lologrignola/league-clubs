import * as api from '../api.js'
import { isConfigured } from '../config.js'

const TAG_ATTR = 'data-pc-club-tag'
const TAG_CLASS = 'pc-native-club-tag'
/** How often to re-fetch tags from Supabase */
const POLL_MS = 120_000
/** Debounce DOM inject after mutations */
const INJECT_DEBOUNCE_MS = 350
/** Debounce LCU friend events → network refresh */
const FRIENDS_REFRESH_DEBOUNCE_MS = 8_000
/** Re-check for social sidebar if not found yet */
const ROOT_RETRY_MS = 5_000

/** @type {Map<string, string>} puuid → tag */
const tagByPuuid = new Map()

/** @type {string|null} */
let myPuuid = null
/** @type {string|null} */
let myGameName = null

/** @type {MutationObserver|null} */
let observer = null
/** @type {ReturnType<typeof setInterval>|null} */
let pollTimer = null
/** @type {ReturnType<typeof setInterval>|null} */
let rootRetryTimer = null
/** @type {ReturnType<typeof setTimeout>|null} */
let injectTimer = null
/** @type {ReturnType<typeof setTimeout>|null} */
let friendsRefreshTimer = null
/** @type {Element|null} */
let observedRoot = null
let started = false
let refreshInFlight = false
let lastRefreshAt = 0

function normalizeTag(tag) {
  if (!tag || typeof tag !== 'string') return ''
  return tag.trim().toUpperCase()
}

export function getCachedTag(puuid) {
  if (!puuid) return ''
  return tagByPuuid.get(puuid) || ''
}

export function getTagCacheSnapshot() {
  return new Map(tagByPuuid)
}

/** Update cache entries; empty tag removes. Triggers re-inject. */
export function setCachedTags(entries) {
  let changed = false
  for (const [puuid, tag] of entries) {
    if (!puuid) continue
    const next = normalizeTag(tag)
    const prev = tagByPuuid.get(puuid) || ''
    if (!next) {
      if (tagByPuuid.has(puuid)) {
        tagByPuuid.delete(puuid)
        changed = true
      }
    } else if (prev !== next) {
      tagByPuuid.set(puuid, next)
      changed = true
    }
  }
  if (changed) queueInject()
}

export function setOwnMainTag(tag) {
  if (!myPuuid) return
  setCachedTags([[myPuuid, tag || '']])
}

function findSocialRoot() {
  return (
    document.querySelector('.lol-social-sidebar') ||
    document.querySelector('.rcp-fe-viewport-sidebar .social-plugin-home') ||
    document.querySelector('.social-roster') ||
    document.querySelector('.lol-social-lower') ||
    null
  )
}

function ensureTagSpan(host, tag) {
  if (!host) return
  const next = normalizeTag(tag)
  let span = host.querySelector?.(`:scope > .${TAG_CLASS}`) || null

  if (!span && host.parentElement) {
    const sib = host.nextElementSibling
    if (sib?.classList?.contains(TAG_CLASS)) span = sib
  }

  if (!next) {
    span?.remove()
    if (host.hasAttribute?.(TAG_ATTR)) host.removeAttribute(TAG_ATTR)
    return
  }

  if (!span) {
    span = document.createElement('span')
    span.className = TAG_CLASS
    if (host.appendChild) host.appendChild(span)
    else host.parentElement?.insertBefore(span, host.nextSibling)
  }

  if (span.textContent !== next) span.textContent = next
  if (host.getAttribute?.(TAG_ATTR) !== next) host.setAttribute?.(TAG_ATTR, next)
}

/**
 * Inject into social sidebar only — no full-document scans.
 */
function injectIntoSocial() {
  const root = findSocialRoot()
  if (!root) return

  ensureObserverOn(root)

  if (!tagByPuuid.size && !document.querySelector(`.${TAG_CLASS}`)) return

  const friendsByName = buildNameIndex()

  const nameEls = root.querySelectorAll(
    [
      '.lol-social-identity .player-name',
      '.lol-social-identity .name',
      '.social-identity .player-name',
      '.friend-name',
      '.roster-player-name',
      '.player-name',
      '.summoner-name',
      '[class*="player-name"]',
      '[class*="summoner-name"]',
    ].join(', '),
  )

  for (const el of nameEls) {
    if (el.closest('#pengu-clubs-panel')) continue
    if (el.classList?.contains(TAG_CLASS)) continue

    if (myPuuid && myGameName && nameMatchesElement(el, myGameName)) {
      ensureTagSpan(el, tagByPuuid.get(myPuuid) || '')
      continue
    }

    const matched = matchElementToPuuid(el, friendsByName)
    if (!matched) continue
    ensureTagSpan(el, tagByPuuid.get(matched) || '')
  }
}

function nameMatchesElement(el, gameName) {
  if (!gameName || !el) return false
  const text = el.textContent?.replace(/\s+/g, ' ').trim() || ''
  const tagSpan = el.querySelector?.(`.${TAG_CLASS}`)
  const nameOnly = tagSpan
    ? text.replace(tagSpan.textContent || '', '').trim()
    : text
  const lower = nameOnly.toLowerCase()
  const gn = gameName.toLowerCase()
  return lower === gn || lower.startsWith(gn)
}

function matchElementToPuuid(el, friendsByName) {
  const tagSpan = el.querySelector?.(`.${TAG_CLASS}`)
  let text = el.textContent?.replace(/\s+/g, ' ').trim() || ''
  if (tagSpan) text = text.replace(tagSpan.textContent || '', '').trim()
  const base = text.split('#')[0].trim()
  return friendsByName.get(text.toLowerCase())
    || friendsByName.get(base.toLowerCase())
    || null
}

/** @returns {Map<string, string>} lowercased name → puuid */
function buildNameIndex() {
  /** @type {Map<string, string>} */
  const map = new Map()
  if (myPuuid && myGameName) {
    map.set(myGameName.toLowerCase(), myPuuid)
  }
  for (const [name, puuid] of friendNameToPuuid) {
    map.set(name, puuid)
  }
  return map
}

/** @type {Map<string, string>} */
const friendNameToPuuid = new Map()

async function refreshFriendIndex() {
  friendNameToPuuid.clear()
  try {
    const friends = await fetch('/lol-chat/v1/friends').then((r) => r.json()).catch(() => [])
    const puuids = []
    for (const f of friends ?? []) {
      const puuid = f.puuid || f.id
      if (!puuid) continue
      puuids.push(puuid)
      if (f.gameName) friendNameToPuuid.set(String(f.gameName).toLowerCase(), puuid)
      if (f.gameName && f.gameTag) {
        friendNameToPuuid.set(`${f.gameName}#${f.gameTag}`.toLowerCase(), puuid)
      }
      if (f.name) friendNameToPuuid.set(String(f.name).toLowerCase(), puuid)
    }
    return puuids
  } catch {
    return []
  }
}

export async function refreshTagCache({ force = false } = {}) {
  if (!isConfigured()) return
  if (refreshInFlight) return
  if (!force && Date.now() - lastRefreshAt < 5_000) return

  refreshInFlight = true
  try {
    const me = await api.fetchIdentity()
    myPuuid = me.puuid
    myGameName = me.gameName || null

    const friendPuuids = await refreshFriendIndex()
    const all = [...new Set([myPuuid, ...friendPuuids].filter(Boolean))]

    // Single RPC covers self + friends (includes membership check server-side)
    const rows = await api.getMainClubTags(all).catch(() => [])

    /** @type {Map<string, string>} */
    const next = new Map()
    for (const row of rows ?? []) {
      if (row?.puuid && row?.tag) next.set(row.puuid, normalizeTag(row.tag))
    }

    tagByPuuid.clear()
    for (const [k, v] of next) tagByPuuid.set(k, v)

    lastRefreshAt = Date.now()
    queueInject()
  } catch (err) {
    console.warn('[pengu-clubs] tag cache refresh failed:', err?.message || err)
  } finally {
    refreshInFlight = false
  }
}

function queueInject() {
  clearTimeout(injectTimer)
  injectTimer = setTimeout(() => {
    try {
      injectIntoSocial()
    } catch (err) {
      console.warn('[pengu-clubs] tag inject failed:', err?.message || err)
    }
  }, INJECT_DEBOUNCE_MS)
}

function queueFriendsRefresh() {
  clearTimeout(friendsRefreshTimer)
  friendsRefreshTimer = setTimeout(() => {
    refreshTagCache()
  }, FRIENDS_REFRESH_DEBOUNCE_MS)
}

function ensureObserverOn(root) {
  if (!observer || !root) return
  if (observedRoot === root) return
  try {
    observer.disconnect()
    observer.observe(root, { childList: true, subtree: true })
    observedRoot = root
  } catch (err) {
    console.warn('[pengu-clubs] tag observer attach failed:', err?.message || err)
  }
}

function bindObserver() {
  if (observer) return
  observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((m) => {
      if (m.target?.classList?.contains?.(TAG_CLASS)) return false
      if (m.target?.closest?.('#pengu-clubs-panel')) return false

      const nodes = [...(m.addedNodes || []), ...(m.removedNodes || [])]
      if (!nodes.length) return true

      return !nodes.every((n) => {
        if (n.nodeType !== 1) return false
        return /** @type {Element} */ (n).classList?.contains(TAG_CLASS)
      })
    })
    if (relevant) queueInject()
  })

  const tryAttach = () => {
    const root = findSocialRoot()
    if (root) {
      ensureObserverOn(root)
      return true
    }
    return false
  }

  if (!tryAttach()) {
    // Wait for social UI — do NOT observe document.body (too expensive)
    rootRetryTimer = setInterval(() => {
      if (tryAttach()) {
        clearInterval(rootRetryTimer)
        rootRetryTimer = null
        queueInject()
      }
    }, ROOT_RETRY_MS)
  }
}

/**
 * @param {{ socket?: { observe: (path: string, cb: Function) => void } }} [opts]
 */
export function startClubTags(opts = {}) {
  if (started) return
  started = true

  bindObserver()
  refreshTagCache({ force: true })
  pollTimer = setInterval(() => refreshTagCache(), POLL_MS)

  const socket = opts.socket
  if (socket?.observe) {
    socket.observe('/lol-chat/v1/friends', () => {
      queueFriendsRefresh()
    })
    socket.observe('/lol-chat/v1/me', () => {
      queueInject()
    })
  }
}

export function stopClubTags() {
  started = false
  observer?.disconnect()
  observer = null
  observedRoot = null
  clearInterval(pollTimer)
  pollTimer = null
  clearInterval(rootRetryTimer)
  rootRetryTimer = null
  clearTimeout(injectTimer)
  injectTimer = null
  clearTimeout(friendsRefreshTimer)
  friendsRefreshTimer = null
}
