# Pi Sieve

A Jev-powered context and tool selector for Pi agents. Sieve selects relevant
memories, command guides, skills, and optional tools for each task. Pi's main
model continues to plan and execute the work.

**Compatibility:** Pi **0.86.1**, Node **22.19+**. The supported Pi package range
is `>=0.86.1 <0.87.0`. Thresholds are experimental; real-world speed and accuracy
gains have not been established.

## Install

Install from the [GitHub repository](https://github.com/yoonshilee/pi-sieve):

```sh
pi install git:github.com/yoonshilee/pi-sieve
pi list
```

This installs the plugin for your user account. Start Pi in the project where
you want to use Sieve, or run `/reload` in an existing session, then configure
your key with `/login typesafe`. No npm release is currently available.

For a project-only installation, run this from the target project instead:

```sh
pi install -l git:github.com/yoonshilee/pi-sieve
```

Update or remove the installation with:

```sh
pi update git:github.com/yoonshilee/pi-sieve
pi remove git:github.com/yoonshilee/pi-sieve
```

For project-only removal, add `-l` and run from that project. Reload or restart
Pi after changing the installation.
See [Pi package management](https://pi.dev/docs/latest/packages) for details.

### Local development

Clone the repository and install its development dependencies:

```sh
git clone https://github.com/yoonshilee/pi-sieve.git
cd pi-sieve
npm ci --ignore-scripts
pi -e ./src/index.ts
```

The last command loads Sieve for one session. For persistent local use, run
`pi install .` instead, then start or reload Pi. Keep the checkout in place:
Pi references local packages without copying them. After updating the checkout,
run `npm ci --ignore-scripts` there and reload Pi. Run `pi remove .` from the
checkout to remove that local installation.

## Configure your TypeSafe key

Each user supplies their own key from the [TypeSafe console](https://console.typesafe.ai).
The plugin contains no shared credential. Review [PRIVACY.md](PRIVACY.md) before
enabling Jev requests.

### Recommended: Pi login

After installing or reloading the plugin, enter this in interactive Pi:

```text
/login typesafe
```

Paste your key into Pi's API-key dialog. Pi saves it under `typesafe` in its
user-level `auth.json` (normally `~/.pi/agent/auth.json`). It applies to the next
task without restarting Pi and is shared across your projects. Sieve registers
an authentication provider with no chat models, so your main model is unchanged.
Saving the key does not validate it with TypeSafe; the next selection request uses it.

Pi creates the credential file with `0600` permissions on Unix, but stores literal
keys as plain text. Its 0.86.1 login dialog can display the entered text; use the
secret-manager option below if you need to avoid displaying a key in the terminal.
To remove the saved credential, run `/logout` and select **TypeSafe**. Pi 0.86.1
does not accept a provider argument for `/logout`.

### Environment variables and secret managers

For CI or non-interactive Pi, set `TYPESAFE_API_KEY` before starting the process.
For a temporary setup in **zsh**, this prompt hides the key and keeps it out of
shell command history:

```zsh
read -rs 'TYPESAFE_API_KEY?TypeSafe API key: '
printf '\n'
export TYPESAFE_API_KEY
pi
```

Pi's saved credential takes precedence over `TYPESAFE_API_KEY`. Logging out removes
the saved credential only; an environment key remains usable. Use `/sieve off` to
stop automatic selection regardless of the credential source. Restart Pi after
changing its parent environment; `/reload` does not import new shell variables.

Pi also supports a `!command` in `auth.json` to retrieve a key from a secret
manager. For example, if you already stored a generic password under the macOS
Keychain service name `typesafe`, merge this entry into your existing `auth.json`
without replacing other providers:

```json
{
  "typesafe": {
    "type": "api_key",
    "key": "!security find-generic-password -ws 'typesafe'"
  }
}
```

Pi executes the command locally and caches its output for the process lifetime;
restart Pi after rotating that secret. See [Pi authentication](https://pi.dev/docs/latest/providers#key-resolution)
for environment references and 1Password examples. Sieve uses Pi's credential
resolver; it does not maintain a second credential file or load `.env`.
Keys are not accepted in `.pi/sieve.json`.

## Add memories and guides

In the project where you run Pi, create these directories:

```sh
mkdir -p .pi/sieve/memories .pi/sieve/guides
```

Add Markdown files with a name, an uploadable description, and a body:

```markdown
---
name: payment-retries
description: Payment retry handling and idempotency checks in this project.
---

# Payment retries

Verify that retrying an idempotency key does not create another payment.
Check the current implementation before relying on this note.
```

See the fictional [memory](examples/memories/payment-retries.md) and
[guide](examples/guides/test-payments.md). Examples are not loaded automatically.
**Descriptions go to Jev; selected bodies go to Pi's main model.** User input and
descriptions may themselves contain private information. Keep mandatory rules in
`AGENTS.md`, which Sieve never filters. Skills and tools come from Pi's loaded
catalog; no separate copies are needed.

Add these entries to your target project's `.gitignore` if the references and
configuration are private; this repository's ignore rules do not protect other projects:

```gitignore
.pi/sieve/
.pi/sieve.json
```

## Configure selection

Defaults work without a configuration file. To override them, copy
[examples/sieve.json](examples/sieve.json) to `.pi/sieve.json` in your target
project, or create a file containing only the fields you want to change.
Changes apply to the next normal task. Relative directories resolve from the
project working directory; other applications' memories are never scanned.

| Field | Default | Purpose |
| --- | --- | --- |
| `enabled` | `true` | Enable automatic selection |
| `memoryDirs` | `[".pi/sieve/memories"]` | Markdown memory directories |
| `guideDirs` | `[".pi/sieve/guides"]` | Markdown guide directories |
| `pinnedSkills` | `[]` | Keep these skill names available |
| `pinnedTools` | `[]` | Keep these already enabled tools available |
| `model` | `jev-1.13.0` | Jev model identifier |
| `timeoutMs` | `1500` | Request deadline, including response reading |
| `maxCandidates` | `40` | Maximum candidates evaluated per request |
| `maxDocuments` | `6` | Maximum selected memories and guides combined |
| `contextChars` | `8000` | Character budget for injected references |
| `includeThreshold` | `0.5` | Minimum probability for unpinned documents |
| `excludeThreshold` | `0.2` | Skills/tools below this probability may be hidden |

Unknown fields or invalid values disable selection for that task. Keys and
custom endpoints are not accepted. Pinning never enables a tool that was already
disabled; mentioning an exact capability name in your input also keeps it available.

## Use and troubleshoot

Work normally in a project Pi trusts, then run `/sieve status` to inspect the last
selection. It reports counts, elapsed time, model version, and a fallback reason.

| Control | Effect |
| --- | --- |
| `/sieve status` | Inspect the last selection; `not_run` means no result yet |
| `/sieve off` | Stop automatic selection and release hidden tools |
| `/sieve on` | Enable selection for the next task |
| `sieve_search` | Main-model tool for local search and recovery of hidden tools |

On/off overrides last for the current session. If something seems missing, ask
the main model to use `sieve_search` with a query such as `payment retries`.
It makes no Jev request and never executes the commands it finds.

| Status or symptom | What to check |
| --- | --- |
| `/sieve` is unknown or TypeSafe is missing from `/login` | Check `pi list`, then reload Pi or enable the extension in `pi config` |
| Login says the key was saved but no default model is configured | TypeSafe provides selection only; configure your main-model provider and choose it with `/model` |
| `missing_key` | Run `/login typesafe`, or check that your configured credential can be resolved |
| `invalid_config` | Compare `.pi/sieve.json` with the example; remove unknown fields |
| `untrusted_project` | Review the project and use Pi's normal trust flow |
| `timeout`, `service_error`, `invalid_response` | Local fallback is active; check your key and TypeSafe service availability |
| `recovery_unavailable` | Your Pi tool allowlist must include `sieve_search` for automatic selection |
| A reference is skipped | Check its frontmatter and body; symlinks and files over 64 KiB are skipped |

## How selection works

At the start of each normal task, Sieve uses up to three verified raw user inputs
on the current branch and keyword-ranks candidate descriptions. One Jev batch
judges the shortlist. Selected reference bodies are temporarily added to the main
model's context; skills remain available through Pi's native on-demand loading.
Tool results do not trigger more Jev calls.

Existing built-in tools, pinned capabilities, and unjudged skills/tools stay
available. Missing credentials, request failures, or insufficient context fall
back to bounded local document matching and preserve the original capabilities.
There are no automatic retries. New input releases hidden tools; completion,
reloads, and session changes clean up Sieve's state.

Sieve preserves unrelated tool additions and yields to detected restrictions from
other extensions. Pi does not expose ownership for every tool-set change, so avoid
multiple extensions independently controlling the same tools. Sieve does not
approve shell commands or bypass permissions.

## Preliminary benchmark

Payments pilot on 2026-09-21: one five-stage workflow per arm, using Astra or Luna
with medium reasoning. All 10 Jev selections succeeded with a **10-second benchmark
timeout** (the plugin default is 1.5 seconds). These small-sample observations do
not establish general speed or accuracy gains; token counts are not monetary costs.

![Pilot comparison of workflow time, independent check pass rates, and main-model token usage](https://raw.githubusercontent.com/yoonshilee/pi-sieve-bench/1cfe86bbe1a4970683107688727661af6b02e5f8/reports/pilot-20260921-jev10s/benchmark.png)

See [Pi Sieve Bench](https://github.com/yoonshilee/pi-sieve-bench#results) for the
complete experimental setup, detailed results, failure analysis, and downloadable data.

## Development and license

See [CONTRIBUTING.md](CONTRIBUTING.md) for the file map, tests, evaluation, and
commit checks, and [PRIVACY.md](PRIVACY.md) for exact data boundaries.

References: [Pi extensions](https://pi.dev/docs/latest/extensions),
[TypeSafe API](https://docs.typesafe.ai/api),
[Jev models](https://docs.typesafe.ai/models).

Licensed under [Apache-2.0](LICENSE). This is an independent project, not an
official Pi or TypeSafe product.
