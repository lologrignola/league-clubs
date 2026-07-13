import * as api from '../api.js'
import { isConfigured } from '../config.js'

const TAG_ATTR = 'data-pc-club-tag'
const TAG_CLASS = 'pc-native-club-tag'
const POLL_MS = 45_000

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
/** @type {ReturnType<typeof setTimeout>|null} */
let injectTimer = null
let started = false

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
    null
  )
}

function ensureTagSpan(host, tag) {
  if (!host) return
  const next = normalizeTag(tag)
  let span = host.querySelector?.(`:scope > .${TAG_CLASS}`) || null

  // Also check next sibling if host is a text-bearing name node
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
    // Prefer appending inside host so layout stays with the name
    if (host.appendChild) host.appendChild(span)
    else host.parentElement?.insertBefore(span, host.nextSibling)
  }

  if (span.textContent !== next) span.textContent = next
  if (host.getAttribute?.(TAG_ATTR) !== next) host.setAttribute?.(TAG_ATTR, next)
}

/**
 * Heuristic: find name label elements in social sidebar and match to friends/me.
 * Riot class names vary; we match by visible name text against LCU identities.
 */
function injectIntoSocial() {
  const root = findSocialRoot() || document.body
  if (!root) return

  const friendsByName = buildNameIndex()

  // Own profile / header — elements that look like the current summoner name
  const profileCandidates = root.querySelectorAll(
    [
      '.lol-social-identity .player-name',
      '.lol-social-identity .name',
      '.social-identity .player-name',
      '.riotbar-summoner-name',
      '[class*="summoner-name"]',
      '[class*="player-name"]',
      '.lol-social-sidebar .my-summoner .name',
    ].join(', '),
  )

  for (const el of profileCandidates) {
    if (el.closest('#pengu-clubs-panel')) continue
    if (el.classList?.contains(TAG_CLASS)) continue
    const tag = myPuuid ? tagByPuuid.get(myPuuid) : ''
    if (tag && nameMatchesElement(el, myGameName)) {
      ensureTagSpan(el, tag)
    }
  }

  // Friend / roster rows
  const nameEls = root.querySelectorAll(
    [
      '.friend-name',
      '.lol-social-roster-group .name',
      '.roster-player-name',
      '[class*="friend"] [class*="name"]',
      '.player-name',
      '.summoner-name',
    ].join(', '),
  )

  for (const el of nameEls) {
    if (el.closest('#pengu-clubs-panel')) continue
    if (el.classList?.contains(TAG_CLASS)) continue

    const matched = matchElementToPuuid(el, friendsByName)
    if (!matched) continue
    ensureTagSpan(el, tagByPuuid.get(matched) || '')
  }

  // Fallback: walk elements whose text exactly equals a known gameName
  if (tagByPuuid.size) {
    const walk = root.querySelectorAll('span, div, p, a, label')
    for (const el of walk) {
      if (el.closest('#pengu-clubs-panel')) continue
      if (el.classList?.contains(TAG_CLASS)) continue
      if (el.querySelector(`.${TAG_CLASS}`)) continue
      // Only leaf-ish nodes with short text
      if (el.children.length > 1) continue
      const text = (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3)
        ? el.textContent?.trim()
        : null
      if (!text || text.length > 32) continue

      const puuid = friendsByName.get(text.toLowerCase())
      if (!puuid) continue
      const tag = tagByPuuid.get(puuid)
      if (!tag) continue
      ensureTagSpan(el, tag)
    }
  }
}

function nameMatchesElement(el, gameName) {
  if (!gameName || !el) return false
  const text = el.textContent?.replace(/\s+/g, ' ').trim() || ''
  // Strip any already-injected tag text
  const tagSpan = el.querySelector?.(`.${TAG_CLASS}`)
  const nameOnly = tagSpan
    ? text.replace(tagSpan.textContent || '', '').trim()
    : text
  return nameOnly.toLowerCase() === gameName.toLowerCase()
    || nameOnly.toLowerCase().startsWith(gameName.toLowerCase())
}

function matchElementToPuuid(el, friendsByName) {
  const tagSpan = el.querySelector?.(`.${TAG_CLASS}`)
  let text = el.textContent?.replace(/\s+/g, ' ').trim() || ''
  if (tagSpan) text = text.replace(tagSpan.textContent || '', '').trim()
  // Riot sometimes shows gameName#tag
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
  // Friends filled asynchronously into a module cache
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

export async function refreshTagCache() {
  if (!isConfigured()) return

  try {
    const me = await api.fetchIdentity()
    myPuuid = me.puuid
    myGameName = me.gameName || null

    const friendPuuids = await refreshFriendIndex()
    const all = [...new Set([myPuuid, ...friendPuuids].filter(Boolean))]

    const [mine, rows] = await Promise.all([
      api.getMyMainClub().catch(() => null),
      api.getMainClubTags(all).catch(() => []),
    ])

    /** @type {Map<string, string>} */
    const next = new Map()
    if (mine?.tag && myPuuid) next.set(myPuuid, normalizeTag(mine.tag))

    for (const row of rows ?? []) {
      if (row?.puuid && row?.tag) next.set(row.puuid, normalizeTag(row.tag))
    }

    // Remove stale
    for (const key of [...tagByPuuid.keys()]) {
      if (!next.has(key)) tagByPuuid.delete(key)
    }
    for (const [k, v] of next) tagByPuuid.set(k, v)

    queueInject()
  } catch (err) {
    console.warn('[pengu-clubs] tag cache refresh failed:', err?.message || err)
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
  }, 80)
}

function bindObserver() {
  if (observer) return
  observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((m) => {
      if (m.target?.classList?.contains?.(TAG_CLASS)) return false
      if (m.target?.closest?.('#pengu-clubs-panel')) return false

      const nodes = [...(m.addedNodes || []), ...(m.removedNodes || [])]
      if (!nodes.length) return true

      // Skip only when every touched node is our injected tag span
      return !nodes.every((n) => {
        if (n.nodeType !== 1) return false
        const el = /** @type {Element} */ (n)
        return el.classList?.contains(TAG_CLASS)
      })
    })
    if (relevant) queueInject()
  })

  const attach = () => {
    const root = document.body || document.documentElement
    if (!root) {
      requestAnimationFrame(attach)
      return
    }
    try {
      observer.observe(root, { childList: true, subtree: true })
    } catch (err) {
      console.warn('[pengu-clubs] tag observer attach failed:', err?.message || err)
    }
  }
  attach()
}

/**
 * @param {{ socket?: { observe: (path: string, cb: Function) => void } }} [opts]
 */
export function startClubTags(opts = {}) {
  if (started) return
  started = true

  bindObserver()
  refreshTagCache()
  pollTimer = setInterval(() => refreshTagCache(), POLL_MS)

  const socket = opts.socket
  if (socket?.observe) {
    socket.observe('/lol-chat/v1/friends', () => {
      refreshTagCache()
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
  clearInterval(pollTimer)
  pollTimer = null
  clearTimeout(injectTimer)
  injectTimer = null
}
