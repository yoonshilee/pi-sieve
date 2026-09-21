import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  AgentSessionRuntime, createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
  type ExtensionAPI, type Skill,
} from "@earendil-works/pi-coding-agent";
import {
  fauxProvider, fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt, getCurrentTools,
  InMemoryCredentialStore,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import sieve from "../src/index.ts";

async function setup(t: TestContext, trusted = true, restrictBeforeSieve = false) {
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
  const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, modelsStorePath: join(agentDir, "models-cache.json"), refreshOnCreate: false });
  const { session } = await createAgentSession({ cwd, agentDir, modelRuntime, model: faux.getModel(),
    resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(cwd),
    tools: ["read", "sieve_search", "payment_lookup", "weather"], thinkingLevel: "off" });
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
      tools: ["read", "sieve_search", "payment_lookup", "weather"] });
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
  const requests: { state: { user_messages: string[] }; questions: Record<string, unknown> }[] = [];
  const fetchMock = t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    const request = JSON.parse(String(options.body));
    requests.push(request);
    return Response.json({ model: "jev-1.13.0", answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
      const entry = question as { instructions: { candidate?: { name: string } } };
      return [id, { type: "noul", noul: entry.instructions.candidate?.name.includes("weather") ? 0.01 : 0.95 }];
    })) });
  });
  t.after(async () => {
    await runtime.dispose();
    fetchMock.mock.restore();
    if (previous === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = previous;
    await rm(cwd, { recursive: true, force: true });
    assert.deepEqual(errors, [], "The real Pi extension runner must not report errors");
  });
  return { cwd, get session() { return runtime.session; }, get api() { return api; }, runtime, faux, requests, settingsManager };
}

test("real Pi filters and restores tools, injects ephemeral references, and preserves project rules", async (t) => {
  const { session, api, faux, requests } = await setup(t);
  faux.setResponses([
    (context) => {
      const names = getCurrentTools(context.messages).map((tool) => tool.name);
      assert(names.includes("read"));
      assert(names.includes("sieve_search"));
      assert(!names.includes("weather"));
      assert(!names.includes("disabled_tool"));
      assert(JSON.stringify(context.messages).includes("PRIVATE_MEMORY_BODY"));
      const prompt = getCurrentSystemPrompt(context.messages);
      assert(prompt.includes("KEEP_PROJECT_RULE"));
      assert(prompt.includes("KEEP_OTHER_EXTENSION"));
      assert(!prompt.includes("weather-skill"));
      return fauxAssistantMessage(fauxToolCall("sieve_search", { query: "weather" }), { stopReason: "toolUse" });
    },
    (context) => {
      assert(getCurrentTools(context.messages).some((tool) => tool.name === "weather"));
      return fauxAssistantMessage("Finished.");
    },
  ]);
  await session.prompt("Fix payment retries");
  assert(api.getActiveTools().includes("weather"));
  assert(!api.getActiveTools().includes("disabled_tool"));
  assert.equal(requests.length, 1, "Tool-loop turns must not call Jev again");
  assert(!JSON.stringify(requests).includes("PRIVATE_MEMORY_BODY"));
  assert(!JSON.stringify(requests).includes("PRIVATE_TOOL_RESULT"));
  assert(!JSON.stringify(session.sessionManager.getEntries()).includes("PRIVATE_MEMORY_BODY"));
});

test("raw inputs, explicit skills, continuation context, and branch changes", async (t) => {
  const { session, faux, requests } = await setup(t);
  for (const prompt of ["Fix payment retries", "/skill:review Check the payment changes", "Continue", "Finish the checks"]) {
    faux.setResponses([fauxAssistantMessage("Finished.")]);
    await session.prompt(prompt);
  }
  assert.equal(requests.length, 4);
  assert.deepEqual(requests[2].state.user_messages, ["Fix payment retries", "/skill:review Check the payment changes", "Continue"]);
  assert.deepEqual(requests[3].state.user_messages, ["/skill:review Check the payment changes", "Continue", "Finish the checks"]);
  assert(!JSON.stringify(requests).includes("PRIVATE_SKILL_BODY"));
  assert(!JSON.stringify(requests[1].questions).includes('"name":"review"'));
  const first = session.sessionManager.getBranch().find((entry) => entry.type === "message" && entry.message.role === "user");
  assert(first);
  await session.navigateTree(first.id, { summarize: false });
  faux.setResponses([fauxAssistantMessage("Finished.")]);
  await session.prompt("A separate task");
  assert.deepEqual(requests.at(-1)!.state.user_messages, ["A separate task"]);
});

test("new streaming instructions restore hidden tools without another cloud request", async (t) => {
  const { session, api, faux, requests } = await setup(t);
  faux.setResponses([
    async () => {
      assert(!api.getActiveTools().includes("weather"));
      await session.steer("Now inspect weather too");
      assert(api.getActiveTools().includes("weather"));
      return fauxAssistantMessage("Changed direction.");
    },
    fauxAssistantMessage("Finished."),
  ]);
  await session.prompt("Fix payment retries");
  assert.equal(requests.length, 1);
});

test("external restrictions, off mode, and untrusted projects remain intact", async (t) => {
  const { session, api, faux, requests } = await setup(t);
  faux.setResponses([() => {
    api.setActiveTools(["read", "sieve_search"]);
    return fauxAssistantMessage("Finished.");
  }]);
  await session.prompt("Fix payment retries");
  assert.deepEqual(api.getActiveTools(), ["read", "sieve_search"]);
  await session.prompt("/sieve off");
  faux.setResponses([fauxAssistantMessage("Finished.")]);
  await session.prompt("Fix payment retries again");
  assert.equal(requests.length, 1);
});

test("untrusted projects never read private candidates or call Jev", async (t) => {
  const { session, faux, requests } = await setup(t, false);
  faux.setResponses([(context) => {
    assert(!JSON.stringify(context.messages).includes("PRIVATE_MEMORY_BODY"));
    assert(getCurrentTools(context.messages).some((tool) => tool.name === "weather"));
    return fauxAssistantMessage("Finished.");
  }]);
  await session.prompt("Fix payment retries");
  assert.equal(requests.length, 0);
});

test("settling and reloading release exclusions and discard raw history", async (t) => {
  const fixture = await setup(t);
  fixture.faux.setResponses([() => {
    assert(!fixture.api.getActiveTools().includes("weather"));
    return fauxAssistantMessage("Finished.");
  }]);
  await fixture.session.prompt("Fix payment retries");
  assert(fixture.api.getActiveTools().includes("weather"));
  await fixture.session.reload();
  fixture.faux.setResponses([fauxAssistantMessage("Finished.")]);
  await fixture.session.prompt("Start another task");
  assert.deepEqual(fixture.requests.at(-1)!.state.user_messages, ["Start another task"]);
  fixture.api.setActiveTools(["read"]);
  fixture.faux.setResponses([fauxAssistantMessage("Finished.")]);
  await fixture.session.prompt("No recovery tool is available");
  assert.equal(fixture.requests.length, 2);
  assert.deepEqual(fixture.api.getActiveTools(), ["read"]);
});

test("disabling during an in-flight selection cannot apply a stale result", async (t) => {
  const { session, api, faux } = await setup(t);
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  t.mock.method(globalThis, "fetch", (_url: unknown, options: RequestInit) => new Promise((_resolve, reject) => {
    started();
    options.signal?.addEventListener("abort", () => reject(new Error("PRIVATE_ABORT")), { once: true });
  }));
  faux.setResponses([(context) => {
    assert(getCurrentTools(context.messages).some((tool) => tool.name === "weather"));
    assert(!JSON.stringify(context.messages).includes("PRIVATE_MEMORY_BODY"));
    return fauxAssistantMessage("Finished.");
  }]);
  const pending = session.prompt("Fix payment retries");
  await ready;
  await session.prompt("/sieve off");
  await pending;
  assert(api.getActiveTools().includes("weather"));
});

test("session replacement starts without old raw inputs and disabled tools", async (t) => {
  const fixture = await setup(t);
  fixture.faux.setResponses([fauxAssistantMessage("Finished.")]);
  await fixture.session.prompt("Fix payment retries");
  await fixture.runtime.newSession();
  fixture.faux.setResponses([fauxAssistantMessage("Finished.")]);
  await fixture.session.prompt("Explain a new topic");
  assert.deepEqual(fixture.requests.at(-1)!.state.user_messages, ["Explain a new topic"]);
  assert(!fixture.api.getActiveTools().includes("disabled_tool"));
  delete process.env.TYPESAFE_API_KEY;
  fixture.faux.setResponses([(context) => {
    assert(getCurrentTools(context.messages).some((tool) => tool.name === "weather"));
    assert(JSON.stringify(context.messages).includes("PRIVATE_MEMORY_BODY"));
    return fauxAssistantMessage("Finished.");
  }]);
  await fixture.session.prompt("Fix payment retries without the selector service");
  assert.equal(fixture.requests.length, 2);
});

test("an earlier extension's live tool restrictions survive structured selection", async (t) => {
  const { session, api, faux } = await setup(t, true, true);
  faux.setResponses([(context) => {
    const names = getCurrentTools(context.messages).map((tool) => tool.name);
    assert(!names.includes("payment_lookup"), "Do not undo an earlier setActiveTools call");
    assert(!names.includes("weather"));
    return fauxAssistantMessage("Finished.");
  }]);
  await session.prompt("Fix payment retries");
  assert(!api.getActiveTools().includes("payment_lookup"));
});
