import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const WORKER_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DOMAIN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function requireMatch(value, expression, environmentName) {
  if (typeof value !== "string" || !expression.test(value)) {
    throw new Error(
      `${environmentName} is missing or has an unsupported format.`,
    );
  }
  return value;
}

function requireHttpsUrl(value, environmentName) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `${environmentName} is missing or has an unsupported format.`,
    );
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new Error(
      `${environmentName} is missing or has an unsupported format.`,
    );
  }
  return parsed.href;
}

export function createCloudflareConfig({
  workerName,
  customDomain,
  macosDownloadUrl,
}) {
  const name = requireMatch(
    workerName,
    WORKER_NAME,
    "CLOUDFLARE_WORKER_NAME",
  );
  const domain = requireMatch(
    customDomain,
    DOMAIN,
    "CLOUDFLARE_CUSTOM_DOMAIN",
  );
  const downloadUrl = requireHttpsUrl(
    macosDownloadUrl,
    "MACOS_DOWNLOAD_URL",
  );

  return {
    $schema:
      "https://developers.cloudflare.com/workers/wrangler/config-schema.json",
    name,
    main: "landing/deploy-worker.js",
    compatibility_date: "2026-07-28",
    routes: [{ pattern: domain, custom_domain: true }],
    assets: {
      directory: "landing/dist",
      binding: "ASSETS",
      run_worker_first: [
        "/download/*",
        "/downloads/God-of-Sessions_0.1.0_aarch64.dmg",
      ],
    },
    vars: {
      MACOS_DOWNLOAD_URL: downloadUrl,
    },
    observability: {
      enabled: true,
    },
  };
}

export function deploymentFromEnvironment(environment = process.env) {
  return {
    workerName: environment.CLOUDFLARE_WORKER_NAME,
    customDomain: environment.CLOUDFLARE_CUSTOM_DOMAIN,
    macosDownloadUrl: environment.MACOS_DOWNLOAD_URL,
  };
}

export async function writeCloudflareConfig(outputPath, deployment) {
  if (typeof outputPath !== "string" || outputPath.trim() === "") {
    throw new Error("CLOUDFLARE_CONFIG_PATH is required.");
  }

  const config = createCloudflareConfig(deployment);
  await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(outputPath, 0o600);
}

async function main() {
  await writeCloudflareConfig(
    process.env.CLOUDFLARE_CONFIG_PATH,
    deploymentFromEnvironment(),
  );
  process.stdout.write("Cloudflare deployment config generated.\n");
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (import.meta.url === invokedPath) {
  await main();
}
