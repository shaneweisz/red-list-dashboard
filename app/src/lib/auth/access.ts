// Allowlist gating access to features that require more than "logged in" —
// currently unused, wired up by a follow-up PR for the IUCN range map layer.
const DEFAULT_ALLOWED_EMAILS = ["shaneweisz@gmail.com"];

function allowedEmails(): string[] {
  const fromEnv = process.env.RANGE_MAP_ALLOWED_EMAILS;
  if (!fromEnv) return DEFAULT_ALLOWED_EMAILS;
  return fromEnv
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isRangeMapAuthorized(email: string | null | undefined): boolean {
  if (!email) return false;
  return allowedEmails().includes(email.toLowerCase());
}
