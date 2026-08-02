import type {
  AppLanguage,
  AppPreferences,
  ChatProvider,
  SubscriptionPlanOverrides,
  SubscriptionPlanTier,
} from "../types";

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
    subscription_plan_tiers: {},
    default_overnight_hours: 7,
    onboarding_complete: false,
    share_anonymous_usage_data: true,
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
      subscription_plan_tiers: validPlanTiers(
        parsed.subscription_plan_tiers,
      ),
      default_overnight_hours:
        typeof parsed.default_overnight_hours === "number" &&
        parsed.default_overnight_hours >= 1 &&
        parsed.default_overnight_hours <= 16
          ? parsed.default_overnight_hours
          : fallback.default_overnight_hours,
      onboarding_complete: parsed.onboarding_complete === true,
      share_anonymous_usage_data:
        typeof parsed.share_anonymous_usage_data === "boolean"
          ? parsed.share_anonymous_usage_data
          : parsed.onboarding_complete === true
            ? false
            : fallback.share_anonymous_usage_data,
    };
  } catch {
    return fallback;
  }
}

function validPlanTiers(
  value: AppPreferences["subscription_plan_tiers"] | undefined,
): AppPreferences["subscription_plan_tiers"] {
  if (!value || typeof value !== "object") return {};
  const valid = new Set<SubscriptionPlanTier>([
    "claude_pro",
    "claude_max5x",
    "claude_max20x",
    "codex_plus",
    "codex_pro5x",
    "codex_pro20x",
  ]);
  const result: Partial<Record<ChatProvider, SubscriptionPlanTier>> = {};
  for (const provider of [
    "claude_subscription",
    "codex_subscription",
  ] as ChatProvider[]) {
    const tier = value[provider];
    if (tier && valid.has(tier)) result[provider] = tier;
  }
  return result;
}

export function planOverrides(
  preferences: AppPreferences,
): SubscriptionPlanOverrides {
  return {
    claude:
      preferences.subscription_plan_tiers.claude_subscription ?? null,
    codex: preferences.subscription_plan_tiers.codex_subscription ?? null,
  };
}

export function savePreferences(preferences: AppPreferences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  document.documentElement.lang = preferences.language;
}
