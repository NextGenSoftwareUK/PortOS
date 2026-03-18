# Supply chain beyond the port → Port OS dashboard

**Scenario:** A **supply chain system** operates **outside the port** (origin, inland legs, warehouses, carriers, compliance) and **feeds** the same **Port OS intelligence dashboard** so leadership sees **door-to-berth** (and optionally **berth-to-door**) in one place.

---

## 1. Why connect

| Port-only view | Extended supply chain view |
|----------------|----------------------------|
| Gate/yard/berth react when cargo arrives | **Pre-arrival horizon** — ETA of trucks, trains, barges; manifest readiness; **risk before congestion** |
| PCS knows vessel + container | **Shipment holon** links container ↔ inland trip ↔ supplier ↔ ESG chain (EUDR) |
| Reactive planning | **Slot booking**, labour, yard block pre-allocation from **upstream ETAs** |

This aligns with LFG **System 08 (ACI)** and **PCS**: the port “knows before the vessel” — extend that to **“knows before the truck hits the gate.”**

---

## 2. Logical architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  SUPPLY CHAIN PLANE (outside port)                              │
│  TMS / WMS / carrier APIs / Shipex-style logistics / ESG trace   │
│  Events: pickup, inland depart/arrive, doc ready, pre-advice      │
└───────────────────────────────┬─────────────────────────────────┘
                                │ APIs · webhooks · message bus
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  INTEGRATION LAYER (PCS / middleware / OASIS)                      │
│  Normalize IDs: BL, container, vehicle, booking ref, holon ID     │
│  Access control: which stakeholder sees which slice                │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  PORT OS DASHBOARD (lfg/port-dashboard pattern)                  │
│  Domains: existing berth/gate/yard/customs/revenue/security        │
│           + hinterland / pre-gate / compliance / exceptions        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. New or enriched dashboard domains

| Domain | Examples |
|--------|----------|
| **hinterland** | Inbound trucks ETA (next 2–24h), rail/barge slots, **delay risk** vs gate capacity |
| **pre_gate** | Digital delivery orders confirmed; **slot bookings** vs actual arrivals; no-show rate |
| **cargo_readiness** | Docs complete % (aligned with ACI); **EUDR / cert** status for export lanes (San Pedro) |
| **inland_exceptions** | Missed slot, temperature break (reefer chain), seal mismatch **before** gate |
| **handoff** | Time from “inland arrival zone” → **gate processed** (SLA) |

These sit **beside** existing tiles; **delta** and **alerts** work the same (e.g. FLASH: mass inbound delay; ROUTINE: slot drift).

---

## 4. Identity & data model (OASIS-friendly)

- **Holon chain:** `Shipment` / `Consignment` → `InlandLeg` → `PortVisit` → `GateEvent` → `YardPosition`  
- Same **GUID** across systems avoids reconciling phone/WhatsApp with PCS.  
- Port dashboard queries: **“all legs arriving in next 6h for Terminal X”** = filter on holon + geo/time.

---

## 5. Reuse from this repo

| Asset | Role |
|-------|------|
| **lfg/port-dashboard** | Add sources `hinterland.mjs`, `preGate.mjs` (mock first, then HTTP to middleware). |
| **Shipex (OASIS provider)** | Pattern for **carrier/order webhooks** and multi-API normalization — good reference for **inbound TMS** integration **through OASIS**, not inside the Node dashboard. |
| **Crucix-style sweep** | One more parallel source = one more connector; **failure isolation** per source. |

---

## 6. Phased build

1. **Schema** — ✅ `domains.hinterland`, `domains.pre_gate` in `lfg/schemas/port-dashboard-v1.schema.json`.  
2. **Mock** — ✅ `lfg/port-dashboard` sweeps include hinterland + pre-gate KPIs, delta + alerts (high inbound vs queue, slot adherence, delay risk).  
3. **Contract** — document webhook/API payload from supply chain platform → integration layer.  
4. **Live** — connect to PCS or **Supply Chain Hub** (TMS/WMS aggregation).

---

## 7. Risks / governance

- **Data volume** — pre-gate events can dwarf berth events; aggregate (hourly buckets) for executive view.  
- **Commercial sensitivity** — forwarders may see only their cargo; **role filter** already in dashboard; extend `ROLE_DOMAINS`.  
- **Single source of truth** — port TOS remains authoritative for **yard truth**; supply chain feeds are **intent + ETA**, reconciled at gate.

---

*Complements [PORT_OS_DASHBOARD_SPEC.md](./PORT_OS_DASHBOARD_SPEC.md).*
