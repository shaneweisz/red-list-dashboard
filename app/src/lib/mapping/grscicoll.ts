/**
 * Naming the institution that holds a specimen.
 *
 * A herbarium sheet's record often carries no institution code at all: GBIF
 * names the holder through its GrSciColl registry key instead, and the only
 * code on the record is the collection's ("Botany"). Read literally that made
 * Naturalis's sheets say they were held by Botany, so the key is resolved to
 * the registry's own name for the institution.
 *
 * One request per institution, then never again for the life of the page — a
 * species' records come from a handful of herbaria, so a few hundred records
 * cost a few lookups. A key that can't be resolved is remembered as such
 * rather than retried on every hover.
 */
const names = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();

/** The name if it's already known, `undefined` if it hasn't been looked up. */
export function knownInstitutionName(key: string): string | null | undefined {
  return names.get(key);
}

export async function fetchInstitutionName(key: string): Promise<string | null> {
  const known = names.get(key);
  if (known !== undefined) return known;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = (async () => {
    try {
      const res = await fetch(`https://api.gbif.org/v1/grscicoll/institution/${key}`);
      if (!res.ok) return null;
      const body: { name?: string } = await res.json();
      return body.name?.trim() || null;
    } catch {
      // Offline, or GBIF having a moment. The code the record carries is still
      // shown; this only ever adds a name to it.
      return null;
    }
  })().then((name) => {
    names.set(key, name);
    inFlight.delete(key);
    return name;
  });
  inFlight.set(key, request);
  return request;
}

/** Empties the cache. Tests only — the page never wants a second lookup. */
export function resetInstitutionNames() {
  names.clear();
  inFlight.clear();
}
