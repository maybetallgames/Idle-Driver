# Idle Driver

An idle game where you control the autopilot of a family SUV on its trip to the mountains.

**Play the latest build:** https://maybetallgames.github.io/idle-driver/

## Development

Built with TypeScript, Vite, and Vitest. Designed to be developed entirely from Claude cloud
sessions (see `CLAUDE.md`).

```sh
npm install
npm run check       # typecheck, test, build
npm run screenshot  # phone-sized screenshot of the built game
npm run dev         # local dev server
```

Every PR runs CI. Merging to `main` deploys to GitHub Pages.
