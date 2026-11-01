package net.okocraft.spawnseedfinder;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Regression test against known seeds.
 *
 * <p>The expected values were measured on generated 26.3 worlds. When this test fails after a Minecraft/Paper update,
 * either the server API used by {@link Worldgen} changed or world generation itself changed; in the latter case
 * previously found seeds are no longer valid.</p>
 */
class NoiseSearchTest {

    /** Flat taiga around 0,0: ground 63..65, no water (checked on a real server). */
    static final long FLAT_TAIGA = -3379304205332673365L;
    /** Deep ocean at 0,0. */
    static final long OCEAN = 1L;

    static Worldgen worldgen;

    @BeforeAll
    static void setUp() {
        worldgen = new Worldgen();
    }

    static Criteria taiga() {
        return new Criteria(Set.of("minecraft:taiga"), 0, 0, -15, -15, 31, 31, 10, 0.9, 3);
    }

    @Test
    void knowsOverworldBiomes() {
        Set<String> biomes = worldgen.overworldBiomes();
        assertTrue(biomes.contains("minecraft:taiga"), biomes::toString);
        assertTrue(biomes.contains("minecraft:cherry_grove"), biomes::toString);
    }

    @Test
    void flatTaigaSeedIsAccepted() {
        NoiseSearch.Candidate candidate = new NoiseSearch(worldgen, taiga()).evaluate(FLAT_TAIGA);
        assertNotNull(candidate);
        Terrain.Stats stats = candidate.stats();
        assertEquals(64, stats.level());
        assertTrue(stats.platformRange() <= 2, stats::toString);
        assertEquals(0, stats.fluidColumns());
        assertEquals(1.0, stats.biomeRatio());
    }

    @Test
    void oceanSeedIsRejected() {
        assertEquals("minecraft:deep_ocean", worldgen.seed(OCEAN).biome(0, 63, 0));
        assertNull(new NoiseSearch(worldgen, taiga()).evaluate(OCEAN));
        assertTrue(new NoiseSearch(worldgen, taiga()).evaluateAlways(OCEAN).fluidColumns() > 0);
    }

    @Test
    void otherBiomeIsRejected() {
        Criteria cherry = new Criteria(Set.of("minecraft:cherry_grove"), 0, 0, -15, -15, 31, 31, 10, 0.9, 3);
        assertNull(new NoiseSearch(worldgen, cherry).evaluate(FLAT_TAIGA));
    }

    @Test
    void searchFindsCandidates() throws InterruptedException {
        // About 1 in 25 seeds is taiga at 0,0 and about half of those are dry; keep the limits loose here.
        Criteria loose = new Criteria(Set.of("minecraft:taiga"), 0, 0, -15, -15, 31, 31, 10, 0.5, 20);
        var candidates = new NoiseSearch(worldgen, loose).search(400, 2, 42L, 10, message -> {});
        assertTrue(!candidates.isEmpty(), "no candidate in 400 seeds");
        for (int i = 1; i < candidates.size(); i++) {
            assertTrue(candidates.get(i - 1).stats().score() <= candidates.get(i).stats().score());
        }
    }
}
