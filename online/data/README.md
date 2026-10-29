# Draft Arena Online — player data

`players.js` exports `DATA_META` (sources, dates, per-group counts) and `PLAYERS`
(320 players, one object per line). It is generated, don't edit it by hand. Re-run the recipe below.

## Sources (fetched 2026-10-29)

| Data | Source | Notes |
|---|---|---|
| OVR, face stats, all detailed attributes, positions, weak foot, skill moves, preferred foot, club, league, nationality, birth date | **EA SPORTS FC 27 official ratings site** `https://www.ea.com/games/ea-sports-fc/ratings` | The pages are Next.js. Each page embeds 100 players as JSON in `<script id="__NEXT_DATA__">` (`pageProps.ratingDetails.items`). Filters: `?gender=0&position=<id>&page=<n>`, `?gender=0&nationality=48` (Turkey), league page `/leagues-ratings/trendyol-super-lig/68?page=<n>`. |
| Market value (`mv`, `mvDate`) | **Transfermarkt** (transfermarkt.com) | The quick-search page `schnellsuche/ergebnis/schnellsuche?query=<name>` finds the player id. `ceapi/marketValueDevelopment/graph/<id>` gives the value history, and the last entry is the current value plus the date TM set it (`mvDate`). |
| Season form (`form`), height | **FotMob** public JSON | Search: `https://www.fotmob.com/api/data/search/suggest?term=<name>&hits=20&lang=en`. Player: `https://www.fotmob.com/api/data/playerData?id=<id>`, which provides `recentMatches` (about the last 60 matches with per-match rating, minutes, goals and assists) and `playerInformation` (height). |

## Field mapping

- `id` is `ea-<EA player id>`. `name` is EA's common name, or first + last name.
- `nat` is the EA nationality label mapped to a FIFA trigram (England/Scotland/Wales are separate: ENG/SCO/WAL; Kosovo is `KVX`).
- `club` is EA's team label. Unlicensed or short names are mapped: Lombardia FC → Inter, Milano FC → AC Milan, Bergamo Calcio → Atalanta, Paris SG → Paris Saint-Germain, Man Utd → Manchester United, Spurs → Tottenham Hotspur, etc. (`CLUB` in `build_players.py`). `league` is EA's league label, shortened (LALIGA EA SPORTS → LaLiga, Serie A Enilive → Serie A, Ligue 1 McDonald's → Ligue 1, ROSHN Saudi League → Saudi Pro League). `Trendyol Süper Lig` is kept as is.
- `age` is computed from EA's birth date as of 2026-10-29.
- `foot` comes from EA `preferredFoot` (1 = R, 2 = L). `weakFoot` = `weakFootAbility`, `skillMoves` = `skillMoves`.
- `pos`/`alt` are EA `position.shortLabel` / `alternatePositions[].shortLabel`. EA FC 27 has no CF/RWB/LWB primary positions, so none appear as `pos`. Wing groups are LM+LW and RM+RW.
- The outfield face stats `pac sho pas dri def phy` are EA's card values. **Goalkeepers** have `div han kic ref spd gkp` instead of `pac…phy`, read from the same six card slots (EA stores GK DIV/HAN/KIC/REF/SPD/POS in the pac/sho/pas/dri/def/phy slots).
- `a` holds EA's detailed attributes: acceleration→acc, sprintSpeed→spr, positioning→pos, finishing→fin, shotPower→spw, longShots→lsh, volleys→vol, penalties→pen, vision→vis, crossing→cro, freeKickAccuracy→fk, shortPassing→spa, longPassing→lpa, curve→cur, agility→agi, balance→bal, reactions→rea, ballControl→bco, dribbling→dri, composure→com, interceptions→int, headingAccuracy→hea, defensiveAwareness→daw, standingTackle→stt, slidingTackle→slt, jumping→jmp, stamina→sta, strength→str, aggression→agg, gkDiving/Handling/Kicking/Positioning/Reflexes→gkdiv/gkhan/gkkic/gkpos/gkref. Every player has all 34.
- `height` comes from FotMob, because EA's ratings site sends `height: ""`. It is null where FotMob could not be matched.
- `mv` is Transfermarkt's current value in EUR, and `mvDate` is the date Transfermarkt last set that value (not the fetch date).
- `form` covers every competitive match FotMob lists **since 2026-07-20**, which is the 2026/27 season after the World Cup final. National-team games count, club friendlies don't. `rating` is the mean FotMob rating of the rated matches (2 decimals). `apps` counts matches played, including short sub appearances without a rating. `last` holds the ratings of the last ≤5 rated matches, most recent last. `minutes`, `goals` and `assists` are season sums. `date` is the fetch date. `form` is null if the player could not be matched or has played no 2026/27 match.

## Matching rules (no guessing)

- **FotMob:** a search hit is accepted only when its birth date **equals EA's birth date**. Otherwise `form` and `height` are null.
- **Transfermarkt:** a search row is accepted only if its age is within ±1 of the EA-derived age **and** one of its nationalities equals the EA nationality. If several rows qualify, the best club-name match wins, and if that is still a tie, the exact age decides; otherwise the player gets no value. Ages and birth dates are unchanged, but names are spelled as on TM.

## Selection

`select_players.py` takes the highest-OVR men (ties broken by EA rank) per group. Targets: GK 30, CB 55, RB 25, LB 25, CDM 28, CM 40, CAM 25, LM/LW 30, RM/RW 30, ST 32. It then swaps in the best Süper Lig / Turkish-national players (OVR ≥ 74, at most 7 swaps per group) for the lowest-rated others in the same group, until 44 such players are in the pool.

## Coverage (build of 2026-10-29)

These are the 320 players: GK 30, CB 55, RB 25, LB 25, CDM 28, CM 40, CAM 25, LM/LW 30, RM/RW 30, ST 32. OVRs run from 77 to 91. 44 are Süper Lig or Turkish (36 play in the Süper Lig, 15 are Turkish nationals, 7 are both).

| Field | Coverage |
|---|---|
| Detailed attributes (all 34) | 100% |
| Height (FotMob) | 100% |
| Market value (Transfermarkt) | 100% |
| Form | 98.4% |

Values were set between 2026-05-21 and 2026-10-07. Form is null for 5 players with no 2026/27 appearance so far: Saliba, Khéphren Thuram, Rodrygo, Mitoma, Ekitiké. 6 players have fewer than 3 apps. Éder Militão has 1 app with no rating, so his `rating` is null.

## Missing / caveats

- **Work rates are not published by EA's ratings site**, so `workAtt`/`workDef` are `null` for everyone.
- Height comes from FotMob, not EA.
- **Clubs are EA's** (the FC 27 database as of 2026-10-29), and some lag behind real transfers. For these players, Transfermarkt and FotMob agree on a different current club (EA → real): E. Martínez Aston Villa → Chelsea, Livaković Fenerbahçe → Barcelona, J. M. Giménez Atlético → Deportivo, Diego Carlos Fenerbahçe → Parma, D. Muñoz Crystal Palace → Nottingham Forest, Palhinha Bayern → Benfica, Amrabat Fenerbahçe → Ajax, Enzo Fernández Chelsea → Man City, Palacios Leverkusen → Ipswich, Talisca Fenerbahçe → Al-Jazira, Barcola PSG → Liverpool, Rafael Leão Milan → Galatasaray, Pedro Gonçalves Sporting → Fiorentina, Grealish Man City → Everton, Marmoush Man City → Tottenham, Ndiaye Everton → Man City, Diaby Al Ittihad → Leverkusen, Watkins Aston Villa → Al Hilal. `form` and `mv` reflect the real club.
- EA lists West Ham under "EFL Championship" and a few big names in the Süper Lig (Salah at Trabzonspor, Ederson/Kanté/Asensio at Fenerbahçe, Osimhen/Leroy Sané at Galatasaray). Transfermarkt and FotMob show the same clubs. These are kept exactly as EA has them.

## Re-run recipe

```bash
RAW=/path/to/scratch/data-raw          # keep raw downloads OUT of the repo
W=/path/to/scratch/work; mkdir -p $RAW $W
T=online/tools/data
python3 -I $T/fetch_ea.py      $RAW/ea  $W/ea_pool.json          # ~32 pages, ~1 min
python3 -I $T/select_players.py $W/ea_pool.json $W/selected.json
python3 -I $T/fetch_fotmob.py  $W/selected.json $RAW/fotmob $W/fotmob.json   # ~20 min, cached
python3 -I $T/fetch_tm.py      $W/selected.json $RAW/tm     $W/tm.json       # ~20 min, cached, 1 req/s
python3 -I $T/build_players.py $W/selected.json $W/fotmob.json $W/tm.json online/data/players.js $W/clubdiff.json
node $T/validate_players.mjs
```

All fetchers cache raw responses, so a rerun only downloads what is missing. Delete the cache directories to refresh the data. The FotMob and TM steps can run in parallel because they hit different hosts. Re-running `fetch_tm.py` retries value-history requests that failed (TM occasionally answers HTTP 405).
