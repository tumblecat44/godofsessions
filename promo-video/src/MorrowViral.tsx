import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const OPENING_TRIM_FRAMES = 15;

const providers = [
  { name: "Grok Build", tone: "cyan" },
  { name: "Claude Code", tone: "amber" },
  { name: "Codex", tone: "teal" },
  { name: "Cursor", tone: "violet" },
  { name: "Hermes", tone: "gold" },
  { name: "Pi", tone: "lime" },
] as const;

function tween(
  frame: number,
  input: number[],
  output: number[],
  easing = Easing.out(Easing.cubic),
) {
  return interpolate(frame, input, output, {
    ...clamp,
    easing,
  });
}

function sceneOpacity(frame: number, duration: number) {
  const enter = tween(frame, [0, 10], [0, 1]);
  const exit = tween(
    frame,
    [duration - 10, duration],
    [1, 0],
    Easing.in(Easing.cubic),
  );
  return enter * exit;
}

function springIn(frame: number, delay = 0, stiffness = 135) {
  return spring({
    frame: frame - delay,
    fps: 30,
    config: {
      damping: 19,
      stiffness,
      mass: 0.9,
    },
  });
}

function Backdrop({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="mv-grid" />
      <div className="mv-glow mv-glow--amber" />
      <div className="mv-glow mv-glow--teal" />
      <div className="mv-noise" />
      {children}
    </>
  );
}

function BrandRail({
  section,
  right = "REAL APP LOGIC · DEMO DATA",
}: {
  section: string;
  right?: string;
}) {
  return (
    <div className="mv-rail">
      <div className="mv-rail__brand">
        <span className="mv-mark">›</span>
        MORROW
      </div>
      <div className="mv-rail__section">{section}</div>
      <div className="mv-demo-badge">
        <i />
        {right}
      </div>
    </div>
  );
}

function Scene({
  children,
  duration,
  className = "",
}: {
  children: ReactNode;
  duration: number;
  className?: string;
}) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      className={`mv-scene ${className}`}
      style={{ opacity: sceneOpacity(frame, duration) }}
    >
      <Backdrop>{children}</Backdrop>
    </AbsoluteFill>
  );
}

function ProviderChip({
  name,
  tone,
  style,
  compact = false,
}: {
  name: string;
  tone: string;
  style?: CSSProperties;
  compact?: boolean;
}) {
  return (
    <div
      className={`mv-provider mv-provider--${tone} ${
        compact ? "mv-provider--compact" : ""
      }`}
      style={style}
    >
      <span className="mv-provider__light" />
      <b>{name}</b>
      <span className="mv-provider__lines">═</span>
    </div>
  );
}

function HookScene() {
  const frame = useCurrentFrame();
  const duration = 84;
  const headline = springIn(frame, 4, 118);
  const orbitScale = tween(frame, [0, duration], [1.04, 0.98]);

  const points = [
    [-620, -290, -4],
    [595, -315, 4],
    [-690, 210, 3],
    [655, 205, -4],
    [-335, 385, -2],
    [370, 390, 3],
  ];

  return (
    <Scene duration={duration} className="mv-hook">
      <div
        className="mv-orbit mv-orbit--outer"
        style={{ transform: `translate(-50%, -50%) scale(${orbitScale})` }}
      />
      <div className="mv-orbit mv-orbit--inner" />
      {providers.map((provider, index) => {
        const [x, y, rotation] = points[index];
        const item = springIn(frame, 2 + index, 150);
        const float = Math.sin((frame + index * 11) / 16) * 7;
        return (
          <ProviderChip
            key={provider.name}
            {...provider}
            style={{
              left: "50%",
              top: "50%",
              opacity: item,
              transform: `translate(calc(-50% + ${x}px), calc(-50% + ${
                y + float
              }px)) rotate(${rotation}deg) scale(${0.92 + item * 0.08})`,
            }}
          />
        );
      })}
      <div
        className="mv-hook__copy"
        style={{
          opacity: headline,
          transform: `translateY(${(1 - headline) * 38}px)`,
        }}
      >
        <span className="mv-kicker">YOUR AI TEAM IS ALREADY HERE</span>
        <h1>
          Six coding agents.
          <br />
          <em>One night.</em>
        </h1>
      </div>
    </Scene>
  );
}

function PainScene() {
  const frame = useCurrentFrame();
  const duration = 102;
  const copy = springIn(frame, 3, 122);
  const elapsedMinutes = Math.round(
    tween(frame, [12, 74], [0, 29], Easing.inOut(Easing.cubic)),
  );
  const clockMinutes = 11 * 60 + 48 + elapsedMinutes;
  const clockHour = Math.floor(clockMinutes / 60) % 12 || 12;
  const clockMinute = clockMinutes % 60;
  const clockPeriod = clockMinutes >= 12 * 60 ? "AM" : "PM";
  const pile = springIn(frame, 14, 145);

  return (
    <Scene duration={duration} className="mv-pain">
      <BrandRail section="11:48 PM · BEDTIME" right="THE HUMAN BOTTLENECK" />
      <div
        className="mv-pain__copy"
        style={{
          opacity: copy,
          transform: `translateX(${(1 - copy) * -38}px)`,
        }}
      >
        <span className="mv-kicker">SHOWERED. READY TO SLEEP.</span>
        <h2>
          One bedtime
          <br />
          <em>decision.</em>
        </h2>
        <p>What should run overnight?</p>
      </div>
      <div
        className="mv-decision-stack"
        style={{
          opacity: pile,
          transform: `translateY(${(1 - pile) * 30}px)`,
        }}
      >
        <div className="mv-clock">
          <span>{clockHour}</span>
          <i>:</i>
          <span>{clockMinute.toString().padStart(2, "0")}</span>
          <small>{clockPeriod}</small>
        </div>
        <div className="mv-decision-stack__label">
          PICK ONE BEFORE BED
          <span>6 OPTIONS</span>
        </div>
        {providers.map((provider, index) => {
          const item = springIn(frame, 22 + index, 155);
          return (
            <div
              className="mv-choice-row"
              key={provider.name}
              style={{
                opacity: item,
                transform: `translateX(${(1 - item) * 20}px)`,
              }}
            >
              <span
                className={`mv-choice-row__dot mv-choice-row__dot--${provider.tone}`}
              />
              <b>{provider.name}</b>
              <span>Choose task</span>
              <i>›</i>
            </div>
          );
        })}
      </div>
    </Scene>
  );
}

function ConvergeScene() {
  const frame = useCurrentFrame();
  const duration = 120;
  const question = springIn(frame, 2, 120);
  const gather = tween(
    frame,
    [18, 56],
    [0, 1],
    Easing.inOut(Easing.cubic),
  );
  const answer = springIn(frame, 48, 112);

  const points = [
    [-540, -235],
    [535, -250],
    [-610, 145],
    [605, 130],
    [-330, 320],
    [350, 325],
  ];

  return (
    <Scene duration={duration} className="mv-converge">
      <BrandRail section="OVERNIGHT RECOMMENDATION" />
      <div
        className="mv-converge__question"
        style={{
          opacity: question * (1 - gather),
          transform: `translateY(${-gather * 28}px) scale(${1 - gather * 0.04})`,
        }}
      >
        <span className="mv-kicker">ASK MORROW ONCE</span>
        <h2>What should run tonight?</h2>
      </div>
      {providers.map((provider, index) => {
        const [x, y] = points[index];
        const alpha = tween(frame, [0, 12, 50, 64], [0, 1, 1, 0]);
        return (
          <ProviderChip
            key={provider.name}
            {...provider}
            compact
            style={{
              left: "50%",
              top: "50%",
              opacity: alpha,
              transform: `translate(calc(-50% + ${x * (1 - gather)}px), calc(-50% + ${
                y * (1 - gather) + 30
              }px)) scale(${1 - gather * 0.45})`,
            }}
          />
        );
      })}
      <div
        className="mv-answer-card"
        style={{
          opacity: answer,
          transform: `translate(-50%, -50%) scale(${0.82 + answer * 0.18})`,
        }}
      >
        <div className="mv-answer-card__top">
          <span>BEST OVERNIGHT BET</span>
          <b>91</b>
        </div>
        <div className="mv-answer-card__body">
          <span className="mv-answer-card__icon">›</span>
          <div>
            <small>GOD OF SESSIONS · CODEX</small>
            <h3>Launch-proof vertical slice</h3>
            <p>High value · safe route · fits tonight's capacity</p>
          </div>
        </div>
        <div className="mv-answer-card__footer">
          <span>7h night plan</span>
          <span>Exact approval required</span>
        </div>
      </div>
      <div
        className="mv-converge__result"
        style={{ opacity: tween(frame, [62, 78], [0, 1]) }}
      >
        SIX SIGNALS → ONE ANSWER
      </div>
    </Scene>
  );
}

function AppChrome({ children }: { children: ReactNode }) {
  return (
    <div className="mv-app">
      <div className="mv-app__topbar">
        <div className="mv-app__traffic">
          <i />
          <i />
          <i />
        </div>
        <span>God of Sessions</span>
        <div className="mv-app__status">
          <i />
          LOCAL
        </div>
      </div>
      <div className="mv-app__body">
        <aside>
          <div className="mv-app__logo">
            <span>›</span>
            Morrow
          </div>
          <nav>
            <div>Watch</div>
            <div className="active">Overnight</div>
            <div>Capacity</div>
            <div>Morning review</div>
          </nav>
          <small>6 providers connected</small>
        </aside>
        <main>{children}</main>
      </div>
    </div>
  );
}

function RecommendationScene() {
  const frame = useCurrentFrame();
  const duration = 180;
  const app = springIn(frame, 2, 118);
  const card = springIn(frame, 24, 130);
  const underline = tween(frame, [40, 76], [0, 1]);

  return (
    <Scene duration={duration} className="mv-product">
      <BrandRail section="01 · ONE RECOMMENDATION" />
      <div
        className="mv-product__headline"
        style={{
          opacity: springIn(frame, 7, 120),
          transform: `translateY(${(1 - springIn(frame, 7, 120)) * 24}px)`,
        }}
      >
        <span className="mv-kicker">NO MORE TAB TRIAGE</span>
        <h2>
          One recommendation.
          <br />
          <em>Not six tabs.</em>
        </h2>
      </div>
      <div
        className="mv-product__app"
        style={{
          opacity: app,
          transform: `perspective(1600px) rotateY(${
            (1 - app) * -7
          }deg) translateX(${(1 - app) * 70}px)`,
        }}
      >
        <AppChrome>
          <div className="mv-ui-heading">
            <div>
              <span>OVERNIGHT</span>
              <h3>Build tonight's recommendation</h3>
            </div>
            <button>Recalculate</button>
          </div>
          <div
            className="mv-ui-best"
            style={{
              opacity: card,
              transform: `translateY(${(1 - card) * 28}px)`,
            }}
          >
            <div className="mv-ui-best__score">
              <strong>91</strong>
              <span>FIT SCORE</span>
            </div>
            <div className="mv-ui-best__copy">
              <span>BEST OVERNIGHT BET · CODEX</span>
              <h4>Launch-proof vertical slice</h4>
              <p>
                Highest-value bounded task that fits tonight's available
                capacity.
              </p>
              <div className="mv-ui-best__meta">
                <b>4h 20m</b>
                <b>Safe route</b>
                <b>Evidence on finish</b>
              </div>
            </div>
          </div>
          <div className="mv-ui-note">
            <i style={{ transform: `scaleX(${underline})` }} />
            Ranked from live sessions, route readiness, and usage windows.
          </div>
        </AppChrome>
      </div>
    </Scene>
  );
}

const capacityRows = [
  {
    name: "Claude Code",
    window: "5-hour",
    used: 100,
    label: "Resets 12:41 AM",
    tone: "amber",
  },
  {
    name: "Codex",
    window: "weekly",
    used: 13,
    label: "87% available",
    tone: "teal",
  },
  {
    name: "Grok Build",
    window: "weekly",
    used: 28,
    label: "72% available",
    tone: "cyan",
  },
] as const;

function CapacityScene() {
  const frame = useCurrentFrame();
  const duration = 180;
  const panel = springIn(frame, 4, 118);
  const copy = springIn(frame, 15, 124);

  return (
    <Scene duration={duration} className="mv-capacity">
      <BrandRail section="02 · CAPACITY-AWARE" />
      <div
        className="mv-capacity__panel"
        style={{
          opacity: panel,
          transform: `translateX(${(1 - panel) * -54}px)`,
        }}
      >
        <div className="mv-panel-heading">
          <div>
            <span>AVAILABLE CAPACITY</span>
            <h3>Tonight's execution windows</h3>
          </div>
          <div>7h plan</div>
        </div>
        {capacityRows.map((row, index) => {
          const rowIn = springIn(frame, 22 + index, 145);
          const progress = tween(
            frame,
            [34 + index * 4, 74 + index * 4],
            [0, row.used],
          );
          return (
            <div
              className="mv-capacity-row"
              key={row.name}
              style={{
                opacity: rowIn,
                transform: `translateY(${(1 - rowIn) * 18}px)`,
              }}
            >
              <div className="mv-capacity-row__title">
                <span
                  className={`mv-capacity-row__dot mv-capacity-row__dot--${row.tone}`}
                />
                <b>{row.name}</b>
                <small>{row.window}</small>
                <em>{row.label}</em>
              </div>
              <div className="mv-meter">
                <i
                  className={`mv-meter__fill mv-meter__fill--${row.tone}`}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mv-capacity-row__numbers">
                <span>{row.used}% used</span>
                <span>{100 - row.used}% free</span>
              </div>
            </div>
          );
        })}
        <div className="mv-capacity__math">
          <span>5-HOUR WINDOW</span>
          <i>+</i>
          <span>WEEKLY WINDOW</span>
          <i>+</i>
          <span>TASK ESTIMATE</span>
          <b>= FIT</b>
        </div>
      </div>
      <div
        className="mv-capacity__copy"
        style={{
          opacity: copy,
          transform: `translateY(${(1 - copy) * 30}px)`,
        }}
      >
        <span className="mv-kicker">USE WHAT IS ACTUALLY AVAILABLE</span>
        <h2>
          Five hours.
          <br />
          One week.
          <br />
          <em>Counted once.</em>
        </h2>
        <p>Morrow fits the work to the capacity you already have.</p>
      </div>
    </Scene>
  );
}

const readinessRows = [
  { label: "Power connected", state: "PASS", tone: "pass" },
  { label: "Idle sleep protection", state: "ON", tone: "pass" },
  { label: "Disk space", state: "PASS", tone: "pass" },
  { label: "Lid position", state: "KEEP OPEN", tone: "warn" },
] as const;

function AwakeScene() {
  const frame = useCurrentFrame();
  const duration = 150;
  const card = springIn(frame, 5, 120);
  const pulse = 0.45 + Math.sin(frame / 8) * 0.12;

  return (
    <Scene duration={duration} className="mv-awake">
      <BrandRail section="03 · HOST READINESS" />
      <div className="mv-awake__copy">
        <span className="mv-kicker">BEFORE MORROW STARTS</span>
        <h2>
          Keep the Mac
          <br />
          <em>awake.</em>
        </h2>
        <p>Idle sleep protection is checked before the first bounded run.</p>
      </div>
      <div
        className="mv-readiness-card"
        style={{
          opacity: card,
          transform: `translateY(${(1 - card) * 34}px)`,
        }}
      >
        <div className="mv-readiness-card__top">
          <div>
            <span className="mv-status-pulse" style={{ opacity: pulse }} />
            HOST READY
          </div>
          <b>3 PASS · 1 NOTE</b>
        </div>
        {readinessRows.map((row, index) => {
          const item = springIn(frame, 22 + index, 150);
          return (
            <div
              className="mv-readiness-row"
              key={row.label}
              style={{
                opacity: item,
                transform: `translateX(${(1 - item) * 22}px)`,
              }}
            >
              <span className={`mv-check mv-check--${row.tone}`}>
                {row.tone === "pass" ? "✓" : "!"}
              </span>
              <b>{row.label}</b>
              <em className={`mv-state mv-state--${row.tone}`}>
                {row.state}
              </em>
            </div>
          );
        })}
        <div className="mv-readiness-card__note">
          <b>caffeinate -i</b> protects against idle sleep. It does not override
          lid-close sleep.
        </div>
      </div>
    </Scene>
  );
}

function ApprovalScene() {
  const frame = useCurrentFrame();
  const duration = 132;
  const modal = springIn(frame, 3, 126);
  const press = tween(frame, [72, 77, 84], [1, 0.98, 1]);
  const accepted = springIn(frame, 78, 155);

  return (
    <Scene duration={duration} className="mv-approval">
      <BrandRail section="04 · EXACT APPROVAL" />
      <div className="mv-approval__shade" />
      <div
        className="mv-approval__copy"
        style={{ opacity: springIn(frame, 6, 118) }}
      >
        <span className="mv-kicker">NOTHING STARTS YET</span>
        <h2>
          One exact
          <br />
          <em>approval.</em>
        </h2>
      </div>
      <div
        className="mv-approval-card"
        style={{
          opacity: modal,
          transform: `translateY(${(1 - modal) * 34}px) scale(${
            0.96 + modal * 0.04
          })`,
        }}
      >
        <div className="mv-approval-card__heading">
          <div>
            <span>REVIEW NIGHT PLAN</span>
            <h3>Approve the full night</h3>
          </div>
          <button>×</button>
        </div>
        <div className="mv-contract-grid">
          <div>
            <span>ROUTE</span>
            <b>Codex · local runtime</b>
          </div>
          <div>
            <span>WORKSPACE</span>
            <b>godofsessions</b>
          </div>
          <div>
            <span>TIME BUDGET</span>
            <b>4h 20m · ends 5:38 AM</b>
          </div>
          <div>
            <span>EVIDENCE</span>
            <b>Provider receipt + Git observation</b>
          </div>
        </div>
        <div className="mv-approval-card__boundary">
          Single-use · expires in 09:42 · no ambiguous retry
        </div>
        <button
          className="mv-approve-button"
          style={{ transform: `scale(${press})` }}
        >
          <span style={{ opacity: 1 - accepted }}>Approve night plan</span>
          <span
            className="mv-approve-button__accepted"
            style={{ opacity: accepted }}
          >
            ✓ Approved
          </span>
        </button>
      </div>
    </Scene>
  );
}

const nightRows = [
  {
    time: "12:00",
    provider: "Codex",
    task: "Launch-proof vertical slice",
    width: 100,
  },
  {
    time: "02:40",
    provider: "Hermes",
    task: "Bounded verification",
    width: 76,
  },
  {
    time: "04:10",
    provider: "Claude",
    task: "Capacity-aware follow-up",
    width: 44,
  },
] as const;

function NightScene() {
  const frame = useCurrentFrame();
  const duration = 132;
  const moon = springIn(frame, 2, 95);
  const timeline = springIn(frame, 13, 126);

  return (
    <Scene duration={duration} className="mv-night">
      <BrandRail section="NIGHT RUN · BOUNDED" right="PROVIDER-OWNED EXECUTION" />
      <div
        className="mv-night__moon"
        style={{
          opacity: moon,
          transform: `translateY(${(1 - moon) * 22}px) scale(${
            0.9 + moon * 0.1
          })`,
        }}
      >
        <i />
      </div>
      <div className="mv-night__copy">
        <span className="mv-kicker">YOU CAN STOP HOLDING THE QUEUE</span>
        <h2>
          Sleep.
          <br />
          <em>Morrow keeps watch.</em>
        </h2>
        <p>Bounded runs continue through the provider you approved.</p>
      </div>
      <div
        className="mv-night-board"
        style={{
          opacity: timeline,
          transform: `translateX(${(1 - timeline) * 40}px)`,
        }}
      >
        <div className="mv-night-board__top">
          <span>NIGHT PLAN</span>
          <b>
            <i />
            ON WATCH
          </b>
        </div>
        {nightRows.map((row, index) => {
          const item = springIn(frame, 24 + index, 145);
          const progress = tween(
            frame,
            [32 + index * 10, 94 + index * 8],
            [0, row.width],
          );
          return (
            <div
              className="mv-night-row"
              key={row.task}
              style={{
                opacity: item,
                transform: `translateY(${(1 - item) * 16}px)`,
              }}
            >
              <span className="mv-night-row__time">{row.time}</span>
              <div>
                <span>{row.provider}</span>
                <b>{row.task}</b>
                <div className="mv-night-meter">
                  <i style={{ width: `${progress}%` }} />
                </div>
              </div>
              <em>{index === 0 ? "RUNNING" : "PLANNED"}</em>
            </div>
          );
        })}
        <div className="mv-night-board__footer">
          Starts stay provider-authoritative · uncertain starts fail closed
        </div>
      </div>
    </Scene>
  );
}

function EndScene() {
  const frame = useCurrentFrame();
  const duration = 96;
  const mark = springIn(frame, 0, 92);
  const copy = springIn(frame, 12, 116);
  const light = tween(frame, [0, duration], [0.22, 0.62]);

  return (
    <Scene duration={duration} className="mv-end">
      <div className="mv-end__sun" style={{ opacity: light }} />
      <div
        className="mv-end__mark"
        style={{
          opacity: mark,
          transform: `scale(${0.74 + mark * 0.26}) rotate(${
            (1 - mark) * -8
          }deg)`,
        }}
      >
        ›
      </div>
      <div
        className="mv-end__copy"
        style={{
          opacity: copy,
          transform: `translateY(${(1 - copy) * 28}px)`,
        }}
      >
        <span>MORROW</span>
        <h2>
          Wake to <em>evidence.</em>
        </h2>
        <p>One recommendation. One approval. One clear morning.</p>
        <div className="mv-end__cta">
          <i />
          morrow.vibejason.com
        </div>
      </div>
    </Scene>
  );
}

function GlobalProgress() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <div className="mv-global-progress">
      <i style={{ width: `${(frame / durationInFrames) * 100}%` }} />
    </div>
  );
}

export function MorrowViral() {
  return (
    <AbsoluteFill className="morrow-viral">
      <Sequence
        from={-OPENING_TRIM_FRAMES}
        durationInFrames={84}
        premountFor={20}
      >
        <HookScene />
      </Sequence>
      <Sequence
        from={72 - OPENING_TRIM_FRAMES}
        durationInFrames={102}
        premountFor={20}
      >
        <PainScene />
      </Sequence>
      <Sequence
        from={162 - OPENING_TRIM_FRAMES}
        durationInFrames={120}
        premountFor={20}
      >
        <ConvergeScene />
      </Sequence>
      <Sequence
        from={270 - OPENING_TRIM_FRAMES}
        durationInFrames={180}
        premountFor={20}
      >
        <RecommendationScene />
      </Sequence>
      <Sequence
        from={438 - OPENING_TRIM_FRAMES}
        durationInFrames={180}
        premountFor={20}
      >
        <CapacityScene />
      </Sequence>
      <Sequence
        from={606 - OPENING_TRIM_FRAMES}
        durationInFrames={150}
        premountFor={20}
      >
        <AwakeScene />
      </Sequence>
      <Sequence
        from={744 - OPENING_TRIM_FRAMES}
        durationInFrames={132}
        premountFor={20}
      >
        <ApprovalScene />
      </Sequence>
      <Sequence
        from={864 - OPENING_TRIM_FRAMES}
        durationInFrames={132}
        premountFor={20}
      >
        <NightScene />
      </Sequence>
      <Sequence
        from={984 - OPENING_TRIM_FRAMES}
        durationInFrames={96}
        premountFor={20}
      >
        <EndScene />
      </Sequence>
      <GlobalProgress />
    </AbsoluteFill>
  );
}
