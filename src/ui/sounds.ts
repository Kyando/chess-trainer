// Synthesized board sounds (no audio assets to license). Each is a short
// filtered noise "knock" or a soft tone, built with the Web Audio API.

export type SoundName = 'move' | 'capture' | 'check' | 'castle' | 'promote' | 'start' | 'end' | 'lowtime' | 'illegal'

let ctx: AudioContext | null = null
let muted = false

function audio(): AudioContext | null {
  if (muted) return null
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function knock(ac: AudioContext, at: number, freq: number, gain: number) {
  const len = Math.floor(ac.sampleRate * 0.06)
  const buffer = ac.createBuffer(1, len, ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4)
  const src = ac.createBufferSource()
  src.buffer = buffer
  const filter = ac.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = freq
  filter.Q.value = 1.2
  const g = ac.createGain()
  g.gain.value = gain
  src.connect(filter).connect(g).connect(ac.destination)
  src.start(at)
}

function tone(ac: AudioContext, at: number, freq: number, duration: number, gain: number) {
  const osc = ac.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = freq
  const g = ac.createGain()
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(gain, at + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, at + duration)
  osc.connect(g).connect(ac.destination)
  osc.start(at)
  osc.stop(at + duration)
}

export function playSound(name: SoundName) {
  const ac = audio()
  if (!ac) return
  const t = ac.currentTime
  switch (name) {
    case 'move':
      knock(ac, t, 900, 1.6)
      break
    case 'capture':
      knock(ac, t, 600, 2)
      knock(ac, t + 0.05, 1100, 1.2)
      break
    case 'castle':
      knock(ac, t, 900, 1.4)
      knock(ac, t + 0.09, 800, 1.4)
      break
    case 'check':
      knock(ac, t, 900, 1.4)
      tone(ac, t, 880, 0.18, 0.12)
      break
    case 'promote':
      knock(ac, t, 900, 1.4)
      tone(ac, t + 0.02, 1320, 0.2, 0.1)
      break
    case 'start':
      tone(ac, t, 523, 0.25, 0.12)
      tone(ac, t + 0.12, 784, 0.35, 0.12)
      break
    case 'end':
      tone(ac, t, 784, 0.25, 0.12)
      tone(ac, t + 0.15, 523, 0.45, 0.12)
      break
    case 'lowtime':
      tone(ac, t, 1500, 0.08, 0.08)
      break
    case 'illegal':
      tone(ac, t, 180, 0.15, 0.15)
      break
  }
}

export function setMuted(value: boolean) {
  muted = value
}

/** Picks the sound for a played move from chess.js move flags / SAN. */
export function soundForMove(move: { san: string; flags: string }): SoundName {
  if (move.san.includes('+') || move.san.includes('#')) return 'check'
  if (move.flags.includes('p')) return 'promote'
  if (move.flags.includes('k') || move.flags.includes('q')) return 'castle'
  if (move.flags.includes('c') || move.flags.includes('e')) return 'capture'
  return 'move'
}
