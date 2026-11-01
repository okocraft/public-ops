package net.okocraft.spawnseedfinder;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Discord embed summarising a run. The full report (with height maps) is attached separately.
 */
final class DiscordMessage {

    static final int COLOR_FOUND = 0x57F287;
    static final int COLOR_NONE = 0xED4245;
    private static final int MAX_SEEDS = 10;
    private static final String[] RANKS = {"🥇", "🥈", "🥉"};

    /**
     * @param searched   number of searched seeds, or -1 for the verify command
     * @param candidates number of noise-stage candidates
     * @param failures   seeds whose verification failed
     */
    record Run(Criteria criteria, String version, long searched, int candidates, List<ServerVerifier.Result> results, int failures, Instant time) {
    }

    private DiscordMessage() {
    }

    static JsonObject build(Run run) {
        Criteria criteria = run.criteria();
        List<ServerVerifier.Result> ok = run.results().stream().filter(r -> r.stats().acceptable(criteria)).toList();
        List<ServerVerifier.Result> rejected = run.results().stream().filter(r -> !r.stats().acceptable(criteria)).toList();

        JsonObject embed = new JsonObject();
        embed.addProperty("title", ok.isEmpty() ? "スポーンシード探索: 該当なし" : "スポーンシード探索: " + ok.size() + " 件見つかりました");
        embed.addProperty("color", ok.isEmpty() ? COLOR_NONE : COLOR_FOUND);
        embed.addProperty("description", description(run));
        embed.addProperty("timestamp", run.time().toString());

        JsonArray fields = new JsonArray();
        for (int i = 0; i < Math.min(ok.size(), MAX_SEEDS); i++) {
            ServerVerifier.Result r = ok.get(i);
            Terrain.Stats s = r.stats();
            String rank = i < RANKS.length ? RANKS[i] + " " + (i + 1) + " 位" : (i + 1) + " 位";
            String value = String.format(Locale.ROOT,
                "```%n%d%n```地表 **Y%d**（%d〜%d, 高低差 %d）%n伐採が必要な木 %d 列 ・ 対象バイオーム %.0f%%",
                r.seed(), s.level(), s.platformMin(), s.platformMax(), s.platformRange(), r.treeColumns(), s.biomeRatio() * 100);
            fields.add(field(rank, value, false));
        }
        if (ok.size() > MAX_SEEDS) {
            fields.add(field("ほか " + (ok.size() - MAX_SEEDS) + " 件", "添付のレポートを参照してください", false));
        }
        if (ok.isEmpty()) {
            fields.add(field("該当なし", "条件を満たすシードはありませんでした。探索数を増やすか、条件を緩めてください。", false));
        }
        if (!rejected.isEmpty() || run.failures() > 0) {
            List<String> lines = new ArrayList<>();
            for (ServerVerifier.Result r : rejected) {
                lines.add("・" + String.join(" / ", problems(criteria, r.stats())));
            }
            if (run.failures() > 0) {
                lines.add("・検証に失敗: " + run.failures() + " 件");
            }
            fields.add(field("実サーバーで除外（" + (rejected.size() + run.failures()) + " 件）", String.join("\n", lines), false));
        }
        embed.add("fields", fields);

        JsonObject footer = new JsonObject();
        footer.addProperty("text", "高さマップ付きの詳細レポートを添付しています ・ spawn-seed-finder");
        embed.add("footer", footer);

        JsonArray embeds = new JsonArray();
        embeds.add(embed);
        JsonObject message = new JsonObject();
        message.add("embeds", embeds);
        return message;
    }

    private static String description(Run run) {
        Criteria c = run.criteria();
        String searched = run.searched() < 0
            ? "指定シードを検証"
            : String.format(Locale.ROOT, "%,d シード探索 → 候補 %d 件 → 実サーバー検証 %d 件",
                run.searched(), run.candidates(), run.results().size() + run.failures());
        return String.join("\n",
            "**バイオーム** " + String.join(", ", c.biomes().stream().map(b -> "`" + b + "`").sorted().toList()),
            String.format(Locale.ROOT, "**プラットフォーム** %d×%d（中心 %d, %d）・ 高低差 %d 以内 ・ 周囲 %d マス",
                c.sizeX(), c.sizeZ(), c.centerX(), c.centerZ(), c.maxRange(), c.margin()),
            "**Minecraft** " + run.version() + " ・ " + searched
        );
    }

    static List<String> problems(Criteria criteria, Terrain.Stats stats) {
        List<String> problems = new ArrayList<>();
        if (stats.fluidColumns() > 0) {
            problems.add("水・溶岩あり（" + stats.fluidColumns() + " 列）");
        }
        if (stats.platformRange() > criteria.maxRange()) {
            problems.add("高低差 " + stats.platformRange() + "（Y" + stats.platformMin() + "〜" + stats.platformMax() + "）");
        }
        if (stats.biomeRatio() < criteria.minBiomeRatio()) {
            problems.add(String.format(Locale.ROOT, "対象バイオーム %.0f%%", stats.biomeRatio() * 100));
        }
        return problems;
    }

    private static JsonObject field(String name, String value, boolean inline) {
        JsonObject field = new JsonObject();
        field.addProperty("name", truncate(name, 256));
        field.addProperty("value", truncate(value, 1024));
        field.addProperty("inline", inline);
        return field;
    }

    private static String truncate(String value, int max) {
        return value.length() <= max ? value : value.substring(0, max - 1) + "…";
    }
}
