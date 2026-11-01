package net.okocraft.spawnseedfinder;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Starts the dev bundle's Paper server, generates the spawn area of a known seed and reads it back.
 *
 * <p>Catches changes in the server's start-up, console output, world layout and chunk format.</p>
 */
class ServerVerifierTest {

    @BeforeAll
    static void bootstrap() {
        new Worldgen(); // NBT classes need the server bootstrap
    }

    @Test
    @Timeout(value = 10, unit = TimeUnit.MINUTES)
    void verifiesKnownSeedOnPaper(@TempDir Path dir) throws Exception {
        Criteria criteria = NoiseSearchTest.taiga();
        ServerVerifier.Result result = new ServerVerifier(criteria, dir, false, System.out::println).verify(NoiseSearchTest.FLAT_TAIGA, "flat-taiga");

        Terrain.Stats stats = result.stats();
        assertEquals(64, stats.level(), stats::toString);
        assertTrue(stats.platformMin() >= 63 && stats.platformMax() <= 65, stats::toString);
        assertEquals(0, stats.fluidColumns(), stats::toString);
        assertEquals(1.0, stats.biomeRatio(), stats::toString);
        assertTrue(result.treeColumns() > 0, "a taiga platform area should have trees to clear");
        assertTrue(stats.acceptable(criteria), stats::toString);
        assertEquals(criteria.areaMaxZ() - criteria.areaMinZ() + 1, result.heightMap().size());
    }
}
