import { afterEach, describe, expect, test, vi } from 'vitest';

/**
 * Smoke test for the Phase-0 probe (scripts/probe-score-odds.ts). The script
 * runs on import via top-level await, so we stub the key, fetch, and exit, then
 * import it and assert it drove the expected calls without crashing. It does
 * NOT hit the live API.
 */
describe('probe-score-odds (mocked fetch)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  test('runs the bulk + events probe path without crashing', async () => {
    vi.stubEnv('ODDS_API_KEY', 'test-key');
    // Fresh Response per call — a real fetch never shares a (single-read) body
    // across calls, so the mock must not either.
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response('[]', { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((): never => undefined as never));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await import('../scripts/probe-score-odds.js');

    // Bulk odds call, then the events fallback (bulk returned no event id).
    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]?.[0]).toContain('markets=correct_score');
    expect(exitSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });
});
