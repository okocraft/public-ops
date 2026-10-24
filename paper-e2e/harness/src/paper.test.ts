import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chooseClientVersion } from "./bot.ts";
import { PaperServer, serverProperties } from "./paper.ts";

describe("serverProperties", () => {
  it("binds the unauthenticated server to loopback by default", () => {
    const properties = serverProperties();
    assert.match(properties, /^online-mode=false$/m);
    assert.match(properties, /^server-ip=127\.0\.0\.1$/m);
  });

  it("refuses online-mode=false on a public address", () => {
    assert.throws(() => serverProperties({ "server-ip": "0.0.0.0" }));
    assert.throws(() => serverProperties({ "server-ip": "" }));
  });

  it("allows a public address when authentication is enabled", () => {
    assert.doesNotThrow(() => serverProperties({ "online-mode": "true", "server-ip": "0.0.0.0" }));
  });
});

describe("chooseClientVersion", () => {
  it("uses the server version when the client supports it", () => {
    assert.deepEqual(chooseClientVersion("26.1", ["1.21.11", "26.1"]), {
      version: "26.1",
      needsTranslation: false,
    });
  });

  it("falls back to the newest client and flags translation", () => {
    assert.deepEqual(chooseClientVersion("26.3", ["1.21.11", "26.1"]), {
      version: "26.1",
      needsTranslation: true,
    });
  });
});

describe("PaperServer.errors", () => {
  it("skips known noise and keeps real errors", () => {
    const server = new PaperServer({ dir: "/nonexistent" });
    server.lines.push(
      "[10:00:00 ERROR]: No key layers in MapLike[{}]",
      "[10:00:01 ERROR]: Could not load plugin",
      "[10:00:02 INFO]: Done",
    );
    assert.deepEqual(server.errors(), ["[10:00:01 ERROR]: Could not load plugin"]);
  });
});
