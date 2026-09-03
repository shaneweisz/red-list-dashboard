import { describe, it, expect } from "vitest";
import {
  canRedo,
  canUndo,
  commit,
  historyLines,
  initHistory,
  jumpBack,
  redo,
  redoLabel,
  undo,
  undoLabel,
} from "../edit-history";

const t = (n: number) => `2026-08-17T00:0${n}:00.000Z`;

describe("initHistory", () => {
  it("starts with nowhere to go", () => {
    const h = initHistory({ n: 0 });
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(undoLabel(h)).toBeNull();
  });
});

describe("commit", () => {
  it("moves the present back and takes the new state", () => {
    const h = commit(initHistory({ n: 0 }), { n: 1 }, "exclude 4 records", t(1));
    expect(h.present.state).toEqual({ n: 1 });
    expect(h.past[0].state).toEqual({ n: 0 });
    expect(canUndo(h)).toBe(true);
  });

  /** The label describes the action that produced the state, so it's what undo takes back. */
  it("labels undo with the action that would be taken back", () => {
    const h = commit(initHistory({ n: 0 }), { n: 1 }, "exclude 4 records", t(1));
    expect(undoLabel(h)).toBe("exclude 4 records");
  });

  it("keeps the most recent states within the limit", () => {
    let h = initHistory({ n: 0 });
    for (let i = 1; i <= 5; i++) h = commit(h, { n: i }, `edit ${i}`, t(i), 3);
    expect(h.past).toHaveLength(3);
    expect(h.past.map((p) => p.state.n)).toEqual([4, 3, 2]);
  });

  /**
   * Redo only means "the thing I just undid". A fresh edit makes that branch
   * unreachable, so keeping it would offer to reapply an edit already worked past.
   */
  it("drops the redo branch once a new edit lands", () => {
    let h = commit(initHistory({ n: 0 }), { n: 1 }, "one", t(1));
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    h = commit(h, { n: 2 }, "two", t(2));
    expect(canRedo(h)).toBe(false);
  });
});

describe("undo and redo", () => {
  const three = () => {
    let h = initHistory({ n: 0 });
    h = commit(h, { n: 1 }, "one", t(1));
    h = commit(h, { n: 2 }, "two", t(2));
    h = commit(h, { n: 3 }, "three", t(3));
    return h;
  };

  it("walks back and forward through the same states", () => {
    let h = three();
    h = undo(h);
    expect(h.present.state).toEqual({ n: 2 });
    h = undo(h);
    expect(h.present.state).toEqual({ n: 1 });
    h = redo(h);
    expect(h.present.state).toEqual({ n: 2 });
    h = redo(h);
    expect(h.present.state).toEqual({ n: 3 });
    expect(canRedo(h)).toBe(false);
  });

  it("names what each button would do", () => {
    let h = three();
    expect(undoLabel(h)).toBe("three");
    h = undo(h);
    expect(undoLabel(h)).toBe("two");
    expect(redoLabel(h)).toBe("three");
  });

  it("does nothing at either end rather than throwing", () => {
    const start = initHistory({ n: 0 });
    expect(undo(start)).toBe(start);
    expect(redo(start)).toBe(start);
    let h = three();
    h = undo(undo(undo(h)));
    expect(h.present.state).toEqual({ n: 0 });
    expect(undo(h)).toBe(h);
  });

  it("returns to the first loaded state, which has no label", () => {
    let h = three();
    h = undo(undo(undo(h)));
    expect(h.present.label).toBeNull();
    expect(canUndo(h)).toBe(false);
  });
});

describe("jumpBack", () => {
  const five = () => {
    let h = initHistory({ n: 0 });
    for (let i = 1; i <= 5; i++) h = commit(h, { n: i }, `edit ${i}`, t(i));
    return h;
  };

  it("goes back several steps at once", () => {
    const h = jumpBack(five(), 2);
    expect(h.present.state).toEqual({ n: 2 });
  });

  // Everything stepped over has to stay redoable, in order.
  it("leaves the skipped edits ready to redo in order", () => {
    let h = jumpBack(five(), 2);
    expect(h.future.map((f) => f.state.n)).toEqual([3, 4, 5]);
    h = redo(h);
    expect(h.present.state).toEqual({ n: 3 });
  });

  it("ignores an index outside the list", () => {
    const h = five();
    expect(jumpBack(h, -1)).toBe(h);
    expect(jumpBack(h, 99)).toBe(h);
  });
});

describe("historyLines", () => {
  it("lists the session newest first, with the present marked", () => {
    let h = initHistory({ n: 0 });
    h = commit(h, { n: 1 }, "add a georeference", t(1));
    h = commit(h, { n: 2 }, "exclude 4 records", t(2));
    const lines = historyLines(h);
    expect(lines.map((l) => l.label)).toEqual(["exclude 4 records", "add a georeference"]);
    expect(lines[0]).toMatchObject({ stepsBack: 0, undone: false, at: t(2) });
    expect(lines[1].stepsBack).toBe(1);
  });

  // Having just pressed undo, the thing you most want to see is what came off.
  it("keeps undone edits in the list, marked as undone", () => {
    let h = initHistory({ n: 0 });
    h = commit(h, { n: 1 }, "one", t(1));
    h = commit(h, { n: 2 }, "two", t(2));
    h = undo(h);
    const lines = historyLines(h);
    expect(lines.map((l) => [l.label, l.undone])).toEqual([
      ["two", true],
      ["one", false],
    ]);
  });

  it("says nothing about a session with no edits", () => {
    expect(historyLines(initHistory({ n: 0 }))).toEqual([]);
  });
});
