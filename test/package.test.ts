import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

test("the packed package loads through Pi's extension loader", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "sieve-package-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const pack = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", cwd], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  execFileSync("tar", ["-xzf", join(cwd, pack[0].filename), "-C", cwd]);
  const agentDir = join(cwd, "agent");
  await mkdir(agentDir);
  const loader = new DefaultResourceLoader({ cwd, agentDir,
    settingsManager: SettingsManager.inMemory({}, { projectTrusted: true }),
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    additionalExtensionPaths: [join(cwd, "package")],
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  assert(loaded.extensions[0].tools.has("sieve_search"));
  assert(loaded.extensions[0].tools.has("sieve_score"));
  assert(loaded.extensions[0].commands.has("sieve"));
});
