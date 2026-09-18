import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Select, { components, StylesConfig } from "react-select";
import ColResizeHandle from "./ColResizeHandle";
import EmptyState from "./EmptyState";
import { useColumnWidths } from "../utils/useColumnWidths";
import { tenantDisplayName } from "../utils/tenantName";
import { findTenantForRoom, roomHasTenant, findBookingForRoom } from "../utils/tenantRoom";

type PinDir = "left" | "right" | false;

interface ColDef {
  key: string;
  header: string;
  visible: boolean;
  pinnable: boolean;
  pin: PinDir;
  thClass?: string;
  tdClass?: string;
}

const INITIAL_COLS: ColDef[] = [
  { key: "checkbox",       header: "checkbox",        visible: true,  pinnable: true,  pin: "left",  thClass: "text-center checkbox-cell", tdClass: "text-center checkbox-cell" },
  { key: "number",         header: "ห้อง",             visible: true,  pinnable: true,  pin: false,   tdClass: "room-cell" },
  { key: "tower",          header: "ตึก",              visible: true,  pinnable: true,  pin: false },
  { key: "floor",          header: "ชั้น",             visible: true,  pinnable: true,  pin: false,   thClass: "text-center", tdClass: "text-center" },
  { key: "status",         header: "สถานะ",            visible: true,  pinnable: true,  pin: false,   thClass: "text-center", tdClass: "text-center" },
  { key: "price",          header: "ราคา/เดือน",       visible: true,  pinnable: true,  pin: false },
  { key: "dailyPrice",     header: "ราคา/วัน",         visible: true,  pinnable: true,  pin: false },
  { key: "meterElectric",  header: "มิเตอร์ไฟ",        visible: true,  pinnable: true,  pin: false,   thClass: "text-center", tdClass: "text-center" },
  { key: "meterWater",     header: "มิเตอร์น้ำ",        visible: true,  pinnable: true,  pin: false,   thClass: "text-center", tdClass: "text-center" },
  { key: "roomActive",     header: "สถานะห้อง",        visible: true,  pinnable: true,  pin: false,   thClass: "text-center", tdClass: "text-center" },
  { key: "tenant",         header: "ผู้เช่าปัจจุบัน",   visible: true,  pinnable: true,  pin: false },
  { key: "detail",         header: "รายละเอียด",       visible: false, pinnable: true,  pin: false },
  { key: "tags",           header: "แท็ก",             visible: false, pinnable: true,  pin: false },
  { key: "actions",        header: "จัดการ",           visible: true,  pinnable: true,  pin: "right", thClass: "text-center action-cell", tdClass: "text-center action-cell" },
];

/* ── Column visibility dropdown ───────────────────────────────────────────── */
const colSelectStyles: StylesConfig<any, true> = {
  control: (base, state) => ({
    ...base,
    backgroundColor: state.menuIsOpen || state.isFocused ? "var(--color-white)" : "var(--color-background)",
    border: `1px solid ${state.menuIsOpen || state.isFocused ? "var(--color-primary)" : "var(--color-light)"}`,
    borderRadius: "var(--border-radius-1)",
    boxShadow: state.menuIsOpen || state.isFocused ? "0 0 0 3px rgba(108,155,207,0.25)" : "none",
    minHeight: "38px", fontSize: "0.9rem", cursor: "pointer",
    transition: "border-color 0.3s ease, box-shadow 0.3s ease",
    "&:hover": { borderColor: "var(--color-primary)", boxShadow: "0 0 0 3px rgba(108,155,207,0.18)", backgroundColor: "var(--color-white)" },
  }),
  valueContainer: (base) => ({ ...base, padding: "0 0.75rem", flexWrap: "nowrap", overflow: "hidden" }),
  indicatorSeparator: () => ({ display: "none" }),
  dropdownIndicator: (base, state) => ({
    ...base,
    color: state.isFocused ? "var(--color-primary)" : "var(--color-dark-variant)",
    padding: "0 8px",
    transition: "transform 0.2s ease, color 0.2s ease",
    transform: state.selectProps.menuIsOpen ? "rotate(180deg)" : "rotate(0deg)",
  }),
  menu: (base) => ({ ...base, backgroundColor: "var(--color-white)", border: "1px solid var(--color-light)", borderRadius: "var(--border-radius-1)", boxShadow: "var(--box-shadow)", zIndex: 9999, overflow: "hidden" }),
  menuList: (base) => ({ ...base, padding: "4px", maxHeight: "260px" }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isFocused ? "var(--color-light)" : "transparent",
    color: "var(--color-dark)",
    fontSize: "0.88rem", borderRadius: "var(--border-radius-1)",
    padding: "0.45rem 0.75rem", cursor: "pointer", transition: "background 0.15s ease",
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
function ColVisibilityDropdown({ cols, onChange }: { cols: ColDef[]; onChange: (key: string, v: boolean) => void }) {
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

/* ── Pin context menu ─────────────────────────────────────────────────────── */
interface PinMenu { colKey: string; x: number; y: number }
function PinMenuPopup({ menu, cols, onPin, onClose }: { menu: PinMenu; cols: ColDef[]; onPin: (k: string, d: PinDir) => void; onClose: () => void }) {
  const col = cols.find((c) => c.key === menu.colKey);
  const cur = col?.pin ?? false;
  useEffect(() => {
    const close = () => onClose();
    setTimeout(() => window.addEventListener("click", close), 0);
    return () => window.removeEventListener("click", close);
  }, []);
  return (
    <ul className="pinning-menu" style={{ position: "fixed", top: menu.y, left: menu.x }} onClick={(e) => e.stopPropagation()}>
      {cur && <li className="disabled"><i className="fas fa-thumbtack" />{cur === "left" ? "ปักหมุดซ้าย (ใช้อยู่)" : "ปักหมุดขวา (ใช้อยู่)"}</li>}
      {cur !== "left"  && <li onClick={() => { onPin(menu.colKey, "left");  onClose(); }}><i className="fas fa-thumbtack" style={{ color: "var(--color-primary)" }} />ปักหมุดซ้าย</li>}
      {cur !== "right" && <li onClick={() => { onPin(menu.colKey, "right"); onClose(); }}><i className="fas fa-thumbtack" style={{ color: "var(--color-danger)" }} />ปักหมุดขวา</li>}
      {cur && <li onClick={() => { onPin(menu.colKey, false); onClose(); }}><i className="fas fa-times" />เลิกปักหมุด</li>}
    </ul>
  );
}

/* ── Status helper ────────────────────────────────────────────────────────── */
function statusClass(s: string) {
  if (s === "ว่าง") return "status-available";
  if (s === "ไม่ว่าง") return "status-occupied";
  if (s === "จอง") return "status-booked";
  return "status-maintenance";
}

/* ── Main component ───────────────────────────────────────────────────────── */
export default function RoomTableView({
  data, allRooms, towers, tenants, bookings = [], onViewDetail, onEdit, onDelete, onDeleteBulk, onRoomUpdate, onTenantsUpdate,
}: {
  data: any[];
  allRooms: any[];
  towers: any[];
  tenants: any[];
  bookings?: any[];
  onViewDetail: (r: any) => void;
  onEdit?: (r: any) => void;
  onDelete?: (r: any) => Promise<void>;
  onDeleteBulk?: (rooms: any[]) => Promise<void>;
  onRoomUpdate?: (updated: any) => void;
  onTenantsUpdate?: (updater: (prev: any[]) => any[]) => void;
}) {
  const navigate = useNavigate();
  const [cols, setCols] = useState<ColDef[]>(INITIAL_COLS);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [pinMenu, setPinMenu] = useState<PinMenu | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<any[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [resolveMode, setResolveMode] = useState<"remove" | "move" | null>(null);
  const [moveTargetRoomId, setMoveTargetRoomId] = useState<string>("");
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [blockMsg, setBlockMsg] = useState<string>("");
  const tableRef = useRef<HTMLTableElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const { widths, startResize } = useColumnWidths("rooms", {
    checkbox: 40, number: 100, tower: 110, floor: 80, status: 110, price: 120, dailyPrice: 110,
    meterElectric: 110, meterWater: 110, roomActive: 110, tenant: 160, detail: 200, tags: 160, actions: 130,
  });

  useEffect(() => {
    if (!blockMsg) return;
    const t = setTimeout(() => setBlockMsg(""), 3000);
    return () => clearTimeout(t);
  }, [blockMsg]);

  async function toggleField(room: any, field: "meterWaterActive" | "meterElectricActive" | "isActive") {
    if (field === "isActive" && room.isActive !== false) {
      const hasTenant = roomHasTenant(tenants, room);
      if (hasTenant) {
        setBlockMsg(`ห้อง ${room.number} มีผู้เช่าอยู่ ไม่สามารถปิดใช้งานได้`);
        return;
      }
    }
    const key = `${room.id}-${field}`;
    if (toggling.has(key)) return;
    setToggling((prev) => new Set(prev).add(key));
    try {
      const { roomsApi } = await import("../api/client");
      const updated = await roomsApi.update(room.id, { [field]: !room[field] });
      onRoomUpdate?.(updated);
    } finally {
      setToggling((prev) => { const n = new Set(prev); n.delete(key); return n; });
    }
  }

  function findRoomTenant(room: any) {
    return findTenantForRoom(tenants, room);
  }

  function closeConfirmDelete() {
    setConfirmDelete(null);
    setResolveMode(null);
    setMoveTargetRoomId("");
  }

  async function doDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      if (confirmDelete.length === 1) {
        await onDelete?.(confirmDelete[0]);
      } else {
        await onDeleteBulk?.(confirmDelete);
      }
      setSelectedRows(new Set());
    } finally {
      setDeleting(false);
      closeConfirmDelete();
    }
  }

  async function doResolveTenantAndDelete() {
    if (!confirmDelete || confirmDelete.length !== 1) return;
    const room = confirmDelete[0];
    const tenant = findRoomTenant(room);
    if (!tenant) return;
    if (resolveMode === "move" && !moveTargetRoomId) return;
    setDeleting(true);
    try {
      const { tenantsApi } = await import("../api/client");
      const newRoomId = resolveMode === "move" ? moveTargetRoomId : "";
      await tenantsApi.updateRoom(tenant.id, newRoomId);
      onTenantsUpdate?.((prev) => prev.map((t) => (t.id === tenant.id ? { ...t, idRoom: newRoomId } : t)));
      if (resolveMode === "move") {
        const targetRoom = allRooms.find((r) => r.id === moveTargetRoomId);
        if (targetRoom) onRoomUpdate?.({ ...targetRoom, status: "ไม่ว่าง" });
      }
      await onDelete?.(room);
      setSelectedRows(new Set());
      closeConfirmDelete();
    } finally {
      setDeleting(false);
    }
  }

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

  function toggleAll(checked: boolean) { setSelectedRows(checked ? new Set(data.map((r) => r.id)) : new Set()); }
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

  function renderCell(col: ColDef, room: any) {
    const tower = towers.find((t) => t.id === room.towerId);
    const tenant = findTenantForRoom(tenants, room);
    const tags: any[] = Array.isArray(room.tags) ? room.tags : [];

    switch (col.key) {
      case "checkbox":
        return (
          <input type="checkbox" className="form-check-input row-checkbox"
            checked={selectedRows.has(room.id)}
            onChange={() => toggleRow(room.id)}
            onClick={(e) => e.stopPropagation()} />
        );
      case "number":
        return (
          <div className="d-flex align-items-center gap-2">
            <span className="fw-bold">ห้อง {room.number}</span>
            {!room.isActive && <span className="badge bg-secondary" style={{ fontSize: "0.7rem" }}>ปิดใช้งาน</span>}
          </div>
        );
      case "tower":
        return tower
          ? <span className="tower-tag" style={{ backgroundColor: tower.color || "var(--color-primary)" }}>{tower.name}</span>
          : <span className="text-muted">-</span>;
      case "floor":
        return room.floor || <span className="text-muted">-</span>;
      case "status":
        return <span className={`status-badge ${statusClass(room.status)}`}>{room.status}</span>;
      case "price":
        return room.price > 0
          ? <span className="fw-semibold">{Number(room.price).toLocaleString()} ฿</span>
          : <span className="text-muted">-</span>;
      case "dailyPrice":
        return room.dailyPrice > 0
          ? <span>{Number(room.dailyPrice).toLocaleString()} ฿</span>
          : <span className="badge bg-secondary" style={{ fontWeight: 400, fontSize: "0.75rem" }}>ปิดใช้งาน</span>;
      case "meterElectric": {
        const on = room.meterElectricActive !== false;
        const loading = toggling.has(`${room.id}-meterElectricActive`);
        return (
          <button
            className={`meter-toggle-btn${on ? " meter-toggle-btn--on" : ""}`}
            onClick={(e) => { e.stopPropagation(); toggleField(room, "meterElectricActive"); }}
            disabled={loading}
            title={on ? "มิเตอร์ไฟเปิดอยู่ — คลิกเพื่อปิด" : "มิเตอร์ไฟปิดอยู่ — คลิกเพื่อเปิด"}
          >
            {loading
              ? <span className="spinner-border spinner-border-sm" />
              : <><i className={`fas fa-bolt`} />{on ? "เปิด" : "ปิด"}</>}
          </button>
        );
      }
      case "meterWater": {
        const on = room.meterWaterActive !== false;
        const loading = toggling.has(`${room.id}-meterWaterActive`);
        return (
          <button
            className={`meter-toggle-btn${on ? " meter-toggle-btn--on meter-toggle-btn--water" : ""}`}
            onClick={(e) => { e.stopPropagation(); toggleField(room, "meterWaterActive"); }}
            disabled={loading}
            title={on ? "มิเตอร์น้ำเปิดอยู่ — คลิกเพื่อปิด" : "มิเตอร์น้ำปิดอยู่ — คลิกเพื่อเปิด"}
          >
            {loading
              ? <span className="spinner-border spinner-border-sm" />
              : <><i className="fas fa-tint" />{on ? "เปิด" : "ปิด"}</>}
          </button>
        );
      }
      case "roomActive": {
        const active = room.isActive !== false;
        const loading = toggling.has(`${room.id}-isActive`);
        return (
          <button
            className={`meter-toggle-btn${active ? " meter-toggle-btn--on meter-toggle-btn--room" : ""}`}
            onClick={(e) => { e.stopPropagation(); toggleField(room, "isActive"); }}
            disabled={loading}
            title={active ? "ห้องเปิดใช้งาน — คลิกเพื่อปิด" : "ห้องปิดใช้งาน — คลิกเพื่อเปิด"}
          >
            {loading
              ? <span className="spinner-border spinner-border-sm" />
              : <><i className={`fas fa-door-${active ? "open" : "closed"}`} />{active ? "เปิด" : "ปิด"}</>}
          </button>
        );
      }
      case "tenant": {
        if (tenant) return <span className="namec-cell">{tenantDisplayName(tenant)}</span>;
        const booking = findBookingForRoom(bookings, room);
        if (booking) {
          return (
            <div className="d-flex align-items-center gap-2">
              <span className="namec-cell text-warning">ผู้จอง: {booking.name}</span>
              {booking.idLine && (
                <button type="button" className="btn btn-sm btn-outline-primary" title="ไปหน้าแชท"
                  onClick={(e) => { e.stopPropagation(); navigate("/chat", { state: { openLineUserId: booking.idLine } }); }}>
                  <i className="fas fa-comment-dots" />
                </button>
              )}
            </div>
          );
        }
        return <span className="text-muted fst-italic">ว่าง</span>;
      }
      case "detail":
        return room.detail || <span className="text-muted">-</span>;
      case "tags":
        if (!tags.length) return <span className="text-muted">-</span>;
        return (
          <div className="d-flex flex-wrap gap-1">
            {tags.slice(0, 3).map((tag: any, i: number) => (
              <span key={i} className="room-tag-item" style={{ "--tag-color": tag.color } as React.CSSProperties}>
                <i className={tag.icon || "fas fa-tag"} />{tag.name}
              </span>
            ))}
            {tags.length > 3 && <span className="badge bg-secondary">+{tags.length - 3}</span>}
          </div>
        );
      case "actions":
        return (
          <div className="btn-group" role="group">
            <button type="button" className="btn btn-sm btn-info" title="ดูรายละเอียด"
              onClick={(e) => { e.stopPropagation(); onViewDetail(room); }}>
              <i className="fas fa-eye" />
            </button>
            {onEdit && (
              <button type="button" className="btn btn-sm btn-warning" title="แก้ไข"
                onClick={(e) => { e.stopPropagation(); onEdit(room); }}>
                <i className="fas fa-edit" />
              </button>
            )}
            {onDelete && (
              <button type="button" className="btn btn-sm btn-danger" title="ลบห้อง"
                onClick={(e) => { e.stopPropagation(); setConfirmDelete([room]); }}>
                <i className="fas fa-trash-alt" />
              </button>
            )}
          </div>
        );
      default: return "-";
    }
  }

  return (
    <div>
      {/* Column visibility */}
      <div className="mb-2">
        <ColVisibilityDropdown cols={cols} onChange={handleColVisibility} />
      </div>

      {/* Bulk actions bar */}
      {selectedRows.size > 0 && (
        <div className="bulk-actions-bar mb-2" style={{ justifyContent: "space-between" }}>
          <span>เลือก <strong>{selectedRows.size}</strong> รายการ</span>
          <div className="d-flex gap-2">
            {onDeleteBulk && (
              <button className="btn btn-danger btn-sm"
                onClick={() => setConfirmDelete(data.filter((r) => selectedRows.has(r.id)))}>
                <i className="fas fa-trash-alt me-1" />ลบรายการที่เลือก
              </button>
            )}
            <button className="btn btn-sm btn-outline-secondary"
              onClick={() => setSelectedRows(new Set())}>
              <i className="fas fa-times me-1" />ยกเลิก
            </button>
          </div>
        </div>
      )}

      {/* Block warning */}
      {blockMsg && (
        <div className="alert alert-warning py-2 mb-2 d-flex align-items-center gap-2" style={{ fontSize: "0.88rem" }}>
          <i className="fas fa-exclamation-triangle" />{blockMsg}
        </div>
      )}

      {/* Table */}
      <div className="nicescrollbar" style={{ maxHeight: 560, overflow: "auto" }}>
        <table ref={tableRef} className="table-mainstyle table-hover table-resizable" style={{ minWidth: 700 }}>
          <thead>
            <tr>
              {ordered.map((col) => {
                const pinClass = col.pin === "left" ? "pinned pinned-left" : col.pin === "right" ? "pinned pinned-right" : "";
                return (
                  <th key={col.key} className={`${col.thClass ?? ""} ${pinClass}`} style={{ width: widths[col.key] }}>
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
            {data.map((room) => (
              <tr key={room.id} style={{ opacity: room.isActive === false ? 0.6 : 1 }}>
                {ordered.map((col) => {
                  const pinClass = col.pin === "left" ? "pinned pinned-left" : col.pin === "right" ? "pinned pinned-right" : "";
                  return (
                    <td key={col.key} className={`${col.tdClass ?? ""} ${pinClass}`}>
                      {renderCell(col, room)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {data.length === 0 && (
              <tr><td colSpan={ordered.length}><EmptyState icon="fa-door-open" text="ไม่พบข้อมูลห้องพัก" compact /></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pin menu */}
      {pinMenu && (
        <PinMenuPopup menu={pinMenu} cols={cols} onPin={handlePin} onClose={() => setPinMenu(null)} />
      )}

      {/* Confirm delete dialog */}
      {confirmDelete && (() => {
        const isSingle = confirmDelete.length === 1;
        const singleTenant = isSingle ? findRoomTenant(confirmDelete[0]) : null;
        const roomsWithTenant = !isSingle ? confirmDelete.filter((r) => findRoomTenant(r)) : [];
        const vacantRooms = allRooms.filter((r) =>
          r.id !== confirmDelete[0]?.id && !roomHasTenant(tenants, r)
        );

        // ── กรณีลบหลายห้อง แต่มีบางห้องยังมีผู้เช่าอยู่ ── บล็อกทั้งหมด
        if (!isSingle && roomsWithTenant.length > 0) {
          return (
            <div className="confirm-overlay" onClick={() => !deleting && closeConfirmDelete()}>
              <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="confirm-icon confirm-icon--warning">
                  <i className="fas fa-exclamation-triangle" />
                </div>
                <h6 className="confirm-title">ไม่สามารถลบได้</h6>
                <p className="confirm-message">
                  ห้อง <strong>{roomsWithTenant.map((r) => r.number).join(", ")}</strong> ยังมีผู้เช่าอยู่
                  <br />กรุณานำผู้เช่าออกหรือย้ายห้องให้ผู้เช่าก่อน แล้วลบห้องนั้นทีละห้อง
                </p>
                <div className="confirm-actions">
                  <button className="btn btn-primary" onClick={closeConfirmDelete}>ปิด</button>
                </div>
              </div>
            </div>
          );
        }

        // ── กรณีลบห้องเดียว แต่มีผู้เช่าอยู่ ── ต้องนำผู้เช่าออก/ย้ายก่อน
        if (isSingle && singleTenant) {
          return (
            <div className="confirm-overlay" onClick={() => !deleting && closeConfirmDelete()}>
              <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="confirm-icon confirm-icon--warning">
                  <i className="fas fa-user-times" />
                </div>
                <h6 className="confirm-title">ห้อง {confirmDelete[0].number} มีผู้เช่าอยู่</h6>
                <p className="confirm-message">
                  <strong>{tenantDisplayName(singleTenant)}</strong> อยู่ในห้องนี้
                  <br />ต้องนำผู้เช่าออกจากห้อง หรือย้ายไปห้องอื่นก่อน จึงจะลบห้องนี้ได้
                </p>
                <div className="d-flex flex-column gap-2 mb-3" style={{ textAlign: "left" }}>
                  <button
                    className={`btn ${resolveMode === "remove" ? "btn-danger" : "btn-outline-danger"}`}
                    onClick={() => setResolveMode(resolveMode === "remove" ? null : "remove")}
                    disabled={deleting}
                  >
                    <i className="fas fa-user-times me-2" />นำผู้เช่าออกจากห้องนี้ แล้วลบห้อง
                  </button>
                  <button
                    className={`btn ${resolveMode === "move" ? "btn-warning" : "btn-outline-warning"}`}
                    onClick={() => setResolveMode(resolveMode === "move" ? null : "move")}
                    disabled={deleting}
                  >
                    <i className="fas fa-exchange-alt me-2" />ย้ายผู้เช่าไปห้องอื่น แล้วลบห้องนี้
                  </button>
                  {resolveMode === "move" && (
                    <select className="form-select form-select-sm mt-1" value={moveTargetRoomId}
                      onChange={(e) => setMoveTargetRoomId(e.target.value)} disabled={deleting}>
                      <option value="">-- เลือกห้องปลายทาง --</option>
                      {vacantRooms.map((r) => (
                        <option key={r.id} value={r.id}>ห้อง {r.number}{r.floor ? ` (ชั้น ${r.floor})` : ""}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="confirm-actions">
                  <button className="btn btn-outline-secondary" onClick={closeConfirmDelete} disabled={deleting}>
                    ยกเลิก
                  </button>
                  <button className="btn btn-danger" onClick={doResolveTenantAndDelete}
                    disabled={deleting || !resolveMode || (resolveMode === "move" && !moveTargetRoomId)}>
                    {deleting
                      ? <><span className="spinner-border spinner-border-sm me-2" />กำลังดำเนินการ...</>
                      : <><i className="fas fa-trash-alt me-1" />ยืนยันและลบห้อง</>}
                  </button>
                </div>
              </div>
            </div>
          );
        }

        // ── กรณีปกติ ไม่มีผู้เช่าติดอยู่ ──
        return (
          <div className="confirm-overlay" onClick={() => !deleting && closeConfirmDelete()}>
            <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="confirm-icon confirm-icon--danger">
                <i className="fas fa-trash-alt" />
              </div>
              <h6 className="confirm-title">
                {isSingle ? "ลบห้องพัก" : `ลบห้องพัก ${confirmDelete.length} ห้อง`}
              </h6>
              <p className="confirm-message">
                {isSingle
                  ? <>ลบห้อง <strong>{confirmDelete[0].number}</strong> ใช่หรือไม่?</>
                  : `ลบห้องพัก ${confirmDelete.length} ห้อง ใช่หรือไม่?`}
                <br /><small className="text-danger">การกระทำนี้ไม่สามารถย้อนกลับได้</small>
              </p>
              <div className="confirm-actions">
                <button className="btn btn-outline-secondary" onClick={closeConfirmDelete} disabled={deleting}>
                  ยกเลิก
                </button>
                <button className="btn btn-danger" onClick={doDelete} disabled={deleting}>
                  {deleting
                    ? <><span className="spinner-border spinner-border-sm me-2" />กำลังลบ...</>
                    : <><i className="fas fa-trash-alt me-1" />ลบ</>}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
