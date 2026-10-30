import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, api, qs, uploadCsv } from '../api/client.js';

function respond(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('api client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('requests credentials so the httpOnly session cookie travels with every call', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(respond(200, { ok: true }));
    vi.stubGlobal('fetch', fetchSpy);

    await api.get('/api/dashboard/summary');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('include');
  });

  it('maps the documented error envelope {error:{code,message,details?}}', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respond(409, {
          error: { code: 'INVALID_TRANSITION', message: 'Cannot move a sample.', details: { from: 'RECEIVED' } },
        }),
      ),
    );

    const error = await api.post('/api/samples/x/transition', { to: 'COMPLETED' }).then(
      () => null,
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(409);
    expect(apiError.code).toBe('INVALID_TRANSITION');
    expect(apiError.message).toBe('Cannot move a sample.');
    expect(apiError.details).toEqual({ from: 'RECEIVED' });
  });

  it('falls back to a readable message when the server sends non-JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, text: () => Promise.resolve('<html>bad gateway</html>') } as unknown as Response));

    await expect(api.get('/api/cases')).rejects.toMatchObject({ status: 502, code: 'UNKNOWN' });
  });

  it('raises NetworkError when fetch itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    await expect(api.get('/api/health')).rejects.toBeInstanceOf(NetworkError);
  });

  it('uploadCsv posts multipart form data under the "file" field', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(respond(201, {}));
    vi.stubGlobal('fetch', fetchSpy);
    const file = new File(['a,b'], 'samples.csv', { type: 'text/csv' });

    await uploadCsv('/api/imports/preview', file);

    const [path, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/imports/preview');
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect(form instanceof FormData).toBe(true);
    expect(form.get('file')).toBeInstanceOf(File);
  });

  it('qs skips empty values and encodes the rest', () => {
    expect(qs({ search: '', status: 'OPEN', page: 2, missing: undefined, blank: null })).toBe('?status=OPEN&page=2');
    expect(qs({})).toBe('');
  });
});
