# Idle Driver

An idle game: you are the autopilot of a family SUV driving to the mountains. Miles accrue
automatically; spend them on upgrades to drive faster and reach the next landmark.

The owner works on this **entirely from a phone through Claude cloud sessions**. There is no
local machine, so everything must build, test, and be verifiable inside the cloud container,
and the result must be playable in a mobile browser.

## Stack

- TypeScript + Vite, no framework. Vitest for tests.
- `src/game.ts`: all game logic as pure functions over `GameState` (no DOM, no timers).
  Put new mechanics here and unit test them in `tests/`.
- `src/main.ts`: DOM wiring, game loop (`requestAnimationFrame`), save/load to `localStorage`,
  offline catch-up.
- `src/road.ts`: canvas drawing of the road scene.
- `src/style.css`: mobile-first styles (design for a ~390px wide phone first).

## Commands

The SessionStart hook (`.claude/hooks/session-start.sh`) runs `npm install` in cloud sessions.

- `npm run check`: typecheck + tests + production build. **Run before every commit.**
- `npm test`: unit tests only.
- `npm run screenshot [-- out.png]`: builds, serves, and saves a 390x844 phone screenshot
  (default `screenshot.png`, gitignored). Use it to visually verify UI changes, then read the
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
- Balance numbers (costs, speeds, landmark distances) live in `UPGRADES` / `LANDMARKS`.
- Vite `base` is `./` so the build works under the Pages sub-path; use relative asset paths.
- Work on a branch and open a PR; the owner reviews and merges from their phone.
