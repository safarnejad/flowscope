#!/usr/bin/env bun
// Records the README's tour GIF (docs/img/tour.gif) from the made-up demo tree, never from real transcripts:
// home, a live workflow's board, an agent's result and transcript, the timeline, and a batch of CLI runs.
//
//   bun scripts/tour.ts            needs ffmpeg and the dev dependencies (bun install; bunx playwright install chromium)
import { chromium, type Page } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { makeDemo } from "./demo";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "docs/img/tour.gif");
const PORT = 4795, BASE = `http://127.0.0.1:${PORT}`;
const W = 1280, H = 760;

const dir = mkdtempSync(join(tmpdir(), "flowscope-tour-"));
makeDemo(join(dir, "data"));
const srv = spawn("bun", ["server.ts", "--foreground", "--port", String(PORT)], {
  cwd: ROOT, stdio: "ignore",
  env: { ...process.env, CLAUDE_PROJECTS_DIR: join(dir, "data/claude"), CODEX_SESSIONS_DIR: join(dir, "data/codex"), FLOWSCOPE_CACHE: join(dir, "cache") },
});

try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + "/api/pid")).ok) break; } catch {} await Bun.sleep(100); }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: "light", recordVideo: { dir, size: { width: W, height: H } } });
  const page = await ctx.newPage();
  await tour(page);
  await ctx.close(); await browser.close();
  const video = join(dir, readdirSync(dir).find((f) => f.endsWith(".webm"))!);
  // Two passes: a palette made from the clip, then the GIF drawn with it, so text stays crisp.
  const vf = "fps=12,scale=960:-1:flags=lanczos";
  const ff = (args: string[]) => { const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" }); if (r.status) throw new Error("ffmpeg failed"); };
  ff(["-ss", "0.6", "-i", video, "-vf", `${vf},palettegen=stats_mode=diff`, join(dir, "pal.png")]);
  ff(["-ss", "0.6", "-i", video, "-i", join(dir, "pal.png"), "-lavfi", `${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, OUT]);
  console.log(`wrote ${OUT}`);
} finally {
  srv.kill(); rmSync(dir, { recursive: true, force: true });
}

async function tour(page: Page) {
  const pause = (s: number) => page.waitForTimeout(s * 1000);
  await page.goto(BASE + "/");
  await page.locator("#runs .run").first().waitFor();
  await pause(2);
  await page.locator("#runs .run", { hasText: "money-migration" }).click();
  await page.locator(".phase h3").first().waitFor();
  await pause(2.5);
  await page.locator(".card", { hasText: "packages/inventory" }).click();
  await pause(2);
  await page.locator(".dtabs button", { hasText: "Transcript" }).click();
  await pause(2.5);
  await page.keyboard.press("Escape");
  await pause(0.6);
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await pause(2.5);
  await page.locator("#filters button", { hasText: "CLI" }).click();
  await page.locator("#runs .run", { hasText: "Claude ×40" }).click();
  await page.locator("#main header h2", { hasText: "Claude ×40" }).waitFor();
  await pause(3);
}
