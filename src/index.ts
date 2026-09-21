import { createHash } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  DEFAULTS, SEARCH_TOOL, TASK_LIMIT, isMentioned, keywordScore, loadConfig, loadDocuments,
  rankCandidates, renderDocuments, selectCandidates,
  type Candidate, type Config, type FallbackReason,
} from "./selection.ts";

const CONTEXT_TYPE = "pi-sieve-context";
const INPUT_COUNT = 3;
const AUTH_PROVIDER = "typesafe";

function messageKey(message: { timestamp: number; content: unknown }): string {
  return `${message.timestamp}:${createHash("sha256").update(JSON.stringify(message.content)).digest("hex")}`;
}

export default function sieve(pi: ExtensionAPI): void {
  // Register authentication only; Jev is not a main-agent chat model.
  pi.registerProvider(AUTH_PROVIDER, { name: "TypeSafe", apiKey: "$TYPESAFE_API_KEY", models: [] });

  let config: Config = { ...DEFAULTS };
  let enabledOverride: boolean | undefined;
  let catalog: Candidate[] = [];
  let context = "";
  let pendingRaw: string | undefined;
  let inputTools: string[] = [];
  let currentInput: { raw: string; expanded: string } | undefined;
  const knownInputs = new Map<string, string>();
  let hidden = new Set<string>();
  let appliedTools: string[] = [];
  let request: AbortController | undefined;
  let generation = 0;
  let diagnostics: { reason: FallbackReason; evaluated?: number; selected?: number; hidden?: number; skipped?: number; elapsedMs?: number; model?: string } = { reason: "not_run" };

  function releaseTools(names?: Set<string>): void {
    if (!hidden.size) return;
    const active = pi.getActiveTools();
    // A removed visible tool indicates another controller narrowed the loadout.
    // Yield ownership rather than restoring tools into that restriction.
    if (appliedTools.some((name) => !active.includes(name))) { hidden.clear(); return; }
    const available = new Set(pi.getAllTools().map((tool) => tool.name));
    const restored = [...hidden].filter((name) => available.has(name) && (!names || names.has(name)));
    if (restored.length) pi.setActiveTools([...new Set([...active, ...restored])]);
    for (const name of restored) hidden.delete(name);
    appliedTools = pi.getActiveTools();
  }

  function resetRun(): void {
    generation++;
    request?.abort();
    request = undefined;
    releaseTools();
    hidden.clear();
    appliedTools = [];
    context = "";
    catalog = [];
  }

  function resetSession(): void {
    resetRun();
    pendingRaw = undefined;
    inputTools = [];
    currentInput = undefined;
    knownInputs.clear();
    enabledOverride = undefined;
    diagnostics = { reason: "not_run" };
  }

  pi.on("session_start", resetSession);
  pi.on("session_shutdown", resetSession);
  pi.on("session_tree", resetSession);
  pi.on("agent_settled", () => { resetRun(); currentInput = undefined; });

  pi.on("input", (event) => {
    resetRun();
    currentInput = undefined;
    inputTools = pi.getActiveTools();
    pendingRaw = event.source !== "extension" && !event.streamingBehavior ? event.text : undefined;
    return { action: "continue" };
  });

  pi.on("message_end", (event) => {
    if (event.message.role !== "user" || !currentInput) return;
    const text = typeof event.message.content === "string" ? event.message.content :
      event.message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
    if (text === currentInput.expanded) {
      knownInputs.set(messageKey(event.message), currentInput.raw);
      while (knownInputs.size > INPUT_COUNT) knownInputs.delete(knownInputs.keys().next().value!);
      currentInput = undefined;
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    resetRun();
    const runGeneration = generation;
    const raw = pendingRaw;
    pendingRaw = undefined;
    currentInput = raw === undefined ? undefined : { raw, expanded: event.prompt };
    if (!ctx.isProjectTrusted()) { diagnostics = { reason: "untrusted_project" }; return; }
    try { config = await loadConfig(ctx.cwd); }
    catch { diagnostics = { reason: "invalid_config" }; return; }
    if (generation !== runGeneration || ctx.signal?.aborted) return;
    if (!(enabledOverride ?? config.enabled)) { diagnostics = { reason: "disabled" }; return; }
    const task: string[] = raw === undefined ? [] : [raw];
    if (raw !== undefined) {
      const recent = ctx.sessionManager.getBranch().flatMap((entry) => {
        if (entry.type !== "message" || entry.message.role !== "user") return [];
        const input = knownInputs.get(messageKey(entry.message));
        return input === undefined ? [] : [input];
      });
      for (const prior of recent.slice(-(INPUT_COUNT - 1)).reverse()) {
        if ([prior, ...task].join("\n").length <= TASK_LIMIT) task.unshift(prior);
      }
    }
    const options = event.systemPromptOptions;
    const liveBefore = new Set(pi.getActiveTools());
    const removedElsewhere = new Set(inputTools.filter((name) => !liveBefore.has(name)));
    const active = new Set(options.selectedTools.filter((name) => !removedElsewhere.has(name)));
    if (!active.has(SEARCH_TOOL)) { diagnostics = { reason: "recovery_unavailable" }; return; }
    const loaded = await loadDocuments(ctx.cwd, config);
    if (generation !== runGeneration || ctx.signal?.aborted) return;
    const allTools = pi.getAllTools();
    const query = task.join("\n");
    catalog = [
      ...loaded.candidates,
      ...options.skills.filter((skill) => !skill.disableModelInvocation).map((skill): Candidate => ({
        id: `skill:${skill.name}`, kind: "skill", name: skill.name, description: skill.description,
        path: skill.filePath, pinned: config.pinnedSkills.includes(skill.name) || isMentioned(query, skill.name),
      })),
      ...allTools.filter((tool) => active.has(tool.name) && tool.sourceInfo.source !== "builtin" && tool.name !== SEARCH_TOOL)
        .map((tool): Candidate => ({
          id: `tool:${tool.name}`, kind: "tool", name: tool.name, description: tool.description,
          pinned: config.pinnedTools.includes(tool.name) || isMentioned(query, tool.name),
        })),
    ];
    for (const item of catalog) item.pinned ||= isMentioned(query, item.name);
    request = new AbortController();
    const signal = ctx.signal ? AbortSignal.any([request.signal, ctx.signal]) : request.signal;
    const key = await ctx.modelRegistry.getApiKeyForProvider(AUTH_PROVIDER);
    if (generation !== runGeneration || signal.aborted) return;
    const selection = await selectCandidates(task, catalog, config, key, signal);
    if (generation !== runGeneration || signal.aborted) return;
    const liveAfter = pi.getActiveTools();
    if (liveAfter.length !== liveBefore.size || liveAfter.some((name) => !liveBefore.has(name))) {
      diagnostics = { reason: "tools_changed" };
      return;
    }
    context = renderDocuments(selection.documents, config.contextChars);
    options.skills = options.skills.filter((skill) => !selection.excluded.has(`skill:${skill.name}`));
    hidden = new Set([...active].filter((name) => selection.excluded.has(`tool:${name}`)));
    options.selectedTools = options.selectedTools.filter((name) => active.has(name) && !hidden.has(name));
    appliedTools = [...options.selectedTools];
    diagnostics = {
      reason: selection.fallback, evaluated: selection.evaluated, selected: selection.documents.length,
      hidden: hidden.size, skipped: loaded.skipped, elapsedMs: selection.elapsedMs, model: selection.model,
    };
  });

  pi.on("context", (event) => {
    const messages = event.messages.filter((message) => message.role !== "custom" || message.customType !== CONTEXT_TYPE);
    if (context) messages.push({ role: "custom", customType: CONTEXT_TYPE, content: context, display: false, timestamp: Date.now() });
    return { messages };
  });

  pi.registerCommand("sieve", {
    description: "Inspect or toggle Sieve: status, on, off",
    handler: async (args, ctx) => {
      const action = args.trim() || "status";
      if (action === "off" || action === "on") {
        resetRun();
        enabledOverride = action === "on";
        diagnostics = { reason: action === "off" ? "disabled" : "not_run" };
        ctx.ui.notify(`Sieve ${action}. Changes apply to the next task.`, "info");
      } else if (action === "status") {
        ctx.ui.notify(JSON.stringify({ enabled: enabledOverride ?? config.enabled, ...diagnostics }), "info");
      } else ctx.ui.notify("Usage: /sieve status|on|off", "warning");
    },
  });

  pi.registerTool({
    name: SEARCH_TOOL, label: "Sieve Search",
    description: "Search local memory, command guides, and skill descriptions. Restore matching tools hidden by Sieve when a required capability is missing. This does not execute commands.",
    promptGuidelines: ["Use sieve_search when a needed skill, memory, guide, or tool appears to be missing."],
    parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: TASK_LIMIT }) }),
    async execute(_id, { query }, _signal, _update, ctx: ExtensionContext) {
      if (!ctx.isProjectTrusted()) return { content: [{ type: "text", text: "Sieve requires a trusted project." }], details: {} };
      try {
        const currentConfig = await loadConfig(ctx.cwd);
        const loaded = await loadDocuments(ctx.cwd, currentConfig);
        const candidates = [...loaded.candidates, ...catalog.filter((item) => item.kind === "skill" || item.kind === "tool")];
        const matches = rankCandidates(query, candidates).filter((item) => keywordScore(query, item) > 0).slice(0, 10);
        const before = new Set(hidden);
        releaseTools(new Set(matches.filter((item) => item.kind === "tool").map((item) => item.name)));
        const active = new Set(pi.getActiveTools());
        const results = matches.map((item) => ({
          kind: item.kind, name: item.name, description: item.description, source: item.path,
          restored: item.kind === "tool" ? before.has(item.name) && active.has(item.name) : undefined,
        }));
        const documents = renderDocuments(matches.filter((item) => item.body !== undefined).slice(0, currentConfig.maxDocuments), currentConfig.contextChars);
        return { content: [{ type: "text", text: JSON.stringify(results) + (documents ? `\n${documents}` : "") }], details: {} };
      } catch {
        return { content: [{ type: "text", text: "Sieve could not load the local configuration." }], details: {} };
      }
    },
  });
}
