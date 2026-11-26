import { spawnSync } from "node:child_process";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parsePackManifest,
  resolvePackageManagerInvocation,
  verifyReleaseArtifact,
  writeReleaseArtifactManifest,
} from "./lib/release-artifact.mjs";

// The published package must stay loadable on the minimum supported Node version, so packing is
// not restricted to the Node 24 release-build major.
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 18)) {
  console.error(
    `Release packages must be built and packed on Node >=22.18.0; received Node ${process.versions.node}.`,
  );
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const outputArg = process.argv[2];
if (!outputArg) {
  console.error("Usage: node scripts/pack-release-package.mjs <empty-artifact-directory>");
  process.exit(1);
}

const artifactDir = path.resolve(repoRoot, outputArg);
await mkdir(artifactDir, { recursive: true });
const existingFiles = await readdir(artifactDir);
if (existingFiles.length > 0) {
  console.error(`Release artifact directory must be empty: ${artifactDir}`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  return result.stdout;
}

const pnpm = resolvePackageManagerInvocation("pnpm");
const packJson = run(pnpm.command, [
  ...pnpm.args,
  "--config.ignore-scripts=true",
  "pack",
  "--json",
  "--pack-destination",
  artifactDir,
]);
const packManifestPath = path.join(artifactDir, "pack-manifest.json");

try {
  await writeFile(packManifestPath, packJson, "utf8");
  const contentsCheck = spawnSync(
    process.execPath,
    ["scripts/verify-package-contents.mjs", packManifestPath],
    { cwd: repoRoot, stdio: "inherit" },
  );
  if (contentsCheck.error) throw contentsCheck.error;
  if (contentsCheck.status !== 0) process.exit(contentsCheck.status ?? 1);

  const tarballs = (await readdir(artifactDir)).filter((file) => file.endsWith(".tgz"));
  if (tarballs.length !== 1) {
    throw new Error(`Expected exactly one release tarball; found ${tarballs.length}.`);
  }

  const packManifest = parsePackManifest(packJson);
  const packedFilename = path.basename(packManifest.filename ?? "");
  if (!packedFilename || packedFilename !== tarballs[0]) {
    throw new Error(
      `pnpm pack reported ${packManifest.filename ?? "no filename"}, but created ${tarballs[0]}.`,
    );
  }

  const tarballPath = path.join(artifactDir, tarballs[0]);
  await writeReleaseArtifactManifest(artifactDir, tarballPath);
  const artifact = await verifyReleaseArtifact(artifactDir);
  console.log(`Release artifact created once: ${artifact.filename} (sha256 ${artifact.sha256}).`);
} finally {
  await rm(packManifestPath, { force: true });
}
