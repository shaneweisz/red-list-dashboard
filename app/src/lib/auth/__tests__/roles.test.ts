import { describe, it, expect, vi } from "vitest";
import { hasRole, isAdmin } from "../roles";

function mockSupabase(row: { role: string } | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row });
  const eq2 = vi.fn().mockReturnValue({ maybeSingle });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  const from = vi.fn().mockReturnValue({ select });
  return { from, _spies: { from, select, eq1, eq2, maybeSingle } } as unknown as Parameters<typeof hasRole>[0];
}

describe("hasRole", () => {
  it("returns true when a matching row exists", async () => {
    const supabase = mockSupabase({ role: "admin" });
    await expect(hasRole(supabase, "user-1", "admin")).resolves.toBe(true);
  });

  it("returns false when no matching row exists", async () => {
    const supabase = mockSupabase(null);
    await expect(hasRole(supabase, "user-1", "admin")).resolves.toBe(false);
  });

  it("queries the user_roles table filtered by user_id and role", async () => {
    const supabase = mockSupabase({ role: "admin" });
    await hasRole(supabase, "user-1", "admin");
    const spies = (supabase as unknown as { _spies: Record<string, ReturnType<typeof vi.fn>> })._spies;
    expect(spies.from).toHaveBeenCalledWith("user_roles");
    expect(spies.eq1).toHaveBeenCalledWith("user_id", "user-1");
    expect(spies.eq2).toHaveBeenCalledWith("role", "admin");
  });
});

describe("isAdmin", () => {
  it("returns false for null/undefined userId without querying", async () => {
    const supabase = mockSupabase({ role: "admin" });
    expect(await isAdmin(supabase, null)).toBe(false);
    expect(await isAdmin(supabase, undefined)).toBe(false);
  });

  it("returns true when the user has the admin role", async () => {
    const supabase = mockSupabase({ role: "admin" });
    expect(await isAdmin(supabase, "user-1")).toBe(true);
  });

  it("returns false when the user has no admin row", async () => {
    const supabase = mockSupabase(null);
    expect(await isAdmin(supabase, "user-1")).toBe(false);
  });
});
