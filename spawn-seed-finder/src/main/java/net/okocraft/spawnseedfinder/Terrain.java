package net.okocraft.spawnseedfinder;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Scores a ground height map against {@link Criteria}.
 *
 * <p>Shared by the fast noise-based search and the real-server verification so both rank seeds the same way.</p>
 */
public final class Terrain {

    /**
     * One column of the checked area.
     *
     * @param ground y of the first air block above the ground (ignoring trees and plants)
     * @param fluid  whether water, ice or lava covers the ground
     * @param biome  biome id at the ground, or {@code null} if it was not sampled
     */
    public record Column(int x, int z, int ground, boolean fluid, String biome) {
    }

    /**
     * @param level          platform level: median ground y under the platform
     * @param platformMin    lowest ground y under the platform
     * @param platformMax    highest ground y under the platform
     * @param platformMeanDev mean absolute deviation from {@code level} under the platform
     * @param marginExcess   mean height difference in the margin beyond a gentle 1-in-3 slope
     * @param marginMaxDiff  largest height difference from {@code level} in the margin
     * @param fluidColumns   columns covered by water, ice or lava (platform and margin)
     * @param biomeRatio     ratio of sampled columns in an accepted biome
     * @param score          lower is better
     */
    public record Stats(
        int level, int platformMin, int platformMax, double platformMeanDev,
        double marginExcess, int marginMaxDiff, int fluidColumns, double biomeRatio, double score
    ) {
        public int platformRange() {
            return this.platformMax - this.platformMin;
        }

        public boolean acceptable(Criteria criteria) {
            return this.fluidColumns == 0 && this.platformRange() <= criteria.maxRange() && this.biomeRatio >= criteria.minBiomeRatio();
        }
    }

    private Terrain() {
    }

    public static Stats evaluate(Criteria criteria, List<Column> columns) {
        List<Column> platform = new ArrayList<>();
        List<Column> margin = new ArrayList<>();
        int fluid = 0;
        int biomeSamples = 0;
        int biomeHits = 0;

        for (Column column : columns) {
            (criteria.inPlatform(column.x(), column.z()) ? platform : margin).add(column);
            if (column.fluid()) {
                fluid++;
            }
            if (column.biome() != null) {
                biomeSamples++;
                if (criteria.biomes().contains(column.biome())) {
                    biomeHits++;
                }
            }
        }

        int[] heights = platform.stream().mapToInt(Column::ground).toArray();
        Arrays.sort(heights);
        int level = heights[heights.length / 2];

        double platformDev = 0;
        for (int h : heights) {
            platformDev += Math.abs(h - level);
        }
        platformDev /= heights.length;

        double marginExcess = 0;
        int marginMax = 0;
        for (Column column : margin) {
            int diff = Math.abs(column.ground() - level);
            int tolerated = criteria.distanceFromPlatform(column.x(), column.z()) / 3;
            marginExcess += Math.max(0, diff - tolerated);
            marginMax = Math.max(marginMax, diff);
        }
        if (!margin.isEmpty()) {
            marginExcess /= margin.size();
        }

        double biomeRatio = biomeSamples == 0 ? 1.0 : (double) biomeHits / biomeSamples;
        int range = heights[heights.length - 1] - heights[0];
        double score = platformDev * 3 + range * 0.5 + marginExcess * 2 + (1 - biomeRatio) * 10 + fluid * 5;

        return new Stats(level, heights[0], heights[heights.length - 1], platformDev, marginExcess, marginMax, fluid, biomeRatio, score);
    }

    /**
     * Renders the area as text: {@code #} platform at level, {@code 1-9} higher, {@code a-z} lower,
     * {@code ~} fluid. Margin columns use the same digits/letters with {@code .} for "at level".
     */
    public static List<String> heightMap(Criteria criteria, List<Column> columns, int level) {
        int width = criteria.areaMaxX() - criteria.areaMinX() + 1;
        int length = criteria.areaMaxZ() - criteria.areaMinZ() + 1;
        char[][] rows = new char[length][width];
        for (char[] row : rows) {
            Arrays.fill(row, ' ');
        }
        for (Column column : columns) {
            int diff = column.ground() - level;
            char c;
            if (column.fluid()) {
                c = '~';
            } else if (diff == 0) {
                c = criteria.inPlatform(column.x(), column.z()) ? '#' : '.';
            } else if (diff > 0) {
                c = (char) ('0' + Math.min(9, diff));
            } else {
                c = (char) ('a' + Math.min(25, -diff - 1));
            }
            rows[column.z() - criteria.areaMinZ()][column.x() - criteria.areaMinX()] = c;
        }
        List<String> lines = new ArrayList<>(length);
        for (char[] row : rows) {
            lines.add(new String(row));
        }
        return lines;
    }
}
