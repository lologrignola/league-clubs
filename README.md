# Pengu Clubs Revival

In-client group chat / clubs workaround for League of Legends via **Pengu Loader** + **Supabase**.

Native `/lol-clubs` API was removed by Riot in 2020. This plugin recreates the experience with a custom backend.

## Project layout

```
pengu-clubs/
├── plugins/pengu-clubs/     ← copy into Pengu Loader plugins dir
│   ├── index.js
│   ├── config.js            ← set Supabase URL + anon key
│   ├── api.js
│   ├── presence.js
│   ├── styles.css
│   └── ui/
└── supabase/migrations/
    ├── 001_clubs.sql
    ├── 002_presence.sql
    └── 003_clubs_features.sql
```

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com)
2. Open **SQL Editor** → run migrations in order: `001`, `002`, `003`, `004`, `005`
3. Copy **Project URL** and **anon public** key from Project Settings → API

### 2. Configure plugin

Edit `plugins/pengu-clubs/config.js`:

```javascript
export const config = {
  supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR_ANON_KEY',
}
```

### 3. Install

Copy `plugins/pengu-clubs/` to Pengu Loader plugins folder:

```
%LOCALAPPDATA%\Pengu Loader\plugins\pengu-clubs\
```

Or DevTools (`Ctrl+Shift+I`) → `window.openPluginsFolder()`

### 4. Load

Restart League Client or `window.reloadClient()`.

- **Clubs** button (bottom-right)
- `Ctrl+K` → "Open Clubs" or "Discover Clubs"

## Features

| Feature | Status |
|---------|--------|
| Create club (tag, name, MOTD) | ✓ |
| Join by invite code | ✓ |
| Discover clubs by tag/name | ✓ |
| Edit MOTD (owner/admin) | ✓ |
| Club list + chat UI | ✓ |
| Realtime messages | ✓ |
| Member online/in-game status | ✓ |
| Load older messages | ✓ |
| Leave club / owner kick | ✓ |
| Rate-limited send (1/sec) | ✓ |
| Toast error/success feedback | ✓ |
| CommandBar shortcuts | ✓ |

## Security note (MVP)

Identity is **client-trusted** via LCU `puuid`. Fine for friends-only testing; add signed tokens before public release.

## LCU endpoints used

- `GET /lol-summoner/v1/current-summoner`
- `GET /lol-chat/v1/me`, `/session`, `/friends`
- `GET /lol-gameflow/v1/gameflow-phase`
- `socket.observe('/lol-chat/v1/session')`

## For friends (join your club)

They need **only**:

1. **Pengu Loader** installed
2. Copy `plugins/pengu-clubs/` into their plugins folder
3. **Same `config.js` as you** — share your Supabase URL + anon key (one line each). They do **not** need their own Supabase project.
4. Restart League Client

Then: **Join** → paste your invite code.

> You run Supabase migrations once. Friends just use your backend via `config.js`.

## Troubleshooting

- **Config banner** — edit `config.js` with real Supabase keys
- **RPC errors** — confirm all 3 migrations ran
- **No realtime** — check Realtime enabled on `messages` table
- **Presence offline** — run `002_presence.sql` + `004_presence_timeout.sql`; both clients need plugin + same `config.js` (client open is enough); Riot friends optional fallback
