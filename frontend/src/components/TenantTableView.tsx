import { useState, useRef, useLayoutEffect, useEffect } from "react";
import Select, { components, StylesConfig } from "react-select";
import { formatCheckInDate } from "../utils/yearFormat";
import ColResizeHandle from "./ColResizeHandle";
import PinMenuPopup, { type PinMenuState } from "./PinMenuPopup";
import EmptyState from "./EmptyState";
import ContractStatusBadge from "./ContractStatusBadge";
import PrivacyMask from "./PrivacyMask";
import PrivacyAvatar from "./PrivacyAvatar";
import { usePrivacyMode } from "../context/PrivacyModeContext";
import { useColumnWidths, useColumnVisibility, useRowOrder } from "../utils/useColumnWidths";
import { tenantDisplayName } from "../utils/tenantName";

export const AVATAR_URL = "https://cdn-icons-png.flaticon.com/512/149/149071.png";

// Google Drive image proxy ปิดใช้งานถาวรที่ฝั่ง backend (GOOGLE_INTEGRATION_ENABLED) — ไม่ยิง request
// ไปเปล่าๆ ให้ตกกลับเป็น avatar เริ่มต้นทันทีถ้า url เป็นลิงก์ Drive
function getDriveImgSrc(url: string): string {
  if (!url) return AVATAR_URL;
  if (/\/d\/[a-zA-Z0-9_-]+/.test(url) || /[?&]id=[a-zA-Z0-9_-]+/.test(url)) return AVATAR_URL;
  return url;
}

function getRoomNumber(rooms: any[], idRoom: string): string {
  if (!idRoom) return "";
  const room = rooms.find(
    (r) => String(r.id) === String(idRoom) || String(r.number) === String(idRoom)
  );
  return room ? String(room.number) : String(idRoom);
}

// ห้องทั้งหมดของผู้เช่า (หลัก + เพิ่มเติม) รวมเป็นข้อความเดียว เช่น "101, 102, 103"
function getTenantRoomsLabel(rooms: any[], tenant: any): string {
  const ids = [tenant.idRoom, ...(Array.isArray(tenant.extraRoomIds) ? tenant.extraRoomIds : [])].filter(Boolean);
  return ids.map((id) => getRoomNumber(rooms, id)).filter(Boolean).join(", ");
}

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
  { key: "checkbox",    header: "checkbox",           visible: true,  pinnable: true,  pin: "left",  thClass: "text-center checkbox-cell", tdClass: "text-center checkbox-cell" },
  { key: "id",          header: "id",                 visible: false, pinnable: false, pin: false },
  { key: "image",       header: "รูป",                visible: true,  pinnable: true,  pin: false },
  { key: "title",       header: "คำนำหน้า",            visible: true,  pinnable: true,  pin: false },
  { key: "firstName",   header: "ชื่อ",               visible: true,  pinnable: true,  pin: false },
  { key: "lastName",    header: "นามสกุล",             visible: true,  pinnable: true,  pin: false },
  { key: "phone",       header: "เบอร์โทร",            visible: true,  pinnable: true,  pin: false },
  { key: "idLine",      header: "Line ID",             visible: true,  pinnable: true,  pin: false },
  { key: "lineConnect", header: "Line Connect",        visible: true,  pinnable: true,  pin: false,  thClass: "text-center", tdClass: "text-center" },
  { key: "roomNumber",  header: "ห้อง",                visible: true,  pinnable: true,  pin: false,  thClass: "text-center", tdClass: "text-center room-cell" },
  { key: "houseNo",     header: "เลขที่บ้าน",           visible: false, pinnable: true,  pin: false,  thClass: "text-center", tdClass: "text-center" },
  { key: "soi",         header: "ซอย",                 visible: false, pinnable: true,  pin: false },
  { key: "road",        header: "ถนน",                 visible: false, pinnable: true,  pin: false },
  { key: "province",    header: "จังหวัด",              visible: false, pinnable: true,  pin: false },
  { key: "amphoe",      header: "อำเภอ",               visible: false, pinnable: true,  pin: false },
  { key: "tambon",      header: "ตำบล",                visible: false, pinnable: true,  pin: false },
  { key: "zipcode",     header: "รหัสไปรษณีย์",         visible: false, pinnable: true,  pin: false },
  { key: "address",     header: "ลายละเอียดเพิ่มเติม",   visible: false, pinnable: true,  pin: false },
  { key: "checkInDate", header: "วันที่ลงทะเบียน",       visible: true,  pinnable: true,  pin: false },
  { key: "contractEndDate", header: "หมดอายุสัญญา",      visible: true,  pinnable: true,  pin: false },
  { key: "pdf",         header: "ไฟล์เอกสาร",           visible: true,  pinnable: true,  pin: false,  thClass: "text-center", tdClass: "text-center" },
  { key: "actions",     header: "จัดการ",               visible: true,  pinnable: true,  pin: "right", thClass: "text-center action-cell", tdClass: "text-center action-cell" },
];

// ─── Column visibility dropdown (react-select styled) ────────────────────────
const colSelectStyles: StylesConfig<any, true> = {
  control: (base, state) => ({
    ...base,
    backgroundColor: state.menuIsOpen || state.isFocused ? "var(--color-white)" : "var(--color-background)",
    border: `1px solid ${state.menuIsOpen || state.isFocused ? "var(--color-primary)" : "var(--color-light)"}`,
    borderRadius: "var(--border-radius-1)",
    boxShadow: state.menuIsOpen || state.isFocused ? "0 0 0 3px rgba(108,155,207,0.25)" : "none",
    minHeight: "38px",
    fontSize: "0.9rem",
    cursor: "pointer",
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
  menu: (base) => ({
    ...base,
    backgroundColor: "var(--color-white)",
    border: "1px solid var(--color-light)",
    borderRadius: "var(--border-radius-1)",
    boxShadow: "0 4px 24px rgba(0,0,0,0.10)",
    zIndex: 9999,
    overflow: "hidden",
  }),
  menuList: (base) => ({ ...base, padding: "4px", maxHeight: "260px" }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isFocused ? "rgba(108,155,207,0.12)" : "transparent",
    color: "var(--color-dark-variant)",
    fontSize: "0.88rem",
    borderRadius: "var(--border-radius-1)",
    padding: "0.45rem 0.75rem",
    cursor: "pointer",
    transition: "background 0.15s ease",
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

function ColVisibilityDropdown({
  cols, onChange,
}: {
  cols: ColDef[];
  onChange: (key: string, visible: boolean) => void;
}) {
  const toggleable = cols.filter((c) => c.key !== "actions" && c.key !== "checkbox");
  const options = toggleable.map((c) => ({ value: c.key, label: c.header }));
  const value = toggleable.filter((c) => c.visible).map((c) => ({ value: c.key, label: c.header }));

  return (
    <Select
      isMulti
      options={options}
      value={value}
      onChange={(selected) => {
        const selectedKeys = new Set((selected as any[]).map((s) => s.value));
        toggleable.forEach((c) => {
          if (c.visible !== selectedKeys.has(c.key)) onChange(c.key, selectedKeys.has(c.key));
        });
      }}
      styles={colSelectStyles}
      components={{ Option: ColCheckboxOption, ValueContainer: ColValueContainer, MultiValue: () => null }}
      closeMenuOnSelect={false}
      hideSelectedOptions={false}
      isSearchable={false}
      noOptionsMessage={() => "ไม่พบข้อมูล"}
      placeholder="เลือกคอลัมน์ที่แสดง..."
    />
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function TenantTableView({
  data, rooms, onViewDetail, onDelete, onDeleteBulk,
}: {
  data: any[];
  rooms: any[];
  onViewDetail: (t: any) => void;
  onDelete: (tenant: any) => Promise<void>;
  onDeleteBulk: (tenants: any[]) => Promise<void>;
}) {
  const { enabled: privacyModeEnabled } = usePrivacyMode();
  const [cols, setCols] = useColumnVisibility("tenants", INITIAL_COLS);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [pinMenu, setPinMenu] = useState<PinMenuState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<any[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const { widths, startResize } = useColumnWidths("tenants", {
    checkbox: 40, id: 80, image: 70, title: 100, firstName: 110, lastName: 110, phone: 130, idLine: 120,
    lineConnect: 110, roomNumber: 90, houseNo: 110, soi: 110, road: 110, province: 110,
    amphoe: 110, tambon: 110, zipcode: 110, address: 200, checkInDate: 150, pdf: 110, actions: 130,
  });
  const { ordered: rowOrdered, moveRow } = useRowOrder("tenants", data, (t: any) => String(t.id));
  const [draggingRowKey, setDraggingRowKey] = useState<string | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);

  async function doDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      if (confirmDelete.length === 1) {
        await onDelete(confirmDelete[0]);
      } else {
        await onDeleteBulk(confirmDelete);
      }
      setSelectedRows(new Set());
    } catch {
      // error handled by parent
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  // Ordered visible columns: left-pinned → normal → right-pinned
  const visible = cols.filter((c) => c.visible);
  const ordered = [
    ...visible.filter((c) => c.pin === "left"),
    ...visible.filter((c) => !c.pin),
    ...visible.filter((c) => c.pin === "right"),
  ];

  // Compute sticky left/right offsets after each render
  useLayoutEffect(() => {
    const tbl = tableRef.current;
    if (!tbl) return;
    const ths = Array.from(tbl.querySelectorAll<HTMLTableCellElement>("thead tr th"));
    const rowTds = Array.from(tbl.querySelectorAll<HTMLTableRowElement>("tbody tr")).map(
      (tr) => Array.from(tr.querySelectorAll<HTMLTableCellElement>("td"))
    );

    // left-pinned
    let leftOff = 0;
    ordered.forEach((col, i) => {
      if (col.pin !== "left") return;
      const th = ths[i];
      if (!th) return;
      th.style.left = `${leftOff}px`;
      rowTds.forEach((cells) => { if (cells[i]) cells[i].style.left = `${leftOff}px`; });
      leftOff += th.offsetWidth;
    });

    // right-pinned (reverse)
    let rightOff = 0;
    [...ordered].reverse().forEach((col, ri) => {
      if (col.pin !== "right") return;
      const i = ordered.length - 1 - ri;
      const th = ths[i];
      if (!th) return;
      th.style.right = `${rightOff}px`;
      rowTds.forEach((cells) => { if (cells[i]) cells[i].style.right = `${rightOff}px`; });
      rightOff += th.offsetWidth;
    });
  });

  // Indeterminate state for select-all
  const allSelected = data.length > 0 && selectedRows.size === data.length;
  const someSelected = selectedRows.size > 0 && !allSelected;
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  function toggleAll(checked: boolean) {
    setSelectedRows(checked ? new Set(data.map((t) => t.id)) : new Set());
  }
  function toggleRow(id: string) {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleColVisibility(key: string, visible: boolean) {
    setCols((prev) => prev.map((c) => (c.key === key ? { ...c, visible } : c)));
  }
  function handlePin(key: string, dir: PinDir) {
    setCols((prev) => prev.map((c) => (c.key === key ? { ...c, pin: dir } : c)));
  }

  function openPinMenu(e: React.MouseEvent, colKey: string) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPinMenu({ colKey, x: Math.max(0, rect.right - 160), y: rect.bottom + 4 });
  }

  // Cell renderer
  function renderCell(col: ColDef, tenant: any) {
    const rNum = getTenantRoomsLabel(rooms, tenant);
    const pdfs: any[] = Array.isArray(tenant.pdfLinks) ? tenant.pdfLinks : [];
    switch (col.key) {
      case "checkbox":
        return (
          <>
            <span className="row-drag-handle" draggable
              onClick={(e) => e.stopPropagation()}
              onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(tenant.id)); setDraggingRowKey(String(tenant.id)); }}
              onDragEnd={() => { setDraggingRowKey(null); setDropTargetKey(null); }}
              title="ลากเพื่อสลับลำดับแถว">
              <i className="fas fa-grip-vertical" />
            </span>
            <input type="checkbox" className="form-check-input row-checkbox"
              checked={selectedRows.has(tenant.id)}
              onChange={() => toggleRow(tenant.id)}
              onClick={(e) => e.stopPropagation()} />
          </>
        );
      case "id": return tenant.id;
      case "image":
        return (
          <PrivacyAvatar
            src={getDriveImgSrc(tenant.driveImageUrl)}
            className="tenant-list-avatar"
            style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover" }}
            alt={tenant.firstName}
            onError={(e) => { (e.target as HTMLImageElement).src = AVATAR_URL; }}
          />
        );
      case "title":     return tenant.title || "-";
      case "firstName": return tenant.firstName || "-";
      case "lastName":  return tenant.lastName || "-";
      case "phone":     return <PrivacyMask value={tenant.tel} />;
      case "idLine":    return <PrivacyMask value={tenant.idLine} />;
      case "lineConnect":
        return tenant.lineUserId
          ? <i className="fas fa-check-circle text-success" title="เชื่อมต่อแล้ว" />
          : <span className="text-muted">-</span>;
      case "roomNumber":
        return rNum
          ? <span className="fw-bold">ห้อง {rNum}</span>
          : <span className="text-muted">-</span>;
      case "houseNo":     return <PrivacyMask value={tenant.houseNo} />;
      case "soi":         return <PrivacyMask value={tenant.soi} />;
      case "road":        return <PrivacyMask value={tenant.road} />;
      case "province":    return <PrivacyMask value={tenant.province} />;
      case "amphoe":      return <PrivacyMask value={tenant.amphoe} />;
      case "tambon":      return <PrivacyMask value={tenant.tambon} />;
      case "zipcode":     return <PrivacyMask value={tenant.zipcode} />;
      case "address":     return <PrivacyMask value={tenant.address} />;
      case "checkInDate": return formatCheckInDate(tenant.checkInDate);
      case "contractEndDate":
        return tenant.contractEndDate ? (
          <div className="d-flex flex-column gap-1">
            <span>{formatCheckInDate(tenant.contractEndDate)}</span>
            <ContractStatusBadge contractEndDate={tenant.contractEndDate} />
          </div>
        ) : <span className="text-muted">-</span>;
      case "pdf":
        if (!pdfs.length) return <span className="text-muted">-</span>;
        if (privacyModeEnabled)
          return (
            <span className="btn btn-sm btn-outline-secondary pdf-icon-btn" title="ซ่อนอยู่ในโหมดความเป็นส่วนตัว">
              <i className="fas fa-eye-slash" />
              {pdfs.length > 1 && <span className="badge bg-secondary ms-1">{pdfs.length}</span>}
            </span>
          );
        if (pdfs.length === 1)
          return (
            <a href={pdfs[0].url} target="_blank" rel="noopener noreferrer"
              className="btn btn-sm btn-outline-danger pdf-icon-btn" title={pdfs[0].name}
              onClick={(e) => e.stopPropagation()}>
              <i className="fas fa-file-pdf" />
            </a>
          );
        return (
          <span className="btn btn-sm btn-outline-primary pdf-icon-btn">
            <i className="fas fa-folder-open" />
            <span className="badge bg-secondary ms-1">{pdfs.length}</span>
          </span>
        );
      case "actions":
        return (
          <div className="btn-group" role="group">
            <button type="button" className="btn btn-sm btn-info" title="ดูรายละเอียด"
              onClick={(e) => { e.stopPropagation(); onViewDetail(tenant); }}>
              <i className="fas fa-eye" />
            </button>
            <button type="button" className="btn btn-sm btn-warning" title="แก้ไขข้อมูล"
              onClick={(e) => { e.stopPropagation(); onViewDetail(tenant); }}>
              <i className="fas fa-edit" />
            </button>
            <button type="button" className="btn btn-sm btn-danger" title="ลบผู้เช่า"
              onClick={(e) => { e.stopPropagation(); setConfirmDelete([tenant]); }}>
              <i className="fas fa-trash-alt" />
            </button>
          </div>
        );
      default: return "-";
    }
  }

  return (
    <div>
      {/* Toolbar: column visibility */}
      <div className="mb-2">
        <ColVisibilityDropdown cols={cols} onChange={handleColVisibility} />
      </div>

      {/* Bulk actions bar */}
      {selectedRows.size > 0 && (
        <div className="bulk-actions-bar mb-2" style={{ justifyContent: "space-between" }}>
          <span>เลือก <strong>{selectedRows.size}</strong> รายการ</span>
          <button className="btn btn-danger btn-sm"
            onClick={() => setConfirmDelete(data.filter((t) => selectedRows.has(t.id)))}>
            <i className="fas fa-trash-alt me-1" />ลบรายการที่เลือก
          </button>
        </div>
      )}

      {/* Table */}
      <div style={{ maxHeight: 600, overflow: "auto" }} className="nicescrollbar">
        <table ref={tableRef} className="table-mainstyle table-hover table-resizable" style={{ minWidth: 600 }}>
          <thead>
            <tr>
              {ordered.map((col) => {
                const pinClass =
                  col.pin === "left" ? "pinned pinned-left" :
                  col.pin === "right" ? "pinned pinned-right" : "";
                return (
                  <th key={col.key} className={`${col.thClass ?? ""} ${pinClass}`} style={{ width: widths[col.key] }}>
                    {col.key === "checkbox" ? (
                      <input ref={selectAllRef} type="checkbox" className="form-check-input"
                        checked={allSelected} onChange={(e) => toggleAll(e.target.checked)} />
                    ) : col.header}
                    {col.pinnable && col.key !== "checkbox" && (
                      <i
                        className={`fas fa-thumbtack pin-icon${col.pin === "left" ? " active-left" : col.pin === "right" ? " active-right" : ""}`}
                        title="ตัวเลือกการปักหมุด"
                        onClick={(e) => openPinMenu(e, col.key)}
                      />
                    )}
                    <ColResizeHandle onMouseDown={(e) => startResize(col.key, e)} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rowOrdered.map((tenant) => {
              const rowKey = String(tenant.id);
              return (
                <tr key={tenant.id}
                  className={`${draggingRowKey === rowKey ? "row-dragging" : ""} ${dropTargetKey === rowKey ? "row-drop-target" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); if (draggingRowKey && draggingRowKey !== rowKey) setDropTargetKey(rowKey); }}
                  onDragLeave={() => setDropTargetKey((k) => (k === rowKey ? null : k))}
                  onDrop={(e) => { e.preventDefault(); const dragged = e.dataTransfer.getData("text/plain"); if (dragged) moveRow(dragged, rowKey); setDraggingRowKey(null); setDropTargetKey(null); }}>
                  {ordered.map((col) => {
                    const pinClass =
                      col.pin === "left" ? "pinned pinned-left" :
                      col.pin === "right" ? "pinned pinned-right" : "";
                    return (
                      <td key={col.key} className={`${col.tdClass ?? ""} ${pinClass}`}>
                        {renderCell(col, tenant)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {data.length === 0 && (
              <tr>
                <td colSpan={ordered.length}><EmptyState icon="fa-user" text="ไม่พบข้อมูล" compact /></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pin menu popup */}
      {pinMenu && (
        <PinMenuPopup
          menu={pinMenu}
          cols={cols}
          onPin={handlePin}
          onClose={() => setPinMenu(null)}
        />
      )}

      {/* Confirm delete dialog */}
      {confirmDelete && (
        <div className="confirm-overlay" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon confirm-icon--danger">
              <i className="fas fa-trash-alt" />
            </div>
            <h6 className="confirm-title">
              {confirmDelete.length === 1 ? "ลบผู้เช่า" : `ลบผู้เช่า ${confirmDelete.length} รายการ`}
            </h6>
            <p className="confirm-message">
              {confirmDelete.length === 1
                ? `ลบ ${tenantDisplayName(confirmDelete[0])}${(confirmDelete[0].idRoom || confirmDelete[0].extraRoomIds?.length) ? ` และนำออกจากห้องที่เช่าอยู่` : ""} ใช่หรือไม่?`
                : `ลบผู้เช่า ${confirmDelete.length} รายการ และนำออกจากห้องที่เช่าอยู่ทั้งหมด ใช่หรือไม่?`}
              <br /><small className="text-danger">การกระทำนี้ไม่สามารถย้อนกลับได้</small>
            </p>
            <div className="confirm-actions">
              <button className="btn btn-outline-secondary" onClick={() => setConfirmDelete(null)} disabled={deleting}>
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
      )}
    </div>
  );
}
