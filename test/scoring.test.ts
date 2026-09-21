import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS } from "../src/selection.ts";
import { scoreOptions, type ScoreInput } from "../src/scoring.ts";

export const input: ScoreInput = {
  context: { goal: "Locate duplicate charges", observation: "Concurrent retries create duplicates" },
  question: "How much relevant evidence will this action provide?",
  criteria: ["No relevant evidence", "Indirect evidence", "Direct evidence"],
  options: [{ id: "inspect", content: "Inspect the idempotency handler" }, { id: "test", content: "Run the concurrent retry test" }],
};
const answer = { type: "score", score: 1.75, confidence: 0.5, probabilities: { "0": 0, "1": 0.25, "2": 0.75 } };

test("one scoring batch preserves caller rubric, identities, and privacy boundaries", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    calls++;
    const request = JSON.parse(String(init.body));
    assert.deepEqual(request.state, { context: input.context });
    assert.deepEqual(request.questions.q0.criteria, input.criteria);
    assert.deepEqual(request.questions.q1.instructions.option, input.options[1]);
    assert(!String(init.body).includes("fixture-only"));
    return Response.json({ model: DEFAULTS.model, answers: { q0: answer, q1: answer }, usage: { input_tokens: 100, output_tokens: 20 } });
  });
  const result = await scoreOptions(input, { ...DEFAULTS }, "fixture-only");
  assert.equal(calls, 1);
  assert(result.available);
  assert.deepEqual(result.selected, input.options[0]);
  assert.deepEqual(result.results.map(r => r.id), ["inspect", "test"]);
  assert.equal(result.results[0].score, 1.75);
  assert.equal(result.maxScore, 2);
  assert.equal(result.inputTokens, 100);
  assert(!JSON.stringify(result).includes(input.question));
});

test("invalid inputs and service answers never fabricate scores or leak errors", async t => {
  let calls = 0;
  const mock = t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ model: DEFAULTS.model, answers: {} }); });
  for (const invalid of [{ ...input, criteria: ["one"] }, { ...input, options: [input.options[0], input.options[0]] }, { ...input, secret: "extra" }, { ...input, question: " " }]) {
    assert.equal((await scoreOptions(invalid, { ...DEFAULTS }, "fixture-only")).reason, "invalid_input");
  }
  assert.equal((await scoreOptions(input, { ...DEFAULTS, enabled: false }, "fixture-only")).reason, "disabled");
  assert.equal((await scoreOptions(input, { ...DEFAULTS })).reason, "missing_key");
  assert.equal(calls, 0);
  for (const invalid of [{}, { ...answer, score: 3 }, { ...answer, confidence: -1 }, { ...answer, probabilities: { "0": 0.5, "1": 0.5 } }, { ...answer, score: 0 }, { ...answer, probabilities: { "0": 1, "1": 1, "2": 1 } }]) {
    mock.mock.mockImplementation(async () => Response.json({ model: DEFAULTS.model, answers: { q0: invalid, q1: answer } }));
    const result = await scoreOptions(input, { ...DEFAULTS }, "fixture-only");
    assert.equal(result.reason, "invalid_response");
    assert.deepEqual(result.results, []);
    assert.equal(result.selected, null);
  }
  mock.mock.mockImplementation(async () => new Response("PRIVATE_SERVICE_ERROR", { status: 503 }));
  const result = await scoreOptions(input, { ...DEFAULTS }, "fixture-only");
  assert.equal(result.reason, "service_error");
  assert(!JSON.stringify(result).includes("PRIVATE_SERVICE_ERROR"));
  assert.deepEqual(result.results, []);
});

test("scoring deadline and cancellation return unavailable without stale scores", async t => {
  t.mock.method(globalThis, "fetch", (_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new Error("PRIVATE_ABORT")), { once: true });
  }));
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    assert.equal((await scoreOptions(input, { ...DEFAULTS, timeoutMs: 10 }, "fixture-only")).reason, "timeout");
    assert.equal((await scoreOptions(input, { ...DEFAULTS }, "fixture-only", AbortSignal.abort())).reason, "cancelled");
  } finally { clearTimeout(keepAlive); }
});


test("independently rounded service scores and probabilities remain valid", async t => {
  const answers = {
    q0: { type: "score", score: 1.41, confidence: 0.5, probabilities: { "0": 0.05, "1": 0.53, "2": 0.39, "3": 0.03 } },
    q1: { type: "score", score: 0.73, confidence: 0.63, probabilities: { "0": 0.32, "1": 0.63, "2": 0.04, "3": 0.01 } },
  };
  t.mock.method(globalThis, "fetch", async () => Response.json({ model: DEFAULTS.model, answers }));
  const result = await scoreOptions({ ...input, criteria: [...input.criteria, "Decisive evidence"] }, { ...DEFAULTS }, "fixture-only");
  assert(result.available);
  assert.deepEqual(result.results.map(item => item.score), [1.41, 0.73]);
});

test("the highest score selects an unchanged option without a command-length shortcut", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ model: DEFAULTS.model, answers: {
    q0: { ...answer, score: 1, probabilities: { "0": 0, "1": 1, "2": 0 } }, q1: answer,
  } }));
  const options = [input.options[0], { id: "exact", content: "node -e '" + " ".repeat(350) + "console.log(1)'" }];
  const result = await scoreOptions({ ...input, options }, { ...DEFAULTS }, "fixture-only");
  assert.deepEqual(result.selected, options[1]);
  assert.equal((await scoreOptions(input, { ...DEFAULTS }, "fixture-only", AbortSignal.abort())).selected, null);
});
