# Pengu Clubs Revival

In-client group chat / clubs workaround for League of Legends via **Pengu Loader** + **Supabase**.

Native `/lol-clubs` API was removed by Riot in 2020. This plugin brings clubs back with a shared online backend.

---

## Install (players — use the shared backend)

You do **not** need Supabase, a database, or your own API keys. This release connects to the maintainer's backend out of the box.

### Requirements

- League of Legends client (Windows)
- [Pengu Loader](https://pengu.lol/) installed

### Option A — CDN loader (recommended)

One small file on disk; plugin code loads from GitHub ([jsDelivr](https://www.jsdelivr.com/)) when the client starts. You get fixes without re-downloading the repo.

1. Open the Pengu plugins folder (`window.openPluginsFolder()` in DevTools)
   - Often `C:\Program Files\Pengu Loader\plugins\` or `%LOCALAPPDATA%\Pengu Loader\plugins\`
2. Copy **`loader/league-clubs.js`** into that folder (same level as other `.js` plugins — no subfolder needed)
   - Or run **`loader/install.bat`** (Windows) — copies the file for you
3. Restart the client or `window.reloadClient()`
4. Click **Clubs** (bottom-right) or `Ctrl+K` → "Open Clubs"

Direct download (after repo is public):  
`https://github.com/lologrignola/league-clubs/raw/main/loader/league-clubs.js`

Updates: push to GitHub, bump `rev` in `version.json`, players get it on next `reloadClient()` — no need to re-send `league-clubs.js`.

### Option B — full folder (offline / fork)

1. **Download** this repo (Code → Download ZIP, or clone).
2. **Copy the whole plugin folder** into `plugins\`
   - Folder name can be anything (e.g. `pengu-clubs` or `league-clubs`)
   - Must contain `index.js`, `config.js`, `styles.css`, etc. at the top level of that folder
3. **Restart the client** or run `window.reloadClient()` in DevTools

### After install

- On first launch you are auto-joined to **[LEAGC] League Clubs** — the global lounge
- **Create** a private club or **Join** others with an invite code

### First time in a club

- **Create** → pick tag, name, optional MOTD → share the invite code
- **Join** → paste invite code from a friend
- **Find** → search public clubs by tag/name (still need invite to enter)

---

## Shared backend (important)

By default, this plugin uses **the maintainer's Supabase project** — one shared database for everyone who installs it as-is.

| What that means | Details |
|-----------------|--------|
| Your clubs & messages | Stored on the maintainer's Supabase (cloud Postgres) |
| No setup for you | `config.js` is already filled in |
| Same backend as others | Everyone on default install shares the same club pool |
| Maintainer pays hosting | Free-tier limits apply; project may pause if idle |

### Is it encrypted?

**Partially — be precise:**

| Layer | Encrypted? |
|-------|------------|
| Data in transit (plugin ↔ Supabase) | **Yes** — HTTPS / WSS |
| Keys in `config.js` | **No** — plain text in the file (normal for client apps) |
| Database at rest (Supabase) | **Yes** — Supabase encrypts stored data on their side |
| Admin / database password | **Not in the plugin** — only the public *publishable* key is included |

The key in `config.js` is a **publishable (anon) key**. It is meant to be visible in client code. It does **not** grant full database admin access. The **service role** key is never shipped.

**What you should assume:** club chat is community-grade privacy, not end-to-end encrypted. The maintainer (and anyone who abuses the public API) could theoretically read data. Do not use this for sensitive content.

---

## Use your own backend instead

Want your own database, private clubs, or no shared pool? Self-host:

1. Create a free project at [supabase.com](https://supabase.com)
2. Supabase **SQL Editor** → run migrations in order:
   - `supabase/migrations/001_clubs.sql`
   - `002_presence.sql`
   - `003_clubs_features.sql`
   - `004_presence_timeout.sql`
   - `005_leave_kick.sql`
   - `006_public_hardening.sql`
3. Copy `config.example.js` → `config.js` (overwrite the default)
4. In Supabase: **Project Settings → API** → copy:
   - **Project URL** → `supabaseUrl`
   - **publishable** or **anon** key → `supabaseAnonKey`
5. Edit `config.js`:

```javascript
export const config = {
  supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR_ANON_OR_PUBLISHABLE_KEY',
}
```

6. Restart / `window.reloadClient()`

Everyone using **your** `config.js` shares **your** backend. Other installs with the default file still use the maintainer's.

---

## Abuse limits (shared backend)

| Limit | Value |
|-------|-------|
| Clubs owned per player | 5 |
| Clubs joined per player | 20 |
| Members per club | 100 |
| Messages | 1/sec per club, 60/min total |
| Club creation | 5/day per player |
| Join attempts | 20/hour per player |
| Club search | 30/min per player |

---

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
| Rate-limited send | ✓ |
| Toast error/success feedback | ✓ |
| CommandBar shortcuts | ✓ |

---

## Project layout

```
league-clubs/                 ← repo root (also what CDN serves)
├── index.js                  ← plugin entry (loaded remotely if using loader/)
├── config.js                 ← default: maintainer's backend
├── config.example.js         ← template for self-hosting
├── loader/
│   ├── league-clubs.js       ← copy this to Pengu plugins/ for CDN install
│   └── install.bat           ← Windows one-click copy
├── version.json              ← bump for tagged CDN releases
├── api.js
├── styles.css
├── ui/
└── supabase/migrations/      ← self-hosters only; not needed for CDN players
```

---

## Hosting / distribution (vs Rose)

**[Rose](https://github.com/Alban1911/Rose)** ships Pengu plugins **inside its installer**: files live under `Pengu Loader/plugins/ROSE-*`, and the Rose desktop app **updates from GitHub Releases** (ZIP). Plugins talk to Rose's local HTTP bridge (`127.0.0.1`) for assets — not a public CDN.

**This project** is a standalone plugin, so distribution is simpler:

| Approach | Who copies what | Updates |
|----------|-----------------|---------|
| **CDN loader** (`loader/league-clubs.js`) | Player keeps one file in `plugins/` forever | Push + bump `version.json` `rev` |
| **Full folder** | Player copies entire repo | Re-download or `git pull` |
| **GitHub Release ZIP** | Same as full folder | Manual re-install (Rose-style) |

**Maintainer checklist**

1. Keep `config.js` with the shared publishable key (players on CDN install use it from the served bundle).
2. Push to `main`, then bump **`rev`** in `version.json` (e.g. `4` → `5`) so clients bypass League's module cache.
3. Do **not** commit `service_role` keys.
4. Keep the Supabase project active (free tier pauses when idle).

---

## Security notes (public MVP)

- Identity is **client-trusted** via LCU `puuid` — spoofing is possible in theory
- Direct table access is blocked; reads/writes go through RPC functions
- Knowing a club ID can allow reading that club's messages via the public API
- Fine for casual friends/community chat — not for high-trust or private use without self-hosting

---

## LCU endpoints used

- `GET /lol-summoner/v1/current-summoner`
- `GET /lol-chat/v1/me`, `/session`, `/friends`
- `GET /lol-gameflow/v1/gameflow-phase`
- `socket.observe('/lol-chat/v1/session')`

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Unstyled / broken UI | Ensure `styles.css` is next to `index.js`; reload client |
| "Configure Supabase" banner | Edit `config.js` with valid URL + key, or restore default |
| RPC / database errors | Migrations not run (self-host) or maintainer project paused |
| No realtime | Maintainer must have `messages` in Supabase realtime publication |
| Rate limit errors | Wait and retry |
| Presence always offline | Both users need plugin + same backend (`config.js`) |

---

## Maintainer

- Default `config.js` points to the shared LeagueClubs Supabase project
- Rotate publishable key in dashboard if abused
- Keep project **active** (free tier pauses after ~7 days of inactivity)
