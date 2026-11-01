package net.okocraft.spawnseedfinder;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DiscordMessageTest {

    static final Criteria TAIGA = new Criteria(Set.of("minecraft:taiga"), 0, 0, -15, -15, 31, 31, 10, 0.9, 3);
    static final Instant TIME = Instant.parse("2026-11-01T14:00:00Z");

    static ServerVerifier.Result result(long seed, int min, int max, int fluid, double biome) {
        Terrain.Stats stats = new Terrain.Stats(64, min, max, 0.2, 0.1, 3, fluid, biome, 1.0);
        return new ServerVerifier.Result(seed, stats, 0, 25, "0,64,0", List.of());
    }

    @Test
    void listsAcceptedSeedsAsFields() {
        JsonObject embed = embed(DiscordMessage.build(new DiscordMessage.Run(TAIGA, "26.3", 100_000, 98, List.of(
            result(111L, 63, 65, 0, 1.0),
            result(222L, 50, 70, 0, 1.0),
            result(333L, 63, 64, 59, 1.0)
        ), 1, TIME)));

        assertEquals("スポーンシード探索: 1 件見つかりました", embed.get("title").getAsString());
        assertEquals(DiscordMessage.COLOR_FOUND, embed.get("color").getAsInt());
        assertEquals("2026-11-01T14:00:00Z", embed.get("timestamp").getAsString());
        assertTrue(embed.get("description").getAsString().contains("`minecraft:taiga`"));
        assertTrue(embed.get("description").getAsString().contains("100,000 シード探索 → 候補 98 件 → 実サーバー検証 4 件"));

        JsonArray fields = embed.getAsJsonArray("fields");
        assertEquals(2, fields.size());
        JsonObject first = fields.get(0).getAsJsonObject();
        assertEquals("🥇 1 位", first.get("name").getAsString());
        assertTrue(first.get("value").getAsString().startsWith("```\n111\n```地表 **Y64**（63〜65, 高低差 2）"), first.toString());

        JsonObject rejected = fields.get(1).getAsJsonObject();
        assertEquals("実サーバーで除外（3 件）", rejected.get("name").getAsString());
        assertEquals("・高低差 20（Y50〜70）\n・水・溶岩あり（59 列）\n・検証に失敗: 1 件", rejected.get("value").getAsString());
        // rejected seeds are not listed
        assertTrue(!rejected.toString().contains("222") && !rejected.toString().contains("333"));
    }

    @Test
    void saysSoWhenNothingFits() {
        JsonObject embed = embed(DiscordMessage.build(new DiscordMessage.Run(TAIGA, "26.3", 1000, 0, List.of(), 0, TIME)));
        assertEquals("スポーンシード探索: 該当なし", embed.get("title").getAsString());
        assertEquals(DiscordMessage.COLOR_NONE, embed.get("color").getAsInt());
        assertEquals("該当なし", embed.getAsJsonArray("fields").get(0).getAsJsonObject().get("name").getAsString());
    }

    @Test
    void staysWithinDiscordLimits() {
        List<ServerVerifier.Result> many = java.util.stream.LongStream.range(0, 30).mapToObj(i -> result(-1_000_000_000_000_000_000L - i, 63, 65, 0, 1.0)).toList();
        JsonObject embed = embed(DiscordMessage.build(new DiscordMessage.Run(TAIGA, "26.3", 1_000_000, 30, many, 0, TIME)));
        JsonArray fields = embed.getAsJsonArray("fields");
        assertTrue(fields.size() <= 25);
        assertEquals("ほか 20 件", fields.get(fields.size() - 1).getAsJsonObject().get("name").getAsString());
        int total = embed.get("title").getAsString().length() + embed.get("description").getAsString().length()
            + embed.getAsJsonObject("footer").get("text").getAsString().length();
        for (var field : fields) {
            total += field.getAsJsonObject().get("name").getAsString().length() + field.getAsJsonObject().get("value").getAsString().length();
        }
        assertTrue(total <= 6000, "embed has " + total + " characters");
    }

    private static JsonObject embed(JsonObject message) {
        return message.getAsJsonArray("embeds").get(0).getAsJsonObject();
    }
}
