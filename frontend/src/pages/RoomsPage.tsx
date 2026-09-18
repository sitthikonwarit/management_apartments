import { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { roomsApi, tenantsApi, metersApi } from "../api/client";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  Title, Tooltip, Legend,
} from "chart.js";
ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);
// Chart.js ใช้ฟอนต์ default ของตัวเอง (Helvetica/Arial) ไม่ใช่ฟอนต์หลักของเว็บ (ดู --font-family บน body ใน
// App.css) ทำให้ label/legend/tooltip ของกราฟหน้าตาไม่เข้าชุดกับตัวอักษรที่อื่นในหน้าเว็บ ตั้ง default ตรงนี้
// ที่เดียวให้ทุกกราฟในไฟล์นี้ (และไฟล์อื่นที่ import Chart.js ต่อจากนี้) ใช้ฟอนต์เดียวกันทั้งหมดโดยไม่ต้องเซ็ตซ้ำ
// ในทุก options ของแต่ละกราฟ
ChartJS.defaults.font.family = "'Mitr', 'Poppins', sans-serif";
import { useBreadcrumb } from "../context/BreadcrumbContext";
import { useAppConfig } from "../context/AppConfigContext";
import CustomSelect2 from "../components/CustomSelect2";
import ToolbarActionsMenu from "../components/ToolbarActionsMenu";
import EmptyState from "../components/EmptyState";
import TowerManagement from "../components/TowerManagement";
import RoomTableView from "../components/RoomTableView";
import { usePersistedViewMode } from "../utils/usePersistedViewMode";
import { toDisplayYear } from "../utils/yearFormat";
import { tenantDisplayName } from "../utils/tenantName";
import { tenantOccupiesRoom, findTenantForRoom, roomsOfTenant, findBookingForRoom } from "../utils/tenantRoom";
import { useLiveRefreshTick } from "../utils/useLiveSync";
import { toastSuccess, toastError } from "../utils/toast";

type ViewMode = "list" | "grid" | "table";

const THAI_MONTHS_LONG = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
function formatThaiDate(str: string): string {
  if (!str) return "-";
  let d: number, m: number, yearOut: number;
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    // YYYY-MM-DD (CE) → แปลงปีตามที่ตั้งค่าไว้ (พ.ศ./ค.ศ.)
    const p = str.split("-");
    yearOut = toDisplayYear(parseInt(p[0], 10), "CE");
    m = parseInt(p[1], 10) - 1;
    d = parseInt(p[2], 10);
  } else {
    // DD/MM/YYYY (BE) → แปลงปีตามที่ตั้งค่าไว้ (พ.ศ./ค.ศ.)
    const p = str.split("/");
    if (p.length !== 3) return str;
    d = parseInt(p[0], 10);
    m = parseInt(p[1], 10) - 1;
    yearOut = toDisplayYear(parseInt(p[2], 10), "BE");
  }
  if (isNaN(d) || isNaN(m) || isNaN(yearOut) || m < 0 || m > 11) return str;
  return `${d} ${THAI_MONTHS_LONG[m]} ${yearOut}`;
}

// ─── Meter chart helpers ──────────────────────────────────────────────────────
const THAI_MONTHS_METER = [
  "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม",
];
// หมายเหตุ: monthYear ของมิเตอร์เก็บเป็นปี ค.ศ. ตรงๆ อยู่แล้ว — label นี้แปลงตามที่ตั้งค่าไว้แค่ตอนแสดงผล
function meterMonthLabel(my: string) {
  if (!my) return "";
  const [m, y] = my.split("/");
  const yearOut = toDisplayYear(parseInt(y, 10) || 0, "CE");
  return `${THAI_MONTHS_METER[parseInt(m, 10) - 1] ?? m} ${yearOut}`;
}
function meterScore(my: string) {
  const [m, y] = my.split("/");
  return parseInt(y, 10) * 12 + parseInt(m, 10);
}
function calcMeterUnits(curr: any, prev: any): number | null {
  if (curr === "" || curr == null || prev === "" || prev == null) return null;
  const c = Number(curr), p = Number(prev);
  if (isNaN(c) || isNaN(p)) return null;
  return c >= p ? c - p : (c + 10000) - p;
}

// ─── MeterBarChart ────────────────────────────────────────────────────────────
function MeterBarChart({ data }: { data: { label: string; monthYear: string; electric: number; water: number }[] }) {
  const chartData = {
    labels: data.map((d) => d.label),
    datasets: [
      {
        label: "น้ำ (หน่วย)",
        data: data.map((d) => d.water),
        backgroundColor: "rgba(54, 162, 235, 0.7)",
        borderColor: "rgba(54, 162, 235, 1)",
        borderWidth: 1,
        borderRadius: 4,
        barPercentage: 0.6,
        categoryPercentage: 0.8,
      },
      {
        label: "ไฟ (หน่วย)",
        data: data.map((d) => d.electric),
        backgroundColor: "rgba(255, 206, 86, 0.7)",
        borderColor: "rgba(255, 206, 86, 1)",
        borderWidth: 1,
        borderRadius: 4,
        barPercentage: 0.6,
        categoryPercentage: 0.8,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top" as const,
        align: "end" as const,
        labels: { usePointStyle: true, boxWidth: 8, font: { size: 12 } },
      },
      tooltip: {
        backgroundColor: "rgba(0,0,0,0.82)",
        titleFont: { size: 13 },
        bodyFont: { size: 12 },
        callbacks: {
          afterLabel: (ctx: any) => `เลขมิเตอร์: ${data[ctx.dataIndex]?.monthYear ?? ""}`,
        },
      },
    },
    scales: {
      y: { beginAtZero: true, grid: { color: "#f0f0f0" }, ticks: { font: { size: 11 } } },
      x: { grid: { display: false }, ticks: { font: { size: 11 } } },
    },
    interaction: { mode: "index" as const, intersect: false },
  };

  return (
    <div style={{ position: "relative", height: 260 }}>
      <Bar data={chartData} options={options} />
    </div>
  );
}

// ─── Room Tag Management ──────────────────────────────────────────────────────
const EMPTY_TAG_FORM = { name: "", icon: "fas fa-tag", color: "#6C9BCF", price: "0" };
const SUGGESTED_ICONS = [
  "fas fa-tag","fas fa-star","fas fa-home","fas fa-key","fas fa-door-open",
  "fas fa-building","fas fa-bed","fas fa-bath","fas fa-couch","fas fa-tv",
  "fas fa-wifi","fas fa-snowflake","fas fa-fire","fas fa-bolt","fas fa-water",
  "fas fa-tools","fas fa-wrench","fas fa-shield-alt","fas fa-parking","fas fa-car",
  "fas fa-elevator","fas fa-swimming-pool","fas fa-dumbbell","fas fa-paw","fas fa-smoking",
];

function RoomTagManagementView({ tags, onTagsChange, onBack }: {
  tags: any[];
  onTagsChange: (tags: any[]) => void;
  onBack: () => void;
}) {
  const [tagForm, setTagForm] = useState(EMPTY_TAG_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = search
    ? tags.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
    : tags;

  function openAdd() {
    setEditingId(null); setTagForm(EMPTY_TAG_FORM); setError(""); setShowModal(true);
  }
  function startEdit(tag: any) {
    setEditingId(tag.id);
    setTagForm({ name: tag.name, icon: tag.icon || "fas fa-tag", color: tag.color || "#6C9BCF", price: String(tag.price ?? 0) });
    setError(""); setShowModal(true);
  }
  function cancelForm() {
    setEditingId(null); setTagForm(EMPTY_TAG_FORM); setError(""); setShowModal(false);
  }

  async function handleSave() {
    if (!tagForm.name.trim()) { setError("กรุณากรอกชื่อแท็ก"); return; }
    setSaving(true); setError("");
    try {
      if (editingId) {
        const updated = await roomsApi.updateTag(editingId, tagForm);
        onTagsChange(tags.map((t) => (t.id === editingId ? updated : t)));
      } else {
        const created = await roomsApi.createTag(tagForm);
        onTagsChange([...tags, created]);
      }
      toastSuccess("บันทึกแท็กสำเร็จ");
      cancelForm();
    } catch { setError("บันทึกไม่สำเร็จ กรุณาลองใหม่"); toastError("บันทึกไม่สำเร็จ กรุณาลองใหม่"); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      await roomsApi.deleteTag(id);
      onTagsChange(tags.filter((t) => t.id !== id));
      setDeleteId(null);
      if (editingId === id) cancelForm();
      toastSuccess("ลบแท็กสำเร็จ");
    } catch { setError("ลบไม่สำเร็จ กรุณาลองใหม่"); toastError("ลบไม่สำเร็จ กรุณาลองใหม่"); }
    finally { setDeleting(false); }
  }

  const previewPrice = Number(tagForm.price);

  return (
    <div className="custom-card page-view">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h5 className="form-section-title mb-0" style={{ borderBottom: "none" }}>จัดการแท็กห้องพัก</h5>
        <button className="btn btn-primary" onClick={openAdd}>
          <i className="fas fa-plus me-2" />เพิ่มแท็กใหม่
        </button>
      </div>

      <div className="search-container mb-4">
        <i className="fas fa-search" />
        <input type="text" className="form-control" placeholder="ค้นหาชื่อแท็ก..."
          value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="nicescrollbar" style={{ maxHeight: 420, overflowY: "auto" }}>
        {filtered.length === 0 ? (
          <div className="text-center text-muted p-5">
            <i className="fas fa-tags fa-2x mb-2 d-block opacity-25" />
            {search ? "ไม่พบแท็กที่ค้นหา" : "ยังไม่มีแท็กในระบบ"}
          </div>
        ) : (
          <div className="tmv-list">
            {filtered.map((tag) => (
              <div key={tag.id}>
                <div className={`tower-item${editingId === tag.id ? " tower-item--active" : ""}`} style={{ borderLeftColor: tag.color }}>
                  <div className="tower-item-info">
                    <div className="tower-item-color-dot" style={{ backgroundColor: tag.color }} />
                    <div className="tower-item-name">
                      <i className={`${tag.icon || "fas fa-tag"} me-2`} style={{ color: tag.color }} />
                      <strong>{tag.name}</strong>
                      {tag.price > 0 && (
                        <span className="text-muted ms-2" style={{ fontSize: "0.82rem" }}>
                          (+{Number(tag.price).toLocaleString()} บาท)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="tower-item-actions">
                    <button className="edit-tag-btn" onClick={() => startEdit(tag)} disabled={saving || deleting} title="แก้ไข">
                      <i className="fas fa-edit" />
                    </button>
                    <button className="delete-tag-btn delete-btn"
                      onClick={() => setDeleteId(deleteId === tag.id ? null : tag.id)}
                      disabled={saving || deleting} title="ลบ">
                      <i className="fas fa-trash-alt" />
                    </button>
                  </div>
                </div>
                {deleteId === tag.id && (
                  <div className="tmv-confirm-strip">
                    <i className="fas fa-exclamation-triangle text-danger me-2" />
                    <span>ยืนยันลบ <strong>{tag.name}</strong>?</span>
                    <div className="d-flex gap-1 ms-auto">
                      <button className="btn btn-sm btn-outline-secondary" onClick={() => setDeleteId(null)} disabled={deleting}>ยกเลิก</button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(tag.id)} disabled={deleting}>
                        {deleting ? <span className="spinner-border spinner-border-sm" /> : <><i className="fas fa-trash-alt me-1" />ลบ</>}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="d-flex mt-4 pt-3" style={{ borderTop: "1px solid var(--color-light)" }}>
        <button className="btn btn-outline-secondary" onClick={onBack}>
          <i className="fas fa-arrow-left me-1" />กลับ
        </button>
      </div>

      {showModal && (
        <div className="room-modal-overlay" onClick={cancelForm}>
          <div className="room-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="room-modal-header">
              <div className="room-modal-title">
                <i className={`fas ${editingId ? "fa-edit" : "fa-plus-circle"} me-2`} />
                {editingId ? "แก้ไขแท็ก" : "เพิ่มแท็กใหม่"}
              </div>
              <button className="room-modal-close" onClick={cancelForm}><i className="fas fa-times" /></button>
            </div>
            <div className="room-modal-body" style={{ padding: "1.25rem 1.5rem" }}>
              <div className="row g-3">
                <div className="col-12">
                  <label className="form-label">ชื่อแท็ก <span className="text-danger">*</span></label>
                  <input className="form-control" placeholder="เช่น แอร์, จอดรถ, เฟอร์นิเจอร์..."
                    value={tagForm.name} autoFocus
                    onChange={(e) => setTagForm((f) => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="col-12">
                  <label className="form-label">ไอคอน (Font Awesome)</label>
                  <div className="input-group">
                    <span className="input-group-text" style={{ color: tagForm.color, minWidth: 44, fontSize: "1.1rem" }}>
                      <i className={tagForm.icon || "fas fa-tag"} />
                    </span>
                    <input className="form-control" placeholder="fas fa-tag" value={tagForm.icon}
                      onChange={(e) => setTagForm((f) => ({ ...f, icon: e.target.value }))} />
                  </div>
                </div>
                <div className="col-12">
                  <label className="form-label small text-muted">เลือกไอคอนแนะนำ:</label>
                  <div className="tmv-icon-picker">
                    {SUGGESTED_ICONS.map((ic) => (
                      <button key={ic} type="button"
                        className={`tmv-icon-item${tagForm.icon === ic ? " tmv-icon-item--selected" : ""}`}
                        onClick={() => setTagForm((f) => ({ ...f, icon: ic }))} title={ic}>
                        <i className={ic} />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="col-6">
                  <label className="form-label">สีแท็ก</label>
                  <input type="color" className="form-control form-control-color w-100"
                    value={tagForm.color} title="เลือกสี"
                    onChange={(e) => setTagForm((f) => ({ ...f, color: e.target.value }))} />
                </div>
                <div className="col-6">
                  <label className="form-label">ราคาบวกเพิ่ม (บาท)</label>
                  <input type="number" className="form-control" placeholder="0" min={0}
                    value={tagForm.price}
                    onChange={(e) => setTagForm((f) => ({ ...f, price: e.target.value }))} />
                </div>
                <div className="col-12">
                  <label className="form-label small text-muted">ตัวอย่างแท็ก:</label>
                  <div className="p-2 rounded" style={{ background: "var(--color-background)" }}>
                    <span className="tenant-tag-chip" style={{ "--tag-color": tagForm.color } as React.CSSProperties}>
                      <i className={tagForm.icon || "fas fa-tag"} />
                      {tagForm.name || "ชื่อแท็ก"}
                      {previewPrice > 0 && <span className="tenant-tag-price">+{previewPrice.toLocaleString()}฿</span>}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            {error && (
              <div className="room-modal-error">
                <i className="fas fa-exclamation-circle me-2" />{error}
              </div>
            )}
            <div className="room-modal-footer">
              <button className="btn btn-outline-secondary" onClick={cancelForm} disabled={saving}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving
                  ? <><span className="spinner-border spinner-border-sm me-2" />กำลังบันทึก...</>
                  : <><i className="fas fa-save me-1" />{editingId ? "บันทึกการแก้ไข" : "บันทึก"}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function statusClass(s: string) {
  if (s === "ว่าง") return "status-available";
  if (s === "ปิดปรับปรุง" || s === "ปรับปรุง") return "status-maintenance";
  if (s === "จอง") return "status-booked";
  return "status-occupied";
}

function parsePictures(raw: any): { url: string; name?: string }[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

// ─── Room Edit View ───────────────────────────────────────────────────────────
const ROOM_STATUSES = ["ว่าง", "ไม่ว่าง", "จอง", "ปิดปรับปรุง"];

function RoomEditView({
  room, towers, allTags, onBack, onSaved,
}: {
  room: any; towers: any[]; allTags: any[];
  onBack: () => void; onSaved: (updated: any) => void;
}) {
  const [form, setForm] = useState({
    number: room.number ?? "",
    floor: room.floor ?? "",
    price: room.price > 0 ? String(room.price) : "",
    dailyPrice: room.dailyPrice > 0 ? String(room.dailyPrice) : "",
    detail: room.detail ?? "",
    status: room.status ?? "ว่าง",
    towerId: room.towerId ?? "",
    tags: Array.isArray(room.tags) ? room.tags : [],
    meterElectricActive: room.meterElectricActive !== false,
    meterWaterActive: room.meterWaterActive !== false,
    isActive: room.isActive !== false,
  });
  const [pictures, setPictures] = useState<{ url: string; name?: string }[]>(() => parsePictures(room.pictures));
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleAddPictures(files: FileList) {
    const newImages: { base64: string; name: string }[] = [];
    for (const file of Array.from(files)) {
      const base64 = await new Promise<string>((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result as string);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      newImages.push({ base64, name: file.name });
    }
    setUploading(true);
    try {
      const result = await roomsApi.updatePictures(room.id, pictures.map((p) => p.url), newImages);
      setPictures(result.pictures);
    } finally { setUploading(false); }
  }

  async function handleDeletePicture(url: string) {
    setUploading(true);
    try {
      const result = await roomsApi.updatePictures(room.id, pictures.map((p) => p.url).filter((u) => u !== url), []);
      setPictures(result.pictures);
      toastSuccess("ลบรูปภาพสำเร็จ");
    } finally { setUploading(false); }
  }

  function toggleTag(id: string) {
    setForm((f) => ({
      ...f,
      tags: f.tags.includes(id) ? f.tags.filter((t: string) => t !== id) : [...f.tags, id],
    }));
  }

  async function handleSave() {
    if (!form.number.trim()) { setError("กรุณาระบุเลขห้อง"); return; }
    setError(""); setSaving(true);
    try {
      const payload = {
        number: form.number.trim(),
        floor: form.floor.trim(),
        price: Number(form.price) || 0,
        dailyPrice: Number(form.dailyPrice) || 0,
        detail: form.detail.trim(),
        status: form.status,
        towerId: form.towerId,
        tags: form.tags,
        meterElectricActive: form.meterElectricActive,
        meterWaterActive: form.meterWaterActive,
        isActive: form.isActive,
      };
      const updated = await roomsApi.update(room.id, payload);
      toastSuccess("บันทึกข้อมูลห้องสำเร็จ");
      onSaved({ ...updated, pictures });
    } catch { setError("บันทึกไม่สำเร็จ กรุณาลองใหม่"); toastError("บันทึกไม่สำเร็จ กรุณาลองใหม่"); }
    finally { setSaving(false); }
  }

  return (
    <div className="custom-card page-view" id="tenantDetailEditCard">
      <div className="detail-modal-body">

        <div className="tenant-detail-profile-header">
          <div className="tenant-detail-profile-center" style={{ justifyContent: "center" }}>
            <div className="profile-info">
              <h4 className="profile-name">แก้ไขห้อง {room.number}</h4>
              <small className="text-muted">แก้ไขข้อมูลห้องพัก</small>
            </div>
          </div>
        </div>

        {/* ─── รูปภาพ ─── */}
        <div className="detail-section">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h6 className="mb-0"><i className="fas fa-images me-2" />รูปภาพห้องพัก</h6>
            <button className="btn btn-sm btn-outline-primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="fas fa-plus me-1" />}
              เพิ่มรูป
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: "none" }}
              onChange={(e) => e.target.files?.length && handleAddPictures(e.target.files)} />
          </div>
          {pictures.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {pictures.map((pic, idx) => (
                <div key={pic.url} style={{ position: "relative", width: 90, height: 90, flexShrink: 0 }}>
                  <img src={pic.url} alt={pic.name || `รูป ${idx + 1}`}
                    style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 8, cursor: "pointer", border: "2px solid var(--color-light)" }}
                    onClick={() => setLightboxIdx(idx)} />
                  <button
                    style={{ position: "absolute", top: -6, right: -6, background: "#dc3545", border: "none", borderRadius: "50%", width: 22, height: 22, color: "#fff", fontSize: "0.75rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                    onClick={() => handleDeletePicture(pic.url)} disabled={uploading} title="ลบรูป">
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="file-view-empty"><i className="fas fa-image me-2 text-muted" />ยังไม่มีรูปภาพ คลิก "เพิ่มรูป" เพื่ออัปโหลด</div>
          )}
        </div>

        {/* ─── Lightbox ─── */}
        {lightboxIdx !== null && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={() => setLightboxIdx(null)}>
            <button style={{ position: "absolute", top: 16, right: 20, background: "none", border: "none", color: "#fff", fontSize: "2rem", cursor: "pointer" }} onClick={() => setLightboxIdx(null)}>×</button>
            {pictures.length > 1 && (
              <button style={{ position: "absolute", left: 16, background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", borderRadius: "50%", width: 40, height: 40, fontSize: "1.2rem", cursor: "pointer" }}
                onClick={(e) => { e.stopPropagation(); setLightboxIdx((lightboxIdx - 1 + pictures.length) % pictures.length); }}>
                <i className="fas fa-chevron-left" />
              </button>
            )}
            <img src={pictures[lightboxIdx]?.url} alt="" style={{ maxWidth: "90vw", maxHeight: "85vh", borderRadius: 8, boxShadow: "0 4px 32px rgba(0,0,0,0.5)" }} onClick={(e) => e.stopPropagation()} />
            {pictures.length > 1 && (
              <button style={{ position: "absolute", right: 16, background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", borderRadius: "50%", width: 40, height: 40, fontSize: "1.2rem", cursor: "pointer" }}
                onClick={(e) => { e.stopPropagation(); setLightboxIdx((lightboxIdx + 1) % pictures.length); }}>
                <i className="fas fa-chevron-right" />
              </button>
            )}
            <div style={{ position: "absolute", bottom: 12, color: "rgba(255,255,255,0.7)", fontSize: "0.85rem" }}>
              {lightboxIdx + 1} / {pictures.length}
            </div>
          </div>
        )}

        {/* ─── ข้อมูลพื้นฐาน ─── */}
        <div className="detail-section">
          <h6><i className="fas fa-info-circle me-2" />ข้อมูลพื้นฐาน</h6>
          <div className="row g-3">
            <div className="col-6">
              <label className="form-label">เลขห้อง <span className="text-danger">*</span></label>
              <input className="form-control" value={form.number}
                onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))} />
            </div>
            <div className="col-6">
              <label className="form-label">ชั้น</label>
              <input className="form-control" value={form.floor}
                onChange={(e) => setForm((f) => ({ ...f, floor: e.target.value }))} placeholder="เช่น 1, 2, 3" />
            </div>
            <div className="col-12">
              <label className="form-label">ตึก</label>
              <select className="form-select" value={form.towerId}
                onChange={(e) => setForm((f) => ({ ...f, towerId: e.target.value }))}>
                <option value="">— ไม่ระบุตึก —</option>
                {towers.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.prefix || "-"})</option>)}
              </select>
            </div>
            <div className="col-12">
              <label className="form-label">สถานะ</label>
              <div className="d-flex flex-wrap gap-2">
                {ROOM_STATUSES.map((s) => (
                  <button key={s} type="button"
                    className={`btn btn-sm ${form.status === s ? "btn-primary" : "btn-outline-secondary"}`}
                    onClick={() => setForm((f) => ({ ...f, status: s }))}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ─── ราคา ─── */}
        <div className="detail-section">
          <h6><i className="fas fa-dollar-sign me-2" />ราคา</h6>
          <div className="row g-3">
            <div className="col-6">
              <label className="form-label">ราคา/เดือน (บาท)</label>
              <input type="number" className="form-control" min={0} placeholder="0"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
            </div>
            <div className="col-6">
              <label className="form-label">ราคา/วัน (บาท)</label>
              <input type="number" className="form-control" min={0} placeholder="0"
                value={form.dailyPrice}
                onChange={(e) => setForm((f) => ({ ...f, dailyPrice: e.target.value }))} />
            </div>
          </div>
        </div>

        {/* ─── รายละเอียด ─── */}
        <div className="detail-section">
          <h6><i className="fas fa-align-left me-2" />รายละเอียด</h6>
          <textarea className="form-control" rows={3} value={form.detail}
            onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))}
            placeholder="ระบุรายละเอียดหรือสิ่งอำนวยความสะดวก..." />
        </div>

        {/* ─── แท็ก ─── */}
        {allTags.length > 0 && (
          <div className="detail-section">
            <h6><i className="fas fa-tags me-2" />แท็กและสิ่งอำนวยความสะดวก</h6>
            <div className="d-flex flex-wrap gap-2">
              {allTags.map((tag) => {
                const active = form.tags.includes(String(tag.id));
                return (
                  <button key={tag.id} type="button"
                    className={`btn btn-sm ${active ? "btn-primary" : "btn-outline-secondary"}`}
                    style={active ? { background: tag.color, borderColor: tag.color } : {}}
                    onClick={() => toggleTag(String(tag.id))}>
                    {tag.icon && <i className={`${tag.icon} me-1`} />}
                    {tag.name}
                    {tag.price > 0 && <span className="ms-1 opacity-75" style={{ fontSize: "0.75rem" }}>+{Number(tag.price).toLocaleString()}฿</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── มิเตอร์ + การใช้งาน ─── */}
        <div className="detail-section">
          <h6><i className="fas fa-sliders-h me-2" />การตั้งค่า</h6>
          <div className="d-flex flex-column gap-3">
            {[
              { key: "meterElectricActive", label: "มิเตอร์ไฟฟ้า", icon: "fas fa-bolt text-warning" },
              { key: "meterWaterActive", label: "มิเตอร์น้ำ", icon: "fas fa-tint text-info" },
              { key: "isActive", label: "เปิดใช้งานห้อง", icon: "fas fa-door-open text-success" },
            ].map(({ key, label, icon }) => (
              <div key={key} className="d-flex align-items-center justify-content-between">
                <span><i className={`${icon} me-2`} />{label}</span>
                <div className="form-check form-switch mb-0">
                  <input type="checkbox" className="form-check-input" role="switch"
                    checked={(form as any)[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && <div className="alert alert-danger py-2 mb-0">{error}</div>}
      </div>

      <div className="detail-modal-footer">
        <button className="btn btn-outline-secondary" onClick={onBack} disabled={saving}>
          <i className="fas fa-arrow-left me-1" />กลับ
        </button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving
            ? <><span className="spinner-border spinner-border-sm me-2" />กำลังบันทึก...</>
            : <><i className="fas fa-save me-1" />บันทึก</>}
        </button>
      </div>
    </div>
  );
}

// ─── Room Detail View ─────────────────────────────────────────────────────────
function RoomDetailView({
  room, tower, tenant, booking, allRooms, tenants, tags, meterRecords,
  onBack, onPrev, onNext, hasPrev, hasNext, onSelectRoom, onRoomUpdate, onEdit, onTenantsUpdate,
}: {
  room: any; tower: any; tenant: any; booking?: any; allRooms: any[]; tenants: any[]; tags: any[]; meterRecords: any[];
  onBack: () => void; onPrev: () => void; onNext: () => void;
  hasPrev: boolean; hasNext: boolean; onSelectRoom: (r: any) => void;
  onRoomUpdate: (updated: any) => void; onEdit: () => void;
  onTenantsUpdate: (updater: (prev: any[]) => any[]) => void;
}) {
  const { config } = useAppConfig();
  const navigate = useNavigate();
  const pictures = parsePictures(room.pictures);
  const [imgIdx, setImgIdx] = useState(0);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const roomTags: string[] = Array.isArray(room.tags)
    ? room.tags.map((t: any) => (typeof t === "object" && t !== null ? String(t.id ?? "") : String(t)))
    : [];
  const sClass = statusClass(room.status);
  const towerColor = tower?.color || "var(--color-primary)";

  const [showTagModal, setShowTagModal] = useState(false);
  const [pendingTagIds, setPendingTagIds] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);

  const [showTenantModal, setShowTenantModal] = useState(false);
  const [tenantSearch, setTenantSearch] = useState("");
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [savingTenant, setSavingTenant] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [chartRange, setChartRange] = useState<"6m"|"1y"|"all">("6m");
  const [chartMode,  setChartMode]  = useState<"chart"|"table">("chart");

  const chartData = useMemo(() => {
    const sorted = [...meterRecords].sort((a, b) => meterScore(a.monthYear) - meterScore(b.monthYear));

    // เก็บเฉพาะเดือนที่มีข้อมูลของห้องนี้ เรียงตามเวลา
    const roomRows = sorted
      .map((r) => {
        const d = r.data ?? {};
        const rd = d[String(room.number)] ?? d[room.id] ?? null;
        return rd ? { monthYear: r.monthYear, rd } : null;
      })
      .filter((x): x is { monthYear: string; rd: any } => x !== null);

    if (roomRows.length === 0) return [];

    // คำนวณหน่วยจาก sequence เดิมก่อน (prevRd ต้องใช้ index ของ roomRows เต็ม)
    const allMapped = roomRows.map((row, i) => {
      const { monthYear, rd } = row;
      const prevRd = i > 0 ? roomRows[i - 1].rd : null;

      let electric = calcMeterUnits(rd.currElectric, rd.prevElectric);
      if (electric === null && prevRd)
        electric = calcMeterUnits(rd.currElectric, prevRd.currElectric);

      let water = calcMeterUnits(rd.currWater, rd.prevWater);
      if (water === null && prevRd)
        water = calcMeterUnits(rd.currWater, prevRd.currWater);

      return {
        label: meterMonthLabel(monthYear),
        monthYear,
        electric: Math.max(0, electric ?? 0),
        water:    Math.max(0, water    ?? 0),
      };
    });

    // กรองช่วงเวลาหลังจากคำนวณแล้ว
    const limit = chartRange === "6m" ? 6 : chartRange === "1y" ? 12 : Infinity;
    const maxScore = meterScore(roomRows[roomRows.length - 1].monthYear);

    return allMapped.filter((row) => {
      const s = meterScore(row.monthYear);
      return s <= maxScore && maxScore - s < limit;
    });
  }, [meterRecords, room.number, room.id, chartRange, config.yearFormat]);

  function openTenantModal() {
    setSelectedTenantId(tenant?.id ?? null);
    setTenantSearch("");
    setConfirmRemove(false);
    setShowTenantModal(true);
  }

  async function handleAssignTenant() {
    if (!selectedTenantId) return;
    setSavingTenant(true);
    try {
      // ห้องนี้เป็นของผู้เช่าได้แค่คนเดียว — ถ้าห้องนี้ดันเป็น "ห้องเพิ่มเติม" ของผู้เช่าคนอื่นอยู่ ต้องถอดออกก่อน
      const otherWithExtra = tenants.find((t) =>
        t.id !== selectedTenantId &&
        Array.isArray(t.extraRoomIds) &&
        (t.extraRoomIds.includes(room.id) || t.extraRoomIds.includes(room.number))
      );
      if (otherWithExtra) {
        const newExtra = (otherWithExtra.extraRoomIds as string[]).filter((rid) => rid !== room.id && rid !== room.number);
        await tenantsApi.updateExtraRooms(otherWithExtra.id, newExtra);
      }
      await tenantsApi.updateRoom(selectedTenantId, room.id);
      onTenantsUpdate((prev) =>
        prev.map((t) => {
          if (t.id === selectedTenantId) return { ...t, idRoom: room.id };
          if (otherWithExtra && t.id === otherWithExtra.id)
            return { ...t, extraRoomIds: (t.extraRoomIds as string[]).filter((rid) => rid !== room.id && rid !== room.number) };
          if ((t.idRoom === room.id || t.idRoom === room.number) && t.id !== selectedTenantId)
            return { ...t, idRoom: "" };
          return t;
        })
      );
      onRoomUpdate({ ...room, status: "ไม่ว่าง" });
      toastSuccess("บันทึกข้อมูลสำเร็จ");
      setShowTenantModal(false);
    } finally {
      setSavingTenant(false);
    }
  }

  async function handleRemoveTenant() {
    if (!tenant) return;
    setSavingTenant(true);
    try {
      // ห้องนี้อาจเป็นห้องหลักหรือห้องเพิ่มเติมของผู้เช่าคนนี้ก็ได้ ต้องเช็คก่อนว่าจะถอดฝั่งไหน
      const isPrimary = tenant.idRoom === room.id || tenant.idRoom === room.number;
      if (isPrimary) {
        await tenantsApi.updateRoom(tenant.id, "");
        onTenantsUpdate((prev) => prev.map((t) => (t.id === tenant.id ? { ...t, idRoom: "" } : t)));
      } else {
        const newExtra = (Array.isArray(tenant.extraRoomIds) ? tenant.extraRoomIds : []).filter(
          (rid: string) => rid !== room.id && rid !== room.number
        );
        await tenantsApi.updateExtraRooms(tenant.id, newExtra);
        onTenantsUpdate((prev) => prev.map((t) => (t.id === tenant.id ? { ...t, extraRoomIds: newExtra } : t)));
      }
      onRoomUpdate({ ...room, status: "ว่าง" });
      toastSuccess("นำผู้เช่าออกจากห้องสำเร็จ");
      setConfirmRemove(false);
      setShowTenantModal(false);
    } finally {
      setSavingTenant(false);
    }
  }

  function openTagModal() {
    setPendingTagIds(roomTags);
    setShowTagModal(true);
  }

  function toggleTag(id: string) {
    setPendingTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }

  async function handleSaveTags() {
    setSavingTags(true);
    try {
      const updated = await roomsApi.update(room.id, { tags: pendingTagIds });
      onRoomUpdate(updated);
      toastSuccess("บันทึกแท็กสำเร็จ");
      setShowTagModal(false);
    } finally {
      setSavingTags(false);
    }
  }

  return (
    <div className="custom-card page-view" id="tenantDetailEditCard">
      <div className="detail-modal-body">

        {/* ─── Header Navigation ─── */}
        <div className="tenant-detail-profile-header">
          <button className="btn btn-light btn-circle btn-nav" onClick={onPrev} disabled={!hasPrev} title="ห้องก่อนหน้า">
            <i className="fas fa-chevron-left" />
          </button>
          <div className="tenant-detail-profile-center">
            {pictures.length > 0 ? (
              <div style={{ position: "relative", width: 80, height: 80, flexShrink: 0 }}>
                <img
                  src={pictures[imgIdx]?.url}
                  alt={`ห้อง ${room.number}`}
                  style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, cursor: pictures.length > 1 ? "pointer" : "default" }}
                  onClick={() => pictures.length > 1 && setImgIdx((imgIdx + 1) % pictures.length)}
                />
                {pictures.length > 1 && (
                  <span style={{ position: "absolute", bottom: 2, right: 4, fontSize: "0.7rem", color: "#fff", background: "rgba(0,0,0,0.5)", borderRadius: 4, padding: "0 4px" }}>
                    {imgIdx + 1}/{pictures.length}
                  </span>
                )}
              </div>
            ) : (
              <div style={{ width: 80, height: 80, background: towerColor, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: "1.5rem", flexShrink: 0 }}>
                {room.number}
              </div>
            )}
            <div className="profile-info">
              <h4 className="profile-name">ห้อง {room.number}</h4>
              <div className="d-flex align-items-center gap-2 mt-1">
                {tower && (
                  <span className="tower-tag" style={{ backgroundColor: towerColor }}>
                    {tower.prefix || tower.name}
                  </span>
                )}
                <span className={`status-badge ${sClass}`}>{room.status}</span>
              </div>
            </div>
          </div>
          <button className="btn btn-light btn-circle btn-nav" onClick={onNext} disabled={!hasNext} title="ห้องถัดไป">
            <i className="fas fa-chevron-right" />
          </button>
        </div>

        {/* ─── Room Selector ─── */}
        <div className="tenant-selector-wrapper">
          <CustomSelect2
            value={{ value: room.id, label: `ห้อง ${room.number} (${room.status})` }}
            options={allRooms.map((r) => {
              const t = findTenantForRoom(tenants, r);
              return {
                value: r.id,
                label: `ห้อง ${r.number}${t ? ` (${tenantDisplayName(t)})` : ` (${r.status})`}`,
              };
            })}
            onChange={(opt: any) => {
              const found = allRooms.find((r) => String(r.id) === String(opt?.value));
              if (found) onSelectRoom(found);
            }}
            placeholder="ค้นหาหรือเลือกห้องอื่น..."
            isSearchable
          />
        </div>

        {/* ─── Tags ─── */}
        <div className="detail-section">
          <div className="detail-section-header">
            <h6 className="mb-0"><i className="fas fa-tags me-2" />แท็กและสิ่งอำนวยความสะดวก</h6>
            <button className="btn btn-sm btn-outline-primary" onClick={openTagModal}>
              <i className="fas fa-tags me-1" />จัดการแท็ก
            </button>
          </div>
          {(() => {
            const resolved = roomTags.map(tid => tags.find(t => String(t.id) === String(tid))).filter(Boolean);
            return resolved.length > 0 ? (
              <div className="d-flex flex-wrap gap-2">
                {resolved.map((tag: any) => (
                  <span key={tag.id} className="tenant-tag-chip" style={{ "--tag-color": tag.color } as React.CSSProperties}>
                    {tag.icon && <i className={`${tag.icon} me-1`} />}
                    {tag.name}
                    {tag.price > 0 && <span className="tenant-tag-price">+{tag.price.toLocaleString()}฿</span>}
                  </span>
                ))}
              </div>
            ) : (
              <div className="file-view-empty"><i className="fas fa-tag me-2 text-muted" />ยังไม่มีแท็ก</div>
            );
          })()}
        </div>

        {/* ─── Room Info ─── */}
        <div className="detail-section">
          <h6><i className="fas fa-info-circle me-2" />ข้อมูลห้องพัก</h6>
          <div className="detail-grid">
            {tower && (
              <div className="detail-item">
                <i className="fas fa-building" />
                <div><div className="label">ตึก</div><div className="value">{tower.name}</div></div>
              </div>
            )}
            <div className="detail-item">
              <i className="fas fa-layer-group" />
              <div><div className="label">ชั้น</div><div className="value">{room.floor || "-"}</div></div>
            </div>
            <div className="detail-item">
              <i className="fas fa-dollar-sign" />
              <div>
                <div className="label">ราคา/เดือน</div>
                <div className="value">{room.price > 0 ? `${Number(room.price).toLocaleString()} บาท` : <span className="text-muted fst-italic">ไม่มี</span>}</div>
              </div>
            </div>
            <div className="detail-item">
              <i className="fas fa-sun" />
              <div>
                <div className="label">ราคา/วัน</div>
                <div className="value">
                  {room.dailyPrice > 0
                    ? `${Number(room.dailyPrice).toLocaleString()} บาท`
                    : <span className="badge bg-secondary" style={{ fontWeight: 400, fontSize: "0.78rem" }}>ปิดใช้งาน</span>}
                </div>
              </div>
            </div>
            {room.detail && (
              <div className="detail-item" style={{ gridColumn: "1 / -1" }}>
                <i className="fas fa-align-left" />
                <div><div className="label">รายละเอียด</div><div className="value">{room.detail}</div></div>
              </div>
            )}
          </div>
        </div>

        {/* ─── Meter Status ─── */}
        <div className="detail-section">
          <h6><i className="fas fa-tachometer-alt me-2" />มิเตอร์</h6>
          <div className="detail-grid">
            <div className="detail-item">
              <i className="fas fa-bolt text-warning" />
              <div>
                <div className="label">มิเตอร์ไฟฟ้า</div>
                <div className="value">
                  {room.meterElectricActive
                    ? <span className="badge bg-success">เปิดใช้งาน</span>
                    : <span className="badge bg-secondary">ปิดใช้งาน</span>}
                </div>
              </div>
            </div>
            <div className="detail-item">
              <i className="fas fa-tint text-info" />
              <div>
                <div className="label">มิเตอร์น้ำ</div>
                <div className="value">
                  {room.meterWaterActive
                    ? <span className="badge bg-success">เปิดใช้งาน</span>
                    : <span className="badge bg-secondary">ปิดใช้งาน</span>}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Tenant / Status Section ─── */}
        <div className="detail-section">
          <div className="detail-section-header">
            <h6 className="mb-0">
              <i className={`fas ${tenant ? "fa-user-check text-danger" : booking ? "fa-user-clock text-warning" : "fa-door-open text-success"} me-2`} />
              {tenant ? "ผู้เช่าปัจจุบัน" : booking ? "มีผู้จองห้องนี้" : "สถานะห้อง"}
            </h6>
            <button className="btn btn-sm btn-outline-primary" onClick={openTenantModal}>
              <i className={`fas ${tenant ? "fa-exchange-alt" : "fa-user-plus"} me-1`} />
              {tenant ? "เปลี่ยนผู้เช่า" : "เลือกผู้เช่า"}
            </button>
          </div>
          {tenant ? (
            <div className="file-view-container mt-2">
              <div className="file-view-item" style={{ cursor: "pointer" }}
                onClick={() => navigate("/tenants", { state: { subView: "detail", tenantId: tenant.id } })}>
                <i className="fas fa-user file-icon text-primary" />
                <span className="file-name">ผู้เช่า: <strong>{tenantDisplayName(tenant)}</strong></span>
                <i className="fas fa-external-link-alt ms-auto text-muted" style={{ fontSize: "0.75rem" }} />
              </div>
              {tenant.tel && (
                <div className="file-view-item">
                  <i className="fas fa-phone-alt file-icon text-secondary" />
                  <span className="file-name">เบอร์โทร: <strong>{tenant.tel}</strong></span>
                </div>
              )}
              {tenant.contractStartDate && (
                <div className="file-view-item">
                  <i className="fas fa-calendar-alt file-icon text-success" />
                  <span className="file-name">วันเริ่มสัญญา: <strong>{formatThaiDate(tenant.contractStartDate)}</strong></span>
                </div>
              )}
              {tenant.contractEndDate && (
                <div className="file-view-item">
                  <i className="fas fa-calendar-times file-icon text-danger" />
                  <span className="file-name">วันสิ้นสุดสัญญา: <strong>{formatThaiDate(tenant.contractEndDate)}</strong></span>
                </div>
              )}
            </div>
          ) : booking ? (
            <div className="file-view-container mt-2">
              <div className="file-view-item">
                <i className="fas fa-user-clock file-icon text-warning" />
                <span className="file-name">ผู้จอง: <strong>{booking.name}</strong></span>
              </div>
              {booking.tel && (
                <div className="file-view-item">
                  <i className="fas fa-phone-alt file-icon text-secondary" />
                  <span className="file-name">เบอร์โทร: <strong>{booking.tel}</strong></span>
                </div>
              )}
              {booking.bookedAt && (
                <div className="file-view-item">
                  <i className="fas fa-clock file-icon text-muted" />
                  <span className="file-name">จองเมื่อ: <strong>{new Date(booking.bookedAt).toLocaleString("th-TH")}</strong></span>
                </div>
              )}
              {booking.idLine && (
                <div className="file-view-item" style={{ cursor: "pointer" }}
                  onClick={() => navigate("/chat", { state: { openLineUserId: booking.idLine } })}>
                  <i className="fas fa-comment-dots file-icon text-primary" />
                  <span className="file-name">ไปหน้าแชทกับผู้จอง</span>
                  <i className="fas fa-external-link-alt ms-auto text-muted" style={{ fontSize: "0.75rem" }} />
                </div>
              )}
            </div>
          ) : (
            <div className="file-view-empty mt-2">
              <i className="fas fa-door-open me-2 text-success" />
              {room.isActive === false ? "ห้องปิดปรับปรุงชั่วคราว" : "ว่าง — พร้อมให้เช่า"}
            </div>
          )}
        </div>

        {/* ─── Meter History Chart ─── */}
        <div className="detail-section">
          <div className="detail-section-header">
            <h6 className="mb-0">
              <i className="fas fa-chart-bar me-2" style={{ color: "var(--color-primary)" }} />
              ประวัติการจดมิเตอร์
            </h6>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {/* Range */}
              <div className="btn-group btn-group-sm">
                {(["6m","1y","all"] as const).map((r) => (
                  <button key={r} type="button"
                    style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                    className={`btn ${chartRange === r ? "btn-primary" : "btn-outline-secondary"}`}
                    onClick={() => setChartRange(r)}>
                    {r === "6m" ? "6 ด." : r === "1y" ? "1 ปี" : "ทั้งหมด"}
                  </button>
                ))}
              </div>
              {/* Mode */}
              <div className="btn-group btn-group-sm">
                <button type="button"
                  style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                  className={`btn ${chartMode === "chart" ? "btn-primary" : "btn-outline-secondary"}`}
                  onClick={() => setChartMode("chart")}
                  title="กราฟ">
                  <i className="fas fa-chart-bar" />
                </button>
                <button type="button"
                  style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                  className={`btn ${chartMode === "table" ? "btn-primary" : "btn-outline-secondary"}`}
                  onClick={() => setChartMode("table")}
                  title="ตาราง">
                  <i className="fas fa-table" />
                </button>
              </div>
            </div>
          </div>

          {chartData.length === 0 ? (
            <div className="file-view-empty">
              <i className="fas fa-tachometer-alt me-2" style={{ opacity: 0.4 }} />
              ยังไม่มีข้อมูลการจดมิเตอร์สำหรับห้องนี้
            </div>
          ) : chartMode === "chart" ? (
            <div style={{ padding: "4px 0 0" }}>
              <MeterBarChart data={chartData} />
            </div>
          ) : (
            <div className="table-responsive" style={{ marginTop: 4 }}>
              <table className="meter-chart-table">
                <thead>
                  <tr>
                    <th style={{ color: "var(--color-dark-variant)" }}>เดือน/ปี</th>
                    <th className="text-end" style={{ color: "rgba(255, 206, 86, 1)" }}>
                      <i className="fas fa-bolt me-1" />ไฟฟ้า (หน่วย)
                    </th>
                    <th className="text-end" style={{ color: "rgba(54, 162, 235, 1)" }}>
                      <i className="fas fa-tint me-1" />น้ำ (หน่วย)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...chartData].reverse().map((row) => (
                    <tr key={row.monthYear}>
                      <td>{row.label}</td>
                      <td className="text-end" style={{ fontWeight: 600, color: "rgba(255, 206, 86, 1)" }}>{row.electric}</td>
                      <td className="text-end" style={{ fontWeight: 600, color: "rgba(54, 162, 235, 1)" }}>{row.water}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>

      <div className="detail-modal-footer">
        <button className="btn btn-outline-secondary" onClick={onBack}>
          <i className="fas fa-arrow-left me-1" />กลับ
        </button>
        <button className="btn btn-primary" onClick={onEdit}>
          <i className="fas fa-edit me-1" />แก้ไข
        </button>
      </div>

      {showTenantModal && (() => {
        const q = tenantSearch.toLowerCase();
        const filtered = tenants.filter((t) =>
          `${t.firstName} ${t.lastName} ${t.tel ?? ""}`.toLowerCase().includes(q)
        ).sort((a, b) => {
          const aIsHere = tenantOccupiesRoom(a, room);
          const bIsHere = tenantOccupiesRoom(b, room);
          if (aIsHere && !bIsHere) return -1;
          if (!aIsHere && bIsHere) return 1;
          const aFree = !a.idRoom && !(a.extraRoomIds?.length);
          const bFree = !b.idRoom && !(b.extraRoomIds?.length);
          if (aFree && !bFree) return -1;
          if (!aFree && bFree) return 1;
          return 0;
        });
        return (
          <div className="room-modal-overlay" onClick={() => setShowTenantModal(false)}>
            <div className="room-modal" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
              <div className="room-modal-header">
                <div className="room-modal-title">
                  <i className="fas fa-user-plus me-2" />เลือกผู้เช่าสำหรับห้อง {room.number}
                </div>
                <button className="room-modal-close" onClick={() => setShowTenantModal(false)}>
                  <i className="fas fa-times" />
                </button>
              </div>
              <div className="room-modal-body" style={{ padding: "1rem 1.5rem" }}>
                <div className="search-container mb-3">
                  <i className="fas fa-search" />
                  <input autoFocus type="text" className="form-control"
                    placeholder="ค้นหาชื่อหรือเบอร์โทร..."
                    value={tenantSearch}
                    onChange={(e) => setTenantSearch(e.target.value)} />
                </div>
                <div className="nicescrollbar" style={{ maxHeight: 320, overflowY: "auto" }}>
                  {filtered.length === 0 ? (
                    <div className="text-center text-muted py-4">
                      <i className="fas fa-user-slash fa-2x mb-2 d-block opacity-25" />ไม่พบผู้เช่า
                    </div>
                  ) : (
                    <div className="tmv-list">
                      {filtered.map((t) => {
                        const isHere = tenantOccupiesRoom(t, room);
                        const otherRooms = roomsOfTenant(t, allRooms).filter((r) => r.id !== room.id && r.number !== room.number);
                        const hasOtherRoom = otherRooms.length > 0;
                        const isSelected = selectedTenantId === t.id;
                        return (
                          <div key={t.id}
                            className={`tower-item${isSelected ? " tower-item--active" : ""}`}
                            style={{ cursor: "pointer", borderLeftColor: isHere ? "var(--color-success)" : isSelected ? "var(--color-primary)" : undefined }}
                            onClick={() => setSelectedTenantId(isSelected ? null : t.id)}>
                            <div className="tower-item-info" style={{ gap: "0.5rem" }}>
                              <div style={{ width: 36, height: 36, borderRadius: "50%", background: isHere ? "var(--color-success)" : "var(--color-primary)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: "0.9rem", flexShrink: 0 }}>
                                {t.firstName?.[0]}{t.lastName?.[0]}
                              </div>
                              <div className="tower-item-name">
                                <div><strong>{tenantDisplayName(t)}</strong></div>
                                <div style={{ fontSize: "0.8rem", color: "var(--color-dark-variant)" }}>
                                  {t.tel && <span><i className="fas fa-phone me-1" />{t.tel}</span>}
                                  {isHere && <span className="ms-2 text-success"><i className="fas fa-check-circle me-1" />อยู่ในห้องนี้</span>}
                                  {hasOtherRoom && <span className="ms-2 text-warning"><i className="fas fa-door-open me-1" />ห้อง {otherRooms.map((r) => r.number).join(", ")}</span>}
                                  {!t.idRoom && !(t.extraRoomIds?.length) && <span className="ms-2 text-muted"><i className="fas fa-minus-circle me-1" />ไม่มีห้อง</span>}
                                </div>
                              </div>
                            </div>
                            {isSelected && <i className="fas fa-check-circle text-primary ms-2" style={{ flexShrink: 0 }} />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                {tenant && (
                  <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--color-light)" }}>
                    {!confirmRemove ? (
                      <button className="btn btn-sm btn-outline-danger w-100" onClick={() => setConfirmRemove(true)}>
                        <i className="fas fa-user-times me-1" />นำผู้เช่าออกจากห้องนี้
                      </button>
                    ) : (
                      <div className="d-flex align-items-center gap-2">
                        <span className="text-danger small flex-grow-1">
                          <i className="fas fa-exclamation-triangle me-1" />ยืนยันนำ <strong>{tenant.firstName}</strong> ออกจากห้องนี้?
                        </span>
                        <button className="btn btn-sm btn-outline-secondary" onClick={() => setConfirmRemove(false)} disabled={savingTenant}>ยกเลิก</button>
                        <button className="btn btn-sm btn-danger" onClick={handleRemoveTenant} disabled={savingTenant}>
                          {savingTenant ? <span className="spinner-border spinner-border-sm" /> : "ยืนยัน"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="room-modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowTenantModal(false)} disabled={savingTenant}>
                  ยกเลิก
                </button>
                <button className="btn btn-primary" onClick={handleAssignTenant}
                  disabled={savingTenant || !selectedTenantId || selectedTenantId === tenant?.id}>
                  {savingTenant
                    ? <><span className="spinner-border spinner-border-sm me-2" />กำลังบันทึก...</>
                    : <><i className="fas fa-save me-1" />ยืนยันเลือกผู้เช่า</>}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showTagModal && (
        <div className="room-modal-overlay" onClick={() => setShowTagModal(false)}>
          <div className="room-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="room-modal-header">
              <div className="room-modal-title">
                <i className="fas fa-tags me-2" />จัดการแท็กห้อง {room.number}
              </div>
              <button className="room-modal-close" onClick={() => setShowTagModal(false)}>
                <i className="fas fa-times" />
              </button>
            </div>
            <div className="room-modal-body" style={{ padding: "1.25rem 1.5rem" }}>
              {tags.length === 0 ? (
                <div className="room-modal-empty"><i className="fas fa-tag me-2" />ยังไม่มีแท็กในระบบ</div>
              ) : (
                <div className="tag-picker-grid">
                  {tags.map((tag) => {
                    const selected = pendingTagIds.includes(String(tag.id));
                    return (
                      <div
                        key={tag.id}
                        className={`tag-picker-card${selected ? " tag-picker-card--selected" : ""}`}
                        style={selected ? { "--tag-color": tag.color } as React.CSSProperties : {}}
                        onClick={() => toggleTag(String(tag.id))}
                      >
                        <div className="tag-picker-icon" style={{ color: tag.color }}>
                          <i className={tag.icon || "fas fa-tag"} />
                        </div>
                        <div className="tag-picker-info">
                          <div className="tag-picker-name">{tag.name}</div>
                          {tag.price > 0 && (
                            <div className="tag-picker-price">+{Number(tag.price).toLocaleString()} ฿/เดือน</div>
                          )}
                        </div>
                        <div className="tag-picker-check">
                          {selected && <i className="fas fa-check-circle" style={{ color: tag.color }} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="room-modal-footer">
              <span className="text-muted me-auto" style={{ fontSize: "0.85rem" }}>
                เลือก {pendingTagIds.length} แท็ก
              </span>
              <button className="btn btn-outline-secondary" onClick={() => setShowTagModal(false)} disabled={savingTags}>
                ยกเลิก
              </button>
              <button className="btn btn-primary" onClick={handleSaveTags} disabled={savingTags}>
                {savingTags
                  ? <><span className="spinner-border spinner-border-sm me-2" />กำลังบันทึก...</>
                  : <><i className="fas fa-save me-1" />บันทึก</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Import ห้องพักจาก CSV ──────────────────────────────────────────────────────
interface RoomCsvRow {
  number: string; towerName: string; floor: string;
  price: string; dailyPrice: string; detail: string; status: string; code: string;
}

// รูปแบบ: เลขห้อง,ตึก,ชั้น,ราคา/เดือน,ราคา/วัน,รายละเอียด,สถานะ,รหัสห้อง
function parseRoomCsv(text: string): RoomCsvRow[] {
  const rows: RoomCsvRow[] = [];
  const lines = text.split(/\r?\n/).filter(Boolean);
  const start = /^\d/.test(lines[0]?.replace(/^﻿/, "").trim()) ? 0 : 1;
  for (let i = start; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.replace(/^"|"$/g, "").trim());
    if (!cols[0]) continue;
    rows.push({
      number: cols[0] ?? "",
      towerName: cols[1] ?? "",
      floor: cols[2] ?? "",
      price: cols[3] ?? "",
      dailyPrice: cols[4] ?? "",
      detail: cols[5] ?? "",
      status: cols[6] ?? "",
      code: cols[7] ?? "",
    });
  }
  return rows;
}

function resolveRoomTower(towers: any[], name: string): any | null {
  const q = name.trim().toLowerCase();
  if (!q) return null;
  return towers.find((t) => t.name?.toLowerCase() === q || t.prefix?.toLowerCase() === q) ?? null;
}

function RoomImportModal({ file, existingRooms, towers, onClose, onImport }: {
  file: File; existingRooms: any[]; towers: any[];
  onClose: () => void;
  onImport: (rows: { row: RoomCsvRow; towerId: string }[]) => void;
}) {
  const [rows, setRows] = useState<RoomCsvRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseRoomCsv(text);
      setRows(parsed);
      setSelected(new Set(
        parsed
          .map((r, i) => ({ r, i }))
          .filter(({ r }) => !existingRooms.some((er) => er.number === r.number))
          .map(({ i }) => i)
      ));
      setLoading(false);
    };
    reader.readAsText(file);
  }, [file]);

  function toggle(i: number) {
    setSelected((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });
  }

  const selectedRows = rows.map((row, i) => ({ row, i })).filter(({ i }) => selected.has(i));

  return (
    <div className="confirm-overlay" onClick={onClose}>
      <div className="confirm-dialog" style={{ maxWidth: 560, width: "90%", textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
        <div className="d-flex align-items-center gap-2 mb-3">
          <i className="fas fa-file-import text-primary" style={{ fontSize: "1.4rem" }} />
          <h6 className="confirm-title mb-0" style={{ textAlign: "left" }}>เลือกห้องที่ต้องการนำเข้า</h6>
        </div>

        {loading ? (
          <div className="text-center p-4"><div className="spinner-border spinner-border-sm" style={{ color: "var(--color-primary)" }} /></div>
        ) : rows.length === 0 ? (
          <p className="text-muted text-center">ไม่พบข้อมูลในไฟล์ CSV</p>
        ) : (
          <>
            <div style={{ background: "var(--color-background)", border: "1px solid var(--color-light)", borderRadius: "var(--border-radius-1)", padding: "6px 10px", marginBottom: 10, fontSize: "0.78rem", color: "var(--color-dark-variant)", fontFamily: "monospace" }}>
              <i className="fas fa-info-circle me-1" style={{ fontFamily: "inherit" }} />
              รูปแบบ: เลขห้อง, ตึก, ชั้น, ราคา/เดือน, ราคา/วัน, รายละเอียด, สถานะ, รหัสห้อง
              <span className="ms-2" style={{ opacity: 0.7 }}>เช่น&nbsp;&nbsp;101,อาพาท์เมต,1,2000,500,,ว่าง,</span>
            </div>
            <div className="nicescrollbar" style={{ maxHeight: 320, overflowY: "auto", border: "1px solid var(--color-light)", borderRadius: "var(--border-radius-1)", padding: "0.5rem" }}>
              {rows.map((row, i) => {
                const exists = existingRooms.some((r) => r.number === row.number);
                const tower = resolveRoomTower(towers, row.towerName);
                return (
                  <label key={i}
                    className="d-flex align-items-center gap-2 p-2"
                    style={{ cursor: exists ? "not-allowed" : "pointer", opacity: exists ? 0.5 : 1, borderRadius: "var(--border-radius-1)" }}>
                    <input type="checkbox" className="form-check-input"
                      checked={selected.has(i) && !exists}
                      disabled={exists}
                      onChange={() => toggle(i)} />
                    <span className="flex-grow-1">
                      <strong>ห้อง {row.number || "-"}</strong>
                      <small className="text-muted ms-2">
                        {tower ? tower.name : row.towerName ? `ไม่พบตึก "${row.towerName}"` : "ไม่ระบุตึก"}
                        {row.price && ` · ${row.price} ฿/เดือน`}
                      </small>
                    </span>
                    {exists && <span className="badge bg-warning text-dark" style={{ fontSize: "0.72rem" }}>มีอยู่แล้ว</span>}
                  </label>
                );
              })}
            </div>
            <p className="mt-2 mb-0" style={{ fontSize: "0.82rem", color: "var(--color-info-dark)" }}>
              เลือก {selectedRows.length} ห้อง
            </p>
          </>
        )}

        <div className="confirm-actions mt-3">
          <button className="btn btn-outline-secondary" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={selectedRows.length === 0 || loading}
            onClick={() => onImport(selectedRows.map(({ row }) => ({ row, towerId: resolveRoomTower(towers, row.towerName)?.id ?? "" })))}>
            <i className="fas fa-file-import me-1" />ยืนยันนำเข้า ({selectedRows.length} ห้อง)
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function RoomsPage() {
  const [rooms, setRooms] = useState<any[]>([]);
  const [towers, setTowers] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [tags, setTags] = useState<any[]>([]);
  const [meterRecords, setMeterRecords] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("number_asc");
  const [towerFilter, setTowerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const { setBreadcrumb } = useBreadcrumb();
  const [view, setView] = usePersistedViewMode<ViewMode>("rooms", "grid", ["list", "grid", "table"]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  // Import CSV
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importDragOver, setImportDragOver] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Export CSV
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportSelectedIds, setExportSelectedIds] = useState<Set<string>>(new Set());

  const navState = (location.state as { subView?: string; roomId?: string }) ?? {};
  const subView = navState.subView ?? "list";

  const detailRoom = navState.roomId
    ? rooms.find((r) => String(r.id) === String(navState.roomId)) ?? null
    : null;

  function goToList() {
    navigate("/rooms", { state: { subView: "list" } });
  }

  function goToDetail(room: any) {
    window.scrollTo(0, 0);
    navigate("/rooms", { state: { subView: "detail", roomId: room.id } });
  }

  const [towerSubtitle, setTowerSubtitle] = useState<string | null>(null);
  const towerGoToDashboardRef = useRef<(() => void) | null>(null);

  function goToTowers() {
    window.scrollTo(0, 0);
    setTowerSubtitle(null);
    navigate("/rooms", { state: { subView: "towers" } });
  }

  function goToEdit(room: any) {
    window.scrollTo(0, 0);
    navigate("/rooms", { state: { subView: "edit", roomId: room.id } });
  }

  function goToTags() {
    window.scrollTo(0, 0);
    navigate("/rooms", { state: { subView: "tags" } });
  }

  // Sync breadcrumbs
  useEffect(() => {
    if (subView === "detail" && detailRoom) {
      setBreadcrumb([
        { label: "จัดการห้องพัก", onClick: goToList },
        { label: `ห้อง ${detailRoom.number}` },
      ]);
    } else if (subView === "towers") {
      setBreadcrumb([
        { label: "จัดการห้องพัก", onClick: goToList },
        { label: "จัดการตึกและห้องพัก", onClick: towerSubtitle ? () => { setTowerSubtitle(null); towerGoToDashboardRef.current?.(); } : undefined },
        ...(towerSubtitle ? [{ label: towerSubtitle }] : []),
      ]);
    } else if (subView === "edit" && detailRoom) {
      setBreadcrumb([
        { label: "จัดการห้องพัก", onClick: goToList },
        { label: `ห้อง ${detailRoom.number}`, onClick: () => goToDetail(detailRoom) },
        { label: "แก้ไข" },
      ]);
    } else if (subView === "tags") {
      setBreadcrumb([
        { label: "จัดการห้องพัก", onClick: goToList },
        { label: "จัดการแท็ก" },
      ]);
    } else {
      setBreadcrumb([{ label: "จัดการห้องพัก" }]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subView, detailRoom?.id, towerSubtitle]);

  useEffect(() => {
    Promise.all([roomsApi.getAll(), roomsApi.getTowers(), tenantsApi.getAll(), roomsApi.getTags(), metersApi.getAll(), roomsApi.activeBookings()])
      .then(([r, t, ten, tg, mr, bk]) => { setRooms(r); setTowers(t); setTenants(ten); setTags(tg); setMeterRecords(mr); setBookings(bk); })
      .finally(() => setLoading(false));
    return () => setBreadcrumb([]);
  }, []);

  // มีคนอื่นแก้ไขห้อง/ตึก/แท็กห้อง/ผู้เช่า/มิเตอร์/การจองที่เครื่องอื่น (WebSocket แจ้งมา) — โหลดข้อมูลใหม่เงียบๆ
  // ไม่ต้องเปิด loading spinner ทับหน้าเดิม (ข้าม tick แรกที่ 0 เพราะ effect ด้านบนโหลดตอน mount ไปแล้ว)
  const roomsLiveTick = useLiveRefreshTick(["room", "tower", "room-tag", "tenant", "meter"]);
  useEffect(() => {
    if (roomsLiveTick === 0) return;
    Promise.all([roomsApi.getAll(), roomsApi.getTowers(), tenantsApi.getAll(), roomsApi.getTags(), metersApi.getAll(), roomsApi.activeBookings()])
      .then(([r, t, ten, tg, mr, bk]) => { setRooms(r); setTowers(t); setTenants(ten); setTags(tg); setMeterRecords(mr); setBookings(bk); });
  }, [roomsLiveTick]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let list = rooms.filter((r) => {
      const tenant = findTenantForRoom(tenants, r);
      const matchSearch = `${r.number} ${r.code} ${r.detail} ${tenant?.firstName ?? ""} ${tenant?.lastName ?? ""}`.toLowerCase().includes(q);
      const matchTower = !towerFilter || r.towerId === towerFilter;
      const matchStatus = !statusFilter || r.status === statusFilter;
      return matchSearch && matchTower && matchStatus;
    });
    switch (sort) {
      case "number_asc": list = [...list].sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true })); break;
      case "number_desc": list = [...list].sort((a, b) => String(b.number).localeCompare(String(a.number), undefined, { numeric: true })); break;
      case "price_asc": list = [...list].sort((a, b) => a.price - b.price); break;
      case "price_desc": list = [...list].sort((a, b) => b.price - a.price); break;
    }
    return list;
  }, [rooms, tenants, search, sort, towerFilter, statusFilter]);

  function downloadRoomCsvTemplate() {
    const lines: string[] = ["เลขห้อง,ตึก,ชั้น,ราคา/เดือน,ราคา/วัน,รายละเอียด,สถานะ,รหัสห้อง"];
    lines.push(`101,${towers[0]?.name ?? "ชื่อตึก"},1,2000,500,,ว่าง,`);
    const csv = "﻿" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "room_template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function openExportDialog() {
    setExportSelectedIds(new Set(rooms.map((r) => r.id)));
    setShowExportDialog(true);
  }

  // Export ตามรูปแบบเดียวกับ Import — นำไฟล์ที่ export ได้กลับไป Import ใหม่ได้เลย
  function doExportRooms() {
    const sorted = rooms
      .filter((r) => exportSelectedIds.has(r.id))
      .sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true, sensitivity: "base" }));
    const lines: string[] = ["เลขห้อง,ตึก,ชั้น,ราคา/เดือน,ราคา/วัน,รายละเอียด,สถานะ,รหัสห้อง"];
    sorted.forEach((r) => {
      const tower = towers.find((t) => t.id === r.towerId);
      lines.push([
        r.number ?? "",
        tower?.name ?? "",
        r.floor ?? "",
        r.price ?? 0,
        r.dailyPrice ?? 0,
        String(r.detail ?? "").replace(/,/g, " "),
        r.status ?? "",
        r.code ?? "",
      ].join(","));
    });
    const csv = "﻿" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `room_export_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowExportDialog(false);
  }

  async function handleRoomImportConfirm(selectedRows: { row: RoomCsvRow; towerId: string }[]) {
    setImportFile(null);
    setImporting(true);
    try {
      const created: any[] = [];
      for (const { row, towerId } of selectedRows) {
        const newRoom = await roomsApi.create({
          number: row.number,
          floor: row.floor,
          towerId,
          price: Number(row.price) || 0,
          dailyPrice: Number(row.dailyPrice) || 0,
          detail: row.detail,
          code: row.code,
          status: ROOM_STATUSES.includes(row.status) ? row.status : "ว่าง",
        });
        created.push(newRoom);
      }
      setRooms((prev) => [...prev, ...created]);
      toastSuccess("นำเข้าข้อมูลห้องพักสำเร็จ");
    } catch (e: any) {
      const msg = "เกิดข้อผิดพลาดในการนำเข้า: " + (e?.response?.data?.error ?? e?.message ?? "Unknown error");
      toastError(msg);
    } finally {
      setImporting(false);
    }
  }

  // Edit view
  if (subView === "edit" && detailRoom) {
    return (
      <RoomEditView
        room={detailRoom}
        towers={towers}
        allTags={tags}
        onBack={() => goToDetail(detailRoom)}
        onSaved={(updated) => {
          setRooms((prev) => prev.map((r) => r.id === updated.id ? updated : r));
          goToDetail(updated);
        }}
      />
    );
  }

  // Tags management view
  if (subView === "tags") {
    return (
      <RoomTagManagementView
        tags={tags}
        onTagsChange={setTags}
        onBack={goToList}
      />
    );
  }

  // Towers management view
  if (subView === "towers") {
    return (
      <TowerManagement
        towers={towers}
        allRooms={rooms}
        tenants={tenants}
        onClose={goToList}
        onTowersUpdate={setTowers}
        onRoomsUpdate={setRooms}
        onTenantsUpdate={(updater) => setTenants(updater)}
        onSubtitleChange={(label) => setTowerSubtitle(label)}
        registerGoToDashboard={(fn) => { towerGoToDashboardRef.current = fn; }}
      />
    );
  }

  // Detail view
  if (subView === "detail" && detailRoom) {
    const tower = towers.find((t) => t.id === detailRoom.towerId);
    const tenant = findTenantForRoom(tenants, detailRoom);
    const booking = findBookingForRoom(bookings, detailRoom);
    const detailIndex = filtered.findIndex((r) => r.id === detailRoom.id);
    return (
      <RoomDetailView
        room={detailRoom}
        tower={tower}
        tenant={tenant}
        booking={booking}
        allRooms={filtered}
        tenants={tenants}
        tags={tags}
        meterRecords={meterRecords}
        onBack={goToList}
        onPrev={() => detailIndex > 0 && goToDetail(filtered[detailIndex - 1])}
        onNext={() => detailIndex < filtered.length - 1 && goToDetail(filtered[detailIndex + 1])}
        hasPrev={detailIndex > 0}
        hasNext={detailIndex < filtered.length - 1}
        onSelectRoom={goToDetail}
        onRoomUpdate={(updated) => setRooms((prev) => prev.map((r) => r.id === updated.id ? updated : r))}
        onTenantsUpdate={(updater) => setTenants(updater)}
        onEdit={() => goToEdit(detailRoom)}
      />
    );
  }

  const towerOptions = [
    { value: "", label: "ทั้งหมด (ตึก)" },
    ...towers.map((t) => ({ value: t.id, label: t.name })),
  ];
  const statusOptions = [
    { value: "", label: "ทั้งหมด (สถานะ)" },
    ...ROOM_STATUSES.map((s) => ({ value: s, label: s })),
  ];

  return (
    <div id="roomListCard" className="custom-card page-view">
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-3 page-list-toolbar">
        <h5 className="form-section-title mb-0" style={{ borderBottom: "none" }}>รายการห้องพักทั้งหมด</h5>
        <ToolbarActionsMenu>
          <input ref={importInputRef} type="file" accept=".csv" className="d-none"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) { setShowImportDialog(false); setImportFile(f); }
              e.target.value = "";
            }} />
          <button type="button" id="exportRoomBtn" className="btn btn-outline-secondary d-inline-flex align-items-center"
            onClick={openExportDialog} disabled={rooms.length === 0}>
            <i className="fas fa-file-export me-2" /><span className="btn-text">Export</span>
          </button>
          <button type="button" id="importRoomBtn" className="btn btn-outline-secondary d-inline-flex align-items-center"
            disabled={importing} onClick={() => setShowImportDialog(true)}>
            {importing
              ? <><span className="spinner-border spinner-border-sm me-2" />กำลังนำเข้า...</>
              : <><i className="fas fa-file-import me-2" /><span className="btn-text">Import</span></>}
          </button>
          <button type="button" className="btn btn-info d-inline-flex align-items-center" onClick={goToTags}>
            <i className="fas fa-tags me-2" />จัดการแท็ก
          </button>
          <button type="button" className="btn btn-primary d-inline-flex align-items-center" onClick={goToTowers}>
            <i className="fas fa-building me-2" />จัดการตึกและห้องพัก
          </button>
        </ToolbarActionsMenu>
      </div>

      <div className="row g-2 mb-3 align-items-center">
        <div className="col-12 col-lg">
          <div className="search-container">
            <i className="fas fa-search" />
            <input type="text" className="form-control" placeholder="ค้นหาด้วยเลขห้อง, ชื่อผู้เช่า..."
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="col-12 col-md-auto" style={{ minWidth: 170 }}>
          <CustomSelect2
            inputId="towerFilterRoom"
            value={towerOptions.find((o) => o.value === towerFilter) ?? towerOptions[0]}
            options={towerOptions}
            onChange={(opt: any) => setTowerFilter(opt?.value ?? "")}
            isSearchable={false}
            placeholder="ทั้งหมด (ตึก)"
          />
        </div>
        <div className="col-12 col-md-auto" style={{ minWidth: 170 }}>
          <CustomSelect2
            inputId="statusFilterRoom"
            value={statusOptions.find((o) => o.value === statusFilter) ?? statusOptions[0]}
            options={statusOptions}
            onChange={(opt: any) => setStatusFilter(opt?.value ?? "")}
            isSearchable={false}
            placeholder="ทั้งหมด (สถานะ)"
          />
        </div>
        <div className="col-12 col-md-auto">
          <CustomSelect2
            inputId="sortRoom"
            value={{ value: sort, label: { number_asc: "เลขห้อง (น้อย-มาก)", number_desc: "เลขห้อง (มาก-น้อย)", price_asc: "ราคา (น้อย-มาก)", price_desc: "ราคา (มาก-น้อย)" }[sort] }}
            options={[
              { value: "number_asc", label: "เลขห้อง (น้อย-มาก)" },
              { value: "number_desc", label: "เลขห้อง (มาก-น้อย)" },
              { value: "price_asc", label: "ราคา (น้อย-มาก)" },
              { value: "price_desc", label: "ราคา (มาก-น้อย)" },
            ]}
            onChange={(opt: any) => setSort(opt?.value)}
            isSearchable={false}
          />
        </div>
        <div className="col-12 col-md-auto">
          <div className="d-flex align-items-center flex-shrink-0 gap-2">
            <div className="btn-group view-switch-group" role="group">
              {(["list", "grid", "table"] as ViewMode[]).map((v) => (
                <button key={v} type="button"
                  className={`btn btn-outline-secondary view-btn-room${view === v ? " active" : ""}`}
                  onClick={() => setView(v)}>
                  <i className={`fas fa-${v === "list" ? "list" : v === "grid" ? "th-large" : "table"}`} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div id="roomListContainer" className="nicescrollbar" style={{ maxHeight: 650, overflow: "auto" }}>
      {loading ? (
        <div className="text-center p-5"><div className="spinner-border" style={{ color: "var(--color-primary)" }} /></div>
      ) : view === "grid" ? (
        <div className="room-grid">
          {filtered.map((room) => {
            const tower = towers.find((t) => t.id === room.towerId);
            const tenant = findTenantForRoom(tenants, room);
            const booking = !tenant ? findBookingForRoom(bookings, room) : null;
            const sClass = statusClass(room.status);
            return (
              <div key={room.id} className={`room-card${!room.isActive ? " is-inactive" : ""}`}
                style={{ cursor: "pointer" }} onClick={() => goToDetail(room)}>
                <div className="room-card-header">
                  <h5>ห้อง {room.number}</h5>
                  <div className="d-flex align-items-center gap-2">
                    {tower && (
                      <span className="tower-tag" style={{ backgroundColor: tower.color || "var(--color-primary)" }}>
                        {tower.prefix || tower.name}
                      </span>
                    )}
                    <span className={`status-badge ${sClass}`}>{room.status}</span>
                  </div>
                </div>
                <div className="room-card-body">
                  <div className="room-card-info-grid">
                    <div className="room-card-info-item">
                      <span className="label">ราคา/เดือน</span>
                      <span className="value">{room.price > 0 ? `${room.price.toLocaleString()} ฿` : "-"}</span>
                    </div>
                    <div className="room-card-info-item">
                      <span className="label">ชั้น</span>
                      <span className="value">{room.floor || "-"}</span>
                    </div>
                    {room.dailyPrice > 0 && (
                      <div className="room-card-info-item">
                        <span className="label">ราคา/วัน</span>
                        <span className="value">{room.dailyPrice.toLocaleString()} ฿</span>
                      </div>
                    )}
                    {room.detail && (
                      <div className="room-card-info-item" style={{ gridColumn: "span 2" }}>
                        <span className="label">รายละเอียด</span>
                        <span className="value">{room.detail}</span>
                      </div>
                    )}
                  </div>
                  {tenant ? (
                    <div className="room-card-tenant-info">
                      <p><i className="fas fa-user" />{tenantDisplayName(tenant)}</p>
                      {tenant.tel && <p style={{ marginTop: "0.3rem" }}><i className="fas fa-phone" />{tenant.tel}</p>}
                    </div>
                  ) : booking ? (
                    <div className="room-card-tenant-info d-flex align-items-center justify-content-between">
                      <div>
                        <p><i className="fas fa-user-clock" />ผู้จอง: {booking.name}</p>
                        {booking.tel && <p style={{ marginTop: "0.3rem" }}><i className="fas fa-phone" />{booking.tel}</p>}
                      </div>
                      {booking.idLine && (
                        <button type="button" className="btn btn-sm btn-outline-primary flex-shrink-0"
                          title="ไปหน้าแชท"
                          onClick={(e) => { e.stopPropagation(); navigate("/chat", { state: { openLineUserId: booking.idLine } }); }}>
                          <i className="fas fa-comment-dots" />
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="room-card-tenant-info">
                      <p><i className="fas fa-door-open" />ว่าง - พร้อมให้เช่า</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="w-100"><EmptyState icon="fa-door-open" text="ไม่พบข้อมูลห้องพักที่ตรงกัน" /></div>
          )}
        </div>
      ) : view === "table" ? (
        <RoomTableView
          data={filtered}
          allRooms={rooms}
          towers={towers}
          tenants={tenants}
          bookings={bookings}
          onViewDetail={goToDetail}
          onEdit={goToEdit}
          onDelete={async (room) => {
            await roomsApi.delete(room.id);
            setRooms((prev) => prev.filter((r) => r.id !== room.id));
          }}
          onDeleteBulk={async (roomsToDelete) => {
            await roomsApi.bulkDelete(roomsToDelete.map((r) => r.id));
            const ids = new Set(roomsToDelete.map((r) => r.id));
            setRooms((prev) => prev.filter((r) => !ids.has(r.id)));
          }}
          onRoomUpdate={(updated) => setRooms((prev) => prev.map((r) => r.id === updated.id ? updated : r))}
          onTenantsUpdate={(updater) => setTenants(updater)}
        />
      ) : (
        <div>
          {filtered.map((room) => {
            const tower = towers.find((t) => t.id === room.towerId);
            const tenant = findTenantForRoom(tenants, room);
            const booking = !tenant ? findBookingForRoom(bookings, room) : null;
            return (
              <div key={room.id}
                className="d-flex align-items-center gap-3 p-3"
                style={{ borderBottom: "1px solid var(--color-light)", cursor: "pointer" }}
                onClick={() => goToDetail(room)}>
                <div style={{ width: 60, height: 60, background: tower?.color || "var(--color-primary)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: "1.1rem", flexShrink: 0 }}>
                  {room.number}
                </div>
                <div className="flex-grow-1">
                  <div className="d-flex align-items-center gap-2">
                    <strong>ห้อง {room.number}</strong>
                    <span className={`status-badge ${statusClass(room.status)}`}>{room.status}</span>
                  </div>
                  <small className="text-muted">{tower?.name || ""} {room.detail ? `• ${room.detail}` : ""}</small>
                </div>
                <div className="text-end">
                  <div style={{ fontWeight: 600, color: "var(--color-primary)" }}>
                    {room.price > 0 ? `${room.price.toLocaleString()} ฿/เดือน` : ""}
                    {room.dailyPrice > 0 && <span style={{ fontWeight: 400, fontSize: "0.82rem", color: "var(--color-dark-variant)", display: "block" }}>{room.dailyPrice.toLocaleString()} ฿/วัน</span>}
                  </div>
                  <small className="text-muted">{tenant ? tenantDisplayName(tenant) : booking ? `ผู้จอง: ${booking.name}` : "ว่าง"}</small>
                </div>
                {booking?.idLine && (
                  <button type="button" className="btn btn-sm btn-outline-primary flex-shrink-0"
                    title="ไปหน้าแชท"
                    onClick={(e) => { e.stopPropagation(); navigate("/chat", { state: { openLineUserId: booking.idLine } }); }}>
                    <i className="fas fa-comment-dots" />
                  </button>
                )}
                <i className="fas fa-chevron-right text-muted" />
              </div>
            );
          })}
          {filtered.length === 0 && (
            <EmptyState icon="fa-door-open" text="ไม่พบข้อมูลห้องพักที่ตรงกัน" />
          )}
        </div>
      )}
      </div>

      {/* Import Drop Dialog */}
      {showImportDialog && (
        <div className="confirm-overlay" onClick={() => setShowImportDialog(false)}>
          <div className="import-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="import-dialog-header">
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div className="import-dialog-icon">
                  <i className="fas fa-file-csv" />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--color-dark)", lineHeight: 1.3 }}>นำเข้าข้อมูลห้องพัก</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--color-dark-variant)" }}>รองรับไฟล์ .CSV เท่านั้น</div>
                </div>
              </div>
              <button className="import-dialog-close" onClick={() => setShowImportDialog(false)}>
                <i className="fas fa-times" />
              </button>
            </div>

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
              <button className="import-template-card" onClick={downloadRoomCsvTemplate}>
                <div className="import-template-icon">
                  <i className="fas fa-download" />
                </div>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontWeight: 600, fontSize: "0.88rem", color: "var(--color-dark)" }}>ดาวน์โหลด Template CSV</div>
                  <div style={{ fontSize: "0.76rem", color: "var(--color-dark-variant)", marginTop: 2 }}>
                    ไฟล์ตัวอย่างพร้อมหัวคอลัมน์ที่รองรับ
                  </div>
                </div>
                <i className="fas fa-chevron-right ms-auto" style={{ color: "var(--color-dark-variant)", fontSize: "0.75rem", flexShrink: 0 }} />
              </button>

              {/* Format hint */}
              <div className="import-format-hint">
                <i className="fas fa-info-circle" style={{ flexShrink: 0 }} />
                <span>คอลัมน์: <strong>เลขห้อง, ตึก, ชั้น, ราคา/เดือน, ราคา/วัน, รายละเอียด, สถานะ, รหัสห้อง</strong>&nbsp;&nbsp;<code>101,อาพาท์เมต,1,2000,500,,ว่าง,</code></span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal (เลือกห้องที่จะนำเข้า) */}
      {importFile && (
        <RoomImportModal
          file={importFile}
          existingRooms={rooms}
          towers={towers}
          onClose={() => setImportFile(null)}
          onImport={handleRoomImportConfirm}
        />
      )}

      {/* Export Dialog */}
      {showExportDialog && (() => {
        const sortedRooms = [...rooms].sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true, sensitivity: "base" }));
        const allSelected = sortedRooms.every((r) => exportSelectedIds.has(r.id));
        return (
          <div className="confirm-overlay" onClick={() => setShowExportDialog(false)}>
            <div className="import-dialog" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
              <div className="import-dialog-header">
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div className="import-dialog-icon" style={{ background: "linear-gradient(135deg,rgba(76,175,80,0.2),rgba(76,175,80,0.08))", borderColor: "rgba(76,175,80,0.25)", color: "#4caf50" }}>
                    <i className="fas fa-file-export" />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--color-dark)", lineHeight: 1.3 }}>ส่งออกข้อมูลห้องพัก</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--color-dark-variant)" }}>เลือกห้องที่ต้องการส่งออก</div>
                  </div>
                </div>
                <button className="import-dialog-close" onClick={() => setShowExportDialog(false)}>
                  <i className="fas fa-times" />
                </button>
              </div>

              <div className="import-dialog-body">
                <div style={{ fontSize: "0.75rem", color: "var(--color-dark-variant)", padding: "0 2px" }}>
                  <i className="fas fa-info-circle me-1" />เลขห้อง, ตึก, ชั้น, ราคา/เดือน, ราคา/วัน, รายละเอียด, สถานะ, รหัสห้อง — นำกลับมา Import ได้
                </div>

                <div style={{ borderRadius: 12, border: "1px solid var(--color-light)", overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "var(--color-background)", borderBottom: "1px solid var(--color-light)" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.82rem", fontWeight: 600, color: "var(--color-dark-variant)" }}>
                      <input type="checkbox" style={{ accentColor: "var(--color-primary)", width: 15, height: 15 }}
                        checked={allSelected}
                        onChange={(e) => setExportSelectedIds(e.target.checked ? new Set(sortedRooms.map((r) => r.id)) : new Set())} />
                      เลือกทั้งหมด ({sortedRooms.length} ห้อง)
                    </label>
                    <span style={{ fontSize: "0.75rem", color: "var(--color-primary)", fontWeight: 600 }}>
                      {exportSelectedIds.size} ห้อง
                    </span>
                  </div>

                  <div className="nicescrollbar" style={{ maxHeight: 280, overflowY: "auto" }}>
                    {sortedRooms.map((r) => {
                      const tower = towers.find((t) => t.id === r.towerId);
                      const checked = exportSelectedIds.has(r.id);
                      return (
                        <label key={r.id}
                          style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid var(--color-light)", transition: "background 0.12s", background: checked ? "rgba(108,155,207,0.05)" : "transparent" }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-background)")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = checked ? "rgba(108,155,207,0.05)" : "transparent")}>
                          <input type="checkbox" style={{ accentColor: "var(--color-primary)", width: 15, height: 15, flexShrink: 0 }}
                            checked={checked}
                            onChange={(e) => {
                              const next = new Set(exportSelectedIds);
                              e.target.checked ? next.add(r.id) : next.delete(r.id);
                              setExportSelectedIds(next);
                            }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: "0.88rem", color: "var(--color-dark)" }}>ห้อง {r.number}</div>
                            {tower && <div style={{ fontSize: "0.72rem", color: "var(--color-dark-variant)" }}><i className="fas fa-building me-1" />{tower.name}</div>}
                          </div>
                          <span style={{ fontSize: "0.75rem", color: "var(--color-dark-variant)", flexShrink: 0 }}>{r.status}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="btn btn-outline-secondary btn-sm" onClick={() => setShowExportDialog(false)}>ยกเลิก</button>
                  <button className="btn btn-success btn-sm d-inline-flex align-items-center"
                    disabled={exportSelectedIds.size === 0}
                    onClick={doExportRooms}>
                    <i className="fas fa-download me-2" />ดาวน์โหลด CSV
                    <span style={{ marginLeft: 6, background: "rgba(255,255,255,0.25)", borderRadius: 10, padding: "1px 8px", fontSize: "0.8em" }}>
                      {exportSelectedIds.size} ห้อง
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
