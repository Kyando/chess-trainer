# Chess Trainer

A personal, chess.com-style chess app for playing, analysing and learning — mobile-first,
running fully in the browser. See [PLAN.md](PLAN.md) for the roadmap (v1 → v2 voice + AI coach).

## Features so far (v1.0, phase 1)

- Green/cream board (chessground) with drag or click-to-move, legal-move dots,
  **premoves**, right-click arrows/highlights, last-move and check highlights
- Play vs Stockfish 19 (WASM, in a Web Worker) at 9 strength levels (≈400 → max);
  weak levels sample among the engine's top moves, so they make human-like mistakes
- Clocks: bullet / blitz / rapid presets with increment, or untimed practice;
  tenths under 20 s, low-time warning, timeout vs insufficient material
- Move list with navigation (buttons or ← → ↑ ↓ keys), flip (`f`), takeback, resign,
  promotion picker, captured pieces and material balance, synthesized sounds
- Installable PWA (offline), screen kept awake during games

## Run

```bash
npm install      # also copies the Stockfish engine into public/engine
npm run dev      # http://localhost:5173 (also exposed on your LAN for phone testing)
npm test         # unit tests (vitest)
npm run build    # type-check + production build
```

To try it on a phone, open the "Network" URL that `npm run dev` prints while the phone
is on the same Wi-Fi.

## Structure

```
src/core/     game logic, independent of UI: GameSession (rules, clock, result, events),
              ChessClock, material, settings
src/engine/   Stockfish worker wrapper (UCI), info-line parsing, bot levels
src/ui/       React components: Board (chessground wrapper), clocks, move list, dialogs,
              sounds, wake lock
```

## Licenses

Uses chessground (GPL-3), chess.js (BSD-2) and Stockfish.js (GPL-3). For personal use.
