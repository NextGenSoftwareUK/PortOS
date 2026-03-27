/**
 * In-memory holon store.
 * One Map<Id, holon> per holon type.
 * All holons must carry an `Id` (string / UUID) field.
 */

/** @type {Map<string, Map<string, object>>} */
const _store = new Map();

function ensureType(type) {
  if (!_store.has(type)) _store.set(type, new Map());
  return _store.get(type);
}

/** Insert or replace a holon. Returns the holon. */
export function upsert(type, holon) {
  if (!holon?.Id) throw new Error(`Holon missing Id field (type=${type})`);
  ensureType(type).set(holon.Id, { ...holon, _type: type });
  return holon;
}

/** Get a single holon by id, or null. */
export function get(type, id) {
  return _store.get(type)?.get(id) ?? null;
}

/** List holons of a type, optionally filtered. */
export function list(type, predicate = null) {
  const map = _store.get(type);
  if (!map) return [];
  const arr = Array.from(map.values());
  return predicate ? arr.filter(predicate) : arr;
}

/** Count holons of a type, optionally filtered. */
export function count(type, predicate = null) {
  return list(type, predicate).length;
}

/** Patch fields on an existing holon. Returns updated holon or null. */
export function update(type, id, patch) {
  const map = _store.get(type);
  if (!map?.has(id)) return null;
  const updated = { ...map.get(id), ...patch };
  map.set(id, updated);
  return updated;
}

/** Remove a holon. */
export function remove(type, id) {
  _store.get(type)?.delete(id);
}

/** All registered holon types. */
export function allTypes() {
  return Array.from(_store.keys());
}

/** Count of holons for a type. */
export function typeCount(type) {
  return _store.get(type)?.size ?? 0;
}

/** { type: count } summary for all types. */
export function stats() {
  const out = {};
  for (const [type, map] of _store.entries()) out[type] = map.size;
  return out;
}

/** Total holon count across all types. */
export function totalCount() {
  let n = 0;
  for (const map of _store.values()) n += map.size;
  return n;
}

/** Clear all holons of a type (useful for re-seeding). */
export function clearType(type) {
  _store.get(type)?.clear();
}

/** Clear everything. */
export function clearAll() {
  _store.clear();
}
