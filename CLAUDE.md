# Idle Driver

An idle game: you are the autopilot of a family SUV driving to the mountains. Miles accrue
automatically; spend them on upgrades to drive faster and reach the next landmark.

The owner works on this **entirely from a phone through Claude cloud sessions**. There is no
local machine, so everything must build, test, and be verifiable inside the cloud container,
and the result must be playable in a mobile browser.

## Stack

- TypeScript + Vite, no framework. Vitest for tests.
- `src/game.ts`: all game logic as pure functions over `GameState` (no DOM, no timers).
  Put new mechanics here and unit test them in `tests/`. Distances are real route miles and speeds real
  mph (the trip is as long as the drive). Money ($) comes from stream viewers (followers raise the
  audience, hype spikes fade); gas costs money and Dad fills up when the tank runs dry. `LANDMARKS`
  (cities from the baked map plus sights and state lines) and `REGIONS` (scenery: viewer and takeover
  multipliers) are placed by route mile; a game clock runs 12x real time for day and night. Upgrades are
  sensors (repeatable), stream gear, driving
  features (one-time, with `requires`) and comfort; features set the autonomy level (L0-L5), which spaces
  out takeovers (the car stops until you tap, or online Dad sorts it out after a while). Dad's
  tiredness rises while driving (slower at higher autonomy); untapped takeovers and falling asleep
  cause crashes (repair cost + tow wait).
- `src/crashSim.ts`: the cartoon crash, simulated with cannon-es (only during crashes) and precomputed
  per frame; deterministic per seed. `src/scene/crashScene.ts` plays it with a see-through SUV and
  the family tumbling inside.
- `src/main.ts`: DOM wiring, game loop (`requestAnimationFrame`), save/load to `localStorage`,
  offline catch-up.
- `src/world.ts`: pure traffic lane logic and a seeded RNG.
- `src/perception.ts`: pure sensor model. Which wedges around the car each owned sensor covers
  (`sensorCones`) and whether a point is perceived. `src/scene/sensorShader.ts` draws it: full color
  inside the wedges, dim night-blue outside, glowing wedge edges.
- `src/map/`: pure map helpers. `geo.ts` (projection, resampling, lane/building rules; also used by
  the bake script), `chunk.ts` (baked chunk format, position/heading along the route) and `strip.ts`
  (the route strip minimap).
- `src/scene/`: Three.js rendering. `mapScene.ts` loads chunks around the car and drives the SUV,
  traffic and camera; `mapMeshes.ts` builds terrain/roads/buildings/trees for a chunk; `models.ts`
  has the low-poly cars. Rendering reads game state and owns no rules.
  URL options: `?seed=N` fixes traffic, `?mile=N` shows that spot on the route.
- `scripts/bake-map.ts` + `public/map/`: the real-world map, pre-baked (see
  `docs/prototype-plan.md`). Re-run with `NODE_USE_ENV_PROXY=1 node scripts/bake-map.ts`
  (Node's fetch needs that flag to use the cloud proxy); `--chunks 0-5` bakes a range.
- `src/style.css`: mobile-first styles (design for a ~390px wide phone first).

## Commands

The SessionStart hook (`.claude/hooks/session-start.sh`) runs `npm install` in cloud sessions.

- `npm run check`: typecheck + tests + production build. **Run before every commit.**
- `npm test`: unit tests only.
- `npm run screenshot [-- out.png] [--mile N] [--levels camera:5,radar:2] [--cash 500] [--takeover storm]
  [--crash spin --wait 4000] [--tired 0.7] [--away 7200] [--state '{"followers":300}']`: builds, serves,
  and saves a 390x844 phone screenshot (default `screenshot.png`, gitignored), optionally at mile N of
  the route, with those upgrades owned, that much cash, stuck on a takeover, mid-crash (`--wait` ms after
  load picks the moment), with Dad that tired, back from N seconds away, or any other save fields. Use it to visually verify UI changes, then read the
  image. It exits non-zero if the page logs errors.
- `npm run dev`: dev server (not usually useful in the cloud since the owner can't open it).

`playwright` is pinned to the version whose Chromium is preinstalled in the cloud image
(`/opt/pw-browsers`). Don't bump it or run `playwright install`.

## Deploy

`.github/workflows/ci.yml` runs typecheck/tests/build on every PR. Pushes to `main` also deploy
`dist/` to GitHub Pages, which is how the owner plays the latest build on their phone:
https://maybetallgames.github.io/Idle-Driver/

The footer shows `build <sha>` so the owner can tell which commit they're playing.

## Conventions

- Keep logic pure and tested; keep `main.ts` thin.
- Save format: if you change `GameState`, keep `deserialize` backward compatible (old saves
  must load) and add a test for it. Bump `SAVE_VERSION` if a migration is needed.
- Balance numbers (costs, speeds, stream, gas, landmark distances) live in `UPGRADES`, `LANDMARKS`, `STATES`
  and the constants at the top of `game.ts`.
- Vite `base` is `./` so the build works under the Pages sub-path; use relative asset paths.
- Work on a branch and open a PR; the owner reviews and merges from their phone.
