# Players and progress

## Players

Open **Players** at `/players` to choose a server with a player list. If a compatible server is already selected, the header link opens its list directly. An instance with a live roster shows the players that WebCraft lists online with their Minecraft heads and round-trip latency. The connection indicator shows good at up to 75 ms, fair at up to 150 ms, and high latency above 150 ms. A player without a loadable Java skin gets a name-based icon. The directory combines online players with known names from the server roster and saved statistics. The default sort shows online players first, then offline players from most to least recently seen. Players without a recorded time appear last. The picker also offers name, time played, achievements, and quests when supported. Each row shows time played or the selected progress count. When the live feed is unavailable, rows show the last known records. Select anywhere on a player row to open the profile with a slide and fade. The status dot opens status details. Switching servers in the header keeps the selected player and profile tab. Profiles show the current or last known game mode and operator permissions when supplied. Creative is marked once it has been observed on that instance. The API stores downloaded skins in SQLite and uses the cached image while refreshing.

To publish the live roster for an instance, include `players` in its `tabs` and set `"onlinePlayersTransport": "websocket"` or `"onlinePlayersTransport": "http"` in its private `server.json`. Enable `onlinePlayersEnabled` in WebCraft and allow the matching transport for that feed. Set `tokenEnv` to a Node environment variable holding the same machine token as WebCraft's `WEBCRAFT_FEED_TOKEN`. If you add `tokenEnv` to an instance that uses a public status feed, set `"statusExposure": "public"` explicitly. Restart the Node API after changing its configuration.

WebCraft applies Minecraft's online listing settings. The live head lookup is limited to players currently listed online. Profile and portrait skins have separate checks for known names in [the player route](../server/index.mts). The browser requests `GET /api/players?server=<alias>&online=1` and subscribes on the same-origin `/api/live` socket. In WebSocket mode, Node subscribes to WebCraft and resubscribes after disconnects. In HTTP mode, Node polls about every five seconds even when nobody has the page open. Route both `/api/players` and `/api/live` to the Node API in Caddy. Keep WebCraft's internal endpoints and token on the private side of the proxy.

Updated WebCraft instances also send maximum health and time played. Maximum health includes live modifiers from equipment, affixes and effects. Capycraft shows it only for players listed online. Time played uses the Minecraft play-time statistic in whole minutes and can include time spent AFK. Capycraft saves the last observed value and observation time in SQLite by server alias and Minecraft UUID. The Players page shows previously observed names and their saved time and last online observation after they leave or the feed goes offline. Minecraft UUIDs stay private. Older WebCraft versions continue to provide names and latency.

When the WebCraft player roster is enabled, Capycraft also imports play time from saved world statistics. Players with a known name can show time played before their first login after the update. An imported play-time value alone does not establish when the player was last online.

Run `node --test tests/onlinePlayers.test.mts` to exercise both transports, browser subscriptions, and directory recovery with loopback fixtures.

Instances without a live roster keep the alphabetical list of previously recorded usernames. The [Node.js API](../server/index.mts) fetches WebCraft player histories on startup and about once a minute. It keeps one entry per Minecraft UUID and uses the name from the latest known login on that server. The SQLite list retains previously collected names during outages.

## Player history setup

On each Minecraft instance, install a WebCraft Core version with the player history feed. Enable `listenerEnabled` and `playerHistoryEnabled` in `webcraft-server.toml` and set `WEBCRAFT_FEED_TOKEN` in the mod's process environment. Set `"playerHistory": true` and reference the token with `tokenEnv` in the Capycraft instance definition. Existing installations can keep using `WEBCRAFT_PLAYER_FEEDS` in the ignored `.env.local`. Each entry supplies `server`, `url`, and `token` and takes priority for that instance. An entry with no alias uses the default server.

```dotenv
WEBCRAFT_PLAYER_FEEDS='[{"server":"universum","url":"http://127.0.0.1:8765/api/v1/internal/players","token":"REPLACE_WITH_THE_INSTANCE_FEED_TOKEN"}]'
```

The API stores data at `data/players.sqlite` by default. Set `CAPYCRAFT_PLAYER_DATABASE` to use a different path. WebCraft records logins after the feature is enabled. Earlier logins would need a separate import from existing records.

## Achievements and lifetime roster

Open **Achievements** from a player profile. The tab shows that player's visible progress on the selected instance and puts completed achievements first. The catalog supplies in-game groups and item icon IDs. Item icons appear when the corresponding item is in the published item export. Hidden advancements, recipes, and entries without display metadata are excluded by WebCraft. The old `/server/<alias>/achievements` link opens the Players list.

To publish the tab, set `"achievements": true` and include `"achievements"` in the instance's private `tabs` list. Set `"playerRoster": true` to collect known names for the player picker and dashboard. Enable `advancementsEnabled` and `playerRosterEnabled` in WebCraft, allow HTTP access to both feeds, and configure the same machine token through the instance's `tokenEnv`. Both feeds remain on the private side of the proxy. Restart the Node API after changing instance definitions.

Node imports enabled rosters at startup and about once a minute into the player SQLite database. Dated player history takes precedence for the same UUID. Undated roster names are ordered by when Capycraft first saw that spelling or saw it change. The selected server uses its own known names. The aggregate dashboard merges across worlds and collapses duplicate names case-insensitively. Unknown names are skipped. A player whose name is no longer known to WebCraft may be missing from the picker, or a previously cached name may no longer resolve to progress after server data changes.

### Achievements API and cache

The public `/api/players?roster=1` returns names only. Add `server=<alias>` to scope it. `/api/achievements?server=<alias>` returns the shared catalog. Add `player=<name>` for a known player's completion data or also add `view=progress` for just counts, completed IDs, and available completion dates. The [achievement handler](../server/achievements.mts) and [catalog reader](../src/achievements.mts) own payload fields and limits.

The [SQLite progress cache](../server/progressCache.mts) keys entries to the published item revision. Catalogs with board positions are fresh for one day. Older catalogs without those positions are rechecked after a minute. Compact progress is fresh for 15 seconds.

Run `node --test tests/achievements.test.mts` to verify roster persistence, instance and player access, and the catalog and progress responses.

## FTB Quests

Open **Quests** from a player profile to see the shared progress of their FTB team on the selected instance. The tab shows a status message when the feed or saved progress is unavailable. Select a chapter from the sidebar or expand a chapter group by its heading. On narrower screens the sidebar sits above the board. Older server quest links lead to the player list or to the named player's Quests tab.

Install the WebCraft Quests addon on a server with FTB Quests and add `webcraft_quests:quests` to WebCraft's `enabledModules`. Allow HTTP access to its machine-only `/api/v1/internal/modules/webcraft_quests/quests/data` route. In Capycraft's private `server.json`, set `"quests": true`, add `"quests"` to `tabs`, and set `tokenEnv` to the environment variable containing the WebCraft machine token. Set `"playerRoster": true` and enable WebCraft's player roster feed over HTTP to populate the picker from the world's saved names. Restart the Node API after editing the instance definition.

### Profile views and boards

The player profile opens on Inventory, with its hotbar below the storage slots. The [local equipment preview](local-equipment.md) shows the player and equipped items when configured. The profile fetches shared catalogs separately from player completion data. A profile without saved team progress can still browse its quest catalog. Achievements default to Board and Quests default to List. The site remembers each view preference separately. Select a chapter or advancement group to see its graph. The quest list shows one title per row. Clicking an achievement pins its tooltip until a different achievement is selected. Clicking a quest opens a dialog with its description and any exported tasks, rewards, and prerequisites. View, chapter or group, and open details are stored in the address so they can be shared or restored on reload.

The boards use game coordinates, connections, and the server's published item imagery where available. An updated WebCraft Quests add-on also exports group and chapter icons and visible decorative PNGs. Item-based images use the server's published item catalog. The add-on reads texture PNGs from installed mods, `kubejs/assets`, and the game's `webcraft-assets/quest-art/assets/<namespace>/textures/` directory. Copy publicly shareable resource-pack images into that directory if the textures only exist on the client. Missing catalog items and textures use icon placeholders or leave decorations out. Older WebCraft catalogs without layout data show a grid of unconnected nodes.

Tasks and rewards that involve items appear as square slots. Hover or focus a slot to see the item tooltip, click to pin its tooltip, click the slot again to open recipes, or right-click to see recipes that use it. Closing the item dialog returns to the same quest. Quantities are shown in the corner, including an inclusive range for rewards with a random bonus. A filter-based task uses its configured artwork or a representative matching item. If no match can be exported, the task still appears without a recipe link.

The local ATM10 server's quest-art directory includes the six PNG references from `mainquestline_part_1.snbt`. These came from the installed ATM10 client's `kubejs/assets/atm/textures/questpics/` directory and supply the board title and chapter illustrations. The server copy preserves the original namespace, paths, and transparency.

### Quests API and cache

`GET /api/quests?server=<alias>` returns `total` and `chapters`, with chapter IDs and titles and each quest's ID, title, and description. Add `player=<name>` to receive the matched game name, `completed`, and `completedIds`. Capycraft resolves the name within that instance using the private roster and player history. Unknown or ambiguous names and a team without saved progress receive distinct HTTP 404 states. Only the private upstream request contains the UUID and machine token. The public response includes no team name.

The API stores the whole quest catalog in SQLite per server and published item import revision. The first request for a new revision refreshes the catalog, and concurrent requests share that refresh. Catalogs from the current WebCraft version have no time-based expiry. Responses from older versions are checked again after one minute so a WebCraft upgrade can take effect without an item import. Player progress is requested and cached separately for 15 seconds. Full player responses combine the shared catalog with that progress.

Run `node --test tests/quests.test.mts` to verify instance opt-in, private player resolution, public response fields, and failed progress.
