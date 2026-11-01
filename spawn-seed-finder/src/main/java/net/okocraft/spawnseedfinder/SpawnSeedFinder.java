package net.okocraft.spawnseedfinder;

import com.google.gson.JsonObject;
import net.minecraft.SharedConstants;

import java.io.IOException;
import java.io.PrintStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Finds world seeds whose spawn area fits a spawn platform.
 *
 * <pre>
 * search  [options]                 noise search, then verify the best seeds on a Paper server
 * verify  --seeds a,b,c [options]   verify given seeds only
 * biomes                            list overworld biome ids
 * </pre>
 */
public final class SpawnSeedFinder {

    // The server bootstrap redirects System.out/err to its logger; keep the real streams for our own output.
    private static final PrintStream OUT = System.out;
    private static final PrintStream ERR = System.err;

    private static final String USAGE = """
        Usage: <command> [options]

        Commands:
          search   Search random seeds on the noise stage, then verify the best ones on a Paper server
          verify   Verify the seeds given by --seeds on a Paper server
          biomes   List overworld biome ids

        Options:
          --biome <id,...>         accepted biomes, e.g. minecraft:taiga (required for search/verify)
          --schem <file>           take the platform size and offset from a Sponge schematic
          --size <n>               platform size when no --schem is given (default 31)
          --center <x,z>           paste origin / world spawn (default 0,0)
          --margin <n>             columns checked around the platform (default 10)
          --max-range <n>          max ground height difference under the platform (default 3)
          --min-biome-ratio <r>    min ratio of accepted biomes in the area (default 0.9)
          --count <n>              seeds to search (default 100000)
          --top <n>                noise candidates to report (default 20)
          --verify <n>             candidates to verify on a Paper server (default 5, 0 = skip)
          --seeds <a,b,...>        seeds for the verify command
          --threads <n>            search threads (default: all processors)
          --random-seed <n>        seed of the seed generator, for reproducible searches
          --out <file>             report file (default spawn-seeds.md)
          --keep-worlds            keep the generated server directories
          --mask-seeds             keep seeds out of the console (labels instead; registered as secrets on GitHub Actions)
          --discord-webhook-env <name>  post the result to the Discord webhook URL in this environment variable
          --discord-forum-post <name>   name of the post to create when the webhook belongs to a forum channel
                                   (default: "Spawn seeds: <biomes>")
        """;

    public static void main(String[] args) throws Exception {
        if (args.length == 0 || args[0].equals("--help") || args[0].equals("help")) {
            OUT.println(USAGE);
            return;
        }
        String command = args[0];
        Map<String, String> options = parseOptions(Arrays.copyOfRange(args, 1, args.length));

        Worldgen worldgen = new Worldgen();
        if (command.equals("biomes")) {
            worldgen.overworldBiomes().forEach(OUT::println);
            OUT.flush();
            System.exit(0);
        }
        if (!command.equals("search") && !command.equals("verify")) {
            fail("Unknown command: " + command);
        }

        Criteria criteria = criteria(options, worldgen.overworldBiomes());
        Path out = Path.of(options.getOrDefault("out", "spawn-seeds.md"));
        int verifyCount = Integer.parseInt(options.getOrDefault("verify", "5"));
        boolean mask = options.containsKey("mask-seeds");
        String webhookEnv = options.get("discord-webhook-env");
        String webhookUrl = null;
        if (webhookEnv != null) {
            webhookUrl = System.getenv(webhookEnv);
            if (webhookUrl == null || webhookUrl.isBlank()) {
                fail("Environment variable " + webhookEnv + " (--discord-webhook-env) is not set");
            }
        }
        String version = SharedConstants.getCurrentVersion().name();
        NoiseSearch search = new NoiseSearch(worldgen, criteria);
        Report report = new Report().header(criteria, version);
        long searched = -1;
        int candidateCount = 0;

        List<Long> toVerify = new ArrayList<>();
        if (command.equals("search")) {
            long count = Long.parseLong(options.getOrDefault("count", "100000"));
            int threads = Integer.parseInt(options.getOrDefault("threads", Integer.toString(Runtime.getRuntime().availableProcessors())));
            // SecureRandom, not new SplittableRandom(): the latter is seeded from the clock, and the log shows when it ran
            long randomSeed = options.containsKey("random-seed") ? Long.parseLong(options.get("random-seed")) : new SecureRandom().nextLong();
            int top = Integer.parseInt(options.getOrDefault("top", "20"));
            // the random seed reproduces every candidate, so it is as secret as the seeds
            maskInCi(mask, randomSeed);
            log("searching " + count + " seeds with " + threads + " threads" + (mask ? "" : " (random-seed " + randomSeed + ")"));
            List<NoiseSearch.Candidate> candidates = search.search(count, threads, randomSeed, top, SpawnSeedFinder::log);
            candidates.forEach(candidate -> maskInCi(mask, candidate.seed()));
            report.noiseCandidates("Noise-stage candidates (" + count + " seeds, random-seed " + randomSeed + ")", candidates);
            candidates.stream().limit(verifyCount).forEach(candidate -> toVerify.add(candidate.seed()));
            searched = count;
            candidateCount = candidates.size();
        } else {
            String seeds = options.get("seeds");
            if (seeds == null) {
                fail("verify needs --seeds");
            }
            for (String seed : seeds.split(",")) {
                toVerify.add(Long.parseLong(seed.trim()));
            }
            List<NoiseSearch.Candidate> given = new ArrayList<>();
            for (long seed : toVerify) {
                given.add(new NoiseSearch.Candidate(seed, search.evaluateAlways(seed)));
            }
            report.noiseCandidates("Noise-stage stats of the given seeds", given);
        }

        List<ServerVerifier.Result> results = new ArrayList<>();
        List<String> failures = new ArrayList<>();
        if (!toVerify.isEmpty() && (command.equals("verify") || verifyCount > 0)) {
            ServerVerifier verifier = new ServerVerifier(criteria, Path.of("verify-worlds").toAbsolutePath(), options.containsKey("keep-worlds"), SpawnSeedFinder::log);
            Report failureReport = new Report();
            for (int i = 0; i < toVerify.size(); i++) {
                long seed = toVerify.get(i);
                String label = mask ? "candidate-" + (i + 1) : Long.toString(seed);
                try {
                    ServerVerifier.Result result = verifier.verify(seed, label);
                    log(String.format(Locale.ROOT, "%s: level %d, ground %d..%d, fluid %d, trees %d, biome ratio %.2f -> %s",
                        label, result.stats().level(), result.stats().platformMin(), result.stats().platformMax(),
                        result.stats().fluidColumns(), result.treeColumns(), result.stats().biomeRatio(),
                        result.stats().acceptable(criteria) ? "OK" : "NG"));
                    results.add(result);
                } catch (IOException e) {
                    log("verification of " + label + " failed: " + e.getMessage());
                    failureReport.failure(seed, e);
                    failures.add(label);
                }
            }
            results.sort((a, b) -> Double.compare(a.stats().score(), b.stats().score()));
            report.verified(results, criteria);
            if (!failures.isEmpty()) {
                report.append(failureReport);
            }
        }

        Files.writeString(out, report.toString());
        log("report written to " + out.toAbsolutePath());
        if (!mask) {
            OUT.println(report);
            OUT.flush();
        }

        if (webhookUrl != null) {
            JsonObject message = DiscordMessage.build(new DiscordMessage.Run(criteria, version, searched, candidateCount, results, failures.size(), Instant.now()));
            String forumPost = options.getOrDefault("discord-forum-post", "Spawn seeds: " + String.join(", ", criteria.biomes()));
            new DiscordWebhook(webhookUrl, forumPost).post(message, "spawn-seeds.md", report.toString());
            log("posted the result to Discord");
        }
        System.exit(0); // the server bootstrap leaves non-daemon threads behind
    }

    /**
     * Registers a value as a secret with GitHub Actions so that it is masked even if something prints it.
     * The {@code ::add-mask::} command itself is not shown in the log.
     */
    private static void maskInCi(boolean mask, long value) {
        if (mask && "true".equals(System.getenv("GITHUB_ACTIONS"))) {
            OUT.println("::add-mask::" + value);
            OUT.flush();
        }
    }

    private static Criteria criteria(Map<String, String> options, Set<String> knownBiomes) throws IOException {
        String biomeOption = options.get("biome");
        if (biomeOption == null) {
            fail("--biome is required (see the 'biomes' command)");
        }
        Set<String> biomes = new LinkedHashSet<>();
        for (String biome : biomeOption.split(",")) {
            String id = biome.trim().contains(":") ? biome.trim() : "minecraft:" + biome.trim();
            if (!knownBiomes.contains(id)) {
                fail("Unknown overworld biome: " + id + " (see the 'biomes' command)");
            }
            biomes.add(id);
        }

        int sizeX;
        int sizeZ;
        int offsetX;
        int offsetZ;
        if (options.containsKey("schem")) {
            Schematic schematic = Schematic.read(Path.of(options.get("schem")));
            sizeX = schematic.width();
            sizeZ = schematic.length();
            offsetX = schematic.offsetX();
            offsetZ = schematic.offsetZ();
        } else {
            int size = Integer.parseInt(options.getOrDefault("size", "31"));
            sizeX = sizeZ = size;
            offsetX = offsetZ = -(size / 2);
        }

        String[] center = options.getOrDefault("center", "0,0").split(",");
        return new Criteria(
            Set.copyOf(biomes),
            Integer.parseInt(center[0].trim()), Integer.parseInt(center[1].trim()),
            offsetX, offsetZ, sizeX, sizeZ,
            Integer.parseInt(options.getOrDefault("margin", "10")),
            Double.parseDouble(options.getOrDefault("min-biome-ratio", "0.9")),
            Integer.parseInt(options.getOrDefault("max-range", "3"))
        );
    }

    private static Map<String, String> parseOptions(String[] args) {
        Map<String, String> options = new HashMap<>();
        for (int i = 0; i < args.length; i++) {
            if (!args[i].startsWith("--")) {
                fail("Unexpected argument: " + args[i]);
            }
            String key = args[i].substring(2);
            if (key.equals("keep-worlds") || key.equals("mask-seeds")) {
                options.put(key, "true");
            } else if (i + 1 < args.length) {
                options.put(key, args[++i]);
            } else {
                fail("Missing value for --" + key);
            }
        }
        return options;
    }

    private static void log(String message) {
        ERR.println("[spawn-seed-finder] " + message);
    }

    private static void fail(String message) {
        ERR.println(message);
        ERR.println(USAGE);
        System.exit(2);
    }
}
