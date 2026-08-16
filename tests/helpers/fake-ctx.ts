/**
 * Minimal fake cordis context for driving the CTM host end to end: the
 * sessions / sessionQuery services, a webServer that captures the POST /ctm
 * handler, an `ctx.on` registry whose agent/pre-step waterfall flushes the
 * edit queue, and a logger. Only the surface host.ts actually touches is
 * implemented — `tokenMeter` and `sessionProjections` stay absent on purpose
 * (the host optional-chains both).
 */
import { apply } from '../../src/host'
import type { CtmResponse } from '../../src/contract'
import type { FakeSession } from './fake-session'

interface FakeRoute {
  kind: string
  path: string
  handler: (req: unknown, res: unknown) => Promise<void>
}

export interface Harness {
  /** POST one JSON body to the captured /ctm route; returns status + parsed envelope. */
  post(body: unknown): Promise<{ status: number; json: CtmResponse }>
  /** Run the agent/pre-step waterfall for one session (the queued-edit flush point). */
  preStep(session: FakeSession): Promise<void>
  /** Open a turn, run pre-step (flushing queued edits into the log), close the turn. */
  flush(session: FakeSession): Promise<void>
  warnings: string[]
}

export function createHarness(sessions: FakeSession[]): Harness {
  const sessionMap = new Map(sessions.map(s => [s.id, s]))
  const listeners = new Map<string, ((payload: unknown, next: () => unknown) => unknown)[]>()
  const routes: FakeRoute[] = []
  const warnings: string[] = []

  const webServer = {
    register(route: FakeRoute): () => void {
      routes.push(route)
      return () => {}
    },
  }
  const ctx = {
    logger: () => ({ warn: (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) } }),
    on(name: string, fn: (payload: unknown, next: () => unknown) => unknown): void {
      const list = listeners.get(name) ?? []
      list.push(fn)
      listeners.set(name, list)
    },
    inject(_deps: string[], cb: (scope: unknown) => unknown): void {
      cb({ webServer })
    },
    sessions: { get: (id: string) => sessionMap.get(id) },
    sessionQuery: {
      // The live surface read: current surface events in model-visible order.
      readSurface: (id: string) => {
        const s = sessionMap.get(id)
        return Promise.resolve({ events: s ? s.surface.nodes.map(seq => s.events[seq]!) : [] })
      },
      readSession: (id: string) => Promise.resolve({ events: sessionMap.get(id)?.events ?? [] }),
    },
  }
  apply(ctx)

  async function post(body: unknown): Promise<{ status: number; json: CtmResponse }> {
    const route = routes.find(r => r.path === '/ctm')
    if (route === undefined) throw new Error('the host did not register /ctm')
    const req = {
      method: 'POST',
      async *[Symbol.asyncIterator]() { yield JSON.stringify(body) },
    }
    let status = 0
    let text = ''
    const res = {
      writeHead(s: number) { status = s; return res },
      end(t?: string) { text = t ?? '' },
    }
    await route.handler(req, res)
    return { status, json: JSON.parse(text) as CtmResponse }
  }

  async function preStep(session: FakeSession): Promise<void> {
    const fns = listeners.get('agent/pre-step') ?? []
    let i = 0
    const next = async (): Promise<void> => {
      const fn = fns[i++]
      if (fn !== undefined) await fn({ agent: { session } }, next)
    }
    await next()
  }

  async function flush(session: FakeSession): Promise<void> {
    session.beginTurn()
    await preStep(session)
    session.endTurn()
  }

  return { post, preStep, flush, warnings }
}
