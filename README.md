# Arete

A Windows desktop app that measures what daily practice adds up to: training, food and weight, in one place. It's the companion to [Praxis](https://github.com/Quasician/praxis).

In Aristotle's ethics, *arete* (excellence) isn't inborn. It's built through repeated action, *praxis*. Praxis plans and runs the day; Arete measures what those days are building.

## What it does

- **Habits:** each habit is an if-then plan (a cue and a time) with a full and a minimum version; the minimum still counts. A habit-strength score grows with each repetition and dips, rather than resets, after a miss ("never miss twice"). Each habit shows its stage (Starting, Building, Sticking, Formed) and roughly how many repetitions are left. A habit counts as formed at 90% strength while kept on at least 80% of its days for four weeks; formed habits get a celebration and stay on a Formed shelf, flagged if they slip. New habits wait in an *Up next* queue, and the next one is suggested once the newest has held for two weeks. Also: recovery weeks after repeated misses, a weekly review with suggestions, and a feed of records and milestones (with notifications). Practices such as meditation, stretching, art, music and piano count as habits but not as active minutes.
- **Habits from Todoist:** with a Todoist token, every task labelled `@habit` is a habit. Recurring tasks give its days, time and length; undated ones go in Up next; tasks named alike before a colon ("Lifting: Upper 1", "Lifting: Lower 1") are one habit. Ticking the task in Todoist or Praxis logs the habit; doing it in Arete, or a synced Hevy or Concept2 workout, ticks the task. Arete makes no daily copies. A habit made in Arete gets one recurring `@habit` task in the Inbox.
- **Goals:** strength targets read from Hevy (estimated one-rep max for loaded lifts, reps for bodyweight lifts, seconds for holds), each with its starting number, raw target, deadline and pace. A front-and-back body figure fills in each muscle group as the goals that train it progress. A suggested block sets +10% on DB bench, Bulgarian split squat and DB Romanian deadlift, three more pull-ups, a 60-second dead hang and a 2-minute deep squat hold, from your own recent numbers.
- **Weekly progression in Hevy:** after each workout syncs, Arete sets the next targets in your Hevy routines with double progression: same weight and one more rep until every working set reaches the top of its range (6–10 for goal lifts, 8–12 otherwise), then one weight step heavier and back to the bottom. Bodyweight exercises add a rep, holds add 5 seconds. Only weights and target reps change, a copy of the routines is kept first, and there's a preview. Each goal shows when a rep a session would reach it. Off until you turn it on.
- **Week:** your weekly plan next to what actually happened, with one-click check-ins and progress through a training program ("week 5 of 12").
- **Activity:** lifting imported from Hevy, rowing imported from the Concept2 Logbook, and anything else logged by hand. Includes a rowing pace chart.
- **Food:** meals described in plain words. With an Anthropic API key, Arete estimates calories and protein (with a range) from the description.
- **Weight:** weigh-ins with a 7-day trend line, so daily water swings don't hide the real direction. Import the ZIP that Withings emails you (Withings app → Profile → Settings → Export All Health Data); re-importing never duplicates readings.

- **Progress:** weekly active minutes against the 150–300 minute guideline, estimated one-rep max per exercise from Hevy, and VO2max estimated from Concept2 2,000 m tests (Concept2's formula) against men's FRIEND registry percentiles, with the test protocol.
- **Calories vs. weight:** estimated daily burn from what you logged and your weight trend over 21 days.
- **Lighting:** colours follow the time of day, light from dawn through golden hour and dark at dusk and night, from sunrise and sunset times (or fixed light or dark).
- **App:** starts with Windows (can be turned off in Settings), and checks for updates at start-up, every six hours, or on demand, with a restart-to-update button.

Planned next: planned meals from the grocery rotation and a live Withings connection.

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
