package net.okocraft.spawnseedfinder;

import net.minecraft.SharedConstants;
import net.minecraft.core.Holder;
import net.minecraft.core.HolderGetter;
import net.minecraft.core.HolderLookup;
import net.minecraft.core.registries.Registries;
import net.minecraft.data.registries.VanillaRegistries;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.level.LevelHeightAccessor;
import net.minecraft.world.level.NoiseColumn;
import net.minecraft.world.level.biome.BiomeResolver;
import net.minecraft.world.level.biome.MultiNoiseBiomeSource;
import net.minecraft.world.level.biome.MultiNoiseBiomeSourceParameterLists;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.levelgen.NoiseBasedChunkGenerator;
import net.minecraft.world.level.levelgen.NoiseGeneratorSettings;
import net.minecraft.world.level.levelgen.RandomState;
import net.minecraft.world.level.levelgen.synth.NormalNoise;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

/**
 * The vanilla overworld generator, built from the server's own registries without starting a server.
 *
 * <p>Only the noise stage (terrain shape, aquifers and biomes) is computed. Features such as trees, lakes and
 * lava pools are not, which is why candidates are verified on a real server afterwards.</p>
 */
public final class Worldgen {

    private static boolean bootstrapped;

    private final HolderLookup.Provider lookup;
    private final Holder<NoiseGeneratorSettings> settings;
    private final HolderGetter<NormalNoise> noises;
    private final NoiseBasedChunkGenerator generator;
    private final LevelHeightAccessor heightAccessor;

    public Worldgen() {
        bootstrap();
        this.lookup = VanillaRegistries.createWorldLookup();
        this.settings = this.lookup.lookupOrThrow(Registries.NOISE_SETTINGS).getOrThrow(NoiseGeneratorSettings.OVERWORLD);
        this.noises = this.lookup.lookupOrThrow(Registries.NOISE);
        var parameters = this.lookup.lookupOrThrow(Registries.MULTI_NOISE_BIOME_SOURCE_PARAMETER_LIST)
            .getOrThrow(MultiNoiseBiomeSourceParameterLists.OVERWORLD);
        this.generator = new NoiseBasedChunkGenerator(MultiNoiseBiomeSource.createFromPreset(parameters), this.settings);
        var noiseSettings = this.settings.value().noiseSettings();
        this.heightAccessor = LevelHeightAccessor.create(noiseSettings.minY(), noiseSettings.height());
    }

    private static synchronized void bootstrap() {
        if (!bootstrapped) {
            SharedConstants.tryDetectVersion();
            Bootstrap.bootStrap();
            bootstrapped = true;
        }
    }

    /**
     * Biome ids the overworld generator can produce.
     */
    public Set<String> overworldBiomes() {
        Set<String> result = new TreeSet<>();
        this.generator.getBiomeSource().possibleBiomes()
            .forEach(holder -> holder.unwrapKey().ifPresent(key -> result.add(key.identifier().toString())));
        return result;
    }

    public SeedView seed(long seed) {
        RandomState randomState = RandomState.create(this.noises, seed, this.settings.value());
        return new SeedView(randomState, this.generator.getBiomeSource().createUncachedResolver(randomState));
    }

    /**
     * Noise-stage view of one seed. Not thread-safe; create one per thread.
     */
    public final class SeedView {

        private final RandomState randomState;
        private final BiomeResolver biomes;

        private SeedView(RandomState randomState, BiomeResolver biomes) {
            this.randomState = randomState;
            this.biomes = biomes;
        }

        public String biome(int x, int y, int z) {
            return this.biomes.getNoiseBiome(x >> 2, y >> 2, z >> 2).unwrapKey().orElseThrow().identifier().toString();
        }

        /**
         * Ground column from the noise stage.
         *
         * <p>{@code Heightmap.Types.OCEAN_FLOOR_WG} cannot be used with a bare generator in 26.x (it never matches),
         * so the base column is scanned directly.</p>
         *
         * @param sampleBiome whether to look up the biome at the ground
         */
        public Terrain.Column column(int x, int z, boolean sampleBiome) {
            NoiseColumn column = Worldgen.this.generator.getBaseColumn(x, z, Worldgen.this.heightAccessor, this.randomState);
            int ground = Worldgen.this.heightAccessor.getMinY();
            boolean fluid = false;
            for (int y = Worldgen.this.heightAccessor.getMaxY(); y >= Worldgen.this.heightAccessor.getMinY(); y--) {
                BlockState state = column.getBlock(y);
                if (state.isAir()) {
                    continue;
                }
                if (!state.getFluidState().isEmpty()) {
                    fluid = true;
                    continue;
                }
                ground = y + 1;
                break;
            }
            return new Terrain.Column(x, z, ground, fluid, sampleBiome ? this.biome(x, ground, z) : null);
        }

        /**
         * Samples the area every {@code step} columns. Biomes are sampled every 4 columns (biome resolution).
         */
        public List<Terrain.Column> area(Criteria criteria, int step) {
            List<Terrain.Column> columns = new ArrayList<>();
            for (int x = criteria.areaMinX(); x <= criteria.areaMaxX(); x += step) {
                for (int z = criteria.areaMinZ(); z <= criteria.areaMaxZ(); z += step) {
                    boolean sampleBiome = Math.floorMod(x - criteria.areaMinX(), 4) == 0 && Math.floorMod(z - criteria.areaMinZ(), 4) == 0;
                    columns.add(this.column(x, z, sampleBiome));
                }
            }
            return columns;
        }
    }
}
