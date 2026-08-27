interface OperatorMarkProps {
  size?: number;
  active?: boolean;
  className?: string;
}

export function OperatorMark({
  size = 30,
  active = false,
  className = "",
}: OperatorMarkProps) {
  return (
    <span
      className={`operator-mark ${active ? "is-active" : ""} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 40 40" role="presentation">
        <g className="operator-mark__ring">
          <path d="M15.3 4.4A16 16 0 0 1 24.7 4.4" />
          <path d="M29.2 6.2A16 16 0 0 1 35 13.7" />
          <path d="M36 18.7A16 16 0 0 1 34.3 28" />
          <path d="M31.2 32A16 16 0 0 1 22.5 35.8" />
          <path d="M17.4 35.8A16 16 0 0 1 9 31.8" />
          <path className="operator-mark__signal" d="M5.6 27.7A16 16 0 0 1 4.3 18.2" />
          <path d="M5.4 13.4A16 16 0 0 1 11 6.2" />
        </g>
        <rect x="11.2" y="12.8" width="17.6" height="14.6" rx="6.4" />
        <path className="operator-mark__caret" d="m17.4 17.2 5.2 3-5.2 3" />
      </svg>
    </span>
  );
}
