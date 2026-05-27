"use strict";

(() => {
  const app = document.getElementById("app");
  const state = {
    config: null,
    sourceData: {},
    events: [],
    selectedDashboard: sessionStorage.getItem("eq2dash:selectedDashboard") || "",
    adminKey: sessionStorage.getItem("eq2dash:adminKey") || "",
    search: "",
    editMode: false,
    dirty: false,
    drawer: null,
    wizard: createWizard(),
    editor: null,
    toasts: [],
    charts: new Map()
  };

  const widgetTypes = [
    { type: "status-table", title: "Server Status", w: 6, h: 4 },
    { type: "kpi-up", title: "Servers Up", w: 3, h: 2 },
    { type: "kpi-uptime", title: "Median Uptime", w: 3, h: 2 },
    { type: "line-chart", title: "Line Chart", w: 6, h: 3 },
    { type: "activity-log", title: "Activity Log", w: 5, h: 3 },
    { type: "gauge", title: "Gauge", w: 3, h: 2 },
    { type: "heatmap", title: "Heatmap", w: 3, h: 2 },
    { type: "map-overlay", title: "Map Overlay", w: 6, h: 3 },
    { type: "generic-table", title: "Generic Table", w: 5, h: 3 }
  ];

  const sourceTypes = [
    ["json-rest", "JSON REST"],
    ["html-scrape", "HTML scrape"],
    ["static-json", "Static JSON"],
    ["static-csv", "Static CSV"],
    ["websocket", "WebSocket feed"],
    ["manual", "Manual data"]
  ];

  document.addEventListener("click", onClick);
  document.addEventListener("input", onInput);
  document.addEventListener("change", onChange);

  init();

  async function init() {
    try {
      await loadConfig();
      await loadSourceData();
      render();
    } catch (error) {
      app.innerHTML = `<div class="boot"><div class="boot-mark"></div><div><h1>EQ2 Stats</h1><p>${escapeHtml(error.message)}</p></div></div>`;
    }
  }

  async function loadConfig(admin = false) {
    state.config = await api("/api/config", admin ? { admin: true } : {});
    normalizeSelectedDashboard();
  }

  async function loadSourceData() {
    state.sourceData = {};
    const sources = state.config?.sources || [];
    await Promise.all(sources.map(async (source) => {
      try {
        state.sourceData[source.id] = await api(`/api/sources/${encodeURIComponent(source.id)}/data`);
      } catch (error) {
        state.sourceData[source.id] = {
          sourceId: source.id,
          status: "error",
          error: error.message,
          data: { rows: [], raw: null, events: [] },
          fields: []
        };
      }
    }));
    try {
      const result = await api("/api/events?limit=120");
      state.events = result.events || [];
    } catch {
      state.events = [];
    }
  }

  async function api(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.admin) headers["X-Admin-Key"] = getAdminKey();
    const response = await fetch(url, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      if (response.status === 401) {
        state.adminKey = "";
        sessionStorage.removeItem("eq2dash:adminKey");
      }
      throw new Error(typeof body === "string" ? body : body.error || "Request failed.");
    }
    return body;
  }

  function getAdminKey() {
    let key = state.adminKey || sessionStorage.getItem("eq2dash:adminKey");
    if (!key) {
      try {
        key = window.prompt("Admin key");
      } catch {
        key = "";
      }
      if (!key) throw new Error("Admin key required.");
    }
    state.adminKey = key;
    sessionStorage.setItem("eq2dash:adminKey", key);
    return key;
  }

  function render() {
    if (!state.config) return;
    destroyCharts();
    document.documentElement.dataset.theme = state.config.theme || "dark";
    const dashboard = currentDashboard();
    app.innerHTML = `
      <div class="layout">
        ${renderSidebar(dashboard)}
        <main class="main">
          ${renderTopbar(dashboard)}
          <section class="content">
            ${state.editMode ? renderEditNotice() : ""}
            ${renderDashboardGrid(dashboard)}
          </section>
        </main>
      </div>
      ${renderDrawer()}
      ${renderToasts()}
    `;
    renderCharts();
    setupInteractions();
  }

  function renderSidebar(dashboard) {
    const dashboards = state.config.dashboards || [];
    const sources = state.config.sources || [];
    const presets = state.config.presets || [];
    return `
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark"></div>
          <div>
            <h1>EQ2 Stats</h1>
            <span>Shared tracker hub</span>
          </div>
        </div>

        <section class="side-section">
          <div class="side-heading">
            <span>Dashboards</span>
            <button class="btn small ghost" data-action="add-dashboard" title="Add dashboard">+</button>
          </div>
          <div class="side-list">
            ${dashboards.map((dash) => `
              <div class="side-row">
                <button class="side-item ${dash.id === dashboard?.id ? "active" : ""}" data-dashboard="${escapeAttr(dash.id)}">
                  <span class="status-dot up"></span>
                  <span>${escapeHtml(dash.name)}</span>
                </button>
                ${state.editMode ? `
                  <div class="side-actions">
                    <button class="mini-action" data-edit-dashboard="${escapeAttr(dash.id)}" title="Edit dashboard">Edit</button>
                    <button class="mini-action danger" data-remove-dashboard="${escapeAttr(dash.id)}" title="Remove dashboard">Remove</button>
                  </div>
                ` : ""}
              </div>
            `).join("") || `<div class="empty-mini">No dashboards</div>`}
          </div>
        </section>

        <section class="side-section">
          <div class="side-heading">
            <span>Sources</span>
            <button class="btn small ghost" data-action="add-source" title="Add source">+</button>
          </div>
          <div class="side-list">
            ${sources.map((source) => {
              const snapshot = state.sourceData[source.id] || source.snapshot || {};
              return `
                <div class="side-row">
                  <div class="source-chip">
                    <span class="status-dot ${snapshot.status === "ok" ? "up" : snapshot.status === "error" ? "down" : ""}"></span>
                    <div>
                      <strong>${escapeHtml(source.name)}</strong>
                      <span>${escapeHtml(source.type)} / ${source.enabled === false ? "disabled" : escapeHtml(snapshot.status || "pending")}</span>
                    </div>
                  </div>
                  ${state.editMode ? `
                    <div class="side-actions">
                      <button class="mini-action" data-edit-source="${escapeAttr(source.id)}" title="Edit source">Edit</button>
                      <button class="mini-action danger" data-remove-source="${escapeAttr(source.id)}" title="Remove source">Remove</button>
                    </div>
                  ` : ""}
                </div>
              `;
            }).join("") || `<div class="source-chip"><span class="status-dot"></span><div><strong>No sources</strong><span>Add one to start tracking.</span></div></div>`}
          </div>
        </section>

        ${(presets.length || state.editMode) ? `
          <section class="side-section">
            <div class="side-heading">
              <span>Presets</span>
              <button class="btn small ghost" data-action="save-preset" title="Save preset">+</button>
            </div>
            <div class="side-list">
              ${presets.map((preset) => `
                <div class="side-row">
                  <div class="side-item passive">
                    <span class="status-dot"></span>
                    <span>${escapeHtml(preset.name)}</span>
                  </div>
                  ${state.editMode ? `
                    <div class="side-actions">
                      <button class="mini-action" data-edit-preset="${escapeAttr(preset.id)}" title="Edit preset">Edit</button>
                      <button class="mini-action danger" data-remove-preset="${escapeAttr(preset.id)}" title="Remove preset">Remove</button>
                    </div>
                  ` : ""}
                </div>
              `).join("") || `<div class="empty-mini">No presets</div>`}
            </div>
          </section>
        ` : ""}
      </aside>
    `;
  }

  function renderTopbar(dashboard) {
    return `
      <header class="topbar">
        <div class="title-stack">
          <h2>${escapeHtml(dashboard?.name || "Dashboard")}</h2>
          <p>${escapeHtml(dashboard?.description || "Shared sources, widgets, and layouts are stored on the server.")}</p>
        </div>
        <div class="toolbar">
          <input class="search" id="searchBox" type="search" value="${escapeAttr(state.search)}" placeholder="Search servers or widgets">
          <input class="admin-key" id="adminKey" type="password" value="${escapeAttr(state.adminKey)}" placeholder="Admin key" autocomplete="off">
          <button class="btn" data-action="refresh" title="Refresh data">Refresh</button>
          <button class="btn" data-action="add-source" title="Add source">+ Source</button>
          <button class="btn" data-action="export" title="Export layout JSON">Export</button>
          <button class="btn" data-action="import" title="Import layout JSON">Import</button>
          <input hidden id="importFile" type="file" accept="application/json,.json">
          <button class="btn" data-action="theme" title="Toggle shared theme">Theme</button>
          ${state.editMode ? `
            <button class="btn" data-action="edit-dashboard" title="Edit current dashboard">Dashboard</button>
            <button class="btn" data-action="add-widget" title="Add widget">+ Widget</button>
            <button class="btn" data-action="save-preset" title="Save preset">Preset</button>
            <button class="btn accent" data-action="save" title="Save shared layout">Save</button>
            <button class="btn" data-action="discard" title="Discard edits">Discard</button>
          ` : `
            <button class="btn primary" data-action="edit" title="Edit shared layout">Edit</button>
          `}
        </div>
      </header>
    `;
  }

  function renderEditNotice() {
    return `
      <div class="notice">
        <span>Editing shared config. Sources, dashboards, widgets, presets, layout, and advanced JSON changes publish when you save.</span>
        <button class="btn small ghost" data-action="clear-admin">Clear admin key</button>
      </div>
    `;
  }

  function renderDashboardGrid(dashboard) {
    if (!dashboard) return `<div class="empty">No dashboards configured.</div>`;
    const widgets = dashboardWidgets(dashboard.id);
    if (!widgets.length) {
      return `<div class="empty">No widgets on this dashboard. Use Edit, then Add Widget.</div>`;
    }
    return `
      <div class="dashboard-grid">
        ${widgets.map(renderWidget).join("")}
      </div>
    `;
  }

  function renderWidget(widget) {
    const source = getSource(widget.sourceId);
    const editable = state.editMode ? "editable" : "";
    const compactHeader = ["kpi-up", "kpi-uptime", "gauge", "heatmap"].includes(widget.type);
    return `
      <article class="widget-card ${editable}" data-widget-id="${escapeAttr(widget.id)}" style="${layoutStyle(widget.layout)}">
        <div class="widget-head">
          <h3>${escapeHtml(widget.title)}</h3>
          <div class="widget-meta">
            ${compactHeader ? "" : `<span>${escapeHtml(source?.name || "No source")}</span>`}
            ${state.editMode ? `
              <button class="btn small ghost" data-edit-widget="${escapeAttr(widget.id)}" title="Configure widget">Edit</button>
              <button class="btn small ghost" data-remove-widget="${escapeAttr(widget.id)}" title="Remove widget">Remove</button>
            ` : ""}
          </div>
        </div>
        <div class="widget-body">
          ${renderWidgetBody(widget)}
        </div>
      </article>
    `;
  }

  function renderWidgetBody(widget) {
    switch (widget.type) {
      case "status-table":
        return renderStatusTable(widget);
      case "kpi-up":
        return renderServersUp(widget);
      case "kpi-uptime":
        return renderMedianUptime(widget);
      case "line-chart":
        return `<div class="chart-wrap"><canvas data-chart-widget="${escapeAttr(widget.id)}"></canvas></div>`;
      case "activity-log":
        return renderActivityLog(widget);
      case "gauge":
        return renderGauge(widget);
      case "heatmap":
        return renderHeatmap(widget);
      case "map-overlay":
        return renderMap(widget);
      case "generic-table":
        return renderGenericTable(widget);
      default:
        return `<div class="empty">Widget type ${escapeHtml(widget.type)} is ready for a renderer.</div>`;
    }
  }

  function renderStatusTable(widget) {
    const rows = filteredRows(widget.sourceId);
    return `
      <table class="server-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Uptime</th>
            <th>Population</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td><div class="server-name-cell"><span class="status-dot ${escapeAttr(row.status)}"></span><strong>${escapeHtml(row.name || row.id)}</strong></div></td>
              <td><span class="status-pill"><span class="status-dot ${escapeAttr(row.status)}"></span>${escapeHtml(row.status || "unknown")}</span></td>
              <td>${escapeHtml(row.uptime || "-")}</td>
              <td>${escapeHtml(row.population || "-")}</td>
            </tr>
          `).join("") || `<tr><td colspan="4">No rows match the current search.</td></tr>`}
        </tbody>
      </table>
    `;
  }

  function renderServersUp(widget) {
    const rows = sourceRows(widget.sourceId);
    const up = rows.filter((row) => row.status === "up").length;
    const total = rows.length;
    return `
      <div class="kpi">
        <p class="kpi-label">Servers up</p>
        <div>
          <div class="kpi-value">${up}<span style="font-size: 22px; color: var(--muted);"> / ${total}</span></div>
          <p class="kpi-sub">${total - up} need attention or are locked.</p>
        </div>
      </div>
    `;
  }

  function renderMedianUptime(widget) {
    const rows = sourceRows(widget.sourceId);
    const values = rows.map((row) => Number(row.uptimeHours)).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
    const median = values.length ? values[Math.floor(values.length / 2)] : 0;
    const latestRestart = rows
      .map((row) => row.lastRestart)
      .filter(Boolean)
      .sort()
      .pop();
    return `
      <div class="kpi">
        <p class="kpi-label">Median uptime</p>
        <div>
          <div class="kpi-value">${escapeHtml(formatDurationHours(median))}</div>
          <p class="kpi-sub">Latest restart: ${escapeHtml(formatDate(latestRestart))}</p>
        </div>
      </div>
    `;
  }

  function renderActivityLog(widget) {
    const items = sourceEvents(widget.sourceId)
      .filter((event) => !state.search || `${event.message} ${event.severity}`.toLowerCase().includes(state.search.toLowerCase()))
      .slice(0, 30);
    return `
      <div class="feed">
        ${items.map((event) => `
          <div class="feed-row">
            <span class="feed-time">${escapeHtml(formatTime(event.createdAt))}</span>
            <span class="status-dot ${severityClass(event.severity)}"></span>
            <span>${escapeHtml(event.message)}</span>
          </div>
        `).join("") || `<div class="empty">No activity yet.</div>`}
      </div>
    `;
  }

  function renderGauge(widget) {
    const rows = sourceRows(widget.sourceId);
    const serverId = widget.options?.serverId;
    const row = rows.find((item) => item.id === serverId) || rows[0] || {};
    const max = Number(widget.options?.max || 100);
    const value = Number(row[widget.options?.metric || "queue"] || 0);
    const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
    return `
      <div class="gauge">
        <div>
          <div class="gauge-ring" style="--value: ${pct}%"><strong>${escapeHtml(value)}</strong></div>
          <p class="kpi-sub" style="text-align: center; margin-top: 10px;">${escapeHtml(row.name || "Queue")} / max ${escapeHtml(max)}</p>
        </div>
      </div>
    `;
  }

  function renderHeatmap(widget) {
    const rows = sourceRows(widget.sourceId);
    const stress = rows.filter((row) => row.status !== "up").length;
    return `
      <div>
        <div class="heatmap">
          ${Array.from({ length: 84 }).map((_, index) => {
            const heat = 0.16 + (((index * 17 + stress * 23) % 9) / 10);
            return `<span class="heat-cell" style="--heat:${heat.toFixed(2)}"></span>`;
          }).join("")}
        </div>
        <p class="kpi-sub" style="margin-top: 10px;">12 week restart and incident density placeholder.</p>
      </div>
    `;
  }

  function renderMap(widget) {
    const rows = sourceRows(widget.sourceId);
    const image = widget.options?.image || "/assets/norrath-map.svg";
    return `
      <div class="map-widget" style="background-image: url('${escapeAttr(image)}')">
        ${rows.map((row) => {
          const pos = row.position || {};
          const x = Number(pos.x || 50);
          const y = Number(pos.y || 50);
          return `
            <div class="map-pin" style="left:${x}%; top:${y}%">
              <span class="status-dot ${escapeAttr(row.status)}"></span>
              <span>${escapeHtml(row.name || row.id)}</span>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderGenericTable(widget) {
    const rows = filteredRows(widget.sourceId).slice(0, 20);
    const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).filter((key) => !["history", "position"].includes(key)).slice(0, 6);
    if (!rows.length || !columns.length) return `<div class="empty">No tabular data available.</div>`;
    return `
      <table class="server-table">
        <thead><tr>${columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows.map((row) => `<tr>${columns.map((col) => `<td>${escapeHtml(displayValue(row[col]))}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    `;
  }

  function renderDrawer() {
    if (state.drawer === "source") return renderSourceDrawer();
    if (state.drawer === "dashboard") return renderDashboardDrawer();
    if (state.drawer === "widget") return renderWidgetDrawer();
    if (state.drawer === "preset") return renderPresetDrawer();
    if (state.drawer === "palette") return renderPaletteDrawer();
    return "";
  }

  function renderSourceDrawer() {
    const form = state.wizard.form;
    const type = form.type || "json-rest";
    const isEdit = state.wizard.mode === "edit";
    const enabled = form.enabled !== false && form.enabled !== "false";
    return `
      <section class="drawer" role="dialog" aria-modal="true">
        <div class="drawer-panel">
          <div class="drawer-head">
            <div>
              <h2>${isEdit ? "Edit data source" : "Add a data source"}</h2>
              <p>Sources, mappings, uploaded data, and advanced JSON are saved centrally on the server.</p>
            </div>
            <button class="btn" data-action="close-drawer">Close</button>
          </div>

          <div class="form-grid">
            ${isEdit ? `
              <div class="field full">
                <label>Source ID</label>
                <input value="${escapeAttr(state.wizard.sourceId)}" disabled>
              </div>
            ` : ""}
            <div class="field">
              <label>Source type</label>
              <select name="type" data-wizard>
                ${sourceTypes.map(([value, label]) => `<option value="${value}" ${value === type ? "selected" : ""}>${label}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label>Name</label>
              <input name="name" data-wizard value="${escapeAttr(form.name)}" placeholder="EQ2 server status">
            </div>
            <label class="field check-field">
              <span>Enabled</span>
              <input type="checkbox" name="enabled" data-wizard ${enabled ? "checked" : ""}>
            </label>

            ${renderSourceFields(type, form)}

            <div class="field">
              <label>Root path</label>
              <input name="rootPath" data-wizard value="${escapeAttr(form.rootPath)}" placeholder="servers">
            </div>
            <div class="field">
              <label>Poll seconds</label>
              <input name="refreshSeconds" data-wizard value="${escapeAttr(form.refreshSeconds)}" inputmode="numeric">
            </div>

            <div class="field">
              <label>Name field</label>
              <input name="fieldName" data-wizard value="${escapeAttr(form.fieldName)}" placeholder="name">
            </div>
            <div class="field">
              <label>Status field</label>
              <input name="fieldStatus" data-wizard value="${escapeAttr(form.fieldStatus)}" placeholder="status">
            </div>
            <div class="field">
              <label>Uptime field</label>
              <input name="fieldUptime" data-wizard value="${escapeAttr(form.fieldUptime)}" placeholder="uptime">
            </div>
            <div class="field">
              <label>Population field</label>
              <input name="fieldPopulation" data-wizard value="${escapeAttr(form.fieldPopulation)}" placeholder="population">
            </div>
            <div class="field">
              <label>Last restart field</label>
              <input name="fieldLastRestart" data-wizard value="${escapeAttr(form.fieldLastRestart)}" placeholder="lastRestart">
            </div>
            <div class="field full">
              <label>Advanced config JSON</label>
              <textarea name="configJson" data-wizard spellcheck="false">${escapeHtml(form.configJson)}</textarea>
            </div>
            <div class="field full">
              <label>Advanced mapping JSON</label>
              <textarea name="mappingJson" data-wizard spellcheck="false">${escapeHtml(form.mappingJson)}</textarea>
            </div>
          </div>

          ${renderTestResult()}

          <div class="drawer-actions">
            <div>
              ${isEdit ? `<button class="btn danger" data-action="remove-source" title="Remove source">Remove source</button>` : ""}
            </div>
            <div>
              <button class="btn" data-action="test-source">Test source</button>
              <button class="btn" data-action="close-drawer">Cancel</button>
              <button class="btn accent" data-action="save-source">Save source</button>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function renderSourceFields(type, form) {
    if (type === "json-rest") {
      return `
        <div class="field full">
          <label>URL</label>
          <input name="url" data-wizard value="${escapeAttr(form.url)}" placeholder="https://example.local/servers.json">
        </div>
      `;
    }
    if (type === "html-scrape") {
      return `
        <div class="field full">
          <label>URL</label>
          <input name="url" data-wizard value="${escapeAttr(form.url)}" placeholder="https://example.local/status">
        </div>
        <div class="field">
          <label>Row selector</label>
          <input name="rowSelector" data-wizard value="${escapeAttr(form.rowSelector)}" placeholder=".server-row">
        </div>
        <div class="field">
          <label>Name selector</label>
          <input name="nameSelector" data-wizard value="${escapeAttr(form.nameSelector)}" placeholder=".server-name">
        </div>
        <div class="field">
          <label>Status selector</label>
          <input name="statusSelector" data-wizard value="${escapeAttr(form.statusSelector)}" placeholder=".status">
        </div>
        <div class="field">
          <label>Uptime selector</label>
          <input name="uptimeSelector" data-wizard value="${escapeAttr(form.uptimeSelector)}" placeholder=".uptime">
        </div>
        <div class="field">
          <label>Population selector</label>
          <input name="populationSelector" data-wizard value="${escapeAttr(form.populationSelector)}" placeholder=".population">
        </div>
      `;
    }
    if (type === "static-csv" || type === "static-json" || type === "manual") {
      return `
        <div class="field full">
          <label>Upload or paste data</label>
          <input type="file" id="sourceFile" accept=".json,.csv,application/json,text/csv">
          <textarea name="content" data-wizard placeholder="${type === "static-csv" ? "name,status,uptime" : "{ \"servers\": [] }"}">${escapeHtml(form.content)}</textarea>
        </div>
      `;
    }
    if (type === "websocket") {
      return `
        <div class="field full">
          <label>WebSocket URL</label>
          <input name="url" data-wizard value="${escapeAttr(form.url)}" placeholder="ws://localhost:9000/events">
        </div>
        <div class="field full">
          <label>Message field</label>
          <input name="messageField" data-wizard value="${escapeAttr(form.messageField)}" placeholder="message">
        </div>
      `;
    }
    return "";
  }

  function renderTestResult() {
    const result = state.wizard.test;
    if (!result) return "";
    if (result.error) {
      return `<div class="test-result"><strong>Test failed</strong><pre>${escapeHtml(result.error)}</pre></div>`;
    }
    return `
      <div class="test-result">
        <strong>Preview</strong>
        <p class="kpi-sub">${escapeHtml((result.fields || []).length)} fields detected. First rows are shown below.</p>
        <pre>${escapeHtml(JSON.stringify({ sample: result.sample, fields: (result.fields || []).slice(0, 12) }, null, 2))}</pre>
      </div>
    `;
  }

  function renderDashboardDrawer() {
    const form = state.editor?.form || {};
    const isEdit = state.editor?.mode === "edit";
    return `
      <section class="drawer" role="dialog" aria-modal="true">
        <div class="drawer-panel">
          <div class="drawer-head">
            <div>
              <h2>${isEdit ? "Edit dashboard" : "Add dashboard"}</h2>
              <p>Dashboards group widgets and control the title and description shown in the workspace.</p>
            </div>
            <button class="btn" data-action="close-drawer">Close</button>
          </div>
          <div class="form-grid">
            ${isEdit ? `
              <div class="field full">
                <label>Dashboard ID</label>
                <input value="${escapeAttr(state.editor.id)}" disabled>
              </div>
            ` : ""}
            <div class="field full">
              <label>Name</label>
              <input name="name" data-editor value="${escapeAttr(form.name)}" placeholder="Server operations">
            </div>
            <div class="field full">
              <label>Description</label>
              <textarea name="description" data-editor>${escapeHtml(form.description)}</textarea>
            </div>
          </div>
          <div class="drawer-actions">
            <div>
              ${isEdit ? `<button class="btn danger" data-action="remove-dashboard" title="Remove dashboard">Remove dashboard</button>` : ""}
            </div>
            <div>
              <button class="btn" data-action="close-drawer">Cancel</button>
              <button class="btn accent" data-action="save-dashboard">Save dashboard</button>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function renderWidgetDrawer() {
    const form = state.editor?.form || {};
    const dashboards = state.config.dashboards || [];
    const sources = state.config.sources || [];
    const selectedType = form.type || widgetTypes[0].type;
    return `
      <section class="drawer" role="dialog" aria-modal="true">
        <div class="drawer-panel">
          <div class="drawer-head">
            <div>
              <h2>Configure widget</h2>
              <p>Choose the source, move the widget between dashboards, and edit renderer options directly.</p>
            </div>
            <button class="btn" data-action="close-drawer">Close</button>
          </div>
          <div class="form-grid">
            <div class="field full">
              <label>Widget ID</label>
              <input value="${escapeAttr(state.editor?.id || "")}" disabled>
            </div>
            <div class="field">
              <label>Widget type</label>
              <select name="type" data-editor>
                ${widgetTypes.map((item) => `<option value="${escapeAttr(item.type)}" ${item.type === selectedType ? "selected" : ""}>${escapeHtml(item.title)} (${escapeHtml(item.type)})</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label>Title</label>
              <input name="title" data-editor value="${escapeAttr(form.title)}" placeholder="Widget title">
            </div>
            <div class="field">
              <label>Dashboard</label>
              <select name="dashboardId" data-editor>
                ${dashboards.map((dash) => `<option value="${escapeAttr(dash.id)}" ${dash.id === form.dashboardId ? "selected" : ""}>${escapeHtml(dash.name)}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label>Source</label>
              <select name="sourceId" data-editor>
                <option value="" ${form.sourceId ? "" : "selected"}>No source</option>
                ${sources.map((source) => `<option value="${escapeAttr(source.id)}" ${source.id === form.sourceId ? "selected" : ""}>${escapeHtml(source.name)}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label>Grid X</label>
              <input name="x" data-editor value="${escapeAttr(form.x)}" inputmode="numeric">
            </div>
            <div class="field">
              <label>Grid Y</label>
              <input name="y" data-editor value="${escapeAttr(form.y)}" inputmode="numeric">
            </div>
            <div class="field">
              <label>Width</label>
              <input name="w" data-editor value="${escapeAttr(form.w)}" inputmode="numeric">
            </div>
            <div class="field">
              <label>Height</label>
              <input name="h" data-editor value="${escapeAttr(form.h)}" inputmode="numeric">
            </div>
            <div class="field full">
              <label>Options JSON</label>
              <textarea name="optionsJson" data-editor spellcheck="false">${escapeHtml(form.optionsJson)}</textarea>
            </div>
            <div class="field full">
              <label>Field config JSON</label>
              <textarea name="fieldConfigJson" data-editor spellcheck="false">${escapeHtml(form.fieldConfigJson)}</textarea>
            </div>
          </div>
          <div class="drawer-actions">
            <button class="btn danger" data-action="remove-widget">Remove widget</button>
            <div>
              <button class="btn" data-action="close-drawer">Cancel</button>
              <button class="btn accent" data-action="save-widget">Save widget</button>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function renderPresetDrawer() {
    const form = state.editor?.form || {};
    return `
      <section class="drawer" role="dialog" aria-modal="true">
        <div class="drawer-panel">
          <div class="drawer-head">
            <div>
              <h2>Edit preset</h2>
              <p>Presets store a named dashboard configuration snapshot.</p>
            </div>
            <button class="btn" data-action="close-drawer">Close</button>
          </div>
          <div class="form-grid">
            <div class="field full">
              <label>Preset ID</label>
              <input value="${escapeAttr(state.editor?.id || "")}" disabled>
            </div>
            <div class="field full">
              <label>Name</label>
              <input name="name" data-editor value="${escapeAttr(form.name)}" placeholder="Preset name">
            </div>
            <div class="field full">
              <label>Config JSON</label>
              <textarea name="configJson" data-editor spellcheck="false">${escapeHtml(form.configJson)}</textarea>
            </div>
          </div>
          <div class="drawer-actions">
            <button class="btn danger" data-action="remove-preset">Remove preset</button>
            <div>
              <button class="btn" data-action="close-drawer">Cancel</button>
              <button class="btn accent" data-action="save-preset-edit">Save preset</button>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function renderPaletteDrawer() {
    return `
      <section class="drawer" role="dialog" aria-modal="true">
        <div class="drawer-panel">
          <div class="drawer-head">
            <div>
              <h2>Add a widget</h2>
              <p>Pick a renderer, then configure its source, layout, options, and field config.</p>
            </div>
            <button class="btn" data-action="close-drawer">Close</button>
          </div>
          <div class="palette">
            ${widgetTypes.map((item) => `
              <button data-add-widget="${escapeAttr(item.type)}">
                <strong>${escapeHtml(item.title)}</strong>
                <span class="kpi-sub">${escapeHtml(item.type)}</span>
              </button>
            `).join("")}
          </div>
        </div>
      </section>
    `;
  }

  function renderToasts() {
    if (!state.toasts.length) return "";
    return `<div class="toast-stack">${state.toasts.map((toast) => `<div class="toast ${toast.type || ""}">${escapeHtml(toast.message)}</div>`).join("")}</div>`;
  }

  async function onClick(event) {
    const dashboardButton = event.target.closest("[data-dashboard]");
    if (dashboardButton) {
      state.selectedDashboard = dashboardButton.dataset.dashboard;
      sessionStorage.setItem("eq2dash:selectedDashboard", state.selectedDashboard);
      render();
      return;
    }

    const editDashboardButton = event.target.closest("[data-edit-dashboard]");
    if (editDashboardButton) {
      openDashboardDrawer(editDashboardButton.dataset.editDashboard);
      return;
    }

    const removeDashboardButton = event.target.closest("[data-remove-dashboard]");
    if (removeDashboardButton) {
      removeDashboard(removeDashboardButton.dataset.removeDashboard);
      return;
    }

    const editSourceButton = event.target.closest("[data-edit-source]");
    if (editSourceButton) {
      openSourceDrawer(editSourceButton.dataset.editSource);
      return;
    }

    const removeSourceButton = event.target.closest("[data-remove-source]");
    if (removeSourceButton) {
      removeSource(removeSourceButton.dataset.removeSource);
      return;
    }

    const editWidgetButton = event.target.closest("[data-edit-widget]");
    if (editWidgetButton) {
      openWidgetDrawer(editWidgetButton.dataset.editWidget);
      return;
    }

    const removeButton = event.target.closest("[data-remove-widget]");
    if (removeButton) {
      removeWidget(removeButton.dataset.removeWidget);
      return;
    }

    const editPresetButton = event.target.closest("[data-edit-preset]");
    if (editPresetButton) {
      openPresetDrawer(editPresetButton.dataset.editPreset);
      return;
    }

    const removePresetButton = event.target.closest("[data-remove-preset]");
    if (removePresetButton) {
      removePreset(removePresetButton.dataset.removePreset);
      return;
    }

    const addWidgetButton = event.target.closest("[data-add-widget]");
    if (addWidgetButton) {
      addWidget(addWidgetButton.dataset.addWidget);
      return;
    }

    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;

    const action = actionButton.dataset.action;
    try {
      if (action === "refresh") await refreshAll();
      if (action === "edit") await enterEditMode();
      if (action === "save") await saveSharedConfig();
      if (action === "discard") await discardEdits();
      if (action === "add-source") openSourceDrawer();
      if (action === "close-drawer") closeDrawer();
      if (action === "test-source") await testSource();
      if (action === "save-source") saveSource();
      if (action === "remove-source") removeSource(state.wizard.sourceId);
      if (action === "theme") await toggleTheme();
      if (action === "export") await exportConfig();
      if (action === "import") document.getElementById("importFile")?.click();
      if (action === "add-dashboard") openDashboardDrawer();
      if (action === "edit-dashboard") openDashboardDrawer(currentDashboard()?.id);
      if (action === "save-dashboard") saveDashboard();
      if (action === "remove-dashboard") removeDashboard(state.editor?.id);
      if (action === "add-widget") openPalette();
      if (action === "save-widget") saveWidget();
      if (action === "remove-widget") removeWidget(state.editor?.id);
      if (action === "save-preset") await savePreset();
      if (action === "save-preset-edit") savePresetEdit();
      if (action === "remove-preset") removePreset(state.editor?.id);
      if (action === "clear-admin") clearAdminKey();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function onInput(event) {
    if (event.target.id === "searchBox") {
      state.search = event.target.value;
      render();
      const next = document.getElementById("searchBox");
      next?.focus();
      next?.setSelectionRange(state.search.length, state.search.length);
      return;
    }
    if (event.target.id === "adminKey") {
      state.adminKey = event.target.value;
      sessionStorage.setItem("eq2dash:adminKey", state.adminKey);
      return;
    }
    if (event.target.matches("[data-wizard]")) {
      updateFormValue(state.wizard.form, event.target);
      return;
    }
    if (event.target.matches("[data-editor]")) {
      updateFormValue(state.editor.form, event.target);
    }
  }

  async function onChange(event) {
    if (event.target.matches("[data-wizard]")) {
      updateFormValue(state.wizard.form, event.target);
      if (event.target.name === "type") render();
      return;
    }
    if (event.target.matches("[data-editor]")) {
      updateFormValue(state.editor.form, event.target);
      return;
    }
    if (event.target.id === "sourceFile") {
      const file = event.target.files?.[0];
      if (file) {
        state.wizard.form.content = await file.text();
        if (file.name.toLowerCase().endsWith(".csv")) state.wizard.form.type = "static-csv";
        if (file.name.toLowerCase().endsWith(".json")) state.wizard.form.type = "static-json";
        render();
      }
      return;
    }
    if (event.target.id === "importFile") {
      const file = event.target.files?.[0];
      if (file) await importConfig(file);
    }
  }

  async function refreshAll() {
    await loadConfig();
    await loadSourceData();
    toast("Dashboard refreshed.");
    render();
  }

  async function enterEditMode() {
    state.config = await api("/api/config", { admin: true });
    normalizeSelectedDashboard();
    state.editMode = true;
    state.dirty = false;
    render();
  }

  async function discardEdits() {
    state.editMode = false;
    state.dirty = false;
    state.drawer = null;
    state.editor = null;
    await loadConfig();
    await loadSourceData();
    render();
  }

  async function saveSharedConfig() {
    const saved = await api("/api/config", {
      method: "PUT",
      admin: true,
      body: sanitizeConfig(state.config)
    });
    state.config = saved;
    state.editMode = false;
    state.dirty = false;
    state.drawer = null;
    state.editor = null;
    normalizeSelectedDashboard();
    await loadSourceData();
    toast("Shared dashboard saved.");
    render();
  }

  function openSourceDrawer(sourceId = null) {
    getAdminKey();
    state.editMode = true;
    const source = sourceId ? (state.config.sources || []).find((item) => item.id === sourceId) : null;
    if (sourceId && !source) throw new Error("Source not found.");
    state.drawer = "source";
    state.editor = null;
    state.wizard = createWizard(source);
    state.wizard.mode = source ? "edit" : "add";
    state.wizard.sourceId = source?.id || null;
    render();
  }

  function openDashboardDrawer(dashboardId = null) {
    getAdminKey();
    state.editMode = true;
    const dashboard = dashboardId ? (state.config.dashboards || []).find((item) => item.id === dashboardId) : null;
    if (dashboardId && !dashboard) throw new Error("Dashboard not found.");
    state.drawer = "dashboard";
    state.editor = {
      kind: "dashboard",
      mode: dashboard ? "edit" : "add",
      id: dashboard?.id || null,
      form: {
        name: dashboard?.name || "",
        description: dashboard?.description || ""
      }
    };
    render();
  }

  function openWidgetDrawer(widgetId) {
    getAdminKey();
    state.editMode = true;
    const widget = findWidget(widgetId);
    if (!widget) throw new Error("Widget not found.");
    state.drawer = "widget";
    state.editor = {
      kind: "widget",
      mode: "edit",
      id: widget.id,
      form: {
        type: widget.type || widgetTypes[0].type,
        title: widget.title || "",
        dashboardId: widget.dashboardId || currentDashboard()?.id || "",
        sourceId: widget.sourceId || "",
        x: String(widget.layout?.x || 1),
        y: String(widget.layout?.y || 1),
        w: String(widget.layout?.w || 3),
        h: String(widget.layout?.h || 2),
        optionsJson: prettyJson(widget.options || {}),
        fieldConfigJson: prettyJson(widget.fieldConfig || {})
      }
    };
    render();
  }

  function openPresetDrawer(presetId) {
    getAdminKey();
    state.editMode = true;
    const preset = (state.config.presets || []).find((item) => item.id === presetId);
    if (!preset) throw new Error("Preset not found.");
    state.drawer = "preset";
    state.editor = {
      kind: "preset",
      mode: "edit",
      id: preset.id,
      form: {
        name: preset.name || "",
        configJson: prettyJson(preset.config || {})
      }
    };
    render();
  }

  function openPalette() {
    getAdminKey();
    state.editMode = true;
    state.drawer = "palette";
    render();
  }

  function closeDrawer() {
    state.drawer = null;
    state.editor = null;
    render();
  }

  async function testSource() {
    state.wizard.test = null;
    render();
    try {
      state.wizard.test = await api("/api/sources/test", {
        method: "POST",
        admin: true,
        body: buildSourcePayload()
      });
    } catch (error) {
      state.wizard.test = { error: error.message };
    }
    render();
  }

  function saveSource() {
    const payload = buildSourcePayload();
    const existingIndex = (state.config.sources || []).findIndex((source) => source.id === state.wizard.sourceId);
    const source = {
      ...(existingIndex >= 0 ? state.config.sources[existingIndex] : {}),
      id: existingIndex >= 0 ? state.config.sources[existingIndex].id : uniqueSourceId(payload.name),
      name: payload.name,
      type: payload.type,
      enabled: payload.enabled,
      refreshSeconds: Number(payload.refreshSeconds || 30),
      config: payload.config,
      mapping: payload.mapping
    };
    state.config.sources = state.config.sources || [];
    if (existingIndex >= 0) state.config.sources.splice(existingIndex, 1, source);
    else state.config.sources.push(source);
    state.drawer = null;
    state.dirty = true;
    render();
  }

  function buildSourcePayload() {
    const form = state.wizard.form;
    const type = form.type || "json-rest";
    const text = (name) => String(form[name] || "").trim();
    const rawConfig = parseJsonInput(form.configJson, "Advanced config JSON", {});
    const rawMapping = parseJsonInput(form.mappingJson, "Advanced mapping JSON", {});
    const generatedConfig = {};
    if (type === "json-rest") generatedConfig.url = text("url");
    if (type === "html-scrape") {
      generatedConfig.url = text("url");
      generatedConfig.rowSelector = text("rowSelector");
      generatedConfig.selectors = {
        ...((rawConfig && rawConfig.selectors) || {}),
        name: text("nameSelector") || ".name",
        status: text("statusSelector") || ".status",
        uptime: text("uptimeSelector") || ".uptime",
        population: text("populationSelector") || ".population"
      };
    }
    if (type === "static-json" || type === "manual") {
      generatedConfig.contentType = "json";
      generatedConfig.content = form.content || "{}";
    }
    if (type === "static-csv") {
      generatedConfig.contentType = "csv";
      generatedConfig.content = form.content || "";
    }
    if (type === "websocket") {
      generatedConfig.url = text("url");
      generatedConfig.messageField = text("messageField");
    }
    const mappingFields = {
      ...((rawMapping && rawMapping.fields) || {}),
      name: text("fieldName") || "name",
      status: text("fieldStatus") || "status",
      uptime: text("fieldUptime") || "uptime",
      population: text("fieldPopulation") || "population",
      lastRestart: text("fieldLastRestart") || "lastRestart"
    };
    return {
      type,
      name: text("name") || sourceTypes.find(([value]) => value === type)?.[1] || "Untitled source",
      enabled: form.enabled !== false && form.enabled !== "false",
      refreshSeconds: Number(form.refreshSeconds || 30),
      config: { ...rawConfig, ...generatedConfig },
      mapping: {
        ...rawMapping,
        rootPath: text("rootPath"),
        fields: mappingFields
      }
    };
  }

  async function toggleTheme() {
    getAdminKey();
    state.config.theme = state.config.theme === "dark" ? "light" : "dark";
    await saveSharedConfig();
  }

  async function exportConfig() {
    const fullConfig = await api("/api/config", { admin: true });
    const blob = new Blob([JSON.stringify(sanitizeConfig(fullConfig), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "eq2-dashboard-config.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importConfig(file) {
    getAdminKey();
    const text = await file.text();
    const config = JSON.parse(text);
    state.config = config;
    await saveSharedConfig();
  }

  function saveDashboard() {
    const form = state.editor?.form || {};
    const name = String(form.name || "").trim() || "Untitled dashboard";
    const dashboard = {
      ...(state.editor?.id ? state.config.dashboards.find((item) => item.id === state.editor.id) : {}),
      id: state.editor?.id || uniqueId("dashboard", name),
      name,
      description: String(form.description || "").trim()
    };
    const index = (state.config.dashboards || []).findIndex((item) => item.id === dashboard.id);
    state.config.dashboards = state.config.dashboards || [];
    if (index >= 0) state.config.dashboards.splice(index, 1, dashboard);
    else state.config.dashboards.push(dashboard);
    state.selectedDashboard = dashboard.id;
    sessionStorage.setItem("eq2dash:selectedDashboard", dashboard.id);
    state.drawer = null;
    state.editor = null;
    state.dirty = true;
    render();
  }

  function removeDashboard(id) {
    if (!id) return;
    const dashboard = (state.config.dashboards || []).find((item) => item.id === id);
    if (!dashboard) return;
    if (!window.confirm(`Remove dashboard "${dashboard.name}" and its widgets?`)) return;
    state.config.dashboards = state.config.dashboards.filter((item) => item.id !== id);
    state.config.widgets = (state.config.widgets || []).filter((widget) => widget.dashboardId !== id);
    if (state.selectedDashboard === id) normalizeSelectedDashboard();
    state.drawer = null;
    state.editor = null;
    state.dirty = true;
    render();
  }

  function addWidget(type) {
    getAdminKey();
    const def = widgetTypes.find((item) => item.type === type) || widgetTypes[0];
    const dashboard = currentDashboard();
    if (!dashboard) throw new Error("Add a dashboard before adding widgets.");
    const widgets = dashboardWidgets(dashboard.id);
    const y = widgets.reduce((max, widget) => Math.max(max, Number(widget.layout?.y || 1) + Number(widget.layout?.h || 2)), 1);
    const id = uniqueId("widget", def.title);
    state.config.widgets = state.config.widgets || [];
    state.config.widgets.push({
      id,
      dashboardId: dashboard.id,
      type: def.type,
      title: def.title,
      sourceId: state.config.sources[0]?.id || null,
      layout: { x: 1, y, w: def.w, h: def.h },
      options: def.type === "map-overlay" ? { image: "/assets/norrath-map.svg" } : {},
      fieldConfig: {}
    });
    state.drawer = null;
    state.editMode = true;
    state.dirty = true;
    openWidgetDrawer(id);
  }

  function saveWidget() {
    const widget = findWidget(state.editor?.id);
    if (!widget) throw new Error("Widget not found.");
    const form = state.editor.form;
    const type = form.type || widgetTypes[0].type;
    const options = parseJsonInput(form.optionsJson, "Options JSON", {});
    const fieldConfig = parseJsonInput(form.fieldConfigJson, "Field config JSON", {});
    if (type === "map-overlay" && !options.image) options.image = "/assets/norrath-map.svg";
    Object.assign(widget, {
      type,
      title: String(form.title || "").trim() || "Untitled widget",
      dashboardId: form.dashboardId || currentDashboard()?.id || "",
      sourceId: form.sourceId || null,
      layout: {
        x: clamp(Number(form.x || 1), 1, 12),
        y: Math.max(1, Number(form.y || 1)),
        w: clamp(Number(form.w || 3), 2, 12),
        h: clamp(Number(form.h || 2), 2, 8)
      },
      options,
      fieldConfig
    });
    state.drawer = null;
    state.editor = null;
    state.dirty = true;
    render();
  }

  function removeWidget(id) {
    getAdminKey();
    if (!id) return;
    state.config.widgets = state.config.widgets.filter((widget) => widget.id !== id);
    state.drawer = null;
    state.editor = null;
    state.dirty = true;
    render();
  }

  function removeSource(id) {
    getAdminKey();
    const source = (state.config.sources || []).find((item) => item.id === id);
    if (!source) return;
    if (!window.confirm(`Remove source "${source.name}"? Widgets using it will switch to no source.`)) return;
    state.config.sources = state.config.sources.filter((item) => item.id !== id);
    for (const widget of state.config.widgets || []) {
      if (widget.sourceId === id) widget.sourceId = null;
    }
    state.drawer = null;
    state.editor = null;
    state.dirty = true;
    render();
  }

  async function savePreset() {
    getAdminKey();
    const name = window.prompt("Preset name");
    if (!name) return;
    state.config.presets = state.config.presets || [];
    state.config.presets.push({
      id: uniqueId("preset", name),
      name,
      config: sanitizeConfig(state.config)
    });
    state.dirty = true;
    render();
  }

  function savePresetEdit() {
    const preset = (state.config.presets || []).find((item) => item.id === state.editor?.id);
    if (!preset) throw new Error("Preset not found.");
    const form = state.editor.form;
    preset.name = String(form.name || "").trim() || "Untitled preset";
    preset.config = parseJsonInput(form.configJson, "Config JSON", {});
    state.drawer = null;
    state.editor = null;
    state.dirty = true;
    render();
  }

  function removePreset(id) {
    const preset = (state.config.presets || []).find((item) => item.id === id);
    if (!preset) return;
    if (!window.confirm(`Remove preset "${preset.name}"?`)) return;
    state.config.presets = state.config.presets.filter((item) => item.id !== id);
    state.drawer = null;
    state.editor = null;
    state.dirty = true;
    render();
  }

  function clearAdminKey() {
    state.adminKey = "";
    sessionStorage.removeItem("eq2dash:adminKey");
    toast("Admin key cleared.");
    render();
  }

  function normalizeSelectedDashboard() {
    const dashboards = state.config?.dashboards || [];
    if (!state.selectedDashboard || !dashboards.some((dash) => dash.id === state.selectedDashboard)) {
      state.selectedDashboard = dashboards[0]?.id || "";
      sessionStorage.setItem("eq2dash:selectedDashboard", state.selectedDashboard);
    }
  }

  function currentDashboard() {
    return (state.config.dashboards || []).find((dash) => dash.id === state.selectedDashboard) || state.config.dashboards?.[0] || null;
  }

  function dashboardWidgets(dashboardId) {
    return (state.config.widgets || [])
      .filter((widget) => widget.dashboardId === dashboardId)
      .sort((a, b) => (Number(a.layout?.y || 0) - Number(b.layout?.y || 0)) || (Number(a.layout?.x || 0) - Number(b.layout?.x || 0)));
  }

  function getSource(sourceId) {
    if (!sourceId) return null;
    return (state.config.sources || []).find((source) => source.id === sourceId) || null;
  }

  function sourceRows(sourceId) {
    const source = getSource(sourceId);
    const snapshot = state.sourceData[source?.id] || source?.snapshot;
    return snapshot?.data?.rows || [];
  }

  function filteredRows(sourceId) {
    const rows = sourceRows(sourceId);
    if (!state.search) return rows;
    const term = state.search.toLowerCase();
    return rows.filter((row) => JSON.stringify(row).toLowerCase().includes(term));
  }

  function sourceEvents(sourceId) {
    const source = getSource(sourceId);
    const snapshotEvents = state.sourceData[source?.id]?.data?.events || [];
    const globalEvents = state.events.filter((event) => !source?.id || event.sourceId === source.id || event.source_id === source.id);
    const all = [...snapshotEvents, ...globalEvents].map((event) => ({
      id: event.id || uniqueId("event", event.message || "event"),
      severity: event.severity || "info",
      message: event.message || event.text || "Event",
      createdAt: event.createdAt || event.created_at || new Date().toISOString()
    }));
    const seen = new Set();
    return all
      .filter((event) => {
        const key = `${event.severity}|${event.message}|${event.createdAt}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function renderCharts() {
    if (!window.Chart) return;
    document.querySelectorAll("canvas[data-chart-widget]").forEach((canvas) => {
      const id = canvas.dataset.chartWidget;
      const widget = state.config.widgets.find((item) => item.id === id);
      if (!widget) return;
      const rows = sourceRows(widget.sourceId);
      const points = averageHistory(rows);
      const ctx = canvas.getContext("2d");
      const chart = new Chart(ctx, {
        type: "line",
        data: {
          labels: points.map((_, index) => `T-${points.length - index - 1}`),
          datasets: [{
            label: "Availability",
            data: points,
            borderColor: getComputedStyle(document.documentElement).getPropertyValue("--accent-2").trim(),
            backgroundColor: "rgba(85, 194, 178, 0.18)",
            tension: 0.35,
            fill: true,
            pointRadius: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { color: getCss("--muted"), maxTicksLimit: 6 } },
            y: { min: 0, max: 100, ticks: { color: getCss("--muted") }, grid: { color: getCss("--line") } }
          }
        }
      });
      state.charts.set(id, chart);
    });
  }

  function destroyCharts() {
    for (const chart of state.charts.values()) chart.destroy();
    state.charts.clear();
  }

  function averageHistory(rows) {
    const series = rows.map((row) => Array.isArray(row.history) ? row.history.map(Number).filter(Number.isFinite) : []).filter((values) => values.length);
    if (!series.length) return [97, 98, 99, 100, 99, 98, 99, 99, 100, 99, 98, 99];
    const length = Math.max(...series.map((values) => values.length));
    return Array.from({ length }).map((_, index) => {
      const values = series.map((items) => items[index]).filter(Number.isFinite);
      return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : null;
    });
  }

  function setupInteractions() {
    if (!window.interact) return;
    try {
      window.interact(".widget-card").unset();
    } catch {
      // Interact may not have a previous binding.
    }
    if (!state.editMode) return;
    window.interact(".widget-card.editable")
      .draggable({
        allowFrom: ".widget-head",
        listeners: {
          start(event) {
            const widget = findWidget(event.target.dataset.widgetId);
            event.target.dataset.dragState = JSON.stringify({ x: widget.layout.x, y: widget.layout.y, dx: 0, dy: 0 });
          },
          move(event) {
            const widget = findWidget(event.target.dataset.widgetId);
            const info = gridMetrics(event.target);
            const data = JSON.parse(event.target.dataset.dragState || "{}");
            data.dx += event.dx;
            data.dy += event.dy;
            const next = {
              ...widget.layout,
              x: clamp(Number(data.x) + Math.round(data.dx / info.colStep), 1, Math.max(1, info.cols - Number(widget.layout.w || 1) + 1)),
              y: Math.max(1, Number(data.y) + Math.round(data.dy / info.rowStep))
            };
            event.target.dataset.dragState = JSON.stringify(data);
            updateWidgetLayout(widget, event.target, next);
          }
        }
      })
      .resizable({
        edges: { right: true, bottom: true },
        listeners: {
          start(event) {
            const widget = findWidget(event.target.dataset.widgetId);
            event.target.dataset.resizeState = JSON.stringify({ w: widget.layout.w, h: widget.layout.h, dx: 0, dy: 0 });
          },
          move(event) {
            const widget = findWidget(event.target.dataset.widgetId);
            const info = gridMetrics(event.target);
            const data = JSON.parse(event.target.dataset.resizeState || "{}");
            data.dx += event.deltaRect.width;
            data.dy += event.deltaRect.height;
            const next = {
              ...widget.layout,
              w: clamp(Number(data.w) + Math.round(data.dx / info.colStep), 2, info.cols - Number(widget.layout.x || 1) + 1),
              h: clamp(Number(data.h) + Math.round(data.dy / info.rowStep), 2, 8)
            };
            event.target.dataset.resizeState = JSON.stringify(data);
            updateWidgetLayout(widget, event.target, next);
          }
        }
      });
  }

  function gridMetrics(target) {
    const grid = target.closest(".dashboard-grid");
    const styles = getComputedStyle(grid);
    const cols = styles.gridTemplateColumns.split(" ").filter(Boolean).length || 12;
    const colGap = parseFloat(styles.columnGap) || 0;
    const rowGap = parseFloat(styles.rowGap) || 0;
    const colWidth = (grid.clientWidth - (cols - 1) * colGap) / cols;
    const rowHeight = parseFloat(styles.gridAutoRows) || 92;
    return { cols, colStep: colWidth + colGap, rowStep: rowHeight + rowGap };
  }

  function updateWidgetLayout(widget, element, layout) {
    widget.layout = {
      x: Number(layout.x),
      y: Number(layout.y),
      w: Number(layout.w),
      h: Number(layout.h)
    };
    element.style.gridColumn = `${widget.layout.x} / span ${widget.layout.w}`;
    element.style.gridRow = `${widget.layout.y} / span ${widget.layout.h}`;
    state.dirty = true;
  }

  function layoutStyle(layout = {}) {
    const x = Number(layout.x || 1);
    const y = Number(layout.y || 1);
    const w = Number(layout.w || 3);
    const h = Number(layout.h || 2);
    return `grid-column: ${x} / span ${w}; grid-row: ${y} / span ${h};`;
  }

  function updateFormValue(form, target) {
    if (!form || !target.name) return;
    form[target.name] = target.type === "checkbox" ? target.checked : target.value;
  }

  function parseJsonInput(value, label, fallback = {}) {
    const text = String(value || "").trim();
    if (!text) return fallback;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`${label} is not valid JSON: ${error.message}`);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object.`);
    }
    return parsed;
  }

  function prettyJson(value) {
    return JSON.stringify(value || {}, null, 2);
  }

  function sanitizeConfig(config) {
    return {
      version: 1,
      theme: config.theme || "dark",
      dashboards: (config.dashboards || []).map((dash) => ({
        id: dash.id,
        name: dash.name,
        description: dash.description || "",
        createdAt: dash.createdAt,
        updatedAt: dash.updatedAt
      })),
      sources: (config.sources || []).map((source) => ({
        id: source.id,
        name: source.name,
        type: source.type,
        enabled: source.enabled !== false,
        refreshSeconds: Number(source.refreshSeconds || 30),
        config: source.config || {},
        mapping: source.mapping || {},
        createdAt: source.createdAt,
        updatedAt: source.updatedAt
      })),
      widgets: (config.widgets || []).map((widget) => ({
        id: widget.id,
        dashboardId: widget.dashboardId,
        type: widget.type,
        title: widget.title,
        sourceId: widget.sourceId,
        layout: widget.layout || { x: 1, y: 1, w: 3, h: 2 },
        options: widget.options || {},
        fieldConfig: widget.fieldConfig || {},
        createdAt: widget.createdAt,
        updatedAt: widget.updatedAt
      })),
      presets: (config.presets || []).map((preset) => ({
        id: preset.id,
        name: preset.name,
        config: preset.config || {},
        createdAt: preset.createdAt,
        updatedAt: preset.updatedAt
      }))
    };
  }

  function findWidget(id) {
    return (state.config.widgets || []).find((widget) => widget.id === id);
  }

  function createWizard(source = null) {
    const config = source?.config || {};
    const mapping = source?.mapping || {};
    const fields = mapping.fields || {};
    const selectors = config.selectors || {};
    return {
      form: {
        type: source?.type || "json-rest",
        name: source?.name || "",
        enabled: source?.enabled !== false,
        url: config.url || "",
        content: config.content || "{\n  \"servers\": []\n}",
        rootPath: mapping.rootPath || "servers",
        refreshSeconds: String(source?.refreshSeconds || 30),
        fieldName: fields.name || "name",
        fieldStatus: fields.status || "status",
        fieldUptime: fields.uptime || "uptime",
        fieldPopulation: fields.population || "population",
        fieldLastRestart: fields.lastRestart || "lastRestart",
        rowSelector: config.rowSelector || "",
        nameSelector: selectors.name || "",
        statusSelector: selectors.status || "",
        uptimeSelector: selectors.uptime || "",
        populationSelector: selectors.population || "",
        messageField: config.messageField || "message",
        configJson: prettyJson(config),
        mappingJson: prettyJson(mapping)
      },
      test: null
    };
  }

  function uniqueSourceId(name) {
    let id = uniqueId("source", name);
    const used = new Set((state.config.sources || []).map((source) => source.id));
    while (used.has(id)) id = `${id}-${Math.random().toString(36).slice(2, 5)}`;
    return id;
  }

  function uniqueId(prefix, name) {
    const base = slug(name || prefix);
    return `${prefix}-${base}-${Date.now().toString(36)}`;
  }

  function slug(value) {
    return String(value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "item";
  }

  function toast(message, type = "") {
    const id = uniqueId("toast", message);
    state.toasts.push({ id, message, type });
    render();
    setTimeout(() => {
      state.toasts = state.toasts.filter((item) => item.id !== id);
      render();
    }, 3600);
  }

  function displayValue(value) {
    if (value === null || value === undefined) return "-";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function formatTime(value) {
    if (!value) return "--:--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 5);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function formatDurationHours(hours) {
    const value = Number(hours || 0);
    const days = Math.floor(value / 24);
    const remain = Math.round(value % 24);
    if (days <= 0) return `${remain}h`;
    return `${days}d ${remain}h`;
  }

  function severityClass(severity) {
    if (severity === "critical" || severity === "error") return "down";
    if (severity === "warning") return "locked";
    return "up";
  }

  function getCss(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }
})();
