# Arete

A Windows desktop app that measures what daily practice adds up to: training, food and weight, in one place. It's the companion to [Praxis](https://github.com/Quasician/praxis).

In Aristotle's ethics, *arete* (excellence) isn't inborn. It's built through repeated action, *praxis*. Praxis plans and runs the day; Arete measures what those days are building.

## What it does

- **Week:** your weekly plan next to what actually happened, with one-click check-ins and progress through a training program ("week 5 of 12").
- **Activity:** lifting imported from Hevy, rowing imported from the Concept2 Logbook, and anything else logged by hand. Includes a rowing pace chart.
- **Food:** meals described in plain words, with optional calories and protein.
- **Weight:** weigh-ins with a 7-day trend line, so daily water swings don't hide the real direction. Import the ZIP that Withings emails you (Withings app → Profile → Settings → Export All Health Data); re-importing never duplicates readings.

Planned next: calorie estimates from meal descriptions, planned meals from the grocery rotation, a live Withings connection, and an energy-balance view that estimates real daily burn from intake and weight trend.

## Privacy

Everything stays on your PC, in Arete's data folder (`%APPDATA%\Arete`): the database (`arete.sqlite`) and `settings.json`. API keys are encrypted with Windows' own protection (DPAPI, through Electron's `safeStorage`) and never reach the app's window. Nothing personal belongs in this repo, and `.gitignore` blocks common data and secret files as a safety net.

## Install and updates

Download `Arete-Setup-<version>.exe` from [Releases](https://github.com/Quasician/arete/releases), run it, then right-click Arete on the taskbar and choose **Pin to taskbar**. Installed copies check for new releases on start and every six hours, and update themselves.

## Development

Requires Node 22.

```bash
npm install
npm run dev        # run with hot reload
npm test           # unit tests
npm run build      # typecheck and build
npm run dist:win   # build a local Windows installer (on Windows)
```

### Releasing

1. Bump `version` in `package.json` and push to `main`.
2. The **Release** workflow tags that version, builds the installer on Windows and publishes the release. A version that's already released is skipped, and a failed run can be re-run from the Actions tab.

## Stack

Electron with electron-vite; React, TypeScript, TanStack Query and Zustand in the window (matching Praxis); SQLite through sql.js (WebAssembly, so there's no native module to build) with Drizzle ORM; ECharts for charts; electron-builder and electron-updater for the installer and updates.

```
src/main/       Electron main process: window, database, settings, sync
src/main/sync/  Hevy and Concept2 importers
src/preload/    The bridge that exposes window.arete to the window
src/renderer/   The React app
src/shared/     Types and pure logic used by both sides
tests/          Unit tests (node --test)
```
