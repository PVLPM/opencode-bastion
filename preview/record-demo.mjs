// One-command README recording: start Vite, record the ?demo=1 scene with
// Playwright, then encode the 24 fps WebP with ffmpeg. The scene itself lives
// in preview/demo; nothing here drives production code.
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { createServer } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const screens = path.join(here, ".screens", "demo");
const videoPath = path.join(screens, "agent-fleet.webm");
const timingPath = path.join(screens, "timing.json");
const webpPath = path.join(repo, "docs", "images", "agent-fleet.webp");
// The orchestrator is the first card, so its details stay in view at the
// shorter surface. The finished children are ordered newest-first, which puts
// Explorer last, where its details would be clipped.
const ORCHESTRATOR = "ses_demo_root";
// 770 px is the measured height that keeps all six cards and the Lanes dock
// visible at once: 6 + 32 + 493 + 237 + 2 borders.
const VIEWPORT = { width: 800, height: 830 };
// The 800×830 video leaves a 100 px side and 30 px vertical margin around the
// 600×770 surface. Crop to 640×800, leaving 20 px side / 15 px vertical.
const CROP = "crop=640:800:80:15";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${String(result.status)}`);
  }
}

async function fileSize(file) {
  const info = await stat(file);
  return `${(info.size / 1_000_000).toFixed(2)} MB`;
}

await rm(screens, { recursive: true, force: true });
await mkdir(screens, { recursive: true });
await mkdir(path.dirname(webpPath), { recursive: true });

const server = await createServer({
  configFile: path.join(here, "vite.config.ts"),
  root: here,
  server: { port: 5199, strictPort: true },
  logLevel: "warn",
});
await server.listen();

let browser;
const failures = [];
let startedAt = 0;
let pageCreatedAt = 0;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "no-preference",
    recordVideo: { dir: screens, size: VIEWPORT },
  });
  const page = await context.newPage();
  pageCreatedAt = Date.now();
  page.on("pageerror", (error) => {
    failures.push(`pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });

  await page.goto("http://localhost:5199/?demo=1", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__bastionDemo?.ready === true, undefined, {
    timeout: 15_000,
  });
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      inter: document.fonts.check("440 12px Inter"),
      manrope: document.fonts.check("440 12px Manrope"),
    };
  });
  if (!fonts.inter) throw new Error("Inter did not load for the demo.");

  // Six lanes need 22 + 6 × 28 = 190 px; one keyboard step opens 200 px.
  const separator = page.locator('[role="separator"][aria-label="Resize agent lanes"]');
  await separator.focus();
  await separator.press("ArrowUp");
  await page.waitForTimeout(350);
  const laneHeight = await page
    .locator(".bn-lanes__scroll")
    .evaluate((element) => element.getBoundingClientRect().height);
  if (laneHeight < 200) throw new Error(`Lanes did not expand (got ${laneHeight}px).`);

  startedAt = Date.now();
  await page.evaluate(() => window.__bastionDemo.start());

  // The finished state must be stable: the final verification opens a block
  // after the children finish and closes it once more.
  await page.waitForFunction(
    () => {
      const cards = [...document.querySelectorAll("[data-bn-card]")];
      const blocks = [...document.querySelectorAll("[data-bn-block]")];
      return (
        cards.length === 6 &&
        cards.every((card) => card.dataset.status === "done") &&
        blocks.length === 11 &&
        blocks.every((block) => block.dataset.live !== "true")
      );
    },
    undefined,
    { timeout: 40_000 },
  );
  await page.waitForTimeout(900);

  const more = page.locator(`[data-bn-card="${ORCHESTRATOR}"] [data-bn-more="true"]`);
  await more.click();
  await page.mouse.move(24, 24);
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(`[data-bn-card="${id}"] [data-bn-more="true"]`)
        ?.getAttribute("aria-expanded") === "true",
    ORCHESTRATOR,
  );
  await page
    .locator(`[data-bn-card="${ORCHESTRATOR}"] .bn-card__details`)
    .waitFor({ state: "visible" });
  await page.waitForTimeout(350);
  // The detail rows must be fully visible in the card list at this height.
  const fit = await page.evaluate((id) => {
    const details = document.querySelector(`[data-bn-card="${id}"] .bn-card__details`);
    const cards = document.querySelector(".bn-cards");
    if (!(details instanceof Element) || !(cards instanceof Element)) return null;
    const detailsBox = details.getBoundingClientRect();
    const cardsBox = cards.getBoundingClientRect();
    return {
      rows: details.querySelectorAll(".bn-dl__row").length,
      clearance: Math.round((cardsBox.bottom - detailsBox.bottom) * 10) / 10,
    };
  }, ORCHESTRATOR);
  if (fit === null) throw new Error("The expanded details could not be measured.");
  if (fit.clearance < 0) throw new Error(`Details clip by ${-fit.clearance}px.`);
  console.log(`details rows=${fit.rows}; clearance=${fit.clearance}px`);
  await page.waitForTimeout(2_600);
  await more.click();
  await page.mouse.move(24, 24);
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(`[data-bn-card="${id}"] [data-bn-more="true"]`)
        ?.getAttribute("aria-expanded") === "false",
    ORCHESTRATOR,
  );
  await page.waitForTimeout(900);
  await page.waitForFunction(() => window.__bastionDemo?.done === true, undefined, {
    timeout: 20_000,
  });
  // A beat of the finished panel, so the WebP does not end on the last frame of
  // the story.
  await page.waitForTimeout(800);

  const layout = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (element === null) return null;
      const box = element.getBoundingClientRect();
      return {
        height: Math.round(box.height * 10) / 10,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
      };
    };
    const cards = document.querySelector(".bn-cards");
    const lanes = document.querySelector(".bn-lanes");
    const all = [...document.querySelectorAll("[data-bn-card]")];
    const last = all[all.length - 1];
    return {
      surface: rect(".pv-demo__surface"),
      panel: rect(".bn-panel"),
      cards: rect(".bn-cards"),
      lanes: rect(".bn-lanes"),
      lastCard: last === undefined ? null : rect(`[data-bn-card="${last.dataset.bnCard}"]`),
      gap:
        last === undefined || cards === null || lanes === null
          ? null
          : Math.round(
              (lanes.getBoundingClientRect().top - last.getBoundingClientRect().bottom) * 10,
            ) / 10,
    };
  });
  console.log("layout", JSON.stringify(layout));

  if (failures.length > 0) throw new Error(failures.join("\n"));

  await writeFile(
    timingPath,
    JSON.stringify({ pageCreatedAt, startedAt, finishedAt: Date.now() }, null, 2),
  );
  const video = page.video();
  await page.close();
  await video.saveAs(videoPath);
} catch (error) {
  if (failures.length > 0) console.error(failures.join("\n"));
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await server.close();
}

const timing = JSON.parse(await readFile(timingPath, "utf8"));
const started = (timing.startedAt - timing.pageCreatedAt) / 1000;
const finished = (timing.finishedAt - timing.pageCreatedAt) / 1000;
// Start just before the first event, not at the top of the page load: the
// recording opens on the blank document for a moment.
const trim = Math.max(0, started - 0.2);
const end = Math.max(trim + 1, finished);
const duration = end - trim;

console.log(
  `video ${await fileSize(videoPath)}; trim ${trim.toFixed(2)}s; encode ${duration.toFixed(2)}s`,
);

// One pass: 24 fps, cropped to the panel surface, and q90 with millisecond
// frame timing. The flat margins cost almost nothing to encode; the crop is
// for the tighter README framing, not for size. q90 is the measured
// size/clarity point for the 12 px UI text.
const cut = `fps=24,trim=start=${trim.toFixed(3)}:end=${end.toFixed(3)},setpts=PTS-STARTPTS,${CROP}`;
run("ffmpeg", [
  "-y",
  "-i",
  videoPath,
  "-an",
  "-vf",
  cut,
  "-c:v",
  "libwebp_anim",
  "-quality",
  "90",
  "-compression_level",
  "6",
  "-loop",
  "0",
  webpPath,
]);

const probe = spawnSync(
  "ffprobe",
  [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,avg_frame_rate,nb_frames:format=duration,size",
    "-of",
    "json",
    webpPath,
  ],
  { encoding: "utf8" },
);
if (probe.status !== 0) throw new Error(probe.stderr);
console.log(probe.stdout.trim());
console.log(`webp ${await fileSize(webpPath)} at ${webpPath}`);
