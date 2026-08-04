import { useState } from "react";
import ImageLightbox from "./ImageLightbox";
import { chatApi, type ChatMessage } from "../api/client";
import { monthYearLabel } from "../utils/billCalc";
import { toastSuccess, toastError } from "../utils/toast";

interface PaymentConfirmSnapshot {
  kind: "payment_confirm";
  intentId: string;
  billId: string;
  roomId: string;
  roomNumber: string;
  monthYear: string;
  amount: number;
  tenantName: string;
  slipUrl: string;
  status: "pending" | "confirmed" | "rejected";
  rejectReason: string;
  confirmedBy: string;
  confirmedAt: string;
}

function money(n: number) {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(n || 0);
}

const cardStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 14, overflow: "hidden",
  border: "1px solid #e0e0e0", width: 300, maxWidth: "100%", boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
};

// การ์ดแจ้งชำระเงินในหน้าแชท — ผู้เช่าส่งเข้ามาจากป็อปอัพ "จ่ายงวดนี้" ในหน้า LIFF Payment ตอนตรวจสลิป
// อัตโนมัติด้วย EasySlip ไม่สำเร็จ (kind: "payment_confirm" ใน text ของ chatMessages) พนักงานกดยืนยัน/ปฏิเสธ
// ได้ตรงนี้เลย ไม่ต้องออกจากหน้าแชท — ยืนยันแล้วระบบบันทึกยอด/อัปเดตบิล/ส่งใบเสร็จให้ครบเหมือนตรวจสลิปอัตโนมัติ
export function ChatPaymentConfirmMessage({ messageId, lineUserId, raw, onUpdated }: {
  messageId: string; lineUserId: string; raw: string; onUpdated: (updated: ChatMessage) => void;
}) {
  let data: PaymentConfirmSnapshot | null = null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.kind === "payment_confirm") data = parsed;
  } catch {
    // ข้อมูลอ่านไม่ได้ — fallback ข้างล่าง
  }

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);

  if (!data) {
    return (
      <div style={{ background: "var(--color-background)", borderRadius: "var(--border-radius-1)", padding: "8px 12px" }}>
        <span style={{ whiteSpace: "pre-wrap" }}>{raw}</span>
      </div>
    );
  }

  async function handleConfirm() {
    setConfirming(true);
    try {
      const updated = await chatApi.confirmPayment(lineUserId, messageId, "confirm");
      toastSuccess("ยืนยันการชำระเงินสำเร็จ บันทึกยอด+ส่งใบเสร็จให้แล้ว");
      onUpdated(updated);
    } catch (e: any) {
      toastError(e?.response?.data?.error ?? "ยืนยันไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setConfirming(false);
    }
  }

  const statusBadge = data.status === "confirmed"
    ? { text: "ยืนยันแล้ว", cls: "bg-success" }
    : data.status === "rejected"
      ? { text: "ปฏิเสธแล้ว", cls: "bg-danger" }
      : { text: "รอตรวจสอบ", cls: "bg-light text-dark" };

  return (
    <div style={cardStyle}>
      <div style={{ background: "#1b9c85", padding: 16 }}>
        <div className="d-flex align-items-center">
          <i className="fas fa-hand-holding-dollar" style={{ color: "#fff", fontSize: 16 }} />
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 15, marginLeft: 8 }}>แจ้งชำระเงิน</span>
          <span className={`badge ms-auto ${statusBadge.cls}`}>{statusBadge.text}</span>
        </div>
      </div>
      <div style={{ padding: 16 }}>
        {data.roomNumber && <div className="text-muted small mb-1">ห้อง {data.roomNumber}</div>}
        {data.monthYear && <div className="small mb-2">สำหรับเดือน {monthYearLabel(data.monthYear)}</div>}
        <div className="fw-bold fs-5 mb-2" style={{ color: "var(--color-primary)" }}>{money(data.amount)} ฿</div>

        {data.slipUrl && (
          <img src={data.slipUrl} alt="สลิปการโอน" style={{ width: "100%", maxHeight: 200, objectFit: "cover", borderRadius: 8, cursor: "pointer", marginBottom: 12 }}
            onClick={() => setLightboxOpen(true)} />
        )}

        {data.status === "pending" ? (
          <div className="d-flex gap-2">
            <button className="btn btn-sm btn-outline-danger flex-grow-1" onClick={() => setShowRejectForm(true)} disabled={confirming}>
              <i className="fas fa-times me-1" />ปฏิเสธ
            </button>
            <button className="btn btn-sm btn-success flex-grow-1" onClick={handleConfirm} disabled={confirming}>
              {confirming ? <span className="spinner-border spinner-border-sm" /> : <><i className="fas fa-check me-1" />ยืนยันการชำระ</>}
            </button>
          </div>
        ) : data.status === "confirmed" ? (
          <div className="text-muted" style={{ fontSize: 11 }}>ยืนยันโดย {data.confirmedBy}</div>
        ) : (
          <div className="small">
            <div className="text-muted" style={{ fontSize: 11 }}>ปฏิเสธโดย {data.confirmedBy}</div>
            {data.rejectReason && <div className="text-danger mt-1">เหตุผล: {data.rejectReason}</div>}
          </div>
        )}
      </div>

      {lightboxOpen && data.slipUrl && (
        <ImageLightbox images={[data.slipUrl]} index={0} onClose={() => setLightboxOpen(false)} onIndexChange={() => {}} />
      )}

      {showRejectForm && (
        <RejectFormModal
          messageId={messageId} lineUserId={lineUserId}
          onClose={() => setShowRejectForm(false)}
          onRejected={(updated) => { setShowRejectForm(false); onUpdated(updated); }}
        />
      )}
    </div>
  );
}

function RejectFormModal({ messageId, lineUserId, onClose, onRejected }: {
  messageId: string; lineUserId: string; onClose: () => void; onRejected: (updated: ChatMessage) => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleReject() {
    setSaving(true);
    try {
      const updated = await chatApi.confirmPayment(lineUserId, messageId, "reject", reason.trim());
      toastSuccess("ปฏิเสธคำขอแจ้งชำระเงินแล้ว แจ้งผู้เช่าทาง LINE แล้ว");
      onRejected(updated);
    } catch (e: any) {
      toastError(e?.response?.data?.error ?? "ปฏิเสธไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="confirm-overlay" onClick={() => !saving && onClose()}>
      <div className="confirm-dialog" style={{ maxWidth: 400, width: "94%", textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
        <h6 className="confirm-title" style={{ textAlign: "left" }}>ปฏิเสธคำขอแจ้งชำระเงิน</h6>
        <label className="form-label small fw-bold">เหตุผล (ไม่บังคับ)</label>
        <textarea className="form-control mb-3" rows={3} placeholder="เช่น สลิปไม่ชัด / ยอดไม่ตรง"
          value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="confirm-actions">
          <button className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>ยกเลิก</button>
          <button className="btn btn-danger" onClick={handleReject} disabled={saving}>
            {saving
              ? <><span className="spinner-border spinner-border-sm me-2" />กำลังบันทึก...</>
              : <><i className="fas fa-times me-1" />ยืนยันการปฏิเสธ</>}
          </button>
        </div>
      </div>
    </div>
  );
}
