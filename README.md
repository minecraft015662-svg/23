# Geeken theme

A license-protected theme and addon system for the Pterodactyl panel.

- `server/` license website and API (Node.js, Express, SQLite)
- `installer/` the `install.sh` one-liner and the `geeken` CLI
- `theme/overlay/` files copied into the panel (CSS, JS, branding config)
- `addons/` 26 addons, A to Z (starter scaffolds, see below)
- `tools/build-release.js` packages the theme and addons for download

## 1. Run the license server

Requires Node.js 18+. (The CLI on customer servers installs `jq` itself.)

```bash
cd server
cp .env.example .env        # fill in BASE_URL, ADMIN_PASS, SESSION_SECRET, SMTP
npm install
npm run release             # builds server/releases and server/registry.json
npm start
```

Put it behind HTTPS (Nginx or Caddy reverse proxy to port 3000). Use `pm2` or systemd to keep it running.

Open `https://your-domain/admin.html` to create licenses, email them, revoke them, reset a domain lock, and create bot API keys.

### Deploy on Render

1. Push this repo to GitHub (private).
2. Render dashboard, **New**, **Web Service**, connect the repo. Leave **Root Directory** empty.
3. Runtime **Node**. Build command: `cd server && npm install && npm run release`. Start command: `cd server && npm start`.
4. **Database**: either set `DATABASE_URL` to a free external Postgres (Neon, Supabase and similar; recommended on the free plan, data survives restarts), or use a paid instance type with a **Disk** mounted at `/var/data` and `DB_PATH=/var/data/geeken.db`. Never use SQLite without a Disk on the free type, its files are deleted on every deploy and restart.
5. **Environment** variables: `BASE_URL` (your Render or custom domain URL, no trailing slash), `ADMIN_USER`, `ADMIN_PASS`, `SESSION_SECRET` (long random string), `DATABASE_URL` (or `DB_PATH`), `BRAND_NAME`, and the SMTP variables.
6. Deploy, then open `https://your-service.onrender.com/admin.html`.

## 2. Install on a panel (customer side)

```bash
bash <(curl -s https://your-domain/install.sh)
```

This opens a menu. You can also use commands directly:

```bash
geeken install                         # install or update the theme
geeken brand "My Hosting" ./logo.png   # your hosting name and logo
geeken color "#1d9e75"                 # accent color
geeken addon list
geeken addon install ticket-system
geeken addon install-all
geeken addon remove ticket-system
geeken uninstall                       # restores the original panel files
```

The license locks to the panel domain (`APP_URL`) the first time it is used. Reset it in the admin page or with the bot API.

## 3. License types

| Type | Value | Can install |
| --- | --- | --- |
| Theme only | `theme` | the theme |
| Theme + addon | `both` | the theme and all addons |

## 4. Bot API

Create a key in the admin page (shown once). Then:

```bash
# create a license and email it
curl -X POST https://your-domain/api/v1/licenses \
  -H "Authorization: Bearer gk_live_..." -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","type":"both","days":30}'

curl -H "Authorization: Bearer gk_live_..." https://your-domain/api/v1/licenses/GKN-XXXX-XXXX-XXXX-XXXX
curl -X POST -H "Authorization: Bearer gk_live_..." https://your-domain/api/v1/licenses/GKN-.../revoke
curl -X POST -H "Authorization: Bearer gk_live_..." https://your-domain/api/v1/licenses/GKN-.../reset-domain
```

`days` is `0` for a lifetime license.

## 5. Addons A to Z

activity-log, backups-plus, custom-pages, discord-widget, email-templates, file-manager-plus, game-presets, help-center, invoice-billing, json-config-editor, keyboard-shortcuts, language-pack, maintenance-mode, notification-center, onboarding-wizard, plugin-installer, quick-actions, resource-graphs, server-groups, ticket-system, uptime-monitor, version-checker, wallet-coins, xp-levels, yearly-reports, zero-downtime-restart.

Each addon is a folder with `addon.json` and `addon.js` (2 files, so the repo stays under GitHub's 100-file web upload limit). The CLI copies `addon.js` into `public/geeken/addons/<name>/`, registers it in `config.json`, and the theme loads it on every panel page. If an addon needs backend work, add an optional `install.sh` (and `uninstall.sh`) to its folder and the CLI will run it. **These are working scaffolds, not finished features.** Write each feature inside its `addon.js` (front-end), and add an `install.sh` if it needs Laravel routes or database tables. After editing, run `npm run release` again.

To add a new addon, copy any addon folder, change the name in `addon.json` and `addon.js`, and rebuild the release.

## 6. Security notes

- Addon `install.sh` files run as root on the customer's server. Only ship scripts you wrote.
- Keep `.env` private and use HTTPS.
- A license that was shared can be revoked or domain-reset from the admin page.
- The theme is delivered as CSS and JS, so a determined customer can read it. A license check protects delivery and updates, it is not DRM.

## 7. What is not finished

- The theme is a starter (colors, branding, addon loader). A full custom UI like Arix needs real React work inside the panel source, then `geeken build`.
- Panel support was written for Pterodactyl 1.x. Test on a staging panel before selling.
- There is no customer login page yet, only the admin page and the bot API.
