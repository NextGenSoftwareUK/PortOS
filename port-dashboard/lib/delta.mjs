/**
 * @param {object|null} prev - previous sweep payload
 * @param {object} curr - current sweep payload
 */
export function computeDelta(prev, curr) {
  if (!prev?.domains || !curr?.domains) {
    return { changes: [], summary: "First sweep — no prior comparison." };
  }

  const changes = [];

  for (const domain of Object.keys(curr.domains)) {
    const prevKpis = prev.domains[domain]?.kpis ?? [];
    const currKpis = curr.domains[domain]?.kpis ?? [];
    const prevMap = Object.fromEntries(prevKpis.map((k) => [k.id, k]));
    for (const k of currKpis) {
      const p = prevMap[k.id];
      if (!p || p.value === k.value) continue;
      if (typeof k.value === "number" && typeof p.value === "number") {
        const dir = k.value > p.value ? "up" : "down";
        changes.push({
          domain,
          kpiId: k.id,
          label: k.label,
          from: p.value,
          to: k.value,
          unit: k.unit ?? "",
          dir,
        });
      }
    }
  }

  const summary =
    changes.length === 0
      ? "No KPI movement vs last sweep."
      : `${changes.length} KPI(s) moved since last sweep.`;

  return { changes, summary, prevSweepAt: prev.meta?.generatedAt };
}
