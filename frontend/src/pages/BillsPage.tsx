import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation, useNavigationType } from "react-router-dom";
import Select, { components } from "react-select";
import { billsApi, roomsApi, tenantsApi, vehiclesApi, metersApi, settingsApi, specialDiscountsApi } from "../api/client";
import { useBreadcrumb } from "../context/BreadcrumbContext";
import { useAppConfig, type AppConfig } from "../context/AppConfigContext";
import CustomSelect2 from "../components/CustomSelect2";
import { BillLinePreview } from "../components/BillLinePreviewCard";
import ToolbarActionsMenu from "../components/ToolbarActionsMenu";
import ColResizeHandle from "../components/ColResizeHandle";
import ThaiDatePicker from "../components/ThaiDatePicker";
import EmptyState from "../components/EmptyState";
import PinMenuPopup, { type PinMenuState } from "../components/PinMenuPopup";
import {
  type BillGroup, type BillItem, type BillLineItem, type GenCtx, type OutstandingItem, type OutstandingAdjustment,
  type SpecialDiscount,
  monthYearLabel, myScore, prevMY,
  generateBillForMonth, refreshDerivedFields, recalcItem, resolveDefaultFormulas,
  syncTenantForItem, normalizeBillItem, getRoomsAwaitingMeterReading, closeOutstandingBills,
  adjustedOutstandingAmount, applyPartialOutstandingPayment, buildWaterElectricRows, ROUNDING_DISCOUNT_ID,
  reconcileOutstandingItems, thaiBahtText,
} from "../utils/billCalc";
import { usePersistedViewMode } from "../utils/usePersistedViewMode";
import { useColumnWidths, useColumnVisibility, useRowOrder, usePersistedPref } from "../utils/useColumnWidths";
import { useAuth } from "../context/AuthContext";
import { thaiDateTimeString, thaiDateOnlyString, thaiFullDateString } from "../utils/yearFormat";
import { useLiveRefreshTick } from "../utils/useLiveSync";
import { toastSuccess, toastError } from "../utils/toast";
import { setUnsavedGuard, clearUnsavedGuard, guardNavigation } from "../utils/unsavedGuard";
import { findTenantForRoom } from "../utils/tenantRoom";

// หมายเหตุ: ข้อมูลเดือน/ปีของบิลและมิเตอร์ในระบบนี้เก็บเป็นปี ค.ศ. ตรงๆ เสมอ (ไม่แปลง)
// เพื่อให้ตรงกับข้อมูลมิเตอร์/บิลเดิมที่มีอยู่แล้ว — การแปลงเป็น พ.ศ./ค.ศ. ตามที่ผู้ใช้เลือกไว้ในหน้าตั้งค่า
// ทำแค่ตอนแสดงผล (label) เท่านั้น ผ่าน monthYearLabel()
const STATUS_OPTIONS = [
  { value: "all", label: "ทุกสถานะ" },
  { value: "unpaid", label: "ค้างชำระ (Unpaid)" },
  { value: "paid", label: "จ่ายแล้ว (Paid)" },
  { value: "overdue", label: "เกินกำหนด (Overdue)" },
];
const GROUP_SORT_OPTIONS = [
  { value: "desc", label: "ใหม่สุด - เก่าสุด" },
  { value: "asc", label: "เก่าสุด - ใหม่สุด" },
];

function money(n: number) {
  return (Number(n) || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ข้อความสรุปการส่งบิลทาง LINE ล่าสุด — ใช้ทั้งใน tooltip ปุ่มส่ง และในป็อปอัพยืนยันการส่ง (BillsPage)
function sendLogSummary(log?: { timestamp: string; method: "manual" | "auto"; by?: string; status: "success" | "error" }) {
  if (!log) return "ยังไม่เคยส่ง";
  const who = log.by || (log.method === "auto" ? "ระบบอัตโนมัติ" : "-");
  const statusText = log.status === "success" ? "สำเร็จ" : "ไม่สำเร็จ";
  return `ส่งล่าสุด: ${new Date(log.timestamp).toLocaleString("th-TH")} โดย ${who} (${statusText})`;
}

function formatDateSafe(s?: string) {
  if (!s) return "-";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s; // ข้อมูลเก่าบางรายการเก็บวันที่เป็นข้อความรูปแบบอื่น แสดงข้อความเดิมแทนการ crash/Invalid Date
  return thaiDateTimeString(d);
}

// scheduledDate มาจาก <input type="date"> (ISO ค.ศ. ล้วน) — แปลงตามที่ตั้งค่าไว้ (พ.ศ./ค.ศ.) แค่ตอนแสดงผล
function scheduledDateSafe(s?: string) {
  if (!s) return "-";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return thaiDateOnlyString(d);
}

// ── พิมพ์บิลสำหรับห้องที่มีผู้ร่วมพักหลายคน: เอาแค่ใบหลัก / แยกใบตามคนหารราคา / เอาทั้งคู่ ──
type BillSplitMode = "main" | "split" | "both";
// จำนวนใบบิล (slip) ที่พิมพ์ต่อแผ่น A4 หนึ่งแผ่น — "auto" = ปล่อยขยายอัตโนมัติตามเนื้อหาเหมือนเดิม
// "pretty" = ใบแบบสวยเต็มแผ่น 1 ใบ/หน้าเสมอ (BillSlipPretty) คนละแบบกับใบแนวยาว (BillSlip) ที่ใช้กับ auto/1-4
type BillSlipLayout = "auto" | "1" | "2" | "3" | "4" | "pretty";
const DEFAULT_SLIP_LINE_KEYS = new Set(["room", "water", "electric", "outstanding"]);
type PrintEntry = {
  item: BillItem; monthYear: string;
  payerName?: string; payerIndex?: number; payerCount?: number; payerTotal?: number;
};

function getResidentNames(item: BillItem, tenants: any[]): string[] {
  const mainName = item.tenantId ? `${item.tenantTitle} ${item.tenantName}`.trim() : item.tenantName;
  if (item.residentCount <= 1) return [mainName];
  const tenant = tenants.find((t) => String(t.id) === String(item.tenantId));
  const coNames: string[] = Array.isArray(tenant?.coResidents)
    ? tenant.coResidents.map((c: any) => String(c?.name ?? "").trim()).filter(Boolean)
    : [];
  const names = [mainName, ...coNames];
  // เผื่อจำนวนชื่อที่มีจริงไม่ครบตาม residentCount (ข้อมูลผู้ร่วมพักไม่ครบ) — เติมชื่อว่างเป็น "ผู้ร่วมพัก N" ให้ครบจำนวน
  while (names.length < item.residentCount) names.push(`ผู้ร่วมพัก ${names.length}`);
  return names;
}

function expandEntriesForPrint(
  entries: { item: BillItem; monthYear: string }[],
  splitMode: BillSplitMode,
  tenants: any[]
): PrintEntry[] {
  if (splitMode === "main") return entries;
  const result: PrintEntry[] = [];
  entries.forEach((e) => {
    const { item } = e;
    if (item.residentCount <= 1) { result.push(e); return; }
    if (splitMode === "both") result.push(e);
    const names = getResidentNames(item, tenants);
    const share = item.total / item.residentCount;
    names.forEach((name, i) => {
      result.push({ ...e, payerName: name, payerIndex: i + 1, payerCount: item.residentCount, payerTotal: share });
    });
  });
  return result;
}

function otherChargesTotal(item: BillItem) {
  const tags = item.billTagItems.reduce((s, t) => s + (Number(t.price) || 0), 0)
    + item.billTenantTagItems.reduce((s, t) => s + (Number(t.price) || 0), 0);
  const custom = item.customItems.reduce((s, c) => s + (Number(c.price) || 0), 0);
  const discount = item.discountItems.reduce((s, d) => s + (Number(d.price) || 0), 0);
  return item.priceVehicle + tags + custom - discount;
}

// ── คอลัมน์ของ "ตารางสรุปบิล" (โหมดพิมพ์ record) — เลือกได้ว่าจะเอาคอลัมน์ไหนเหมือนหน้าจดมิเตอร์
// คอลัมน์ที่ blank: true คือช่องว่างเปล่าไว้ให้เขียนด้วยมือ (เช่น ตอนเก็บเงินหน้างาน) ไม่ได้ดึงข้อมูลจากบิล
interface BillRecordColDef { key: string; header: string; align?: "end"; blank?: boolean }
const BILL_RECORD_COLS: BillRecordColDef[] = [
  { key: "room", header: "ห้อง" },
  { key: "tenant", header: "ผู้เช่า" },
  { key: "priceRoom", header: "ค่าห้อง", align: "end" },
  { key: "water", header: "ค่าน้ำ", align: "end" },
  { key: "electric", header: "ค่าไฟ", align: "end" },
  { key: "vehicle", header: "ค่าจอดรถ", align: "end" },
  { key: "roomTag", header: "Tag ห้อง", align: "end" },
  { key: "tenantTag", header: "Tag ผู้เช่า", align: "end" },
  { key: "customItems", header: "รายการอื่นๆ", align: "end" },
  { key: "discount", header: "ส่วนลด", align: "end" },
  { key: "other", header: "อื่นๆ (รวม)", align: "end" },
  { key: "ownMonth", header: "ยอดเดือนนี้", align: "end" },
  { key: "outstanding", header: "ค้างชำระ", align: "end" },
  { key: "fine", header: "ค่าปรับ", align: "end" },
  { key: "total", header: "รวมสุทธิ", align: "end" },
  { key: "status", header: "สถานะ" },
  { key: "collected", header: "ยอดที่เก็บจริง", align: "end", blank: true },
  { key: "collectDate", header: "วันที่เก็บ", blank: true },
  { key: "signature", header: "ลายเซ็นผู้รับ/ผู้จ่าย", blank: true },
  { key: "note", header: "หมายเหตุ", blank: true },
];
// ค่าเริ่มต้น: คอลัมน์แยกย่อย (ค่าจอดรถ/Tag ห้อง/Tag ผู้เช่า/รายการอื่นๆ/ส่วนลด) ปิดไว้ก่อน เปิดเองได้จาก
// ตัวเลือกคอลัมน์ — ถ้าเปิดทุกอย่างพร้อมกันเป็นค่าเริ่มต้น ตารางจะกว้างเกินหน้ากระดาษ A4 แนวนอน จนบางคอลัมน์
// (โดยเฉพาะตัวที่อยู่กลางๆ) ล้นออกนอกหน้าไม่ถูกพิมพ์ให้เห็นเลย — คงค่าเริ่มต้นเป็นชุดเดิมก่อนมีฟีเจอร์นี้ไว้
// (รวม "อื่นๆ (รวม)" เหมือนเดิม) ผู้ใช้ที่อยากได้รายละเอียดแยกค่อยเปิดเพิ่มเอง (แนะนำให้ปิด "อื่นๆ (รวม)" ลง
// พร้อมกันกันข้อมูลซ้ำซ้อน/ตารางกว้างเกินไป)
const BILL_RECORD_DEFAULT_COLS = new Set(
  BILL_RECORD_COLS.filter((c) => !c.blank && !["vehicle", "roomTag", "tenantTag", "customItems", "discount"].includes(c.key)).map((c) => c.key)
);
const BILL_RECORD_COL_GROUPS: { label: string; icon?: string; color?: string; keys: string[] }[] = [
  { label: "ข้อมูลบิล", keys: [
    "room", "tenant", "priceRoom", "water", "electric", "vehicle", "roomTag", "tenantTag", "customItems",
    "discount", "other", "ownMonth", "outstanding", "fine", "total", "status",
  ] },
  { label: "ช่องว่างสำหรับเขียนด้วยมือ", icon: "fa-pen", color: "#b07000", keys: ["collected", "collectDate", "signature", "note"] },
];

// ── หมวดที่เลือกแสดง/ซ่อนได้ในหน้าพิมพ์ "สรุป Dashboard" (ดู DashboardSummaryPage) ──────────────────────────
const DASHBOARD_SECTIONS: { key: string; label: string; desc: string }[] = [
  { key: "roomStatus", label: "สถานะห้อง", desc: "ห้องทั้งหมด / จ่ายแล้ว / รอชำระ / เกินกำหนด" },
  { key: "breakdown", label: "แยกตามประเภทค่าใช้จ่าย", desc: "ค่าเช่า / น้ำ / ไฟ / อื่นๆ / ค่าปรับ / ค้างชำระยกมา" },
  { key: "totals", label: "ยอดเรียกเก็บ", desc: "ยอดเรียกเก็บทั้งหมด (คงที่) / คาดการณ์รายรับ / ขาดอีก" },
  { key: "received", label: "เงินที่ได้รับแล้ว", desc: "รับแล้วเดือน / เดือนเก่าที่ปิดในเดือนนี้ / ยอดรับแล้วสุทธิ" },
];
const DASHBOARD_SECTIONS_DEFAULT = DASHBOARD_SECTIONS.map((s) => s.key);

// entry.payerTotal !== undefined = แถวนี้คือ "แถวแยกตามคน" (มาจาก splitMode split/both) แสดงชื่อคนนั้นๆ
// และยอดหารเฉพาะของเขา ส่วนแถวปกติ (ไม่แยก) ถ้าเปิดฟีเจอร์หารค่าเช่าฯ + ห้องมีผู้ร่วมพัก จะโชว์สรุปหาร
// ต่อคนแทรกไว้ใต้ชื่อผู้เช่าหลัก/ยอดรวม ให้ตรงกับที่ใบบิลรายห้อง (BillSlip) แสดงอยู่แล้ว
function renderBillRecordCell(
  col: BillRecordColDef, entry: PrintEntry, config: AppConfig, tenants: any[],
  otherDetailMode: "price" | "detail" = "price",
  totalDisplayMode: "net" | "excludeSpecialDiscount" = "net"
) {
  const { item } = entry;
  const isSplitRow = entry.payerTotal !== undefined;
  const showSplit = !isSplitRow && !!config.features.splitRentByResidents && item.residentCount > 1;
  switch (col.key) {
    case "room": return item.roomNumber;
    case "tenant": {
      if (isSplitRow) {
        return (
          <>
            {entry.payerName}
            <div className="bill-record-subline">ผู้ร่วมพักคนที่ {entry.payerIndex}/{entry.payerCount}</div>
          </>
        );
      }
      const mainName = item.tenantId ? `${item.tenantTitle} ${item.tenantName}` : item.tenantName;
      if (!showSplit) return mainName;
      const coNames = getResidentNames(item, tenants).slice(1);
      return (
        <>
          {mainName}
          {coNames.length > 0 && <div className="bill-record-subline">ร่วมกับ {coNames.join(", ")}</div>}
        </>
      );
    }
    case "priceRoom": return money(item.priceRoom);
    case "water": return money(item.priceWater);
    case "electric": return money(item.priceElectric);
    case "vehicle": return item.priceVehicle > 0 ? money(item.priceVehicle) : "-";
    case "roomTag":
      return item.billTagItems.length > 0 ? (
        <>{item.billTagItems.map((t, i) => <div key={i}>{t.name} ({money(t.price)})</div>)}</>
      ) : "-";
    case "tenantTag":
      return item.billTenantTagItems.length > 0 ? (
        <>{item.billTenantTagItems.map((t, i) => <div key={i}>{t.name} ({money(t.price)})</div>)}</>
      ) : "-";
    case "customItems":
      return item.customItems.length > 0 ? (
        <>{item.customItems.map((c, i) => <div key={i}>{c.name} ({money(c.price)})</div>)}</>
      ) : "-";
    case "discount":
      return item.discountItems.length > 0 ? (
        <>{item.discountItems.map((d, i) => <div key={i}>{d.name} (-{money(d.price)})</div>)}</>
      ) : "-";
    // "อื่นๆ (รวม)" — ยอดรวมของค่าจอดรถ/Tag ห้อง/Tag ผู้เช่า/รายการอื่นๆ หักส่วนลด ก้อนเดียว (ซ้ำข้อมูลกับ
    // คอลัมน์แยกด้านบน ไว้ให้เลือกโชว์แทนคอลัมน์แยกถ้าอยากได้ตารางแคบลง) — otherDetailMode เลือกว่าจะโชว์แค่
    // ยอดรวมเฉยๆ หรือแตกรายละเอียดทุกรายการให้ด้วยในช่องเดียวกัน
    case "other": {
      const totalText = money(otherChargesTotal(item));
      if (otherDetailMode === "price") return totalText;
      const lines: { name: string; price: number }[] = [
        ...item.billTagItems.map((t) => ({ name: t.name, price: t.price })),
        ...item.billTenantTagItems.map((t) => ({ name: t.name, price: t.price })),
        ...(item.priceVehicle > 0 ? [{ name: "ค่าจอดรถ", price: item.priceVehicle }] : []),
        ...item.customItems.map((c) => ({ name: c.name, price: c.price })),
        ...item.discountItems.map((d) => ({ name: d.name, price: -d.price })),
      ];
      if (lines.length === 0) return totalText;
      return (
        <>
          <div className="bill-record-subline fw-bold">{totalText}</div>
          {lines.map((l, i) => <div key={i} className="bill-record-subline">{l.name} ({l.price < 0 ? "-" : ""}{money(Math.abs(l.price))})</div>)}
        </>
      );
    }
    case "ownMonth": return money(Math.max(0, item.total - (item.outstandingAmount || 0)));
    case "outstanding": {
      if (!(item.outstandingAmount > 0) || item.status === "paid") return "-";
      // บอกด้วยว่าค้างของเดือนไหนบ้าง (ยอดค้างอาจยกมาจากหลายเดือนติดกันพร้อมกันได้) ไม่ใช่โชว์แค่ยอดรวมเฉยๆ
      // เหมือนคอลัมน์ค้างชำระในตารางบิลแบบ interactive (ดู case "outstanding" ใน renderCell ด้านล่าง)
      if (item.outstandingItems.length === 0) return money(item.outstandingAmount);
      return (
        <>
          {item.outstandingItems.map((o, i) => (
            <div key={i}>{monthYearLabel(o.monthYear)} ({money(o.amount)})</div>
          ))}
        </>
      );
    }
    case "fine": return item.fineAmount > 0 ? money(item.fineAmount) : "-";
    case "total": {
      if (isSplitRow) {
        return (
          <>
            {money(entry.payerTotal as number)}
            <div className="bill-record-subline">หารจาก {money(item.total)} ÷ {entry.payerCount} คน</div>
          </>
        );
      }
      // ส่วนลดพิเศษ (id ขึ้นต้น "special-" — ดู applySpecialDiscounts ใน billCalc.ts) มีวันหมดอายุได้ ยอด
      // รวมสุทธิปัจจุบันเลยอาจไม่ใช่ยอดที่จะเรียกเก็บจริงถาวร — โชว์ทั้งสองยอดให้เห็นเสมอถ้ามีส่วนลดพิเศษ:
      // ยอดหลัก (ตามโหมดที่เลือก) + บรรทัดเล็กบอกอีกยอดหนึ่งไว้เทียบ กันพนักงานเข้าใจผิดว่ายอดนี้คงที่ตลอดไป
      const specialDiscountTotal = item.discountItems
        .filter((d) => d.id.startsWith("special-"))
        .reduce((s, d) => s + (Number(d.price) || 0), 0);
      const fullAmount = item.total + specialDiscountTotal; // ยอดถ้าไม่มีส่วนลดพิเศษนี้ (หลังหมดอายุ)
      const mainTotal = totalDisplayMode === "excludeSpecialDiscount" ? fullAmount : item.total;
      const altLabel = totalDisplayMode === "excludeSpecialDiscount"
        ? `ยอดปัจจุบัน (รวมส่วนลดพิเศษแล้ว) ${money(item.total)}`
        : `ยอดหลังส่วนลดพิเศษหมดอายุ ${money(fullAmount)}`;
      if (!showSplit) {
        return (
          <>
            {money(mainTotal)}
            {specialDiscountTotal > 0 && <div className="bill-record-subline">{altLabel}</div>}
          </>
        );
      }
      return (
        <>
          {money(mainTotal)}
          <div className="bill-record-subline">หาร {item.residentCount} คน · คนละ {money(mainTotal / item.residentCount)}</div>
          {specialDiscountTotal > 0 && <div className="bill-record-subline">{altLabel}</div>}
        </>
      );
    }
    case "status": return item.status === "paid" ? "จ่ายแล้ว" : "รอชำระ";
    default: return null; // คอลัมน์ blank สำหรับเขียนด้วยมือ — ไม่มีข้อมูลให้แสดง
  }
}

// ── ประวัติการชำระของห้อง/เดือนนี้ — เรียงตามวันที่จ่ายจริง (เก่า → ใหม่) ──────
function getPaymentHistory(payments: any[], roomId: string, monthYear: string) {
  return payments
    .filter((p) => p?.data?.roomId === roomId && p?.data?.monthYear === monthYear)
    .sort((a, b) => new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime());
}

// สลิปล่าสุดของยอดที่จ่ายผ่านสแกน/โอน (ไม่นับยอดที่ยกเลิกแล้ว) ใช้โชว์ปุ่ม "ดูสลิป" ในตารางบิลโดยไม่ต้องเปิดรายละเอียด
function getLatestSlipUrl(payments: any[], roomId: string, monthYear: string): string | null {
  const history = getPaymentHistory(payments, roomId, monthYear);
  for (let i = history.length - 1; i >= 0; i--) {
    const p = history[i];
    if (p?.data?.method === "scan" && p?.data?.slipUrl && !p?.data?.cancelled) return p.data.slipUrl;
  }
  return null;
}

function BillStatusBadge({ item }: { item: BillItem }) {
  if (item.status === "paid") return <span className="status-badge status-paid">จ่ายแล้ว</span>;
  if (item.paidAmount > 0) return <span className="status-badge status-partial">ค้าง {money(item.total - item.paidAmount)} ฿</span>;
  if (item.isOverdue) return <span className="status-badge status-overdue">เกินกำหนด {item.overdueDays} วัน</span>;
  return <span className="status-badge status-unpaid">รอชำระ</span>;
}

// รับ overdue config ที่ "แช่แข็ง" ไว้กับตัวบิลแต่ละใบ (item.overdueConfig) แทนค่าปัจจุบันในหน้าตั้งค่า
// เพื่อไม่ให้ข้อความกำหนดชำระบนบิลเก่าเปลี่ยนไปตามการแก้ไขวันครบกำหนด/ค่าปรับภายหลัง
// (ค่าปรับที่คำนวณจริงใน calculateOverdueFine ก็ใช้ config ชุดเดียวกันนี้อยู่แล้ว — ฟังก์ชันนี้แค่ทำให้ข้อความที่แสดงตรงกัน)
function dueDateLabel(overdue: AppConfig["overdue"] | undefined) {
  const day = overdue?.day ?? 5;
  return day === 0 ? "กำหนดชำระภายในสิ้นเดือน" : `กำหนดชำระภายในวันที่ ${day} ของเดือน`;
}

// ── รายการประวัติการชำระ พร้อมปุ่มยกเลิกรายยอด — ใช้ร่วมกันทั้งป็อปอัพจ่ายเงินและหน้ารายละเอียดบิล ──
function PaymentHistoryList({ history, onCancel }: {
  history: any[];
  onCancel: (p: any, reason: string) => Promise<void>;
}) {
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<any | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // ยอด "ชำระไปแล้วรวม" ต้องรวมจากรายการที่เห็นในลิสต์นี้เองเท่านั้น (ไม่นับที่ยกเลิกแล้ว) ไม่ใช่ item.paidAmount
  // ของบิลเดือนที่กำลังแก้ไข เพราะรายการในลิสต์อาจเป็นยอดที่จ่ายไปปิดยอดค้างของเดือนอื่นทั้งหมด (ไม่ได้ลง
  // paidAmount ของเดือนนี้เลยสักบาท — ดู handleConfirmPayment/includeCurrentMonth) ถ้าใช้ item.paidAmount
  // จะโชว์ 0 ทั้งที่ลิสต์ด้านบนมีรายการจ่ายจริงอยู่ ทำให้ดูเหมือนยอดที่จ่ายไปแล้วหายไป
  const totalPaid = history.reduce((sum, p) => {
    if (p.data?.cancelled) return sum;
    const linkedOld: { amount: number }[] = Array.isArray(p.data?.linkedOldMonthPayments) ? p.data.linkedOldMonthPayments : [];
    const linkedOldTotal = linkedOld.reduce((s: number, l: any) => s + (Number(l?.amount) || 0), 0);
    return sum + (Number(p.data?.amount) || 0) + linkedOldTotal;
  }, 0);

  async function doCancel(p: any) {
    setCancellingId(p.id);
    try {
      await onCancel(p, cancelReason.trim());
      setConfirmCancel(null);
      setCancelReason("");
      toastSuccess("ยกเลิกรายการชำระเงินสำเร็จ");
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <>
      <div className="payment-history-list nicescrollbar">
        {history.map((p, i) => {
          const cancelled = !!p.data?.cancelled;
          const linkedOld: { id: string; monthYear: string; amount: number }[] = Array.isArray(p.data?.linkedOldMonthPayments) ? p.data.linkedOldMonthPayments : [];
          const settledVia: string = p.data?.settledViaMonthYear || "";
          // ยอดของรายการนี้ = ส่วนที่ลงบิลเดือนนี้ (data.amount) + ยอดเดือนเก่าที่ปิดไปพร้อมกันในรายการเดียวกัน
          // (linkedOldMonthPayments) ไม่งั้นถ้าจ่าย "เฉพาะเดือนเก่า" (ไม่รวมเดือนนี้) data.amount จะเป็น 0 ทั้งที่
          // จริงๆ รับเงินของเดือนเก่ามาแล้ว
          const linkedOldTotal = linkedOld.reduce((s, l) => s + (Number(l.amount) || 0), 0);
          const txnAmount = (Number(p.data?.amount) || 0) + linkedOldTotal;
          return (
            <div key={p.id} className={`payment-history-item${cancelled ? " cancelled" : ""}`}>
              <div className="phi-top">
                <span className="phi-idx">
                  ยอดที่ {i + 1}
                  {cancelled && <span className="phi-cancelled-badge">ยกเลิกแล้ว</span>}
                </span>
                <span className="phi-amt">{money(txnAmount)} ฿</span>
              </div>
              <div className="phi-bottom">
                <span className="phi-meta">
                  <i className={`fas ${p.data?.method === "scan" ? "fa-qrcode" : "fa-money-bill-wave"} me-1`} />
                  {p.data?.method === "scan" ? "สแกน/โอน" : "เงินสด"} · {scheduledDateSafe(p.paymentDate)}
                  {p.data?.slipUrl && (
                    <button type="button" className="phi-slip-thumb" title="ดูสลิป" onClick={() => setLightboxSrc(p.data.slipUrl)}>
                      <img src={p.data.slipUrl} alt="สลิป" />
                    </button>
                  )}
                </span>
                {!cancelled && (
                  <button type="button" className="phi-cancel" title="ยกเลิกยอดนี้"
                    disabled={cancellingId === p.id} onClick={() => { setConfirmCancel(p); setCancelReason(""); }}>
                    {cancellingId === p.id ? <span className="spinner-border spinner-border-sm" /> : <i className="fas fa-times" />}
                  </button>
                )}
              </div>
              {settledVia && (
                <div className="text-muted" style={{ fontSize: 11 }}>
                  <i className="fas fa-link me-1" />ชำระจากเดือน {monthYearLabel(settledVia)}
                </div>
              )}
              {linkedOld.length > 0 && (
                <div className="text-muted" style={{ fontSize: 11 }}>
                  <i className="fas fa-link me-1" />
                  ปิดยอดของเดือน {linkedOld.map((l) => `${monthYearLabel(l.monthYear)} (${money(Number(l.amount) || 0)} ฿)`).join(", ")} ไปด้วย
                </div>
              )}
              {cancelled && (
                <div className="phi-cancel-note">
                  <i className="fas fa-comment-dots me-1" />
                  {p.data?.cancelReason || "ไม่ได้ระบุหมายเหตุ"}
                </div>
              )}
            </div>
          );
        })}
        <div className="payment-history-row payment-history-sum">
          <span>ชำระไปแล้วรวม</span>
          <span className="amt">{money(totalPaid)} ฿</span>
        </div>
      </div>

      {confirmCancel && (
        <div className="confirm-overlay" onClick={() => !cancellingId && setConfirmCancel(null)} style={{ zIndex: 1200 }}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon confirm-icon--danger"><i className="fas fa-times" /></div>
            <h6 className="confirm-title">ยกเลิกยอดชำระนี้?</h6>
            <p className="confirm-message">
              ยกเลิกยอด {money((Number(confirmCancel.data?.amount) || 0) + (Array.isArray(confirmCancel.data?.linkedOldMonthPayments) ? confirmCancel.data.linkedOldMonthPayments.reduce((s: number, l: any) => s + (Number(l?.amount) || 0), 0) : 0))} ฿ ที่ชำระเมื่อ {scheduledDateSafe(confirmCancel.paymentDate)} ใช่หรือไม่?
              <br /><small className="text-danger">ยอดคงเหลือของบิลจะเพิ่มขึ้นตามจำนวนนี้ และสถานะจะเปลี่ยนเป็นค้างชำระถ้ายังไม่ครบ</small>
            </p>
            <div className="text-start mb-3">
              <label className="form-label small fw-bold">หมายเหตุการยกเลิก</label>
              <textarea className="form-control" rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                placeholder="เช่น กรอกยอดผิด, ลูกค้ายกเลิกการโอน..." />
            </div>
            <div className="confirm-actions">
              <button className="btn btn-outline-secondary" onClick={() => setConfirmCancel(null)} disabled={!!cancellingId}>ปิด</button>
              <button className="btn btn-danger" onClick={() => doCancel(confirmCancel)} disabled={!!cancellingId || !cancelReason.trim()}>
                {cancellingId ? <><span className="spinner-border spinner-border-sm me-2" />กำลังยกเลิก...</> : <><i className="fas fa-times me-1" />ใช่, ยกเลิก</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {lightboxSrc && (
        <div className="lightbox-overlay" onClick={() => setLightboxSrc(null)}>
          <button className="lightbox-close" onClick={() => setLightboxSrc(null)}><i className="fas fa-times" /></button>
          <img className="lightbox-img" src={lightboxSrc} alt="สลิป" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}

// ── ป็อปอัพบันทึกการชำระเงิน — เลือกช่องทาง (เงินสด/สแกน) แนบสลิป บันทึกยอดสุทธิ+วันที่จ่าย ──
function PaymentModal({ item, history, monthYear, config, allBills, onClose, onConfirm, onCancelPayment }: {
  item: BillItem;
  history: any[];
  monthYear: string;
  config: AppConfig;
  allBills: BillGroup[];
  onClose: () => void;
  onConfirm: (payload: {
    method: "cash" | "scan"; received: number; note: string; paymentDate: string;
    slipImage: { base64: string; name: string } | null;
    fineWaiveAmount: number; discountItems: BillLineItem[]; settleOutstandingMonths: string[];
    settleOutstandingAdjustments: Record<string, OutstandingAdjustment>;
    includeCurrentMonth: boolean;
    sendReceipt: boolean;
  }) => Promise<void>;
  onCancelPayment: (p: any, reason: string) => Promise<void>;
}) {
  const [method, setMethod] = useState<"cash" | "scan">("cash");
  const [note, setNote] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [slipImage, setSlipImage] = useState<{ base64: string; name: string } | null>(null);
  // กดปุ่ม "ยืนยันการชำระ" แล้วถามก่อนว่าจะส่งใบเสร็จเข้า LINE ให้ผู้เช่าด้วยไหม (แทนที่จะเป็นสวิตช์ติ๊กไว้ล่วงหน้า
  // ในฟอร์ม) — ป็อปอัพนี้เปิดขึ้นมาก่อน submit() จริงจะยังไม่ทำงานจนกว่าจะเลือกตัวเลือกใดตัวเลือกหนึ่ง
  const [showReceiptChoice, setShowReceiptChoice] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // ปรับลดค่าปรับ/เพิ่มส่วนลด/เลือกปิดยอดค้างเดือนก่อน — ทำได้จากตรงนี้เลยตอนบันทึกรับเงิน ไม่ต้องย้อนไปแก้หน้ารายละเอียดบิล
  const [fineWaiveAmount, setFineWaiveAmount] = useState(0);
  const [discountItems, setDiscountItems] = useState<BillLineItem[]>(item.discountItems);
  const [newDiscName, setNewDiscName] = useState("");
  const [newDiscPrice, setNewDiscPrice] = useState("");
  // ยอดค้างยกมาที่แช่แข็งไว้กับบิลนี้ อาจมีบางเดือนที่ผู้ใช้ไปปิดยอดจากหน้าของเดือนนั้นเองไปแล้ว — แยกออกมา
  // ไม่ให้โผล่เป็นตัวเลือก "ปิดยอด" ซ้ำ และหักยอดที่ปิดไปแล้วออกจากยอดที่ต้องเก็บวันนี้ให้อัตโนมัติ
  const { pending: pendingOutstandingItems, settled: settledOutstandingItems, settledAmount: alreadySettledAmount } =
    useMemo(
      () => reconcileOutstandingItems(allBills, item.roomId, item.tenantId, item.tenantName, item.outstandingItems),
      [allBills, item.roomId, item.tenantId, item.tenantName, item.outstandingItems]
    );
  const [settleMonths, setSettleMonths] = useState<Set<string>>(() => new Set(pendingOutstandingItems.map((o) => o.monthYear)));
  // ปิดได้ = จ่ายเฉพาะยอดค้างเดือนเก่าที่เลือกไว้ ไม่จำเป็นต้องปิดยอด/จ่ายเดือนนี้ไปด้วยพร้อมกัน
  const [includeCurrentMonth, setIncludeCurrentMonth] = useState(true);

  // ยกเว้นค่าปรับ/เพิ่มส่วนลดของเดือนอื่นที่ค้างชำระ ก่อนกดปิดยอด — key เป็น monthYear ของเดือนนั้นๆ
  // (คนละอันกับ fineWaiveAmount/discountItems ด้านบนที่เป็นของเดือนปัจจุบันเท่านั้น)
  const [outstandingAdjustments, setOutstandingAdjustments] = useState<Record<string, OutstandingAdjustment>>({});
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const [monthDiscName, setMonthDiscName] = useState("");
  const [monthDiscPrice, setMonthDiscPrice] = useState("");

  function getAdjustment(my: string): OutstandingAdjustment {
    return outstandingAdjustments[my] ?? { fineWaiveAmount: 0, discountItems: [] };
  }
  function setAdjustment(my: string, updater: (a: OutstandingAdjustment) => OutstandingAdjustment) {
    setOutstandingAdjustments((prev) => ({ ...prev, [my]: updater(prev[my] ?? { fineWaiveAmount: 0, discountItems: [] }) }));
  }
  function addMonthDiscount(my: string) {
    if (!monthDiscName.trim()) return;
    setAdjustment(my, (a) => ({ ...a, discountItems: [...a.discountItems, { id: `DC-${Date.now()}`, name: monthDiscName.trim(), price: Number(monthDiscPrice) || 0 }] }));
    setMonthDiscName(""); setMonthDiscPrice("");
  }
  function removeMonthDiscount(my: string, i: number) {
    setAdjustment(my, (a) => ({ ...a, discountItems: a.discountItems.filter((_, idx) => idx !== i) }));
  }

  const originalDiscountSum = item.discountItems.reduce((s, d) => s + (Number(d.price) || 0), 0);
  const editedDiscountSum = discountItems.reduce((s, d) => s + (Number(d.price) || 0), 0);
  const discountDelta = editedDiscountSum - originalDiscountSum;

  // เดือนที่ไม่ติ๊กเลือกปิดยอด = ยังไม่เก็บวันนี้ ต้องหักออกจากยอดที่ต้องชำระวันนี้ด้วย (ไม่ใช่แค่ไม่ปิดสถานะบิลต้นทาง)
  // ไม่งั้นจะเก็บเงินไปเต็มโดยที่ไม่ได้ปิดยอดค้างเดือนนั้นจริง กลายเป็นเงินเกินไม่มีที่ไป
  const includedOutstandingItems = pendingOutstandingItems.filter((o) => settleMonths.has(o.monthYear));
  // ใช้ยอดหลังยกเว้นค่าปรับ/เพิ่มส่วนลดของเดือนนั้นๆ แล้ว (ถ้ามีปรับ) ไม่ใช่ o.amount ดิบ — ยอดที่ลดไปนี้จะ
  // หักออกจากยอดที่ต้องชำระวันนี้ไปด้วยผ่าน deferredOutstandingAmount ด้านล่างเหมือนกัน (รวมอยู่ในยอด
  // effectiveTotal ก้อนเดียว ไม่ได้แยกเรียกเก็บเป็นบิลของเดือนนั้นต่างหาก — ยอดขึ้นเป็นชำระของเดือนนี้เดือนเดียว)
  const includedOutstandingAmount = includedOutstandingItems.reduce((s, o) => s + adjustedOutstandingAmount(o, outstandingAdjustments), 0);
  // ยอดค้างยกมาที่ "ไม่เก็บวันนี้" = ยอดค้างเต็มที่แช่แข็งไว้ - เฉพาะเดือนที่เลือกปิดวันนี้ — ก้อนนี้รวมทั้งเดือนที่
  // ยังไม่เลือก (deferred จริง) และเดือนที่ปิดยอดไปแล้วก่อนหน้า (alreadySettledAmount) เพราะทั้งคู่ต้องถูกหักออก
  // จากยอดที่ต้องชำระวันนี้เท่ากัน — ส่วนเดือนที่ปิดไปแล้วจะถูกเครดิตกลับเข้า paidAmount ของเดือนนี้ตอนบันทึกจริง
  // (ดู handleConfirmPayment) เพื่อให้บิลเดือนนี้ยังปิดครบยอดเต็มได้
  const deferredOutstandingAmount = Math.max(0, item.outstandingAmount - includedOutstandingAmount);

  const totalAdjustment = fineWaiveAmount + discountDelta + deferredOutstandingAmount;
  // ปิดสวิตช์ "รวมยอดเดือนนี้ด้วย" = จ่ายเฉพาะเดือนเก่าที่เลือกไว้เท่านั้น ไม่แตะยอด/สถานะของเดือนนี้เลย
  // (ไม่หัก paidAmount เดิมของเดือนนี้ออกด้วย เพราะยอดเก่าที่ยกมาคำนวณสุทธิจาก getOutstandingBalance ไว้แล้ว)
  const effectiveTotal = includeCurrentMonth ? Math.max(0, item.total - totalAdjustment) : includedOutstandingAmount;
  const remainingDue = includeCurrentMonth ? Math.max(0, effectiveTotal - (item.paidAmount || 0)) : effectiveTotal;

  // ตัวอย่างบิล LINE ต้องเห็นค่าปรับ/ส่วนลด/ยอดค้างที่เลือกปิด/ยอดสุทธิที่ปรับแล้วสดๆ ตามที่กำลังแก้ในป็อปอัพนี้ทันที
  // ไม่ใช่ค่าเดิมของ item ก่อนปรับ — เดือนที่ยังไม่เลือกปิดจะไม่โผล่ในบิลเพราะยังไม่ได้เรียกเก็บวันนี้
  const previewItem = useMemo<BillItem>(() => ({
    ...item,
    fineAmount: Math.max(0, item.fineAmount - fineWaiveAmount),
    discountItems,
    outstandingItems: includedOutstandingItems,
    outstandingAmount: includedOutstandingAmount,
    total: effectiveTotal,
  }), [item, fineWaiveAmount, discountItems, effectiveTotal, includedOutstandingAmount]);

  const [received, setReceived] = useState(remainingDue);

  const change = Math.max(0, received - remainingDue);
  const willFullySettle = received >= remainingDue;
  const stillOwing = Math.max(0, remainingDue - received);

  // ถ้ายอดคงเหลือเปลี่ยนจากภายนอก (เช่น เพิ่งกดยกเลิกยอดชำระเก่าในลิสต์ด้านขวา หรือปรับค่าปรับ/ส่วนลด) ให้ตั้งค่าเริ่มต้นใหม่ตาม
  useEffect(() => { setReceived(remainingDue); }, [remainingDue]);

  function toggleSettleMonth(my: string) {
    setSettleMonths((prev) => {
      const next = new Set(prev);
      if (next.has(my)) next.delete(my); else next.add(my);
      return next;
    });
  }

  function addDiscount() {
    if (!newDiscName.trim()) return;
    setDiscountItems((prev) => [...prev, { id: `DC-${Date.now()}`, name: newDiscName.trim(), price: Number(newDiscPrice) || 0 }]);
    setNewDiscName(""); setNewDiscPrice("");
  }
  function removeDiscount(i: number) {
    setDiscountItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  function handleFile(f: File) {
    const reader = new FileReader();
    reader.onload = () => setSlipImage({ base64: reader.result as string, name: f.name });
    reader.readAsDataURL(f);
  }

  async function submit(sendReceipt: boolean) {
    setShowReceiptChoice(false);
    setSubmitting(true);
    setError("");
    try {
      const settleOutstandingAdjustments: Record<string, OutstandingAdjustment> = {};
      for (const my of settleMonths) {
        const a = outstandingAdjustments[my];
        if (a && (a.fineWaiveAmount > 0 || a.discountItems.length > 0)) settleOutstandingAdjustments[my] = a;
      }
      await onConfirm({
        method, received, note, paymentDate, slipImage,
        fineWaiveAmount, discountItems, settleOutstandingMonths: Array.from(settleMonths),
        settleOutstandingAdjustments, includeCurrentMonth, sendReceipt,
      });
      toastSuccess("บันทึกการชำระเงินสำเร็จ");
    } catch (e: any) {
      const msg = "บันทึกไม่สำเร็จ: " + (e?.response?.data?.error ?? e?.message ?? "Unknown error");
      setError(msg);
      toastError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const hasHistory = history.length > 0;
  const [rightTab, setRightTab] = useState<"line" | "history">(hasHistory ? "history" : "line");

  return (
    <div className="confirm-overlay" onClick={() => !submitting && onClose()}>
      <div className="confirm-dialog" style={{ maxWidth: 820, textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
        <div className="d-flex align-items-center gap-2 mb-3">
          <i className="fas fa-hand-holding-usd text-success" style={{ fontSize: "1.4rem" }} />
          <h6 className="confirm-title mb-0" style={{ textAlign: "left" }}>บันทึกการชำระเงิน — ห้อง {item.roomNumber}</h6>
        </div>

        <div className="payment-modal-body">
          <div className="payment-modal-history">
            <ul className="nav nav-pills nav-fill mb-2 payment-modal-tabs p-1 rounded shadow-sm">
              <li className="nav-item">
                <button type="button" className={`nav-link rounded-pill${rightTab === "line" ? " active" : ""}`} onClick={() => setRightTab("line")}>
                  <i className="fab fa-line me-1" />บิล LINE
                </button>
              </li>
              {hasHistory && (
                <li className="nav-item">
                  <button type="button" className={`nav-link rounded-pill${rightTab === "history" ? " active" : ""}`} onClick={() => setRightTab("history")}>
                    <i className="fas fa-receipt me-1" />ประวัติการชำระ
                  </button>
                </li>
              )}
            </ul>

            {rightTab === "line" ? (
              <div className="d-flex justify-content-center">
                <BillLinePreview item={previewItem} monthYear={monthYear} config={config} />
              </div>
            ) : (
              <>
                <label className="form-label small fw-bold mb-1">ประวัติการชำระที่ผ่านมา (จากยอดเต็ม {money(item.total)} ฿)</label>
                <PaymentHistoryList history={history} onCancel={onCancelPayment} />
              </>
            )}
          </div>

          <div className="payment-modal-form nicescrollbar">
            <div className="payment-due-box mb-3">
              <span>ยอดที่ต้องชำระ{item.paidAmount > 0 ? " (คงเหลือ)" : ""}</span>
              <span className="payment-due-amount">{money(remainingDue)} ฿</span>
            </div>
            {includeCurrentMonth && totalAdjustment > 0 && (
              <div className="text-muted small mb-3 mt-n2">
                ปรับลดจากยอดเต็ม {money(item.total)} ฿ รวม {money(totalAdjustment)} ฿
              </div>
            )}
            {!includeCurrentMonth && (
              <div className="text-muted small mb-3 mt-n2">
                <i className="fas fa-circle-info me-1" />ไม่รวมยอดของ{monthYearLabel(monthYear)} — จ่ายเฉพาะเดือนเก่าที่เลือกด้านล่างเท่านั้น ยอด/สถานะของเดือนนี้จะไม่เปลี่ยน
              </div>
            )}

            <div className="payment-adjust-section mb-3">
              {includeCurrentMonth && item.fineAmount > 0 && (
                <div className="payment-adjust-row">
                  <label className="form-label small fw-bold mb-1">
                    <i className="fas fa-exclamation-triangle me-1 text-danger" />ค่าปรับล่าช้า ({item.overdueDays} วัน)
                  </label>
                  <div className="d-flex align-items-center gap-2">
                    <input type="number" className="form-control form-control-sm text-end" min={0} max={item.fineAmount}
                      value={item.fineAmount - fineWaiveAmount}
                      onChange={(e) => {
                        const v = Math.min(item.fineAmount, Math.max(0, Number(e.target.value) || 0));
                        setFineWaiveAmount(item.fineAmount - v);
                      }} />
                    <span className="text-muted small flex-shrink-0">จากเดิม {money(item.fineAmount)} ฿</span>
                  </div>
                  {fineWaiveAmount > 0 && (
                    <div className="text-success small mt-1"><i className="fas fa-check me-1" />ลดค่าปรับให้ {money(fineWaiveAmount)} ฿</div>
                  )}
                </div>
              )}

              {includeCurrentMonth && (
                <div className={`payment-adjust-row${item.fineAmount > 0 ? " mt-2" : ""}`}>
                  <label className="form-label small fw-bold mb-1"><i className="fas fa-tag me-1 text-danger" />ส่วนลด</label>
                  {discountItems.map((d, i) => (
                    <div key={d.id} className="bill-line-row">
                      <span className="name"><i className="fas fa-tag me-1 text-danger" />{d.name}</span>
                      <span className="price text-danger">-{money(d.price)}</span>
                      <button type="button" className="btn btn-sm btn-outline-danger border-0" onClick={() => removeDiscount(i)}>
                        <i className="fas fa-times" />
                      </button>
                    </div>
                  ))}
                  <div className="d-flex gap-2 mt-1">
                    <input className="form-control form-control-sm" placeholder="ชื่อส่วนลด" value={newDiscName} onChange={(e) => setNewDiscName(e.target.value)} />
                    <input type="number" className="form-control form-control-sm text-end" style={{ maxWidth: 110 }} placeholder="จำนวนเงิน" value={newDiscPrice} onChange={(e) => setNewDiscPrice(e.target.value)} />
                    <button type="button" className="btn btn-sm btn-outline-danger flex-shrink-0" onClick={addDiscount}>
                      <i className="fas fa-plus" />
                    </button>
                  </div>
                </div>
              )}

              {(pendingOutstandingItems.length > 0 || settledOutstandingItems.length > 0) && (
                <div className="payment-adjust-row mt-2">
                  <label className="form-label small fw-bold mb-1"><i className="fas fa-history me-1 text-danger" />เลือกเดือนที่จะปิดยอดในการชำระครั้งนี้ (เลือกได้หลายเดือน)</label>
                  {(() => {
                    // ยอด "เดือนนี้" ล้วนๆ (ไม่รวมยอดค้างยกมา) หลังหักค่าปรับ/ส่วนลดที่ปรับในป็อปอัพนี้ — สูตร
                    // เดียวกับ ownRemainingDue ใน handleConfirmPayment เทียบกับ item.paidAmount ที่จ่ายไปแล้วจริง
                    // ถ้าครบแล้ว (เช่น จ่ายยอดของเดือนนี้ไปเต็มในรอบก่อนหน้า เหลือแต่ยอดค้างเดือนเก่า) ให้ล็อกเป็น
                    // "รวมอยู่ในยอดวันนี้เสมอ" (ปิดคลิกไม่ได้ เหมือนเดือนเก่าที่ปิดยอดไปแล้วด้านล่าง) แทนที่จะโชว์
                    // ยอดเต็มของเดือนนี้ซ้ำอีกรอบราวกับยังต้องเก็บเพิ่ม ทำให้ผู้ใช้เข้าใจผิดว่าต้องเก็บเงินซ้ำ
                    const ownMonthTotal = Math.max(0, item.total - item.outstandingAmount - fineWaiveAmount - discountDelta);
                    const ownMonthRemaining = Math.max(0, ownMonthTotal - (item.paidAmount || 0));
                    const ownMonthSettled = ownMonthRemaining <= 0.005;
                    return (
                      <div className={`d-flex justify-content-between align-items-center py-1 mb-1${ownMonthSettled ? " opacity-50" : ""}`}
                        style={{ borderBottom: "1px dashed var(--color-light)" }}>
                        <span style={{ cursor: ownMonthSettled ? "default" : "pointer" }}
                          onClick={() => { if (!ownMonthSettled) setIncludeCurrentMonth((v) => !v); }}>
                          <input className="form-check-input me-2" type="checkbox"
                            checked={ownMonthSettled ? true : includeCurrentMonth} disabled={ownMonthSettled}
                            onChange={(e) => setIncludeCurrentMonth(e.target.checked)} id="settle-current-month" />
                          <span className="small fw-semibold">{monthYearLabel(monthYear)} (เดือนนี้)</span>
                        </span>
                        {ownMonthSettled ? (
                          <span className="small text-success fw-bold"><i className="fas fa-circle-check me-1" />ครบถ้วนแล้ว</span>
                        ) : (
                          <span className="small text-danger fw-bold">{money(ownMonthRemaining)} ฿</span>
                        )}
                      </div>
                    );
                  })()}
                  {settledOutstandingItems.map((o) => (
                    <div key={o.monthYear} className="d-flex justify-content-between align-items-center py-1 mb-1">
                      <span className="small text-muted">
                        <i className="fas fa-circle-check me-2 text-success" />{monthYearLabel(o.monthYear)}
                        <span className="ms-1">(ปิดยอดไปแล้ว)</span>
                      </span>
                      <span className="small text-muted text-decoration-line-through">{money(o.amount)} ฿</span>
                    </div>
                  ))}
                  {pendingOutstandingItems.map((o) => {
                    const checked = settleMonths.has(o.monthYear);
                    const adj = getAdjustment(o.monthYear);
                    const adjustedAmt = adjustedOutstandingAmount(o, outstandingAdjustments);
                    const hasAdjustment = adj.fineWaiveAmount > 0 || adj.discountItems.length > 0;
                    const expanded = expandedMonth === o.monthYear;
                    return (
                      <div key={o.monthYear} className="mb-1">
                        <div className="d-flex justify-content-between align-items-center py-1">
                          <span style={{ cursor: "pointer" }} onClick={() => toggleSettleMonth(o.monthYear)}>
                            <input className="form-check-input me-2" type="checkbox" checked={checked}
                              onChange={() => toggleSettleMonth(o.monthYear)} id={`settle-${o.monthYear}`} />
                            <span className="small">{monthYearLabel(o.monthYear)}</span>
                          </span>
                          <span className="d-flex align-items-center gap-2">
                            {hasAdjustment && (
                              <span className="text-muted text-decoration-line-through" style={{ fontSize: 11 }}>{money(o.amount)}</span>
                            )}
                            <span className="small text-danger fw-bold">{money(adjustedAmt)} ฿</span>
                            {checked && (
                              <button type="button" className="btn btn-sm btn-outline-secondary border-0 py-0 px-1"
                                title="ปรับค่าปรับ/ส่วนลดของเดือนนี้ก่อนปิดยอด"
                                onClick={() => setExpandedMonth(expanded ? null : o.monthYear)}>
                                <i className="fas fa-sliders" style={{ fontSize: 11 }} />
                              </button>
                            )}
                          </span>
                        </div>
                        {checked && expanded && (
                          <div className="p-2 mb-1" style={{ background: "var(--color-background)", borderRadius: 8 }}>
                            {o.fineAmount > 0 && (
                              <div className="mb-2">
                                <label className="form-label small mb-1">ลดค่าปรับล่าช้าของเดือนนี้ (จากเดิม {money(o.fineAmount)} ฿)</label>
                                <input type="number" className="form-control form-control-sm" min={0} max={o.fineAmount}
                                  value={adj.fineWaiveAmount}
                                  onChange={(e) => setAdjustment(o.monthYear, (a) => ({ ...a, fineWaiveAmount: Math.min(o.fineAmount, Math.max(0, Number(e.target.value) || 0)) }))} />
                              </div>
                            )}
                            <label className="form-label small mb-1">ส่วนลดเพิ่มเติมของเดือนนี้</label>
                            {adj.discountItems.map((d, i) => (
                              <div key={d.id} className="bill-line-row">
                                <span className="name"><i className="fas fa-tag me-1 text-danger" />{d.name}</span>
                                <span className="price text-danger">-{money(d.price)}</span>
                                <button type="button" className="btn btn-sm btn-outline-danger border-0" onClick={() => removeMonthDiscount(o.monthYear, i)}>
                                  <i className="fas fa-times" />
                                </button>
                              </div>
                            ))}
                            <div className="d-flex gap-2 mt-1">
                              <input className="form-control form-control-sm" placeholder="ชื่อส่วนลด" value={monthDiscName} onChange={(e) => setMonthDiscName(e.target.value)} />
                              <input type="number" className="form-control form-control-sm text-end" style={{ maxWidth: 110 }} placeholder="จำนวนเงิน" value={monthDiscPrice} onChange={(e) => setMonthDiscPrice(e.target.value)} />
                              <button type="button" className="btn btn-sm btn-outline-danger flex-shrink-0" onClick={() => addMonthDiscount(o.monthYear)}>
                                <i className="fas fa-plus" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div className="text-muted small mt-1">
                    เดือนที่ติ๊กเลือกจะถูกปิดเป็น "จ่ายแล้ว" ทันทีที่บันทึกยอดนี้ (กดไอคอน <i className="fas fa-sliders" /> เพื่อลดค่าปรับ/เพิ่มส่วนลดของเดือนเก่าก่อนปิดได้)
                    และถูกรวมในยอดที่ต้องชำระวันนี้ด้วย ส่วนเดือนที่ไม่ติ๊กจะไม่ถูกบวกเข้ายอดวันนี้ และยังคงค้างต่อไปให้เก็บภายหลัง —
                    ปิดสวิตช์ "{monthYearLabel(monthYear)} (เดือนนี้)" ได้ถ้าต้องการเก็บเฉพาะยอดค้างเดือนเก่าอย่างเดียว
                  </div>
                  {alreadySettledAmount > 0 && (
                    <div className="text-success small mt-1">
                      <i className="fas fa-circle-check me-1" />
                      ยอดค้างของ {settledOutstandingItems.map((o) => monthYearLabel(o.monthYear)).join(", ")} รวม {money(alreadySettledAmount)} ฿
                      ถูกปิดยอดไปก่อนหน้านี้แล้ว — หักออกจากยอดที่ต้องชำระวันนี้ให้อัตโนมัติ
                    </div>
                  )}
                </div>
              )}
            </div>

            <label className="form-label small fw-bold">ช่องทางชำระเงิน</label>
            <div className="d-flex gap-2 mb-3">
              <button type="button" className={`btn flex-fill ${method === "cash" ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => { setMethod("cash"); setSlipImage(null); }}>
                <i className="fas fa-money-bill-wave me-2" />เงินสด
              </button>
              <button type="button" className={`btn flex-fill ${method === "scan" ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => setMethod("scan")}>
                <i className="fas fa-qrcode me-2" />สแกน/โอน
              </button>
            </div>

            <div className="row g-2 mb-2">
              <div className="col-6">
                <label className="form-label small">เงินที่รับมา</label>
                <input type="number" className="form-control" value={received} onChange={(e) => setReceived(Number(e.target.value) || 0)} />
              </div>
              <div className="col-6">
                <label className="form-label small">วันที่จ่าย</label>
                <ThaiDatePicker value={paymentDate} onChange={setPaymentDate} />
              </div>
            </div>

            <div className="payment-change-box mb-3">
              {willFullySettle ? (
                <><span>เงินทอน</span><span className="payment-change-amount">{money(change)} ฿</span></>
              ) : (
                <><span><i className="fas fa-exclamation-triangle me-1 text-warning" />ยังขาดอยู่</span><span className="payment-change-amount text-warning">{money(stillOwing)} ฿</span></>
              )}
            </div>
            {!willFullySettle && received > 0 && (
              <div className="text-muted small mb-3">
                จะบันทึกยอดที่รับ {money(received)} ฿ วันนี้ไว้เป็นยอดที่ {history.length + 1} ส่วนที่เหลือ {money(stillOwing)} ฿ จะค้างไว้ให้ชำระในครั้งถัดไป
              </div>
            )}

            {method === "scan" && (
              <>
                <label className="form-label small d-block">แนบสลิป</label>
                <div className="mb-3">
                  {slipImage ? (
                    <div className="d-flex align-items-center gap-2">
                      <img src={slipImage.base64} alt="สลิป" style={{ width: 70, height: 70, objectFit: "cover", borderRadius: 8, border: "1px solid var(--color-light)" }} />
                      <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setSlipImage(null)}><i className="fas fa-times me-1" />ลบ</button>
                    </div>
                  ) : (
                    <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => fileRef.current?.click()}>
                      <i className="fas fa-paperclip me-1" />แนบรูปสลิป
                    </button>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" hidden
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
                </div>
              </>
            )}

            <label className="form-label small">หมายเหตุ (ถ้ามี)</label>
            <input className="form-control mb-3" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น จ่ายบางส่วน, โอนผิดบัญชี..." />

            {error && <div className="room-modal-error mb-3"><i className="fas fa-exclamation-circle me-2" />{error}</div>}

            <div className="confirm-actions">
              <button className="btn btn-outline-secondary" onClick={onClose} disabled={submitting}>ยกเลิก</button>
              <button className="btn btn-success" onClick={() => setShowReceiptChoice(true)} disabled={submitting || received <= 0}>
                {submitting
                  ? <><span className="spinner-border spinner-border-sm me-2" />กำลังบันทึก...</>
                  : willFullySettle
                    ? <><i className="fas fa-check-circle me-1" />ยืนยันการชำระ (จ่ายครบ)</>
                    : <><i className="fas fa-check-circle me-1" />บันทึกยอดที่จ่าย (ยังไม่ครบ)</>}
              </button>
            </div>
          </div>
        </div>
      </div>

      {showReceiptChoice && (
        // กดปุ่ม "ยืนยันการชำระ" ที่ฟอร์มหลักไปแล้ว ถือว่ายืนยันจะบันทึกยอดนี้แน่นอน ป็อปอัพนี้แค่ถามต่อว่าจะส่ง
        // ใบเสร็จเข้า LINE ไปด้วยหรือไม่เท่านั้น — ห้ามมีทางปิดป็อปอัพนี้ที่ไม่บันทึกยอดเลย (เดิมมีปุ่ม "ยกเลิก" +
        // กดพื้นหลังปิดได้ ซึ่งดูเหมือนแค่ "ไม่เอาใบเสร็จ" แต่จริงๆ ยกเลิกการบันทึกยอดทั้งก้อนไปเงียบๆ โดยไม่มี error
        // ใดๆ ทำให้ยอดที่จ่ายไปแล้วดูเหมือนไม่ถูกบันทึกเลย/ค้างเท่าเดิม — บั๊กเดิม) ปิดพื้นหลัง/กด Escape จึงไม่ทำอะไร
        // ต้องเลือกปุ่มใดปุ่มหนึ่งด้านล่างเท่านั้นถึงจะปิดป็อปอัพได้ ทั้งคู่บันทึกยอดเหมือนกัน ต่างกันแค่ส่งใบเสร็จหรือไม่
        <div className="confirm-overlay" style={{ zIndex: 1200 }}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon confirm-icon--primary"><i className="fab fa-line" /></div>
            <h6 className="confirm-title">ส่งใบเสร็จเข้า LINE ให้ผู้เช่าด้วยไหม?</h6>
            <p className="confirm-message">
              บันทึกยอด {money(received)} ฿ — เลือกว่าจะส่งใบเสร็จรับเงินเข้าแชท LINE ของผู้เช่าไปด้วยหรือไม่
            </p>
            <div className="confirm-actions" style={{ flexWrap: "wrap" }}>
              <button className="btn btn-outline-success" onClick={() => submit(false)} disabled={submitting}>
                {submitting ? <span className="spinner-border spinner-border-sm" /> : <>ไม่ส่งใบเสร็จ</>}
              </button>
              <button className="btn btn-success" onClick={() => submit(true)} disabled={submitting}>
                {submitting ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="fab fa-line me-1" />}
                ส่งพร้อมใบเสร็จ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── การ์ดมิเตอร์ (ไฟ/น้ำ) พร้อมสูตรคำนวณ — ทรงเดียวกับต้นฉบับ ─────────────────
function MeterBlock({ label, icon, color, tint, active, prev, curr, unit, price, formula, onToggleActive, onPrev, onCurr, onFormula }: {
  label: string; icon: string; color: string; tint: string; active: boolean;
  prev: number; curr: number; unit: number; price: number; formula: string;
  onToggleActive: (v: boolean) => void;
  onPrev: (v: number) => void; onCurr: (v: number) => void; onFormula: (v: string) => void;
}) {
  const [mode, setMode] = useState<"standard" | "custom">(formula ? "custom" : "standard");
  const [showFormula, setShowFormula] = useState(false);
  return (
    <div className="card mb-3 shadow-sm border-0">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h6 className="mb-0" style={{ color }}><i className={`fas ${icon} me-2`} />{label}</h6>
          <div className="form-check form-switch mb-0">
            <input className="form-check-input" type="checkbox" checked={active} onChange={(e) => onToggleActive(e.target.checked)} />
          </div>
        </div>
        <div style={{ opacity: active ? 1 : 0.5, pointerEvents: active ? "auto" : "none" }}>
          <div className="row g-2 mb-2">
            <div className="col-6">
              <small className="text-muted">เก่า</small>
              <input type="number" className="form-control text-end" value={prev} disabled={!active}
                onChange={(e) => onPrev(Number(e.target.value) || 0)} />
            </div>
            <div className="col-6">
              <small className="text-muted">ใหม่</small>
              <input type="number" className="form-control text-end" value={curr} disabled={!active}
                onChange={(e) => onCurr(Number(e.target.value) || 0)} />
            </div>
          </div>
          <div className="d-flex justify-content-between p-2 rounded small align-items-center" style={{ background: tint }}>
            <span>หน่วย: <b>{unit}</b></span>
            <span style={{ cursor: "pointer" }} onClick={() => setShowFormula((v) => !v)} title={`ตั้งค่าสูตรคำนวณ${label}`}>
              <i className="fas fa-cog text-muted me-1" />รวม: <b>{money(price)}</b> ฿
            </span>
          </div>
          {!!formula && (
            <div className="text-end mt-1" style={{ fontSize: 10 }}>
              <span className="badge" style={{ background: color, color: "#fff" }}>ใช้สูตรพิเศษ</span>
            </div>
          )}
          {showFormula && (
            <div className="mt-2">
              <div className="form-check form-switch">
                <input className="form-check-input" type="checkbox" checked={mode === "custom"}
                  onChange={(e) => {
                    const c = e.target.checked;
                    setMode(c ? "custom" : "standard");
                    onFormula(c ? (formula || "return u*r;") : "");
                  }} />
                <label className="form-check-label small">ใช้สูตรกำหนดเองสำหรับห้องนี้</label>
              </div>
              {mode === "custom" && (
                <input className="form-control form-control-sm font-monospace mt-1" value={formula}
                  onChange={(e) => onFormula(e.target.value)} placeholder="เช่น return u*r; หรือ return 100;" />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── หน้าแก้ไขบิลรายห้อง — ทรง 2 คอลัมน์ พร้อมตัวอย่างบิลสด ทรงเดียวกับต้นฉบับ ──
function BillDetailPage({ item, items, currentIndex, monthYear, config, paymentHistory, onUpdate, onSync, onNavigate, onBack, onPrint, onTogglePaid, onCancelPayment, onSendLine, sendingLine }: {
  item: BillItem;
  items: BillItem[];
  currentIndex: number;
  monthYear: string;
  config: AppConfig;
  paymentHistory: any[];
  onUpdate: (updater: (draft: BillItem) => void) => void;
  onSync: () => void;
  onNavigate: (idx: number) => void;
  onBack: () => void;
  onPrint: () => void;
  onTogglePaid: () => void;
  onCancelPayment: (p: any, reason: string) => Promise<void>;
  onSendLine: () => void;
  sendingLine: boolean;
}) {
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [discName, setDiscName] = useState("");
  const [discPrice, setDiscPrice] = useState("");
  const [previewTab, setPreviewTab] = useState<"line" | "paper">("line");

  const roomOptions = items.map((it, idx) => {
    let shortName = it.tenantName || "ว่าง";
    if (shortName.length > 15) shortName = shortName.substring(0, 15) + "..";
    return { value: idx, label: `${it.roomNumber} : ${shortName} (${it.status === "paid" ? "จ่ายแล้ว" : "ค้างชำระ"})` };
  });

  return (
    <div className="custom-card bill-detail-page no-print">
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-3 pb-2 border-bottom">
        <div className="d-flex align-items-center gap-2">
          <button className="btn btn-outline-secondary btn-sm" onClick={onBack} title="กลับไปหน้าตารางบิล">
            <i className="fas fa-arrow-left" />
          </button>
          <h5 className="form-section-title mb-0 border-0" style={{ padding: 0 }}>
            <i className="fas fa-door-open me-2 text-primary" />ห้อง {item.roomNumber} — {item.tenantName}
          </h5>
        </div>
        <div className="d-flex align-items-center gap-2">
          <BillStatusBadge item={item} />
          {config.lineMessaging.enabled && (
            <button type="button" className="btn btn-outline-success btn-sm" onClick={onSendLine} disabled={sendingLine}
              title={sendLogSummary(item.sendLogs?.[0])}>
              {sendingLine ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="fab fa-line me-1" />}
              ส่งบิลทาง LINE
            </button>
          )}
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onPrint}>
            <i className="fas fa-print me-1" />พิมพ์
          </button>
          <button type="button" className={`btn btn-sm ${item.status === "paid" ? "btn-outline-warning" : "btn-success"}`}
            onClick={onTogglePaid}>
            {item.status === "paid" ? <><i className="fas fa-undo me-1" />ยกเลิกการชำระ</> : <><i className="fas fa-check me-1" />บันทึกว่าจ่ายแล้ว</>}
          </button>
        </div>
      </div>

      <div className="card mb-3 shadow-sm border-0">
        <div className="card-body p-2">
          <div className="d-flex align-items-center gap-2">
            <button className="btn btn-outline-secondary" title="ห้องก่อนหน้า" disabled={currentIndex <= 0}
              onClick={() => onNavigate(currentIndex - 1)}>
              <i className="fas fa-chevron-left" />
            </button>
            <div className="flex-grow-1" style={{ minWidth: 0 }}>
              <CustomSelect2
                value={roomOptions.find((o) => o.value === currentIndex) ?? null}
                options={roomOptions}
                onChange={(o: any) => { if (o && o.value !== currentIndex) onNavigate(o.value); }}
              />
            </div>
            <button className="btn btn-outline-secondary" title="ห้องถัดไป" disabled={currentIndex >= items.length - 1}
              onClick={() => onNavigate(currentIndex + 1)}>
              <i className="fas fa-chevron-right" />
            </button>
          </div>
        </div>
      </div>

      <div className="row g-4 align-items-stretch">
        <div className="col-lg-5 col-xl-4">
          <div className="nicescrollbar" style={{ maxHeight: 680, overflow: "auto", paddingRight: 6 }}>
            {paymentHistory.length > 0 && (
              <div className="card mb-3 shadow-sm border-0">
                <div className="card-body">
                  <h6 className="text-secondary mb-2"><i className="fas fa-receipt me-2" />ประวัติการชำระ (จากยอดเต็ม {money(item.total)} ฿)</h6>
                  <PaymentHistoryList history={paymentHistory} onCancel={onCancelPayment} />
                </div>
              </div>
            )}
            <div className="card mb-3 shadow-sm border-0">
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <h6 className="text-secondary mb-0"><i className="fas fa-user-edit me-2" />ข้อมูลผู้เช่า (หน้าบิล)</h6>
                  <button type="button" className="btn btn-xs btn-outline-primary rounded-pill px-2" style={{ fontSize: 10 }} onClick={onSync}>
                    <i className="fas fa-sync-alt me-1" />ดึงข้อมูลล่าสุด
                  </button>
                </div>
                <label className="form-label small text-muted mb-0">ชื่อผู้เช่า (แสดงบนบิล)</label>
                <input className="form-control form-control-sm" value={item.tenantName}
                  onChange={(e) => onUpdate((d) => { d.tenantName = e.target.value; })} />
              </div>
            </div>

            <MeterBlock label="ค่าไฟ" icon="fa-bolt" color="#fd7e14" tint="rgba(253,126,20,0.1)"
              active={item.electricActive} prev={item.meterElectric.prev} curr={item.meterElectric.curr}
              unit={item.meterElectric.unit} price={item.priceElectric} formula={item.electricFormula}
              onToggleActive={(v) => onUpdate((d) => { d.electricActive = v; })}
              onPrev={(v) => onUpdate((d) => { d.meterElectric.prev = v; })}
              onCurr={(v) => onUpdate((d) => { d.meterElectric.curr = v; })}
              onFormula={(v) => onUpdate((d) => { d.electricFormula = v; })}
            />
            <MeterBlock label="ค่าน้ำ" icon="fa-tint" color="#0dcaf0" tint="rgba(13,202,240,0.1)"
              active={item.waterActive} prev={item.meterWater.prev} curr={item.meterWater.curr}
              unit={item.meterWater.unit} price={item.priceWater} formula={item.waterFormula}
              onToggleActive={(v) => onUpdate((d) => { d.waterActive = v; })}
              onPrev={(v) => onUpdate((d) => { d.meterWater.prev = v; })}
              onCurr={(v) => onUpdate((d) => { d.meterWater.curr = v; })}
              onFormula={(v) => onUpdate((d) => { d.waterFormula = v; })}
            />

            <div className="card mb-3 shadow-sm border-0">
              <div className="card-body">
                <h6 className="text-muted small fw-bold mb-3">รายการเรียกเก็บเพิ่มเติม</h6>

                <div className="row g-2 align-items-center mb-3">
                  <label className="col-4 col-form-label small">ค่าห้อง</label>
                  <div className="col-8">
                    <input type="number" className="form-control form-control-sm text-end" value={item.priceRoom}
                      onChange={(e) => onUpdate((d) => { d.priceRoom = Number(e.target.value) || 0; })} />
                  </div>
                </div>

                <label className="small fw-bold text-secondary d-block mb-1">แท็กห้อง / แท็กผู้เช่า</label>
                <div className="d-flex flex-wrap gap-2 mb-3">
                  {item.billTagItems.length === 0 && item.billTenantTagItems.length === 0 && <span className="text-muted small">ไม่มีรายการ</span>}
                  {item.billTagItems.map((t, i) => (
                    <span key={`rt-${t.id}`} className="bill-tag-chip" style={{ "--tag-color": t.color || "#6c757d" } as React.CSSProperties}>
                      {t.name} ({money(t.price)})
                      <button type="button" className="chip-remove" onClick={() => onUpdate((d) => { d.billTagItems.splice(i, 1); })}>
                        <i className="fas fa-times" />
                      </button>
                    </span>
                  ))}
                  {item.billTenantTagItems.map((t, i) => (
                    <span key={`tt-${t.id}`} className="bill-tag-chip" style={{ "--tag-color": t.color || "#6C9BCF" } as React.CSSProperties}>
                      {t.name} ({money(t.price)})
                      <button type="button" className="chip-remove" onClick={() => onUpdate((d) => { d.billTenantTagItems.splice(i, 1); })}>
                        <i className="fas fa-times" />
                      </button>
                    </span>
                  ))}
                </div>

                <label className="small fw-bold text-secondary d-block mb-1">ที่จอดรถ / ยานพาหนะ</label>
                <div className="d-flex flex-wrap gap-2 mb-3">
                  {item.billVehicleItems.length === 0 && <span className="text-muted small">ไม่มีรายการ</span>}
                  {item.billVehicleItems.map((v, i) => (
                    <span key={v.id} className="bill-tag-chip" style={{ "--tag-color": "#6c757d" } as React.CSSProperties}>
                      {v.name} ({money(v.price)})
                      <button type="button" className="chip-remove" onClick={() => onUpdate((d) => { d.billVehicleItems.splice(i, 1); })}>
                        <i className="fas fa-times" />
                      </button>
                    </span>
                  ))}
                </div>

                <div className="d-flex justify-content-between align-items-center mt-3 mb-2">
                  <label className="small fw-bold text-secondary mb-0">รายการอื่นๆ / เพิ่มเติม</label>
                </div>
                {item.customItems.map((c, i) => (
                  <div key={c.id} className="bill-line-row">
                    <span className="name">{c.name}</span>
                    <span className="price">{money(c.price)}</span>
                    <button type="button" className="btn btn-sm btn-outline-danger border-0" onClick={() => onUpdate((d) => { d.customItems.splice(i, 1); })}>
                      <i className="fas fa-times" />
                    </button>
                  </div>
                ))}
                <div className="d-flex gap-2 mt-2 mb-3">
                  <input className="form-control form-control-sm" placeholder="ชื่อรายการ" value={customName} onChange={(e) => setCustomName(e.target.value)} />
                  <input type="number" className="form-control form-control-sm text-end" style={{ maxWidth: 120 }} placeholder="ราคา" value={customPrice} onChange={(e) => setCustomPrice(e.target.value)} />
                  <button type="button" className="btn btn-sm btn-outline-primary flex-shrink-0" onClick={() => {
                    if (!customName.trim()) return;
                    onUpdate((d) => { d.customItems.push({ id: `CI-${Date.now()}`, name: customName.trim(), price: Number(customPrice) || 0 }); });
                    setCustomName(""); setCustomPrice("");
                  }}><i className="fas fa-plus" /></button>
                </div>

                <div className="d-flex justify-content-between align-items-center mb-2">
                  <label className="small fw-bold text-danger mb-0">รายการส่วนลด</label>
                </div>
                {item.discountItems.map((c, i) => (
                  <div key={c.id} className="bill-line-row">
                    <span className="name">
                      <i className={`fas ${c.id === ROUNDING_DISCOUNT_ID ? "fa-coins" : "fa-tag"} me-1 text-danger`} />
                      {c.name}{c.id === ROUNDING_DISCOUNT_ID ? " (อัตโนมัติ)" : ""}
                    </span>
                    <span className="price text-danger">-{money(c.price)}</span>
                    <button type="button" className="btn btn-sm btn-outline-danger border-0" onClick={() => onUpdate((d) => {
                      d.discountItems.splice(i, 1);
                      if (c.id === ROUNDING_DISCOUNT_ID) d.roundingDismissed = true;
                    })}>
                      <i className="fas fa-times" />
                    </button>
                  </div>
                ))}
                <div className="d-flex gap-2 mt-2">
                  <input className="form-control form-control-sm" placeholder="ชื่อส่วนลด" value={discName} onChange={(e) => setDiscName(e.target.value)} />
                  <input type="number" className="form-control form-control-sm text-end" style={{ maxWidth: 120 }} placeholder="จำนวนเงิน" value={discPrice} onChange={(e) => setDiscPrice(e.target.value)} />
                  <button type="button" className="btn btn-sm btn-outline-danger flex-shrink-0" onClick={() => {
                    if (!discName.trim()) return;
                    onUpdate((d) => { d.discountItems.push({ id: `DC-${Date.now()}`, name: discName.trim(), price: Number(discPrice) || 0 }); });
                    setDiscName(""); setDiscPrice("");
                  }}><i className="fas fa-plus" /></button>
                </div>
              </div>
            </div>

            <div className="card mb-3 shadow-sm border-0">
              <div className="card-body">
                <h6 className="text-muted small fw-bold mb-2">
                  <i className="fas fa-triangle-exclamation me-2 text-danger" />ค่าปรับล่าช้า (เฉพาะบิลใบนี้)
                </h6>
                {(() => {
                  const fineMode = item.fineOverride?.mode ?? "auto";
                  const setFineMode = (m: "auto" | "off" | "manual") => onUpdate((d) => {
                    if (m === "auto") { d.fineOverride = undefined; return; }
                    const prevAmt = d.fineOverride?.amount;
                    d.fineOverride = {
                      mode: m,
                      amount: prevAmt ?? (m === "manual" ? Math.round(Number(item.fineAmount) || 0) : 0),
                    };
                  });
                  return (
                    <>
                      <div className="btn-group btn-group-sm w-100 mb-2" role="group">
                        <button type="button" className={`btn btn-outline-secondary${fineMode === "auto" ? " active" : ""}`}
                          onClick={() => setFineMode("auto")}>อัตโนมัติ</button>
                        <button type="button" className={`btn btn-outline-secondary${fineMode === "off" ? " active" : ""}`}
                          onClick={() => setFineMode("off")}>ปิด</button>
                        <button type="button" className={`btn btn-outline-secondary${fineMode === "manual" ? " active" : ""}`}
                          onClick={() => setFineMode("manual")}>กรอกเอง</button>
                      </div>
                      {fineMode === "manual" && (
                        <div className="row g-2 align-items-center mb-2">
                          <label className="col-4 col-form-label small">จำนวนเงิน (฿)</label>
                          <div className="col-8">
                            <input type="number" min={0} className="form-control form-control-sm text-end"
                              value={item.fineOverride?.amount ?? 0}
                              onChange={(e) => onUpdate((d) => {
                                d.fineOverride = { mode: "manual", amount: Math.max(0, Number(e.target.value) || 0) };
                              })} />
                          </div>
                        </div>
                      )}
                      <div className="small text-muted">
                        {fineMode === "off"
                          ? "ไม่คิดค่าปรับล่าช้าสำหรับบิลใบนี้"
                          : fineMode === "manual"
                            ? <>ค่าปรับที่จะแสดงบนบิล: <span className="fw-bold text-danger">{money(item.fineAmount)} ฿</span>
                              {(Number(item.fineWaived) || 0) > 0 && <> (หักส่วนลดค่าปรับ {money(item.fineWaived)} ฿ แล้ว)</>}</>
                            : item.isOverdue
                              ? <>เกินกำหนด {item.overdueDays} วัน · ค่าปรับอัตโนมัติ <span className="fw-bold text-danger">{money(item.fineAmount)} ฿</span></>
                              : "ยังไม่เลยวันครบกำหนดชำระ — ยังไม่มีค่าปรับ"}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>

        <div className="col-lg-7 col-xl-8">
          <div className="h-100 preview-pane rounded p-3 d-flex flex-column">
            <ul className="nav nav-pills nav-fill mb-3 preview-tabs p-1 rounded shadow-sm flex-shrink-0">
              <li className="nav-item">
                <button type="button" className={`nav-link rounded-pill${previewTab === "line" ? " active" : ""}`} onClick={() => setPreviewTab("line")}>
                  <i className="fab fa-line me-2" />บิลอิเล็กทรอนิกส์ (LINE)
                </button>
              </li>
              <li className="nav-item">
                <button type="button" className={`nav-link rounded-pill${previewTab === "paper" ? " active" : ""}`} onClick={() => setPreviewTab("paper")}>
                  <i className="fas fa-file-invoice me-2" />บิลกระดาษ (A4)
                </button>
              </li>
            </ul>

            <div className="flex-grow-1 overflow-auto nicescrollbar">
              {previewTab === "line" ? (
                <div className="d-flex justify-content-center py-2">
                  <BillLinePreview item={item} monthYear={monthYear} config={config} />
                </div>
              ) : (
                <div>
                  <div className="text-center mb-3 mt-2">
                    <button type="button" className="btn btn-dark shadow-sm px-4" onClick={onPrint}>
                      <i className="fas fa-print me-2" />พิมพ์บิลนี้
                    </button>
                  </div>
                  <div className="d-flex justify-content-center pb-3">
                    <BillSlip item={item} monthYear={monthYear} config={config} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ข้อความบรรทัดเดียวที่ย่อขนาดตัวอักษรอัตโนมัติจนพอดีกับความกว้างช่อง (ไม่ตัดเป็น "...") ──
// ใช้กับชื่อห้อง/ชื่อผู้เช่าบนใบพิมพ์ ที่ความกว้างช่องคงที่แต่ความยาวข้อความไม่แน่นอน
// ตั้งค่าผ่าน CSS custom property --fit-scale แทนการ set fontSize ตรงๆ เพื่อให้ยังคูณรวมกับขนาดฐาน
// (calc(var(--slip-fs) * ... )) ของ class เดิมได้ ไม่ใช่ไป override ทับขนาดที่คำนวณไว้แล้ว
function FitText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const MIN_SCALE = 0.5; // ย่อได้ต่ำสุดครึ่งหนึ่งของขนาดเดิม ถ้ายังไม่พอก็ปล่อยให้ตัดด้วย ... (กันเล็กจนอ่านไม่ออก)

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--fit-scale", "1");
    let scale = 1;
    while (scale > MIN_SCALE && el.scrollWidth > el.clientWidth) {
      scale -= 0.05;
      el.style.setProperty("--fit-scale", scale.toFixed(2));
    }
  }, [text]);

  return (
    <div ref={ref} className={className} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
      {text}
    </div>
  );
}

// ── บิลกระดาษแนวยาว — 6 แถวต่อแผ่น A4 ตัวใหญ่อ่านง่าย พร้อมเส้นประตัด ───────────
function BillSlip({ item, monthYear, config, payerName, payerIndex, payerCount, payerTotal, lineKeys, heightMm }: {
  item: BillItem; monthYear: string; config: AppConfig;
  payerName?: string; payerIndex?: number; payerCount?: number; payerTotal?: number;
  // เลือกได้ว่าจะโชว์ค่าห้อง/ค่าน้ำ/ค่าไฟ บนใบพิมพ์หรือไม่ (ไม่กระทบยอดรวมสุทธิที่แสดง — แค่ซ่อนบรรทัดรายการ)
  lineKeys?: Set<string>;
  // บังคับความสูงตายตัว (มม.) ตอนเลือกจำนวนใบ/แผ่นแบบตายตัว — ไม่ระบุ = ปล่อยขยายอัตโนมัติตามเนื้อหาเหมือนเดิม
  heightMm?: number;
}) {
  // ใบนี้เป็น "ใบแยกตามคน" ของห้องที่มีผู้ร่วมพักหลายคนหรือไม่ (มาจากตัวเลือกแยกใบตามคนตอนพิมพ์)
  const isSplitCopy = payerTotal !== undefined;
  const showSplit = !isSplitCopy && !!config.features.splitRentByResidents && item.residentCount > 1;
  const showRoom = !lineKeys || lineKeys.has("room");
  const showWater = !lineKeys || lineKeys.has("water");
  const showElectric = !lineKeys || lineKeys.has("electric");
  const showOutstanding = !lineKeys || lineKeys.has("outstanding");
  // ค่าบริการต่อหน่วย (ถ้าเปิดใช้งาน) รวมเป็นบรรทัดเดียวกันหรือแยกบรรทัดต่างหาก ตามที่ตั้งค่าไว้ในหน้า Settings
  // (ดู buildWaterElectricRows ใน utils/billCalc.ts) — ยังคงกรองด้วย lineKeys (แสดง/ซ่อนน้ำ-ไฟทั้งกลุ่ม) เหมือนเดิม
  const waterElectricRows = buildWaterElectricRows(item)
    .filter((r) => (r.kind === "water" || r.kind === "waterFee" ? showWater : showElectric))
    .map((r) => ({
      name: `${r.label} (${r.unit} หน่วย)`, price: r.price,
      sub: (r.kind === "electricFee" || r.kind === "waterFee"
        ? `หน่วยละ ${money(r.rate)} บาท`
        : `${r.kind === "electric" ? item.meterElectric.prev : item.meterWater.prev} → ${r.kind === "electric" ? item.meterElectric.curr : item.meterWater.curr} · หน่วยละ ${money(r.rate)} บาท`)
        + (r.note ? ` (${r.note})` : ""),
    }));
  const rows: { name: string; price: number; sub?: string }[] = [
    ...(showRoom ? [{ name: "ค่าห้อง", price: item.priceRoom }] : []),
    // โชว์บรรทัดค่าน้ำ/ไฟเมื่อห้องเปิดใช้มิเตอร์นั้นอยู่ (waterActive/electricActive) เสมอ แม้ยังไม่ได้จด
    // มิเตอร์เดือนนี้หรือหน่วยเท่าเดิม (ราคาเป็น 0) — ไม่ใช่ซ่อนแค่เพราะยอดคำนวณได้ 0 บาท
    ...waterElectricRows,
    ...item.billTagItems.map((t) => ({ name: t.name, price: t.price })),
    ...item.billTenantTagItems.map((t) => ({ name: t.name, price: t.price })),
    ...item.billVehicleItems.map((v) => ({ name: v.name, price: v.price })),
    ...item.customItems.map((c) => ({ name: c.name, price: c.price })),
    // เปิดสวิตช์ "ยอดค้างชำระ" แล้วต้องขึ้นเสมอไม่ว่าจะมียอดค้างจริงหรือไม่ (0 บาทก็ยังโชว์บรรทัดนี้)
    ...(showOutstanding ? [{ name: "ค้างชำระยกมา", price: item.outstandingAmount }] : []),
    ...(item.fineAmount ? [{ name: item.overdueDays > 0 ? `ค่าปรับ (${item.overdueDays} วัน)` : "ค่าปรับล่าช้า", price: item.fineAmount }] : []),
    ...item.discountItems.map((d) => ({ name: `ส่วนลด: ${d.name}`, price: -d.price })),
  ];
  // ขนาดตัวอักษรฐานของใบนี้ — สเกลขึ้นเล็กน้อยตามความสูงช่อง (สูงสุดแค่ 1.5 เท่า ที่ 1 ใบ/แผ่น) ไม่ใช่สเกล
  // ตรงตามสัดส่วนความสูงเต็มๆ (เคยขึ้นถึง ~6 เท่า) เพราะความกว้างของใบยังคงที่ 186mm เสมอไม่ว่าจะกี่ใบ/แผ่น
  // สเกลเต็มอัตราจะทำให้ตัวหนังสือ (โดยเฉพาะเลขห้อง/ยอดเงินฝั่งซ้าย-ขวาที่กว้างคงที่ 44mm/42mm) ล้นช่อง
  const slipStyle: React.CSSProperties | undefined = (() => {
    if (!heightMm) return undefined;
    const minH = A4_PORTRAIT_USABLE_MM / 4; // ความสูงช่องเล็กสุดในตัวเลือก (4 ใบ/แผ่น) ใกล้เคียงขนาดปกติอยู่แล้ว
    const t = Math.max(0, Math.min(1, (heightMm - minH) / (A4_PORTRAIT_USABLE_MM - minH)));
    const scale = 1 + t * 0.5; // 1.0x ที่ 4 ใบ/แผ่น ไล่ขึ้นถึง 1.5x ที่ 1 ใบ/แผ่น
    return {
      height: `${heightMm}mm`, minHeight: `${heightMm}mm`, maxHeight: `${heightMm}mm`, overflow: "hidden",
      ["--slip-fs" as any]: `${(10 * scale).toFixed(2)}pt`,
    };
  })();
  return (
    <div className="bill-slip" style={slipStyle}>
      <div className="bill-slip-left">
        <div className="brand">{config.appIdentity.nameText || "ใบแจ้งหนี้"}</div>
        <FitText className="room" text={`ห้อง ${item.roomNumber}`} />
        {/* ชื่อผู้เช่ายาวเกินบรรทัดเดียว ให้ตัดขึ้นบรรทัดที่ 2 แทนการย่อขนาดตัวอักษรหรือตัดเป็น "..." */}
        <div className="tenant">{isSplitCopy ? payerName : (item.tenantId ? `${item.tenantTitle} ${item.tenantName}` : item.tenantName)}</div>
        {isSplitCopy && <div className="month">ผู้ร่วมพักคนที่ {payerIndex}/{payerCount} ของห้องนี้</div>}
        <div className="month">{monthYearLabel(monthYear)}</div>
      </div>
      <div className="bill-slip-rows">
        {rows.map((r, i) => (
          <div key={i} className="bill-slip-row">
            <span className="name">{r.name}{r.sub && <span className="sub">{r.sub}</span>}</span>
            <span className="amt">{r.price < 0 ? "-" : ""}{money(Math.abs(r.price))}</span>
          </div>
        ))}
      </div>
      <div className="bill-slip-right">
        <span className="label">{isSplitCopy ? "ส่วนที่ต้องชำระ" : "รวมทั้งสิ้น"}</span>
        <span className="amount">{money(isSplitCopy ? (payerTotal as number) : item.total)} ฿</span>
        {isSplitCopy && (
          <span className="split">หารจากยอดรวม {money(item.total)} บาท ÷ {payerCount} คน</span>
        )}
        {showSplit && (
          <span className="split">หาร {item.residentCount} คน · คนละ {money(item.total / item.residentCount)} บาท</span>
        )}
        <span className="due">{dueDateLabel(item.overdueConfig ?? config.overdue)}</span>
      </div>
    </div>
  );
}

// จำนวนแถวขั้นต่ำในตารางของใบแบบสวย — เติมแถวว่างให้ครบถ้ารายการจริงน้อยกว่านี้ (ให้หน้าตาเหมือนแบบฟอร์ม
// กระดาษพิมพ์ล่วงหน้าที่มีเส้นตารางครบ ไม่ใช่ตารางสั้นๆ ห้วนๆ) — ถ้ารายการจริงเกินก็แสดงตามจริง ไม่ตัดทิ้ง
const PRETTY_SLIP_MIN_ROWS = 8;

// ── บิลกระดาษแบบสวย 1 ใบเต็มแผ่น (A4 แนวตั้ง) — โลโก้ + ตารางรายการพร้อมเลขมิเตอร์ก่อน/หลัง + ยอดรวมเป็น
// ตัวหนังสือ + ช่องเซ็นชื่อ + QR ชำระเงิน (ถ้าตั้งค่าไว้) ทางเลือกเพิ่มจากใบแนวยาวเดิม (BillSlip) สำหรับคนที่
// อยากได้ใบที่ดูเป็นทางการ พิมพ์แจกทีละใบต่อห้อง (ไม่รองรับหลายใบ/แผ่นเหมือนโหมดอื่น เพราะเนื้อหาใหญ่เต็มหน้าอยู่แล้ว)
function BillSlipPretty({ item, monthYear, config, payerName, payerIndex, payerCount, payerTotal, lineKeys }: {
  item: BillItem; monthYear: string; config: AppConfig;
  payerName?: string; payerIndex?: number; payerCount?: number; payerTotal?: number;
  lineKeys?: Set<string>;
}) {
  const isSplitCopy = payerTotal !== undefined;
  const showWater = !lineKeys || lineKeys.has("water");
  const showElectric = !lineKeys || lineKeys.has("electric");
  const showRoom = !lineKeys || lineKeys.has("room");
  const showOutstanding = !lineKeys || lineKeys.has("outstanding");

  type PrettyRow = { name: string; prev?: number; curr?: number; unit?: number; rate?: number; price: number };
  const waterElectricRows: PrettyRow[] = buildWaterElectricRows(item)
    .filter((r) => (r.kind === "water" || r.kind === "waterFee" ? showWater : showElectric))
    .map((r) => ({
      name: r.label,
      prev: r.kind === "electric" ? item.meterElectric.prev : r.kind === "water" ? item.meterWater.prev : undefined,
      curr: r.kind === "electric" ? item.meterElectric.curr : r.kind === "water" ? item.meterWater.curr : undefined,
      unit: r.unit,
      rate: r.rate,
      price: r.price,
    }));
  const rows: PrettyRow[] = [
    ...(showRoom ? [{ name: "ค่าห้องพัก", price: item.priceRoom }] : []),
    ...waterElectricRows,
    ...item.billTagItems.map((t) => ({ name: t.name, price: t.price })),
    ...item.billTenantTagItems.map((t) => ({ name: t.name, price: t.price })),
    ...item.billVehicleItems.map((v) => ({ name: v.name, price: v.price })),
    ...item.customItems.map((c) => ({ name: c.name, price: c.price })),
    ...(showOutstanding ? [{ name: "ค้างชำระยกมา", price: item.outstandingAmount }] : []),
    ...(item.fineAmount ? [{ name: item.overdueDays > 0 ? `ค่าปรับ (${item.overdueDays} วัน)` : "ค่าปรับล่าช้า", price: item.fineAmount }] : []),
    ...item.discountItems.map((d) => ({ name: `ส่วนลด: ${d.name}`, price: -d.price })),
  ];
  const blankRows = Math.max(0, PRETTY_SLIP_MIN_ROWS - rows.length);
  const total = isSplitCopy ? (payerTotal as number) : item.total;

  // ทุกตารางด้านล่างมีคอลัมน์ของตัวเองอิสระต่อกัน (ไม่ต้องเทียบ colSpan ข้ามตารางให้ตรงกัน) — ที่ยังดูเป็น
  // กล่องเดียวต่อเนื่องกันได้เพราะห่อด้วย .bsp-box (มีกรอบนอกใบเดียว) แล้วแต่ละตารางมีแค่เส้นคั่นบน/ล่างเอง
  const noteText = `บิลค่าเช่าประจำเดือน ${monthYearLabel(monthYear)} · ${dueDateLabel(item.overdueConfig ?? config.overdue)}${isSplitCopy ? ` · หารจากยอดรวม ${money(item.total)} บาท ÷ ${payerCount} คน` : ""}`;

  return (
    <div className="bill-slip-pretty">
      <div className="bsp-header">
        {config.appIdentity.logoUrl && <img className="bsp-logo" src={config.appIdentity.logoUrl} alt="" />}
        <div className="bsp-org-name">{config.appIdentity.nameText || "-"}</div>
      </div>
      <div className="bsp-title">บิลชำระค่าเช่าห้องพักและที่ดิน</div>

      <div className="bsp-box">
        <table className="bsp-meta">
          <colgroup><col style={{ width: "13mm" }} /><col /><col style={{ width: "13mm" }} /><col /></colgroup>
          <tbody>
            <tr>
              <td className="bsp-meta-label">รหัส</td>
              <td>{item.roomNumber}</td>
              <td className="bsp-meta-label">วันที่</td>
              <td>{thaiFullDateString(new Date())}</td>
            </tr>
            <tr>
              <td className="bsp-meta-label">ชื่อ</td>
              <td>{isSplitCopy ? payerName : (item.tenantId ? `${item.tenantTitle} ${item.tenantName}` : item.tenantName)}</td>
              <td className="bsp-meta-label">ห้องพัก</td>
              <td>{item.roomNumber}</td>
            </tr>
          </tbody>
        </table>

        <table className="bsp-table">
          <colgroup>
            <col style={{ width: "7%" }} /><col style={{ width: "27%" }} /><col style={{ width: "12%" }} />
            <col style={{ width: "12%" }} /><col style={{ width: "12%" }} /><col style={{ width: "12%" }} /><col style={{ width: "18%" }} />
          </colgroup>
          <thead>
            <tr>
              <th className="bsp-col-no">ลำดับ</th>
              <th className="bsp-col-name">รายการ</th>
              <th>เลขครั้งก่อน</th>
              <th>เลขครั้งนี้</th>
              <th>หน่วยละ</th>
              <th>จำนวนที่ใช้</th>
              <th className="bsp-col-amt">จำนวนเงิน</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="bsp-col-no">{i + 1}</td>
                <td className="bsp-col-name">{r.name}</td>
                <td>{r.prev ?? ""}</td>
                <td>{r.curr ?? ""}</td>
                <td>{r.rate ? money(r.rate) : ""}</td>
                <td>{r.unit ?? ""}</td>
                <td className="bsp-col-amt">{r.price < 0 ? "-" : ""}{money(Math.abs(r.price))}</td>
              </tr>
            ))}
            {Array.from({ length: blankRows }).map((_, i) => (
              <tr key={`blank-${i}`}>
                <td className="bsp-col-no">{rows.length + i + 1}</td>
                <td className="bsp-col-name">&nbsp;</td>
                <td /><td /><td /><td /><td className="bsp-col-amt" />
              </tr>
            ))}
          </tbody>
        </table>

        <table className="bsp-note">
          <colgroup><col style={{ width: "13mm" }} /><col /></colgroup>
          <tbody>
            <tr>
              <td className="bsp-meta-label">หมายเหตุ</td>
              <td>{noteText}</td>
            </tr>
          </tbody>
        </table>

        <table className="bsp-total">
          <colgroup><col style={{ width: "25mm" }} /><col /><col style={{ width: "30mm" }} /></colgroup>
          <tbody>
            <tr>
              <td className="bsp-total-label">รวมเป็นเงิน</td>
              <td className="bsp-total-text">({thaiBahtText(total)})</td>
              <td className="bsp-total-amt">{money(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="bsp-footer">
        <div className="bsp-footer-left">
          {config.richMenu.contactPhone && <div>สามารถติดต่อสอบถามได้ที่เบอร์ {config.richMenu.contactPhone}</div>}
        </div>
        <div className="bsp-signature">ลายเซ็น .......................................................<div>ผู้เช่า</div></div>
      </div>

      {config.payment.qrImage && (
        <div className="bsp-footer-qr">
          <img src={config.payment.qrImage} alt="QR ชำระเงิน" />
          <div>สแกนเพื่อชำระเงิน</div>
        </div>
      )}
    </div>
  );
}

// ── ตัวเลือกห้อง/ตัวกรองก่อนพิมพ์บิล — ทรงเดียวกับหน้าจดมิเตอร์ ────────────────
function billEntryKey(monthYear: string, roomId: string) { return `${monthYear}::${roomId}`; }

function BillPrintConfigModal({ pool, rooms, towers, initialSelected, onCancel, onConfirm }: {
  pool: { item: BillItem; monthYear: string }[];
  rooms: any[];
  towers: any[];
  initialSelected: Set<string>;
  onCancel: () => void;
  onConfirm: (result: {
    entries: { item: BillItem; monthYear: string }[]; mode: "slip" | "record" | "dashboard"; splitMode: BillSplitMode;
    colKeys: Set<string>; slipLineKeys: Set<string>; slipLayout: BillSlipLayout; otherDetailMode: "price" | "detail";
    totalDisplayMode: "net" | "excludeSpecialDiscount"; dashboardSections: Set<string>;
  }) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(initialSelected);
  const [search, setSearch] = useState("");
  const [occupancy, setOccupancy] = useState<"all" | "occupied" | "vacant">("all");
  const [towerFilter, setTowerFilter] = useState<string[]>([]);
  const [mode, setMode] = useState<"slip" | "record" | "dashboard">("slip");
  const [splitMode, setSplitMode] = useState<BillSplitMode>("main");
  // คอลัมน์ของตารางสรุป (โหมด record) รวมช่องว่างสำหรับเขียนด้วยมือ — เลือกได้เหมือนหน้าจดมิเตอร์ จำไว้ "ต่อ
  // ผู้ใช้ต่อเครื่อง" (ดู usePersistedPref) ไม่ต้องมาติ๊กเลือกใหม่ทุกครั้งที่เปิดป็อปอัพนี้ — เก็บเป็น array
  // เพราะ Set ไม่ใช่ชนิดที่ JSON.stringify ได้ตรงๆ
  const [colKeysArr, setColKeysArr] = usePersistedPref<string[]>("bills-print-cols", [...BILL_RECORD_DEFAULT_COLS]);
  const colKeys = useMemo(() => new Set(colKeysArr), [colKeysArr]);
  const setColKeys = (next: Set<string>) => setColKeysArr([...next]);
  // คอลัมน์ "อื่นๆ (รวม)" โชว์แค่ยอดรวม หรือแตกรายละเอียดทุกรายการให้ด้วยในช่องเดียวกัน (ดู renderBillRecordCell)
  const [otherDetailMode, setOtherDetailMode] = usePersistedPref<"price" | "detail">("bills-print-other-mode", "price");
  // คอลัมน์ "รวมสุทธิ" โชว์ยอดปัจจุบัน (รวมส่วนลดพิเศษที่ยังไม่หมดอายุ) หรือยอดเต็มถ้าไม่มีส่วนลดพิเศษนั้น
  const [totalDisplayMode, setTotalDisplayMode] = usePersistedPref<"net" | "excludeSpecialDiscount">("bills-print-total-mode", "net");
  // หมวดที่เลือกแสดงในหน้าพิมพ์ "สรุป Dashboard" — จำไว้ต่อผู้ใช้เหมือน colKeys ด้านบน (คีย์เดียวกับที่
  // printDashboardForCurrentMonth/printDashboardForGroup ใน BillsPage อ่านใช้ ให้ตั้งค่าที่นี่มีผลตรงนั้นด้วย)
  const [dashboardSectionsArr, setDashboardSectionsArr] = usePersistedPref<string[]>("bills-print-dashboard-sections", DASHBOARD_SECTIONS_DEFAULT);
  const dashboardSections = useMemo(() => new Set(dashboardSectionsArr), [dashboardSectionsArr]);
  const setDashboardSections = (next: Set<string>) => setDashboardSectionsArr([...next]);
  // รายการที่โชว์บนใบพิมพ์ (โหมด slip) และจำนวนใบต่อแผ่น A4 — เปิด/ปิดค่าห้อง/น้ำ/ไฟได้ + เลือกขนาดตายตัวหรืออัตโนมัติ
  const [slipLineKeys, setSlipLineKeys] = useState<Set<string>>(DEFAULT_SLIP_LINE_KEYS);
  const [slipLayout, setSlipLayout] = useState<BillSlipLayout>("auto");

  const activeTowers = towers.filter((t: any) => t.isActive !== false);
  // ห้องที่เลือกพิมพ์อยู่ตอนนี้ มีห้องไหนที่มีผู้ร่วมพักหลายคนบ้าง — ใช้โชว์ตัวเลือกแยกใบตามคน
  const selectedMultiResidentCount = useMemo(
    () => pool.filter((e) => selected.has(billEntryKey(e.monthYear, e.item.roomId)) && e.item.residentCount > 1).length,
    [pool, selected]
  );
  const months = useMemo(() => [...new Set(pool.map((e) => e.monthYear))].sort((a, b) => myScore(a) - myScore(b)), [pool]);
  const showMonth = months.length > 1;

  const filtered = pool.filter((e) => {
    const room = rooms.find((r) => r.id === e.item.roomId || r.number === e.item.roomNumber);
    const q = search.trim().toLowerCase();
    const matchSearch = !q || e.item.roomNumber.toLowerCase().includes(q) || e.item.tenantName.toLowerCase().includes(q);
    const occupied = !!e.item.tenantId;
    const matchOccupancy = occupancy === "all" || (occupancy === "occupied" && occupied) || (occupancy === "vacant" && !occupied);
    const matchTower = towerFilter.length === 0 || towerFilter.includes(room?.towerId ?? "unassigned");
    return matchSearch && matchOccupancy && matchTower;
  });
  const allFilteredSelected = filtered.length > 0 && filtered.every((e) => selected.has(billEntryKey(e.monthYear, e.item.roomId)));

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="print-config-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="print-config-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "rgba(var(--color-primary-rgb, 108,155,207),0.15)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-primary)", fontSize: "1rem" }}>
              <i className="fas fa-print" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--color-dark)" }}>ตั้งค่าการพิมพ์</div>
              <div style={{ fontSize: "0.78rem", color: "var(--color-dark-variant)" }}>{months.map((my) => monthYearLabel(my)).join(", ")}</div>
            </div>
          </div>
          <button className="btn btn-sm" style={{ color: "var(--color-dark-variant)", padding: "4px 8px" }} onClick={onCancel}>
            <i className="fas fa-times" />
          </button>
        </div>

        <div className="print-config-summary">
          {mode === "dashboard" ? (
            <>
              <span><i className="fas fa-chart-pie me-1" />สรุปภาพรวม {months.length > 1 ? `${months.length} เดือน` : "1 เดือน"}</span>
              <span style={{ marginLeft: 12 }}><i className="fas fa-list-check me-1" />{dashboardSections.size} / {DASHBOARD_SECTIONS.length} หมวด</span>
            </>
          ) : (
            <>
              <span><i className="fas fa-door-open me-1" />{selected.size} / {pool.length} ห้อง</span>
              {mode === "record" && (
                <span style={{ marginLeft: 12 }}><i className="fas fa-columns me-1" />{colKeys.size} / {BILL_RECORD_COLS.length} คอลัมน์</span>
              )}
            </>
          )}
        </div>

        <div className="print-mode-picker">
          <button type="button" className={`print-mode-btn${mode === "slip" ? " active" : ""}`} onClick={() => setMode("slip")}>
            <i className="fas fa-file-invoice me-2" />
            <span>
              <span className="print-mode-title">สำหรับแจกผู้เช่า</span>
              <span className="print-mode-desc">บิลแนวยาวตัวใหญ่ พร้อมเส้นประตัด เลือกจำนวนใบ/แผ่นได้ด้านล่าง</span>
            </span>
          </button>
          <button type="button" className={`print-mode-btn${mode === "record" ? " active" : ""}`} onClick={() => setMode("record")}>
            <i className="fas fa-table me-2" />
            <span>
              <span className="print-mode-title">สำหรับบริหาร/บันทึก</span>
              <span className="print-mode-desc">ตารางสรุปยอดทุกห้องในหน้าเดียว เก็บเป็นหลักฐาน</span>
            </span>
          </button>
          <button type="button" className={`print-mode-btn${mode === "dashboard" ? " active" : ""}`} onClick={() => setMode("dashboard")}>
            <i className="fas fa-chart-pie me-2" />
            <span>
              <span className="print-mode-title">สรุป Dashboard</span>
              <span className="print-mode-desc">ภาพรวมเดือนนี้หน้าเดียว (จำนวนห้อง/ยอดเรียกเก็บ/รับแล้ว) ไม่ต้องเลือกห้อง</span>
            </span>
          </button>
        </div>

        {selectedMultiResidentCount > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "8px 20px", borderBottom: "1px solid var(--color-light)", flexShrink: 0 }}>
            <span style={{ fontSize: "0.72rem", color: "var(--color-dark-variant)", flexShrink: 0 }}>
              <i className="fas fa-users me-1" />{selectedMultiResidentCount} ห้องมีผู้ร่วมพักหลายคน — พิมพ์:
            </span>
            {mode === "slip" ? (
              <>
                <button type="button" className={`pcp-chip${splitMode === "main" ? " active" : ""}`} onClick={() => setSplitMode("main")}
                  title="พิมพ์แค่ 1 ใบต่อห้อง เหมือนเดิม">ใบหลักใบเดียว</button>
                <button type="button" className={`pcp-chip${splitMode === "split" ? " active" : ""}`} onClick={() => setSplitMode("split")}
                  title="แยกใบให้ทุกคนในห้อง คนละยอด = ยอดรวม ÷ จำนวนคน">แยกใบตามคน (หารราคา)</button>
                <button type="button" className={`pcp-chip${splitMode === "both" ? " active" : ""}`} onClick={() => setSplitMode("both")}
                  title="พิมพ์ทั้งใบหลัก และใบแยกตามคนด้วย">ทั้งคู่</button>
              </>
            ) : (
              <>
                <button type="button" className={`pcp-chip${splitMode === "main" ? " active" : ""}`} onClick={() => setSplitMode("main")}
                  title="1 แถวต่อห้อง เหมือนเดิม (โชว์ยอดหารต่อคนแทรกไว้ใต้ยอดรวม ถ้าเปิดฟีเจอร์หารค่าเช่าฯ)">รวมแถวเดียว</button>
                <button type="button" className={`pcp-chip${splitMode === "split" ? " active" : ""}`} onClick={() => setSplitMode("split")}
                  title="แยกแถวให้ทุกคนในห้อง คนละยอด = ยอดรวม ÷ จำนวนคน">แยกแถวตามคน (หารราคา)</button>
                <button type="button" className={`pcp-chip${splitMode === "both" ? " active" : ""}`} onClick={() => setSplitMode("both")}
                  title="โชว์ทั้งแถวรวม และแถวแยกตามคนด้วย">ทั้งคู่</button>
              </>
            )}
          </div>
        )}

        {mode === "slip" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "8px 20px", borderBottom: "1px solid var(--color-light)", flexShrink: 0 }}>
            <span style={{ fontSize: "0.72rem", color: "var(--color-dark-variant)", flexShrink: 0 }}><i className="fas fa-list-ul me-1" />แสดงในใบ:</span>
            {[{ key: "room", label: "ค่าห้อง" }, { key: "water", label: "ค่าน้ำ" }, { key: "electric", label: "ค่าไฟ" }, { key: "outstanding", label: "ยอดค้างชำระ" }].map((c) => (
              <button key={c.key} type="button" className={`pcp-chip${slipLineKeys.has(c.key) ? " active" : ""}`}
                onClick={() => setSlipLineKeys((prev) => {
                  const next = new Set(prev);
                  next.has(c.key) ? next.delete(c.key) : next.add(c.key);
                  return next;
                })}>{c.label}</button>
            ))}
            <span style={{ width: 1, height: 16, background: "var(--color-light)", margin: "0 2px", flexShrink: 0 }} />
            <span style={{ fontSize: "0.72rem", color: "var(--color-dark-variant)", flexShrink: 0 }}><i className="fas fa-th-large me-1" />ต่อแผ่น A4:</span>
            {(["auto", "1", "2", "3", "4", "pretty"] as const).map((v) => (
              <button key={v} type="button" className={`pcp-chip${slipLayout === v ? " active" : ""}`} onClick={() => setSlipLayout(v)}
                title={v === "auto" ? "ปล่อยขยายอัตโนมัติตามเนื้อหา (เดิม)" : v === "pretty" ? "ใบแบบสวยเต็มแผ่น 1 ใบต่อหน้า พร้อมตารางเลขมิเตอร์/ยอดเป็นตัวหนังสือ/QR ชำระเงิน" : `บังคับขนาดตายตัว ${v} ใบต่อแผ่น`}>
                {v === "auto" ? "อัตโนมัติ" : v === "pretty" ? "1 ใบแบบสวย" : `${v} ใบ`}
              </button>
            ))}
          </div>
        )}

        {mode === "record" && (colKeys.has("other") || colKeys.has("total")) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 20px", borderBottom: "1px solid var(--color-light)", flexShrink: 0 }}>
            {colKeys.has("other") && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.72rem", color: "var(--color-dark-variant)", flexShrink: 0 }}><i className="fas fa-layer-group me-1" />คอลัมน์ "อื่นๆ (รวม)":</span>
                <button type="button" className={`pcp-chip${otherDetailMode === "price" ? " active" : ""}`} onClick={() => setOtherDetailMode("price")}>ราคาอย่างเดียว</button>
                <button type="button" className={`pcp-chip${otherDetailMode === "detail" ? " active" : ""}`} onClick={() => setOtherDetailMode("detail")}>ราคา + รายละเอียด</button>
              </div>
            )}
            {colKeys.has("total") && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.72rem", color: "var(--color-dark-variant)", flexShrink: 0 }}><i className="fas fa-coins me-1" />คอลัมน์ "รวมสุทธิ":</span>
                <button type="button" className={`pcp-chip${totalDisplayMode === "net" ? " active" : ""}`} onClick={() => setTotalDisplayMode("net")}
                  title="โชว์ยอดปัจจุบัน รวมส่วนลดพิเศษที่ยังไม่หมดอายุ">ยอดปัจจุบัน (รวมส่วนลดพิเศษ)</button>
                <button type="button" className={`pcp-chip${totalDisplayMode === "excludeSpecialDiscount" ? " active" : ""}`} onClick={() => setTotalDisplayMode("excludeSpecialDiscount")}
                  title="โชว์ยอดเต็ม ราวกับไม่มีส่วนลดพิเศษนั้น (เผื่อดูว่าจะเก็บเท่าไหร่หลังหมดอายุ)">ยอดเต็มหลังส่วนลดหมดอายุ</button>
              </div>
            )}
          </div>
        )}

        <div className="print-config-body">
          {mode === "record" && (
            <>
              <div className="print-config-panel">
                <div className="print-config-panel-header">
                  <span>คอลัมน์</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="pcp-btn" onClick={() => setColKeys(new Set(BILL_RECORD_COLS.map((c) => c.key)))}>ทั้งหมด</button>
                    <button className="pcp-btn" onClick={() => setColKeys(new Set())}>ล้าง</button>
                  </div>
                </div>
                <div className="nicescrollbar" style={{ overflowY: "auto", flex: 1 }}>
                  {BILL_RECORD_COL_GROUPS.map((grp) => (
                    <div key={grp.label} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: "0.7rem", fontWeight: 600, color: grp.color ?? "var(--color-dark-variant)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4, display: "flex", alignItems: "center", gap: 5 }}>
                        {grp.icon && <i className={`fas ${grp.icon}`} />}
                        {grp.label}
                      </div>
                      {BILL_RECORD_COLS.filter((c) => grp.keys.includes(c.key)).map((col) => (
                        <label key={col.key} className="print-config-check-row">
                          <input type="checkbox" className="print-config-checkbox"
                            checked={colKeys.has(col.key)}
                            onChange={(e) => {
                              const next = new Set(colKeys);
                              e.target.checked ? next.add(col.key) : next.delete(col.key);
                              setColKeys(next);
                            }}
                          />
                          <span>{col.header}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ width: 1, background: "var(--color-light)", flexShrink: 0 }} />
            </>
          )}
          {mode === "dashboard" && (
            <>
              <div className="print-config-panel">
                <div className="print-config-panel-header">
                  <span>หมวดที่แสดง</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="pcp-btn" onClick={() => setDashboardSections(new Set(DASHBOARD_SECTIONS.map((s) => s.key)))}>ทั้งหมด</button>
                    <button className="pcp-btn" onClick={() => setDashboardSections(new Set())}>ล้าง</button>
                  </div>
                </div>
                <div className="nicescrollbar" style={{ overflowY: "auto", flex: 1 }}>
                  {DASHBOARD_SECTIONS.map((s) => (
                    <label key={s.key} className="print-config-check-row" style={{ alignItems: "flex-start" }}>
                      <input type="checkbox" className="print-config-checkbox" style={{ marginTop: 2 }}
                        checked={dashboardSections.has(s.key)}
                        onChange={(e) => {
                          const next = new Set(dashboardSections);
                          e.target.checked ? next.add(s.key) : next.delete(s.key);
                          setDashboardSections(next);
                        }}
                      />
                      <span>
                        {s.label}
                        <div className="text-muted" style={{ fontSize: "0.68rem", fontWeight: 400 }}>{s.desc}</div>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div style={{ width: 1, background: "var(--color-light)", flexShrink: 0 }} />
            </>
          )}
          {mode === "dashboard" ? (
            <div className="print-config-panel" style={{ flex: 1, alignItems: "center", justifyContent: "center", textAlign: "center" }}>
              <div style={{ color: "var(--color-dark-variant)", padding: "24px 16px" }}>
                <i className="fas fa-chart-pie mb-2" style={{ fontSize: "2rem", color: "var(--color-primary)" }} />
                <div style={{ fontWeight: 600, color: "var(--color-dark)", marginBottom: 4 }}>พิมพ์สรุปภาพรวมทั้งเดือน</div>
                <div style={{ fontSize: "0.82rem" }}>
                  ไม่ต้องเลือกห้อง — จะพิมพ์สรุปของ{months.length > 1 ? `ทั้ง ${months.length} เดือน` : "เดือนนี้"} ({months.map((my) => monthYearLabel(my)).join(", ")}) ให้ครบทุกห้องในเดือนนั้นๆ โดยอัตโนมัติ
                </div>
              </div>
            </div>
          ) : (
          <div className="print-config-panel" style={{ flex: 1 }}>
            <div className="print-config-panel-header">
              <span>ผู้เช่า / ห้อง</span>
              <div style={{ display: "flex", gap: 4 }}>
                <button className="pcp-btn" onClick={() => setSelected(new Set(pool.map((e) => billEntryKey(e.monthYear, e.item.roomId))))}>ทั้งหมด</button>
                <button className="pcp-btn" onClick={() => setSelected(new Set())}>ล้าง</button>
              </div>
            </div>

            <div className="print-config-search">
              <i className="fas fa-search" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--color-dark-variant)", fontSize: "0.8rem", pointerEvents: "none" }} />
              <input type="text" className="form-control form-control-sm" style={{ paddingLeft: 30, fontSize: "0.85rem" }}
                placeholder="ค้นหาเลขห้อง หรือชื่อผู้เช่า..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>

            <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
              {(["all", "occupied", "vacant"] as const).map((f) => (
                <button key={f} className={`pcp-chip${occupancy === f ? " active" : ""}`} onClick={() => setOccupancy(f)}>
                  {f === "all" ? "ทั้งหมด" : f === "occupied" ? <><i className="fas fa-user me-1" />มีผู้เช่า</> : <><i className="fas fa-door-open me-1" />ว่าง</>}
                </button>
              ))}
            </div>

            {activeTowers.length > 1 && (
              <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                {activeTowers.map((tw: any) => {
                  const active = towerFilter.includes(tw.id);
                  return (
                    <button key={tw.id} className={`pcp-chip${active ? " active" : ""}`}
                      onClick={() => setTowerFilter((prev) => prev.includes(tw.id) ? prev.filter((id) => id !== tw.id) : [...prev, tw.id])}>
                      <i className="fas fa-building me-1" style={{ fontSize: "0.7em" }} />{tw.name}
                    </button>
                  );
                })}
                {towerFilter.length > 0 && (
                  <button className="pcp-chip" onClick={() => setTowerFilter([])}><i className="fas fa-times me-1" />ล้างตึก</button>
                )}
              </div>
            )}

            {filtered.length > 0 && (
              <label className="print-config-check-row" style={{ marginBottom: 6, paddingBottom: 6, borderBottom: "1px solid var(--color-light)" }}>
                <input type="checkbox" className="print-config-checkbox" checked={allFilteredSelected}
                  onChange={(e) => {
                    const next = new Set(selected);
                    filtered.forEach((f) => { const k = billEntryKey(f.monthYear, f.item.roomId); e.target.checked ? next.add(k) : next.delete(k); });
                    setSelected(next);
                  }} />
                <span style={{ fontWeight: 600, fontSize: "0.82rem", color: "var(--color-dark-variant)" }}>เลือกทั้งหมดที่กรอง ({filtered.length} ห้อง)</span>
              </label>
            )}

            <div className="nicescrollbar" style={{ overflowY: "auto", flex: 1, minHeight: 140 }}>
              {filtered.length === 0 ? (
                <div style={{ textAlign: "center", color: "var(--color-dark-variant)", padding: "24px 0", fontSize: "0.85rem" }}>
                  <i className="fas fa-search me-2" />ไม่พบห้องที่ตรงกัน
                </div>
              ) : filtered.map((e) => {
                const k = billEntryKey(e.monthYear, e.item.roomId);
                return (
                  <label key={k} className="print-config-room-row">
                    <input type="checkbox" className="print-config-checkbox" checked={selected.has(k)}
                      onChange={(ev) => {
                        const next = new Set(selected);
                        ev.target.checked ? next.add(k) : next.delete(k);
                        setSelected(next);
                      }} />
                    <span className="pcr-room-num">{e.item.roomNumber}</span>
                    {e.item.tenantId ? (
                      <span className="pcr-name">{e.item.tenantName}</span>
                    ) : (
                      <span className="pcr-vacant"><i className="fas fa-door-open me-1" />ว่าง</span>
                    )}
                    {showMonth && <span className="text-muted ms-auto" style={{ fontSize: "0.72rem", flexShrink: 0 }}>{monthYearLabel(e.monthYear)}</span>}
                  </label>
                );
              })}
            </div>
          </div>
          )}
        </div>

        <div className="print-config-footer">
          <button className="btn btn-outline-secondary" onClick={onCancel}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={mode === "dashboard" ? dashboardSections.size === 0 : (selected.size === 0 || (mode === "record" && colKeys.size === 0))}
            onClick={() => onConfirm({
              entries: mode === "dashboard" ? pool : pool.filter((e) => selected.has(billEntryKey(e.monthYear, e.item.roomId))),
              mode, splitMode, colKeys, slipLineKeys, slipLayout, otherDetailMode, totalDisplayMode, dashboardSections,
            })}>
            <i className="fas fa-print me-2" />พิมพ์
            {mode !== "dashboard" && (
              <span style={{ marginLeft: 6, background: "rgba(255,255,255,0.25)", borderRadius: 10, padding: "1px 8px", fontSize: "0.8em" }}>{selected.size} ห้อง</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ตารางสรุปบิลสำหรับบริหาร/บันทึก — รวมทุกห้องไว้ในตารางเดียวต่อเดือน เก็บเป็นหลักฐาน ─
// เลือกคอลัมน์ที่จะพิมพ์ได้ (colKeys) รวมถึงคอลัมน์ blank ที่เว้นว่างไว้ให้เขียนด้วยมือ (เช่น เก็บเงินหน้างาน)
function BillRecordTable({ entries, config, colKeys, tenants, otherDetailMode = "price", totalDisplayMode = "net" }: {
  entries: PrintEntry[]; config: AppConfig; colKeys: Set<string>; tenants: any[];
  otherDetailMode?: "price" | "detail"; totalDisplayMode?: "net" | "excludeSpecialDiscount";
}) {
  const cols = BILL_RECORD_COLS.filter((c) => colKeys.has(c.key));
  const totalIdx = cols.findIndex((c) => c.key === "total");
  // entries อาจมีหลายแถวต่อห้องเดียวกัน (โหมดแยกแถวตามคน) — เรียงตามเลขห้องก่อน แล้วตามด้วยลำดับคนในห้องนั้น
  // (payerIndex ว่าง = แถวรวมของห้อง ให้ขึ้นก่อนแถวแยกของห้องเดียวกันเสมอ)
  const groups = useMemo(() => {
    const map = new Map<string, PrintEntry[]>();
    entries.forEach((e) => {
      if (!map.has(e.monthYear)) map.set(e.monthYear, []);
      map.get(e.monthYear)!.push(e);
    });
    return [...map.entries()]
      .sort(([a], [b]) => myScore(a) - myScore(b))
      .map(([monthYear, list]) => ({
        monthYear,
        rows: [...list].sort((a, b) => {
          const cmp = a.item.roomNumber.localeCompare(b.item.roomNumber, undefined, { numeric: true, sensitivity: "base" });
          return cmp !== 0 ? cmp : (a.payerIndex ?? 0) - (b.payerIndex ?? 0);
        }),
      }));
  }, [entries]);

  return (
    <div className="bill-record-page">
      {groups.map(({ monthYear, rows }, gi) => {
        // ยอดรวม/จำนวนห้องคิดจากห้องจริงเท่านั้น (dedupe ตาม roomId) ไม่นับซ้ำตามจำนวนแถวที่แยกคน
        const uniqueItems = [...new Map(rows.map((e) => [e.item.roomId, e.item])).values()];
        const grandTotal = uniqueItems.reduce((s, i) => s + i.total, 0);
        const paidCount = uniqueItems.filter((i) => i.status === "paid").length;
        return (
          <div key={monthYear} style={gi > 0 ? { pageBreakBefore: "always" } : undefined}>
            <div className="bill-record-title">
              สรุปบิล {config.appIdentity.nameText || ""} — ประจำเดือน {monthYearLabel(monthYear)}
              <span className="bill-record-title-sub">{uniqueItems.length} ห้อง · จ่ายแล้ว {paidCount}/{uniqueItems.length} · พิมพ์เมื่อ {thaiDateTimeString(new Date())}</span>
            </div>
            <table className="bill-record-table">
              <thead>
                <tr>
                  {cols.map((col) => (
                    <th key={col.key} className={col.align === "end" ? "amt" : undefined}>{col.header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr key={`${entry.item.roomId}-${entry.payerIndex ?? "main"}`}>
                    {cols.map((col) => (
                      <td key={col.key} className={`${col.align === "end" ? "amt " : ""}${col.blank ? "blank-write" : ""}`}>
                        {renderBillRecordCell(col, entry, config, tenants, otherDetailMode, totalDisplayMode)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  {totalIdx === -1 ? (
                    <td colSpan={cols.length}>รวมทั้งหมด ({uniqueItems.length} ห้อง)</td>
                  ) : (
                    <>
                      {totalIdx > 0 && <td colSpan={totalIdx}>รวมทั้งหมด ({uniqueItems.length} ห้อง)</td>}
                      <td className="amt">{money(grandTotal)}</td>
                      {cols.length - totalIdx - 1 > 0 && <td colSpan={cols.length - totalIdx - 1} />}
                    </>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })}
    </div>
  );
}

// ── เนื้อหาสำหรับพิมพ์บิล — ซ่อนอยู่บนจอเสมอ (.bill-print-only) แสดงเฉพาะตอนสั่งพิมพ์ (@media print)
// กดพิมพ์แล้วเข้าสู่ไดอะล็อกพิมพ์ของเบราว์เซอร์ทันที ไม่ต้องมีหน้าพรีวิวคั่นกลาง เหมือนหน้าจดมิเตอร์
// A4 แนวตั้ง สูงใช้งานได้จริง = 297mm - ขอบบน/ล่าง 12mm*2 (ต้องตรงกับ @page margin ด้านล่าง)
const A4_PORTRAIT_USABLE_MM = 273;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── คำนวณสถิติสรุปของบิลกลุ่มหนึ่ง (เดือนหนึ่งๆ) — แยกออกมาจาก useMemo เดิมในตัว BillsPage ให้เรียกใช้ซ้ำได้
// ทั้งจากเดือนที่กำลังเปิดแก้ไขอยู่ (billData สด) และจากเดือนอื่นในหน้ารายการที่ยังไม่ได้เปิดเข้าไป (ดูปุ่ม
// "พิมพ์สรุป Dashboard" ใน BillGroupTableView) ซึ่งใช้ b.data ดิบจาก state ตรงๆ แทน
function computeBillStats(billData: BillItem[], payments: any[], monthYear: string): DashboardStats {
  const totalRooms = billData.length;
  const paid = billData.filter((i) => i.status === "paid").length;
  const overdue = billData.filter((i) => i.status !== "paid" && i.isOverdue).length;
  const unpaid = totalRooms - paid - overdue;
  const totalExpected = billData.reduce((s, i) => s + i.total, 0);
  const totalFixed = billData.reduce((s, i) => s + (i.originalTotal ?? i.total), 0);
  const activePayments = payments.filter((p) => !p?.data?.cancelled);
  const receivedThisMonth = activePayments
    .filter((p) => p?.data?.monthYear === monthYear && !p?.data?.settledViaMonthYear)
    .reduce((s, p) => s + (Number(p?.data?.amount) || 0), 0);
  const receivedOldMonthsClosedThisMonth = activePayments
    .filter((p) => p?.data?.settledViaMonthYear === monthYear)
    .reduce((s, p) => s + (Number(p?.data?.amount) || 0), 0);
  const netReceived = receivedThisMonth + receivedOldMonthsClosedThisMonth;
  const totalMissing = totalExpected - receivedThisMonth;
  const totalRent = billData.reduce((s, i) => s + (Number(i.priceRoom) || 0), 0);
  const totalWater = billData.reduce((s, i) => s + (Number(i.priceWater) || 0), 0);
  const totalElectric = billData.reduce((s, i) => s + (Number(i.priceElectric) || 0), 0);
  const totalFine = billData.reduce((s, i) => s + (Number(i.fineAmount) || 0), 0);
  const totalOutstandingCarried = billData.reduce((s, i) => s + (Number(i.outstandingAmount) || 0), 0);
  const totalOther = totalExpected - totalRent - totalWater - totalElectric - totalFine - totalOutstandingCarried;
  const waterUnits = billData.reduce((s, i) => s + (Number(i.meterWater?.unit) || 0), 0);
  const electricUnits = billData.reduce((s, i) => s + (Number(i.meterElectric?.unit) || 0), 0);
  const collectRate = totalExpected > 0 ? (receivedThisMonth / totalExpected) * 100 : 0;
  return {
    totalRooms, paid, overdue, unpaid, totalExpected, totalFixed,
    receivedThisMonth, receivedOldMonthsClosedThisMonth, netReceived, totalMissing,
    totalRent, totalWater, totalElectric, totalFine, totalOutstandingCarried, totalOther,
    waterUnits, electricUnits, collectRate,
  };
}

interface DashboardStats {
  totalRooms: number; paid: number; unpaid: number; overdue: number;
  totalRent: number; totalWater: number; waterUnits: number; totalElectric: number; electricUnits: number;
  totalOther: number; totalFine: number; totalOutstandingCarried: number;
  totalFixed: number; totalExpected: number; totalMissing: number; collectRate: number;
  receivedThisMonth: number; receivedOldMonthsClosedThisMonth: number; netReceived: number;
}

// ── การ์ดตัวเลขเดี่ยวสำหรับหน้าพิมพ์สรุป Dashboard (ดู DashboardSummaryPrint ด้านล่าง) — กรอบ+สีคล้ายของเดิม
// บนจอ แต่พื้นขาว/เส้นขอบชัดเจน ให้เห็นดีแม้พิมพ์ขาวดำ (ไม่พึ่งพื้นหลังสี ซึ่งเบราว์เซอร์มักไม่พิมพ์ให้ตามปกติ
// นอกจากจะเปิด "พิมพ์พื้นหลัง" เอง)
function DashPrintTile({ icon, color, label, value }: { icon: string; color: string; label: string; value: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, border: "1px solid #ddd", borderRadius: 8,
      padding: "10px 12px", minWidth: 0,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 9, flexShrink: 0, border: `1.5px solid ${color}`,
        color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
      }}>
        <i className={`fas ${icon}`} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: "1.02rem", color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
        <div style={{ fontSize: "0.72rem", color: "#666" }}>{label}</div>
      </div>
    </div>
  );
}

// ── พิมพ์สรุปภาพรวม Dashboard ของเดือนที่กำลังเปิดดูอยู่ — เอาไว้ติดบอร์ด/ส่งเจ้าของหอให้ดูภาพรวมเร็วๆ โดย
// ไม่ต้องพิมพ์บิลรายห้องทั้งหมด ใช้ class .bill-print-only ตัวเดียวกับใบบิล/ตารางสรุป (ดู @media print ใน
// App.css) โชว์เฉพาะตอนสั่งพิมพ์เท่านั้น ปกติซ่อนไว้ (display: none) — จัดเป็นการ์ดกริดหน้าตาใกล้เคียงกับหน้า
// จอจริง (ดูแถวสรุปด้านบนของ BillsPage) แทนตารางตัวอักษรล้วนๆ ให้อ่านง่าย/ดูดีกว่าเดิม
function DashboardSummaryPage({ stats, config, monthYear, pageBreakBefore, sections }: {
  stats: DashboardStats; config: AppConfig; monthYear: string; pageBreakBefore: boolean; sections: Set<string>;
}) {
  const breakdown = [
    { label: "ค่าเช่า", value: stats.totalRent, color: "#6C9BCF" },
    { label: "ค่าน้ำ", value: stats.totalWater, color: "#0dcaf0" },
    { label: "ค่าไฟ", value: stats.totalElectric, color: "#fd7e14" },
    { label: "อื่นๆ", value: Math.max(stats.totalOther, 0), color: "#6610f2" },
    { label: "ค่าปรับ", value: stats.totalFine, color: "#dc3545" },
    { label: "ค้างชำระยกมา", value: stats.totalOutstandingCarried, color: "#e83e8c" },
  ];
  return (
      <div className="bill-record-page" style={pageBreakBefore ? { pageBreakBefore: "always" } : undefined}>
        <div className="bill-record-title">
          สรุปภาพรวมบิล {config.appIdentity.nameText || ""} — ประจำเดือน {monthYearLabel(monthYear)}
          <span className="bill-record-title-sub">พิมพ์เมื่อ {thaiDateTimeString(new Date())}</span>
        </div>

        {sections.has("roomStatus") && (
          <>
            <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", margin: "14px 0 6px" }}>
              สถานะห้อง
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
              <DashPrintTile icon="fa-door-open" color="#6c757d" label="ห้องทั้งหมด" value={String(stats.totalRooms)} />
              <DashPrintTile icon="fa-check-circle" color="#1B9C85" label="จ่ายแล้ว" value={String(stats.paid)} />
              <DashPrintTile icon="fa-clock" color="#fd7e14" label="รอชำระ" value={String(stats.unpaid)} />
              <DashPrintTile icon="fa-exclamation-triangle" color="#dc3545" label="เกินกำหนด" value={String(stats.overdue)} />
            </div>
          </>
        )}

        {sections.has("breakdown") && (
          <>
            <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", margin: "16px 0 6px" }}>
              แยกตามประเภทค่าใช้จ่าย
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
              <DashPrintTile icon="fa-home" color="#6C9BCF" label="ค่าเช่า" value={`${money(stats.totalRent)} บาท`} />
              <DashPrintTile icon="fa-tint" color="#0dcaf0" label={`ค่าน้ำ (${stats.waterUnits.toLocaleString()} หน่วย)`} value={`${money(stats.totalWater)} บาท`} />
              <DashPrintTile icon="fa-bolt" color="#fd7e14" label={`ค่าไฟ (${stats.electricUnits.toLocaleString()} หน่วย)`} value={`${money(stats.totalElectric)} บาท`} />
              <DashPrintTile icon="fa-receipt" color="#6610f2" label="อื่นๆ" value={`${money(stats.totalOther)} บาท`} />
              <DashPrintTile icon="fa-exclamation-circle" color="#dc3545" label="ค่าปรับ" value={`${money(stats.totalFine)} บาท`} />
              <DashPrintTile icon="fa-history" color="#e83e8c" label="ค้างชำระยกมา" value={`${money(stats.totalOutstandingCarried)} บาท`} />
            </div>

            {stats.totalExpected > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: "flex", height: 10, borderRadius: 6, overflow: "hidden", border: "1px solid #ddd" }}>
                  {breakdown.map((b, i) => (
                    <div key={i} style={{ width: `${(b.value / stats.totalExpected) * 100}%`, background: b.color }} />
                  ))}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 6, fontSize: "0.72rem", color: "#555" }}>
                  {breakdown.map((b, i) => (
                    <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <i style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: b.color }} />
                      {b.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {sections.has("totals") && (
          <>
            <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", margin: "18px 0 6px" }}>
              ยอดเรียกเก็บ
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
              <DashPrintTile icon="fa-lock" color="#777" label="ยอดเรียกเก็บทั้งหมด (คงที่)" value={`${money(stats.totalFixed)} บาท`} />
              <DashPrintTile icon="fa-chart-line" color="#6C9BCF" label="คาดการณ์รายรับ" value={`${money(stats.totalExpected)} บาท`} />
              <DashPrintTile icon="fa-triangle-exclamation" color="#dc3545" label="ขาดอีก" value={`${money(stats.totalMissing)} บาท`} />
            </div>
            <div style={{ marginTop: 10, height: 10, borderRadius: 6, border: "1px solid #ddd", overflow: "hidden" }}>
              <div style={{ width: `${Math.min(stats.collectRate, 100)}%`, height: "100%", background: "#1B9C85" }} />
            </div>
          </>
        )}

        {sections.has("received") && (
          <div style={{
            marginTop: 16, padding: "12px 14px", borderRadius: 10, border: "1.5px solid #1B9C85", background: "#f3faf8",
          }}>
            <div style={{ fontWeight: 700, fontSize: "0.82rem", color: "#1B9C85", marginBottom: 8 }}>
              <i className="fas fa-hand-holding-usd me-1" />เงินที่ได้รับแล้ว
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "#1B9C85" }}>{money(stats.receivedThisMonth)} บาท</div>
                <div style={{ fontSize: "0.72rem", color: "#555" }}>รับแล้วเดือน ({stats.collectRate.toFixed(0)}%)</div>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "#20c997" }}>{money(stats.receivedOldMonthsClosedThisMonth)} บาท</div>
                <div style={{ fontSize: "0.72rem", color: "#555" }}>เดือนเก่าที่ปิดในเดือนนี้</div>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: "1.2rem", color: "#198754" }}>{money(stats.netReceived)} บาท</div>
                <div style={{ fontSize: "0.72rem", color: "#555" }}>ยอดรับแล้วสุทธิ</div>
              </div>
            </div>
          </div>
        )}
      </div>
  );
}

// ── พิมพ์สรุปภาพรวม Dashboard ของเดือนที่เลือก — เอาไว้ติดบอร์ด/ส่งเจ้าของหอให้ดูภาพรวมเร็วๆ โดยไม่ต้องพิมพ์
// บิลรายห้องทั้งหมด ใช้ class .bill-print-only ตัวเดียวกับใบบิล/ตารางสรุป (ดู @media print ใน App.css) โชว์
// เฉพาะตอนสั่งพิมพ์เท่านั้น ปกติซ่อนไว้ (display: none) — รับได้หลายเดือนพร้อมกัน (bulk print) พิมพ์แยกหน้า
// ต่อเดือนให้เอง
function DashboardSummaryPrint({ groups, config, sections }: {
  groups: { monthYear: string; stats: DashboardStats }[]; config: AppConfig; sections?: Set<string>;
}) {
  const sec = sections ?? new Set(DASHBOARD_SECTIONS_DEFAULT);
  return (
    <div className="bill-print-only">
      <style>{`@media print { @page { size: A4 portrait; margin: 14mm; } }`}</style>
      {groups.map((g, i) => (
        <DashboardSummaryPage key={g.monthYear} stats={g.stats} config={config} monthYear={g.monthYear} pageBreakBefore={i > 0} sections={sec} />
      ))}
    </div>
  );
}

function BillPrintOnly({ entries, config, mode, colKeys, lineKeys, layout, tenants, otherDetailMode = "price", totalDisplayMode = "net" }: {
  entries: PrintEntry[]; config: AppConfig; mode: "slip" | "record"; colKeys: Set<string>;
  lineKeys: Set<string>; layout: BillSlipLayout; tenants: any[];
  otherDetailMode?: "price" | "detail"; totalDisplayMode?: "net" | "excludeSpecialDiscount";
}) {
  const isPretty = layout === "pretty";
  const perPage = layout === "auto" || isPretty ? 0 : Number(layout);
  const heightMm = perPage > 0 ? A4_PORTRAIT_USABLE_MM / perPage : undefined;
  // โหมด "1 ใบแบบสวย" บังคับ 1 ใบ/หน้าเสมอ (เนื้อหาใหญ่เต็มหน้าอยู่แล้ว ไม่มีที่ว่างให้อีกใบมาแชร์หน้าเดียวกัน)
  const pages = isPretty ? entries.map((e) => [e]) : perPage > 0 ? chunkArray(entries, perPage) : [entries];
  return (
    <div className="bill-print-only">
      <style>{`@media print { @page { size: A4 ${mode === "record" ? "landscape" : "portrait"}; margin: 12mm; } }`}</style>
      {mode === "slip" ? (
        pages.map((pageEntries, pi) => (
          // โหมด "อัตโนมัติ" (heightMm undefined): ไม่แบ่งหน้าด้วย JS ตายตัว ปล่อยให้เบราว์เซอร์แบ่งหน้าเองตาม
          // @page เพื่อให้ใบที่มีรายการเยอะ (แท็ก/รถ/ส่วนลด ฯลฯ) ขยายสูงขึ้นได้เองโดยไม่ถูกตัดขาดกลางใบ
          // โหมดตายตัว (1-4 ใบ/แผ่น): บังคับความสูงเท่ากันทุกใบ + ขึ้นหน้าใหม่ทุกๆ N ใบเสมอ
          <div key={pi} className="bill-print-page" style={pi > 0 ? { pageBreakBefore: "always" } : undefined}>
            {pageEntries.map(({ item, monthYear, payerName, payerIndex, payerCount, payerTotal }) =>
              isPretty ? (
                <BillSlipPretty key={`${item.roomId}-${payerIndex ?? "main"}`} item={item} monthYear={monthYear} config={config}
                  payerName={payerName} payerIndex={payerIndex} payerCount={payerCount} payerTotal={payerTotal}
                  lineKeys={lineKeys} />
              ) : (
                <BillSlip key={`${item.roomId}-${payerIndex ?? "main"}`} item={item} monthYear={monthYear} config={config}
                  payerName={payerName} payerIndex={payerIndex} payerCount={payerCount} payerTotal={payerTotal}
                  lineKeys={lineKeys} heightMm={heightMm} />
              )
            )}
          </div>
        ))
      ) : (
        <BillRecordTable entries={entries} config={config} colKeys={colKeys} tenants={tenants} otherDetailMode={otherDetailMode} totalDisplayMode={totalDisplayMode} />
      )}
    </div>
  );
}

// ── มุมมองตาราง (Table view) ของบิลรายห้อง — โครงเดียวกับตารางหน้าอื่นๆ (ห้องพัก/ยานพาหนะ) ──
type PinDir = "left" | "right" | false;
interface BillColDef { key: string; header: string; visible: boolean; pinnable: boolean; pin: PinDir; thClass?: string; tdClass?: string }

const BILL_TABLE_COLS: BillColDef[] = [
  { key: "checkbox",    header: "checkbox",  visible: true, pinnable: false, pin: "left",  thClass: "text-center checkbox-cell", tdClass: "text-center checkbox-cell" },
  { key: "room",        header: "ห้อง",       visible: true, pinnable: true,  pin: "left",  tdClass: "room-cell" },
  { key: "tenant",      header: "ผู้เช่า",     visible: true, pinnable: true,  pin: false },
  { key: "priceRoom",   header: "ค่าห้อง",     visible: true, pinnable: true,  pin: false,   thClass: "text-end", tdClass: "text-end" },
  { key: "water",       header: "ค่าน้ำ",      visible: true, pinnable: true,  pin: false,   thClass: "text-end", tdClass: "text-end" },
  { key: "electric",    header: "ค่าไฟ",       visible: true, pinnable: true,  pin: false,   thClass: "text-end", tdClass: "text-end" },
  { key: "vehicle",     header: "ค่าจอดรถ",    visible: true, pinnable: true,  pin: false,   thClass: "text-end", tdClass: "text-end" },
  { key: "roomTag",     header: "Tag ห้อง",    visible: true, pinnable: true,  pin: false,   thClass: "text-end", tdClass: "text-end" },
  { key: "tenantTag",   header: "Tag ผู้เช่า",  visible: true, pinnable: true,  pin: false,   thClass: "text-end", tdClass: "text-end" },
  { key: "discount",    header: "ส่วนลด",      visible: true, pinnable: true,  pin: false,   thClass: "text-end", tdClass: "text-end" },
  { key: "other",       header: "อื่นๆ",       visible: true, pinnable: true,  pin: false,   thClass: "text-end", tdClass: "text-end" },
  { key: "fine",        header: "ค่าปรับ",      visible: true, pinnable: true,  pin: false,   thClass: "text-end", tdClass: "text-end" },
  { key: "outstanding", header: "ค้างชำระ",    visible: true, pinnable: true,  pin: false,   thClass: "text-end", tdClass: "text-end" },
  { key: "ownMonth",    header: "ยอดเดือนนี้",  visible: true, pinnable: true,  pin: false,   thClass: "text-end", tdClass: "text-end" },
  { key: "total",       header: "รวมสุทธิ",    visible: true, pinnable: true,  pin: false,   thClass: "text-end", tdClass: "text-end" },
  { key: "received",    header: "รับชำระแล้ว",  visible: true, pinnable: true,  pin: false,   thClass: "text-end", tdClass: "text-end" },
  { key: "status",      header: "สถานะ",       visible: true, pinnable: true,  pin: false,   thClass: "text-center", tdClass: "text-center" },
  { key: "actions",     header: "จัดการ",      visible: true, pinnable: true,  pin: "right", thClass: "text-center action-cell", tdClass: "text-center action-cell" },
];

const colSelectStyles: any = {
  control: (base: any, state: any) => ({
    ...base,
    backgroundColor: state.menuIsOpen || state.isFocused ? "var(--color-white)" : "var(--color-background)",
    border: `1px solid ${state.menuIsOpen || state.isFocused ? "var(--color-primary)" : "var(--color-light)"}`,
    borderRadius: "var(--border-radius-1)",
    boxShadow: state.menuIsOpen || state.isFocused ? "0 0 0 3px rgba(108,155,207,0.25)" : "none",
    minHeight: "38px", fontSize: "0.9rem", cursor: "pointer",
  }),
  valueContainer: (base: any) => ({ ...base, padding: "0 0.75rem", flexWrap: "nowrap", overflow: "hidden" }),
  indicatorSeparator: () => ({ display: "none" }),
  menu: (base: any) => ({ ...base, backgroundColor: "var(--color-white)", border: "1px solid var(--color-light)", borderRadius: "var(--border-radius-1)", boxShadow: "var(--box-shadow)", zIndex: 9999, overflow: "hidden" }),
  menuList: (base: any) => ({ ...base, padding: "4px", maxHeight: "260px" }),
  option: (base: any, state: any) => ({
    ...base,
    backgroundColor: state.isFocused ? "var(--color-light)" : "transparent",
    color: "var(--color-dark)", fontSize: "0.88rem", borderRadius: "var(--border-radius-1)",
    padding: "0.45rem 0.75rem", cursor: "pointer",
  }),
};

function ColCheckboxOption(props: any) {
  return (
    <components.Option {...props}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="checkbox" className="form-check-input" checked={props.isSelected} readOnly style={{ flexShrink: 0 }} />
        <span className={props.isSelected ? "fw-bold" : ""}>{props.label}</span>
      </div>
    </components.Option>
  );
}
function ColValueContainer(props: any) {
  const count = props.getValue().length;
  const total = (props.selectProps.options as any[]).length;
  const input = Array.isArray(props.children) ? props.children[props.children.length - 1] : props.children;
  return (
    <components.ValueContainer {...props}>
      <span style={{ color: "var(--color-dark)", fontWeight: 500, fontSize: "0.9rem", whiteSpace: "nowrap" }}>
        {count > 0 ? `แสดง ${count} / ${total} คอลัมน์` : "เลือกคอลัมน์ที่แสดง..."}
      </span>
      {input}
    </components.ValueContainer>
  );
}
function BillColVisibilityDropdown({ cols, onChange }: { cols: BillColDef[]; onChange: (key: string, v: boolean) => void }) {
  const toggleable = cols.filter((c) => c.key !== "actions" && c.key !== "checkbox");
  const options = toggleable.map((c) => ({ value: c.key, label: c.header }));
  const value = toggleable.filter((c) => c.visible).map((c) => ({ value: c.key, label: c.header }));
  return (
    <Select isMulti options={options} value={value}
      onChange={(sel) => {
        const keys = new Set((sel as any[]).map((s) => s.value));
        toggleable.forEach((c) => { if (c.visible !== keys.has(c.key)) onChange(c.key, keys.has(c.key)); });
      }}
      styles={colSelectStyles}
      components={{ Option: ColCheckboxOption, ValueContainer: ColValueContainer, MultiValue: () => null }}
      closeMenuOnSelect={false} hideSelectedOptions={false} isSearchable={false}
      noOptionsMessage={() => "ไม่พบข้อมูล"} placeholder="เลือกคอลัมน์ที่แสดง..."
    />
  );
}

// (BillPinMenuPopup ถูกย้ายไปใช้ shared component แล้ว — ดู components/PinMenuPopup.tsx)

function BillTableView({ data, isFiltered = false, payments, monthYear, allBills, onEdit, onPrint, onToggleStatus, onOpenPayment, onBulkPrint, lineEnabled, onSendLine, sendingLineIdx, onSendLineBulk, bulkSendingLine }: {
  data: { item: BillItem; idx: number }[];
  isFiltered?: boolean;
  payments: any[];
  monthYear: string;
  allBills: BillGroup[];
  onEdit: (idx: number) => void;
  onPrint: (item: BillItem) => void;
  onToggleStatus: (idx: number) => void;
  onOpenPayment: (idx: number) => void;
  onBulkPrint: (items: BillItem[]) => void;
  lineEnabled: boolean;
  onSendLine: (idx: number) => void;
  sendingLineIdx: number | null;
  onSendLineBulk: (roomIds: string[]) => void;
  bulkSendingLine: boolean;
}) {
  const [cols, setCols, moveColumn] = useColumnVisibility("bills-room", BILL_TABLE_COLS);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [pinMenu, setPinMenu] = useState<PinMenuState | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const { widths, startResize } = useColumnWidths("bills-room", {
    checkbox: 40, room: 90, tenant: 160, priceRoom: 100, water: 100,
    electric: 100, vehicle: 100, roomTag: 140, tenantTag: 140, discount: 110, other: 100, fine: 130, outstanding: 130,
    ownMonth: 110, total: 110, received: 110, status: 110, actions: 130,
  });
  const { ordered: rowOrdered, moveRow } = useRowOrder("bills-room", data, (d) => String(d.item.roomId), isFiltered);
  const [draggingRowKey, setDraggingRowKey] = useState<string | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const [draggingColKey, setDraggingColKey] = useState<string | null>(null);
  const [dropTargetColKey, setDropTargetColKey] = useState<string | null>(null);

  const visible = cols.filter((c) => c.visible);
  const ordered = [
    ...visible.filter((c) => c.pin === "left"),
    ...visible.filter((c) => !c.pin),
    ...visible.filter((c) => c.pin === "right"),
  ];

  useLayoutEffect(() => {
    const tbl = tableRef.current;
    if (!tbl) return;
    const ths = Array.from(tbl.querySelectorAll<HTMLTableCellElement>("thead tr th"));
    const rowTds = Array.from(tbl.querySelectorAll<HTMLTableRowElement>("tbody tr")).map(
      (tr) => Array.from(tr.querySelectorAll<HTMLTableCellElement>("td"))
    );
    let leftOff = 0;
    ordered.forEach((col, i) => {
      if (col.pin !== "left") return;
      const th = ths[i]; if (!th) return;
      th.style.left = `${leftOff}px`;
      rowTds.forEach((cells) => { if (cells[i]) cells[i].style.left = `${leftOff}px`; });
      leftOff += th.offsetWidth;
    });
    let rightOff = 0;
    [...ordered].reverse().forEach((col, ri) => {
      if (col.pin !== "right") return;
      const i = ordered.length - 1 - ri;
      const th = ths[i]; if (!th) return;
      th.style.right = `${rightOff}px`;
      rowTds.forEach((cells) => { if (cells[i]) cells[i].style.right = `${rightOff}px`; });
      rightOff += th.offsetWidth;
    });
  });

  const allSelected = data.length > 0 && selectedRows.size === data.length;
  const someSelected = selectedRows.size > 0 && !allSelected;
  useEffect(() => { if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected; }, [someSelected]);

  function toggleAll(checked: boolean) { setSelectedRows(checked ? new Set(data.map((d) => d.item.roomId)) : new Set()); }
  function toggleRow(id: string) {
    setSelectedRows((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function handleColVisibility(key: string, v: boolean) { setCols((prev) => prev.map((c) => c.key === key ? { ...c, visible: v } : c)); }
  function handlePin(key: string, dir: PinDir) { setCols((prev) => prev.map((c) => c.key === key ? { ...c, pin: dir } : c)); }
  function openPinMenu(e: React.MouseEvent, colKey: string) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPinMenu({ colKey, x: Math.max(0, rect.right - 160), y: rect.bottom + 4 });
  }

  function renderCell(col: BillColDef, item: BillItem, idx: number) {
    switch (col.key) {
      case "checkbox":
        return (
          <>
            <span className="row-drag-handle" draggable
              onClick={(e) => e.stopPropagation()}
              onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(item.roomId)); setDraggingRowKey(String(item.roomId)); }}
              onDragEnd={() => { setDraggingRowKey(null); setDropTargetKey(null); }}
              title="ลากเพื่อสลับลำดับแถว">
              <i className="fas fa-grip-vertical" />
            </span>
            <input type="checkbox" className="form-check-input row-checkbox"
              checked={selectedRows.has(item.roomId)} onChange={() => toggleRow(item.roomId)}
              onClick={(e) => e.stopPropagation()} />
          </>
        );
      case "room": return <span className="fw-bold">ห้อง {item.roomNumber}</span>;
      case "tenant": return item.tenantId
        ? `${item.tenantTitle} ${item.tenantName}`
        : <span className="text-muted fst-italic">{item.tenantName || "ว่าง"}</span>;
      case "priceRoom": return money(item.priceRoom);
      case "water":
        return <>{money(item.priceWater)}<div className="text-muted" style={{ fontSize: 11 }}>{item.meterWater.unit} หน่วย</div></>;
      case "electric":
        return <>{money(item.priceElectric)}<div className="text-muted" style={{ fontSize: 11 }}>{item.meterElectric.unit} หน่วย</div></>;
      case "vehicle": return item.priceVehicle > 0 ? money(item.priceVehicle) : "-";
      // Tag ห้อง/Tag ผู้เช่า/ส่วนลด แยกเป็นคอลัมน์ของตัวเอง (เดิมรวมอยู่ใน "อื่นๆ" ก้อนเดียว) แสดงเป็น chip
      // ไอคอน + ชื่อ + ยอด ต่อรายการ (ทรงเดียวกับ .bill-tag-chip ในหน้าแก้ไขบิล ไม่มีปุ่มลบตรงนี้)
      case "roomTag":
        return item.billTagItems.length > 0 ? (
          <div className="d-flex flex-wrap justify-content-end gap-1">
            {item.billTagItems.map((t, i) => (
              <span key={i} className="bill-tag-chip" style={{ "--tag-color": t.color || "#6c757d" } as React.CSSProperties}>
                <i className="fas fa-tag" style={{ fontSize: 10 }} />{t.name} ({money(t.price)})
              </span>
            ))}
          </div>
        ) : "-";
      case "tenantTag":
        return item.billTenantTagItems.length > 0 ? (
          <div className="d-flex flex-wrap justify-content-end gap-1">
            {item.billTenantTagItems.map((t, i) => (
              <span key={i} className="bill-tag-chip" style={{ "--tag-color": t.color || "#6C9BCF" } as React.CSSProperties}>
                <i className="fas fa-user" style={{ fontSize: 10 }} />{t.name} ({money(t.price)})
              </span>
            ))}
          </div>
        ) : "-";
      case "discount":
        return item.discountItems.length > 0 ? (
          <div className="d-flex flex-wrap justify-content-end gap-1">
            {item.discountItems.map((d, i) => (
              <span key={i} className="bill-tag-chip" style={{ "--tag-color": "#dc3545" } as React.CSSProperties}>
                <i className="fas fa-tag" style={{ fontSize: 10 }} />{d.name} (-{money(d.price)})
              </span>
            ))}
          </div>
        ) : "-";
      case "other": {
        // เหลือแค่ "รายการอื่นๆ/เพิ่มเติม" (customItems) ล้วนๆ — ค่าจอดรถ/Tag ห้อง/Tag ผู้เช่า/ส่วนลด
        // แยกออกไปเป็นคอลัมน์ของตัวเองหมดแล้วด้านบน
        const customTotal = item.customItems.reduce((s, c) => s + (Number(c.price) || 0), 0);
        if (item.customItems.length === 0) return "-";
        return (
          <>
            {money(customTotal)}
            <div className="text-muted" style={{ fontSize: 11 }}>{item.customItems.map((c) => c.name).join(", ")}</div>
          </>
        );
      }
      case "fine": {
        if (!(item.fineAmount > 0)) return "-";
        return (
          <div className="d-flex flex-wrap justify-content-end gap-1">
            <span className="bill-tag-chip" style={{ "--tag-color": item.status === "paid" ? "#198754" : "#dc3545" } as React.CSSProperties}>
              <i className="fas fa-calendar-alt" style={{ fontSize: 10 }} />{monthYearLabel(monthYear)} ({money(item.fineAmount)})
            </span>
          </div>
        );
      }
      case "outstanding": {
        if (!(item.outstandingAmount > 0)) return "-";
        // ยอดของแต่ละเดือนที่ยกมา (item.outstandingItems) เป็นค่าที่ "แช่แข็ง" ไว้ตอนสร้างบิลเดือนนี้ — โชว์
        // ยอดเต็มเดิมเสมอไม่ว่าจะจ่ายไปแล้วบางส่วนหรือไม่ (เป็นบันทึกยอดตอนออกบิล ไม่ใช่ยอดคงเหลือสดๆ) ส่วนยอดที่
        // รับมาแล้วจริงของเดือนนั้น ไปโชว์ที่คอลัมน์ "รับชำระแล้ว" แทน (ดู case "received" ด้านล่าง) — เปลี่ยนสี
        // เป็นเขียวเมื่อยอดก้อนนี้ถูกปิด/จ่ายครบแล้วเท่านั้น ยังไม่ครบ (แม้จ่ายมาบางส่วน) ยังเป็นสีแดงเหมือนเดิม
        const chips = item.outstandingItems.length > 0
          ? item.outstandingItems.map((o) => {
              const group = allBills.find((b) => b.monthYear === o.monthYear);
              const roomBill = group?.data?.find((r) => String(r.roomId) === String(item.roomId));
              const cleared = item.status === "paid"
                || (!!roomBill && (roomBill.status === "paid" || (Number(roomBill.paidAmount) || 0) >= (Number(roomBill.total) || 0) - 0.005));
              return { label: monthYearLabel(o.monthYear), amount: o.amount, cleared };
            })
          : [{ label: "ยอดยกมา", amount: item.outstandingAmount, cleared: item.status === "paid" }];
        return (
          <div className="d-flex flex-wrap justify-content-end gap-1">
            {chips.map((c, i) => (
              <span key={i} className="bill-tag-chip" style={{ "--tag-color": c.cleared ? "#198754" : "#dc3545" } as React.CSSProperties}>
                <i className="fas fa-calendar-alt" style={{ fontSize: 10 }} />{c.label} ({money(c.amount)})
              </span>
            ))}
          </div>
        );
      }
      case "ownMonth": return money(Math.max(0, item.total - (item.outstandingAmount || 0)));
      case "total": return <span className="fw-bold" style={{ color: "var(--color-primary)" }}>{money(item.total)}</span>;
      case "received": {
        // ชิปของเดือนนี้เอง (item.paidAmount) + ชิปของเดือนเก่าที่ยกมา (item.outstandingItems) เดือนไหนที่มีการ
        // รับเงินไปแล้วจริง (roomBill.paidAmount > 0 ของบิลต้นทางเดือนนั้น) ไม่ว่าจะปิดครบหรือจ่ายมาแค่บางส่วน —
        // ให้เห็นว่าเงินที่รับมาไปลงเดือนไหนบ้าง แทนที่จะไปลดยอด "ค้างชำระ" ของเดือนนั้นในคอลัมน์อื่น (ดู case
        // "outstanding" ด้านบน ที่ตั้งใจคงยอดแช่แข็งเดิมไว้เป็นบันทึกตอนออกบิล)
        const chips: { label: string; amount: number; cleared: boolean }[] = [];
        const paid = Number(item.paidAmount) || 0;
        if (paid > 0) chips.push({ label: monthYearLabel(monthYear), amount: paid, cleared: paid >= item.total - 0.005 });
        for (const o of item.outstandingItems) {
          const group = allBills.find((b) => b.monthYear === o.monthYear);
          const roomBill = group?.data?.find((r) => String(r.roomId) === String(item.roomId));
          if (!roomBill) continue;
          // roomBill.paidAmount คือยอดจ่ายสะสมของ "บิลเดือนนั้นทั้งใบ" (รวมค่าใช้จ่ายของตัวมันเอง+ยอดค้างที่มัน
          // ยกมาจากเดือนก่อนหน้ามันเองด้วย) ไม่ใช่แค่ส่วนที่ไหลมาเป็น "ค้างชำระ" ของเดือนนี้ (o.amount — เฉพาะ
          // ownAmount ของเดือนนั้น) เอามาโชว์ตรงๆ จะดูสูงเกินจริง/ปนกับยอดอื่นที่ไม่เกี่ยวกับ chip นี้ — คำนวณ
          // ย้อนกลับจากสูตรเดียวกับตอนสร้าง o.amount (getOutstandingBalance: o.amount = ownAmount - paidAmount
          // ตอนสร้างบิลนี้) ได้ว่าเงินที่รับเพิ่มมาสำหรับก้อนนี้ตั้งแต่นั้น = o.amount - ยอดคงเหลือสดๆ ตอนนี้
          const ownAmount = (Number(roomBill.total) || 0) - (Number(roomBill.outstandingAmount) || 0);
          const liveRemaining = Math.max(0, ownAmount - (Number(roomBill.paidAmount) || 0));
          const receivedForThis = Math.max(0, o.amount - liveRemaining);
          if (receivedForThis > 0) chips.push({ label: monthYearLabel(o.monthYear), amount: receivedForThis, cleared: liveRemaining <= 0.005 });
        }
        if (chips.length === 0) return "-";
        return (
          <div className="d-flex flex-wrap justify-content-end gap-1">
            {chips.map((c, i) => (
              <span key={i} className="bill-tag-chip" style={{ "--tag-color": c.cleared ? "#198754" : "#ffc107" } as React.CSSProperties}>
                <i className="fas fa-calendar-alt" style={{ fontSize: 10 }} />{c.label} ({money(c.amount)})
              </span>
            ))}
          </div>
        );
      }
      case "status": return <BillStatusBadge item={item} />;
      case "actions": {
        return (
          <div className="btn-group" role="group">
            {/* เดิมเป็นปุ่ม "ดูสลิป" (เปิด lightbox รูปสลิปล่าสุด เฉพาะบิลที่มีสลิปแนบ) — เปลี่ยนเป็นปุ่มลูกตา
                เปิดป็อปอัพ "บันทึกการชำระเงิน" (PaymentModal) แทน ในนั้นมีทั้งประวัติการชำระ (ดูสลิปได้เหมือนเดิม)
                + ปุ่มยกเลิกรายการชำระทีละรายการอยู่แล้ว — โชว์เฉพาะบิลที่มีเงินเข้าแล้ว (paidAmount > 0 ไม่ว่า
                จะจ่ายครบหรือจ่ายบางส่วน) บิลที่ยังไม่มีเงินเข้าเลยไม่มีอะไรให้ดู/ยกเลิก จึงไม่โชว์ปุ่มนี้ */}
            {item.paidAmount > 0 && (
              <button type="button" className="btn btn-sm btn-outline-primary" title="บันทึกการชำระเงิน"
                onClick={(e) => { e.stopPropagation(); onOpenPayment(idx); }}>
                <i className="fas fa-eye" />
              </button>
            )}
            {lineEnabled && (
              <button type="button" className="btn btn-sm btn-outline-success" disabled={sendingLineIdx === idx}
                title={item.sendLogs?.[0] ? sendLogSummary(item.sendLogs[0]) : "ส่งบิลทาง LINE"}
                onClick={(e) => { e.stopPropagation(); onSendLine(idx); }}>
                {sendingLineIdx === idx ? <span className="spinner-border spinner-border-sm" /> : <i className="fab fa-line" />}
              </button>
            )}
            <button type="button" className="btn btn-sm btn-info" title="แก้ไข" onClick={(e) => { e.stopPropagation(); onEdit(idx); }}>
              <i className="fas fa-edit" />
            </button>
            <button type="button" className="btn btn-sm btn-secondary" title="พิมพ์" onClick={(e) => { e.stopPropagation(); onPrint(item); }}>
              <i className="fas fa-print" />
            </button>
            {/* เอาปุ่ม "ยกเลิกการชำระ" ออกจากแถบไอคอนย่อในตาราง (เคยกดแล้วย้อนสถานะเป็นยังไม่จ่ายตรงๆ ทันที
                ไม่ผ่านการเลือกว่าจะยกเลิกรายการชำระไหน/เหตุผลอะไร) บิลที่จ่ายแล้วต้องกด "แก้ไข" เข้าไปดู
                รายละเอียดแล้วยกเลิกยอดที่จ่ายจากประวัติการชำระ (PaymentHistoryList) แทน ซึ่งบันทึกเหตุผลและ
                ยกเลิกได้ทีละรายการ — ปุ่มนี้เหลือไว้ใช้แค่ "บันทึกว่าจ่ายแล้ว" ตอนบิลยังไม่จ่ายเท่านั้น */}
            {item.status !== "paid" && (
              <button type="button" className="btn btn-sm btn-success" title="บันทึกว่าจ่ายแล้ว"
                onClick={(e) => { e.stopPropagation(); onToggleStatus(idx); }}>
                <i className="fas fa-check" />
              </button>
            )}
          </div>
        );
      }
      default: return "-";
    }
  }

  return (
    <div>
      <div className="mb-2">
        <BillColVisibilityDropdown cols={cols} onChange={handleColVisibility} />
      </div>

      {selectedRows.size > 0 && (
        <div className="bulk-actions-bar mb-2" style={{ justifyContent: "space-between" }}>
          <span>เลือก <strong>{selectedRows.size}</strong> รายการ</span>
          <div className="d-flex gap-2">
            <button className="btn btn-light btn-sm fw-bold"
              onClick={() => onBulkPrint(data.filter((d) => selectedRows.has(d.item.roomId)).map((d) => d.item))}>
              <i className="fas fa-print me-1" />พิมพ์ที่เลือก
            </button>
            {lineEnabled && (
              <button className="btn btn-success btn-sm fw-bold" disabled={bulkSendingLine}
                onClick={() => {
                  onSendLineBulk(data.filter((d) => selectedRows.has(d.item.roomId)).map((d) => d.item.roomId));
                  setSelectedRows(new Set());
                }}>
                {bulkSendingLine ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="fab fa-line me-1" />}
                ส่งบิลที่เลือก
              </button>
            )}
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setSelectedRows(new Set())}>
              <i className="fas fa-times me-1" />ยกเลิก
            </button>
          </div>
        </div>
      )}

      <div className="nicescrollbar" style={{ maxHeight: 560, overflow: "auto" }}>
        <table ref={tableRef} className="table-mainstyle table-hover table-resizable" style={{ minWidth: 700 }}>
          <thead>
            <tr>
              {ordered.map((col) => {
                const pinClass = col.pin === "left" ? "pinned pinned-left" : col.pin === "right" ? "pinned pinned-right" : "";
                const canDragCol = col.key !== "checkbox";
                return (
                  <th key={col.key} className={`${col.thClass ?? ""} ${pinClass} ${draggingColKey === col.key ? "col-dragging" : ""} ${dropTargetColKey === col.key ? "col-drop-target" : ""}`}
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
                    {col.pinnable && (
                      <i className={`fas fa-thumbtack pin-icon${col.pin === "left" ? " active-left" : col.pin === "right" ? " active-right" : ""}`}
                        title="ตัวเลือกการปักหมุด" onClick={(e) => openPinMenu(e, col.key)} />
                    )}
                    <ColResizeHandle onMouseDown={(e) => startResize(col.key, e)} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={ordered.length}><EmptyState icon="fa-file-invoice" text="ไม่พบข้อมูล" compact /></td></tr>
            ) : rowOrdered.map(({ item, idx }) => {
              const rowKey = String(item.roomId);
              return (
                <tr key={item.roomId}
                  className={`${draggingRowKey === rowKey ? "row-dragging" : ""} ${dropTargetKey === rowKey ? "row-drop-target" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); if (draggingRowKey && draggingRowKey !== rowKey) setDropTargetKey(rowKey); }}
                  onDragLeave={() => setDropTargetKey((k) => (k === rowKey ? null : k))}
                  onDrop={(e) => { e.preventDefault(); const dragged = e.dataTransfer.getData("text/plain"); if (dragged) moveRow(dragged, rowKey); setDraggingRowKey(null); setDropTargetKey(null); }}>
                  {ordered.map((col) => {
                    const pinClass = col.pin === "left" ? "pinned pinned-left" : col.pin === "right" ? "pinned pinned-right" : "";
                    return <td key={col.key} className={`${col.tdClass ?? ""} ${pinClass}`}>{renderCell(col, item, idx)}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pinMenu && <PinMenuPopup menu={pinMenu} cols={cols} onPin={handlePin} onClose={() => setPinMenu(null)} />}
    </div>
  );
}

// ── มุมมองตาราง (Table view) ของรายการบิลตามเดือน — โครงเดียวกับ BillTableView ──
const BILL_GROUP_TABLE_COLS: BillColDef[] = [
  { key: "checkbox",  header: "checkbox",    visible: true, pinnable: false, pin: "left",  thClass: "text-center checkbox-cell", tdClass: "text-center checkbox-cell" },
  { key: "month",     header: "เดือน/ปี",     visible: true, pinnable: true,  pin: "left" },
  { key: "rooms",     header: "ห้องทั้งหมด",  visible: true, pinnable: true,  pin: false,   thClass: "text-center", tdClass: "text-center" },
  { key: "paid",      header: "จ่ายแล้ว/ทั้งหมด", visible: true, pinnable: true, pin: false, thClass: "text-center", tdClass: "text-center" },
  { key: "total",     header: "ยอดรวม",       visible: true, pinnable: true,  pin: false,   thClass: "text-end",    tdClass: "text-end" },
  { key: "scheduled", header: "วันนัดชำระ",   visible: true, pinnable: true,  pin: false },
  { key: "updated",   header: "อัปเดตล่าสุด", visible: true, pinnable: true,  pin: false },
  { key: "actions",   header: "จัดการ",       visible: true, pinnable: true,  pin: "right", thClass: "text-center action-cell", tdClass: "text-center action-cell" },
];

function BillGroupTableView({ data, onEdit, onPrint, onDelete, onBulkPrint, onPrintDashboard }: {
  data: BillGroup[];
  onEdit: (g: BillGroup) => void;
  onPrint: (g: BillGroup) => void;
  onDelete: (g: BillGroup) => void;
  onBulkPrint: (groups: BillGroup[]) => void;
  onPrintDashboard: (g: BillGroup) => void;
}) {
  const [cols, setCols, moveColumn] = useColumnVisibility("bills-group", BILL_GROUP_TABLE_COLS);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [pinMenu, setPinMenu] = useState<PinMenuState | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const { widths, startResize } = useColumnWidths("bills-group", {
    checkbox: 40, month: 130, rooms: 110, paid: 130, total: 120, scheduled: 130, updated: 160, actions: 130,
  });
  const { ordered: rowOrdered, moveRow } = useRowOrder("bills-group", data, (g) => g.id ?? g.monthYear);
  const [draggingRowKey, setDraggingRowKey] = useState<string | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const [draggingColKey, setDraggingColKey] = useState<string | null>(null);
  const [dropTargetColKey, setDropTargetColKey] = useState<string | null>(null);

  const visible = cols.filter((c) => c.visible);
  const ordered = [
    ...visible.filter((c) => c.pin === "left"),
    ...visible.filter((c) => !c.pin),
    ...visible.filter((c) => c.pin === "right"),
  ];

  useLayoutEffect(() => {
    const tbl = tableRef.current;
    if (!tbl) return;
    const ths = Array.from(tbl.querySelectorAll<HTMLTableCellElement>("thead tr th"));
    const rowTds = Array.from(tbl.querySelectorAll<HTMLTableRowElement>("tbody tr")).map(
      (tr) => Array.from(tr.querySelectorAll<HTMLTableCellElement>("td"))
    );
    let leftOff = 0;
    ordered.forEach((col, i) => {
      if (col.pin !== "left") return;
      const th = ths[i]; if (!th) return;
      th.style.left = `${leftOff}px`;
      rowTds.forEach((cells) => { if (cells[i]) cells[i].style.left = `${leftOff}px`; });
      leftOff += th.offsetWidth;
    });
    let rightOff = 0;
    [...ordered].reverse().forEach((col, ri) => {
      if (col.pin !== "right") return;
      const i = ordered.length - 1 - ri;
      const th = ths[i]; if (!th) return;
      th.style.right = `${rightOff}px`;
      rowTds.forEach((cells) => { if (cells[i]) cells[i].style.right = `${rightOff}px`; });
      rightOff += th.offsetWidth;
    });
  });

  const allSelected = data.length > 0 && selectedRows.size === data.length;
  const someSelected = selectedRows.size > 0 && !allSelected;
  useEffect(() => { if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected; }, [someSelected]);

  function toggleAll(checked: boolean) { setSelectedRows(checked ? new Set(data.map((g) => g.id!)) : new Set()); }
  function toggleRow(id: string) {
    setSelectedRows((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function handleColVisibility(key: string, v: boolean) { setCols((prev) => prev.map((c) => c.key === key ? { ...c, visible: v } : c)); }
  function handlePin(key: string, dir: PinDir) { setCols((prev) => prev.map((c) => c.key === key ? { ...c, pin: dir } : c)); }
  function openPinMenu(e: React.MouseEvent, colKey: string) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPinMenu({ colKey, x: Math.max(0, rect.right - 160), y: rect.bottom + 4 });
  }

  function renderCell(col: BillColDef, g: BillGroup) {
    const paidCount = g.data.filter((i) => i.status === "paid").length;
    const total = g.data.reduce((s, i) => s + (Number(i.total) || 0), 0);
    switch (col.key) {
      case "checkbox": {
        const rowKey = g.id ?? g.monthYear;
        return (
          <>
            <span className="row-drag-handle" draggable
              onClick={(e) => e.stopPropagation()}
              onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", rowKey); setDraggingRowKey(rowKey); }}
              onDragEnd={() => { setDraggingRowKey(null); setDropTargetKey(null); }}
              title="ลากเพื่อสลับลำดับแถว">
              <i className="fas fa-grip-vertical" />
            </span>
            <input type="checkbox" className="form-check-input row-checkbox"
              checked={selectedRows.has(g.id!)} onChange={() => toggleRow(g.id!)}
              onClick={(e) => e.stopPropagation()} />
          </>
        );
      }
      case "month": return <span className="fw-bold" style={{ color: "var(--color-primary)" }}>{monthYearLabel(g.monthYear)}</span>;
      case "rooms": return g.data.length;
      case "paid": return `${paidCount}/${g.data.length}`;
      case "total": return <span className="fw-bold">{money(total)} ฿</span>;
      case "scheduled": return scheduledDateSafe(g.scheduledDate);
      case "updated": return formatDateSafe(g.updatedAt);
      case "actions":
        return (
          <div className="btn-group" role="group">
            <button type="button" className="btn btn-sm btn-info" title="ดู/แก้ไข" onClick={(e) => { e.stopPropagation(); onEdit(g); }}>
              <i className="fas fa-eye" />
            </button>
            <button type="button" className="btn btn-sm btn-secondary" title="พิมพ์ทั้งเดือน" onClick={(e) => { e.stopPropagation(); onPrint(g); }}>
              <i className="fas fa-print" />
            </button>
            <button type="button" className="btn btn-sm btn-outline-secondary" title="พิมพ์สรุป Dashboard" onClick={(e) => { e.stopPropagation(); onPrintDashboard(g); }}>
              <i className="fas fa-chart-pie" />
            </button>
            <button type="button" className="btn btn-sm btn-danger" title="ลบ" onClick={(e) => { e.stopPropagation(); onDelete(g); }}>
              <i className="fas fa-trash-alt" />
            </button>
          </div>
        );
      default: return "-";
    }
  }

  return (
    <div>
      <div className="mb-2">
        <BillColVisibilityDropdown cols={cols} onChange={handleColVisibility} />
      </div>

      {selectedRows.size > 0 && (
        <div className="bulk-actions-bar mb-2" style={{ justifyContent: "space-between" }}>
          <span>เลือก <strong>{selectedRows.size}</strong> รายการ</span>
          <div className="d-flex gap-2">
            <button className="btn btn-light btn-sm fw-bold"
              onClick={() => onBulkPrint(data.filter((g) => selectedRows.has(g.id!)))}>
              <i className="fas fa-print me-1" />พิมพ์ที่เลือก
            </button>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setSelectedRows(new Set())}>
              <i className="fas fa-times me-1" />ยกเลิก
            </button>
          </div>
        </div>
      )}

      <div className="table-responsive-wrapper nicescrollbar" style={{ maxHeight: 650, overflow: "auto" }}>
        <table ref={tableRef} className="table-mainstyle table-hover table-resizable" style={{ minWidth: 700 }}>
          <thead>
            <tr>
              {ordered.map((col) => {
                const pinClass = col.pin === "left" ? "pinned pinned-left" : col.pin === "right" ? "pinned pinned-right" : "";
                const canDragCol = col.key !== "checkbox";
                return (
                  <th key={col.key} className={`${col.thClass ?? ""} ${pinClass} ${draggingColKey === col.key ? "col-dragging" : ""} ${dropTargetColKey === col.key ? "col-drop-target" : ""}`}
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
                    {col.pinnable && (
                      <i className={`fas fa-thumbtack pin-icon${col.pin === "left" ? " active-left" : col.pin === "right" ? " active-right" : ""}`}
                        title="ตัวเลือกการปักหมุด" onClick={(e) => openPinMenu(e, col.key)} />
                    )}
                    <ColResizeHandle onMouseDown={(e) => startResize(col.key, e)} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={ordered.length}><EmptyState icon="fa-file-invoice" text="ไม่พบข้อมูล" compact /></td></tr>
            ) : rowOrdered.map((g) => {
              const rowKey = g.id ?? g.monthYear;
              return (
                <tr key={g.id ?? g.monthYear}
                  className={`${draggingRowKey === rowKey ? "row-dragging" : ""} ${dropTargetKey === rowKey ? "row-drop-target" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); if (draggingRowKey && draggingRowKey !== rowKey) setDropTargetKey(rowKey); }}
                  onDragLeave={() => setDropTargetKey((k) => (k === rowKey ? null : k))}
                  onDrop={(e) => { e.preventDefault(); const dragged = e.dataTransfer.getData("text/plain"); if (dragged) moveRow(dragged, rowKey); setDraggingRowKey(null); setDropTargetKey(null); }}>
                  {ordered.map((col) => {
                    const pinClass = col.pin === "left" ? "pinned pinned-left" : col.pin === "right" ? "pinned pinned-right" : "";
                    return <td key={col.key} className={`${col.tdClass ?? ""} ${pinClass}`}>{renderCell(col, g)}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pinMenu && <PinMenuPopup menu={pinMenu} cols={cols} onPin={handlePin} onClose={() => setPinMenu(null)} />}
    </div>
  );
}

interface BulkSendItem { roomId: string; roomNumber: string; status: "pending" | "sending" | "success" | "error"; message?: string }

// ── ป็อปอัพส่วนลดพิเศษเฉพาะห้อง ───────────────────────────────────────────────
// ตั้งส่วนลด (จำนวนเงินตรงๆ หรือเปอร์เซ็นต์) ผูกกับห้องที่เลือกไว้ ให้คิดซ้ำเข้าบิลทุกเดือนอัตโนมัติจนกว่าจะถึง
// เดือนหลังวันหมดอายุที่ตั้งไว้ (ไม่ตั้งวันหมดอายุ = ใช้ได้ตลอดไป) — ดู applySpecialDiscounts ใน utils/billCalc.ts
function SpecialDiscountsModal({ rooms, tenants, towers, discounts, onClose, onChange }: {
  rooms: any[]; tenants: any[]; towers: any[]; discounts: SpecialDiscount[];
  onClose: () => void;
  onChange: (next: SpecialDiscount[]) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<"fixed" | "percent">("fixed");
  const [value, setValue] = useState("");
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [expiryDate, setExpiryDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const [roomSearch, setRoomSearch] = useState("");
  const [roomTowerFilter, setRoomTowerFilter] = useState<string[]>([]);
  const activeTowers = towers.filter((t: any) => t.isActive !== false);

  const roomList = rooms
    .slice()
    .sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true, sensitivity: "base" }))
    .map((r) => {
      const tenant = findTenantForRoom(tenants, r);
      const tenantName = tenant ? `${tenant.firstName ?? ""} ${tenant.lastName ?? ""}`.trim() : "";
      return { id: r.id, number: r.number, towerId: r.towerId, tenantName };
    });
  const filteredRooms = roomList.filter((r) => {
    const q = roomSearch.trim().toLowerCase();
    const matchSearch = !q || r.number.toLowerCase().includes(q) || r.tenantName.toLowerCase().includes(q);
    const matchTower = roomTowerFilter.length === 0 || roomTowerFilter.includes(r.towerId ?? "unassigned");
    return matchSearch && matchTower;
  });
  const allFilteredSelected = filteredRooms.length > 0 && filteredRooms.every((r) => roomIds.includes(r.id));

  function resetForm() {
    setEditingId(null); setName(""); setType("fixed"); setValue(""); setRoomIds([]); setExpiryDate(""); setError("");
  }
  function startEdit(d: SpecialDiscount) {
    setEditingId(d.id); setName(d.name); setType(d.type); setValue(String(d.value)); setRoomIds(d.roomIds); setExpiryDate(d.expiryDate); setError("");
  }

  async function handleSubmit() {
    if (!name.trim()) { setError("กรุณาระบุชื่อส่วนลด"); return; }
    if (roomIds.length === 0) { setError("กรุณาเลือกห้องอย่างน้อย 1 ห้อง"); return; }
    if (!(Number(value) > 0)) { setError("กรุณาระบุจำนวน/เปอร์เซ็นต์ให้ถูกต้อง"); return; }
    setSaving(true); setError("");
    try {
      const payload = { name: name.trim(), type, value: Number(value), roomIds, expiryDate };
      const saved = editingId ? await specialDiscountsApi.update(editingId, payload) : await specialDiscountsApi.create(payload);
      // บันทึกลง backend สำเร็จแล้ว ณ จุดนี้ — reset ฟอร์ม/แจ้งเตือนสำเร็จก่อนเลย ไม่รอ onChange ด้านล่าง
      // (ซึ่งแค่รีคำนวณบิลเดือนที่เปิดอยู่ให้เห็นผลทันที เป็นแค่ side effect ของหน้านี้ ไม่ใช่ส่วนที่ตัดสินว่า
      // บันทึกสำเร็จหรือไม่) กันปัญหาที่ onChange พังแล้วทำให้ผู้ใช้เข้าใจผิดว่าบันทึกไม่สำเร็จทั้งที่จริงๆ
      // ข้อมูลถูกบันทึกลง backend ไปแล้ว
      resetForm();
      toastSuccess(editingId ? "แก้ไขส่วนลดพิเศษแล้ว" : "เพิ่มส่วนลดพิเศษแล้ว");
      try {
        onChange(editingId ? discounts.map((d) => (d.id === editingId ? saved : d)) : [...discounts, saved]);
      } catch (e) {
        console.error("[SpecialDiscountsModal] onChange failed", e);
      }
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await specialDiscountsApi.delete(id);
      onChange(discounts.filter((d) => d.id !== id));
      if (editingId === id) resetForm();
      toastSuccess("ลบส่วนลดพิเศษแล้ว");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="confirm-overlay" onClick={onClose}>
      <div className="confirm-dialog" style={{ maxWidth: 820, width: "96%", textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h6 className="mb-0"><i className="fas fa-percent me-2 text-primary" />ส่วนลดพิเศษเฉพาะห้อง</h6>
          <button className="btn-close" onClick={onClose} />
        </div>

        {discounts.length > 0 && (
          <div className="mb-3" style={{ maxHeight: 220, overflowY: "auto" }}>
            {discounts.map((d) => (
              <div key={d.id} className="d-flex align-items-center justify-content-between p-2 mb-1 rounded"
                style={{ background: "var(--color-background)", border: "1px solid var(--color-light)" }}>
                <div className="flex-grow-1" style={{ minWidth: 0 }}>
                  <div className="fw-semibold">
                    {d.name} <span className="text-muted small">({d.type === "percent" ? `${d.value}%` : `${d.value.toLocaleString()} บาท`})</span>
                  </div>
                  <div className="text-muted" style={{ fontSize: 11 }}>
                    {d.roomIds.length} ห้อง · {d.expiryDate ? `หมดอายุ ${thaiDateOnlyString(new Date(d.expiryDate))}` : "ไม่มีวันหมดอายุ"}
                  </div>
                </div>
                <div className="d-flex gap-1 flex-shrink-0">
                  <button className="btn btn-sm btn-outline-secondary" title="แก้ไข" onClick={() => startEdit(d)}><i className="fas fa-pen" /></button>
                  <button className="btn btn-sm btn-outline-danger" title="ลบ" disabled={deletingId === d.id} onClick={() => handleDelete(d.id)}>
                    {deletingId === d.id ? <span className="spinner-border spinner-border-sm" /> : <i className="fas fa-trash-alt" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <hr className="my-2" />
        <label className="form-label small fw-bold mb-2">{editingId ? "แก้ไขส่วนลด" : "เพิ่มส่วนลดใหม่"}</label>
        <div className="row g-3 mb-2">
          <div className="col-md-6">
            <div className="row g-2">
              <div className="col-12">
                <input type="text" className="form-control" placeholder="ชื่อส่วนลด เช่น ส่วนลดพนักงาน"
                  value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="col-6">
                <select className="form-select" value={type} onChange={(e) => setType(e.target.value as "fixed" | "percent")}>
                  <option value="fixed">จำนวนเงิน (บาท)</option>
                  <option value="percent">เปอร์เซ็นต์ (%)</option>
                </select>
              </div>
              <div className="col-6">
                <input type="number" min={0} className="form-control" placeholder={type === "percent" ? "เช่น 10" : "เช่น 500"}
                  value={value} onChange={(e) => setValue(e.target.value)} />
              </div>
              <div className="col-12">
                <label className="form-label small mb-1">วันหมดอายุ <span className="text-muted fw-normal">(ไม่ระบุ = ไม่มีวันหมดอายุ)</span></label>
                <ThaiDatePicker value={expiryDate} onChange={setExpiryDate} />
              </div>
            </div>
          </div>
          <div className="col-md-6">
            <label className="form-label small mb-1">ห้องที่ใช้ส่วนลดนี้ {roomIds.length > 0 && <span className="text-muted fw-normal">({roomIds.length} ห้อง)</span>}</label>
            <div className="print-config-panel" style={{
              background: "var(--color-background)", border: "1px solid var(--color-light)", borderRadius: "var(--border-radius-1)",
              padding: 10,
            }}>
              <div className="print-config-search">
                <i className="fas fa-search" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--color-dark-variant)", fontSize: "0.8rem", pointerEvents: "none" }} />
                <input type="text" className="form-control form-control-sm" style={{ paddingLeft: 30, fontSize: "0.85rem" }}
                  placeholder="ค้นหาเลขห้อง หรือชื่อผู้เช่า..." value={roomSearch} onChange={(e) => setRoomSearch(e.target.value)} />
              </div>

              {activeTowers.length > 1 && (
                <div style={{ display: "flex", gap: 6, margin: "8px 0", flexWrap: "wrap" }}>
                  {activeTowers.map((tw: any) => {
                    const active = roomTowerFilter.includes(tw.id);
                    return (
                      <button key={tw.id} type="button" className={`pcp-chip${active ? " active" : ""}`}
                        onClick={() => setRoomTowerFilter((prev) => prev.includes(tw.id) ? prev.filter((id) => id !== tw.id) : [...prev, tw.id])}>
                        <i className="fas fa-building me-1" style={{ fontSize: "0.7em" }} />{tw.name}
                      </button>
                    );
                  })}
                  {roomTowerFilter.length > 0 && (
                    <button type="button" className="pcp-chip" onClick={() => setRoomTowerFilter([])}><i className="fas fa-times me-1" />ล้างตึก</button>
                  )}
                </div>
              )}

              {filteredRooms.length > 0 && (
                <label className="print-config-check-row" style={{ marginTop: 6, marginBottom: 6, paddingBottom: 6, borderBottom: "1px solid var(--color-light)" }}>
                  <input type="checkbox" className="print-config-checkbox" checked={allFilteredSelected}
                    onChange={(e) => {
                      const next = new Set(roomIds);
                      filteredRooms.forEach((r) => { e.target.checked ? next.add(r.id) : next.delete(r.id); });
                      setRoomIds([...next]);
                    }} />
                  <span style={{ fontWeight: 600, fontSize: "0.82rem", color: "var(--color-dark-variant)" }}>เลือกทั้งหมดที่กรอง ({filteredRooms.length} ห้อง)</span>
                </label>
              )}

              <div className="nicescrollbar" style={{ overflowY: "auto", maxHeight: 190 }}>
                {filteredRooms.length === 0 ? (
                  <div style={{ textAlign: "center", color: "var(--color-dark-variant)", padding: "20px 0", fontSize: "0.85rem" }}>
                    <i className="fas fa-search me-2" />ไม่พบห้องที่ตรงกัน
                  </div>
                ) : filteredRooms.map((r) => (
                  <label key={r.id} className="print-config-room-row">
                    <input type="checkbox" className="print-config-checkbox" checked={roomIds.includes(r.id)}
                      onChange={(e) => {
                        const next = new Set(roomIds);
                        e.target.checked ? next.add(r.id) : next.delete(r.id);
                        setRoomIds([...next]);
                      }} />
                    <span className="pcr-room-num">{r.number}</span>
                    {r.tenantName ? <span className="pcr-name">{r.tenantName}</span> : <span className="pcr-vacant"><i className="fas fa-door-open me-1" />ว่าง</span>}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
        {error && <div className="room-modal-error mb-2"><i className="fas fa-exclamation-circle me-2" />{error}</div>}
        <div className="d-flex gap-2">
          {editingId && <button className="btn btn-outline-secondary" onClick={resetForm}>ยกเลิกแก้ไข</button>}
          <button className="btn btn-primary flex-grow-1" onClick={handleSubmit} disabled={saving}>
            {saving ? <><span className="spinner-border spinner-border-sm me-2" />กำลังบันทึก...</> : editingId ? "บันทึกการแก้ไข" : <><i className="fas fa-plus me-1" />เพิ่มส่วนลด</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── หน้าหลัก ────────────────────────────────────────────────────────────────────
export default function BillsPage() {
  const { setBreadcrumb } = useBreadcrumb();
  const { config } = useAppConfig();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();

  // เก็บสถานะหน้าย่อยไว้ใน location.state (แทน useState เฉยๆ) เพื่อให้ปุ่ม "ย้อนกลับ" ของเบราว์เซอร์
  // ใช้งานได้จริง — กดย้อนกลับจะไล่กลับ detail -> editor -> list ก่อนจะออกจากหน้านี้จริงๆ
  const view = ((location.state as { subView?: "list" | "editor" | "detail" })?.subView) ?? "list";
  function setView(v: "list" | "editor" | "detail") { navigate("/bills", { state: { subView: v } }); }

  // ฟังก์ชันที่จะเรียกถ้าผู้ใช้ยืนยัน "ออก" จาก dialog เตือนแก้ไขค้าง — ตั้งค่าต่างกันไปตามช่องทางที่กดออก
  // (ปุ่มย้อนกลับในหน้า / ปุ่มย้อนกลับเบราว์เซอร์ / คลิกเมนู sidebar) แต่ใช้ dialog เดียวกันทั้งหมด
  const pendingLeaveRef = useRef<(() => void) | null>(null);

  const [groupViewMode, setGroupViewMode] = usePersistedViewMode<"table" | "list" | "grid">("bills-group", "table", ["table", "list", "grid"]);
  const [roomViewMode, setRoomViewMode] = usePersistedViewMode<"table" | "list" | "grid">("bills-room", "table", ["table", "list", "grid"]);
  const [groupSearch, setGroupSearch] = useState("");
  const [groupSort, setGroupSort] = useState<"desc" | "asc">("desc");
  const [loading, setLoading] = useState(true);
  const [bills, setBills] = useState<BillGroup[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [roomSlipLightbox, setRoomSlipLightbox] = useState<string | null>(null);

  const [rooms, setRooms] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [towers, setTowers] = useState<any[]>([]);
  const [roomTags, setRoomTags] = useState<any[]>([]);
  const [tenantTags, setTenantTags] = useState<any[]>([]);
  const [meterReadings, setMeterReadings] = useState<any[]>([]);
  const [formulas, setFormulas] = useState<any[]>([]);
  const [specialDiscounts, setSpecialDiscounts] = useState<SpecialDiscount[]>([]);
  const [showSpecialDiscounts, setShowSpecialDiscounts] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingMonthYear, setEditingMonthYear] = useState("");
  const [editingScheduledDate, setEditingScheduledDate] = useState("");
  const [billData, setBillData] = useState<BillItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [sendingLineIdx, setSendingLineIdx] = useState<number | null>(null);
  const [bulkSendingLine, setBulkSendingLine] = useState(false);
  const [bulkSendModal, setBulkSendModal] = useState<BulkSendItem[] | null>(null);
  const [confirmSendIdx, setConfirmSendIdx] = useState<number | null>(null);
  const [confirmSendBulkIds, setConfirmSendBulkIds] = useState<string[] | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newMonthYear, setNewMonthYear] = useState("");
  const [createError, setCreateError] = useState("");
  // เดือนที่แล้วมีห้องไหนใช้ "สูตรพิเศษ" (waterFormula/electricFormula กำหนดเองต่อห้อง) บ้างไหม — ถามผู้ใช้
  // ว่าจะนำสูตรเหล่านี้มาใช้ต่อกับบิลเดือนใหม่หรือไม่ (ค่าเริ่มต้นสร้างบิลใหม่จะรีเซ็ตกลับไปใช้สูตรมาตรฐานเสมอ)
  const [carryOverFormulas, setCarryOverFormulas] = useState(true);

  const [detailIndex, setDetailIndex] = useState<number | null>(null);
  const [payingIndex, setPayingIndex] = useState<number | null>(null);
  const [printPayload, setPrintPayload] = useState<PrintEntry[] | null>(null);
  const [printMode, setPrintMode] = useState<"slip" | "record">("slip");
  const [printColKeys, setPrintColKeys] = useState<Set<string>>(BILL_RECORD_DEFAULT_COLS);
  const [printOtherDetailMode, setPrintOtherDetailMode] = useState<"price" | "detail">("price");
  const [printTotalDisplayMode, setPrintTotalDisplayMode] = useState<"net" | "excludeSpecialDiscount">("net");
  const [printDashboard, setPrintDashboard] = useState(false);
  // ข้อมูลสำหรับพิมพ์สรุป Dashboard — แยกจาก stats/editingMonthYear ตรงๆ เพราะกดพิมพ์ได้จากหลายที่: เดือนที่
  // เปิดแก้ไขอยู่ (ใช้ billData สด), เดือนอื่นในหน้ารายการที่ยังไม่ได้เปิดเข้าไปเลย (ใช้ b.data ดิบ), หรือเลือก
  // โหมด "สรุป Dashboard" ในป็อปอัพตั้งค่าการพิมพ์ซึ่งอาจมีได้หลายเดือนพร้อมกัน (bulk print) — เป็น array เสมอ
  // พิมพ์ทีละหน้าต่อเดือน (ดู DashboardSummaryPrint)
  const [printDashboardGroups, setPrintDashboardGroups] = useState<{ monthYear: string; stats: DashboardStats }[]>([]);
  // หมวดที่เลือกแสดง — จำไว้ต่อผู้ใช้คีย์เดียวกับใน BillPrintConfigModal เพื่อให้ปุ่มพิมพ์เดี่ยวๆ (ในหน้าแก้ไข
  // บิล/ตารางรายการ) ใช้ค่าที่ตั้งไว้ล่าสุดเหมือนกันเสมอ ไม่ต้องไปตั้งซ้ำสองที่ — อ่านจาก localStorage ตรงๆ
  // (ไม่ผ่าน useState ของ usePersistedPref) ทุกครั้งที่กดพิมพ์ กัน React re-render ค้างค่าเก่าถ้าผู้ใช้เพิ่งไป
  // แก้ไว้ในป็อปอัพตั้งค่าการพิมพ์หมาดๆ ในเซสชันเดียวกัน
  const { user } = useAuth();
  function readPersistedDashboardSections(): Set<string> {
    try {
      const raw = localStorage.getItem(`pref:bills-print-dashboard-sections:${user?.id || "anon"}`);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set(DASHBOARD_SECTIONS_DEFAULT);
    } catch {
      return new Set(DASHBOARD_SECTIONS_DEFAULT);
    }
  }
  const [printDashboardSections, setPrintDashboardSections] = useState<Set<string>>(() => new Set(DASHBOARD_SECTIONS_DEFAULT));

  function printDashboardForCurrentMonth() {
    setPrintDashboardGroups([{ monthYear: editingMonthYear, stats }]);
    setPrintDashboardSections(readPersistedDashboardSections());
    setPrintDashboard(true);
    setTimeout(() => window.print(), 80);
  }

  function printDashboardForGroup(group: BillGroup) {
    const items = (group.data ?? []).map(normalizeBillItem);
    setPrintDashboardGroups([{ monthYear: group.monthYear, stats: computeBillStats(items, payments, group.monthYear) }]);
    setPrintDashboardSections(readPersistedDashboardSections());
    setPrintDashboard(true);
    setTimeout(() => window.print(), 80);
  }
  const [printSlipLineKeys, setPrintSlipLineKeys] = useState<Set<string>>(DEFAULT_SLIP_LINE_KEYS);
  const [printSlipLayout, setPrintSlipLayout] = useState<BillSlipLayout>("auto");
  const [printConfigPool, setPrintConfigPool] = useState<{ item: BillItem; monthYear: string }[] | null>(null);
  const [printConfigPreselect, setPrintConfigPreselect] = useState<Set<string>>(new Set());
  const [printConfigNonce, setPrintConfigNonce] = useState(0);
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState<BillGroup | null>(null);
  const [deletingGroup, setDeletingGroup] = useState(false);
  // ลบ "ประวัติการชำระที่ผ่านมา" ของบิลเดือนนี้ไปด้วยไหม — เลือกได้อิสระตอนกดลบบิล (ค่าเริ่มต้นไม่ลบ เผื่อ
  // ต้องเก็บไว้เป็นหลักฐานทางการเงิน) ไม่งั้นลบเฉพาะตัวบิลแล้วประวัติเดิมจะยังค้างอยู่ (จับคู่แสดงผลได้ต่อเพราะ
  // getPaymentHistory จับคู่ด้วย roomId+monthYear ที่ฝังอยู่ใน data เอง ไม่ได้อิง billId ที่ถูกลบไปแล้ว)
  const [deletePaymentHistory, setDeletePaymentHistory] = useState(false);
  const [confirmBack, setConfirmBack] = useState(false);

  // ลงทะเบียน/ยกเลิกกับตัวดักการออกจากหน้าที่แก้ไขค้าง (unsavedGuard) ทุกครั้งที่ dirty เปลี่ยน — ใช้ให้
  // เมนู sidebar รู้ว่าต้องดักไว้ก่อนพาออกจากหน้านี้ไหม (ดู handleBackClick/dialog ด้านล่างสำหรับ trigger อื่นๆ)
  useEffect(() => {
    setUnsavedGuard(dirty, (onLeave) => {
      pendingLeaveRef.current = onLeave;
      setConfirmBack(true);
    });
    return () => clearUnsavedGuard();
  }, [dirty]);

  // ปิด/รีเฟรชแท็บ หรือปิดเบราว์เซอร์ทั้งที่ยังมีการแก้ไขค้างอยู่ — เตือนด้วย native dialog ของเบราว์เซอร์เอง
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) { e.preventDefault(); e.returnValue = ""; }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // กดปุ่มย้อนกลับของเบราว์เซอร์ขณะมีการแก้ไขค้างอยู่ — history ของหน้านี้ผูกกับ location.state.subView
  // (ดูคอมเมนต์ setView ด้านบน) ทำให้ POP navigation เปลี่ยน view ทันทีโดยไม่ถาม จึงต้อง "ดันสถานะเดิมกลับ"
  // ขึ้นไปก่อน (ผู้ใช้จะยังเห็นหน้าเดิมอยู่) แล้วค่อยเปิด dialog ยืนยันแบบเดียวกับปุ่มย้อนกลับปกติ ถ้ายืนยันออก
  // ค่อยปล่อยให้ back() จริงๆ ทำงาน
  const prevLocationRef = useRef(location);
  useEffect(() => {
    if (navigationType === "POP" && dirty) {
      const restoreState = prevLocationRef.current.state;
      navigate(location.pathname, { state: restoreState });
      guardNavigation(() => window.history.back());
    }
    prevLocationRef.current = location;
  }, [location, navigationType, dirty, navigate]);

  useEffect(() => {
    if (view === "detail" && detailIndex !== null && billData[detailIndex]) {
      setBreadcrumb([
        { label: "ใบแจ้งหนี้", onClick: handleBackClick },
        { label: monthYearLabel(editingMonthYear), onClick: backToEditor },
        { label: `ห้อง ${billData[detailIndex].roomNumber}` },
      ]);
    } else if (view === "editor") {
      setBreadcrumb([
        { label: "ใบแจ้งหนี้", onClick: handleBackClick },
        { label: monthYearLabel(editingMonthYear) },
      ]);
    } else {
      setBreadcrumb([{ label: "ใบแจ้งหนี้" }]);
    }
    return () => setBreadcrumb([]);
  }, [view, editingMonthYear, dirty, detailIndex, billData]);

  useEffect(() => {
    Promise.all([
      billsApi.getAll(), roomsApi.getAll(), tenantsApi.getAll(), vehiclesApi.getAll(),
      roomsApi.getTags(), tenantsApi.getTags(), metersApi.getAll(), settingsApi.getAll(),
      roomsApi.getTowers(), billsApi.getPayments(), specialDiscountsApi.getAll(),
    ]).then(([b, r, t, v, rt, tt, m, f, tw, pay, sd]) => {
      setBills(b); setRooms(r); setTenants(t); setVehicles(v);
      setRoomTags(rt); setTenantTags(tt); setMeterReadings(m); setFormulas(f); setTowers(tw); setPayments(pay);
      setSpecialDiscounts(sd);
    }).finally(() => setLoading(false));
  }, []);

  // มีคนอื่นแก้ไขบิล/ห้อง/ผู้เช่า/รถ/แท็ก/มิเตอร์/สูตร/ตึก/การชำระเงินที่เครื่องอื่น — โหลดข้อมูลใหม่เงียบๆ
  // ไม่กระทบ billData ที่กำลังแก้ไขค้างอยู่ (เป็น state แยกจาก bills) จึงไม่เสี่ยงข้อมูลที่ยังไม่ได้บันทึกหาย
  const billsLiveTick = useLiveRefreshTick([
    "bill", "room", "tenant", "vehicle", "room-tag", "tenant-tag", "meter", "formula", "tower", "payment", "special-discount",
  ]);
  useEffect(() => {
    if (billsLiveTick === 0) return;
    Promise.all([
      billsApi.getAll(), roomsApi.getAll(), tenantsApi.getAll(), vehiclesApi.getAll(),
      roomsApi.getTags(), tenantsApi.getTags(), metersApi.getAll(), settingsApi.getAll(),
      roomsApi.getTowers(), billsApi.getPayments(), specialDiscountsApi.getAll(),
    ]).then(([b, r, t, v, rt, tt, m, f, tw, pay, sd]) => {
      setBills(b); setRooms(r); setTenants(t); setVehicles(v);
      setRoomTags(rt); setTenantTags(tt); setMeterReadings(m); setFormulas(f); setTowers(tw); setPayments(pay);
      setSpecialDiscounts(sd);
    });
  }, [billsLiveTick]);

  const ctx: GenCtx = useMemo(() => ({
    rooms, tenants, vehicles, roomTags, tenantTags, meterReadings, formulas, config, allBills: bills, specialDiscounts,
  }), [rooms, tenants, vehicles, roomTags, tenantTags, meterReadings, formulas, config, bills, specialDiscounts]);

  // เปิดตรงไปยังบิล/ห้องที่ระบุ เมื่อมีคนนำทางมาจากหน้าอื่น (เช่น คลิกประวัติการชำระเงินจากหน้ารายละเอียดผู้เช่า)
  // ผ่าน navigate("/bills", { state: { openBillId, openRoomId } }) — ทำครั้งเดียวหลังโหลดข้อมูลบิลเสร็จ
  const handledDeepLinkRef = useRef(false);
  useEffect(() => {
    const state = location.state as { openBillId?: string; openRoomId?: string } | null;
    if (!state?.openBillId || loading || handledDeepLinkRef.current) return;
    const group = bills.find((b) => b.id === state.openBillId);
    if (!group) return;
    handledDeepLinkRef.current = true;
    const data = (group.data ?? []).map(normalizeBillItem);
    refreshDerivedFields(data, group.monthYear, ctx);
    setEditingId(group.id);
    setEditingMonthYear(group.monthYear);
    setEditingScheduledDate(group.scheduledDate ?? "");
    setBillData(data);
    setDirty(false);
    const idx = state.openRoomId ? data.findIndex((it) => String(it.roomId) === String(state.openRoomId)) : -1;
    setDetailIndex(idx >= 0 ? idx : null);
    setView(idx >= 0 ? "detail" : "editor");
  }, [bills, loading]);

  const defaults = useMemo(() => resolveDefaultFormulas(formulas), [formulas]);

  // เดือนที่เลือกสร้างบิลได้ต้องมีการจดมิเตอร์ของเดือนนั้นแล้วเท่านั้น (เรียงล่าสุดก่อน)
  const meteredMonthYears = useMemo(
    () => Array.from(new Set(meterReadings.map((m) => m.monthYear))).sort((a, b) => myScore(b) - myScore(a)),
    [meterReadings]
  );
  const MONTHYEAR_OPTIONS = meteredMonthYears.map((my) => ({ value: my, label: monthYearLabel(my) }));

  const awaitingMeterRooms = useMemo(
    () => newMonthYear ? getRoomsAwaitingMeterReading(newMonthYear, ctx) : [],
    [newMonthYear, ctx]
  );

  // ห้องที่ใช้สูตรพิเศษในบิลของเดือนก่อนหน้าเดือนที่กำลังจะสร้าง — ไว้ถามผู้ใช้ว่าจะนำมาใช้ต่อไหม
  const prevMonthBillForNew = useMemo(
    () => newMonthYear ? bills.find((b) => b.monthYear === prevMY(newMonthYear)) : undefined,
    [bills, newMonthYear]
  );
  const prevSpecialFormulaRooms = useMemo(() => {
    if (!prevMonthBillForNew) return [];
    return (prevMonthBillForNew.data ?? [])
      .filter((i) => i.waterFormula || i.electricFormula)
      .map((i) => ({ roomId: i.roomId, roomNumber: i.roomNumber, water: i.waterFormula, electric: i.electricFormula }));
  }, [prevMonthBillForNew]);

  const sortedBills = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    const filtered = q
      ? bills.filter((b) => monthYearLabel(b.monthYear).toLowerCase().includes(q) || b.monthYear.toLowerCase().includes(q))
      : bills;
    return [...filtered].sort((a, b) =>
      groupSort === "desc" ? myScore(b.monthYear) - myScore(a.monthYear) : myScore(a.monthYear) - myScore(b.monthYear)
    );
  }, [bills, groupSearch, groupSort, config.yearFormat]);

  function openCreateModal() {
    setCreateError("");
    setNewMonthYear(meteredMonthYears[0] ?? "");
    setCarryOverFormulas(true);
    setShowCreateModal(true);
  }

  function handleCreateConfirm() {
    const monthYear = newMonthYear;
    if (!monthYear) {
      setCreateError("ยังไม่มีเดือนไหนจดมิเตอร์เลย กรุณาจดมิเตอร์ก่อนสร้างบิล");
      return;
    }
    const existing = bills.find((b) => b.monthYear === monthYear);
    if (existing) {
      openEditor(existing);
      setShowCreateModal(false);
      return;
    }
    if (rooms.length === 0) {
      setCreateError("ไม่พบข้อมูลห้องพัก กรุณาเพิ่มห้องพักก่อนสร้างบิล");
      return;
    }
    const data = generateBillForMonth(monthYear, ctx);
    if (data.length === 0) {
      setCreateError("ไม่พบห้องที่ให้เช่าอยู่ (ห้องทั้งหมดอาจว่างหรือปิดปรับปรุง) กรุณาตรวจสอบสถานะห้องพักก่อนสร้างบิล");
      return;
    }
    // นำสูตรพิเศษของเดือนก่อนหน้ามาใช้ต่อ (ถ้าผู้ใช้เลือกไว้) — generateBillForMonth รีเซ็ต waterFormula/
    // electricFormula เป็นค่าว่างเสมอสำหรับบิลใหม่ ต้อง set กลับแล้วคำนวณราคาใหม่ด้วย recalcItem
    if (carryOverFormulas && prevSpecialFormulaRooms.length > 0) {
      data.forEach((item) => {
        const prev = prevSpecialFormulaRooms.find((r) => String(r.roomId) === String(item.roomId));
        if (!prev) return;
        if (prev.water) item.waterFormula = prev.water;
        if (prev.electric) item.electricFormula = prev.electric;
        recalcItem(item, config, defaults, monthYear);
      });
    }
    setEditingId(null);
    setEditingMonthYear(monthYear);
    setEditingScheduledDate("");
    setBillData(data);
    setDirty(true);
    setView("editor");
    setShowCreateModal(false);
  }

  function openEditor(group: BillGroup) {
    const data = (group.data ?? []).map(normalizeBillItem);
    refreshDerivedFields(data, group.monthYear, ctx);
    setEditingId(group.id);
    setEditingMonthYear(group.monthYear);
    setEditingScheduledDate(group.scheduledDate ?? "");
    setBillData(data);
    setDirty(false);
    setDetailIndex(null);
    setView("editor");
  }

  function backToList() {
    setView("list");
    setDetailIndex(null);
  }

  function backToEditor() {
    setView("editor");
    setDetailIndex(null);
  }

  function openDetail(idx: number) {
    setDetailIndex(idx);
    setView("detail");
  }

  // บิลที่จะพิมพ์อาจมาจากเดือนที่ไม่ได้เปิดแก้ไขอยู่ตอนนี้ (เช่น พิมพ์สรุปจากหน้ารายการหลายเดือนพร้อมกัน) ยอดที่
  // เก็บไว้ใน bills state จึงอาจไม่ทันล่าสุด — โดยเฉพาะส่วนลดพิเศษที่มีวันหมดอายุ (ดู applySpecialDiscounts) หรือ
  // การปัดเศษ ถ้าไม่เคยเปิดบิลเดือนนั้นมาแก้/รีเฟรชอีกเลยตั้งแต่เพิ่ม/แก้ส่วนลดพิเศษ ยอดที่พิมพ์จะยังเป็นยอดเก่า
  // ก่อนมีส่วนลดนั้น (หรือยังมีส่วนลดที่หมดอายุไปแล้วค้างอยู่) — คำนวณใหม่สดๆ ด้วย ctx ปัจจุบันก่อนพิมพ์เสมอ ไม่
  // พึ่งค่าที่แช่แข็งไว้ใน state (clone ก่อน ไม่แก้ item ต้นฉบับใน bills/billData ตรงๆ)
  function openPrintConfig(pool: { item: BillItem; monthYear: string }[], preselect?: Set<string>) {
    const byMonth = new Map<string, BillItem[]>();
    const cloned = pool.map(({ item, monthYear }) => {
      const copy = JSON.parse(JSON.stringify(item)) as BillItem;
      if (!byMonth.has(monthYear)) byMonth.set(monthYear, []);
      byMonth.get(monthYear)!.push(copy);
      return { item: copy, monthYear };
    });
    byMonth.forEach((items, monthYear) => refreshDerivedFields(items, monthYear, ctx));
    setPrintConfigPool(cloned);
    setPrintConfigPreselect(preselect ?? new Set(cloned.map((e) => billEntryKey(e.monthYear, e.item.roomId))));
    setPrintConfigNonce((n) => n + 1);
  }

  function handleBackClick() {
    if (dirty) { pendingLeaveRef.current = backToList; setConfirmBack(true); }
    else backToList();
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (editingId) {
        const updated = await billsApi.update(editingId, billData, editingScheduledDate);
        setBills((prev) => prev.map((b) => (b.id === editingId ? updated : b)));
      } else {
        const created = await billsApi.create(editingMonthYear, billData, editingScheduledDate);
        setBills((prev) => [...prev, created]);
        setEditingId(created.id);
      }
      setDirty(false);
      toastSuccess("บันทึกบิลสำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  // ส่งบิลของห้องเดียวเข้า LINE — ต้องบันทึกบิลก่อน (ฝั่ง backend อ่านข้อมูลห้องจาก DB ตรงๆ เพื่อให้ตรง
  // กับที่ auto-send อัตโนมัติใช้) ถ้ายังมีการแก้ไขที่ไม่ได้บันทึกอยู่ ระบบจะบันทึกให้อัตโนมัติก่อนส่ง
  async function handleSendLineForRoom(idx: number) {
    const room = billData[idx];
    setSendingLineIdx(idx);
    try {
      let billId = editingId;
      if (!billId || dirty) {
        const saved = billId
          ? await billsApi.update(billId, billData, editingScheduledDate)
          : await billsApi.create(editingMonthYear, billData, editingScheduledDate);
        billId = saved.id;
        setBills((prev) => (editingId ? prev.map((b) => (b.id === billId ? saved : b)) : [...prev, saved]));
        if (!editingId) setEditingId(saved.id);
        setDirty(false);
      }
      const result = await billsApi.sendLine(billId!, room.roomId);
      if (result.bill) {
        setBills((prev) => prev.map((b) => (b.id === billId ? result.bill : b)));
        setBillData((result.bill.data ?? []).map(normalizeBillItem));
      }
      if (result.success) toastSuccess(result.message || "ส่งบิลทาง LINE สำเร็จ");
      else toastError(result.message || "ส่งบิลทาง LINE ไม่สำเร็จ");
    } catch (e: any) {
      toastError(e?.response?.data?.error ?? "ส่งบิลทาง LINE ไม่สำเร็จ");
    } finally {
      setSendingLineIdx(null);
    }
  }

  function updateBulkSendItem(roomId: string, patch: Partial<BulkSendItem>) {
    setBulkSendModal((prev) => prev?.map((it) => (it.roomId === roomId ? { ...it, ...patch } : it)) ?? prev);
  }

  // ส่งบิลหลายห้องพร้อมกัน — เปิด popup แสดงสถานะทีละห้อง บันทึกบิลก่อนครั้งเดียว
  // แล้วยิงส่งทีละห้องตามลำดับ (ไม่ยิงพร้อมกันเพื่อกันโดน rate limit ของ LINE)
  async function handleSendLineBulk(roomIds: string[]) {
    if (roomIds.length === 0) return;
    setBulkSendModal(roomIds.map((roomId) => ({
      roomId,
      roomNumber: billData.find((d) => d.roomId === roomId)?.roomNumber ?? roomId,
      status: "pending",
    })));
    setBulkSendingLine(true);
    try {
      let billId = editingId;
      if (!billId || dirty) {
        const saved = billId
          ? await billsApi.update(billId, billData, editingScheduledDate)
          : await billsApi.create(editingMonthYear, billData, editingScheduledDate);
        billId = saved.id;
        setBills((prev) => (editingId ? prev.map((b) => (b.id === billId ? saved : b)) : [...prev, saved]));
        if (!editingId) setEditingId(saved.id);
        setDirty(false);
      }
      for (const roomId of roomIds) {
        updateBulkSendItem(roomId, { status: "sending" });
        try {
          const result = await billsApi.sendLine(billId!, roomId);
          if (result.bill) {
            setBills((prev) => prev.map((b) => (b.id === billId ? result.bill : b)));
            setBillData((result.bill.data ?? []).map(normalizeBillItem));
          }
          updateBulkSendItem(roomId, { status: result.success ? "success" : "error", message: result.message });
        } catch (e: any) {
          updateBulkSendItem(roomId, { status: "error", message: e?.response?.data?.error ?? "ส่งบิลทาง LINE ไม่สำเร็จ" });
        }
      }
    } finally {
      setBulkSendingLine(false);
    }
  }

  async function handleDeleteGroup() {
    if (!confirmDeleteGroup) return;
    setDeletingGroup(true);
    try {
      if (confirmDeleteGroup.id) await billsApi.delete(confirmDeleteGroup.id, deletePaymentHistory);
      setBills((prev) => prev.filter((b) => b.id !== confirmDeleteGroup.id));
      if (deletePaymentHistory) {
        setPayments((prev) => prev.filter((p) => p.billId !== confirmDeleteGroup.id));
      }
      setConfirmDeleteGroup(null);
      setDeletePaymentHistory(false);
      if (editingId === confirmDeleteGroup.id) backToList();
      toastSuccess("ลบบิลสำเร็จ");
    } finally {
      setDeletingGroup(false);
    }
  }

  function updateItem(index: number, updater: (draft: BillItem) => void) {
    setBillData((prev) => {
      const next = [...prev];
      const draft = JSON.parse(JSON.stringify(next[index])) as BillItem;
      updater(draft);
      recalcItem(draft, config, defaults, editingMonthYear);
      next[index] = draft;
      return next;
    });
    setDirty(true);
  }

  // เมื่อจ่ายเงินแล้ว (ต่างจากแก้ไขข้อมูลบิลทั่วไป): บันทึกประวัติการชำระ + สถานะ "จ่ายแล้ว" ทันที
  // ไม่รอให้ผู้ใช้กด "บันทึก" เอง เพราะเป็นข้อมูลการเงินที่ไม่อยากให้ตกหล่นถ้าลืมกดบันทึก
  function openPaymentModal(idx: number) { setPayingIndex(idx); }

  async function handleConfirmPayment(payload: {
    method: "cash" | "scan"; received: number; note: string; paymentDate: string;
    slipImage: { base64: string; name: string } | null;
    fineWaiveAmount: number; discountItems: BillLineItem[]; settleOutstandingMonths: string[];
    settleOutstandingAdjustments: Record<string, OutstandingAdjustment>;
    includeCurrentMonth: boolean;
    sendReceipt: boolean;
  }) {
    if (payingIndex === null) return;
    const target = billData[payingIndex];

    // ปรับค่าปรับ/ส่วนลดตามที่เลือกในป็อปอัพก่อน แล้วคำนวณยอดรวมใหม่ ให้ยอดคงเหลือที่ใช้คิดเงินทอน/ยอดค้าง
    // ตรงกับยอดที่แสดงในป็อปอัพจริง (ใช้ draft.total ที่ปรับแล้วแทน target.total เดิม) — ถ้าปิดสวิตช์
    // "รวมยอดเดือนนี้ด้วย" ไว้ ไม่ต้องปรับอะไรกับเดือนนี้เลย (fineWaiveAmount/discountItems เป็นของเดือนนี้
    // เท่านั้น ตัวป็อปอัพเองก็ซ่อน UI ปรับสองอย่างนี้ไปแล้วเมื่อปิดสวิตช์ ค่าที่ส่งมาจะเป็นค่าว่าง/เดิมอยู่แล้ว)
    const draft = JSON.parse(JSON.stringify(target)) as BillItem;
    if (payload.includeCurrentMonth && payload.fineWaiveAmount > 0) draft.fineWaived = (draft.fineWaived || 0) + payload.fineWaiveAmount;
    if (payload.includeCurrentMonth) draft.discountItems = payload.discountItems;
    recalcItem(draft, config, defaults, editingMonthYear);

    // ยอดค้างของเดือนเก่าที่เลือกปิด (หลังหักค่าปรับ/ส่วนลดที่ปรับไว้แล้ว) — คำนวณด้วยสูตรเดียวกับที่ป็อปอัพ
    // ใช้แสดงผล กันตัวเลขสองที่เพี้ยนไม่ตรงกัน — เก็บเรียงลำดับเดิมของ outstandingItems (เก่าสุดก่อน) ไว้ใช้
    // จัดสรรเงินที่รับจริงด้านล่าง
    // เดือนค้างยกมาที่บิลต้นทางถูก "ปิดยอดไปแล้ว" ก่อนหน้านี้ (ผู้ใช้ไปกดปิดจากหน้าของเดือนนั้นเองโดยตรง ไม่ได้
    // ปิดผ่านป็อปอัพนี้) — snapshot outstandingAmount ที่ฝังอยู่ใน draft.total ยังนับรวมยอดพวกนี้อยู่ ต้องแยกออก
    // ไม่เอาไปปิดซ้ำ แต่ต้องเครดิตกลับเข้า paidAmount ของเดือนนี้ (alreadySettledCredit ด้านล่าง) เท่ากับที่ป็อปอัพ
    // หักออกจากยอดที่ต้องชำระวันนี้ไปแล้ว ไม่งั้นบิลเดือนนี้จะปิดครบไม่ได้ทั้งที่เก็บเงินจริงครบแล้ว
    const reconciledOutstanding = reconcileOutstandingItems(
      bills, target.roomId, target.tenantId, target.tenantName, target.outstandingItems
    );
    const alreadySettledMonths = new Set(reconciledOutstanding.settled.map((o) => o.monthYear));
    const alreadySettledCredit = payload.includeCurrentMonth ? reconciledOutstanding.settledAmount : 0;

    const oldMonthsList = target.outstandingItems
      .filter((o) => payload.settleOutstandingMonths.includes(o.monthYear) && !alreadySettledMonths.has(o.monthYear))
      .map((o) => ({ monthYear: o.monthYear, due: adjustedOutstandingAmount(o, payload.settleOutstandingAdjustments) }));
    const oldMonthsDue = oldMonthsList.reduce((s, o) => s + o.due, 0);
    // ยอดค้างยกมาทั้งหมด (draft.outstandingAmount) ถูกรวมเป็นส่วนหนึ่งของ draft.total อยู่แล้ว (ดู calcItemTotal
    // ใน billCalc.ts) เดือนเก่าที่ "ติ๊กเลือกปิด" (oldMonthsDue) จึงไม่ใช่ยอดเพิ่มนอก draft.total แต่เป็นส่วนหนึ่ง
    // ที่ซ้อนอยู่ในนั้นอยู่แล้ว — ต้องคิดยอดที่ต้องเก็บวันนี้จาก "ค่าใช้จ่ายของเดือนนี้เองล้วนๆ" (ownRemainingDue ไม่รวม
    // ยอดค้างยกมาเลย) บวกเฉพาะเดือนเก่าที่เลือกปิดเท่านั้น ส่วนเดือนที่ไม่เลือก (deferred) จะไม่ถูกเรียกเก็บวันนี้ (บั๊กเดิม:
    // เอา currentRemainingDue ที่มียอดค้างยกมาเต็มจำนวนฝังอยู่แล้ว ไปบวกกับ oldMonthsDue ที่เลือกปิดซ้ำอีกที ทำให้ต้อง
    // จ่ายเกินยอดจริงเกือบเท่าตัวถึงจะปิดบิลเดือนนี้ได้ครบ — เดือนนี้เลยค้างสถานะ "ยังไม่จ่าย" ตลอดแม้จ่ายครบยอดที่แสดงจริง)
    const ownRemainingDue = payload.includeCurrentMonth
      ? Math.max(0, (draft.total - (draft.outstandingAmount || 0)) - (draft.paidAmount || 0))
      : 0;
    const totalDueToday = ownRemainingDue + oldMonthsDue;

    // เงินที่รับมาอาจมากกว่ายอดที่ต้องจ่าย (มีเงินทอน) หรือน้อยกว่า (จ่ายไม่ครบ) — ยอดที่นับเป็น
    // "จ่ายจริง" รวมคือส่วนที่ไม่เกินยอดที่ต้องจ่ายทั้งหมดวันนี้เท่านั้น ส่วนเกินคือเงินทอนคืนลูกค้า ไม่ใช่รายรับ
    // จัดสรรเงินที่รับจริงให้เดือนเก่าที่เลือกปิดก่อน (เก่าสุดก่อน) แล้วเดือนนี้ได้รับส่วนที่เหลือ — กันปิดยอดเดือนเก่า
    // เต็มจำนวน/ตั้งสถานะ "จ่ายแล้ว" ทั้งที่เงินที่รับจริงไม่พอ (บั๊กเดิม: closeOutstandingBills ถูกเรียกปิดยอดเต็ม
    // เสมอไม่สนว่าจ่ายครบไหม ทำให้ตัวเลข "เดือนเก่าที่ปิดในเดือนนี้"/"รับแล้วสุทธิ" บวมเกินเงินที่รับจริง) เดือนที่
    // เงินไม่พอปิดเต็มจะถูกกันไว้เป็นยอดชำระบางส่วน (partial) ไม่ปิดสถานะ ส่วนเดือนที่ไม่มีเงินเหลือถึงเลยจะยังคง
    // ค้างชำระเหมือนเดิมทุกประการ (แม้จะติ๊กเลือกไว้ก็ตาม)
    const amountApplied = Math.min(payload.received, totalDueToday);
    const changeGiven = Math.max(0, payload.received - totalDueToday);

    let remainingForOld = amountApplied;
    const fullyCoveredOldMonths: string[] = [];
    let partialOldMonth: { monthYear: string; amount: number } | null = null;
    for (const o of oldMonthsList) {
      if (remainingForOld <= 0.005) break;
      if (o.due <= 0) { fullyCoveredOldMonths.push(o.monthYear); continue; }
      if (remainingForOld >= o.due - 0.005) {
        fullyCoveredOldMonths.push(o.monthYear);
        remainingForOld -= o.due;
      } else {
        partialOldMonth = { monthYear: o.monthYear, amount: remainingForOld };
        remainingForOld = 0;
      }
    }
    // เงินที่จัดสรรไปปิด/จ่ายบางส่วนของเดือนเก่าที่เลือกไว้ (oldMonthsCollected) เป็น "เงินก้อนเดียวกัน" กับที่จ่ายยอด
    // ค้างยกมาซึ่งฝังอยู่ใน draft.total ของเดือนนี้อยู่แล้ว ต้องเอามารวมเข้า paidAmount ของเดือนนี้ด้วย (เฉพาะตอนที่
    // รวมยอดเดือนนี้ด้วย — ปิดสวิตช์ไว้แปลว่าไม่แตะยอด/สถานะของเดือนนี้เลยตามที่ UI แจ้งไว้) ไม่งั้น draft.total (ที่
    // รวมยอดค้างเต็มจำนวน) จะไม่มีวันถูกจ่ายครบ ทำให้บิลเดือนนี้ค้างสถานะ "ยังไม่จ่าย" ตลอดไปทั้งที่จริงๆ เก็บเงินครบแล้ว
    // (ดูรายการชำระแยกของเดือนเก่าที่ผูกกันผ่าน linkedOldMonthPayments/settledViaMonthYear ด้านล่าง)
    const oldMonthsCollected = amountApplied - remainingForOld;
    const amountForCurrent = payload.includeCurrentMonth ? Math.min(remainingForOld, ownRemainingDue) : 0;
    const paidBeforeSettledCredit = (draft.paidAmount || 0) + amountForCurrent
      + (payload.includeCurrentMonth ? oldMonthsCollected : 0);
    // เครดิตยอดเดือนเก่าที่ปิดไปแล้วเข้า paidAmount ของเดือนนี้ แค่เท่าที่ยังขาดให้ครบ draft.total เท่านั้น
    // (กันบวกเกินยอดถ้าเผลอรันซ้ำบนบิลที่ปิดครบไปแล้ว)
    const settledCreditApplied = Math.max(0, Math.min(alreadySettledCredit, draft.total - paidBeforeSettledCredit));
    const newPaidAmount = paidBeforeSettledCredit + settledCreditApplied;
    const fullySettled = newPaidAmount >= draft.total - 0.005; // เผื่อ floating point

    // ปิดยอดค้างชำระเดือนก่อนที่มีเงินพอปิดเต็มจำนวนจริงเท่านั้น (fullyCoveredOldMonths) — ตั้งสถานะบิลต้นทาง
    // เดือนนั้นเป็น "จ่ายแล้ว" ไปพร้อมกันเลย ไม่งั้นยอดค้างนี้จะถูกคำนวณย้อนกลับมารวมในบิลเดือนถัดๆ ไปอีก ทั้งที่จริง
    // ถูกเก็บไปแล้วในยอดนี้ — สร้างรายการ "ประวัติการชำระ" ของบิลเดือนนั้นเองด้วย (ไม่งั้นเปิดไปดูบิลเดือนเก่าจะไม่เห็นว่า
    // ใครจ่าย/จ่ายเมื่อไหร่ ทั้งที่จริงๆ ปิดยอดไปแล้ว) ทำก่อนสร้างรายการชำระของเดือนนี้ เพื่อเอา id ของแต่ละรายการมาผูก
    // (linkedOldMonthPayments) กับรายการชำระของเดือนนี้ — ยกเลิกรายการของเดือนนี้แล้วจะย้อนยอดที่ปิดไปของเดือนเก่า
    // กลับมาค้างชำระเหมือนเดิมได้ด้วย (ดู handleCancelPayment)
    const linkedOldMonthPayments: { id: string; monthYear: string; amount: number }[] = [];
    if (fullyCoveredOldMonths.length > 0) {
      const closures = closeOutstandingBills(
        bills, target.roomId, target.tenantId, target.tenantName,
        fullyCoveredOldMonths, payload.settleOutstandingAdjustments
      );
      for (const { group, data } of closures) {
        if (!group.id) continue;
        const closedRoom = data.find((r) => r.roomId === target.roomId);
        const outstandingRow = target.outstandingItems.find((o) => o.monthYear === group.monthYear);
        const closedAmount = outstandingRow ? adjustedOutstandingAmount(outstandingRow, payload.settleOutstandingAdjustments) : 0;
        if (closedAmount > 0) {
          const oldPaymentRow = await billsApi.createPayment({
            billId: group.id,
            roomId: target.roomId,
            roomNumber: target.roomNumber,
            tenantId: target.tenantId,
            tenantName: target.tenantName,
            monthYear: group.monthYear,
            method: payload.method,
            amount: closedAmount,
            received: closedAmount,
            change: 0,
            note: `ปิดยอดพร้อมกับชำระเดือน ${monthYearLabel(editingMonthYear)}`,
            paymentDate: payload.paymentDate,
            billTotal: closedRoom?.total ?? closedAmount,
            paidTotal: closedRoom?.paidAmount ?? closedAmount,
            settledViaMonthYear: editingMonthYear,
            sendReceipt: false,
          });
          linkedOldMonthPayments.push({ id: oldPaymentRow.id, monthYear: group.monthYear, amount: closedAmount });
          setPayments((prev) => [...prev, oldPaymentRow]);
        }
        const closedSaved = await billsApi.update(group.id, data, group.scheduledDate ?? "");
        setBills((prev) => prev.map((b) => (b.id === group.id ? closedSaved : b)));
      }
    }

    // เดือนที่เงินไม่พอปิดเต็มจำนวน — บันทึกเป็นยอดชำระบางส่วนของเดือนนั้นแทน (เพิ่ม paidAmount ค้างสถานะเดิมไว้
    // ไม่ยกเว้นค่าปรับ/เพิ่มส่วนลดเพราะยังไม่ปิดยอดจริง) กันเงินที่ยังไม่ได้รับจริงถูกนับเป็นปิดยอดไปด้วย
    if (partialOldMonth) {
      const group = bills.find((b) => b.monthYear === partialOldMonth.monthYear);
      const applied = applyPartialOutstandingPayment(
        bills, target.roomId, target.tenantId, target.tenantName, partialOldMonth.monthYear, partialOldMonth.amount
      );
      if (group?.id && applied) {
        const partialSaved = await billsApi.update(group.id, applied.data, group.scheduledDate ?? "");
        setBills((prev) => prev.map((b) => (b.id === group.id ? partialSaved : b)));
        const partialRow = applied.data.find((r) => r.roomId === target.roomId);
        const oldPaymentRow = await billsApi.createPayment({
          billId: group.id,
          roomId: target.roomId,
          roomNumber: target.roomNumber,
          tenantId: target.tenantId,
          tenantName: target.tenantName,
          monthYear: partialOldMonth.monthYear,
          method: payload.method,
          amount: partialOldMonth.amount,
          received: partialOldMonth.amount,
          change: 0,
          note: `จ่ายบางส่วนของเดือน ${monthYearLabel(partialOldMonth.monthYear)} พร้อมกับชำระเดือน ${monthYearLabel(editingMonthYear)}`,
          paymentDate: payload.paymentDate,
          billTotal: partialRow?.total ?? partialOldMonth.amount,
          paidTotal: partialRow?.paidAmount ?? partialOldMonth.amount,
          settledViaMonthYear: editingMonthYear,
          sendReceipt: false,
        });
        linkedOldMonthPayments.push({ id: oldPaymentRow.id, monthYear: partialOldMonth.monthYear, amount: partialOldMonth.amount });
        setPayments((prev) => [...prev, oldPaymentRow]);
      }
    }

    const paymentRow = await billsApi.createPayment({
      billId: editingId ?? "",
      roomId: target.roomId,
      roomNumber: target.roomNumber,
      tenantId: target.tenantId,
      tenantName: target.tenantName,
      monthYear: editingMonthYear,
      method: payload.method,
      amount: amountForCurrent,
      received: payload.received,
      change: changeGiven,
      note: payload.note,
      paymentDate: payload.paymentDate,
      slipImage: payload.slipImage,
      billTotal: draft.total,
      paidTotal: newPaidAmount,
      linkedOldMonthPayments,
      // รวมยอดเดือนเก่าที่ปิดพร้อมกันในรายการนี้ + ยอดเดือนเก่าที่ปิดไปก่อนแล้วแต่เพิ่งถูกเครดิตเข้าเดือนนี้
      // (alreadySettledCredit) — ตอนยกเลิกรายการนี้ต้องย้อน paidAmount ของเดือนนี้ออกให้ครบทั้งก้อน
      linkedOldMonthsCreditedAmount: payload.includeCurrentMonth ? oldMonthsCollected + settledCreditApplied : 0,
      sendReceipt: payload.sendReceipt,
    });
    setPayments((prev) => [...prev, paymentRow]);

    draft.paidAmount = newPaidAmount;
    draft.status = fullySettled ? "paid" : "unpaid";
    recalcItem(draft, config, defaults, editingMonthYear);
    const nextBillData = billData.map((it, i) => (i === payingIndex ? draft : it));

    const saved = editingId
      ? await billsApi.update(editingId, nextBillData, editingScheduledDate)
      : await billsApi.create(editingMonthYear, nextBillData, editingScheduledDate);
    setBillData(nextBillData);
    if (!editingId) setEditingId(saved.id);
    setBills((prev) => (editingId ? prev.map((b) => (b.id === editingId ? saved : b)) : [...prev, saved]));

    setDirty(false);
    setPayingIndex(null);
  }

  // ยกเลิกยอดชำระที่บันทึกไปแล้ว — ย้อนยอดที่จ่ายรายการนั้นออกจาก paidAmount ของบิล แล้วปรับสถานะกลับ
  // เป็นค้างชำระถ้ายอดสะสมหลังหักไม่ครบยอดเต็มอีกต่อไป จากนั้นบันทึกรายการเป็น "ยกเลิกแล้ว" พร้อมหมายเหตุ
  // (soft-cancel — ไม่ลบทิ้งจริง เพื่อให้ยังเห็นในประวัติเป็นหลักฐานได้)
  async function handleCancelPayment(payment: any, reason: string) {
    if (payment?.data?.cancelled) return; // กันยกเลิกซ้ำ

    // ย้อน paidAmount ของบิลห้อง/เดือนหนึ่งลงตามจำนวนที่ยกเลิก แล้วบันทึก — เดือนที่กำลังเปิดดูอยู่แก้ผ่าน
    // billData/setBillData ให้เห็นผลทันทีไม่ต้องปิดเปิดหน้าใหม่ ส่วนเดือนอื่น (เช่นเดือนเก่าที่เคยถูกปิดยอดไปพร้อม
    // กับรายการนี้ — ดู linkedOldMonthPayments ด้านล่าง) แก้ผ่าน bills state ตรงๆ ไม่ผ่าน recalcItem เพราะเป็นบิล
    // ที่ปิดไปแล้ว ต้องคงค่าปรับ/ส่วนลด/สูตรเดิมไว้ ไม่คำนวณใหม่ด้วยบริบท (config/เดือน) ปัจจุบัน
    async function revertBillAmount(targetMonthYear: string, roomId: string, amount: number) {
      if (!roomId || amount <= 0) return;
      if (targetMonthYear === editingMonthYear) {
        const idx = billData.findIndex((it) => it.roomId === roomId);
        if (idx === -1) return;
        const draft = JSON.parse(JSON.stringify(billData[idx])) as BillItem;
        draft.paidAmount = Math.max(0, (draft.paidAmount || 0) - amount);
        draft.status = draft.paidAmount >= draft.total - 0.005 ? "paid" : "unpaid";
        // ยกเลิกยอดชำระแล้ว = ยกเลิกการลดหย่อนค่าปรับที่เคยให้ไว้ตอนบันทึกการชำระครั้งนั้นด้วย (ดู
        // fineWaiveAmount ใน handleConfirmPayment ด้านบน ที่บวกเข้า fineWaived ไว้) ไม่งั้นค่าปรับจะค้าง
        // ถูกหัก/เป็น 0 อยู่ต่อไปทั้งที่การชำระที่แลกมาด้วยการลดค่าปรับนั้นถูกยกเลิกไปแล้ว — เคลียร์กลับเป็น 0
        // ให้ recalcItem คิดค่าปรับตามปกติ (อัตโนมัติเต็มจำนวน) ใหม่ทั้งหมด
        draft.fineWaived = 0;
        recalcItem(draft, config, defaults, editingMonthYear);
        const nextBillData = billData.map((it, i) => (i === idx ? draft : it));
        const saved = editingId
          ? await billsApi.update(editingId, nextBillData, editingScheduledDate)
          : await billsApi.create(editingMonthYear, nextBillData, editingScheduledDate);
        setBillData(nextBillData);
        if (!editingId) setEditingId(saved.id);
        setBills((prev) => (editingId ? prev.map((b) => (b.id === editingId ? saved : b)) : [...prev, saved]));
        setDirty(false);
      } else {
        const group = bills.find((b) => b.monthYear === targetMonthYear);
        if (!group || !group.id) return;
        const data = (group.data ?? []).map(normalizeBillItem);
        const idx = data.findIndex((r) => r.roomId === roomId);
        if (idx === -1) return;
        const draft = JSON.parse(JSON.stringify(data[idx])) as BillItem;
        draft.paidAmount = Math.max(0, (draft.paidAmount || 0) - amount);
        draft.status = draft.paidAmount >= draft.total - 0.005 ? "paid" : "unpaid";
        const nextData = data.map((r, i) => (i === idx ? draft : r));
        const closedSaved = await billsApi.update(group.id, nextData, group.scheduledDate ?? "");
        setBills((prev) => prev.map((b) => (b.id === group.id ? closedSaved : b)));
      }
    }

    const roomId = payment?.data?.roomId;
    const monthYear = payment?.data?.monthYear;
    // paidAmount ของเดือนนี้ที่เพิ่มไปตอนบันทึก ไม่ได้มีแค่ payment.data.amount (ส่วนของเดือนนี้เองล้วนๆ) แต่รวม
    // linkedOldMonthsCreditedAmount ที่จ่ายยอดค้างยกมาของเดือนเก่าไปด้วยพร้อมกัน (ดู handleConfirmPayment) ต้อง
    // บวกกลับเข้าไปตอนย้อนยอดของเดือนนี้ด้วย ไม่งั้น paidAmount จะค้างเกินจริงอยู่ถาวรหลังยกเลิก (ยกเลิกไม่ครบ)
    const applied = (Number(payment?.data?.amount) || 0) + (Number(payment?.data?.linkedOldMonthsCreditedAmount) || 0);
    await revertBillAmount(monthYear, roomId, applied);

    // รายการนี้เคยปิดยอดค้างของเดือนอื่นไปพร้อมกันตอนบันทึกด้วยไหม (linkedOldMonthPayments — ดู
    // handleConfirmPayment) ถ้ามี ต้องย้อนยอดของเดือนเหล่านั้นกลับมาค้างชำระเหมือนเดิม พร้อมยกเลิกรายการชำระ
    // ของเดือนนั้นๆ ไปด้วย ไม่งั้นเดือนเก่าจะค้างเป็น "จ่ายแล้ว" ตลอดไปทั้งที่เงินก้อนที่จ่ายจริงถูกยกเลิกไปแล้ว
    const linked: { id: string; monthYear: string; amount: number }[] = Array.isArray(payment?.data?.linkedOldMonthPayments)
      ? payment.data.linkedOldMonthPayments
      : [];
    for (const l of linked) {
      await revertBillAmount(l.monthYear, roomId, l.amount);
      if (l.id) {
        const updated = await billsApi.cancelPayment(l.id, reason || `ยกเลิกอัตโนมัติตามรายการชำระของ${monthYearLabel(monthYear)}`);
        setPayments((prev) => prev.map((p) => (p.id === l.id ? updated : p)));
      }
    }

    const updated = await billsApi.cancelPayment(payment.id, reason);
    setPayments((prev) => prev.map((p) => (p.id === payment.id ? updated : p)));
  }

  const filteredData = useMemo(() => {
    const q = search.trim().toLowerCase();
    return billData
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => {
        if (statusFilter === "overdue" && !(item.status !== "paid" && item.isOverdue)) return false;
        if (statusFilter === "paid" && item.status !== "paid") return false;
        if (statusFilter === "unpaid" && item.status !== "unpaid") return false;
        if (!q) return true;
        return item.roomNumber.toLowerCase().includes(q) || item.tenantName.toLowerCase().includes(q);
      });
  }, [billData, search, statusFilter]);

  const stats = useMemo(
    () => computeBillStats(billData, payments, editingMonthYear),
    [billData, payments, editingMonthYear]
  );

  return (
    <>
      {view === "list" ? (
        <div className="custom-card no-print">
          <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-3 page-list-toolbar">
            <h5 className="form-section-title mb-0" style={{ borderBottom: "none" }}>บิล/แจ้งหนี้</h5>
            <ToolbarActionsMenu>
              <button className="btn btn-primary d-inline-flex align-items-center" onClick={openCreateModal}>
                <i className="fas fa-plus me-2" />สร้างบิลใหม่
              </button>
            </ToolbarActionsMenu>
          </div>

          <div className="row g-2 mb-3 align-items-center">
            <div className="col-12 col-lg">
              <div className="search-container">
                <i className="fas fa-search" />
                <input type="text" className="form-control" style={{ paddingLeft: 40 }} placeholder="ค้นหาด้วยเดือน, ปี..."
                  value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)} />
              </div>
            </div>
            <div className="col-12 col-md-auto" style={{ minWidth: 200 }}>
              <CustomSelect2 value={GROUP_SORT_OPTIONS.find((o) => o.value === groupSort)} options={GROUP_SORT_OPTIONS}
                onChange={(o: any) => setGroupSort(o?.value ?? "desc")} isSearchable={false} />
            </div>
            <div className="col-12 col-md-auto">
              <div className="btn-group view-switch-group" role="group">
                {(["list", "grid", "table"] as const).map((v) => (
                  <button key={v} type="button" className={`btn btn-outline-secondary view-switcher${groupViewMode === v ? " active" : ""}`}
                    onClick={() => setGroupViewMode(v)} title={v === "table" ? "ตาราง" : v === "list" ? "รายการ" : "การ์ด"}>
                    <i className={`fas fa-${v === "table" ? "table" : v === "list" ? "list" : "th-large"}`} />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="text-center p-5"><div className="spinner-border" style={{ color: "var(--color-primary)" }} /></div>
          ) : groupViewMode === "table" ? (
            <BillGroupTableView
              data={sortedBills}
              onEdit={openEditor}
              onPrint={(g) => openPrintConfig(g.data.map((item) => ({ item, monthYear: g.monthYear })))}
              onDelete={(g) => setConfirmDeleteGroup(g)}
              onBulkPrint={(groups) => openPrintConfig(groups.flatMap((g) => g.data.map((item) => ({ item, monthYear: g.monthYear }))))}
              onPrintDashboard={printDashboardForGroup}
            />
          ) : groupViewMode === "grid" ? (
            sortedBills.length === 0 ? (
              <EmptyState icon="fa-file-invoice" text="ไม่พบข้อมูล" />
            ) : (
            <div className="room-grid">
              {sortedBills.map((b) => {
                const paidCount = b.data.filter((i) => i.status === "paid").length;
                const total = b.data.reduce((s, i) => s + (Number(i.total) || 0), 0);
                return (
                  <div key={b.id} className="room-card" style={{ cursor: "pointer" }} onClick={() => openEditor(b)}>
                    <div className="room-card-header">
                      <h5>{monthYearLabel(b.monthYear)}</h5>
                      <span className="status-badge status-paid">{paidCount}/{b.data.length} จ่ายแล้ว</span>
                    </div>
                    <div className="room-card-body">
                      <div className="room-card-info-grid">
                        <div className="room-card-info-item"><span className="label">ห้องทั้งหมด</span><span className="value">{b.data.length}</span></div>
                        <div className="room-card-info-item"><span className="label">วันนัดชำระ</span><span className="value">{scheduledDateSafe(b.scheduledDate)}</span></div>
                        <div className="room-card-info-item" style={{ gridColumn: "span 2" }}>
                          <span className="label">ยอดรวม</span>
                          <span className="value" style={{ color: "var(--color-primary)", fontWeight: 700 }}>{money(total)} ฿</span>
                        </div>
                      </div>
                      <div className="room-card-tenant-info d-flex justify-content-between align-items-center">
                        <small className="text-muted">อัปเดต {formatDateSafe(b.updatedAt)}</small>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            )
          ) : (
            <div>
              {sortedBills.length === 0 ? (
                <EmptyState icon="fa-file-invoice" text="ไม่พบข้อมูล" />
              ) : sortedBills.map((b) => {
                const paidCount = b.data.filter((i) => i.status === "paid").length;
                const total = b.data.reduce((s, i) => s + (Number(i.total) || 0), 0);
                return (
                  <div key={b.id} className="d-flex align-items-center gap-3 p-3"
                    style={{ borderBottom: "1px solid var(--color-light)", cursor: "pointer" }} onClick={() => openEditor(b)}>
                    <div style={{ width: 60, height: 60, background: "var(--color-primary)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: "0.85rem", flexShrink: 0, textAlign: "center" }}>
                      {b.monthYear}
                    </div>
                    <div className="flex-grow-1">
                      <div className="d-flex align-items-center gap-2">
                        <strong>{monthYearLabel(b.monthYear)}</strong>
                        <span className="status-badge status-paid">{paidCount}/{b.data.length} จ่ายแล้ว</span>
                      </div>
                      <small className="text-muted">วันนัดชำระ: {scheduledDateSafe(b.scheduledDate)} • อัปเดต {formatDateSafe(b.updatedAt)}</small>
                    </div>
                    <div className="text-end">
                      <div style={{ fontWeight: 600, color: "var(--color-primary)" }}>{money(total)} ฿</div>
                    </div>
                    <i className="fas fa-chevron-right text-muted" />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : view === "editor" ? (
        <div className="custom-card no-print">
          <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-3 pb-2 border-bottom">
            <div className="d-flex align-items-center gap-2">
              <button className="btn btn-outline-secondary btn-sm" onClick={handleBackClick} title="กลับไปหน้ารายการ">
                <i className="fas fa-arrow-left" />
              </button>
              <h5 className="form-section-title mb-0 border-0" style={{ padding: 0 }}>
                <i className="fas fa-file-invoice-dollar me-2 text-primary" />บิลเดือน {monthYearLabel(editingMonthYear)}
              </h5>
            </div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <div className="d-flex align-items-center gap-1">
                <label className="small text-muted mb-0">วันนัดชำระ</label>
                <div style={{ width: 200 }}>
                  <ThaiDatePicker
                    value={editingScheduledDate}
                    onChange={(v) => { setEditingScheduledDate(v); setDirty(true); }}
                  />
                </div>
              </div>
              <button className="btn btn-outline-primary btn-sm" onClick={() => setShowSpecialDiscounts(true)}>
                <i className="fas fa-percent me-1" />ส่วนลดพิเศษ
              </button>
              <button className="btn btn-outline-secondary btn-sm" onClick={printDashboardForCurrentMonth}>
                <i className="fas fa-print me-1" />พิมพ์สรุป Dashboard
              </button>
              {editingId && (
                <button className="btn btn-outline-danger btn-sm" onClick={() => setConfirmDeleteGroup({ id: editingId, monthYear: editingMonthYear, data: billData })}>
                  <i className="fas fa-trash-alt me-1" />ลบบิลเดือนนี้
                </button>
              )}
              <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                {saving ? <><span className="spinner-border spinner-border-sm me-2" />กำลังบันทึก...</> : <><i className="fas fa-save me-1" />บันทึก</>}
              </button>
            </div>
          </div>

          <div className="row g-2 mb-2">
            <div className="col-6 col-md-3"><div className="bill-stat-tile"><div className="val text-secondary">{stats.totalRooms}</div><div className="lbl">ห้องทั้งหมด</div></div></div>
            <div className="col-6 col-md-3"><div className="bill-stat-tile"><div className="val" style={{ color: "var(--color-success)" }}>{stats.paid}</div><div className="lbl">จ่ายแล้ว</div></div></div>
            <div className="col-6 col-md-3"><div className="bill-stat-tile"><div className="val" style={{ color: "#fd7e14" }}>{stats.unpaid}</div><div className="lbl">รอชำระ</div></div></div>
            <div className="col-6 col-md-3"><div className="bill-stat-tile"><div className="val text-danger">{stats.overdue}</div><div className="lbl">เกินกำหนด</div></div></div>
          </div>

          <div className="row g-2 mb-2">
            <div className="col-6 col-md-4">
              <div className="bill-stat-tile bill-stat-tile-icon">
                <div className="bill-stat-icon" style={{ background: "rgba(108,155,207,0.14)", color: "var(--color-primary)" }}><i className="fas fa-home" /></div>
                <div className="bill-stat-body"><div className="val text-primary">{money(stats.totalRent)}</div><div className="lbl">ค่าเช่า</div></div>
              </div>
            </div>
            <div className="col-6 col-md-4">
              <div className="bill-stat-tile bill-stat-tile-icon">
                <div className="bill-stat-icon" style={{ background: "rgba(13,202,240,0.14)", color: "#0dcaf0" }}><i className="fas fa-tint" /></div>
                <div className="bill-stat-body"><div className="val" style={{ color: "#0dcaf0" }}>{money(stats.totalWater)}</div><div className="lbl">ค่าน้ำ ({stats.waterUnits.toLocaleString()} น.)</div></div>
              </div>
            </div>
            <div className="col-6 col-md-4">
              <div className="bill-stat-tile bill-stat-tile-icon">
                <div className="bill-stat-icon" style={{ background: "rgba(253,126,20,0.14)", color: "#fd7e14" }}><i className="fas fa-bolt" /></div>
                <div className="bill-stat-body"><div className="val" style={{ color: "#fd7e14" }}>{money(stats.totalElectric)}</div><div className="lbl">ค่าไฟ ({stats.electricUnits.toLocaleString()} น.)</div></div>
              </div>
            </div>
            <div className="col-6 col-md-4">
              <div className="bill-stat-tile bill-stat-tile-icon">
                <div className="bill-stat-icon" style={{ background: "rgba(111,66,193,0.14)", color: "var(--color-import)" }}><i className="fas fa-receipt" /></div>
                <div className="bill-stat-body"><div className="val" style={{ color: "var(--color-import)" }}>{money(stats.totalOther)}</div><div className="lbl">อื่นๆ</div></div>
              </div>
            </div>
            <div className="col-6 col-md-4">
              <div className="bill-stat-tile bill-stat-tile-icon">
                <div className="bill-stat-icon" style={{ background: "rgba(220,53,69,0.14)", color: "#dc3545" }}><i className="fas fa-exclamation-circle" /></div>
                <div className="bill-stat-body"><div className="val" style={{ color: "#dc3545" }}>{money(stats.totalFine)}</div><div className="lbl">ค่าปรับ</div></div>
              </div>
            </div>
            <div className="col-6 col-md-4">
              <div className="bill-stat-tile bill-stat-tile-icon">
                <div className="bill-stat-icon" style={{ background: "rgba(232,62,140,0.14)", color: "#e83e8c" }}><i className="fas fa-history" /></div>
                <div className="bill-stat-body"><div className="val" style={{ color: "#e83e8c" }}>{money(stats.totalOutstandingCarried)}</div><div className="lbl">ค้างชำระยกมา</div></div>
              </div>
            </div>
          </div>

          {stats.totalExpected > 0 && (
            <div className="mb-3">
              <div className="bill-breakdown-bar">
                <div style={{ width: `${(stats.totalRent / stats.totalExpected) * 100}%`, background: "var(--color-primary)" }} title={`ค่าเช่า ${money(stats.totalRent)} ฿`} />
                <div style={{ width: `${(stats.totalWater / stats.totalExpected) * 100}%`, background: "#0dcaf0" }} title={`ค่าน้ำ ${money(stats.totalWater)} ฿`} />
                <div style={{ width: `${(stats.totalElectric / stats.totalExpected) * 100}%`, background: "#fd7e14" }} title={`ค่าไฟ ${money(stats.totalElectric)} ฿`} />
                <div style={{ width: `${(Math.max(stats.totalOther, 0) / stats.totalExpected) * 100}%`, background: "var(--color-import)" }} title={`อื่นๆ ${money(stats.totalOther)} ฿`} />
                <div style={{ width: `${(stats.totalFine / stats.totalExpected) * 100}%`, background: "#dc3545" }} title={`ค่าปรับ ${money(stats.totalFine)} ฿`} />
                <div style={{ width: `${(stats.totalOutstandingCarried / stats.totalExpected) * 100}%`, background: "#e83e8c" }} title={`ค้างชำระยกมา ${money(stats.totalOutstandingCarried)} ฿`} />
              </div>
              <div className="bill-breakdown-legend mt-2">
                <span><i style={{ background: "var(--color-primary)" }} />ค่าเช่า</span>
                <span><i style={{ background: "#0dcaf0" }} />ค่าน้ำ</span>
                <span><i style={{ background: "#fd7e14" }} />ค่าไฟ</span>
                <span><i style={{ background: "var(--color-import)" }} />อื่นๆ</span>
                <span><i style={{ background: "#dc3545" }} />ค่าปรับ</span>
                <span><i style={{ background: "#e83e8c" }} />ค้างชำระยกมา</span>
              </div>
            </div>
          )}

          <div className="row g-2 mb-2">
            <div className="col-6 col-md-4">
              <div className="bill-stat-tile">
                <div className="val" style={{ color: "var(--color-dark-variant)" }}><i className="fas fa-lock me-1" style={{ fontSize: 12 }} />{money(stats.totalFixed)}</div>
                <div className="lbl">ยอดเรียกเก็บทั้งหมด (คงที่)</div>
              </div>
            </div>
            <div className="col-6 col-md-4"><div className="bill-stat-tile"><div className="val text-primary">{money(stats.totalExpected)}</div><div className="lbl">คาดการณ์รายรับ</div></div></div>
            <div className="col-6 col-md-4"><div className="bill-stat-tile"><div className="val text-danger">{money(stats.totalMissing)}</div><div className="lbl">ขาดอีก</div></div></div>
          </div>
          <div className="bill-progress mb-2">
            <div className="bill-progress-bar" style={{ width: `${Math.min(stats.collectRate, 100)}%` }} />
          </div>

          <div className="bill-received-panel mb-3">
            <div className="bill-received-panel-title"><i className="fas fa-hand-holding-usd me-2" />เงินที่ได้รับแล้ว</div>
            <div className="bill-received-panel-grid">
              <div className="bill-received-item">
                <div className="val text-success">{money(stats.receivedThisMonth)}</div>
                <div className="lbl">รับแล้วเดือน ({stats.collectRate.toFixed(0)}%)</div>
              </div>
              <div className="bill-received-item">
                <div className="val" style={{ color: "#20c997" }}>{money(stats.receivedOldMonthsClosedThisMonth)}</div>
                <div className="lbl">เดือนเก่าที่ปิดในเดือนนี้</div>
              </div>
              <div className="bill-received-item bill-received-item-net">
                <div className="val fw-bold" style={{ color: "#198754" }}>{money(stats.netReceived)}</div>
                <div className="lbl">ยอดรับแล้วสุทธิ</div>
              </div>
            </div>
          </div>

          <div className="row g-2 mb-3 align-items-center">
            <div className="col-12 col-lg">
              <div className="search-container">
                <i className="fas fa-search" />
                <input type="text" className="form-control" style={{ paddingLeft: 40 }} placeholder="ค้นหาเลขห้อง, ผู้เช่า..."
                  value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            <div className="col-12 col-md-auto" style={{ minWidth: 200 }}>
              <CustomSelect2 value={STATUS_OPTIONS.find((o) => o.value === statusFilter)} options={STATUS_OPTIONS}
                onChange={(o: any) => setStatusFilter(o?.value ?? "all")} isSearchable={false} />
            </div>
            <div className="col-12 col-md-auto">
              <div className="btn-group view-switch-group" role="group">
                {(["list", "grid", "table"] as const).map((v) => (
                  <button key={v} type="button" className={`btn btn-outline-secondary view-switcher${roomViewMode === v ? " active" : ""}`}
                    onClick={() => setRoomViewMode(v)} title={v === "table" ? "ตาราง" : v === "list" ? "รายการ" : "การ์ด"}>
                    <i className={`fas fa-${v === "table" ? "table" : v === "list" ? "list" : "th-large"}`} />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {roomViewMode === "table" ? (
            <BillTableView
              data={filteredData}
              isFiltered={!!search.trim() || statusFilter !== "all"}
              payments={payments}
              monthYear={editingMonthYear}
              allBills={bills}
              onEdit={openDetail}
              onPrint={(item) => openPrintConfig(
                billData.map((it) => ({ item: it, monthYear: editingMonthYear })),
                new Set([billEntryKey(editingMonthYear, item.roomId)]),
              )}
              onToggleStatus={(idx) => billData[idx].status === "paid"
                ? updateItem(idx, (d) => { d.status = "unpaid"; })
                : openPaymentModal(idx)}
              onOpenPayment={openPaymentModal}
              onBulkPrint={(items) => openPrintConfig(
                billData.map((it) => ({ item: it, monthYear: editingMonthYear })),
                new Set(items.map((it) => billEntryKey(editingMonthYear, it.roomId))),
              )}
              lineEnabled={config.lineMessaging.enabled}
              onSendLine={setConfirmSendIdx}
              sendingLineIdx={sendingLineIdx}
              onSendLineBulk={setConfirmSendBulkIds}
              bulkSendingLine={bulkSendingLine}
            />
          ) : roomViewMode === "grid" ? (
            filteredData.length === 0 ? (
              <div className="nicescrollbar" style={{ maxHeight: 600, overflow: "auto" }}>
                <EmptyState icon="fa-file-invoice" text="ไม่พบข้อมูล" />
              </div>
            ) : (
            <div className="room-grid nicescrollbar" style={{ maxHeight: 600, overflow: "auto" }}>
              {filteredData.map(({ item, idx }) => (
                <div key={item.roomId} className="room-card" style={{ cursor: "pointer" }} onClick={() => openDetail(idx)}>
                  <div className="room-card-header">
                    <h5>ห้อง {item.roomNumber}</h5>
                    <div className="d-flex align-items-center gap-2">
                      {getLatestSlipUrl(payments, item.roomId, editingMonthYear) && (
                        <button type="button" className="btn btn-sm btn-outline-primary" title="ดูสลิป"
                          onClick={(e) => { e.stopPropagation(); setRoomSlipLightbox(getLatestSlipUrl(payments, item.roomId, editingMonthYear)); }}>
                          <i className="fas fa-receipt" />
                        </button>
                      )}
                      <BillStatusBadge item={item} />
                    </div>
                  </div>
                  <div className="room-card-body">
                    <div className="room-card-info-grid">
                      <div className="room-card-info-item"><span className="label">ค่าห้อง</span><span className="value">{money(item.priceRoom)} ฿</span></div>
                      <div className="room-card-info-item"><span className="label">ค่าน้ำ</span><span className="value">{money(item.priceWater)} ฿ ({item.meterWater.unit} น.)</span></div>
                      <div className="room-card-info-item"><span className="label">ค่าไฟ</span><span className="value">{money(item.priceElectric)} ฿ ({item.meterElectric.unit} น.)</span></div>
                      <div className="room-card-info-item"><span className="label">อื่นๆ</span><span className="value">{money(otherChargesTotal(item))} ฿</span></div>
                    </div>
                    <div className="room-card-tenant-info">
                      <p><i className="fas fa-user" />{item.tenantName || "ว่าง"}</p>
                      <p style={{ marginTop: "0.3rem", fontWeight: 700, color: "var(--color-primary)" }}>
                        <i className="fas fa-coins" />รวมสุทธิ {money(item.total)} ฿
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            )
          ) : (
            <div className="nicescrollbar" style={{ maxHeight: 600, overflow: "auto" }}>
              {filteredData.length === 0 ? (
                <EmptyState icon="fa-file-invoice" text="ไม่พบข้อมูล" />
              ) : filteredData.map(({ item, idx }) => (
                <div key={item.roomId} className="d-flex align-items-center gap-3 p-3"
                  style={{ borderBottom: "1px solid var(--color-light)", cursor: "pointer" }} onClick={() => openDetail(idx)}>
                  <div style={{ width: 50, height: 50, background: "var(--color-primary)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: "0.85rem", flexShrink: 0 }}>
                    {item.roomNumber}
                  </div>
                  <div className="flex-grow-1">
                    <div className="d-flex align-items-center gap-2">
                      <strong>ห้อง {item.roomNumber}</strong>
                      <BillStatusBadge item={item} />
                    </div>
                    <small className="text-muted">{item.tenantName || "ว่าง"} • น้ำ {item.meterWater.unit} น. • ไฟ {item.meterElectric.unit} น.</small>
                  </div>
                  <div className="text-end">
                    <div style={{ fontWeight: 600, color: "var(--color-primary)" }}>{money(item.total)} ฿</div>
                    {item.outstandingAmount > 0 && item.status !== "paid" && <small className="text-danger">ค้าง {money(item.outstandingAmount)} ฿</small>}
                  </div>
                  {getLatestSlipUrl(payments, item.roomId, editingMonthYear) && (
                    <button type="button" className="btn btn-sm btn-outline-primary" title="ดูสลิป"
                      onClick={(e) => { e.stopPropagation(); setRoomSlipLightbox(getLatestSlipUrl(payments, item.roomId, editingMonthYear)); }}>
                      <i className="fas fa-receipt" />
                    </button>
                  )}
                  {config.lineMessaging.enabled && (
                    <button type="button" className="btn btn-sm btn-outline-success" disabled={sendingLineIdx === idx}
                      title={item.sendLogs?.[0] ? sendLogSummary(item.sendLogs[0]) : "ส่งบิลทาง LINE"}
                      onClick={(e) => { e.stopPropagation(); setConfirmSendIdx(idx); }}>
                      {sendingLineIdx === idx ? <span className="spinner-border spinner-border-sm" /> : <i className="fab fa-line" />}
                    </button>
                  )}
                  <i className="fas fa-chevron-right text-muted" />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : detailIndex !== null && billData[detailIndex] ? (
        <BillDetailPage
          key={billData[detailIndex].customBillId}
          item={billData[detailIndex]}
          items={billData}
          currentIndex={detailIndex}
          monthYear={editingMonthYear}
          config={config}
          paymentHistory={getPaymentHistory(payments, billData[detailIndex].roomId, editingMonthYear)}
          onUpdate={(updater) => updateItem(detailIndex, updater)}
          onSync={() => updateItem(detailIndex, (d) => { syncTenantForItem(d, ctx, editingMonthYear); })}
          onNavigate={(idx) => setDetailIndex(idx)}
          onBack={backToEditor}
          onPrint={() => openPrintConfig(
            billData.map((it) => ({ item: it, monthYear: editingMonthYear })),
            new Set([billEntryKey(editingMonthYear, billData[detailIndex].roomId)]),
          )}
          onTogglePaid={() => billData[detailIndex].status === "paid"
            ? updateItem(detailIndex, (d) => { d.status = "unpaid"; })
            : openPaymentModal(detailIndex)}
          onCancelPayment={handleCancelPayment}
          onSendLine={() => setConfirmSendIdx(detailIndex)}
          sendingLine={sendingLineIdx === detailIndex}
        />
      ) : null}

      {showCreateModal && (
        <div className="confirm-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="confirm-dialog" style={{ maxWidth: 420, textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
            <div className="d-flex align-items-center gap-2 mb-3">
              <i className="fas fa-file-invoice-dollar text-primary" style={{ fontSize: "1.4rem" }} />
              <h6 className="confirm-title mb-0" style={{ textAlign: "left" }}>สร้างบิลใหม่</h6>
            </div>
            {MONTHYEAR_OPTIONS.length === 0 ? (
              <div className="alert alert-warning small mb-0">
                <i className="fas fa-exclamation-triangle me-1" />ยังไม่มีเดือนไหนจดมิเตอร์เลย กรุณาไปจดมิเตอร์ก่อนถึงจะสร้างบิลได้
              </div>
            ) : (
              <>
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label small">เดือน (แสดงเฉพาะเดือนที่จดมิเตอร์แล้ว)</label>
                    <CustomSelect2 value={MONTHYEAR_OPTIONS.find((o) => o.value === newMonthYear)} options={MONTHYEAR_OPTIONS}
                      onChange={(o: any) => setNewMonthYear(o?.value ?? newMonthYear)} isSearchable={false} />
                  </div>
                </div>
                {bills.some((b) => b.monthYear === newMonthYear) ? (
                  <div className="alert alert-warning small mt-3 mb-0">
                    <i className="fas fa-info-circle me-1" />มีบิลของเดือนนี้อยู่แล้ว ระบบจะเปิดให้แก้ไขบิลเดิมแทน
                  </div>
                ) : (
                  <>
                    {awaitingMeterRooms.length > 0 && (
                      <div className="alert alert-warning small mt-3 mb-0">
                        <i className="fas fa-exclamation-triangle me-1" />
                        พบ {awaitingMeterRooms.length} ห้องที่ยังไม่ได้จดมิเตอร์ของเดือนนี้ ระบบจะ<strong>ยังสร้างบิลให้</strong>แต่ค่าน้ำ/ไฟจะเป็น 0 ไปก่อนจนกว่าจะจดมิเตอร์แล้วมาแก้ไขบิล:
                        <div className="mt-1" style={{ opacity: 0.85 }}>
                          {awaitingMeterRooms.map((r: any) => r.number).join(", ")}
                        </div>
                      </div>
                    )}
                    {prevSpecialFormulaRooms.length > 0 && (
                      <div className="mt-3 p-2 rounded" style={{ background: "var(--color-light)" }}>
                        <div className="form-check form-switch mb-2">
                          <input className="form-check-input" type="checkbox" id="carryOverFormulaChk"
                            checked={carryOverFormulas} onChange={(e) => setCarryOverFormulas(e.target.checked)} />
                          <label className="form-check-label small" htmlFor="carryOverFormulaChk">
                            นำสูตรคำนวณพิเศษของเดือน {monthYearLabel(prevMY(newMonthYear))} มาใช้ต่อ
                          </label>
                        </div>
                        <div className="small" style={{ opacity: 0.85 }}>
                          พบ {prevSpecialFormulaRooms.length} ห้องที่ใช้สูตรพิเศษ:
                          <div className="d-flex flex-wrap gap-1 mt-1">
                            {prevSpecialFormulaRooms.map((r) => (
                              <span key={r.roomId} className="badge" style={{ background: "var(--color-primary)" }}>
                                ห้อง {r.roomNumber}
                                {r.water && <i className="fas fa-tint ms-1" title="สูตรพิเศษค่าน้ำ" />}
                                {r.electric && <i className="fas fa-bolt ms-1" title="สูตรพิเศษค่าไฟ" />}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            {createError && <div className="room-modal-error mt-3"><i className="fas fa-exclamation-circle me-2" />{createError}</div>}
            <div className="confirm-actions mt-4">
              <button className="btn btn-outline-secondary" onClick={() => setShowCreateModal(false)}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={handleCreateConfirm} disabled={!newMonthYear}><i className="fas fa-check-circle me-1" />ยืนยัน</button>
            </div>
          </div>
        </div>
      )}

      {bulkSendModal && (
        <div className="confirm-overlay" onClick={() => { if (!bulkSendingLine) setBulkSendModal(null); }}>
          <div className="confirm-dialog" style={{ maxWidth: 440, textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
            <div className="d-flex align-items-center gap-2 mb-3">
              <i className="fab fa-line text-success" style={{ fontSize: "1.4rem" }} />
              <h6 className="confirm-title mb-0" style={{ textAlign: "left" }}>
                {bulkSendingLine ? "กำลังส่งบิลทาง LINE..." : "ผลการส่งบิลทาง LINE"}
              </h6>
            </div>
            <div className="nicescrollbar" style={{ maxHeight: 320, overflowY: "auto" }}>
              <ul className="list-unstyled mb-0">
                {bulkSendModal.map((it) => (
                  <li key={it.roomId} className="py-2" style={{ borderBottom: "1px solid var(--color-light)" }}>
                    <div className="d-flex align-items-center justify-content-between">
                      <span>ห้อง {it.roomNumber}</span>
                      <span className="d-flex align-items-center gap-2 small">
                        {it.status === "pending" && <span className="text-muted">รอส่ง</span>}
                        {it.status === "sending" && (
                          <>
                            <span className="spinner-border spinner-border-sm text-secondary" />
                            <span className="text-muted">กำลังส่ง...</span>
                          </>
                        )}
                        {it.status === "success" && (
                          <>
                            <i className="fas fa-check-circle text-success" />
                            <span className="text-success">สำเร็จ</span>
                          </>
                        )}
                        {it.status === "error" && (
                          <>
                            <i className="fas fa-times-circle text-danger" />
                            <span className="text-danger">ไม่สำเร็จ</span>
                          </>
                        )}
                      </span>
                    </div>
                    {it.status === "error" && it.message && (
                      <div className="text-danger small mt-1" style={{ opacity: 0.85 }}>
                        <i className="fas fa-exclamation-circle me-1" />{it.message}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-3 small text-muted">
              {bulkSendingLine
                ? `กำลังส่ง ${bulkSendModal.filter((it) => it.status === "success" || it.status === "error").length}/${bulkSendModal.length} ห้อง`
                : `สำเร็จ ${bulkSendModal.filter((it) => it.status === "success").length} ห้อง, ไม่สำเร็จ ${bulkSendModal.filter((it) => it.status === "error").length} ห้อง`}
            </div>
            <div className="confirm-actions mt-3">
              <button className="btn btn-primary" disabled={bulkSendingLine} onClick={() => setBulkSendModal(null)}>
                {bulkSendingLine ? <span className="spinner-border spinner-border-sm" /> : "ปิด"}
              </button>
            </div>
          </div>
        </div>
      )}

      {roomSlipLightbox && (
        <div className="lightbox-overlay" onClick={() => setRoomSlipLightbox(null)}>
          <button className="lightbox-close" onClick={() => setRoomSlipLightbox(null)}><i className="fas fa-times" /></button>
          <img className="lightbox-img" src={roomSlipLightbox} alt="สลิป" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {confirmDeleteGroup && (
        <div className="confirm-overlay" onClick={() => { if (!deletingGroup) { setConfirmDeleteGroup(null); setDeletePaymentHistory(false); } }}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon confirm-icon--danger"><i className="fas fa-trash-alt" /></div>
            <h6 className="confirm-title">ยืนยันการลบบิล?</h6>
            <p className="confirm-message">
              ลบบิลเดือน <strong>{monthYearLabel(confirmDeleteGroup.monthYear)}</strong> ทั้งหมด ({confirmDeleteGroup.data.length} ห้อง) ใช่หรือไม่?
              <br /><small className="text-danger">คำเตือน: ข้อมูลจะถูกลบถาวร ไม่สามารถกู้คืนได้</small>
            </p>
            <label className="d-flex align-items-start gap-2 text-start mb-0" style={{ cursor: "pointer" }}>
              <input className="form-check-input mt-1" type="checkbox" checked={deletePaymentHistory}
                onChange={(e) => setDeletePaymentHistory(e.target.checked)} />
              <span className="small">
                ลบ "ประวัติการชำระที่ผ่านมา" ของบิลเดือนนี้ด้วย
                <br /><span className="text-muted">ไม่ติ๊ก = ลบเฉพาะตัวบิล ประวัติการชำระเดิมยังอยู่เหมือนเดิม (ไปดูได้ในหน้าประวัติการชำระ)</span>
              </span>
            </label>
            <div className="confirm-actions">
              <button className="btn btn-outline-secondary" onClick={() => { setConfirmDeleteGroup(null); setDeletePaymentHistory(false); }} disabled={deletingGroup}>ยกเลิก</button>
              <button className="btn btn-danger" onClick={handleDeleteGroup} disabled={deletingGroup}>
                {deletingGroup ? <><span className="spinner-border spinner-border-sm me-2" />กำลังลบ...</> : <><i className="fas fa-trash-alt me-1" />ใช่, ลบข้อมูล</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmBack && (
        <div className="confirm-overlay" onClick={() => { if (!saving) { setConfirmBack(false); pendingLeaveRef.current = null; } }}>
          <div className="confirm-dialog" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon confirm-icon--warning"><i className="fas fa-exclamation-triangle" /></div>
            <h6 className="confirm-title">คุณมีการแก้ไขที่ยังไม่ได้บันทึก</h6>
            <p className="confirm-message">ต้องการอยู่ต่อเพื่อบันทึก หรือออกโดยไม่บันทึกการเปลี่ยนแปลง?</p>
            <div className="confirm-actions" style={{ flexWrap: "wrap" }}>
              <button className="btn btn-outline-secondary" disabled={saving}
                onClick={() => { setConfirmBack(false); pendingLeaveRef.current = null; }}>
                อยู่ต่อ
              </button>
              <button className="btn btn-danger" disabled={saving}
                onClick={() => {
                  setConfirmBack(false);
                  setDirty(false); // ต้องเคลียร์ก่อนเรียก leave() เสมอ ไม่งั้นถ้าออกทางปุ่มย้อนกลับเบราว์เซอร์
                  // history.back() ที่ตามมาจะไปโดน POP-guard effect ดักซ้ำเข้าลูปไม่รู้จบ (dirty ยังเป็น true อยู่)
                  const leave = pendingLeaveRef.current; pendingLeaveRef.current = null;
                  leave?.();
                }}>
                ออกโดยไม่บันทึก
              </button>
              <button className="btn btn-primary" disabled={saving}
                onClick={async () => {
                  await handleSave();
                  setConfirmBack(false);
                  const leave = pendingLeaveRef.current; pendingLeaveRef.current = null;
                  leave?.();
                }}>
                {saving ? <span className="spinner-border spinner-border-sm" /> : "บันทึกแล้วออก"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmSendIdx !== null && billData[confirmSendIdx] && (
        <div className="confirm-overlay" onClick={() => sendingLineIdx === null && setConfirmSendIdx(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon confirm-icon--primary"><i className="fab fa-line" /></div>
            <h6 className="confirm-title">ยืนยันการส่งบิลทาง LINE?</h6>
            <p className="confirm-message">
              ส่งบิลห้อง <strong>{billData[confirmSendIdx].roomNumber}</strong> ({billData[confirmSendIdx].tenantName || "ว่าง"}) ทาง LINE ใช่หรือไม่?
              <br /><small className="text-muted">{sendLogSummary(billData[confirmSendIdx].sendLogs?.[0])}</small>
            </p>
            <div className="confirm-actions">
              <button className="btn btn-outline-secondary" onClick={() => setConfirmSendIdx(null)} disabled={sendingLineIdx !== null}>ยกเลิก</button>
              <button className="btn btn-success" disabled={sendingLineIdx !== null}
                onClick={async () => {
                  const idx = confirmSendIdx;
                  setConfirmSendIdx(null);
                  await handleSendLineForRoom(idx);
                }}>
                {sendingLineIdx !== null ? <><span className="spinner-border spinner-border-sm me-2" />กำลังส่ง...</> : <><i className="fab fa-line me-1" />ใช่, ส่งเลย</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmSendBulkIds && (
        <div className="confirm-overlay" onClick={() => !bulkSendingLine && setConfirmSendBulkIds(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon confirm-icon--primary"><i className="fab fa-line" /></div>
            <h6 className="confirm-title">ยืนยันการส่งบิลทาง LINE?</h6>
            <p className="confirm-message">ส่งบิลทาง LINE ให้ <strong>{confirmSendBulkIds.length}</strong> ห้องที่เลือกไว้ ใช่หรือไม่?</p>
            <div className="confirm-actions">
              <button className="btn btn-outline-secondary" onClick={() => setConfirmSendBulkIds(null)} disabled={bulkSendingLine}>ยกเลิก</button>
              <button className="btn btn-success" disabled={bulkSendingLine}
                onClick={async () => {
                  const ids = confirmSendBulkIds;
                  setConfirmSendBulkIds(null);
                  await handleSendLineBulk(ids);
                }}>
                {bulkSendingLine ? <><span className="spinner-border spinner-border-sm me-2" />กำลังส่ง...</> : <><i className="fab fa-line me-1" />ใช่, ส่งเลย</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSpecialDiscounts && (
        <SpecialDiscountsModal
          rooms={rooms}
          tenants={tenants}
          towers={towers}
          discounts={specialDiscounts}
          onClose={() => setShowSpecialDiscounts(false)}
          onChange={(next) => {
            setSpecialDiscounts(next);
            // บิลเดือนที่กำลังเปิดแก้ไขอยู่ (ถ้ามี) ต้องคิดส่วนลดพิเศษใหม่ให้ทันที ไม่ต้องปิดเปิดหน้าใหม่ —
            // ใช้ refreshDerivedFields ตัวเดียวกับตอนโหลดบิล แค่สลับ specialDiscounts ใน ctx เป็นชุดล่าสุด
            if (billData.length > 0) {
              const nextData = billData.map((it) => ({ ...it }));
              refreshDerivedFields(nextData, editingMonthYear, { ...ctx, specialDiscounts: next });
              setBillData(nextData);
              setDirty(true);
            }
          }}
        />
      )}

      {printConfigPool && (
        <BillPrintConfigModal
          key={printConfigNonce}
          pool={printConfigPool}
          rooms={rooms}
          towers={towers}
          initialSelected={printConfigPreselect}
          onCancel={() => setPrintConfigPool(null)}
          onConfirm={({ entries, mode, splitMode, colKeys, slipLineKeys, slipLayout, otherDetailMode, totalDisplayMode, dashboardSections }) => {
            if (mode === "dashboard") {
              // โหมดนี้ไม่ผ่าน BillPrintOnly/expandEntriesForPrint เลย — รวมยอด entries (ทุกห้องของ pool ที่
              // ให้มา ไม่ใช่แค่ที่ติ๊กเลือก เพราะซ่อนตัวเลือกห้องไปแล้วสำหรับโหมดนี้) แยกตามเดือน คำนวณสถิติ
              // สรุปต่อเดือนด้วย computeBillStats ตัวเดียวกับที่ใช้ทุกจุด
              const byMonth = new Map<string, BillItem[]>();
              entries.forEach((e) => {
                if (!byMonth.has(e.monthYear)) byMonth.set(e.monthYear, []);
                byMonth.get(e.monthYear)!.push(e.item);
              });
              setPrintDashboardGroups(
                [...byMonth.entries()]
                  .sort(([a], [b]) => myScore(a) - myScore(b))
                  .map(([monthYear, items]) => ({ monthYear, stats: computeBillStats(items, payments, monthYear) }))
              );
              setPrintDashboardSections(dashboardSections);
              setPrintDashboard(true);
              setTimeout(() => window.print(), 80);
              return;
            }
            // ไม่ปิดหน้าตั้งค่าพิมพ์ตรงนี้ — ถ้ากด cancel ที่ไดอะล็อกพิมพ์ของเบราว์เซอร์ จะได้กลับมาที่
            // หน้าตั้งค่าพิมพ์เดิมทันที (ปรับตัวเลือกแล้วกดพิมพ์ใหม่ได้เลย) แทนที่จะหลุดไปหน้าเปล่าๆ
            setPrintPayload(expandEntriesForPrint(entries, splitMode, tenants));
            setPrintMode(mode);
            setPrintColKeys(colKeys);
            setPrintOtherDetailMode(otherDetailMode);
            setPrintTotalDisplayMode(totalDisplayMode);
            setPrintSlipLineKeys(slipLineKeys);
            setPrintSlipLayout(slipLayout);
            // เข้าไดอะล็อกพิมพ์ของเบราว์เซอร์ทันทีเหมือนหน้าจดมิเตอร์ ไม่ต้องมีหน้าพรีวิวคั่นกลาง — รอ
            // ให้ state ข้างบน render เป็น .bill-print-only ก่อนแล้วค่อยเรียก print()
            setTimeout(() => window.print(), 80);
          }}
        />
      )}

      {printPayload && (
        <BillPrintOnly entries={printPayload} config={config} mode={printMode} colKeys={printColKeys}
          lineKeys={printSlipLineKeys} layout={printSlipLayout} tenants={tenants} otherDetailMode={printOtherDetailMode}
          totalDisplayMode={printTotalDisplayMode} />
      )}

      {printDashboard && printDashboardGroups.length > 0 && (
        <DashboardSummaryPrint groups={printDashboardGroups} config={config} sections={printDashboardSections} />
      )}

      {payingIndex !== null && billData[payingIndex] && (
        <PaymentModal
          item={billData[payingIndex]}
          history={getPaymentHistory(payments, billData[payingIndex].roomId, editingMonthYear)}
          monthYear={editingMonthYear}
          config={config}
          allBills={bills}
          onClose={() => setPayingIndex(null)}
          onConfirm={handleConfirmPayment}
          onCancelPayment={handleCancelPayment}
        />
      )}
    </>
  );
}
