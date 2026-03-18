# PortOS

**Port intelligence dashboard** — multi-domain operational sweeps, delta tracking, stakeholder views, HUD (West Africa / LFG Port OS framing). MVP uses mock telemetry; designed to plug into PCS, TOS, TMS, and later OASIS holons.

## Quick start

```bash
cd port-dashboard
cp .env.example .env   # optional
npm install
npm start
```

Open **http://localhost:3120** · Health: `/api/health` · Brief: `/export/brief.html`

## Repo layout

| Path | Description |
|------|-------------|
| `port-dashboard/` | Node (Express) app |
| `docs/` | Specs (System 08 mapping, supply-chain extension) |
| `schemas/` | JSON Schema for sweep payload |
| `mock/` | Sample JSON |

## License

Specify license in repo settings as needed. UI visually inspired by [Crucix](https://github.com/calesthio/Crucix) (AGPL) — this codebase is a separate implementation for port telemetry.
