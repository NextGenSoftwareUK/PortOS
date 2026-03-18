/** @type {Record<string, number>} */
let baseline = {};

export function resetState(seed = {}) {
  baseline = { ...seed };
}

function ensure(key, fallback) {
  if (baseline[key] === undefined) baseline[key] = fallback;
  return baseline[key];
}

/** Integer KPI: small random walk */
export function walkInt(key, min, max, spread = 2) {
  const cur = ensure(key, Math.floor((min + max) / 2));
  const d = Math.floor(Math.random() * (spread * 2 + 1)) - spread;
  const next = Math.max(min, Math.min(max, cur + d));
  baseline[key] = next;
  return next;
}

/** Float / money: proportional drift */
export function walkMoney(key, center, variancePct = 0.02) {
  const cur = ensure(key, center);
  const factor = 1 + (Math.random() * 2 - 1) * variancePct;
  const next = Math.max(0, Math.round(cur * factor));
  baseline[key] = next;
  return next;
}
