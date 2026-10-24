package net.okocraft.e2ehelper;

import java.util.Locale;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.Cancellable;
import org.bukkit.event.Event;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityEvent;
import org.bukkit.event.player.PlayerEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Test-only console commands for end-to-end tests. Every result is logged as a single line
 * {@code E2E <TAG> key=value key=value} that the test harness parses. Commands run on the main
 * thread, so this plugin is for Paper only (it is not Folia-compatible).
 */
public final class E2eHelperPlugin extends JavaPlugin {

    private final Listener listener = new Listener() {
    };

    private void out(String tag, String fields) {
        getLogger().info("E2E " + tag + (fields.isEmpty() ? "" : " " + fields));
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!sender.equals(getServer().getConsoleSender())) {
            sender.sendMessage("Console only.");
            return true;
        }
        try {
            switch (command.getName()) {
                case "e2epos" -> position(args[0]);
                case "e2espawn" -> spawn(args);
                case "e2ehealth" -> health(args[0]);
                case "e2eexists" -> exists(args[0]);
                case "e2eequip" -> equip(args);
                case "e2elisten" -> listen(args[0]);
                default -> {
                    return false;
                }
            }
        } catch (RuntimeException | ReflectiveOperationException e) {
            out("ERROR", "command=" + command.getName() + " message=" + String.valueOf(e.getMessage()).replace(' ', '_'));
        }
        return true;
    }

    private Player player(String name) {
        Player player = getServer().getPlayerExact(name);
        if (player == null) {
            throw new IllegalArgumentException("no_such_player");
        }
        return player;
    }

    private void position(String name) {
        Player p = player(name);
        Location l = p.getLocation();
        String vehicle = p.getVehicle() == null ? "none" : p.getVehicle().getType().name();
        out("POS", String.format(Locale.ROOT, "player=%s world=%s x=%.2f y=%.2f z=%.2f vehicle=%s",
                p.getName(), l.getWorld().getKey(), l.getX(), l.getY(), l.getZ(), vehicle));
    }

    /** {@code e2espawn <type> <name|-> <x> <y> <z>} in the first loaded world. */
    private void spawn(String[] a) {
        World world = getServer().getWorlds().getFirst();
        Location at = new Location(world, Double.parseDouble(a[2]), Double.parseDouble(a[3]), Double.parseDouble(a[4]));
        Entity entity = world.spawnEntity(at, EntityType.valueOf(a[0].toUpperCase(Locale.ROOT)));
        if (!a[1].equals("-")) {
            entity.customName(Component.text(a[1]));
            entity.setCustomNameVisible(true);
        }
        if (entity instanceof LivingEntity living) {
            living.setAI(false);
        }
        out("SPAWNED", "type=" + a[0] + " id=" + entity.getEntityId() + " uuid=" + entity.getUniqueId());
    }

    private void health(String uuid) {
        Entity entity = getServer().getEntity(UUID.fromString(uuid));
        String value = entity instanceof LivingEntity living && entity.isValid() ? String.valueOf(living.getHealth()) : "gone";
        out("HEALTH", "uuid=" + uuid + " value=" + value);
    }

    private void exists(String uuid) {
        Entity entity = getServer().getEntity(UUID.fromString(uuid));
        out("EXISTS", "uuid=" + uuid + " value=" + (entity != null && entity.isValid()));
    }

    /** {@code e2eequip <player> <head|chest|legs|feet|hand|off_hand> <material|air>}. */
    private void equip(String[] a) {
        Player p = player(a[0]);
        EquipmentSlot slot = EquipmentSlot.valueOf(a[1].toUpperCase(Locale.ROOT));
        ItemStack item = a[2].equals("air") ? null : new ItemStack(Material.valueOf(a[2].toUpperCase(Locale.ROOT)));
        p.getInventory().setItem(slot, item);
        out("EQUIPPED", "player=" + p.getName() + " slot=" + a[1] + " item=" + a[2]);
    }

    /** Registers a MONITOR listener that logs each call of the named event class. */
    @SuppressWarnings("unchecked")
    private void listen(String className) throws ClassNotFoundException {
        Class<?> found = findClass(className);
        if (!Event.class.isAssignableFrom(found)) {
            throw new IllegalArgumentException("not_an_event");
        }
        getServer().getPluginManager().registerEvent((Class<? extends Event>) found, listener, EventPriority.MONITOR,
                (ignored, event) -> {
                    if (!found.isInstance(event)) {
                        return;
                    }
                    StringBuilder fields = new StringBuilder("name=" + event.getClass().getSimpleName());
                    if (event instanceof Cancellable cancellable) {
                        fields.append(" cancelled=").append(cancellable.isCancelled());
                    }
                    if (event instanceof PlayerEvent playerEvent) {
                        fields.append(" player=").append(playerEvent.getPlayer().getName());
                    } else if (event instanceof EntityEvent entityEvent) {
                        fields.append(" entity=").append(entityEvent.getEntityType().name());
                    }
                    out("EVENT", fields.toString());
                }, this, false);
        out("LISTENING", "event=" + found.getSimpleName());
    }

    private Class<?> findClass(String name) throws ClassNotFoundException {
        try {
            return Class.forName(name);
        } catch (ClassNotFoundException ignored) {
            for (Plugin plugin : getServer().getPluginManager().getPlugins()) {
                try {
                    return plugin.getClass().getClassLoader().loadClass(name);
                } catch (ClassNotFoundException ignoredToo) {
                    // try the next plugin class loader
                }
            }
            throw new ClassNotFoundException(name);
        }
    }
}
