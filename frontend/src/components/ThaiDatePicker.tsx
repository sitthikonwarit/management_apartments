import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { toDisplayYear } from "../utils/yearFormat";

/* ── Constants ─────────────────────────────────────────────────── */
const MONTHS = [
  "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน",
  "พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม",
  "กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม",
];
const MONTHS_SHORT = [
  "ม.ค.","ก.พ.","มี.ค.","เม.ย.",
  "พ.ค.","มิ.ย.","ก.ค.","ส.ค.",
  "ก.ย.","ต.ค.","พ.ย.","ธ.ค.",
];
const DAYS = ["อา","จ","อ","พ","พฤ","ศ","ส"];

/* ── Helpers ────────────────────────────────────────────────────── */
// ค่า value/onChange ของ component นี้เป็น ISO (YYYY-MM-DD, ปี ค.ศ.) เสมอ — ตรงกับที่
// contractStartDate/contractEndDate เก็บจริงใน DB ส่วนการแสดงผล พ.ศ./ค.ศ. ทำผ่าน toDisplayYear ด้านล่าง
function parseISO(str: string): { d: number; m: number; y: number } | null {
  if (!str) return null;
  const p = str.split("-");
  if (p.length !== 3) return null;
  const y = +p[0], m = +p[1] - 1, d = +p[2];
  if (isNaN(d) || isNaN(m) || isNaN(y) || d < 1 || d > 31 || m < 0 || m > 11) return null;
  return { d, m, y };
}

function formatISO(d: number, m: number, y: number) {
  return `${String(y).padStart(4,"0")}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}

function daysInMonth(y: number, m: number) {
  return new Date(y, m + 1, 0).getDate();
}

function firstDay(y: number, m: number) {
  return new Date(y, m, 1).getDay();
}

/* ── Calendar Popup ─────────────────────────────────────────────── */
interface CalendarProps {
  value: string;
  onSelect: (val: string) => void;
  onClose: () => void;
  anchor: DOMRect;
}

type View = "days" | "months" | "years";

function Calendar({ value, onSelect, onClose, anchor }: CalendarProps) {
  const parsed = parseISO(value);
  const todayCE = new Date();
  const initY = parsed?.y ?? todayCE.getFullYear();
  const initM = parsed?.m ?? todayCE.getMonth();

  const [curY, setCurY] = useState(initY);
  const [curM, setCurM] = useState(initM);
  const [view, setView] = useState<View>("days");
  const [yearPage, setYearPage] = useState(Math.floor(initY / 12) * 12);
  const popRef = useRef<HTMLDivElement>(null);

  /* position */
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const reposition = useCallback(() => {
    const pop = popRef.current;
    if (!pop) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const pw = pop.offsetWidth || 300, ph = pop.offsetHeight || 320;
    let top = anchor.bottom + 6;
    let left = anchor.left;
    if (top + ph > vh - 8) top = anchor.top - ph - 6;
    if (left + pw > vw - 8) left = vw - pw - 8;
    if (left < 8) left = 8;
    setPos({ top, left, width: anchor.width });
  }, [anchor]);

  useEffect(() => {
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [reposition, view]);

  /* close on outside click */
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) onClose();
    }
    setTimeout(() => document.addEventListener("mousedown", handle), 0);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose]);

  /* ── Day grid ── */
  function renderDays() {
    const total = daysInMonth(curY, curM);
    const start = firstDay(curY, curM);
    const cells: React.ReactNode[] = [];

    for (let i = 0; i < start; i++)
      cells.push(<div key={`e${i}`} />);

    for (let d = 1; d <= total; d++) {
      const isToday = d === todayCE.getDate() && curM === todayCE.getMonth() && curY === todayCE.getFullYear();
      const isSel = parsed && d === parsed.d && curM === parsed.m && curY === parsed.y;
      cells.push(
        <button
          key={d}
          className={`tdp-day${isToday ? " tdp-today" : ""}${isSel ? " tdp-selected" : ""}`}
          onClick={() => { onSelect(formatISO(d, curM, curY)); onClose(); }}
          type="button"
        >
          {d}
        </button>
      );
    }
    return cells;
  }

  /* ── Month grid ── */
  function renderMonths() {
    return MONTHS_SHORT.map((name, i) => (
      <button
        key={i}
        className={`tdp-month-item${i === curM && curY === initY ? " tdp-selected" : ""}${i === todayCE.getMonth() && curY === todayCE.getFullYear() ? " tdp-today" : ""}`}
        onClick={() => { setCurM(i); setView("days"); }}
        type="button"
      >
        {name}
      </button>
    ));
  }

  /* ── Year grid ── */
  function renderYears() {
    const years = Array.from({ length: 12 }, (_, i) => yearPage + i);
    return years.map((y) => (
      <button
        key={y}
        className={`tdp-month-item${y === curY ? " tdp-selected" : ""}${y === todayCE.getFullYear() ? " tdp-today" : ""}`}
        onClick={() => { setCurY(y); setView("months"); }}
        type="button"
      >
        {toDisplayYear(y, "CE")}
      </button>
    ));
  }

  return createPortal(
    <div
      ref={popRef}
      className="tdp-popup"
      style={{ top: pos.top, left: pos.left, minWidth: Math.max(pos.width, 300) }}
    >
      {/* Header */}
      <div className="tdp-header">
        <button
          className="tdp-nav"
          type="button"
          onClick={() => {
            if (view === "days") {
              if (curM === 0) { setCurM(11); setCurY(y => y - 1); }
              else setCurM(m => m - 1);
            } else if (view === "years") {
              setYearPage(p => p - 12);
            }
          }}
        >
          <i className="fas fa-chevron-left" />
        </button>

        <button
          className="tdp-title"
          type="button"
          onClick={() => setView(v => v === "days" ? "months" : v === "months" ? "years" : "days")}
        >
          {view === "days" && <>{MONTHS[curM]} {toDisplayYear(curY, "CE")}</>}
          {view === "months" && <>{toDisplayYear(curY, "CE")}</>}
          {view === "years" && <>{toDisplayYear(yearPage, "CE")} – {toDisplayYear(yearPage + 11, "CE")}</>}
          <i className="fas fa-chevron-down" style={{ fontSize: "0.7rem", marginLeft: "0.4rem", opacity: 0.6 }} />
        </button>

        <button
          className="tdp-nav"
          type="button"
          onClick={() => {
            if (view === "days") {
              if (curM === 11) { setCurM(0); setCurY(y => y + 1); }
              else setCurM(m => m + 1);
            } else if (view === "years") {
              setYearPage(p => p + 12);
            }
          }}
        >
          <i className="fas fa-chevron-right" />
        </button>
      </div>

      {/* Body */}
      {view === "days" && (
        <>
          <div className="tdp-dow-row">
            {DAYS.map(d => <div key={d} className="tdp-dow">{d}</div>)}
          </div>
          <div className="tdp-grid">{renderDays()}</div>
        </>
      )}
      {view === "months" && <div className="tdp-month-grid">{renderMonths()}</div>}
      {view === "years"  && <div className="tdp-month-grid">{renderYears()}</div>}

      {/* Footer */}
      <div className="tdp-footer">
        <button
          className="tdp-today-btn"
          type="button"
          onClick={() => {
            const t = new Date();
            setCurY(t.getFullYear()); setCurM(t.getMonth()); setView("days");
            onSelect(formatISO(t.getDate(), t.getMonth(), t.getFullYear()));
            onClose();
          }}
        >
          <i className="fas fa-calendar-day me-1" />วันนี้
        </button>
        <button className="tdp-clear-btn" type="button" onClick={() => { onSelect(""); onClose(); }}>
          <i className="fas fa-times me-1" />ล้างค่า
        </button>
      </div>
    </div>,
    document.body
  );
}

/* ── Public Component ───────────────────────────────────────────── */
interface ThaiDatePickerProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  label?: string;
}

export default function ThaiDatePicker({ value, onChange, placeholder = "เลือกวันที่" }: ThaiDatePickerProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const inputRef = useRef<HTMLDivElement>(null);

  function openPicker() {
    if (inputRef.current)
      setAnchor(inputRef.current.getBoundingClientRect());
    setOpen(true);
  }

  const parsed = parseISO(value);
  const display = parsed
    ? `${String(parsed.d).padStart(2,"0")} ${MONTHS[parsed.m]} ${toDisplayYear(parsed.y, "CE")}`
    : "";

  return (
    <div className="tdp-wrapper" ref={inputRef}>
      <div className={`tdp-input${open ? " tdp-input--open" : ""}${value ? " tdp-input--filled" : ""}`} onClick={openPicker}>
        <i className="fas fa-calendar-alt tdp-input-icon" />
        <span className={value ? "tdp-input-value" : "tdp-input-placeholder"}>
          {display || placeholder}
        </span>
        {value && (
          <button
            className="tdp-input-clear"
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(""); }}
          >
            <i className="fas fa-times" />
          </button>
        )}
      </div>

      {open && anchor && (
        <Calendar
          value={value}
          onSelect={onChange}
          onClose={() => setOpen(false)}
          anchor={anchor}
        />
      )}
    </div>
  );
}
