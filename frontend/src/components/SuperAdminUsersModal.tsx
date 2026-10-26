import { useEffect, useMemo, useState } from "react";
import { superAdminApi, type SuperAdminUser } from "../api/client";
import { toastError } from "../utils/toast";
import { thaiDateTimeString } from "../utils/yearFormat";

function ago(iso: string) {
  if (!iso) return "ยังไม่เคยเข้าสู่ระบบ";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} นาทีที่แล้ว`;
  if (s < 86400) return `${Math.floor(s / 3600)} ชั่วโมงที่แล้ว`;
  return `${Math.floor(s / 86400)} วันที่แล้ว`;
}

// รายชื่อผู้ใช้ทั้งหมดทุกองค์กร + วันที่เข้าสู่ระบบล่าสุดของแต่ละคน + รีเซ็ตรหัสผ่านเป็นรหัสชั่วคราวรายบุคคล (คัดลอกให้เจ้าตัวได้)
// เจ้าตัวล็อกอินด้วยรหัสชั่วคราวแล้วระบบบังคับให้ตั้งรหัสผ่านใหม่ (กรอก 2 รอบ) ก่อนใช้งาน
export default function SuperAdminUsersModal({ onClose, onUnauthorized }: { onClose: () => void; onUnauthorized: () => void }) {
  const [users, setUsers] = useState<SuperAdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<SuperAdminUser | null>(null);
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState<{ user: SuperAdminUser; username: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    try { setUsers(await superAdminApi.getUsers()); }
    catch (e: any) {
      if (e?.response?.status === 401) { onUnauthorized(); return; }
      toastError(e?.response?.data?.error ?? "โหลดรายชื่อผู้ใช้ไม่สำเร็จ");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const q = search.trim().toLowerCase();
  const shown = useMemo(
    () => users.filter((u) => !q || [u.username, u.displayName, u.orgName, u.phone].some((v) => (v ?? "").toLowerCase().includes(q)))
      .sort((a, b) => (b.lastLoginAt || "").localeCompare(a.lastLoginAt || "")),
    [users, q]
  );

  async function doReset() {
    if (!target) return;
    setResetting(true);
    try {
      const r = await superAdminApi.resetUserPassword(target.id);
      setResult({ user: target, ...r });
      setTarget(null); setCopied(false);
      load();
    } catch (e: any) {
      toastError(e?.response?.data?.error ?? "รีเซ็ตรหัสผ่านไม่สำเร็จ");
    } finally { setResetting(false); }
  }
  async function copy() {
    if (!result) return;
    try { await navigator.clipboard.writeText(`Username: ${result.username}\nรหัสผ่านชั่วคราว: ${result.password}`); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { toastError("คัดลอกไม่สำเร็จ — กรุณาเลือกข้อความแล้วคัดลอกเอง"); }
  }

  return (
    <div className="confirm-overlay" style={{ alignItems: "flex-start", overflow: "auto" }} onClick={onClose}>
      <div className="confirm-dialog" style={{ maxWidth: 1100, width: "100%", textAlign: "left", margin: "3vh auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <h5 className="mb-0"><i className="fas fa-users me-2 text-primary" />ผู้ใช้ทั้งหมด <span className="text-muted fs-6">({users.length})</span></h5>
          <div className="d-flex gap-2">
            <input className="form-control" style={{ width: 240 }} placeholder="ค้นหาชื่อ / องค์กร / เบอร์..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <button className="btn btn-outline-secondary" onClick={onClose}><i className="fas fa-times" /></button>
          </div>
        </div>

        {loading ? (
          <div className="text-center p-4"><div className="spinner-border" /></div>
        ) : (
          <div className="nicescrollbar" style={{ overflow: "auto", maxHeight: "68vh" }}>
            <table className="table-mainstyle table-hover" style={{ width: "100%", minWidth: 900 }}>
              <thead>
                <tr><th>ผู้ใช้</th><th>องค์กร</th><th>บทบาท</th><th>เบอร์</th><th>LINE</th><th>เข้าสู่ระบบล่าสุด</th><th /></tr>
              </thead>
              <tbody>
                {shown.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <span className="fw-bold">{u.username || <em className="text-muted">ไม่มีชื่อผู้ใช้</em>}</span>
                      {u.displayName && <div className="text-muted small">{u.displayName}</div>}
                      {u.mustChangePassword && <span className="badge bg-warning text-dark mt-1">รอตั้งรหัสใหม่</span>}
                    </td>
                    <td>{u.orgName}{u.orgStatus === "suspended" && <span className="badge bg-secondary ms-1">ระงับ</span>}</td>
                    <td>{u.role === "owner" ? "เจ้าของ" : "พนักงาน"}</td>
                    <td>{u.phone || "-"}</td>
                    <td>{u.lineLinked ? <i className="fas fa-check text-success" /> : <span className="text-muted">-</span>}</td>
                    <td>
                      {u.lastLoginAt ? <>{thaiDateTimeString(new Date(u.lastLoginAt))}<div className="text-muted small">{ago(u.lastLoginAt)}</div></> : <span className="text-muted">ยังไม่เคย</span>}
                    </td>
                    <td>
                      <button className="btn btn-sm btn-outline-primary" disabled={!u.username} title={u.username ? "" : "บัญชีนี้ยังไม่มีชื่อผู้ใช้ รีเซ็ตรหัสผ่านไม่ได้"} onClick={() => setTarget(u)}>
                        <i className="fas fa-key me-1" />รหัสชั่วคราว
                      </button>
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={7} className="text-center text-muted p-4">ไม่พบผู้ใช้</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {target && (
        <div className="confirm-overlay" style={{ zIndex: 1500 }} onClick={() => !resetting && setTarget(null)}>
          <div className="confirm-dialog" style={{ maxWidth: 440, textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
            <h6 className="confirm-title"><i className="fas fa-key me-2" />ตั้งรหัสชั่วคราวให้ "{target.username}"?</h6>
            <p className="text-muted small mb-0">
              ระบบจะสุ่มรหัสผ่านชั่วคราวให้ รหัสเดิมใช้ไม่ได้ทันที และเครื่องที่ล็อกอินค้างอยู่จะถูกเตะออก เจ้าตัวต้องล็อกอินด้วยรหัสชั่วคราวนี้ แล้วระบบจะบังคับให้ตั้งรหัสผ่านใหม่ (กรอก 2 รอบ)
              จะแสดงรหัสให้ดูครั้งเดียว กรุณาคัดลอกส่งให้เจ้าตัว
            </p>
            <div className="confirm-actions">
              <button className="btn btn-outline-secondary" onClick={() => setTarget(null)} disabled={resetting}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={doReset} disabled={resetting}>
                {resetting ? <><span className="spinner-border spinner-border-sm me-2" />กำลังตั้ง...</> : <><i className="fas fa-key me-1" />ยืนยัน</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {result && (
        <div className="confirm-overlay" style={{ zIndex: 1500 }} onClick={() => setResult(null)}>
          <div className="confirm-dialog" style={{ maxWidth: 440, textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
            <h6 className="confirm-title text-success"><i className="fas fa-check-circle me-2" />ตั้งรหัสชั่วคราวสำเร็จ</h6>
            <p className="text-muted small mb-2">คัดลอกให้ {result.user.displayName || result.user.username} ตอนนี้เลย — ปิดหน้าต่างแล้วดูรหัสนี้ซ้ำไม่ได้</p>
            <div className="p-3 rounded-3 mb-3" style={{ background: "var(--color-background)", border: "1px solid var(--color-light)" }}>
              <div className="d-flex justify-content-between small mb-1"><span className="text-muted">Username</span><code>{result.username}</code></div>
              <div className="d-flex justify-content-between small"><span className="text-muted">รหัสผ่านชั่วคราว</span><code>{result.password}</code></div>
            </div>
            <div className="confirm-actions">
              <button className="btn btn-outline-secondary" onClick={() => setResult(null)}>ปิด</button>
              <button className="btn btn-primary" onClick={copy}>
                {copied ? <><i className="fas fa-check me-1" />คัดลอกแล้ว</> : <><i className="fas fa-copy me-1" />คัดลอก</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
