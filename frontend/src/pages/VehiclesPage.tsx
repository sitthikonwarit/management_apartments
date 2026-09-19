










import { useEffect, useState, useMemo, useRef, useLayoutEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Select from "react-select";
import { vehiclesApi, tenantsApi, roomsApi } from "../api/client";
import { useBreadcrumb } from "../context/BreadcrumbContext";
import CustomSelect2 from "../components/CustomSelect2";
import ToolbarActionsMenu from "../components/ToolbarActionsMenu";
import ColResizeHandle from "../components/ColResizeHandle";
import EmptyState from "../components/EmptyState";
import { usePersistedViewMode } from "../utils/usePersistedViewMode";
import { useColumnWidths, useColumnVisibility } from "../utils/useColumnWidths";
import { tenantDisplayName } from "../utils/tenantName";
import { roomsOfTenant } from "../utils/tenantRoom";
import { useLiveRefreshTick } from "../utils/useLiveSync";
import { toastSuccess, toastError } from "../utils/toast";

// ── Types ─────────────────────────────────────────────────────────────────────
type PageView = "list" | "types" | "detail" | "form" | "edit";
type ListViewMode = "list" | "grid" | "table";
type PinDir = "left" | "right" | false;
interface ColDef {
  key: string; header: string; visible: boolean;
  pinnable: boolean; pin: PinDir; thClass?: string; tdClass?: string;
}
interface PinMenu { colKey: string; x: number; y: number }

// ── Column definitions ────────────────────────────────────────────────────────
const VEHICLE_TABLE_COLS: ColDef[] = [
  { key: "checkbox", header: "checkbox",    visible: true,  pinnable: true, pin: "left",  thClass: "text-center checkbox-cell", tdClass: "text-center checkbox-cell" },
  { key: "type",     header: "ประเภท",       visible: true,  pinnable: true, pin: false },
  { key: "plate",    header: "ป้ายทะเบียน",  visible: true,  pinnable: true, pin: false },
  { key: "brand",    header: "ยี่ห้อ/รุ่น",  visible: true,  pinnable: true, pin: false },
  { key: "color",    header: "สี",            visible: true,  pinnable: true, pin: false },
  { key: "owner",    header: "เจ้าของ",       visible: true,  pinnable: true, pin: false },
  { key: "room",     header: "ห้อง",          visible: true,  pinnable: true, pin: false,  thClass: "text-center", tdClass: "text-center" },
  { key: "phone",    header: "เบอร์โทร",      visible: false, pinnable: true, pin: false },
  { key: "fee",      header: "ค่าจอด/เดือน", visible: true,  pinnable: true, pin: false,  thClass: "text-end",    tdClass: "text-end" },
  { key: "actions",  header: "จัดการ",        visible: true,  pinnable: true, pin: "right", thClass: "text-center action-cell", tdClass: "text-center action-cell" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function getRoomNumber(rooms: any[], idRoom: string | undefined | null): string | null {
  if (!idRoom) return null;
  const room = rooms.find((r) => r.id === idRoom || r.number === idRoom);
  return room?.number ?? idRoom;
}

function getTenantRoomsLabel(rooms: any[], tenant: any): string {
  const ids = [tenant.idRoom, ...(Array.isArray(tenant.extraRoomIds) ? tenant.extraRoomIds : [])].filter(Boolean);
  return ids.map((rid) => getRoomNumber(rooms, rid)).filter(Boolean).join(", ");
}

function getTenantInfo(tenants: any[], customerId: string, rooms: any[]) {
  const t = tenants.find((t) => t.id === customerId);
  if (!t) return { name: null, room: null, phone: null };
  const roomIds = [t.idRoom, ...(Array.isArray(t.extraRoomIds) ? t.extraRoomIds : [])].filter(Boolean);
  const roomLabel = roomIds.map((rid) => getRoomNumber(rooms, rid)).filter(Boolean).join(", ") || null;
  return {
    name:  tenantDisplayName(t),
    room:  roomLabel,
    phone: t.tel     || null,
  };
}

function getTypeInfo(types: any[], vehicleTypeId: string) {
  return types.find((t) => t.id === vehicleTypeId) ?? { id: "", name: "ไม่ระบุ", icon: "fas fa-car", defaultFee: 0 };
}

// ── SimpleImageLightbox (แสดงรูปเดียวแบบเต็มจอ ใช้เเบบเดียวกับหน้าผู้เช่า) ──────
function SimpleImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose}><i className="fas fa-times" /></button>
      <img className="lightbox-img" src={src} alt="ขยายรูป" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

// ── PinMenuPopup ──────────────────────────────────────────────────────────────
function PinMenuPopup({ menu, cols, onPin, onClose }: {
  menu: PinMenu; cols: ColDef[];
  onPin: (k: string, d: PinDir) => void; onClose: () => void;
}) {
  const col = cols.find((c) => c.key === menu.colKey);
  const cur = col?.pin ?? false;
  useEffect(() => {
    const close = () => onClose();
    setTimeout(() => window.addEventListener("click", close), 0);
    return () => window.removeEventListener("click", close);
  }, []);
  return (
    <ul className="pinning-menu" style={{ position: "fixed", top: menu.y, left: menu.x }}
      onClick={(e) => e.stopPropagation()}>
      {cur && <li className="disabled"><i className="fas fa-thumbtack" />{cur === "left" ? "ปักหมุดซ้าย (ใช้อยู่)" : "ปักหมุดขวา (ใช้อยู่)"}</li>}
      {cur !== "left"  && <li onClick={() => { onPin(menu.colKey, "left");  onClose(); }}><i className="fas fa-thumbtack" style={{ color: "var(--color-primary)" }} />ปักหมุดซ้าย</li>}
      {cur !== "right" && <li onClick={() => { onPin(menu.colKey, "right"); onClose(); }}><i className="fas fa-thumbtack" style={{ color: "var(--color-danger)" }} />ปักหมุดขวา</li>}
      {cur && <li onClick={() => { onPin(menu.colKey, false); onClose(); }}><i className="fas fa-times" />เลิกปักหมุด</li>}
    </ul>
  );
}

// ── VehicleTypesView (TagManagement style) ────────────────────────────────────
const EMPTY_TYPE_FORM = { name: "", icon: "fas fa-car", defaultFee: 0 };

const TYPE_SUGGESTED_ICONS = [
  "fas fa-car","fas fa-motorcycle","fas fa-truck","fas fa-bus","fas fa-shuttle-van",
  "fas fa-bicycle","fas fa-tractor","fas fa-caravan","fas fa-trailer",
  "fas fa-parking","fas fa-gas-pump","fas fa-road","fas fa-key","fas fa-shipping-fast",
  "fas fa-ambulance","fas fa-police-car","fas fa-taxi","fas fa-rv","fas fa-truck-pickup",
  "fas fa-snowplow","fas fa-bus-alt","fas fa-truck-monster","fas fa-car-side","fas fa-car-alt",
];

function VehicleTypesView({ types, onBack, onUpdate }: {
  types: any[]; onBack: () => void; onUpdate: (types: any[]) => void;
}) {
  const [form, setForm] = useState(EMPTY_TYPE_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = search
    ? types.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
    : types;

  function openAdd() {
    setEditingId(null); setForm(EMPTY_TYPE_FORM); setError(""); setShowModal(true);
  }
  function startEdit(t: any) {
    setEditingId(t.id);
    setForm({ name: t.name, icon: t.icon || "fas fa-car", defaultFee: t.defaultFee ?? 0 });
    setError(""); setShowModal(true);
  }
  function cancelForm() {
    setEditingId(null); setForm(EMPTY_TYPE_FORM); setError(""); setShowModal(false);
  }

  async function handleSave() {
    if (!form.name.trim()) { setError("กรุณากรอกชื่อประเภทรถ"); return; }
    setSaving(true); setError("");
    try {
      if (editingId) {
        const updated = await vehiclesApi.updateType(editingId, form);
        onUpdate(types.map((t) => (t.id === editingId ? updated : t)));
      } else {
        const created = await vehiclesApi.createType(form);
        onUpdate([...types, created]);
      }
      toastSuccess("บันทึกประเภทรถสำเร็จ");
      cancelForm();
    } catch { setError("บันทึกไม่สำเร็จ กรุณาลองใหม่"); toastError("บันทึกไม่สำเร็จ กรุณาลองใหม่"); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      await vehiclesApi.deleteType(id);
      onUpdate(types.filter((t) => t.id !== id));
      setDeleteId(null);
      if (editingId === id) cancelForm();
      toastSuccess("ลบประเภทรถสำเร็จ");
    } catch { setError("ลบไม่สำเร็จ กรุณาลองใหม่"); toastError("ลบไม่สำเร็จ กรุณาลองใหม่"); }
    finally { setDeleting(false); }
  }

  return (
    <div className="custom-card page-view">

      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h5 className="form-section-title mb-0" style={{ borderBottom: "none" }}>จัดการประเภทรถ</h5>
        <button className="btn btn-primary" onClick={openAdd}>
          <i className="fas fa-plus me-2" />เพิ่มประเภทรถ
        </button>
      </div>

      {/* Search */}
      <div className="search-container mb-4">
        <i className="fas fa-search" />
        <input type="text" className="form-control" placeholder="ค้นหาชื่อประเภทรถ..."
          value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {/* List */}
      <div className="nicescrollbar" style={{ maxHeight: 420, overflowY: "auto" }}>
        {filtered.length === 0 ? (
          <div className="text-center text-muted p-5">
            <i className="fas fa-car fa-2x mb-2 d-block opacity-25" />
            {search ? "ไม่พบประเภทรถที่ค้นหา" : "ยังไม่มีประเภทรถในระบบ"}
          </div>
        ) : (
          <div className="tmv-list">
            {filtered.map((t) => (
              <div key={t.id}>
                <div className={`tower-item${editingId === t.id ? " tower-item--active" : ""}`}
                  style={{ borderLeftColor: "var(--color-primary)" }}>
                  <div className="tower-item-info">
                    <div className="tower-item-color-dot" style={{ backgroundColor: "var(--color-primary)" }} />
                    <div className="tower-item-name">
                      <i className={`${t.icon || "fas fa-car"} me-2`} style={{ color: "var(--color-primary)" }} />
                      <strong>{t.name}</strong>
                      {t.defaultFee > 0 && (
                        <span className="text-muted ms-2" style={{ fontSize: "0.82rem" }}>
                          (ค่าจอดเริ่มต้น {Number(t.defaultFee).toLocaleString()} บาท/เดือน)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="tower-item-actions">
                    <button className="edit-tag-btn" onClick={() => startEdit(t)}
                      disabled={saving || deleting} title="แก้ไข">
                      <i className="fas fa-edit" />
                    </button>
                    <button className="delete-tag-btn delete-btn"
                      onClick={() => setDeleteId(deleteId === t.id ? null : t.id)}
                      disabled={saving || deleting} title="ลบ">
                      <i className="fas fa-trash-alt" />
                    </button>
                  </div>
                </div>
                {deleteId === t.id && (
                  <div className="tmv-confirm-strip">
                    <i className="fas fa-exclamation-triangle text-danger me-2" />
                    <span>ยืนยันลบ <strong>{t.name}</strong>?</span>
                    <div className="d-flex gap-1 ms-auto">
                      <button className="btn btn-sm btn-outline-secondary" onClick={() => setDeleteId(null)} disabled={deleting}>ยกเลิก</button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(t.id)} disabled={deleting}>
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

      {/* Footer */}
      <div className="d-flex mt-4 pt-3" style={{ borderTop: "1px solid var(--color-light)" }}>
        <button className="btn btn-outline-secondary" onClick={onBack}>
          <i className="fas fa-arrow-left me-1" />กลับ
        </button>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="room-modal-overlay" onClick={cancelForm}>
          <div className="room-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>

            <div className="room-modal-header">
              <div className="room-modal-title">
                <i className={`fas ${editingId ? "fa-edit" : "fa-plus-circle"} me-2`} />
                {editingId ? "แก้ไขประเภทรถ" : "เพิ่มประเภทรถใหม่"}
              </div>
              <button className="room-modal-close" onClick={cancelForm}><i className="fas fa-times" /></button>
            </div>

            <div className="room-modal-body" style={{ padding: "1.25rem 1.5rem" }}>
              <div className="row g-3">

                {/* ชื่อประเภท */}
                <div className="col-12">
                  <label className="form-label">ชื่อประเภทรถ <span className="text-danger">*</span></label>
                  <input className="form-control" placeholder="เช่น รถยนต์, มอเตอร์ไซค์, รถบรรทุก..."
                    value={form.name} autoFocus
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                </div>

                {/* ไอคอน */}
                <div className="col-12">
                  <label className="form-label">ไอคอน (Font Awesome)</label>
                  <div className="input-group">
                    <span className="input-group-text" style={{ color: "var(--color-primary)", minWidth: 44, fontSize: "1.1rem" }}>
                      <i className={form.icon || "fas fa-car"} />
                    </span>
                    <input className="form-control" placeholder="fas fa-car"
                      value={form.icon}
                      onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))} />
                  </div>
                </div>

                {/* Icon Picker */}
                <div className="col-12">
                  <label className="form-label small text-muted">เลือกไอคอนแนะนำ:</label>
                  <div className="tmv-icon-picker">
                    {TYPE_SUGGESTED_ICONS.map((ic) => (
                      <button key={ic} type="button"
                        className={`tmv-icon-item${form.icon === ic ? " tmv-icon-item--selected" : ""}`}
                        onClick={() => setForm((f) => ({ ...f, icon: ic }))} title={ic}>
                        <i className={ic} />
                      </button>
                    ))}
                  </div>
                </div>

                {/* ค่าจอดเริ่มต้น */}
                <div className="col-12">
                  <label className="form-label">ค่าจอดเริ่มต้น (บาท/เดือน)</label>
                  <input type="number" className="form-control" placeholder="0" min={0}
                    value={form.defaultFee}
                    onChange={(e) => setForm((f) => ({ ...f, defaultFee: Number(e.target.value) }))} />
                </div>

                {/* Preview */}
                <div className="col-12">
                  <label className="form-label small text-muted">ตัวอย่าง:</label>
                  <div className="p-2 rounded" style={{ background: "var(--color-background)" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 14px",
                      borderRadius: 20, fontSize: "0.88rem", fontWeight: 600,
                      background: "rgba(108,155,207,0.12)", color: "var(--color-primary)",
                      border: "1.5px solid rgba(108,155,207,0.35)" }}>
                      <i className={form.icon || "fas fa-car"} />
                      {form.name || "ชื่อประเภทรถ"}
                      {form.defaultFee > 0 && (
                        <span style={{ fontSize: "0.75rem", fontWeight: 500, opacity: 0.8, marginLeft: 2 }}>
                          {form.defaultFee.toLocaleString()} ฿/เดือน
                        </span>
                      )}
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

// ── VehicleEditView (แก้ไขยานพาหนะ – หน้าเต็มแบบเดียวกับเพิ่มยานพาหนะ) ───────────
function VehicleEditView({ vehicle, types, tenants, rooms, onBack, onSuccess }: {
  vehicle: any; types: any[]; tenants: any[]; rooms: any[];
  onBack: () => void; onSuccess: (v: any) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    vehicleTypeId: vehicle.vehicleTypeId ?? "",
    licensePlate:  vehicle.licensePlate  ?? "",
    brand:         vehicle.brand         ?? "",
    color:         vehicle.color         ?? "",
    customerId:    vehicle.customerId    ?? "",
    parkingFee:    vehicle.parkingFee    ?? 0,
  });
  const [images, setImages] = useState<string[]>(Array.isArray(vehicle.images) ? vehicle.images : []);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const typeOptions = [
    { value: "", label: "-- เลือกประเภทรถ --" },
    ...types.map((t) => ({ value: t.id, label: t.name })),
  ];
  const tenantOptions = tenants.map((t) => {
    const roomNumber = getTenantRoomsLabel(rooms, t);
    return { value: t.id, label: `${tenantDisplayName(t)}${roomNumber ? ` (ห้อง ${roomNumber})` : ""}` };
  });

  function handleTypeChange(typeId: string) {
    const t = types.find((t) => t.id === typeId);
    setForm((prev) => ({ ...prev, vehicleTypeId: typeId, parkingFee: t ? t.defaultFee : prev.parkingFee }));
  }

  async function handleAddImages(files: FileList) {
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
      const result = await vehiclesApi.updateImages(vehicle.id, images, newImages);
      setImages(result.images);
    } finally { setUploading(false); }
  }

  async function handleRemoveImage(url: string) {
    setUploading(true);
    try {
      const result = await vehiclesApi.updateImages(vehicle.id, images.filter((u) => u !== url), []);
      setImages(result.images);
      toastSuccess("ลบรูปภาพสำเร็จ");
    } finally { setUploading(false); }
  }

  async function handleSubmit() {
    if (!form.licensePlate.trim()) { toastError("กรุณาระบุป้ายทะเบียน"); return; }
    setSaving(true);
    try {
      const result = await vehiclesApi.update(vehicle.id, form);
      toastSuccess("บันทึกข้อมูลยานพาหนะสำเร็จ");
      onSuccess({ ...result, images });
    } catch (e: any) {
      const msg = "เกิดข้อผิดพลาด: " + (e?.response?.data?.error ?? e?.message ?? "Unknown error");
      toastError(msg);
    } finally { setSaving(false); }
  }

  return (
    <div className="custom-card">
      <div className="row g-3">

        <div className="col-12 mt-2">
          <h5 className="form-section-title">แก้ไขข้อมูลยานพาหนะ</h5>
        </div>

        {/* รูปภาพ */}
        <div className="col-12">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <label className="form-label mb-0">รูปภาพยานพาหนะ</label>
            <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="fas fa-plus me-1" />}
              เพิ่มรูป
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: "none" }}
              onChange={(e) => { if (e.target.files?.length) handleAddImages(e.target.files); e.target.value = ""; }} />
          </div>
          {images.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {images.map((url) => (
                <div key={url} style={{ position: "relative", width: 90, height: 90, flexShrink: 0 }}>
                  <img src={url} alt="" style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 8, border: "2px solid var(--color-light)", cursor: "zoom-in" }}
                    onClick={() => setPreviewUrl(url)} />
                  <button type="button"
                    style={{ position: "absolute", top: -6, right: -6, background: "#dc3545", border: "none", borderRadius: "50%", width: 22, height: 22, color: "#fff", fontSize: "0.75rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                    onClick={() => handleRemoveImage(url)} disabled={uploading} title="ลบรูป">×</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="file-view-empty"><i className="fas fa-image me-2 text-muted" />ยังไม่มีรูปภาพ คลิก "เพิ่มรูป" เพื่ออัปโหลด</div>
          )}
        </div>

        <div className="col-md-6">
          <label className="form-label">ประเภทรถ</label>
          <CustomSelect2
            value={typeOptions.find((o) => o.value === form.vehicleTypeId) ?? typeOptions[0]}
            options={typeOptions}
            onChange={(o: any) => handleTypeChange(o?.value ?? "")}
            isSearchable={false}
            placeholder="-- เลือกประเภทรถ --"
          />
        </div>
        <div className="col-md-6">
          <label className="form-label">ป้ายทะเบียน<span className="text-danger">*</span></label>
          <input type="text" className="form-control" placeholder="เช่น กข 1234"
            value={form.licensePlate} onChange={(e) => setForm((p) => ({ ...p, licensePlate: e.target.value }))} />
        </div>
        <div className="col-md-6">
          <label className="form-label">ยี่ห้อ/รุ่น</label>
          <input type="text" className="form-control" placeholder="เช่น Toyota Vios"
            value={form.brand} onChange={(e) => setForm((p) => ({ ...p, brand: e.target.value }))} />
        </div>
        <div className="col-md-6">
          <label className="form-label">สี</label>
          <input type="text" className="form-control" placeholder="เช่น ขาว, ดำ, เทา"
            value={form.color} onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))} />
        </div>
        <div className="col-md-6">
          <label className="form-label">ค่าจอด/เดือน (บาท)</label>
          <input type="number" className="form-control" min={0}
            value={form.parkingFee} onChange={(e) => setForm((p) => ({ ...p, parkingFee: Number(e.target.value) }))} />
        </div>
        <div className="col-md-6">
          <label className="form-label">เจ้าของ / ผู้เช่า</label>
          <CustomSelect2
            value={tenantOptions.find((o) => o.value === form.customerId) ?? null}
            options={tenantOptions}
            onChange={(o: any) => setForm((p) => ({ ...p, customerId: o?.value ?? "" }))}
            isClearable={true as any}
            placeholder="ค้นหาชื่อผู้เช่า..."
          />
        </div>

        <div className="col-12 d-flex justify-content-between gap-2 mt-2">
          <button type="button" className="btn btn-outline-secondary" onClick={onBack} disabled={saving}>
            <i className="fas fa-arrow-left me-1" />กลับ
          </button>
          <button type="button" className="btn btn-primary px-4" onClick={handleSubmit} disabled={saving}>
            {saving
              ? <><span className="spinner-border spinner-border-sm me-2" />กำลังบันทึก...</>
              : <><i className="fas fa-save me-2" />บันทึกการแก้ไข</>}
          </button>
        </div>

      </div>

      {previewUrl && <SimpleImageLightbox src={previewUrl} onClose={() => setPreviewUrl(null)} />}
    </div>
  );
}

// ── VehicleFormView (เพิ่มยานพาหนะใหม่ – หน้าเต็มแบบเดียวกับเพิ่มผู้เช่า) ──────────
function VehicleFormView({ types, tenants, rooms, onBack, onSuccess }: {
  types: any[]; tenants: any[]; rooms: any[];
  onBack: () => void; onSuccess: (vehicle: any) => void;
}) {
  const [form, setForm] = useState({
    vehicleTypeId: "", licensePlate: "", brand: "", color: "", customerId: "", parkingFee: 0,
  });
  const [images, setImages] = useState<{ base64: string; name: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const typeOptions = [
    { value: "", label: "-- เลือกประเภทรถ --" },
    ...types.map((t) => ({ value: t.id, label: t.name })),
  ];
  const tenantOptions = tenants.map((t) => {
    const roomNumber = getTenantRoomsLabel(rooms, t);
    return { value: t.id, label: `${tenantDisplayName(t)}${roomNumber ? ` (ห้อง ${roomNumber})` : ""}` };
  });

  function handleTypeChange(typeId: string) {
    const t = types.find((t) => t.id === typeId);
    setForm((prev) => ({ ...prev, vehicleTypeId: typeId, parkingFee: t ? t.defaultFee : prev.parkingFee }));
  }

  async function handleAddImages(files: FileList) {
    const newOnes: { base64: string; name: string }[] = [];
    for (const file of Array.from(files)) {
      const base64 = await new Promise<string>((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result as string);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      newOnes.push({ base64, name: file.name });
    }
    setImages((prev) => [...prev, ...newOnes]);
  }

  function removeImage(idx: number) {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit() {
    setError("");
    if (!form.licensePlate.trim()) { setError("กรุณาระบุป้ายทะเบียน"); return; }
    setSubmitting(true);
    try {
      const created = await vehiclesApi.create({ ...form, newImages: images });
      toastSuccess("เพิ่มยานพาหนะสำเร็จ");
      onSuccess(created);
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";
      setError(msg);
      toastError(msg);
    } finally { setSubmitting(false); }
  }

  return (
    <div className="custom-card">
      <div className="row g-3">

        <div className="col-12 mt-2">
          <h5 className="form-section-title">ข้อมูลยานพาหนะ</h5>
        </div>

        {/* รูปภาพ */}
        <div className="col-12">
          <label className="form-label">รูปภาพยานพาหนะ</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {images.map((img, idx) => (
              <div key={idx} style={{ position: "relative", width: 90, height: 90, flexShrink: 0 }}>
                <img src={img.base64} alt="" style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 8, border: "2px solid var(--color-light)", cursor: "zoom-in" }}
                  onClick={() => setPreviewUrl(img.base64)} />
                <button type="button" onClick={() => removeImage(idx)}
                  style={{ position: "absolute", top: -6, right: -6, background: "#dc3545", border: "none", borderRadius: "50%", width: 22, height: 22, color: "#fff", fontSize: "0.75rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                  title="ลบรูป">×</button>
              </div>
            ))}
            <div onClick={() => fileInputRef.current?.click()}
              style={{ width: 90, height: 90, borderRadius: 8, border: "2px dashed var(--color-light)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--color-dark-variant)", flexShrink: 0 }}>
              <i className="fas fa-camera fa-lg" />
            </div>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: "none" }}
            onChange={(e) => { if (e.target.files?.length) handleAddImages(e.target.files); e.target.value = ""; }} />
        </div>

        <div className="col-md-6">
          <label className="form-label">ประเภทรถ</label>
          <CustomSelect2
            value={typeOptions.find((o) => o.value === form.vehicleTypeId) ?? typeOptions[0]}
            options={typeOptions}
            onChange={(o: any) => handleTypeChange(o?.value ?? "")}
            isSearchable={false}
            placeholder="-- เลือกประเภทรถ --"
          />
        </div>
        <div className="col-md-6">
          <label className="form-label">ป้ายทะเบียน<span className="text-danger">*</span></label>
          <input type="text" className="form-control" placeholder="เช่น กข 1234"
            value={form.licensePlate} onChange={(e) => setForm((p) => ({ ...p, licensePlate: e.target.value }))} />
        </div>
        <div className="col-md-6">
          <label className="form-label">ยี่ห้อ/รุ่น</label>
          <input type="text" className="form-control" placeholder="เช่น Toyota Vios"
            value={form.brand} onChange={(e) => setForm((p) => ({ ...p, brand: e.target.value }))} />
        </div>
        <div className="col-md-6">
          <label className="form-label">สี</label>
          <input type="text" className="form-control" placeholder="เช่น ขาว, ดำ, เทา"
            value={form.color} onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))} />
        </div>
        <div className="col-md-6">
          <label className="form-label">ค่าจอด/เดือน (บาท)</label>
          <input type="number" className="form-control" min={0}
            value={form.parkingFee} onChange={(e) => setForm((p) => ({ ...p, parkingFee: Number(e.target.value) }))} />
        </div>
        <div className="col-md-6">
          <label className="form-label">เจ้าของ / ผู้เช่า</label>
          <CustomSelect2
            value={tenantOptions.find((o) => o.value === form.customerId) ?? null}
            options={tenantOptions}
            onChange={(o: any) => setForm((p) => ({ ...p, customerId: o?.value ?? "" }))}
            isClearable={true as any}
            placeholder="ค้นหาชื่อผู้เช่า..."
          />
        </div>

        {error && (
          <div className="col-12">
            <div className="alert alert-danger py-2 mb-0">{error}</div>
          </div>
        )}

        <div className="col-12 d-flex justify-content-between gap-2 mt-2">
          <button type="button" className="btn btn-outline-secondary" onClick={onBack} disabled={submitting}>
            <i className="fas fa-arrow-left me-1" />กลับ
          </button>
          <button type="button" className="btn btn-primary px-4" onClick={handleSubmit} disabled={submitting}>
            {submitting
              ? <><span className="spinner-border spinner-border-sm me-2" />กำลังบันทึก...</>
              : <><i className="fas fa-paper-plane me-2" />เพิ่มยานพาหนะ</>}
          </button>
        </div>

      </div>

      {previewUrl && <SimpleImageLightbox src={previewUrl} onClose={() => setPreviewUrl(null)} />}
    </div>
  );
}

// ── VehicleDetailView ─────────────────────────────────────────────────────────
function VehicleDetailView({
  vehicle, types, tenants, rooms, allVehicles,
  onBack, onPrev, onNext, hasPrev, hasNext, onSelectVehicle, onEdit, onDeleteRequest,
}: {
  vehicle: any; types: any[]; tenants: any[]; rooms: any[]; allVehicles: any[];
  onBack: () => void; onPrev: () => void; onNext: () => void;
  hasPrev: boolean; hasNext: boolean; onSelectVehicle: (v: any) => void;
  onEdit: () => void; onDeleteRequest: () => void;
}) {
  const navigate = useNavigate();
  const typeInfo = getTypeInfo(types, vehicle.vehicleTypeId);
  const tenant = tenants.find((t) => t.id === vehicle.customerId) ?? null;
  const tenantRooms = tenant ? roomsOfTenant(tenant, rooms) : [];
  const pictures: string[] = Array.isArray(vehicle.images) ? vehicle.images : [];
  const [imgIdx, setImgIdx] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLightboxOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxOpen]);

  return (
    <div className="custom-card page-view" id="tenantDetailEditCard">
      <div className="detail-modal-body">

        {/* ─── Header Navigation ─── */}
        <div className="tenant-detail-profile-header" style={{ flexDirection: "column" }}>
          <button className="btn btn-light btn-circle btn-nav" onClick={onPrev} disabled={!hasPrev} title="คันก่อนหน้า">
            <i className="fas fa-chevron-left" />
          </button>
          <button className="btn btn-light btn-circle btn-nav" onClick={onNext} disabled={!hasNext} title="คันถัดไป">
            <i className="fas fa-chevron-right" />
          </button>

          <div style={{ width: "100%", maxWidth: 480, margin: "0 auto" }}>
            <div
              style={{ height: 280, borderRadius: "var(--border-radius-1)", overflow: "hidden", background: "var(--color-light)", display: "flex", alignItems: "center", justifyContent: "center", cursor: pictures.length > 0 ? "zoom-in" : "default", boxShadow: "var(--box-shadow)" }}
              onClick={() => pictures.length > 0 && setLightboxOpen(true)}
            >
              {pictures.length > 0 ? (
                <img
                  src={pictures[imgIdx]}
                  alt={vehicle.licensePlate}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              ) : (
                <i className={`${typeInfo.icon} fa-4x`} style={{ color: "var(--color-primary)", opacity: 0.4 }} />
              )}
            </div>

            {pictures.length > 1 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginTop: 10 }}>
                {pictures.map((url, idx) => (
                  <img key={url} src={url} alt=""
                    style={{
                      width: 56, height: 56, objectFit: "cover", borderRadius: 6, cursor: "pointer",
                      border: idx === imgIdx ? "2px solid var(--color-primary)" : "2px solid transparent",
                      opacity: idx === imgIdx ? 1 : 0.6,
                      transition: "opacity 0.15s, border-color 0.15s",
                    }}
                    onClick={() => { setImgIdx(idx); setLightboxOpen(true); }} />
                ))}
              </div>
            )}

            <div className="profile-info">
              <h4 className="profile-name">{vehicle.licensePlate}</h4>
              <div className="d-flex align-items-center justify-content-center gap-2 mt-1">
                <span className="tower-tag" style={{ background: "rgba(108,155,207,0.15)", color: "var(--color-primary)", border: "1px solid rgba(108,155,207,0.3)" }}>
                  <i className={`${typeInfo.icon} me-1`} />{typeInfo.name}
                </span>
                <span className={`status-badge ${vehicle.parkingFee > 0 ? "status-booked" : "status-available"}`}>
                  {vehicle.parkingFee > 0 ? `${Number(vehicle.parkingFee).toLocaleString()} ฿/เดือน` : "จอดฟรี"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Vehicle Selector ─── */}
        <div className="tenant-selector-wrapper">
          <CustomSelect2
            value={{ value: vehicle.id, label: `${vehicle.licensePlate}${vehicle.brand ? ` (${vehicle.brand})` : ""}` }}
            options={allVehicles.map((v) => ({
              value: v.id,
              label: `${v.licensePlate}${v.brand ? ` (${v.brand})` : ""}`,
            }))}
            onChange={(opt: any) => {
              const found = allVehicles.find((v) => String(v.id) === String(opt?.value));
              if (found) onSelectVehicle(found);
            }}
            placeholder="ค้นหาหรือเลือกคันอื่น..."
            isSearchable
          />
        </div>

        {/* ─── Vehicle Info ─── */}
        <div className="detail-section">
          <h6><i className="fas fa-info-circle me-2" />ข้อมูลยานพาหนะ</h6>
          <div className="detail-grid">
            <div className="detail-item">
              <i className={typeInfo.icon} />
              <div><div className="label">ประเภท</div><div className="value">{typeInfo.name}</div></div>
            </div>
            <div className="detail-item">
              <i className="fas fa-id-card" />
              <div><div className="label">ป้ายทะเบียน</div><div className="value">{vehicle.licensePlate}</div></div>
            </div>
            <div className="detail-item">
              <i className="fas fa-car" />
              <div><div className="label">ยี่ห้อ/รุ่น</div><div className="value">{vehicle.brand || <span className="text-muted fst-italic">ไม่ระบุ</span>}</div></div>
            </div>
            <div className="detail-item">
              <i className="fas fa-palette" />
              <div><div className="label">สี</div><div className="value">{vehicle.color || <span className="text-muted fst-italic">ไม่ระบุ</span>}</div></div>
            </div>
            <div className="detail-item">
              <i className="fas fa-parking" />
              <div>
                <div className="label">ค่าจอด/เดือน</div>
                <div className="value">
                  {vehicle.parkingFee > 0
                    ? `${Number(vehicle.parkingFee).toLocaleString()} บาท`
                    : <span className="text-success">ฟรี</span>}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Owner / Tenant ─── */}
        <div className="detail-section">
          <h6><i className="fas fa-user me-2" />เจ้าของ / ผู้เช่า</h6>
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
              {tenantRooms.map((r) => (
                <div key={r.id} className="file-view-item" style={{ cursor: "pointer" }}
                  onClick={() => navigate("/rooms", { state: { subView: "detail", roomId: r.id } })}>
                  <i className="fas fa-door-open file-icon text-success" />
                  <span className="file-name">ห้องพัก: <strong>ห้อง {r.number}</strong></span>
                  <i className="fas fa-external-link-alt ms-auto text-muted" style={{ fontSize: "0.75rem" }} />
                </div>
              ))}
            </div>
          ) : (
            <div className="file-view-empty mt-2">
              <i className="fas fa-user-slash me-2 text-muted" />ไม่ระบุเจ้าของ
            </div>
          )}
        </div>

      </div>

      <div className="detail-modal-footer">
        <button className="btn btn-outline-secondary" onClick={onBack}>
          <i className="fas fa-arrow-left me-1" />กลับ
        </button>
        <div className="d-flex gap-2">
          <button className="btn btn-outline-danger" onClick={onDeleteRequest}>
            <i className="fas fa-trash-alt me-1" />ลบ
          </button>
          <button className="btn btn-primary" onClick={onEdit}>
            <i className="fas fa-edit me-1" />แก้ไข
          </button>
        </div>
      </div>

      {/* ─── Lightbox (เเบบเดียวกับหน้าผู้เช่า) ─── */}
      {lightboxOpen && pictures.length > 0 && (
        <div className="lightbox-overlay" onClick={() => setLightboxOpen(false)}>
          <button className="lightbox-close" onClick={() => setLightboxOpen(false)}><i className="fas fa-times" /></button>
          {pictures.length > 1 && (
            <button style={{ position: "absolute", left: 16, background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", borderRadius: "50%", width: 40, height: 40, fontSize: "1.2rem", cursor: "pointer" }}
              onClick={(e) => { e.stopPropagation(); setImgIdx((imgIdx - 1 + pictures.length) % pictures.length); }}>
              <i className="fas fa-chevron-left" />
            </button>
          )}
          <img className="lightbox-img" src={pictures[imgIdx]} alt="ขยายรูป" onClick={(e) => e.stopPropagation()} />
          {pictures.length > 1 && (
            <button style={{ position: "absolute", right: 16, background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", borderRadius: "50%", width: 40, height: 40, fontSize: "1.2rem", cursor: "pointer" }}
              onClick={(e) => { e.stopPropagation(); setImgIdx((imgIdx + 1) % pictures.length); }}>
              <i className="fas fa-chevron-right" />
            </button>
          )}
          <div style={{ position: "absolute", bottom: 12, color: "rgba(255,255,255,0.7)", fontSize: "0.85rem" }}>
            {imgIdx + 1} / {pictures.length}
          </div>
        </div>
      )}
    </div>
  );
}

// ── VehicleTableView ──────────────────────────────────────────────────────────
function VehicleTableView({ vehicles, types, tenants, rooms, onViewDetail, onEdit, onDeleted }: {
  vehicles: any[]; types: any[]; tenants: any[]; rooms: any[];
  onViewDetail: (v: any) => void; onEdit: (v: any) => void; onDeleted: (ids: string[]) => void;
}) {
  const [cols, setCols] = useColumnVisibility("vehicles", VEHICLE_TABLE_COLS);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<any[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pinMenu, setPinMenu] = useState<PinMenu | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const { widths, startResize } = useColumnWidths("vehicles", {
    checkbox: 40, type: 110, plate: 130, brand: 130, color: 90, owner: 150, room: 90, phone: 130, fee: 110, actions: 130,
  });

  const allSelected  = vehicles.length > 0 && selectedRows.size === vehicles.length;
  const someSelected = selectedRows.size > 0 && !allSelected;
  useEffect(() => { if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected; }, [someSelected]);

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

  function handlePin(key: string, dir: PinDir) {
    setCols((prev) => prev.map((c) => c.key === key ? { ...c, pin: dir } : c));
  }
  function openPinMenu(e: React.MouseEvent, key: string) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPinMenu({ colKey: key, x: Math.max(0, r.right - 160), y: r.bottom + 4 });
  }

  const toggleable = cols.filter((c) => c.key !== "actions" && c.key !== "checkbox");
  const colOptions  = toggleable.map((c) => ({ value: c.key, label: c.header }));
  const colValue    = toggleable.filter((c) => c.visible).map((c) => ({ value: c.key, label: c.header }));

  async function doDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      for (const v of confirmDelete) await vehiclesApi.delete(v.id);
      onDeleted(confirmDelete.map((v) => v.id));
      setSelectedRows(new Set());
      setConfirmDelete(null);
    } finally { setDeleting(false); }
  }

  function renderCell(col: ColDef, v: any) {
    const typeInfo = getTypeInfo(types, v.vehicleTypeId);
    const { name: ownerName, room: ownerRoom, phone: ownerPhone } = getTenantInfo(tenants, v.customerId, rooms);
    switch (col.key) {
      case "checkbox":
        return (
          <input type="checkbox" className="form-check-input row-checkbox"
            checked={selectedRows.has(v.id)}
            onClick={(e) => e.stopPropagation()}
            onChange={() => setSelectedRows((prev) => {
              const n = new Set(prev);
              n.has(v.id) ? n.delete(v.id) : n.add(v.id);
              return n;
            })} />
        );
      case "type":
        return <span><i className={`${typeInfo.icon} me-1`} />{typeInfo.name}</span>;
      case "plate":
        return <span className="vehicle-plate-badge fw-bold" style={{ color: "var(--color-primary)" }}>{v.licensePlate}</span>;
      case "brand":
        return v.brand ? <span>{v.brand}</span> : <span className="text-muted">-</span>;
      case "color":
        return v.color ? <span>{v.color}</span> : <span className="text-muted">-</span>;
      case "owner":
        return ownerName ? <span>{ownerName}</span> : <em className="text-muted">ไม่ระบุ</em>;
      case "room":
        return ownerRoom ? <span>ห้อง {ownerRoom}</span> : <span className="text-muted">-</span>;
      case "phone":
        return ownerPhone ? <span>{ownerPhone}</span> : <span className="text-muted">-</span>;
      case "fee":
        return v.parkingFee > 0
          ? <span className="fw-semibold">{v.parkingFee.toLocaleString()} ฿</span>
          : <span className="text-success">ฟรี</span>;
      case "actions":
        return (
          <div className="btn-group" role="group">
            <button type="button" className="btn btn-sm btn-info" title="ดูรายละเอียด"
              onClick={(e) => { e.stopPropagation(); onViewDetail(v); }}>
              <i className="fas fa-eye" />
            </button>
            <button type="button" className="btn btn-sm btn-warning" title="แก้ไข"
              onClick={(e) => { e.stopPropagation(); onEdit(v); }}>
              <i className="fas fa-edit" />
            </button>
            <button type="button" className="btn btn-sm btn-danger" title="ลบ"
              onClick={(e) => { e.stopPropagation(); setConfirmDelete([v]); }}>
              <i className="fas fa-trash-alt" />
            </button>
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
            setCols((prev) => prev.map((c) =>
              c.key === "actions" || c.key === "checkbox" ? c : { ...c, visible: keys.has(c.key) }
            ));
          }}
          styles={{
            control: (b, s) => ({ ...b, backgroundColor: s.menuIsOpen || s.isFocused ? "var(--color-white)" : "var(--color-background)", border: `1px solid ${s.menuIsOpen || s.isFocused ? "var(--color-primary)" : "var(--color-light)"}`, borderRadius: "var(--border-radius-1)", boxShadow: s.menuIsOpen || s.isFocused ? "0 0 0 3px rgba(108,155,207,0.25)" : "none", minHeight: "38px", fontSize: "0.9rem", cursor: "pointer", "&:hover": { borderColor: "var(--color-primary)" } }),
            valueContainer: (b) => ({ ...b, padding: "0 0.75rem", flexWrap: "nowrap", overflow: "hidden" }),
            indicatorSeparator: () => ({ display: "none" }),
            dropdownIndicator: (b, s) => ({ ...b, color: s.isFocused ? "var(--color-primary)" : "var(--color-dark-variant)", padding: "0 8px" }),
            menu: (b) => ({ ...b, backgroundColor: "var(--color-white)", border: "1px solid var(--color-light)", borderRadius: "var(--border-radius-1)", boxShadow: "var(--box-shadow)", zIndex: 9999 }),
            menuList: (b) => ({ ...b, padding: "4px", maxHeight: "260px" }),
            option: (b, s) => ({ ...b, backgroundColor: s.isFocused ? "var(--color-light)" : "transparent", color: "var(--color-dark)", fontSize: "0.88rem", borderRadius: "var(--border-radius-1)", padding: "0.45rem 0.75rem", cursor: "pointer" }),
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
            <button className="btn btn-danger btn-sm"
              onClick={() => setConfirmDelete(vehicles.filter((v) => selectedRows.has(v.id)))}>
              <i className="fas fa-trash-alt me-1" />ลบรายการที่เลือก
            </button>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setSelectedRows(new Set())}>
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
                return (
                  <th key={col.key} className={`${col.thClass ?? ""} ${pc}`} style={{ width: widths[col.key] }}>
                    {col.key === "checkbox"
                      ? <input ref={selectAllRef} type="checkbox" className="form-check-input"
                          checked={allSelected}
                          onChange={(e) => setSelectedRows(e.target.checked ? new Set(vehicles.map((v) => v.id)) : new Set())} />
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
            {vehicles.map((v) => (
              <tr key={v.id}>
                {ordered.map((col) => {
                  const pc = col.pin === "left" ? "pinned pinned-left" : col.pin === "right" ? "pinned pinned-right" : "";
                  return <td key={col.key} className={`${col.tdClass ?? ""} ${pc}`}>{renderCell(col, v)}</td>;
                })}
              </tr>
            ))}
            {vehicles.length === 0 && (
              <tr><td colSpan={ordered.length}><EmptyState icon="fa-car" text="ไม่พบรายการยานพาหนะ" compact /></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pinMenu && <PinMenuPopup menu={pinMenu} cols={cols} onPin={handlePin} onClose={() => setPinMenu(null)} />}

      {/* Confirm delete */}
      {confirmDelete && (
        <div className="confirm-overlay" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon confirm-icon--danger"><i className="fas fa-trash-alt" /></div>
            <h6 className="confirm-title">
              {confirmDelete.length === 1 ? "ยืนยันการลบ?" : `ลบ ${confirmDelete.length} รายการ`}
            </h6>
            <p className="confirm-message">
              {confirmDelete.length === 1
                ? <>ลบรถ <strong>{confirmDelete[0].licensePlate}</strong> ใช่หรือไม่?</>
                : <>ลบยานพาหนะ <strong>{confirmDelete.length} คัน</strong> ที่เลือก ใช่หรือไม่?</>}
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

// ── Main VehiclesPage ─────────────────────────────────────────────────────────
export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sort, setSort] = useState("plate_asc");
  const [view, setView] = usePersistedViewMode<ListViewMode>("vehicles", "list", ["list", "grid", "table"]);
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const { setBreadcrumb } = useBreadcrumb();
  const navigate = useNavigate();
  const location = useLocation();

  // เก็บสถานะหน้าย่อยไว้ใน location.state (แทน useState เฉยๆ) เพื่อให้ปุ่ม "ย้อนกลับ" ของเบราว์เซอร์
  // ใช้งานได้จริง — กดย้อนกลับจะพากลับไปหน้าย่อยก่อนหน้าของหน้านี้ ก่อนจะออกจากหน้านี้จริงๆ
  const navState = (location.state as { subView?: PageView; vehicleId?: string; returnView?: "list" | "detail" }) ?? {};
  const pageView = navState.subView ?? "list";
  const detailVehicleId = pageView === "detail" ? navState.vehicleId ?? null : null;
  const editingVehicleId = pageView === "edit" ? navState.vehicleId ?? null : null;
  const editReturnView = navState.returnView ?? "list";

  const detailVehicle = detailVehicleId ? vehicles.find((v) => v.id === detailVehicleId) ?? null : null;
  const editingVehicle = editingVehicleId ? vehicles.find((v) => v.id === editingVehicleId) ?? null : null;

  function goToList() { navigate("/vehicles", { state: { subView: "list" } }); }
  function goToDetail(v: any) { navigate("/vehicles", { state: { subView: "detail", vehicleId: v.id } }); }
  function goToEdit(v: any, from: "list" | "detail" = "list") {
    navigate("/vehicles", { state: { subView: "edit", vehicleId: v.id, returnView: from } });
  }
  function goToTypes() { navigate("/vehicles", { state: { subView: "types" } }); }
  function goToForm() { navigate("/vehicles", { state: { subView: "form" } }); }

  useEffect(() => {
    Promise.all([vehiclesApi.getAll(), vehiclesApi.getTypes(), tenantsApi.getAll(), roomsApi.getAll()])
      .then(([v, t, ten, rm]) => { setVehicles(v); setTypes(t); setTenants(ten); setRooms(rm); })
      .finally(() => setLoading(false));
    return () => setBreadcrumb([]);
  }, []);

  // มีคนอื่นแก้ไขยานพาหนะ/ประเภทรถ/ผู้เช่า/ห้องที่เครื่องอื่น — โหลดข้อมูลใหม่เงียบๆ ไม่เปิด loading spinner
  const vehiclesLiveTick = useLiveRefreshTick(["vehicle", "vehicle-type", "tenant", "room"]);
  useEffect(() => {
    if (vehiclesLiveTick === 0) return;
    Promise.all([vehiclesApi.getAll(), vehiclesApi.getTypes(), tenantsApi.getAll(), roomsApi.getAll()])
      .then(([v, t, ten, rm]) => { setVehicles(v); setTypes(t); setTenants(ten); setRooms(rm); });
  }, [vehiclesLiveTick]);

  useEffect(() => {
    if (pageView === "types") {
      setBreadcrumb([
        { label: "ยานพาหนะ", onClick: goToList },
        { label: "จัดการประเภทรถ" },
      ]);
    } else if (pageView === "form") {
      setBreadcrumb([
        { label: "ยานพาหนะ", onClick: goToList },
        { label: "เพิ่มยานพาหนะ" },
      ]);
    } else if (pageView === "edit" && editingVehicle) {
      setBreadcrumb([
        { label: "ยานพาหนะ", onClick: goToList },
        ...(editReturnView === "detail"
          ? [{ label: editingVehicle.licensePlate, onClick: () => goToDetail(editingVehicle) }]
          : []),
        { label: "แก้ไข" },
      ]);
    } else if (pageView === "detail" && detailVehicle) {
      setBreadcrumb([
        { label: "ยานพาหนะ", onClick: goToList },
        { label: detailVehicle.licensePlate },
      ]);
    } else {
      setBreadcrumb([{ label: "ยานพาหนะ" }]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageView, detailVehicle?.id, editingVehicle?.id, editReturnView]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let list = vehicles.filter((v) => {
      const { name: ownerName, room } = getTenantInfo(tenants, v.customerId, rooms);
      const matchSearch = !q || `${v.licensePlate} ${v.brand} ${ownerName ?? ""} ${room ?? ""}`.toLowerCase().includes(q);
      const matchType   = !typeFilter || v.vehicleTypeId === typeFilter;
      return matchSearch && matchType;
    });

    const [sortKey, sortOrder] = sort.split("_");
    list.sort((a, b) => {
      let va: any, vb: any;
      const aOwner = getTenantInfo(tenants, a.customerId, rooms);
      const bOwner = getTenantInfo(tenants, b.customerId, rooms);
      switch (sortKey) {
        case "plate": va = a.licensePlate; vb = b.licensePlate; break;
        case "brand": va = a.brand;        vb = b.brand;        break;
        case "color": va = a.color;        vb = b.color;        break;
        case "owner": va = aOwner.name;    vb = bOwner.name;    break;
        case "fee":   va = a.parkingFee;   vb = b.parkingFee;   break;
        default:      va = a.licensePlate; vb = b.licensePlate;
      }
      if (typeof va === "number")
        return sortOrder === "asc" ? va - vb : vb - va;
      return sortOrder === "asc"
        ? String(va ?? "").localeCompare(String(vb ?? ""), "th")
        : String(vb ?? "").localeCompare(String(va ?? ""), "th");
    });
    return list;
  }, [vehicles, tenants, rooms, search, typeFilter, sort]);

  // ── Render: Types View ──
  if (pageView === "types") {
    return <VehicleTypesView types={types} onBack={goToList} onUpdate={setTypes} />;
  }

  // ── Render: Add Vehicle (หน้าเต็ม) ──
  if (pageView === "form") {
    return (
      <VehicleFormView
        types={types}
        tenants={tenants}
        rooms={rooms}
        onBack={goToList}
        onSuccess={(created) => {
          setVehicles((prev) => [created, ...prev]);
          goToList();
        }}
      />
    );
  }

  // ── Render: Edit Vehicle (หน้าเต็ม) ──
  if (pageView === "edit" && editingVehicle) {
    return (
      <VehicleEditView
        vehicle={editingVehicle}
        types={types}
        tenants={tenants}
        rooms={rooms}
        onBack={() => (editReturnView === "detail" ? goToDetail(editingVehicle) : goToList())}
        onSuccess={(saved) => {
          setVehicles((prev) => prev.map((v) => (v.id === saved.id ? saved : v)));
          editReturnView === "detail" ? goToDetail(saved) : goToList();
        }}
      />
    );
  }

  async function handleConfirmedDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await vehiclesApi.delete(confirmDelete.id);
      setVehicles((prev) => prev.filter((v) => v.id !== confirmDelete.id));
      if (pageView === "detail" && confirmDelete.id === detailVehicleId) goToList();
      setConfirmDelete(null);
      toastSuccess("ลบยานพาหนะสำเร็จ");
    } catch (e: any) {
      const msg = "เกิดข้อผิดพลาด: " + (e?.response?.data?.error ?? e?.message);
      toastError(msg);
    } finally { setDeleting(false); }
  }

  const deleteModal = confirmDelete && (
    <div className="confirm-overlay" onClick={() => !deleting && setConfirmDelete(null)}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-icon confirm-icon--danger"><i className="fas fa-trash-alt" /></div>
        <h6 className="confirm-title">ยืนยันการลบ?</h6>
        <p className="confirm-message">
          ลบรถ <strong>{confirmDelete.licensePlate}</strong> ใช่หรือไม่?
          <br /><small className="text-danger">คำเตือน: ข้อมูลจะถูกลบถาวร ไม่สามารถกู้คืนได้</small>
        </p>
        <div className="confirm-actions">
          <button className="btn btn-outline-secondary" onClick={() => setConfirmDelete(null)} disabled={deleting}>ยกเลิก</button>
          <button className="btn btn-danger" disabled={deleting} onClick={handleConfirmedDelete}>
            {deleting
              ? <><span className="spinner-border spinner-border-sm me-2" />กำลังลบ...</>
              : <><i className="fas fa-trash-alt me-1" />ใช่, ลบข้อมูล</>}
          </button>
        </div>
      </div>
    </div>
  );

  // ── Render: Detail View ──
  if (pageView === "detail" && detailVehicle) {
    const detailIndex = filtered.findIndex((v) => v.id === detailVehicle.id);
    return (
      <>
        <VehicleDetailView
          vehicle={detailVehicle}
          types={types}
          tenants={tenants}
          rooms={rooms}
          allVehicles={filtered}
          onBack={goToList}
          onPrev={() => detailIndex > 0 && goToDetail(filtered[detailIndex - 1])}
          onNext={() => detailIndex < filtered.length - 1 && goToDetail(filtered[detailIndex + 1])}
          hasPrev={detailIndex > 0}
          hasNext={detailIndex < filtered.length - 1}
          onSelectVehicle={goToDetail}
          onEdit={() => goToEdit(detailVehicle, "detail")}
          onDeleteRequest={() => setConfirmDelete(detailVehicle)}
        />
        {deleteModal}
      </>
    );
  }

  const typeOptions = [
    { value: "", label: "ทั้งหมด (ประเภทรถ)" },
    ...types.map((t) => ({ value: t.id, label: t.name })),
  ];
  const sortOptions = [
    { value: "plate_asc",  label: "ทะเบียน A→Z" },
    { value: "plate_desc", label: "ทะเบียน Z→A" },
    { value: "brand_asc",  label: "ยี่ห้อ A→Z" },
    { value: "owner_asc",  label: "เจ้าของ A→Z" },
    { value: "fee_asc",    label: "ค่าจอด น้อย→มาก" },
    { value: "fee_desc",   label: "ค่าจอด มาก→น้อย" },
  ];

  return (
    <div id="vehicleListCard" className="custom-card">
      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-3 page-list-toolbar">
        <h5 className="form-section-title mb-0" style={{ borderBottom: "none" }}>รายการยานพาหนะ</h5>
        <ToolbarActionsMenu>
          <button className="btn btn-info d-inline-flex align-items-center" onClick={goToTypes}>
            <i className="fas fa-tags me-2" /><span className="btn-text">จัดการประเภทรถ</span>
          </button>
          <button className="btn btn-primary d-inline-flex align-items-center"
            onClick={goToForm}>
            <i className="fas fa-plus me-2" /><span className="btn-text">เพิ่มยานพาหนะ</span>
          </button>
        </ToolbarActionsMenu>
      </div>

      {/* Summary cards */}
      {!loading && (
        <div className="row g-3 mb-4">
          {[
            { icon: "fa-car text-primary",         label: "ทั้งหมด",    val: `${vehicles.length} คัน` },
            { icon: "fa-parking text-warning",      label: "มีค่าจอด",   val: `${vehicles.filter((v) => v.parkingFee > 0).length} คัน` },
            { icon: "fa-check-circle text-success", label: "จอดฟรี",     val: `${vehicles.filter((v) => !v.parkingFee).length} คัน` },
            { icon: "fa-tags text-info",            label: "ประเภทรถ",   val: `${types.length} ประเภท` },
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
      )}

      {/* Filter / Sort / View bar */}
      <div className="row g-2 mb-3 align-items-center">
        <div className="col-12 col-lg">
          <div className="search-container flex-grow-1">
            <i className="fas fa-search" />
            <input type="text" className="form-control"
              placeholder="ค้นหาทะเบียน, ยี่ห้อ, ชื่อเจ้าของ..."
              style={{ paddingLeft: 40 }}
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="col-12 col-md-auto" style={{ minWidth: 185 }}>
          <CustomSelect2
            value={typeOptions.find((o) => o.value === typeFilter) ?? typeOptions[0]}
            options={typeOptions}
            onChange={(o: any) => setTypeFilter(o?.value ?? "")}
            isSearchable={false}
            placeholder="ทั้งหมด (ประเภทรถ)"
          />
        </div>
        <div className="col-12 col-md-auto" style={{ minWidth: 185 }}>
          <CustomSelect2
            value={sortOptions.find((o) => o.value === sort) ?? sortOptions[0]}
            options={sortOptions}
            onChange={(o: any) => setSort(o?.value ?? "plate_asc")}
            isSearchable={false}
          />
        </div>
        <div className="col-12 col-md-auto">
          <div className="btn-group view-switch-group" role="group">
            <button type="button"
              className={`btn btn-outline-secondary${view === "list" ? " active" : ""}`}
              title="List View" onClick={() => setView("list")}>
              <i className="fas fa-list" />
            </button>
            <button type="button"
              className={`btn btn-outline-secondary${view === "grid" ? " active" : ""}`}
              title="Grid View" onClick={() => setView("grid")}>
              <i className="fas fa-th-large" />
            </button>
            <button type="button"
              className={`btn btn-outline-secondary${view === "table" ? " active" : ""}`}
              title="Table View" onClick={() => setView("table")}>
              <i className="fas fa-table" />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-center p-5">
          <div className="spinner-border" style={{ color: "var(--color-primary)" }} />
        </div>
      ) : view === "table" ? (
        <VehicleTableView
          vehicles={filtered}
          types={types}
          tenants={tenants}
          rooms={rooms}
          onViewDetail={goToDetail}
          onEdit={(v) => goToEdit(v)}
          onDeleted={(ids) => setVehicles((prev) => prev.filter((v) => !ids.includes(v.id)))}
        />
      ) : (
        <div className="nicescrollbar" style={{ maxHeight: 650, overflow: "auto" }}>
          {filtered.length === 0 ? (
            <EmptyState icon="fa-car" text={search || typeFilter ? "ไม่พบยานพาหนะที่ตรงกัน" : "ยังไม่มีข้อมูลยานพาหนะ"} />
          ) : view === "grid" ? (
            /* ── Grid View ── */
            <div className="room-grid">
              {filtered.map((v) => {
                const typeInfo = getTypeInfo(types, v.vehicleTypeId);
                const { name: ownerName, room: ownerRoom } = getTenantInfo(tenants, v.customerId, rooms);
                const firstImg = v.images?.[0];
                return (
                  <div key={v.id} className="room-card" style={{ cursor: "pointer" }} onClick={() => goToDetail(v)}>
                    <div className="room-card-header">
                      <div className="d-flex align-items-center gap-2" style={{ overflow: "hidden", flex: 1 }}>
                        <div className="tower-tag" style={{ background: "rgba(108,155,207,0.15)", color: "var(--color-primary)", border: "1px solid rgba(108,155,207,0.3)", flexShrink: 0 }}>
                          <i className={`${typeInfo.icon} me-1`} />{typeInfo.name}
                        </div>
                        <h5 className="text-truncate mb-0" style={{ fontSize: "0.95rem" }} title={v.licensePlate}>
                          {v.licensePlate}
                        </h5>
                      </div>
                      <span className={`status-badge ${v.parkingFee > 0 ? "status-booked" : "status-available"}`}>
                        {v.parkingFee > 0 ? `${v.parkingFee.toLocaleString()} ฿` : "ฟรี"}
                      </span>
                    </div>
                    <div className="room-card-body">
                      <div style={{ height: 120, borderRadius: "var(--border-radius-1)", overflow: "hidden", background: "var(--color-light)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "0.75rem" }}>
                        {firstImg ? (
                          <img src={firstImg} style={{ width: "100%", height: "100%", objectFit: "cover", cursor: "zoom-in" }} alt=""
                            onClick={(e) => { e.stopPropagation(); setPreviewUrl(firstImg); }}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        ) : (
                          <i className={`${typeInfo.icon} fa-3x`} style={{ color: "var(--color-info-dark)", opacity: 0.35 }} />
                        )}
                      </div>
                      <div className="room-card-info-grid">
                        <div className="room-card-info-item">
                          <span className="label">ยี่ห้อ</span>
                          <span className="value">{v.brand || "-"}</span>
                        </div>
                        <div className="room-card-info-item">
                          <span className="label">สี</span>
                          <span className="value">{v.color || "-"}</span>
                        </div>
                      </div>
                      {ownerName && (
                        <div className="room-card-tenant-info">
                          <p><i className="fas fa-user" />{ownerName}</p>
                          {ownerRoom && <p><i className="fas fa-door-open" />ห้อง {ownerRoom}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* ── List View ── */
            <div>
              {filtered.map((v) => {
                const typeInfo = getTypeInfo(types, v.vehicleTypeId);
                const { name: ownerName, room: ownerRoom } = getTenantInfo(tenants, v.customerId, rooms);
                const firstImg = v.images?.[0];
                return (
                  <div key={v.id} className="d-flex align-items-center gap-3 p-3"
                    style={{ borderBottom: "1px solid var(--color-light)", cursor: "pointer" }}
                    onClick={() => goToDetail(v)}>
                    <div style={{ width: 54, height: 54, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: "var(--color-light)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {firstImg ? (
                        <img src={firstImg} style={{ width: "100%", height: "100%", objectFit: "cover", cursor: "zoom-in" }} alt=""
                          onClick={(e) => { e.stopPropagation(); setPreviewUrl(firstImg); }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      ) : (
                        <i className={`${typeInfo.icon} fa-lg`} style={{ color: "var(--color-info-dark)" }} />
                      )}
                    </div>
                    <div className="flex-grow-1" style={{ minWidth: 0 }}>
                      <div className="d-flex align-items-center gap-2 flex-wrap">
                        <span className="vehicle-plate-badge fw-bold" style={{ color: "var(--color-primary)" }}>
                          {v.licensePlate}
                        </span>
                        <small className="text-muted">
                          <i className={`${typeInfo.icon} me-1`} />{typeInfo.name}
                        </small>
                        {v.brand && (
                          <small className="text-muted">
                            <i className="fas fa-car me-1" />{v.brand}{v.color && ` · ${v.color}`}
                          </small>
                        )}
                      </div>
                      {(ownerName || ownerRoom) && (
                        <div className="d-flex gap-3 mt-1 flex-wrap">
                          {ownerName && <small className="text-muted"><i className="fas fa-user me-1" />{ownerName}</small>}
                          {ownerRoom && <small className="text-muted"><i className="fas fa-door-open me-1" />ห้อง {ownerRoom}</small>}
                        </div>
                      )}
                    </div>
                    <div className="d-flex flex-column align-items-end gap-2" style={{ flexShrink: 0 }}>
                      <span style={{ fontWeight: 600, color: v.parkingFee > 0 ? "var(--color-primary)" : "var(--color-success)", fontSize: "0.9rem" }}>
                        {v.parkingFee > 0 ? `${v.parkingFee.toLocaleString()} ฿` : "ฟรี"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Single-vehicle delete confirm */}
      {deleteModal}

      {previewUrl && <SimpleImageLightbox src={previewUrl} onClose={() => setPreviewUrl(null)} />}
    </div>
  );
}
