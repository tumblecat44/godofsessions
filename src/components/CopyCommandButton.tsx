import { useState } from "react";
import { Button } from "./ui/Button";

export function CopyCommandButton({ command, language }: { command: string; language: "en" | "ko" }) {
  const [copied, setCopied] = useState(false);
  const ko = language === "ko";
  return (
    <Button
      size="sm"
      aria-label={ko ? `${command} 복사` : `Copy ${command}`}
      onClick={() => {
        void navigator.clipboard.writeText(command).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }).catch(() => undefined);
      }}
    >
      {copied ? (ko ? "복사됨" : "Copied") : (ko ? "명령 복사" : "Copy command")}
    </Button>
  );
}
