# Port OS Intelligence Dashboard — Short Spec

**Status:** Draft v0.1  
**Audience:** LFG port programme + OASIS integration  
**Reference doc:** LFG Port Digital Transformation Strategy (PAA + San Pedro, nine systems).  
**Technical seed:** [Crucix](https://github.com/calesthio/Crucix) — parallel data sweep → synthesized JSON → SSE HUD + deltas + optional alerts.

---

## 1. Goal

Deliver a **live operational reporting dashboard** (“Port Intelligence Dashboard” / System 08 in the LFG stack) that:

- Surfaces **berth, gate, yard, customs triage, revenue, security** in one view.
- Refreshes on a **fixed cadence** (e.g. 1–15 min) with **delta vs previous sweep** (what changed).
- Supports **stakeholder-filtered views** (authority vs terminal vs customs vs forwarder).
- Can later **persist and attribute** data via **OASIS holons** (sovereign mapping per port / zone / asset).

This is **not** a replacement for PCS, TOS, or payments — it is the **read + alert + executive brief** layer on top.

---

## 2. Scope (MVP → v1)

| Phase | Scope |
|-------|--------|
| **MVP** | Configurable **Port OS mode**: mock telemetry sources + dashboard layout matching System 08 KPI tiles; SSE refresh; delta panel; optional static “executive summary” export (HTML/JSON). |
| **v1** | Replace mocks with **real connectors** (REST from PCS/TOS/gate/customs aggregators as available); env-based URLs and API keys. |
| **v1.5** | **OASIS read path**: pull snapshot or holon summaries from ONODE Data API; map zones to holon IDs. |
| **v2** | Push significant events/alerts into OASIS as holons; role-based JWT (Avatar) for dashboard access.

**Out of scope (initially):** authoring transactions, payments, or customs decisions inside this repo.

---

## 3. LFG system → data domain mapping

| LFG system | Dashboard domain | Typical metrics |
|------------|------------------|----------------|
| 01 Gate / OCR | `gate` | Trucks/hour, queue length, exception count |
| 02 PCS | `pcs` | Vessel ETA/berth, cargo status propagation health |
| 03 TOS | `yard`, `berth` | Yard fill, dwell, berth occupancy, crane productivity (subset) |
| 04 AI Customs | `customs` | GREEN/YELLOW/RED ratio, avg clearance time, queue depth |
| 05–07 | `provenance`, `esg`, `permits` | Optional tiles: ledger lag, EUDR cert coverage, active permits |
| **08 ACI** | `intel` (orchestration) | Pre-arrival manifest readiness, planning horizon |
| 09 Payments | `revenue` | Collected vs outstanding, daily totals |
| Supply chain | `hinterland` | Inbound ETAs, delay risk, rail/barge (mock v0.2) |
| Pre-gate | `pre_gate` | Slot bookings, adherence, docs ready, inland exceptions |

---

## 4. Architecture (target)

```
┌─────────────────────────────────────────────────────────┐
│  Port sweep orchestrator (Crucix-style parallel fetch)   │
│  Sources: port-gate, port-pcs, port-tos, port-customs,   │
│           port-revenue, port-security, [optional OASIS]    │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Synthesize → canonical JSON + delta vs last run           │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Express: /api/data, /events (SSE), static HUD           │
│  Optional: PDF/HTML brief, Telegram/Discord alerts         │
└─────────────────────────────────────────────────────────┘
```

- **Canonical JSON shape:** versioned schema under `lfg/schemas/` (to be added in implementation).
- **Failure model:** per-source errors; sweep continues; dashboard shows source health (same pattern as Crucix).

---

## 5. OASIS / holonic mapping (design intent)

| Real-world entity | Holon role (conceptual) |
|-------------------|-------------------------|
| Port (PAA, San Pedro) | Root operational holon |
| Terminal / berth zone | Child holon |
| Shift or sweep run | Time-bounded holon or metadata on snapshot |
| High-severity alert | Child holon or linked event |

Crucix/dashboard remains **stateless or file-cached** until v1.5; OASIS becomes **system of record** for identity, multi-site replication, and audit.

---

## 6. Repository layout (this folder)

```
lfg/
  README.md
  PORT_OS_DASHBOARD_SPEC.md
  schemas/port-dashboard-v1.schema.json
  mock/sweep-sample-abidjan.json
  port-dashboard/               ← MVP implementation (Express, SSE, mock sources)
    server.mjs
    lib/sources/
    public/index.html
```

**Decision:** **B)** Greenfield Express in `port-dashboard/` (no Crucix AGPL fork for MVP). Same sweep → delta → SSE pattern as Crucix.

---

## 7. Success criteria (MVP)

- [x] Single command starts server; dashboard loads with **all System 08 tile groups** from **mock data** (`port-dashboard/`).
- [x] **Sweep cycle** + **delta panel** vs previous run; SSE push on sweep.
- [x] **Stakeholder views** (`authority`, `customs`, `forwarder`, `terminal`) via `?role=`.
- [x] **Export** HTML + JSON brief; `runs/latest.json` persisted.
- [ ] Real connectors (`PCS_BASE_URL`, …) — v1.
- [ ] OASIS read — v1.5.

---

## 8. Open decisions

- **License:** Crucix is AGPL; confirm whether LFG deployment requires clean-room UI on proprietary connectors vs AGPL-compliant fork.
- **Sites:** Abidjan vs San Pedro — single dashboard with `PORT_SITE=abidjan|sanpedro` vs two instances.
- **Language:** Executive UI EN/FR toggle (deferred post-MVP).

---

*End of short spec.*
