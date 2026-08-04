// ============================================================================
// Dev-only status-flip simulator, gated behind NEXT_PUBLIC_ENABLE_SIMULATIONS=1.
//
// While armed, every /api/status response reports GitHub's endpoint as down
// (503, 2400ms) instead of its real state. This lets you demonstrate the
// what-changed badge and its tooltip live — on the Integrations panel and the
// sidebar widget — without waiting for a real provider outage. The flag must
// be set at build time (Next inlines NEXT_PUBLIC_ vars), so production stays
// clean unless someone explicitly opts in.
// ============================================================================

export const isStatusSimulationEnabled = (): boolean =>
  process.env.NEXT_PUBLIC_ENABLE_SIMULATIONS === '1';

const SIMULATED_ID = 'github';
export const SIMULATED_ENDPOINT = { ok: false, status: 503, ms: 2400, detail: 'Simulated outage' };

let armed = false;
export const armStatusSimulation = () => { armed = true; };
export const disarmStatusSimulation = () => { armed = false; };
export const isStatusSimulationArmed = () => armed;

/**
 * Wrap a fetch implementation so /api/status responses report the simulated
 * outage while armed. All other requests pass through untouched, and an armed
 * request is never modified when the underlying response already failed.
 */
export const installStatusSimulationFetch = (origFetch: typeof fetch): typeof fetch => {
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const res = await origFetch(input, init);
    if (!url.includes('/api/status') || !armed || !res.ok) return res;
    // The flip always builds a fresh Response, so consuming the body is safe.
    const body = await res.json();
    const copy = JSON.parse(JSON.stringify(body));
    const target = copy.integrations?.find((i: { id: string }) => i.id === SIMULATED_ID);
    if (target) target.endpoint = { ...SIMULATED_ENDPOINT };
    return new Response(JSON.stringify({ ...copy, checkedAt: new Date().toISOString() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return wrapped;
};
