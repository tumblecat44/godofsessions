import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppPreferences } from "../types";

type TelemetryEvent =
  | "app_first_opened"
  | "app_opened"
  | "onboarding_completed"
  | "sessions_indexed";

interface TelemetryContext {
  enabled: boolean;
  app_version: string;
}

const ENDPOINT = "https://morrow.vibejason.com/api/events";
const INSTALL_ID_KEY = "morrow.telemetry.install-id.v1";
const SENT_KEY_PREFIX = "morrow.telemetry.sent.v1.";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let contextPromise: Promise<TelemetryContext> | null = null;

function installId() {
  const stored = localStorage.getItem(INSTALL_ID_KEY);
  if (stored && UUID.test(stored)) return stored;
  const created = crypto.randomUUID();
  localStorage.setItem(INSTALL_ID_KEY, created);
  return created;
}

function platform() {
  const agent = navigator.userAgent.toLowerCase();
  if (agent.includes("mac")) return "macos";
  if (agent.includes("win")) return "windows";
  if (agent.includes("linux")) return "linux";
  return "unknown";
}

function telemetryContext() {
  if (!contextPromise) {
    contextPromise = invoke<TelemetryContext>("load_telemetry_context");
  }
  return contextPromise;
}

async function send(
  event: TelemetryEvent,
  preferences: AppPreferences,
): Promise<boolean> {
  if (
    !isTauri() ||
    !preferences.share_anonymous_usage_data ||
    navigator.doNotTrack === "1"
  ) {
    return false;
  }

  try {
    const context = await telemetryContext();
    if (!context.enabled) return false;
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        install_id: installId(),
        app_version: context.app_version,
        platform: platform(),
      }),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      keepalive: true,
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function trackAppOpened(preferences: AppPreferences) {
  const firstOpenKey = `${SENT_KEY_PREFIX}app_first_opened`;
  if (!localStorage.getItem(firstOpenKey)) {
    if (await send("app_first_opened", preferences)) {
      localStorage.setItem(firstOpenKey, "1");
    }
  }
  await send("app_opened", preferences);
}

export async function trackOnce(
  event: "onboarding_completed" | "sessions_indexed",
  preferences: AppPreferences,
) {
  const key = `${SENT_KEY_PREFIX}${event}`;
  if (localStorage.getItem(key)) return;
  if (await send(event, preferences)) {
    localStorage.setItem(key, "1");
  }
}
