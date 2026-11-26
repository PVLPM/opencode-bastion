import { spawnSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parsePackManifest, resolvePackageManagerInvocation } from "./lib/release-artifact.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const manifestPath = process.argv[2];

let rawManifest;
if (manifestPath) {
  rawManifest = await readFile(path.resolve(repoRoot, manifestPath), "utf8");
} else {
  const pnpm = resolvePackageManagerInvocation("pnpm");
  const result = spawnSync(
    pnpm.command,
    [...pnpm.args, "--config.ignore-scripts=true", "pack", "--json", "--dry-run"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  rawManifest = result.stdout;
}

const manifest = parsePackManifest(rawManifest);
const files = manifest.files.map((entry) => entry.path).sort();

// Strict allowlist: anything else — source maps, src, docs, preview, scripts, test, .github or
// any future build output — is a packaging regression, not an acceptable extra.
const allowedFiles = ["LICENSE", "README.md", "dist/gui-experimental.cjs", "package.json"];
const unexpected = files.filter((file) => !allowedFiles.includes(file));
const missing = allowedFiles.filter((file) => !files.includes(file));
if (unexpected.length > 0 || missing.length > 0) {
  console.error("npm package does not match the strict release allowlist:");
  for (const file of unexpected) console.error(`- unexpected: ${file}`);
  for (const file of missing) console.error(`- missing: ${file}`);
  process.exit(1);
}

const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const problems = [];
if (packageJson.exports?.["./gui-experimental"]?.default !== "./dist/gui-experimental.cjs") {
  problems.push('exports["./gui-experimental"].default must be "./dist/gui-experimental.cjs"');
}
if (packageJson.peerDependencies?.["@opencode/plugin"] !== ">=2.4.0 <2.5.0") {
  problems.push('peerDependencies["@opencode/plugin"] must be ">=2.4.0 <2.5.0"');
}
if (packageJson.engines?.node !== ">=22.18.0") {
  problems.push('engines.node must be ">=22.18.0"');
}

const readme = await readFile(path.join(repoRoot, "README.md"), "utf8");
// The demo animation is a 7.18 MB WebP served from raw.githubusercontent.com; it must never be
// pulled into the package by a local image reference.
if (!readme.includes("agent-fleet.webp")) {
  problems.push("README.md must reference agent-fleet.webp");
}
if (readme.includes("agent-fleet.gif")) {
  problems.push("README.md must not reference agent-fleet.gif");
}

if (problems.length > 0) {
  console.error("npm package metadata is not release-ready:");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

// The dry-run manifest carries no tarball, so the size limit is enforced when a real pack
// manifest is supplied (pack-release-package.mjs always does).
if (manifestPath) {
  const artifactDir = path.dirname(path.resolve(repoRoot, manifestPath));
  const tarballs = (await readdir(artifactDir)).filter((file) => file.endsWith(".tgz"));
  if (tarballs.length !== 1) {
    console.error(`Expected exactly one .tgz beside the pack manifest; found ${tarballs.length}.`);
    process.exit(1);
  }
  const tarballSize = (await stat(path.join(artifactDir, tarballs[0]))).size;
  const limit = 1024 * 1024;
  if (tarballSize >= limit) {
    console.error(
      `Release tarball ${tarballs[0]} is ${tarballSize} bytes; the limit is ${limit} bytes (1 MiB).`,
    );
    process.exit(1);
  }
}

console.log(
  `npm contents verified: ${files.length} files (dist/gui-experimental.cjs plus package.json, README.md, and LICENSE) with no source maps or build-only assets.`,
);
