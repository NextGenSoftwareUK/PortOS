/**
 * Sweep sources — holon-backed parallel fetch.
 * Same async parallel pattern as before; each source function reads
 * from the in-memory holon store instead of random walks.
 * This is the "v1.5 read path" from PORT_OS_DASHBOARD_SPEC.md:
 *   Mock holons → same path as real OASIS Data API calls will use.
 */

import { randomUUID } from "node:crypto";
import {
  kpisBerth,
  kpisGate,
  kpisYard,
  kpisCustoms,
  kpisRevenue,
  kpisSecurity,
  kpisPcs,
  kpisIntel,
  kpisHinterland,
  kpisPreGate,
} from "../holons/queries.mjs";
import { list } from "../holons/store.mjs";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Each source simulates the latency of calling a real upstream system.
// When real connectors exist (PCS_BASE_URL etc.), replace the holon query
// with an HTTP fetch and map the response to the same { label, kpis } shape.

async function sourceBerth() {
  await delay(30 + Math.random() * 80);   // simulates TOS / PCS REST call
  return { domain: "berth", block: kpisBerth() };
}

async function sourceGate() {
  await delay(20 + Math.random() * 60);   // simulates OCR gate system call
  return { domain: "gate", block: kpisGate() };
}

async function sourceYard() {
  await delay(25 + Math.random() * 70);   // simulates TOS call
  return { domain: "yard", block: kpisYard() };
}

async function sourceCustoms() {
  await delay(40 + Math.random() * 100);  // simulates AI customs API
  return { domain: "customs", block: kpisCustoms() };
}

async function sourceRevenue() {
  await delay(15 + Math.random() * 50);   // simulates payments/PingPay API
  return { domain: "revenue", block: kpisRevenue() };
}

async function sourceSecurity() {
  await delay(20 + Math.random() * 40);   // simulates ISPS security system
  return { domain: "security", block: kpisSecurity() };
}

async function sourcePcs() {
  await delay(10 + Math.random() * 30);   // simulates PCS health check
  return { domain: "pcs", block: kpisPcs() };
}

async function sourceIntel() {
  await delay(35 + Math.random() * 90);   // simulates ACI / manifest aggregation
  return { domain: "intel", block: kpisIntel() };
}

async function sourceHinterland() {
  await delay(25 + Math.random() * 75);   // simulates TMS / carrier API
  return { domain: "hinterland", block: kpisHinterland() };
}

async function sourcePreGate() {
  await delay(30 + Math.random() * 65);   // simulates pre-gate booking system
  return { domain: "pre_gate", block: kpisPreGate() };
}

const SOURCES = [
  sourceBerth,
  sourceHinterland,
  sourcePreGate,
  sourceGate,
  sourceYard,
  sourceCustoms,
  sourceRevenue,
  sourceSecurity,
  sourcePcs,
  sourceIntel,
];

/** Pull AlertHolons from the store and map to the alert feed format. */
function buildAlerts(domains) {
  const alerts = [];

  // Derive threshold-based alerts from KPIs (same logic as before)
  const q = domains.gate?.kpis?.find((k) => k.id === "queue");
  if (q && q.value > 20) {
    alerts.push({ tier: "PRIORITY", message: `Gate queue elevated (${q.value} trucks avg)`, domain: "gate" });
  }

  const manifest = domains.intel?.kpis?.find((k) => k.id === "manifests_ready_pct");
  if (manifest && manifest.value < 60) {
    alerts.push({ tier: "ROUTINE", message: `Pre-arrival manifest readiness below target (${manifest.value}%)`, domain: "intel" });
  }

  const inbound = domains.hinterland?.kpis?.find((k) => k.id === "inbound_eta_6h");
  if (inbound && q && inbound.value > 95 && q.value > 16) {
    alerts.push({
      tier: "PRIORITY",
      message: `High inbound volume (${inbound.value} ETA 6h) vs gate queue (${q.value}) — consider slot throttling`,
      domain: "hinterland",
    });
  }

  const adhere = domains.pre_gate?.kpis?.find((k) => k.id === "slot_adherence_pct");
  if (adhere && adhere.value < 68) {
    alerts.push({ tier: "ROUTINE", message: `Slot adherence soft (${adhere.value}%) — pre-gate congestion risk`, domain: "pre_gate" });
  }

  // Pull live AlertHolons from the store
  const holonAlerts = list("AlertHolon", (a) => !a.IsResolved);
  for (const a of holonAlerts) {
    const dup = alerts.find((al) => al.domain === a.Domain && al.tier === a.Severity);
    if (!dup) {
      alerts.push({ tier: a.Severity, message: a.Body || a.Title, domain: a.Domain, holonId: a.Id });
    }
  }

  if (!alerts.length && Math.random() > 0.65) {
    alerts.push({ tier: "ROUTINE", message: "All domains within nominal thresholds", domain: "intel" });
  }

  return alerts;
}

/**
 * Run all sources in parallel. Failure-isolated: a source error
 * doesn't abort the sweep. Returns the full dashboard payload.
 */
export async function runSweepParallel(site = "abidjan") {
  const settled = await Promise.allSettled(SOURCES.map((fn) => fn()));

  const domains = {};
  let ok = 0;
  let failed = 0;

  for (const s of settled) {
    if (s.status === "fulfilled") {
      ok++;
      const { domain, block } = s.value;
      domains[domain] = block;
    } else {
      failed++;
      console.error("[sweep] source failed", s.reason);
    }
  }

  const alerts = buildAlerts(domains);

  return {
    meta: {
      sweepId: randomUUID(),
      site,
      generatedAt: new Date().toISOString(),
      sourcesOk: ok,
      sourcesFailed: failed,
    },
    domains,
    alerts,
  };
}

/** No-op — state now lives in the holon store, not random walk state. */
export function resetMockTelemetry() {}
