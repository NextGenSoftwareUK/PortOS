import { randomUUID } from "node:crypto";
import { walkInt, walkMoney, resetState } from "../state.mjs";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Initial seed (Abidjan-shaped) */
const SEED = {
  occupied: 8,
  eta_24h: 5,
  trucks_per_hr: 42,
  queue: 14,
  exceptions: 3,
  fill_pct: 72,
  dwell_avg_hr: 36,
  green_pct: 55,
  yellow_pct: 32,
  red_pct: 13,
  clearance_avg_min: 48,
  collected_today: 125_000_000,
  outstanding: 42_000_000,
  personnel_on_site: 890,
  alerts_open: 1,
  api_latency_ms: 180,
  manifests_ready_pct: 68,
  inbound_eta_6h: 86,
  delay_risk_trucks: 7,
  rail_barge_24h: 4,
  slot_bookings_4h: 62,
  slot_adherence_pct: 78,
  pregate_docs_ready_pct: 71,
  inland_exceptions: 5,
};

let seeded = false;

function ensureSeed() {
  if (!seeded) {
    resetState(SEED);
    seeded = true;
  }
}

async function sourceBerth() {
  await delay(30 + Math.random() * 80);
  return {
    domain: "berth",
    block: {
      label: "Berth & vessel",
      kpis: [
        {
          id: "occupied",
          label: "Berths occupied",
          value: walkInt("occupied", 4, 12, 1),
          unit: "of 12",
        },
        {
          id: "eta_24h",
          label: "Vessels ETA 24h",
          value: walkInt("eta_24h", 2, 9, 1),
          unit: "vessels",
        },
      ],
    },
  };
}

async function sourceGate() {
  await delay(20 + Math.random() * 60);
  const trucks = walkInt("trucks_per_hr", 28, 55, 3);
  return {
    domain: "gate",
    block: {
      label: "Gate throughput",
      kpis: [
        {
          id: "trucks_per_hr",
          label: "Trucks / hour",
          value: trucks,
          unit: "trucks",
          trend: trucks >= 40 ? "up" : "down",
        },
        {
          id: "queue",
          label: "Avg queue",
          value: walkInt("queue", 6, 28, 2),
          unit: "trucks",
        },
        {
          id: "exceptions",
          label: "Exceptions (shift)",
          value: walkInt("exceptions", 0, 8, 1),
          unit: "events",
        },
      ],
    },
  };
}

async function sourceYard() {
  await delay(25 + Math.random() * 70);
  return {
    domain: "yard",
    block: {
      label: "Yard",
      kpis: [
        {
          id: "fill_pct",
          label: "Yard fill",
          value: walkInt("fill_pct", 55, 92, 2),
          unit: "%",
        },
        {
          id: "dwell_avg_hr",
          label: "Avg dwell",
          value: walkInt("dwell_avg_hr", 18, 52, 2),
          unit: "hours",
        },
      ],
    },
  };
}

async function sourceCustoms() {
  await delay(40 + Math.random() * 100);
  const g = walkInt("green_pct", 42, 62, 2);
  const y = Math.max(18, Math.min(42, Math.round((100 - g) * (0.28 + Math.random() * 0.12))));
  const r = 100 - g - y;
  return {
    domain: "customs",
    block: {
      label: "Customs triage",
      kpis: [
        { id: "green_pct", label: "GREEN", value: g, unit: "%" },
        { id: "yellow_pct", label: "YELLOW", value: y, unit: "%" },
        { id: "red_pct", label: "RED", value: Math.max(5, r), unit: "%" },
        {
          id: "clearance_avg_min",
          label: "Avg clearance",
          value: walkInt("clearance_avg_min", 32, 72, 3),
          unit: "min",
        },
      ],
    },
  };
}

async function sourceRevenue() {
  await delay(15 + Math.random() * 50);
  return {
    domain: "revenue",
    block: {
      label: "Revenue (digital)",
      kpis: [
        {
          id: "collected_today",
          label: "Collected today",
          value: walkMoney("collected_today", 125_000_000, 0.015),
          unit: "XOF",
        },
        {
          id: "outstanding",
          label: "Outstanding",
          value: walkMoney("outstanding", 42_000_000, 0.03),
          unit: "XOF",
        },
      ],
    },
  };
}

async function sourceSecurity() {
  await delay(20 + Math.random() * 40);
  return {
    domain: "security",
    block: {
      label: "Security / ISPS",
      kpis: [
        {
          id: "personnel_on_site",
          label: "Credentialed on site",
          value: walkInt("personnel_on_site", 720, 980, 15),
          unit: "persons",
        },
        {
          id: "alerts_open",
          label: "Open alerts",
          value: walkInt("alerts_open", 0, 4, 1),
          unit: "alerts",
        },
      ],
    },
  };
}

async function sourcePcs() {
  await delay(10 + Math.random() * 30);
  return {
    domain: "pcs",
    block: {
      label: "PCS health",
      kpis: [
        {
          id: "api_latency_ms",
          label: "PCS API p95",
          value: walkInt("api_latency_ms", 95, 320, 25),
          unit: "ms",
        },
      ],
    },
  };
}

async function sourceIntel() {
  await delay(35 + Math.random() * 90);
  return {
    domain: "intel",
    block: {
      label: "ACI / pre-arrival",
      kpis: [
        {
          id: "manifests_ready_pct",
          label: "Manifests ready pre-arrival",
          value: walkInt("manifests_ready_pct", 52, 88, 3),
          unit: "%",
        },
      ],
    },
  };
}

/** Supply chain: inbound hinterland → port (mock TMS / carrier aggregation) */
async function sourceHinterland() {
  await delay(25 + Math.random() * 75);
  return {
    domain: "hinterland",
    block: {
      label: "Hinterland inbound",
      kpis: [
        {
          id: "inbound_eta_6h",
          label: "Trucks ETA ≤6h",
          value: walkInt("inbound_eta_6h", 48, 120, 8),
          unit: "vehicles",
        },
        {
          id: "delay_risk_trucks",
          label: "At delay risk (>30m)",
          value: walkInt("delay_risk_trucks", 2, 22, 3),
          unit: "vehicles",
        },
        {
          id: "rail_barge_24h",
          label: "Rail / barge arrivals 24h",
          value: walkInt("rail_barge_24h", 1, 12, 2),
          unit: "consignments",
        },
      ],
    },
  };
}

/** Pre-gate: slots, docs, exceptions before gate processing */
async function sourcePreGate() {
  await delay(30 + Math.random() * 65);
  return {
    domain: "pre_gate",
    block: {
      label: "Pre-gate & slots",
      kpis: [
        {
          id: "slot_bookings_4h",
          label: "Booked slots (next 4h)",
          value: walkInt("slot_bookings_4h", 35, 85, 6),
          unit: "slots",
        },
        {
          id: "slot_adherence_pct",
          label: "On-time vs slot",
          value: walkInt("slot_adherence_pct", 62, 94, 4),
          unit: "%",
        },
        {
          id: "pregate_docs_ready_pct",
          label: "Docs complete pre-arrival",
          value: walkInt("pregate_docs_ready_pct", 55, 92, 4),
          unit: "%",
        },
        {
          id: "inland_exceptions",
          label: "Open inland exceptions",
          value: walkInt("inland_exceptions", 0, 14, 2),
          unit: "cases",
        },
      ],
    },
  };
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

export async function runSweepParallel(site = "abidjan") {
  ensureSeed();

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

  const alerts = [];
  const q = domains.gate?.kpis?.find((k) => k.id === "queue");
  if (q && q.value > 20) {
    alerts.push({
      tier: "PRIORITY",
      message: `Gate queue elevated (${q.value} trucks avg)`,
      domain: "gate",
    });
  }
  const manifest = domains.intel?.kpis?.find((k) => k.id === "manifests_ready_pct");
  if (manifest && manifest.value < 60) {
    alerts.push({
      tier: "ROUTINE",
      message: `Pre-arrival manifest readiness below target (${manifest.value}%)`,
      domain: "intel",
    });
  }
  const inbound = domains.hinterland?.kpis?.find((k) => k.id === "inbound_eta_6h");
  const risk = domains.hinterland?.kpis?.find((k) => k.id === "delay_risk_trucks");
  if (inbound && q && inbound.value > 95 && q.value > 16) {
    alerts.push({
      tier: "PRIORITY",
      message: `High inbound volume (${inbound.value} ETA 6h) vs gate queue (${q.value}) — consider slot throttling`,
      domain: "hinterland",
    });
  }
  if (risk && risk.value > 15) {
    alerts.push({
      tier: "ROUTINE",
      message: `${risk.value} hinterland vehicles at delay risk — gate ETA drift likely`,
      domain: "hinterland",
    });
  }
  const adhere = domains.pre_gate?.kpis?.find((k) => k.id === "slot_adherence_pct");
  if (adhere && adhere.value < 68) {
    alerts.push({
      tier: "ROUTINE",
      message: `Slot adherence soft (${adhere.value}%) — pre-gate congestion risk`,
      domain: "pre_gate",
    });
  }
  if (alerts.length === 0 && Math.random() > 0.7) {
    alerts.push({
      tier: "ROUTINE",
      message: "All domains within nominal thresholds",
      domain: "intel",
    });
  }

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

export function resetMockTelemetry() {
  seeded = false;
  resetState({});
}
