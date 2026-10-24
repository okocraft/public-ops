import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickLuckPermsBukkit } from "./download.ts";

describe("pickLuckPermsBukkit", () => {
  it("returns the Bukkit loader jar", () => {
    const picked = pickLuckPermsBukkit({
      downloads: {
        bukkit: "https://download.luckperms.net/1675/bukkit/loader/LuckPerms-Bukkit-5.5.88.jar",
        fabric: "https://download.luckperms.net/1675/fabric/LuckPerms-Fabric-5.5.88.jar",
      },
    });
    assert.equal(picked.fileName, "LuckPerms-Bukkit-5.5.88.jar");
  });

  it("fails when there is no Bukkit download", () => {
    assert.throws(() => pickLuckPermsBukkit({ downloads: {} }));
    assert.throws(() => pickLuckPermsBukkit({}));
  });
});
