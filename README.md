# EQ2 Stats Dashboard

Shared stats and tracking dashboard for the EQ2EMU team. V1 focuses on EverQuest II server status, uptime, and activity, but the app is built around configurable sources, field mappings, widgets, and shared layouts.

## Install

Requirements:

- Node.js 20 or newer
- One machine/server that everyone can reach on the network

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
3. Click `Edit` and enter the admin key when prompted.
4. Use `+ Source` to add JSON REST, HTML scrape, static JSON/CSV, WebSocket, or manual data.
5. Test the source, map fields such as `name`, `status`, `uptime`, and `population`, then save.
6. Use `+ Widget` in edit mode to add tiles such as status tables, KPIs, charts, feeds, gauges, heatmaps, or map overlays.
7. Drag widget headers to rearrange tiles and resize from the lower-right corner.
8. Click `Save` to publish the shared layout for everyone.
9. Use `Export` and `Import` to back up or move dashboard JSON.

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
