import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHelperLine, toPosition } from "./helper-log.ts";

describe("parseHelperLine", () => {
  it("parses a tagged line with fields", () => {
    const line =
      "[12:00:00 INFO]: [E2EHelper] E2E POS player=N world=minecraft:overworld x=1.50 y=-60.00 z=2.50 vehicle=none";
    const parsed = parseHelperLine(line);
    assert.equal(parsed?.tag, "POS");
    assert.equal(parsed?.fields["world"], "minecraft:overworld");
  });

  it("ignores ordinary log lines", () => {
    assert.equal(parseHelperLine("[12:00:00 INFO]: Done (3.2s)!"), null);
  });

  it("strips ANSI colours", () => {
    assert.equal(parseHelperLine("\u001b[93mE2E EXISTS id=abc value=true\u001b[0m")?.tag, "EXISTS");
  });
});

describe("toPosition", () => {
  it("converts a POS line", () => {
    const position = toPosition({
      tag: "POS",
      fields: {
        player: "N",
        world: "minecraft:overworld",
        x: "1.5",
        y: "-60",
        z: "2.5",
        vehicle: "none",
      },
    });
    assert.deepEqual(position, {
      player: "N",
      world: "minecraft:overworld",
      x: 1.5,
      y: -60,
      z: 2.5,
      vehicle: null,
    });
  });

  it("rejects malformed numbers", () => {
    assert.equal(
      toPosition({ tag: "POS", fields: { player: "N", world: "w", x: "a", y: "1", z: "2" } }),
      null,
    );
  });
});
