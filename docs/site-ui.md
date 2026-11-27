# Site UI and artwork

## Home and navigation

The home page (`/`) shows a full-screen winter scene, an illustrated highlight, and square-cornered information panels. The server overview shows a card for each server in the header picker. It displays the information and status reported by WebCraft and keeps the last known server information during outages. The two corner illustrations sit above the scrolling content, and the native scrollbar stays visible beside them. The landscape and header stay in place while the information panels scroll. Below 550 px, the corner illustrations take up a larger share of the width until they reach a limit that leaves a gap between them. Home includes a player dashboard preview.

A pixelated square fills as the browser decodes the landscape, island, and logo images. Once the images are ready, the large logo drops into the center over the blurred landscape. The dark header slides in, and the logo shrinks and moves to its left edge. After the logo settles, the navigation entries appear one at a time from left to right. The header controls slide in from right to left as the landscape comes into focus. Page content slides in and fades into view when the intro ends, or as soon as the images are ready with the intro turned off. With reduced motion enabled, the finished scene appears as soon as the images are ready. The loading screen offers a retry if an image fails to load.

[index.html](../index.html) loads [src/main.tsx](../src/main.tsx), which mounts [App](../src/App.tsx) in the shared [WinterScene](../src/scene/WinterScene.tsx). The logo in [SceneHeader](../src/scene/SceneHeader.tsx) links home. Old links to the information page also open the home page. [SceneBackground and SceneIslands](../src/scene/SceneBackground.tsx) render the landscape and the two island cutouts. [SceneEntrance](../src/scene/SceneEntrance.tsx) waits for the images and runs the entrance animation.

See [navigation](../src/navigation.ts) for current paths and legacy hash shortcuts such as `#/items` and `#/players`. The `/404` route shows an illustrated [404 page](../src/layout/PageError.tsx). The page offers a link home. The Players view uses the same layout to show sign-in and permission messages if its API responds with 401 or 403.

[PageLayout](../src/layout/PageLayout.tsx) provides a single column or a responsive grid for content such as [InfoPanel](../src/layout/InfoPanel.tsx).

On wide screens, the server overview sits beside the [home highlight](../src/layout/HomeHighlight.tsx). On narrow screens, a compact card above the highlight shows the selected server or an available server, its occupancy, and its copyable address. The full overview follows the information panels.

The home highlight rotates through seven localized facts every 20 seconds. The text and artwork slide horizontally when the active fact changes. Original inline vector icons mark the previous and next buttons on the left and the play or pause button on the right. All three buttons keep the same size while rotation is toggled. With reduced motion enabled, rotation starts paused and manual changes are immediate. Each [fact](../src/layout/homeHighlightFacts.ts) includes its own artwork setting. All seven currently use the winter capybara crop. The wildlife facts draw on [research on capybara digestion](https://link.springer.com/article/10.1007/BF00264639), [observations of cecotrophy](https://www.sciencedirect.com/science/article/abs/pii/S0168159199000805), [research on wombat droppings](https://doi.org/10.1039/D0SM01230K), and the [San Diego Zoo’s capybara profile](https://animals.sandiegozoo.org/animals/capybara).

When a server is configured, the [home leaderboard](../src/layout/HomeLeaderboard.tsx) appears below the player dashboard. Use the top tabs to choose a server and the bottom tabs to rank its players by completed achievements or FTB team quests. The three places remain visible even when vacant or when the corresponding feed is unavailable.

The full player dashboard is planned.

The outline inside the play or pause button fills as the current fact's 20-second interval elapses. Pause holds the current progress until playback resumes. Selecting another fact manually resets the outline and pauses playback.

The header places the server picker after Home. Selecting a server reveals its tabs one at a time, or immediately with reduced motion. The browser tab remembers the selected server when you return to Home. Choose **Select server** in the picker to clear the selection. Players stays in the navigation, and clearing the server from Players opens the server selection page. Shared server links use the server alias in the URL to set the selection. When you switch servers from a section the new server omits, the picker opens the new server's home page. The header shows the current language as a flag. The language menu offers English, Czech, Japanese, Ukrainian, German, French, and Spanish. Server-provided content uses the language supplied by the server. English is the default for new visitors. A swatch grid offers all 16 Minecraft dye colors and defaults to green. The selected color accents the highlight, controls, and panel borders, with a subtler tint on panel backgrounds and text. The Intro switch controls whether the entrance plays on the next load. The browser remembers these preferences. [Account sign-in](account-sign-in.md) is optional.

## Offline and render-error pages

After a successful visit over HTTPS or on loopback, the service worker saves the offline page in the browser. If a page navigation fails to connect or returns HTTP 502, 503, or 504, it shows **Server offline**. If the site crashes while rendering, it shows **Something went wrong** using the same layout. **Try again** reloads the original address.

Both pages embed the existing [dragon battle backdrop](../assets/dragon-battle-background.png), the [supplied electric capybara illustration](../assets/capycraft-capybara-electric-transparent.webp), the [winter logo](../assets/capycraft-winter-logo.png) for the header and entrance animation, and the site's [tab icon](../public/favicon.png). The header keeps the home logo link and the site's language and color pickers. Both pages use the saved theme and intro settings and respect reduced motion. If an in-site navigation leads to a render error, the fallback appears without replaying the intro. Changing the language also sets the `lang` parameter on the current address.

Select **Play mine maze** to guide a capybara through a mine with the arrow keys or by swiping on the game board. Collect every diamond and dodge the minecarts to unlock the exit. The game and its original canvas pixel art are bundled into the offline page and need no additional network requests.

To verify it, open the site and wait for the service worker to activate in the browser's developer tools. Take the site offline and reload normally. Check the offline panel at desktop and narrow mobile widths and open the maze at both sizes. Check arrow-key and swipe controls, then restore the connection and select **Try again**.

## Artwork

- The [dragon battle](../assets/dragon-battle-background.png) comes from `Válka draků nad korálovým golemem.png` and serves as the opaque full-screen background.
- The [snow islands](../assets/capybara-snow-islands.png) come from `Sněhové ostrovy s kapybarou a magickou zahradou.png`. The scene displays the transparent PNG twice with different CSS crops, placing the garden behind the capybara. CSS draws the capybara's eyelid to match the position and colors of the original artwork. The capybara blinks at irregular intervals and keeps its eye open when reduced motion is enabled. The home highlight and 404 page crop the same artwork to show the capybara and lantern.
- The [winter logo](../assets/capycraft-winter-logo.png) comes from `Zimní logo CAPYCRAFT s kapybarou (1).png`. It starts large in the center of the scene and finishes at the left of the header.

The repository preserves all three supplied images in their original form. The Discord invite uses a [white Discord symbol](../assets/discord-symbol-white.svg) based on the [official vector](https://discord.com/branding). Its outline uses rounded curves at the corners and is displayed at 36 × 27 CSS pixels.

The [browser tab favicon](../public/favicon.png) is the supplied transparent pixel-art capybara.

The [paper copy icon](../assets/pixel-copy-papers.png) and [example server keep](../assets/example-server-keep.webp) are original pixel art for the server cards. Both use a transparent background.

The dashboard preview uses [Nugwa's local 64 × 64 classic Java skin](../assets/nugwa-a7cd3a2452c6.png), obtained from the [Minecraft texture service](https://textures.minecraft.net/texture/a7cd3a2452c60522337b72e157429e2ff6ec4a90287a8d685a4bf5aada0177a5) through the [Nugwa profile](https://sessionserver.mojang.com/session/minecraft/profile/a0ea91265d8e40218f45c610125e2f75). In the [solo scene](../src/portrait/nugwaAnimation.ts), Nugwa looks both ways, stands, and turns to wave before leaving on the left. He peeks in from the right and returns to the [seated pose](../src/portrait/nugwaPose.ts).

In the [grass block scene](../src/portrait/blockScene.ts), the block rolls to the left after bumping the seated player. The other player claims the seat while the first investigates, then the first carries the block away. This scene requires two distinct usernames. [The loop](../src/portrait/portraitAnimation.ts) can also pair the departure and arrival clips with different players. It follows the cast order and wraps back to the first player. The bundled cast includes [nightware6's local 64 × 64 classic Java skin](../assets/nightware6-56ec53e9f367.png) from the [Minecraft texture service](https://textures.minecraft.net/texture/56ec53e9f3674c0f7aa8e99d2233002529968a1aa1428dafab94f399e0fa1463). The grass block uses an [original pixel texture](../src/portrait/grassBlock.ts).

The [renderer](../src/portrait/renderPortrait.ts) adapts WebCraft Armor Preview's expanded outer skin, depth testing, nearest-neighbor texture sampling, and two-light shading. It supersamples the outlines to smooth the edges in motion.

[NugwaPortrait](../src/portrait/NugwaPortrait.tsx) cycles through all distinct known names for the selected server, or across enabled rosters and historical names when no server is selected. It loads the first two skins, prefetches one future skin at a time, and keeps up to six in the portrait cache. The name changes when a new character comes into view. A player with an unavailable skin appears as a labeled placeholder. If the roster has no names, the canvas uses the bundled cast. The API looks up recorded usernames through Minecraft's profile and texture services.

An explicit `players` list keeps its supplied playback order and skips unavailable skins. Set `arrival` to `same` to open with the same player returning, or `next` to alternate the departure-and-arrival scene with the grass block scene. A cast of one always plays the departure and return.

The portrait uses WebGL2 when available and switches to Canvas 2D if initialization fails or the WebGL context is lost. Playback runs while the card and browser window are active and resumes from the same point after switching windows or scrolling away. If Canvas 2D also fails, the card loads the transparent [animated PNG](../assets/nugwa-animated.png). The transparent [seated PNG](../assets/nugwa-seated.png) appears while the canvas loads and whenever reduced motion is enabled. The PNG exports use the bundled cast, shared animation, and Canvas 2D renderer.

### Portrait development

To compare renderer costs on the same device, open Home with `?portraitPerf` and then with `?portraitPerf&portraitRenderer=2d`. Keep the portrait visible and the window focused. Every 120 drawn frames, the console reports the active renderer and the median and 95th percentile CPU draw times in milliseconds. WebGL2 timing measures CPU submission time. Use a browser performance trace for GPU work and overall frame pacing.

Edit [portrait-players.json](../portrait-players.json) to add or reorder distinct Minecraft Java usernames with public custom skins. A list with one name plays only the solo scene. Run `npm run export:nugwa` after editing the cast, poses, scenes, or renderer. It downloads skins for new names from Minecraft's profile and texture services, reuses saved skins for existing names, and regenerates the cast and both PNGs. Run `npm run export:nugwa -- --refresh-skins` to fetch updated skins for names already in the cast. The site reads the generated assets locally.

## Fonts

Headings and recipe quantities use [Chakra Petch](https://github.com/google/fonts/tree/main/ofl/chakrapetch). Body text uses [Barlow](https://github.com/google/fonts/tree/main/ofl/barlow), and server statistics use [Barlow Condensed](https://github.com/google/fonts/tree/main/ofl/barlowcondensed). The build serves Latin and Latin Extended WOFF2 files locally, with system fonts available as fallbacks for other scripts. See the licenses for [Chakra Petch](../public/licenses/chakra-petch-ofl.txt) and [Barlow](../public/licenses/barlow-ofl.txt).
