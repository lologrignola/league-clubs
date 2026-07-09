/**
 * @name Pengu Clubs
 * @author lologrignola
 * @description In-client clubs chat — loads plugin code from GitHub via jsDelivr
 * @link https://github.com/lologrignola/league-clubs
 *
 * Install: copy this file into your Pengu plugins folder (same place as Relay.js).
 * Players keep this file forever — updates come from version.json on GitHub.
 *
 * version.json (GitHub raw) → rev for update checks + latest commit SHA for code.
 * jsDelivr @main can lag; commit-pinned URLs always match GitHub.
 */

const REPO = 'lologrignola/league-clubs'
const VERSION_URL = `https://raw.githubusercontent.com/${REPO}/main/version.json`
const COMMIT_URL = `https://api.github.com/repos/${REPO}/commits/main`
const FALLBACK_REV = '1'

let remote = null
let remotePromise = null

async function fetchRelease() {
  const [versionRes, commitRes] = await Promise.all([
    fetch(VERSION_URL, { cache: 'no-store' }),
    fetch(COMMIT_URL, { cache: 'no-store', headers: { Accept: 'application/vnd.github.v3+json' } }),
  ])

  if (!versionRes.ok) throw new Error(`version.json ${versionRes.status}`)
  if (!commitRes.ok) throw new Error(`commits/main ${commitRes.status}`)

  const version = await versionRes.json()
  const commit = await commitRes.json()
  const rev = String(version.rev ?? version.version ?? FALLBACK_REV)
  const sha = commit.sha

  if (!sha) throw new Error('commit SHA missing')

  return { rev, sha, cdnBase: `https://cdn.jsdelivr.net/gh/${REPO}@${sha}` }
}

function injectStyles(rev, cdnBase) {
  const id = 'pengu-clubs-styles'
  let link = document.getElementById(id)
  const href = `${cdnBase}/styles.css?rev=${rev}`
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
    remotePromise = fetchRelease()
      .then(({ rev, sha, cdnBase }) => {
        window.__penguClubsRev = rev
        window.__penguClubsSha = sha
        injectStyles(rev, cdnBase)
        return import(`${cdnBase}/index.js?rev=${rev}`)
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
