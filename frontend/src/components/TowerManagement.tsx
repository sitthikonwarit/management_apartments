import { useState, useEffect } from "react";
import { roomsApi, tenantsApi } from "../api/client";
import { tenantDisplayName } from "../utils/tenantName";
import { findTenantForRoom, roomHasTenant } from "../utils/tenantRoom";
import EmptyState from "./EmptyState";

// ─── helpers ──────────────────────────────────────────────────────────────────
function statusClass(s: string) {
  if (s === "ว่าง") return "status-available";
  if (s === "ปิดปรับปรุง" || s === "ปรับปรุง") return "status-maintenance";
  if (s === "จอง") return "status-booked";
  return "status-occupied";
}

// ─── Room Generate Modal ───────────────────────────────────────────────────────
function RoomGenerateModal({
  tower,
  existingNumbers,
  onConfirm,
  onClose,
}: {
  tower: any;
  existingNumbers: Set<string>;
  onConfirm: (rooms: any[]) => Promise<void>;
  onClose: () => void;
}) {
  const roomsPerFloor: number[] = Array.isArray(tower.roomsPerFloor) ? tower.roomsPerFloor : [];
  const totalConfigured = roomsPerFloor.reduce((s, n) => s + (Number(n) || 0), 0);
  const candidates: any[] = [];
  for (let fi = 0; fi < roomsPerFloor.length; fi++) {
    const floor = fi + 1;
    const count = Number(roomsPerFloor[fi]) || 0;
    for (let ri = 1; ri <= count; ri++) {
      const num = `${tower.prefix || ""}${floor}${String(ri).padStart(2, "0")}`;
      if (!existingNumbers.has(num)) {
        candidates.push({ number: num, floor, price: tower.monthlyPrice || 0, dailyPrice: tower.dailyPrice || 0, detail: tower.details || "" });
      }
    }
  }

  const [selected, setSelected] = useState<Set<string>>(() => new Set(candidates.map((c) => c.number)));
  const [saving, setSaving] = useState(false);
  const [genError, setGenError] = useState("");

  if (candidates.length === 0) {
    const isUnconfigured = totalConfigured === 0;
    return (
      <div className="room-select-modal-overlay show" style={{ zIndex: 1060 }}>
        <div className="room-select-modal-content" style={{ maxWidth: 480 }}>
          <div className="import-modal-header">
            <h5>สร้างห้องอัตโนมัติ</h5>
            <button className="close-btn" onClick={onClose}>×</button>
          </div>
          <div className="import-modal-body text-center p-4">
            <i className={`fas ${isUnconfigured ? "fa-exclamation-circle text-warning" : "fa-check-circle text-success"} fa-2x mb-3`} />
            {isUnconfigured ? (
              <>
                <p className="fw-semibold">ยังไม่ได้กำหนดจำนวนห้องในแต่ละชั้น</p>
                <p className="text-muted small">กรุณาระบุจำนวนห้องพักในแต่ละชั้นในส่วน "โครงสร้างตึก" แล้วบันทึกก่อนสร้างห้อง</p>
              </>
            ) : (
              <p>ห้องทั้งหมดตามโครงสร้างตึกมีอยู่ในระบบแล้ว</p>
            )}
            <button className="btn btn-secondary mt-2" onClick={onClose}>ปิด</button>
          </div>
        </div>
      </div>
    );
  }

  const allSelected = selected.size === candidates.length;

  async function handleConfirm() {
    const rooms = candidates.filter((c) => selected.has(c.number));
    if (!rooms.length) return;
    setSaving(true);
    setGenError("");
    try {
      await onConfirm(rooms);
    } catch {
      setGenError("เกิดข้อผิดพลาดในการสร้างห้อง กรุณาลองใหม่");
      setSaving(false);
    }
  }

  return (
    <div className="room-select-modal-overlay show" style={{ zIndex: 1060 }}>
      <div className="room-select-modal-content" style={{ maxWidth: 700 }}>
        <div className="import-modal-header">
          <h5>สร้างห้องอัตโนมัติ — ตึก {tower.name}</h5>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="import-modal-body">
          <p className="text-muted mb-3">
            ระบบตรวจพบ <strong>{candidates.length}</strong> ห้องใหม่ที่สามารถสร้างได้
            <br />กรุณาเลือกห้องที่ต้องการสร้าง:
          </p>
          <div className="d-flex justify-content-between align-items-center mb-2">
            <div className="form-check form-switch">
              <input
                className="form-check-input" type="checkbox" role="switch"
                id="gen-select-all" checked={allSelected}
                onChange={(e) => setSelected(e.target.checked ? new Set(candidates.map((c) => c.number)) : new Set())}
              />
              <label className="form-check-label" htmlFor="gen-select-all">
                เลือกทั้งหมด ({candidates.length} ห้อง)
              </label>
            </div>
            <span className="text-muted small">เลือกแล้ว {selected.size} ห้อง</span>
          </div>
          <div style={{ maxHeight: 400, overflowY: "auto" }} className="nicescrollbar">
            <div className="list-group">
              {candidates.map((c) => (
                <label key={c.number} className="list-group-item list-group-item-action d-flex justify-content-between align-items-center" style={{ cursor: "pointer" }}>
                  <div className="d-flex align-items-center gap-2">
                    <input
                      type="checkbox" className="form-check-input"
                      checked={selected.has(c.number)}
                      onChange={(e) => {
                        const s = new Set(selected);
                        e.target.checked ? s.add(c.number) : s.delete(c.number);
                        setSelected(s);
                      }}
                    />
                    <span className="fw-semibold">ห้อง {c.number}</span>
                    <span className="text-muted small">ชั้น {c.floor}</span>
                  </div>
                  <span className="text-muted small">{c.price > 0 ? `${Number(c.price).toLocaleString()} ฿/เดือน` : "ไม่มีราคา"}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        {genError && <div className="alert alert-danger py-2 mx-3 mb-0">{genError}</div>}
        <div className="import-modal-footer d-flex justify-content-end gap-2">
          <button className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>ยกเลิก</button>
          <button className="btn btn-primary" onClick={handleConfirm} disabled={saving || selected.size === 0}>
            {saving ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="fas fa-check me-1" />}
            ยืนยันการสร้าง ({selected.size} ห้อง)
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tower Form ────────────────────────────────────────────────────────────────
function TowerForm({
  tower,
  allRooms,
  tenants,
  onSaved,
  onBack,
  onRoomsUpdate,
  onTenantsUpdate,
}: {
  tower: any | null;
  allRooms: any[];
  tenants: any[];
  onSaved: (t: any) => void;
  onBack: () => void;
  onRoomsUpdate: (rooms: any[]) => void;
  onTenantsUpdate: (updater: (prev: any[]) => any[]) => void;
}) {
  const [form, setForm] = useState({
    name: tower?.name ?? "",
    prefix: tower?.prefix ?? "",
    color: tower?.color ?? "#6C9BCF",
    floorCount: tower?.floorCount ?? 1,
    roomsPerFloor: (tower?.roomsPerFloor as number[])?.length ? (tower?.roomsPerFloor as number[]) : [1],
    monthlyPriceEnabled: (tower?.monthlyPrice ?? 0) > 0,
    monthlyPrice: tower?.monthlyPrice ?? 0,
    dailyPriceEnabled: (tower?.dailyPrice ?? 0) > 0,
    dailyPrice: tower?.dailyPrice ?? 0,
    details: tower?.details ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [roomSearch, setRoomSearch] = useState("");

  useEffect(() => {
    if (!tower) return;
    setForm({
      name: tower.name ?? "",
      prefix: tower.prefix ?? "",
      color: tower.color ?? "#6C9BCF",
      floorCount: tower.floorCount ?? 1,
      roomsPerFloor: (tower.roomsPerFloor as number[])?.length ? (tower.roomsPerFloor as number[]) : [1],
      monthlyPriceEnabled: (tower.monthlyPrice ?? 0) > 0,
      monthlyPrice: tower.monthlyPrice ?? 0,
      dailyPriceEnabled: (tower.dailyPrice ?? 0) > 0,
      dailyPrice: tower.dailyPrice ?? 0,
      details: tower.details ?? "",
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tower?.id]);
  const [floorFilter, setFloorFilter] = useState("all");
  const [selectedRooms, setSelectedRooms] = useState<Set<string>>(new Set());
  const [deletingRooms, setDeletingRooms] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [resolveMode, setResolveMode] = useState<"remove" | "move" | null>(null);
  const [moveTargetRoomId, setMoveTargetRoomId] = useState<string>("");
  const [showGenModal, setShowGenModal] = useState(false);

  const roomsInTower = allRooms.filter((r) => r.towerId === tower?.id);
  const floors = [...new Set(roomsInTower.map((r) => String(r.floor)).filter(Boolean))].sort((a, b) =>
    Number(a) - Number(b)
  );
  const filteredRooms = roomsInTower
    .filter((r) => {
      const matchSearch = !roomSearch || String(r.number).toLowerCase().includes(roomSearch.toLowerCase());
      const matchFloor = floorFilter === "all" || String(r.floor) === floorFilter;
      return matchSearch && matchFloor;
    })
    .sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));

  function setFloor(count: number) {
    const clamped = Math.max(1, Math.min(50, count));
    const rpf = [...form.roomsPerFloor];
    while (rpf.length < clamped) rpf.push(rpf[0] ?? 1);
    setForm({ ...form, floorCount: clamped, roomsPerFloor: rpf.slice(0, clamped) });
  }

  async function handleSave() {
    if (!form.name.trim()) { setError("กรุณาระบุชื่อตึก"); return; }
    if (form.floorCount < 1) { setError("จำนวนชั้นต้องมากกว่า 0"); return; }
    setError("");
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        prefix: form.prefix.trim(),
        color: form.color,
        floorCount: form.floorCount,
        roomsPerFloor: form.roomsPerFloor,
        monthlyPrice: form.monthlyPriceEnabled ? form.monthlyPrice : 0,
        dailyPrice: form.dailyPriceEnabled ? form.dailyPrice : 0,
        details: form.details,
      };
      const result = tower
        ? await roomsApi.updateTower(tower.id, payload)
        : await roomsApi.createTower(payload);
      onSaved(result);
    } catch {
      setError("เกิดข้อผิดพลาด กรุณาลองใหม่");
    } finally {
      setSaving(false);
    }
  }

  function findRoomTenant(roomId: string) {
    const room = allRooms.find((r) => r.id === roomId);
    if (!room) return null;
    return findTenantForRoom(tenants, room);
  }

  function closeConfirmDelete() {
    setConfirmDelete(null);
    setResolveMode(null);
    setMoveTargetRoomId("");
  }

  async function doDeleteRooms(ids: string[]) {
    setDeletingRooms(true);
    try {
      await roomsApi.bulkDelete(ids);
      onRoomsUpdate(allRooms.filter((r) => !ids.includes(r.id)));
      setSelectedRooms(new Set());
    } finally {
      setDeletingRooms(false);
      closeConfirmDelete();
    }
  }

  async function doResolveTenantAndDeleteRoom() {
    if (!confirmDelete || confirmDelete.length !== 1) return;
    const roomId = confirmDelete[0];
    const tenant = findRoomTenant(roomId);
    if (!tenant) return;
    if (resolveMode === "move" && !moveTargetRoomId) return;
    setDeletingRooms(true);
    try {
      const { tenantsApi } = await import("../api/client");
      const newRoomId = resolveMode === "move" ? moveTargetRoomId : "";
      await tenantsApi.updateRoom(tenant.id, newRoomId);
      onTenantsUpdate((prev) => prev.map((t) => (t.id === tenant.id ? { ...t, idRoom: newRoomId } : t)));
      await roomsApi.bulkDelete([roomId]);
      let nextRooms = allRooms.filter((r) => r.id !== roomId);
      if (resolveMode === "move") {
        nextRooms = nextRooms.map((r) => (r.id === moveTargetRoomId ? { ...r, status: "ไม่ว่าง" } : r));
      }
      onRoomsUpdate(nextRooms);
      setSelectedRooms(new Set());
      closeConfirmDelete();
    } finally {
      setDeletingRooms(false);
    }
  }

  async function handleToggleRoom(roomId: string, isActive: boolean) {
    const updated = await roomsApi.toggleActive(roomId, isActive);
    onRoomsUpdate(allRooms.map((r) => (r.id === roomId ? updated : r)));
  }

  async function handleGenerate(rooms: any[]) {
    const result = await roomsApi.generate(tower!.id, rooms);
    onRoomsUpdate([...allRooms, ...result.created]);
    setShowGenModal(false);
  }

  const existingNumbers = new Set(roomsInTower.map((r) => String(r.number)));

  return (
    <>
      <div className="custom-card">
        <div className="row g-3">

          {/* ── ข้อมูลตึก ── */}
          <div className="col-12 mt-2">
            <h5 className="form-section-title">{tower ? "แก้ไขตึก" : "เพิ่มตึกใหม่"}</h5>
          </div>

          <div className="col-12">
            <label className="form-label">ชื่อตึก<span className="text-danger">*</span></label>
            <input className="form-control" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="เช่น ตึก A, อาคารมหาโชค" />
          </div>
          <div className="col-md-6">
            <label className="form-label">คำนำหน้าห้อง</label>
            <input className="form-control" value={form.prefix}
              onChange={(e) => setForm({ ...form, prefix: e.target.value })}
              placeholder="เช่น A" />
          </div>
          <div className="col-md-6">
            <label className="form-label">สีประจำตึก</label>
            <input type="color" className="form-control form-control-color w-100" value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })} />
          </div>

          {/* ── ราคา ── */}
          <div className="col-12 mt-2">
            <h5 className="form-section-title">ราคาเริ่มต้น</h5>
          </div>
          <div className="col-md-6">
            <label className="form-label">ราคาเช่า/เดือน</label>
            <div className="input-group">
              <div className="input-group-text">
                <input type="checkbox" className="form-check-input mt-0" checked={form.monthlyPriceEnabled}
                  onChange={(e) => setForm({ ...form, monthlyPriceEnabled: e.target.checked })} />
              </div>
              <span className="input-group-text"><i className="fas fa-dollar-sign" /></span>
              <input type="number" className="form-control" disabled={!form.monthlyPriceEnabled}
                value={form.monthlyPriceEnabled ? form.monthlyPrice : ""} placeholder="เช่น 3500"
                onChange={(e) => setForm({ ...form, monthlyPrice: Number(e.target.value) || 0 })} />
            </div>
          </div>
          <div className="col-md-6">
            <label className="form-label">ราคาเช่า/วัน</label>
            <div className="input-group">
              <div className="input-group-text">
                <input type="checkbox" className="form-check-input mt-0" checked={form.dailyPriceEnabled}
                  onChange={(e) => setForm({ ...form, dailyPriceEnabled: e.target.checked })} />
              </div>
              <span className="input-group-text"><i className="fas fa-sun" /></span>
              <input type="number" className="form-control" disabled={!form.dailyPriceEnabled}
                value={form.dailyPriceEnabled ? form.dailyPrice : ""} placeholder="เช่น 500"
                onChange={(e) => setForm({ ...form, dailyPrice: Number(e.target.value) || 0 })} />
            </div>
          </div>
          <div className="col-12">
            <label className="form-label">รายละเอียด (ค่าเริ่มต้น)</label>
            <textarea className="form-control" rows={3} value={form.details}
              onChange={(e) => setForm({ ...form, details: e.target.value })}
              placeholder="ระบุรายละเอียดหรือสิ่งอำนวยความสะดวกเริ่มต้น..." />
          </div>

          {/* ── โครงสร้าง ── */}
          <div className="col-12 mt-2">
            <h5 className="form-section-title">โครงสร้างตึก</h5>
          </div>
          <div className="col-12">
            <label className="form-label">จำนวนชั้น<span className="text-danger">*</span></label>
            <input type="number" className="form-control" min={1} max={50} value={form.floorCount}
              onChange={(e) => setFloor(Number(e.target.value) || 1)} />
          </div>
          <div className="col-12">
            <label className="form-label">จำนวนห้องในแต่ละชั้น</label>
            <div className="d-flex flex-column gap-2">
              {Array.from({ length: form.floorCount }, (_, i) => (
                <div key={i} className="input-group">
                  <span className="input-group-text" style={{ width: 80 }}>ชั้น {i + 1}</span>
                  <input type="number" className="form-control" min={0} placeholder="จำนวนห้อง"
                    value={form.roomsPerFloor[i] ?? ""}
                    onChange={(e) => {
                      const rpf = [...form.roomsPerFloor];
                      rpf[i] = Number(e.target.value) || 0;
                      setForm({ ...form, roomsPerFloor: rpf });
                    }} />
                </div>
              ))}
            </div>
          </div>

          {/* ── ห้องพักในตึก (edit mode) ── */}
          {tower && (<>
            <div className="col-12 mt-2">
              <h5 className="form-section-title">ห้องพักในตึกนี้</h5>
            </div>
            <div className="col-12">
              <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
                <span className="text-muted small">{roomsInTower.length} ห้องทั้งหมด</span>
                <button className="btn btn-sm btn-success" onClick={() => setShowGenModal(true)}>
                  <i className="fas fa-magic me-1" />สร้างห้องอัตโนมัติ
                </button>
              </div>
              <div className="row g-2 mb-2 align-items-center">
                <div className="col">
                  <div className="search-container">
                    <i className="fas fa-search" />
                    <input type="text" className="form-control form-control-sm" placeholder="ค้นหาเลขห้อง..."
                      value={roomSearch} onChange={(e) => setRoomSearch(e.target.value)} />
                  </div>
                </div>
                <div className="col-auto">
                  <select className="form-select form-select-sm" value={floorFilter}
                    onChange={(e) => setFloorFilter(e.target.value)}>
                    <option value="all">ทุกชั้น</option>
                    {floors.map((f) => <option key={f} value={f}>ชั้น {f}</option>)}
                  </select>
                </div>
              </div>
              {selectedRooms.size > 0 && (
                <div className="bulk-actions-bar mb-2">
                  <div className="d-flex justify-content-between align-items-center w-100">
                    <div className="d-flex align-items-center gap-2">
                      <input type="checkbox" className="form-check-input" checked
                        onChange={() => setSelectedRooms(new Set())} />
                      <span>เลือก <strong>{selectedRooms.size}</strong> ห้อง</span>
                    </div>
                    <button className="btn btn-danger btn-sm"
                      onClick={() => setConfirmDelete(Array.from(selectedRooms))} disabled={deletingRooms}>
                      <i className="fas fa-trash-alt me-1" />ลบรายการที่เลือก
                    </button>
                  </div>
                </div>
              )}
              <div className="tower-room-list-form nicescrollbar" style={{ maxHeight: 400 }}>
                {filteredRooms.length === 0 ? (
                  <p className="text-muted text-center p-3">
                    {roomsInTower.length === 0 ? "ยังไม่มีห้องพักในตึกนี้" : "ไม่พบห้องที่ตรงตามเงื่อนไข"}
                  </p>
                ) : filteredRooms.map((room) => {
                  const tenant = findTenantForRoom(tenants, room);
                  return (
                    <div key={room.id} className="tower-room-item-form">
                      <div className="form-check" style={{ flex: 1, minWidth: 0 }}>
                        <input type="checkbox" className="form-check-input room-select-checkbox"
                          checked={selectedRooms.has(room.id)}
                          onChange={(e) => {
                            const s = new Set(selectedRooms);
                            e.target.checked ? s.add(room.id) : s.delete(room.id);
                            setSelectedRooms(s);
                          }} />
                        <label className="form-check-label d-flex align-items-center gap-2 flex-wrap">
                          <span className="room-number">ห้อง {room.number}</span>
                          <span className={`status-badge ${statusClass(room.status)}`}>{room.status}</span>
                          {tenant && <small className="text-muted fst-italic">— {tenantDisplayName(tenant)}</small>}
                        </label>
                      </div>
                      <div className="d-flex align-items-center gap-2">
                        <div className="form-check form-switch mb-0">
                          <input type="checkbox" className="form-check-input room-status-toggle"
                            role="switch" checked={room.isActive}
                            onChange={(e) => handleToggleRoom(room.id, e.target.checked)} />
                        </div>
                        <button type="button" className="btn btn-sm btn-outline-danger btn-room-action"
                          title="ลบห้องนี้" onClick={() => setConfirmDelete([room.id])}>
                          <i className="fas fa-trash-alt" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>)}

          {/* ── Error + Actions ── */}
          {error && (
            <div className="col-12">
              <div className="alert alert-danger py-2 mb-0">{error}</div>
            </div>
          )}
          <div className="col-12 d-flex justify-content-between gap-2 mt-2">
            <button type="button" className="btn btn-outline-secondary" onClick={onBack} disabled={saving}>
              <i className="fas fa-arrow-left me-1" />กลับ
            </button>
            <button type="button" className="btn btn-primary px-4" onClick={handleSave} disabled={saving}>
              {saving
                ? <><span className="spinner-border spinner-border-sm me-2" />กำลังบันทึก...</>
                : <><i className="fas fa-save me-2" />{tower ? "อัปเดต" : "บันทึก"}</>}
            </button>
          </div>

        </div>
      </div>

      {/* Confirm delete dialog */}
      {confirmDelete && (() => {
        const isSingle = confirmDelete.length === 1;
        const singleRoom = isSingle ? allRooms.find((r) => r.id === confirmDelete[0]) : null;
        const singleTenant = isSingle ? findRoomTenant(confirmDelete[0]) : null;
        const roomsWithTenant = !isSingle
          ? confirmDelete.map((id) => allRooms.find((r) => r.id === id)).filter((r) => r && findRoomTenant(r.id))
          : [];
        const vacantRooms = allRooms.filter((r) =>
          r.id !== confirmDelete[0] && !roomHasTenant(tenants, r)
        );

        // ── กรณีลบหลายห้อง แต่มีบางห้องยังมีผู้เช่าอยู่ ── บล็อกทั้งหมด
        if (!isSingle && roomsWithTenant.length > 0) {
          return (
            <div className="room-select-modal-overlay show" style={{ zIndex: 1060 }}>
              <div className="room-select-modal-content" style={{ maxWidth: 420 }}>
                <div className="import-modal-header">
                  <h5>ไม่สามารถลบได้</h5>
                  <button className="close-btn" onClick={closeConfirmDelete}>×</button>
                </div>
                <div className="import-modal-body">
                  <p>
                    ห้อง <strong>{roomsWithTenant.map((r) => r!.number).join(", ")}</strong> ยังมีผู้เช่าอยู่
                    <br />กรุณานำผู้เช่าออกหรือย้ายห้องให้ผู้เช่าก่อน แล้วลบห้องนั้นทีละห้อง
                  </p>
                </div>
                <div className="import-modal-footer d-flex justify-content-end gap-2">
                  <button className="btn btn-primary" onClick={closeConfirmDelete}>ปิด</button>
                </div>
              </div>
            </div>
          );
        }

        // ── กรณีลบห้องเดียว แต่มีผู้เช่าอยู่ ── ต้องนำผู้เช่าออก/ย้ายก่อน
        if (isSingle && singleTenant) {
          return (
            <div className="room-select-modal-overlay show" style={{ zIndex: 1060 }}>
              <div className="room-select-modal-content" style={{ maxWidth: 420 }}>
                <div className="import-modal-header">
                  <h5>ห้อง {singleRoom?.number} มีผู้เช่าอยู่</h5>
                  <button className="close-btn" onClick={closeConfirmDelete}>×</button>
                </div>
                <div className="import-modal-body">
                  <p><strong>{tenantDisplayName(singleTenant)}</strong> อยู่ในห้องนี้
                    <br />ต้องนำผู้เช่าออกจากห้อง หรือย้ายไปห้องอื่นก่อน จึงจะลบห้องนี้ได้</p>
                  <div className="d-flex flex-column gap-2">
                    <button
                      className={`btn ${resolveMode === "remove" ? "btn-danger" : "btn-outline-danger"}`}
                      onClick={() => setResolveMode(resolveMode === "remove" ? null : "remove")}
                      disabled={deletingRooms}
                    >
                      <i className="fas fa-user-times me-2" />นำผู้เช่าออกจากห้องนี้ แล้วลบห้อง
                    </button>
                    <button
                      className={`btn ${resolveMode === "move" ? "btn-warning" : "btn-outline-warning"}`}
                      onClick={() => setResolveMode(resolveMode === "move" ? null : "move")}
                      disabled={deletingRooms}
                    >
                      <i className="fas fa-exchange-alt me-2" />ย้ายผู้เช่าไปห้องอื่น แล้วลบห้องนี้
                    </button>
                    {resolveMode === "move" && (
                      <select className="form-select form-select-sm mt-1" value={moveTargetRoomId}
                        onChange={(e) => setMoveTargetRoomId(e.target.value)} disabled={deletingRooms}>
                        <option value="">-- เลือกห้องปลายทาง --</option>
                        {vacantRooms.map((r) => (
                          <option key={r.id} value={r.id}>ห้อง {r.number}{r.floor ? ` (ชั้น ${r.floor})` : ""}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
                <div className="import-modal-footer d-flex justify-content-end gap-2">
                  <button className="btn btn-outline-secondary" onClick={closeConfirmDelete} disabled={deletingRooms}>ยกเลิก</button>
                  <button className="btn btn-danger" onClick={doResolveTenantAndDeleteRoom}
                    disabled={deletingRooms || !resolveMode || (resolveMode === "move" && !moveTargetRoomId)}>
                    {deletingRooms ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="fas fa-trash-alt me-1" />}
                    ยืนยันและลบห้อง
                  </button>
                </div>
              </div>
            </div>
          );
        }

        // ── กรณีปกติ ไม่มีผู้เช่าติดอยู่ ──
        return (
          <div className="room-select-modal-overlay show" style={{ zIndex: 1060 }}>
            <div className="room-select-modal-content" style={{ maxWidth: 420 }}>
              <div className="import-modal-header">
                <h5>ยืนยันการลบ</h5>
                <button className="close-btn" onClick={closeConfirmDelete}>×</button>
              </div>
              <div className="import-modal-body">
                <p>
                  {isSingle
                    ? <>คุณต้องการลบ <strong>ห้อง {singleRoom?.number}</strong> ใช่หรือไม่?</>
                    : <>คุณต้องการลบห้องพักที่เลือกทั้งหมด <strong>{confirmDelete.length} ห้อง</strong> ใช่หรือไม่?</>}
                </p>
                <small className="text-danger">การกระทำนี้ไม่สามารถย้อนกลับได้</small>
              </div>
              <div className="import-modal-footer d-flex justify-content-end gap-2">
                <button className="btn btn-outline-secondary" onClick={closeConfirmDelete} disabled={deletingRooms}>ยกเลิก</button>
                <button className="btn btn-danger" onClick={() => doDeleteRooms(confirmDelete)} disabled={deletingRooms}>
                  {deletingRooms ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="fas fa-trash-alt me-1" />}
                  ใช่, ลบเลย
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Generate modal */}
      {showGenModal && tower && (
        <RoomGenerateModal
          tower={{ ...tower, ...form }}
          existingNumbers={existingNumbers}
          onConfirm={handleGenerate}
          onClose={() => setShowGenModal(false)}
        />
      )}
    </>
  );
}

// ─── Tower Dashboard ───────────────────────────────────────────────────────────
function TowerDashboard({
  towers,
  allRooms,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
}: {
  towers: any[];
  allRooms: any[];
  onAdd: () => void;
  onEdit: (t: any) => void;
  onDelete: (t: any) => void;
  onToggle: (id: string, isActive: boolean) => void;
}) {
  const unassigned = allRooms.filter((r) => !r.towerId);

  return (
    <div className="custom-card">
      <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-2">
        <h5 className="form-section-title mb-0" style={{ borderBottom: "none" }}>ภาพรวมตึกทั้งหมด</h5>
        <button className="btn btn-primary d-inline-flex align-items-center" onClick={onAdd}>
          <i className="fas fa-plus me-2" />เพิ่มตึกใหม่
        </button>
      </div>

      {towers.length === 0 && unassigned.length === 0 ? (
        <EmptyState icon="fa-building" text="ยังไม่มีข้อมูลตึก" />
      ) : (
        <div className="tower-dashboard-grid">
          {/* unassigned rooms card */}
          {unassigned.length > 0 && (
            <div className="tower-card">
              <div className="tower-card-header">
                <div className="tower-card-title">
                  <div className="tower-item-color-dot" style={{ background: "#6c757d" }} />
                  <h6>ห้องที่ไม่ระบุตึก</h6>
                </div>
              </div>
              <div className="tower-card-body">
                <div className="tower-stats-grid" style={{ gridTemplateColumns: "1fr" }}>
                  <div className="stat-item">
                    <i className="fas fa-building" />
                    <div className="stat-item-info">
                      <div className="value">{unassigned.length} ห้อง</div>
                      <div className="label">ทั้งหมด</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* tower cards */}
          {towers.map((tower) => {
            const roomsInTower = allRooms.filter((r) => r.towerId === tower.id);
            const available = roomsInTower.filter((r) => r.status === "ว่าง").length;
            const occupied = roomsInTower.filter((r) => r.status === "ไม่ว่าง").length;
            const maintenance = roomsInTower.filter((r) => r.status === "ปรับปรุง" || r.status === "ปิดปรับปรุง").length;
            const total = roomsInTower.length;
            const occupancy = total > 0 ? (occupied / total) * 100 : 0;
            const progressColor = occupancy >= 85 ? "bg-danger" : occupancy >= 50 ? "bg-warning" : "bg-success";

            return (
              <div key={tower.id} className={`tower-card${!tower.isActive ? " is-inactive" : ""}`}>
                <div className="tower-card-header">
                  <div className="tower-card-title">
                    <div className="tower-item-color-dot" style={{ background: tower.color }} />
                    <h6>{tower.name} <small className="text-muted fw-normal">({tower.prefix || "-"})</small></h6>
                  </div>
                  <div className="tower-card-actions">
                    <button className="btn-tower-action" title="แก้ไข" onClick={() => onEdit(tower)}>
                      <i className="fas fa-edit" />
                    </button>
                    <button className="btn-tower-action delete-btn" title="ลบ" onClick={() => onDelete(tower)}>
                      <i className="fas fa-trash-alt" />
                    </button>
                  </div>
                </div>
                <div className="tower-card-body">
                  <div className="progress-info">
                    <span className="progress-label">อัตราการเข้าพัก</span>
                    <span className="progress-percentage">{Math.round(occupancy)}%</span>
                  </div>
                  <div className="progress mb-3">
                    <div className={`progress-bar ${progressColor}`} style={{ width: `${occupancy}%` }} />
                  </div>
                  <div className="tower-stats-grid">
                    <div className="stat-item">
                      <i className="fas fa-building" />
                      <div className="stat-item-info">
                        <div className="value">{total}</div>
                        <div className="label">{tower.floorCount} ชั้น</div>
                      </div>
                    </div>
                    <div className="stat-item">
                      <i className="fas fa-door-open" />
                      <div className="stat-item-info">
                        <div className="value">{available}</div>
                        <div className="label">ว่าง</div>
                      </div>
                    </div>
                    <div className="stat-item">
                      <i className="fas fa-user-check" />
                      <div className="stat-item-info">
                        <div className="value">{occupied}</div>
                        <div className="label">ผู้เช่า</div>
                      </div>
                    </div>
                    <div className="stat-item">
                      <i className="fas fa-tools" />
                      <div className="stat-item-info">
                        <div className="value">{maintenance}</div>
                        <div className="label">ปรับปรุง</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="tower-card-footer">
                  <div className="form-check form-switch">
                    <input type="checkbox" className="form-check-input tower-status-toggle"
                      role="switch" id={`twr-toggle-${tower.id}`}
                      checked={tower.isActive}
                      onChange={(e) => onToggle(tower.id, e.target.checked)} />
                    <label className="form-check-label" htmlFor={`twr-toggle-${tower.id}`}>
                      {tower.isActive ? "เปิดใช้งาน" : "ปิดใช้งาน"}
                    </label>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main TowerManagement component ───────────────────────────────────────────
export default function TowerManagement({
  towers,
  allRooms,
  tenants,
  onClose,
  onTowersUpdate,
  onRoomsUpdate,
  onTenantsUpdate,
  onSubtitleChange,
  registerGoToDashboard,
}: {
  towers: any[];
  allRooms: any[];
  tenants: any[];
  onClose: () => void;
  onTowersUpdate: (t: any[]) => void;
  onRoomsUpdate: (r: any[]) => void;
  onTenantsUpdate: (updater: (prev: any[]) => any[]) => void;
  onSubtitleChange?: (label: string | null) => void;
  registerGoToDashboard?: (fn: () => void) => void;
}) {
  const [view, setView] = useState<"dashboard" | "form">("dashboard");
  const [editTower, setEditTower] = useState<any | null>(null);
  const [confirmDeleteTower, setConfirmDeleteTower] = useState<any | null>(null);
  const [deletingTower, setDeletingTower] = useState(false);
  const [deactivateTower, setDeactivateTower] = useState<any | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  useEffect(() => {
    registerGoToDashboard?.(() => {
      setView("dashboard");
      setEditTower(null);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goToForm(tower: any | null) {
    setEditTower(tower);
    setView("form");
    onSubtitleChange?.(tower ? `แก้ไข: ${tower.name}` : "เพิ่มตึกใหม่");
  }

  function goToDashboard() {
    setView("dashboard");
    setEditTower(null);
    onSubtitleChange?.(null);
  }

  async function handleTowerSaved(saved: any) {
    const exists = towers.find((t) => t.id === saved.id);
    const updated = exists
      ? towers.map((t) => (t.id === saved.id ? saved : t))
      : [...towers, saved];
    onTowersUpdate(updated);
    setEditTower(saved);
    if (!exists) {
      onSubtitleChange?.(`แก้ไข: ${saved.name}`);
    }
  }

  async function handleToggleTower(id: string, isActive: boolean) {
    if (!isActive) {
      const tower = towers.find((t) => t.id === id);
      setDeactivateTower(tower);
      return;
    }
    const updated = await roomsApi.toggleTowerActive(id, isActive);
    onTowersUpdate(towers.map((t) => (t.id === id ? updated : t)));
  }

  async function doDeactivateTower(mode: "remove_tenants" | "close_vacant") {
    if (!deactivateTower) return;
    setDeactivating(true);
    try {
      const towerId = deactivateTower.id;
      const towerRooms = allRooms.filter((r) => r.towerId === towerId);

      if (mode === "remove_tenants") {
        // นำผู้เช่าทั้งหมดออก + ปิดทุกห้อง (เช็คทั้งห้องหลักและห้องเพิ่มเติมของผู้เช่าแต่ละคน)
        const roomsWithTenants = towerRooms.filter((r) => roomHasTenant(tenants, r));
        await Promise.all(
          roomsWithTenants.map((r) => {
            const tenant = findTenantForRoom(tenants, r);
            if (!tenant) return Promise.resolve();
            if (tenant.idRoom === r.id || tenant.idRoom === r.number) {
              return tenantsApi.updateRoom(tenant.id, "");
            }
            const extra: string[] = Array.isArray(tenant.extraRoomIds) ? tenant.extraRoomIds : [];
            return tenantsApi.updateExtraRooms(tenant.id, extra.filter((rid) => rid !== r.id && rid !== r.number));
          })
        );
        await Promise.all(towerRooms.map((r) => roomsApi.toggleActive(r.id, false)));
        onRoomsUpdate(allRooms.map((r) =>
          r.towerId === towerId ? { ...r, isActive: false, status: "ว่าง" } : r
        ));
      } else {
        // ปิดเฉพาะห้องว่าง
        const vacantRooms = towerRooms.filter((r) => !roomHasTenant(tenants, r));
        await Promise.all(vacantRooms.map((r) => roomsApi.toggleActive(r.id, false)));
        onRoomsUpdate(allRooms.map((r) =>
          vacantRooms.some((vr) => vr.id === r.id) ? { ...r, isActive: false } : r
        ));
      }

      const updated = await roomsApi.toggleTowerActive(towerId, false);
      onTowersUpdate(towers.map((t) => (t.id === towerId ? updated : t)));
      setDeactivateTower(null);
    } finally {
      setDeactivating(false);
    }
  }

  async function handleDeleteTower() {
    if (!confirmDeleteTower) return;
    setDeletingTower(true);
    try {
      await roomsApi.deleteTower(confirmDeleteTower.id);
      onTowersUpdate(towers.filter((t) => t.id !== confirmDeleteTower.id));
      setConfirmDeleteTower(null);
      if (editTower?.id === confirmDeleteTower.id) goToDashboard();
    } finally {
      setDeletingTower(false);
    }
  }

  return (
    <>
      {view === "dashboard" ? (
        <TowerDashboard
          towers={towers}
          allRooms={allRooms}
          onAdd={() => goToForm(null)}
          onEdit={goToForm}
          onDelete={setConfirmDeleteTower}
          onToggle={handleToggleTower}
        />
      ) : (
        <TowerForm
          tower={editTower}
          allRooms={allRooms}
          tenants={tenants}
          onSaved={handleTowerSaved}
          onBack={goToDashboard}
          onRoomsUpdate={onRoomsUpdate}
          onTenantsUpdate={onTenantsUpdate}
        />
      )}

      {/* Confirm delete tower */}
      {deactivateTower && (() => {
        const towerRooms = allRooms.filter((r) => r.towerId === deactivateTower.id);
        const occupiedCount = towerRooms.filter((r) => roomHasTenant(tenants, r)).length;
        const vacantCount = towerRooms.length - occupiedCount;
        return (
          <div className="confirm-overlay" onClick={() => !deactivating && setDeactivateTower(null)}>
            <div className="confirm-dialog" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
              <div className="confirm-icon confirm-icon--warning">
                <i className="fas fa-building" />
              </div>
              <h6 className="confirm-title">ปิดใช้งานตึก {deactivateTower.name}</h6>
              <p className="confirm-message">
                ตึกนี้มี <strong>{towerRooms.length} ห้อง</strong>
                {occupiedCount > 0 && <> (มีผู้เช่า {occupiedCount} ห้อง, ว่าง {vacantCount} ห้อง)</>}
                <br />กรุณาเลือกวิธีจัดการห้องพัก
              </p>
              <div className="d-flex flex-column gap-2 mb-3">
                <button
                  className="btn btn-danger"
                  onClick={() => doDeactivateTower("remove_tenants")}
                  disabled={deactivating}
                >
                  {deactivating ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="fas fa-user-times me-2" />}
                  นำผู้เช่าทั้งหมดออกจากตึก
                  {occupiedCount > 0 && <span className="badge bg-light text-danger ms-2">{occupiedCount} ราย</span>}
                </button>
                <button
                  className="btn btn-warning"
                  onClick={() => doDeactivateTower("close_vacant")}
                  disabled={deactivating}
                >
                  {deactivating ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="fas fa-door-closed me-2" />}
                  ปิดเฉพาะห้องว่าง
                  {vacantCount > 0 && <span className="badge bg-light text-warning ms-2">{vacantCount} ห้อง</span>}
                </button>
              </div>
              <div className="confirm-actions">
                <button className="btn btn-outline-secondary" onClick={() => setDeactivateTower(null)} disabled={deactivating}>
                  ยกเลิก
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {confirmDeleteTower && (() => {
        const towerRoomCount = allRooms.filter((r) => r.towerId === confirmDeleteTower.id).length;

        if (towerRoomCount > 0) {
          return (
            <div className="room-select-modal-overlay show" style={{ zIndex: 1060 }}>
              <div className="room-select-modal-content" style={{ maxWidth: 420 }}>
                <div className="import-modal-header">
                  <h5>ไม่สามารถลบตึกได้</h5>
                  <button className="close-btn" onClick={() => setConfirmDeleteTower(null)}>×</button>
                </div>
                <div className="import-modal-body">
                  <p>
                    ตึก <strong>{confirmDeleteTower.name}</strong> ยังมีห้องพักอยู่ <strong>{towerRoomCount} ห้อง</strong>
                    <br />กรุณาลบห้องพักทั้งหมดในตึกนี้ก่อน จึงจะลบตึกได้
                  </p>
                </div>
                <div className="import-modal-footer d-flex justify-content-end gap-2">
                  <button className="btn btn-outline-secondary" onClick={() => setConfirmDeleteTower(null)}>ปิด</button>
                  <button className="btn btn-primary" onClick={() => { const t = confirmDeleteTower; setConfirmDeleteTower(null); goToForm(t); }}>
                    <i className="fas fa-list me-1" />ไปที่รายการห้องของตึกนี้
                  </button>
                </div>
              </div>
            </div>
          );
        }

        return (
          <div className="room-select-modal-overlay show" style={{ zIndex: 1060 }}>
            <div className="room-select-modal-content" style={{ maxWidth: 420 }}>
              <div className="import-modal-header">
                <h5>ยืนยันการลบตึก</h5>
                <button className="close-btn" onClick={() => setConfirmDeleteTower(null)}>×</button>
              </div>
              <div className="import-modal-body">
                <p>คุณต้องการลบตึก <strong>{confirmDeleteTower.name}</strong> ใช่หรือไม่?</p>
                <small className="text-danger">การกระทำนี้ไม่สามารถย้อนกลับได้</small>
              </div>
              <div className="import-modal-footer d-flex justify-content-end gap-2">
                <button className="btn btn-outline-secondary" onClick={() => setConfirmDeleteTower(null)} disabled={deletingTower}>ยกเลิก</button>
                <button className="btn btn-danger" onClick={handleDeleteTower} disabled={deletingTower}>
                  {deletingTower ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="fas fa-trash-alt me-1" />}
                  ใช่, ลบเลย
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
