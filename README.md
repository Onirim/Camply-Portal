![Camply Logo](https://onirim.github.io/Camply/android-chrome-192x192.png)

# Camply - a Lite TTRPG Campaign Manager

Template website for managing tabletop role-playing game campaigns.
Stack: Vanilla HTML/CSS/JS + Supabase + GitHub Pages.
What the template manages (do not modify)

- Discord Auth via Supabase
- Characters (with optionnal stat system)
- Chronicles (campaign stories with Markdown entries)
- Documents (shareable Markdown documents)
- Maps (with pins)
- Campaigns (collections grouping characters + chronicles + documents + maps)
- Sharing system via 8-character code
- Subscription to other player's content
- Ownership transfers of objects
- New unread objects indicators
- Tags and filters
- Illustration uploads
- i18n FR/EN
- PWA (service worker, manifest)

Optional: Adapt for your game

    game-system.js
    editor.js

## New project setup
1. **Create the GitHub repo**

    Click "Use this template" on GitHub
    Give the repo a name (e.g., my-game-campaign-manager)
    Enable GitHub Pages on the main branch (Settings > Pages)

2. **Create the Discord Auth application**

    In OAuth2, retrieve the client ID and secret key
    In Redirects, insert the Callback URL of the Supabase project (see below)

3. **Create a Supabase project (can be a free project)**

    In Supabase SQL Editor, run:
   ```
        sql/00_fresh_install.sql

   ```
    Configure Discord auth in Authentication > Providers
    Add the GitHub Pages URL in Authentication > URL Configuration

4. **Fill in supabase-client.js**

```
const SUPABASE_URL = 'https://XXXX.supabase.co';
const SUPABASE_KEY = 'sb_publishable_XXXX';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
```

5. **Update the branding**

In index.html:
```
<title>My Game — Campaign Manager</title>
```
In site.webmanifest:
```
{
  "name": "My Game",
  "short_name": "My Game",
  "start_url": "/my-repo/"
}
```

6. **Set a campaign map** (optional)
    Maps are no longer configured by editing a file. Once the app is running and connected to Supabase, sign in as a universe owner and go to **Configuration > Cartes** to upload map images and configure them from the UI.

