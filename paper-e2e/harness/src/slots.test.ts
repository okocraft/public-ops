import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { cdsReadArgs, createSlot, removeSlot, slotDir } from "./slots.ts";

describe("slots", () => {
  it("links the heavy directories, copies plugins and removes the slot", () => {
    const root = mkdtempSync(join(tmpdir(), "e2e-slots-"));
    const server = join(root, "server");
    mkdirSync(join(server, "plugins"), { recursive: true });
    mkdirSync(join(server, "libraries"));
    writeFileSync(join(server, "plugins", "a.jar"), "jar");
    try {
      const slot = createSlot(server, 1);
      assert.equal(slot, slotDir(server, 1));
      assert.ok(lstatSync(join(slot, "libraries")).isSymbolicLink());
      assert.ok(lstatSync(join(slot, "plugins", "a.jar")).isFile());
      assert.ok(!lstatSync(join(slot, "plugins")).isSymbolicLink());
      removeSlot(server, 1);
      assert.ok(!existsSync(slot));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("only passes the archive flags when the archive exists", () => {
    const root = mkdtempSync(join(tmpdir(), "e2e-cds-"));
    try {
      assert.deepEqual(cdsReadArgs(root), []);
      mkdirSync(join(root, ".e2e"));
      writeFileSync(join(root, ".e2e", "app.jsa"), "x");
      assert.match(cdsReadArgs(root)[0] ?? "", /SharedArchiveFile=.*app\.jsa$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
