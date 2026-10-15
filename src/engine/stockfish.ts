import { parseInfo, type EngineLine } from './uci'

export interface SearchOptions {
  depth?: number
  movetime?: number
  /** Node budget: same work on every position, whatever the device speed. */
  nodes?: number
  multipv?: number
}

export interface SearchResult {
  bestmove: string
  /** Final lines, sorted by multipv rank. */
  lines: EngineLine[]
}

const ENGINE_URL = `${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`

/**
 * Stockfish running in a Web Worker, speaking UCI. Searches are serialized:
 * each `search` waits for the previous one to finish.
 */
export class StockfishEngine {
  private worker: Worker
  private handlers = new Set<(line: string) => void>()
  private queue: Promise<unknown>
  private currentMultipv = 1

  constructor() {
    this.worker = new Worker(ENGINE_URL)
    this.worker.onmessage = (e: MessageEvent<string>) => {
      for (const h of [...this.handlers]) h(e.data)
    }
    this.queue = this.init()
  }

  private send(cmd: string) {
    this.worker.postMessage(cmd)
  }

  private waitFor(predicate: (line: string) => boolean, onLine?: (line: string) => void) {
    return new Promise<string>((resolve) => {
      const handler = (line: string) => {
        onLine?.(line)
        if (predicate(line)) {
          this.handlers.delete(handler)
          resolve(line)
        }
      }
      this.handlers.add(handler)
    })
  }

  private async init() {
    const uciok = this.waitFor((l) => l === 'uciok')
    this.send('uci')
    await uciok
    await this.isReady()
  }

  private async isReady() {
    const ready = this.waitFor((l) => l === 'readyok')
    this.send('isready')
    await ready
  }

  /** Clears the engine's hash between games. */
  newGame(): Promise<void> {
    return this.enqueue(async () => {
      this.send('ucinewgame')
      await this.isReady()
    })
  }

  search(fen: string, opts: SearchOptions): Promise<SearchResult> {
    return this.enqueue(async () => {
      const multipv = opts.multipv ?? 1
      if (multipv !== this.currentMultipv) {
        this.send(`setoption name MultiPV value ${multipv}`)
        this.currentMultipv = multipv
      }
      const lines = new Map<number, EngineLine>()
      const done = this.waitFor(
        (l) => l.startsWith('bestmove'),
        (l) => {
          const info = parseInfo(l)
          if (info) lines.set(info.multipv, info)
        },
      )
      this.send(`position fen ${fen}`)
      const limits = [
        opts.depth ? `depth ${opts.depth}` : '',
        opts.movetime ? `movetime ${opts.movetime}` : '',
        opts.nodes ? `nodes ${opts.nodes}` : '',
      ].filter(Boolean).join(' ')
      this.send(`go ${limits || 'depth 12'}`)
      const best = await done
      return {
        bestmove: best.split(' ')[1],
        lines: [...lines.values()].sort((a, b) => a.multipv - b.multipv),
      }
    })
  }

  /**
   * Continuous analysis for the analysis board: streams the current lines to
   * `onUpdate` until `depth` is reached or the returned function is called.
   */
  analyze(fen: string, opts: { depth: number; multipv: number }, onUpdate: (lines: EngineLine[]) => void): () => void {
    let cancelled = false
    let running = false
    void this.enqueue(async () => {
      if (cancelled) return
      running = true
      if (opts.multipv !== this.currentMultipv) {
        this.send(`setoption name MultiPV value ${opts.multipv}`)
        this.currentMultipv = opts.multipv
      }
      const lines = new Map<number, EngineLine>()
      const done = this.waitFor(
        (l) => l.startsWith('bestmove'),
        (l) => {
          const info = parseInfo(l)
          if (!info || cancelled) return
          lines.set(info.multipv, info)
          onUpdate([...lines.values()].sort((a, b) => a.multipv - b.multipv))
        },
      )
      this.send(`position fen ${fen}`)
      this.send(`go depth ${opts.depth}`)
      await done
      running = false
    })
    return () => {
      if (cancelled) return
      cancelled = true
      if (running) this.stop()
    }
  }

  /** Aborts the running search; its promise still resolves with what was found. */
  stop() {
    this.send('stop')
  }

  terminate() {
    this.worker.terminate()
    this.handlers.clear()
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => undefined)
    return run
  }
}
