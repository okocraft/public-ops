package net.okocraft.spawnseedfinder;

import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtIo;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;

class SchematicTest {

    @Test
    void readsSpongeV3Footprint(@TempDir Path dir) throws Exception {
        CompoundTag schematic = new CompoundTag();
        schematic.putInt("Version", 3);
        schematic.putShort("Width", (short) 31);
        schematic.putShort("Height", (short) 9);
        schematic.putShort("Length", (short) 25);
        schematic.putIntArray("Offset", new int[]{-15, -5, -12});
        CompoundTag root = new CompoundTag();
        root.put("Schematic", schematic);
        Path file = dir.resolve("spawn.schem");
        NbtIo.writeCompressed(root, file);

        assertEquals(new Schematic(31, 25, -15, -12), Schematic.read(file));
    }

    @Test
    void readsSpongeV2Footprint(@TempDir Path dir) throws Exception {
        CompoundTag root = new CompoundTag();
        root.putInt("Version", 2);
        root.putShort("Width", (short) 10);
        root.putShort("Height", (short) 3);
        root.putShort("Length", (short) 20);
        Path file = dir.resolve("spawn.schem");
        NbtIo.writeCompressed(root, file);

        assertEquals(new Schematic(10, 20, -5, -10), Schematic.read(file));
    }
}
