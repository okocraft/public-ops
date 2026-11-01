package net.okocraft.spawnseedfinder;

import java.util.Set;

/**
 * What a good spawn looks like.
 *
 * <p>The platform covers the columns {@code [centerX + offsetX, centerX + offsetX + sizeX)} and
 * {@code [centerZ + offsetZ, centerZ + offsetZ + sizeZ)}; {@code margin} more columns around it are checked
 * so that the platform blends into its surroundings.</p>
 *
 * @param biomes        accepted biome ids (for example {@code minecraft:taiga}); the platform centre must be one of them
 * @param centerX       x of the paste origin (the world spawn)
 * @param centerZ       z of the paste origin (the world spawn)
 * @param offsetX       x offset of the platform's first column from the origin
 * @param offsetZ       z offset of the platform's first column from the origin
 * @param sizeX         platform width
 * @param sizeZ         platform length
 * @param margin        columns checked around the platform
 * @param minBiomeRatio minimum ratio of accepted biomes over the platform and the margin
 * @param maxRange      maximum height difference (max - min) of the ground under the platform
 */
public record Criteria(
    Set<String> biomes,
    int centerX, int centerZ,
    int offsetX, int offsetZ,
    int sizeX, int sizeZ,
    int margin,
    double minBiomeRatio,
    int maxRange
) {

    public int platformMinX() {
        return this.centerX + this.offsetX;
    }

    public int platformMaxX() {
        return this.platformMinX() + this.sizeX - 1;
    }

    public int platformMinZ() {
        return this.centerZ + this.offsetZ;
    }

    public int platformMaxZ() {
        return this.platformMinZ() + this.sizeZ - 1;
    }

    public int areaMinX() {
        return this.platformMinX() - this.margin;
    }

    public int areaMaxX() {
        return this.platformMaxX() + this.margin;
    }

    public int areaMinZ() {
        return this.platformMinZ() - this.margin;
    }

    public int areaMaxZ() {
        return this.platformMaxZ() + this.margin;
    }

    public boolean inPlatform(int x, int z) {
        return this.platformMinX() <= x && x <= this.platformMaxX() && this.platformMinZ() <= z && z <= this.platformMaxZ();
    }

    /**
     * Distance (in columns) from the platform edge, 0 inside the platform.
     */
    public int distanceFromPlatform(int x, int z) {
        int dx = Math.max(0, Math.max(this.platformMinX() - x, x - this.platformMaxX()));
        int dz = Math.max(0, Math.max(this.platformMinZ() - z, z - this.platformMaxZ()));
        return Math.max(dx, dz);
    }
}
