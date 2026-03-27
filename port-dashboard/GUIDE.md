# Port OS Dashboard — Developer Guide

**Live URL:** https://portos-production-9f14.up.railway.app  
**Source repo:** https://github.com/NextGenSoftwareUK/PortOS  
**Run locally:** `cd port-dashboard && npm install && npm start` → http://localhost:3120

---

## What is this system?

The Port OS Intelligence Dashboard is a real-time operational overview for a port (currently modelled on Abidjan PAA, Côte d'Ivoire). It tracks everything that happens in a port — vessels arriving, containers moving through gates, customs decisions, revenue, hinterland trucks — and presents it as live KPIs across 8 domains.

The data backbone is **holons**. Every entity in the system — a container, a vessel, a berth, a truck, a customs triage decision — is a holon. Holons have unique IDs, carry their own fields, and link to each other via foreign key references (e.g. a `ContainerHolon` has a `ConsignmentId` pointing to a `ConsignmentHolon`).

Right now the holons live in-memory (the PoC). The production path is to persist them to **OASIS** at `api.oasisweb4.com/api/data`.

---

## System architecture

```
Browser (public/index.html)
    │
    ├── GET /api/data          → KPIs for the current sweep
    ├── GET /api/holons        → holon store overview (counts by type)
    ├── GET /api/holons/:type  → list all holons of a type
    ├── GET /api/holons/:type/:id → single holon
    ├── GET /api/holons/container-lifecycle/:iso → full container chain
    ├── GET /events            → Server-Sent Events (live push)
    └── POST /api/events/simulate → inject demo events
    
server.mjs (Express, Node.js)
    │
    ├── lib/holons/store.mjs     — in-memory Map<type, Map<id, holon>>
    ├── lib/holons/seed.mjs      — populates store with 1,003 holons on boot
    ├── lib/holons/simulator.mjs — mutates holons every 12s (live feel)
    ├── lib/holons/queries.mjs   — computes KPIs from holon graph
    ├── lib/sources/index.mjs    — parallel sweep across 8 domains
    └── lib/delta.mjs            — diff between current and previous sweep
```

---

## The 24 holon types (organised by zome)

Holons are grouped into 7 **zomes** (logical domains). Each type has a fixed set of fields.

### Zome 1 — Port infrastructure

| Type | Count | Key fields | Links to |
|------|-------|-----------|----------|
| `PortHolon` | 1 | `PortCode`, `Site`, `CountryCode` | — |
| `TerminalHolon` | 2 | `Name`, `TerminalType` (`container`/`bulk`) | `PortId` |
| `BerthHolon` | 12 | `BerthNumber`, `Status` (`occupied`/`free`/`reserved`/`maintenance`) | `TerminalId` |
| `YardBlockHolon` | 8 | `BlockName`, `Zone`, `Capacity`, `CurrentFill`, `FillPct` | `TerminalId` |

### Zome 2 — Vessels

| Type | Count | Key fields | Links to |
|------|-------|-----------|----------|
| `VesselHolon` | 8 | `ImoNumber` (e.g. `IMO9000001`), `VesselName`, `Operator` | — |
| `VesselCallHolon` | 8 | `VoyageNumber` (e.g. `V2026001`), `Status`, `Eta`, `Ata`, `ManifestReadinessPct` | `VesselId`, `BerthId`, `PortId` |

### Zome 3 — Shipments & cargo

| Type | Count | Key fields | Links to |
|------|-------|-----------|----------|
| `ShipmentHolon` | 25 | `BillOfLading` (e.g. `BLABJ2026001`), `Status`, `Incoterms` | `CallId` |
| `ConsignmentHolon` | 30 | `HsCode`, `GrossWeightKg`, `HazmatClass`, `TemperatureControlled` | `ShipmentId` |
| `ContainerHolon` | 120 | `IsoNumber` (e.g. `MSCU1000000`), `Status`, `ContainerType`, `SealNumber` | `ConsignmentId` |
| `TradeDocumentHolon` | 50 | `DocType`, `Status` (`submitted`/`approved`/`rejected`/`pending`) | `ContainerId` |

### Zome 4 — Movement

| Type | Count | Key fields | Links to |
|------|-------|-----------|----------|
| `VehicleHolon` | 30 | `PlateNumber` (e.g. `AB1000CI`), `DriverName`, `VehicleType` | `CarrierId`, `CurrentLegId` |
| `GateEventHolon` | ~85 | `Direction` (`in`/`out`), `Timestamp`, `PlateMatchResult`, `ExceptionFlag` | `VehicleId`, `ContainerId`, `SlotId` |
| `YardPositionHolon` | 60 | `BlockName`, `Bay`, `Row`, `Tier`, `DwellHours` | `ContainerId` |
| `PortVisitHolon` | 80 | `GateInTime`, `GateOutTime`, `DwellHours`, `Status` | `ContainerId` |

### Zome 5 — Customs & compliance

| Type | Count | Key fields | Links to |
|------|-------|-----------|----------|
| `CustomsTriageHolon` | 120 | `RiskLevel` (`GREEN`/`YELLOW`/`RED`), `ClearanceStatus`, `InspectionType`, `AvgClearanceMinutes` | `ContainerId` |
| `ESGCertHolon` | 20 | `CertType`, `IssuedBy`, `ValidUntil` | `ShipmentId` |

### Zome 6 — Hinterland

| Type | Count | Key fields | Links to |
|------|-------|-----------|----------|
| `CarrierHolon` | 12 | `Name`, `Mode` (`road`/`rail`/`barge`/`multimodal`), `KpiOnTimeRatePct` | — |
| `WarehouseHolon` | 8 | `Name`, `Address`, `Latitude`, `Longitude`, `ContainerCapacity` | — |
| `InlandLegHolon` | 40 | `ModeOfTransport`, `EtaGate`, `DelayRiskScore`, `Status` | `ContainerId`, `CarrierId`, `WarehouseId` |
| `HinterlandETAHolon` | 90 | `EtaGate`, `DelayRiskScore`, `IsHighRisk` | `LegId`, `ContainerId` |
| `SlotBookingHolon` | 80 | `SlotTime`, `DoConfirmed`, `Status` | `ContainerId`, `VehicleId` |

### Zome 7 — Intelligence & audit

| Type | Count | Key fields | Links to |
|------|-------|-----------|----------|
| `HandoffSLAHolon` | 30 | `SlaType`, `TargetHours`, `ActualHours`, `Breached` | `ContainerId` |
| `AlertHolon` | ~2 | `Severity` (`FLASH`/`URGENT`/`ROUTINE`), `Domain`, `Title`, `IsResolved` | `PortId` |
| `RevenueItemHolon` | 70 | `ChargeType`, `AmountXof`, `IsPaid`, `DueDate` | `ContainerId` |
| `SweepSnapshotHolon` | grows | `SweepStartedAt`, `AlertCount`, `DeltaVsPrevious` | — |

---

## How to find and query holons

### Via the dashboard UI

1. Open the live URL
2. Click any **domain tile** in the left rail (e.g. "Customs & compliance") → the holon drawer slides open on the right
3. The drawer shows all holons for that domain, tabbed by type
4. Click the **HOLONS badge** (top-right of the dashboard) → opens the full store overview
5. Click the **"Container lifecycle"** tab → type an ISO number to trace a full container journey

### Via the API (for Sohaib to use directly)

All endpoints are live on the Railway URL. No auth needed (PoC).

#### 1. Get a count of all holons by type
```
GET /api/holons
```
```json
{
  "total": 1003,
  "byType": {
    "PortHolon": 1,
    "ContainerHolon": 120,
    "CustomsTriageHolon": 120,
    ...
  }
}
```

#### 2. List all holons of a type (paged)
```
GET /api/holons/ContainerHolon
GET /api/holons/ContainerHolon?limit=20&offset=40
GET /api/holons/VesselCallHolon
GET /api/holons/CustomsTriageHolon
```
Returns `{ type, total, items: [...] }`.

#### 3. Get a single holon by its UUID
```
GET /api/holons/ContainerHolon/<uuid>
GET /api/holons/BerthHolon/<uuid>
```

#### 4. Trace a container's full lifecycle
This is the most powerful query. Give it a container ISO number and it returns the complete chain:
```
GET /api/holons/container-lifecycle/MSCU1000000
GET /api/holons/container-lifecycle/MSCU1000042
GET /api/holons/container-lifecycle/MSCU1000099
```

Returns the container linked to its consignment, shipment, gate events, yard positions, customs triage, trade documents, inland legs, slot bookings, hinterland ETAs, port visit, and SLA.

**Container ISO numbers in the seed data:** `MSCU1000000` through `MSCU1000119` (120 containers).

#### 5. Get current KPI sweep data
```
GET /api/data
GET /api/data?role=customs
GET /api/data?role=forwarder
GET /api/data?role=terminal
```
Role filters which domains are visible.

#### 6. Get delta (what changed since last sweep)
```
GET /api/delta
```

#### 7. Get an exportable brief
```
GET /export/brief.html
GET /export/brief.json
```

---

## Key reference numbers in the seed data

Use these to look things up without guessing:

| Entity | Example values |
|--------|---------------|
| Container ISO | `MSCU1000000` → `MSCU1000119` |
| Bill of Lading | `BLABJ2026001` → `BLABJ2026025` |
| Vessel IMO | `IMO9000001` → `IMO9000008` |
| Voyage number | `V2026001` → `V2026008` |
| Vehicle plate | `AB1000CI` → `AB1029CI` |
| Berth number | `B01` → `B12` |
| Yard block | `A1`, `A2`, `B1`, `B2`, `RF`, `HZ`, `EM`, `TS` |

**Container statuses** (pipeline order):
```
inland → pre-gate → gate-in → yard → loading → on-vessel → gate-out
```

**Customs risk levels:** `GREEN` (55%), `YELLOW` (32%), `RED` (13%)

---

## How the live simulation works

Every 12 seconds `simulator.mjs` makes small changes to the holon store:

- Creates 1–3 new `GateEventHolon` records (trucks arriving)
- Progresses containers along the status pipeline (`pre-gate` → `gate-in` → `yard`)
- Moves customs decisions (`pending` → `cleared` or `hold`)
- Collects revenue (marks `RevenueItemHolon` as paid)
- Generates and resolves `AlertHolon` entries
- Updates `HinterlandETAHolon` ETAs as trucks get closer

The SSE stream (`/events`) pushes a lightweight notification every 60 seconds (on each full sweep). The dashboard updates without polling.

---

## Injecting demo events

Three synthetic events can be triggered to show how the system responds:

```bash
# Spike gate throughput — 20 gate events injected at once
curl -X POST https://portos-production-9f14.up.railway.app/api/events/simulate \
  -H "Content-Type: application/json" \
  -d '{"event":"gate_rush"}'

# Escalate 5 containers to RED customs + create FLASH alert
curl -X POST https://portos-production-9f14.up.railway.app/api/events/simulate \
  -H "Content-Type: application/json" \
  -d '{"event":"customs_flash"}'

# Berth a scheduled vessel
curl -X POST https://portos-production-9f14.up.railway.app/api/events/simulate \
  -H "Content-Type: application/json" \
  -d '{"event":"vessel_arrival"}'
```

---

## File map

```
port-dashboard/
├── server.mjs                  ← Express server, all API routes, boot logic
├── public/
│   └── index.html              ← Single-page dashboard UI (all JS inline)
├── lib/
│   ├── holons/
│   │   ├── store.mjs           ← The holon database (in-memory Map)
│   │   ├── seed.mjs            ← Generates all 1,003 holons on boot
│   │   ├── queries.mjs         ← KPI calculations from holon data
│   │   └── simulator.mjs       ← Live mutation engine (runs every 12s)
│   ├── sources/
│   │   └── index.mjs           ← Parallel sweep across 8 domains
│   ├── delta.mjs               ← Diff between sweeps (what changed)
│   └── roles.mjs               ← Role-based domain filtering
├── .env.example                ← Copy to .env for local config
├── Dockerfile                  ← Container build (Railway/Render/Fly.io)
├── railway.json                ← Railway deploy config
└── PRODUCTION_DEPLOYMENT.md    ← Full production + OASIS wiring guide
```

---

## Running locally

```bash
git clone https://github.com/NextGenSoftwareUK/PortOS.git
cd PortOS/port-dashboard
npm install
npm start
```

Open http://localhost:3120 — the dashboard is live with 1,003 seed holons.

**Optional env vars** (copy `.env.example` to `.env`):
```
PORT=3120
PORT_SITE=abidjan
REFRESH_INTERVAL_SEC=60
SIM_INTERVAL_SEC=12
```

---

## Next step: wiring to OASIS persistence

Currently all holons are in-memory — they reset on restart. The production path is:

1. Register a service account at `api.oasisweb4.com/api/avatar/register`
2. Authenticate → get a JWT
3. Replace `store.mjs` with `oasis-client.mjs` that calls `POST /api/data/save-holon`
4. Run the bootstrap script once to push all 1,003 holons to OASIS (MongoDB Atlas)
5. From then on, holons persist across restarts and replicate across ports via STAR Network

Full details in `PRODUCTION_DEPLOYMENT.md` → Phase 2.

---

*Questions? The full OASIS API reference is at https://api.oasisweb4.com/swagger/index.html*
