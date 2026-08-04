// หน้า LIFF ดูห้องว่าง — ปลายทางของปุ่ม "ดูห้องว่าง" บนเมนู Guest (คนละ LIFF App กับหน้า "จองห้อง" จริงๆ ดู
// liffRoomsUrl ใน backend/src/services/richMenu.ts) แสดงรายการห้องว่างสาธารณะ (ไม่ต้องเป็นผู้เช่ามาก่อน)
// มีช่องค้นหา กดการ์ดห้องเพื่อดูรายละเอียดเต็ม+รูปทั้งหมด แล้วมีปุ่ม "จองห้องนี้" เป็นทางลัดข้ามไปหน้า
// "จองห้อง" (LiffBookingPage.tsx — คนละ LIFF App) พร้อมระบุห้องที่เลือกไว้ผ่าน query "?roomId="
import { useEffect, useMemo, useState } from "react";
import liff from "@line/liff";
import { liffApi } from "../api/client";
import { extractLiffId } from "../utils/liffHelpers";
import ImageLightbox from "../components/ImageLightbox";

type Status = "loading" | "ready" | "error";

interface AvailableRoom {
  id: string; number: string; floor: string; towerName: string; towerColor: string;
  price: number; dailyPrice: number; detail: string; pictures: { url: string; name?: string }[];
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n) || 0);
}

export default function LiffRoomsPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [branding, setBranding] = useState({ logoUrl: "", nameText: "" });
  const [bookingUrl, setBookingUrl] = useState("");
  const [rooms, setRooms] = useState<AvailableRoom[]>([]);
  const [search, setSearch] = useState("");

  const [detailRoom, setDetailRoom] = useState<AvailableRoom | null>(null);
  const [galleryImages, setGalleryImages] = useState<string[] | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await liffApi.getConfig();
        if (cancelled) return;
        setBranding({ logoUrl: cfg.appIdentity.logoUrl, nameText: cfg.appIdentity.nameText });
        setBookingUrl(cfg.liffBookingUrl);

        const liffId = extractLiffId(cfg.liffRoomsUrl);
        if (!liffId) { setErrorMsg("ระบบยังไม่ได้ตั้งค่า LIFF Rooms URL กรุณาติดต่อผู้ดูแลระบบ"); setStatus("error"); return; }

        await liff.init({ liffId });
        if (!liff.isLoggedIn()) { liff.login(); return; }

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

  const filteredRooms = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter((r) =>
      r.number.toLowerCase().includes(q) ||
      r.towerName.toLowerCase().includes(q) ||
      r.floor.toLowerCase().includes(q) ||
      r.detail.toLowerCase().includes(q)
    );
  }, [rooms, search]);

  function goBook(room: AvailableRoom) {
    if (!bookingUrl) return;
    window.location.href = `${bookingUrl}${bookingUrl.includes("?") ? "&" : "?"}roomId=${encodeURIComponent(room.id)}`;
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

  // ─── มุมมองรายละเอียดห้อง (กดจากการ์ด) ───────────────────────────────────
  if (detailRoom) {
    const pics = detailRoom.pictures;
    return (
      <div className="login-page-wrap">
        <div className="login-card custom-card" style={{ maxWidth: 440, textAlign: "left" }}>
          <button type="button" className="btn btn-link btn-sm p-0 mb-2" onClick={() => setDetailRoom(null)}>
            <i className="fas fa-arrow-left me-1" />กลับไปรายการห้อง
          </button>

          {pics.length > 0 ? (
            <div
              className="rounded overflow-hidden mb-3"
              style={{ position: "relative", cursor: "pointer" }}
              onClick={() => { setGalleryImages(pics.map((p) => p.url)); setGalleryIndex(0); }}
            >
              <img src={pics[0].url} alt="" style={{ width: "100%", height: 220, objectFit: "cover", display: "block" }} />
              {pics.length > 1 && (
                <span style={{ position: "absolute", bottom: 8, right: 8, background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 11, padding: "2px 8px", borderRadius: 12 }}>
                  <i className="fas fa-images me-1" />{pics.length} รูป
                </span>
              )}
            </div>
          ) : (
            <div className="rounded mb-3" style={{ width: "100%", height: 180, background: "var(--color-background)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <i className="fas fa-door-open text-muted" style={{ fontSize: 28 }} />
            </div>
          )}

          <div className="d-flex justify-content-between align-items-start mb-1">
            <span className="fw-bold fs-5">ห้อง {detailRoom.number}</span>
            <span className="fw-bold" style={{ color: "var(--color-primary)" }}>{fmtMoney(detailRoom.price)} ฿/เดือน</span>
          </div>
          <div className="text-muted small mb-2">
            {detailRoom.towerName && (
              <span className="me-2">
                <span className="tower-tag" style={{ backgroundColor: detailRoom.towerColor || "var(--color-primary)" }}>{detailRoom.towerName}</span>
              </span>
            )}
            {detailRoom.floor && <span className="me-2"><i className="fas fa-layer-group me-1" />ชั้น {detailRoom.floor}</span>}
            {detailRoom.dailyPrice > 0 && <span><i className="fas fa-calendar-day me-1" />{fmtMoney(detailRoom.dailyPrice)} ฿/วัน</span>}
          </div>
          {detailRoom.detail && <div className="small mb-3" style={{ whiteSpace: "pre-wrap" }}>{detailRoom.detail}</div>}

          <button className="btn btn-primary w-100" onClick={() => goBook(detailRoom)} disabled={!bookingUrl}>
            <i className="fas fa-calendar-check me-1" />จองห้องนี้
          </button>
          {!bookingUrl && (
            <div className="text-muted small mt-2 text-center">ระบบยังไม่ได้ตั้งค่าหน้าจองห้อง กรุณาติดต่อผู้ดูแลระบบ</div>
          )}
        </div>

        {galleryImages && (
          <ImageLightbox images={galleryImages} index={galleryIndex} onClose={() => setGalleryImages(null)} onIndexChange={setGalleryIndex} />
        )}
      </div>
    );
  }

  // ─── รายการห้องว่าง + ช่องค้นหา ───────────────────────────────────────────
  return (
    <div className="login-page-wrap">
      <div className="login-card custom-card" style={{ maxWidth: 440 }}>
        <div className="text-center mb-3">
          {branding.logoUrl
            ? <img src={branding.logoUrl} alt="" style={{ width: 56, height: 56, objectFit: "contain", borderRadius: "50%", margin: "0 auto", display: "block" }} />
            : <div className="login-icon"><i className="fas fa-door-open" /></div>}
          <h5 className="mt-3 mb-1" style={{ fontWeight: 700 }}>ห้องว่าง</h5>
          <p className="text-muted small mb-0">เลือกห้องที่สนใจ กดดูรายละเอียดแล้วจองได้เลย</p>
        </div>

        <div className="mb-3">
          <div className="position-relative">
            <i className="fas fa-search" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--color-dark-variant)" }} />
            <input
              type="text"
              className="form-control"
              style={{ paddingLeft: 34 }}
              placeholder="ค้นหาเลขห้อง, ตึก, ชั้น..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {rooms.length === 0 ? (
          <div className="alert alert-light border text-center small mb-0">
            <i className="fas fa-circle-info me-2" />ขณะนี้ยังไม่มีห้องว่าง
          </div>
        ) : filteredRooms.length === 0 ? (
          <div className="alert alert-light border text-center small mb-0">
            <i className="fas fa-circle-info me-2" />ไม่พบห้องที่ตรงกับคำค้นหา
          </div>
        ) : (
          <div className="d-flex flex-column gap-3">
            {filteredRooms.map((room) => (
              <div key={room.id} className="rounded overflow-hidden" style={{ border: "1px solid var(--color-light)", textAlign: "left", cursor: "pointer" }}
                onClick={() => setDetailRoom(room)}>
                {room.pictures.length > 0 ? (
                  <div style={{ position: "relative" }}>
                    <img src={room.pictures[0].url} alt="" style={{ width: "100%", height: 160, objectFit: "cover", display: "block" }} />
                    {room.pictures.length > 1 && (
                      <span style={{ position: "absolute", bottom: 8, right: 8, background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 11, padding: "2px 8px", borderRadius: 12 }}>
                        <i className="fas fa-images me-1" />{room.pictures.length} รูป
                      </span>
                    )}
                    {room.towerColor && (
                      <span style={{ position: "absolute", top: 8, left: 8, background: room.towerColor, color: "#fff", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 12 }}>
                        {room.towerName}
                      </span>
                    )}
                  </div>
                ) : (
                  <div style={{ width: "100%", height: 120, background: "var(--color-background)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <i className="fas fa-door-open text-muted" style={{ fontSize: 28 }} />
                  </div>
                )}
                <div className="p-3">
                  <div className="d-flex justify-content-between align-items-start mb-1">
                    <span className="fw-bold fs-6">ห้อง {room.number}</span>
                    <span className="fw-bold" style={{ color: "var(--color-primary)" }}>{fmtMoney(room.price)} ฿/เดือน</span>
                  </div>
                  <div className="text-muted small">
                    {room.floor && <span><i className="fas fa-layer-group me-1" />ชั้น {room.floor}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
