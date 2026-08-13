import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function PromptBar(props: {
  disabled: boolean;
  error?: string;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const next = text.trim();
        if (!next || props.disabled) return;
        props.onSubmit(next);
        setText("");
      }}
    >
      <Textarea
        aria-label="Prompt"
        disabled={props.disabled}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <Button type="submit" disabled={props.disabled}>
        Send
      </Button>
      {props.error ? <p role="alert">{props.error}</p> : null}
    </form>
  );
}
