import { describe, it, expect, vi, afterEach } from "vitest";
import { loadCompiler, saveCompiler } from "../CompilerDialog";

describe("remembering who compiles the point file", () => {
  const store = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  };

  afterEach(() => vi.unstubAllGlobals());

  it("has nothing to offer before anyone has saved one", () => {
    vi.stubGlobal("window", { localStorage: store() });
    expect(loadCompiler()).toBe("");
  });

  it("offers the name back on the next save", () => {
    vi.stubGlobal("window", { localStorage: store() });
    saveCompiler("R. C. McGregor");
    expect(loadCompiler()).toBe("R. C. McGregor");
  });

  it("keeps the most recent name, since a handover is a real thing", () => {
    vi.stubGlobal("window", { localStorage: store() });
    saveCompiler("R. C. McGregor");
    saveCompiler("E. H. Walker");
    expect(loadCompiler()).toBe("E. H. Walker");
  });

  it("lets the name be cleared", () => {
    vi.stubGlobal("window", { localStorage: store() });
    saveCompiler("R. C. McGregor");
    saveCompiler("");
    expect(loadCompiler()).toBe("");
  });

  it("survives a browser that refuses storage rather than losing the file", () => {
    // A private window throws on both; neither is a reason to refuse a save.
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => { throw new Error("denied"); },
        setItem: () => { throw new Error("denied"); },
      },
    });
    expect(() => saveCompiler("R. C. McGregor")).not.toThrow();
    expect(loadCompiler()).toBe("");
  });

  it("says nothing on the server, where there is no storage to read", () => {
    vi.stubGlobal("window", undefined);
    expect(loadCompiler()).toBe("");
    expect(() => saveCompiler("R. C. McGregor")).not.toThrow();
  });
});
