import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callSystemOne, TypeSafeError } from '@/lib/ai/typesafe';

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

const request = {
  state: 'Help! My payouts have been failing for 3 days.',
  questions: { is_urgent: { type: 'noul' as const, instructions: 'Does this convey urgency?' } },
};

describe('TypeSafe client', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('TYPESAFE_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('throws without an API key', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', '');
    await expect(callSystemOne(request)).rejects.toBeInstanceOf(TypeSafeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the key and defaults the model to jev-latest', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { model: 'jev-1.13.0', answers: { is_urgent: { type: 'noul', noul: 0.95 } } }),
    );

    const res = await callSystemOne(request);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    expect(JSON.parse(init.body).model).toBe('jev-latest');
    expect(res.answers.is_urgent).toEqual({ type: 'noul', noul: 0.95 });
  });

  it('retries a 429 honouring retry-after, then succeeds', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, { detail: 'rate limited' }, { 'retry-after': '2' }))
      .mockResolvedValueOnce(jsonResponse(200, { model: 'jev-1.13.0', answers: {} }));

    const pending = callSystemOne(request);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toMatchObject({ model: 'jev-1.13.0' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('does not retry a 4xx validation error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(422, { detail: 'bad criteria' }));
    await expect(callSystemOne(request)).rejects.toMatchObject({ status: 422 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
