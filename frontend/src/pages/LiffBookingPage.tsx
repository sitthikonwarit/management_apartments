// หน้า LIFF จองห้อง — ปลายทางของปุ่ม "จองห้อง" บนเมนู Guest (คนละ LIFF App กับหน้า "ดูห้องว่าง" จริงๆ ดู
// liffBookingUrl ใน backend/src/services/richMenu.ts) หน้าที่หลักคือแสดง "ห้องที่คุณจองอยู่" (ยกเลิกเองได้
// ที่นี่ — ห้องจะกลับเป็น "ว่าง" อัตโนมัติ) มีช่องค้นหา ถ้ามาจากทางลัด "จองห้องนี้" ในหน้า LiffRoomsPage
// (ต่อ query "?roomId=") จะมีฟอร์มยืนยันจองห้องนั้นขึ้นก่อนด้วย — จองสำเร็จแล้วห้องจะ "ล็อก" (rooms.status
// = "จอง") ให้ทันที ไม่ต้องรอพนักงานโทรกลับยืนยันเหมือนเดิมอีกต่อไป (ดู POST /liff/rooms/book และ
// /liff/rooms/cancel ใน backend/src/routes/liff.ts)
import { useEffect, useMemo, useState } from "react";
import liff from "@line/liff";
import { liffApi, startLiffPresenceHeartbeat } from "../api/client";
import { extractLiffId } from "../utils/liffHelpers";
import ImageLightbox from "../components/ImageLightbox";

type Status = "loading" | "ready" | "error";

interface AvailableRoom {
  id: string; number: string; floor: string; towerName: string; towerColor: string;
  price: number; dailyPrice: number; detail: string; pictures: { url: string; name?: string }[];
}

interface MyBooking {
  bookingId: string; roomId: string; roomNumber: string; towerName: string; towerColor: string;
  floor: string; price: number; detail: string; pictures: { url: string; name?: string }[]; bookedAt: string;
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n) || 0);
}

export default function LiffBookingPage() {
  // รหัสองค์กร (?org=<slug>) จาก Endpoint URL ของ LIFF app นี้เอง — ดูคอมเมนต์เดียวกันใน LiffLoginPage.tsx
  const org = new URLSearchParams(window.location.search).get("org") || undefined;
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [branding, setBranding] = useState({ logoUrl: "", nameText: "" });
  const [accessToken, setAccessToken] = useState("");

  const [myBookings, setMyBookings] = useState<MyBooking[]>([]);
  const [search, setSearch] = useState("");

  // ห้องที่มาจากทางลัด "?roomId=" (ยังไม่เคยจอง) — โชว์ฟอร์มยืนยันจองห้องนี้ก่อน
  const [pendingRoom, setPendingRoom] = useState<AvailableRoom | null>(null);
  const [pendingNotFound, setPendingNotFound] = useState(false);
  const [name, setName] = useState("");
  const [tel, setTel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [justBooked, setJustBooked] = useState(false);

  const [cancelTarget, setCancelTarget] = useState<MyBooking | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const [galleryImages, setGalleryImages] = useState<string[] | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);

  async function loadMyBookings(token: string) {
    const res = await liffApi.myBookings(token, org);
    setMyBookings(res.bookings);
    return res.bookings;
  }

  useEffect(() => {
    let cancelled = false;
    let stopPresence: (() => void) | null = null;
    (async () => {
      try {
        const cfg = await liffApi.getConfig(org);
        if (cancelled) return;
        setBranding({ logoUrl: cfg.appIdentity.logoUrl, nameText: cfg.appIdentity.nameText });

        const liffId = extractLiffId(cfg.liffBookingUrl);
        if (!liffId) { setErrorMsg("ระบบยังไม่ได้ตั้งค่า LIFF Booking URL กรุณาติดต่อผู้ดูแลระบบ"); setStatus("error"); return; }

        await liff.init({ liffId });
        if (!liff.isLoggedIn()) { liff.login(); return; }

        const token = liff.getAccessToken();
        if (!token) { setErrorMsg("ไม่พบ Access Token จาก LINE กรุณาลองใหม่อีกครั้ง"); setStatus("error"); return; }
        setAccessToken(token);
        if (!cancelled) stopPresence = startLiffPresenceHeartbeat(token, "booking", org);

        const bookings = await loadMyBookings(token);
        if (cancelled) return;

        const roomId = new URLSearchParams(window.location.search).get("roomId");
        if (roomId && !bookings.some((b) => b.roomId === roomId)) {
          const availableRooms = await liffApi.availableRooms(org);
          if (cancelled) return;
          const found = availableRooms.find((r) => r.id === roomId);
          if (found) setPendingRoom(found);
          else setPendingNotFound(true);
        }

        setStatus("ready");
      } catch (e: any) {
        if (cancelled) return;
        setErrorMsg(e?.response?.data?.error ?? e?.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
        setStatus("error");
      }
    })();
    return () => { cancelled = true; stopPresence?.(); };
  }, []);

  const filteredBookings = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return myBookings;
    return myBookings.filter((b) =>
      b.roomNumber.toLowerCase().includes(q) || b.towerName.toLowerCase().includes(q)
    );
  }, [myBookings, search]);

  function clearRoomIdFromUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete("roomId");
    window.history.replaceState({}, "", url.toString());
  }

  async function handleSubmitBooking(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingRoom) return;
    if (!name.trim()) { setFormError("กรุณากรอกชื่อ"); return; }
    if (!tel.trim()) { setFormError("กรุณากรอกเบอร์โทรศัพท์"); return; }
    setSubmitting(true); setFormError("");
    try {
      await liffApi.bookRoom(accessToken, pendingRoom.id, name.trim(), tel.trim(), org);
      setJustBooked(true);
      await loadMyBookings(accessToken);
      clearRoomIdFromUrl();
    } catch (e: any) {
      setFormError(e?.response?.data?.error ?? e?.message ?? "จองห้องไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setSubmitting(false);
    }
  }

  function dismissPendingRoom() {
    setPendingRoom(null);
    setJustBooked(false);
    clearRoomIdFromUrl();
  }

  async function handleCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await liffApi.cancelBooking(accessToken, cancelTarget.bookingId, org);
      setMyBookings((prev) => prev.filter((b) => b.bookingId !== cancelTarget.bookingId));
      setCancelTarget(null);
    } catch (e: any) {
      setFormError(e?.response?.data?.error ?? e?.message ?? "ยกเลิกการจองไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setCancelling(false);
    }
  }

  if (status !== "ready") {
    return (
      <div className="login-page-wrap">
        <div className="login-card custom-card text-center">
          {branding.logoUrl
            ? <img src={branding.logoUrl} alt="" style={{ width: 56, height: 56, objectFit: "contain", borderRadius: "50%", margin: "0 auto", display: "block" }} />
            : <div className="login-icon"><i className="fas fa-calendar-check" /></div>}
          <h5 className="mt-3 mb-1" style={{ fontWeight: 700 }}>{branding.nameText || "จองห้อง"}</h5>
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
      <div className="login-card custom-card" style={{ maxWidth: 440, textAlign: "left" }}>

        {/* ─── ฟอร์มยืนยันจอง (มาจากทางลัดในหน้า "ดูห้องว่าง") ─── */}
        {pendingRoom && (
          <div className="mb-4 pb-4" style={{ borderBottom: "1px solid var(--color-light)" }}>
            {justBooked ? (
              <div className="text-center py-2">
                <div className="login-icon mb-3" style={{ background: "rgba(27,156,133,0.15)", color: "var(--color-success)" }}>
                  <i className="fas fa-check-circle" />
                </div>
                <div className="alert alert-success py-2 px-3 small mb-3">
                  จองห้อง {pendingRoom.number} สำเร็จ ระบบล็อกห้องให้เรียบร้อยแล้ว ยกเลิกได้เองด้านล่างหากเปลี่ยนใจ
                </div>
                <button className="btn btn-outline-secondary btn-sm" onClick={dismissPendingRoom}>ปิด</button>
              </div>
            ) : (
              <form onSubmit={handleSubmitBooking}>
                <h6 className="fw-bold mb-1">ยืนยันจองห้อง {pendingRoom.number}</h6>
                <p className="text-muted small mb-3">
                  {pendingRoom.towerName ? `${pendingRoom.towerName} — ` : ""}{fmtMoney(pendingRoom.price)} ฿/เดือน
                  — กรอกชื่อและเบอร์โทรเพื่อยืนยัน ห้องจะถูกล็อกให้ทันที
                </p>
                <div className="mb-2">
                  <label className="form-label small fw-bold">ชื่อ</label>
                  <input className="form-control" autoFocus value={name} onChange={(e) => setName(e.target.value)} disabled={submitting} />
                </div>
                <div className="mb-2">
                  <label className="form-label small fw-bold">เบอร์โทรศัพท์</label>
                  <input type="tel" className="form-control" value={tel} onChange={(e) => setTel(e.target.value)} disabled={submitting} />
                </div>
                {formError && <div className="room-modal-error my-2"><i className="fas fa-exclamation-circle me-2" />{formError}</div>}
                <div className="d-flex gap-2 mt-3">
                  <button type="button" className="btn btn-outline-secondary flex-grow-1" onClick={dismissPendingRoom} disabled={submitting}>ยกเลิก</button>
                  <button type="submit" className="btn btn-primary flex-grow-1" disabled={submitting}>
                    {submitting
                      ? <><span className="spinner-border spinner-border-sm me-2" />กำลังส่ง...</>
                      : <><i className="fas fa-paper-plane me-1" />ยืนยันจอง</>}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
        {pendingNotFound && (
          <div className="alert alert-warning small mb-4"><i className="fas fa-exclamation-triangle me-2" />ห้องนี้ไม่ว่างแล้ว กรุณาเลือกห้องอื่นจากหน้า "ดูห้องว่าง"</div>
        )}

        {/* ─── รายการห้องที่จองอยู่ ─── */}
        <div className="text-center mb-3">
          {!pendingRoom && (branding.logoUrl
            ? <img src={branding.logoUrl} alt="" style={{ width: 56, height: 56, objectFit: "contain", borderRadius: "50%", margin: "0 auto", display: "block" }} />
            : <div className="login-icon"><i className="fas fa-calendar-check" /></div>)}
          <h5 className="mt-3 mb-1" style={{ fontWeight: 700 }}>ห้องที่คุณจองอยู่</h5>
          <p className="text-muted small mb-0">ยกเลิกได้เองที่นี่ — ห้องจะกลับเป็นว่างทันที</p>
        </div>

        {myBookings.length > 0 && (
          <div className="mb-3">
            <div className="position-relative">
              <i className="fas fa-search" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--color-dark-variant)" }} />
              <input
                type="text"
                className="form-control"
                style={{ paddingLeft: 34 }}
                placeholder="ค้นหาเลขห้อง, ตึก..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        )}

        {myBookings.length === 0 ? (
          <div className="alert alert-light border text-center small mb-0">
            <i className="fas fa-circle-info me-2" />คุณยังไม่มีห้องที่จองอยู่
          </div>
        ) : filteredBookings.length === 0 ? (
          <div className="alert alert-light border text-center small mb-0">
            <i className="fas fa-circle-info me-2" />ไม่พบห้องที่ตรงกับคำค้นหา
          </div>
        ) : (
          <div className="d-flex flex-column gap-3">
            {filteredBookings.map((b) => (
              <div key={b.bookingId} className="rounded overflow-hidden" style={{ border: "1px solid var(--color-light)" }}>
                {b.pictures.length > 0 ? (
                  <div
                    style={{ position: "relative", cursor: b.pictures.length > 1 ? "pointer" : "default" }}
                    onClick={() => { if (b.pictures.length > 1) { setGalleryImages(b.pictures.map((p) => p.url)); setGalleryIndex(0); } }}
                  >
                    <img src={b.pictures[0].url} alt="" style={{ width: "100%", height: 150, objectFit: "cover", display: "block" }} />
                    {b.towerColor && (
                      <span style={{ position: "absolute", top: 8, left: 8, background: b.towerColor, color: "#fff", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 12 }}>
                        {b.towerName}
                      </span>
                    )}
                  </div>
                ) : null}
                <div className="p-3">
                  <div className="d-flex justify-content-between align-items-start mb-1">
                    <span className="fw-bold fs-6">ห้อง {b.roomNumber}</span>
                    <span className="fw-bold" style={{ color: "var(--color-primary)" }}>{fmtMoney(b.price)} ฿/เดือน</span>
                  </div>
                  <div className="text-muted small mb-2">
                    <i className="fas fa-clock me-1" />จองเมื่อ {new Date(b.bookedAt).toLocaleString("th-TH")}
                  </div>
                  <button className="btn btn-sm btn-outline-danger w-100" onClick={() => setCancelTarget(b)}>
                    <i className="fas fa-times-circle me-1" />ยกเลิกการจอง
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {cancelTarget && (
        <div className="confirm-overlay" onClick={() => !cancelling && setCancelTarget(null)}>
          <div className="confirm-dialog" style={{ maxWidth: 360, width: "92%" }} onClick={(e) => e.stopPropagation()}>
            <h6 className="confirm-title">ยกเลิกการจองห้อง {cancelTarget.roomNumber}?</h6>
            <p className="text-muted small mb-3">ห้องจะเปลี่ยนกลับเป็น "ว่าง" ทันทีหลังยกเลิก</p>
            {formError && <div className="room-modal-error my-2"><i className="fas fa-exclamation-circle me-2" />{formError}</div>}
            <div className="confirm-actions mt-3">
              <button type="button" className="btn btn-outline-secondary" onClick={() => setCancelTarget(null)} disabled={cancelling}>ไม่ยกเลิก</button>
              <button type="button" className="btn btn-danger" onClick={handleCancel} disabled={cancelling}>
                {cancelling
                  ? <><span className="spinner-border spinner-border-sm me-2" />กำลังยกเลิก...</>
                  : <><i className="fas fa-times-circle me-1" />ยืนยันยกเลิก</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {galleryImages && (
        <ImageLightbox images={galleryImages} index={galleryIndex} onClose={() => setGalleryImages(null)} onIndexChange={setGalleryIndex} />
      )}
    </div>
  );
}
