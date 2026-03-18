import express from "express";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { computeDelta } from "./lib/delta.mjs";
import { filterPayload, ROLE_DOMAINS } from "./lib/roles.mjs";
import { runSweepParallel } from "./lib/sources/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3120);
const SITE = process.env.PORT_SITE || "abidjan";
const REFRESH_SEC = Math.max(15, Number(process.env.REFRESH_INTERVAL_SEC || 60));

let lastPayload = null;
let previousPayload = null;
let sweepRunning = false;

/** @type {Set<(chunk: string) => void>} */
const sseClients = new Set();

function broadcastSse(event, data) {
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const write of sseClients) {
    try {
      write(line);
    } catch {
      sseClients.delete(write);
    }
  }
}

async function persistRun(payload) {
  const dir = join(__dirname, "runs");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "latest.json"), JSON.stringify(payload, null, 2), "utf8");
}

async function doSweep() {
  if (sweepRunning) return;
  sweepRunning = true;
  try {
    previousPayload = lastPayload;
    const raw = await runSweepParallel(SITE);
    const delta = computeDelta(previousPayload, raw);
    lastPayload = { ...raw, delta };
    await persistRun(lastPayload);
    broadcastSse("sweep", {
      meta: lastPayload.meta,
      deltaSummary: lastPayload.delta.summary,
      changeCount: lastPayload.delta.changes.length,
    });
  } catch (e) {
    console.error("[sweep]", e);
    broadcastSse("error", { message: String(e.message || e) });
  } finally {
    sweepRunning = false;
  }
}

function getData(role) {
  if (!lastPayload) return null;
  const base = {
    ...lastPayload,
    delta: lastPayload.delta,
  };
  if (!role || role === "authority") return base;
  return filterPayload(base, role);
}

const app = express();
app.use(express.static(join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "lfg-port-dashboard",
    site: SITE,
    refreshSec: REFRESH_SEC,
    lastSweep: lastPayload?.meta?.generatedAt ?? null,
    sseClients: sseClients.size,
  });
});

app.get("/api/roles", (_req, res) => {
  res.json({ roles: Object.keys(ROLE_DOMAINS), domainsByRole: ROLE_DOMAINS });
});

app.get("/api/data", (req, res) => {
  const role = String(req.query.role || "authority");
  const data = getData(role);
  if (!data) return res.status(503).json({ error: "Sweep not ready yet" });
  res.json(data);
});

app.get("/api/delta", (_req, res) => {
  if (!lastPayload?.delta) return res.status(503).json({ error: "No delta yet" });
  res.json(lastPayload.delta);
});

app.get("/export/brief.json", (req, res) => {
  const role = String(req.query.role || "authority");
  const data = getData(role);
  if (!data) return res.status(503).json({ error: "Sweep not ready" });
  res.setHeader("Content-Disposition", 'attachment; filename="port-brief.json"');
  res.json({
    exportedAt: new Date().toISOString(),
    site: data.meta.site,
    meta: data.meta,
    delta: data.delta,
    domains: data.domains,
    alerts: data.alerts,
  });
});

app.get("/export/brief.html", async (req, res) => {
  const role = String(req.query.role || "authority");
  const data = getData(role);
  if (!data) return res.status(503).send("Sweep not ready — wait a few seconds and refresh.");
  const fmt = (n) =>
    typeof n === "number" && n > 1_000_000
      ? new Intl.NumberFormat("fr-CI").format(n) + " XOF"
      : String(n);
  const rows = [];
  for (const [key, block] of Object.entries(data.domains)) {
    for (const k of block.kpis || []) {
      rows.push(
        `<tr><td>${key}</td><td>${k.label}</td><td>${fmt(k.value)} ${k.unit || ""}</td></tr>`,
      );
    }
  }
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Port brief — ${data.meta.site} — ${data.meta.generatedAt}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.25rem; }
    table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
    th, td { border: 1px solid #ccc; padding: 0.5rem 0.75rem; text-align: left; }
    th { background: #f4f4f4; }
    .delta { background: #fff8e6; padding: 1rem; margin-top: 1rem; }
  </style>
</head>
<body>
  <h1>LFG Port intelligence brief</h1>
  <p><strong>Site:</strong> ${data.meta.site} &nbsp;|&nbsp; <strong>Sweep:</strong> ${data.meta.generatedAt} &nbsp;|&nbsp; <strong>Role:</strong> ${role}</p>
  <p>Sources OK: ${data.meta.sourcesOk} / failed: ${data.meta.sourcesFailed}</p>
  <div class="delta"><strong>Delta:</strong> ${data.delta.summary}<ul>${data.delta.changes.slice(0, 20).map((c) => `<li>${c.label}: ${c.from} → ${c.to} ${c.unit}</li>`).join("")}</ul></div>
  <table><thead><tr><th>Domain</th><th>KPI</th><th>Value</th></tr></thead><tbody>${rows.join("")}</tbody></table>
  <p style="margin-top:2rem;color:#666;font-size:0.85rem;">MVP mock telemetry — not operational data.</p>
</body>
</html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const write = (chunk) => {
    res.write(chunk);
  };
  sseClients.add(write);
  write(`event: connected\ndata: ${JSON.stringify({ refreshSec: REFRESH_SEC })}\n\n`);
  if (lastPayload) {
    write(
      `event: snapshot\ndata: ${JSON.stringify({ meta: lastPayload.meta, hasDelta: !!lastPayload.delta?.changes?.length })}\n\n`,
    );
  }

  req.on("close", () => {
    sseClients.delete(write);
  });
});

app.post("/api/sweep", async (_req, res) => {
  await doSweep();
  res.json({ ok: true, meta: lastPayload?.meta });
});

const server = app.listen(PORT, async () => {
  console.log(`
  LFG Port OS dashboard (MVP)
  http://localhost:${PORT}
  Health: http://localhost:${PORT}/api/health
  Brief:  http://localhost:${PORT}/export/brief.html
  Site: ${SITE}  |  Refresh: ${REFRESH_SEC}s
  `);
  await doSweep();
  setInterval(doSweep, REFRESH_SEC * 1000);
});

server.on("error", (e) => {
  console.error(e);
  process.exit(1);
});
