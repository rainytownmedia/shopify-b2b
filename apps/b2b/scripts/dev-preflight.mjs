import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const MIN_SUPPORTED = [20, 19, 0];
const ALT_SUPPORTED_MAJOR = 22;
const ALT_SUPPORTED_MIN = [22, 12, 0];

function parseVersion(raw) {
  const clean = raw.replace(/^v/, "");
  const [major = "0", minor = "0", patch = "0"] = clean.split(".");
  return [Number(major), Number(minor), Number(patch)];
}

function cmp(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

function isNodeSupported(rawVersion) {
  const v = parseVersion(rawVersion);
  const [major] = v;
  if (major === 20) return cmp(v, MIN_SUPPORTED) >= 0;
  if (major === ALT_SUPPORTED_MAJOR) return cmp(v, ALT_SUPPORTED_MIN) >= 0;
  return major > ALT_SUPPORTED_MAJOR;
}

function resolveStore() {
  return (
    process.env.SHOPIFY_DEV_STORE ||
    process.env.SHOPIFY_FLAG_STORE ||
    process.env.SHOPIFY_STORE ||
    ""
  ).trim();
}

function resolveConfigPath() {
  return (process.env.SHOPIFY_DEV_CONFIG || "shopify.app.toml").trim();
}

async function ensureFileExists(targetPath) {
  await access(targetPath, fsConstants.R_OK);
}

function runShopifyVersionCheck() {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["shopify", "version"], {
      stdio: "pipe",
      shell: false,
      env: process.env,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(out.trim() || "shopify-cli: ok");
        return;
      }
      reject(
        new Error(
          `shopify CLI check failed with exit code ${code}\n${(err || out).trim()}`
        )
      );
    });
  });
}

export async function runPreflight({
  skipCliCheck = false,
  cwd = process.cwd(),
} = {}) {
  if (!isNodeSupported(process.version)) {
    throw new Error(
      `Unsupported Node ${process.version}. This app requires >=20.19 <22 or >=22.12.`
    );
  }

  const store = resolveStore();
  if (!store) {
    throw new Error(
      "Missing dev store. Set SHOPIFY_DEV_STORE (or SHOPIFY_STORE) before running dev."
    );
  }

  const configPath = resolveConfigPath();
  const absoluteConfig = path.resolve(cwd, configPath);
  await ensureFileExists(absoluteConfig);

  if (!skipCliCheck) {
    await runShopifyVersionCheck();
  }

  return {
    store,
    configPath,
    absoluteConfig,
    nodeVersion: process.version,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const skipCliCheck = process.argv.includes("--skip-cli-check");
  try {
    const result = await runPreflight({ skipCliCheck });
    console.log(
      [
        "[dev-preflight] ok",
        `node=${result.nodeVersion}`,
        `config=${result.configPath}`,
        `store=${result.store}`,
      ].join(" | ")
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[dev-preflight] failed: ${message}`);
    process.exit(1);
  }
}
