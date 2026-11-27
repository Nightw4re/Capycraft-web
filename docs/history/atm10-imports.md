# Historical ATM10 catalog measurements

These measurements describe earlier importer revisions and environments.

## Recipe uses response

On the local ATM10 catalog, the gzip response for iron ingot uses was 56,446 bytes, down from 1,367,709 bytes of JSON. In 48 first requests with empty handler caches and an established local HTTP connection, the handler took at most 7.1 ms. Forty-seven complete responses arrived in under 20 ms. The first HTTP request in a fresh process took 29 ms, including 5.6 ms in the handler. These timings exclude browser decompression and JSON parsing.

## ATM10 import baseline

On November 20, 2026, the local Windows import worker started at 12:28:35 CET and published the replacement catalog at 13:12:42 CET, about 44 minutes later. The submitted archive was about 202 MiB and contained 303,181 ZIP entries, 63,217 catalog items, and 1,972 variants. The previous catalog remained available while the replacement was prepared. The inbox upload was consumed after the successful import.

The new revision contained 61,064 WebP icons, 63,217 item detail files, 125,862 payload files, and 633 atlases. The running worker still used the earlier status format, so this run provides a wall-clock baseline without timings for individual stages. The measurements do not establish how much time went to ZIP reads, file writes, atlas generation, or CPU pacing.

## ATM10 sample benchmark

An isolated sample from the original archive contained 100 items from 42 mods, with 34 variants and 569 ZIP entries. Each configuration ran eight times in rotating order. These historical measurements used an earlier importer that could compose atlases.

| Configuration | Total | Atlas creation | ZIP reading | Storage writes and commit |
| --- | ---: | ---: | ---: | ---: |
| Files with atlases | 1,439 ms | 348 ms | 296 ms | 608 ms |
| Files with direct icons | 1,044 ms | 0 ms | 293 ms | 613 ms |
| SQLite with atlases | 581 ms | 311 ms | 155 ms | 23 ms |
| SQLite with direct icons | 288 ms | 0 ms | 174 ms | 27 ms |

Values are medians. Atlas creation includes its storage write, and the ZIP measurement includes reading the directory and inflating individual entries. The benchmark disables CPU pacing and skips live publication and backup rotation. The sample measures import work. Direct previews change the number of image requests, so browser load time is a separate measurement.

The full ATM10 archive was also imported into an isolated update using SQLite and direct previews. It published 63,217 items and 61,064 unique previews in 3 minutes 12 seconds. The importer read 235,464 non-image ZIP entries (about 663 MiB) and 64,318 preview entries (about 45 MiB). It performed 251,526 SQLite asset writes. These are application-level reads and writes. ZIP reading, including directory scanning and decompression, took about 98 seconds.

Reimporting the same archive through the running ATM10 inbox with SQLite and fluid recipes enabled prepared 63,632 catalog entries in 3 minutes 39 seconds. The import metrics exclude the inbox polling delay and backup cleanup. The published catalog returned Argon and Liquefied Source with their production recipes through the site API.
