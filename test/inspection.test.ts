import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { INSPECTION_CRITERIA, inspectObservations, inspectionContent, loadObservations, type InspectionMode } from "../src/inspection.ts";
import { DEFAULTS } from "../src/selection.ts";

const batch = { objective: "Apply the requested record update.", observations: [{ id: "a", text: "The transaction committed; the email notification failed." }, { id: "b", text: "The reply was lost; the ledger has not been checked." }] };
function response(mode: InspectionMode) {
  const labels = Object.keys(INSPECTION_CRITERIA[mode]);
  return { model: DEFAULTS.model, usage: { input_tokens: 200, output_tokens: 20 }, answers: Object.fromEntries(batch.observations.map((_, i) => [`q${i}`, {
    type: "choice", choice: labels[i ? 3 : 0], confidence: 1,
    probabilities: Object.fromEntries(labels.map((label, index) => [label, index === (i ? 3 : 0) ? 1 : 0])),
  }])) };
}

test("both semantic modes make one batch request without forwarding paths, history, IDs, or auth in the body", async t => {
  const requests: unknown[] = [];
  let mode: InspectionMode = "outcome";
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => { requests.push(JSON.parse(String(init.body))); return Response.json(response(mode)); });
  for (mode of ["outcome", "evidence"] as const) {
    const result = await inspectObservations(batch, mode, DEFAULTS, "fixture-key");
    assert.equal(result.available, true);
    assert.equal(result.judgments[1].label, mode === "outcome" ? "unknown" : "insufficient");
    assert.equal(result.inputTokens, 200);
    assert.deepEqual(result.observations, []);
    assert(!JSON.stringify(inspectionContent(result)).includes(batch.observations[0].text));
  }
  assert.equal(requests.length, 2);
  const body = JSON.stringify(requests);
  assert(body.includes(batch.observations[0].text), "Inspection explicitly uploads the approved observation text");
  for (const forbidden of ["fixture-key", "source", "history", '"id":']) assert(!body.includes(forbidden));
});

test("disabled and missing-key paths return unchanged raw observations with no invented judgments", async t => {
  t.mock.method(globalThis, "fetch", async () => { assert.fail("Local paths must not call Jev"); });
  for (const [config, key, reason] of [[{ ...DEFAULTS, enabled: false }, "fixture", "disabled"], [DEFAULTS, undefined, "missing_key"]] as const) {
    const result = await inspectObservations(batch, "outcome", config, key);
    assert.equal(result.reason, reason);
    assert.deepEqual(result.observations, batch.observations);
    assert.deepEqual(result.judgments, []);
  }
});

test("malformed responses fail the whole batch and retain original evidence", async t => {
  const valid = response("outcome");
  const bad = [
    { ...valid, answers: {} },
    { ...valid, answers: { ...valid.answers, extra: valid.answers.q0 } },
    { ...valid, answers: { ...valid.answers, q0: { ...valid.answers.q0, choice: "invented" } } },
    { ...valid, answers: { ...valid.answers, q0: { ...valid.answers.q0, confidence: -1 } } },
    { ...valid, answers: { ...valid.answers, q0: { ...valid.answers.q0, probabilities: { completed: 2, not_applied: 0, partial: 0, unknown: 0 } } } },
  ];
  let value: unknown;
  t.mock.method(globalThis, "fetch", async () => Response.json(value));
  for (value of bad) {
    const result = await inspectObservations(batch, "outcome", DEFAULTS, "fixture");
    assert.equal(result.reason, "invalid_response");
    assert.deepEqual(result.judgments, []);
    assert.deepEqual(result.observations, batch.observations);
  }
});

test("timeouts fall back, cancellation suppresses stale evidence, and errors never expose response bodies", async t => {
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(new Error("PRIVATE_PROVIDER_BODY")), { once: true });
  }));
  const timer = setTimeout(() => {}, 100);
  t.after(() => clearTimeout(timer));
  const timeout = await inspectObservations(batch, "outcome", { ...DEFAULTS, timeoutMs: 5 }, "fixture");
  assert.equal(timeout.reason, "timeout");
  assert.deepEqual(timeout.observations, batch.observations);
  const abort = new AbortController();
  const pending = inspectObservations(batch, "outcome", DEFAULTS, "fixture", abort.signal);
  abort.abort();
  const cancelled = await pending;
  assert.equal(cancelled.reason, "cancelled");
  assert.deepEqual(cancelled.observations, []);
  assert(!JSON.stringify([timeout, cancelled]).includes("PRIVATE_PROVIDER_BODY"));
});

test("only bounded, valid, explicitly named observation files are read", async t => {
  const root = await mkdtemp(join(tmpdir(), "sieve-observations-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, ".pi/sieve/observations");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "sample.json");
  await writeFile(path, JSON.stringify(batch));
  assert.deepEqual(await loadObservations(root, "sample"), batch);
  assert.equal(await loadObservations(root, "../sample"), undefined);
  await symlink(path, join(directory, "linked.json"));
  assert.equal(await loadObservations(root, "linked"), undefined);
  for (const data of [{ ...batch, extra: true }, { ...batch, observations: [batch.observations[0], batch.observations[0]] }, { ...batch, objective: " " }, { ...batch, objective: "x".repeat(33_000) }]) {
    await writeFile(path, JSON.stringify(data));
    assert.equal(await loadObservations(root, "sample"), undefined);
  }
  assert.equal((await inspectObservations(batch, "outcome", { ...DEFAULTS, maxCandidates: 1 }, "fixture")).reason, "invalid_input");
});
