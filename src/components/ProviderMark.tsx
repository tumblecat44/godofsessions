import { providerMarks, providerNames } from "../lib/format";
import type { Provider } from "../types";

interface ProviderMarkProps {
  provider: Provider;
  showName?: boolean;
}

export function ProviderMark({
  provider,
  showName = false,
}: ProviderMarkProps) {
  return (
    <span className="provider-mark-wrap">
      <span className={`provider-mark provider-mark--${provider}`}>
        {providerMarks[provider]}
      </span>
      {showName && <span>{providerNames[provider]}</span>}
    </span>
  );
}
