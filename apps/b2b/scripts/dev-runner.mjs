import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { runPreflight } from "./dev-preflight.mjs";

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2000, 5000];
const TRANSIENT_PATTERNS = [
  /FetchError:\s*request to .*\/app_dev\/unstable\/graphql\.json failed/i,
  /request to .*myshopify\.com.*failed/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /EAI_AGAIN/i,
  /socket hang up/i,
  /connect tunnel failed/i,
];

function isTransientShopifyDevError(output) {
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(output));
}

function runOnce(configPath, store) {
  return new Promise((resolve, reject) => {
    const args = [
      "shopify",
      "app",
      "dev",
      "--config",
      configPath,
      "--store",
      store,
    ];
    const child = spawn("npx", args, {
      stdio: "pipe",
      shell: false,
      env: process.env,
    });
    let combinedOutput = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      combinedOutput += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      combinedOutput += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ code, signal, output: combinedOutput });
    });
  });
}

async function main() {
  const preflight = await runPreflight();
  let attempt = 0;

  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;
    if (attempt > 1) {
      console.warn(`[dev-runner] retry attempt ${attempt}/${MAX_ATTEMPTS}`);
    }

    const { code, signal, output } = await runOnce(
      preflight.configPath,
      preflight.store
    );

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    if (code === 0) {
      return;
    }

    const shouldRetry =
      attempt < MAX_ATTEMPTS && isTransientShopifyDevError(output);
    if (!shouldRetry) {
      process.exit(code ?? 1);
    }

    const retryDelay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
    console.warn(
      `[dev-runner] transient Shopify CLI error detected; retrying in ${retryDelay}ms`
    );
    await delay(retryDelay);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[dev-runner] failed: ${message}`);
  process.exit(1);
});
