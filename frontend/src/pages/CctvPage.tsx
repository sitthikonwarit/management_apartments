import { useCallback, useEffect, useRef, useState } from "react";
import { cctvApi, type CctvCamera } from "../api/client";
import { useBreadcrumb } from "../context/BreadcrumbContext";
import ToolbarActionsMenu from "../components/ToolbarActionsMenu";
import EmptyState from "../components/EmptyState";
import { useLiveRefreshTick } from "../utils/useLiveSync";
import { toastSuccess, toastError } from "../utils/toast";

const errMsg = (e: any) => e?.response?.data?.error ?? e?.message ?? "เกิดข้อผิดพลาด";
const TICKET_REFRESH_MS = 4 * 60 * 1000; // ตั๋วอายุ 5 นาที ขอใหม่ก่อนหมด (ใช้ตอนเชื่อมต่อใหม่เท่านั้น สตรีมที่เปิดอยู่ไม่ขาด)

// ภาพสตรีม MJPEG ผ่านพร็อกซีของเว็บ (<img>) — ขาดแล้วลองต่อใหม่เองทุก 4 วินาที
function CamView({ cam, ticket, large, onOpen }: { cam: CctvCamera; ticket: string; large?: boolean; onOpen?: () => void }) {
  const [nonce, setNonce] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const retryRef = useRef<number | null>(null);
  useEffect(() => () => { if (retryRef.current) window.clearTimeout(retryRef.current); }, []);

  return (
    <div style={{ position: "relative", background: "#000", borderRadius: 10, overflow: "hidden", aspectRatio: "16 / 9", cursor: onOpen ? "zoom-in" : undefined }} onClick={onOpen}>
      {ticket && (
        <img key={nonce} src={`/api/cctv/stream/${cam.id}?t=${encodeURIComponent(ticket)}&n=${nonce}`} alt={cam.name}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: failed ? "none" : "block" }}
          onLoad={() => { setLoaded(true); setFailed(false); }}
          onError={() => {
            setFailed(true); setLoaded(false);
            retryRef.current = window.setTimeout(() => setNonce((n) => n + 1), 4000);
          }} />
      )}
      {(failed || !loaded) && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#aaa", fontSize: "0.85rem", gap: 6 }}>
          {failed ? <><i className="fas fa-video-slash fa-lg" />เชื่อมต่อกล้องไม่ได้ กำลังลองใหม่...</> : <><span className="spinner-border spinner-border-sm" />กำลังเชื่อมต่อ...</>}
        </div>
      )}
      <div style={{ position: "absolute", left: 8, top: 8, background: "rgba(0,0,0,0.55)", color: "#fff", padding: large ? "4px 12px" : "2px 8px", borderRadius: 6, fontSize: large ? "1rem" : "0.8rem" }}>
        <i className="fas fa-circle me-1" style={{ color: loaded && !failed ? "#28c76f" : "#dc3545", fontSize: "0.5rem", verticalAlign: "middle" }} />{cam.name}
      </div>
    </div>
  );
}

function CameraModal({ cam, onClose, onSaved }: { cam: CctvCamera | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(cam?.name ?? "");
  const [url, setUrl] = useState(cam?.streamUrl ?? "");
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!name.trim()) { toastError("กรุณาระบุชื่อกล้อง"); return; }
    if (!/^https?:\/\//i.test(url.trim())) { toastError("URL สตรีมต้องขึ้นต้นด้วย http:// หรือ https://"); return; }
    setSaving(true);
    try {
      if (cam) await cctvApi.updateCamera(cam.id, { name, streamUrl: url }); else await cctvApi.createCamera({ name, streamUrl: url });
      toastSuccess(cam ? "แก้ไขกล้องแล้ว" : "เพิ่มกล้องแล้ว");
      onSaved();
    } catch (e) { toastError(errMsg(e)); } finally { setSaving(false); }
  }
  return (
    <div className="confirm-overlay" onClick={() => !saving && onClose()}>
      <div className="confirm-dialog" style={{ maxWidth: 520, width: "100%", textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
        <h6 className="mb-3"><i className="fas fa-video me-2 text-primary" />{cam ? "แก้ไขกล้อง" : "เพิ่มกล้อง"}</h6>
        <div className="mb-2">
          <label className="form-label">ชื่อกล้อง</label>
          <input className="form-control" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น CAM 5 หน้าประตู" />
        </div>
        <div className="mb-2">
          <label className="form-label">URL สตรีม (MJPEG)</label>
          <input className="form-control" value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="off" spellCheck={false}
            placeholder="http://100.x.x.x:1984/api/stream.mjpeg?src=cam5" />
          <div className="text-muted small mt-1">ที่อยู่สตรีมจากตัวกลางที่หอพัก (เช่น go2rtc) เก็บแบบเข้ารหัส และไม่ถูกส่งให้เบราว์เซอร์ — คนดูผ่านเว็บนี้เท่านั้น</div>
        </div>
        <div className="d-flex gap-2 justify-content-end mt-3">
          <button className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>ยกเลิก</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="fas fa-save me-2" />}บันทึก
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CctvPage() {
  const { setBreadcrumb } = useBreadcrumb();
  const [cams, setCams] = useState<CctvCamera[]>([]);
  const [ticket, setTicket] = useState("");
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [manage, setManage] = useState(false);
  const [editCam, setEditCam] = useState<CctvCamera | null | "new">(null);
  const [full, setFull] = useState<CctvCamera | null>(null);
  const [cols, setCols] = useState<number>(() => { try { return Number(localStorage.getItem("cctv-cols")) || 2; } catch { return 2; } });

  useEffect(() => {
    setBreadcrumb([{ label: "กล้องวงจรปิด" }]);
    return () => setBreadcrumb([]);
  }, [setBreadcrumb]);

  const tick = useLiveRefreshTick(["cctv"]);
  const load = useCallback(async () => {
    try { setCams(await cctvApi.getCameras()); } catch (e) { toastError(errMsg(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load, tick]);

  // ขอตั๋วเปิดสตรีม + ต่ออายุเป็นระยะ
  useEffect(() => {
    let alive = true;
    const get = () => cctvApi.getTicket().then((t) => { if (alive) setTicket(t.ticket); }).catch(() => {});
    get();
    const id = window.setInterval(get, TICKET_REFRESH_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  function pickCols(n: number) { setCols(n); try { localStorage.setItem("cctv-cols", String(n)); } catch {} }

  async function remove(c: CctvCamera) {
    try { await cctvApi.deleteCamera(c.id); toastSuccess("ลบกล้องแล้ว"); load(); } catch (e) { toastError(errMsg(e)); }
  }

  return (
    <div className="custom-card">
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-3 page-list-toolbar">
        <h5 className="form-section-title mb-0" style={{ borderBottom: "none" }}>กล้องวงจรปิด</h5>
        <ToolbarActionsMenu>
          <button className={`btn ${paused ? "btn-success" : "btn-outline-secondary"} d-inline-flex align-items-center`} onClick={() => setPaused((p) => !p)}>
            <i className={`fas ${paused ? "fa-play" : "fa-pause"} me-2`} /><span className="btn-text">{paused ? "เล่นต่อ" : "หยุดดู"}</span>
          </button>
          <button className="btn btn-info d-inline-flex align-items-center" onClick={() => setManage(true)}>
            <i className="fas fa-sliders me-2" /><span className="btn-text">จัดการกล้อง</span>
          </button>
          <button className="btn btn-primary d-inline-flex align-items-center" onClick={() => setEditCam("new")}>
            <i className="fas fa-plus me-2" /><span className="btn-text">เพิ่มกล้อง</span>
          </button>
        </ToolbarActionsMenu>
      </div>

      <div className="d-flex align-items-center gap-2 mb-3">
        <span className="text-muted small">จำนวนช่องต่อแถว</span>
        <div className="btn-group view-switch-group" role="group">
          {[1, 2, 3, 4].map((n) => (
            <button key={n} type="button" className={`btn btn-outline-secondary${cols === n ? " active" : ""}`} onClick={() => pickCols(n)}>{n}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center p-5"><div className="spinner-border" style={{ color: "var(--color-primary)" }} /></div>
      ) : cams.length === 0 ? (
        <EmptyState icon="fa-video" text={'ยังไม่มีกล้อง กด "เพิ่มกล้อง" แล้วใส่ URL สตรีมจากตัวกลางที่หอพัก'} />
      ) : paused ? (
        <EmptyState icon="fa-pause-circle" text='หยุดดูอยู่ — กด "เล่นต่อ" เพื่อกลับมาดูสด (หยุดดูจะปิดการเชื่อมต่อทุกกล้อง ประหยัดเน็ต)' />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${window.innerWidth < 640 ? 1 : cols}, minmax(0, 1fr))`, gap: 12 }}>
          {cams.map((c) => <CamView key={c.id} cam={c} ticket={ticket} onOpen={() => setFull(c)} />)}
        </div>
      )}

      {full && (
        <div className="lightbox-overlay" onClick={() => setFull(null)}>
          <button className="lightbox-close" onClick={() => setFull(null)}><i className="fas fa-times" /></button>
          <div style={{ width: "min(96vw, 1400px)" }} onClick={(e) => e.stopPropagation()}>
            <CamView cam={full} ticket={ticket} large />
          </div>
        </div>
      )}

      {manage && (
        <div className="confirm-overlay" onClick={() => setManage(false)}>
          <div className="confirm-dialog" style={{ maxWidth: 560, width: "100%", textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
            <h6 className="mb-3"><i className="fas fa-sliders me-2 text-primary" />จัดการกล้อง</h6>
            {cams.length === 0 ? <div className="text-muted">ยังไม่มีกล้อง</div> : cams.map((c) => (
              <div key={c.id} className="d-flex justify-content-between align-items-center py-2" style={{ borderBottom: "1px solid var(--color-light)" }}>
                <span className="fw-bold">{c.name}</span>
                <div className="btn-group">
                  <button className="btn btn-sm btn-warning" title="แก้ไข" onClick={() => { setManage(false); setEditCam(c); }}><i className="fas fa-edit" /></button>
                  <button className="btn btn-sm btn-danger" title="ลบ" onClick={() => remove(c)}><i className="fas fa-trash-alt" /></button>
                </div>
              </div>
            ))}
            <div className="d-flex justify-content-end mt-3"><button className="btn btn-outline-secondary" onClick={() => setManage(false)}>ปิด</button></div>
          </div>
        </div>
      )}

      {editCam && <CameraModal cam={editCam === "new" ? null : editCam} onClose={() => setEditCam(null)} onSaved={() => { setEditCam(null); load(); }} />}
    </div>
  );
}
