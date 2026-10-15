# Personal Chess Trainer — Plan

A local, chess.com-style chess app for playing, analysing and learning — built around
*my own* games (chess.com, ~840 blitz) and a theory → practice learning loop.
Mobile-first PWA; voice play and an AI coach in v2.

## Guiding principles

- **The engine knows the truth, the LLM explains it.** Never let an LLM compute chess.
- **Your games are the textbook.** Every feature should connect back to my real mistakes.
- **Mobile-first, local-first.** Runs in the browser, works offline, data in IndexedDB.
- **Each version is usable on its own.** No big-bang releases.
- **Copyright:** no chess.com assets (pieces, sounds, logos); book content only paraphrased
  or public domain, copyrighted-book drills kept private.

## Stack

| Concern | Choice |
|---|---|
| UI | React + TypeScript + Vite, mobile-first CSS |
| Board | `chessground` (lichess board: drag/click, premoves, arrows) themed green/cream |
| Rules | `chess.js` |
| Engine | Stockfish 19 WASM (`stockfish`, lite single-threaded) in a Web Worker |
| Storage | IndexedDB (Dexie) — games, analyses, puzzles, SRS schedule, lesson progress |
| PWA | `vite-plugin-pwa` (installable, offline) |
| v2 backend | Node (Hono) or Python (FastAPI): LLM coach, cloud STT/TTS, Maia (lc0) |

## Architecture (designed for v2)

```
INPUT adapters          GAME CORE (pure logic)         OUTPUT adapters
├ board (touch/drag)    ├ game state + move tree       ├ board render
├ text/keyboard   ───►  ├ clocks                  ───► ├ sounds
└ voice (v2)            ├ events: move, check, end…    └ speech narration (v2)
                        └ chess.js rules
ENGINE service: analyze(fen) / bestMove(fen, level)   ← also a tool for the v2 coach
LESSON engine: JSON lessons (explain → find-move → puzzles → play-out → your games)
Concept tags shared by mistakes, puzzles and lessons: fork, pin, hanging-piece, …
```

## Roadmap

### v1.0 — Local chess.com
- [x] **Phase 1 — Play:** themed board, legal moves, premoves, arrows, sounds, clocks
      (5+0, 3+2, 10+0…), move list + navigation, flip, resign, takeback, bot levels
- [x] **Phase 1b — PWA:** installable, offline, wake lock (PNG icons still to do for iOS)
- [ ] **Phase 2 — Analysis board:** eval bar, MultiPV lines, move tree with variations,
      PGN/FEN import/export, opening names (lichess-org/chess-openings, CC0)
- [ ] **Phase 3 — chess.com import:** `api.chess.com/pub/player/{user}/games/archives`
      → monthly PGN (incl. `%clk` clock times) → IndexedDB; filterable games list
- [ ] **Phase 4 — Game Review:** per-move classification (Best/Excellent/Good/Book/
      Inaccuracy/Mistake/Blunder/Miss), accuracy via lichess win% formula, eval graph,
      key moments, "retry the mistake"

### v1.1 — Training loop
- [ ] Puzzles generated from my own blunders (and opponents' missed tactics)
- [ ] Spaced repetition (FSRS/SM-2) for failed puzzles and positions
- [ ] Theme detection + lichess puzzle DB (CC0) for matching drills
- [ ] Opening trainer from my real games; endgame drills vs engine
- [ ] "Blunder check" mode: name opponent's threat before moving
- [ ] Insights dashboard: results by opening, blunders by phase, **blunders vs clock time**

### v1.2 — Theory → practice (lesson engine)
- [ ] Lesson format (JSON): explain / find-move / puzzle-set / play-out / detect-in-games
- [ ] Learning loop: LEARN → GUIDED → PRACTICE → APPLY → YOUR GAMES → SRS
- [ ] Curriculum 800→1200: Safety · Tactics I · Mates · Opening principles ·
      Endgames I · Tactics II · Planning · Practical blitz
- [ ] Sources: own wording, public-domain classics (Capablanca *Chess Fundamentals*…),
      classical master games, lichess puzzles, my games

### v2.0 — AI coach (text first)
- [ ] Backend holding API key; LLM with tools: `get_position`, `analyze`, `threats`,
      `find_concept`, `lesson_lookup`
- [ ] Modes: silent / hints on request / warn before blunders / Socratic
- [ ] AI-assisted lesson generation, validated by chess.js + Stockfish + my approval

### v2.1 — Voice ("washing the dishes" mode)
- [ ] STT adapter: Web Speech API first, cloud STT/Whisper fallback (iOS risk!)
- [ ] Move parser matched against the current legal moves; disambiguation prompts;
      commands (undo, repeat, where are my pieces, what's attacking me)
- [ ] TTS narration; blindfold aids (read position, peek mode, slow time controls)

### v2.2 — Full teacher
- [ ] Spoken conversation with the coach; coach memory of my weaknesses
- [ ] Maia (lc0) human-like bots at 1100/1300/1500

## Risks

- iOS speech recognition reliability → prototype early on the real phone.
- LLM chess hallucinations → always ground in engine output.
- Scope creep → ship each version independently.

## Exporting chess.com games

- Website: Profile → Games → Archive → select → Download (PGN).
- API (no auth): `https://api.chess.com/pub/player/{user}/games/archives`, then
  `.../games/{YYYY}/{MM}/pgn`. Fetch serially, send a User-Agent with contact info.
