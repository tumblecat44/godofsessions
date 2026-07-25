import type { SessionStatus } from "../types";

export function StatusGlyph({ status }: { status: SessionStatus }) {
  return (
    <span className={`status-glyph status-glyph--${status}`} aria-hidden="true">
      <span />
    </span>
  );
}
