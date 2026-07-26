import type { CSSProperties, ReactNode } from "react";
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

const COLORS = {
  ink: "#0d1728",
  deep: "#101b30",
  bone: "#f3efe5",
  paper: "#fbf8f0",
  amber: "#f4a62a",
  amberSoft: "#ffd98d",
  teal: "#70d5c7",
  tealDeep: "#1c8b82",
  muted: "#8f98a7",
  line: "rgba(255,255,255,0.12)",
};

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

function fadeWindow(
  frame: number,
  duration: number,
  fadeIn = 16,
  fadeOut = 16,
) {
  return (
    ease(frame, [0, fadeIn], [0, 1]) *
    ease(frame, [duration - fadeOut, duration], [1, 0])
  );
}

function GlowNoise() {
  return (
    <>
      <div className="ambient ambient--amber" />
      <div className="ambient ambient--teal" />
      <div className="noise" />
    </>
  );
}

function ProviderTile({
  name,
  tone,
  style,
}: {
  name: string;
  tone: "amber" | "teal" | "bone";
  style?: CSSProperties;
}) {
  return (
    <div className={`provider-tile provider-tile--${tone}`} style={style}>
      <span className="provider-dot" />
      <strong>{name}</strong>
      <i />
    </div>
  );
}

function HookScene() {
  const frame = useCurrentFrame();
  const duration = 105;
  const opacity = fadeWindow(frame, duration, 8, 18);
  const first = spring({
    frame,
    fps: 30,
    config: { damping: 16, stiffness: 150, mass: 0.9 },
  });
  const second = spring({
    frame: frame - 20,
    fps: 30,
    config: { damping: 18, stiffness: 140, mass: 0.8 },
  });
  const tileData = [
    ["Codex", "teal", -580, -290, -8],
    ["Claude", "amber", 550, -330, 7],
    ["Cursor", "bone", -650, 250, 5],
    ["Grok", "teal", 610, 265, -5],
    ["Hermes", "amber", -330, 390, -4],
    ["OpenClaw", "bone", 360, 400, 4],
  ] as const;

  return (
    <AbsoluteFill className="scene scene--hook" style={{ opacity }}>
      <GlowNoise />
      <div className="hook-orbit" />
      {tileData.map(([name, tone, x, y, rotation], index) => {
        const drift = Math.sin((frame + index * 18) / 16) * 12;
        const enter = ease(frame, [index * 3, 26 + index * 3], [0, 1]);
        return (
          <ProviderTile
            key={name}
            name={name}
            tone={tone}
            style={{
              transform: `translate(${x}px, ${y + drift}px) rotate(${rotation}deg) scale(${0.82 + enter * 0.18})`,
              opacity: enter * 0.86,
            }}
          />
        );
      })}
      <div className="hook-copy">
        <span
          className="eyebrow eyebrow--light"
          style={{
            opacity: first,
            transform: `translateY(${(1 - first) * 24}px)`,
          }}
        >
          AI WORK IS EVERYWHERE
        </span>
        <h1>
          <span
            style={{
              opacity: first,
              transform: `translateY(${(1 - first) * 46}px)`,
            }}
          >
            Six AI tools.
          </span>
          <span
            className="hook-accent"
            style={{
              opacity: second,
              transform: `translateY(${(1 - second) * 46}px)`,
            }}
          >
            One human bottleneck.
          </span>
        </h1>
      </div>
      <div className="timeline-progress" style={{ width: `${(frame / duration) * 100}%` }} />
    </AbsoluteFill>
  );
}

function ImageScene({
  src,
  duration,
  children,
  className = "",
  zoomFrom = 1.02,
  zoomTo = 1.08,
}: {
  src: string;
  duration: number;
  children?: ReactNode;
  className?: string;
  zoomFrom?: number;
  zoomTo?: number;
}) {
  const frame = useCurrentFrame();
  const opacity = fadeWindow(frame, duration, 14, 18);
  const scale = ease(frame, [0, duration], [zoomFrom, zoomTo]);
  return (
    <AbsoluteFill className={`scene image-scene ${className}`} style={{ opacity }}>
      <Img
        className="image-scene__image"
        src={src}
        style={{ transform: `scale(${scale})` }}
      />
      <div className="image-scene__vignette" />
      <div className="image-scene__grain" />
      {children}
    </AbsoluteFill>
  );
}

function MorrowArrival() {
  const frame = useCurrentFrame();
  const title = spring({
    frame: frame - 10,
    fps: 30,
    config: { damping: 18, stiffness: 110 },
  });
  const badge = spring({
    frame: frame - 42,
    fps: 30,
    config: { damping: 16, stiffness: 130 },
  });

  return (
    <ImageScene
      src={staticFile("assets/morrow-orbit.png")}
      duration={165}
      className="arrival"
      zoomFrom={1.01}
      zoomTo={1.075}
    >
      <div className="arrival-copy">
        <span
          className="eyebrow eyebrow--amber"
          style={{
            opacity: title,
            transform: `translateY(${(1 - title) * 22}px)`,
          }}
        >
          MEET MORROW
        </span>
        <h2
          style={{
            opacity: title,
            transform: `translateY(${(1 - title) * 42}px)`,
          }}
        >
          The night shift
          <br />
          for every AI session.
        </h2>
        <div
          className="provider-strip"
          style={{
            opacity: badge,
            transform: `translateY(${(1 - badge) * 20}px)`,
          }}
        >
          {["Codex", "Claude", "Cursor", "Grok", "Hermes", "OpenClaw"].map(
            (name, index) => (
              <span key={name}>
                <i className={index % 2 === 0 ? "teal" : "amber"} />
                {name}
              </span>
            ),
          )}
        </div>
      </div>
    </ImageScene>
  );
}

function Sidebar() {
  const items = [
    ["◇", "Morrow", true],
    ["▦", "Attention", false],
    ["⌁", "Control board", false],
    ["☾", "Overnight", false],
  ];
  return (
    <aside className="mock-sidebar">
      <div className="brand-mark">
        <span className="brand-mark__glyph">›</span>
        <span>
          <strong>GOD OF SESSIONS</strong>
          <small>LOCAL CONTROL PLANE</small>
        </span>
      </div>
      <nav>
        {items.map(([icon, name, selected]) => (
          <div className={selected ? "selected" : ""} key={name as string}>
            <span>{icon}</span>
            <strong>{name}</strong>
          </div>
        ))}
      </nav>
      <div className="sidebar-foot">
        <div className="status-light" />
        <span>
          <strong>12 sessions observed</strong>
          <small>Local only · Read first</small>
        </span>
      </div>
    </aside>
  );
}

function ChatCard({ frame }: { frame: number }) {
  const userIn = spring({
    frame: frame - 18,
    fps: 30,
    config: { damping: 18, stiffness: 130 },
  });
  const thinking = ease(frame, [48, 72], [0, 1]) * ease(frame, [100, 118], [1, 0]);
  const answerIn = spring({
    frame: frame - 100,
    fps: 30,
    config: { damping: 18, stiffness: 115 },
  });
  const rows = [
    ["01", "Ship onboarding polish", "Codex", "2h 10m", "READY"],
    ["02", "Verify provider sign-in", "Claude", "1h 20m", "READY"],
    ["03", "Resolve desktop blocker", "Hermes", "Needs you", "HOLD"],
  ];

  return (
    <section className="mock-chat">
      <header>
        <div>
          <span className="eyebrow">MORROW OPERATOR</span>
          <h3>What should move tonight?</h3>
        </div>
        <div className="watch-pill">
          <i />
          MORROW WATCH
        </div>
      </header>
      <div className="chat-thread">
        <div
          className="user-message"
          style={{
            opacity: userIn,
            transform: `translateY(${(1 - userIn) * 22}px) scale(${0.98 + userIn * 0.02})`,
          }}
        >
          Move the best work forward tonight.
        </div>
        <div className="morrow-message">
          <Img src={staticFile("assets/morrow.png")} />
          <div className="morrow-message__body">
            {thinking > 0.01 && (
              <div className="thinking" style={{ opacity: thinking }}>
                <span />
                <span />
                <span />
                Inspecting sessions, capacity, and safe routes
              </div>
            )}
            <div
              className="answer"
              style={{
                opacity: answerIn,
                transform: `translateY(${(1 - answerIn) * 22}px)`,
              }}
            >
              <p>
                I found <strong>3 useful moves</strong> across 2 projects.
                Two can run safely tonight. One needs you first.
              </p>
              <div className="ranked-list">
                {rows.map(([rank, task, provider, time, state], index) => {
                  const rowIn = spring({
                    frame: frame - 112 - index * 8,
                    fps: 30,
                    config: { damping: 18, stiffness: 150 },
                  });
                  return (
                    <div
                      className={`ranked-row ranked-row--${state.toLowerCase()}`}
                      key={rank}
                      style={{
                        opacity: rowIn,
                        transform: `translateX(${(1 - rowIn) * 26}px)`,
                      }}
                    >
                      <span className="rank">{rank}</span>
                      <span className="task">
                        <strong>{task}</strong>
                        <small>{provider}</small>
                      </span>
                      <span className="time">{time}</span>
                      <span className="state">{state}</span>
                    </div>
                  );
                })}
              </div>
              <button>Review exact night plan <span>→</span></button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function WatchRail({ frame }: { frame: number }) {
  const inValue = spring({
    frame: frame - 116,
    fps: 30,
    config: { damping: 18, stiffness: 120 },
  });
  return (
    <aside
      className="mock-watch"
      style={{
        opacity: inValue,
        transform: `translateX(${(1 - inValue) * 34}px)`,
      }}
    >
      <header>
        <span className="operator-orb">›</span>
        <span>
          <strong>MORROW WATCH</strong>
          <small>Every session. One clear next move.</small>
        </span>
      </header>
      <div className="watch-metrics">
        <div><strong>12</strong><small>OBSERVED</small></div>
        <div><strong>3</strong><small>RUNNING</small></div>
        <div className="attention"><strong>1</strong><small>NEEDS YOU</small></div>
      </div>
      <div className="focus-card">
        <span>NEEDS YOU</span>
        <strong>desktop-app</strong>
        <p>Choose the release theme before tonight’s run.</p>
      </div>
    </aside>
  );
}

function ProductAnswer() {
  const frame = useCurrentFrame();
  const duration = 240;
  const opacity = fadeWindow(frame, duration, 12, 20);
  const scale = ease(frame, [0, duration], [0.96, 1.0]);
  const headline = spring({
    frame,
    fps: 30,
    config: { damping: 18, stiffness: 120 },
  });
  return (
    <AbsoluteFill className="scene product-scene" style={{ opacity }}>
      <GlowNoise />
      <div className="product-copy" style={{ opacity: headline }}>
        <span className="eyebrow eyebrow--amber">ONE QUESTION</span>
        <h2>Get the next move,<br />not another dashboard.</h2>
      </div>
      <div className="app-window" style={{ transform: `scale(${scale})` }}>
        <div className="titlebar">
          <span />
          <span />
          <span />
          <strong>God of Sessions</strong>
          <small>LOCAL · READ-ONLY UNTIL APPROVED</small>
        </div>
        <div className="app-body">
          <Sidebar />
          <div className="app-content">
            <ChatCard frame={frame} />
            <WatchRail frame={frame} />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

function PlanLane({
  name,
  provider,
  delay,
  width,
  color,
  frame,
  start,
}: {
  name: string;
  provider: string;
  delay: string;
  width: number;
  color: "amber" | "teal";
  frame: number;
  start: number;
}) {
  const progress = spring({
    frame: frame - start,
    fps: 30,
    config: { damping: 20, stiffness: 105 },
  });
  return (
    <div className="plan-lane">
      <header>
        <span>{provider}</span>
        <small>{delay}</small>
      </header>
      <div className="lane-track">
        <div
          className={`lane-block lane-block--${color}`}
          style={{ width: `${progress * width}%` }}
        >
          <strong style={{ opacity: ease(progress, [0.35, 0.7], [0, 1]) }}>{name}</strong>
        </div>
      </div>
    </div>
  );
}

function ApprovalScene() {
  const frame = useCurrentFrame();
  const duration = 195;
  const opacity = fadeWindow(frame, duration, 12, 18);
  const cardIn = spring({
    frame,
    fps: 30,
    config: { damping: 18, stiffness: 105 },
  });
  const approve = spring({
    frame: frame - 116,
    fps: 30,
    config: { damping: 14, stiffness: 170 },
  });
  return (
    <AbsoluteFill className="scene approval-scene" style={{ opacity }}>
      <GlowNoise />
      <div className="approval-copy">
        <span className="eyebrow eyebrow--teal">EXACT BY DESIGN</span>
        <h2>Review the plan.<br />Approve once.</h2>
        <p>No blanket autonomy. Every run stays tied to<br />the route, time, and goal you reviewed.</p>
      </div>
      <div
        className="plan-card"
        style={{
          opacity: cardIn,
          transform: `translateY(${(1 - cardIn) * 46}px) rotateY(${(1 - cardIn) * -4}deg)`,
        }}
      >
        <header className="plan-card__header">
          <div>
            <span>TONIGHT · 7 HOURS</span>
            <h3>2 safe runs before 7:30 AM</h3>
          </div>
          <span className="plan-confidence">HIGH CONFIDENCE</span>
        </header>
        <div className="lane-ruler">
          <span>12 AM</span><span>2 AM</span><span>4 AM</span><span>6 AM</span><span>7:30</span>
        </div>
        <PlanLane
          name="Onboarding polish"
          provider="CODEX"
          delay="starts now"
          width={62}
          color="teal"
          frame={frame}
          start={28}
        />
        <PlanLane
          name="Provider sign-in check"
          provider="CLAUDE"
          delay="after shared workspace is free"
          width={42}
          color="amber"
          frame={frame}
          start={50}
        />
        <div className="plan-proof">
          <span>✓ Exact provider route</span>
          <span>✓ Bounded workspace</span>
          <span>✓ Morning evidence</span>
        </div>
        <button
          className="approve-button"
          style={{
            transform: `scale(${0.92 + approve * 0.08})`,
            boxShadow: `0 0 ${approve * 38}px rgba(244,166,42,${approve * 0.42})`,
          }}
        >
          Approve tonight’s plan
          <span>⌘ ↵</span>
        </button>
      </div>
    </AbsoluteFill>
  );
}

function NightScene() {
  const frame = useCurrentFrame();
  const notices = [
    ["Codex", "Onboarding build passed", "2:14 AM"],
    ["Claude", "Sign-in flow verified", "4:42 AM"],
    ["Morrow", "One decision saved for you", "6:05 AM"],
  ];
  return (
    <ImageScene
      src={staticFile("assets/morrow-night.png")}
      duration={180}
      className="night-scene"
      zoomFrom={1.04}
      zoomTo={1.11}
    >
      <div className="night-copy">
        <span className="eyebrow eyebrow--amber">WHILE YOU SLEEP</span>
        <h2>Morrow keeps<br />the watch.</h2>
      </div>
      <div className="night-notices">
        {notices.map(([provider, message, time], index) => {
          const inValue = spring({
            frame: frame - 34 - index * 30,
            fps: 30,
            config: { damping: 16, stiffness: 135 },
          });
          return (
            <div
              className="night-notice"
              key={message}
              style={{
                opacity: inValue,
                transform: `translateX(${(1 - inValue) * 48}px) scale(${0.96 + inValue * 0.04})`,
              }}
            >
              <span className={index === 2 ? "amber" : "teal"}>{provider.slice(0, 1)}</span>
              <div>
                <small>{provider} · {time}</small>
                <strong>{message}</strong>
              </div>
              <i>✓</i>
            </div>
          );
        })}
      </div>
    </ImageScene>
  );
}

function MorningScene() {
  const frame = useCurrentFrame();
  const title = spring({
    frame: frame - 8,
    fps: 30,
    config: { damping: 18, stiffness: 115 },
  });
  const pill = spring({
    frame: frame - 52,
    fps: 30,
    config: { damping: 16, stiffness: 140 },
  });
  return (
    <ImageScene
      src={staticFile("assets/morrow-morning.png")}
      duration={180}
      className="morning-scene"
      zoomFrom={1.035}
      zoomTo={1.09}
    >
      <div
        className="morning-copy"
        style={{
          opacity: title,
          transform: `translateY(${(1 - title) * 38}px)`,
        }}
      >
        <span className="eyebrow eyebrow--teal">GOOD MORNING</span>
        <h2>Wake up to evidence.<br /><em>Not open tabs.</em></h2>
        <div
          className="morning-pill"
          style={{
            opacity: pill,
            transform: `translateY(${(1 - pill) * 20}px)`,
          }}
        >
          <span>2</span> results ready to review
          <i>→</i>
        </div>
      </div>
    </ImageScene>
  );
}

function BrandScene() {
  const frame = useCurrentFrame();
  const duration = 120;
  const sceneOpacity = ease(frame, [0, 24], [0, 1]);
  const logo = spring({
    frame,
    fps: 30,
    config: { damping: 17, stiffness: 105 },
  });
  const copy = spring({
    frame: frame - 22,
    fps: 30,
    config: { damping: 18, stiffness: 120 },
  });
  const orbit = ease(frame, [0, duration], [-16, 18]);
  return (
    <AbsoluteFill
      className="scene brand-scene"
      style={{ display: "grid", opacity: sceneOpacity, zIndex: 30 }}
    >
      <GlowNoise />
      <div className="brand-orbit brand-orbit--one" style={{ transform: `rotate(${orbit}deg)` }} />
      <div className="brand-orbit brand-orbit--two" style={{ transform: `rotate(${-orbit * 0.7}deg)` }} />
      <Img
        src={staticFile("assets/morrow.png")}
        className="brand-morrow"
        style={{
          opacity: logo,
          transform: `translateY(${(1 - logo) * 56}px) scale(${0.88 + logo * 0.12})`,
        }}
      />
      <div
        className="brand-copy"
        style={{
          opacity: copy,
          transform: `translateY(${(1 - copy) * 32}px)`,
        }}
      >
        <span className="eyebrow eyebrow--amber">MORROW IS ON WATCH</span>
        <h2>God of Sessions</h2>
        <p>Every session. One clear next move.</p>
      </div>
      <div className="brand-rule">
        <span />
        LOCAL-FIRST
        <span />
        APPROVAL-GATED
        <span />
        MULTI-AGENT
      </div>
    </AbsoluteFill>
  );
}

export function Promo() {
  return (
    <AbsoluteFill className="promo">
      <Sequence from={0} durationInFrames={105} premountFor={30}>
        <HookScene />
      </Sequence>
      <Sequence from={86} durationInFrames={165} premountFor={30}>
        <MorrowArrival />
      </Sequence>
      <Sequence from={226} durationInFrames={240} premountFor={30}>
        <ProductAnswer />
      </Sequence>
      <Sequence from={438} durationInFrames={195} premountFor={30}>
        <ApprovalScene />
      </Sequence>
      <Sequence from={604} durationInFrames={180} premountFor={30}>
        <NightScene />
      </Sequence>
      <Sequence from={756} durationInFrames={180} premountFor={30}>
        <MorningScene />
      </Sequence>
      <Sequence from={840} durationInFrames={120} premountFor={30}>
        <BrandScene />
      </Sequence>
    </AbsoluteFill>
  );
}
