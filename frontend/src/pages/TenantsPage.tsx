import { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { tenantsApi, roomsApi, vehiclesApi, billsApi } from "../api/client";

import { useBreadcrumb } from "../context/BreadcrumbContext";
import CustomSelect2 from "../components/CustomSelect2";
import ToolbarActionsMenu from "../components/ToolbarActionsMenu";
import TenantTableView from "../components/TenantTableView";
import TenantFormView from "../components/TenantFormView";
import TenantEditView from "../components/TenantEditView";
import { usePersistedViewMode } from "../utils/usePersistedViewMode";
import { toDisplayYear, formatCheckInDate } from "../utils/yearFormat";
import { monthYearLabel, myScore, normalizeBillItem, type BillGroup } from "../utils/billCalc";
import { tenantDisplayName } from "../utils/tenantName";
import { useLiveRefreshTick } from "../utils/useLiveSync";
import { toastSuccess, toastError } from "../utils/toast";

type ViewMode = "list" | "grid" | "table";
type SubView = "list" | "detail" | "form" | "edit" | "tags";

const AVATAR = "https://cdn-icons-png.flaticon.com/512/149/149071.png";

function getDriveImgSrc(url: string): string {
  if (!url) return AVATAR;
  const m1 = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) return `/api/drive/image/${m1[1]}`;
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2) return `/api/drive/image/${m2[1]}`;
  return url;
}

function fmtPhone(val: string): string {
  const d = val.replace(/\D/g, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0,3)}-${d.slice(3)}`;
  return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
}

const THAI_MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
function formatThaiDate(dateStr: string): string {
  if (!dateStr) return "";
  // DD/MM/YYYY (Thai buddhist year already) — แปลงปีตามที่ตั้งค่าไว้ (พ.ศ./ค.ศ.) แค่ตอนแสดงผล
  const m1 = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return `${parseInt(m1[1])} ${THAI_MONTHS[parseInt(m1[2])-1]} ${toDisplayYear(parseInt(m1[3], 10), "BE")}`;
  // ISO or other parseable format (เก็บเป็น ค.ศ.)
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${toDisplayYear(d.getFullYear(), "CE")}`;
  } catch { return dateStr; }
}

function money(n: number) {
  return (Number(n) || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getRoomNumber(rooms: any[], idRoom: string): string {
  if (!idRoom) return "";
  const room = rooms.find((r) => String(r.id) === String(idRoom) || String(r.number) === String(idRoom));
  return room ? String(room.number) : String(idRoom);
}

// ห้องทั้งหมดของผู้เช่า (หลัก + เพิ่มเติม) รวมเป็นข้อความเดียว เช่น "101, 102, 103"
function getTenantRoomsLabel(rooms: any[], tenant: any): string {
  const ids = [tenant.idRoom, ...(Array.isArray(tenant.extraRoomIds) ? tenant.extraRoomIds : [])].filter(Boolean);
  const labels = ids.map((id) => getRoomNumber(rooms, id)).filter(Boolean);
  return labels.join(", ");
}

function TenantDetailView({
  tenant, allTenants, rooms, vehicles, allTags, bills, payments,
  onBack, onPrev, onNext, hasPrev, hasNext, onSelectTenant, onTenantUpdate, onEdit, onDelete,
}: {
  tenant: any; allTenants: any[]; rooms: any[]; vehicles: any[]; allTags: any[]; bills: BillGroup[]; payments: any[];
  onBack: () => void; onPrev: () => void; onNext: () => void;
  hasPrev: boolean; hasNext: boolean; onSelectTenant: (t: any) => void;
  onTenantUpdate: (t: any) => void; onEdit: () => void; onDelete: () => void;
}) {
  const navigate = useNavigate();
  const room = rooms.find((r) => String(r.id) === String(tenant.idRoom) || String(r.number) === String(tenant.idRoom));
  const roomNumber = room ? String(room.number) : (tenant.idRoom ? String(tenant.idRoom) : "");
  const allRoomsLabel = getTenantRoomsLabel(rooms, tenant); // ห้องหลัก + ห้องเพิ่มเติมทั้งหมด
  const myVehicles = vehicles.filter((v) => String(v.customerId) === String(tenant.id));

  // ── บิล/ยอดค้างชำระของผู้เช่าคนนี้ (รวมทุกห้องที่เคยผูกกับผู้เช่ารายนี้) ──
  const myBillRows = bills
    .flatMap((g) => g.data.filter((it) => String(it.tenantId) === String(tenant.id)).map((it) => ({ billId: g.id, monthYear: g.monthYear, item: it })))
    .sort((a, b) => myScore(b.monthYear) - myScore(a.monthYear));
  const outstandingTotal = myBillRows.reduce((sum, r) => sum + Math.max(0, Number(r.item.total) - Number(r.item.paidAmount)), 0);

  // ── ประวัติการชำระเงินของผู้เช่าคนนี้ ──
  const myPayments = payments
    .filter((p) => String(p.tenantId) === String(tenant.id))
    .sort((a, b) => (b.paymentDate || "") > (a.paymentDate || "") ? 1 : -1);
  const [showPaymentHistory, setShowPaymentHistory] = useState(false);
  const fullAddress = [tenant.houseNo, tenant.soi, tenant.road, tenant.tambon, tenant.amphoe, tenant.province, tenant.zipcode]
    .filter(Boolean).join(" ") || tenant.address || "";
  const pdfs: any[] = Array.isArray(tenant.pdfLinks) ? tenant.pdfLinks : [];
  const coResidents: any[] = Array.isArray(tenant.coResidents) ? tenant.coResidents : [];
  const imgSrc = getDriveImgSrc(tenant.driveImageUrl);

  // ── Confirm dialog ──
  type ConfirmOpts = {
    icon: string; iconClass: string;
    title: string; message: string;
    confirmLabel: string; confirmClass: string;
    cancelLabel?: string;
    onConfirm: () => void;
  };
  const [confirmDialog, setConfirmDialog] = useState<ConfirmOpts | null>(null);

  function showConfirm(opts: ConfirmOpts) { setConfirmDialog(opts); }
  function closeConfirm() { setConfirmDialog(null); }

  // ── Room ──
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [roomSearch, setRoomSearch] = useState("");
  const [savingRoom, setSavingRoom] = useState(false);
  const [roomError, setRoomError] = useState("");
  const [deleting, setDeleting] = useState(false);

  function handleDelete() {
    showConfirm({
      icon: "fas fa-trash-alt", iconClass: "danger",
      title: "ลบผู้เช่า",
      message: `ลบ ${tenantDisplayName(tenant)} ออกจากระบบ${allRoomsLabel ? ` และนำออกจากห้อง ${allRoomsLabel}` : ""} ใช่หรือไม่?\nการกระทำนี้ไม่สามารถย้อนกลับได้`,
      confirmLabel: "ลบ", confirmClass: "btn-danger",
      cancelLabel: "ยกเลิก",
      onConfirm: async () => {
        closeConfirm();
        setDeleting(true);
        try {
          await tenantsApi.delete(tenant.id);
          toastSuccess("ลบผู้เช่าสำเร็จ");
          onDelete();
        } catch {
          setDeleting(false);
          toastError("ไม่สามารถลบผู้เช่าได้ กรุณาลองใหม่");
          showConfirm({
            icon: "fas fa-times-circle", iconClass: "danger",
            title: "เกิดข้อผิดพลาด", message: "ไม่สามารถลบผู้เช่าได้ กรุณาลองใหม่",
            confirmLabel: "ตกลง", confirmClass: "btn-primary",
            onConfirm: closeConfirm,
          });
        }
      },
    });
  }

  const availableRooms = rooms.filter((r) => r.status === "ว่าง" || String(r.id) === String(tenant.idRoom));
  const filteredModalRooms = availableRooms.filter((r) =>
    !roomSearch || String(r.number).includes(roomSearch) || (r.detail || "").toLowerCase().includes(roomSearch.toLowerCase())
  );

  function openRoomModal() {
    setSelectedRoomId(tenant.idRoom ?? "");
    setRoomSearch("");
    setRoomError("");
    setShowRoomModal(true);
  }

  async function handleSaveRoom() {
    setSavingRoom(true);
    setRoomError("");
    try {
      const updated = await tenantsApi.updateRoom(tenant.id, selectedRoomId);
      onTenantUpdate(updated);
      toastSuccess("บันทึกข้อมูลสำเร็จ");
      setShowRoomModal(false);
    } catch {
      setRoomError("บันทึกไม่สำเร็จ กรุณาลองใหม่");
      toastError("บันทึกไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSavingRoom(false);
    }
  }

  function handleRemoveRoom() {
    showConfirm({
      icon: "fas fa-sign-out-alt", iconClass: "danger",
      title: "นำออกจากห้อง",
      message: `นำ ${tenantDisplayName(tenant)} ออกจากห้อง ${roomNumber} ใช่หรือไม่?`,
      confirmLabel: "นำออก", confirmClass: "btn-danger",
      cancelLabel: "ยกเลิก",
      onConfirm: async () => {
        closeConfirm();
        setSavingRoom(true);
        try {
          const updated = await tenantsApi.updateRoom(tenant.id, "");
          onTenantUpdate(updated);
          toastSuccess("นำผู้เช่าออกจากห้องสำเร็จ");
        } catch {
          toastError("ไม่สามารถดำเนินการได้ กรุณาลองใหม่");
          showConfirm({
            icon: "fas fa-times-circle", iconClass: "danger",
            title: "เกิดข้อผิดพลาด", message: "ไม่สามารถดำเนินการได้ กรุณาลองใหม่",
            confirmLabel: "ตกลง", confirmClass: "btn-primary",
            onConfirm: closeConfirm,
          });
        } finally { setSavingRoom(false); }
      },
    });
  }

  // ── ห้องเพิ่มเติม (ผู้เช่า 1 คนเช่าได้หลายห้อง) ──
  const extraRoomIds: string[] = Array.isArray(tenant.extraRoomIds) ? tenant.extraRoomIds : [];
  const extraRooms = extraRoomIds
    .map((rid) => rooms.find((r) => String(r.id) === String(rid) || String(r.number) === String(rid)))
    .filter(Boolean);
  const [showExtraRoomModal, setShowExtraRoomModal] = useState(false);
  const [selectedExtraRoomId, setSelectedExtraRoomId] = useState("");
  const [extraRoomSearch, setExtraRoomSearch] = useState("");
  const [savingExtraRoom, setSavingExtraRoom] = useState(false);

  const availableExtraRooms = rooms.filter((r) =>
    r.status === "ว่าง" &&
    String(r.id) !== String(tenant.idRoom) &&
    !extraRoomIds.some((rid) => String(rid) === String(r.id))
  );
  const filteredExtraRoomOptions = availableExtraRooms.filter((r) =>
    !extraRoomSearch || String(r.number).includes(extraRoomSearch) || (r.detail || "").toLowerCase().includes(extraRoomSearch.toLowerCase())
  );

  function openExtraRoomModal() {
    setSelectedExtraRoomId("");
    setExtraRoomSearch("");
    setShowExtraRoomModal(true);
  }

  async function handleAddExtraRoom() {
    if (!selectedExtraRoomId) return;
    setSavingExtraRoom(true);
    try {
      const updated = await tenantsApi.updateExtraRooms(tenant.id, [...extraRoomIds, selectedExtraRoomId]);
      onTenantUpdate(updated);
      toastSuccess("เพิ่มห้องสำเร็จ");
      setShowExtraRoomModal(false);
    } finally {
      setSavingExtraRoom(false);
    }
  }

  function handleRemoveExtraRoom(roomId: string) {
    const room = rooms.find((r) => String(r.id) === String(roomId));
    showConfirm({
      icon: "fas fa-sign-out-alt", iconClass: "danger",
      title: "นำออกจากห้อง",
      message: `นำ ${tenantDisplayName(tenant)} ออกจากห้อง ${room?.number ?? roomId} ใช่หรือไม่?`,
      confirmLabel: "นำออก", confirmClass: "btn-danger",
      cancelLabel: "ยกเลิก",
      onConfirm: async () => {
        closeConfirm();
        setSavingExtraRoom(true);
        try {
          const updated = await tenantsApi.updateExtraRooms(tenant.id, extraRoomIds.filter((rid) => String(rid) !== String(roomId)));
          onTenantUpdate(updated);
          toastSuccess("นำผู้เช่าออกจากห้องสำเร็จ");
        } finally {
          setSavingExtraRoom(false);
        }
      },
    });
  }

  // ── Co-residents ──
  const EMPTY_CO = { name: "", phone: "", lineId: "", imageBase64: "", imgSrc: AVATAR };
  const [showCoModal, setShowCoModal] = useState(false);
  const [coForm, setCoForm] = useState(EMPTY_CO);
  const [coError, setCoError] = useState("");
  const [savingCo, setSavingCo] = useState(false);
  const coImgRef = useRef<HTMLInputElement>(null);

  function openCoModal() {
    setCoForm(EMPTY_CO);
    setCoError("");
    setShowCoModal(true);
  }

  function onCoImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      setCoForm((f) => ({ ...f, imageBase64: result, imgSrc: result }));
    };
    reader.readAsDataURL(file);
  }

  async function handleAddCoResident() {
    if (!coForm.name.trim()) { setCoError("กรุณากรอกชื่อ"); return; }
    setSavingCo(true);
    setCoError("");
    try {
      const newEntry = {
        name: coForm.name.trim(),
        phone: coForm.phone.trim(),
        lineId: coForm.lineId.trim(),
        ...(coForm.imageBase64 ? { imageBase64: coForm.imageBase64 } : {}),
      };
      const updated = await tenantsApi.updateCoResidents(tenant.id, [...coResidents, newEntry]);
      onTenantUpdate(updated);
      toastSuccess("เพิ่มผู้ร่วมพักอาศัยสำเร็จ");
      setShowCoModal(false);
    } catch {
      setCoError("บันทึกไม่สำเร็จ กรุณาลองใหม่");
      toastError("บันทึกไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSavingCo(false);
    }
  }

  function handleRemoveCoResident(idx: number) {
    showConfirm({
      icon: "fas fa-user-minus", iconClass: "danger",
      title: "ลบผู้ร่วมพักอาศัย",
      message: `ลบ คุณ${coResidents[idx].name} ออกจากรายการใช่หรือไม่?`,
      confirmLabel: "ลบออก", confirmClass: "btn-danger",
      cancelLabel: "ยกเลิก",
      onConfirm: async () => {
        closeConfirm();
        setSavingCo(true);
        try {
          const newList = coResidents.filter((_, i) => i !== idx);
          const updated = await tenantsApi.updateCoResidents(tenant.id, newList);
          onTenantUpdate(updated);
          toastSuccess("ลบผู้ร่วมพักอาศัยสำเร็จ");
        } catch {
          toastError("ไม่สามารถดำเนินการได้ กรุณาลองใหม่");
          showConfirm({
            icon: "fas fa-times-circle", iconClass: "danger",
            title: "เกิดข้อผิดพลาด", message: "ไม่สามารถดำเนินการได้ กรุณาลองใหม่",
            confirmLabel: "ตกลง", confirmClass: "btn-primary",
            onConfirm: closeConfirm,
          });
        } finally { setSavingCo(false); }
      },
    });
  }

  // ── Tags ──
  const currentTagIds: string[] = Array.isArray(tenant.tags) ? tenant.tags : [];
  const [showTagModal, setShowTagModal] = useState(false);
  const [pendingTagIds, setPendingTagIds] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);

  function openTagModal() {
    setPendingTagIds([...currentTagIds]);
    setShowTagModal(true);
  }

  function toggleTag(id: string) {
    setPendingTagIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleSaveTags() {
    setSavingTags(true);
    try {
      const updated = await tenantsApi.updateTags(tenant.id, pendingTagIds);
      onTenantUpdate(updated);
      toastSuccess("บันทึกแท็กสำเร็จ");
      setShowTagModal(false);
    } catch {
      toastError("ไม่สามารถบันทึกแท็กได้ กรุณาลองใหม่");
      showConfirm({
        icon: "fas fa-times-circle", iconClass: "danger",
        title: "เกิดข้อผิดพลาด", message: "ไม่สามารถบันทึกแท็กได้ กรุณาลองใหม่",
        confirmLabel: "ตกลง", confirmClass: "btn-primary",
        onConfirm: closeConfirm,
      });
    } finally { setSavingTags(false); }
  }

  useEffect(() => {
    if (!lightboxSrc) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLightboxSrc(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxSrc]);

  return (
    <div className="custom-card page-view" id="tenantDetailEditCard">
      <div className="detail-modal-body">

        {/* ─── Profile Header ─── */}
        <div className="tenant-detail-profile-header">
          <button className="btn btn-light btn-circle btn-nav" onClick={onPrev} disabled={!hasPrev} title="ผู้เช่าคนก่อนหน้า">
            <i className="fas fa-chevron-left" />
          </button>
          <div className="tenant-detail-profile-center">
            <img
              className="profile-image"
              src={imgSrc}
              alt={tenant.firstName}
              onError={(e) => { (e.target as HTMLImageElement).src = AVATAR; }}
              onClick={() => setLightboxSrc(imgSrc)}
            />
            <div className="profile-info">
              <h4 className="profile-name">{tenantDisplayName(tenant)}</h4>
            </div>
          </div>
          <button className="btn btn-light btn-circle btn-nav" onClick={onNext} disabled={!hasNext} title="ผู้เช่าคนถัดไป">
            <i className="fas fa-chevron-right" />
          </button>
        </div>

        {/* ─── Tenant Selector ─── */}
        <div className="tenant-selector-wrapper">
          <CustomSelect2
            value={{ value: tenant.id, label: `${tenantDisplayName(tenant)}${allRoomsLabel ? ` (ห้อง ${allRoomsLabel})` : ""}` }}
            options={allTenants.map((t) => {
              const rNum = getTenantRoomsLabel(rooms, t);
              return { value: t.id, label: `${tenantDisplayName(t)}${rNum ? ` (ห้อง ${rNum})` : ""}` };
            })}
            onChange={(opt: any) => {
              const found = allTenants.find((t) => String(t.id) === String(opt?.value));
              if (found) onSelectTenant(found);
            }}
            placeholder="ค้นหาหรือเลือกผู้เช่าอื่น..."
            isSearchable
          />
        </div>

        {/* ─── Contact ─── */}
        <div className="detail-section">
          <h6><i className="fas fa-address-book me-2" />ข้อมูลติดต่อ</h6>
          <div className="detail-grid">
            <div className="detail-item">
              <i className="fas fa-phone-alt" />
              <div><div className="label">เบอร์โทรศัพท์</div><div className="value">{tenant.tel || "-"}</div></div>
            </div>
            <div className="detail-item">
              <i className="fab fa-line" style={{ color: "#06C755" }} />
              <div><div className="label">Line ID</div><div className="value">{tenant.idLine || "-"}</div></div>
            </div>
          </div>

          {/* Line Connect */}
          <div className="line-connect-item">
            <i className="fas fa-link" style={{ color: tenant.lineUserId ? "#06C755" : "#ccc" }} />
            <div>
              <div className="label" style={{ fontSize: "0.85rem", color: "#6c757d" }}>Line Connect</div>
              <div className="value">
                {tenant.lineUserId
                  ? <span className="badge bg-success">เชื่อมต่อแล้ว</span>
                  : <span className="badge bg-secondary">ยังไม่เชื่อมต่อ</span>}
              </div>
            </div>
          </div>
        </div>

        {/* ─── Personal Info ─── */}
        <div className="detail-section">
          <h6><i className="fas fa-user-circle me-2" />ข้อมูลส่วนตัวและที่อยู่</h6>
          <div className="detail-grid">
            <div className="detail-item">
              <i className="fas fa-id-card" />
              <div><div className="label">เลขบัตรประชาชน</div><div className="value">{tenant.idLicense || "-"}</div></div>
            </div>
            <div className="detail-item">
              <i className="fas fa-users" />
              <div><div className="label">จำนวนผู้พัก</div><div className="value">{tenant.amount ? `${tenant.amount} คน` : "-"}</div></div>
            </div>
            <div className="detail-item">
              <i className="fas fa-calendar-alt" />
              <div><div className="label">วันที่ลงทะเบียน</div><div className="value">{formatCheckInDate(tenant.checkInDate)}</div></div>
            </div>
            {fullAddress && (
              <div className="detail-item" style={{ gridColumn: "1 / -1" }}>
                <i className="fas fa-map-marker-alt" />
                <div><div className="label">ที่อยู่ตามทะเบียนบ้าน</div><div className="value">{fullAddress}</div></div>
              </div>
            )}
          </div>
        </div>

        {/* ─── Tags ─── */}
        <div className="detail-section">
          <div className="detail-section-header">
            <h6 className="mb-0"><i className="fas fa-tags me-2" />แท็ก</h6>
            <button className="btn btn-sm btn-outline-primary" onClick={openTagModal}>
              <i className="fas fa-pen me-1" />จัดการแท็ก
            </button>
          </div>
          {currentTagIds.length > 0 ? (
            <div className="d-flex flex-wrap gap-2">
              {currentTagIds.map((tid) => {
                const tag = allTags.find((t) => String(t.id) === String(tid));
                if (!tag) return null;
                return (
                  <span
                    key={tid}
                    className="tenant-tag-chip"
                    style={{ "--tag-color": tag.color } as React.CSSProperties}
                  >
                    {tag.icon && <i className={`${tag.icon} me-1`} />}
                    {tag.name}
                    {tag.price > 0 && <span className="tenant-tag-price">+{tag.price.toLocaleString()}฿</span>}
                  </span>
                );
              })}
            </div>
          ) : (
            <div className="file-view-empty"><i className="fas fa-tag me-2 text-muted" />ยังไม่มีแท็ก</div>
          )}
        </div>

        {/* ─── Co-residents ─── */}
        <div className="detail-section">
          <div className="detail-section-header">
            <h6 className="mb-0"><i className="fas fa-users me-2" />ผู้ร่วมพักอาศัย</h6>
            <button className="btn btn-sm btn-outline-primary" onClick={openCoModal} disabled={savingCo}>
              <i className="fas fa-user-plus me-1" />เพิ่ม
            </button>
          </div>
          {coResidents.length > 0 ? (
            <div className="d-flex flex-wrap gap-2">
              {coResidents.map((cr: any, i: number) => (
                <div key={i} className="co-resident-card" style={{ position: "relative" }}>
                  <img
                    className="co-resident-avatar"
                    src={cr.image || AVATAR}
                    onError={(e) => { (e.target as HTMLImageElement).src = AVATAR; }}
                    alt={cr.name}
                    style={{ cursor: "zoom-in" }}
                    onClick={() => setLightboxSrc(cr.image || AVATAR)}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>คุณ {cr.name}</div>
                    <small className="text-muted">
                      {cr.phone && <><i className="fas fa-phone-alt me-1" />{cr.phone}</>}
                      {cr.phone && cr.lineId && <span className="mx-1">|</span>}
                      {cr.lineId && <><i className="fab fa-line me-1 text-success" />{cr.lineId}</>}
                    </small>
                  </div>
                  <button
                    className="co-resident-remove"
                    onClick={() => handleRemoveCoResident(i)}
                    disabled={savingCo}
                    title="ลบออก"
                  >
                    <i className="fas fa-times" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="file-view-empty"><i className="fas fa-user-slash me-2 text-muted" />ไม่มีผู้ร่วมพักอาศัย</div>
          )}
        </div>

        {/* ─── Room Management ─── */}
        <div className="detail-section">
          <div className="detail-section-header">
            <h6 className="mb-0"><i className="fas fa-key me-2" />การจัดการห้องพัก</h6>
            {tenant.idRoom && (
              <div className="d-flex gap-2">
                <button className="btn btn-sm btn-outline-primary" onClick={openRoomModal} disabled={savingRoom}>
                  <i className="fas fa-exchange-alt me-1" />เปลี่ยนห้อง
                </button>
                <button className="btn btn-sm btn-outline-danger" onClick={handleRemoveRoom} disabled={savingRoom}>
                  {savingRoom ? <span className="spinner-border spinner-border-sm" /> : <><i className="fas fa-sign-out-alt me-1" />นำออก</>}
                </button>
              </div>
            )}
          </div>

          {tenant.idRoom ? (
            <div className="file-view-container">
              <div className="file-view-item" style={{ cursor: "pointer" }}
                onClick={() => room && navigate("/rooms", { state: { subView: "detail", roomId: room.id } })}>
                <i className="fas fa-door-open file-icon text-success" />
                <span className="file-name">ห้อง <strong>{roomNumber}</strong>{room?.detail ? ` — ${room.detail}` : ""}</span>
                {room?.price && <span className="text-muted" style={{ fontSize: "0.85rem" }}>{Number(room.price).toLocaleString()} ฿/เดือน</span>}
                <i className="fas fa-external-link-alt ms-auto text-muted" style={{ fontSize: "0.75rem", flexShrink: 0 }} />
              </div>
              {tenant.contractStartDate && (
                <div className="file-view-item">
                  <i className="fas fa-calendar-check file-icon text-primary" />
                  <span className="file-name">วันเข้าพัก <strong>{formatThaiDate(tenant.contractStartDate)}</strong></span>
                </div>
              )}
              {tenant.contractEndDate && (
                <div className="file-view-item">
                  <i className="fas fa-calendar-times file-icon text-danger" />
                  <span className="file-name">หมดอายุสัญญา <strong>{formatThaiDate(tenant.contractEndDate)}</strong></span>
                </div>
              )}
            </div>
          ) : (
            <div className="file-view-empty" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem", padding: "1.25rem" }}>
              <i className="fas fa-door-closed fa-lg text-muted" />
              <span>ยังไม่ได้เลือกห้องพัก</span>
              <button className="btn btn-primary btn-sm" onClick={openRoomModal}>
                <i className="fas fa-plus me-1" />เลือกห้องพัก
              </button>
            </div>
          )}
        </div>

        {/* ─── Extra Rooms (ผู้เช่า 1 คนเช่าได้หลายห้อง) ─── */}
        <div className="detail-section">
          <div className="detail-section-header">
            <h6 className="mb-0"><i className="fas fa-door-open me-2" />ห้องเพิ่มเติม</h6>
            <button className="btn btn-sm btn-outline-primary" onClick={openExtraRoomModal} disabled={savingExtraRoom}>
              <i className="fas fa-plus me-1" />เพิ่มห้อง
            </button>
          </div>
          {extraRooms.length > 0 ? (
            <div className="file-view-container">
              {extraRooms.map((r: any) => (
                <div key={r.id} className="file-view-item" style={{ cursor: "pointer" }}
                  onClick={() => navigate("/rooms", { state: { subView: "detail", roomId: r.id } })}>
                  <i className="fas fa-door-open file-icon text-success" />
                  <span className="file-name">ห้อง <strong>{r.number}</strong>{r.detail ? ` — ${r.detail}` : ""}</span>
                  {r.price && <span className="text-muted" style={{ fontSize: "0.85rem" }}>{Number(r.price).toLocaleString()} ฿/เดือน</span>}
                  <button className="btn btn-sm btn-outline-danger ms-2"
                    onClick={(e) => { e.stopPropagation(); handleRemoveExtraRoom(r.id); }}
                    disabled={savingExtraRoom} title="นำออก">
                    <i className="fas fa-times" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="file-view-empty"><i className="fas fa-door-closed me-2 text-muted" />ไม่มีห้องเพิ่มเติม</div>
          )}
        </div>

        {/* ─── ประวัติการชำระเงิน / ค้างชำระ ─── */}
        <div className="detail-section">
          <div className="detail-section-header">
            <h6 className="mb-0"><i className="fas fa-file-invoice-dollar me-2" />ประวัติการชำระเงิน</h6>
            {outstandingTotal > 0
              ? <span className="status-badge status-unpaid">ค้างชำระ {money(outstandingTotal)} ฿</span>
              : <span className="status-badge status-paid">ไม่มีค้างชำระ</span>}
          </div>

          {myBillRows.length > 0 ? (
            <div className="file-view-container mb-3">
              {myBillRows.map(({ billId, monthYear, item }) => {
                const due = Math.max(0, Number(item.total) - Number(item.paidAmount));
                return (
                  <div key={`${monthYear}-${item.roomId}`} className="file-view-item" style={{ cursor: billId ? "pointer" : undefined }}
                    onClick={() => billId && navigate("/bills", { state: { openBillId: billId, openRoomId: item.roomId } })}>
                    <i className={`fas fa-file-invoice file-icon ${due > 0 ? "text-danger" : "text-success"}`} />
                    <span className="file-name">
                      {monthYearLabel(monthYear)} — ห้อง <strong>{item.roomNumber}</strong>
                      <span className="text-muted ms-1" style={{ fontSize: "0.85rem" }}>ยอดรวม {money(item.total)} ฿</span>
                    </span>
                    {due > 0
                      ? <span className="status-badge status-unpaid">ค้าง {money(due)} ฿</span>
                      : <span className="status-badge status-paid">จ่ายแล้ว</span>}
                    {billId && <i className="fas fa-chevron-right ms-2 text-muted" style={{ fontSize: "0.75rem" }} />}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="file-view-empty mb-3"><i className="fas fa-file-invoice me-2 text-muted" />ยังไม่มีบิลของผู้เช่ารายนี้</div>
          )}

          <button type="button" className="btn btn-sm btn-outline-secondary w-100 d-flex align-items-center justify-content-center gap-2"
            onClick={() => setShowPaymentHistory((v) => !v)}>
            <i className={`fas ${showPaymentHistory ? "fa-chevron-up" : "fa-chevron-down"}`} />
            {showPaymentHistory ? "ซ่อนประวัติการชำระเงิน" : `แสดงประวัติการชำระเงิน (${myPayments.length} รายการ)`}
          </button>

          {showPaymentHistory && (
            myPayments.length > 0 ? (
              <div className="file-view-container mt-2">
                {myPayments.map((p: any) => (
                  <div key={p.id} className="file-view-item" style={{ cursor: p.billId ? "pointer" : undefined }}
                    onClick={() => p.billId && navigate("/bills", { state: { openBillId: p.billId, openRoomId: p.data?.roomId } })}>
                    <i className={`fas ${p.data?.cancelled ? "fa-ban text-muted" : "fa-check-circle text-success"} file-icon`} />
                    <span className="file-name">
                      {formatThaiDate(p.paymentDate)} — ห้อง <strong>{p.data?.roomNumber || "-"}</strong>
                      {p.data?.monthYear ? ` (${monthYearLabel(p.data.monthYear)})` : ""}
                      <span className="text-muted ms-1" style={{ fontSize: "0.85rem" }}>
                        {p.data?.method === "scan" ? "โอน/สแกน" : "เงินสด"}
                      </span>
                    </span>
                    {p.data?.cancelled
                      ? <span className="status-badge status-overdue" title={p.data.cancelReason || ""}>ยกเลิกแล้ว</span>
                      : <span className="status-badge status-paid">{money(p.data?.amount)} ฿</span>}
                    {p.billId && <i className="fas fa-chevron-right ms-2 text-muted" style={{ fontSize: "0.75rem" }} />}
                  </div>
                ))}
              </div>
            ) : (
              <div className="file-view-empty mt-2"><i className="fas fa-receipt me-2 text-muted" />ยังไม่มีประวัติการชำระเงิน</div>
            )
          )}
        </div>

        {/* ─── Vehicles ─── */}
        <div className="detail-section">
          <h6><i className="fas fa-car me-2" />ยานพาหนะ</h6>
          {myVehicles.length > 0 ? (
            <div className="file-view-container">
              {myVehicles.map((v: any) => (
                <div key={v.id} className="file-view-item">
                  <i className="fas fa-car file-icon text-info" />
                  <div className="file-name d-flex flex-column">
                    <span style={{ fontWeight: 600 }}>{v.licensePlate}</span>
                    <small className="text-muted">{v.brand}{v.color ? ` • ${v.color}` : ""}</small>
                  </div>
                  {v.parkingFee > 0 && (
                    <span className="ms-auto text-muted" style={{ fontSize: "0.85rem" }}>{v.parkingFee?.toLocaleString()} ฿/เดือน</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="file-view-empty"><i className="fas fa-car-slash me-2 text-muted" />ไม่มียานพาหนะ</div>
          )}
        </div>

        {/* ─── PDF Attachments ─── */}
        <div className="detail-section">
          <h6><i className="fas fa-paperclip me-2" />เอกสารแนบ</h6>
          {pdfs.length > 0 ? (
            <div className="file-view-container">
              {pdfs.map((file: any, i: number) => (
                <a key={i} href={file.url} target="_blank" rel="noopener noreferrer" className="file-view-item">
                  <i className="fas fa-file-pdf file-icon text-danger" />
                  <span className="file-name">{file.name || "เปิดเอกสาร"}</span>
                  <i className="fas fa-external-link-alt open-icon" />
                </a>
              ))}
            </div>
          ) : (
            <div className="file-view-empty"><i className="fas fa-file-slash me-2 text-muted" />ไม่มีเอกสารแนบ</div>
          )}
        </div>

      </div>

      <div className="detail-modal-footer">
        <button className="btn btn-outline-secondary" onClick={onBack}>
          <i className="fas fa-arrow-left me-1" />กลับ
        </button>
        <button className="btn btn-primary" onClick={onEdit}>
          <i className="fas fa-edit me-2" />แก้ไขข้อมูล
        </button>
        <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
          {deleting
            ? <><span className="spinner-border spinner-border-sm me-2" />กำลังลบ...</>
            : <><i className="fas fa-trash-alt me-2" />ลบผู้เช่า</>}
        </button>
      </div>

      {/* ─── Tag Picker Modal ─── */}
      {showTagModal && (
        <div className="room-modal-overlay" onClick={() => setShowTagModal(false)}>
          <div className="room-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="room-modal-header">
              <div className="room-modal-title"><i className="fas fa-tags me-2" />จัดการแท็ก</div>
              <button className="room-modal-close" onClick={() => setShowTagModal(false)}>
                <i className="fas fa-times" />
              </button>
            </div>

            <div className="room-modal-body" style={{ padding: "1.25rem 1.5rem" }}>
              {allTags.length === 0 ? (
                <div className="room-modal-empty"><i className="fas fa-tag me-2" />ยังไม่มีแท็กในระบบ</div>
              ) : (
                <div className="tag-picker-grid">
                  {allTags.map((tag) => {
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
                            <div className="tag-picker-price">+{tag.price.toLocaleString()} ฿/เดือน</div>
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

      {/* ─── Add Co-resident Modal ─── */}
      {showCoModal && (
        <div className="room-modal-overlay" onClick={() => setShowCoModal(false)}>
          <div className="room-modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="room-modal-header">
              <div className="room-modal-title">
                <i className="fas fa-user-plus me-2" />เพิ่มผู้ร่วมพักอาศัย
              </div>
              <button className="room-modal-close" onClick={() => setShowCoModal(false)}>
                <i className="fas fa-times" />
              </button>
            </div>

            <div className="room-modal-body" style={{ padding: "1.25rem 1.5rem" }}>
              {/* Avatar picker */}
              <div className="text-center mb-3">
                <div
                  className="co-modal-avatar"
                  onClick={() => coImgRef.current?.click()}
                  title="คลิกเพื่อเพิ่มรูป"
                >
                  <img
                    src={coForm.imgSrc}
                    alt="avatar"
                    onError={(e) => { (e.target as HTMLImageElement).src = AVATAR; }}
                  />
                  <div className="co-modal-avatar-overlay"><i className="fas fa-camera" /></div>
                </div>
                <input ref={coImgRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onCoImage} />
                <small className="text-muted d-block mt-1">คลิกเพื่อเพิ่มรูปภาพ (ไม่บังคับ)</small>
              </div>

              <div className="mb-3">
                <label className="form-label">ชื่อ-นามสกุล<span className="text-danger">*</span></label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="ชื่อ นามสกุล"
                  autoFocus
                  value={coForm.name}
                  onChange={(e) => setCoForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="mb-3">
                <label className="form-label">เบอร์โทรศัพท์</label>
                <input
                  type="tel"
                  className="form-control"
                  placeholder="089-999-9999"
                  maxLength={12}
                  value={coForm.phone}
                  onChange={(e) => setCoForm((f) => ({ ...f, phone: fmtPhone(e.target.value) }))}
                />
              </div>
              <div className="mb-1">
                <label className="form-label">Line ID</label>
                <div className="input-group">
                  <span className="input-group-text"><i className="fab fa-line text-success" /></span>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="ID Line"
                    value={coForm.lineId}
                    onChange={(e) => setCoForm((f) => ({ ...f, lineId: e.target.value }))}
                  />
                </div>
              </div>
            </div>

            {coError && (
              <div className="room-modal-error">
                <i className="fas fa-exclamation-circle me-2" />{coError}
              </div>
            )}

            <div className="room-modal-footer">
              <button className="btn btn-outline-secondary" onClick={() => setShowCoModal(false)} disabled={savingCo}>
                ยกเลิก
              </button>
              <button className="btn btn-primary" onClick={handleAddCoResident} disabled={savingCo}>
                {savingCo
                  ? <><span className="spinner-border spinner-border-sm me-2" />กำลังบันทึก...</>
                  : <><i className="fas fa-user-plus me-1" />เพิ่ม</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Room Picker Modal ─── */}
      {showRoomModal && (
        <div className="room-modal-overlay" onClick={() => setShowRoomModal(false)}>
          <div className="room-modal" onClick={(e) => e.stopPropagation()}>
            <div className="room-modal-header">
              <div className="room-modal-title">
                <i className="fas fa-door-open me-2" />
                เลือกห้องพัก
              </div>
              <button className="room-modal-close" onClick={() => setShowRoomModal(false)}>
                <i className="fas fa-times" />
              </button>
            </div>

            <div className="room-modal-search">
              <i className="fas fa-search room-modal-search-icon" />
              <input
                type="text"
                className="room-modal-search-input"
                placeholder="ค้นหาห้อง..."
                value={roomSearch}
                autoFocus
                onChange={(e) => setRoomSearch(e.target.value)}
              />
            </div>

            <div className="room-modal-body">
              {filteredModalRooms.length === 0 ? (
                <div className="room-modal-empty">
                  <i className="fas fa-search me-2" />ไม่พบห้องว่าง
                </div>
              ) : (
                <div className="room-modal-grid">
                  {filteredModalRooms.map((r) => {
                    const isCurrent = String(r.id) === String(tenant.idRoom);
                    const isSelected = String(r.id) === String(selectedRoomId);
                    return (
                      <div
                        key={r.id}
                        className={`room-picker-card${isSelected ? " room-picker-card--selected" : ""}${isCurrent ? " room-picker-card--current" : ""}`}
                        onClick={() => setSelectedRoomId(r.id)}
                      >
                        <div className="room-picker-number">ห้อง {r.number}</div>
                        {r.detail && <div className="room-picker-detail">{r.detail}</div>}
                        {r.price && <div className="room-picker-price">{Number(r.price).toLocaleString()} ฿/เดือน</div>}
                        {isCurrent && <span className="room-picker-badge room-picker-badge--current">ห้องปัจจุบัน</span>}
                        {isSelected && !isCurrent && <span className="room-picker-badge room-picker-badge--selected"><i className="fas fa-check me-1" />เลือก</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {roomError && (
              <div className="room-modal-error">
                <i className="fas fa-exclamation-circle me-2" />{roomError}
              </div>
            )}

            <div className="room-modal-footer">
              <button className="btn btn-outline-secondary" onClick={() => setShowRoomModal(false)} disabled={savingRoom}>
                ยกเลิก
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveRoom}
                disabled={savingRoom || !selectedRoomId}
              >
                {savingRoom
                  ? <><span className="spinner-border spinner-border-sm me-2" />กำลังบันทึก...</>
                  : <><i className="fas fa-check me-1" />ยืนยัน</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {showExtraRoomModal && (
        <div className="room-modal-overlay" onClick={() => setShowExtraRoomModal(false)}>
          <div className="room-modal" onClick={(e) => e.stopPropagation()}>
            <div className="room-modal-header">
              <div className="room-modal-title">
                <i className="fas fa-door-open me-2" />
                เพิ่มห้องพักให้ผู้เช่าคนนี้
              </div>
              <button className="room-modal-close" onClick={() => setShowExtraRoomModal(false)}>
                <i className="fas fa-times" />
              </button>
            </div>

            <div className="room-modal-search">
              <i className="fas fa-search room-modal-search-icon" />
              <input
                type="text"
                className="room-modal-search-input"
                placeholder="ค้นหาห้อง..."
                value={extraRoomSearch}
                autoFocus
                onChange={(e) => setExtraRoomSearch(e.target.value)}
              />
            </div>

            <div className="room-modal-body">
              {filteredExtraRoomOptions.length === 0 ? (
                <div className="room-modal-empty">
                  <i className="fas fa-search me-2" />ไม่พบห้องว่าง
                </div>
              ) : (
                <div className="room-modal-grid">
                  {filteredExtraRoomOptions.map((r) => {
                    const isSelected = String(r.id) === String(selectedExtraRoomId);
                    return (
                      <div
                        key={r.id}
                        className={`room-picker-card${isSelected ? " room-picker-card--selected" : ""}`}
                        onClick={() => setSelectedExtraRoomId(r.id)}
                      >
                        <div className="room-picker-number">ห้อง {r.number}</div>
                        {r.detail && <div className="room-picker-detail">{r.detail}</div>}
                        {r.price && <div className="room-picker-price">{Number(r.price).toLocaleString()} ฿/เดือน</div>}
                        {isSelected && <span className="room-picker-badge room-picker-badge--selected"><i className="fas fa-check me-1" />เลือก</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="room-modal-footer">
              <button className="btn btn-outline-secondary" onClick={() => setShowExtraRoomModal(false)} disabled={savingExtraRoom}>
                ยกเลิก
              </button>
              <button
                className="btn btn-primary"
                onClick={handleAddExtraRoom}
                disabled={savingExtraRoom || !selectedExtraRoomId}
              >
                {savingExtraRoom
                  ? <><span className="spinner-border spinner-border-sm me-2" />กำลังบันทึก...</>
                  : <><i className="fas fa-check me-1" />ยืนยัน</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {lightboxSrc && (
        <div className="lightbox-overlay" onClick={() => setLightboxSrc(null)}>
          <button className="lightbox-close" onClick={() => setLightboxSrc(null)}>
            <i className="fas fa-times" />
          </button>
          <img
            className="lightbox-img"
            src={lightboxSrc}
            alt="ขยายรูป"
            onClick={(e) => e.stopPropagation()}
            onError={(e) => { (e.target as HTMLImageElement).src = AVATAR; }}
          />
        </div>
      )}

      {/* ─── Confirm Dialog ─── */}
      {confirmDialog && (
        <div className="confirm-overlay" onClick={confirmDialog.cancelLabel ? closeConfirm : undefined}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className={`confirm-icon confirm-icon--${confirmDialog.iconClass}`}>
              <i className={confirmDialog.icon} />
            </div>
            <h6 className="confirm-title">{confirmDialog.title}</h6>
            <p className="confirm-message">{confirmDialog.message}</p>
            <div className="confirm-actions">
              {confirmDialog.cancelLabel && (
                <button className="btn btn-outline-secondary" onClick={closeConfirm}>
                  {confirmDialog.cancelLabel}
                </button>
              )}
              <button className={`btn ${confirmDialog.confirmClass}`} onClick={confirmDialog.onConfirm}>
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TagFormFields({ form, onChange }: {
  form: { name: string; icon: string; color: string; price: string };
  onChange: (f: any) => void;
}) {
  return (
    <div className="tag-mgmt-form-fields">
      <div className="tag-form-preview" style={{ background: form.color + "22", borderColor: form.color, color: form.color }}>
        <i className={form.icon || "fas fa-tag"} />
        <span>{form.name || "ชื่อแท็ก"}</span>
      </div>
      <div className="tag-form-grid">
        <div>
          <label className="tag-form-label">ชื่อแท็ก *</label>
          <input className="form-control form-control-sm" placeholder="เช่น ค้างชำระ" value={form.name}
            onChange={(e) => onChange((f: any) => ({ ...f, name: e.target.value }))} autoFocus />
        </div>
        <div>
          <label className="tag-form-label">ไอคอน (Font Awesome)</label>
          <input className="form-control form-control-sm" placeholder="fas fa-tag" value={form.icon}
            onChange={(e) => onChange((f: any) => ({ ...f, icon: e.target.value }))} />
        </div>
        <div>
          <label className="tag-form-label">สี</label>
          <div className="d-flex gap-2 align-items-center">
            <input type="color" className="form-control form-control-sm form-control-color" style={{ width: 48, padding: "2px" }}
              value={form.color} onChange={(e) => onChange((f: any) => ({ ...f, color: e.target.value }))} />
            <input className="form-control form-control-sm" style={{ fontFamily: "monospace" }}
              value={form.color} onChange={(e) => onChange((f: any) => ({ ...f, color: e.target.value }))} />
          </div>
        </div>
        <div>
          <label className="tag-form-label">ราคาเพิ่ม (฿/เดือน)</label>
          <input type="number" className="form-control form-control-sm" placeholder="0" min={0}
            value={form.price} onChange={(e) => onChange((f: any) => ({ ...f, price: e.target.value }))} />
        </div>
      </div>
    </div>
  );
}

const EMPTY_TAG_FORM = { name: "", icon: "fas fa-tag", color: "#6C9BCF", price: "0" };

const SUGGESTED_ICONS = [
  "fas fa-tag","fas fa-star","fas fa-heart","fas fa-home","fas fa-key",
  "fas fa-money-bill-wave","fas fa-exclamation-triangle","fas fa-check-circle",
  "fas fa-ban","fas fa-clock","fas fa-thumbs-up","fas fa-fire",
  "fas fa-cat","fas fa-dog","fas fa-smoking","fas fa-baby",
  "fas fa-car","fas fa-wifi","fas fa-tools","fas fa-shield-alt",
  "fas fa-crown","fas fa-user-tie","fas fa-users","fas fa-bolt",
];

function TagManagementView({
  tags, onTagsChange, onBack,
}: {
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
    setEditingId(null);
    setTagForm(EMPTY_TAG_FORM);
    setError("");
    setShowModal(true);
  }

  function startEdit(tag: any) {
    setEditingId(tag.id);
    setTagForm({ name: tag.name, icon: tag.icon || "fas fa-tag", color: tag.color || "#6C9BCF", price: String(tag.price ?? 0) });
    setError("");
    setShowModal(true);
  }

  function cancelForm() {
    setEditingId(null);
    setTagForm(EMPTY_TAG_FORM);
    setError("");
    setShowModal(false);
  }

  async function handleSave() {
    if (!tagForm.name.trim()) { setError("กรุณากรอกชื่อแท็ก"); return; }
    setSaving(true);
    setError("");
    try {
      if (editingId) {
        const updated = await tenantsApi.updateTag(editingId, tagForm);
        onTagsChange(tags.map((t) => (t.id === editingId ? updated : t)));
      } else {
        const created = await tenantsApi.createTag(tagForm);
        onTagsChange([...tags, created]);
      }
      toastSuccess("บันทึกแท็กสำเร็จ");
      cancelForm();
    } catch {
      setError("บันทึกไม่สำเร็จ กรุณาลองใหม่");
      toastError("บันทึกไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      await tenantsApi.deleteTag(id);
      onTagsChange(tags.filter((t) => t.id !== id));
      setDeleteId(null);
      if (editingId === id) cancelForm();
      toastSuccess("ลบแท็กสำเร็จ");
    } catch {
      setError("ลบไม่สำเร็จ กรุณาลองใหม่");
      toastError("ลบไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setDeleting(false);
    }
  }

  const previewPrice = Number(tagForm.price);

  return (
    <div className="custom-card page-view">

      {/* ─── Header ─── */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h5 className="form-section-title mb-0" style={{ borderBottom: "none" }}>จัดการแท็กผู้เช่า</h5>
        <button className="btn btn-primary" onClick={openAdd}>
          <i className="fas fa-plus me-2" />เพิ่มแท็กใหม่
        </button>
      </div>

      {/* ─── Search ─── */}
      <div className="search-container mb-4">
        <i className="fas fa-search" />
        <input
          type="text"
          className="form-control"
          placeholder="ค้นหาชื่อแท็ก..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* ─── Tag List ─── */}
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
                <div
                  className={`tower-item${editingId === tag.id ? " tower-item--active" : ""}`}
                  style={{ borderLeftColor: tag.color }}
                >
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
                    <button
                      className="edit-tag-btn"
                      onClick={() => startEdit(tag)}
                      disabled={saving || deleting}
                      title="แก้ไข"
                    >
                      <i className="fas fa-edit" />
                    </button>
                    <button
                      className="delete-tag-btn delete-btn"
                      onClick={() => setDeleteId(deleteId === tag.id ? null : tag.id)}
                      disabled={saving || deleting}
                      title="ลบ"
                    >
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

      {/* ─── Footer ─── */}
      <div className="d-flex mt-4 pt-3" style={{ borderTop: "1px solid var(--color-light)" }}>
        <button className="btn btn-outline-secondary" onClick={onBack}>
          <i className="fas fa-arrow-left me-1" />กลับ
        </button>
      </div>

      {/* ─── Add / Edit Modal ─── */}
      {showModal && (
        <div className="room-modal-overlay" onClick={cancelForm}>
          <div className="room-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>

            <div className="room-modal-header">
              <div className="room-modal-title">
                <i className={`fas ${editingId ? "fa-edit" : "fa-plus-circle"} me-2`} />
                {editingId ? "แก้ไขแท็ก" : "เพิ่มแท็กใหม่"}
              </div>
              <button className="room-modal-close" onClick={cancelForm}>
                <i className="fas fa-times" />
              </button>
            </div>

            <div className="room-modal-body" style={{ padding: "1.25rem 1.5rem" }}>
              <div className="row g-3">

                {/* ชื่อแท็ก */}
                <div className="col-12">
                  <label className="form-label">ชื่อแท็ก <span className="text-danger">*</span></label>
                  <input
                    className="form-control"
                    placeholder="เช่น ค้างชำระ, VIP, เลี้ยงสัตว์..."
                    value={tagForm.name}
                    autoFocus
                    onChange={(e) => setTagForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>

                {/* ไอคอน */}
                <div className="col-12">
                  <label className="form-label">ไอคอน (Font Awesome)</label>
                  <div className="input-group">
                    <span className="input-group-text" style={{ color: tagForm.color, minWidth: 44, fontSize: "1.1rem" }}>
                      <i className={tagForm.icon || "fas fa-tag"} />
                    </span>
                    <input
                      className="form-control"
                      placeholder="fas fa-tag"
                      value={tagForm.icon}
                      onChange={(e) => setTagForm((f) => ({ ...f, icon: e.target.value }))}
                    />
                  </div>
                </div>

                {/* Icon Picker */}
                <div className="col-12">
                  <label className="form-label small text-muted">เลือกไอคอนแนะนำ:</label>
                  <div className="tmv-icon-picker">
                    {SUGGESTED_ICONS.map((ic) => (
                      <button
                        key={ic}
                        type="button"
                        className={`tmv-icon-item${tagForm.icon === ic ? " tmv-icon-item--selected" : ""}`}
                        onClick={() => setTagForm((f) => ({ ...f, icon: ic }))}
                        title={ic}
                      >
                        <i className={ic} />
                      </button>
                    ))}
                  </div>
                </div>

                {/* สี + ราคา */}
                <div className="col-6">
                  <label className="form-label">สีแท็ก</label>
                  <input
                    type="color"
                    className="form-control form-control-color w-100"
                    value={tagForm.color}
                    title="เลือกสี"
                    onChange={(e) => setTagForm((f) => ({ ...f, color: e.target.value }))}
                  />
                </div>
                <div className="col-6">
                  <label className="form-label">ราคาบวกเพิ่ม (บาท)</label>
                  <input
                    type="number"
                    className="form-control"
                    placeholder="0"
                    min={0}
                    value={tagForm.price}
                    onChange={(e) => setTagForm((f) => ({ ...f, price: e.target.value }))}
                  />
                </div>

                {/* Preview */}
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

// ─── Import ผู้เช่าจาก CSV ──────────────────────────────────────────────────────
interface TenantCsvRow {
  roomNumber: string; title: string; firstName: string; lastName: string;
  idLicense: string; tel: string; idLine: string; amount: string;
  houseNo: string; soi: string; road: string; province: string; amphoe: string; tambon: string;
  zipcode: string; address: string;
}

// รูปแบบ: เลขห้อง,คำนำหน้า,ชื่อ,นามสกุล,เลขบัตรประชาชน,เบอร์โทร,LineID,จำนวนผู้เข้าพัก,
//         บ้านเลขที่,ซอย,ถนน,จังหวัด,อำเภอ,ตำบล,รหัสไปรษณีย์,ที่อยู่เพิ่มเติม
function parseTenantCsv(text: string): TenantCsvRow[] {
  const rows: TenantCsvRow[] = [];
  const lines = text.split(/\r?\n/).filter(Boolean);
  const start = /^\d/.test(lines[0]?.replace(/^﻿/, "").trim()) ? 0 : 1;
  for (let i = start; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.replace(/^"|"$/g, "").trim());
    if (!cols[2] && !cols[3]) continue; // ต้องมีอย่างน้อยชื่อหรือนามสกุล
    rows.push({
      roomNumber: cols[0] ?? "",
      title: cols[1] ?? "",
      firstName: cols[2] ?? "",
      lastName: cols[3] ?? "",
      idLicense: cols[4] ?? "",
      tel: cols[5] ?? "",
      idLine: cols[6] ?? "",
      amount: cols[7] ?? "",
      houseNo: cols[8] ?? "",
      soi: cols[9] ?? "",
      road: cols[10] ?? "",
      province: cols[11] ?? "",
      amphoe: cols[12] ?? "",
      tambon: cols[13] ?? "",
      zipcode: cols[14] ?? "",
      address: cols[15] ?? "",
    });
  }
  return rows;
}

function resolveTenantRoom(rooms: any[], roomNumber: string): any | null {
  const q = roomNumber.trim();
  if (!q) return null;
  return rooms.find((r) => String(r.number) === q) ?? null;
}

function TenantImportModal({ file, existingTenants, rooms, onClose, onImport }: {
  file: File; existingTenants: any[]; rooms: any[];
  onClose: () => void;
  onImport: (rows: { row: TenantCsvRow; roomId: string }[]) => void;
}) {
  const [rows, setRows] = useState<TenantCsvRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseTenantCsv(text);
      setRows(parsed);
      setSelected(new Set(
        parsed
          .map((r, i) => ({ r, i }))
          .filter(({ r }) => !(r.idLicense && existingTenants.some((et) => et.idLicense === r.idLicense)))
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
          <h6 className="confirm-title mb-0" style={{ textAlign: "left" }}>เลือกผู้เช่าที่ต้องการนำเข้า</h6>
        </div>

        {loading ? (
          <div className="text-center p-4"><div className="spinner-border spinner-border-sm" style={{ color: "var(--color-primary)" }} /></div>
        ) : rows.length === 0 ? (
          <p className="text-muted text-center">ไม่พบข้อมูลในไฟล์ CSV</p>
        ) : (
          <>
            <div style={{ background: "var(--color-background)", border: "1px solid var(--color-light)", borderRadius: "var(--border-radius-1)", padding: "6px 10px", marginBottom: 10, fontSize: "0.78rem", color: "var(--color-dark-variant)", fontFamily: "monospace" }}>
              <i className="fas fa-info-circle me-1" style={{ fontFamily: "inherit" }} />
              รูปแบบ: เลขห้อง, คำนำหน้า, ชื่อ, นามสกุล, เลขบัตรประชาชน, เบอร์โทร, LineID, จำนวนผู้เข้าพัก, บ้านเลขที่, ซอย, ถนน, จังหวัด, อำเภอ, ตำบล, รหัสไปรษณีย์, ที่อยู่เพิ่มเติม
              <br /><span style={{ opacity: 0.7 }}>เช่น&nbsp;&nbsp;101,นาย,สมชาย,ใจดี,1-2345-67890-12-3,0891234567,,1</span>
            </div>
            <div className="nicescrollbar" style={{ maxHeight: 320, overflowY: "auto", border: "1px solid var(--color-light)", borderRadius: "var(--border-radius-1)", padding: "0.5rem" }}>
              {rows.map((row, i) => {
                const dup = !!row.idLicense && existingTenants.some((et) => et.idLicense === row.idLicense);
                const room = resolveTenantRoom(rooms, row.roomNumber);
                return (
                  <label key={i}
                    className="d-flex align-items-center gap-2 p-2"
                    style={{ cursor: dup ? "not-allowed" : "pointer", opacity: dup ? 0.5 : 1, borderRadius: "var(--border-radius-1)" }}>
                    <input type="checkbox" className="form-check-input"
                      checked={selected.has(i) && !dup}
                      disabled={dup}
                      onChange={() => toggle(i)} />
                    <span className="flex-grow-1">
                      <strong>{row.title} {row.firstName} {row.lastName}</strong>
                      <small className="text-muted ms-2">
                        {room ? `ห้อง ${room.number}` : row.roomNumber ? `ไม่พบห้อง "${row.roomNumber}"` : "ไม่ระบุห้อง"}
                      </small>
                    </span>
                    {dup && <span className="badge bg-warning text-dark" style={{ fontSize: "0.72rem" }}>มีอยู่แล้ว</span>}
                  </label>
                );
              })}
            </div>
            <p className="mt-2 mb-0" style={{ fontSize: "0.82rem", color: "var(--color-info-dark)" }}>
              เลือก {selectedRows.length} รายการ
            </p>
          </>
        )}

        <div className="confirm-actions mt-3">
          <button className="btn btn-outline-secondary" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={selectedRows.length === 0 || loading}
            onClick={() => onImport(selectedRows.map(({ row }) => ({ row, roomId: resolveTenantRoom(rooms, row.roomNumber)?.id ?? "" })))}>
            <i className="fas fa-file-import me-1" />ยืนยันนำเข้า ({selectedRows.length} รายการ)
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TenantsPage() {
  const { setBreadcrumb } = useBreadcrumb();
  const navigate = useNavigate();
  const location = useLocation();
  const [tenants, setTenants] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [bills, setBills] = useState<BillGroup[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [towers, setTowers] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("checkInDate_desc");
  const [towerFilter, setTowerFilter] = useState("");
  const [view, setView] = usePersistedViewMode<ViewMode>("tenants", "list", ["list", "grid", "table"]);
  const [loading, setLoading] = useState(true);
  const [tenantTags, setTenantTags] = useState<any[]>([]);

  // Import CSV
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importDragOver, setImportDragOver] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Export CSV
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportSelectedIds, setExportSelectedIds] = useState<Set<string>>(new Set());

  const navState = (location.state as { subView?: SubView; tenantId?: string }) ?? {};
  const subView: SubView = navState.subView ?? "list";
  const detailTenant = navState.tenantId
    ? tenants.find((t) => String(t.id) === String(navState.tenantId)) ?? null
    : null;

  function goToList() {
    navigate("/tenants", { state: { subView: "list" } });
  }

  function goToDetail(tenant: any) {
    window.scrollTo(0, 0);
    navigate("/tenants", { state: { subView: "detail", tenantId: tenant.id } });
  }

  function goToForm() {
    navigate("/tenants", { state: { subView: "form" } });
  }

  function goToTags() {
    window.scrollTo(0, 0);
    navigate("/tenants", { state: { subView: "tags" } });
  }

  function goToEdit() {
    if (!detailTenant) return;
    window.scrollTo(0, 0);
    navigate("/tenants", { state: { subView: "edit", tenantId: detailTenant.id } });
  }

  useEffect(() => {
    if (subView === "list") {
      setBreadcrumb([{ label: "ผู้เช่า" }]);
    } else if (subView === "form") {
      setBreadcrumb([
        { label: "ผู้เช่า", onClick: goToList },
        { label: "เพิ่มผู้เช่า" },
      ]);
    } else if (subView === "tags") {
      setBreadcrumb([
        { label: "ผู้เช่า", onClick: goToList },
        { label: "จัดการแท็ก" },
      ]);
    } else if (subView === "detail" && detailTenant) {
      setBreadcrumb([
        { label: "ผู้เช่า", onClick: goToList },
        { label: tenantDisplayName(detailTenant) },
      ]);
    } else if (subView === "edit" && detailTenant) {
      setBreadcrumb([
        { label: "ผู้เช่า", onClick: goToList },
        { label: tenantDisplayName(detailTenant), onClick: () => goToDetail(detailTenant) },
        { label: "แก้ไขข้อมูล" },
      ]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subView, detailTenant?.id]);

  // บิลดิบจาก API อาจไม่มีฟิลด์บางตัว (เช่น paidAmount) ถ้ายังไม่เคยถูกเปิด/บันทึกซ้ำหลังมีฟีเจอร์นั้นๆ
  // ต้อง normalize ก่อนใช้เสมอ (เหมือนที่ BillsPage.tsx ทำ) ไม่งั้นค่า undefined จะกลายเป็น NaN
  // ตอนคำนวณยอดค้างชำระ แล้วดันถูกตีความว่า "จ่ายแล้ว" ทั้งที่จริงยังไม่จ่าย
  function normalizeBills(b: BillGroup[]): BillGroup[] {
    return b.map((g) => ({ ...g, data: g.data.map(normalizeBillItem) }));
  }

  useEffect(() => {
    Promise.all([tenantsApi.getAll(), roomsApi.getAll(), vehiclesApi.getAll(), tenantsApi.getTags(), billsApi.getAll(), billsApi.getPayments(), roomsApi.getTowers()])
      .then(([t, r, v, tg, b, pay, tw]) => { setTenants(t); setRooms(r); setVehicles(v); setTenantTags(tg); setBills(normalizeBills(b)); setPayments(pay); setTowers(tw); })
      .finally(() => setLoading(false));
    return () => setBreadcrumb([]);
  }, []);

  // มีคนอื่นแก้ไขผู้เช่า/ห้อง/รถ/แท็กผู้เช่า/บิล/การชำระเงิน/ตึกที่เครื่องอื่น — โหลดข้อมูลใหม่เงียบๆ ไม่เปิด loading spinner
  const tenantsLiveTick = useLiveRefreshTick(["tenant", "tenant-tag", "room", "vehicle", "bill", "payment", "tower"]);
  useEffect(() => {
    if (tenantsLiveTick === 0) return;
    Promise.all([tenantsApi.getAll(), roomsApi.getAll(), vehiclesApi.getAll(), tenantsApi.getTags(), billsApi.getAll(), billsApi.getPayments(), roomsApi.getTowers()])
      .then(([t, r, v, tg, b, pay, tw]) => { setTenants(t); setRooms(r); setVehicles(v); setTenantTags(tg); setBills(normalizeBills(b)); setPayments(pay); setTowers(tw); });
  }, [tenantsLiveTick]);

  // ห้องทั้งหมด (หลัก + เพิ่มเติม) ของผู้เช่าคนหนึ่งอยู่ตึกไหนบ้าง — ใช้กรองตาม towerFilter
  function tenantTowerIds(t: any): string[] {
    const ids = [t.idRoom, ...(Array.isArray(t.extraRoomIds) ? t.extraRoomIds : [])].filter(Boolean);
    const roomObjs = ids.map((id) => rooms.find((r) => String(r.id) === String(id) || String(r.number) === String(id))).filter(Boolean);
    return [...new Set(roomObjs.map((r: any) => String(r.towerId ?? "")))].filter(Boolean);
  }

  const filtered = useMemo(() => {
    let list = tenants.filter((t) => {
      const matchSearch = `${t.firstName} ${t.lastName} ${t.tel} ${getTenantRoomsLabel(rooms, t)}`.toLowerCase().includes(search.toLowerCase());
      const matchTower = !towerFilter || tenantTowerIds(t).includes(towerFilter);
      return matchSearch && matchTower;
    });
    switch (sort) {
      case "checkInDate_desc": list = [...list].sort((a, b) => (b.checkInDate || "") > (a.checkInDate || "") ? 1 : -1); break;
      case "checkInDate_asc": list = [...list].sort((a, b) => (a.checkInDate || "") > (b.checkInDate || "") ? 1 : -1); break;
      case "name_asc": list = [...list].sort((a, b) => `${a.firstName}${a.lastName}`.localeCompare(`${b.firstName}${b.lastName}`, "th")); break;
      case "name_desc": list = [...list].sort((a, b) => `${b.firstName}${b.lastName}`.localeCompare(`${a.firstName}${a.lastName}`, "th")); break;
    }
    return list;
  }, [tenants, rooms, search, sort, towerFilter]);

  function downloadTenantCsvTemplate() {
    const lines: string[] = [
      "เลขห้อง,คำนำหน้า,ชื่อ,นามสกุล,เลขบัตรประชาชน,เบอร์โทร,LineID,จำนวนผู้เข้าพัก,บ้านเลขที่,ซอย,ถนน,จังหวัด,อำเภอ,ตำบล,รหัสไปรษณีย์,ที่อยู่เพิ่มเติม",
    ];
    lines.push(`${rooms[0]?.number ?? "101"},นาย,สมชาย,ใจดี,,0891234567,,1,,,,,,,,`);
    const csv = "﻿" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tenant_template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleTenantImportConfirm(selectedRows: { row: TenantCsvRow; roomId: string }[]) {
    setImportFile(null);
    setImporting(true);
    try {
      const created: any[] = [];
      for (const { row, roomId } of selectedRows) {
        const newTenant = await tenantsApi.create({
          formData: {
            title: row.title,
            firstName: row.firstName,
            lastName: row.lastName,
            idLicense: row.idLicense,
            tel: row.tel,
            idLine: row.idLine,
            lineUserId: "",
            amount: row.amount,
            houseNo: row.houseNo,
            soi: row.soi,
            road: row.road,
            province: row.province,
            amphoe: row.amphoe,
            tambon: row.tambon,
            zipcode: row.zipcode,
            address: row.address,
            roomId,
          },
        });
        created.push(newTenant);
      }
      setTenants((prev) => [...created, ...prev]);
      const occupiedRoomIds = new Set(created.map((t) => String(t.idRoom ?? "")).filter(Boolean));
      if (occupiedRoomIds.size > 0) {
        setRooms((prev) => prev.map((r) =>
          occupiedRoomIds.has(String(r.id)) ? { ...r, status: "ไม่ว่าง" } : r
        ));
      }
      toastSuccess("นำเข้าข้อมูลผู้เช่าสำเร็จ");
    } catch (e: any) {
      const msg = "เกิดข้อผิดพลาดในการนำเข้า: " + (e?.response?.data?.error ?? e?.message ?? "Unknown error");
      toastError(msg);
    } finally {
      setImporting(false);
    }
  }

  function openExportDialog() {
    setExportSelectedIds(new Set(tenants.map((t) => t.id)));
    setShowExportDialog(true);
  }

  // Export ตามรูปแบบเดียวกับ Import — นำไฟล์ที่ export ได้กลับไป Import ใหม่ได้เลย
  function doExportTenants() {
    const sorted = tenants
      .filter((t) => exportSelectedIds.has(t.id))
      .sort((a, b) => `${a.firstName}${a.lastName}`.localeCompare(`${b.firstName}${b.lastName}`, "th"));
    const lines: string[] = [
      "เลขห้อง,คำนำหน้า,ชื่อ,นามสกุล,เลขบัตรประชาชน,เบอร์โทร,LineID,จำนวนผู้เข้าพัก,บ้านเลขที่,ซอย,ถนน,จังหวัด,อำเภอ,ตำบล,รหัสไปรษณีย์,ที่อยู่เพิ่มเติม",
    ];
    sorted.forEach((t) => {
      const roomNumber = getRoomNumber(rooms, t.idRoom);
      lines.push([
        roomNumber ?? "",
        t.title ?? "",
        t.firstName ?? "",
        t.lastName ?? "",
        t.idLicense ?? "",
        t.tel ?? "",
        t.idLine ?? "",
        t.amount ?? "",
        t.houseNo ?? "",
        t.soi ?? "",
        t.road ?? "",
        t.province ?? "",
        t.amphoe ?? "",
        t.tambon ?? "",
        t.zipcode ?? "",
        String(t.address ?? "").replace(/,/g, " "),
      ].join(","));
    });
    const csv = "﻿" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tenant_export_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowExportDialog(false);
  }

  const detailIndex = detailTenant ? filtered.findIndex((t) => t.id === detailTenant.id) : -1;
  const towerOptions = [{ value: "", label: "ทั้งหมด (ตึก)" }, ...towers.map((t) => ({ value: t.id, label: t.name }))];

  if (subView === "form") {
    return (
      <div className="page-view">
        <TenantFormView
          onBack={goToList}
          onSuccess={(newTenant) => {
            setTenants((prev) => [newTenant, ...prev]);
            if (newTenant.idRoom) {
              setRooms((prev) => prev.map((r) =>
                String(r.id) === String(newTenant.idRoom) ? { ...r, status: "ไม่ว่าง" } : r
              ));
            }
            goToList();
          }}
        />
      </div>
    );
  }

  if (subView === "tags") {
    return (
      <TagManagementView
        tags={tenantTags}
        onTagsChange={setTenantTags}
        onBack={goToList}
      />
    );
  }

  if (subView === "edit" && detailTenant) {
    return (
      <div className="page-view">
        <TenantEditView
          tenant={detailTenant}
          onBack={() => goToDetail(detailTenant)}
          onSuccess={(updated) => {
            setTenants((prev) => prev.map((t) => t.id === updated.id ? updated : t));
            goToDetail(updated);
          }}
        />
      </div>
    );
  }

  if (subView === "detail" && detailTenant) {
    return (
      <TenantDetailView
        tenant={detailTenant}
        allTenants={filtered}
        rooms={rooms}
        vehicles={vehicles}
        bills={bills}
        payments={payments}
        onBack={goToList}
        onPrev={() => detailIndex > 0 && goToDetail(filtered[detailIndex - 1])}
        onNext={() => detailIndex < filtered.length - 1 && goToDetail(filtered[detailIndex + 1])}
        hasPrev={detailIndex > 0}
        hasNext={detailIndex < filtered.length - 1}
        allTags={tenantTags}
        onSelectTenant={goToDetail}
        onEdit={goToEdit}
        onTenantUpdate={(updated: any) => {
          setTenants((prev: any[]) => prev.map((t) => t.id === updated.id ? updated : t));
        }}
        onDelete={() => {
          const vacatedIds = [detailTenant.idRoom, ...(Array.isArray(detailTenant.extraRoomIds) ? detailTenant.extraRoomIds : [])]
            .filter(Boolean).map(String);
          if (vacatedIds.length > 0) {
            setRooms((prev) => prev.map((r) => vacatedIds.includes(String(r.id)) ? { ...r, status: "ว่าง" } : r));
          }
          setTenants((prev) => prev.filter((t) => t.id !== detailTenant.id));
          goToList();
        }}
      />
    );
  }

  return (
    <div id="tenantListCard" className="custom-card page-view">
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-3 page-list-toolbar">
        <h5 className="form-section-title mb-0" style={{ borderBottom: "none" }}>รายชื่อผู้เช่าปัจจุบัน</h5>
        <ToolbarActionsMenu>
          <button type="button" id="exportExcelBtn" className="btn btn-outline-secondary d-inline-flex align-items-center justify-content-center"
            onClick={openExportDialog} disabled={tenants.length === 0}>
            <i className="fas fa-file-export me-2" /><span>Export</span>
          </button>
          <input ref={importInputRef} type="file" accept=".csv" className="d-none"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) { setShowImportDialog(false); setImportFile(f); }
              e.target.value = "";
            }} />
          <button type="button" id="importTenantBtn" className="btn btn-outline-secondary d-inline-flex align-items-center justify-content-center"
            style={{ color: "var(--color-import)", borderColor: "var(--color-import)" }}
            disabled={importing} onClick={() => setShowImportDialog(true)}>
            {importing
              ? <><span className="spinner-border spinner-border-sm me-2" />กำลังนำเข้า...</>
              : <><i className="fas fa-file-import me-2" /><span>Import</span></>}
          </button>
          <button type="button" className="btn btn-outline-primary d-inline-flex align-items-center justify-content-center" onClick={goToTags}>
            <i className="fas fa-tags me-2" /><span>จัดการแท็ก</span>
          </button>
          <button id="showRegisterFormBtn" className="btn btn-primary d-inline-flex align-items-center justify-content-center" onClick={goToForm}>
            <i className="fas fa-plus me-2" /><span>เพิ่มผู้เช่า</span>
          </button>
        </ToolbarActionsMenu>
      </div>

      <div className="row g-2 mb-3 align-items-center">
        <div className="col-12 col-lg">
          <div className="search-container flex-grow-1">
            <i className="fas fa-search" />
            <input type="text" className="form-control" placeholder="ค้นหาด้วยชื่อ, เลขห้อง, เบอร์โทร..."
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="col-12 col-md-auto" style={{ minWidth: 170 }}>
          <CustomSelect2
            inputId="towerFilterTenant"
            value={towerOptions.find((o) => o.value === towerFilter) ?? towerOptions[0]}
            options={towerOptions}
            onChange={(opt: any) => setTowerFilter(opt?.value ?? "")}
            isSearchable={false}
            placeholder="ทั้งหมด (ตึก)"
          />
        </div>
        <div className="col-12 col-md-auto">
          <CustomSelect2
            inputId="sortTenant"
            value={{ value: sort, label: { checkInDate_desc: "เข้าพักล่าสุดก่อน", checkInDate_asc: "เข้าพักเก่าสุดก่อน", name_asc: "ชื่อ (ก-ฮ)", name_desc: "ชื่อ (ฮ-ก)" }[sort] }}
            options={[
              { value: "checkInDate_desc", label: "เข้าพักล่าสุดก่อน" },
              { value: "checkInDate_asc", label: "เข้าพักเก่าสุดก่อน" },
              { value: "name_asc", label: "ชื่อ (ก-ฮ)" },
              { value: "name_desc", label: "ชื่อ (ฮ-ก)" },
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
                  className={`btn btn-outline-secondary view-btn${view === v ? " active" : ""}`}
                  onClick={() => setView(v)}>
                  <i className={`fas fa-${v === "list" ? "list" : v === "grid" ? "th-large" : "table"}`} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="text-muted mb-2" style={{ fontSize: "0.85rem" }}>ทั้งหมด {filtered.length} รายการ</div>

      {loading ? (
        <div className="text-center p-5"><div className="spinner-border" style={{ color: "var(--color-primary)" }} /></div>
      ) : view === "table" ? (
        <TenantTableView
          data={filtered}
          rooms={rooms}
          onViewDetail={goToDetail}
          onDelete={async (tenant) => {
            await tenantsApi.delete(tenant.id);
            const vacatedIds = [tenant.idRoom, ...(Array.isArray(tenant.extraRoomIds) ? tenant.extraRoomIds : [])]
              .filter(Boolean).map(String);
            if (vacatedIds.length > 0) {
              setRooms((prev) => prev.map((r) => vacatedIds.includes(String(r.id)) ? { ...r, status: "ว่าง" } : r));
            }
            setTenants((prev) => prev.filter((t) => t.id !== tenant.id));
          }}
          onDeleteBulk={async (tenantsToDelete) => {
            await Promise.all(tenantsToDelete.map((t) => tenantsApi.delete(t.id)));
            const deletedIds = new Set(tenantsToDelete.map((t) => t.id));
            const freedRoomIds = new Set(
              tenantsToDelete.flatMap((t) =>
                [t.idRoom, ...(Array.isArray(t.extraRoomIds) ? t.extraRoomIds : [])].filter(Boolean).map(String)
              )
            );
            if (freedRoomIds.size > 0) {
              setRooms((prev) => prev.map((r) =>
                freedRoomIds.has(String(r.id)) ? { ...r, status: "ว่าง" } : r
              ));
            }
            setTenants((prev) => prev.filter((t) => !deletedIds.has(t.id)));
          }}
        />
      ) : (
        <div id="tenantListContainer" style={{ maxHeight: 650, overflow: "auto" }} className="nicescrollbar">
          <ul id="tenantList" className={`list-group list-group-flush view-${view}`}>
            {filtered.map((t) => (
              <li key={t.id} className="list-group-item p-2" style={{ cursor: "pointer" }} onClick={() => goToDetail(t)}>
                {view === "grid" ? (
                  <div>
                    <div className="tenant-grid-header">
                      <img className="tenant-list-avatar"
                        src={getDriveImgSrc(t.driveImageUrl)}
                        onError={(e) => { (e.target as HTMLImageElement).src = AVATAR; }}
                        alt={t.firstName} />
                      <div>
                        <strong>{tenantDisplayName(t)}</strong><br />
                        <small className="text-muted">ห้อง {getTenantRoomsLabel(rooms, t) || "-"}</small>
                      </div>
                    </div>
                    <hr />
                    <small><i className="fas fa-phone me-1 text-muted" />{t.tel}</small>
                  </div>
                ) : (
                  <div className="d-flex align-items-center gap-3 py-1">
                    <img className="tenant-list-avatar"
                      src={getDriveImgSrc(t.driveImageUrl)}
                      onError={(e) => { (e.target as HTMLImageElement).src = AVATAR; }}
                      alt={t.firstName} />
                    <div className="flex-grow-1">
                      <strong>{tenantDisplayName(t)}</strong>
                      <div className="d-flex gap-3 mt-1">
                        <small><i className="fas fa-door-open me-1 text-muted" />ห้อง {getTenantRoomsLabel(rooms, t) || "-"}</small>
                        <small><i className="fas fa-phone me-1 text-muted" />{t.tel}</small>
                        {t.checkInDate && <small><i className="fas fa-calendar me-1 text-muted" />{formatCheckInDate(t.checkInDate)}</small>}
                      </div>
                    </div>
                    <i className="fas fa-chevron-right text-muted" />
                  </div>
                )}
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="list-group-item text-center text-muted p-4">ไม่พบข้อมูล</li>
            )}
          </ul>
        </div>
      )}

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
                  <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--color-dark)", lineHeight: 1.3 }}>นำเข้าข้อมูลผู้เช่า</div>
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
              <button className="import-template-card" onClick={downloadTenantCsvTemplate}>
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
                <span>คอลัมน์: <strong>เลขห้อง, คำนำหน้า, ชื่อ, นามสกุล, เลขบัตรประชาชน, เบอร์โทร, LineID, จำนวนผู้เข้าพัก, ...ที่อยู่</strong></span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal (เลือกผู้เช่าที่จะนำเข้า) */}
      {importFile && (
        <TenantImportModal
          file={importFile}
          existingTenants={tenants}
          rooms={rooms}
          onClose={() => setImportFile(null)}
          onImport={handleTenantImportConfirm}
        />
      )}

      {/* Export Dialog */}
      {showExportDialog && (() => {
        const sortedTenants = [...tenants].sort((a, b) => `${a.firstName}${a.lastName}`.localeCompare(`${b.firstName}${b.lastName}`, "th"));
        const allSelected = sortedTenants.every((t) => exportSelectedIds.has(t.id));
        return (
          <div className="confirm-overlay" onClick={() => setShowExportDialog(false)}>
            <div className="import-dialog" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
              <div className="import-dialog-header">
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div className="import-dialog-icon" style={{ background: "linear-gradient(135deg,rgba(76,175,80,0.2),rgba(76,175,80,0.08))", borderColor: "rgba(76,175,80,0.25)", color: "#4caf50" }}>
                    <i className="fas fa-file-export" />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--color-dark)", lineHeight: 1.3 }}>ส่งออกข้อมูลผู้เช่า</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--color-dark-variant)" }}>เลือกผู้เช่าที่ต้องการส่งออก</div>
                  </div>
                </div>
                <button className="import-dialog-close" onClick={() => setShowExportDialog(false)}>
                  <i className="fas fa-times" />
                </button>
              </div>

              <div className="import-dialog-body">
                <div style={{ fontSize: "0.75rem", color: "var(--color-dark-variant)", padding: "0 2px" }}>
                  <i className="fas fa-info-circle me-1" />เลขห้อง, คำนำหน้า, ชื่อ, นามสกุล, เลขบัตรประชาชน, เบอร์โทร, LineID, จำนวนผู้เข้าพัก, ...ที่อยู่ — นำกลับมา Import ได้
                </div>

                <div style={{ borderRadius: 12, border: "1px solid var(--color-light)", overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "var(--color-background)", borderBottom: "1px solid var(--color-light)" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.82rem", fontWeight: 600, color: "var(--color-dark-variant)" }}>
                      <input type="checkbox" style={{ accentColor: "var(--color-primary)", width: 15, height: 15 }}
                        checked={allSelected}
                        onChange={(e) => setExportSelectedIds(e.target.checked ? new Set(sortedTenants.map((t) => t.id)) : new Set())} />
                      เลือกทั้งหมด ({sortedTenants.length} คน)
                    </label>
                    <span style={{ fontSize: "0.75rem", color: "var(--color-primary)", fontWeight: 600 }}>
                      {exportSelectedIds.size} คน
                    </span>
                  </div>

                  <div className="nicescrollbar" style={{ maxHeight: 280, overflowY: "auto" }}>
                    {sortedTenants.map((t) => {
                      const roomNumber = getTenantRoomsLabel(rooms, t);
                      const checked = exportSelectedIds.has(t.id);
                      return (
                        <label key={t.id}
                          style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid var(--color-light)", transition: "background 0.12s", background: checked ? "rgba(108,155,207,0.05)" : "transparent" }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-background)")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = checked ? "rgba(108,155,207,0.05)" : "transparent")}>
                          <input type="checkbox" style={{ accentColor: "var(--color-primary)", width: 15, height: 15, flexShrink: 0 }}
                            checked={checked}
                            onChange={(e) => {
                              const next = new Set(exportSelectedIds);
                              e.target.checked ? next.add(t.id) : next.delete(t.id);
                              setExportSelectedIds(next);
                            }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: "0.88rem", color: "var(--color-dark)" }}>{tenantDisplayName(t)}</div>
                            {roomNumber && <div style={{ fontSize: "0.72rem", color: "var(--color-dark-variant)" }}><i className="fas fa-door-open me-1" />ห้อง {roomNumber}</div>}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="btn btn-outline-secondary btn-sm" onClick={() => setShowExportDialog(false)}>ยกเลิก</button>
                  <button className="btn btn-success btn-sm d-inline-flex align-items-center"
                    disabled={exportSelectedIds.size === 0}
                    onClick={doExportTenants}>
                    <i className="fas fa-download me-2" />ดาวน์โหลด CSV
                    <span style={{ marginLeft: 6, background: "rgba(255,255,255,0.25)", borderRadius: 10, padding: "1px 8px", fontSize: "0.8em" }}>
                      {exportSelectedIds.size} คน
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
