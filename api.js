import { config, isConfigured } from './config.js'
import { parseRpcError } from './ui/toast.js'

export { isConfigured }

let identity = null
let sessionReady = false

export function setSessionReady(ready) {
  sessionReady = ready
}

export function isSessionReady() {
  return sessionReady
}

export async function fetchIdentity() {
  if (identity) return identity

  const [summoner, chatMe] = await Promise.all([
    fetch('/lol-summoner/v1/current-summoner').then((r) => r.json()),
    fetch('/lol-chat/v1/me').then((r) => r.json()).catch(() => null),
  ])

  identity = {
    puuid: summoner.puuid,
    summonerId: summoner.summonerId,
    gameName: summoner.gameName ?? chatMe?.gameName ?? 'Unknown',
    gameTag: summoner.tagLine ?? chatMe?.gameTag ?? '',
  }

  return identity
}

export function getIdentity() {
  return identity
}

function supabaseHeaders() {
  return {
    apikey: config.supabaseAnonKey,
    Authorization: `Bearer ${config.supabaseAnonKey}`,
    'Content-Type': 'application/json',
  }
}

async function rpc(fn, params) {
  if (!isConfigured()) {
    throw new Error('Supabase not configured — edit config.js with your project URL and anon key.')
  }

  const res = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify(params),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(parseRpcError(err) || `RPC ${fn} failed (${res.status})`)
  }

  const text = await res.text()
  return text ? JSON.parse(text) : null
}

export async function createClub(tag, name, motd = '') {
  const me = await fetchIdentity()
  return rpc('create_club', {
    p_tag: tag.toUpperCase(),
    p_name: name,
    p_motd: motd,
    p_owner_puuid: me.puuid,
    p_owner_name: me.gameName,
    p_owner_tag: me.gameTag,
  })
}

export async function joinClub(inviteCode) {
  const me = await fetchIdentity()
  return rpc('join_club', {
    p_invite_code: inviteCode.trim().toUpperCase(),
    p_puuid: me.puuid,
    p_game_name: me.gameName,
    p_game_tag: me.gameTag,
  })
}

export async function getMyClubs() {
  const me = await fetchIdentity()
  return rpc('get_my_clubs', { p_puuid: me.puuid })
}

export async function getClubMembers(clubId) {
  const me = await fetchIdentity()
  return rpc('get_club_members', { p_club_id: clubId, p_puuid: me.puuid })
}

export async function getMessages(clubId, limit = 50, before = null) {
  const me = await fetchIdentity()
  return rpc('get_club_messages', {
    p_club_id: clubId,
    p_puuid: me.puuid,
    p_limit: limit,
    p_before: before,
  })
}

export async function searchClubs(query) {
  const me = await fetchIdentity()
  return rpc('search_clubs', { p_query: query.trim(), p_puuid: me.puuid })
}

export async function updateMotd(clubId, motd) {
  const me = await fetchIdentity()
  return rpc('update_club_motd', {
    p_club_id: clubId,
    p_puuid: me.puuid,
    p_motd: motd,
  })
}

export async function sendMessage(clubId, body) {
  const me = await fetchIdentity()
  return rpc('send_message', {
    p_club_id: clubId,
    p_puuid: me.puuid,
    p_body: body.trim(),
  })
}

export async function regenerateInvite(clubId) {
  const me = await fetchIdentity()
  return rpc('regenerate_invite', { p_club_id: clubId, p_puuid: me.puuid })
}

export async function leaveClub(clubId) {
  const me = await fetchIdentity()
  return rpc('leave_club', { p_club_id: clubId, p_puuid: me.puuid })
}

export async function kickMember(clubId, targetPuuid) {
  const me = await fetchIdentity()
  return rpc('kick_member', {
    p_club_id: clubId,
    p_actor_puuid: me.puuid,
    p_target_puuid: targetPuuid,
  })
}

export async function upsertPresence(clubId, status, detail = '') {
  const me = await fetchIdentity()
  return rpc('upsert_presence', {
    p_club_id: clubId,
    p_puuid: me.puuid,
    p_status: status,
    p_detail: detail,
  })
}

export async function getClubPresence(clubId) {
  const me = await fetchIdentity()
  return rpc('get_club_presence', { p_club_id: clubId, p_puuid: me.puuid })
}

const DEFAULT_JOIN_KEY = 'pengu-clubs-default-joined'

function defaultClubTag() {
  return (config.defaultClubTag || 'LEAGC').toUpperCase()
}

function defaultJoinStorageKey(puuid) {
  return `${DEFAULT_JOIN_KEY}:${puuid}`
}

/** Auto-join the global League Clubs lounge on first run (per player). */
export async function ensureDefaultClubJoin() {
  const code = config.defaultClubInviteCode?.trim()
  if (!isConfigured() || !code) return false

  const me = await fetchIdentity()
  const storageKey = defaultJoinStorageKey(me.puuid)
  if (localStorage.getItem(storageKey) === '1') return false

  const clubs = await getMyClubs()
  const tag = defaultClubTag()
  if (clubs?.some((c) => (c.tag || '').toUpperCase() === tag)) {
    localStorage.setItem(storageKey, '1')
    return false
  }

  await joinClub(code)
  localStorage.setItem(storageKey, '1')
  return true
}

/** @returns {{ unsubscribe: () => void }} */
export function subscribeToMessages(clubId, onMessage) {
  if (!isConfigured()) return { unsubscribe: () => {} }

  const wsUrl = `${config.supabaseUrl.replace('https://', 'wss://')}/realtime/v1/websocket?apikey=${encodeURIComponent(config.supabaseAnonKey)}`
  const ws = new WebSocket(wsUrl)

  let heartbeat = null
  let ref = 0

  const nextRef = () => String(++ref)

  ws.onopen = () => {
    ws.send(JSON.stringify({
      topic: 'realtime:public:messages',
      event: 'phx_join',
      payload: {
        config: {
          postgres_changes: [{
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `club_id=eq.${clubId}`,
          }],
        },
      },
      ref: nextRef(),
    }))

    heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef() }))
      }
    }, 25000)
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.event === 'postgres_changes' && msg.payload?.data?.record) {
        onMessage(msg.payload.data.record)
      }
    } catch {
      // ignore parse errors
    }
  }

  return {
    unsubscribe: () => {
      clearInterval(heartbeat)
      if (ws.readyState === WebSocket.OPEN) ws.close()
    },
  }
}
