// หน้า LIFF Booking — ปลายทางของปุ่ม "ดูห้องว่าง"/"จองห้อง" บนเมนู Guest (ชี้มาที่ URL เดียวกัน ต่างกันแค่
// ข้อความปุ่ม ดู services/richMenu.ts) แสดงรายการห้องว่างสาธารณะ (ไม่ต้องเป็นผู้เช่ามาก่อน) กด "จองห้องนี้"
// กรอกชื่อ+เบอร์โทรแล้วส่งเข้าเป็นข้อความแชทพิเศษ (messageType "booking") เด้งแจ้งเตือนในหน้าแชทของเว็บทันที
// พนักงานโทรกลับไปยืนยันเอง ไม่มีการล็อกห้อง/ยืนยันอัตโนมัติใดๆ (ดู components/ChatBookingCard.tsx)
import { useEffect, useState } from "react";
import liff from "@line/liff";
import { liffApi } from "../api/client";
import { extractLiffId } from "../utils/liffHelpers";

type Status = "loading" | "ready" | "error";

interface AvailableRoom {
  id: string; number: string; floor: string; towerName: string; towerColor: string;
  price: number; dailyPrice: number; detail: string; pictures: { url: string; name?: string }[];
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n) || 0);
}

export default function LiffBookingPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [branding, setBranding] = useState({ logoUrl: "", nameText: "" });
  const [accessToken, setAccessToken] = useState("");
  const [rooms, setRooms] = useState<AvailableRoom[]>([]);

  const [bookRoom, setBookRoom] = useState<AvailableRoom | null>(null);
  const [name, setName] = useState("");
  const [tel, setTel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await liffApi.getConfig();
        if (cancelled) return;
        setBranding({ logoUrl: cfg.appIdentity.logoUrl, nameText: cfg.appIdentity.nameText });

        const liffId = extractLiffId(cfg.liffBookingUrl);
        if (!liffId) { setErrorMsg("ระบบยังไม่ได้ตั้งค่า LIFF Booking URL กรุณาติดต่อผู้ดูแลระบบ"); setStatus("error"); return; }

        await liff.init({ liffId });
        if (!liff.isLoggedIn()) { liff.login(); return; }

        const token = liff.getAccessToken();
        if (!token) { setErrorMsg("ไม่พบ Access Token จาก LINE กรุณาลองใหม่อีกครั้ง"); setStatus("error"); return; }
        setAccessToken(token);

        const availableRooms = await liffApi.availableRooms();
        if (cancelled) return;
        setRooms(availableRooms);
        setStatus("ready");
      } catch (e: any) {
        if (cancelled) return;
        setErrorMsg(e?.response?.data?.error ?? e?.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
        setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function openBook(room: AvailableRoom) {
    setBookRoom(room);
    setName(""); setTel(""); setFormError(""); setSubmitted(false);
  }

  function closeBook() {
    setBookRoom(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!bookRoom) return;
    if (!name.trim()) { setFormError("กรุณากรอกชื่อ"); return; }
    if (!tel.trim()) { setFormError("กรุณากรอกเบอร์โทรศัพท์"); return; }
    setSubmitting(true); setFormError("");
    try {
      await liffApi.bookRoom(accessToken, bookRoom.id, name.trim(), tel.trim());
      setSubmitted(true);
    } catch (e: any) {
      setFormError(e?.response?.data?.error ?? e?.message ?? "จองห้องไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setSubmitting(false);
    }
  }

  if (status !== "ready") {
    return (
      <div className="login-page-wrap">
        <div className="login-card custom-card text-center">
          {branding.logoUrl
            ? <img src={branding.logoUrl} alt="" style={{ width: 56, height: 56, objectFit: "contain", borderRadius: "50%", margin: "0 auto", display: "block" }} />
            : <div className="login-icon"><i className="fas fa-door-open" /></div>}
          <h5 className="mt-3 mb-1" style={{ fontWeight: 700 }}>{branding.nameText || "ห้องว่าง"}</h5>
          {status === "loading" && (
            <div className="py-4">
              <div className="spinner-border" style={{ color: "var(--color-primary)" }} />
              <p className="text-muted small mt-3 mb-0">กำลังโหลดข้อมูล...</p>
            </div>
          )}
          {status === "error" && (
            <div className="room-modal-error mt-3"><i className="fas fa-exclamation-circle me-2" />{errorMsg}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="login-page-wrap">
      <div className="login-card custom-card" style={{ maxWidth: 440 }}>
        <div className="text-center mb-3">
          {branding.logoUrl
            ? <img src={branding.logoUrl} alt="" style={{ width: 56, height: 56, objectFit: "contain", borderRadius: "50%", margin: "0 auto", display: "block" }} />
            : <div className="login-icon"><i className="fas fa-door-open" /></div>}
          <h5 className="mt-3 mb-1" style={{ fontWeight: 700 }}>ห้องว่าง</h5>
          <p className="text-muted small mb-0">เลือกห้องที่สนใจแล้วกดจองได้เลย พนักงานจะโทรกลับไปยืนยัน</p>
        </div>

        {rooms.length === 0 ? (
          <div className="alert alert-light border text-center small mb-0">
            <i className="fas fa-circle-info me-2" />ขณะนี้ยังไม่มีห้องว่าง
          </div>
        ) : (
          <div className="d-flex flex-column gap-2">
            {rooms.map((room) => (
              <div key={room.id} className="p-2 rounded d-flex gap-2" style={{ border: "1px solid var(--color-light)", textAlign: "left" }}>
                {room.pictures[0] ? (
                  <img src={room.pictures[0].url} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 72, height: 72, borderRadius: 8, background: "var(--color-background)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <i className="fas fa-door-open text-muted" />
                  </div>
                )}
                <div className="flex-grow-1" style={{ minWidth: 0 }}>
                  <div className="d-flex justify-content-between align-items-start">
                    <div>
                      <span className="fw-bold">ห้อง {room.number}</span>
                      {(room.towerName || room.floor) && (
                        <span className="text-muted small ms-1">
                          {room.towerName}{room.towerName && room.floor && " · "}{room.floor && `ชั้น ${room.floor}`}
                        </span>
                      )}
                    </div>
                    <span className="fw-bold small" style={{ color: "var(--color-primary)" }}>{fmtMoney(room.price)} ฿/ด.</span>
                  </div>
                  {room.detail && <div className="text-muted small text-truncate" style={{ maxWidth: "100%" }}>{room.detail}</div>}
                  {room.dailyPrice > 0 && <div className="text-muted small">{fmtMoney(room.dailyPrice)} ฿/วัน</div>}
                  <button className="btn btn-sm btn-primary w-100 mt-2" onClick={() => openBook(room)}>
                    <i className="fas fa-calendar-check me-1" />จองห้องนี้
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {bookRoom && (
        <div className="confirm-overlay" onClick={() => !submitting && closeBook()}>
          <div className="confirm-dialog" style={{ maxWidth: 380, width: "92%", textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
            {submitted ? (
              <div className="text-center py-3">
                <div className="login-icon mb-3" style={{ background: "rgba(27,156,133,0.15)", color: "var(--color-success)" }}>
                  <i className="fas fa-check-circle" />
                </div>
                <div className="alert alert-success py-2 px-3 small mb-3">ส่งคำขอจองห้อง {bookRoom.number} เรียบร้อยแล้ว พนักงานจะติดต่อกลับทางแชทนี้หรือโทรกลับไปยืนยันเร็วๆ นี้</div>
                <button className="btn btn-primary w-100" onClick={closeBook}>ปิด</button>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <h6 className="confirm-title" style={{ textAlign: "left" }}>จองห้อง {bookRoom.number}</h6>
                <p className="text-muted small mb-3">{fmtMoney(bookRoom.price)} ฿/เดือน — กรอกชื่อและเบอร์โทรเพื่อให้พนักงานติดต่อกลับ</p>
                <div className="mb-2">
                  <label className="form-label small fw-bold">ชื่อ</label>
                  <input className="form-control" autoFocus value={name} onChange={(e) => setName(e.target.value)} disabled={submitting} />
                </div>
                <div className="mb-2">
                  <label className="form-label small fw-bold">เบอร์โทรศัพท์</label>
                  <input type="tel" className="form-control" value={tel} onChange={(e) => setTel(e.target.value)} disabled={submitting} />
                </div>
                {formError && <div className="room-modal-error my-2"><i className="fas fa-exclamation-circle me-2" />{formError}</div>}
                <div className="confirm-actions mt-3">
                  <button type="button" className="btn btn-outline-secondary" onClick={closeBook} disabled={submitting}>ยกเลิก</button>
                  <button type="submit" className="btn btn-primary" disabled={submitting}>
                    {submitting
                      ? <><span className="spinner-border spinner-border-sm me-2" />กำลังส่ง...</>
                      : <><i className="fas fa-paper-plane me-1" />ยืนยันการจอง</>}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
