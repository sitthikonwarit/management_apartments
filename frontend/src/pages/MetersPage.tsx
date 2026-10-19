import LiveMeterDashboard from "../components/LiveMeterDashboard";
import { useEffect, useState, useMemo, useRef, useLayoutEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Select from "react-select";
import { metersApi, roomsApi, tenantsApi } from "../api/client";
import { useBreadcrumb } from "../context/BreadcrumbContext";
import { useAppConfig } from "../context/AppConfigContext";
import CustomSelect2 from "../components/CustomSelect2";
import ToolbarActionsMenu from "../components/ToolbarActionsMenu";
import ColResizeHandle from "../components/ColResizeHandle";
import PinMenuPopup, { type PinMenuState } from "../components/PinMenuPopup";
import EmptyState from "../components/EmptyState";
import { usePersistedViewMode } from "../utils/usePersistedViewMode";
import { useColumnWidths, useColumnVisibility, useRowOrder } from "../utils/useColumnWidths";
import { tenantDisplayName } from "../utils/tenantName";
import { findTenantForRoom } from "../utils/tenantRoom";
import { toDisplayYear, thaiDateTimeString, thaiDateOnlyString, normalizeYearToCE } from "../utils/yearFormat";
import { useLiveRefreshTick } from "../utils/useLiveSync";
import { toastSuccess, toastError } from "../utils/toast";

// ── Types ─────────────────────────────────────────────────────────────────────
type PageView = "list" | "details" | "form";
type ListViewMode = "list" | "grid" | "table";
type PinDir = "left" | "right" | false;
interface ColDef {
  key: string; header: string; visible: boolean;
  pinnable: boolean; pin: PinDir; thClass?: string; tdClass?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const THAI_MONTHS = [
  "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม",
];

const DETAIL_COLS: ColDef[] = [
  { key:"room",        header:"เลขห้อง",     visible:true, pinnable:true, pin:"left",  thClass:"text-center", tdClass:"text-center" },
  { key:"tenant",      header:"ผู้เช่า",      visible:true, pinnable:true, pin:false },
  { key:"ePrev",       header:"ไฟก่อน",       visible:true, pinnable:true, pin:false,   thClass:"text-end",    tdClass:"text-end" },
  { key:"eCurr",       header:"ไฟนี้",         visible:true, pinnable:true, pin:false,   thClass:"text-end",    tdClass:"text-end" },
  { key:"eUnit",       header:"หน่วยไฟ",       visible:true, pinnable:true, pin:false,   thClass:"text-end",    tdClass:"text-end" },
  { key:"wPrev",       header:"น้ำก่อน",       visible:true, pinnable:true, pin:false,   thClass:"text-end",    tdClass:"text-end" },
  { key:"wCurr",       header:"น้ำนี้",         visible:true, pinnable:true, pin:false,   thClass:"text-end",    tdClass:"text-end" },
  { key:"wUnit",       header:"หน่วยน้ำ",       visible:true, pinnable:true, pin:false,   thClass:"text-end",    tdClass:"text-end" },
  { key:"lastUpdated", header:"อัปเดตล่าสุด",  visible:true, pinnable:true, pin:"right", thClass:"text-end",    tdClass:"text-end" },
];

const FORM_COLS: ColDef[] = [
  { key:"room",    header:"เลขห้อง",  visible:true, pinnable:true, pin:"left",  thClass:"text-center", tdClass:"text-center" },
  { key:"tenant",  header:"ผู้เช่า",  visible:true, pinnable:true, pin:false },
  { key:"ePrev",   header:"ไฟก่อน",   visible:true, pinnable:true, pin:false,   thClass:"text-end",    tdClass:"text-end" },
  { key:"eCurr",   header:"ไฟนี้",    visible:true, pinnable:true, pin:false,   thClass:"text-end",    tdClass:"text-end" },
  { key:"eUnit",   header:"หน่วยไฟ",  visible:true, pinnable:true, pin:false,   thClass:"text-end",    tdClass:"text-end" },
  { key:"wPrev",   header:"น้ำก่อน",  visible:true, pinnable:true, pin:false,   thClass:"text-end",    tdClass:"text-end" },
  { key:"wCurr",   header:"น้ำนี้",   visible:true, pinnable:true, pin:false,   thClass:"text-end",    tdClass:"text-end" },
  { key:"wUnit",   header:"หน่วยน้ำ", visible:true, pinnable:true, pin:false,   thClass:"text-end",    tdClass:"text-end" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function padZ(n: number) { return String(n).padStart(2, "0"); }

// หมายเหตุ: monthYear ของมิเตอร์เก็บเป็นปี ค.ศ. ตรงๆ อยู่แล้ว (เหมือนบิล) — label นี้แปลงเป็นปีที่ผู้ใช้
// เลือกไว้ในหน้าตั้งค่า (พ.ศ./ค.ศ.) แค่ตอนแสดงผลเท่านั้น ไม่กระทบข้อมูลที่เก็บจริง
function monthYearLabel(my: string) {
  if (!my) return "";
  const [m, y] = my.split("/");
  const yearOut = toDisplayYear(parseInt(y, 10) || 0, "CE");
  return `${THAI_MONTHS[parseInt(m, 10) - 1] ?? m} ${yearOut}`;
}

function myScore(my: string) {
  const [m, y] = my.split("/");
  return parseInt(y, 10) * 12 + parseInt(m, 10);
}

function prevMY(my: string) {
  if (!my) return "";
  const [m, y] = my.split("/");
  let mi = parseInt(m, 10) - 1, yi = parseInt(y, 10);
  if (mi <= 0) { mi = 12; yi--; }
  return `${padZ(mi)}/${yi}`;
}

// base = 10^จำนวนหลักเลขมิเตอร์ (ตั้งค่าได้ใน Settings, ค่าเริ่มต้น 4 หลัก = 10000) — ใช้ตอนมิเตอร์วนรอบ
function calcUnits(curr: any, prev: any, base = 10000): number | null {
  if (curr === "" || curr == null || prev === "" || prev == null) return null;
  const c = Number(curr), p = Number(prev);
  if (isNaN(c) || isNaN(p)) return null;
  if (c >= p) return c - p;
  return (c + base) - p; // rollover เมื่อมิเตอร์วนรอบกลับไป 0
}

function clampMeterValue(v: string, maxVal = 9999) {
  const n = parseInt(v, 10);
  return isNaN(n) || v === "" ? "" : String(Math.min(maxVal, Math.max(0, n)));
}

// สร้าง room list จาก savedKeys เป็น source of truth
// ห้องที่ถูกลบออกจากระบบแล้วจะยังแสดงเป็น placeholder
function findRecord(allRecords: any[], my: string): any | undefined {
  if (!my) return undefined;
  const qyN = normYear(my);
  const [qm] = my.split("/");
  const qmi = parseInt(qm, 10);
  return allRecords.find((r) => {
    const [rm] = r.monthYear.split("/");
    return parseInt(rm, 10) === qmi && normYear(r.monthYear) === qyN;
  });
}

function normYear(my: string): string {
  const parts = my.split("/");
  if (parts.length !== 2) return "";
  const y = parseInt(parts[1], 10);
  return isNaN(y) ? "" : String(normalizeYearToCE(y));
}

function buildRoomsFromKeys(savedKeys: Set<string>, allRooms: any[], recordData?: Record<string, any>): any[] {
  return Array.from(savedKeys)
    .map((key) => {
      const found = allRooms.find((r) => r.number === key) ?? allRooms.find((r) => r.id === key);
      if (found) {
        const rd = recordData?.[key] ?? {};
        const hadElectric = rd.currElectric != null && rd.currElectric !== "" || rd.prevElectric != null && rd.prevElectric !== "";
        const hadWater    = rd.currWater    != null && rd.currWater    !== "" || rd.prevWater    != null && rd.prevWater    !== "";
        return {
          ...found,
          meterElectricActive: found.meterElectricActive || hadElectric,
          meterWaterActive:    found.meterWaterActive    || hadWater,
        };
      }
      return { id: key, number: key, isDeleted: true, isActive: false, meterElectricActive: true, meterWaterActive: true };
    })
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true, sensitivity: "base" }));
}

// ── CSV Import ────────────────────────────────────────────────────────────────
interface CsvRow {
  monthYear: string; roomNumber: string;
  electric: string; water: string;
  prevElectric: string; prevWater: string;
  tenantName: string;
}
interface ImportMonth { monthYear: string; label: string; rows: CsvRow[]; selected: boolean; alreadyExists: boolean; }

// รองรับ 2 format:
//   Simple (4 col):   เดือน/ปี, เลขห้อง, ไฟฟ้า, น้ำ
//   Detailed (10 col): เดือน/ปี, เลขห้อง, ผู้เช่า, ไฟก่อน, ไฟนี้, หน่วยไฟ, น้ำก่อน, น้ำนี้, หน่วยน้ำ, วันที่
//
// คอลัมน์ "เดือน/ปี" อ่านได้หลายรูปแบบ ไม่บังคับ MM/YYYY อย่างเดียว: YYYY-MM, YYYY-MM-DD,
// หรือมีชื่อเดือนปนตัวเลข (26-Jun, Jun-2026, มิถุนายน 2569, 26 มิ.ย. 69 ฯลฯ) — รวมถึงกรณี Excel
// แปลงคอลัมน์นี้เป็นวันที่ให้เองอัตโนมัติจนเหลือแค่ "26-Jun" (ไม่มีปีอยู่ในไฟล์จริงๆ) ซึ่งจะถาม
// ผู้ใช้ว่าให้ใช้ปีไหนแทน แทนที่จะขึ้น "ไม่พบข้อมูลในไฟล์" เฉยๆ
const MONTH_ABBR_EN = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
const MONTH_ABBR_TH = ["ม.ค","ก.พ","มี.ค","เม.ย","พ.ค","มิ.ย","ก.ค","ส.ค","ก.ย","ต.ค","พ.ย","ธ.ค"];
const MONTH_FULL_TH = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];

function findMonthIndex(token: string): number | null {
  const clean = token.toLowerCase().replace(/\./g, "");
  const en = MONTH_ABBR_EN.findIndex((m) => clean.startsWith(m));
  if (en !== -1) return en;
  const thAbbr = MONTH_ABBR_TH.findIndex((m) => clean === m.replace(/\./g, ""));
  if (thAbbr !== -1) return thAbbr;
  const thFull = MONTH_FULL_TH.findIndex((m) => token.trim() === m);
  if (thFull !== -1) return thFull;
  return null;
}

// year: null = อ่านเดือนออกแต่ไม่รู้ปี (ต้องถามผู้ใช้) — คืน null ทั้งก้อนถ้าอ่านไม่ออกเลยแม้แต่เดือน
function parseFlexibleMonthYear(raw: string): { month: number; year: number | null } | null {
  const s = raw.trim();
  if (!s) return null;

  const slash = s.split("/");
  if (slash.length === 2 && /^\d{1,2}$/.test(slash[0]) && /^\d{2,4}$/.test(slash[1])) {
    const m = parseInt(slash[0], 10), y = parseInt(slash[1], 10);
    if (m >= 1 && m <= 12) return { month: m, year: normalizeYearToCE(y) };
  }

  const iso = s.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/);
  if (iso) {
    const y = parseInt(iso[1], 10), m = parseInt(iso[2], 10);
    if (m >= 1 && m <= 12) return { month: m, year: y };
  }

  // วันที่เต็มแบบตัวเลขล้วน 3 ส่วนคั่นด้วย / (เช่น 2/1/2026 = เดือน 2 วัน 1 ปี 2026, พบบ่อยตอน Excel
  // ส่งออกวันที่ทั้งก้อนแทนที่จะเป็นแค่เดือน/ปี) — หาส่วนที่เป็นปี (≥1000) แล้วเดาว่าอีก 2 ส่วนไหนคือเดือน
  // โดยตัวที่เกิน 12 ต้องเป็นวันแน่ๆ (ไม่ใช่เดือน) ถ้ากำกวมทั้งคู่ ≤12 ถือว่าส่วนแรกคือเดือน (ตามธรรมเนียม เดือน/ปี ของระบบนี้)
  const dateParts = s.split("/");
  if (dateParts.length === 3 && dateParts.every((p) => /^\d{1,4}$/.test(p))) {
    const nums = dateParts.map((p) => parseInt(p, 10));
    const yearIdx = nums.findIndex((n) => n >= 1000);
    if (yearIdx !== -1) {
      const others = nums.filter((_, i) => i !== yearIdx);
      const month = others[0] > 12 ? others[1] : others[0];
      if (month >= 1 && month <= 12) return { month, year: normalizeYearToCE(nums[yearIdx]) };
    }
  }

  const tokens = s.split(/[\s\-\/,]+/).filter(Boolean);
  let month: number | null = null;
  const numbers: number[] = [];
  for (const tok of tokens) {
    const mi = findMonthIndex(tok);
    if (mi !== null) { month = mi + 1; continue; }
    if (/^\d+$/.test(tok)) numbers.push(parseInt(tok, 10));
  }
  if (month !== null) {
    // ปีต้องเป็นเลข 4 หลัก (ค.ศ. หรือ พ.ศ. ก็ได้ ทั้งคู่ล้วนเกิน 1000) — เลขสั้นกว่านั้น (เช่น "26"
    // ที่เป็นวันที่ หรือปี พ.ศ. แบบย่อ 2 หลัก) กำกวมเกินกว่าจะเดา ถือว่ายังไม่รู้ปี ต้องถามผู้ใช้
    const yearToken = numbers.find((n) => n >= 1000);
    return { month, year: yearToken !== undefined ? normalizeYearToCE(yearToken) : null };
  }
  return null;
}

interface RawMeterCsvEntry {
  month: number; year: number | null; rawDate: string; roomNumber: string;
  electric: string; water: string; prevElectric: string; prevWater: string; tenantName: string;
}

function parseMeterCsvRaw(text: string): RawMeterCsvEntry[] {
  const entries: RawMeterCsvEntry[] = [];
  const lines = text.split(/\r?\n/).filter(Boolean);
  const start = /^\d/.test(lines[0]?.replace(/^﻿/, "").trim()) ? 0 : 1;
  for (let i = start; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.replace(/^"|"$/g, "").trim());
    if (cols.length < 3) continue;
    const rawMY = cols[0];
    const parsed = parseFlexibleMonthYear(rawMY);
    if (!parsed) continue; // อ่านไม่ออกเลยแม้แต่เดือน ข้ามแถวนี้
    const roomNumber = cols[1];
    // Detailed: ≥9 col และ col[5] เป็นตัวเลข (หน่วยไฟ) หรือว่าง — ไม่ใช่ชื่อคน
    const isDetailed = cols.length >= 9 && (cols[5] === "" || !isNaN(Number(cols[5])));
    // นำเข้าได้ (4 คอลัมน์เดิม): เดือน/ปี, เลขห้อง, ไฟฟ้า, น้ำ
    // ต่อท้ายได้อีก 3 คอลัมน์ที่ไม่บังคับ (จะเว้นว่างหรือไม่ใส่เลยก็ได้): ไฟก่อน, น้ำก่อน, ผู้เช่า(ชื่อหรือรหัส)
    const electric     = isDetailed ? (cols[4] ?? "") : (cols[2] ?? "");
    const water        = isDetailed ? (cols[7] ?? "") : (cols[3] ?? "");
    const prevElectric = isDetailed ? (cols[3] ?? "") : (cols[4] ?? "");
    const prevWater    = isDetailed ? (cols[6] ?? "") : (cols[5] ?? "");
    const tenantName   = isDetailed ? (cols[2] ?? "") : (cols[6] ?? "");
    entries.push({ month: parsed.month, year: parsed.year, rawDate: rawMY, roomNumber, electric, water, prevElectric, prevWater, tenantName });
  }
  return entries;
}

function ImportModal({ file, rooms, allRecords, onClose, onImport }: {
  file: File; rooms: any[]; allRecords: any[];
  onClose: () => void;
  onImport: (months: ImportMonth[], includeAllRooms: boolean, fillCurrentTenantName: boolean) => void;
}) {
  const [rawEntries, setRawEntries] = useState<RawMeterCsvEntry[] | null>(null);
  const [fallbackYear, setFallbackYear] = useState<string>(String(new Date().getFullYear()));
  const [months, setMonths] = useState<ImportMonth[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeAllRooms, setIncludeAllRooms] = useState(true);
  const [fillCurrentTenantName, setFillCurrentTenantName] = useState(true);

  useEffect(() => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setRawEntries(parseMeterCsvRaw(text));
      setLoading(false);
    };
    reader.readAsText(file);
  }, [file]);

  const yearlessEntries = useMemo(() => rawEntries?.filter((e) => e.year === null) ?? [], [rawEntries]);
  const needsYearPrompt = rawEntries !== null && yearlessEntries.length > 0 && months.length === 0;

  function buildMonths(entries: RawMeterCsvEntry[], yearForMissing: number) {
    const rows: CsvRow[] = entries.map((e) => ({
      monthYear: `${padZ(e.month)}/${e.year ?? yearForMissing}`,
      roomNumber: e.roomNumber, electric: e.electric, water: e.water,
      prevElectric: e.prevElectric, prevWater: e.prevWater, tenantName: e.tenantName,
    }));
    const map = new Map<string, CsvRow[]>();
    rows.forEach((r) => {
      if (!map.has(r.monthYear)) map.set(r.monthYear, []);
      map.get(r.monthYear)!.push(r);
    });
    setMonths(
      Array.from(map.entries())
        .sort(([a], [b]) => myScore(b) - myScore(a))
        .map(([my, csvRows]) => ({
          monthYear: my,
          label: monthYearLabel(my),
          rows: csvRows,
          selected: true,
          alreadyExists: allRecords.some((r) => r.monthYear === my),
        }))
    );
  }

  // ไม่มีแถวไหนขาดปีเลย จัดกลุ่มเป็นเดือนได้ทันทีโดยไม่ต้องถาม
  useEffect(() => {
    if (rawEntries && yearlessEntries.length === 0) buildMonths(rawEntries, new Date().getFullYear());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawEntries]);

  function toggle(my: string) {
    setMonths((prev) => prev.map((m) => m.monthYear === my ? { ...m, selected: !m.selected } : m));
  }

  const selected = months.filter((m) => m.selected && !m.alreadyExists);

  return (
    <div className="confirm-overlay" onClick={onClose}>
      <div className="confirm-dialog" style={{ maxWidth: 520, width: "90%", textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
        <div className="d-flex align-items-center gap-2 mb-3">
          <i className="fas fa-file-import text-primary" style={{ fontSize: "1.4rem" }} />
          <h6 className="confirm-title mb-0" style={{ textAlign: "left" }}>เลือกเดือนที่ต้องการนำเข้า</h6>
        </div>

        {loading ? (
          <div className="text-center p-4"><div className="spinner-border spinner-border-sm" style={{ color: "var(--color-primary)" }} /></div>
        ) : needsYearPrompt ? (
          <>
            <div className="alert alert-warning" style={{ fontSize: "0.85rem" }}>
              <i className="fas fa-exclamation-triangle me-2" />
              พบ {yearlessEntries.length} แถวที่ไม่มีปีระบุในไฟล์ (เช่น <code>{yearlessEntries[0].rawDate}</code>) — อาจเกิดจาก Excel แปลงคอลัมน์เดือน/ปีเป็นวันที่ให้เองจนปีหายไป
            </div>
            <label className="form-label small fw-bold">ปีที่ต้องการใช้สำหรับแถวเหล่านี้ (ค.ศ.)</label>
            <input type="number" className="form-control mb-3" value={fallbackYear}
              onChange={(e) => setFallbackYear(e.target.value)} />
            <div className="confirm-actions">
              <button className="btn btn-outline-secondary" onClick={onClose}>ยกเลิก</button>
              <button className="btn btn-primary"
                onClick={() => rawEntries && buildMonths(rawEntries, parseInt(fallbackYear, 10) || new Date().getFullYear())}>
                <i className="fas fa-check me-1" />ใช้ปีนี้ ดำเนินการต่อ
              </button>
            </div>
          </>
        ) : months.length === 0 ? (
          <p className="text-muted text-center">ไม่พบข้อมูลในไฟล์ CSV</p>
        ) : (
          <>
            <p className="text-muted mb-2" style={{ fontSize: "0.85rem" }}>
              พบ {months.length} เดือน
            </p>
            <div style={{ background: "var(--color-background)", border: "1px solid var(--color-light)", borderRadius: "var(--border-radius-1)", padding: "6px 10px", marginBottom: 10, fontSize: "0.78rem", color: "var(--color-dark-variant)", fontFamily: "monospace" }}>
              <i className="fas fa-info-circle me-1" style={{ fontFamily: "inherit" }} />
              รองรับ 2 รูปแบบ: <strong>นำเข้าได้</strong> (เดือน/ปี, ห้อง, ไฟ, น้ำ, <em>ไฟก่อน, น้ำก่อน, ผู้เช่า</em> — 3 คอลัมน์ท้ายไม่บังคับ) และ <strong>ละเอียด</strong> (Export จากระบบ)
              <span className="ms-2" style={{ opacity: 0.7 }}>เช่น&nbsp;&nbsp;06/2568,101,1234,56 หรือ 06/2568,101,1234,56,1200,50,CUS-123</span>
              <br /><span style={{ opacity: 0.7 }}>ช่องผู้เช่าใส่ชื่อหรือรหัสผู้เช่าก็ได้ ถ้าตรงกับรหัสที่มีอยู่จริงจะดึงชื่อปัจจุบันมาให้อัตโนมัติ</span>
            </div>
            <div className="nicescrollbar" style={{ maxHeight: 300, overflowY: "auto", border: "1px solid var(--color-light)", borderRadius: "var(--border-radius-1)", padding: "0.5rem" }}>
              {months.map((m) => (
                <label key={m.monthYear}
                  className="d-flex align-items-center gap-2 p-2"
                  style={{ cursor: m.alreadyExists ? "not-allowed" : "pointer", opacity: m.alreadyExists ? 0.5 : 1, borderRadius: "var(--border-radius-1)" }}>
                  <input type="checkbox" className="form-check-input"
                    checked={m.selected && !m.alreadyExists}
                    disabled={m.alreadyExists}
                    onChange={() => toggle(m.monthYear)} />
                  <span className="flex-grow-1">
                    <strong>{m.label}</strong>
                    <small className="text-muted ms-2">{m.rows.length} ห้องในไฟล์</small>
                  </span>
                  {m.alreadyExists && <span className="badge bg-warning text-dark" style={{ fontSize: "0.72rem" }}>มีอยู่แล้ว</span>}
                </label>
              ))}
            </div>
            <p className="mt-2 mb-2" style={{ fontSize: "0.82rem", color: "var(--color-info-dark)" }}>
              เลือก {selected.length} เดือน
            </p>
            <label className="d-flex align-items-center gap-2" style={{ cursor: "pointer" }}>
              <input type="checkbox" className="form-check-input"
                checked={includeAllRooms} onChange={(e) => setIncludeAllRooms(e.target.checked)} />
              <span style={{ fontSize: "0.85rem" }}>รวมห้องปัจจุบันที่ไม่มีในไฟล์ด้วย (ห้องที่ไม่มีในไฟล์จะได้ค่าว่าง)</span>
            </label>
            {selected.some((m) => m.rows.some((r) => !r.tenantName)) && (
              <label className="d-flex align-items-center gap-2 mt-2" style={{ cursor: "pointer" }}>
                <input type="checkbox" className="form-check-input"
                  checked={fillCurrentTenantName} onChange={(e) => setFillCurrentTenantName(e.target.checked)} />
                <span style={{ fontSize: "0.85rem" }}>เติมชื่อผู้เช่าปัจจุบันให้ห้องที่ไฟล์ไม่มีชื่อผู้เช่า (ไม่ติ๊ก = ปล่อยว่าง)</span>
              </label>
            )}

            <div className="confirm-actions mt-3">
              <button className="btn btn-outline-secondary" onClick={onClose}>ยกเลิก</button>
              <button className="btn btn-primary" disabled={selected.length === 0}
                onClick={() => onImport(selected, includeAllRooms, fillCurrentTenantName)}>
                <i className="fas fa-file-import me-1" />ยืนยันนำเข้า ({selected.length} เดือน)
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Column-pin hook ───────────────────────────────────────────────────────────
function usePinTable(initial: ColDef[], storageKey: string, widthDefaults: Record<string, number>) {
  const [cols, setCols, moveColumn] = useColumnVisibility(storageKey, initial);
  const [pinMenu, setPinMenu] = useState<PinMenuState | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const { widths, startResize } = useColumnWidths(storageKey, widthDefaults);

  const visible = cols.filter((c) => c.visible);
  const ordered = [
    ...visible.filter((c) => c.pin === "left"),
    ...visible.filter((c) => !c.pin),
    ...visible.filter((c) => c.pin === "right"),
  ];

  useLayoutEffect(() => {
    const tbl = tableRef.current; if (!tbl) return;
    const ths = Array.from(tbl.querySelectorAll<HTMLElement>("thead tr th"));
    const rows = Array.from(tbl.querySelectorAll<HTMLTableRowElement>("tbody tr"))
      .map((tr) => Array.from(tr.querySelectorAll<HTMLElement>("td")));
    let lo = 0;
    ordered.forEach((col, i) => {
      if (col.pin !== "left") return;
      const th = ths[i]; if (!th) return;
      th.style.left = `${lo}px`;
      rows.forEach((r) => { if (r[i]) r[i].style.left = `${lo}px`; });
      lo += th.offsetWidth;
    });
    let ro = 0;
    [...ordered].reverse().forEach((col, ri) => {
      if (col.pin !== "right") return;
      const i = ordered.length - 1 - ri;
      const th = ths[i]; if (!th) return;
      th.style.right = `${ro}px`;
      rows.forEach((r) => { if (r[i]) r[i].style.right = `${ro}px`; });
      ro += th.offsetWidth;
    });
  });

  function pin(key: string, dir: PinDir) {
    setCols((prev) => prev.map((c) => c.key === key ? { ...c, pin: dir } : c));
  }
  function openMenu(e: React.MouseEvent, key: string) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPinMenu({ colKey: key, x: Math.max(0, r.right - 160), y: r.bottom + 4 });
  }
  return { tableRef, cols, ordered, pinMenu, setPinMenu, openMenu, pin, widths, startResize, moveColumn };
}

// ── PinMenuPopup (shared component — ดู components/PinMenuPopup.tsx) ──────────

// ── UnitCell ──────────────────────────────────────────────────────────────────
function UnitCell({ units, prevUnits }: { units: number | null; prevUnits: number | null }) {
  if (units === null) return <span className="text-muted">-</span>;
  const diff  = prevUnits !== null ? units - prevUnits : null;
  const icon  = diff === null ? "" : diff > 0 ? "fa-arrow-up" : diff < 0 ? "fa-arrow-down" : "fa-minus";
  const color = diff === null ? undefined : diff > 0 ? "var(--color-danger)" : diff < 0 ? "var(--color-success)" : "var(--color-info-dark)";
  return (
    <div className="d-flex flex-column align-items-end" style={{ lineHeight: 1.3 }}>
      <div className="d-flex align-items-center gap-1">
        <span className="fw-bold">{units}</span>
        {diff !== null && (
          <span style={{ fontSize: "0.72em", color }}>
            <i className={`fas ${icon}`} />
            {diff !== 0 && ` ${Math.abs(diff)}`}
          </span>
        )}
      </div>
      {prevUnits !== null && (
        <span style={{ fontSize: "0.72rem", color: "var(--color-info-dark)" }}>
          ก่อน: {prevUnits}
        </span>
      )}
    </div>
  );
}

// ── renderMeterCellForPrint (ใช้พิมพ์หลายเดือนพร้อมกันจากหน้ารายการ) ─────────────
function renderMeterCellForPrint(colKey: string, room: any, record: any, prevRecord: any, prevPrevRecord: any, tenants: any[], meterBase = 10000) {
  const d = record.data?.[room.number] ?? record.data?.[room.id] ?? {};
  const prevD = prevRecord?.data?.[room.number] ?? prevRecord?.data?.[room.id] ?? {};
  const prevPrevD = prevPrevRecord?.data?.[room.number] ?? prevPrevRecord?.data?.[room.id] ?? {};
  const currentTenant = findTenantForRoom(tenants, room);
  const tenantDisplay: string | null = d.tenantName !== undefined
    ? (d.tenantName || null)
    : (currentTenant ? tenantDisplayName(currentTenant) : null);

  const prevE = d.prevElectric !== "" && d.prevElectric != null ? d.prevElectric : prevD.currElectric ?? "-";
  const prevW = d.prevWater    !== "" && d.prevWater    != null ? d.prevWater    : prevD.currWater    ?? "-";
  const ue = prevE !== "-" ? calcUnits(d.currElectric, prevE, meterBase) : null;
  const uw = prevW !== "-" ? calcUnits(d.currWater,    prevW, meterBase) : null;
  const prevUe = prevD.prevElectric != null && prevD.prevElectric !== ""
    ? calcUnits(prevD.currElectric, prevD.prevElectric, meterBase)
    : calcUnits(prevD.currElectric, prevPrevD.currElectric, meterBase);
  const prevUw = prevD.prevWater != null && prevD.prevWater !== ""
    ? calcUnits(prevD.currWater, prevD.prevWater, meterBase)
    : calcUnits(prevD.currWater, prevPrevD.currWater, meterBase);

  const off = <span className="meter-disabled-text">ปิดใช้งาน</span>;
  switch (colKey) {
    case "room": return (
      <span style={{ fontWeight: 700, color: room.isDeleted ? "var(--color-danger)" : "var(--color-primary)" }}>
        ห้อง {room.number}
      </span>
    );
    case "tenant": return tenantDisplay
      ? <span style={{ color: "var(--color-dark)" }}>{tenantDisplay}</span>
      : <em className="text-muted">ห้องว่าง</em>;
    case "ePrev": return room.meterElectricActive ? (prevE === "-" ? "-" : (isNaN(parseInt(prevE, 10)) ? "-" : parseInt(prevE, 10))) : off;
    case "eCurr": return room.meterElectricActive ? (d.currElectric ?? "-") : off;
    case "eUnit": return room.meterElectricActive ? <UnitCell units={ue} prevUnits={prevUe} /> : off;
    case "wPrev": return room.meterWaterActive    ? (prevW === "-" ? "-" : (isNaN(parseInt(prevW, 10)) ? "-" : parseInt(prevW, 10))) : off;
    case "wCurr": return room.meterWaterActive    ? (d.currWater ?? "-") : off;
    case "wUnit": return room.meterWaterActive    ? <UnitCell units={uw} prevUnits={prevUw} /> : off;
    case "lastUpdated": {
      const lu = d.lastUpdated ?? d.updatedAt;
      return lu
        ? <span className="text-muted" style={{ fontSize: "0.85rem" }}>{lu.slice(0, 16).replace("T", " ")}</span>
        : <span className="text-muted">-</span>;
    }
    default: return "-";
  }
}

// ── MeterDetailView ───────────────────────────────────────────────────────────
function MeterDetailView({ record, rooms, tenants, allRecords, towers, onEdit, onDelete }: {
  record: any; rooms: any[]; tenants: any[]; allRecords: any[]; towers: any[];
  onEdit: () => void; onDelete: () => Promise<void>;
}) {
  const { config } = useAppConfig();
  const meterBase = Math.pow(10, config.meterDigits || 4);
  const [search, setSearch] = useState("");
  const [filterTowers, setFilterTowers] = useState<string[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingLocal, setDeletingLocal] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printColKeys, setPrintColKeys] = useState<Set<string>>(
    () => new Set(DETAIL_COLS.map((c) => c.key))
  );
  const [printRowIds, setPrintRowIds] = useState<Set<string>>(new Set());
  const [printRoomSearch, setPrintRoomSearch] = useState("");
  const [printRoomFilter, setPrintRoomFilter] = useState<"all" | "occupied" | "vacant">("all");
  const [printTowerFilter, setPrintTowerFilter] = useState<string[]>([]);

  const towerOptions = useMemo(() => {
    const active = towers.filter((t) => t.isActive !== false);
    const opts = active.map((t: any) => ({ value: t.id, label: t.name }));
    opts.push({ value: "unassigned", label: "ไม่ระบุตึก" });
    return opts;
  }, [towers]);
  const { tableRef, cols, ordered, pinMenu, setPinMenu, openMenu, pin, widths, startResize, moveColumn } = usePinTable(DETAIL_COLS, "meters-detail", {
    room: 90, tenant: 150, ePrev: 90, eCurr: 90, eUnit: 100, wPrev: 90, wCurr: 90, wUnit: 100, lastUpdated: 150,
  });

  const prevR     = findRecord(allRecords, prevMY(record.monthYear));
  const prevPrevR = findRecord(allRecords, prevMY(prevMY(record.monthYear)));

  const savedKeys = new Set(Object.keys(record.data ?? {}));
  const hasSaved  = savedKeys.size > 0;

  // snapshot ห้องตอน mount ป้องกันห้องใหม่โผล่ใน record เก่าที่ยังไม่มีข้อมูล
  const [snapshotNumbers] = useState<Set<string>>(() =>
    new Set(
      rooms
        .filter((r) => r.isActive !== false && (r.meterElectricActive || r.meterWaterActive))
        .map((r) => r.number)
    )
  );

  // hasSaved=true → ใช้ savedKeys เป็น source of truth (รวมห้องที่ถูกลบด้วย)
  // hasSaved=false → ใช้ snapshot ตอน mount (ห้องใหม่ไม่โผล่)
  const activeRooms = hasSaved
    ? buildRoomsFromKeys(savedKeys, rooms, record.data)
    : rooms
        .filter((r) => r.isActive !== false && (r.meterElectricActive || r.meterWaterActive) && snapshotNumbers.has(r.number))
        .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true, sensitivity: "base" }));

  const displayed = activeRooms.filter((r) => {
    if (filterTowers.length > 0) {
      const tid = r.towerId || "unassigned";
      if (!filterTowers.includes(tid)) return false;
    }
    if (!search) return true;
    const tenant = findTenantForRoom(tenants, r);
    const q = search.toLowerCase();
    return r.number.toLowerCase().includes(q) ||
      (tenant ? `${tenant.firstName} ${tenant.lastName}`.toLowerCase().includes(q) : false);
  });
  const { ordered: rowOrdered, moveRow } = useRowOrder("meters-detail", displayed, (r: any) => String(r.id), !!search.trim() || filterTowers.length > 0);
  const [draggingRowKey, setDraggingRowKey] = useState<string | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const [draggingColKey, setDraggingColKey] = useState<string | null>(null);
  const [dropTargetColKey, setDropTargetColKey] = useState<string | null>(null);

  function renderCell(colKey: string, room: any) {
    const d        = record.data?.[room.number]     ?? record.data?.[room.id]     ?? {};
    const prevD    = prevR?.data?.[room.number]     ?? prevR?.data?.[room.id]     ?? {};
    const prevPrevD = prevPrevR?.data?.[room.number] ?? prevPrevR?.data?.[room.id] ?? {};
    // ใช้ snapshot ที่บันทึกไว้ก่อน — ถ้าไม่มี (record เก่าก่อนเพิ่มฟีเจอร์) ค่อย fallback ผู้เช่าปัจจุบัน
    const currentTenant = findTenantForRoom(tenants, room);
    const tenantDisplay: string | null = d.tenantName !== undefined
      ? (d.tenantName || null)
      : (currentTenant ? tenantDisplayName(currentTenant) : null);

    const prevE = d.prevElectric !== "" && d.prevElectric != null ? d.prevElectric : prevD.currElectric ?? "-";
    const prevW = d.prevWater    !== "" && d.prevWater    != null ? d.prevWater    : prevD.currWater    ?? "-";
    const ue = prevE !== "-" ? calcUnits(d.currElectric, prevE, meterBase) : null;
    const uw = prevW !== "-" ? calcUnits(d.currWater,    prevW, meterBase) : null;
    const prevUe = prevD.prevElectric != null && prevD.prevElectric !== ""
      ? calcUnits(prevD.currElectric, prevD.prevElectric, meterBase)
      : calcUnits(prevD.currElectric, prevPrevD.currElectric, meterBase);
    const prevUw = prevD.prevWater != null && prevD.prevWater !== ""
      ? calcUnits(prevD.currWater, prevD.prevWater, meterBase)
      : calcUnits(prevD.currWater, prevPrevD.currWater, meterBase);

    const off = <span className="meter-disabled-text">ปิดใช้งาน</span>;
    switch (colKey) {
      case "room":   return (
        <>
          <span className="row-drag-handle" draggable
            onClick={(e) => e.stopPropagation()}
            onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(room.id)); setDraggingRowKey(String(room.id)); }}
            onDragEnd={() => { setDraggingRowKey(null); setDropTargetKey(null); }}
            title="ลากเพื่อสลับลำดับแถว">
            <i className="fas fa-grip-vertical" />
          </span>
          <span style={{ fontWeight: 700, color: room.isDeleted ? "var(--color-danger)" : "var(--color-primary)" }}>
            ห้อง {room.number}
            {room.isDeleted && <i className="fas fa-trash-alt ms-1" style={{ fontSize: "0.75em" }} title="ห้องนี้ถูกลบออกจากระบบแล้ว" />}
          </span>
        </>
      );
      case "tenant": return tenantDisplay
        ? <span style={{ color: "var(--color-dark)" }}>{tenantDisplay}</span>
        : <em className="text-muted">ห้องว่าง</em>;
      case "ePrev":  return room.meterElectricActive ? (prevE === "-" ? "-" : (isNaN(parseInt(prevE, 10)) ? "-" : parseInt(prevE, 10))) : off;
      case "eCurr":  return room.meterElectricActive ? (d.currElectric ?? "-") : off;
      case "eUnit":  return room.meterElectricActive ? <UnitCell units={ue} prevUnits={prevUe} /> : off;
      case "wPrev":  return room.meterWaterActive    ? (prevW === "-" ? "-" : (isNaN(parseInt(prevW, 10)) ? "-" : parseInt(prevW, 10))) : off;
      case "wCurr":  return room.meterWaterActive    ? (d.currWater ?? "-") : off;
      case "wUnit":  return room.meterWaterActive    ? <UnitCell units={uw} prevUnits={prevUw} /> : off;
      case "lastUpdated": {
        const lu = d.lastUpdated ?? d.updatedAt;
        return lu
          ? <span className="text-muted" style={{ fontSize: "0.85rem" }}>{lu.slice(0, 16).replace("T", " ")}</span>
          : <span className="text-muted">-</span>;
      }
      default: return "-";
    }
  }

  return (
    <div className="custom-card">
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-3">
        <h5 className="form-section-title mb-0" style={{ borderBottom: "none" }}>
          รายละเอียด: {monthYearLabel(record.monthYear)}
        </h5>
        <div className="d-flex gap-2 no-print">
          <button className="btn btn-outline-secondary d-inline-flex align-items-center" onClick={() => {
            setPrintRowIds(new Set(displayed.map((r) => r.id)));
            setPrintRoomSearch("");
            setPrintRoomFilter("all");
            setPrintTowerFilter([]);
            setShowPrintModal(true);
          }}>
            <i className="fas fa-print me-2" /><span className="btn-text">พิมพ์</span>
          </button>
          <button className="btn btn-primary d-inline-flex align-items-center" onClick={onEdit}>
            <i className="fas fa-edit me-2" /><span className="btn-text">ไปที่หน้าแก้ไข</span>
          </button>
          <button className="btn btn-danger d-inline-flex align-items-center" onClick={() => setShowDeleteConfirm(true)}>
            <i className="fas fa-trash-alt me-2" /><span className="btn-text">ลบข้อมูล</span>
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="row g-3 mb-4 no-print">
        {[
          { icon: "fa-calendar-alt text-primary",  label: "เดือน/ปี",      val: monthYearLabel(record.monthYear) },
          { icon: "fa-check-circle text-success",  label: "บันทึกแล้ว",
            val: `${activeRooms.filter(r => {
              if (r.meterElectricActive === false && r.meterWaterActive === false) return true;
              const d = record.data?.[r.number] ?? record.data?.[r.id] ?? {};
              const eFilled = r.meterElectricActive !== false && d.currElectric != null && d.currElectric !== "";
              const wFilled = r.meterWaterActive    !== false && d.currWater    != null && d.currWater    !== "";
              return eFilled || wFilled;
            }).length} / ${activeRooms.length} ห้อง` },
          { icon: "fa-calendar-day text-warning",  label: "วันที่บันทึก", val: record.recordDate ? thaiDateOnlyString(new Date(record.recordDate)) : "-" },
          { icon: "fa-clock text-info",            label: "อัปเดตล่าสุด", val: record.updatedAt ? thaiDateTimeString(new Date(record.updatedAt)) : "-" },
        ].map(({ icon, label, val }) => (
          <div key={label} className="col-6 col-md-3">
            <div className="detail-item">
              <i className={`fas ${icon}`} />
              <div>
                <div className="label">{label}</div>
                <div className="value">{val}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="row g-2 mb-3 align-items-center no-print">
        <div className="col-12 col-lg">
          <div className="search-container flex-grow-1">
            <i className="fas fa-search" />
            <input type="text" id="searchMeterDetailRoom" className="form-control"
              placeholder="ค้นหาเลขห้อง, ผู้เช่า..." style={{ paddingLeft: 40 }}
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {towerOptions.length > 1 && (
          <div className="col-12 col-md-auto" style={{ minWidth: 200 }}>
            <CustomSelect2
              inputId="filterMeterDetailTower"
              isMulti={true as any}
              value={towerOptions.filter((o) => filterTowers.includes(o.value))}
              options={towerOptions}
              onChange={(selected: any) => setFilterTowers(selected ? selected.map((o: any) => o.value) : [])}
              placeholder="กรองตามตึก..."
              closeMenuOnSelect={false as any}
            />
          </div>
        )}
      </div>

      <div className="table-responsive-wrapper mt-3 nicescrollbar" style={{ maxHeight: 538, overflow: "auto" }}>
        <table ref={tableRef} className="table-mainstyle table-hover table-resizable" style={{ minWidth: 700 }} id="meter-detail-table">
          <thead>
            <tr>
              {ordered.map((col) => {
                const pc = col.pin === "left" ? "pinned pinned-left" : col.pin === "right" ? "pinned pinned-right" : "";
                return (
                  <th key={col.key} className={`${col.thClass ?? ""} ${pc} ${draggingColKey === col.key ? "col-dragging" : ""} ${dropTargetColKey === col.key ? "col-drop-target" : ""}`}
                    style={{ width: widths[col.key] }}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", col.key); setDraggingColKey(col.key); }}
                    onDragEnd={() => { setDraggingColKey(null); setDropTargetColKey(null); }}
                    onDragOver={(e) => { e.preventDefault(); if (draggingColKey && draggingColKey !== col.key) setDropTargetColKey(col.key); }}
                    onDragLeave={() => setDropTargetColKey((k) => (k === col.key ? null : k))}
                    onDrop={(e) => { e.preventDefault(); const dragged = e.dataTransfer.getData("text/plain"); if (dragged) moveColumn(dragged, col.key); setDraggingColKey(null); setDropTargetColKey(null); }}>
                    {col.key === "ePrev" || col.key === "eCurr" || col.key === "eUnit"
                      ? <><i className="fas fa-bolt text-warning me-1" />{col.header}</>
                      : col.key === "wPrev" || col.key === "wCurr" || col.key === "wUnit"
                        ? <><i className="fas fa-tint text-primary me-1" />{col.header}</>
                        : col.header}
                    {col.pinnable && (
                      <i className={`fas fa-thumbtack pin-icon${col.pin === "left" ? " active-left" : col.pin === "right" ? " active-right" : ""}`}
                        onClick={(e) => openMenu(e, col.key)} />
                    )}
                    <ColResizeHandle onMouseDown={(e) => startResize(col.key, e)} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody id="meter-detail-table-container">
            {displayed.length === 0 ? (
              <tr><td colSpan={ordered.length} className="text-center text-muted p-5">ไม่พบข้อมูลบันทึก</td></tr>
            ) : rowOrdered.map((room) => {
              const rowKey = String(room.id);
              return (
                <tr key={room.id}
                  className={`${draggingRowKey === rowKey ? "row-dragging" : ""} ${dropTargetKey === rowKey ? "row-drop-target" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); if (draggingRowKey && draggingRowKey !== rowKey) setDropTargetKey(rowKey); }}
                  onDragLeave={() => setDropTargetKey((k) => (k === rowKey ? null : k))}
                  onDrop={(e) => { e.preventDefault(); const dragged = e.dataTransfer.getData("text/plain"); if (dragged) moveRow(dragged, rowKey); setDraggingRowKey(null); setDropTargetKey(null); }}>
                  {ordered.map((col) => {
                    const pc = col.pin === "left" ? "pinned pinned-left" : col.pin === "right" ? "pinned pinned-right" : "";
                    return <td key={col.key} className={`${col.tdClass ?? ""} ${pc}`}>{renderCell(col.key, room)}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pinMenu && <PinMenuPopup menu={pinMenu} cols={cols} onPin={pin} onClose={() => setPinMenu(null)} />}

      {showDeleteConfirm && (
        <div className="confirm-overlay" onClick={() => !deletingLocal && setShowDeleteConfirm(false)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon confirm-icon--danger"><i className="fas fa-trash-alt" /></div>
            <h6 className="confirm-title">ยืนยันการลบข้อมูล?</h6>
            <p className="confirm-message">
              คุณต้องการลบประวัติการจดมิเตอร์ของ{" "}
              <strong>{record.monthYear}</strong> ใช่หรือไม่?
              <br />
              <small className="text-danger">คำเตือน: ข้อมูลจะถูกลบถาวร ไม่สามารถกู้คืนได้</small>
            </p>
            <div className="confirm-actions">
              <button className="btn btn-outline-secondary"
                onClick={() => setShowDeleteConfirm(false)} disabled={deletingLocal}>
                ยกเลิก
              </button>
              <button className="btn btn-danger" disabled={deletingLocal} onClick={async () => {
                setDeletingLocal(true);
                try { await onDelete(); } finally { setDeletingLocal(false); setShowDeleteConfirm(false); }
              }}>
                {deletingLocal
                  ? <><span className="spinner-border spinner-border-sm me-2" />กำลังลบ...</>
                  : <><i className="fas fa-trash-alt me-1" />ใช่, ลบข้อมูล</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Print selector modal ── */}
      {showPrintModal && (() => {
        const ECOLS = ["ePrev","eCurr","eUnit"];
        const WCOLS = ["wPrev","wCurr","wUnit"];
        const COL_GROUPS = [
          { label: "ทั่วไป", keys: ["room","tenant","lastUpdated"] },
          { label: "ไฟฟ้า", icon: "fa-bolt", color: "#b07000", keys: ECOLS },
          { label: "น้ำ",   icon: "fa-tint",  color: "#0055aa", keys: WCOLS },
        ];
        const activeTowers = towers.filter((t) => t.isActive !== false);
        const filteredRooms = displayed.filter((room) => {
          const tenant = findTenantForRoom(tenants, room);
          const q = printRoomSearch.toLowerCase();
          const matchSearch = !q ||
            room.number.toLowerCase().includes(q) ||
            (tenant ? `${tenant.firstName} ${tenant.lastName}`.toLowerCase().includes(q) : false);
          const matchOccupy =
            printRoomFilter === "all" ||
            (printRoomFilter === "occupied" && !!tenant) ||
            (printRoomFilter === "vacant"   && !tenant);
          const matchTower = printTowerFilter.length === 0 ||
            printTowerFilter.includes(room.towerId ?? "unassigned");
          return matchSearch && matchOccupy && matchTower;
        });
        const allFilteredSelected = filteredRooms.length > 0 && filteredRooms.every((r) => printRowIds.has(r.id));

        return (
          <div className="confirm-overlay" onClick={() => setShowPrintModal(false)}>
            <div className="print-config-dialog" onClick={(e) => e.stopPropagation()}>

              {/* Header */}
              <div className="print-config-header">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: "rgba(var(--color-primary-rgb, 108,155,207),0.15)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-primary)", fontSize: "1rem" }}>
                    <i className="fas fa-print" />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--color-dark)" }}>ตั้งค่าการพิมพ์</div>
                    <div style={{ fontSize: "0.78rem", color: "var(--color-dark-variant)" }}>
                      {monthYearLabel(record.monthYear)}
                    </div>
                  </div>
                </div>
                <button className="btn btn-sm" style={{ color: "var(--color-dark-variant)", padding: "4px 8px" }}
                  onClick={() => setShowPrintModal(false)}>
                  <i className="fas fa-times" />
                </button>
              </div>

              {/* Summary bar */}
              <div className="print-config-summary">
                <span><i className="fas fa-columns me-1" />{printColKeys.size} / {DETAIL_COLS.length} คอลัมน์</span>
                <span style={{ margin: "0 6px", opacity: 0.3 }}>|</span>
                <span><i className="fas fa-door-open me-1" />{printRowIds.size} / {displayed.length} ห้อง</span>
              </div>

              {/* Body */}
              <div className="print-config-body">

                {/* Left — Columns */}
                <div className="print-config-panel">
                  <div className="print-config-panel-header">
                    <span>คอลัมน์</span>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="pcp-btn" onClick={() => setPrintColKeys(new Set(DETAIL_COLS.map((c) => c.key)))}>ทั้งหมด</button>
                      <button className="pcp-btn" onClick={() => setPrintColKeys(new Set())}>ล้าง</button>
                    </div>
                  </div>
                  <div className="nicescrollbar" style={{ overflowY: "auto", flex: 1 }}>
                    {COL_GROUPS.map((grp) => (
                      <div key={grp.label} style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: "0.7rem", fontWeight: 600, color: grp.color ?? "var(--color-dark-variant)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4, display: "flex", alignItems: "center", gap: 5 }}>
                          {grp.icon && <i className={`fas ${grp.icon}`} />}
                          {grp.label}
                        </div>
                        {DETAIL_COLS.filter((c) => grp.keys.includes(c.key)).map((col) => (
                          <label key={col.key} className="print-config-check-row">
                            <input type="checkbox" className="print-config-checkbox"
                              checked={printColKeys.has(col.key)}
                              onChange={(e) => {
                                const next = new Set(printColKeys);
                                e.target.checked ? next.add(col.key) : next.delete(col.key);
                                setPrintColKeys(next);
                              }}
                            />
                            <span>{col.header}</span>
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Divider */}
                <div style={{ width: 1, background: "var(--color-light)", flexShrink: 0 }} />

                {/* Right — Rooms */}
                <div className="print-config-panel" style={{ flex: 1 }}>
                  <div className="print-config-panel-header">
                    <span>ผู้เช่า / ห้อง</span>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="pcp-btn" onClick={() => setPrintRowIds(new Set(displayed.map((r) => r.id)))}>ทั้งหมด</button>
                      <button className="pcp-btn" onClick={() => setPrintRowIds(new Set())}>ล้าง</button>
                    </div>
                  </div>

                  {/* Search */}
                  <div className="print-config-search">
                    <i className="fas fa-search" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--color-dark-variant)", fontSize: "0.8rem", pointerEvents: "none" }} />
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      style={{ paddingLeft: 30, fontSize: "0.85rem" }}
                      placeholder="ค้นหาเลขห้อง หรือชื่อผู้เช่า..."
                      value={printRoomSearch}
                      onChange={(e) => setPrintRoomSearch(e.target.value)}
                    />
                  </div>

                  {/* Occupancy filter chips */}
                  <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                    {(["all","occupied","vacant"] as const).map((f) => (
                      <button key={f}
                        className={`pcp-chip${printRoomFilter === f ? " active" : ""}`}
                        onClick={() => setPrintRoomFilter(f)}>
                        {f === "all" ? "ทั้งหมด" : f === "occupied" ? <><i className="fas fa-user me-1" />มีผู้เช่า</> : <><i className="fas fa-door-open me-1" />ว่าง</>}
                      </button>
                    ))}
                  </div>

                  {/* Tower filter chips (only when > 1 tower) */}
                  {activeTowers.length > 1 && (
                    <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                      {activeTowers.map((tw: any) => {
                        const active = printTowerFilter.includes(tw.id);
                        return (
                          <button key={tw.id}
                            className={`pcp-chip${active ? " active" : ""}`}
                            onClick={() => {
                              setPrintTowerFilter((prev) =>
                                prev.includes(tw.id) ? prev.filter((id) => id !== tw.id) : [...prev, tw.id]
                              );
                            }}>
                            <i className="fas fa-building me-1" style={{ fontSize: "0.7em" }} />{tw.name}
                          </button>
                        );
                      })}
                      {printTowerFilter.length > 0 && (
                        <button className="pcp-chip" onClick={() => setPrintTowerFilter([])}>
                          <i className="fas fa-times me-1" />ล้างตึก
                        </button>
                      )}
                    </div>
                  )}

                  {/* Select-all filtered */}
                  {filteredRooms.length > 0 && (
                    <label className="print-config-check-row" style={{ marginBottom: 6, paddingBottom: 6, borderBottom: "1px solid var(--color-light)" }}>
                      <input type="checkbox" className="print-config-checkbox"
                        checked={allFilteredSelected}
                        onChange={(e) => {
                          const next = new Set(printRowIds);
                          filteredRooms.forEach((r) => e.target.checked ? next.add(r.id) : next.delete(r.id));
                          setPrintRowIds(next);
                        }}
                      />
                      <span style={{ fontWeight: 600, fontSize: "0.82rem", color: "var(--color-dark-variant)" }}>
                        เลือกทั้งหมดที่กรอง ({filteredRooms.length} ห้อง)
                      </span>
                    </label>
                  )}

                  {/* Room list */}
                  <div className="nicescrollbar" style={{ overflowY: "auto", flex: 1 }}>
                    {filteredRooms.length === 0 ? (
                      <div style={{ textAlign: "center", color: "var(--color-dark-variant)", padding: "24px 0", fontSize: "0.85rem" }}>
                        <i className="fas fa-search me-2" />ไม่พบห้องที่ตรงกัน
                      </div>
                    ) : filteredRooms.map((room) => {
                      const tenant = findTenantForRoom(tenants, room);
                      return (
                        <label key={room.id} className="print-config-room-row">
                          <input type="checkbox" className="print-config-checkbox"
                            checked={printRowIds.has(room.id)}
                            onChange={(e) => {
                              const next = new Set(printRowIds);
                              e.target.checked ? next.add(room.id) : next.delete(room.id);
                              setPrintRowIds(next);
                            }}
                          />
                          <span className="pcr-room-num">{room.number}</span>
                          {tenant ? (
                            <span className="pcr-name">{tenantDisplayName(tenant)}</span>
                          ) : (
                            <span className="pcr-vacant"><i className="fas fa-door-open me-1" />ว่าง</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="print-config-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowPrintModal(false)}>ยกเลิก</button>
                <button className="btn btn-primary"
                  disabled={printColKeys.size === 0 || printRowIds.size === 0}
                  onClick={() => setTimeout(() => window.print(), 80)}>
                  <i className="fas fa-print me-2" />พิมพ์
                  <span style={{ marginLeft: 6, background: "rgba(255,255,255,0.25)", borderRadius: 10, padding: "1px 8px", fontSize: "0.8em" }}>
                    {printRowIds.size} ห้อง
                  </span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Print-only table (hidden on screen, shown when printing) ── */}
      <div className="meter-print-only">
        <div style={{ marginBottom: 10 }}>
          <strong style={{ fontSize: 13 }}>รายละเอียดการจดมิเตอร์: {monthYearLabel(record.monthYear)}</strong>
          {record.recordDate && <span style={{ marginLeft: 16, fontSize: 11, color: "#555" }}>วันที่บันทึก: {thaiDateOnlyString(new Date(record.recordDate))}</span>}
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "9pt" }}>
          <thead>
            <tr>
              {DETAIL_COLS.filter((c) => printColKeys.has(c.key)).map((col) => (
                <th key={col.key} className={col.thClass ?? ""}
                  style={{ border: "1px solid #bbb", padding: "5px 7px", background: "#e8e8e8", fontWeight: 600, whiteSpace: "nowrap" }}>
                  {col.key === "ePrev" || col.key === "eCurr" || col.key === "eUnit"
                    ? <><i className="fas fa-bolt me-1" style={{ color: "#b07000" }} />{col.header}</>
                    : col.key === "wPrev" || col.key === "wCurr" || col.key === "wUnit"
                      ? <><i className="fas fa-tint me-1" style={{ color: "#0055aa" }} />{col.header}</>
                      : col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayed.filter((r) => printRowIds.has(r.id)).map((room) => (
              <tr key={room.id}>
                {DETAIL_COLS.filter((c) => printColKeys.has(c.key)).map((col) => (
                  <td key={col.key} className={col.tdClass ?? ""}
                    style={{ border: "1px solid #ddd", padding: "4px 7px", color: "#000" }}>
                    {renderCell(col.key, room)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 8, fontSize: 9, color: "#888", textAlign: "right" }}>
          {printRowIds.size} ห้อง · พิมพ์เมื่อ: {thaiDateTimeString(new Date())}
        </div>
      </div>
    </div>
  );
}

// ── MeterFormView ─────────────────────────────────────────────────────────────
function MeterFormView({ record, rooms, tenants, allRecords, towers, onSave, onBack }: {
  record: any | null; rooms: any[]; tenants: any[]; allRecords: any[]; towers: any[];
  onSave: (updated: any) => void; onBack: () => void;
}) {
  const { config } = useAppConfig();
  const meterBase = Math.pow(10, config.meterDigits || 4);
  const meterMax = meterBase - 1;
  const isNew = !record;
  const currentYear = new Date().getFullYear();

  const [selYear,      setSelYear]      = useState(() => isNew ? String(currentYear) : record.monthYear.split("/")[1]);
  const [selMonth,     setSelMonth]     = useState(() => isNew ? "" : record.monthYear.split("/")[0]);
  const [search,       setSearch]       = useState("");
  const [filterTowers, setFilterTowers] = useState<string[]>([]);
  const [saving,       setSaving]       = useState(false);

  const towerOptions = useMemo(() => {
    const active = towers.filter((t: any) => t.isActive !== false);
    const opts = active.map((t: any) => ({ value: t.id, label: t.name }));
    opts.push({ value: "unassigned", label: "ไม่ระบุตึก" });
    return opts;
  }, [towers]);

  const { tableRef, cols, ordered, pinMenu, setPinMenu, openMenu, pin, widths, startResize, moveColumn } = usePinTable(FORM_COLS, "meters-form", {
    room: 90, tenant: 150, ePrev: 90, eCurr: 90, eUnit: 100, wPrev: 90, wCurr: 90, wUnit: 100,
  });

  const targetMY: string | null = isNew && selMonth && selYear
    ? `${selMonth}/${selYear}` : (record?.monthYear ?? null);

  // เดือนที่มีข้อมูลแล้วในปีที่เลือก (normalize เป็น 2 หลักเสมอ)
  const existingMonthsForYear = useMemo(() => {
    if (!selYear) return new Set<string>();
    return new Set(
      allRecords
        .filter((r) => normYear(r.monthYear) === selYear)
        .map((r) => padZ(parseInt(r.monthYear.split("/")[0], 10)))
    );
  }, [allRecords, selYear]);

  // ปีที่ยังมีเดือนว่างอยู่ (ยังสร้างได้) — รวมปีของ record ที่กำลังแก้อยู่เสมอ
  const yearOptions = useMemo(() => {
    return [0, 1, 2]
      .map((i) => String(currentYear - i))
      .filter((y) => {
        if (!isNew && y === selYear) return true; // ปีของ record ที่แก้อยู่ต้องโชว์เสมอ
        const takenMonths = allRecords.filter((r) => normYear(r.monthYear) === y).length;
        return takenMonths < 12;
      })
      .map((y) => ({ value: y, label: String(toDisplayYear(Number(y), "CE")) }));
  }, [currentYear, allRecords, isNew, selYear, config.yearFormat]);

  // เดือนที่ยังไม่จด (สร้างได้) — ตัดออกเลย ไม่แสดงใน dropdown
  const monthOptions = useMemo(() =>
    THAI_MONTHS
      .map((name, i) => ({ value: padZ(i + 1), label: name }))
      .filter(({ value }) => {
        const isCurrent = !isNew && value === selMonth;
        return isCurrent || !existingMonthsForYear.has(value);
      }),
    [existingMonthsForYear, isNew, selMonth]);

  const prevRecord     = findRecord(allRecords, prevMY(targetMY ?? ""));
  const prevPrevRecord = findRecord(allRecords, prevMY(prevMY(targetMY ?? "")));

  // หา record ล่าสุดก่อน targetMY (ข้ามเดือนที่ไม่มีข้อมูลได้สูงสุด 24 เดือน)
  const effectivePrevInfo = useMemo(() => {
    if (!targetMY || !isNew) return null;
    let my = targetMY;
    for (let i = 0; i < 24; i++) {
      my = prevMY(my);
      const rec = findRecord(allRecords, my);
      if (rec) return { record: rec, monthYear: my, skipped: i > 0 };
    }
    return null;
  }, [targetMY, allRecords, isNew]);

  const savedKeys = record ? new Set(Object.keys(record.data ?? {})) : new Set<string>();
  const hasSaved  = savedKeys.size > 0;

  // snapshot ห้องตอนเปิด form (เฉพาะโหมดแก้ไข) เพื่อกันห้องใหม่แทรกเข้ามา
  const [snapshotNumbers] = useState<Set<string> | null>(() => {
    if (isNew) return null;
    return new Set(
      rooms
        .filter((r) => r.isActive !== false)
        .map((r) => r.number)
    );
  });

  const activeRooms = useMemo(() => {
    if (!isNew) {
      // โหมดแก้ไข: ห้องที่มีข้อมูลใน savedKeys เป็น source of truth (รวมห้องถูกลบด้วย)
      if (hasSaved) return buildRoomsFromKeys(savedKeys, rooms, record?.data);
      // ยังไม่มีข้อมูล → ใช้ snapshot ตอนเปิด
      return rooms
        .filter((r) => r.isActive !== false && snapshotNumbers?.has(r.number))
        .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true, sensitivity: "base" }));
    }
    // โหมดสร้างใหม่: แสดงทุกห้องที่ active
    return rooms
      .filter((r) => r.isActive !== false)
      .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true, sensitivity: "base" }));
  }, [rooms, hasSaved, savedKeys, isNew, snapshotNumbers]);

  const [data, setData] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = {};
    if (record?.data) Object.assign(init, record.data);
    activeRooms.forEach((r) => {
      const prev = prevRecord?.data?.[r.number] ?? prevRecord?.data?.[r.id] ?? {};
      if (!init[r.number]) {
        init[r.number] = {
          prevElectric: prev.currElectric ?? "",
          currElectric: "",
          prevWater:    prev.currWater    ?? "",
          currWater:    "",
        };
      } else {
        // โหมดแก้ไข: ถ้าค่า ก่อน ว่างอยู่ ให้ดึงจากเดือนก่อนหน้ามาเติม
        const row = init[r.number];
        if ((row.prevElectric === "" || row.prevElectric == null) && prev.currElectric != null && prev.currElectric !== "") {
          init[r.number] = { ...row, prevElectric: prev.currElectric };
        }
        if ((row.prevWater === "" || row.prevWater == null) && prev.currWater != null && prev.currWater !== "") {
          init[r.number] = { ...init[r.number], prevWater: prev.currWater };
        }
      }
    });
    return init;
  });

  // Re-fill prev values when month changes (new mode)
  useEffect(() => {
    if (!isNew || !targetMY) return;
    const snap = effectivePrevInfo?.record;
    setData(() => {
      const init: Record<string, any> = {};
      activeRooms.forEach((r) => {
        const prev = snap?.data?.[r.number] ?? snap?.data?.[r.id] ?? {};
        init[r.number] = {
          prevElectric: prev.currElectric ?? "",
          currElectric: "",
          prevWater:    prev.currWater    ?? "",
          currWater:    "",
        };
      });
      return init;
    });
  }, [targetMY, effectivePrevInfo, isNew]);

  function setField(roomNum: string, field: string, val: string) {
    setData((prev) => ({ ...prev, [roomNum]: { ...prev[roomNum], [field]: val } }));
  }

  // กด Enter แล้วโฟกัสไปช่องเดียวกัน (ไฟก่อน/ไฟนี้/น้ำก่อน/น้ำนี้) ของห้องถัดไปในตาราง
  // ข้ามห้องที่ปิดใช้งานมิเตอร์ประเภทนั้น (ไม่มี input ให้โฟกัส) ไปหาห้องถัดไปที่มีจริง
  function focusNextRoomField(colKey: string, currentRoomNumber: string) {
    const idx = rowOrdered.findIndex((r) => r.number === currentRoomNumber);
    if (idx === -1) return;
    for (let i = idx + 1; i < rowOrdered.length; i++) {
      const el = document.getElementById(`meter-input-${colKey}-${rowOrdered[i].number}`) as HTMLInputElement | null;
      if (el) { el.focus(); el.select(); return; }
    }
  }

  const displayed = activeRooms.filter((r) => {
    if (filterTowers.length > 0) {
      const tid = r.towerId || "unassigned";
      if (!filterTowers.includes(tid)) return false;
    }
    if (!search) return true;
    const q = search.toLowerCase();
    const tenant = findTenantForRoom(tenants, r);
    return r.number.toLowerCase().includes(q) ||
      (tenant ? `${tenant.firstName} ${tenant.lastName}`.toLowerCase().includes(q) : false);
  });
  const { ordered: rowOrdered, moveRow } = useRowOrder("meters-form", displayed, (r: any) => String(r.id), !!search.trim() || filterTowers.length > 0);
  const [draggingRowKey, setDraggingRowKey] = useState<string | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const [draggingColKey, setDraggingColKey] = useState<string | null>(null);
  const [dropTargetColKey, setDropTargetColKey] = useState<string | null>(null);

  async function handleSave() {
    if (!targetMY) { toastError("กรุณาเลือกเดือนและปี"); return; }
    setSaving(true);
    try {
      let rec = record;
      if (!rec) {
        rec = await metersApi.create(targetMY);
      }
      const now = new Date().toISOString();
      // snapshot ชื่อผู้เช่า ณ เวลาบันทึก เพื่อกันข้อมูลเก่าเปลี่ยนตามผู้เช่าปัจจุบัน
      const dataWithSnapshot: Record<string, any> = {};
      activeRooms.forEach((r) => {
        const t = findTenantForRoom(tenants, r);
        const cur  = data[r.number] ?? {};
        const orig = record?.data?.[r.number] ?? {};
        const changed =
          String(cur.currElectric ?? "") !== String(orig.currElectric ?? "") ||
          String(cur.currWater    ?? "") !== String(orig.currWater    ?? "");
        dataWithSnapshot[r.number] = {
          ...cur,
          tenantName: t ? `${t.firstName} ${t.lastName}` : "",
          lastUpdated: changed ? now : (orig.lastUpdated ?? undefined),
        };
      });
      const updated = await metersApi.update(rec.id, dataWithSnapshot);
      toastSuccess("บันทึกข้อมูลมิเตอร์สำเร็จ");
      onSave(updated);
    } catch (e: any) {
      const msg = "เกิดข้อผิดพลาด: " + (e?.response?.data?.error ?? e?.message ?? "Unknown error");
      toastError(msg);
    } finally {
      setSaving(false);
    }
  }

  function renderCell(colKey: string, room: any) {
    const d        = data[room.number] ?? {};
    const prevD    = prevRecord?.data?.[room.number]     ?? prevRecord?.data?.[room.id]     ?? {};
    const prevPrevD = prevPrevRecord?.data?.[room.number] ?? prevPrevRecord?.data?.[room.id] ?? {};
    const ue = calcUnits(d.currElectric, d.prevElectric, meterBase);
    const uw = calcUnits(d.currWater,    d.prevWater, meterBase);
    const prevUe = prevD.prevElectric != null && prevD.prevElectric !== ""
      ? calcUnits(prevD.currElectric, prevD.prevElectric, meterBase)
      : calcUnits(prevD.currElectric, prevPrevD.currElectric, meterBase);
    const prevUw = prevD.prevWater != null && prevD.prevWater !== ""
      ? calcUnits(prevD.currWater, prevD.prevWater, meterBase)
      : calcUnits(prevD.currWater, prevPrevD.currWater, meterBase);
    const off = <span className="meter-disabled-text">ปิดใช้งาน</span>;

    switch (colKey) {
      case "room":   return (
        <>
          <span className="row-drag-handle" draggable
            onClick={(e) => e.stopPropagation()}
            onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(room.id)); setDraggingRowKey(String(room.id)); }}
            onDragEnd={() => { setDraggingRowKey(null); setDropTargetKey(null); }}
            title="ลากเพื่อสลับลำดับแถว">
            <i className="fas fa-grip-vertical" />
          </span>
          <span style={{ fontWeight: 700, color: room.isDeleted ? "var(--color-danger)" : "var(--color-primary)" }}>
            ห้อง {room.number}
            {room.isDeleted && <i className="fas fa-trash-alt ms-1" style={{ fontSize: "0.75em" }} title="ห้องนี้ถูกลบออกจากระบบแล้ว" />}
          </span>
        </>
      );
      case "tenant": {
        const t = findTenantForRoom(tenants, room);
        return t ? <span>{tenantDisplayName(t)}</span> : <em className="text-muted">ห้องว่าง</em>;
      }
      case "ePrev": return room.meterElectricActive
        ? <input id={`meter-input-ePrev-${room.number}`} type="number" className="form-control form-control-sm text-end" min={0} max={meterMax}
            value={d.prevElectric ?? ""} style={{ minWidth: 70 }}
            onChange={(e) => setField(room.number, "prevElectric", clampMeterValue(e.target.value, meterMax))}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focusNextRoomField("ePrev", room.number); } }} />
        : off;
      case "eCurr": return room.meterElectricActive
        ? <input id={`meter-input-eCurr-${room.number}`} type="number" className="form-control form-control-sm text-end" min={0} max={meterMax}
            value={d.currElectric ?? ""} style={{ minWidth: 70 }}
            onChange={(e) => setField(room.number, "currElectric", clampMeterValue(e.target.value, meterMax))}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focusNextRoomField("eCurr", room.number); } }} />
        : off;
      case "eUnit": return room.meterElectricActive ? <UnitCell units={ue} prevUnits={prevUe} /> : off;
      case "wPrev": return room.meterWaterActive
        ? <input id={`meter-input-wPrev-${room.number}`} type="number" className="form-control form-control-sm text-end" min={0} max={meterMax}
            value={d.prevWater ?? ""} style={{ minWidth: 70 }}
            onChange={(e) => setField(room.number, "prevWater", clampMeterValue(e.target.value, meterMax))}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focusNextRoomField("wPrev", room.number); } }} />
        : off;
      case "wCurr": return room.meterWaterActive
        ? <input id={`meter-input-wCurr-${room.number}`} type="number" className="form-control form-control-sm text-end" min={0} max={meterMax}
            value={d.currWater ?? ""} style={{ minWidth: 70 }}
            onChange={(e) => setField(room.number, "currWater", clampMeterValue(e.target.value, meterMax))}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focusNextRoomField("wCurr", room.number); } }} />
        : off;
      case "wUnit": return room.meterWaterActive ? <UnitCell units={uw} prevUnits={prevUw} /> : off;
      default: return "-";
    }
  }

  const formTitle = isNew
    ? "เพิ่มจดบันทึกใหม่"
    : `แก้ไขรายละเอียด: ${monthYearLabel(record.monthYear)}`;

  return (
    <div className="custom-card" id="meterFormCard">
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-3">
        <h5 id="meter-form-title" className="form-section-title mb-0" style={{ borderBottom: "none" }}>
          {formTitle}
        </h5>
      </div>

      <div className="row g-2 mb-3 align-items-center">
        <div className="col-12 col-md-6">
          <label htmlFor="meterYearSelect" className="form-label mb-1 small">
            ปี (พ.ศ.)<span className="text-danger">*</span>
          </label>
          <CustomSelect2
            inputId="meterYearSelect"
            value={yearOptions.find((o) => o.value === selYear) ?? null}
            options={yearOptions}
            onChange={(o: any) => { setSelYear(o?.value ?? ""); setSelMonth(""); }}
            isDisabled={!isNew}
            isSearchable={false}
            placeholder="เลือกปี..."
          />
        </div>
        <div className="col-12 col-md-6">
          <label htmlFor="meterMonthSelect" className="form-label mb-1 small">
            เดือน<span className="text-danger">*</span>
          </label>
          <CustomSelect2
            inputId="meterMonthSelect"
            value={monthOptions.find((o) => o.value === selMonth) ?? null}
            options={monthOptions}
            onChange={(o: any) => { if (!o?.isDisabled) setSelMonth(o?.value ?? ""); }}
            isDisabled={!isNew}
            isSearchable={false}
            placeholder={monthOptions.length === 0 ? "ทุกเดือนมีข้อมูลแล้ว" : "เลือกเดือน..."}
          />
        </div>
      </div>

      <div className="row g-2 mb-3 align-items-center">
        <div className="col-12 col-lg">
          <div className="search-container flex-grow-1">
            <i className="fas fa-search" />
            <input type="text" id="searchMeterRoom" className="form-control"
              placeholder="ค้นหาเลขห้อง, ผู้เช่า..." style={{ paddingLeft: 40 }}
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {towerOptions.length > 1 && (
          <div className="col-12 col-md-auto" style={{ minWidth: 200 }}>
            <CustomSelect2
              isMulti={true as any}
              options={towerOptions}
              value={towerOptions.filter((o: any) => filterTowers.includes(o.value))}
              onChange={(sel: any) => setFilterTowers(sel ? sel.map((o: any) => o.value) : [])}
              placeholder="กรองตามตึก..."
              closeMenuOnSelect={false as any}
            />
          </div>
        )}
      </div>

      {isNew && effectivePrevInfo?.skipped && (
        <div className="alert alert-warning d-flex align-items-center gap-2 py-2 px-3 mt-2 mb-0" style={{ fontSize: "0.88rem" }}>
          <i className="fas fa-exclamation-triangle" />
          <span>
            ไม่พบข้อมูลเดือนก่อนหน้า — ค่ามิเตอร์เริ่มต้นอ้างอิงจาก{" "}
            <strong>{monthYearLabel(effectivePrevInfo.monthYear)}</strong>
          </span>
        </div>
      )}

      <div className="table-responsive-wrapper mt-3 nicescrollbar" style={{ maxHeight: 538, overflow: "auto" }}>
        <table ref={tableRef} className="table-mainstyle table-hover table-resizable" style={{ minWidth: 700 }} id="meter-reading-table">
          <thead>
            <tr>
              {ordered.map((col) => {
                const pc = col.pin === "left" ? "pinned pinned-left" : col.pin === "right" ? "pinned pinned-right" : "";
                return (
                  <th key={col.key} className={`${col.thClass ?? ""} ${pc} ${draggingColKey === col.key ? "col-dragging" : ""} ${dropTargetColKey === col.key ? "col-drop-target" : ""}`}
                    style={{ width: widths[col.key] }}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", col.key); setDraggingColKey(col.key); }}
                    onDragEnd={() => { setDraggingColKey(null); setDropTargetColKey(null); }}
                    onDragOver={(e) => { e.preventDefault(); if (draggingColKey && draggingColKey !== col.key) setDropTargetColKey(col.key); }}
                    onDragLeave={() => setDropTargetColKey((k) => (k === col.key ? null : k))}
                    onDrop={(e) => { e.preventDefault(); const dragged = e.dataTransfer.getData("text/plain"); if (dragged) moveColumn(dragged, col.key); setDraggingColKey(null); setDropTargetColKey(null); }}>
                    {col.key === "ePrev" || col.key === "eCurr" || col.key === "eUnit"
                      ? <><i className="fas fa-bolt text-warning me-1" />{col.header}</>
                      : col.key === "wPrev" || col.key === "wCurr" || col.key === "wUnit"
                        ? <><i className="fas fa-tint text-primary me-1" />{col.header}</>
                        : col.header}
                    {col.pinnable && (
                      <i className={`fas fa-thumbtack pin-icon${col.pin === "left" ? " active-left" : col.pin === "right" ? " active-right" : ""}`}
                        onClick={(e) => openMenu(e, col.key)} />
                    )}
                    <ColResizeHandle onMouseDown={(e) => startResize(col.key, e)} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody id="meter-reading-form-container">
            {!targetMY ? (
              <tr><td colSpan={ordered.length} className="text-center text-muted p-5">
                เลือกปีและเดือนเพื่อเริ่มจดบันทึก
              </td></tr>
            ) : displayed.length === 0 ? (
              <tr><td colSpan={ordered.length} className="text-center text-muted p-5">
                กำลังโหลดข้อมูลห้องพัก...
              </td></tr>
            ) : rowOrdered.map((room) => {
              const rowKey = String(room.id);
              return (
                <tr key={room.id} data-room-id={room.id}
                  className={`${draggingRowKey === rowKey ? "row-dragging" : ""} ${dropTargetKey === rowKey ? "row-drop-target" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); if (draggingRowKey && draggingRowKey !== rowKey) setDropTargetKey(rowKey); }}
                  onDragLeave={() => setDropTargetKey((k) => (k === rowKey ? null : k))}
                  onDrop={(e) => { e.preventDefault(); const dragged = e.dataTransfer.getData("text/plain"); if (dragged) moveRow(dragged, rowKey); setDraggingRowKey(null); setDropTargetKey(null); }}>
                  {ordered.map((col) => {
                    const pc = col.pin === "left" ? "pinned pinned-left" : col.pin === "right" ? "pinned pinned-right" : "";
                    return <td key={col.key} className={`${col.tdClass ?? ""} ${pc}`}>{renderCell(col.key, room)}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="col-12 text-center mt-4">
        <button type="button" id="saveMeterReadingsBtn" className="btn btn-primary submit-btn"
          onClick={handleSave} disabled={saving}>
          {saving
            ? <><span className="spinner-border spinner-border-sm me-2" />กำลังบันทึก...</>
            : <><i className="fas fa-paper-plane me-2" />บันทึก</>}
        </button>
      </div>

      {pinMenu && <PinMenuPopup menu={pinMenu} cols={cols} onPin={pin} onClose={() => setPinMenu(null)} />}
    </div>
  );
}

// ── MeterTableView ────────────────────────────────────────────────────────────
const METER_TABLE_COLS: ColDef[] = [
  { key: "checkbox",   header: "checkbox",       visible: true,  pinnable: true,  pin: "left",  thClass: "text-center checkbox-cell", tdClass: "text-center checkbox-cell" },
  { key: "monthYear",  header: "เดือน/ปี",        visible: true,  pinnable: true,  pin: false },
  { key: "status",     header: "สถานะ",            visible: true,  pinnable: true,  pin: false,   thClass: "text-center", tdClass: "text-center" },
  { key: "filled",     header: "บันทึกแล้ว",      visible: true,  pinnable: true,  pin: false,   thClass: "text-center", tdClass: "text-center" },
  { key: "progress",   header: "ความคืบหน้า",     visible: true,  pinnable: true,  pin: false },
  { key: "recordDate", header: "วันที่สร้าง",     visible: false, pinnable: true,  pin: false,   thClass: "text-center", tdClass: "text-center" },
  { key: "updatedAt",  header: "อัปเดตล่าสุด",   visible: true,  pinnable: true,  pin: false,   thClass: "text-center", tdClass: "text-center" },
  { key: "actions",    header: "จัดการ",           visible: true,  pinnable: true,  pin: "right", thClass: "text-center action-cell", tdClass: "text-center action-cell" },
];

function MeterTableView({ meters, isFiltered = false, sortKey, filledCount, roomCount, onView, onEdit, onDeleted, onPrintSelected }: {
  meters: any[];
  isFiltered?: boolean;
  sortKey?: string;
  filledCount: (r: any) => number;
  roomCount:   (r: any) => number;
  onView:    (m: any) => void;
  onEdit:    (m: any) => void;
  onDeleted: (ids: string[]) => void;
  onPrintSelected: (monthYears: string[]) => void;
}) {
  const [cols, setCols, moveColumn] = useColumnVisibility("meters-list", METER_TABLE_COLS);
  const [selectedRows, setSelectedRows]   = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<any[] | null>(null);
  const [deleting,      setDeleting]      = useState(false);
  const [pinMenu, setPinMenu] = useState<PinMenuState | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const tableRef     = useRef<HTMLTableElement>(null);
  const { widths, startResize } = useColumnWidths("meters-list", {
    checkbox: 40, monthYear: 130, status: 120, filled: 120, progress: 150, recordDate: 130, updatedAt: 160, actions: 150,
  });
  const { ordered: rowOrdered, moveRow, resetRowOrder } = useRowOrder("meters-list", meters, (m: any) => String(m.id), isFiltered);
  const [draggingRowKey, setDraggingRowKey] = useState<string | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const [draggingColKey, setDraggingColKey] = useState<string | null>(null);
  const [dropTargetColKey, setDropTargetColKey] = useState<string | null>(null);
  const prevSortKeyRef = useRef(sortKey);
  useEffect(() => {
    if (prevSortKeyRef.current !== sortKey) {
      resetRowOrder();
      prevSortKeyRef.current = sortKey;
    }
  }, [sortKey]);

  const allSelected  = meters.length > 0 && selectedRows.size === meters.length;
  const someSelected = selectedRows.size > 0 && !allSelected;
  useEffect(() => { if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected; }, [someSelected]);

  function toggleAll(checked: boolean) { setSelectedRows(checked ? new Set(meters.map((m) => m.id)) : new Set()); }
  function toggleRow(id: string) {
    setSelectedRows((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function doDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      for (const m of confirmDelete) await metersApi.delete(m.id);
      onDeleted(confirmDelete.map((m) => m.id));
      setSelectedRows(new Set());
      setConfirmDelete(null);
      toastSuccess("ลบข้อมูลมิเตอร์สำเร็จ");
    } finally { setDeleting(false); }
  }

  const visible = cols.filter((c) => c.visible);
  const ordered = [
    ...visible.filter((c) => c.pin === "left"),
    ...visible.filter((c) => !c.pin),
    ...visible.filter((c) => c.pin === "right"),
  ];

  useLayoutEffect(() => {
    const tbl = tableRef.current; if (!tbl) return;
    const ths  = Array.from(tbl.querySelectorAll<HTMLElement>("thead tr th"));
    const rows = Array.from(tbl.querySelectorAll<HTMLTableRowElement>("tbody tr"))
      .map((tr) => Array.from(tr.querySelectorAll<HTMLElement>("td")));
    let lo = 0;
    ordered.forEach((col, i) => {
      if (col.pin !== "left") return;
      const th = ths[i]; if (!th) return;
      th.style.left = `${lo}px`;
      rows.forEach((r) => { if (r[i]) r[i].style.left = `${lo}px`; });
      lo += th.offsetWidth;
    });
    let ro = 0;
    [...ordered].reverse().forEach((col, ri) => {
      if (col.pin !== "right") return;
      const i = ordered.length - 1 - ri;
      const th = ths[i]; if (!th) return;
      th.style.right = `${ro}px`;
      rows.forEach((r) => { if (r[i]) r[i].style.right = `${ro}px`; });
      ro += th.offsetWidth;
    });
  });

  function handleColVisibility(key: string, v: boolean) { setCols((prev) => prev.map((c) => c.key === key ? { ...c, visible: v } : c)); }
  function handlePin(key: string, dir: PinDir)           { setCols((prev) => prev.map((c) => c.key === key ? { ...c, pin: dir }     : c)); }
  function openPinMenu(e: React.MouseEvent, key: string) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPinMenu({ colKey: key, x: Math.max(0, r.right - 160), y: r.bottom + 4 });
  }

  const toggleable = cols.filter((c) => c.key !== "actions" && c.key !== "checkbox");
  const colOptions = toggleable.map((c) => ({ value: c.key, label: c.header }));
  const colValue   = toggleable.filter((c) => c.visible).map((c) => ({ value: c.key, label: c.header }));

  function renderCell(col: ColDef, m: any) {
    const filled  = filledCount(m);
    const total   = roomCount(m);
    const pct     = total > 0 ? Math.round((filled / total) * 100) : 0;
    const done    = filled === total && total > 0;
    const partial = filled > 0 && !done;
    const statusLabel = done ? "ครบแล้ว" : partial ? "บางส่วน" : "ยังไม่บันทึก";
    const statusCls   = done ? "status-available" : partial ? "status-booked" : "status-maintenance";
    switch (col.key) {
      case "checkbox":
        return (
          <>
            <span className="row-drag-handle" draggable
              onClick={(e) => e.stopPropagation()}
              onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(m.id)); setDraggingRowKey(String(m.id)); }}
              onDragEnd={() => { setDraggingRowKey(null); setDropTargetKey(null); }}
              title="ลากเพื่อสลับลำดับแถว">
              <i className="fas fa-grip-vertical" />
            </span>
            <input type="checkbox" className="form-check-input row-checkbox"
              checked={selectedRows.has(m.id)}
              onChange={() => toggleRow(m.id)}
              onClick={(e) => e.stopPropagation()} />
          </>
        );
      case "monthYear":
        return <span style={{ fontWeight: 600, color: "var(--color-primary)" }}>{monthYearLabel(m.monthYear)}</span>;
      case "status":
        return <span className={`status-badge ${statusCls}`}>{statusLabel}</span>;
      case "filled":
        return <span className="fw-semibold">{filled} / {total} ห้อง</span>;
      case "progress":
        return (
          <div style={{ minWidth: 130 }}>
            <div className="d-flex justify-content-between mb-1" style={{ fontSize: "0.72rem", color: "var(--color-dark-variant)" }}>
              <span>{filled} ห้อง</span><span>{pct}%</span>
            </div>
            <div style={{ height: 6, background: "var(--color-light)", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, borderRadius: 99, transition: "width 0.4s",
                background: done ? "var(--color-success)" : partial ? "var(--color-warning)" : "var(--color-info-dark)" }} />
            </div>
          </div>
        );
      case "recordDate":
        return <span className="text-muted" style={{ fontSize: "0.85rem" }}>{m.recordDate ? thaiDateOnlyString(new Date(m.recordDate)) : "-"}</span>;
      case "updatedAt":
        return <span className="text-muted" style={{ fontSize: "0.85rem" }}>{m.updatedAt ? thaiDateTimeString(new Date(m.updatedAt)) : "-"}</span>;
      case "actions":
        return (
          <div className="btn-group" role="group">
            <button type="button" className="btn btn-sm btn-info"    title="ดูรายละเอียด"
              onClick={(e) => { e.stopPropagation(); onView(m); }}><i className="fas fa-eye" /></button>
            <button type="button" className="btn btn-sm btn-warning" title="แก้ไข"
              onClick={(e) => { e.stopPropagation(); onEdit(m); }}><i className="fas fa-edit" /></button>
            <button type="button" className="btn btn-sm btn-outline-primary" title="พิมพ์"
              onClick={(e) => { e.stopPropagation(); onPrintSelected([m.monthYear]); }}><i className="fas fa-print" /></button>
            <button type="button" className="btn btn-sm btn-danger"  title="ลบ"
              onClick={(e) => { e.stopPropagation(); setConfirmDelete([m]); }}><i className="fas fa-trash-alt" /></button>
          </div>
        );
      default: return "-";
    }
  }

  return (
    <div>
      {/* Column visibility */}
      <div className="mb-2">
        <Select isMulti options={colOptions} value={colValue}
          onChange={(sel) => {
            const keys = new Set((sel as any[]).map((s) => s.value));
            toggleable.forEach((c) => { if (c.visible !== keys.has(c.key)) handleColVisibility(c.key, keys.has(c.key)); });
          }}
          styles={{
            control: (b, s) => ({ ...b, backgroundColor: s.menuIsOpen || s.isFocused ? "var(--color-white)" : "var(--color-background)", border: `1px solid ${s.menuIsOpen || s.isFocused ? "var(--color-primary)" : "var(--color-light)"}`, borderRadius: "var(--border-radius-1)", boxShadow: s.menuIsOpen || s.isFocused ? "0 0 0 3px rgba(108,155,207,0.25)" : "none", minHeight: "38px", fontSize: "0.9rem", cursor: "pointer", transition: "border-color 0.3s ease, box-shadow 0.3s ease", "&:hover": { borderColor: "var(--color-primary)", boxShadow: "0 0 0 3px rgba(108,155,207,0.18)", backgroundColor: "var(--color-white)" } }),
            valueContainer: (b) => ({ ...b, padding: "0 0.75rem", flexWrap: "nowrap", overflow: "hidden" }),
            indicatorSeparator: () => ({ display: "none" }),
            dropdownIndicator: (b, s) => ({ ...b, color: s.isFocused ? "var(--color-primary)" : "var(--color-dark-variant)", padding: "0 8px", transition: "transform 0.2s ease, color 0.2s ease", transform: (s.selectProps as any).menuIsOpen ? "rotate(180deg)" : "rotate(0deg)" }),
            menu: (b) => ({ ...b, backgroundColor: "var(--color-white)", border: "1px solid var(--color-light)", borderRadius: "var(--border-radius-1)", boxShadow: "var(--box-shadow)", zIndex: 9999, overflow: "hidden" }),
            menuList: (b) => ({ ...b, padding: "4px", maxHeight: "260px" }),
            option: (b, s) => ({ ...b, backgroundColor: s.isFocused ? "var(--color-light)" : "transparent", color: "var(--color-dark)", fontSize: "0.88rem", borderRadius: "var(--border-radius-1)", padding: "0.45rem 0.75rem", cursor: "pointer", transition: "background 0.15s ease" }),
          }}
          components={{
            Option: ({ innerProps, isSelected, isFocused, label }: any) => (
              <div {...innerProps} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.45rem 0.75rem", cursor: "pointer", background: isFocused ? "var(--color-light)" : "transparent", borderRadius: "var(--border-radius-1)", fontSize: "0.88rem" }}>
                <input type="checkbox" className="form-check-input" checked={isSelected} readOnly style={{ flexShrink: 0 }} />
                <span className={isSelected ? "fw-bold" : ""}>{label}</span>
              </div>
            ),
            ValueContainer: ({ children, getValue, selectProps }: any) => {
              const count = getValue().length; const total = (selectProps.options as any[]).length;
              const input = Array.isArray(children) ? children[children.length - 1] : children;
              return (
                <div style={{ padding: "0 0.75rem", display: "flex", alignItems: "center" }}>
                  <span style={{ color: "var(--color-dark)", fontWeight: 500, fontSize: "0.9rem", whiteSpace: "nowrap" }}>
                    {count > 0 ? `แสดง ${count} / ${total} คอลัมน์` : "เลือกคอลัมน์ที่แสดง..."}
                  </span>
                  {input}
                </div>
              );
            },
            MultiValue: () => null,
          }}
          closeMenuOnSelect={false} hideSelectedOptions={false} isSearchable={false}
          noOptionsMessage={() => "ไม่พบข้อมูล"} placeholder="เลือกคอลัมน์ที่แสดง..."
        />
      </div>

      {/* Bulk actions bar */}
      {selectedRows.size > 0 && (
        <div className="bulk-actions-bar mb-2" style={{ justifyContent: "space-between" }}>
          <span>เลือก <strong>{selectedRows.size}</strong> รายการ</span>
          <div className="d-flex gap-2">
            <button className="btn btn-outline-primary btn-sm"
              onClick={() => onPrintSelected(meters.filter((m) => selectedRows.has(m.id)).map((m) => m.monthYear))}>
              <i className="fas fa-print me-1" />พิมพ์ที่เลือก
            </button>
            <button className="btn btn-danger btn-sm"
              onClick={() => setConfirmDelete(meters.filter((m) => selectedRows.has(m.id)))}>
              <i className="fas fa-trash-alt me-1" />ลบรายการที่เลือก
            </button>
            <button className="btn btn-sm btn-outline-secondary"
              onClick={() => setSelectedRows(new Set())}>
              <i className="fas fa-times me-1" />ยกเลิก
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="nicescrollbar" style={{ maxHeight: 560, overflow: "auto" }}>
        <table ref={tableRef} className="table-mainstyle table-hover table-resizable" style={{ minWidth: 600 }}>
          <thead>
            <tr>
              {ordered.map((col) => {
                const pc = col.pin === "left" ? "pinned pinned-left" : col.pin === "right" ? "pinned pinned-right" : "";
                const canDragCol = col.key !== "checkbox";
                return (
                  <th key={col.key} className={`${col.thClass ?? ""} ${pc} ${draggingColKey === col.key ? "col-dragging" : ""} ${dropTargetColKey === col.key ? "col-drop-target" : ""}`}
                    style={{ width: widths[col.key] }}
                    draggable={canDragCol}
                    onDragStart={canDragCol ? (e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", col.key); setDraggingColKey(col.key); } : undefined}
                    onDragEnd={() => { setDraggingColKey(null); setDropTargetColKey(null); }}
                    onDragOver={canDragCol ? (e) => { e.preventDefault(); if (draggingColKey && draggingColKey !== col.key) setDropTargetColKey(col.key); } : undefined}
                    onDragLeave={() => setDropTargetColKey((k) => (k === col.key ? null : k))}
                    onDrop={canDragCol ? (e) => { e.preventDefault(); const dragged = e.dataTransfer.getData("text/plain"); if (dragged) moveColumn(dragged, col.key); setDraggingColKey(null); setDropTargetColKey(null); } : undefined}>
                    {col.key === "checkbox"
                      ? <input ref={selectAllRef} type="checkbox" className="form-check-input"
                          checked={allSelected} onChange={(e) => toggleAll(e.target.checked)} />
                      : col.header}
                    {col.pinnable && col.key !== "checkbox" && (
                      <i className={`fas fa-thumbtack pin-icon${col.pin === "left" ? " active-left" : col.pin === "right" ? " active-right" : ""}`}
                        title="ตัวเลือกการปักหมุด"
                        onClick={(e) => openPinMenu(e, col.key)} />
                    )}
                    <ColResizeHandle onMouseDown={(e) => startResize(col.key, e)} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rowOrdered.map((m) => {
              const rowKey = String(m.id);
              return (
                <tr key={m.id}
                  className={`${draggingRowKey === rowKey ? "row-dragging" : ""} ${dropTargetKey === rowKey ? "row-drop-target" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); if (draggingRowKey && draggingRowKey !== rowKey) setDropTargetKey(rowKey); }}
                  onDragLeave={() => setDropTargetKey((k) => (k === rowKey ? null : k))}
                  onDrop={(e) => { e.preventDefault(); const dragged = e.dataTransfer.getData("text/plain"); if (dragged) moveRow(dragged, rowKey); setDraggingRowKey(null); setDropTargetKey(null); }}>
                  {ordered.map((col) => {
                    const pc = col.pin === "left" ? "pinned pinned-left" : col.pin === "right" ? "pinned pinned-right" : "";
                    return <td key={col.key} className={`${col.tdClass ?? ""} ${pc}`}>{renderCell(col, m)}</td>;
                  })}
                </tr>
              );
            })}
            {meters.length === 0 && (
              <tr><td colSpan={ordered.length}><EmptyState icon="fa-tachometer-alt" text="ไม่พบรายการจดมิเตอร์" compact /></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pinMenu && <PinMenuPopup menu={pinMenu} cols={cols} onPin={handlePin} onClose={() => setPinMenu(null)} />}

      {/* Confirm delete dialog */}
      {confirmDelete && (
        <div className="confirm-overlay" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon confirm-icon--danger"><i className="fas fa-trash-alt" /></div>
            <h6 className="confirm-title">
              {confirmDelete.length === 1 ? "ลบข้อมูลจดมิเตอร์" : `ลบ ${confirmDelete.length} รายการ`}
            </h6>
            <p className="confirm-message">
              {confirmDelete.length === 1
                ? <>ลบประวัติการจดมิเตอร์ของ <strong>{monthYearLabel(confirmDelete[0].monthYear)}</strong> ใช่หรือไม่?</>
                : <>ลบประวัติการจดมิเตอร์ <strong>{confirmDelete.length} เดือน</strong> ที่เลือก ใช่หรือไม่?</>}
              <br /><small className="text-danger">คำเตือน: ข้อมูลจะถูกลบถาวร ไม่สามารถกู้คืนได้</small>
            </p>
            <div className="confirm-actions">
              <button className="btn btn-outline-secondary" onClick={() => setConfirmDelete(null)} disabled={deleting}>ยกเลิก</button>
              <button className="btn btn-danger" onClick={doDelete} disabled={deleting}>
                {deleting
                  ? <><span className="spinner-border spinner-border-sm me-2" />กำลังลบ...</>
                  : <><i className="fas fa-trash-alt me-1" />ใช่, ลบข้อมูล</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main MetersPage ───────────────────────────────────────────────────────────
export default function MetersPage() {
  const [meters,  setMeters]  = useState<any[]>([]);
  const [rooms,   setRooms]   = useState<any[]>([]);
  const [showLive, setShowLive] = useState(false);
  const [tenants, setTenants] = useState<any[]>([]);
  const [towers,  setTowers]  = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const navigate = useNavigate();
  const location = useLocation();
  // เก็บสถานะหน้าย่อยไว้ใน location.state (แทน useState เฉยๆ) เพื่อให้ปุ่ม "ย้อนกลับ" ของเบราว์เซอร์
  // ใช้งานได้จริง — กดย้อนกลับจะพากลับไปหน้าย่อยก่อนหน้าของหน้านี้ ก่อนจะออกจากหน้านี้จริงๆ
  const navState = (location.state as { subView?: PageView; monthYear?: string; isNew?: boolean }) ?? {};
  const pageView = navState.subView ?? "list";
  const activeMonthYear = pageView === "list" ? null : navState.monthYear ?? null;
  const isNewForm = pageView === "form" ? !!navState.isNew : false;

  function goToList() { navigate("/meters", { state: { subView: "list" } }); }
  function goToDetails(monthYear: string) { navigate("/meters", { state: { subView: "details", monthYear } }); }
  function goToForm(monthYear: string | null, isNew: boolean) {
    navigate("/meters", { state: { subView: "form", monthYear: monthYear ?? undefined, isNew } });
  }

  const [listViewMode, setListViewMode] = usePersistedViewMode<ListViewMode>("meters", "list", ["list", "grid", "table"]);
  const [search,       setSearch]       = useState("");
  const [sort,         setSort]         = useState("desc");

  const [confirmDeleteMY, setConfirmDeleteMY] = useState<string | null>(null);
  const [deleting,        setDeleting]        = useState(false);
  const [syncing,         setSyncing]         = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Export
  const [showExportDialog,    setShowExportDialog]    = useState(false);
  const [exportSelectedMYs,   setExportSelectedMYs]   = useState<Set<string>>(new Set());
  const [exportFormat,        setExportFormat]        = useState<"detailed"|"simple">("detailed");

  // Print (หลายเดือน)
  const [showPrintDialog,   setShowPrintDialog]   = useState(false);
  const [printSelectedMYs,  setPrintSelectedMYs]  = useState<Set<string>>(new Set());
  const [printColKeys,      setPrintColKeys]      = useState<Set<string>>(() => new Set(DETAIL_COLS.map((c) => c.key)));
  const [printRoomNumbers,  setPrintRoomNumbers]  = useState<Set<string>>(new Set());
  const [printAllRooms,     setPrintAllRooms]     = useState<any[]>([]);
  const [printRoomSearch,   setPrintRoomSearch]   = useState("");
  const [printRoomFilter,   setPrintRoomFilter]   = useState<"all" | "occupied" | "vacant">("all");
  const [printTowerFilter,  setPrintTowerFilter]  = useState<string[]>([]);

  // Import
  const [importFile,        setImportFile]        = useState<File | null>(null);
  const [importing,         setImporting]         = useState(false);
  const [showImportDialog,  setShowImportDialog]  = useState(false);
  const [importDragOver,    setImportDragOver]    = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const { setBreadcrumb } = useBreadcrumb();
  const { config } = useAppConfig();

  const activeRecord = activeMonthYear ? meters.find((m) => m.monthYear === activeMonthYear) ?? null : null;

  // Load data
  useEffect(() => {
    Promise.all([metersApi.getAll(), roomsApi.getAll(), tenantsApi.getAll(), roomsApi.getTowers()])
      .then(([m, r, t, tw]) => { setMeters(m); setRooms(r); setTenants(t); setTowers(tw); })
      .finally(() => setLoading(false));
    return () => setBreadcrumb([]);
  }, []);

  // มีคนอื่นแก้ไขมิเตอร์/ห้อง/ผู้เช่า/ตึกที่เครื่องอื่น — โหลดข้อมูลใหม่เงียบๆ ไม่เปิด loading spinner
  const metersLiveTick = useLiveRefreshTick(["meter", "room", "tenant", "tower"]);
  useEffect(() => {
    if (metersLiveTick === 0) return;
    Promise.all([metersApi.getAll(), roomsApi.getAll(), tenantsApi.getAll(), roomsApi.getTowers()])
      .then(([m, r, t, tw]) => { setMeters(m); setRooms(r); setTenants(t); setTowers(tw); });
  }, [metersLiveTick]);

  // Breadcrumb
  useEffect(() => {
    if (pageView === "form" && isNewForm) {
      setBreadcrumb([
        { label: "จดมิเตอร์", onClick: goToList },
        { label: "เพิ่มจดบันทึกใหม่" },
      ]);
    } else if (pageView === "form" && activeMonthYear) {
      setBreadcrumb([
        { label: "จดมิเตอร์", onClick: goToList },
        { label: `รายละเอียด: ${monthYearLabel(activeMonthYear)}`, onClick: () => goToDetails(activeMonthYear) },
        { label: "แก้ไขข้อมูล" },
      ]);
    } else if (pageView === "details" && activeMonthYear) {
      setBreadcrumb([
        { label: "จดมิเตอร์", onClick: goToList },
        { label: `รายละเอียด: ${monthYearLabel(activeMonthYear)}` },
      ]);
    } else {
      setBreadcrumb([{ label: "จดมิเตอร์" }]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageView, activeMonthYear, isNewForm]);

  // Helpers
  const filledCount = useMemo(() => (record: any) => {
    const d = record.data ?? {};
    const savedKeys = Object.keys(d);
    if (savedKeys.length === 0) return 0;
    return savedKeys.filter((key) => {
      const rd = d[key];
      if (!rd) return false;
      const room = rooms.find((r) => r.number === key || r.id === key);
      // ห้องที่ถูกลบ: ใช้ logic เดิม
      if (!room) return (rd.currElectric !== "" && rd.currElectric != null) || (rd.currWater !== "" && rd.currWater != null);
      // ห้องที่ปิดใช้งานทั้งสองมิเตอร์: นับเป็นบันทึกแล้ว (ไม่มีอะไรต้องบันทึก)
      if (room.meterElectricActive === false && room.meterWaterActive === false) return true;
      const eFilled = room.meterElectricActive !== false && rd.currElectric !== "" && rd.currElectric != null;
      const wFilled = room.meterWaterActive    !== false && rd.currWater    !== "" && rd.currWater    != null;
      return eFilled || wFilled;
    }).length;
  }, [rooms]);

  const roomCount = useMemo(() => (record: any) => {
    const d = record.data ?? {};
    const savedKeys = Object.keys(d);
    if (savedKeys.length > 0) return savedKeys.length;
    return rooms.filter((r) => r.isActive !== false).length;
  }, [rooms]);

  const filteredMeters = useMemo(() => {
    let list = meters.filter((m) =>
      !search || monthYearLabel(m.monthYear).includes(search) || m.monthYear.includes(search)
    );
    return list.sort((a, b) =>
      sort === "asc" ? myScore(a.monthYear) - myScore(b.monthYear) : myScore(b.monthYear) - myScore(a.monthYear)
    );
  }, [meters, search, sort, config.yearFormat]);

  async function handleSyncSheets() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await metersApi.syncSheets();
      setMeters(res.records ?? []);
      const successText = `ซิงค์จาก Google Sheet สำเร็จ — เพิ่มใหม่ ${res.inserted} อัปเดต ${res.updated} รายการ`;
      setSyncMsg({ type: "success", text: successText });
      toastSuccess(successText);
    } catch (e: any) {
      const msg = "เกิดข้อผิดพลาด: " + (e?.response?.data?.error ?? e?.message ?? "Unknown error");
      setSyncMsg({ type: "error", text: msg });
      toastError(msg);
    } finally { setSyncing(false); }
  }

  async function handleDelete() {
    if (!confirmDeleteMY) return;
    const rec = meters.find((m) => m.monthYear === confirmDeleteMY);
    if (!rec) return;
    setDeleting(true);
    try {
      await metersApi.delete(rec.id);
      setMeters((prev) => prev.filter((m) => m.id !== rec.id));
      toastSuccess("ลบข้อมูลมิเตอร์สำเร็จ");
      setConfirmDeleteMY(null);
      goToList();
    } finally { setDeleting(false); }
  }

function openExportDialog() {
    setExportSelectedMYs(new Set(meters.map((m) => m.monthYear)));
    setExportFormat("detailed");
    setShowExportDialog(true);
  }

  function openPrintDialog(monthYears: string[]) {
    setPrintSelectedMYs(new Set(monthYears));
    setPrintColKeys(new Set(DETAIL_COLS.map((c) => c.key)));
    const roomMap = new Map<string, any>();
    monthYears.forEach((my) => {
      const record = meters.find((m) => m.monthYear === my);
      if (!record) return;
      buildRoomsFromKeys(new Set(Object.keys(record.data ?? {})), rooms, record.data)
        .forEach((r) => { if (!roomMap.has(r.number)) roomMap.set(r.number, r); });
    });
    const sortedRooms = [...roomMap.values()].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true, sensitivity: "base" }));
    setPrintAllRooms(sortedRooms);
    setPrintRoomNumbers(new Set(sortedRooms.map((r) => r.number)));
    setPrintRoomSearch("");
    setPrintRoomFilter("all");
    setPrintTowerFilter([]);
    setShowPrintDialog(true);
  }

  function doExport() {
    const sorted = [...exportSelectedMYs].sort((a, b) => myScore(a) - myScore(b));
    const isDetailed = exportFormat === "detailed";
    const header = isDetailed
      ? "เดือน/ปี,เลขห้อง,ผู้เช่า,ไฟก่อน,ไฟนี้,หน่วยไฟ,น้ำก่อน,น้ำนี้,หน่วยน้ำ,วันที่บันทึก"
      : "เดือน/ปี,เลขห้อง,ไฟฟ้า,น้ำ";
    const lines: string[] = [header];

    for (const my of sorted) {
      const record = meters.find((r) => r.monthYear === my);
      if (!record) continue;
      const prevRecord = findRecord(meters, prevMY(my));
      const activeRooms = buildRoomsFromKeys(new Set(Object.keys(record.data ?? {})), rooms, record.data);

      for (const room of activeRooms) {
        const d     = record.data?.[room.number]     ?? record.data?.[room.id]     ?? {};
        const prevD = prevRecord?.data?.[room.number] ?? prevRecord?.data?.[room.id] ?? {};
        const prevE = d.prevElectric !== "" && d.prevElectric != null ? d.prevElectric : (prevD.currElectric ?? "");
        const prevW = d.prevWater    !== "" && d.prevWater    != null ? d.prevWater    : (prevD.currWater    ?? "");
        const ue    = prevE !== "" ? calcUnits(d.currElectric, prevE, Math.pow(10, config.meterDigits || 4)) : null;
        const uw    = prevW !== "" ? calcUnits(d.currWater,    prevW, Math.pow(10, config.meterDigits || 4)) : null;

        if (isDetailed) {
          const currentTenant = findTenantForRoom(tenants, room);
          const name = d.tenantName !== undefined
            ? (d.tenantName || "ห้องว่าง")
            : (currentTenant ? tenantDisplayName(currentTenant) : "ห้องว่าง");
          lines.push([my, room.number, name, prevE, d.currElectric ?? "", ue ?? "", prevW, d.currWater ?? "", uw ?? "", record.recordDate ?? ""].join(","));
        } else {
          lines.push([my, room.number, d.currElectric ?? "", d.currWater ?? ""].join(","));
        }
      }
    }

    const csv  = "﻿" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `meter_export_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowExportDialog(false);
  }

  function downloadCsvTemplate() {
    const now = new Date();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const y = now.getFullYear();
    const monthYear = `${m}/${y}`;
    const activeRooms = rooms
      .filter((r) => r.isActive !== false && (r.meterElectricActive || r.meterWaterActive))
      .sort((a: any, b: any) => a.number.localeCompare(b.number, undefined, { numeric: true, sensitivity: "base" }));
    const lines: string[] = ["เดือน/ปี,เลขห้อง,ไฟฟ้า,น้ำ,ไฟก่อน,น้ำก่อน,ผู้เช่า(ชื่อหรือรหัส)"];
    activeRooms.forEach((r: any) => lines.push(`${monthYear},${r.number},,,,,`));
    const csv = "﻿" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meter_template_${m}-${y}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // นำเข้าเดือนที่เลือก — สร้างข้อมูลทุกห้อง (ห้องที่ไม่มีใน CSV ได้ค่าว่าง)
  async function handleImportConfirm(selectedMonths: ImportMonth[], includeAllRooms: boolean, fillCurrentTenantName: boolean) {
    setImportFile(null);
    setImporting(true);
    try {
      const activeRooms = rooms.filter((r) => r.isActive !== false && (r.meterElectricActive || r.meterWaterActive));
      // ห้องในไฟล์ไม่มีชื่อผู้เช่า (format นำเข้าได้ไม่มีคอลัมน์นี้เลย) — ถ้าติ๊กไว้ ให้เติมชื่อผู้เช่าปัจจุบันแทนที่จะปล่อยว่าง
      function resolveTenantName(room: any, csvRow?: CsvRow) {
        const raw = csvRow?.tenantName?.trim();
        if (raw) {
          // ถ้าใส่มาเป็นรหัสผู้เช่า (ตรงกับ id ผู้เช่าที่มีอยู่จริง) ให้ auto แปลงเป็นชื่อปัจจุบันของผู้เช่าคนนั้น
          const byId = tenants.find((tn) => String(tn.id) === raw);
          return byId ? tenantDisplayName(byId) : raw;
        }
        if (!fillCurrentTenantName || !room) return "";
        const t = findTenantForRoom(tenants, room);
        return t ? tenantDisplayName(t) : "";
      }
      for (const month of selectedMonths) {
        // สร้าง record ใหม่
        const created = await metersApi.create(month.monthYear);
        const data: Record<string, any> = {};
        if (includeAllRooms) {
          // ทุกห้องในระบบ ห้องที่มีใน CSV จะได้ค่า ที่เหลือว่าง
          activeRooms.forEach((room) => {
            const csvRow = month.rows.find((r) => r.roomNumber === room.number);
            data[room.number] = {
              prevElectric: csvRow?.prevElectric ?? "",
              currElectric: csvRow?.electric     ?? "",
              prevWater:    csvRow?.prevWater    ?? "",
              currWater:    csvRow?.water        ?? "",
              tenantName:   resolveTenantName(room, csvRow),
            };
          });
        } else {
          // เอาเฉพาะห้องที่มีอยู่ในไฟล์ CSV เท่านั้น
          month.rows.forEach((csvRow) => {
            const room = rooms.find((r) => r.number === csvRow.roomNumber);
            data[csvRow.roomNumber] = {
              prevElectric: csvRow.prevElectric ?? "",
              currElectric: csvRow.electric     ?? "",
              prevWater:    csvRow.prevWater    ?? "",
              currWater:    csvRow.water        ?? "",
              tenantName:   resolveTenantName(room, csvRow),
            };
          });
        }
        const updated = await metersApi.update(created.id, data);
        setMeters((prev) => {
          const idx = prev.findIndex((m) => m.id === updated.id);
          if (idx > -1) { const n = [...prev]; n[idx] = updated; return n; }
          return [updated, ...prev];
        });
      }
      toastSuccess("นำเข้าข้อมูลมิเตอร์สำเร็จ");
    } catch (e: any) {
      const msg = "เกิดข้อผิดพลาดในการนำเข้า: " + (e?.response?.data?.error ?? e?.message ?? "Unknown error");
      toastError(msg);
    } finally { setImporting(false); }
  }

  // ── Render: Form View ──
  if (pageView === "form") {
    return (
      <MeterFormView
        record={isNewForm ? null : activeRecord}
        rooms={rooms}
        tenants={tenants}
        towers={towers}
        allRecords={meters}
        onSave={(updated) => {
          setMeters((prev) => {
            const idx = prev.findIndex((m) => m.id === updated.id);
            if (idx > -1) { const n = [...prev]; n[idx] = updated; return n; }
            return [updated, ...prev];
          });
          goToDetails(updated.monthYear);
        }}
        onBack={() => {
          if (isNewForm) goToList();
          else if (activeMonthYear) goToDetails(activeMonthYear);
          else goToList();
        }}
      />
    );
  }

  // ── Render: Detail View ──
  if (pageView === "details" && activeRecord) {
    return (
      <MeterDetailView
        record={activeRecord}
        rooms={rooms}
        tenants={tenants}
        allRecords={meters}
        towers={towers}
        onEdit={() => goToForm(activeRecord.monthYear, false)}
        onDelete={async () => {
          const rec = meters.find((m) => m.monthYear === activeMonthYear);
          if (!rec) return;
          await metersApi.delete(rec.id);
          setMeters((prev) => prev.filter((m) => m.id !== rec.id));
          toastSuccess("ลบข้อมูลมิเตอร์สำเร็จ");
          goToList();
        }}
      />
    );
  }

  // ── Render: List View ──
  return (
    <div className="custom-card" id="meterGroupCard">
      {showLive && <LiveMeterDashboard rooms={rooms} onClose={() => setShowLive(false)} />}
      {/* Sync result banner */}
      {syncMsg && (
        <div className={`alert ${syncMsg.type === "success" ? "alert-success" : "alert-danger"} d-flex align-items-center justify-content-between mb-3 py-2 px-3`} style={{ fontSize: "0.88rem", borderRadius: "var(--border-radius-1)" }}>
          <span>
            <i className={`fas ${syncMsg.type === "success" ? "fa-check-circle" : "fa-exclamation-circle"} me-2`} />
            {syncMsg.text}
          </span>
          <button type="button" className="btn-close btn-sm ms-3" onClick={() => setSyncMsg(null)} />
        </div>
      )}

      <div className="no-print">
      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-3 page-list-toolbar">
        <h5 className="form-section-title mb-0" style={{ borderBottom: "none" }}>รายการจดมิเตอร์</h5>
        <ToolbarActionsMenu>
          <button type="button" id="exportMeterBtn"
            className="btn btn-outline-secondary d-inline-flex align-items-center"
            onClick={openExportDialog} disabled={meters.length === 0}>
            <i className="fas fa-file-export me-2" /><span className="btn-text">Export</span>
          </button>
          <input ref={importInputRef} type="file" accept=".csv" className="d-none"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) { setShowImportDialog(false); setImportFile(f); }
              e.target.value = "";
            }} />
          <button type="button" id="importMeterBtn"
            className="btn btn-outline-secondary d-inline-flex align-items-center"
            disabled={importing}
            onClick={() => setShowImportDialog(true)}>
            {importing
              ? <><span className="spinner-border spinner-border-sm me-2" />กำลังนำเข้า...</>
              : <><i className="fas fa-file-import me-2" /><span className="btn-text">Import</span></>}
          </button>
          {config.features.liveMeterEnabled && (
            <button type="button" id="showLiveMeterBtn" onClick={() => setShowLive(true)}
              className="btn btn-outline-success d-inline-flex align-items-center">
              <i className="fas fa-satellite-dish me-2" /><span className="btn-text">Live Meter</span>
            </button>
          )}
          <button id="showMeterFormBtn"
            className="btn btn-primary d-inline-flex align-items-center"
            onClick={() => goToForm(null, true)}>
            <i className="fas fa-plus me-2" /><span className="btn-text">เพิ่มจดบันทึก</span>
          </button>
        </ToolbarActionsMenu>
      </div>

      {/* Filter/Sort/View bar */}
      <div className="row g-2 mb-3 align-items-center">
        <div className="col-12 col-lg">
          <div className="search-container flex-grow-1">
            <i className="fas fa-search" />
            <input type="text" id="searchMeterGroup" className="form-control"
              placeholder="ค้นหาด้วยเดือน, ปี..." style={{ paddingLeft: 40 }}
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="col-12 col-md-auto">
          <CustomSelect2
            inputId="sortMeterGroup"
            value={{ value: sort, label: sort === "desc" ? "ใหม่สุด - เก่าสุด" : "เก่าสุด - ใหม่สุด" }}
            options={[
              { value: "desc", label: "ใหม่สุด - เก่าสุด" },
              { value: "asc",  label: "เก่าสุด - ใหม่สุด" },
            ]}
            onChange={(o: any) => setSort(o?.value ?? "desc")}
            isSearchable={false}
          />
        </div>
        <div className="col-12 col-md-auto">
          <div className="d-flex align-items-center flex-shrink-0 gap-2">
            <div className="btn-group view-switch-group" role="group" aria-label="View switch">
              <button type="button"
                className={`btn btn-outline-secondary view-btn-meter${listViewMode === "list" ? " active" : ""}`}
                id="view-btn-meter-list" title="List View"
                onClick={() => setListViewMode("list")}>
                <i className="fas fa-list" />
              </button>
              <button type="button"
                className={`btn btn-outline-secondary view-btn-meter${listViewMode === "grid" ? " active" : ""}`}
                id="view-btn-meter-grid" title="Grid View"
                onClick={() => setListViewMode("grid")}>
                <i className="fas fa-th-large" />
              </button>
              <button type="button"
                className={`btn btn-outline-secondary view-btn-meter${listViewMode === "table" ? " active" : ""}`}
                id="view-btn-meter-table" title="Table View"
                onClick={() => setListViewMode("table")}>
                <i className="fas fa-table" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Cards / Table */}
      {listViewMode === "table" && !loading ? (
        <MeterTableView
          meters={filteredMeters}
          isFiltered={!!search.trim()}
          sortKey={sort}
          filledCount={filledCount}
          roomCount={roomCount}
          onView={(m) => goToDetails(m.monthYear)}
          onEdit={(m) => goToForm(m.monthYear, false)}
          onDeleted={(ids) => setMeters((prev) => prev.filter((m) => !ids.includes(m.id)))}
          onPrintSelected={openPrintDialog}
        />
      ) : (
      <div id="meterListContainer" className="nicescrollbar" style={{ maxHeight: 650, overflow: "auto" }}>
        {loading ? (
          <div className="text-center p-5">
            <div className="spinner-border" style={{ color: "var(--color-primary)" }} />
          </div>
        ) : filteredMeters.length === 0 ? (
          <EmptyState icon="fa-tachometer-alt" text="ยังไม่มีข้อมูลการจดมิเตอร์" />
        ) : listViewMode === "grid" ? (
          /* ── Grid View ── */
          <div className="room-grid">
            {filteredMeters.map((m) => {
              const filled  = filledCount(m);
              const total   = roomCount(m);
              const pct     = total > 0 ? Math.round((filled / total) * 100) : 0;
              const done    = filled === total && total > 0;
              const partial = filled > 0 && !done;
              const statusLabel = done ? "ครบแล้ว" : partial ? "บันทึกบางส่วน" : "ยังไม่บันทึก";
              const statusCls   = done ? "status-available" : partial ? "status-booked" : "status-maintenance";
              return (
                <div key={m.id} className="room-card" style={{ cursor: "pointer" }}
                  onClick={() => goToDetails(m.monthYear)}>
                  <div className="room-card-header">
                    <h5 style={{ fontSize: "1rem" }}>{monthYearLabel(m.monthYear)}</h5>
                    <span className={`status-badge ${statusCls}`}>{statusLabel}</span>
                  </div>
                  <div className="room-card-body">
                    <div className="room-card-info-grid">
                      <div className="room-card-info-item">
                        <span className="label">บันทึกแล้ว</span>
                        <span className="value">{filled} / {total} ห้อง</span>
                      </div>
                      <div className="room-card-info-item">
                        <span className="label">วันที่สร้าง</span>
                        <span className="value">{m.recordDate ? thaiDateOnlyString(new Date(m.recordDate)) : "-"}</span>
                      </div>
                    </div>
                    <div style={{ margin: "0.5rem 0" }}>
                      <div style={{ height: 6, background: "var(--color-light)", borderRadius: 99, overflow: "hidden" }}>
                        <div style={{
                          height: "100%", width: `${pct}%`, borderRadius: 99,
                          background: done ? "var(--color-success)" : partial ? "var(--color-warning)" : "var(--color-info-dark)",
                          transition: "width 0.4s",
                        }} />
                      </div>
                    </div>
                    <div className="room-card-tenant-info">
                      <p>
                        <i className="fas fa-clock" />
                        {m.updatedAt ? thaiDateTimeString(new Date(m.updatedAt)) : "ยังไม่มีการบันทึก"}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ── List View ── */
          <div>
            {filteredMeters.map((m) => {
              const filled  = filledCount(m);
              const total   = roomCount(m);
              const done    = filled === total && total > 0;
              const partial = filled > 0 && !done;
              const statusLabel = done ? "ครบแล้ว" : partial ? "บางส่วน" : "ยังไม่บันทึก";
              const statusCls   = done ? "status-available" : partial ? "status-booked" : "status-maintenance";
              const iconColor   = done ? "var(--color-success)" : partial ? "#b8860b" : "var(--color-info-dark)";
              const iconBg      = done ? "rgba(27,156,133,0.12)" : partial ? "rgba(247,208,96,0.18)" : "var(--color-light)";
              return (
                <div key={m.id}
                  className="d-flex align-items-center gap-3 p-3"
                  style={{ borderBottom: "1px solid var(--color-light)", cursor: "pointer" }}
                  onClick={() => goToDetails(m.monthYear)}>
                  <div style={{
                    width: 56, height: 56, borderRadius: "50%",
                    background: iconBg, display: "flex", alignItems: "center",
                    justifyContent: "center", flexShrink: 0,
                  }}>
                    <i className="fas fa-tachometer-alt" style={{ fontSize: "1.25rem", color: iconColor }} />
                  </div>
                  <div className="flex-grow-1">
                    <div className="d-flex align-items-center gap-2">
                      <strong style={{ color: "var(--color-dark)" }}>{monthYearLabel(m.monthYear)}</strong>
                      <span className={`status-badge ${statusCls}`}>{statusLabel}</span>
                    </div>
                    <small className="text-muted">
                      <i className="fas fa-calendar-alt me-1" />{m.recordDate ? thaiDateOnlyString(new Date(m.recordDate)) : "-"}
                    </small>
                  </div>
                  <div className="text-end">
                    <div style={{ fontWeight: 600, color: "var(--color-primary)" }}>
                      {filled} / {total} ห้อง
                    </div>
                    <small className="text-muted">{m.updatedAt ? thaiDateOnlyString(new Date(m.updatedAt)) : "-"}</small>
                  </div>
                  <i className="fas fa-chevron-right text-muted" />
                </div>
              );
            })}
            {filteredMeters.length === 0 && (
              <EmptyState icon="fa-tachometer-alt" text="ไม่พบรายการจดบันทึก" />
            )}
          </div>
        )}
      </div>
      )}
      </div>

      {/* Export Dialog */}
      {showExportDialog && (() => {
        const sortedMeters = [...meters].sort((a, b) => myScore(b.monthYear) - myScore(a.monthYear));
        const allSelected  = sortedMeters.every((m) => exportSelectedMYs.has(m.monthYear));
        return (
          <div className="confirm-overlay" onClick={() => setShowExportDialog(false)}>
            <div className="import-dialog" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>

              {/* Header */}
              <div className="import-dialog-header">
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div className="import-dialog-icon" style={{ background: "linear-gradient(135deg,rgba(76,175,80,0.2),rgba(76,175,80,0.08))", borderColor: "rgba(76,175,80,0.25)", color: "#4caf50" }}>
                    <i className="fas fa-file-export" />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--color-dark)", lineHeight: 1.3 }}>ส่งออกข้อมูลมิเตอร์</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--color-dark-variant)" }}>เลือกเดือนและรูปแบบไฟล์</div>
                  </div>
                </div>
                <button className="import-dialog-close" onClick={() => setShowExportDialog(false)}>
                  <i className="fas fa-times" />
                </button>
              </div>

              <div className="import-dialog-body">

                {/* Format toggle */}
                <div style={{ display: "flex", gap: 8 }}>
                  {([["detailed","ละเอียด","fa-table"],["simple","นำเข้าได้","fa-redo"]] as const).map(([val, label, icon]) => (
                    <button key={val}
                      onClick={() => setExportFormat(val)}
                      style={{ flex: 1, padding: "8px 12px", borderRadius: 10, border: `1.5px solid ${exportFormat === val ? "var(--color-primary)" : "var(--color-light)"}`, background: exportFormat === val ? "rgba(108,155,207,0.1)" : "var(--color-background)", color: exportFormat === val ? "var(--color-primary)" : "var(--color-dark-variant)", fontWeight: exportFormat === val ? 600 : 400, fontSize: "0.82rem", cursor: "pointer", transition: "all 0.15s", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      <i className={`fas ${icon}`} />{label}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--color-dark-variant)", marginTop: -4, padding: "0 2px" }}>
                  {exportFormat === "detailed"
                    ? <><i className="fas fa-info-circle me-1" />ห้อง, ผู้เช่า, ไฟก่อน/ใหม่/หน่วย, น้ำก่อน/ใหม่/หน่วย, วันที่</>
                    : <><i className="fas fa-info-circle me-1" />เดือน/ปี, เลขห้อง, ไฟฟ้า, น้ำ — สามารถนำกลับมา Import ได้</>}
                </div>

                {/* Month list */}
                <div style={{ borderRadius: 12, border: "1px solid var(--color-light)", overflow: "hidden" }}>
                  {/* Select-all header */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "var(--color-background)", borderBottom: "1px solid var(--color-light)" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.82rem", fontWeight: 600, color: "var(--color-dark-variant)" }}>
                      <input type="checkbox" style={{ accentColor: "var(--color-primary)", width: 15, height: 15 }}
                        checked={allSelected}
                        onChange={(e) => setExportSelectedMYs(e.target.checked ? new Set(sortedMeters.map((m) => m.monthYear)) : new Set())} />
                      เลือกทั้งหมด ({sortedMeters.length} เดือน)
                    </label>
                    <span style={{ fontSize: "0.75rem", color: "var(--color-primary)", fontWeight: 600 }}>
                      {exportSelectedMYs.size} เดือน
                    </span>
                  </div>

                  {/* Scrollable month list */}
                  <div className="nicescrollbar" style={{ maxHeight: 240, overflowY: "auto" }}>
                    {sortedMeters.map((m) => {
                      const roomCount = Object.keys(m.data ?? {}).length;
                      const checked   = exportSelectedMYs.has(m.monthYear);
                      return (
                        <label key={m.monthYear}
                          style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid var(--color-light)", transition: "background 0.12s", background: checked ? "rgba(108,155,207,0.05)" : "transparent" }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-background)")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = checked ? "rgba(108,155,207,0.05)" : "transparent")}>
                          <input type="checkbox" style={{ accentColor: "var(--color-primary)", width: 15, height: 15, flexShrink: 0 }}
                            checked={checked}
                            onChange={(e) => {
                              const next = new Set(exportSelectedMYs);
                              e.target.checked ? next.add(m.monthYear) : next.delete(m.monthYear);
                              setExportSelectedMYs(next);
                            }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: "0.88rem", color: "var(--color-dark)" }}>{monthYearLabel(m.monthYear)}</div>
                            {m.recordDate && <div style={{ fontSize: "0.72rem", color: "var(--color-dark-variant)" }}><i className="fas fa-calendar-check me-1" />{thaiDateOnlyString(new Date(m.recordDate))}</div>}
                          </div>
                          <span style={{ fontSize: "0.75rem", color: "var(--color-dark-variant)", flexShrink: 0 }}>{roomCount} ห้อง</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Action row */}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="btn btn-outline-secondary btn-sm" onClick={() => setShowExportDialog(false)}>ยกเลิก</button>
                  <button className="btn btn-success btn-sm d-inline-flex align-items-center"
                    disabled={exportSelectedMYs.size === 0}
                    onClick={doExport}>
                    <i className="fas fa-download me-2" />ดาวน์โหลด CSV
                    <span style={{ marginLeft: 6, background: "rgba(255,255,255,0.25)", borderRadius: 10, padding: "1px 8px", fontSize: "0.8em" }}>
                      {exportSelectedMYs.size} เดือน
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Print Dialog (จากรายการที่เลือกในหน้า Table View) — เหมือนกับหน้าตั้งค่าการพิมพ์แบบเดี่ยวทุกประการ */}
      {showPrintDialog && (() => {
        const ECOLS = ["ePrev","eCurr","eUnit"];
        const WCOLS = ["wPrev","wCurr","wUnit"];
        const COL_GROUPS = [
          { label: "ทั่วไป", keys: ["room","tenant","lastUpdated"] },
          { label: "ไฟฟ้า", icon: "fa-bolt", color: "#b07000", keys: ECOLS },
          { label: "น้ำ",   icon: "fa-tint",  color: "#0055aa", keys: WCOLS },
        ];
        const activeTowers = towers.filter((t) => t.isActive !== false);
        const filteredRooms = printAllRooms.filter((room) => {
          const tenant = findTenantForRoom(tenants, room);
          const q = printRoomSearch.toLowerCase();
          const matchSearch = !q ||
            room.number.toLowerCase().includes(q) ||
            (tenant ? `${tenant.firstName} ${tenant.lastName}`.toLowerCase().includes(q) : false);
          const matchOccupy =
            printRoomFilter === "all" ||
            (printRoomFilter === "occupied" && !!tenant) ||
            (printRoomFilter === "vacant"   && !tenant);
          const matchTower = printTowerFilter.length === 0 ||
            printTowerFilter.includes(room.towerId ?? "unassigned");
          return matchSearch && matchOccupy && matchTower;
        });
        const allFilteredSelected = filteredRooms.length > 0 && filteredRooms.every((r) => printRoomNumbers.has(r.number));
        const sortedSelectedMYs = [...printSelectedMYs].sort((a, b) => myScore(a) - myScore(b));

        return (
          <div className="confirm-overlay" onClick={() => setShowPrintDialog(false)}>
            <div className="print-config-dialog" onClick={(e) => e.stopPropagation()}>

              {/* Header */}
              <div className="print-config-header">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: "rgba(var(--color-primary-rgb, 108,155,207),0.15)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-primary)", fontSize: "1rem" }}>
                    <i className="fas fa-print" />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--color-dark)" }}>ตั้งค่าการพิมพ์</div>
                    <div style={{ fontSize: "0.78rem", color: "var(--color-dark-variant)" }}>
                      {sortedSelectedMYs.map((my) => monthYearLabel(my)).join(", ")}
                    </div>
                  </div>
                </div>
                <button className="btn btn-sm" style={{ color: "var(--color-dark-variant)", padding: "4px 8px" }}
                  onClick={() => setShowPrintDialog(false)}>
                  <i className="fas fa-times" />
                </button>
              </div>

              {/* Summary bar */}
              <div className="print-config-summary">
                <span><i className="fas fa-calendar-alt me-1" />{printSelectedMYs.size} เดือน</span>
                <span style={{ margin: "0 6px", opacity: 0.3 }}>|</span>
                <span><i className="fas fa-columns me-1" />{printColKeys.size} / {DETAIL_COLS.length} คอลัมน์</span>
                <span style={{ margin: "0 6px", opacity: 0.3 }}>|</span>
                <span><i className="fas fa-door-open me-1" />{printRoomNumbers.size} / {printAllRooms.length} ห้อง</span>
              </div>

              {/* Body */}
              <div className="print-config-body">

                {/* Left — Columns */}
                <div className="print-config-panel">
                  <div className="print-config-panel-header">
                    <span>คอลัมน์</span>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="pcp-btn" onClick={() => setPrintColKeys(new Set(DETAIL_COLS.map((c) => c.key)))}>ทั้งหมด</button>
                      <button className="pcp-btn" onClick={() => setPrintColKeys(new Set())}>ล้าง</button>
                    </div>
                  </div>
                  <div className="nicescrollbar" style={{ overflowY: "auto", flex: 1 }}>
                    {COL_GROUPS.map((grp) => (
                      <div key={grp.label} style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: "0.7rem", fontWeight: 600, color: grp.color ?? "var(--color-dark-variant)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4, display: "flex", alignItems: "center", gap: 5 }}>
                          {grp.icon && <i className={`fas ${grp.icon}`} />}
                          {grp.label}
                        </div>
                        {DETAIL_COLS.filter((c) => grp.keys.includes(c.key)).map((col) => (
                          <label key={col.key} className="print-config-check-row">
                            <input type="checkbox" className="print-config-checkbox"
                              checked={printColKeys.has(col.key)}
                              onChange={(e) => {
                                const next = new Set(printColKeys);
                                e.target.checked ? next.add(col.key) : next.delete(col.key);
                                setPrintColKeys(next);
                              }}
                            />
                            <span>{col.header}</span>
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Divider */}
                <div style={{ width: 1, background: "var(--color-light)", flexShrink: 0 }} />

                {/* Right — Rooms */}
                <div className="print-config-panel" style={{ flex: 1 }}>
                  <div className="print-config-panel-header">
                    <span>ผู้เช่า / ห้อง</span>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="pcp-btn" onClick={() => setPrintRoomNumbers(new Set(printAllRooms.map((r) => r.number)))}>ทั้งหมด</button>
                      <button className="pcp-btn" onClick={() => setPrintRoomNumbers(new Set())}>ล้าง</button>
                    </div>
                  </div>

                  {/* Search */}
                  <div className="print-config-search">
                    <i className="fas fa-search" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--color-dark-variant)", fontSize: "0.8rem", pointerEvents: "none" }} />
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      style={{ paddingLeft: 30, fontSize: "0.85rem" }}
                      placeholder="ค้นหาเลขห้อง หรือชื่อผู้เช่า..."
                      value={printRoomSearch}
                      onChange={(e) => setPrintRoomSearch(e.target.value)}
                    />
                  </div>

                  {/* Occupancy filter chips */}
                  <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                    {(["all","occupied","vacant"] as const).map((f) => (
                      <button key={f}
                        className={`pcp-chip${printRoomFilter === f ? " active" : ""}`}
                        onClick={() => setPrintRoomFilter(f)}>
                        {f === "all" ? "ทั้งหมด" : f === "occupied" ? <><i className="fas fa-user me-1" />มีผู้เช่า</> : <><i className="fas fa-door-open me-1" />ว่าง</>}
                      </button>
                    ))}
                  </div>

                  {/* Tower filter chips (only when > 1 tower) */}
                  {activeTowers.length > 1 && (
                    <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                      {activeTowers.map((tw: any) => {
                        const active = printTowerFilter.includes(tw.id);
                        return (
                          <button key={tw.id}
                            className={`pcp-chip${active ? " active" : ""}`}
                            onClick={() => {
                              setPrintTowerFilter((prev) =>
                                prev.includes(tw.id) ? prev.filter((id) => id !== tw.id) : [...prev, tw.id]
                              );
                            }}>
                            <i className="fas fa-building me-1" style={{ fontSize: "0.7em" }} />{tw.name}
                          </button>
                        );
                      })}
                      {printTowerFilter.length > 0 && (
                        <button className="pcp-chip" onClick={() => setPrintTowerFilter([])}>
                          <i className="fas fa-times me-1" />ล้างตึก
                        </button>
                      )}
                    </div>
                  )}

                  {/* Select-all filtered */}
                  {filteredRooms.length > 0 && (
                    <label className="print-config-check-row" style={{ marginBottom: 6, paddingBottom: 6, borderBottom: "1px solid var(--color-light)" }}>
                      <input type="checkbox" className="print-config-checkbox"
                        checked={allFilteredSelected}
                        onChange={(e) => {
                          const next = new Set(printRoomNumbers);
                          filteredRooms.forEach((r) => e.target.checked ? next.add(r.number) : next.delete(r.number));
                          setPrintRoomNumbers(next);
                        }}
                      />
                      <span style={{ fontWeight: 600, fontSize: "0.82rem", color: "var(--color-dark-variant)" }}>
                        เลือกทั้งหมดที่กรอง ({filteredRooms.length} ห้อง)
                      </span>
                    </label>
                  )}

                  {/* Room list */}
                  <div className="nicescrollbar" style={{ overflowY: "auto", flex: 1 }}>
                    {filteredRooms.length === 0 ? (
                      <div style={{ textAlign: "center", color: "var(--color-dark-variant)", padding: "24px 0", fontSize: "0.85rem" }}>
                        <i className="fas fa-search me-2" />ไม่พบห้องที่ตรงกัน
                      </div>
                    ) : filteredRooms.map((room) => {
                      const tenant = findTenantForRoom(tenants, room);
                      return (
                        <label key={room.number} className="print-config-room-row">
                          <input type="checkbox" className="print-config-checkbox"
                            checked={printRoomNumbers.has(room.number)}
                            onChange={(e) => {
                              const next = new Set(printRoomNumbers);
                              e.target.checked ? next.add(room.number) : next.delete(room.number);
                              setPrintRoomNumbers(next);
                            }}
                          />
                          <span className="pcr-room-num">{room.number}</span>
                          {tenant ? (
                            <span className="pcr-name">{tenantDisplayName(tenant)}</span>
                          ) : (
                            <span className="pcr-vacant"><i className="fas fa-door-open me-1" />ว่าง</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="print-config-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowPrintDialog(false)}>ยกเลิก</button>
                <button className="btn btn-primary"
                  disabled={printColKeys.size === 0 || printRoomNumbers.size === 0}
                  onClick={() => setTimeout(() => window.print(), 80)}>
                  <i className="fas fa-print me-2" />พิมพ์
                  <span style={{ marginLeft: 6, background: "rgba(255,255,255,0.25)", borderRadius: 10, padding: "1px 8px", fontSize: "0.8em" }}>
                    {printRoomNumbers.size} ห้อง
                  </span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Import Drop Dialog */}
      {showImportDialog && (
        <div className="confirm-overlay" onClick={() => setShowImportDialog(false)}>
          <div className="import-dialog" onClick={(e) => e.stopPropagation()}>

            {/* Header */}
            <div className="import-dialog-header">
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div className="import-dialog-icon">
                  <i className="fas fa-file-csv" />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--color-dark)", lineHeight: 1.3 }}>นำเข้าข้อมูลมิเตอร์</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--color-dark-variant)" }}>รองรับไฟล์ .CSV เท่านั้น</div>
                </div>
              </div>
              <button className="import-dialog-close" onClick={() => setShowImportDialog(false)}>
                <i className="fas fa-times" />
              </button>
            </div>

            {/* Drop zone */}
            <div className="import-dialog-body">
              <div
                className={`import-drop-zone${importDragOver ? " drag-over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setImportDragOver(true); }}
                onDragEnter={(e) => { e.preventDefault(); setImportDragOver(true); }}
                onDragLeave={() => setImportDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setImportDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f && f.name.endsWith(".csv")) { setShowImportDialog(false); setImportFile(f); }
                }}>
                <div className={`import-drop-icon${importDragOver ? " active" : ""}`}>
                  <i className={`fas ${importDragOver ? "fa-file-csv" : "fa-cloud-upload-alt"}`} />
                </div>
                <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--color-dark)", marginBottom: 4 }}>
                  {importDragOver ? "วางไฟล์ที่นี่เลย!" : "ลากไฟล์ CSV มาวางที่นี่"}
                </div>
                <div style={{ fontSize: "0.82rem", color: "var(--color-dark-variant)", marginBottom: 16 }}>
                  {importDragOver ? "" : "หรือกดปุ่มด้านล่างเพื่อเลือกไฟล์"}
                </div>
                {!importDragOver && (
                  <button className="btn btn-primary btn-sm d-inline-flex align-items-center"
                    style={{ gap: 6 }}
                    onClick={() => importInputRef.current?.click()}>
                    <i className="fas fa-folder-open" />เลือกไฟล์จากเครื่อง
                  </button>
                )}
              </div>

              {/* Template card */}
              <button className="import-template-card" onClick={() => downloadCsvTemplate()}>
                <div className="import-template-icon">
                  <i className="fas fa-download" />
                </div>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontWeight: 600, fontSize: "0.88rem", color: "var(--color-dark)" }}>ดาวน์โหลด Template CSV</div>
                  <div style={{ fontSize: "0.76rem", color: "var(--color-dark-variant)", marginTop: 2 }}>
                    ไฟล์ตัวอย่างพร้อมเลขห้องทุกห้องในระบบ
                  </div>
                </div>
                <i className="fas fa-chevron-right ms-auto" style={{ color: "var(--color-dark-variant)", fontSize: "0.75rem", flexShrink: 0 }} />
              </button>

              {/* Format hint */}
              <div className="import-format-hint">
                <i className="fas fa-info-circle" style={{ flexShrink: 0 }} />
                <span>รองรับ CSV รูปแบบ <strong>นำเข้าได้</strong> และ <strong>ละเอียด</strong> จากหน้า Export&nbsp;&nbsp;<code>06/2568,101,1234,56</code></span>
              </div>

              {/* Divider */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--color-dark-variant)", fontSize: "0.75rem" }}>
                <div style={{ flex: 1, height: 1, background: "var(--color-light)" }} />
                <span>หรือ</span>
                <div style={{ flex: 1, height: 1, background: "var(--color-light)" }} />
              </div>

              {/* Google Sheet import card */}
              <button
                className="import-template-card"
                disabled={syncing}
                onClick={() => { setShowImportDialog(false); handleSyncSheets(); }}>
                <div className="import-template-icon" style={{ background: "linear-gradient(135deg,rgba(52,168,83,0.2),rgba(52,168,83,0.08))", borderColor: "rgba(52,168,83,0.25)", color: "#34a853" }}>
                  {syncing
                    ? <span className="spinner-border spinner-border-sm" />
                    : <i className="fas fa-table" />}
                </div>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontWeight: 600, fontSize: "0.88rem", color: "var(--color-dark)" }}>นำเข้าจาก Google Sheet</div>
                  <div style={{ fontSize: "0.76rem", color: "var(--color-dark-variant)", marginTop: 2 }}>
                    ซิงค์ข้อมูลมิเตอร์จาก Spreadsheet โดยตรง
                  </div>
                </div>
                <i className="fas fa-chevron-right ms-auto" style={{ color: "var(--color-dark-variant)", fontSize: "0.75rem", flexShrink: 0 }} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {importFile && (
        <ImportModal
          file={importFile}
          rooms={rooms}
          allRecords={meters}
          onClose={() => setImportFile(null)}
          onImport={handleImportConfirm}
        />
      )}

      {/* Confirm Delete */}
      {confirmDeleteMY && (
        <div className="confirm-overlay" onClick={() => !deleting && setConfirmDeleteMY(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon confirm-icon--danger"><i className="fas fa-trash-alt" /></div>
            <h6 className="confirm-title">ยืนยันการลบข้อมูล?</h6>
            <p className="confirm-message">
              คุณต้องการลบประวัติการจดมิเตอร์ของ{" "}
              <strong>{monthYearLabel(confirmDeleteMY)}</strong> ใช่หรือไม่?
              <br />
              <small className="text-danger">คำเตือน: ข้อมูลจะถูกลบถาวร ไม่สามารถกู้คืนได้</small>
            </p>
            <div className="confirm-actions">
              <button className="btn btn-outline-secondary"
                onClick={() => setConfirmDeleteMY(null)} disabled={deleting}>
                ยกเลิก
              </button>
              <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
                {deleting
                  ? <><span className="spinner-border spinner-border-sm me-2" />กำลังลบ...</>
                  : <><i className="fas fa-trash-alt me-1" />ใช่, ลบข้อมูล</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Print-only tables (หลายเดือน, ซ่อนบนจอ แสดงตอนพิมพ์) ── */}
      {printSelectedMYs.size > 0 && (() => {
        const printSortedMYs = [...printSelectedMYs].sort((a, b) => myScore(a) - myScore(b));
        return (
          <div className="meter-print-only">
            {printSortedMYs.map((my, idx) => {
              const record = meters.find((m) => m.monthYear === my);
              if (!record) return null;
              const prevRecord     = findRecord(meters, prevMY(my));
              const prevPrevRecord = findRecord(meters, prevMY(prevMY(my)));
              const activeRooms = buildRoomsFromKeys(new Set(Object.keys(record.data ?? {})), rooms, record.data)
                .filter((r) => printRoomNumbers.has(r.number))
                .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true, sensitivity: "base" }));
              return (
                <div key={my} style={idx > 0 ? { pageBreakBefore: "always" } : undefined}>
                  <div style={{ marginBottom: 10 }}>
                    <strong style={{ fontSize: 13 }}>รายละเอียดการจดมิเตอร์: {monthYearLabel(my)}</strong>
                    {record.recordDate && <span style={{ marginLeft: 16, fontSize: 11, color: "#555" }}>วันที่บันทึก: {thaiDateOnlyString(new Date(record.recordDate))}</span>}
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "9pt" }}>
                    <thead>
                      <tr>
                        {DETAIL_COLS.filter((c) => printColKeys.has(c.key)).map((col) => (
                          <th key={col.key} className={col.thClass ?? ""}
                            style={{ border: "1px solid #bbb", padding: "5px 7px", background: "#e8e8e8", fontWeight: 600, whiteSpace: "nowrap" }}>
                            {col.key === "ePrev" || col.key === "eCurr" || col.key === "eUnit"
                              ? <><i className="fas fa-bolt me-1" style={{ color: "#b07000" }} />{col.header}</>
                              : col.key === "wPrev" || col.key === "wCurr" || col.key === "wUnit"
                                ? <><i className="fas fa-tint me-1" style={{ color: "#0055aa" }} />{col.header}</>
                                : col.header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeRooms.map((room) => (
                        <tr key={room.id}>
                          {DETAIL_COLS.filter((c) => printColKeys.has(c.key)).map((col) => (
                            <td key={col.key} className={col.tdClass ?? ""}
                              style={{ border: "1px solid #ddd", padding: "4px 7px", color: "#000" }}>
                              {renderMeterCellForPrint(col.key, room, record, prevRecord, prevPrevRecord, tenants, Math.pow(10, config.meterDigits || 4))}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ marginTop: 8, fontSize: 9, color: "#888", textAlign: "right" }}>
                    {activeRooms.length} ห้อง
                  </div>
                </div>
              );
            })}
            <div style={{ marginTop: 8, fontSize: 9, color: "#888", textAlign: "right" }}>
              {printSortedMYs.length} เดือน · พิมพ์เมื่อ: {thaiDateTimeString(new Date())}
            </div>
          </div>
        );
      })()}

    </div>
  );
}
