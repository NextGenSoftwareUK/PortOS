# Port OS Intelligence Dashboard — Production Deployment Plan

> **Confirmed API base:** `https://api.oasisweb4.com` (live, HTTP 200, Kestrel/.NET)  
> **Swagger UI:** `https://api.oasisweb4.com/swagger/index.html`

---

## Overview of what we have built

| Layer | File | Status |
|-------|------|--------|
| In-memory holon store | `lib/holons/store.mjs` | PoC — replace with OASIS API in Phase 2 |
| 999 seed holons (24 types) | `lib/holons/seed.mjs` | PoC — becomes one-time bootstrap call |
| KPI aggregation | `lib/holons/queries.mjs` | Production-ready (logic stays, data source swaps) |
| Live holon simulator | `lib/holons/simulator.mjs` | Demo only — remove in production |
| SSE sweep server | `server.mjs` | Production-ready once env vars are set |
| Dashboard frontend | `public/index.html` | Production-ready — single file with holon drawer |

---

## Phase 1 — Deploy what exists (today, ~1 hour)

### 1.1 — Create a Railway (or Render/Fly.io) project

The dashboard is a plain Node.js/Express app. No build step required.

**Railway (recommended — free tier, automatic HTTPS, env var UI):**

```bash
# Install Railway CLI
npm install -g @railway/cli

# Authenticate
railway login

# From the port-dashboard directory
cd lfg/port-dashboard
railway init          # name it: lfg-port-dashboard
railway up            # deploys, gives you a public URL
```

Railway auto-detects Node.js, runs `npm start` from `package.json`.

**Verify `package.json` has a start script:**

```json
{
  "scripts": {
    "start": "node server.mjs"
  }
}
```

### 1.2 — Set environment variables

In Railway → Variables (or Render → Environment):

| Variable | Value | Description |
|----------|-------|-------------|
| `PORT` | `3120` | (Railway sets this automatically) |
| `PORT_SITE` | `abidjan` | Port site identifier |
| `REFRESH_INTERVAL_SEC` | `60` | Sweep cadence |
| `SIM_INTERVAL_SEC` | `12` | Holon simulator tick |

### 1.3 — Share the URL

Railway provides a URL like `https://lfg-port-dashboard.up.railway.app`.  
Share this with your colleague — no GitHub repo access needed.

### 1.4 — (Optional) Split frontend to Vercel

If you want the static UI on a Vercel domain:

1. Copy `public/index.html` into a Vercel project root
2. Update the two API base URL constants at the top of `index.html`:

```js
// Change from relative:
const API = '';
const SSE_URL = '/events';

// To absolute backend URL:
const API = 'https://lfg-port-dashboard.up.railway.app';
const SSE_URL = 'https://lfg-port-dashboard.up.railway.app/events';
```

3. Add CORS to `server.mjs`:

```js
import cors from 'cors';
app.use(cors({ origin: 'https://your-vercel-project.vercel.app' }));
```

---

## Phase 2 — Wire holons to OASIS (next sprint, ~1 day)

The in-memory `store.mjs` gets replaced by real calls to `api.oasisweb4.com/api/data`.

### 2.1 — Register an OASIS Avatar for the app

This is the service account that the Port OS dashboard uses to authenticate.

```bash
curl -X POST https://api.oasisweb4.com/api/avatar/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "portos-abidjan",
    "email": "portdash@yourorg.com",
    "password": "SecurePortOS123!",
    "firstName": "Port",
    "lastName": "OS"
  }'
```

Verify the email, then authenticate to get a JWT:

```bash
curl -X POST https://api.oasisweb4.com/api/avatar/authenticate \
  -H "Content-Type: application/json" \
  -d '{"username": "portos-abidjan", "password": "SecurePortOS123!"}'
# → copy result.jwtToken into OASIS_JWT env var
```

Add to environment variables:

| Variable | Value |
|----------|-------|
| `OASIS_API_URL` | `https://api.oasisweb4.com` |
| `OASIS_JWT` | `<jwt from authenticate>` |

### 2.2 — Create `lib/holons/oasis-client.mjs`

This file replaces `store.mjs` as the persistence layer. Port OS holon fields go into the `metadata` object.

```js
// lib/holons/oasis-client.mjs
const BASE = process.env.OASIS_API_URL || 'https://api.oasisweb4.com';
const JWT  = process.env.OASIS_JWT || '';

const headers = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${JWT}`,
});

/** Save (create or update) a Port OS holon */
export async function saveHolon(type, fields) {
  const { Id, ...rest } = fields;
  const body = {
    holon: {
      id: Id || '00000000-0000-0000-0000-000000000000',
      name: `${type}:${fields.IsoNumber || fields.Name || Id}`,
      holonType: 40,        // Generic Holon
      metadata: { type, ...rest },
      isActive: true,
    },
    saveChildren: false,
  };
  const res = await fetch(`${BASE}/api/data/save-holon`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.isError) throw new Error(`OASIS save-holon failed: ${json.message}`);
  // Return the holon back with its OASIS id
  return { ...fields, Id: json.result.result.id };
}

/** Load all holons of a Port OS type */
export async function loadHolonsByType(type) {
  // Uses the metadata.type field — in production use a parentHolonId per type
  const res = await fetch(`${BASE}/api/data/load-all-holons/Holon`, {
    headers: headers(),
  });
  const json = await res.json();
  if (json.isError) throw new Error(`OASIS load-all-holons failed: ${json.message}`);
  return (json.result.result || [])
    .filter(h => h.metadata?.type === type)
    .map(h => ({ Id: h.id, ...h.metadata }));
}

/** Delete a holon */
export async function deleteHolon(id) {
  const res = await fetch(`${BASE}/api/data/delete-holon/${id}`, {
    method: 'DELETE',
    headers: headers(),
  });
  const json = await res.json();
  if (json.isError) throw new Error(`OASIS delete-holon failed: ${json.message}`);
  return true;
}
```

### 2.3 — Data model mapping

OASIS holons have a `metadata` object (key-value). All Port OS fields go there:

| Port OS field | OASIS field |
|---------------|-------------|
| `Id` | `holon.id` (GUID) |
| `IsoNumber`, `Status`, `PortCode` etc | `holon.metadata.*` |
| `IpfsCid` | `holon.metadata.IpfsCid` + OASIS file store |
| `OnChainTxHash` | `holon.metadata.OnChainTxHash` + provider |
| `_type` | `holon.metadata.type` |

### 2.4 — Bootstrap script (one-time seed)

Run this once to push the 999 seed holons into OASIS:

```bash
node scripts/bootstrap-oasis.mjs
```

Create `scripts/bootstrap-oasis.mjs`:

```js
import { seedAll } from '../lib/holons/seed.mjs';
import { saveHolon } from '../lib/holons/oasis-client.mjs';
import { list } from '../lib/holons/store.mjs';

// Seed into memory first
seedAll('abidjan');

// Then push each to OASIS
const types = [
  'PortHolon', 'TerminalHolon', 'BerthHolon', 'VesselCallHolon',
  'ContainerHolon', 'ConsignmentHolon', 'ShipmentHolon', 'VehicleHolon',
  'GateEventHolon', 'YardPositionHolon', 'CustomsTriageHolon',
  'TradeDocumentHolon', 'RevenueLineHolon', 'SlotBookingHolon',
  'InlandLegHolon', 'HinterlandETAHolon', 'HandoffSLAHolon',
  'PortVisitHolon', 'CongestionSnapshotHolon', 'AlertHolon',
  'KpiSnapshotHolon', 'AuditEventHolon', 'SweepSnapshotHolon', 'PortAgentHolon',
];

let saved = 0;
for (const type of types) {
  const holons = list(type);
  for (const h of holons) {
    await saveHolon(type, h);
    saved++;
    if (saved % 50 === 0) console.log(`  Saved ${saved} holons...`);
  }
}
console.log(`Bootstrap complete — ${saved} holons persisted to OASIS.`);
```

---

## Phase 3 — Production hardening

### 3.1 — JWT refresh

OASIS JWTs expire. Add a token refresh mechanism or use long-lived tokens. Check the `/api/avatar/refresh-token` endpoint.

### 3.2 — Parent holons for scoped queries

Instead of filtering all holons by `metadata.type`, create a **PortHolon root** and attach all sub-holons as children. Then use `load-holons-for-parent` for fast, scoped queries:

```js
// Load all ContainerHolons under the Abidjan port root
POST /api/data/load-holons-for-parent
{ "id": "<PORT_ROOT_HOLON_ID>", "holonType": "Holon" }
```

### 3.3 — STAR Network for multi-port replication

When a second port (e.g. San Pedro) comes online, create a second ONODE and configure STAR replication. Holons created in Abidjan automatically replicate to San Pedro.

This uses the OASIS HyperDrive provider settings:
```json
{ "autoReplicationMode": "AllProviders", "setGlobally": false }
```

### 3.4 — Remove the simulator in production

`simulator.mjs` generates synthetic state changes. In production, real gate OCR readers, customs systems, and vessel AIS feeds write directly to holons via the OASIS Data API. Remove the `setInterval(simulateStep, ...)` call in `server.mjs`.

### 3.5 — Blockchain provenance (optional, high-value demo)

For regulatory-grade audit trails, use the `onChainProvider` flag when saving holons:

```js
{
  "holon": { ... },
  "onChainProvider": "EthereumOASIS",   // or SolanaOASIS, HoloOASIS
  "saveChildren": false
}
```

The returned `OnChainTxHash` can be displayed in the dashboard's holon drawer as proof of immutability.

---

## Summary checklist

### Phase 1 (share today)
- [ ] Ensure `package.json` has `"start": "node server.mjs"`
- [ ] `railway init` + `railway up` from `lfg/port-dashboard/`
- [ ] Set `PORT_SITE=abidjan` env var
- [ ] Share Railway URL with colleague

### Phase 2 (OASIS wiring)
- [ ] Register OASIS Avatar for the app → get JWT
- [ ] Add `OASIS_API_URL` + `OASIS_JWT` to Railway env vars
- [ ] Create `lib/holons/oasis-client.mjs`
- [ ] Run `bootstrap-oasis.mjs` once to seed 999 holons to OASIS
- [ ] Update `store.mjs` reads/writes to call `oasis-client.mjs`

### Phase 3 (production hardening)
- [ ] JWT refresh on expiry
- [ ] Parent holon scoping for fast queries
- [ ] Remove simulator, connect real data feeds
- [ ] STAR replication if multi-port
- [ ] Blockchain provenance for audit holons
