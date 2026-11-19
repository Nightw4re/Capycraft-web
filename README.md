# Capycraft

Vrstvená zimní scéna v poměru 16:9. Spouští se otevřením [index.html](index.html) v prohlížeči. Celá scéna sdílí jeden souřadnicový prostor. Rozložení a efekty řeší HTML a CSS, denní podmínky počítá malý skript.

## Kde dělat změny

- [index.html](index.html) obsahuje vrstvy, výchozí čas, umístění jednotlivých mraků a testovací ovládání. Zaškrtávací políčko ve skupině **Vrstvy** má mít stejnou hodnotu jako `id` cílové vrstvy.
- [styles.css](styles.css) určuje měřítko, polohu a pořadí vrstev, odstíny, masky a odrazy. `--waterline` udává začátek hladiny jako procento výšky scény. K tomuto údaji jsou vztažené polohy hor, lesa, ostrůvku a stínu krajiny.
- [scene.js](scene.js) čte jeden posuvník v minutách a z něj odvozuje výšku a pozici slunce a měsíce, denní a soumrakové světlo, viditelnost hvězd a náklon odlesků. Výchozí náhled je v 17:30.

## Pořadí vykreslení

| Vrstva od pozadí | Ovládání nebo podklad |
| --- | --- |
| Obloha | `.sky-base` s jednolitou barvou podle denní doby |
| Záře | `.sunset-gradient` barví celou šířku oblohy. `.sky-glow` obsahuje také soustředěnou záři slunce a modrobílou záři měsíce. Vysoké slunce má režimy Jemná, Halo a Odlesk objektivu. |
| Slunce a měsíc | Samostatné čtverce v `.celestial` |
| Hvězdy | [stars-voxel.png](assets/stars-voxel.png) s jemným zvýrazněním ve směru pásů mraků |
| Mraky | Tři výřezy z [clouds-sky.png](assets/clouds-sky.png), opakované v různých měřítcích a místy zrcadlené |
| Hladina a světelné odlesky | [water-ripples.png](assets/water-ripples.png) |
| Hory | [landscape-shore.png](assets/landscape-shore.png) |
| Vzdálený les | [forest-distant.png](assets/forest-distant.png) se samostatně zakončeným zasněženým břehem |
| Soumrakový závoj | `.sunset-wash` přenáší stejnou paletu s nižší intenzitou na vzdálený terén. Patří k přepínači Záře. |
| Stín hor | Převrácená, zploštěná kopie horského podkladu nad břehem a vodou |
| Pravý ostrůvek | [right-island.png](assets/right-island.png) |
| Pravé popředí | [right-foreground-bank.png](assets/right-foreground-bank.png) pro břeh a [right-foreground-waterline.png](assets/right-foreground-waterline.png) jako zdroj ker |
| Stopa odlesku objektivu | `.sun-flare-ghost` se zobrazuje v odpovídajícím režimu denní záře |

## Světlo a mraky

- Barva oblohy a jas terénu mají vlastní křivky v `renderTime()`. Krajina drží světlo déle než obloha a při západu přechází k modrofialové. Pravé popředí má slabší barevný posun, aby byla hnědá hlína rozeznatelná od šedého kamene.
- `.sun`, `.moon`, `.sky-glow`, `.sun-soft-glow` a `.sun-halo` určují barvy a velikosti jednotlivých efektů. Režim denní záře vybírají přepínače v `index.html`.
- `--sunlight` propojuje barvu slunce, širokého soumrakového závoje a odlesku ve vodě. Závoj je výraznější u hor a plynule mizí směrem k horní obloze i k hladině.
- `--sun-disc` nastavuje jednolitou výplň slunce a nejjasnější část okolní záře. `--sunset-light` řídí sílu závoje a jemné oteplení pravého ostrůvku a břehu v popředí.
- Soumrakový přechod je široký eliptický gradient. Teplejší odstíny vystupují výš u slunce a směrem od něj zůstává obloha chladnější. U vzdálených hor se při soumraku také mírně sníží kontrast.
- Pozici a velikost každé instance mraku lze změnit hodnotami `--x`, `--y` a `--width` v HTML. Souřadnice tří výřezů a rychlosti pohybu jsou v `.cloud-wide`, `.cloud-mid` a `.cloud-far`. Polední mraky jsou chladné a lehce průsvitné. Za soumraku se překrývají s hvězdami, v noci zmizí. Systémová volba omezeného pohybu vypíná jejich posun.

## Hladina, břehy a odrazy

- Sluneční a měsíční odlesk leží pod průsvitnou texturou vln. U břehu jsou úzké, do popředí se rozšiřují a při pohybu těles se jemně naklánějí ke středu obrazu. Intenzitu, šířku a barvy nastavují `.water-light-sun` a `.water-light-moon`. Slunce má navíc širší teplý rozptyl po stranách.
- `.water-landscape-reflection` tónuje zasněžený břeh i hladinu pod ním. Při nízkém slunci je tmavší a naklání se od něj. Při skrytí hor nebo vody se skryje také.
- Pravý ostrůvek má vlastní polohu a přepínač. Pro jeho případné přepracování je k dispozici [nenasazený skalnatý návrh](assets/right-island-rocky.png).
- Pravé popředí tvoří jedna přepínatelná skupina s břehem, dvojicí ker a jejich odrazy. Břeh je částečně za okrajem obrazu. Má hladší plochy, nepravidelné detaily, teplou zeminu, chladný kámen a tenkou tyrkysovou linku u vody.
- Kry přebírá `.foreground-floes` z původního PNG pomocí výřezu. Maska zeslabuje krytí modrých stěn a nechává sněhové vršky světlé. V `index.html` jsou body spodních hran ker v pixelech zdrojového obrázku o rozměru 1671 × 941. Každý úsek `.floe-reflection` zrcadlí svůj kus ledu kolem úsečky mezi dvěma sousedními body. Při výměně obrázku ker je potřeba upravit body i masku.

## Předlohy a kontrola změn

- [Původní zimní výjev](references/winter-scene.png) a [mapa hloubkových vrstev](references/depth-map.png) jsou uloženy v projektu pro další úpravy.
- Nové výřezy mají mít průhledné okolí a u terénu hotovou spodní hranu. Samostatné vrstvy zkontroluj i při skrytí vrstev, které je běžně překrývají.
- Při změně projdi v prohlížeči alespoň poledne, západ a noc. Na mobilu zkontroluj šířku scény a přístupnost přepínačů na výšku i na šířku.

<details>
<summary>Zadání ImageGen pro aktuální materiál pravého břehu</summary>

> Use case: precise-object-edit. This is the transparent right foreground artwork of the original Capycraft winter-lake scene. Edit ONLY the connected snowy bank at the lower right. Preserve the generous empty surrounding padding, the same camera, size, contour, 1671×941 16:9 canvas and position: highest point remains about y480 at the right edge; the leftmost attached shoreline remains about x880 and y875. Keep the right and bottom frame connections. Remove the two detached ice floes and their shadows entirely from THIS deliverable, since they will be layered separately at their original positions. Give the bank's block faces cleaner and smoother solid surfaces with crisp stepped edges. Replace the blurry or mottled face details with restrained, sharper small square material details, clean flat areas and readable ambient occlusion. Give earth and stone visibly distinct local colors: earthy warm chestnut and amber brown exposed earth faces versus more desaturated neutral/slate gray rock faces, with gentle cool light on shaded sides. The snow is white-blue with crisp substantial voxel edges. Keep the very thin turquoise wet line and faint fading broken reflection attached only to the real water contacts at the bottom of the connected bank. Preserve real alpha transparency around the bank and in the short shoreline fade. No blue backdrop, pools of painted water, mountains, props, structures, plants, detached ice, lettering, or framing. Only the same connected lower-right bank, with smooth clean materials, warm brown earth and distinct cool gray stone.

> Use case: precise-object-edit. Retouch this exact transparent 1671×941 Capycraft foreground bank. Preserve all pixel positions, the untouched transparent padding, silhouette, terraces, cool white snow, thin turquoise waterline and fading contact reflection, current warmth of chestnut earth and cool neutral slate gray stone. The ONLY change is the small regularly spaced lighter square marks currently in rows on the vertical brown and gray block faces. Remove those regular lines, including the crisp orange square decorations on the brown faces. Keep the broad smooth clean readable faces. If needed for material readability, add at most very sparse, irregular, low-contrast irregular natural mineral or earth flecks staggered at different heights and of unequal size. Most faces should be quiet and uninterrupted with natural subtle variation, not a decorative cake pattern. Keep the crisp major voxel edges and every existing large shape and position. True transparent alpha outside the bank, original overall composition, no new objects or floating ice.

</details>

