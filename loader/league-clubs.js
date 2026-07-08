/**
 * @name Pengu Clubs
 * @author lologrignola
 * @description In-client clubs chat — loads plugin code from GitHub via jsDelivr
 * @link https://github.com/lologrignola/league-clubs
 *
 * Install: copy this file into your Pengu plugins folder (same place as Relay.js).
 * Players keep this file forever — updates come from version.json on GitHub.
 */

const CDN_BASE = 'https://cdn.jsdelivr.net/gh/lologrignola/league-clubs@main'
const FALLBACK_REV = '1'

let remote = null
let remotePromise = null

async function fetchRev() {
  try {
    const res = await fetch(`${CDN_BASE}/version.json`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`version.json ${res.status}`)
    const data = await res.json()
    return String(data.rev ?? data.version ?? FALLBACK_REV)
  } catch (err) {
    console.warn('[pengu-clubs] version.json unavailable, using fallback rev:', err.message)
    return FALLBACK_REV
  }
}

function injectStyles(rev) {
  const id = 'pengu-clubs-styles'
  let link = document.getElementById(id)
  const href = `${CDN_BASE}/styles.css?rev=${rev}`
  if (!link) {
    link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = href
    document.head.appendChild(link)
    return
  }
  if (link.href !== href) link.href = href
}

function getRemote() {
  if (remote) return Promise.resolve(remote)
  if (!remotePromise) {
    remotePromise = fetchRev()
      .then((rev) => {
        window.__penguClubsRev = rev
        injectStyles(rev)
        return import(`${CDN_BASE}/index.js?rev=${rev}`)
      })
      .then((mod) => {
        remote = mod
        return mod
      })
      .catch((err) => {
        remotePromise = null
        console.error('[pengu-clubs] CDN load failed:', err)
        throw err
      })
  }
  return remotePromise
}

getRemote().catch(() => {})

export function init(ctx) {
  getRemote().then((mod) => mod.init(ctx))
}

export function load() {
  getRemote().then((mod) => mod.load())
}
