import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  armStatusSimulation, disarmStatusSimulation, installStatusSimulationFetch,
  isStatusSimulationArmed, isStatusSimulationEnabled, SIMULATED_ENDPOINT,
} from './statusSimulation';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const statusBody = () => ({
  ok: true,
  checkedAt: new Date().toISOString(),
  integrations: [
    { id: 'github', name: 'GitHub', endpoint: { ok: true, status: 200, ms: 40, detail: 'ok' } },
    { id: 'firestore', name: 'Firestore', endpoint: null },
  ],
});

const jsonFetch = (body: unknown) => vi.fn(async () =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
);

beforeEach(() => {
  disarmStatusSimulation();
  delete process.env.NEXT_PUBLIC_ENABLE_SIMULATIONS;
});

afterEach(() => {
  disarmStatusSimulation();
  delete process.env.NEXT_PUBLIC_ENABLE_SIMULATIONS;
  vi.restoreAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('isStatusSimulationEnabled', () => {
  it('is false when the env flag is unset', () => {
    expect(isStatusSimulationEnabled()).toBe(false);
  });

  it('is false when the env flag is not exactly 1', () => {
    process.env.NEXT_PUBLIC_ENABLE_SIMULATIONS = 'true';
    expect(isStatusSimulationEnabled()).toBe(false);
  });

  it('is true when the env flag is 1', () => {
    process.env.NEXT_PUBLIC_ENABLE_SIMULATIONS = '1';
    expect(isStatusSimulationEnabled()).toBe(true);
  });
});

describe('arm / disarm / isArmed', () => {
  it('starts disarmed and flips on arm', () => {
    expect(isStatusSimulationArmed()).toBe(false);
    armStatusSimulation();
    expect(isStatusSimulationArmed()).toBe(true);
    disarmStatusSimulation();
    expect(isStatusSimulationArmed()).toBe(false);
  });
});

describe('installStatusSimulationFetch', () => {
  it('flips the GitHub endpoint while armed', async () => {
    armStatusSimulation();
    const orig = jsonFetch(statusBody());
    const wrapped = installStatusSimulationFetch(orig as unknown as typeof fetch);
    const res = await wrapped('/api/status');
    const body = await res.json();
    const gh = body.integrations.find((i: { id: string }) => i.id === 'github');
    expect(gh.endpoint).toEqual(SIMULATED_ENDPOINT);
  });

  it('leaves the response untouched when disarmed', async () => {
    const orig = jsonFetch(statusBody());
    const wrapped = installStatusSimulationFetch(orig as unknown as typeof fetch);
    const res = await wrapped('/api/status');
    const body = await res.json();
    const gh = body.integrations.find((i: { id: string }) => i.id === 'github');
    expect(gh.endpoint).toEqual({ ok: true, status: 200, ms: 40, detail: 'ok' });
  });

  it('passes non-status requests through unchanged even when armed', async () => {
    armStatusSimulation();
    const orig = vi.fn(async () => new Response('plain', { status: 200 }));
    const wrapped = installStatusSimulationFetch(orig as unknown as typeof fetch);
    const res = await wrapped('/api/tasks');
    expect(await res.text()).toBe('plain');
    expect(orig).toHaveBeenCalledWith('/api/tasks', undefined);
  });

  it('never flips a failed status response', async () => {
    armStatusSimulation();
    const orig = vi.fn(async () => new Response('nope', { status: 503 }));
    const wrapped = installStatusSimulationFetch(orig as unknown as typeof fetch);
    const res = await wrapped('/api/status');
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('nope');
  });
});
