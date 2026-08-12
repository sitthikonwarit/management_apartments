// หน้า LIFF Repair — ปลายทางของปุ่ม "แจ้งซ่อม" บนเมนู Member ให้ผู้เช่ากรอกหัวข้อ/รายละเอียด/แนบรูป แล้ว
// ส่งเข้าเป็นข้อความแชทพิเศษ (messageType "repair") เด้งแจ้งเตือนในหน้าแชทของเว็บทันที พนักงานกรอกรายละเอียด
// การซ่อม (อุปกรณ์/ราคา/รูป) แล้วกดยืนยันปิดงานต่อได้จากหน้าแชทเลย (ดู components/ChatRepairCard.tsx)
import { useEffect, useState } from "react";
import liff from "@line/liff";
import { liffApi, startLiffPresenceHeartbeat } from "../api/client";
import { extractLiffId } from "../utils/liffHelpers";

type Status = "loading" | "ready" | "error" | "submitted";

const MAX_PHOTOS = 6;

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function LiffRepairPage() {
  // รหัสองค์กร (?org=<slug>) จาก Endpoint URL ของ LIFF app นี้เอง — ดูคอมเมนต์เดียวกันใน LiffLoginPage.tsx
  const org = new URLSearchParams(window.location.search).get("org") || undefined;
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [branding, setBranding] = useState({ logoUrl: "", nameText: "" });
  const [accessToken, setAccessToken] = useState("");

  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let stopPresence: (() => void) | null = null;
    (async () => {
      try {
        const cfg = await liffApi.getConfig(org);
        if (cancelled) return;
        setBranding({ logoUrl: cfg.appIdentity.logoUrl, nameText: cfg.appIdentity.nameText });

        const liffId = extractLiffId(cfg.liffRepairUrl);
        if (!liffId) { setErrorMsg("ระบบยังไม่ได้ตั้งค่า LIFF Repair URL กรุณาติดต่อผู้ดูแลระบบ"); setStatus("error"); return; }

        await liff.init({ liffId });
        if (!liff.isLoggedIn()) { liff.login(); return; }

        const token = liff.getAccessToken();
        if (!token) { setErrorMsg("ไม่พบ Access Token จาก LINE กรุณาลองใหม่อีกครั้ง"); setStatus("error"); return; }
        setAccessToken(token);
        if (!cancelled) stopPresence = startLiffPresenceHeartbeat(token, "repair", org);
        setStatus("ready");
      } catch (e: any) {
        if (cancelled) return;
        setErrorMsg(e?.response?.data?.error ?? e?.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
        setStatus("error");
      }
    })();
    return () => { cancelled = true; stopPresence?.(); };
  }, []);

  async function handleAddPhotos(files: FileList) {
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) return;
    const picked = Array.from(files).slice(0, remaining);
    const base64s = await Promise.all(picked.map(readFileAsBase64));
    setPhotos((prev) => [...prev, ...base64s]);
  }

  function removePhoto(idx: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setFormError("กรุณากรอกหัวข้อที่ต้องการแจ้งซ่อม"); return; }
    setSubmitting(true); setFormError("");
    try {
      await liffApi.submitRepair(accessToken, title.trim(), details.trim(), photos, org);
      setStatus("submitted");
    } catch (e: any) {
      setFormError(e?.response?.data?.error ?? e?.message ?? "ส่งแจ้งซ่อมไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
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
            : <div className="login-icon"><i className="fas fa-tools" /></div>}
          <h5 className="mt-3 mb-1" style={{ fontWeight: 700 }}>{branding.nameText || "แจ้งซ่อม"}</h5>

          {status === "loading" && (
            <div className="py-4">
              <div className="spinner-border" style={{ color: "var(--color-primary)" }} />
              <p className="text-muted small mt-3 mb-0">กำลังโหลดข้อมูล...</p>
            </div>
          )}
          {status === "error" && (
            <div className="room-modal-error mt-3"><i className="fas fa-exclamation-circle me-2" />{errorMsg}</div>
          )}
          {status === "submitted" && (
            <div className="py-3">
              <div className="login-icon mb-3" style={{ background: "rgba(27,156,133,0.15)", color: "var(--color-success)" }}>
                <i className="fas fa-check-circle" />
              </div>
              <div className="alert alert-success py-2 px-3 small mb-0">ส่งแจ้งซ่อมเรียบร้อยแล้ว พนักงานได้รับแจ้งแล้ว จะติดต่อกลับทางแชทนี้</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="login-page-wrap">
      <div className="login-card custom-card" style={{ maxWidth: 420, textAlign: "left" }}>
        <div className="text-center mb-3">
          {branding.logoUrl
            ? <img src={branding.logoUrl} alt="" style={{ width: 56, height: 56, objectFit: "contain", borderRadius: "50%", margin: "0 auto", display: "block" }} />
            : <div className="login-icon"><i className="fas fa-tools" /></div>}
          <h5 className="mt-3 mb-1" style={{ fontWeight: 700 }}>แจ้งซ่อม</h5>
          <p className="text-muted small mb-0">กรอกรายละเอียดสิ่งที่ต้องการแจ้งซ่อม พนักงานจะติดต่อกลับทางแชทนี้</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label className="form-label small fw-bold">หัวข้อ</label>
            <input className="form-control" placeholder="เช่น แอร์ไม่เย็น, ก๊อกน้ำรั่ว" autoFocus
              value={title} onChange={(e) => setTitle(e.target.value)} disabled={submitting} />
          </div>
          <div className="mb-3">
            <label className="form-label small fw-bold">รายละเอียด</label>
            <textarea className="form-control" rows={4} placeholder="อธิบายอาการ/ตำแหน่งที่ชำรุด"
              value={details} onChange={(e) => setDetails(e.target.value)} disabled={submitting} />
          </div>
          <div className="mb-3">
            <label className="form-label small fw-bold">รูปภาพ <span className="text-muted fw-normal">(ไม่บังคับ สูงสุด {MAX_PHOTOS} รูป)</span></label>
            <div className="d-flex flex-wrap gap-2 mb-2">
              {photos.map((p, i) => (
                <div key={i} style={{ position: "relative", width: 64, height: 64 }}>
                  <img src={p} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "1px solid var(--color-light)" }} />
                  <button type="button" onClick={() => removePhoto(i)}
                    style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", border: "none", background: "var(--color-danger)", color: "#fff", fontSize: 11, lineHeight: 1 }}>
                    <i className="fas fa-times" />
                  </button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <label style={{ width: 64, height: 64, border: "1px dashed var(--color-light)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <i className="fas fa-plus text-muted" />
                  <input type="file" accept="image/*" multiple hidden disabled={submitting}
                    onChange={(e) => { if (e.target.files?.length) handleAddPhotos(e.target.files); e.target.value = ""; }} />
                </label>
              )}
            </div>
          </div>

          {formError && <div className="room-modal-error mb-3"><i className="fas fa-exclamation-circle me-2" />{formError}</div>}

          <button type="submit" className="btn btn-primary w-100" disabled={submitting}>
            {submitting
              ? <><span className="spinner-border spinner-border-sm me-2" />กำลังส่ง...</>
              : <><i className="fas fa-paper-plane me-2" />ส่งแจ้งซ่อม</>}
          </button>
        </form>
      </div>
    </div>
  );
}
