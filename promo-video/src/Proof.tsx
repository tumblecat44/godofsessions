import type { CSSProperties } from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

function ease(frame: number, input: [number, number], output: [number, number]) {
  return interpolate(frame, input, output, {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
}

function sceneOpacity(frame: number, duration: number) {
  return (
    ease(frame, [0, 12], [0, 1]) *
    ease(frame, [duration - 12, duration], [1, 0])
  );
}

function ProofBadge({ label = "REAL APP UI · DEMO DATA" }: { label?: string }) {
  return (
    <div className="proof-badge">
      <i />
      {label}
    </div>
  );
}

function Progress({ frame, duration }: { frame: number; duration: number }) {
  return (
    <div className="proof-progress">
      <span style={{ width: `${Math.min(100, (frame / duration) * 100)}%` }} />
    </div>
  );
}

function Hook() {
  const frame = useCurrentFrame();
  const duration = 72;
  const first = spring({
    frame,
    fps: 30,
    config: { damping: 18, stiffness: 120 },
  });
  const second = spring({
    frame: frame - 14,
    fps: 30,
    config: { damping: 18, stiffness: 120 },
  });

  return (
    <AbsoluteFill
      className="proof-scene proof-hook"
      style={{ opacity: sceneOpacity(frame, duration) }}
    >
      <Img
        src={staticFile("proof/app-watch.png")}
        className="proof-hook__image"
        style={{ transform: `scale(${1.05 + frame * 0.0007})` }}
      />
      <div className="proof-hook__veil" />
      <ProofBadge />
      <div className="proof-hook__copy">
        <span style={{ opacity: first }}>YOUR AGENTS KEPT RUNNING.</span>
        <h1
          style={{
            opacity: second,
            transform: `translateY(${(1 - second) * 38}px)`,
          }}
        >
          You became
          <br />
          the queue.
        </h1>
      </div>
      <Progress frame={frame} duration={duration} />
    </AbsoluteFill>
  );
}

function AppScene({
  src,
  duration,
  kicker,
  title,
  detail,
  number,
  imageStyle,
}: {
  src: string;
  duration: number;
  kicker: string;
  title: string;
  detail: string;
  number: string;
  imageStyle?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const copy = spring({
    frame: frame - 5,
    fps,
    config: { damping: 18, stiffness: 125 },
  });
  const scale = ease(frame, [0, duration], [1.005, 1.035]);
  return (
    <AbsoluteFill
      className="proof-scene proof-app-scene"
      style={{ opacity: sceneOpacity(frame, duration) }}
    >
      <div className="proof-app-frame">
        <Img
          src={staticFile(src)}
          className="proof-app-image"
          style={{ transform: `scale(${scale})`, ...imageStyle }}
        />
        <div className="proof-app-frame__edge" />
      </div>
      <div className="proof-app-shade" />
      <ProofBadge />
      <div
        className="proof-app-copy"
        style={{
          opacity: copy,
          transform: `translateY(${(1 - copy) * 26}px)`,
        }}
      >
        <span>{kicker}</span>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
      <div className="proof-scene-number">{number}</div>
      <Progress frame={frame} duration={duration} />
    </AbsoluteFill>
  );
}

function ApprovalScene() {
  const frame = useCurrentFrame();
  const duration = 94;
  const { fps } = useVideoConfig();
  const modal = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 140, mass: 0.9 },
  });
  return (
    <AbsoluteFill
      className="proof-scene proof-approval"
      style={{ opacity: sceneOpacity(frame, duration) }}
    >
      <Img
        src={staticFile("proof/app-approval.png")}
        className="proof-approval__image"
        style={{
          transform: `scale(${0.94 + modal * 0.06})`,
          opacity: 0.45 + modal * 0.55,
        }}
      />
      <div className="proof-approval__copy">
        <span>ONE NIGHT · ONE BOUNDARY</span>
        <h2>One exact approval.</h2>
        <p>Route · workspace · permissions · time budget</p>
      </div>
      <ProofBadge />
      <div className="proof-scene-number">04</div>
      <Progress frame={frame} duration={duration} />
    </AbsoluteFill>
  );
}

function EndScene() {
  const frame = useCurrentFrame();
  const duration = 122;
  const { fps } = useVideoConfig();
  const character = spring({
    frame,
    fps,
    config: { damping: 20, stiffness: 95 },
  });
  const copy = spring({
    frame: frame - 18,
    fps,
    config: { damping: 19, stiffness: 110 },
  });
  return (
    <AbsoluteFill className="proof-scene proof-end">
      <Img
        src={staticFile("assets/morrow-morning.png")}
        className="proof-end__background"
        style={{ transform: `scale(${1.05 + frame * 0.0006})` }}
      />
      <div className="proof-end__veil" />
      <div
        className="proof-end__copy"
        style={{
          opacity: copy,
          transform: `translateY(${(1 - copy) * 28}px)`,
        }}
      >
        <span>MORROW IS ON WATCH</span>
        <h2>
          One bedtime approval.
          <br />
          <strong>Verified work by morning.</strong>
        </h2>
        <p>God of Sessions · Private alpha for macOS</p>
      </div>
      <div
        className="proof-end__mark"
        style={{
          opacity: character,
          transform: `scale(${0.8 + character * 0.2})`,
        }}
      >
        ›
      </div>
      <Progress frame={frame} duration={duration} />
    </AbsoluteFill>
  );
}

export function Proof() {
  return (
    <AbsoluteFill className="launch-proof">
      <Sequence from={0} durationInFrames={72} premountFor={20}>
        <Hook />
      </Sequence>
      <Sequence from={60} durationInFrames={102} premountFor={20}>
        <AppScene
          src="proof/app-watch.png"
          duration={102}
          kicker="MORROW WATCH"
          title="Six sources. One thing needs you."
          detail="Morrow lifts the human gate above every running and quiet session."
          number="01"
        />
      </Sequence>
      <Sequence from={150} durationInFrames={116} premountFor={20}>
        <AppScene
          src="proof/app-answer.png"
          duration={116}
          kicker="ASK ONCE"
          title="What should move tonight?"
          detail="2 safe runs · 1 needs you — ranked from context, capacity, and safe routes."
          number="02"
        />
      </Sequence>
      <Sequence from={254} durationInFrames={114} premountFor={20}>
        <AppScene
          src="proof/app-plan.png"
          duration={114}
          kicker="REVIEW THE PLAN"
          title="Exact route. Exact time. Exact evidence."
          detail="Nothing has started. The recommendation and preflight are still read-only."
          number="03"
        />
      </Sequence>
      <Sequence from={356} durationInFrames={94} premountFor={20}>
        <ApprovalScene />
      </Sequence>
      <Sequence from={438} durationInFrames={112} premountFor={20}>
        <AppScene
          src="proof/app-morning.png"
          duration={112}
          kicker="MORNING REVIEW"
          title="Wake up to evidence, not open tabs."
          detail="Exact provider receipt + bounded workspace observation. You review correctness."
          number="05"
        />
      </Sequence>
      <Sequence from={538} durationInFrames={122} premountFor={20}>
        <EndScene />
      </Sequence>
    </AbsoluteFill>
  );
}
