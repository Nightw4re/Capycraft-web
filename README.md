# Capycraft Web

Capycraft Web má sloužit jako veřejná prezentace Minecraft serveru Capycraft a jako informační přehled pro jeho hráče.

## Aktuální stav

V repozitáři je statická vizuální scéna přes celé okno prohlížeče. Veřejná prezentační stránka a hráčský přehled jsou plánované.

Otevři [index.html](index.html) přímo v prohlížeči. Rozložení vrstev a výřezy jsou v CSS uvnitř HTML. Scéna nepotřebuje server ani instalaci.

## Obrazové podklady

- [Dračí výjev](assets/dragon-battle-background.png) je dodaný soubor `Válka draků nad korálovým golemem.png`. Tvoří neprůhledné pozadí, které vyplňuje okno.
- [Zasněžené ostrovy](assets/capybara-snow-islands.png) jsou dodaný soubor `Sněhové ostrovy s kapybarou a magickou zahradou.png`. Průhledný PNG se zobrazuje dvakrát s různými CSS výřezy. Zahrada je ve vzdálenější vrstvě a kapybara v bližší.

Oba soubory jsou uložené v původní podobě.

## Historie a pravidla práce

Dřívější dynamická zimní scéna s denním cyklem, ovládáním vrstev a technickými poznámkami je v commitu `d7567392f459a06d22b68db41c1603c8372496bd`. [Zimní předloha](references/winter-scene.png) a [mapa hloubkových vrstev](references/depth-map.png) zůstávají dostupné v projektu.

Pravidla pro změny a jejich ověření jsou v [AGENTS.md](AGENTS.md).
