import type { AppLanguage, AppPreferences } from "../types";

const STORAGE_KEY = "morrow.preferences.v1";

function defaultLanguage(): AppLanguage {
  return typeof navigator !== "undefined" &&
    navigator.language.toLowerCase().startsWith("ko")
    ? "ko"
    : "en";
}

export function defaultPreferences(): AppPreferences {
  return {
    language: defaultLanguage(),
    default_chat_provider: "codex_subscription",
    default_chat_models: {},
    default_chat_efforts: {},
    default_overnight_hours: 7,
    onboarding_complete: false,
  };
}

export function loadPreferences(): AppPreferences {
  const fallback = defaultPreferences();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored) as Partial<AppPreferences>;
    return {
      language: parsed.language === "ko" ? "ko" : "en",
      default_chat_provider:
        parsed.default_chat_provider === "claude_subscription"
          ? "claude_subscription"
          : "codex_subscription",
      default_chat_models:
        parsed.default_chat_models &&
        typeof parsed.default_chat_models === "object"
          ? parsed.default_chat_models
          : {},
      default_chat_efforts:
        parsed.default_chat_efforts &&
        typeof parsed.default_chat_efforts === "object"
          ? parsed.default_chat_efforts
          : {},
      default_overnight_hours:
        typeof parsed.default_overnight_hours === "number" &&
        parsed.default_overnight_hours >= 1 &&
        parsed.default_overnight_hours <= 16
          ? parsed.default_overnight_hours
          : fallback.default_overnight_hours,
      onboarding_complete: parsed.onboarding_complete === true,
    };
  } catch {
    return fallback;
  }
}

export function savePreferences(preferences: AppPreferences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  document.documentElement.lang = preferences.language;
}
