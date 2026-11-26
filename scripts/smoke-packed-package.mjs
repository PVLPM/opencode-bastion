import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolvePackageManagerInvocation, verifyReleaseArtifact } from "./lib/release-artifact.mjs";

const inputPath = path.resolve(process.argv[2] ?? "package-artifacts");
const [nodeMajor] = process.versions.node.split(".").map(Number);

if (nodeMajor !== 22 && nodeMajor !== 24) {
  console.error(
    `Packed runtime smoke requires Node 22 or 24; received Node ${process.versions.node}.`,
  );
  process.exit(1);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_cache: path.join(cwd, ".npm-cache"),
      npm_config_fund: "false",
      npm_config_update_notifier: "false",
    },
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  return result.stdout;
}

async function listFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(target)));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

const artifact = await verifyReleaseArtifact(inputPath);
const tarballSize = (await stat(artifact.tarballPath)).size;
const sizeLimit = 1024 * 1024;
assert.ok(
  tarballSize < sizeLimit,
  `${artifact.filename} is ${tarballSize} bytes; the limit is ${sizeLimit} bytes (1 MiB).`,
);

const rootPackage = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const solidVersion = rootPackage.devDependencies?.["solid-js"];
assert.ok(solidVersion, "package.json must pin solid-js for the host-shaped smoke.");

const npm = resolvePackageManagerInvocation("npm");
const workdir = await mkdtemp(path.join(tmpdir(), "opencode-bastion-package-smoke-"));

try {
  run(npm.command, [...npm.args, "init", "-y"], workdir);
  run(
    npm.command,
    [
      ...npm.args,
      "install",
      "--legacy-peer-deps",
      artifact.tarballPath,
      `solid-js@${solidVersion}`,
    ],
    workdir,
  );

  // OpenCode Desktop supplies @opencode/plugin/gui at runtime; the published 2.4.1 package only
  // exposes its ESM entry, so a plain Node require of the packed CJS needs this host-shaped stub.
  const stubDir = path.join(workdir, "node_modules", "@opencode", "plugin");
  await mkdir(stubDir, { recursive: true });
  await writeFile(
    path.join(stubDir, "package.json"),
    `${JSON.stringify(
      {
        name: "@opencode/plugin",
        version: "2.4.1",
        exports: { "./gui": "./gui.cjs" },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(stubDir, "gui.cjs"),
    `exports.Plugin = { define: (definition) => definition };
exports.Style = "Style";
exports.ComposerPill = "ComposerPill";
exports.Panel = "Panel";
exports.MenuItem = "MenuItem";
exports.Command = "Command";
exports.usePanel = () => ({ visible: () => false });
`,
    "utf8",
  );

  const installedDir = path.join(workdir, "node_modules", "opencode-bastion");
  const packedPackage = JSON.parse(await readFile(path.join(installedDir, "package.json"), "utf8"));
  assert.equal(packedPackage.name, "opencode-bastion");
  assert.equal(packedPackage.version, rootPackage.version);
  assert.equal(packedPackage.peerDependencies?.["@opencode/plugin"], ">=2.4.0 <2.5.0");
  assert.equal(packedPackage.engines?.node, ">=22.18.0");
  assert.equal(
    packedPackage.exports?.["./gui-experimental"]?.default,
    "./dist/gui-experimental.cjs",
  );
  assert.deepEqual(packedPackage.files, ["dist/gui-experimental.cjs", "LICENSE", "README.md"]);

  const packedReadme = await readFile(path.join(installedDir, "README.md"), "utf8");
  assert.ok(packedReadme.includes("agent-fleet.webp"));
  assert.ok(!packedReadme.includes("agent-fleet.gif"));

  const installedFiles = await listFiles(installedDir);
  assert.deepEqual(
    installedFiles.filter((file) => file.endsWith(".map")),
    [],
    "The packed package must not contain source maps.",
  );

  // This is a packaging/load smoke, not the real Desktop runtime. The host resolves solid-js to
  // its client build and provides a DOM; Node's default "node" condition selects the server build
  // (whose template setup throws) and Solid's compiled output touches window.document at load.
  const loadCheck = `
    const assert = require("node:assert/strict");
    globalThis.window = { document: { addEventListener() {}, removeEventListener() {} } };
    globalThis.document = globalThis.window.document;
    const exported = require("opencode-bastion/gui-experimental");
    assert.equal(typeof exported.default.setup, "function");
  `;
  run(process.execPath, ["--conditions=browser", "--eval", loadCheck], workdir);

  console.log(
    `Packed package smoke passed for ${artifact.filename} on Node ${process.versions.node} with solid-js ${solidVersion} and a host-shaped @opencode/plugin stub (sha256 ${artifact.sha256}).`,
  );
} finally {
  await rm(workdir, { recursive: true, force: true });
}
