import { defineScenario } from "../src/scenario.ts";
import { sleep } from "../src/text.ts";

/**
 * Plugin-agnostic example (a TESTING.md `OP-xxx` would normally be mapped 1:1 to a file like this):
 * a death is announced exactly once to every player, and the victim receives the death screen data.
 */
export default defineScenario({
  id: "OP-EXAMPLE-001",
  title: "Death message is broadcast once to every player",
  covers: ["VP-EXAMPLE-001"],
  bots: ["A", "B", "C"],
  async run(env, recorder) {
    env.clearAll();
    env.server.command("kill C");
    await sleep(2000);

    for (const name of ["A", "B", "C"]) {
      const received = env
        .bot(name)
        .messages.filter((message) => message.translate?.startsWith("death.") === true);
      recorder.check(
        `OP-EXAMPLE-001:${name}`,
        `${name} receives the death message exactly once`,
        received.length === 1,
        `received ${received.length}: ${JSON.stringify(received.map((message) => message.text))}`,
        ["VP-EXAMPLE-001"],
      );
    }

    const deathScreen = env.bot("C").packets.filter((packet) => packet.name.includes("death"));
    recorder.check(
      "OP-EXAMPLE-001:screen",
      "The victim receives death screen data from the server",
      deathScreen.length === 1,
      `${deathScreen.length} packet(s): ${deathScreen.map((packet) => packet.name).join(", ")}`,
      ["VP-EXAMPLE-001"],
    );
  },
});
