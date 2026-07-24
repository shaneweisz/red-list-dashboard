// Range maps are restricted for now — the only source of truth is the
// RANGE_MAP_ALLOWED_EMAILS env var (comma-separated), so nobody's email is
// hardcoded in the codebase. Unset/empty means nobody is authorized.
export function isRangeMapAuthorized(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowed = (process.env.RANGE_MAP_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}
