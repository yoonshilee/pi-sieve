import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  AgentSessionRuntime, createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
  type ExtensionAPI, type Skill,
} from "@earendil-works/pi-coding-agent";
import {
  fauxProvider, fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt, getCurrentTools,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import sieve from "../src/index.ts";
import { INSPECTION_CRITERIA } from "../src/inspection.ts";
import type { JevRequest } from "../src/selection.ts";

async function setup(t: TestContext, trusted = true, restrictBeforeSieve = false, scoring = false, inspection = false) {
  const cwd = await mkdtemp(join(tmpdir(), "sieve-sdk-"));
  const agentDir = join(cwd, "agent");
  await mkdir(join(cwd, ".pi/sieve/memories"), { recursive: true });
  await mkdir(agentDir);
  await writeFile(join(cwd, ".pi/sieve/memories/payments.md"), "---\nname: payment-history\ndescription: Payment retry rules\n---\nPRIVATE_MEMORY_BODY: use idempotency keys.");
  const skillFile = join(cwd, "review.md");
  await writeFile(skillFile, "---\nname: review\ndescription: Code review workflow\n---\nPRIVATE_SKILL_BODY: review the patch carefully.");
  const sourceInfo = { path: skillFile, source: "test", scope: "temporary" as const, origin: "top-level" as const };
  const skills: Skill[] = [
    { name: "review", description: "Code review workflow", filePath: skillFile, baseDir: cwd, sourceInfo, disableModelInvocation: false },
    { name: "weather-skill", description: "Weather reports", filePath: skillFile, baseDir: cwd, sourceInfo, disableModelInvocation: false },
  ];
  const faux = fauxProvider({ provider: "sieve-fixture", models: [{ id: "fixture" }], tokensPerSecond: Infinity });
  let api!: ExtensionAPI;
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off" }, { projectTrusted: trusted });
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    skillsOverride: () => ({ skills, diagnostics: [] }),
    agentsFilesOverride: () => ({ agentsFiles: [{ path: join(cwd, "AGENTS.md"), content: "KEEP_PROJECT_RULE" }] }),
    extensionFactories: [(pi) => {
      if (restrictBeforeSieve) pi.on("before_agent_start", () => pi.setActiveTools(["read", "sieve_search", "weather"]));
    }, sieve, (pi) => {
      api = pi;
      pi.registerProvider(faux.provider);
      for (const name of ["payment_lookup", "weather", "disabled_tool"]) {
        pi.registerTool({ name, label: name, description: `${name} information`, parameters: Type.Object({}),
          execute: async () => ({ content: [{ type: "text", text: "PRIVATE_TOOL_RESULT" }], details: {} }) });
      }
      pi.on("before_agent_start", (event) => { event.systemPromptOptions.sections.other_extension = "KEEP_OTHER_EXTENSION"; });
    }],
  });
  await resourceLoader.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  const authPath = join(agentDir, "auth.json");
  const modelRuntime = await ModelRuntime.create({ authPath, modelsPath: null, modelsStorePath: join(agentDir, "models-cache.json"), refreshOnCreate: false });
  const { session } = await createAgentSession({ cwd, agentDir, modelRuntime, model: faux.getModel(),
    resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(cwd),
    tools: ["read", "sieve_search", "payment_lookup", "weather", ...(scoring ? ["sieve_score"] : []), ...(inspection ? ["sieve_inspect"] : [])], thinkingLevel: "off" });
  const errors: string[] = [];
  session.subscribe((event) => {
    if (event.type === "message_end" && event.message.role === "assistant" && event.message.stopReason === "error") {
      errors.push(event.message.errorMessage ?? "Scripted model failed.");
    }
  });
  await session.bindExtensions({ onError: (error) => errors.push(error.error) });
  const services = { cwd, agentDir, modelRuntime, resourceLoader, settingsManager, diagnostics: [] };
  const runtime = new AgentSessionRuntime(session, services, async ({ sessionManager, sessionStartEvent }) => {
    await resourceLoader.reload();
    const result = await createAgentSession({ cwd, agentDir, modelRuntime, resourceLoader, settingsManager,
      sessionManager, sessionStartEvent, model: faux.getModel(), thinkingLevel: "off",
      tools: ["read", "sieve_search", "payment_lookup", "weather", ...(scoring ? ["sieve_score"] : []), ...(inspection ? ["sieve_inspect"] : [])] });
    await result.session.bindExtensions({ onError: (error) => errors.push(error.error) });
    result.session.subscribe((event) => {
      if (event.type === "message_end" && event.message.role === "assistant" && event.message.stopReason === "error") {
        errors.push(event.message.errorMessage ?? "Scripted model failed.");
      }
    });
    return { ...result, services, diagnostics: [] };
  });
  const previous = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "fixture-only";
  const requests: JevRequest[] = [];
  const authorizations: (string | null)[] = [];
  const fetchMock = t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    const request: JevRequest = JSON.parse(String(options.body));
    requests.push(request);
    authorizations.push(new Headers(options.headers).get("Authorization"));
    return Response.json({ model: "jev-1.13.0", answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
      return [id, { type: "noul", noul: question.instructions.candidate.name.includes("weather") ? 0.01 : 0.95 }];
    })) });
  });
  t.after(async () => {
    await runtime.dispose();
    fetchMock.mock.restore();
    if (previous === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = previous;
    await rm(cwd, { recursive: true, force: true });
    assert.deepEqual(errors, [], "The real Pi extension runner must not report errors");
  });
  return { cwd, authPath, modelRuntime, authorizations, errors, get session() { return runtime.session; }, get api() { return api; }, runtime, faux, requests, settingsManager };
}

function search(query = "payment retry rules") {
  return fauxAssistantMessage(fauxToolCall("sieve_search", { query }), { stopReason: "toolUse" });
}

function retrieve(faux: ReturnType<typeof fauxProvider>): void {
  faux.setResponses([search(), fauxAssistantMessage("Finished.")]);
}

test("inspection uses one request inside a stable tool call, survives session changes, and local mode returns raw evidence", async t => {
  const fixture = await setup(t, true, false, false, true);
  await mkdir(join(fixture.cwd, ".pi/sieve/observations"));
  await writeFile(join(fixture.cwd, ".pi/sieve/observations/sample.json"), JSON.stringify({
    objective: "Apply the requested update.", observations: [{ id: "a", text: "APPROVED_OBSERVATION: the record was committed." }],
  }));
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    calls++;
    const payload = String(init.body);
    assert(payload.includes("APPROVED_OBSERVATION"));
    for (const privateText of [fixture.cwd, "PRIVATE_MEMORY_BODY", "PRIVATE_TOOL_RESULT", "PRIVATE_SKILL_BODY"]) assert(!payload.includes(privateText));
    return Response.json({ model: "jev-1.13.0", answers: { q0: { type: "choice", choice: "completed", confidence: 1,
      probabilities: Object.fromEntries(Object.keys(INSPECTION_CRITERIA.outcome).map(label => [label, label === "completed" ? 1 : 0])) } } });
  });
  fixture.faux.setResponses([fauxAssistantMessage("No inspection needed.")]);
  await fixture.session.prompt("Say hello");
  assert.equal(calls, 0);
  const snapshots: unknown[][] = [];
  let definitions: unknown;
  let prompt: string | undefined;
  for (const enabled of [true, false, true]) {
    await fixture.session.prompt(enabled ? "/sieve on" : "/sieve off");
    fixture.faux.setResponses([
      context => {
        snapshots.push(structuredClone(context.messages));
        definitions ??= getCurrentTools(context.messages);
        prompt ??= getCurrentSystemPrompt(context.messages);
        return fauxAssistantMessage(fauxToolCall("sieve_inspect", { source: "sample", mode: "outcome" }), { stopReason: "toolUse" });
      },
      context => {
        snapshots.push(structuredClone(context.messages));
        assert.deepEqual(getCurrentTools(context.messages), definitions);
        assert.equal(getCurrentSystemPrompt(context.messages), prompt);
        assert(!fixture.api.getActiveTools().includes("disabled_tool"));
        const content = JSON.stringify(context.messages.at(-1));
        assert(content.includes(enabled ? "completed" : "APPROVED_OBSERVATION"));
        return fauxAssistantMessage("Finished.");
      },
    ]);
    await fixture.session.prompt("Inspect sample");
  }
  for (let i = 1; i < snapshots.length; i++) assert.deepEqual(snapshots[i].slice(0, snapshots[i - 1].length), snapshots[i - 1]);
  assert.equal(calls, 2);
  await fixture.runtime.newSession();
  fixture.faux.setResponses([fauxAssistantMessage(fauxToolCall("sieve_inspect", { source: "sample", mode: "outcome" }), { stopReason: "toolUse" }), fauxAssistantMessage("Finished.")]);
  await fixture.session.prompt("Inspect sample");
  assert.equal(calls, 3);
});

test("native TypeSafe login persists, overrides the environment, survives reload, and logs out", async (t) => {
  const fixture = await setup(t);
  const provider = fixture.modelRuntime.getProvider("typesafe");
  assert(provider?.auth.apiKey?.login, "Pi's native login selector must discover TypeSafe");
  assert.deepEqual(provider.getModels(), [], "Authentication must not add a main-agent model");
  const initialModel = fixture.session.model;
  await fixture.modelRuntime.login("typesafe", "api_key", {
    prompt: async (prompt) => { assert.equal(prompt.type, "secret"); return "stored-fixture"; },
    notify: () => {},
  });
  const stored = JSON.parse(await readFile(fixture.authPath, "utf8"));
  assert.deepEqual(stored.typesafe, { type: "api_key", key: "stored-fixture" });
  if (process.platform !== "win32") assert.equal((await stat(fixture.authPath)).mode & 0o777, 0o600);
  for (let run = 0; run < 2; run++) {
    retrieve(fixture.faux);
    await fixture.session.prompt("Fix payment retries");
    assert.equal(fixture.authorizations.at(-1), "Bearer stored-fixture");
    await fixture.session.reload();
  }
  assert.deepEqual(fixture.session.model, initialModel);
  const history = JSON.stringify(fixture.session.sessionManager.getEntries());
  assert(!history.includes("stored-fixture"));
  assert(!JSON.stringify(fixture.requests).includes("stored-fixture"));
  await fixture.modelRuntime.logout("typesafe");
  assert(!JSON.parse(await readFile(fixture.authPath, "utf8")).typesafe);
  retrieve(fixture.faux);
  await fixture.session.prompt("Fix payment retries");
  assert.equal(fixture.authorizations.at(-1), "Bearer fixture-only", "Logout leaves environment credentials available");
  delete process.env.TYPESAFE_API_KEY;
  const requestCount = fixture.requests.length;
  retrieve(fixture.faux);
  await fixture.session.prompt("Fix payment retries");
  assert.equal(fixture.requests.length, requestCount, "Missing credentials must use local fallback");
});

test("native auth resolves a secret command and cancelled login preserves existing credentials", async (t) => {
  const fixture = await setup(t);
  await writeFile(fixture.authPath, JSON.stringify({ typesafe: { type: "api_key", key: "!printf command-fixture" } }));
  retrieve(fixture.faux);
  await fixture.session.prompt("Fix payment retries");
  assert.equal(fixture.authorizations.at(-1), "Bearer command-fixture");
  await assert.rejects(fixture.modelRuntime.login("typesafe", "api_key", {
    prompt: async () => { throw new Error("Login cancelled"); }, notify: () => {},
  }));
  assert.equal(JSON.parse(await readFile(fixture.authPath, "utf8")).typesafe.key, "!printf command-fixture");
  assert(!JSON.stringify(fixture.session.sessionManager.getEntries()).includes("command-fixture"));
});

test("credential-resolution errors use local fallback without exposing the error", async (t) => {
  const fixture = await setup(t);
  const notifications: string[] = [];
  const ui = fixture.session.extensionRunner!.getUIContext();
  t.mock.method(ui, "notify", (message: string) => { notifications.push(message); });
  const auth = fixture.modelRuntime.getProvider("typesafe")!.auth.apiKey!;
  t.mock.method(auth, "resolve", async () => { throw new Error("PRIVATE_CREDENTIAL_ERROR"); });
  fixture.faux.setResponses([search(), (context) => {
    assert(JSON.stringify(context.messages).includes("PRIVATE_MEMORY_BODY"));
    return fauxAssistantMessage("Finished.");
  }]);
  await fixture.session.prompt("Fix payment retries");
  await fixture.session.prompt("/sieve status");
  assert.equal(fixture.requests.length, 0);
  assert(notifications.some((message) => message.includes("missing_key")));
  assert(!JSON.stringify(notifications).includes("PRIVATE_CREDENTIAL_ERROR"));
  assert(!JSON.stringify(fixture.session.sessionManager.getEntries()).includes("PRIVATE_CREDENTIAL_ERROR"));
});

test("ordinary input, expanded skills, and other tools never trigger Jev", async (t) => {
  const { session, faux, requests } = await setup(t);
  for (const input of ["Fix payment retries", "/skill:review Check the payment changes", "Continue"]) {
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("payment_lookup", {}), { stopReason: "toolUse" }),
      (context) => {
        assert(!JSON.stringify(context.messages).includes("PRIVATE_MEMORY_BODY"));
        return fauxAssistantMessage("Finished.");
      },
    ]);
    await session.prompt(input);
  }
  assert.equal(requests.length, 0);
  retrieve(faux);
  await session.prompt("Search the project references");
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].state, { query: "payment retry rules" });
  const payload = JSON.stringify(requests);
  for (const privateText of ["PRIVATE_SKILL_BODY", "PRIVATE_TOOL_RESULT", "PRIVATE_MEMORY_BODY", "KEEP_PROJECT_RULE", "KEEP_OTHER_EXTENSION", "user_messages"])
    assert(!payload.includes(privateText));
});

test("retrieval appends results without changing tools, skills, rules, or previous messages", async (t) => {
  const { session, api, faux, requests } = await setup(t);
  const seen: unknown[][] = [];
  let tools: unknown;
  let prompt: string | undefined;
  for (let task = 0; task < 2; task++) {
    faux.setResponses([
      (context) => {
        seen.push(structuredClone(context.messages));
        tools ??= structuredClone(getCurrentTools(context.messages));
        prompt ??= getCurrentSystemPrompt(context.messages);
        assert(prompt.includes("KEEP_PROJECT_RULE"));
        assert(prompt.includes("KEEP_OTHER_EXTENSION"));
        assert(prompt.includes("weather-skill"));
        return search();
      },
      (context) => {
        seen.push(structuredClone(context.messages));
        assert.deepEqual(getCurrentTools(context.messages), tools);
        assert.equal(getCurrentSystemPrompt(context.messages), prompt);
        assert(JSON.stringify(context.messages).includes("PRIVATE_MEMORY_BODY"));
        return fauxAssistantMessage(fauxToolCall("payment_lookup", {}), { stopReason: "toolUse" });
      },
      (context) => {
        seen.push(structuredClone(context.messages));
        assert.deepEqual(getCurrentTools(context.messages), tools);
        assert.equal(getCurrentSystemPrompt(context.messages), prompt);
        return fauxAssistantMessage("Finished.");
      },
    ]);
    await session.prompt(task === 0 ? "Fix payment retries" : "Check the next payment issue");
  }
  for (let i = 1; i < seen.length; i++) assert.deepEqual(seen[i].slice(0, seen[i - 1].length), seen[i - 1]);
  assert.equal(requests.length, 2);
  assert(api.getActiveTools().includes("weather"));
  assert(!api.getActiveTools().includes("disabled_tool"));
  assert(JSON.stringify(session.sessionManager.getEntries()).includes("PRIVATE_MEMORY_BODY"), "Tool results use normal Pi session storage");
  assert(!JSON.stringify(session.sessionManager.getEntries()).includes("pi-sieve-context"));
});

test("local and Jev retrieval share a tool schema and honor other extensions' restrictions", async (t) => {
  const { session, api, faux, requests } = await setup(t, true, true);
  const toolDefinitions: unknown[] = [];
  for (const toggle of ["off", "on"]) {
    await session.prompt(`/sieve ${toggle}`);
    faux.setResponses([
      (context) => { toolDefinitions.push(structuredClone(getCurrentTools(context.messages))); return search(); },
      (context) => {
        assert(JSON.stringify(context.messages).includes("PRIVATE_MEMORY_BODY"));
        assert(JSON.stringify(context.messages).includes(toggle === "off" ? "Sieve retrieval: disabled" : "Sieve retrieval: none"));
        return fauxAssistantMessage("Finished.");
      },
    ]);
    await session.prompt("Find payment retry rules");
    assert.deepEqual(api.getActiveTools(), ["read", "sieve_search", "weather"]);
  }
  assert.deepEqual(toolDefinitions[0], toolDefinitions[1]);
  assert.equal(requests.length, 1);
});

test("untrusted projects and invalid configurations return no document content", async (t) => {
  const fixture = await setup(t, false);
  retrieve(fixture.faux);
  await fixture.session.prompt("Find payment retry rules");
  assert.equal(fixture.requests.length, 0);
  assert(!JSON.stringify(fixture.session.messages).includes("PRIVATE_MEMORY_BODY"));
  fixture.settingsManager.setProjectTrusted(true);
  await writeFile(join(fixture.cwd, ".pi/sieve.json"), "PRIVATE_INVALID_CONFIG");
  retrieve(fixture.faux);
  await fixture.session.prompt("Find payment retry rules");
  assert.equal(fixture.requests.length, 0);
  assert(!JSON.stringify(fixture.session.messages).includes("PRIVATE_INVALID_CONFIG"));
  assert(JSON.stringify(fixture.session.messages).includes("invalid_config"));
});

test("off cancels an in-flight search without returning stale bodies or raw errors", async (t) => {
  const fixture = await setup(t);
  const notifications: string[] = [];
  t.mock.method(fixture.session.extensionRunner!.getUIContext(), "notify", (text: string) => notifications.push(text));
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  t.mock.method(globalThis, "fetch", (_url: unknown, options: RequestInit) => new Promise((_resolve, reject) => {
    started();
    options.signal?.addEventListener("abort", () => reject(new Error("PRIVATE_SERVICE_ERROR")), { once: true });
  }));
  retrieve(fixture.faux);
  const running = fixture.session.prompt("Find payment retry rules");
  await ready;
  await fixture.session.prompt("/sieve off");
  await running;
  await fixture.session.prompt("/sieve status");
  const history = JSON.stringify(fixture.session.messages);
  assert(history.includes("cancelled"));
  assert(!history.includes("PRIVATE_MEMORY_BODY"));
  assert(!history.includes("PRIVATE_SERVICE_ERROR"));
  assert(notifications.at(-1)?.includes('"reason":"disabled"'));
  assert(!JSON.stringify(notifications).includes("PRIVATE_SERVICE_ERROR"));
});

test("abort cancels retrieval and a new instruction can use the same tool", async (t) => {
  const fixture = await setup(t);
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const mock = t.mock.method(globalThis, "fetch", (_url: unknown, options: RequestInit) => new Promise((_resolve, reject) => {
    started();
    options.signal?.addEventListener("abort", () => reject(new Error("PRIVATE_ABORT")), { once: true });
  }));
  retrieve(fixture.faux);
  const running = fixture.session.prompt("Find payment retry rules");
  await ready;
  await fixture.session.abort();
  await running;
  assert.deepEqual(fixture.errors.splice(0), ["This operation was aborted"]);
  mock.mock.restore();
  assert(!JSON.stringify(fixture.session.messages).includes("PRIVATE_MEMORY_BODY"));
  retrieve(fixture.faux);
  await fixture.session.prompt("A new retrieval task");
  assert.equal(fixture.requests.length, 1);
});

test("reload, branch navigation, and session replacement keep retrieval isolated", async (t) => {
  const fixture = await setup(t);
  retrieve(fixture.faux);
  await fixture.session.prompt("Find payment retry rules");
  const first = fixture.session.sessionManager.getBranch().find((entry) => entry.type === "message" && entry.message.role === "user");
  assert(first);
  await fixture.session.navigateTree(first.id, { summarize: false });
  await fixture.session.prompt("/sieve off");
  await fixture.session.reload();
  retrieve(fixture.faux);
  await fixture.session.prompt("Search again after reload");
  assert.equal(fixture.requests.length, 2);
  await fixture.session.prompt("/sieve off");
  await fixture.runtime.newSession();
  fixture.faux.setResponses([fauxAssistantMessage("Finished.")]);
  await fixture.session.prompt("An unrelated new task");
  assert.equal(fixture.requests.length, 2);
  assert(!JSON.stringify(fixture.session.messages).includes("PRIVATE_MEMORY_BODY"));
  retrieve(fixture.faux);
  await fixture.session.prompt("Search in the new session");
  assert.equal(fixture.requests.length, 3);
  assert(!fixture.api.getActiveTools().includes("disabled_tool"));
});

test("streaming input cancels pending retrieval without uploading the new instruction", async (t) => {
  const fixture = await setup(t);
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const mock = t.mock.method(globalThis, "fetch", (_url: unknown, options: RequestInit) => new Promise((_resolve, reject) => {
    started();
    options.signal?.addEventListener("abort", () => reject(new Error("PRIVATE_NETWORK_ERROR")), { once: true });
  }));
  retrieve(fixture.faux);
  const running = fixture.session.prompt("Find payment retry rules");
  await ready;
  await fixture.session.steer("PRIVATE_NEW_INSTRUCTION: focus on another module");
  await running;
  mock.mock.restore();
  assert(!JSON.stringify(fixture.session.messages).includes("PRIVATE_MEMORY_BODY"));
  assert.equal(fixture.requests.length, 0);
  retrieve(fixture.faux);
  await fixture.session.prompt("Find references for the current task");
  assert.equal(fixture.requests.length, 1);
  assert(!JSON.stringify(fixture.requests).includes("PRIVATE_NEW_INSTRUCTION"));
});

test("delegated choice returns only the selected option without executing it or changing prefixes", async t => {
  const fixture = await setup(t, true, false, true);
  const input = { context: "A concurrent retry created a duplicate charge", question: "How useful is this action?",
    criteria: ["No evidence", "Relevant evidence"], options: [{ id: "read_handler", content: "Read the payment handler" }, { id: "test", content: "Run the concurrent retry test" }] };
  const { context: facts, ...profile } = input;
  await mkdir(join(fixture.cwd, ".pi/sieve/decisions"), { recursive: true });
  await writeFile(join(fixture.cwd, ".pi/sieve/decisions/fixture.json"), JSON.stringify(profile));
  const requests: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    assert(!String(init.body).includes("fixture.json"));
    assert(!String(init.body).includes('"profile"'));
    return Response.json({ model: "jev-1.13.0", answers: { q0: { type: "score", score: 0.8, confidence: 0.3, probabilities: { "0": 0.2, "1": 0.8 } }, q1: { type: "score", score: 0.9, confidence: 0.5, probabilities: { "0": 0.1, "1": 0.9 } } } });
  });
  let previous: unknown[] = [];
  let definitions: unknown;
  for (const toggle of ["on", "off", "on"]) {
    await fixture.session.prompt(`/sieve ${toggle}`);
    fixture.faux.setResponses([
      context => {
        definitions ??= structuredClone(getCurrentTools(context.messages));
        assert.deepEqual(getCurrentTools(context.messages), definitions);
        previous = structuredClone(context.messages);
        return fauxAssistantMessage(fauxToolCall("sieve_score", requests.length ? { context: facts, profile: "fixture" } : input), { stopReason: "toolUse" });
      },
      context => {
        assert.deepEqual(context.messages.slice(0, previous.length), previous);
        assert(JSON.stringify(context.messages).includes(toggle === "on" ? '"available":true' : '"available":false'));
        const appended = context.messages.slice(previous.length).filter(message => message.role === "toolResult")
          .flatMap(message => message.content).filter(part => part.type === "text").map(part => part.text).join("\n");
        assert(!appended.includes('"probabilities"'));
        assert(!appended.includes('"confidence"'));
        assert(appended.includes(toggle === "on" ? '"selected":{"id":"test"' : '"selected":null'));
        return fauxAssistantMessage("The selected action is ready for execution.");
      },
    ]);
    await fixture.session.prompt("Compare possible next actions without executing them.");
  }
  assert.equal(requests.length, 2);
  for (const marker of ["PRIVATE_MEMORY_BODY", "PRIVATE_SKILL_BODY", "PRIVATE_TOOL_RESULT", "KEEP_PROJECT_RULE", "fixture-only"])
    assert(!JSON.stringify(requests).includes(marker));
  assert(!fixture.api.getActiveTools().includes("disabled_tool"));
  await fixture.runtime.newSession();
  fixture.faux.setResponses([fauxAssistantMessage("New session.")]);
  await fixture.session.prompt("Continue without scoring.");
  assert.equal(requests.length, 2);
});
