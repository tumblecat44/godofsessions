const DMG_PATH =
  "/downloads/God-of-Sessions_0.1.0_universal-20260728.dmg";
const APP_EVENTS = new Set([
  "app_first_opened",
  "app_opened",
  "onboarding_completed",
  "sessions_indexed",
]);
const PLATFORMS = new Set(["macos", "windows", "linux", "unknown"]);
const INSTALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_ORIGINS = new Set([
  "tauri://localhost",
  "https://tauri.localhost",
  "http://tauri.localhost",
  "http://localhost:1420",
]);

function country(request) {
  const value = request.cf?.country;
  return typeof value === "string" && /^[A-Z]{2}$/.test(value)
    ? value
    : "XX";
}

function record(env, request, event, source, dimensions = {}) {
  return env.METRICS.prepare(
    `INSERT INTO product_events
      (event, source, install_id, app_version, platform, country)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      event,
      source,
      dimensions.installId ?? null,
      dimensions.appVersion ?? "unknown",
      dimensions.platform ?? "unknown",
      country(request),
    )
    .run();
}

function recordInBackground(context, promise) {
  const guarded = promise.catch(() => undefined);
  if (context?.waitUntil) context.waitUntil(guarded);
}

function allowedOrigin(request) {
  const origin = request.headers.get("Origin");
  return origin && APP_ORIGINS.has(origin) ? origin : null;
}

function corsHeaders(request) {
  const origin = allowedOrigin(request);
  return origin
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      }
    : {};
}

export function parseAppEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.some(
      (key) =>
        !["event", "install_id", "app_version", "platform"].includes(key),
    )
  ) {
    return null;
  }
  if (
    !APP_EVENTS.has(value.event) ||
    typeof value.install_id !== "string" ||
    !INSTALL_ID.test(value.install_id) ||
    typeof value.app_version !== "string" ||
    !/^[0-9A-Za-z.+-]{1,32}$/.test(value.app_version) ||
    !PLATFORMS.has(value.platform)
  ) {
    return null;
  }
  return {
    event: value.event,
    installId: value.install_id,
    appVersion: value.app_version,
    platform: value.platform,
  };
}

async function receiveAppEvent(request, env, context) {
  if (!allowedOrigin(request)) {
    return new Response("Origin not allowed", { status: 403 });
  }
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (length > 1024) return new Response("Payload too large", { status: 413 });

  let payload;
  try {
    const body = await request.text();
    if (body.length > 1024) {
      return new Response("Payload too large", { status: 413 });
    }
    payload = parseAppEvent(JSON.parse(body));
  } catch {
    payload = null;
  }
  if (!payload) return new Response("Invalid event", { status: 400 });

  recordInBackground(
    context,
    record(env, request, payload.event, "desktop", payload),
  );
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);

    if (url.pathname === "/api/events" && request.method === "OPTIONS") {
      return new Response(null, {
        status: allowedOrigin(request) ? 204 : 403,
        headers: corsHeaders(request),
      });
    }
    if (url.pathname === "/api/events" && request.method === "POST") {
      return receiveAppEvent(request, env, context);
    }
    if (url.pathname === "/download/mac" && request.method === "GET") {
      recordInBackground(
        context,
        record(env, request, "download_clicked", "landing"),
      );
      return Response.redirect(new URL(DMG_PATH, request.url), 302);
    }
    if (url.pathname === DMG_PATH && request.method === "GET") {
      const response = await env.ASSETS.fetch(request);
      if (response.ok && !request.headers.has("Range")) {
        recordInBackground(
          context,
          record(env, request, "download_served", "landing"),
        );
      }
      return response;
    }
    if (url.pathname === "/" && request.method === "GET") {
      recordInBackground(context, record(env, request, "page_view", "landing"));
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(_controller, env, context) {
    recordInBackground(
      context,
      env.METRICS.prepare(
        "DELETE FROM product_events WHERE occurred_at < unixepoch('now', '-180 days')",
      ).run(),
    );
  },
};
