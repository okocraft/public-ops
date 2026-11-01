# Spawn Seed Finder

Finds world seeds whose spawn area fits a spawn platform (a Sponge `.schem`): the wanted biome at the spawn,
flat ground under the platform, gentle slopes around it and no water or lava.

It runs the server's own world generation code from the Paper dev bundle (paperweight-userdev), so it always
matches the Minecraft/Paper version in [`gradle/libs.versions.toml`](gradle/libs.versions.toml).

## How it works

1. **Noise search** (fast, about 200 seeds/s on 4 cores): random seeds are evaluated on the noise stage of the
   overworld generator (terrain shape, aquifers, biomes) without starting a server. Seeds whose spawn is not in
   an accepted biome, has water, or is too uneven are dropped; the rest are scored.
2. **Verification** (about 30 s per seed): the best seeds are generated on a real Paper server (started from the
   dev bundle in a child JVM) and the saved chunks are measured. This catches what the noise stage cannot see:
   lakes, lava pools and trees.

The score is lower for a flatter platform area, a gentler margin and a higher ratio of accepted biomes.

## Usage

Requirements: Java 25 (Gradle downloads everything else).

```sh
# list biome ids
./gradlew run --args="biomes"

# search 100,000 seeds for a taiga spawn at 0,0 fitting rw_spawn.schem, verify the best 5 on Paper
./gradlew run --args="search --biome minecraft:taiga --schem /path/to/rw_spawn.schem"

# several biomes are accepted with commas; other options are listed by --help
./gradlew run --args="search --biome minecraft:taiga,minecraft:snowy_taiga --schem /path/to/rw_spawn.schem --count 200000"

# verify given seeds only
./gradlew run --args="verify --biome minecraft:taiga --schem /path/to/rw_spawn.schem --seeds 6145087142957989124,-3379304205332673365"
```

The report is written to `run/spawn-seeds.md` (`--out` to change). It has the noise-stage candidates, the
verified results (`OK`/`NG`, ground range, water/lava columns, trees to clear) and a height map of each verified
seed. Generated worlds are deleted unless `--keep-worlds` is given (they are kept in `run/verify-worlds`).

| Option | Default | Meaning |
| --- | --- | --- |
| `--biome <id,...>` | required | accepted biomes; the spawn column must be one of them |
| `--schem <file>` | - | platform size and offset from a Sponge schematic (v2/v3) |
| `--size <n>` | 31 | square platform size when no schematic is given |
| `--center <x,z>` | `0,0` | paste origin, i.e. the world spawn |
| `--margin <n>` | 10 | columns checked around the platform |
| `--max-range <n>` | 3 | max ground height difference under the platform |
| `--min-biome-ratio <r>` | 0.9 | min ratio of accepted biomes over the platform and margin |
| `--count <n>` | 100000 | seeds to search |
| `--top <n>` | 20 | noise candidates in the report |
| `--verify <n>` | 5 | candidates to verify on Paper (0 = skip) |
| `--threads <n>` | all cores | search threads |
| `--random-seed <n>` | random | seed of the seed generator, for reproducible runs |

The platform level is the median ground height under the platform; paste the schematic so that its surface sits
on that level.

## Updates

Renovate updates the dev bundle (`io.papermc.paper:dev-bundle`) and paperweight-userdev; CI runs `./gradlew build`.
The tests generate known seeds (noise stage and a real Paper server) and compare them with measured values, so a
failing build after an update means one of:

- the server API used by the tool changed (compile error or exception) - adapt the code;
- world generation changed (different heights/biomes for the known seeds) - seeds found before the update are no
  longer valid; update the expected values in the tests after checking a few seeds in game.
