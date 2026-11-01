package net.okocraft.spawnseedfinder;

import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.nbt.NbtIo;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.stream.Stream;

/**
 * Generates the spawn area of a seed on a real Paper server (the one from the dev bundle) and measures it.
 *
 * <p>This catches what the noise stage cannot see: lakes, lava pools, trees and other features.</p>
 */
public final class ServerVerifier {

    private static final int TOP_Y = 319;
    private static final int BOTTOM_Y = -64;
    private static final String SERVER_MAIN = "org.bukkit.craftbukkit.Main";
    private static final Duration STARTUP_TIMEOUT = Duration.ofMinutes(5);
    private static final Duration GENERATION_TIMEOUT = Duration.ofMinutes(5);

    private static final Set<String> FLUIDS = Set.of(
        "minecraft:water", "minecraft:lava", "minecraft:ice", "minecraft:packed_ice", "minecraft:blue_ice", "minecraft:bubble_column"
    );
    private static final Set<String> SOFT = Set.of(
        "minecraft:air", "minecraft:cave_air", "minecraft:void_air", "minecraft:snow", "minecraft:vine",
        "minecraft:short_grass", "minecraft:tall_grass", "minecraft:fern", "minecraft:large_fern", "minecraft:bush",
        "minecraft:dead_bush", "minecraft:short_dry_grass", "minecraft:tall_dry_grass", "minecraft:sweet_berry_bush",
        "minecraft:leaf_litter", "minecraft:firefly_bush", "minecraft:pink_petals", "minecraft:wildflowers",
        "minecraft:dandelion", "minecraft:poppy", "minecraft:blue_orchid", "minecraft:allium", "minecraft:azure_bluet",
        "minecraft:oxeye_daisy", "minecraft:cornflower", "minecraft:lily_of_the_valley", "minecraft:sunflower",
        "minecraft:lilac", "minecraft:rose_bush", "minecraft:peony", "minecraft:brown_mushroom", "minecraft:red_mushroom",
        "minecraft:pumpkin", "minecraft:melon", "minecraft:sugar_cane", "minecraft:cactus", "minecraft:bamboo",
        "minecraft:moss_carpet", "minecraft:pale_moss_carpet", "minecraft:pale_hanging_moss", "minecraft:glow_lichen",
        "minecraft:cocoa", "minecraft:bee_nest", "minecraft:closed_eyeblossom", "minecraft:open_eyeblossom", "minecraft:cactus_flower"
    );

    /**
     * @param stats        terrain stats of the generated world
     * @param lavaColumns  platform/margin columns covered by lava (also counted in {@code stats.fluidColumns()})
     * @param treeColumns  platform columns with a tree trunk on the ground (trees to clear)
     * @param spawn        world spawn chosen by the server, as {@code x,y,z}
     * @param heightMap    see {@link Terrain#heightMap}
     */
    public record Result(long seed, Terrain.Stats stats, int lavaColumns, int treeColumns, String spawn, List<String> heightMap) {
    }

    private final Criteria criteria;
    private final Path workDirectory;
    private final boolean keepWorlds;
    private final Consumer<String> log;

    public ServerVerifier(Criteria criteria, Path workDirectory, boolean keepWorlds, Consumer<String> log) {
        this.criteria = criteria;
        this.workDirectory = workDirectory;
        this.keepWorlds = keepWorlds;
        this.log = log;
    }

    /**
     * @param label name used in logs and for the server directory, so that the seed itself does not have to appear
     */
    public Result verify(long seed, String label) throws IOException, InterruptedException {
        Path serverDirectory = this.workDirectory.resolve("server-" + label);
        deleteRecursively(serverDirectory);
        Files.createDirectories(serverDirectory);
        Files.writeString(serverDirectory.resolve("eula.txt"), "eula=true\n");
        Files.writeString(serverDirectory.resolve("server.properties"), String.join("\n",
            "level-seed=" + seed,
            "server-ip=127.0.0.1",
            "server-port=" + freePort(),
            "online-mode=false",
            "spawn-protection=0",
            "generate-structures=true",
            "sync-chunk-writes=false",
            ""
        ));

        this.log.accept("verifying " + label + " on a Paper server in " + serverDirectory);
        Process process = new ProcessBuilder(
            ProcessHandle.current().info().command().orElse("java"),
            "-Xmx3G",
            "-Dcom.mojang.eula.agree=true",
            "-DPaper.IReallyKnowWhatIAmDoingISwear=true",
            "-cp", System.getProperty("java.class.path"),
            SERVER_MAIN,
            "--nogui"
        ).directory(serverDirectory.toFile()).redirectErrorStream(true).start();

        LinkedBlockingQueue<String> lines = new LinkedBlockingQueue<>();
        Thread pump = Thread.ofVirtual().start(() -> {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    lines.add(line);
                    Files.writeString(serverDirectory.resolve("console.log"), line + "\n", StandardCharsets.UTF_8,
                        StandardOpenOption.CREATE, StandardOpenOption.APPEND);
                }
            } catch (IOException ignored) {
            }
        });

        try (Writer console = new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8)) {
            awaitLine(lines, process, "Done (", STARTUP_TIMEOUT);

            int minChunkX = this.criteria.areaMinX() >> 4;
            int maxChunkX = this.criteria.areaMaxX() >> 4;
            int minChunkZ = this.criteria.areaMinZ() >> 4;
            int maxChunkZ = this.criteria.areaMaxZ() >> 4;
            command(console, "forceload add " + this.criteria.areaMinX() + " " + this.criteria.areaMinZ() + " "
                + this.criteria.areaMaxX() + " " + this.criteria.areaMaxZ());

            Path regions;
            long deadline = System.nanoTime() + GENERATION_TIMEOUT.toNanos();
            while (true) {
                TimeUnit.SECONDS.sleep(3);
                lines.clear();
                command(console, "save-all flush");
                awaitLine(lines, process, "Saved the game", GENERATION_TIMEOUT);
                regions = findOverworldRegions(serverDirectory);
                if (regions != null && allFull(new RegionReader(regions), minChunkX, maxChunkX, minChunkZ, maxChunkZ)) {
                    break;
                }
                if (System.nanoTime() > deadline) {
                    throw new IOException("Chunks around the spawn were not generated in time (see " + serverDirectory.resolve("console.log") + ")");
                }
            }
            command(console, "stop");
        }
        if (!process.waitFor(2, TimeUnit.MINUTES)) {
            process.destroyForcibly().waitFor();
        }
        pump.join(Duration.ofSeconds(5));

        Path regionDirectory = findOverworldRegions(serverDirectory);
        Result result = this.measure(seed, new RegionReader(regionDirectory), readSpawn(serverDirectory));
        if (!this.keepWorlds) {
            deleteRecursively(serverDirectory);
        }
        return result;
    }

    Result measure(long seed, RegionReader region, String spawn) throws IOException {
        List<Terrain.Column> columns = new ArrayList<>();
        int lava = 0;
        int trees = 0;
        for (int x = this.criteria.areaMinX(); x <= this.criteria.areaMaxX(); x++) {
            for (int z = this.criteria.areaMinZ(); z <= this.criteria.areaMaxZ(); z++) {
                int y = TOP_Y;
                while (y > BOTTOM_Y && soft(region.block(x, y, z))) {
                    y--;
                }
                // the first non-soft block from the top is either a fluid or the ground
                String surface = region.block(x, y, z);
                boolean fluid = FLUIDS.contains(surface);
                if (surface.equals("minecraft:lava")) {
                    lava++;
                }
                while (y > BOTTOM_Y && (FLUIDS.contains(region.block(x, y, z)) || soft(region.block(x, y, z)))) {
                    y--;
                }
                int ground = y + 1;
                if (this.criteria.inPlatform(x, z)) {
                    for (int dy = 0; dy < 6; dy++) {
                        if (region.block(x, ground + dy, z).endsWith("_log")) {
                            trees++;
                            break;
                        }
                    }
                }
                boolean sampleBiome = Math.floorMod(x - this.criteria.areaMinX(), 4) == 0 && Math.floorMod(z - this.criteria.areaMinZ(), 4) == 0;
                columns.add(new Terrain.Column(x, z, ground, fluid, sampleBiome ? region.biome(x, ground, z) : null));
            }
        }
        Terrain.Stats stats = Terrain.evaluate(this.criteria, columns);
        return new Result(seed, stats, lava, trees, spawn, Terrain.heightMap(this.criteria, columns, stats.level()));
    }

    private static boolean soft(String block) {
        return SOFT.contains(block)
            || block.endsWith("_log") || block.endsWith("_leaves") || block.endsWith("_wood")
            || block.endsWith("_sapling") || block.endsWith("_mushroom_block") || block.endsWith("mushroom_stem")
            || block.endsWith("_tulip") || block.endsWith("_carpet");
    }

    private static boolean allFull(RegionReader region, int minChunkX, int maxChunkX, int minChunkZ, int maxChunkZ) throws IOException {
        for (int cx = minChunkX; cx <= maxChunkX; cx++) {
            for (int cz = minChunkZ; cz <= maxChunkZ; cz++) {
                RegionReader.Chunk chunk = region.chunk(cx, cz);
                if (chunk == null || !chunk.isFull()) {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * Overworld region files: {@code world/dimensions/minecraft/overworld/region} (26.x layout) or {@code world/region}.
     */
    private static Path findOverworldRegions(Path serverDirectory) {
        for (Path candidate : List.of(
            serverDirectory.resolve("world/dimensions/minecraft/overworld/region"),
            serverDirectory.resolve("world/region")
        )) {
            if (Files.isDirectory(candidate)) {
                return candidate;
            }
        }
        return null;
    }

    private static String readSpawn(Path serverDirectory) {
        try {
            CompoundTag level = NbtIo.readCompressed(serverDirectory.resolve("world/level.dat"), NbtAccounter.unlimitedHeap());
            CompoundTag data = level.getCompoundOrEmpty("Data");
            int[] pos = data.getCompoundOrEmpty("spawn").getIntArray("pos").orElse(null);
            if (pos != null && pos.length == 3) {
                return pos[0] + "," + pos[1] + "," + pos[2];
            }
            return data.getIntOr("SpawnX", 0) + "," + data.getIntOr("SpawnY", 0) + "," + data.getIntOr("SpawnZ", 0);
        } catch (IOException e) {
            return "?";
        }
    }

    private static void command(Writer console, String command) throws IOException {
        console.write(command + "\n");
        console.flush();
    }

    private static void awaitLine(LinkedBlockingQueue<String> lines, Process process, String needle, Duration timeout) throws IOException, InterruptedException {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (System.nanoTime() < deadline) {
            String line = lines.poll(1, TimeUnit.SECONDS);
            if (line != null && line.contains(needle)) {
                return;
            }
            if (line == null && !process.isAlive()) {
                throw new IOException("The server exited (code " + process.exitValue() + ") before printing '" + needle + "'");
            }
        }
        process.destroyForcibly();
        throw new IOException("Timed out waiting for '" + needle + "' from the server");
    }

    private static int freePort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        }
    }

    private static void deleteRecursively(Path path) throws IOException {
        if (!Files.exists(path)) {
            return;
        }
        try (Stream<Path> walk = Files.walk(path)) {
            for (Path p : walk.sorted(Comparator.reverseOrder()).toList()) {
                Files.deleteIfExists(p);
            }
        }
    }
}
