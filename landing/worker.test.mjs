import assert from "node:assert/strict";
import test from "node:test";

import worker, { parseAppEvent } from "./worker.js";

const installId = "018f1f3e-7b5d-4d8c-8a01-0123456789ab";

function environment() {
  const points = [];
  const pending = [];
  return {
    points,
    context: {
      waitUntil(promise) {
        pending.push(promise);
      },
    },
    flush() {
      return Promise.all(pending);
    },
    env: {
      METRICS: {
        prepare(sql) {
          const statement = {
            run() {
              points.push({ sql, values: [] });
              return Promise.resolve();
            },
            bind(...values) {
              return {
                run() {
                  points.push({ sql, values });
                  return Promise.resolve();
                },
              };
            },
          };
          return statement;
        },
      },
      ASSETS: {
        fetch() {
          return Promise.resolve(new Response("asset", { status: 200 }));
        },
      },
    },
  };
}

test("accepts only the documented anonymous app schema", () => {
  assert.deepEqual(
    parseAppEvent({
      event: "app_opened",
      install_id: installId,
      app_version: "0.1.0",
      platform: "macos",
    }),
    {
      event: "app_opened",
      installId,
      appVersion: "0.1.0",
      platform: "macos",
    },
  );
  assert.equal(
    parseAppEvent({
      event: "app_opened",
      install_id: installId,
      app_version: "0.1.0",
      platform: "macos",
      repository: "/Users/example/project",
    }),
    null,
  );
  assert.equal(
    parseAppEvent({
      event: "prompt_sent",
      install_id: installId,
      app_version: "0.1.0",
      platform: "macos",
    }),
    null,
  );
});

test("records a valid desktop event without request content", async () => {
  const { env, context, flush, points } = environment();
  const response = await worker.fetch(
    new Request("https://morrow.vibejason.com/api/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "tauri://localhost",
      },
      body: JSON.stringify({
        event: "app_first_opened",
        install_id: installId,
        app_version: "0.1.0",
        platform: "macos",
      }),
    }),
    env,
    context,
  );
  await flush();

  assert.equal(response.status, 204);
  assert.equal(points.length, 1);
  assert.deepEqual(points[0].values.slice(0, 5), [
    "app_first_opened",
    "desktop",
    installId,
    "0.1.0",
    "macos",
  ]);
});

test("rejects an oversized body even without a content-length header", async () => {
  const { env, context, points } = environment();
  const response = await worker.fetch(
    new Request("https://morrow.vibejason.com/api/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "tauri://localhost",
      },
      body: JSON.stringify({
        event: "app_opened",
        install_id: installId,
        app_version: "0.1.0",
        platform: "macos",
        padding: "x".repeat(1500),
      }),
    }),
    env,
    context,
  );

  assert.equal(response.status, 413);
  assert.equal(points.length, 0);
});

test("counts download redirects and successful full artifact responses", async () => {
  const { env, context, flush, points } = environment();
  const redirect = await worker.fetch(
    new Request("https://morrow.vibejason.com/download/mac"),
    env,
    context,
  );
  assert.equal(redirect.status, 302);
  assert.equal(
    redirect.headers.get("Location"),
    "https://morrow.vibejason.com/downloads/God-of-Sessions_0.1.0_universal-20260728.dmg",
  );

  const artifact = await worker.fetch(
    new Request(
      "https://morrow.vibejason.com/downloads/God-of-Sessions_0.1.0_universal-20260728.dmg",
    ),
    env,
    context,
  );
  await flush();
  assert.equal(artifact.status, 200);
  assert.deepEqual(
    points.map((point) => point.values[0]),
    ["download_clicked", "download_served"],
  );
});

test("scheduled cleanup removes events older than 180 days", async () => {
  const { env, context, flush, points } = environment();
  await worker.scheduled({}, env, context);
  await flush();
  assert.equal(points.length, 1);
  assert.match(points[0].sql, /-180 days/);
});
