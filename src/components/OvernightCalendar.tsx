import { CalendarDays, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DayPicker, type DayButtonProps } from "react-day-picker";
import { ko as koLocale } from "react-day-picker/locale";
import "react-day-picker/style.css";
import { startedRunItems, tonightPlanItems } from "../lib/tonight";
import type { OvernightPortfolioPlanSummary, OvernightPortfolioRunSummary } from "../shared/contracts";

const activeStatuses = new Set<OvernightPortfolioRunSummary["status"]>(["starting", "running", "stopping"]);

interface OvernightCalendarProps {
  selectedDate: string;
  contextDate: string;
  timeZone: string;
  plans: OvernightPortfolioPlanSummary[];
  runs: OvernightPortfolioRunSummary[];
  ko: boolean;
  onSelect(date: string): void;
}

export function OvernightCalendarButton({ selectedDate, contextDate, timeZone, plans, runs, ko, onSelect }: OvernightCalendarProps) {
  const details = useRef<HTMLDetailsElement>(null);
  const [visibleMonth, setVisibleMonth] = useState(() => selectedDate.slice(0, 7));
  useEffect(() => setVisibleMonth(selectedDate.slice(0, 7)), [selectedDate]);
  const closeCalendar = (date?: string) => {
    if (date) onSelect(date);
    const summary = details.current?.querySelector("summary");
    if (document.activeElement instanceof HTMLElement && details.current?.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    details.current?.removeAttribute("open");
    summary?.focus();
  };
  const runPlanIds = new Set(runs.map((run) => run.planId));
  const inventory = new Map<string, { count: number; active: boolean; attention: boolean }>();
  const include = (date: string, count: number, active: boolean, attention: boolean) => {
    const current = inventory.get(date) ?? { count: 0, active: false, attention: false };
    inventory.set(date, { count: current.count + count, active: current.active || active, attention: current.attention || attention });
  };
  for (const plan of plans) {
    if (runPlanIds.has(plan.id) || plan.status !== "draft") continue;
    include(overnightDateKey(plan.createdAt, timeZone), tonightPlanItems(plan).length, false, false);
  }
  for (const run of runs) {
    include(overnightDateKey(run.startedAt, timeZone), startedRunItems(run.items).length, activeStatuses.has(run.status), run.status !== "completed" && !activeStatuses.has(run.status));
  }
  const CountDayButton = ({ day, modifiers, ...buttonProps }: DayButtonProps) => {
    const button = useRef<HTMLButtonElement>(null);
    useEffect(() => {
      if (modifiers.focused && details.current?.open) button.current?.focus();
    }, [modifiers.focused]);
    const date = calendarDayKey(day.date);
    const record = inventory.get(date);
    const label = `${formatCalendarDate(date, ko)}${record ? (ko ? `, Overnight ${record.count}개` : `, ${record.count} Overnight${record.count === 1 ? "" : "s"}`) : ""}`;
    return <button ref={button} {...buttonProps} aria-label={label} aria-current={date === selectedDate ? "date" : undefined}><span>{day.date.getDate()}</span>{record && <em>{record.count}</em>}</button>;
  };
  return (
    <details ref={details} className="overnight-calendar" onKeyDown={(event) => {
      if (event.key !== "Escape" || !details.current?.open) return;
      event.preventDefault();
      closeCalendar();
    }}>
      <summary aria-label={ko ? "Overnight 날짜 선택" : "Choose Overnight date"}><CalendarDays size={15} /><span>{formatCalendarDate(selectedDate, ko)}</span><ChevronRight size={13} /></summary>
      <div className="overnight-calendar__popover">
        <DayPicker
          mode="single"
          required
          selected={parseCalendarDay(selectedDate)}
          today={parseCalendarDay(contextDate)}
          month={parseCalendarDay(`${visibleMonth}-01`)}
          onMonthChange={(month) => setVisibleMonth(calendarDayKey(month).slice(0, 7))}
          onDayClick={(date) => closeCalendar(calendarDayKey(date))}
          showOutsideDays
          fixedWeeks
          locale={ko ? koLocale : undefined}
          formatters={{ formatCaption: (month) => formatCalendarMonth(calendarDayKey(month).slice(0, 7), ko) }}
          labels={{ labelPrevious: () => (ko ? "이전 달" : "Previous month"), labelNext: () => (ko ? "다음 달" : "Next month") }}
          modifiers={{
            active: [...inventory].filter(([, record]) => record.active).map(([date]) => parseCalendarDay(date)),
            attention: [...inventory].filter(([, record]) => record.attention).map(([date]) => parseCalendarDay(date)),
          }}
          modifiersClassNames={{ active: "is-active", attention: "is-attention" }}
          components={{ DayButton: CountDayButton }}
        />
        <footer><span><i className="is-active" />{ko ? "실행 중" : "Running"}</span><span><i />{ko ? "기록 있음" : "Has records"}</span><button type="button" onClick={() => closeCalendar(contextDate)}>{ko ? "오늘로 이동" : "Go to today"}</button></footer>
      </div>
    </details>
  );
}

export function OvernightDateEmptyState({ date, ko }: { date: string; ko: boolean }) {
  return <div className="overnight-date-empty"><CalendarDays size={20} /><div><span>{ko ? "기록 없음" : "NO RECORDS"}</span><h2>{ko ? `${formatCalendarDate(date, ko)}에는 Overnight가 없습니다` : `No Overnights on ${formatCalendarDate(date, ko)}`}</h2><p>{ko ? "기록이 있는 다른 날짜를 고르거나, 오늘에서 새로 준비하세요." : "Pick a marked date, or prepare a new overnight from today."}</p></div></div>;
}

export function overnightDateKey(value: string, timeZone: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: "year" | "month" | "day") => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function formatCalendarDate(date: string, ko: boolean) {
  return new Intl.DateTimeFormat(ko ? "ko-KR" : "en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

function parseCalendarDay(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day || 1);
}

function calendarDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatCalendarMonth(month: string, ko: boolean) {
  return new Intl.DateTimeFormat(ko ? "ko-KR" : "en-US", { year: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`));
}
