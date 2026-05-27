"use strict";

const express = require("express");
const Database = require("better-sqlite3");
const cheerio = require("cheerio");
const Papa = require("papaparse");
const WebSocket = require("ws");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");

function readJsonFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read config file ${filePath}: ${error.message}`);
  }
}

function resolveInsideRoot(value, fallback) {
  const configured = value || fallback;
  return path.isAbsolute(configured) ? configured : path.join(ROOT, configured);
}

const defaultConfigPath = path.join(ROOT, "config", "default.json");
const localConfigPath = process.env.EQ2DASH_CONFIG
  ? path.resolve(process.env.EQ2DASH_CONFIG)
  : path.join(ROOT, "config", "local.json");
const appConfig = {
  port: 3000,
  databasePath: "data/eq2dash.sqlite",
  adminKey: "",
  ...readJsonFileIfExists(defaultConfigPath),
  ...readJsonFileIfExists(localConfigPath),
};
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || appConfig.port || 3000);
const ADMIN_KEY = process.env.EQ2DASH_ADMIN_KEY || appConfig.adminKey || "";
const DB_PATH = resolveInsideRoot(
  process.env.EQ2DASH_DB_PATH || appConfig.databasePath,
  "data/eq2dash.sqlite",
);
const DATA_DIR = path.dirname(DB_PATH);

if (!ADMIN_KEY || ADMIN_KEY === "replace-with-a-long-random-admin-key") {
  console.error(
    `Missing admin key. Copy config/local.example.json to config/local.json and set adminKey, or set EQ2DASH_ADMIN_KEY.`,
  );
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const nowIso = () => new Date().toISOString();
const json = (value) => JSON.stringify(value ?? null);
const parseJson = (value, fallback = null) => {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const sampleServers = [
  {
    id: "antonia-bayle",
    name: "Antonia Bayle",
    status: "up",
    uptime: "14d 06h",
    uptimeHours: 342,
    lastRestart: "2026-05-13T08:00:00-05:00",
    population: "Medium",
    queue: 0,
    region: "US",
    position: { x: 24, y: 34 },
    history: [
      99.8, 99.7, 99.9, 100, 99.6, 99.7, 100, 100, 99.8, 99.9, 99.7, 100,
    ],
  },
  {
    id: "halls-of-fate",
    name: "Halls of Fate",
    status: "up",
    uptime: "14d 06h",
    uptimeHours: 342,
    lastRestart: "2026-05-13T08:00:00-05:00",
    population: "High",
    queue: 0,
    region: "US",
    position: { x: 47, y: 26 },
    history: [
      99.9, 100, 100, 99.8, 99.7, 99.8, 100, 100, 99.9, 100, 99.8, 99.9,
    ],
  },
  {
    id: "majdul",
    name: "Maj'Dul",
    status: "up",
    uptime: "14d 06h",
    uptimeHours: 342,
    lastRestart: "2026-05-13T08:00:00-05:00",
    population: "Low",
    queue: 0,
    region: "US",
    position: { x: 63, y: 41 },
    history: [
      99.3, 99.5, 99.4, 99.8, 99.7, 99.6, 99.8, 99.9, 99.8, 99.7, 99.6, 99.8,
    ],
  },
  {
    id: "skyfire",
    name: "Skyfire",
    status: "up",
    uptime: "03h 34m",
    uptimeHours: 3.6,
    lastRestart: "2026-05-27T07:18:00-05:00",
    population: "Medium",
    queue: 0,
    region: "US",
    position: { x: 76, y: 55 },
    history: [
      99.6, 99.7, 99.8, 96.2, 99.5, 99.8, 99.8, 99.9, 100, 99.8, 99.7, 99.8,
    ],
  },
  {
    id: "thurgadin",
    name: "Thurgadin",
    status: "locked",
    uptime: "14d 06h",
    uptimeHours: 342,
    lastRestart: "2026-05-13T08:00:00-05:00",
    population: "Locked",
    queue: 0,
    region: "EU",
    position: { x: 35, y: 62 },
    history: [
      99.5, 99.6, 99.5, 99.7, 99.6, 99.4, 98.9, 99.5, 99.6, 99.4, 99.3, 99.5,
    ],
  },
  {
    id: "drunder",
    name: "Drunder",
    status: "down",
    uptime: "-",
    uptimeHours: 0,
    lastRestart: null,
    population: "-",
    queue: 0,
    region: "US",
    position: { x: 82, y: 33 },
    history: [
      98.1, 98.4, 98.0, 97.6, 99.1, 98.7, 97.8, 96.3, 93.5, 88.4, 72.1, 0,
    ],
  },
  {
    id: "kaladim",
    name: "Kaladim",
    status: "up",
    uptime: "21d 02h",
    uptimeHours: 506,
    lastRestart: "2026-05-06T08:00:00-05:00",
    population: "High",
    queue: 0,
    region: "US",
    position: { x: 18, y: 71 },
    history: [100, 100, 99.9, 99.8, 99.9, 100, 100, 99.9, 99.8, 100, 100, 99.9],
  },
  {
    id: "varsoon",
    name: "Varsoon",
    status: "up",
    uptime: "14d 06h",
    uptimeHours: 342,
    lastRestart: "2026-05-13T08:00:00-05:00",
    population: "Medium",
    queue: 0,
    region: "US",
    position: { x: 56, y: 73 },
    history: [
      99.7, 99.8, 99.6, 99.6, 99.9, 99.8, 99.7, 99.9, 100, 99.9, 99.8, 99.8,
    ],
  },
];

const sampleEvents = [
  {
    id: randomUUID(),
    sourceId: "eq2-sample",
    severity: "critical",
    message: "Drunder went down",
    createdAt: "2026-05-27T14:02:00-05:00",
  },
  {
    id: randomUUID(),
    sourceId: "eq2-sample",
    severity: "info",
    message: "Kaladim queue cleared",
    createdAt: "2026-05-27T13:41:00-05:00",
  },
  {
    id: randomUUID(),
    sourceId: "eq2-sample",
    severity: "info",
    message: "Halls of Fate population is High",
    createdAt: "2026-05-27T12:58:00-05:00",
  },
  {
    id: randomUUID(),
    sourceId: "eq2-sample",
    severity: "warning",
    message: "Skyfire restarted",
    createdAt: "2026-05-27T12:30:00-05:00",
  },
  {
    id: randomUUID(),
    sourceId: "eq2-sample",
    severity: "warning",
    message: "Thurgadin is locked",
    createdAt: "2026-05-27T10:02:00-05:00",
  },
];

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      refresh_seconds INTEGER NOT NULL DEFAULT 30,
      config_json TEXT NOT NULL DEFAULT '{}',
      mapping_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_snapshots (
      source_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      data_json TEXT NOT NULL DEFAULT '{}',
      fields_json TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dashboards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS widgets (
      id TEXT PRIMARY KEY,
      dashboard_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      source_id TEXT,
      layout_json TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '{}',
      field_config_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      config_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_events (
      id TEXT PRIMARY KEY,
      source_id TEXT,
      severity TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);
}

function seedIfEmpty() {
  const sourceCount = db
    .prepare("SELECT COUNT(*) AS count FROM sources")
    .get().count;
  if (sourceCount > 0) return;

  const now = nowIso();
  const sourcePayload = { servers: sampleServers, events: sampleEvents };
  const insertSetting = db.prepare(
    "INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)",
  );
  const insertSource = db.prepare(`
    INSERT INTO sources
      (id, name, type, enabled, refresh_seconds, config_json, mapping_json, created_at, updated_at)
    VALUES
      (@id, @name, @type, @enabled, @refreshSeconds, @configJson, @mappingJson, @createdAt, @updatedAt)
  `);
  const insertDashboard = db.prepare(`
    INSERT INTO dashboards (id, name, description, created_at, updated_at)
    VALUES (@id, @name, @description, @createdAt, @updatedAt)
  `);
  const insertWidget = db.prepare(`
    INSERT INTO widgets
      (id, dashboard_id, type, title, source_id, layout_json, options_json, field_config_json, created_at, updated_at)
    VALUES
      (@id, @dashboardId, @type, @title, @sourceId, @layoutJson, @optionsJson, @fieldConfigJson, @createdAt, @updatedAt)
  `);
  const insertEvent = db.prepare(`
    INSERT INTO activity_events (id, source_id, severity, message, payload_json, created_at)
    VALUES (@id, @sourceId, @severity, @message, @payloadJson, @createdAt)
  `);

  const widgets = [
    [
      "server-status",
      "status-table",
      "Server Status",
      { x: 1, y: 1, w: 6, h: 4 },
      { columns: ["name", "status", "uptime", "population"] },
    ],
    ["servers-up", "kpi-up", "Servers Up", { x: 7, y: 1, w: 3, h: 2 }, {}],
    [
      "median-uptime",
      "kpi-uptime",
      "Median Uptime",
      { x: 10, y: 1, w: 3, h: 2 },
      {},
    ],
    [
      "uptime-trend",
      "line-chart",
      "Uptime Trend",
      { x: 7, y: 3, w: 6, h: 3 },
      { metric: "history" },
    ],
    [
      "activity-feed",
      "activity-log",
      "Activity Feed",
      { x: 1, y: 5, w: 6, h: 3 },
      {},
    ],
    [
      "queue-gauge",
      "gauge",
      "Queue Gauge",
      { x: 7, y: 6, w: 3, h: 2 },
      { serverId: "kaladim", metric: "queue", max: 100 },
    ],
    [
      "restart-heatmap",
      "heatmap",
      "Restart Heatmap",
      { x: 10, y: 6, w: 3, h: 2 },
      {},
    ],
    [
      "server-map",
      "map-overlay",
      "Server Map",
      { x: 1, y: 8, w: 12, h: 3 },
      { image: "/assets/norrath-map.svg" },
    ],
  ];

  const tx = db.transaction(() => {
    insertSetting.run("theme", json("dark"), now);
    insertSource.run({
      id: "eq2-sample",
      name: "EQ2 sample server status",
      type: "manual",
      enabled: 1,
      refreshSeconds: 30,
      configJson: json({
        contentType: "json",
        content: JSON.stringify(sourcePayload, null, 2),
      }),
      mappingJson: json({
        rootPath: "servers",
        fields: {
          id: "id",
          name: "name",
          status: "status",
          uptime: "uptime",
          uptimeHours: "uptimeHours",
          lastRestart: "lastRestart",
          population: "population",
          queue: "queue",
          position: "position",
          history: "history",
        },
      }),
      createdAt: now,
      updatedAt: now,
    });
    insertDashboard.run({
      id: "servers",
      name: "Servers",
      description: "EQ2 server status, uptime, and activity tracking.",
      createdAt: now,
      updatedAt: now,
    });
    for (const [id, type, title, layout, options] of widgets) {
      insertWidget.run({
        id,
        dashboardId: "servers",
        type,
        title,
        sourceId: "eq2-sample",
        layoutJson: json(layout),
        optionsJson: json(options),
        fieldConfigJson: json({}),
        createdAt: now,
        updatedAt: now,
      });
    }
    for (const event of sampleEvents) {
      insertEvent.run({
        id: event.id,
        sourceId: event.sourceId,
        severity: event.severity,
        message: event.message,
        payloadJson: json({ seeded: true }),
        createdAt: event.createdAt,
      });
    }
  });
  tx();
}

function getPath(value, pathExpr) {
  if (!pathExpr) return value;
  const parts = String(pathExpr)
    .replace(/\[(\d+|\*)\]/g, ".$1")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (part === "*") {
      if (Array.isArray(current)) return current;
      return undefined;
    }
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function pickRows(raw, mapping = {}) {
  const explicit = getPath(raw, mapping.rootPath || mapping.repeatPath || "");
  if (Array.isArray(explicit)) return explicit;
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.servers)) return raw.servers;
  if (raw && Array.isArray(raw.items)) return raw.items;
  if (raw && Array.isArray(raw.data)) return raw.data;
  if (raw && typeof raw === "object") return [raw];
  return [];
}

function normalizeStatus(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  if (
    ["up", "online", "ok", "available", "running", "true", "1"].includes(text)
  )
    return "up";
  if (["down", "offline", "unavailable", "failed", "false", "0"].includes(text))
    return "down";
  if (
    ["locked", "lock", "maintenance", "maint", "patching", "closed"].includes(
      text,
    )
  )
    return "locked";
  return text || "unknown";
}

function flattenFields(value, prefix = "", out = []) {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    if (value.length > 0) flattenFields(value[0], `${prefix}[*]`, out);
    return out;
  }
  if (typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      flattenFields(inner, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  out.push({ path: prefix, type: typeof value, sample: value });
  return out;
}

function normalizeRows(raw, mapping = {}) {
  const rows = pickRows(raw, mapping);
  const fields = mapping.fields || {};
  const defaults = {
    id: "id",
    name: "name",
    status: "status",
    uptime: "uptime",
    uptimeHours: "uptimeHours",
    lastRestart: "lastRestart",
    population: "population",
    queue: "queue",
    position: "position",
    history: "history",
  };
  const fieldMap = { ...defaults, ...fields };
  return rows.map((row, index) => {
    const normalized = { ...row };
    for (const [field, sourcePath] of Object.entries(fieldMap)) {
      if (typeof sourcePath !== "string") continue;
      const value = getPath(row, sourcePath);
      if (value !== undefined) normalized[field] = value;
    }
    applyTransforms(normalized, row, mapping);
    normalized.id =
      normalized.id || slugify(normalized.name || `row-${index + 1}`);
    normalized.status = normalizeStatus(normalized.status);
    return normalized;
  });
}

function applyTransforms(normalized, row, mapping = {}) {
  const transforms = Array.isArray(mapping.transforms)
    ? mapping.transforms
    : Array.isArray(mapping.calculatedFields)
      ? mapping.calculatedFields
      : [];
  for (const transform of transforms) {
    if (!transform || typeof transform !== "object") continue;
    const type = String(transform.type || transform.kind || "").toLowerCase();
    if (type === "freshness" || type === "freshness-status") {
      applyFreshnessTransform(normalized, row, transform);
    } else if (type === "relative-time" || type === "age-label") {
      applyRelativeTimeTransform(normalized, row, transform);
    } else if (type === "value-map") {
      applyValueMapTransform(normalized, row, transform);
    }
  }
}

function applyFreshnessTransform(normalized, row, transform) {
  const targetField = transform.targetField || "status";
  const timestamp = readTimestamp(normalized, row, transform);
  if (timestamp === null) {
    normalized[targetField] = transform.unknownValue ?? "unknown";
    return;
  }

  const ageSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  const maxAgeSeconds = Number(transform.maxAgeSeconds ?? 120);
  normalized[targetField] =
    ageSeconds <= maxAgeSeconds
      ? transform.freshValue ?? "up"
      : transform.staleValue ?? "down";

  if (transform.ageSecondsField) {
    normalized[transform.ageSecondsField] = ageSeconds;
  }
  if (transform.ageLabelField) {
    normalized[transform.ageLabelField] = formatRelativeAge(ageSeconds);
  }
}

function applyRelativeTimeTransform(normalized, row, transform) {
  const timestamp = readTimestamp(normalized, row, transform);
  if (timestamp === null) return;
  const ageSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (transform.targetField) {
    normalized[transform.targetField] = formatRelativeAge(ageSeconds);
  }
  if (transform.ageSecondsField) {
    normalized[transform.ageSecondsField] = ageSeconds;
  }
}

function applyValueMapTransform(normalized, row, transform) {
  const targetField = transform.targetField;
  if (!targetField || !transform.map || typeof transform.map !== "object") {
    return;
  }
  const value = readTransformValue(normalized, row, transform.sourceField);
  const key = String(value ?? "");
  if (Object.prototype.hasOwnProperty.call(transform.map, key)) {
    normalized[targetField] = transform.map[key];
  } else if (transform.defaultValue !== undefined) {
    normalized[targetField] = transform.defaultValue;
  }
}

function readTimestamp(normalized, row, transform) {
  return parseTimestamp(
    readTransformValue(normalized, row, transform.sourceField || transform.field),
    transform.epochUnit || transform.unit,
  );
}

function readTransformValue(normalized, row, sourceField) {
  if (!sourceField) return undefined;
  const normalizedValue = getPath(normalized, sourceField);
  if (normalizedValue !== undefined) return normalizedValue;
  return getPath(row, sourceField);
}

function parseTimestamp(value, unit = "auto") {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (unit === "ms" || (unit === "auto" && Math.abs(numeric) > 100000000000)) {
      return numeric;
    }
    return numeric * 1000;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatRelativeAge(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${Math.floor(seconds)} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function slugify(value) {
  return (
    String(value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || randomUUID()
  );
}

function parseSourceContent(type, config) {
  const content = config.content ?? "";
  const contentType = String(
    config.contentType || config.format || "",
  ).toLowerCase();
  if (type === "static-csv" || contentType === "csv") {
    const parsed = Papa.parse(content, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
    });
    if (parsed.errors.length) throw new Error(parsed.errors[0].message);
    return parsed.data;
  }
  if (typeof content === "string") return JSON.parse(content || "{}");
  return content;
}

async function fetchText(url) {
  if (!/^https?:\/\//i.test(url))
    throw new Error("Only http and https URLs are supported.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "eq2emu-dashboard/0.1" },
    });
    const text = await response.text();
    if (!response.ok)
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 120)}`);
    return { text, contentType: response.headers.get("content-type") || "" };
  } finally {
    clearTimeout(timer);
  }
}

function scrapeHtml(html, config = {}) {
  const $ = cheerio.load(html);
  const rowSelector = config.rowSelector || config.row || "";
  const selectors = config.selectors || {};
  if (rowSelector) {
    return $(rowSelector)
      .toArray()
      .map((row, index) => {
        const scope = $(row);
        const out = { id: `row-${index + 1}` };
        for (const [field, selector] of Object.entries(selectors)) {
          out[field] = scope.find(selector).first().text().trim();
        }
        return out;
      });
  }
  const out = {
    title: $("title").first().text().trim(),
    headings: $("h1,h2,h3")
      .toArray()
      .slice(0, 12)
      .map((el) => $(el).text().trim())
      .filter(Boolean),
    links: $("a")
      .toArray()
      .slice(0, 12)
      .map((el) => ({ text: $(el).text().trim(), href: $(el).attr("href") }))
      .filter((item) => item.text),
  };
  for (const [field, selector] of Object.entries(selectors)) {
    out[field] = $(selector).first().text().trim();
  }
  return out;
}

async function loadRawSource(source) {
  const config = parseJson(source.config_json, {});
  switch (source.type) {
    case "manual":
    case "static-json":
    case "static-csv":
      return parseSourceContent(source.type, config);
    case "json-rest": {
      const fetched = await fetchText(config.url);
      return JSON.parse(fetched.text);
    }
    case "html-scrape": {
      const fetched = await fetchText(config.url);
      return scrapeHtml(fetched.text, config);
    }
    case "websocket": {
      const snapshot = getSnapshot(source.id);
      return snapshot?.data?.raw || { events: [] };
    }
    default:
      throw new Error(`Unknown source type: ${source.type}`);
  }
}

function saveSnapshot(sourceId, status, data, fields, error = null) {
  db.prepare(
    `
    INSERT INTO source_snapshots (source_id, status, data_json, fields_json, error, fetched_at)
    VALUES (@sourceId, @status, @dataJson, @fieldsJson, @error, @fetchedAt)
    ON CONFLICT(source_id) DO UPDATE SET
      status = excluded.status,
      data_json = excluded.data_json,
      fields_json = excluded.fields_json,
      error = excluded.error,
      fetched_at = excluded.fetched_at
  `,
  ).run({
    sourceId,
    status,
    dataJson: json(data),
    fieldsJson: json(fields),
    error,
    fetchedAt: nowIso(),
  });
}

function getSnapshot(sourceId) {
  const row = db
    .prepare("SELECT * FROM source_snapshots WHERE source_id = ?")
    .get(sourceId);
  if (!row) return null;
  return {
    sourceId: row.source_id,
    status: row.status,
    data: parseJson(row.data_json, {}),
    fields: parseJson(row.fields_json, []),
    error: row.error,
    fetchedAt: row.fetched_at,
  };
}

const refreshTasks = new Map();

async function refreshSource(sourceId) {
  if (refreshTasks.has(sourceId)) return refreshTasks.get(sourceId);
  const task = refreshSourceNow(sourceId).finally(() =>
    refreshTasks.delete(sourceId),
  );
  refreshTasks.set(sourceId, task);
  return task;
}

async function refreshSourceNow(sourceId) {
  const source = db.prepare("SELECT * FROM sources WHERE id = ?").get(sourceId);
  if (!source || !source.enabled) return getSnapshot(sourceId);
  const mapping = parseJson(source.mapping_json, {});
  try {
    const raw = await loadRawSource(source);
    const rows = normalizeRows(raw, mapping);
    const fields = flattenFields(raw).slice(0, 200);
    const events = Array.isArray(raw?.events) ? raw.events : [];
    const data = { rows, raw, events };
    saveSnapshot(source.id, "ok", data, fields);
    return getSnapshot(source.id);
  } catch (error) {
    const previous = getSnapshot(source.id);
    saveSnapshot(
      source.id,
      "error",
      previous?.data || { rows: [], raw: null, events: [] },
      previous?.fields || [],
      error.message,
    );
    return getSnapshot(source.id);
  }
}

function redactSourceConfig(type, config) {
  const redacted = { __redacted: true };
  if (type === "static-json" || type === "static-csv" || type === "manual") {
    redacted.contentType =
      config.contentType || config.format || type.replace("static-", "");
  }
  if (type === "html-scrape") {
    redacted.rowSelector = config.rowSelector || "";
    redacted.selectors = config.selectors || {};
  }
  if (type === "websocket") {
    redacted.messageField = config.messageField || "";
  }
  return redacted;
}

function getConfig(options = {}) {
  const includeSecrets = Boolean(options.includeSecrets);
  const themeRow = db
    .prepare("SELECT value_json FROM settings WHERE key = 'theme'")
    .get();
  const clientRefreshRow = db
    .prepare("SELECT value_json FROM settings WHERE key = 'clientRefreshSeconds'")
    .get();
  const sources = db
    .prepare("SELECT * FROM sources ORDER BY name")
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      enabled: Boolean(row.enabled),
      refreshSeconds: row.refresh_seconds,
      config: includeSecrets
        ? parseJson(row.config_json, {})
        : redactSourceConfig(row.type, parseJson(row.config_json, {})),
      mapping: parseJson(row.mapping_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      snapshot: getSnapshot(row.id),
    }));
  const dashboards = db
    .prepare("SELECT * FROM dashboards ORDER BY name")
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  const widgets = db
    .prepare("SELECT * FROM widgets ORDER BY dashboard_id, id")
    .all()
    .map((row) => ({
      id: row.id,
      dashboardId: row.dashboard_id,
      type: row.type,
      title: row.title,
      sourceId: row.source_id,
      layout: parseJson(row.layout_json, { x: 1, y: 1, w: 3, h: 2 }),
      options: parseJson(row.options_json, {}),
      fieldConfig: parseJson(row.field_config_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  const presets = db
    .prepare("SELECT * FROM presets ORDER BY name")
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      config: parseJson(row.config_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  return {
    version: 1,
    theme: parseJson(themeRow?.value_json, "dark"),
    clientRefreshSeconds: secondsValue(
      parseJson(clientRefreshRow?.value_json, 30),
    ),
    dashboards,
    widgets,
    sources,
    presets,
  };
}

function requireAdmin(req, res, next) {
  const key = req.get("X-Admin-Key") || "";
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    res.status(401).json({ error: "Admin key required." });
    return;
  }
  next();
}

function isAdminRequest(req) {
  return Boolean(ADMIN_KEY && req.get("X-Admin-Key") === ADMIN_KEY);
}

function secondsValue(value, fallback = 30) {
  const seconds = Number(value ?? fallback);
  if (!Number.isFinite(seconds)) return fallback;
  return Math.max(1, Math.floor(seconds));
}

function saveConfig(config) {
  const stamp = nowIso();
  const sources = Array.isArray(config.sources) ? config.sources : [];
  const dashboards = Array.isArray(config.dashboards) ? config.dashboards : [];
  const widgets = Array.isArray(config.widgets) ? config.widgets : [];
  const presets = Array.isArray(config.presets) ? config.presets : [];
  const existingSources = new Map(
    db
      .prepare("SELECT id, config_json, created_at FROM sources")
      .all()
      .map((row) => [row.id, row]),
  );

  const tx = db.transaction(() => {
    db.prepare(
      `
      INSERT INTO settings (key, value_json, updated_at)
      VALUES ('theme', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `,
    ).run(json(config.theme || "dark"), stamp);
    db.prepare(
      `
      INSERT INTO settings (key, value_json, updated_at)
      VALUES ('clientRefreshSeconds', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `,
    ).run(json(secondsValue(config.clientRefreshSeconds, 30)), stamp);

    db.prepare("DELETE FROM widgets").run();
    db.prepare("DELETE FROM dashboards").run();
    db.prepare("DELETE FROM sources").run();
    db.prepare("DELETE FROM presets").run();

    const insertSource = db.prepare(`
      INSERT INTO sources
        (id, name, type, enabled, refresh_seconds, config_json, mapping_json, created_at, updated_at)
      VALUES
        (@id, @name, @type, @enabled, @refreshSeconds, @configJson, @mappingJson, @createdAt, @updatedAt)
    `);
    const insertDashboard = db.prepare(`
      INSERT INTO dashboards (id, name, description, created_at, updated_at)
      VALUES (@id, @name, @description, @createdAt, @updatedAt)
    `);
    const insertWidget = db.prepare(`
      INSERT INTO widgets
        (id, dashboard_id, type, title, source_id, layout_json, options_json, field_config_json, created_at, updated_at)
      VALUES
        (@id, @dashboardId, @type, @title, @sourceId, @layoutJson, @optionsJson, @fieldConfigJson, @createdAt, @updatedAt)
    `);
    const insertPreset = db.prepare(`
      INSERT INTO presets (id, name, config_json, created_at, updated_at)
      VALUES (@id, @name, @configJson, @createdAt, @updatedAt)
    `);

    for (const source of sources) {
      const existing = existingSources.get(source.id);
      const incomingConfig = source.config || {};
      const configJson =
        incomingConfig.__redacted && existing
          ? existing.config_json
          : json(incomingConfig);
      insertSource.run({
        id: source.id || randomUUID(),
        name: source.name || "Untitled source",
        type: source.type || "manual",
        enabled: source.enabled === false ? 0 : 1,
        refreshSeconds: secondsValue(
          source.refreshSeconds ?? source.refresh_seconds,
          30,
        ),
        configJson,
        mappingJson: json(source.mapping || {}),
        createdAt: source.createdAt || existing?.created_at || stamp,
        updatedAt: stamp,
      });
    }
    for (const dashboard of dashboards) {
      insertDashboard.run({
        id: dashboard.id || randomUUID(),
        name: dashboard.name || "Untitled dashboard",
        description: dashboard.description || "",
        createdAt: dashboard.createdAt || stamp,
        updatedAt: stamp,
      });
    }
    for (const widget of widgets) {
      insertWidget.run({
        id: widget.id || randomUUID(),
        dashboardId: widget.dashboardId || dashboards[0]?.id || "servers",
        type: widget.type || "status-table",
        title: widget.title || "Untitled widget",
        sourceId: widget.sourceId || sources[0]?.id || null,
        layoutJson: json(widget.layout || { x: 1, y: 1, w: 3, h: 2 }),
        optionsJson: json(widget.options || {}),
        fieldConfigJson: json(widget.fieldConfig || {}),
        createdAt: widget.createdAt || stamp,
        updatedAt: stamp,
      });
    }
    for (const preset of presets) {
      insertPreset.run({
        id: preset.id || randomUUID(),
        name: preset.name || "Untitled preset",
        configJson: json(preset.config || {}),
        createdAt: preset.createdAt || stamp,
        updatedAt: stamp,
      });
    }
  });
  tx();

}

function addActivity(sourceId, severity, message, payload = {}) {
  db.prepare(
    `
    INSERT INTO activity_events (id, source_id, severity, message, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(
    randomUUID(),
    sourceId,
    severity || "info",
    message || "Event received",
    json(payload),
    nowIso(),
  );
}

const wsClients = new Map();
function startWebSocketSource(source) {
  const config = parseJson(source.config_json, {});
  if (!config.url || wsClients.has(source.id)) return;
  let socket;
  const connect = () => {
    socket = new WebSocket(config.url);
    wsClients.set(source.id, socket);
    socket.on("message", (message) => {
      const text = message.toString();
      let payload = text;
      try {
        payload = JSON.parse(text);
      } catch {
        // Keep text payloads as text.
      }
      addActivity(
        source.id,
        "info",
        config.messageField
          ? String(getPath(payload, config.messageField) || text)
          : text.slice(0, 180),
        payload,
      );
      const events = db
        .prepare(
          `
        SELECT id, source_id AS sourceId, severity, message, payload_json AS payloadJson, created_at AS createdAt
        FROM activity_events
        WHERE source_id = ?
        ORDER BY created_at DESC
        LIMIT 200
      `,
        )
        .all(source.id)
        .map((row) => ({ ...row, payload: parseJson(row.payloadJson, {}) }));
      saveSnapshot(source.id, "ok", { rows: [], raw: { events }, events }, [
        {
          path: "events[*].message",
          type: "string",
          sample: text.slice(0, 80),
        },
      ]);
    });
    socket.on("close", () => {
      wsClients.delete(source.id);
      setTimeout(connect, 10000);
    });
    socket.on("error", (error) => {
      saveSnapshot(
        source.id,
        "error",
        getSnapshot(source.id)?.data || { events: [] },
        [],
        error.message,
      );
      socket.close();
    });
  };
  connect();
}

async function testSource(payload) {
  const type = payload.type || "manual";
  const config = payload.config || {};
  let raw;
  if (type === "json-rest") {
    const fetched = await fetchText(config.url || payload.url);
    raw = JSON.parse(fetched.text);
  } else if (type === "html-scrape") {
    const fetched = await fetchText(config.url || payload.url);
    raw = scrapeHtml(fetched.text, config);
  } else if (type === "static-csv") {
    raw = parseSourceContent("static-csv", config);
  } else if (type === "static-json" || type === "manual") {
    raw = parseSourceContent(type, config);
  } else if (type === "websocket") {
    raw = await testWebSocket(config.url || payload.url);
  } else {
    throw new Error(`Unknown source type: ${type}`);
  }
  const mapping = payload.mapping || {};
  const rows = normalizeRows(raw, mapping);
  return {
    ok: true,
    type,
    sample: Array.isArray(rows) ? rows.slice(0, 5) : rows,
    fields: flattenFields(raw).slice(0, 80),
    rawPreview:
      typeof raw === "string"
        ? raw.slice(0, 1000)
        : JSON.stringify(raw, null, 2).slice(0, 3000),
  };
}

function testWebSocket(url) {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error("WebSocket URL is required."));
      return;
    }
    const socket = new WebSocket(url);
    const events = [];
    const timer = setTimeout(() => {
      socket.close();
      resolve({ events });
    }, 3000);
    socket.on("message", (message) => {
      events.push({ message: message.toString(), createdAt: nowIso() });
      if (events.length >= 5) {
        clearTimeout(timer);
        socket.close();
        resolve({ events });
      }
    });
    socket.on("open", () => {
      if (events.length === 0)
        events.push({ message: "Connected", createdAt: nowIso() });
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

migrate();
seedIfEmpty();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

app.use(
  "/vendor",
  express.static(path.join(ROOT, "node_modules", "interactjs", "dist")),
);
app.use(
  "/vendor",
  express.static(path.join(ROOT, "node_modules", "chart.js", "dist")),
);
app.use(
  "/vendor",
  express.static(path.join(ROOT, "node_modules", "papaparse")),
);
app.use(express.static(PUBLIC_DIR));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, storage: "sqlite", time: nowIso() });
});

app.get("/api/config", (req, res) => {
  res.json(getConfig({ includeSecrets: isAdminRequest(req) }));
});

app.put("/api/config", requireAdmin, (req, res) => {
  try {
    saveConfig(req.body || {});
    res.json(getConfig({ includeSecrets: true }));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/sources/test", requireAdmin, async (req, res) => {
  try {
    res.json(await testSource(req.body || {}));
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/sources/:id/refresh", requireAdmin, async (req, res) => {
  res.json(await refreshSource(req.params.id));
});

app.get("/api/sources/:id/data", async (req, res) => {
  const source = db
    .prepare("SELECT * FROM sources WHERE id = ?")
    .get(req.params.id);
  if (!source) {
    res.status(404).json({ error: "Source not found." });
    return;
  }
  const snapshot = getSnapshot(source.id);
  const staleMs = secondsValue(source.refresh_seconds, 30) * 1000;
  const isStale =
    !snapshot || Date.now() - Date.parse(snapshot.fetchedAt) > staleMs;
  const fresh = isStale ? await refreshSource(source.id) : snapshot;
  res.json(fresh);
});

app.get("/api/events", (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 500);
  const rows = db
    .prepare(
      `
    SELECT id, source_id AS sourceId, severity, message, payload_json AS payloadJson, created_at AS createdAt
    FROM activity_events
    ORDER BY created_at DESC
    LIMIT ?
  `,
    )
    .all(limit)
    .map((row) => ({ ...row, payload: parseJson(row.payloadJson, {}) }));
  res.json({ events: rows });
});

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

const server = app.listen(PORT, HOST, () => {
  console.log(`EQ2 dashboard listening on http://${HOST}:${PORT}`);
  for (const source of db
    .prepare("SELECT * FROM sources WHERE type = 'websocket' AND enabled = 1")
    .all()) {
    startWebSocketSource(source);
  }
});

process.on("SIGINT", () => {
  for (const socket of wsClients.values()) socket.close();
  server.close(() => process.exit(0));
});
