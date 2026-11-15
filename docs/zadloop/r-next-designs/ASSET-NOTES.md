# Factory "AFTER" concept — asset provenance (for plan packet E3)

Concept: `after-factory-pixel.html` → `~/workspace/your_files/warsha-after-factory.png`
Scene builder: `build-factory-scene.py` → `factory-scene.png` (768×448 native, 16px tiles)
Reference clone: `pixel-agents-ref/` = https://github.com/pixel-agents-hq/pixel-agents (shallow clone, 2026-11-15)

## Licence basis (as found in the repo)
- Repo `LICENSE`: **MIT**, © Pablo De Lucca — covers the project's own code and art files.
- `README.md` (line ~40): character pixel art "is based on the amazing work of
  [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack)"
  — the MetroCity pack is **CC0** (per the pack/repo attribution chain verified in research).
- The paid **Donarg** "Office Interior Tileset" is **NOT in the repo** — `docs/external-assets.md`
  only tells users how to slice their own copy. Nothing Donarg-derived was used.

## Taken from the repo (paths under `webview-ui/public/assets/` unless noted)
- Floors — REVISED after owner feedback («الارضيه مش لايقه ع الالوان خليها شكل مصنع اكتر»):
  the wood planks (`floor_5`), the tinted carpet/grid zones and the checkerboard
  (`floor_7`) are GONE — tinted or not, they read as an office/home. The only repo
  floor template still used is `floors/floor_2.png` (2×2 grid), re-tinted to dark
  slate for the bathroom. The main floor is drawn procedurally in the builder
  (see below): every repo floor template is a flat grayscale shape (planks /
  checker / plain grids), so none can produce a concrete texture by tinting.
- Furniture: `DESK/DESK_FRONT.png`, `DESK/DESK_SIDE.png`, `PC/PC_FRONT_ON_2.png`, `PC/PC_FRONT_OFF.png`,
  `TABLE_FRONT/TABLE_FRONT.png`, `WHITEBOARD/WHITEBOARD.png`, `BOOKSHELF/BOOKSHELF.png`,
  `CLOCK/CLOCK.png`, `LARGE_PAINTING/LARGE_PAINTING.png`, `SMALL_PAINTING/SMALL_PAINTING.png`,
  `HANGING_PLANT/HANGING_PLANT.png`, `WOODEN_CHAIR/WOODEN_CHAIR_FRONT.png`, `WOODEN_CHAIR/WOODEN_CHAIR_SIDE.png`,
  `SOFA/SOFA_FRONT.png`, `SOFA/SOFA_SIDE.png`, `COFFEE_TABLE/COFFEE_TABLE.png`,
  `SMALL_TABLE/SMALL_TABLE_FRONT.png`, `COFFEE/COFFEE.png`, `CUSHIONED_BENCH/CUSHIONED_BENCH.png`,
  `WOODEN_BENCH/WOODEN_BENCH.png`, `LARGE_PLANT/LARGE_PLANT.png`, `PLANT/PLANT.png`, `PLANT_2/PLANT_2.png`,
  `CACTUS/CACTUS.png`, `POT/POT.png`, `BIN/BIN.png`
- Pet: `pets/gitcat/pet.png` (one frame cropped)
- Characters: composited from the layered wardrobe sheets in `webview-ui/src/characters/art/`
  (each 128×96 = 8 frames × 3 directions of 16×32): `body/flat.png`, `body/bust.png`,
  `full/business_suit.png`, `full/suit_and_tie.png`, `full/dress.png`,
  `hair/{short,mop,long,parted,spiky,bowl_cut,slicked_back}.png`.
  Hair palette-tinted per character — this mirrors the app's own wardrobe recolor system.
- Panel avatar: one portrait cropped from `webview-ui/public/characters.png` → `panel-avatar.png`.
- Visual style locked against the repo's own screenshot `webview-ui/public/office.png`.

## Drawn for Warsha (same 16px pixel scale, in `build-factory-scene.py`)
Gate barrier post + striped arm, gate lamp post (A/B/C lamps),
packet boxes + motion-trail ghosts, cardboard shipping boxes,
burger on the coffee table, blueprint sheet on the planning table,
wall-mounted diff board (green/red rows) at the review bench,
bathroom partition + door + feet-under-door + WC (no bathroom assets exist upstream).
**Industrial floor set (the revision):** dark charcoal concrete base — per-pixel
speckle, 16px tile seams, 64px slab seams, small oil stains + pale scuffs
(fixed-seed RNG, reproducible); worn painted work-cell borders in Warsha yellow
around the planning / coding / review station groups with subtle per-zone floor
tints (coding slightly cool blue-grey, gates apron and dock progressively
darker); hazard-stripe bands (diagonal yellow/black, scuff-worn) across the
gates checkpoint stop zone and along the shipping-dock edge; worn yellow lane
dashes painted along the packet route (these replace the old faint dotted
route overlay, and the short dash row that used to sit in front of the barrier);
an industrial rubber mat (desaturated rust, speckled, stitched border) under
the break corner — warmer than the concrete so the corner still reads as the
life/break zone, but matting, not office carpet.

## Asset gaps found
- No bathroom/WC, gate/barrier, traffic-lamp, cardboard-box, or food sprites exist in the repo —
  all factory-specific props must be drawn in-house (done here at matching scale) or commissioned.
- No lying-down character frame exists; "sleeping" uses the seated frame + a 💤 bubble.
- No waving frame; the Gatekeeper's "needs you" state is carried by the yellow bubble + panel.
- Floors ship as flat grayscale templates (planks / checker / plain grids) — tinting them still
  reads as wood or checkerboard, never as concrete. A real implementation needs either a
  concrete-textured tileset or the procedural concrete + painted-markings approach used in
  this mock. (Walls/carpets remain ordinary tintable templates.)
