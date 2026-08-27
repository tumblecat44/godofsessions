import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { OvernightPortfolioPlanSummary, OvernightPortfolioRunSummary } from "../shared/contracts";

const activeStatuses = new Set<OvernightPortfolioRunSummary["status"]>(["starting", "running", "stopping", "unknown"]);

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
  const runPlanIds = new Set(runs.map((run) => run.planId));
  const inventory = new Map<string, { count: number; active: boolean; attention: boolean }>();
  const include = (date: string, count: number, active: boolean, attention: boolean) => {
    const current = inventory.get(date) ?? { count: 0, active: false, attention: false };
    inventory.set(date, { count: current.count + count, active: current.active || active, attention: current.attention || attention });
  };
  for (const plan of plans) {
    if (runPlanIds.has(plan.id) || plan.status === "expired") continue;
    include(overnightDateKey(plan.createdAt, timeZone), plan.items.length, false, false);
  }
  for (const run of runs) {
    include(overnightDateKey(run.startedAt, timeZone), run.items.length, activeStatuses.has(run.status), run.status !== "completed" && !activeStatuses.has(run.status));
  }
  const weekdays = ko ? ["일", "월", "화", "수", "목", "금", "토"] : ["S", "M", "T", "W", "T", "F", "S"];
  return (
    <details ref={details} className="overnight-calendar">
      <summary aria-label={ko ? "Overnight 날짜 선택" : "Choose Overnight date"}><CalendarDays size={15} /><span>{formatCalendarDate(selectedDate, ko)}</span><ChevronRight size={13} /></summary>
      <div className="overnight-calendar__popover">
        <header><button type="button" aria-label={ko ? "이전 달" : "Previous month"} onClick={() => setVisibleMonth(shiftCalendarMonth(visibleMonth, -1))}><ChevronLeft size={15} /></button><strong>{formatCalendarMonth(visibleMonth, ko)}</strong><button type="button" aria-label={ko ? "다음 달" : "Next month"} onClick={() => setVisibleMonth(shiftCalendarMonth(visibleMonth, 1))}><ChevronRight size={15} /></button></header>
        <div className="overnight-calendar__weekdays" aria-hidden="true">{weekdays.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
        <div className="overnight-calendar__days">{calendarGridDays(visibleMonth).map((date) => {
          const record = inventory.get(date);
          const classes = [date === selectedDate && "is-selected", date === contextDate && "is-today", date.slice(0, 7) !== visibleMonth && "is-outside", record?.active && "is-active", record?.attention && "is-attention"].filter(Boolean).join(" ");
          return <button type="button" key={date} className={classes} aria-label={`${formatCalendarDate(date, ko)}${record ? (ko ? `, Overnight ${record.count}개` : `, ${record.count} Overnight${record.count === 1 ? "" : "s"}`) : ""}`} onClick={() => { onSelect(date); details.current?.removeAttribute("open"); }}><span>{Number(date.slice(8, 10))}</span>{record && <em>{record.count}</em>}</button>;
        })}</div>
        <footer><span><i className="is-active" />{ko ? "실행 중" : "Running"}</span><span><i />{ko ? "기록 있음" : "Has records"}</span><button type="button" onClick={() => { onSelect(contextDate); details.current?.removeAttribute("open"); }}>{ko ? "오늘로 이동" : "Go to today"}</button></footer>
      </div>
    </details>
  );
}

export function OvernightDateEmptyState({ date, ko }: { date: string; ko: boolean }) {
  return <div className="overnight-date-empty"><CalendarDays size={20} /><div><span>{ko ? "기록 없음" : "NO RECORDS"}</span><h2>{ko ? `${formatCalendarDate(date, ko)}에는 Overnight가 없습니다` : `No Overnights on ${formatCalendarDate(date, ko)}`}</h2><p>{ko ? "캘린더에서 기록이 표시된 다른 날짜를 골라 주세요. 새 Overnight 준비는 오늘 날짜에서 할 수 있습니다." : "Choose another marked date in the calendar. New Overnights can be prepared from today's date."}</p></div></div>;
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

function calendarGridDays(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

function shiftCalendarMonth(month: string, amount: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + amount, 1)).toISOString().slice(0, 7);
}

function formatCalendarMonth(month: string, ko: boolean) {
  return new Intl.DateTimeFormat(ko ? "ko-KR" : "en-US", { year: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`));
}
