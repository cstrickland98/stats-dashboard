# Stats Dashboard

Shared stats and tracking dashboard. The app is built around configurable sources, field mappings, widgets, and shared layouts.

## Install

Requirements:

- Node.js 20 or newer

Install dependencies:

```powershell
npm install
```

## Setup And Run

Create a local server config that is not committed:

```powershell
Copy-Item .\config\local.example.json .\config\local.json
notepad .\config\local.json
```

Set a long random `adminKey` in `config/local.json`, then start the server:

```powershell
npm start
```

Open:

```text
http://localhost:3000
```

The server refuses to start until an admin key is provided. `config/local.json` is ignored by Git and is the intended place for deployment-specific values such as `adminKey`, `port`, and `databasePath`.

Shared dashboards, sources, layouts, presets, cached source data, and activity events are stored in:

```text
data/eq2dash.sqlite
```

Everyone who visits the same running server sees the same shared configuration. Browser storage is only used for personal UI state, such as selected dashboard and temporary admin key session.

Do not put private source URLs, API keys, passwords, or personal machine paths in tracked files. Keep them in `config/local.json` or in the shared dashboard database through the admin UI.

## How To Use

1. Open the dashboard URL.
2. View the seeded `EQ2 sample server status` dashboard.
3. Enter the admin key in the top bar, then click `Edit`.
4. Use `+ Source` to add JSON REST, HTML scrape, static JSON/CSV, WebSocket, or manual data.
5. Test the source, map fields such as `name`, `status`, `uptime`, and `population`, then save the source locally.
6. Use sidebar edit/remove controls to change or delete dashboards, sources, and presets.
7. Use `+ Widget` in edit mode to add tiles, then use each widget's `Edit` button to pick its source, dashboard, layout, options JSON, and field config JSON.
8. Drag widget headers to rearrange tiles and resize from the lower-right corner.
9. Click `Save` to publish the shared layout for everyone.
10. Use `Export` and `Import` to back up or move dashboard JSON.

## Source Notes

- JSON REST sources are fetched by the backend.
- HTML scraping uses backend CSS selectors, so it avoids browser CORS limits.
- Static JSON/CSV and manual sources are stored centrally in SQLite.
- WebSocket sources connect from the backend and buffer recent events.

## Useful API

- `GET /api/config`: read shared dashboard config.
- `GET /api/config` with `X-Admin-Key`: read full config including source connection details.
- `PUT /api/config`: save shared config, requires `X-Admin-Key`.
- `POST /api/sources/test`: test a source, requires `X-Admin-Key`.
- `GET /api/sources/:id/data`: read normalized source data.
- `POST /api/sources/:id/refresh`: refresh a source, requires `X-Admin-Key`.
- `GET /api/events`: read activity events.
