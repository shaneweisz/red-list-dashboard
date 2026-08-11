/**
 * The export gate. CSV leaving the dashboard is the step that needs admin
 * access — a signed-in account isn't the bar, since anyone can get one — so the
 * check lives in the route rather than only in the button's disabled state, and
 * these cover it at the level that actually enforces it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn();
const isAdmin = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

vi.mock("@/lib/auth/roles", () => ({
  isAdmin: (...args: unknown[]) => isAdmin(...args),
}));

import { POST } from "../route";

function postWith(body: unknown): Parameters<typeof POST>[0] {
  return { json: async () => body } as Parameters<typeof POST>[0];
}

const validRow = {
  gbifID: 1234567890,
  decimalLatitude: 1.1958,
  decimalLongitude: -76.9256,
  coordinateUncertaintyInMeters: 1500,
  georeferencedDate: "2026-08-11T10:00:00.000Z",
  verbatimLocality: "Indian garden. Valle de Sibundoy, 1.5 km. SW Sibundoy.",
};

/** Signed in AND an admin — the only combination allowed to export. */
function admin(email = "assessor@example.org") {
  getUser.mockResolvedValue({ data: { user: { id: "user-1", email } } });
  isAdmin.mockResolvedValue(true);
}

/** Signed in with an ordinary account: anyone can get one of those. */
function signedInNonAdmin(email = "stranger@example.org") {
  getUser.mockResolvedValue({ data: { user: { id: "user-2", email } } });
  isAdmin.mockResolvedValue(false);
}

function signedOut() {
  getUser.mockResolvedValue({ data: { user: null } });
  isAdmin.mockResolvedValue(false);
}

describe("POST /api/georeferences/export", () => {
  beforeEach(() => {
    getUser.mockReset();
    isAdmin.mockReset();
  });

  it("refuses a signed-out request", async () => {
    signedOut();
    const response = await POST(postWith({ speciesKey: "6CX6F", georeferences: [validRow] }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/sign in/i) });
  });

  it("refuses a signed-in account without admin access", async () => {
    signedInNonAdmin();
    const response = await POST(postWith({ speciesKey: "6CX6F", georeferences: [validRow] }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/not authorized/i),
    });
  });

  it("returns a Darwin Core CSV attachment for an admin", async () => {
    admin();
    const response = await POST(
      postWith({ speciesKey: "6CX6F", scientificName: "Dioscorea biplicata", georeferences: [validRow] })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/text\/csv/);
    expect(response.headers.get("Content-Disposition")).toContain("dioscorea-biplicata-georeferences.csv");

    const [header, row] = (await response.text()).split("\n");
    expect(header.split(",")).toContain("coordinateUncertaintyInMeters");
    expect(row).toContain("1234567890");
    expect(row).toContain("WGS84");
  });

  it("stamps the signed-in account as georeferencedBy when the row doesn't name one", async () => {
    admin("thom@example.org");
    const response = await POST(postWith({ speciesKey: "6CX6F", georeferences: [validRow] }));
    expect(await response.text()).toContain("thom@example.org");
  });

  it("rejects a row with no uncertainty radius, which can't feed an EOO/AOO", async () => {
    admin();
    const response = await POST(
      postWith({
        speciesKey: "6CX6F",
        georeferences: [{ ...validRow, coordinateUncertaintyInMeters: null }],
      })
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: [expect.stringMatching(/uncertainty/i)],
    });
  });

  it("rejects out-of-range coordinates rather than exporting them", async () => {
    admin();
    const response = await POST(
      postWith({ speciesKey: "6CX6F", georeferences: [{ ...validRow, decimalLatitude: 91 }] })
    );
    expect(response.status).toBe(400);
  });

  it("rejects an empty export", async () => {
    admin();
    const response = await POST(postWith({ speciesKey: "6CX6F", georeferences: [] }));
    expect(response.status).toBe(400);
  });

  it("checks authorization before looking at the payload", async () => {
    signedInNonAdmin();
    const response = await POST(postWith({ georeferences: [{ nonsense: true }] }));
    expect(response.status).toBe(403);
  });
});
