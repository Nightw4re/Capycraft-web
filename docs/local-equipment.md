# Local player equipment

Open a [player profile](players.md) to see armor slots, compact 3D portrait, off-hand slot, and nine hotbar slots. The equipment panel sits beside the profile summary on wide screens and below it on narrow screens. The **Inventory** tab shows all 36 carry slots. Items in the published catalog link to recipes. Use the [item tooltip and recipe gestures](items.md#recipes-and-ingredient-options). Slot tooltips use the stack's own tooltip text and supported formatting. Older WebCraft versions provide plain text, some of which can be formatted using the catalog. Slot bars show the stack's current state. For Mekanism stacks with an older feed, the site can also draw the charge bar from the stored energy and capacity reported in the tooltip. Open the information button for snapshot and availability details. Capycraft stores the last successful snapshot in SQLite.

For inventory data, install WebCraft and Equipment in a local Minecraft instance. Enable `webcraft_equipment:equipment`, allow HTTP for its loadout and inventory routes, and set WebCraft's `viewerUuid` and `WEBCRAFT_VIEWER_TOKEN`. Use the UUID assigned by that world and join with the matching player. The Capycraft API serves this data only over local requests for the configured player and matching instance. In Capycraft's ignored `.env.local` file, configure the local WebCraft listener and matching viewer token.

```dotenv
CAPYCRAFT_LOCAL_EQUIPMENT_URL=http://127.0.0.1:8765
CAPYCRAFT_LOCAL_EQUIPMENT_PLAYER=nightware6
CAPYCRAFT_LOCAL_EQUIPMENT_TOKEN=REPLACE_WITH_THE_LOCAL_VIEWER_TOKEN
```

The browser requests the equipment view through `/api/players`, which Vite proxies in development and preview. The [Node equipment handler](../server/localEquipment.mts) reads the token, fetches from the fixed loopback WebCraft origin, and checks the requesting connection, host, player name, and instance. Keep the local equipment settings out of production and keep these responses out of shared caches.

The portrait uses [WebCraft's Armor Preview geometry renderer](../src/equipment/armor-geometry.mjs). To enable worn armor, copy `designs/webcraft_designs/armor.json` and `designs/webcraft_designs/armor_geometry.json` from a WebCraft client preview export into the ignored `data/armor-preview` directory. Copy the PNGs listed in the armor manifest's `textures` array into `data/armor-preview/textures` using their original `hash.png` names. These files provide the meshes, material layers, and trim textures. The local Equipment endpoint serves them for the configured player and server. Older equipment snapshots use the base material for known armor IDs. An updated WebCraft Equipment snapshot supplies trim material, trim pattern, and leather dye when applicable. If the armor assets or WebGL are unavailable, the profile uses its existing skin renderer.

The local ATM10 manifest also maps `railcraft:steel_chestplate` to `assets/railcraft/textures/models/armor/steel_layer_1.png` from the installed Railcraft Reborn JAR. This transparent 64 × 32 atlas supplies the chest and arm faces of the standard worn armor mesh. Preserve the local manifest entry and its hashed PNG when replacing the vanilla preview export.
