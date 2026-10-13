import { useEffect, useMemo, useState } from "react";
import { logsApi } from "../api/client";
import { useBreadcrumb } from "../context/BreadcrumbContext";
import { thaiDateTimeString } from "../utils/yearFormat";
import { useLiveRefreshTick } from "../utils/useLiveSync";
import EmptyState from "../components/EmptyState";

interface LogEntry {
  id: string;
  timestamp: string;
  userId: string;
  username: string;
  method: string;
  path: string;
  action: string;
  entityType: string;
  description: string;
  status: number;
  requestBody: unknown;
  responseBody: unknown;
  userAgent: string;
  ip: string;
}

const ENTITY_META: Record<string, { label: string; icon: string; color: string }> = {
  room: { label: "ห้องพัก", icon: "fa-door-open", color: "var(--color-primary)" },
  tower: { label: "ตึก", icon: "fa-building", color: "var(--color-primary)" },
  "room-tag": { label: "แท็กห้อง", icon: "fa-tag", color: "var(--color-primary)" },
  tenant: { label: "ผู้เช่า", icon: "fa-user", color: "#6610f2" },
  "tenant-tag": { label: "แท็กผู้เช่า", icon: "fa-tag", color: "#6610f2" },
  meter: { label: "มิเตอร์", icon: "fa-tachometer-alt", color: "#0dcaf0" },
  bill: { label: "บิล", icon: "fa-file-invoice-dollar", color: "var(--color-success)" },
  payment: { label: "การชำระเงิน", icon: "fa-hand-holding-usd", color: "var(--color-success)" },
  vehicle: { label: "ยานพาหนะ", icon: "fa-car", color: "#fd7e14" },
  "vehicle-type": { label: "ประเภทยานพาหนะ", icon: "fa-car", color: "#fd7e14" },
  cctv: { label: "กล้องวงจรปิด", icon: "fa-video", color: "#6c757d" },
  "repair-request": { label: "แจ้งซ่อมจากผู้เช่า", icon: "fa-screwdriver-wrench", color: "#20c997" },
  "repair-item": { label: "คลังซ่อมแซม", icon: "fa-screwdriver-wrench", color: "#20c997" },
  "repair-movement": { label: "เบิก/เติมของซ่อมแซม", icon: "fa-screwdriver-wrench", color: "#20c997" },
  formula: { label: "สูตรคำนวณ", icon: "fa-calculator", color: "#b8860b" },
  settings: { label: "การตั้งค่า", icon: "fa-cog", color: "var(--color-info-dark)" },
  chat: { label: "แชท LINE", icon: "fa-comment", color: "#06C755" },
  user: { label: "ผู้ใช้งาน", icon: "fa-users-cog", color: "var(--color-primary)" },
  auth: { label: "เข้า/ออกระบบ", icon: "fa-sign-in-alt", color: "var(--color-danger)" },
  other: { label: "อื่นๆ", icon: "fa-circle", color: "var(--color-info-dark)" },
};

function entityMeta(type: string) {
  return ENTITY_META[type] ?? { label: type || "อื่นๆ", icon: "fa-circle", color: "var(--color-info-dark)" };
}

function formatLogTime(ts: string) {
  if (!ts) return "-";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return thaiDateTimeString(d);
}

// ── แปลชื่อฟิลด์เทคนิค (camelCase จาก backend) เป็นภาษาไทยที่คนอ่านเข้าใจ — ใช้กับทุกประเภทข้อมูล
// ในระบบ (ห้อง, ผู้เช่า, บิล, มิเตอร์, รถ, ผู้ใช้งาน, ตั้งค่า ฯลฯ) ไม่ต้องแยกทำทีละหน้า
const FIELD_LABELS: Record<string, string> = {
  id: "รหัสอ้างอิง",
  code: "รหัสห้อง",
  number: "เลขห้อง",
  detail: "รายละเอียด",
  details: "รายละเอียด",
  price: "ราคา",
  dailyPrice: "ราคารายวัน",
  monthlyPrice: "ราคารายเดือน",
  pictures: "รูปภาพ",
  images: "รูปภาพ",
  status: "สถานะ",
  floor: "ชั้น",
  floorCount: "จำนวนชั้น",
  roomsPerFloor: "จำนวนห้องต่อชั้น",
  towerId: "ตึก (รหัส)",
  tags: "แท็ก",
  meterWaterActive: "เปิดใช้มิเตอร์น้ำ",
  meterElectricActive: "เปิดใช้มิเตอร์ไฟ",
  isActive: "เปิดใช้งาน",
  isDefault: "ค่าเริ่มต้น",
  checkInDate: "วันที่เข้าพัก",
  amount: "จำนวนเงิน",
  idLicense: "เลขบัตรประชาชน",
  title: "คำนำหน้า",
  firstName: "ชื่อ",
  lastName: "นามสกุล",
  houseNo: "บ้านเลขที่",
  soi: "ซอย",
  road: "ถนน",
  province: "จังหวัด",
  amphoe: "อำเภอ/เขต",
  tambon: "ตำบล/แขวง",
  zipcode: "รหัสไปรษณีย์",
  address: "ที่อยู่",
  tel: "เบอร์โทร",
  idLine: "ไอดีไลน์",
  lineUserId: "Line User ID",
  pdfLinks: "ไฟล์ PDF",
  driveImageUrl: "รูปภาพ",
  idRoom: "ห้องหลัก (รหัส)",
  extraRoomIds: "ห้องเพิ่มเติม (รหัส)",
  contractStartDate: "วันเริ่มสัญญา",
  contractEndDate: "วันสิ้นสุดสัญญา",
  coResidents: "ผู้พักอาศัยร่วม",
  timestamp: "เวลา",
  source: "แหล่งที่มา",
  roomNumber: "เลขห้อง",
  roomCode: "รหัสห้อง",
  roomPrice: "ราคาห้อง",
  roomDetail: "รายละเอียดห้อง",
  customerId: "ผู้เช่า (รหัส)",
  startDate: "วันที่เริ่ม",
  endDate: "วันที่สิ้นสุด",
  prefix: "คำนำหน้าตึก",
  name: "ชื่อ",
  color: "สี",
  icon: "ไอคอน",
  monthYear: "เดือน/ปี",
  data: "ข้อมูล",
  recordDate: "วันที่บันทึก",
  createdAt: "วันที่สร้าง",
  updatedAt: "วันที่แก้ไขล่าสุด",
  licensePlate: "ทะเบียนรถ",
  vehicleTypeId: "ประเภทรถ (รหัส)",
  brand: "ยี่ห้อ",
  parkingFee: "ค่าจอดรถ",
  defaultFee: "ค่าธรรมเนียมเริ่มต้น",
  scheduledDate: "วันที่กำหนด",
  type: "ประเภท",
  formula: "สูตรคำนวณ",
  billId: "บิล (รหัส)",
  tenantId: "ผู้เช่า (รหัส)",
  paymentDate: "วันที่ชำระเงิน",
  operator: "ผู้ดำเนินการ",
  action: "การกระทำ",
  slaveId: "รหัสอุปกรณ์",
  roomId: "ห้อง (รหัส)",
  value: "ค่า",
  voltage: "แรงดันไฟฟ้า",
  current: "กระแสไฟฟ้า",
  power: "กำลังไฟฟ้า",
  username: "ชื่อผู้ใช้",
  password: "รหัสผ่าน",
  passwordHash: "รหัสผ่าน (เข้ารหัสแล้ว)",
  displayName: "ชื่อที่แสดง",
  lastLoginAt: "เข้าสู่ระบบล่าสุด",
  currentSessionId: "รหัสเซสชัน",
  electricRate: "อัตราค่าไฟ",
  waterRate: "อัตราค่าน้ำ",
  overdueEnabled: "เปิดใช้ค่าปรับล่าช้า",
  overdueDay: "วันที่เริ่มปรับ",
  overdueFineType: "ประเภทค่าปรับ",
  overdueFineAmount: "จำนวนค่าปรับ",
  logoUrl: "โลโก้",
  logoBgEnabled: "เปิดพื้นหลังโลโก้",
  logoBgColor: "สีพื้นหลังโลโก้",
  appName: "ชื่อระบบ",
  appNameColors: "สีชื่อระบบ",
  liveMeterEnabled: "เปิดใช้มิเตอร์เรียลไทม์",
  splitRentByResidents: "หารค่าเช่าตามผู้พัก",
  meterDigits: "จำนวนหลักมิเตอร์",
  yearFormat: "รูปแบบปี",
  sessionTimeoutMinutes: "นาทีหมดเวลาเข้าสู่ระบบ",
};

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

function formatFieldValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "ใช่" : "ไม่ใช่";
  if (Array.isArray(value)) {
    if (value.length === 0) return "- (ว่าง)";
    if (value.every((v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
      return value.join(", ");
    }
    return `${value.length} รายการ`;
  }
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "number") {
    const moneyLike = /price|amount|fee|rate|fine/i.test(key);
    return moneyLike ? value.toLocaleString("th-TH") : String(value);
  }
  return String(value);
}

// ── แสดงข้อมูล request/response แบบแปลชื่อฟิลด์เป็นภาษาไทยแล้ว แทนที่จะโชว์ JSON ดิบๆ ที่อ่านยาก ──
function FriendlyBody({ data }: { data: unknown }) {
  if (data === null || data === undefined) return null;
  if (typeof data !== "object" || Array.isArray(data)) {
    return <pre className="log-detail-json">{JSON.stringify(data, null, 2)}</pre>;
  }
  const entries = Object.entries(data as Record<string, unknown>);
  if (entries.length === 0) return <p className="text-muted small mb-0">- ไม่มีข้อมูล -</p>;
  return (
    <div className="log-detail-json" style={{ maxHeight: 280 }}>
      {entries.map(([key, value]) => (
        <div key={key} className="d-flex justify-content-between gap-3" style={{ padding: "3px 0", borderBottom: "1px dashed var(--color-light)" }}>
          <span className="text-muted" style={{ flexShrink: 0 }}>{fieldLabel(key)}</span>
          <span style={{ textAlign: "right", wordBreak: "break-word" }}>{formatFieldValue(key, value)}</span>
        </div>
      ))}
    </div>
  );
}

// ── รายละเอียดเต็มของ log 1 รายการ — เปิดตอนคลิกแถวในตาราง ─────────────────────
function LogDetailModal({ log, onClose }: { log: LogEntry; onClose: () => void }) {
  const meta = entityMeta(log.entityType);
  const ok = log.status < 400;
  const hasRequest = log.requestBody !== null && log.requestBody !== undefined;
  const hasResponse = log.responseBody !== null && log.responseBody !== undefined;

  return (
    <div className="confirm-overlay" onClick={onClose}>
      <div className="confirm-dialog" style={{ maxWidth: 640, width: "94%", textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
        <div className="d-flex align-items-center gap-2 mb-3">
          <div style={{
            width: 36, height: 36, borderRadius: 8, background: meta.color,
            display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", flexShrink: 0,
          }}>
            <i className={`fas ${meta.icon}`} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700 }}>{log.description}</div>
            <div className="text-muted small">{formatLogTime(log.timestamp)}</div>
          </div>
          <button className="btn btn-sm ms-auto" style={{ color: "var(--color-dark-variant)" }} onClick={onClose}>
            <i className="fas fa-times" />
          </button>
        </div>

        <div className="row g-3 mb-3">
          <div className="col-6">
            <small className="text-muted d-block">ผู้ใช้</small>
            <b>{log.username || "-"}</b>
          </div>
          <div className="col-6">
            <small className="text-muted d-block">สถานะ</small>
            <span className={`status-badge ${ok ? "status-paid" : "status-overdue"}`}>{log.status}</span>
          </div>
          <div className="col-6">
            <small className="text-muted d-block">Method / Path</small>
            <code style={{ fontSize: "0.82rem" }}>{log.method} {log.path}</code>
          </div>
          <div className="col-6">
            <small className="text-muted d-block">IP</small>
            <b>{log.ip || "-"}</b>
          </div>
          <div className="col-12">
            <small className="text-muted d-block">User Agent</small>
            <span className="small">{log.userAgent || "-"}</span>
          </div>
        </div>

        {hasRequest && (
          <div className="mb-3">
            <label className="form-label small fw-bold">ข้อมูลที่ส่ง</label>
            <FriendlyBody data={log.requestBody} />
          </div>
        )}
        {hasResponse && (
          <div className="mb-3">
            <label className="form-label small fw-bold">ผลลัพธ์</label>
            <FriendlyBody data={log.responseBody} />
          </div>
        )}
        {!hasRequest && !hasResponse && (
          <p className="text-muted small mb-3">ไม่มีข้อมูลเพิ่มเติมสำหรับรายการนี้</p>
        )}

        <div className="confirm-actions">
          <button className="btn btn-outline-secondary" onClick={onClose}>ปิด</button>
        </div>
      </div>
    </div>
  );
}

export default function LogPage() {
  const { setBreadcrumb } = useBreadcrumb();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState<string[]>([]);
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);

  useEffect(() => {
    setBreadcrumb([{ label: "Log กิจกรรม" }]);
    return () => setBreadcrumb([]);
  }, []);

  useEffect(() => {
    logsApi.getAll().then(setLogs).finally(() => setLoading(false));
  }, []);

  // ใครก็ตามทำอะไรก็ตามในระบบ (ทุก entityType ที่มี) — โหลด log ใหม่เงียบๆ ให้เห็นรายการล่าสุดทันที
  const logsLiveTick = useLiveRefreshTick(Object.keys(ENTITY_META));
  useEffect(() => {
    if (logsLiveTick === 0) return;
    logsApi.getAll().then(setLogs);
  }, [logsLiveTick]);

  const entityTypesPresent = useMemo(() => [...new Set(logs.map((l) => l.entityType))], [logs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      const matchSearch = !q
        || l.description.toLowerCase().includes(q)
        || l.username.toLowerCase().includes(q)
        || l.path.toLowerCase().includes(q);
      const matchEntity = entityFilter.length === 0 || entityFilter.includes(l.entityType);
      return matchSearch && matchEntity;
    });
  }, [logs, search, entityFilter]);

  return (
    <div className="custom-card">
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-3">
        <h5 className="form-section-title mb-0" style={{ borderBottom: "none" }}>Log กิจกรรม</h5>
        <span className="text-muted small">{filtered.length} / {logs.length} รายการ</span>
      </div>

      <div className="row g-2 mb-3 align-items-center">
        <div className="col-12 col-lg">
          <div className="search-container">
            <i className="fas fa-search" />
            <input type="text" className="form-control" style={{ paddingLeft: 40 }}
              placeholder="ค้นหาชื่อผู้ใช้, รายละเอียด, เส้นทาง..."
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      {entityTypesPresent.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          {entityTypesPresent.map((type) => {
            const meta = entityMeta(type);
            const active = entityFilter.includes(type);
            return (
              <button key={type} type="button" className={`pcp-chip${active ? " active" : ""}`}
                onClick={() => setEntityFilter((prev) => prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type])}>
                <i className={`fas ${meta.icon} me-1`} style={{ fontSize: "0.7em" }} />{meta.label}
              </button>
            );
          })}
          {entityFilter.length > 0 && (
            <button type="button" className="pcp-chip" onClick={() => setEntityFilter([])}>
              <i className="fas fa-times me-1" />ล้างตัวกรอง
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-center p-5"><div className="spinner-border" style={{ color: "var(--color-primary)" }} /></div>
      ) : (
        <div className="nicescrollbar" style={{ maxHeight: 640, overflow: "auto" }}>
          <table className="table-mainstyle table-hover" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ whiteSpace: "nowrap" }}>เวลา</th>
                <th>ผู้ใช้</th>
                <th>หมวดหมู่</th>
                <th>การกระทำ</th>
                <th className="text-center">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={5}><EmptyState icon="fa-clipboard-list" text="ไม่พบข้อมูล" compact /></td></tr>
              ) : filtered.map((l) => {
                const meta = entityMeta(l.entityType);
                const ok = l.status < 400;
                return (
                  <tr key={l.id} style={{ cursor: "pointer" }} onClick={() => setSelectedLog(l)}>
                    <td className="small text-muted" style={{ whiteSpace: "nowrap" }}>{formatLogTime(l.timestamp)}</td>
                    <td className="fw-bold">{l.username || "-"}</td>
                    <td>
                      <span className="badge" style={{ background: meta.color, color: "#fff", fontWeight: 500 }}>
                        <i className={`fas ${meta.icon} me-1`} />{meta.label}
                      </span>
                    </td>
                    <td>{l.description}</td>
                    <td className="text-center">
                      <span className={`status-badge ${ok ? "status-paid" : "status-overdue"}`}>{l.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedLog && <LogDetailModal log={selectedLog} onClose={() => setSelectedLog(null)} />}
    </div>
  );
}
