/**
 * Holon simulator — runs periodic state mutations to keep the store "live."
 * Simulates real port events: gate transactions, container status progressions,
 * customs decisions, revenue collection, slot bookings, alert lifecycle.
 *
 * Runs independently of the sweep cycle so holons evolve between sweeps.
 */

import { randomUUID } from "node:crypto";
import { list, count, update, upsert, remove } from "./store.mjs";

const uid = () => randomUUID();
const HR = 3_600_000;
const MIN = 60_000;

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * One simulation tick. Called every ~10–15 seconds.
 * Each section mutates a small slice of holon state.
 */
export function simulateStep() {
  const now = Date.now();

  simulateGateEvents(now);
  progressContainerStatuses(now);
  processCustomsDecisions();
  collectRevenue(now);
  decayOldGateEvents(now);
  replenishSlotBookings(now);
  replenishHinterlandETAs(now);
  updateVesselManifests();
  manageAlerts(now);
}

// ── Gate events ───────────────────────────────────────────────────────────────

function simulateGateEvents(now) {
  const vehicles = list("VehicleHolon");
  const slots = list("SlotBookingHolon");
  const preGateContainers = list("ContainerHolon", (c) => c.Status === "pre-gate" || c.Status === "gate-in");

  const toAdd = rand(1, 3);
  for (let i = 0; i < toAdd; i++) {
    const container = pick(preGateContainers);
    const vehicle = pick(vehicles);
    if (!container || !vehicle) continue;

    const isException = Math.random() < 0.04;
    const slot = pick(slots);

    upsert("GateEventHolon", {
      Id: uid(),
      VehicleId: vehicle.Id,
      ContainerId: container.Id,
      SlotId: slot?.Id ?? null,
      Direction: "in",
      OcrReadPlate: vehicle.PlateNumber,
      PlateMatchResult: isException ? "mismatch" : "match",
      SealCheck: isException ? "fail" : "pass",
      Timestamp: new Date(now).toISOString(),
      ProcessingTimeSeconds: isException ? rand(130, 260) : rand(28, 88),
      ExceptionFlag: isException,
    });

    // Immediately update container status to gate-in
    if (container.Status === "pre-gate") {
      update("ContainerHolon", container.Id, { Status: "gate-in" });
    }
  }
}

// ── Container lifecycle progressions ─────────────────────────────────────────

function progressContainerStatuses(now) {
  // gate-in → yard (1-2 per tick)
  const gateInContainers = list("ContainerHolon", (c) => c.Status === "gate-in");
  for (const c of gateInContainers.slice(0, rand(1, 2))) {
    update("ContainerHolon", c.Id, { Status: "yard" });

    // Assign a yard position
    const blocks = list("YardBlockHolon").filter((b) => b.CurrentFill < b.Capacity);
    const block = pick(blocks);
    if (block) {
      upsert("YardPositionHolon", {
        Id: uid(),
        ContainerId: c.Id,
        BlockId: block.Id,
        Row: pick(["A", "B", "C", "D"]),
        Bay: rand(1, 10),
        Tier: rand(1, 4),
        AssignedAt: new Date(now).toISOString(),
        MovedAt: null,
        Status: "active",
      });
      update("YardBlockHolon", block.Id, {
        CurrentFill: block.CurrentFill + 1,
        FillPct: parseFloat(((block.CurrentFill + 1) / block.Capacity).toFixed(3)),
      });
    }

    // Create a PortVisit if not already existing
    const existingVisit = list("PortVisitHolon", (v) => v.ContainerId === c.Id && v.Status !== "gate-out")[0];
    if (!existingVisit) {
      const callIds = list("VesselCallHolon", (v) => v.Status === "operations" || v.Status === "berthed");
      upsert("PortVisitHolon", {
        Id: uid(),
        ContainerId: c.Id,
        CallId: pick(callIds)?.Id ?? null,
        GateInTime: new Date(now).toISOString(),
        GateOutTime: null,
        DwellHours: 0,
        Status: "in-gate",
      });
    }

    // Start handoff SLA clock
    const existingSla = list("HandoffSLAHolon", (s) => s.ContainerId === c.Id)[0];
    if (!existingSla) {
      upsert("HandoffSLAHolon", {
        Id: uid(),
        ContainerId: c.Id,
        InlandArrivalZoneAt: new Date(now - rand(20, 80) * MIN).toISOString(),
        GateProcessedAt: new Date(now).toISOString(),
        SlaTargetMinutes: 45,
        ActualMinutes: rand(22, 90),
        SlaBreached: false,
        BreachReasonCode: null,
      });
    }
  }

  // yard → loading (≤1 per tick, low probability)
  if (Math.random() < 0.25) {
    const cleared = list("ContainerHolon", (c) => c.Status === "yard");
    const activeOps = list("VesselCallHolon", (v) => v.Status === "operations");
    if (cleared.length && activeOps.length) {
      const c = pick(cleared);
      update("ContainerHolon", c.Id, { Status: "loading" });
      // Free the yard position
      const pos = list("YardPositionHolon", (p) => p.ContainerId === c.Id && p.Status === "active")[0];
      if (pos) {
        update("YardPositionHolon", pos.Id, {
          Status: "loaded",
          MovedAt: new Date(now).toISOString(),
        });
        const block = list("YardBlockHolon").find((b) => b.Id === pos.BlockId);
        if (block) {
          update("YardBlockHolon", block.Id, {
            CurrentFill: Math.max(0, block.CurrentFill - 1),
            FillPct: parseFloat((Math.max(0, block.CurrentFill - 1) / block.Capacity).toFixed(3)),
          });
        }
      }
    }
  }

  // loading → on-vessel (≤1 per tick, very low probability)
  if (Math.random() < 0.12) {
    const loading = list("ContainerHolon", (c) => c.Status === "loading");
    const c = pick(loading);
    if (c) update("ContainerHolon", c.Id, { Status: "on-vessel" });
  }

  // Update dwell hours on active visits
  const now_ = Date.now();
  for (const v of list("PortVisitHolon", (v) => v.Status === "in-yard" || v.Status === "in-gate")) {
    const dwellHours = parseFloat(
      ((now_ - new Date(v.GateInTime).getTime()) / HR).toFixed(1)
    );
    update("PortVisitHolon", v.Id, { DwellHours: dwellHours });
  }
}

// ── Customs ───────────────────────────────────────────────────────────────────

function processCustomsDecisions() {
  const pending = list("CustomsTriageHolon", (t) => t.ClearanceStatus === "pending");
  for (const t of pending.slice(0, rand(1, 3))) {
    const cleared = t.RiskLevel === "GREEN" || Math.random() < 0.55;
    update("CustomsTriageHolon", t.Id, {
      ClearanceStatus: cleared ? "cleared" : "hold",
    });
  }

  // Occasionally escalate a YELLOW to RED (rare)
  if (Math.random() < 0.04) {
    const yellows = list("CustomsTriageHolon", (t) => t.RiskLevel === "YELLOW" && t.ClearanceStatus === "hold");
    const t = pick(yellows);
    if (t) {
      update("CustomsTriageHolon", t.Id, {
        RiskLevel: "RED",
        InspectionType: "physical",
        AvgClearanceMinutes: 120,
      });
      // Update the container too
      const container = list("ContainerHolon").find((c) => c.Id === t.ContainerId);
      if (container) {
        upsert("AlertHolon", {
          Id: uid(),
          PortId: null,
          Domain: "customs",
          Severity: "ADVISORY",
          Title: "Customs escalation",
          Body: `Container ${container.IsoNumber} escalated from YELLOW → RED for physical inspection`,
          TriggeredAt: new Date().toISOString(),
          AcknowledgedAt: null,
          AcknowledgedBy: null,
          IsResolved: false,
        });
      }
    }
  }
}

// ── Revenue ───────────────────────────────────────────────────────────────────

function collectRevenue(now) {
  const outstanding = list("RevenueItemHolon", (r) => r.Status === "outstanding");
  for (const r of outstanding.slice(0, rand(0, 2))) {
    update("RevenueItemHolon", r.Id, {
      Status: "collected",
      PaidAt: new Date(now).toISOString(),
    });
  }

  // Occasionally add a new outstanding item (new charge generated)
  if (Math.random() < 0.15) {
    const types = ["port-dues", "storage", "gate-fee", "customs-fee", "overtime"];
    upsert("RevenueItemHolon", {
      Id: uid(),
      ChargeType: pick(types),
      Amount: rand(1_000_000, 4_000_000),
      Currency: "XOF",
      Status: "outstanding",
      DueAt: new Date(now + rand(2, 24) * HR).toISOString(),
      PaidAt: null,
    });
  }
}

// ── Gate event decay ──────────────────────────────────────────────────────────

function decayOldGateEvents(now) {
  // Keep only events from the last 4h to prevent unbounded growth
  const cutoff = now - 4 * HR;
  const old = list("GateEventHolon", (e) => new Date(e.Timestamp).getTime() < cutoff);
  for (const e of old) remove("GateEventHolon", e.Id);
}

// ── Slot booking replenishment ────────────────────────────────────────────────

function replenishSlotBookings(now) {
  const fourH = 4 * HR;
  const upcoming = count(
    "SlotBookingHolon",
    (s) =>
      s.SlotWindowStart &&
      new Date(s.SlotWindowStart).getTime() - now > 0 &&
      new Date(s.SlotWindowStart).getTime() - now < fourH
  );
  // Keep ~55-70 booked slots in the 4h window
  if (upcoming < 52) {
    const containers = list("ContainerHolon", (c) => c.Status === "pre-gate");
    const vehicles = list("VehicleHolon");
    const toAdd = rand(3, 7);
    for (let i = 0; i < toAdd; i++) {
      const windowStart = new Date(now + rand(5, 235) * MIN).toISOString();
      upsert("SlotBookingHolon", {
        Id: uid(),
        VehicleId: pick(vehicles)?.Id ?? uid(),
        ContainerId: pick(containers)?.Id ?? null,
        SlotWindowStart: windowStart,
        SlotWindowEnd: new Date(new Date(windowStart).getTime() + 30 * MIN).toISOString(),
        Status: "booked",
        DoConfirmed: Math.random() < 0.78,
      });
    }
  }

  // Expire old slots
  const expired = list(
    "SlotBookingHolon",
    (s) => s.SlotWindowEnd && new Date(s.SlotWindowEnd).getTime() < now - HR
  );
  for (const s of expired) remove("SlotBookingHolon", s.Id);
}

// ── Hinterland ETA replenishment ──────────────────────────────────────────────

function replenishHinterlandETAs(now) {
  const sixH = 6 * HR;
  const upcoming = count(
    "HinterlandETAHolon",
    (e) =>
      e.EstimatedArrivalAt &&
      new Date(e.EstimatedArrivalAt).getTime() > now &&
      new Date(e.EstimatedArrivalAt).getTime() - now < sixH
  );
  // Target 80-90 upcoming ETAs within 6h
  if (upcoming < 78) {
    const legs = list("InlandLegHolon");
    const toAdd = rand(3, 8);
    for (let i = 0; i < toAdd; i++) {
      const leg = pick(legs);
      if (!leg) continue;
      const isDelay = Math.random() < 0.08;
      upsert("HinterlandETAHolon", {
        Id: uid(),
        LegId: leg.Id,
        EstimatedArrivalAt: new Date(now + rand(15, 355) * MIN).toISOString(),
        ConfidenceScore: parseFloat((isDelay ? 0.42 : 0.72 + Math.random() * 0.22).toFixed(2)),
        DelayMinutes: isDelay ? rand(35, 90) : rand(-15, 10),
        DelayReason: isDelay ? pick(["traffic", "breakdown", "border", "weather"]) : "unknown",
        Source: pick(["tms", "carrier-api", "manual"]),
      });
    }
  }

  // Remove arrived ETAs
  const arrived = list(
    "HinterlandETAHolon",
    (e) => e.EstimatedArrivalAt && new Date(e.EstimatedArrivalAt).getTime() < now - 15 * MIN
  );
  for (const e of arrived) remove("HinterlandETAHolon", e.Id);
}

// ── Vessel manifest readiness walk ───────────────────────────────────────────

function updateVesselManifests() {
  const inboundCalls = list("VesselCallHolon", (c) =>
    ["scheduled", "at-anchor"].includes(c.Status)
  );
  for (const c of inboundCalls) {
    const delta = rand(-2, 3); // slight upward drift (manifest submissions come in)
    update("VesselCallHolon", c.Id, {
      ManifestReadinessPct: Math.max(0, Math.min(100, (c.ManifestReadinessPct || 68) + delta)),
    });
  }
}

// ── Alert lifecycle ───────────────────────────────────────────────────────────

function manageAlerts(now) {
  // Generate FLASH if gate throughput is very high
  const hrAgo = now - HR;
  const recentGate = count(
    "GateEventHolon",
    (e) => e.Direction === "in" && new Date(e.Timestamp).getTime() > hrAgo
  );
  if (recentGate > 58) {
    const existing = list("AlertHolon", (a) => a.Domain === "gate" && !a.IsResolved && a.Severity === "FLASH");
    if (!existing.length) {
      upsert("AlertHolon", {
        Id: uid(),
        PortId: null,
        Domain: "gate",
        Severity: "FLASH",
        Title: "Gate queue FLASH",
        Body: `Gate throughput at ${recentGate}/hr — FLASH threshold exceeded. Consider slot throttling.`,
        TriggeredAt: new Date(now).toISOString(),
        AcknowledgedAt: null,
        AcknowledgedBy: null,
        IsResolved: false,
      });
    }
  }

  // Auto-resolve stale non-FLASH alerts after 2h
  const staleAlerts = list(
    "AlertHolon",
    (a) => !a.IsResolved && a.Severity !== "FLASH" && now - new Date(a.TriggeredAt).getTime() > 2 * HR
  );
  for (const a of staleAlerts) {
    update("AlertHolon", a.Id, { IsResolved: true });
  }

  // Auto-resolve FLASH alerts when throughput drops
  if (recentGate < 50) {
    const flashAlerts = list("AlertHolon", (a) => !a.IsResolved && a.Severity === "FLASH" && a.Domain === "gate");
    for (const a of flashAlerts) {
      update("AlertHolon", a.Id, { IsResolved: true });
    }
  }
}
