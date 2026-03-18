/** Stakeholder → which domain keys to include */
export const ROLE_DOMAINS = {
  authority: [
    "berth",
    "hinterland",
    "pre_gate",
    "gate",
    "yard",
    "customs",
    "revenue",
    "security",
    "pcs",
    "intel",
  ],
  customs: ["customs", "intel", "gate", "pcs", "pre_gate"],
  forwarder: [
    "hinterland",
    "pre_gate",
    "pcs",
    "gate",
    "yard",
    "berth",
    "customs",
  ],
  terminal: [
    "berth",
    "hinterland",
    "pre_gate",
    "yard",
    "gate",
    "pcs",
    "intel",
  ],
};

export function filterPayload(payload, role) {
  const allowed = ROLE_DOMAINS[role] ?? ROLE_DOMAINS.authority;
  const domains = {};
  for (const k of allowed) {
    if (payload.domains[k]) domains[k] = payload.domains[k];
  }
  return {
    ...payload,
    meta: {
      ...payload.meta,
      role,
    },
    domains,
  };
}
