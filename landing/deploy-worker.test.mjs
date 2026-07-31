import assert from "node:assert/strict";
import test from "node:test";

import worker from "./deploy-worker.js";

function environment() {
  const assetRequests = [];
  return {
    assetRequests,
    env: {
      MACOS_DOWNLOAD_URL:
        "https://github.com/example/sessions/releases/latest/download/God-of-Sessions_universal.dmg",
      ASSETS: {
        fetch(request) {
          assetRequests.push(request.url);
          return Promise.resolve(new Response("asset", { status: 200 }));
        },
      },
    },
  };
}

test("redirects the stable Mac route to the latest signed release", async () => {
  const { env } = environment();
  const response = await worker.fetch(
    new Request("https://sessions.example.com/download/mac"),
    env,
  );

  assert.equal(response.status, 302);
  assert.equal(
    response.headers.get("Location"),
    env.MACOS_DOWNLOAD_URL,
  );
});

test("keeps the currently published Mac download path working", async () => {
  const { env } = environment();
  const response = await worker.fetch(
    new Request(
      "https://sessions.example.com/downloads/God-of-Sessions_0.1.0_aarch64.dmg",
    ),
    env,
  );

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), env.MACOS_DOWNLOAD_URL);
});

test("fails closed when the release download URL is invalid", async () => {
  const { env } = environment();
  env.MACOS_DOWNLOAD_URL = "http://downloads.example.com/unsigned.dmg";

  const response = await worker.fetch(
    new Request("https://sessions.example.com/download/mac"),
    env,
  );

  assert.equal(response.status, 503);
});

test("delegates every other request to static assets", async () => {
  const { env, assetRequests } = environment();
  const request = new Request("https://sessions.example.com/docs");
  const response = await worker.fetch(request, env);

  assert.equal(response.status, 200);
  assert.deepEqual(assetRequests, [request.url]);
});
