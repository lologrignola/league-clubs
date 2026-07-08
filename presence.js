import * as api from './api.js'

const HEARTBEAT_MS = 10_000
const MEMBER_REFRESH_MS = 10_000

let heartbeatTimer = null
let memberRefreshTimer = null
/** @type {(() => void)|null} */
let onMembersRefresh = null
/** @type {(() => void)|null} */
let onPresenceRefresh = null

const INGAME_PHASES = new Set([
  'ChampSelect',
  'GameStart',
  'InProgress',
  'EndOfGame',
  'WaitingForStats',
  'PreEndOfGame',
])

const BUSY_PHASES = new Set([
  'Matchmaking',
  'ReadyCheck',
  'ChampSelect',
  'GameStart',
  'InProgress',
])

/** @type {(() => void)|null} */
let onClubListSync = null

export function setClubListSyncCallback(fn) {
  onClubListSync = fn
}

export function setMembersRefreshCallback(fn) {
  onMembersRefresh = fn
}

export function setPresenceRefreshCallback(fn) {
  onPresenceRefresh = fn
}

export async function fetchLocalStatus() {
  const [phaseRes, meRes, friendsRes] = await Promise.all([
    fetch('/lol-gameflow/v1/gameflow-phase').then((r) => r.text()).catch(() => '"None"'),
    fetch('/lol-chat/v1/me').then((r) => r.json()).catch(() => null),
    fetch('/lol-chat/v1/friends').then((r) => r.json()).catch(() => []),
  ])

  let phase = 'None'
  try {
    phase = JSON.parse(phaseRes)
  } catch {
    phase = phaseRes.replace(/"/g, '') || 'None'
  }

  const availability = meRes?.availability ?? 'chat'
  const { status, detail } = phaseToStatus(phase, availability)

  return { status, detail, phase, friends: friendsRes ?? [] }
}

function phaseToStatus(phase, availability) {
  if (INGAME_PHASES.has(phase)) {
    const labels = {
      ChampSelect: 'In Champion Select',
      GameStart: 'Game Starting',
      InProgress: 'In Game',
      EndOfGame: 'Post-Game',
      WaitingForStats: 'Waiting for Stats',
      PreEndOfGame: 'End of Game',
    }
    return { status: 'ingame', detail: labels[phase] ?? 'In Game' }
  }

  if (BUSY_PHASES.has(phase)) {
    return { status: 'ingame', detail: phase === 'Matchmaking' ? 'In Queue' : 'Ready Check' }
  }

  if (availability === 'away') return { status: 'away', detail: 'Away' }
  if (availability === 'dnd') return { status: 'away', detail: 'Do Not Disturb' }
  if (availability === 'mobile') return { status: 'online', detail: 'Mobile' }

  if (phase === 'Lobby') return { status: 'online', detail: 'In Lobby' }

  return { status: 'online', detail: 'Online' }
}

export function friendStatus(friend) {
  if (!friend) return { status: 'offline', detail: '' }

  const lol = friend.lol ?? {}
  const gameStatus = lol.gameStatus ?? lol.status

  if (gameStatus === 'inGame' || gameStatus === 'championSelect' || gameStatus === 'teamSelect') {
    const champ = lol.championName ?? lol.champion
    return {
      status: 'ingame',
      detail: champ ? `Playing ${champ}` : (friend.statusMessage || 'In Game'),
    }
  }

  if (gameStatus === 'outOfGame' && friend.availability === 'chat') {
    return { status: 'online', detail: friend.statusMessage || 'Online' }
  }

  if (friend.availability === 'away') return { status: 'away', detail: friend.statusMessage || 'Away' }
  if (friend.availability === 'dnd') return { status: 'away', detail: 'Do Not Disturb' }
  if (friend.availability === 'mobile') return { status: 'online', detail: 'Mobile' }
  if (friend.availability === 'offline') return { status: 'offline', detail: '' }

  return { status: 'online', detail: friend.statusMessage || 'Online' }
}

function findFriend(friends, member) {
  if (!friends?.length) return null

  const byPuuid = friends.find((f) => f.puuid && f.puuid === member.puuid)
  if (byPuuid) return byPuuid

  const memberTag = `${member.game_name}#${member.game_tag}`.toLowerCase()
  return friends.find((f) => {
    const tag = `${f.gameName ?? ''}#${f.gameTag ?? ''}`.toLowerCase()
    return tag === memberTag || (f.gameName && f.gameName.toLowerCase() === member.game_name?.toLowerCase())
  }) ?? null
}

export function mergeMemberPresence(members, presenceRows, friends, localStatus, myPuuid) {
  const presenceMap = new Map((presenceRows ?? []).map((p) => [p.puuid, p]))

  return (members ?? []).map((m) => {
    if (myPuuid && m.puuid === myPuuid && localStatus) {
      return { ...m, status: localStatus.status, detail: localStatus.detail, source: 'self' }
    }

    const pres = presenceMap.get(m.puuid)
    const friend = findFriend(friends, m)

    // Plugin heartbeat first — club members with plugin, no friend required
    if (pres && pres.status !== 'offline') {
      return {
        ...m,
        status: pres.status,
        detail: pres.detail ?? '',
        source: 'heartbeat',
      }
    }

    if (friend) {
      const fs = friendStatus(friend)
      if (fs.status !== 'offline') {
        return { ...m, status: fs.status, detail: fs.detail, source: 'riot' }
      }
    }

    if (pres) {
      return { ...m, status: pres.status, detail: pres.detail ?? '', source: 'heartbeat' }
    }

    if (friend) {
      const fs = friendStatus(friend)
      return { ...m, status: fs.status, detail: fs.detail, source: 'riot' }
    }

    return { ...m, status: 'offline', detail: '', source: 'none' }
  })
}

let observersBound = false
let lastReportedPhase = null

export function bindPresenceObservers(socket) {
  if (observersBound || !socket?.observe) return
  observersBound = true

  const pushOnPhaseChange = () => {
    if (!api.isSessionReady() || !api.isConfigured()) return

    fetch('/lol-gameflow/v1/gameflow-phase')
      .then((r) => r.text())
      .then((raw) => {
        let phase = raw
        try {
          phase = JSON.parse(raw)
        } catch {
          phase = raw.replace(/"/g, '') || 'None'
        }
        if (phase === lastReportedPhase) return
        lastReportedPhase = phase
        reportPresenceToClubs()
      })
      .catch(() => {})
  }

  socket.observe('/lol-gameflow/v1/gameflow-phase', pushOnPhaseChange)
  socket.observe('/lol-chat/v1/me', (event) => {
    if (event.eventType === 'Update') reportPresenceToClubs()
  })
}

export async function reportPresenceToClubs() {
  if (!api.isSessionReady() || !api.isConfigured()) return

  try {
    const [{ status, detail }, clubs] = await Promise.all([
      fetchLocalStatus(),
      api.getMyClubs(),
    ])

    await Promise.all(
      (clubs ?? []).map((club) =>
        api.upsertPresence(club.id, status, detail),
      ),
    )

    onClubListSync?.()
    onPresenceRefresh?.()
  } catch (err) {
    console.warn('[pengu-clubs] presence heartbeat failed:', err.message)
  }
}

export function startPresenceLoop() {
  stopPresenceLoop()
  reportPresenceToClubs()
  heartbeatTimer = setInterval(reportPresenceToClubs, HEARTBEAT_MS)
}

export function stopPresenceLoop() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

export function startMemberRefreshLoop() {
  stopMemberRefreshLoop()
  onMembersRefresh?.()
  memberRefreshTimer = setInterval(() => onMembersRefresh?.(), MEMBER_REFRESH_MS)
}

export function stopMemberRefreshLoop() {
  if (memberRefreshTimer) {
    clearInterval(memberRefreshTimer)
    memberRefreshTimer = null
  }
}
