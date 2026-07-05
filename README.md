![Camply Logo](https://onirim.github.io/Camply/android-chrome-192x192.png)

# Camply Portal — a lite TTRPG campaign manager

Camply Portal is a self-hostable web app for running tabletop RPG campaigns: characters, campaign logs, shared documents and maps, all organized around **universes** that a game master owns and shares with their players.

It ships as a **GitHub template**: fork it, connect your own free Supabase project, and you have a working campaign manager on GitHub Pages in a few minutes — no server to run, no build step.

## How it's organized

- **Universe** — a self-contained game world. Each universe has its own characters, chronicles, documents and maps. A user can own several universes and also join universes created by others.
- **Roles** — inside a universe, a member is the **owner** (full control), a **GM** (can edit shared content), or a **player** (manages their own characters/notes).
- **Campaign** — a group of universe members who can see each other's public content (characters, chronicles, documents, maps), without anything to sync manually — visibility is enforced server-side.
- **Sharing** — a universe can be joined by anyone with its 8-character invite code.

## Features

**Content**
- Characters, with an optional custom stat system per game
- Chronicles — campaign logs with Markdown entries
- Shareable Markdown documents
- Maps with pins, per-color legends, and shareable marker layers
- Tags and filters across content types
- Illustration uploads (characters, documents, maps)

**Collaboration**
- Discord authentication (via Supabase)
- Campaigns grouping members' public content
- Subscribing to other players' content
- Ownership transfer of objects and of whole universes
- Unread-content indicators
- Export of your visible data (full archive or Markdown, e.g. to feed an AI)

**Housekeeping**
- Inactive universes are automatically paused and archived, then restored on demand
- Admin panel (for allow-listed accounts) with global stats and orphaned-file cleanup
- i18n (FR/EN)
- PWA support (installable, offline shell via service worker)
- Several ready-made visual themes (see `themes/`)

## Stack

Vanilla HTML/CSS/JS + [Supabase](https://supabase.com/) (Postgres, Auth, Storage, RLS) + GitHub Pages. No build step, no framework, no local Node server required.

## Project layout

| Path | Purpose |
|---|---|
| `index.html` | All views/markup (single page app, view switching via JS) |
| `scripts.js` | Core: auth, universes, characters, routing |
| `chronicles.js`, `documents.js`, `campaigns.js`, `tags.js`, `transfert.js`, `export.js`, `unread-markers.js` | Feature modules |
| `map.js`, `map-admin.js`, `map-config.js` | Map viewer and per-universe map configuration |
| `admin-panel.js`, `universe-pause.js` | Instance administration and universe archiving |
| `editor.js`, `game-system.js` | Character sheet editor — **adapt these for your own game system** |
| `i18n.js` | FR/EN translations |
| `themes/` | Alternate visual themes |
| `sql/` | Supabase schema (`00_fresh_install.sql`) and incremental migrations |

## New project setup

1. **Create the GitHub repo**

   Click "Use this template" on GitHub, name the repo (e.g. `my-game-campaign-manager`), then enable GitHub Pages on the `main` branch (Settings > Pages).

2. **Create a Discord OAuth application**

   In OAuth2, retrieve the client ID and secret. In Redirects, add the callback URL of your Supabase project (see below).

3. **Create a Supabase project** (the free tier works)

   Run `sql/00_fresh_install.sql` in the Supabase SQL Editor, configure Discord auth in Authentication > Providers, and add your GitHub Pages URL in Authentication > URL Configuration.

4. **Fill in `supabase-client.js`**

   ```js
   const SUPABASE_URL = 'https://XXXX.supabase.co';
   const SUPABASE_KEY = 'sb_publishable_XXXX';
   const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
   ```

5. **Update the branding**

   In `index.html`:
   ```html
   <title>My Game — Campaign Manager</title>
   ```
   In `site.webmanifest`:
   ```json
   {
     "name": "My Game",
     "short_name": "My Game",
     "start_url": "/my-repo/"
   }
   ```

6. **Set up maps** (optional)

   Maps aren't configured by editing a file. Once the app is running and connected to Supabase, sign in as a universe owner and go to **Configuration > Cartes** to upload map images, configure them, and define the color legend used for markers.

7. **Adapt the game system** (optional)

   Replace `game-system.js` (and adjust `editor.js` if needed) to define your own character stats — see the contract documented at the top of `game-system.js`.
