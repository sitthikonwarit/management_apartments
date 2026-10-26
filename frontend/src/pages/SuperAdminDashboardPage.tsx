// หน้าควบคุมแพลตฟอร์ม — ดูรายชื่อองค์กรลูกค้าทั้งหมด + ระงับ/เปิดใช้งาน + ลบองค์กรถาวร คนเดียว (คุณ)
// เท่านั้นที่เข้าได้ (ดู SuperAdminLoginPage.tsx, backend/src/routes/superadmin.ts) — ครอบด้วย
// SuperAdminShell (Sidebar/Header เหมือนหน้าแอดมินปกติเป๊ะๆ ใน App.tsx) ตัวหน้านี้เองแค่เรนเดอร์เนื้อหา
// (stat tile + ตาราง) เหมือนหน้าแอดมินอื่นๆ ทั่วไปที่วางอยู่ใน #content-wrapper เฉยๆ ไม่ต้องมี wrapper/สีพิเศษ
// ของตัวเองอีกต่อไป ใช้ตัวแปร CSS/คลาสเดียวกับหน้าแอดมินปกติทั้งหมด (custom-card, detail-section-header,
// bill-stat-tile, table-mainstyle, status-badge ฯลฯ)
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { superAdminApi, type SuperAdminOrg, type SuperAdminRequestRate, type SuperAdminSystemHealth } from "../api/client";
import { toastSuccess, toastError } from "../utils/toast";
import { thaiDateOnlyString } from "../utils/yearFormat";
import SuperAdminUsersModal from "../components/SuperAdminUsersModal";

const API_USAGE_POLL_MS = 5000;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let val = bytes;
  let i = -1;
  do { val /= 1024; i++; } while (val >= 1024 && i < units.length - 1);
  return `${val.toFixed(val < 10 ? 2 : 1)} ${units[i]}`;
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} วัน ${h} ชม.`;
  if (h > 0) return `${h} ชม. ${m} นาที`;
  return `${m} นาที`;
}

// สีเกจ CPU/RAM — เขียวปกติ, เหลืองเริ่มตึงมือ, แดงใกล้เต็ม (เกณฑ์คร่าวๆ พอให้กวาดตาเห็นความผิดปกติได้ไว)
function gaugeColor(pct: number): string {
  if (pct >= 85) return "var(--color-danger)";
  if (pct >= 60) return "#f7d060";
  return "var(--color-success)";
}

// สีอัตรา error ของ API — เกณฑ์ต่างจาก CPU/RAM มาก (error แม้แค่ 1-2% ก็ควรสะดุดตาแล้ว ไม่ใช่รอถึง 60%)
function errorRateColor(ratePercent: number): string {
  if (ratePercent >= 5) return "var(--color-danger)";
  if (ratePercent > 0) return "#f7d060";
  return "var(--color-success)";
}

// ── ช่องแก้ไขแบบ inline ในตาราง (รหัส/slug, เบอร์โทร) — โชว์ค่า + ไอคอนดินสอ กดแล้วเปลี่ยนเป็นช่องกรอก
// พร้อมปุ่มยืนยัน/ยกเลิก บันทึกจริงผ่าน onSave (โยน error กลับมาก็ยังอยู่ในโหมดแก้ไขให้แก้ต่อได้)
function EditableField({ value, placeholder, width = 130, onSave }: {
  value: string; placeholder?: string; width?: number; onSave: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  function cancel() { setEditing(false); setDraft(value); }

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value) { cancel(); return; }
    setSaving(true);
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch (e: any) {
      toastError(e?.response?.data?.error ?? "บันทึกไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <span className="d-inline-flex align-items-center gap-1">
        <span>{value || <span className="text-muted">-</span>}</span>
        <button type="button" className="btn btn-sm btn-link p-0 text-muted" title="แก้ไข" onClick={() => setEditing(true)}>
          <i className="fas fa-pen" style={{ fontSize: 11 }} />
        </button>
      </span>
    );
  }

  return (
    <span className="d-inline-flex align-items-center gap-1">
      <input className="form-control form-control-sm" style={{ width }} value={draft} placeholder={placeholder}
        autoFocus disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }} />
      <button type="button" className="btn btn-sm btn-success py-0 px-1" disabled={saving} onClick={save} title="บันทึก">
        {saving ? <span className="spinner-border spinner-border-sm" style={{ width: 10, height: 10 }} /> : <i className="fas fa-check" style={{ fontSize: 11 }} />}
      </button>
      <button type="button" className="btn btn-sm btn-outline-secondary py-0 px-1" disabled={saving} onClick={cancel} title="ยกเลิก">
        <i className="fas fa-times" style={{ fontSize: 11 }} />
      </button>
    </span>
  );
}

export default function SuperAdminDashboardPage() {
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState<SuperAdminOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [unattributedBytes, setUnattributedBytes] = useState(0);
  const [globalUsage, setGlobalUsage] = useState<SuperAdminRequestRate>({ last1m: 0, last5m: 0 });
  const [systemHealth, setSystemHealth] = useState<SuperAdminSystemHealth | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<SuperAdminOrg | null>(null);
  const [confirmInput, setConfirmInput] = useState("");
  const [deleting, setDeleting] = useState(false);

  const [resetTarget, setResetTarget] = useState<SuperAdminOrg | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<{ username: string; password: string } | null>(null);
  const [resetCopied, setResetCopied] = useState(false);

  const [showUsers, setShowUsers] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const data = await superAdminApi.getOrganizations();
      setOrgs(data);
    } catch (e: any) {
      if (e?.response?.status === 401) {
        navigate("/superadmin/login", { replace: true });
        return;
      }
      toastError(e?.response?.data?.error ?? "โหลดรายชื่อองค์กรไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    superAdminApi.getStorageSummary().then((r) => setUnattributedBytes(r.unattributedBytes)).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // อัตราเรียก API + สถานะความเสถียรของระบบ "แบบเรียลไทม์" — poll endpoint เบาๆ (ไม่แตะ DB ฝั่ง backend
  // เลยยกเว้น system-health ที่ ping DB นิดเดียว ดู lib/apiUsageTracker.ts, lib/serverHealth.ts) ทุก 5
  // วินาที แล้วผสานตัวเลขล่าสุดเข้ากับ orgs ที่มีอยู่แล้ว ไม่โหลดรายการทั้งก้อนซ้ำ (getOrganizations หนักกว่า
  // มากเพราะต้องคำนวณพื้นที่ใช้งานทุกองค์กรทุกครั้ง) เรียกทันทีตอน mount ด้วย (ไม่ต้องรอ 5 วิแรกค้างเปล่า)
  useEffect(() => {
    async function poll() {
      try {
        const [usage, health] = await Promise.all([superAdminApi.getApiUsage(), superAdminApi.getSystemHealth()]);
        setGlobalUsage(usage.global);
        const onlineSet = new Set(usage.onlineOrgIds);
        setOrgs((prev) => prev.map((o) => ({ ...o, apiUsage: usage.perOrg[o.id] ?? o.apiUsage, online: onlineSet.has(o.id) })));
        setSystemHealth(health);
      } catch {
        // โพลพลาดรอบนี้ไม่เป็นไร รอบถัดไปลองใหม่ (ไม่ต้องแจ้งเตือนผู้ใช้ทุกครั้งที่พลาด)
      }
    }
    poll();
    const timer = setInterval(poll, API_USAGE_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  // สรุปยอดรวมทั้งแพลตฟอร์ม — เอาไว้โชว์เป็น stat tile ด้านบน (แพทเทิร์นเดียวกับ .bill-stat-tile ใน
  // BillsPage.tsx) คำนวณใหม่ทุกครั้งที่ orgs เปลี่ยน ไม่ต้องยิง request แยก
  const stats = useMemo(() => {
    const activeCount = orgs.filter((o) => o.status !== "suspended").length;
    const suspendedCount = orgs.length - activeCount;
    const totalRooms = orgs.reduce((sum, o) => sum + o.counts.rooms, 0);
    const totalStorageBytes = orgs.reduce((sum, o) => sum + o.storage.totalBytes, 0) + unattributedBytes;
    return { total: orgs.length, active: activeCount, suspended: suspendedCount, totalRooms, totalStorageBytes };
  }, [orgs, unattributedBytes]);

  async function toggleStatus(org: SuperAdminOrg) {
    const next = org.status === "suspended" ? "active" : "suspended";
    setBusyId(org.id);
    try {
      await superAdminApi.updateOrgStatus(org.id, next);
      setOrgs((prev) => prev.map((o) => (o.id === org.id ? { ...o, status: next } : o)));
      toastSuccess(next === "suspended" ? `ระงับองค์กร "${org.name}" แล้ว` : `เปิดใช้งานองค์กร "${org.name}" แล้ว`);
    } catch (e: any) {
      toastError(e?.response?.data?.error ?? "ทำรายการไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  // แก้ "รหัส (slug)" / "เบอร์โทรเจ้าของ" / "ชื่อเจ้าของ" แบบ inline ในตาราง (ดู EditableField ด้านบน) — โยน
  // error กลับไปให้ EditableField แสดงต่อ (เช่น slug/เบอร์นี้ถูกใช้ไปแล้ว) ถ้าสำเร็จค่อยอัปเดต state ตาราง
  // ไม่ต้องโหลดทั้งหน้าใหม่
  async function handleUpdateOrgField(org: SuperAdminOrg, field: "slug" | "phone" | "displayName", value: string) {
    const result = await superAdminApi.updateOrgDetails(org.id, { [field]: value });
    setOrgs((prev) => prev.map((o) => {
      if (o.id !== org.id) return o;
      if (field === "slug") return { ...o, slug: result.slug ?? value };
      if (field === "phone") return { ...o, owner: { ...o.owner, phone: result.phone ?? value } };
      return { ...o, owner: { ...o.owner, displayName: result.displayName ?? value } };
    }));
    const labels = { slug: "รหัส (slug)", phone: "เบอร์โทร", displayName: "ชื่อเจ้าของ" };
    toastSuccess(`แก้ไข${labels[field]}สำเร็จ`);
  }

  function openDeleteModal(org: SuperAdminOrg) {
    setDeleteTarget(org);
    setConfirmInput("");
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await superAdminApi.deleteOrg(deleteTarget.id, confirmInput);
      setOrgs((prev) => prev.filter((o) => o.id !== deleteTarget.id));
      toastSuccess(`ลบองค์กร "${deleteTarget.name}" เรียบร้อยแล้ว`);
      setDeleteTarget(null);
    } catch (e: any) {
      toastError(e?.response?.data?.error ?? "ลบองค์กรไม่สำเร็จ");
    } finally {
      setDeleting(false);
    }
  }

  function openResetModal(org: SuperAdminOrg) {
    setResetTarget(org);
  }

  async function handleResetPassword() {
    if (!resetTarget) return;
    setResetting(true);
    try {
      const result = await superAdminApi.resetOwnerPassword(resetTarget.id);
      setOrgs((prev) => prev.map((o) => (o.id === resetTarget.id ? { ...o, owner: { ...o.owner, username: result.username } } : o)));
      setResetResult(result);
      setResetCopied(false);
      setResetTarget(null);
    } catch (e: any) {
      toastError(e?.response?.data?.error ?? "รีเซ็ตรหัสผ่านไม่สำเร็จ");
    } finally {
      setResetting(false);
    }
  }

  function copyResetResult() {
    if (!resetResult) return;
    navigator.clipboard.writeText(`Username: ${resetResult.username}\nPassword: ${resetResult.password}`)
      .then(() => setResetCopied(true))
      .catch(() => toastError("คัดลอกไม่สำเร็จ"));
  }

  function openAddModal() {
    setNewOrgName(""); setNewPhone(""); setNewDisplayName(""); setCreateError("");
    setShowAddModal(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError("");
    if (!newOrgName.trim()) { setCreateError("กรุณากรอกชื่อองค์กร"); return; }
    if (newPhone.replace(/\D/g, "").length < 9) { setCreateError("กรุณากรอกเบอร์โทรของเจ้าของบัญชีให้ครบ"); return; }
    setCreating(true);
    try {
      const result = await superAdminApi.createOrganization({
        name: newOrgName.trim(), phone: newPhone.trim(), displayName: newDisplayName.trim(),
      });
      setOrgs((prev) => [
        {
          id: result.id, name: result.name, slug: result.slug, status: result.status, createdAt: new Date().toISOString(),
          counts: { rooms: 0, tenants: 0, users: 1 },
          storage: { dbBytes: 0, uploadBytes: 0, totalBytes: 0 },
          owner: { username: null, phone: result.ownerPhone, displayName: newDisplayName.trim() || null, lineLinked: false },
          apiUsage: { last1m: 0, last5m: 0 },
          online: false,
        },
        ...prev,
      ]);
      toastSuccess(`สร้างองค์กร "${result.name}" แล้ว — ให้ลูกค้ากรอกเบอร์ ${result.ownerPhone} ที่หน้า Login เพื่อเชื่อมบัญชี LINE เอง`);
      setShowAddModal(false);
    } catch (e: any) {
      setCreateError(e?.response?.data?.error ?? "สร้างองค์กรไม่สำเร็จ");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      {/* ── สรุปยอดรวม ── */}
      <div className="row g-2 mb-3">
        <div className="col-6 col-md-4">
          <div className="bill-stat-tile bill-stat-tile-icon">
            <div className="bill-stat-icon" style={{ background: "rgba(108,155,207,0.14)", color: "var(--color-primary)" }}><i className="fas fa-building" /></div>
            <div className="bill-stat-body"><div className="val text-primary">{stats.total}</div><div className="lbl">องค์กรทั้งหมด</div></div>
          </div>
        </div>
        <div className="col-6 col-md-4">
          <div className="bill-stat-tile bill-stat-tile-icon">
            <div className="bill-stat-icon" style={{ background: "rgba(27,156,133,0.14)", color: "var(--color-success)" }}><i className="fas fa-check-circle" /></div>
            <div className="bill-stat-body"><div className="val text-success">{stats.active}</div><div className="lbl">ใช้งานอยู่</div></div>
          </div>
        </div>
        <div className="col-6 col-md-4">
          <div className="bill-stat-tile bill-stat-tile-icon">
            <div className="bill-stat-icon" style={{ background: "rgba(247,208,96,0.2)", color: "#B18D2A" }}><i className="fas fa-pause-circle" /></div>
            <div className="bill-stat-body"><div className="val" style={{ color: "#B18D2A" }}>{stats.suspended}</div><div className="lbl">ระงับใช้งาน</div></div>
          </div>
        </div>
        <div className="col-6 col-md-4">
          <div className="bill-stat-tile bill-stat-tile-icon">
            <div className="bill-stat-icon" style={{ background: "rgba(253,126,20,0.14)", color: "#fd7e14" }}><i className="fas fa-door-open" /></div>
            <div className="bill-stat-body"><div className="val" style={{ color: "#fd7e14" }}>{stats.totalRooms}</div><div className="lbl">ห้องรวมทั้งแพลตฟอร์ม</div></div>
          </div>
        </div>
        <div className="col-6 col-md-4">
          <div className="bill-stat-tile bill-stat-tile-icon">
            <div className="bill-stat-icon" style={{ background: "rgba(111,66,193,0.14)", color: "var(--color-import)" }}><i className="fas fa-database" /></div>
            <div className="bill-stat-body"><div className="val" style={{ color: "var(--color-import)" }}>{formatBytes(stats.totalStorageBytes)}</div><div className="lbl">พื้นที่ใช้ไปทั้งหมด</div></div>
          </div>
        </div>
        <div className="col-6 col-md-4">
          <div className="bill-stat-tile bill-stat-tile-icon">
            <div className="bill-stat-icon" style={{ background: "rgba(13,202,240,0.14)", color: "#0dcaf0" }}><i className="fas fa-bolt" /></div>
            <div className="bill-stat-body">
              <div className="val" style={{ color: "#0dcaf0" }}>{globalUsage.last1m}<span className="text-muted small fw-normal"> /นาที</span></div>
              <div className="lbl">เรียก API ทั้งแพลตฟอร์ม <span className="text-success">● สด</span></div>
            </div>
          </div>
        </div>
      </div>
      <p className="text-muted small mb-3">
        <i className="fas fa-circle-info me-1" />
        พื้นที่ใช้ไปนับรวมข้อมูลในฐานข้อมูล + ไฟล์อัปโหลด (รูปห้อง/รถ/rich menu/สลิป) ต่อองค์กร — ไม่รวมไฟล์แนบ
        ในแชท {formatBytes(unattributedBytes)} ที่ยังแยกตามองค์กรไม่ได้ (แสดงรวมไว้ในยอด "พื้นที่ใช้ไปทั้งหมด"
        ด้านบนแล้ว) ตัวเลข API อัปเดตอัตโนมัติทุก 5 วินาที นับเฉพาะการเรียกผ่านหน้าแอดมินของแต่ละองค์กร (ไม่รวม
        การใช้งานผ่าน LINE ของผู้เช่า)
      </p>

      {/* ── สถานะความเสถียรของระบบ: เครื่องเซิร์ฟ / API / ฐานข้อมูล ── */}
      <div className="detail-section custom-card mb-3">
        <div className="detail-section-header">
          <h6 className="mb-0"><i className="fas fa-heartbeat me-2" />สถานะระบบ</h6>
          <span className="text-muted small">อัปเดตอัตโนมัติทุก 5 วินาที <span className="text-success">● สด</span></span>
        </div>
        {!systemHealth ? (
          <div className="text-center py-4"><div className="spinner-border spinner-border-sm" style={{ color: "var(--color-primary)" }} /></div>
        ) : (
          <div className="row g-3 p-3">
            <div className="col-md-4">
              <div className="p-3 rounded-3 h-100" style={{ border: "1px solid var(--color-light)" }}>
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <span className="fw-bold small"><i className="fas fa-server me-2 text-primary" />เครื่องเซิร์ฟเวอร์</span>
                  <span className="text-muted small">อัปไทม์ {formatUptime(systemHealth.server.uptimeSec)}</span>
                </div>
                <div className="mb-2">
                  <div className="d-flex justify-content-between small mb-1"><span>CPU</span><span>{systemHealth.server.cpuPercent}%</span></div>
                  <div className="bill-progress">
                    <div className="bill-progress-bar" style={{ width: `${Math.min(100, systemHealth.server.cpuPercent)}%`, background: gaugeColor(systemHealth.server.cpuPercent) }} />
                  </div>
                </div>
                <div>
                  <div className="d-flex justify-content-between small mb-1"><span>RAM</span><span>{systemHealth.server.memory.systemUsedPercent}%</span></div>
                  <div className="bill-progress">
                    <div className="bill-progress-bar" style={{ width: `${Math.min(100, systemHealth.server.memory.systemUsedPercent)}%`, background: gaugeColor(systemHealth.server.memory.systemUsedPercent) }} />
                  </div>
                </div>
              </div>
            </div>
            <div className="col-md-4">
              <div className="p-3 rounded-3 h-100" style={{ border: "1px solid var(--color-light)" }}>
                <div className="fw-bold small mb-2"><i className="fas fa-bolt me-2" style={{ color: "#0dcaf0" }} />API</div>
                <div className="d-flex justify-content-between small mb-1">
                  <span>อัตรา error (5 นาที)</span>
                  <span style={{ color: errorRateColor(systemHealth.api.last5m.errorRate) }}>
                    {systemHealth.api.last5m.errorRate}%
                  </span>
                </div>
                <div className="d-flex justify-content-between small mb-1"><span>เวลาตอบสนองเฉลี่ย</span><span>{systemHealth.api.last5m.avgResponseMs} ms</span></div>
                <div className="d-flex justify-content-between small"><span>จำนวนคำขอ (5 นาที)</span><span>{systemHealth.api.last5m.count}</span></div>
              </div>
            </div>
            <div className="col-md-4">
              <div className="p-3 rounded-3 h-100" style={{ border: "1px solid var(--color-light)" }}>
                <div className="fw-bold small mb-2"><i className="fas fa-database me-2 text-success" />ฐานข้อมูล</div>
                {systemHealth.database.connected
                  ? <span className="status-badge status-paid"><i className="fas fa-check-circle me-1" />เชื่อมต่อปกติ</span>
                  : <span className="status-badge status-unpaid"><i className="fas fa-exclamation-triangle me-1" />เชื่อมต่อไม่ได้</span>}
                <div className="text-muted small mt-2">latency: {systemHealth.database.latencyMs} ms</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── ตารางองค์กร ── */}
      <div className="detail-section custom-card">
        <div className="detail-section-header">
          <h6 className="mb-0"><i className="fas fa-list me-2" />รายชื่อองค์กร</h6>
          <div className="d-flex gap-2">
            <button className="btn btn-outline-primary btn-sm" onClick={() => setShowUsers(true)}>
              <i className="fas fa-users me-1" />ผู้ใช้ทั้งหมด
            </button>
            <button className="btn btn-primary btn-sm" onClick={openAddModal}>
              <i className="fas fa-plus me-1" />เพิ่มองค์กร
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-5"><div className="spinner-border" style={{ color: "var(--color-primary)" }} /></div>
        ) : orgs.length === 0 ? (
          <div className="alert alert-light border text-center small mb-0">ยังไม่มีองค์กรในระบบ</div>
        ) : (
          <div className="table-responsive-wrapper nicescrollbar" style={{ overflow: "auto" }}>
            <table className="table-mainstyle table-hover" style={{ minWidth: 1040 }}>
              <thead>
                <tr>
                  <th>ชื่อองค์กร</th>
                  <th>รหัส (slug)</th>
                  <th>ชื่อเจ้าของ</th>
                  <th>เบอร์</th>
                  <th>บัญชี</th>
                  <th>สมัครเมื่อ</th>
                  <th>เข้าล่าสุด</th>
                  <th className="text-center">ห้อง</th>
                  <th className="text-center">ผู้เช่า</th>
                  <th className="text-center">พนักงาน</th>
                  <th>พื้นที่ใช้ไป</th>
                  <th>API/นาที</th>
                  <th>เว็บสด</th>
                  <th>สถานะ</th>
                  <th className="action-cell"></th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((org) => (
                  <tr key={org.id}>
                    <td className="namec-cell">{org.name}</td>
                    <td>
                      <code className="small">
                        <EditableField value={org.slug || ""} placeholder="slug" onSave={(v) => handleUpdateOrgField(org, "slug", v)} />
                      </code>
                    </td>
                    <td className="small">
                      <EditableField value={org.owner.displayName || ""} placeholder="ชื่อเจ้าของ" width={130} onSave={(v) => handleUpdateOrgField(org, "displayName", v)} />
                    </td>
                    <td className="small">
                      <EditableField value={org.owner.phone || ""} placeholder="เบอร์โทร" width={110} onSave={(v) => handleUpdateOrgField(org, "phone", v)} />
                    </td>
                    <td className="small">
                      {org.owner.lineLinked
                        ? <span className="text-success"><i className="fab fa-line me-1" />เชื่อมแล้ว</span>
                        : <span className="text-muted">รอเชื่อม LINE</span>}
                      {org.owner.username && <div className="text-muted" style={{ fontSize: 11 }}>user: {org.owner.username}</div>}
                    </td>
                    <td className="small text-muted">{org.createdAt ? thaiDateOnlyString(new Date(org.createdAt)) : "-"}</td>
                    <td className="small">
                      {org.lastLogin ? <><span className="fw-bold">{org.lastLogin.username}</span><div className="text-muted">{new Date(org.lastLogin.at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}</div></> : <span className="text-muted">-</span>}
                    </td>
                    <td className="text-center">{org.counts.rooms}</td>
                    <td className="text-center">{org.counts.tenants}</td>
                    <td className="text-center">{org.counts.users}</td>
                    <td className="small">{formatBytes(org.storage.totalBytes)}</td>
                    <td className="small">
                      {org.apiUsage.last1m > 0 && <span className="text-success me-1">●</span>}
                      {org.apiUsage.last1m}
                    </td>
                    <td className="small">
                      {org.online
                        ? <span className="text-success"><span className="me-1" style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "var(--color-success)" }} />ออนไลน์</span>
                        : <span className="text-muted"><span className="me-1" style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "var(--color-light)" }} />ออฟไลน์</span>}
                    </td>
                    <td>
                      {org.status === "suspended"
                        ? <span className="status-badge status-unpaid">ระงับใช้งาน</span>
                        : <span className="status-badge status-paid">ใช้งานอยู่</span>}
                    </td>
                    <td className="action-cell">
                      <div className="d-flex gap-2 justify-content-end">
                        <button
                          className={`btn btn-sm ${org.status === "suspended" ? "btn-outline-success" : "btn-outline-warning"}`}
                          disabled={busyId === org.id}
                          onClick={() => toggleStatus(org)}
                        >
                          {busyId === org.id
                            ? <span className="spinner-border spinner-border-sm" />
                            : org.status === "suspended" ? <><i className="fas fa-play me-1" />เปิดใช้งาน</> : <><i className="fas fa-pause me-1" />ระงับ</>}
                        </button>
                        <button className="btn btn-sm btn-outline-primary" onClick={() => openResetModal(org)}>
                          <i className="fas fa-key me-1" />รีเซ็ตรหัสผ่าน
                        </button>
                        <button className="btn btn-sm btn-outline-danger" onClick={() => openDeleteModal(org)}>
                          <i className="fas fa-trash me-1" />ลบ
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAddModal && (
        <div className="confirm-overlay" onClick={() => !creating && setShowAddModal(false)}>
          <div className="confirm-dialog" style={{ maxWidth: 440, textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
            <h6 className="confirm-title"><i className="fas fa-plus me-2" />เพิ่มองค์กรใหม่</h6>
            <p className="text-muted small mb-3">
              สร้างองค์กร + จองบัญชีเจ้าของด้วยเบอร์โทรไว้ก่อน ยังไม่ต้องตั้ง username/password — ให้ลูกค้าไปที่
              หน้า Login เลือก "ล็อกอินครั้งแรก" แล้วกรอกเบอร์นี้ ระบบจะเชื่อมกับบัญชี LINE ของลูกค้าเองอัตโนมัติ
            </p>
            <form onSubmit={handleCreate}>
              <div className="mb-2">
                <label className="form-label small fw-bold">ชื่อองค์กร</label>
                <input className="form-control" autoFocus disabled={creating}
                  value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)} placeholder="เช่น หอพักบ้านสวย" />
              </div>
              <div className="mb-2">
                <label className="form-label small fw-bold">เบอร์โทรเจ้าของบัญชี</label>
                <input type="tel" className="form-control" disabled={creating}
                  value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="เช่น 0812345678" />
              </div>
              <div className="mb-3">
                <label className="form-label small fw-bold">ชื่อที่แสดง <span className="text-muted fw-normal">(ไม่บังคับ)</span></label>
                <input className="form-control" disabled={creating}
                  value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} placeholder="เช่น คุณสมชาย" />
              </div>
              {createError && <div className="room-modal-error mb-3"><i className="fas fa-exclamation-circle me-2" />{createError}</div>}
              <div className="confirm-actions">
                <button type="button" className="btn btn-outline-secondary" onClick={() => setShowAddModal(false)} disabled={creating}>ยกเลิก</button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? <><span className="spinner-border spinner-border-sm me-2" />กำลังสร้าง...</> : <><i className="fas fa-plus me-1" />สร้างองค์กร</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="confirm-overlay" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="confirm-dialog" style={{ maxWidth: 440, textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
            <h6 className="confirm-title text-danger"><i className="fas fa-exclamation-triangle me-2" />ลบองค์กร "{deleteTarget.name}"?</h6>
            <p className="text-muted small mb-2">
              การกระทำนี้ย้อนกลับไม่ได้ ข้อมูลทั้งหมดขององค์กรนี้ (ห้อง {deleteTarget.counts.rooms} ห้อง,
              ผู้เช่า {deleteTarget.counts.tenants} คน, พนักงาน {deleteTarget.counts.users} คน, บิล/ประวัติการชำระเงินทั้งหมด)
              จะถูกลบถาวรทันที
            </p>
            <p className="small mb-2">พิมพ์ชื่อองค์กร <strong>{deleteTarget.name}</strong> เพื่อยืนยัน:</p>
            <input
              className="form-control mb-3" autoFocus disabled={deleting}
              value={confirmInput} onChange={(e) => setConfirmInput(e.target.value)}
              placeholder={deleteTarget.name}
            />
            <div className="confirm-actions">
              <button type="button" className="btn btn-outline-secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>ยกเลิก</button>
              <button
                type="button" className="btn btn-danger"
                disabled={deleting || confirmInput !== deleteTarget.name}
                onClick={handleDelete}
              >
                {deleting ? <><span className="spinner-border spinner-border-sm me-2" />กำลังลบ...</> : <><i className="fas fa-trash me-1" />ลบถาวร</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {showUsers && <SuperAdminUsersModal onClose={() => setShowUsers(false)} onUnauthorized={() => navigate("/superadmin/login", { replace: true })} />}

      {resetTarget && (
        <div className="confirm-overlay" onClick={() => !resetting && setResetTarget(null)}>
          <div className="confirm-dialog" style={{ maxWidth: 440, textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
            <h6 className="confirm-title"><i className="fas fa-key me-2" />รีเซ็ตรหัสผ่านเจ้าของ "{resetTarget.name}"?</h6>
            <p className="text-muted small mb-0">
              ระบบจะสุ่มรหัสผ่านใหม่ให้{resetTarget.owner.username ? <> แทนรหัสเดิมของผู้ใช้ <strong>{resetTarget.owner.username}</strong></> : " พร้อมตั้งชื่อผู้ใช้ให้ด้วย (บัญชีนี้ยังไม่เคยมีชื่อผู้ใช้)"}
              {" "}รหัสผ่านเดิมจะใช้ไม่ได้ทันที และจะแสดงรหัสผ่านใหม่ให้เพียงครั้งเดียว กรุณาคัดลอกไปให้ลูกค้าก่อนปิดหน้าต่าง
            </p>
            <div className="confirm-actions">
              <button type="button" className="btn btn-outline-secondary" onClick={() => setResetTarget(null)} disabled={resetting}>ยกเลิก</button>
              <button type="button" className="btn btn-primary" disabled={resetting} onClick={handleResetPassword}>
                {resetting ? <><span className="spinner-border spinner-border-sm me-2" />กำลังรีเซ็ต...</> : <><i className="fas fa-key me-1" />ยืนยันรีเซ็ต</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {resetResult && (
        <div className="confirm-overlay" onClick={() => setResetResult(null)}>
          <div className="confirm-dialog" style={{ maxWidth: 440, textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
            <h6 className="confirm-title text-success"><i className="fas fa-check-circle me-2" />รีเซ็ตรหัสผ่านสำเร็จ</h6>
            <p className="text-muted small mb-2">
              คัดลอกไปให้ลูกค้าตอนนี้เลย — หน้าต่างนี้ปิดแล้วจะดูรหัสผ่านนี้ซ้ำไม่ได้อีก
            </p>
            <div className="p-3 rounded-3 mb-3" style={{ background: "var(--color-background)", border: "1px solid var(--color-light)" }}>
              <div className="d-flex justify-content-between small mb-1"><span className="text-muted">Username</span><code>{resetResult.username}</code></div>
              <div className="d-flex justify-content-between small"><span className="text-muted">Password</span><code>{resetResult.password}</code></div>
            </div>
            <div className="confirm-actions">
              <button type="button" className="btn btn-outline-secondary" onClick={() => setResetResult(null)}>ปิด</button>
              <button type="button" className="btn btn-primary" onClick={copyResetResult}>
                {resetCopied ? <><i className="fas fa-check me-1" />คัดลอกแล้ว</> : <><i className="fas fa-copy me-1" />คัดลอก</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
