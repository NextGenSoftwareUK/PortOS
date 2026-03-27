import express from "express";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { computeDelta } from "./lib/delta.mjs";
import { filterPayload, ROLE_DOMAINS } from "./lib/roles.mjs";
import { runSweepParallel } from "./lib/sources/index.mjs";

import { seedAll } from "./lib/holons/seed.mjs";
import { simulateStep } from "./lib/holons/simulator.mjs";
import { stats, list, get, update, upsert, typeCount, totalCount } from "./lib/holons/store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3120);
const SITE = process.env.PORT_SITE || "abidjan";
const REFRESH_SEC = Math.max(15, Number(process.env.REFRESH_INTERVAL_SEC || 60));
const SIM_INTERVAL_SEC = Math.max(10, Number(process.env.SIM_INTERVAL_SEC || 12));

let lastPayload = null;
let previousPayload = null;
let sweepRunning = false;
let holonsSeeded = false;

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

function initHolons() {
  if (holonsSeeded) return;
  seedAll(SITE);
  holonsSeeded = true;
  console.log("[holons] seeded", stats());
  setInterval(() => {
    try {
      simulateStep();
    } catch (e) {
      console.error("[simulator]", e);
    }
  }, SIM_INTERVAL_SEC * 1000);
}

async function doSweep() {
  if (sweepRunning) return;
  sweepRunning = true;
  try {
    previousPayload = lastPayload;
    const raw = await runSweepParallel(SITE);

    // Record sweep in holon store
    upsert("SweepSnapshotHolon", {
      Id: raw.meta.sweepId,
      PortId: null,
      SweepStartedAt: raw.meta.generatedAt,
      SweepCompletedMs: Math.round(Math.random() * 80 + 140),
      SourceHealthJson: JSON.stringify({ ok: raw.meta.sourcesOk, failed: raw.meta.sourcesFailed }),
      CanonicalPayloadHash: raw.meta.sweepId.replace(/-/g, ""),
      AlertCount: raw.alerts.length,
      DeltaVsPrevious: previousPayload ? "computed" : "initial",
    });

    const delta = computeDelta(previousPayload, raw);
    lastPayload = { ...raw, delta };
    await persistRun(lastPayload);
    broadcastSse("sweep", {
      meta: lastPayload.meta,
      deltaSummary: lastPayload.delta.summary,
      changeCount: lastPayload.delta.changes.length,
      holonCount: totalCount(),
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
  const base = { ...lastPayload, delta: lastPayload.delta };
  if (!role || role === "authority") return base;
  return filterPayload(base, role);
}

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// ── Standard dashboard endpoints ──────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "lfg-port-dashboard",
    site: SITE,
    refreshSec: REFRESH_SEC,
    simIntervalSec: SIM_INTERVAL_SEC,
    lastSweep: lastPayload?.meta?.generatedAt ?? null,
    sseClients: sseClients.size,
    holons: stats(),
    holonTotal: totalCount(),
  });
});

app.get("/api/roles", (_req, res) => {
  res.json({ roles: Object.keys(ROLE_DOMAINS), domainsByRole: ROLE_DOMAINS });
});

app.get("/api/data", (req, res) => {
  const role = String(req.query.role || "authority");
  const data = getData(role);
  if (!data) return res.status(503).json({ error: "Sweep not ready yet" });
  res.json({ ...data, holonTotal: totalCount() });
});

app.get("/api/delta", (_req, res) => {
  if (!lastPayload?.delta) return res.status(503).json({ error: "No delta yet" });
  res.json(lastPayload.delta);
});

// ── Holon API ─────────────────────────────────────────────────────────────────

/** GET /api/holons → { type: count } for all seeded types */
app.get("/api/holons", (_req, res) => {
  res.json({ total: totalCount(), byType: stats() });
});

/** GET /api/holons/container-lifecycle/:iso → full FK chain for a container */
app.get("/api/holons/container-lifecycle/:iso", (req, res) => {
  const iso = req.params.iso.toUpperCase();
  const container = list("ContainerHolon", (c) => c.IsoNumber === iso)[0];
  if (!container) return res.status(404).json({ error: "Container not found", iso });

  const consignment = container.ConsignmentId ? get("ConsignmentHolon", container.ConsignmentId) : null;
  const shipment = consignment?.ShipmentId ? get("ShipmentHolon", consignment.ShipmentId) : null;
  const inlandLegs = list("InlandLegHolon", (l) => l.ContainerId === container.Id);
  const hinterlandEtas = inlandLegs.flatMap((l) =>
    list("HinterlandETAHolon", (e) => e.LegId === l.Id)
  );
  const slotBookings = list("SlotBookingHolon", (s) => s.ContainerId === container.Id);
  const gateEvents = list("GateEventHolon", (e) => e.ContainerId === container.Id)
    .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    .slice(0, 10);
  const yardPositions = list("YardPositionHolon", (p) => p.ContainerId === container.Id);
  const customsTriage = list("CustomsTriageHolon", (t) => t.ContainerId === container.Id)[0] ?? null;
  const tradeDocuments = list("TradeDocumentHolon", (d) => d.ContainerId === container.Id);
  const portVisit = list("PortVisitHolon", (v) => v.ContainerId === container.Id)
    .sort((a, b) => new Date(b.GateInTime) - new Date(a.GateInTime))[0] ?? null;
  const handoffSla = list("HandoffSLAHolon", (s) => s.ContainerId === container.Id)[0] ?? null;

  res.json({
    container,
    consignment,
    shipment,
    inlandLegs,
    hinterlandEtas: hinterlandEtas.slice(0, 5),
    slotBookings,
    gateEvents,
    yardPositions,
    customsTriage,
    tradeDocuments,
    portVisit,
    handoffSla,
  });
});

/** GET /api/holons/:type → list of holons (paged) */
app.get("/api/holons/:type", (req, res) => {
  const { type } = req.params;
  const limit = Math.min(200, Number(req.query.limit || 100));
  const offset = Number(req.query.offset || 0);
  const items = list(type);
  res.json({ type, total: items.length, items: items.slice(offset, offset + limit) });
});

/** GET /api/holons/:type/:id → single holon */
app.get("/api/holons/:type/:id", (req, res) => {
  const { type, id } = req.params;
  const holon = get(type, id);
  if (!holon) return res.status(404).json({ error: "Not found", type, id });
  res.json(holon);
});

/** PATCH /api/holons/:type/:id → update holon fields */
app.patch("/api/holons/:type/:id", (req, res) => {
  const { type, id } = req.params;
  const updated = update(type, id, req.body);
  if (!updated) return res.status(404).json({ error: "Not found", type, id });
  res.json(updated);
});

/** POST /api/events/simulate → inject a named demo event */
app.post("/api/events/simulate", (req, res) => {
  const { event } = req.body;
  const now = new Date().toISOString();
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);

  switch (event) {
    case "gate_rush": {
      // Add 20 gate events in rapid succession
      const containers = list("ContainerHolon", (c) => c.Status === "pre-gate" || c.Status === "gate-in");
      const vehicles = list("VehicleHolon");
      for (let i = 0; i < 20; i++) {
        const c = containers[i % containers.length];
        const v = vehicles[i % vehicles.length];
        if (!c || !v) continue;
        upsert("GateEventHolon", {
          Id: uid(),
          VehicleId: v.Id,
          ContainerId: c.Id,
          SlotId: null,
          Direction: "in",
          OcrReadPlate: v.PlateNumber,
          PlateMatchResult: "match",
          SealCheck: "pass",
          Timestamp: new Date(Date.now() - i * 12_000).toISOString(),
          ProcessingTimeSeconds: 35 + Math.floor(Math.random() * 25),
          ExceptionFlag: false,
        });
      }
      res.json({ ok: true, event, added: 20, message: "20 gate events injected — throughput spiked" });
      break;
    }
    case "customs_flash": {
      // Escalate 5 containers to RED and create FLASH alert
      const yellows = list("CustomsTriageHolon", (t) => t.RiskLevel === "YELLOW").slice(0, 5);
      for (const t of yellows) {
        update("CustomsTriageHolon", t.Id, {
          RiskLevel: "RED",
          ClearanceStatus: "inspection-required",
          InspectionType: "physical",
          AvgClearanceMinutes: 140,
        });
      }
      upsert("AlertHolon", {
        Id: uid(),
        PortId: null,
        Domain: "customs",
        Severity: "FLASH",
        Title: "Customs FLASH — mass escalation",
        Body: `${yellows.length} containers escalated to RED for physical inspection. Port Authority notified.`,
        TriggeredAt: now,
        AcknowledgedAt: null,
        AcknowledgedBy: null,
        IsResolved: false,
      });
      res.json({ ok: true, event, escalated: yellows.length, message: "FLASH alert generated" });
      break;
    }
    case "vessel_arrival": {
      // Change a scheduled call to berthed
      const scheduled = list("VesselCallHolon", (c) => c.Status === "scheduled" || c.Status === "at-anchor");
      const freeBerths = list("BerthHolon", (b) => b.Status === "free");
      const call = scheduled[0];
      const berth = freeBerths[0];
      if (call && berth) {
        update("VesselCallHolon", call.Id, { Status: "berthed", Ata: now, BerthId: berth.Id });
        update("BerthHolon", berth.Id, { Status: "occupied" });
        upsert("AlertHolon", {
          Id: uid(),
          PortId: null,
          Domain: "berth",
          Severity: "ROUTINE",
          Title: "Vessel berthed",
          Body: `Vessel on call ${call.VoyageNumber} has berthed at ${berth.BerthNumber}`,
          TriggeredAt: now,
          AcknowledgedAt: null,
          AcknowledgedBy: null,
          IsResolved: false,
        });
        res.json({ ok: true, event, call: call.VoyageNumber, berth: berth.BerthNumber });
      } else {
        res.json({ ok: false, event, message: "No scheduled calls or free berths available" });
      }
      break;
    }
    default:
      res.status(400).json({ error: `Unknown event: ${event}`, available: ["gate_rush", "customs_flash", "vessel_arrival"] });
  }
});

// ── Export endpoints ──────────────────────────────────────────────────────────

app.get("/export/brief.json", (req, res) => {
  const role = String(req.query.role || "authority");
  const data = getData(role);
  if (!data) return res.status(503).json({ error: "Sweep not ready" });
  res.setHeader("Content-Disposition", 'attachment; filename="port-brief.json"');
  res.json({ exportedAt: new Date().toISOString(), site: data.meta.site, meta: data.meta, delta: data.delta, domains: data.domains, alerts: data.alerts });
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
      rows.push(`<tr><td>${key}</td><td>${k.label}</td><td>${fmt(k.value)} ${k.unit || ""}</td></tr>`);
    }
  }
  const holonSummary = Object.entries(stats()).map(([t, n]) => `<li>${t}: <strong>${n}</strong></li>`).join("");
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
    .holons { background: #f0fff4; padding: 1rem; margin-top: 1rem; }
    ul { margin: 0.5rem 0 0; padding-left: 1.5rem; columns: 3; }
  </style>
</head>
<body>
  <h1>LFG Port intelligence brief</h1>
  <p><strong>Site:</strong> ${data.meta.site} &nbsp;|&nbsp; <strong>Sweep:</strong> ${data.meta.generatedAt} &nbsp;|&nbsp; <strong>Role:</strong> ${role}</p>
  <p>Sources OK: ${data.meta.sourcesOk} / failed: ${data.meta.sourcesFailed} &nbsp;|&nbsp; Holons tracked: <strong>${totalCount()}</strong></p>
  <div class="delta"><strong>Delta:</strong> ${data.delta.summary}<ul>${data.delta.changes.slice(0, 20).map((c) => `<li>${c.label}: ${c.from} → ${c.to} ${c.unit}</li>`).join("")}</ul></div>
  <table><thead><tr><th>Domain</th><th>KPI</th><th>Value</th></tr></thead><tbody>${rows.join("")}</tbody></table>
  <div class="holons"><strong>Holon store:</strong> ${totalCount()} holons across ${Object.keys(stats()).length} types<ul>${holonSummary}</ul></div>
  <p style="margin-top:2rem;color:#666;font-size:0.85rem;">PortOSTemplate holons · MVP · not operational data.</p>
</body>
</html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// ── SSE ───────────────────────────────────────────────────────────────────────

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const write = (chunk) => res.write(chunk);
  sseClients.add(write);
  write(`event: connected\ndata: ${JSON.stringify({ refreshSec: REFRESH_SEC, holonTotal: totalCount() })}\n\n`);
  if (lastPayload) {
    write(`event: snapshot\ndata: ${JSON.stringify({ meta: lastPayload.meta, hasDelta: !!lastPayload.delta?.changes?.length })}\n\n`);
  }
  req.on("close", () => sseClients.delete(write));
});

app.post("/api/sweep", async (_req, res) => {
  await doSweep();
  res.json({ ok: true, meta: lastPayload?.meta, holonTotal: totalCount() });
});

// ── Boot ──────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, async () => {
  console.log(`
  LFG Port OS dashboard (PortOSTemplate holons)
  http://localhost:${PORT}
  Health:  http://localhost:${PORT}/api/health
  Holons:  http://localhost:${PORT}/api/holons
  Brief:   http://localhost:${PORT}/export/brief.html
  Site: ${SITE}  |  Refresh: ${REFRESH_SEC}s  |  Sim: ${SIM_INTERVAL_SEC}s
  `);
  initHolons();
  await doSweep();
  setInterval(doSweep, REFRESH_SEC * 1000);
});

server.on("error", (e) => {
  console.error(e);
  process.exit(1);
});
