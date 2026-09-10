/**
 * Minimal fake cordis context for driving the CTM host end to end: the
 * sessions / sessionQuery services, a webServer that captures the POST /ctm
 * handler, an `ctx.on` registry whose agent/pre-step waterfall flushes the
 * edit queue, and a logger. Only the surface host.ts actually touches is
 * implemented — `tokenMeter` and `sessionProjections` stay absent on purpose
 * (tokenMeter is optional-chained; sessionProjections is reached through an
 * `ctx.inject(['sessionProjections'])` child that never activates without
 * the service, so reads exercise the event-fold fallback).
 */
import { apply, inject } from '../../src/host'
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
  /** Run the system-prompt/assemble waterfall for one session. */
  assembleSystemPrompt(session: FakeSession, sections?: unknown[]): Promise<any>
  warnings: string[]
}

/**
 * Reproduce cordis's service-access guard: the real Context proxy throws
 * `cannot get property "<name>" without inject` on ANY read of a service the
 * plugin did not declare — optional chaining does NOT save you, the throw
 * happens at property-get time. Declared services (the host's inject list)
 * read as undefined when absent; cordis built-ins (logger/on/inject) are
 * always reachable. Wrap the fake ctx in this to regression-test that the
 * host never touches an undeclared service.
 */
export function cordisInjectGuard<T extends object>(ctx: T, declaredInject: string[]): T {
  const builtins = new Set(['logger', 'on', 'inject', 'then'])
  const declared = new Set(declaredInject)
  return new Proxy(ctx, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && !(prop in target) && !builtins.has(prop) && !declared.has(prop)) {
        throw new Error(`cannot get property "${prop}" without inject`)
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}

export function createHarness(sessions: FakeSession[], opts?: { cordisGuard?: boolean }): Harness {
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
    // cordis semantics: the child context activates only when every declared
    // dependency is composed. sessionProjections is absent here, so the
    // host's optional projection child never runs and reads exercise the
    // event-fold fallback.
    inject(deps: string[], cb: (scope: unknown) => unknown): void {
      const services: Record<string, unknown> = { webServer }
      if (!deps.every(d => services[d] !== undefined)) return
      cb(Object.fromEntries(deps.map(d => [d, services[d]])))
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
  apply(opts?.cordisGuard === true ? cordisInjectGuard(ctx, inject) : ctx)

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

  async function assembleSystemPrompt(session: FakeSession, sections: unknown[] = []): Promise<any> {
    const fns = (listeners.get('system-prompt/assemble') ?? []) as unknown as Array<
      (assembly: any, context: any, next: () => Promise<any>) => Promise<any>
    >
    const base = { sections, contexts: [], tools: [], variables: {} }
    let i = 0
    const next = async (): Promise<any> => {
      const fn = fns[i++]
      return fn === undefined ? base : fn(base, { agent: { session } }, next)
    }
    return next()
  }

  return { post, preStep, flush, assembleSystemPrompt, warnings }
}
