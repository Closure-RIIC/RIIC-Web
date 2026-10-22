import assert from "node:assert/strict";
import test from "node:test";
import { getCookies, memoizeRequest, withPlatformRequest } from "./request-context.ts";

test("simultaneous requests isolate cookies and deduplicate only their own reads", async () => {
  let calls = 0;
  const read = (id: string) => withPlatformRequest(new Request("https://riic.test", { headers: { cookie: `identity=${id}` } }), async () => {
    const load = async () => { calls++; await Promise.resolve(); return getCookies().identity; };
    return Promise.all([memoizeRequest("session", load), memoizeRequest("session", load)]);
  });
  assert.deepEqual(await Promise.all([read("first"), read("second")]), [["first", "first"], ["second", "second"]]);
  assert.equal(calls, 2);
  assert.throws(getCookies, /missing/);
});
