/**
 * Seed generator for PortOSTemplate holons.
 * Produces a realistic Abidjan PAA snapshot with all 24 holon types.
 * KPI targets (matching original mock seeds):
 *   berth: 8/12 occupied, 5 vessels ETA <24h
 *   gate: 42 trucks/hr, queue 14, 3 exceptions
 *   yard: 72% fill, 36h avg dwell
 *   customs: 55% GREEN, 32% YELLOW, 13% RED, 48min avg clearance
 *   revenue: 125M XOF collected, 42M outstanding
 *   security: 1 open alert
 *   intel: 68% manifests ready
 *   hinterland: 86 inbound ETA ≤6h, 7 delay risk, 4 rail/barge 24h
 *   pre_gate: 62 slots (4h), 78% adherence, 71% docs ready, 5 exceptions
 */

import { randomUUID } from "node:crypto";
import { upsert } from "./store.mjs";

const uid = () => randomUUID();
const HR = 3_600_000;
const MIN = 60_000;
const now = () => Date.now();
const addMs = (ms) => new Date(now() + ms).toISOString();
const subMs = (ms) => new Date(now() - ms).toISOString();

/**
 * Seed all holons. Returns a map of key IDs for cross-referencing.
 * @param {string} site
 */
export function seedAll(site = "abidjan") {
  // ── Zome 1: Port infrastructure ──────────────────────────────────

  const portId = uid();
  upsert("PortHolon", {
    Id: portId,
    PortCode: "ABIDJ",
    Site: site,
    CountryCode: "CI",
    Timezone: "Africa/Abidjan",
    OperatorAvatarId: uid(),
    IsActive: true,
  });

  const termIds = [uid(), uid()];
  const terminals = [
    { Id: termIds[0], PortId: portId, Name: "Container Terminal PAA", TerminalType: "container", OperatorName: "PAA-CT", IsActive: true },
    { Id: termIds[1], PortId: portId, Name: "Bulk Terminal PAA", TerminalType: "bulk", OperatorName: "PAA-BT", IsActive: true },
  ];
  for (const t of terminals) upsert("TerminalHolon", t);

  // 12 berths: 8 occupied, 2 free, 1 reserved, 1 maintenance
  const berthStatuses = [
    "occupied","occupied","occupied","occupied",
    "occupied","occupied","occupied","occupied",
    "free","free","reserved","maintenance",
  ];
  const berthIds = berthStatuses.map((status, i) => {
    const id = uid();
    upsert("BerthHolon", {
      Id: id,
      TerminalId: termIds[i < 10 ? 0 : 1],
      BerthNumber: `B${String(i + 1).padStart(2, "0")}`,
      MaxDraftM: 11 + (i % 5),
      MaxLoaM: 260 + (i % 7) * 25,
      Status: status,
    });
    return id;
  });

  // 8 yard blocks → total cap 2400 TEU, fill 72% ≈ 1728 TEU
  const blockDefs = [
    { name: "A1", zone: "import",    cap: 400, fill: 298 },
    { name: "A2", zone: "import",    cap: 400, fill: 312 },
    { name: "B1", zone: "export",    cap: 300, fill: 198 },
    { name: "B2", zone: "export",    cap: 300, fill: 221 },
    { name: "RF", zone: "reefer",    cap: 200, fill: 144 },
    { name: "HZ", zone: "hazmat",    cap: 100, fill:  62 },
    { name: "EM", zone: "empty",     cap: 400, fill: 280 },
    { name: "TS", zone: "transship", cap: 300, fill: 213 },
  ];
  const blockIds = blockDefs.map((b) => {
    const id = uid();
    upsert("YardBlockHolon", {
      Id: id,
      TerminalId: termIds[0],
      BlockName: b.name,
      Zone: b.zone,
      Capacity: b.cap,
      CurrentFill: b.fill,
      FillPct: parseFloat((b.fill / b.cap).toFixed(3)),
    });
    return id;
  });

  // ── Zome 2: Vessels ───────────────────────────────────────────────

  const vesselNames = [
    "MSC ADELE", "CMA CGM ABIDJAN", "HAPAG IVORY COAST",
    "COSCO WEST AFRICA", "EVERGREEN AFRIQUE", "MAERSK FREETOWN",
    "PIL ABIDJAN", "GRIMALDI AFRICA",
  ];
  const vesselOps = ["MSC","CMA CGM","Hapag-Lloyd","COSCO","Evergreen","Maersk","PIL","Grimaldi"];
  const vesselIds = vesselNames.map((name, i) => {
    const id = uid();
    upsert("VesselHolon", {
      Id: id,
      ImoNumber: `IMO${9000001 + i}`,
      VesselName: name,
      Flag: ["LR","FR","DE","CN","TW","DK","SG","IT"][i],
      Operator: vesselOps[i],
      VesselType: "container",
      GrossTonnage: 44_000 + i * 3_500,
      Teu: 2_800 + i * 450,
    });
    return id;
  });

  // 8 vessel calls: 5 operations/berthed, 1 at-anchor, 2 scheduled
  // ManifestReadinessPct target: avg ≈ 68% across scheduled/at-anchor calls
  const callStatuses = ["operations","operations","operations","berthed","berthed","at-anchor","scheduled","scheduled"];
  const manifestPcts = [88, 92, 85, 80, 79, 72, 64, 60]; // avg of last 3 = 65→68 close
  const callIds = callStatuses.map((status, i) => {
    const id = uid();
    upsert("VesselCallHolon", {
      Id: id,
      VesselId: vesselIds[i],
      BerthId: i < 5 ? berthIds[i] : null,
      PortId: portId,
      VoyageNumber: `V202600${i + 1}`,
      Eta: i >= 6 ? addMs((i - 5) * 9 * HR) : subMs(3 * HR),
      Ata: i < 5 ? subMs((10 + i * 5) * HR) : null,
      Etd: addMs((20 + i * 6) * HR),
      Atd: null,
      Status: status,
      ManifestReadinessPct: manifestPcts[i],
      ImportTeu: 380 + i * 90,
      ExportTeu: 180 + i * 55,
    });
    return id;
  });

  // ── Zome 6: Hinterland (carriers, warehouses, legs, ETAs) ─────────

  const carrierNames = [
    "TransIvoire", "Gulf Transport", "Barge Côtière CI", "SITARAIL Express",
    "Hinterland Trucks SA", "West Coast Freight", "Agence Maritime CI",
    "LFG Logistics", "Côte Cargo", "Savane Transport", "Tropical Freight", "Abidjan Lines",
  ];
  const carrierModes = ["road","road","sea","rail","road","road","multimodal","road","road","road","road","multimodal"];
  const carrierIds = carrierNames.map((name, i) => {
    const id = uid();
    upsert("CarrierHolon", {
      Id: id,
      Name: name,
      Mode: carrierModes[i],
      FleetSize: 18 + i * 6,
      KpiOnTimeRatePct: 70 + (i % 6) * 4,
    });
    return id;
  });

  const warehouseCities = ["Yamoussoukro","Bouaké","Man","Korhogo","Divo","Daloa","Abengourou","Gagnoa"];
  const warehouseIds = warehouseCities.map((city, i) => {
    const id = uid();
    upsert("WarehouseHolon", {
      Id: id,
      Name: `Entrepôt ${city}`,
      Address: `Zone Industrielle, ${city}, CI`,
      Latitude: 5.8 + i * 0.35,
      Longitude: -6.2 + i * 0.28,
      ContainerCapacity: 400 + i * 80,
      CurrentOccupancy: 180 + i * 35,
    });
    return id;
  });

  // ── Zome 3: Shipments ─────────────────────────────────────────────

  const shipmentIds = Array.from({ length: 25 }, (_, i) => {
    const id = uid();
    upsert("ShipmentHolon", {
      Id: id,
      BillOfLading: `BLABJ${String(2026001 + i).padStart(6, "0")}`,
      CallId: callIds[i % 5],
      ShipperName: `Shipper ${i + 1} SARL`,
      ConsigneeName: `Consignee ${i + 1} CI`,
      OriginCountry: ["GH","NG","SN","MA","GN"][i % 5],
      DestinationPort: "CIABJ",
      Incoterms: ["FOB","CIF","DAP","CFR","EXW"][i % 5],
      Status: ["pre-arrival","in-customs","released","in-customs","released"][i % 5],
    });
    return id;
  });

  const consignmentIds = Array.from({ length: 30 }, (_, i) => {
    const id = uid();
    upsert("ConsignmentHolon", {
      Id: id,
      ShipmentId: shipmentIds[i % 25],
      HsCode: ["0801.11","0803.10","0901.11","1511.10","1801.00"][i % 5],
      GrossWeightKg: 17_000 + i * 600,
      TemperatureControlled: i % 6 === 0,
      SetTempC: i % 6 === 0 ? 13.0 : null,
      EudrRequired: i % 4 === 0,
      HazmatClass: i % 10 === 0 ? "9" : null,
    });
    return id;
  });

  // 120 containers across status pipeline
  const statusDistribution = [
    ...Array(10).fill("inland"),
    ...Array(15).fill("pre-gate"),
    ...Array(5).fill("gate-in"),
    ...Array(60).fill("yard"),
    ...Array(15).fill("loading"),
    ...Array(10).fill("on-vessel"),
    ...Array(5).fill("gate-out"),
  ];
  const containerTypes = ["20GP","40GP","40HQ","40RF","20GP"];
  const containerIds = statusDistribution.map((status, i) => {
    const id = uid();
    upsert("ContainerHolon", {
      Id: id,
      IsoNumber: `MSCU${String(1_000_000 + i).padStart(7, "0")}`,
      ConsignmentId: consignmentIds[i % 30],
      ContainerType: containerTypes[i % 5],
      SealNumber: `SL${String(90_000 + i).padStart(5, "0")}`,
      CurrentTempC: i % 6 === 0 ? parseFloat((13.1 + Math.sin(i) * 0.3).toFixed(1)) : null,
      GrossWeightKg: 17_500 + (i % 12) * 450,
      Status: status,
      IsEmpty: i >= 115,
    });
    return id;
  });

  // ── Zome 4: Movement holons ───────────────────────────────────────

  // 40 inland legs (first 4 = rail/barge arrived last 24h, next 7 = delay risk > 0.5)
  const inlandLegIds = Array.from({ length: 40 }, (_, i) => {
    const id = uid();
    const isRailBarge = i < 4;
    const isDelayRisk = i >= 4 && i < 11;
    const mode = isRailBarge ? (i < 2 ? "rail" : "barge") : "truck";
    upsert("InlandLegHolon", {
      Id: id,
      ContainerId: containerIds[i % 120],
      CarrierId: carrierIds[i % 12],
      WarehouseId: warehouseIds[i % 8],
      ModeOfTransport: mode,
      EtaDeparture: subMs((14 + i) * HR),
      EtaGate: addMs((1.5 + i * 0.25) * HR),
      ActualDeparture: subMs((9 + i) * HR),
      ActualArrivalZone: isRailBarge ? subMs((0.5 + i * 0.8) * HR) : null,
      DelayRiskScore: isDelayRisk
        ? parseFloat((0.55 + (i % 3) * 0.12).toFixed(2))
        : parseFloat((0.08 + (i % 5) * 0.05).toFixed(2)),
      Status: isRailBarge ? "arrived-zone" : i % 4 === 0 ? "gate-in" : "in-transit",
    });
    return id;
  });

  // Vehicles (30)
  const vehicleIds = Array.from({ length: 30 }, (_, i) => {
    const id = uid();
    upsert("VehicleHolon", {
      Id: id,
      CarrierId: carrierIds[i % 12],
      PlateNumber: `AB${String(1000 + i).padStart(4, "0")}CI`,
      DriverName: `Moussa Koné ${i + 1}`,
      DriverId: `DRV${1000 + i}`,
      VehicleType: i % 5 === 0 ? "barge" : i % 7 === 0 ? "rail-wagon" : "trailer",
      CurrentLegId: inlandLegIds[i % 40],
    });
    return id;
  });

  // Slot bookings: 62 in next 4h (78% with DoConfirmed = adherence proxy)
  const slotIds = Array.from({ length: 80 }, (_, i) => {
    const id = uid();
    const inNext4h = i < 62;
    const windowStart = inNext4h
      ? addMs((i * 3.7 + 2) * MIN)
      : addMs(4 * HR + (i - 62) * 8 * MIN);
    const adherent = inNext4h && i < 48; // 48/62 ≈ 77.4% ≈ 78%
    upsert("SlotBookingHolon", {
      Id: id,
      VehicleId: vehicleIds[i % 30],
      ContainerId: containerIds[i % 120],
      SlotWindowStart: windowStart,
      SlotWindowEnd: new Date(new Date(windowStart).getTime() + 30 * MIN).toISOString(),
      Status: inNext4h ? "booked" : "confirmed",
      DoConfirmed: adherent,
    });
    return id;
  });

  // Gate events: 84 in last 2h (42/hr), 3 with ExceptionFlag
  const gateEvents = Array.from({ length: 84 }, (_, i) => {
    const id = uid();
    const msAgo = Math.floor((i / 84) * 2 * HR) + Math.floor(Math.sin(i) * 2 * MIN + 2 * MIN);
    const isException = i >= 81;
    upsert("GateEventHolon", {
      Id: id,
      VehicleId: vehicleIds[i % 30],
      ContainerId: containerIds[i % 120],
      SlotId: slotIds[i % 80],
      Direction: i % 3 === 0 ? "out" : "in",
      OcrReadPlate: `AB${String(1000 + i).padStart(4, "0")}CI`,
      PlateMatchResult: isException ? "mismatch" : "match",
      SealCheck: isException ? "fail" : "pass",
      Timestamp: subMs(msAgo),
      ProcessingTimeSeconds: isException ? 160 + i * 3 : 38 + (i % 35),
      ExceptionFlag: isException,
    });
    return id;
  });

  // Port visits (80, avg dwell ≈ 36h)
  Array.from({ length: 80 }, (_, i) => {
    const dwellH = 22 + (i % 30); // 22-51h, avg ≈ 36h
    const gateIn = subMs(dwellH * HR);
    const gateOut = i >= 70 ? subMs((dwellH - 3) * HR) : null;
    upsert("PortVisitHolon", {
      Id: uid(),
      ContainerId: containerIds[i % 120],
      CallId: callIds[i % 5],
      GateInTime: gateIn,
      GateOutTime: gateOut,
      DwellHours: dwellH,
      Status: gateOut ? "gate-out" : i >= 60 ? "loaded" : i >= 40 ? "discharged" : "in-yard",
    });
  });

  // Yard positions (60 active, for containers currently in yard)
  Array.from({ length: 60 }, (_, i) => {
    upsert("YardPositionHolon", {
      Id: uid(),
      ContainerId: containerIds[i + 25], // containers in yard zone
      BlockId: blockIds[i % 8],
      Row: ["A","B","C","D"][i % 4],
      Bay: (i % 10) + 1,
      Tier: (i % 4) + 1,
      AssignedAt: subMs((10 + i) * HR),
      MovedAt: i % 7 === 0 ? subMs(HR) : null,
      Status: "active",
    });
  });

  // Handoff SLAs (30, some breached)
  Array.from({ length: 30 }, (_, i) => {
    const actual = 28 + i * 4; // 28-144 min
    const target = 45;
    upsert("HandoffSLAHolon", {
      Id: uid(),
      ContainerId: containerIds[i % 120],
      InlandArrivalZoneAt: subMs((actual + 65) * MIN),
      GateProcessedAt: subMs(65 * MIN),
      SlaTargetMinutes: target,
      ActualMinutes: actual,
      SlaBreached: actual > target,
      BreachReasonCode: actual > target ? ["gate-congestion","missing-docs","ocr-failure"][i % 3] : null,
    });
  });

  // ── Zome 5: Compliance ────────────────────────────────────────────

  // Customs triage: 120 containers — 66 GREEN (55%), 38 YELLOW (32%), 16 RED (13%)
  Array.from({ length: 120 }, (_, i) => {
    const risk = i < 66 ? "GREEN" : i < 104 ? "YELLOW" : "RED";
    const clearance =
      risk === "GREEN" ? "cleared" :
      risk === "YELLOW" ? (i % 3 === 0 ? "hold" : "pending") :
      "inspection-required";
    upsert("CustomsTriageHolon", {
      Id: uid(),
      ContainerId: containerIds[i],
      ConsignmentId: consignmentIds[i % 30],
      RiskLevel: risk,
      ClearanceStatus: clearance,
      QueuePosition: risk === "GREEN" ? 0 : 1 + (i % 22),
      AvgClearanceMinutes: risk === "GREEN" ? 21 : risk === "YELLOW" ? 48 : 96,
      InspectionType: risk === "GREEN" ? "none" : risk === "YELLOW" ? "document" : "scanner",
    });
  });

  // Trade documents: 50 total, 36 approved ≈ 72% ≈ 71%
  const docTypes = ["BL","phytosanitary","EUDR","permit","manifest","commercial-invoice","packing-list","certificate-of-origin"];
  Array.from({ length: 50 }, (_, i) => {
    const approved = i < 36;
    upsert("TradeDocumentHolon", {
      Id: uid(),
      ShipmentId: shipmentIds[i % 25],
      ContainerId: containerIds[i % 120],
      DocType: docTypes[i % docTypes.length],
      Status: approved ? "approved" : i % 4 === 0 ? "rejected" : "pending",
      IpfsCid: approved ? `Qm${uid().replace(/-/g, "").slice(0, 44)}` : null,
      FileHash: uid().replace(/-/g, ""),
    });
  });

  // ESG certs (20: 16 valid, 4 expired)
  Array.from({ length: 20 }, (_, i) => {
    upsert("ESGCertHolon", {
      Id: uid(),
      ShipmentId: shipmentIds[i % 25],
      CertType: ["EUDR","organic","fair-trade","carbon-neutral","rainforest-alliance"][i % 5],
      CoveredPct: 80 + (i % 4) * 5,
      Status: i < 16 ? "valid" : "expired",
      OnChainTxHash: `0x${uid().replace(/-/g, "")}`,
    });
  });

  // ── Hinterland ETA holons ─────────────────────────────────────────
  // 86 arriving ≤6h, 4 arriving >6h, 7 with high delay

  Array.from({ length: 90 }, (_, i) => {
    const withinSix = i < 86;
    const isDelay = i >= 83;
    const etaMs = withinSix
      ? (0.4 + i * 0.068) * HR          // spread across 0–5.85h
      : (6.2 + (i - 86) * 0.6) * HR;   // 6.2–7.4h
    upsert("HinterlandETAHolon", {
      Id: uid(),
      LegId: inlandLegIds[i % 40],
      EstimatedArrivalAt: addMs(etaMs),
      ConfidenceScore: parseFloat((isDelay ? 0.42 + (i % 4) * 0.06 : 0.76 + (i % 5) * 0.04).toFixed(2)),
      DelayMinutes: isDelay ? 38 + (i % 5) * 18 : -(i % 12),
      DelayReason: isDelay ? ["traffic","breakdown","border","weather"][i % 4] : "unknown",
      Source: ["tms","carrier-api","barge-system","rail-system","manual"][i % 5],
    });
  });

  // Inland exceptions: 8 total, 5 unresolved
  Array.from({ length: 8 }, (_, i) => {
    upsert("InlandExceptionHolon", {
      Id: uid(),
      LegId: inlandLegIds[i % 40],
      ContainerId: containerIds[i % 120],
      ExceptionType: ["missed-slot","temp-break","seal-mismatch","doc-missing","delay","vehicle-breakdown","border-hold"][i % 7],
      Severity: ["medium","high","high","medium","low","critical","low","medium"][i],
      IsResolved: i >= 5,
    });
  });

  // ── Zome 7: Operations ────────────────────────────────────────────

  // Shifts (2 recent)
  upsert("ShiftHolon", {
    Id: uid(),
    TerminalId: termIds[0],
    StartTime: subMs(6 * HR),
    EndTime: addMs(2 * HR),
    TrucksThroughGate: 252,
    CraneProductivityMph: 28.4,
    AvgGateTimeSeconds: 52,
    IncidentCount: 3,
  });
  upsert("ShiftHolon", {
    Id: uid(),
    TerminalId: termIds[0],
    StartTime: subMs(14 * HR),
    EndTime: subMs(6 * HR),
    TrucksThroughGate: 336,
    CraneProductivityMph: 31.1,
    AvgGateTimeSeconds: 47,
    IncidentCount: 1,
  });

  // Alerts (1 open ADVISORY)
  upsert("AlertHolon", {
    Id: uid(),
    PortId: portId,
    Domain: "gate",
    Severity: "ADVISORY",
    Title: "Gate queue elevated",
    Body: "Gate queue at 14 trucks avg — approaching FLASH threshold (>20)",
    TriggeredAt: subMs(28 * MIN),
    AcknowledgedAt: null,
    AcknowledgedBy: null,
    IsResolved: false,
  });

  // Revenue items: 50 collected ≈ 125M XOF, 20 outstanding ≈ 42M XOF
  // Collected: amt = 1_500_000 + (i%6)*500_000 → avg 2.5M × 50 = 125M
  const chargeTypes = ["port-dues","storage","reefer-plugin","gate-fee","customs-fee","scanning-fee","overtime"];
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  Array.from({ length: 70 }, (_, i) => {
    const collected = i < 50;
    const amt = collected
      ? 1_500_000 + (i % 6) * 500_000          // 1.5M–4.0M, avg 2.75M (×50 = 137.5M, slightly high — adjust)
      : 1_600_000 + (i % 5) * 350_000;         // 1.6M–3.0M, avg 2.3M (×20 = 46M)
    // Fine-tune: use a deflation factor to hit 125M
    const adjustedAmt = collected ? Math.round(amt * 0.91) : amt; // × 0.91 → ~125M
    upsert("RevenueItemHolon", {
      Id: uid(),
      ChargeType: chargeTypes[i % chargeTypes.length],
      Amount: adjustedAmt,
      Currency: "XOF",
      Status: collected ? "collected" : i % 8 === 0 ? "disputed" : "outstanding",
      DueAt: subMs((i % 18) * HR),
      PaidAt: collected ? new Date(todayStart.getTime() + (i % 10) * HR).toISOString() : null,
    });
  });

  return {
    portId, termIds, berthIds, blockIds,
    vesselIds, callIds,
    shipmentIds, consignmentIds, containerIds,
    inlandLegIds, vehicleIds, slotIds, carrierIds, warehouseIds,
  };
}
