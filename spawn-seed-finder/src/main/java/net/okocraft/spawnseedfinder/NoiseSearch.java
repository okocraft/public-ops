package net.okocraft.spawnseedfinder;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.SplittableRandom;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

/**
 * Fast seed search on the noise stage only.
 */
public final class NoiseSearch {

    public record Candidate(long seed, Terrain.Stats stats) {
    }

    private final Worldgen worldgen;
    private final Criteria criteria;

    public NoiseSearch(Worldgen worldgen, Criteria criteria) {
        this.worldgen = worldgen;
        this.criteria = criteria;
    }

    /**
     * Evaluates one seed, or returns {@code null} when it is rejected.
     *
     * <p>Seeds are rejected cheaply first (centre biome, then a coarse 4-column grid) before the full area is
     * sampled.</p>
     */
    public Candidate evaluate(long seed) {
        Worldgen.SeedView view = this.worldgen.seed(seed);
        Terrain.Column center = view.column(this.criteria.centerX(), this.criteria.centerZ(), true);
        if (center.fluid() || !this.criteria.biomes().contains(center.biome())) {
            return null;
        }
        Terrain.Stats coarse = Terrain.evaluate(this.criteria, view.area(this.criteria, 4));
        if (!coarse.acceptable(this.criteria)) {
            return null;
        }
        Terrain.Stats full = Terrain.evaluate(this.criteria, view.area(this.criteria, 1));
        return full.acceptable(this.criteria) ? new Candidate(seed, full) : null;
    }

    /**
     * Same as {@link #evaluate(long)} but never rejects; used to report on given seeds.
     */
    public Terrain.Stats evaluateAlways(long seed) {
        return Terrain.evaluate(this.criteria, this.worldgen.seed(seed).area(this.criteria, 1));
    }

    public List<Candidate> search(long count, int threads, long randomSeed, int top, Consumer<String> progress) throws InterruptedException {
        SplittableRandom root = new SplittableRandom(randomSeed);
        AtomicLong next = new AtomicLong();
        AtomicLong found = new AtomicLong();
        List<Candidate> candidates = new ArrayList<>();
        ExecutorService executor = Executors.newFixedThreadPool(threads);
        long start = System.nanoTime();

        for (int i = 0; i < threads; i++) {
            SplittableRandom random = root.split();
            executor.execute(() -> {
                while (next.getAndIncrement() < count) {
                    Candidate candidate = this.evaluate(random.nextLong());
                    if (candidate != null) {
                        found.incrementAndGet();
                        synchronized (candidates) {
                            candidates.add(candidate);
                        }
                    }
                }
            });
        }
        executor.shutdown();
        while (!executor.awaitTermination(15, TimeUnit.SECONDS)) {
            progress.accept(String.format("searched %d/%d seeds, %d candidates, %.0fs",
                Math.min(next.get(), count), count, found.get(), (System.nanoTime() - start) / 1e9));
        }
        progress.accept(String.format("searched %d seeds, %d candidates, %.0fs", count, found.get(), (System.nanoTime() - start) / 1e9));

        candidates.sort(Comparator.comparingDouble(candidate -> candidate.stats().score()));
        return candidates.subList(0, Math.min(top, candidates.size()));
    }
}
