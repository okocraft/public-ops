package net.okocraft.spawnseedfinder;

import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.nbt.NbtIo;

import java.io.IOException;
import java.nio.file.Path;

/**
 * Footprint of a Sponge schematic (.schem, version 2 or 3) relative to its paste origin.
 */
public record Schematic(int width, int length, int offsetX, int offsetZ) {

    public static Schematic read(Path file) throws IOException {
        CompoundTag root = NbtIo.readCompressed(file, NbtAccounter.unlimitedHeap());
        CompoundTag schematic = root.getCompound("Schematic").orElse(root); // v3 nests everything in "Schematic"
        int width = schematic.getShortOr("Width", (short) 0) & 0xFFFF;
        int length = schematic.getShortOr("Length", (short) 0) & 0xFFFF;
        if (width == 0 || length == 0) {
            throw new IOException("Not a Sponge schematic (no Width/Length): " + file);
        }
        int[] offset = schematic.getIntArray("Offset").orElse(new int[]{-(width / 2), 0, -(length / 2)});
        return new Schematic(width, length, offset[0], offset[2]);
    }
}
