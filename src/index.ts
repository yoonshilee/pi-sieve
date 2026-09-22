import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { INSPECT_TOOL, InspectionParameters, inspectObservations, inspectionContent, loadObservations } from "./inspection.ts";
import { SCORE_TOOL, ScoreParameters, loadScoreInput, scoreOptions, type ScoringResult } from "./scoring.ts";
import {
  DEFAULTS, SEARCH_TOOL, QUERY_LIMIT, loadConfig, loadDocuments, renderDocuments, selectCandidates,
  type Config,
} from "./selection.ts";

const AUTH_PROVIDER = "typesafe";
interface Diagnostics {
  reason: ScoringResult["reason"];
  operation?: "search" | "score" | "inspect";
  evaluated?: number;
  selected?: number;
  skipped?: number;
  elapsedMs?: number;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export default function sieve(pi: ExtensionAPI): void {
  // Register authentication only; Jev is not a main-agent chat model.
  pi.registerProvider(AUTH_PROVIDER, { name: "TypeSafe", apiKey: "$TYPESAFE_API_KEY", models: [] });
  let enabledOverride: boolean | undefined;
  let diagnostics: Diagnostics = { reason: "not_run" };
  const requests = new Set<AbortController>();

  function cancelRequests(): void {
    for (const request of requests) request.abort();
    requests.clear();
  }

  function resetSession(): void {
    cancelRequests();
    enabledOverride = undefined;
    diagnostics = { reason: "not_run" };
  }

  pi.on("session_start", resetSession);
  pi.on("session_shutdown", resetSession);
  pi.on("session_tree", resetSession);
  pi.on("input", cancelRequests);

  pi.registerCommand("sieve", {
    description: "Inspect Sieve or toggle Jev: status, on, off",
    handler: async (args, ctx) => {
      const action = args.trim() || "status";
      if (action === "off" || action === "on") {
        cancelRequests();
        enabledOverride = action === "on";
        diagnostics = { reason: action === "off" ? "disabled" : "not_run" };
        ctx.ui.notify(action === "on" ? "Sieve will use Jev for inspection, scoring, and search." : "Sieve scoring is disabled; inspection returns raw observations and search uses local matching.", "info");
      } else if (action === "status") {
        let enabled = enabledOverride ?? DEFAULTS.enabled;
        try { enabled = enabledOverride ?? (await loadConfig(ctx.cwd)).enabled; }
        catch { diagnostics = { reason: "invalid_config" }; }
        ctx.ui.notify(JSON.stringify({ enabled, ...diagnostics }), "info");
      } else ctx.ui.notify("Usage: /sieve status|on|off", "warning");
    },
  });

  pi.registerTool({
    name: INSPECT_TOOL, label: "Sieve Inspect",
    description: "Read an existing upload-approved observation batch and classify operation outcomes or each observation's support for a hypothesis. Reads .pi/sieve/observations/<source>.json with objective and observations [{id,text}]. Outcome labels: completed, not_applied, partial, unknown. Evidence labels: supports, contradicts, unrelated, insufficient. Returns semantic judgments; when disabled or unavailable returns original observations for caller interpretation. Does not execute actions or prove overall task completion.",
    promptGuidelines: ["Use sieve_inspect for an existing batch of varied natural-language observations requiring repeated semantic judgments. Do not copy already-read output into a file merely to call it, or use it for exact status/exit-code checks. Outcome asks whether the stated objective happened; evidence asks whether each observation establishes, contradicts, does not address, or lacks proof for the hypothesis. The objective and full observation text go to TypeSafe; use only upload-approved content, never credentials. Original files remain available through read. Unknown or insufficient means obtain evidence, not retry blindly. Existing rules and permissions still apply."],
    parameters: InspectionParameters,
    async execute(_id, { source, mode }, signal, _update, ctx) {
      const request = new AbortController();
      requests.add(request);
      const combined = AbortSignal.any([request.signal, ...(signal ? [signal] : []), ...(ctx.signal ? [ctx.signal] : [])]);
      const failure = (reason: Diagnostics["reason"]) => {
        if (!combined.aborted) diagnostics = { operation: "inspect", reason };
        return { content: [{ type: "text" as const, text: JSON.stringify({ available: false, reason, mode }) }], details: { operation: "inspect", reason } };
      };
      try {
        combined.throwIfAborted();
        if (!ctx.isProjectTrusted()) return failure("untrusted_project");
        let config: Config;
        try { config = await loadConfig(ctx.cwd); }
        catch { combined.throwIfAborted(); return failure("invalid_config"); }
        config.enabled = enabledOverride ?? config.enabled;
        const batch = await loadObservations(ctx.cwd, source);
        combined.throwIfAborted();
        if (!batch) return failure("invalid_input");
        let key: string | undefined;
        if (config.enabled) {
          try { key = await ctx.modelRegistry.getApiKeyForProvider(AUTH_PROVIDER); }
          catch { /* Credential resolution failure returns raw observations, never fabricated labels. */ }
        }
        combined.throwIfAborted();
        const result = await inspectObservations(batch, mode, config, key, combined);
        combined.throwIfAborted();
        diagnostics = { operation: "inspect", reason: result.reason, evaluated: result.evaluated, elapsedMs: result.elapsedMs,
          model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
        return { content: [{ type: "text" as const, text: JSON.stringify(inspectionContent(result)) }], details: diagnostics };
      } catch { return failure(combined.aborted ? "cancelled" : "service_error"); }
      finally { requests.delete(request); }
    },
  });

  pi.registerTool({
    name: SCORE_TOOL, label: "Sieve Score",
    description: "Delegate a substantial choice to Jev. Supply context plus either a known project profile name or inline question, criteria, and options. A profile reuses .pi/sieve/decisions/<name>.json without rewriting its candidates or rubric. Returns the highest-scoring option unchanged; ties use input order. Follow the selected action using existing tools. Does not execute or authorize actions.",
    promptGuidelines: ["Use sieve_score only when multiple plausible options require substantial evidence comparison or a wrong choice would cause significant rework. Skip it for explicit user commands, routine tests, exact code checks, and obvious next steps; never invent alternatives merely to call it. Prefer a known, applicable project profile and concise new facts. Do not guess profile names or recreate unchanged candidates and rubrics each turn. Profiles must contain currently eligible, authorized actions. For inline choices, use a neutral shared rubric without choosing a winner first. Context and the resolved question, criteria, and options go to TypeSafe. Execute selected.content without reranking; exact command options require exact execution. Normal rules and permissions apply. If unavailable, report no decision and obtain missing facts or input."],
    parameters: ScoreParameters,
    async execute(_id, input, signal, _update, ctx) {
      const request = new AbortController();
      requests.add(request);
      const combined = AbortSignal.any([request.signal, ...(signal ? [signal] : []), ...(ctx.signal ? [ctx.signal] : [])]);
      const unavailable = (reason: ScoringResult["reason"]) => ({ available: false, reason, selected: null, results: [] });
      const reply = (result: Pick<ScoringResult, "available" | "reason" | "selected">) => ({
        content: [{ type: "text" as const, text: JSON.stringify({ available: result.available, reason: result.reason, selected: result.selected }) }], details: result,
      });
      try {
        combined.throwIfAborted();
        if (!ctx.isProjectTrusted()) { diagnostics = { operation: "score", reason: "untrusted_project" }; return reply(unavailable("untrusted_project")); }
        let config: Config;
        try { config = await loadConfig(ctx.cwd); }
        catch { combined.throwIfAborted(); diagnostics = { operation: "score", reason: "invalid_config" }; return reply(unavailable("invalid_config")); }
        config.enabled = enabledOverride ?? config.enabled;
        let key: string | undefined;
        if (config.enabled) {
          try { key = await ctx.modelRegistry.getApiKeyForProvider(AUTH_PROVIDER); }
          catch { /* Missing credentials return no fabricated scores. */ }
        }
        combined.throwIfAborted();
        const resolved = await loadScoreInput(ctx.cwd, input);
        combined.throwIfAborted();
        if (!resolved) { diagnostics = { operation: "score", reason: "invalid_input" }; return reply(unavailable("invalid_input")); }
        const result = await scoreOptions(resolved, config, key, combined);
        combined.throwIfAborted();
        diagnostics = { operation: "score", reason: result.reason, evaluated: result.evaluated,
          elapsedMs: result.elapsedMs, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
        return reply(result);
      } catch {
        return reply(unavailable(combined.aborted ? "cancelled" : "service_error"));
      } finally { requests.delete(request); }
    },
  });

  pi.registerTool({
    name: SEARCH_TOOL, label: "Sieve Search",
    description: "Search project memories and command guides for a specific information need. Returns selected references and their source paths. Does not execute commands or change available skills and tools.",
    promptGuidelines: ["Use sieve_search when project memories or command guides may help. Supply a concise information need, not conversation history or raw tool output. The query and candidate summaries may be sent to TypeSafe."],
    parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: QUERY_LIMIT }) }),
    async execute(_id, { query }, signal, _update, ctx) {
      const started = performance.now();
      const request = new AbortController();
      requests.add(request);
      const combined = AbortSignal.any([request.signal, ...(signal ? [signal] : []), ...(ctx.signal ? [ctx.signal] : [])]);
      const reply = (details: Diagnostics, references = "") => ({
        content: [{ type: "text" as const, text: `Sieve retrieval: ${details.reason}.\n${references || "No reference content returned."}` }], details,
      });
      try {
        combined.throwIfAborted();
        if (!ctx.isProjectTrusted()) { diagnostics = { reason: "untrusted_project" }; return reply(diagnostics); }
        let config: Config;
        try { config = await loadConfig(ctx.cwd); }
        catch { combined.throwIfAborted(); diagnostics = { reason: "invalid_config" }; return reply(diagnostics); }
        config.enabled = enabledOverride ?? config.enabled;
        combined.throwIfAborted();
        const loaded = await loadDocuments(ctx.cwd, config);
        combined.throwIfAborted();
        let key: string | undefined;
        if (config.enabled) {
          try { key = await ctx.modelRegistry.getApiKeyForProvider(AUTH_PROVIDER); }
          catch { /* Credential failures use the same bounded local fallback as a missing key. */ }
        }
        combined.throwIfAborted();
        const selection = await selectCandidates(query, loaded.candidates, config, key, combined);
        combined.throwIfAborted();
        diagnostics = {
          operation: "search", reason: selection.fallback, evaluated: selection.evaluated, selected: selection.documents.length,
          skipped: loaded.skipped, elapsedMs: Math.round(performance.now() - started), model: selection.model,
          inputTokens: selection.inputTokens, outputTokens: selection.outputTokens,
        };
        return reply(diagnostics, renderDocuments(selection.documents, config.contextChars));
      } catch {
        // Do not publish an obsolete result or overwrite a newer session's diagnostics.
        return reply({ reason: combined.aborted ? "cancelled" : "service_error" });
      } finally { requests.delete(request); }
    },
  });
}
