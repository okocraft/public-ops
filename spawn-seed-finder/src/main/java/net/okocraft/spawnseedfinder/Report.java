package net.okocraft.spawnseedfinder;

import java.util.List;
import java.util.Locale;

/**
 * Markdown report of a run.
 */
final class Report {

    private final StringBuilder out = new StringBuilder();

    Report header(Criteria criteria, String version) {
        this.out.append("# Spawn seed report\n\n");
        this.out.append("- Minecraft: ").append(version).append('\n');
        this.out.append("- Biomes: ").append(String.join(", ", criteria.biomes())).append('\n');
        this.out.append(String.format(Locale.ROOT, "- Platform: %dx%d, x %d..%d, z %d..%d (origin %d,%d), margin %d%n",
            criteria.sizeX(), criteria.sizeZ(), criteria.platformMinX(), criteria.platformMaxX(),
            criteria.platformMinZ(), criteria.platformMaxZ(), criteria.centerX(), criteria.centerZ(), criteria.margin()));
        this.out.append(String.format(Locale.ROOT, "- Limits: height range <= %d, biome ratio >= %.2f, no water/lava%n%n",
            criteria.maxRange(), criteria.minBiomeRatio()));
        return this;
    }

    Report noiseCandidates(String title, List<NoiseSearch.Candidate> candidates) {
        this.out.append("## ").append(title).append("\n\n");
        if (candidates.isEmpty()) {
            this.out.append("No seed matched.\n\n");
            return this;
        }
        this.out.append("| # | seed | score | level | ground min..max | margin excess | margin max diff | biome ratio |\n");
        this.out.append("|---|---|---|---|---|---|---|---|\n");
        int i = 1;
        for (NoiseSearch.Candidate candidate : candidates) {
            Terrain.Stats s = candidate.stats();
            this.out.append(String.format(Locale.ROOT, "| %d | `%d` | %.2f | %d | %d..%d | %.2f | %d | %.2f |%n",
                i++, candidate.seed(), s.score(), s.level(), s.platformMin(), s.platformMax(), s.marginExcess(), s.marginMaxDiff(), s.biomeRatio()));
        }
        this.out.append('\n');
        return this;
    }

    Report verified(List<ServerVerifier.Result> results, Criteria criteria) {
        this.out.append("## Verified on a Paper server\n\n");
        this.out.append("Ground levels exclude trees and plants. `trees` = platform columns with a trunk to clear.\n\n");
        this.out.append("| verdict | seed | score | level | ground min..max | water/lava columns | lava | trees | biome ratio | server spawn |\n");
        this.out.append("|---|---|---|---|---|---|---|---|---|---|\n");
        for (ServerVerifier.Result r : results) {
            Terrain.Stats s = r.stats();
            this.out.append(String.format(Locale.ROOT, "| %s | `%d` | %.2f | %d | %d..%d | %d | %d | %d | %.2f | %s |%n",
                s.acceptable(criteria) ? "OK" : "NG", r.seed(), s.score(), s.level(), s.platformMin(), s.platformMax(),
                s.fluidColumns(), r.lavaColumns(), r.treeColumns(), s.biomeRatio(), r.spawn()));
        }
        this.out.append("\nHeight maps: `#` platform at level, `.` margin at level, `1-9` higher, `a-z` lower (a = 1 below), `~` water/lava. North is up.\n\n");
        for (ServerVerifier.Result r : results) {
            this.out.append("### `").append(r.seed()).append("` (level ").append(r.stats().level()).append(")\n\n```\n");
            r.heightMap().forEach(line -> this.out.append(line).append('\n'));
            this.out.append("```\n\n");
        }
        return this;
    }

    Report failure(long seed, Exception e) {
        if (this.out.isEmpty()) {
            this.out.append("## Verification failures\n\n");
        }
        this.out.append("- `").append(seed).append("`: verification failed: ").append(e.getMessage()).append("\n");
        return this;
    }

    Report append(Report other) {
        this.out.append(other.out);
        return this;
    }

    @Override
    public String toString() {
        return this.out.toString();
    }
}
