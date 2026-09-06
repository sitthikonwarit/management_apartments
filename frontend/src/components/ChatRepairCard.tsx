import { useState } from "react";
import ImageLightbox from "./ImageLightbox";
import { chatApi, type ChatMessage } from "../api/client";
import { toastSuccess, toastError } from "../utils/toast";

interface RepairItem { name: string; price: number; qty: number }

interface RepairSnapshot {
  kind: "repair";
  title: string;
  details: string;
  tenantPhotos: string[];
  roomNumber: string;
  status: "pending" | "in_progress" | "completed";
  adminItems: RepairItem[];
  adminPhotos: string[];
  adminNote: string;
  confirmedBy: string;
  confirmedAt: string;
}

function money(n: number) {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(n || 0);
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const cardStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 14, overflow: "hidden",
  border: "1px solid #e0e0e0", width: 300, maxWidth: "100%", boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
};

// การ์ดแจ้งซ่อมในหน้าแชท — ผู้เช่าส่งเข้ามาจากหน้า LIFF Repair (kind: "repair" ใน text ของ chatMessages)
// พนักงานกดปุ่ม "กรอกรายละเอียดการซ่อม" กรอกอุปกรณ์/ราคา/รูป แล้วยืนยันปิดงานได้ตรงนี้เลย ไม่ต้องออกจากหน้าแชท
export function ChatRepairMessage({ messageId, lineUserId, raw, onUpdated }: {
  messageId: string; lineUserId: string; raw: string; onUpdated: (updated: ChatMessage) => void;
}) {
  let data: RepairSnapshot | null = null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.kind === "repair") data = parsed;
  } catch {
    // ข้อมูลอ่านไม่ได้ — fallback ข้างล่าง
  }

  const [lightboxImages, setLightboxImages] = useState<string[] | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [showForm, setShowForm] = useState(false);

  if (!data) {
    return (
      <div style={{ background: "var(--color-background)", borderRadius: "var(--border-radius-1)", padding: "8px 12px" }}>
        <span style={{ whiteSpace: "pre-wrap" }}>{raw}</span>
      </div>
    );
  }

  const isCompleted = data.status === "completed";
  const total = data.adminItems.reduce((s, it) => s + it.price * it.qty, 0);

  return (
    <div className="chat-line-card" style={cardStyle}>
      <div style={{ background: "#fd7e14", padding: 16 }}>
        <div className="d-flex align-items-center">
          <i className="fas fa-tools" style={{ color: "#fff", fontSize: 16 }} />
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 15, marginLeft: 8 }}>แจ้งซ่อม</span>
          <span className={`badge ms-auto ${isCompleted ? "bg-success" : "bg-light text-dark"}`}>
            {isCompleted ? "ปิดงานแล้ว" : "รอดำเนินการ"}
          </span>
        </div>
      </div>
      <div style={{ padding: 16 }}>
        <div className="fw-bold mb-1">{data.title}</div>
        {data.roomNumber && <div className="text-muted small mb-2">ห้อง {data.roomNumber}</div>}
        {data.details && <div className="small mb-2" style={{ whiteSpace: "pre-wrap" }}>{data.details}</div>}

        {data.tenantPhotos.length > 0 && (
          <div className="d-flex flex-wrap gap-1 mb-2">
            {data.tenantPhotos.map((url, i) => (
              <img key={i} src={url} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6, cursor: "pointer" }}
                onClick={() => { setLightboxImages(data!.tenantPhotos); setLightboxIndex(i); }} />
            ))}
          </div>
        )}

        {isCompleted ? (
          <div className="border-top pt-2 mt-2 small">
            {data.adminItems.length > 0 && (
              <div className="mb-1">
                {data.adminItems.map((it, i) => (
                  <div key={i} className="d-flex justify-content-between">
                    <span>{it.name} x{it.qty}</span>
                    <span>{money(it.price * it.qty)} ฿</span>
                  </div>
                ))}
                <div className="d-flex justify-content-between fw-bold border-top mt-1 pt-1">
                  <span>รวม</span><span>{money(total)} ฿</span>
                </div>
              </div>
            )}
            {data.adminNote && <div className="text-muted mb-1">หมายเหตุ: {data.adminNote}</div>}
            {data.adminPhotos.length > 0 && (
              <div className="d-flex flex-wrap gap-1 mb-1">
                {data.adminPhotos.map((url, i) => (
                  <img key={i} src={url} alt="" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, cursor: "pointer" }}
                    onClick={() => { setLightboxImages(data!.adminPhotos); setLightboxIndex(i); }} />
                ))}
              </div>
            )}
            <div className="text-muted" style={{ fontSize: 11 }}>ยืนยันโดย {data.confirmedBy}</div>
          </div>
        ) : (
          <button className="btn btn-sm btn-warning w-100 mt-1" onClick={() => setShowForm(true)}>
            <i className="fas fa-clipboard-check me-1" />กรอกรายละเอียดการซ่อม
          </button>
        )}
      </div>

      {lightboxImages && (
        <ImageLightbox images={lightboxImages} index={lightboxIndex} onClose={() => setLightboxImages(null)} onIndexChange={setLightboxIndex} />
      )}

      {showForm && (
        <RepairFormModal
          messageId={messageId} lineUserId={lineUserId}
          onClose={() => setShowForm(false)}
          onConfirmed={(updated) => { setShowForm(false); onUpdated(updated); }}
        />
      )}
    </div>
  );
}

function RepairFormModal({ messageId, lineUserId, onClose, onConfirmed }: {
  messageId: string; lineUserId: string; onClose: () => void; onConfirmed: (updated: ChatMessage) => void;
}) {
  const [items, setItems] = useState<RepairItem[]>([{ name: "", price: 0, qty: 1 }]);
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function updateItem(idx: number, patch: Partial<RepairItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems((prev) => [...prev, { name: "", price: 0, qty: 1 }]);
  }
  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleAddPhotos(files: FileList) {
    const picked = Array.from(files).slice(0, 6 - photos.length);
    const base64s = await Promise.all(picked.map(readFileAsBase64));
    setPhotos((prev) => [...prev, ...base64s]);
  }

  const total = items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);

  async function handleConfirm() {
    setSaving(true); setError("");
    try {
      const cleanItems = items
        .filter((it) => it.name.trim())
        .map((it) => ({ name: it.name.trim(), price: Number(it.price) || 0, qty: Math.max(1, Number(it.qty) || 1) }));
      const updated = await chatApi.confirmRepair(lineUserId, messageId, { items: cleanItems, note: note.trim(), photos });
      toastSuccess("ยืนยันการซ่อมสำเร็จ แจ้งผู้เช่าทาง LINE แล้ว");
      onConfirmed(updated);
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? "ยืนยันไม่สำเร็จ กรุณาลองใหม่";
      setError(msg);
      toastError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="confirm-overlay" onClick={() => !saving && onClose()}>
      <div className="confirm-dialog" style={{ maxWidth: 460, width: "94%", textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
        <h6 className="confirm-title" style={{ textAlign: "left" }}>กรอกรายละเอียดการซ่อม</h6>

        <label className="form-label small fw-bold">อุปกรณ์/รายการที่ใช้หรือซื้อ</label>
        {items.map((it, i) => (
          <div className="row g-2 mb-2" key={i}>
            <div className="col-5">
              <input className="form-control form-control-sm" placeholder="ชื่ออุปกรณ์"
                value={it.name} onChange={(e) => updateItem(i, { name: e.target.value })} />
            </div>
            <div className="col-3">
              <input type="number" className="form-control form-control-sm" placeholder="ราคา"
                value={it.price || ""} onChange={(e) => updateItem(i, { price: Number(e.target.value) })} />
            </div>
            <div className="col-2">
              <input type="number" className="form-control form-control-sm" placeholder="จำนวน" min={1}
                value={it.qty || ""} onChange={(e) => updateItem(i, { qty: Number(e.target.value) })} />
            </div>
            <div className="col-2">
              <button className="btn btn-sm btn-outline-danger border-0 w-100" onClick={() => removeItem(i)}>
                <i className="fas fa-trash" />
              </button>
            </div>
          </div>
        ))}
        <button className="btn btn-sm btn-outline-primary mb-3" onClick={addItem}>
          <i className="fas fa-plus me-1" />เพิ่มรายการ
        </button>

        {total > 0 && (
          <div className="text-end small fw-bold mb-3">รวมค่าใช้จ่าย: {money(total)} ฿</div>
        )}

        <label className="form-label small fw-bold">หมายเหตุ</label>
        <textarea className="form-control mb-3" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />

        <label className="form-label small fw-bold">รูปหลังซ่อมเสร็จ <span className="text-muted fw-normal">(ไม่บังคับ)</span></label>
        <div className="d-flex flex-wrap gap-2 mb-3">
          {photos.map((p, i) => (
            <div key={i} style={{ position: "relative", width: 56, height: 56 }}>
              <img src={p} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: "1px solid var(--color-light)" }} />
              <button type="button" onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", border: "none", background: "var(--color-danger)", color: "#fff", fontSize: 10, lineHeight: 1 }}>
                <i className="fas fa-times" />
              </button>
            </div>
          ))}
          {photos.length < 6 && (
            <label style={{ width: 56, height: 56, border: "1px dashed var(--color-light)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <i className="fas fa-plus text-muted" />
              <input type="file" accept="image/*" multiple hidden
                onChange={(e) => { if (e.target.files?.length) handleAddPhotos(e.target.files); e.target.value = ""; }} />
            </label>
          )}
        </div>

        {error && <div className="room-modal-error mb-3"><i className="fas fa-exclamation-circle me-2" />{error}</div>}

        <div className="confirm-actions">
          <button className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>ยกเลิก</button>
          <button className="btn btn-primary" onClick={handleConfirm} disabled={saving}>
            {saving
              ? <><span className="spinner-border spinner-border-sm me-2" />กำลังบันทึก...</>
              : <><i className="fas fa-check me-1" />ยืนยันปิดงาน</>}
          </button>
        </div>
      </div>
    </div>
  );
}
