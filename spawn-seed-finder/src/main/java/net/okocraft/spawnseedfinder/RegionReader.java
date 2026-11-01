package net.okocraft.spawnseedfinder;

import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.nbt.NbtIo;
import net.minecraft.nbt.Tag;

import java.io.ByteArrayInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.zip.GZIPInputStream;
import java.util.zip.InflaterInputStream;

/**
 * Minimal read-only Anvil (.mca) reader for saved chunks: block names and biomes per position.
 */
public final class RegionReader {

    private static final String AIR = "minecraft:air";

    private final Path regionDirectory;
    private final Map<Long, Chunk> chunks = new HashMap<>();

    public RegionReader(Path regionDirectory) {
        this.regionDirectory = regionDirectory;
    }

    /**
     * @return the chunk, or {@code null} if it has not been saved yet
     */
    public Chunk chunk(int chunkX, int chunkZ) throws IOException {
        long key = ((long) chunkX << 32) ^ (chunkZ & 0xFFFFFFFFL);
        Chunk cached = this.chunks.get(key);
        if (cached != null) {
            return cached;
        }
        CompoundTag tag = this.readChunkTag(chunkX, chunkZ);
        if (tag == null) {
            return null;
        }
        Chunk chunk = new Chunk(tag);
        this.chunks.put(key, chunk);
        return chunk;
    }

    public void invalidate() {
        this.chunks.clear();
    }

    public String block(int x, int y, int z) throws IOException {
        Chunk chunk = this.chunk(x >> 4, z >> 4);
        return chunk == null ? AIR : chunk.block(x, y, z);
    }

    public String biome(int x, int y, int z) throws IOException {
        Chunk chunk = this.chunk(x >> 4, z >> 4);
        return chunk == null ? null : chunk.biome(x, y, z);
    }

    private CompoundTag readChunkTag(int chunkX, int chunkZ) throws IOException {
        Path file = this.regionDirectory.resolve("r." + (chunkX >> 5) + "." + (chunkZ >> 5) + ".mca");
        if (!Files.isRegularFile(file)) {
            return null;
        }
        try (RandomAccessFile raf = new RandomAccessFile(file.toFile(), "r")) {
            if (raf.length() < 8192) {
                return null;
            }
            raf.seek(4L * ((chunkX & 31) + (chunkZ & 31) * 32));
            int location = raf.readInt();
            int sectorOffset = location >>> 8;
            if (sectorOffset == 0) {
                return null;
            }
            raf.seek(sectorOffset * 4096L);
            int length = raf.readInt();
            int compression = raf.readUnsignedByte();
            byte[] data = new byte[length - 1];
            raf.readFully(data);
            InputStream raw = new ByteArrayInputStream(data);
            InputStream in = switch (compression & 0x7F) {
                case 1 -> new GZIPInputStream(raw);
                case 2 -> new InflaterInputStream(raw);
                case 3 -> raw;
                default -> throw new IOException("Unsupported chunk compression " + compression + " in " + file);
            };
            try (DataInputStream dataIn = new DataInputStream(in)) {
                return NbtIo.read(dataIn, NbtAccounter.unlimitedHeap());
            }
        }
    }

    public static final class Chunk {

        private final String status;
        private final Map<Integer, Section> sections = new HashMap<>();

        private Chunk(CompoundTag tag) {
            this.status = tag.getStringOr("Status", "");
            for (CompoundTag section : tag.getListOrEmpty("sections").compoundStream().toList()) {
                this.sections.put((int) section.getByteOr("Y", (byte) 0), new Section(section));
            }
        }

        public boolean isFull() {
            return this.status.equals("minecraft:full") || this.status.equals("full");
        }

        public String block(int x, int y, int z) {
            Section section = this.sections.get(y >> 4);
            return section == null ? AIR : section.block(x & 15, y & 15, z & 15);
        }

        public String biome(int x, int y, int z) {
            Section section = this.sections.get(y >> 4);
            return section == null ? null : section.biome((x & 15) >> 2, (y & 15) >> 2, (z & 15) >> 2);
        }
    }

    private static final class Section {

        private final String[] blockPalette;
        private final long[] blockData;
        private final String[] biomePalette;
        private final long[] biomeData;

        private Section(CompoundTag tag) {
            CompoundTag blocks = tag.getCompoundOrEmpty("block_states");
            this.blockPalette = names(blocks.getListOrEmpty("palette"), AIR);
            this.blockData = blocks.getLongArray("data").orElse(null);
            CompoundTag biomes = tag.getCompoundOrEmpty("biomes");
            this.biomePalette = names(biomes.getListOrEmpty("palette"), null);
            this.biomeData = biomes.getLongArray("data").orElse(null);
        }

        String block(int x, int y, int z) {
            return get(this.blockPalette, this.blockData, (y << 8) | (z << 4) | x, 4);
        }

        String biome(int x, int y, int z) {
            return get(this.biomePalette, this.biomeData, (y << 4) | (z << 2) | x, 1);
        }

        private static String get(String[] palette, long[] data, int index, int minBits) {
            if (palette.length == 0) {
                return null;
            }
            if (data == null || palette.length == 1) {
                return palette[0];
            }
            int bits = Math.max(minBits, 32 - Integer.numberOfLeadingZeros(palette.length - 1));
            int perLong = 64 / bits;
            long word = data[index / perLong];
            int value = (int) ((word >>> ((index % perLong) * bits)) & ((1L << bits) - 1));
            return value < palette.length ? palette[value] : null;
        }

        /**
         * Palette entries are plain strings, or compounds with a {@code Name} when the state has properties.
         */
        private static String[] names(ListTag list, String fallback) {
            String[] result = new String[list.size()];
            for (int i = 0; i < result.length; i++) {
                Tag entry = list.get(i);
                String name = entry.asString()
                    .or(() -> entry.asCompound().flatMap(compound -> compound.getString("Name")))
                    .orElse(fallback);
                int properties = name == null ? -1 : name.indexOf('[');
                result[i] = properties < 0 ? name : name.substring(0, properties);
            }
            return result;
        }
    }
}
