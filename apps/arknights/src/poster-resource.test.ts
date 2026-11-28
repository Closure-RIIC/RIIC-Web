import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPosterPayload, withPosterTimeout } from './poster-resource.ts';
test('a failed read retries once and returns the successful response', async (t) => { let calls = 0; t.mock.method(globalThis, 'fetch', async () => { if (++calls === 1)
    throw new TypeError('Failed to fetch'); return Response.json({ document: { version: 1 } }); }); assert.deepEqual(await fetchPosterPayload('/test'), { document: { version: 1 } }); assert.equal(calls, 2); });
test('POST is never retried after a lost response', async (t) => { let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; throw new TypeError('Failed to fetch'); }); await assert.rejects(fetchPosterPayload('/test', { method: 'POST' })); assert.equal(calls, 1); });
test('404 is not retried and non-JSON success is rejected', async (t) => { let calls = 0; const mock = t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('missing', { status: 404 }); }); await assert.rejects(fetchPosterPayload('/test'), /404/); assert.equal(calls, 1); mock.mock.mockImplementation(async () => new Response('<html>proxy error</html>')); await assert.rejects(fetchPosterPayload('/test')); });
test('server error reads retry once', async (t) => { let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('unavailable', { status: 503 }); }); await assert.rejects(fetchPosterPayload('/test'), /503/); assert.equal(calls, 2); });
test('slow resource times out while successful resources pass through', async () => { await assert.rejects(withPosterTimeout(new Promise(() => { }), 10), /timeout/); assert.equal(await withPosterTimeout(Promise.resolve(42), 100), 42); });
