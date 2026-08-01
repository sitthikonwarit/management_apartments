import { useState, useEffect, useRef } from "react";
import { settingsApi, authApi } from "../api/client";
import { useBreadcrumb } from "../context/BreadcrumbContext";
import { useAppConfig, DEFAULT_APP_CONFIG, NAME_CHAR_DEFAULT, type AppConfig } from "../context/AppConfigContext";
import { useAuth } from "../context/AuthContext";
import CustomSelect2 from "../components/CustomSelect2";
import { thaiDateOnlyString } from "../utils/yearFormat";
import { useLiveRefreshTick } from "../utils/useLiveSync";
import { toastSuccess, toastError } from "../utils/toast";

type Tab = "appearance" | "bill" | "features" | "users";
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "appearance", label: "รูปลักษณ์ (Appearance)", icon: "fas fa-paint-brush" },
  { key: "bill", label: "ระบบบิล (Bill System)", icon: "fas fa-coins" },
  { key: "features", label: "ฟีเจอร์เสริม (Features)", icon: "fas fa-plug" },
  { key: "users", label: "บัญชีผู้ใช้ (Users)", icon: "fas fa-users-cog" },
];

const MAX_LOGO_SIZE = 120;

// กรอบหมวดหมู่แบบเรียบ (ไม่มีเงา) เพื่อแยกแต่ละหัวข้อการตั้งค่าให้เห็นชัดเจน
const CATEGORY_CARD_STYLE: React.CSSProperties = {
  background: "var(--color-white)",
  border: "1px solid var(--color-light)",
  borderRadius: "var(--border-radius-1)",
  padding: "1.25rem",
};

// ── Searchable (ไฮไลท์/กรองรายการตามคำค้นหา เหมือน filterSettings เดิม) ─────────
function Searchable({ query, keywords, children }: { query: string; keywords: string; children: React.ReactNode }) {
  if (!query) return <>{children}</>;
  if (!keywords.toLowerCase().includes(query.toLowerCase())) return null;
  return (
    <div style={{ border: "1.5px solid var(--color-primary)", borderRadius: "var(--border-radius-1)", padding: "0.5rem" }}>
      {children}
    </div>
  );
}

// ── FormulaModal ──────────────────────────────────────────────────────────────
function FormulaModal({ formula, defaultType, onClose, onSaved }: {
  formula: any | null; defaultType: "electric" | "water";
  onClose: () => void; onSaved: (f: any) => void;
}) {
  const [name, setName] = useState(formula?.name ?? "");
  const [type, setType] = useState<"electric" | "water">(formula?.type ?? defaultType);
  const [code, setCode] = useState(formula?.formula ?? "");
  const [isDefault, setIsDefault] = useState<boolean>(formula?.isDefault ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const typeOptions = [
    { value: "electric", label: "ไฟฟ้า (Electric)" },
    { value: "water", label: "น้ำประปา (Water)" },
  ];

  async function handleSave() {
    if (!name.trim() || !code.trim()) { setError("กรุณากรอกชื่อสูตรและโค้ดคำนวณ"); return; }
    setSaving(true); setError("");
    try {
      const payload = { name: name.trim(), type, formula: code.trim(), isDefault };
      const saved = formula
        ? await settingsApi.updateFormula(formula.id, payload)
        : await settingsApi.createFormula(payload);
      toastSuccess("บันทึกสูตรสำเร็จ");
      onSaved(saved);
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? "บันทึกไม่สำเร็จ กรุณาลองใหม่";
      setError(msg);
      toastError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="confirm-overlay" onClick={onClose}>
      <div className="confirm-dialog" style={{ maxWidth: 560, width: "92%", textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
        <div className="d-flex align-items-center gap-2 mb-3">
          <i className={`fas ${formula ? "fa-edit text-warning" : "fa-plus-circle text-primary"}`} style={{ fontSize: "1.4rem" }} />
          <h6 className="confirm-title mb-0" style={{ textAlign: "left" }}>{formula ? "แก้ไขสูตร" : "สร้างสูตรใหม่"}</h6>
        </div>

        <div className="row g-3">
          <div className="col-md-8">
            <label className="form-label small">ชื่อสูตร</label>
            <input className="form-control" placeholder="เช่น ไฟบ้าน, เหมาจ่าย" autoFocus
              value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="col-md-4">
            <label className="form-label small">ประเภท</label>
            <CustomSelect2
              value={typeOptions.find((o) => o.value === type)}
              options={typeOptions}
              onChange={(o: any) => setType(o?.value ?? "electric")}
              isSearchable={false}
            />
          </div>
          <div className="col-12">
            <label className="form-label small">โค้ดคำนวณ (JavaScript)</label>
            <textarea className="form-control font-monospace" rows={4} placeholder="เช่น return u * r;"
              value={code} onChange={(e) => setCode(e.target.value)} />
            <div className="form-text small">
              ตัวแปรที่ใช้ได้: <code>u</code> = หน่วยที่ใช้, <code>r</code> = อัตราค่าบริการ — เช่น <code>return u * r;</code> หรือ <code>return 100;</code> (เหมาจ่าย)
            </div>
          </div>
          <div className="col-12">
            <div className="form-check form-switch">
              <input className="form-check-input" type="checkbox" id="formulaIsDefault"
                checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
              <label className="form-check-label" htmlFor="formulaIsDefault">ตั้งเป็นสูตรเริ่มต้น</label>
            </div>
          </div>
        </div>

        {error && (
          <div className="room-modal-error mt-3">
            <i className="fas fa-exclamation-circle me-2" />{error}
          </div>
        )}

        <div className="confirm-actions mt-4">
          <button className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>ยกเลิก</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving
              ? <><span className="spinner-border spinner-border-sm me-2" />กำลังบันทึก...</>
              : <><i className="fas fa-save me-1" />บันทึกสูตร</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── UserFormModal — เพิ่มผู้ใช้ใหม่ หรือแก้ไขชื่อที่แสดง/เปลี่ยนรหัสผ่านของผู้ใช้เดิม ───────────
function UserFormModal({ editingUser, onClose, onSaved }: {
  editingUser: any | null; onClose: () => void; onSaved: (u: any) => void;
}) {
  const [username, setUsername] = useState(editingUser?.username ?? "");
  const [displayName, setDisplayName] = useState(editingUser?.displayName ?? "");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setError("");
    if (!editingUser) {
      if (!username.trim() || !password) { setError("กรุณากรอกชื่อผู้ใช้และรหัสผ่าน"); return; }
      if (password.length < 6) { setError("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร"); return; }
    } else if (password && password.length < 6) {
      setError("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร");
      return;
    }
    setSaving(true);
    try {
      const saved = editingUser
        ? await authApi.updateUser(editingUser.id, { displayName: displayName.trim(), ...(password ? { password } : {}) })
        : await authApi.createUser(username.trim(), password, displayName.trim() || undefined);
      toastSuccess(editingUser ? "บันทึกข้อมูลผู้ใช้สำเร็จ" : "เพิ่มผู้ใช้สำเร็จ");
      onSaved(saved);
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? e?.message ?? "บันทึกไม่สำเร็จ กรุณาลองใหม่";
      setError(msg);
      toastError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="confirm-overlay" onClick={() => !saving && onClose()}>
      <div className="confirm-dialog" style={{ maxWidth: 420, textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
        <div className="d-flex align-items-center gap-2 mb-3">
          <i className={`fas ${editingUser ? "fa-user-edit text-warning" : "fa-user-plus text-primary"}`} style={{ fontSize: "1.4rem" }} />
          <h6 className="confirm-title mb-0" style={{ textAlign: "left" }}>
            {editingUser ? `แก้ไขผู้ใช้ ${editingUser.username}` : "เพิ่มผู้ใช้ใหม่"}
          </h6>
        </div>

        {!editingUser && (
          <div className="mb-3">
            <label className="form-label small fw-bold">ชื่อผู้ใช้</label>
            <input className="form-control" autoFocus value={username}
              onChange={(e) => setUsername(e.target.value)} placeholder="username" />
          </div>
        )}
        <div className="mb-3">
          <label className="form-label small fw-bold">ชื่อที่แสดง (ถ้ามี)</label>
          <input className="form-control" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="mb-3">
          <label className="form-label small fw-bold">
            {editingUser ? "รหัสผ่านใหม่ (เว้นว่างถ้าไม่ต้องการเปลี่ยน)" : "รหัสผ่าน"}
          </label>
          <input type="password" className="form-control" value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>

        {error && <div className="room-modal-error mb-3"><i className="fas fa-exclamation-circle me-2" />{error}</div>}

        <div className="confirm-actions">
          <button className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>ยกเลิก</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <><span className="spinner-border spinner-border-sm me-2" />กำลังบันทึก...</> : <><i className="fas fa-save me-1" />บันทึก</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main SettingsPage ─────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { setBreadcrumb } = useBreadcrumb();
  const { config, setConfig } = useAppConfig();

  const [activeTab, setActiveTab] = useState<Tab>("appearance");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // ── ร่างฟอร์ม (sync จาก context ตอนโหลดเสร็จ) ──
  const [electricRate, setElectricRate] = useState(0);
  const [waterRate, setWaterRate] = useState(0);
  const [overdueEnabled, setOverdueEnabled] = useState(false);
  const [dueEom, setDueEom] = useState(false);
  const [dueDay, setDueDay] = useState(5);
  const [fineType, setFineType] = useState<"fixed" | "daily">("fixed");
  const [fineAmount, setFineAmount] = useState(0);
  const [liveMeterEnabled, setLiveMeterEnabled] = useState(true);
  const [splitRentByResidents, setSplitRentByResidents] = useState(false);
  const [meterDigits, setMeterDigits] = useState(5);
  const [yearFormat, setYearFormat] = useState<"BE" | "CE">("BE");
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(30);
  const [lineEnabled, setLineEnabled] = useState(false);
  const [lineToken, setLineToken] = useState("");
  const [lineTokenVisible, setLineTokenVisible] = useState(false);
  const [lineAutoSendEnabled, setLineAutoSendEnabled] = useState(false);

  const [logoUrl, setLogoUrl] = useState("");
  const [logoBgEnabled, setLogoBgEnabled] = useState(false);
  const [logoBgColor, setLogoBgColor] = useState("#ffffff");
  const [nameText, setNameText] = useState("");
  const [nameColors, setNameColors] = useState<string[]>([]);
  const [editingCharIdx, setEditingCharIdx] = useState<number | null>(null);
  const colorPickerRef = useRef<HTMLInputElement>(null);
  const logoFileRef = useRef<HTMLInputElement>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // ── สูตรคำนวณ ──
  const [formulas, setFormulas] = useState<any[]>([]);
  const [formulaTab, setFormulaTab] = useState<"electric" | "water">("electric");
  const [showFormulaModal, setShowFormulaModal] = useState(false);
  const [editingFormula, setEditingFormula] = useState<any | null>(null);
  const [confirmDeleteFormula, setConfirmDeleteFormula] = useState<any | null>(null);
  const [deletingFormula, setDeletingFormula] = useState(false);

  // ── บัญชีผู้ใช้ ──
  const { user: currentUser } = useAuth();
  const [usersList, setUsersList] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<any | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);

  useEffect(() => {
    setBreadcrumb([{ label: "ตั้งค่าระบบ" }]);
    return () => setBreadcrumb([]);
  }, []);

  useEffect(() => {
    settingsApi.getAll().then((rows) => setFormulas(rows.filter((r: any) => r.type === "electric" || r.type === "water")))
      .finally(() => setLoading(false));
  }, []);

  function reloadUsers() {
    return authApi.getUsers().then(setUsersList).finally(() => setLoadingUsers(false));
  }
  useEffect(() => { reloadUsers(); }, []);

  // มีคนอื่นแก้ไขสูตรคำนวณ/บัญชีผู้ใช้ที่เครื่องอื่น — โหลดใหม่เงียบๆ (การตั้งค่าระบบเองอยู่ใน
  // AppConfigContext แล้ว sync ให้อัตโนมัติทุกหน้าที่ใช้ useAppConfig() อยู่แล้ว ไม่ต้องซ้ำที่นี่)
  const formulasLiveTick = useLiveRefreshTick(["formula"]);
  useEffect(() => {
    if (formulasLiveTick === 0) return;
    settingsApi.getAll().then((rows) => setFormulas(rows.filter((r: any) => r.type === "electric" || r.type === "water")));
  }, [formulasLiveTick]);

  const usersLiveTick = useLiveRefreshTick(["user"]);
  useEffect(() => {
    if (usersLiveTick === 0) return;
    reloadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usersLiveTick]);

  // sync ร่างฟอร์มจาก config กลางทุกครั้งที่โหลด/อัปเดตเสร็จ
  useEffect(() => {
    setElectricRate(config.electricRate);
    setWaterRate(config.waterRate);
    setOverdueEnabled(config.overdue.enabled);
    setDueEom(config.overdue.day === 0);
    setDueDay(config.overdue.day || 5);
    setFineType(config.overdue.type);
    setFineAmount(config.overdue.amount);
    setLiveMeterEnabled(config.features.liveMeterEnabled);
    setSplitRentByResidents(config.features.splitRentByResidents);
    setMeterDigits(config.meterDigits);
    setYearFormat(config.yearFormat);
    setSessionTimeoutMinutes(config.sessionTimeoutMinutes);
    setLineEnabled(config.lineMessaging.enabled);
    setLineToken(config.lineMessaging.channelAccessToken);
    setLineAutoSendEnabled(config.lineMessaging.autoSendEnabled);
    setLogoUrl(config.appIdentity.logoUrl);
    setLogoBgEnabled(config.appIdentity.logoBg.enabled);
    setLogoBgColor(config.appIdentity.logoBg.color);
    setNameText(config.appIdentity.nameText);
    setNameColors(config.appIdentity.nameColors);
  }, [config]);

  useEffect(() => {
    if (!saveMsg) return;
    const t = setTimeout(() => setSaveMsg(null), 3500);
    return () => clearTimeout(t);
  }, [saveMsg]);

  function ensureNameColors(text: string, colors: string[]): string[] {
    return [...text].map((_, i) => colors[i] || NAME_CHAR_DEFAULT);
  }

  function handleNameTextChange(val: string) {
    setNameText(val);
    setNameColors((prev) => ensureNameColors(val, prev));
  }

  function resetNameColors() {
    setNameColors(ensureNameColors(nameText, []));
  }

  function openCharColorPicker(idx: number) {
    setEditingCharIdx(idx);
    if (colorPickerRef.current) {
      colorPickerRef.current.value = nameColors[idx] || NAME_CHAR_DEFAULT;
      colorPickerRef.current.click();
    }
  }

  function handleCharColorChange(color: string) {
    if (editingCharIdx === null) return;
    setNameColors((prev) => {
      const next = [...prev];
      next[editingCharIdx] = color;
      return next;
    });
  }

  function handleLogoFile(file: File) {
    setUploadingLogo(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width, height = img.height;
        if (width > height) {
          if (width > MAX_LOGO_SIZE) { height *= MAX_LOGO_SIZE / width; width = MAX_LOGO_SIZE; }
        } else {
          if (height > MAX_LOGO_SIZE) { width *= MAX_LOGO_SIZE / height; height = MAX_LOGO_SIZE; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        setLogoUrl(canvas.toDataURL("image/png"));
        setUploadingLogo(false);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }

  async function handleSaveAll() {
    setSaving(true); setSaveMsg(null);
    try {
      const payload: AppConfig = {
        electricRate: Number(electricRate) || 0,
        waterRate: Number(waterRate) || 0,
        overdue: {
          enabled: overdueEnabled,
          day: dueEom ? 0 : Math.min(31, Math.max(1, Number(dueDay) || 1)),
          type: fineType,
          amount: Number(fineAmount) || 0,
        },
        appIdentity: {
          logoUrl, logoBg: { enabled: logoBgEnabled, color: logoBgColor },
          nameText, nameColors,
        },
        features: { liveMeterEnabled, splitRentByResidents },
        meterDigits: Math.max(3, Math.min(9, Number(meterDigits) || 5)),
        yearFormat,
        sessionTimeoutMinutes: Math.max(0, Number(sessionTimeoutMinutes) || 0),
        lineMessaging: { enabled: lineEnabled, channelAccessToken: lineToken.trim(), autoSendEnabled: lineAutoSendEnabled },
      };
      const updated = await settingsApi.updateConfig(payload);
      setConfig({
        ...DEFAULT_APP_CONFIG, ...updated,
        appIdentity: { ...DEFAULT_APP_CONFIG.appIdentity, ...updated.appIdentity },
        overdue: { ...DEFAULT_APP_CONFIG.overdue, ...updated.overdue },
        features: { ...DEFAULT_APP_CONFIG.features, ...updated.features },
        lineMessaging: { ...DEFAULT_APP_CONFIG.lineMessaging, ...updated.lineMessaging },
      });
      const successText = "บันทึกการตั้งค่าทั้งหมดเรียบร้อยแล้ว";
      setSaveMsg({ type: "success", text: successText });
      toastSuccess(successText);
    } catch (e: any) {
      const msg = "บันทึกไม่สำเร็จ: " + (e?.response?.data?.error ?? e?.message ?? "Unknown error");
      setSaveMsg({ type: "error", text: msg });
      toastError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteFormula() {
    if (!confirmDeleteFormula) return;
    setDeletingFormula(true);
    try {
      await settingsApi.deleteFormula(confirmDeleteFormula.id);
      setFormulas((prev) => prev.filter((f) => f.id !== confirmDeleteFormula.id));
      setConfirmDeleteFormula(null);
      toastSuccess("ลบสูตรสำเร็จ");
    } finally {
      setDeletingFormula(false);
    }
  }

  const q = search.trim().toLowerCase();
  const sectionVisible = (key: Tab) => (q ? true : activeTab === key);
  const filteredFormulas = formulas.filter((f) => f.type === formulaTab);

  return (
    <div className="custom-card">
      <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-3">
        <div>
          <h5 className="form-section-title mb-1" style={{ borderBottom: "none" }}>
            <i className="fas fa-cog me-2" />ตั้งค่าระบบ
          </h5>
          <p className="text-muted mb-0" style={{ fontSize: "0.88rem" }}>จัดการการตั้งค่าทั้งหมดของระบบเรียกเก็บเงิน</p>
        </div>
        <button className="btn btn-primary d-inline-flex align-items-center" onClick={handleSaveAll} disabled={saving}>
          {saving
            ? <><span className="spinner-border spinner-border-sm me-2" />กำลังบันทึก...</>
            : <><i className="fas fa-save me-2" /><span className="btn-text">บันทึกทั้งหมด</span></>}
        </button>
      </div>

      {saveMsg && (
        <div className={`alert ${saveMsg.type === "success" ? "alert-success" : "alert-danger"} d-flex align-items-center justify-content-between mb-3 py-2 px-3`} style={{ fontSize: "0.88rem", borderRadius: "var(--border-radius-1)" }}>
          <span>
            <i className={`fas ${saveMsg.type === "success" ? "fa-check-circle" : "fa-exclamation-circle"} me-2`} />
            {saveMsg.text}
          </span>
          <button type="button" className="btn-close btn-sm ms-3" onClick={() => setSaveMsg(null)} />
        </div>
      )}

      <div className="row g-4">
        {/* ── Sidebar ── */}
        <div className="col-md-4 col-lg-3">
          <div style={{ padding: "1rem", position: "sticky", top: 20, background: "var(--color-background)", border: "1px solid var(--color-light)", borderRadius: "var(--border-radius-1)" }}>
            <div className="search-container mb-3">
              <i className="fas fa-search" />
              <input type="text" className="form-control" placeholder="ค้นหาการตั้งค่า..."
                value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="d-flex flex-column gap-1">
              {TABS.map((t) => (
                <button key={t.key} type="button"
                  className={`btn text-start d-flex align-items-center gap-2${activeTab === t.key && !q ? " btn-primary" : " btn-light"}`}
                  style={activeTab === t.key && !q ? {} : { color: "var(--color-dark-variant)" }}
                  onClick={() => { setActiveTab(t.key); setSearch(""); }}>
                  <i className={t.icon} style={{ width: 20, textAlign: "center" }} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Content ── */}
        <div className="col-md-8 col-lg-9">
          {loading ? (
            <div className="text-center p-5"><div className="spinner-border" style={{ color: "var(--color-primary)" }} /></div>
          ) : (
          <div className="nicescrollbar" style={{ maxHeight: 650, overflow: "auto", paddingRight: 14 }}>

            {/* ── รูปลักษณ์ (Appearance) ── */}
            {sectionVisible("appearance") && (
              <div className="detail-section" style={CATEGORY_CARD_STYLE}>
                <h6><i className="fas fa-paint-brush me-2" />ปรับแต่งหน้าตา</h6>
                <div className="row g-4">

                  <Searchable query={q} keywords="โลโก้ logo รูปภาพ พื้นหลัง background">
                    <div className="col-12">
                      <label className="form-label fw-bold">รูปโลโก้ (Logo)</label>
                      <div className="d-flex gap-3 align-items-start flex-wrap">
                        <img src={logoUrl || DEFAULT_APP_CONFIG.appIdentity.logoUrl} alt="logo"
                          style={{ width: 60, height: 60, objectFit: "contain", borderRadius: 10, border: "1px solid var(--color-light)", backgroundColor: logoBgEnabled ? logoBgColor : "transparent" }}
                          onError={(e) => { (e.target as HTMLImageElement).src = DEFAULT_APP_CONFIG.appIdentity.logoUrl; }} />
                        <div className="flex-grow-1" style={{ minWidth: 240 }}>
                          <div className="input-group mb-2">
                            <input type="text" className="form-control" placeholder="https://..."
                              value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
                            <button className="btn btn-outline-secondary" type="button" disabled={uploadingLogo}
                              onClick={() => logoFileRef.current?.click()}>
                              {uploadingLogo ? <span className="spinner-border spinner-border-sm" /> : <i className="fas fa-upload" />}
                            </button>
                          </div>
                          <input ref={logoFileRef} type="file" accept="image/*" style={{ display: "none" }}
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoFile(f); e.target.value = ""; }} />
                          <div className="d-flex align-items-center gap-3 p-2 rounded" style={{ background: "var(--color-background)", border: "1px solid var(--color-light)" }}>
                            <div className="form-check form-switch mb-0">
                              <input className="form-check-input" type="checkbox" id="logoBgEnable"
                                checked={logoBgEnabled} onChange={(e) => setLogoBgEnabled(e.target.checked)} />
                              <label className="form-check-label small fw-bold" htmlFor="logoBgEnable">เติมสีพื้นหลัง</label>
                            </div>
                            <div className="d-flex align-items-center gap-2" style={{ opacity: logoBgEnabled ? 1 : 0.5, pointerEvents: logoBgEnabled ? "auto" : "none" }}>
                              <input type="color" className="form-control form-control-color" value={logoBgColor}
                                onChange={(e) => setLogoBgColor(e.target.value)} title="เลือกสีพื้นหลัง" />
                              <small className="text-muted">{logoBgColor.toUpperCase()}</small>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Searchable>

                  <Searchable query={q} keywords="ชื่อระบบ app name ชื่อหอพัก">
                    <div className="col-12">
                      <label className="form-label fw-bold">ชื่อระบบ (App Name)</label>
                      <div className="input-group mb-2">
                        <input type="text" className="form-control" placeholder="พิมพ์ชื่อระบบที่นี่..."
                          value={nameText} onChange={(e) => handleNameTextChange(e.target.value)} />
                        <button className="btn btn-outline-secondary" type="button" onClick={resetNameColors}>รีเซ็ตสี</button>
                      </div>
                      <div className="p-3 rounded d-flex flex-wrap align-items-center gap-2" style={{ background: "var(--color-background)", border: "1px solid var(--color-light)", minHeight: 60 }}>
                        {nameText ? [...nameText].map((char, i) => (
                          <button key={i} type="button" className="btn btn-sm fw-bold fs-4 position-relative"
                            style={{ color: nameColors[i] || NAME_CHAR_DEFAULT, border: "1px solid #ddd", background: "#ffffff", minWidth: 40, height: 50 }}
                            onClick={() => openCharColorPicker(i)}>
                            {char === " " ? " " : char}
                            <div style={{ width: "100%", height: 4, background: nameColors[i] || NAME_CHAR_DEFAULT, position: "absolute", bottom: 0, left: 0 }} />
                          </button>
                        )) : <span className="text-muted small">พิมพ์ชื่อระบบเพื่อปรับสีทีละตัวอักษร</span>}
                      </div>
                      <input ref={colorPickerRef} type="color" style={{ visibility: "hidden", position: "absolute" }}
                        onChange={(e) => handleCharColorChange(e.target.value)} />
                    </div>
                  </Searchable>

                </div>
              </div>
            )}

            {/* ── ระบบบิล (Bill System) ── */}
            {sectionVisible("bill") && (
              <>
                <div className="detail-section" style={CATEGORY_CARD_STYLE}>
                  <h6 style={{ color: "#b8860b", borderBottomColor: "#b8860b" }}>
                    <i className="fas fa-coins me-2" />อัตราค่าบริการพื้นฐาน
                  </h6>
                  <div className="row g-4">
                    <Searchable query={q} keywords="ค่าไฟ ไฟฟ้า electric rate">
                      <div className="col-md-6">
                        <label className="form-label fw-bold"><i className="fas fa-bolt text-warning me-1" />ค่าไฟ (บาท/หน่วย)</label>
                        <div className="input-group">
                          <input type="number" className="form-control text-end fs-5 fw-bold" placeholder="0.00"
                            value={electricRate} onChange={(e) => setElectricRate(Number(e.target.value))} />
                          <span className="input-group-text">บาท</span>
                        </div>
                        <div className="form-text small">ราคาพื้นฐานเมื่อไม่มีสูตรคำนวณ</div>
                      </div>
                    </Searchable>
                    <Searchable query={q} keywords="ค่าน้ำ น้ำประปา water rate">
                      <div className="col-md-6">
                        <label className="form-label fw-bold"><i className="fas fa-tint text-info me-1" />ค่าน้ำ (บาท/หน่วย)</label>
                        <div className="input-group">
                          <input type="number" className="form-control text-end fs-5 fw-bold" placeholder="0.00"
                            value={waterRate} onChange={(e) => setWaterRate(Number(e.target.value))} />
                          <span className="input-group-text">บาท</span>
                        </div>
                        <div className="form-text small">ราคาพื้นฐานเมื่อไม่มีสูตรคำนวณ</div>
                      </div>
                    </Searchable>
                  </div>
                </div>

                <div className="detail-section" style={CATEGORY_CARD_STYLE}>
                  <div className="d-flex justify-content-between align-items-center mb-3" style={{ borderBottom: "2px solid var(--color-danger)", paddingBottom: 8 }}>
                    <h6 className="mb-0" style={{ fontWeight: 700, color: "var(--color-danger)", border: "none", padding: 0, margin: 0 }}><i className="fas fa-clock me-2" />ค่าปรับล่าช้า</h6>
                    <div className="form-check form-switch mb-0">
                      <input className="form-check-input" type="checkbox" id="overdueEnable"
                        checked={overdueEnabled} onChange={(e) => setOverdueEnabled(e.target.checked)} />
                      <label className="form-check-label fw-bold" htmlFor="overdueEnable">เปิดใช้งาน</label>
                    </div>
                  </div>
                  <Searchable query={q} keywords="ค่าปรับ ปรับเงิน ล่าช้า overdue fine">
                    <div className="row g-3" style={{ opacity: overdueEnabled ? 1 : 0.5, pointerEvents: overdueEnabled ? "auto" : "none" }}>
                      <div className="col-md-4">
                        <label className="form-label small fw-bold">กำหนดจ่ายไม่เกินวันที่</label>
                        <div className="input-group mb-1">
                          <span className="input-group-text"><i className="fas fa-calendar-day" /></span>
                          <input type="number" className="form-control fw-bold" min={1} max={31} disabled={dueEom}
                            value={dueEom ? "" : dueDay} placeholder={dueEom ? "สิ้นเดือน" : "วันที่ (1-31)"}
                            onChange={(e) => setDueDay(Math.min(31, Math.max(1, Number(e.target.value) || 1)))} />
                        </div>
                        <div className="form-check">
                          <input className="form-check-input" type="checkbox" id="dueEom"
                            checked={dueEom} onChange={(e) => setDueEom(e.target.checked)} />
                          <label className="form-check-label small text-muted" htmlFor="dueEom">ทุกสิ้นเดือน</label>
                        </div>
                      </div>
                      <div className="col-md-8">
                        <div className="row g-3">
                          <div className="col-6">
                            <label className="form-label small fw-bold">รูปแบบ</label>
                            <CustomSelect2
                              value={{ value: fineType, label: fineType === "fixed" ? "เหมาจ่ายครั้งเดียว" : "คิดรายวัน (ต่อวัน)" }}
                              options={[{ value: "fixed", label: "เหมาจ่ายครั้งเดียว" }, { value: "daily", label: "คิดรายวัน (ต่อวัน)" }]}
                              onChange={(o: any) => setFineType(o?.value ?? "fixed")}
                              isSearchable={false}
                            />
                          </div>
                          <div className="col-6">
                            <label className="form-label small fw-bold text-danger">จำนวนเงิน</label>
                            <div className="input-group">
                              <input type="number" className="form-control text-end fw-bold text-danger"
                                value={fineAmount} onChange={(e) => setFineAmount(Number(e.target.value))} />
                              <span className="input-group-text">บาท</span>
                            </div>
                          </div>
                          <div className="col-12 text-end">
                            <small className="text-muted">
                              ตัวอย่าง: {fineType === "fixed" ? `ปรับ ${fineAmount.toLocaleString()} บาท` : `ปรับวันละ ${fineAmount.toLocaleString()} บาท`}
                            </small>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Searchable>
                </div>

                <Searchable query={q} keywords="สูตร formula คำนวณ code">
                  <div className="detail-section" style={CATEGORY_CARD_STYLE}>
                    <div className="detail-section-header" style={{ borderBottomColor: "var(--color-success)" }}>
                      <h6 className="mb-0" style={{ color: "var(--color-success)" }}><i className="fas fa-calculator me-2" />สูตรคำนวณขั้นสูง</h6>
                      <button className="btn btn-sm btn-outline-primary" onClick={() => { setEditingFormula(null); setShowFormulaModal(true); }}>
                        <i className="fas fa-plus me-1" />เพิ่มสูตร
                      </button>
                    </div>
                    <div className="d-flex gap-2 mb-3">
                      {(["electric", "water"] as const).map((t) => (
                        <button key={t} type="button"
                          className={`btn btn-sm ${formulaTab === t ? "btn-primary" : "btn-outline-secondary"}`}
                          onClick={() => setFormulaTab(t)}>
                          <i className={`fas ${t === "electric" ? "fa-bolt" : "fa-tint"} me-1`} />
                          {t === "electric" ? "ไฟฟ้า" : "น้ำประปา"}
                        </button>
                      ))}
                    </div>
                    <div className="nicescrollbar" style={{ maxHeight: 320, overflowY: "auto" }}>
                      <table className="table table-hover align-middle">
                        <thead>
                          <tr>
                            <th className="text-center" style={{ width: 90 }}>ค่าเริ่มต้น</th>
                            <th>ชื่อสูตร</th>
                            <th>โค้ด</th>
                            <th className="text-end">อัปเดต</th>
                            <th className="text-center">จัดการ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredFormulas.length === 0 ? (
                            <tr><td colSpan={5} className="text-center text-muted py-4">
                              ยังไม่มีสูตร{formulaTab === "electric" ? "ไฟฟ้า" : "ประปา"}
                            </td></tr>
                          ) : filteredFormulas.map((f) => (
                            <tr key={f.id}>
                              <td className="text-center">
                                {f.isDefault && <i className="fas fa-check-circle text-success" title="ค่าเริ่มต้น" />}
                              </td>
                              <td className="fw-bold" style={{ color: "var(--color-primary)" }}>{f.name}</td>
                              <td><code className="text-muted">{f.formula}</code></td>
                              <td className="text-end small text-muted">
                                {f.updatedAt ? thaiDateOnlyString(new Date(f.updatedAt)) : "-"}
                              </td>
                              <td className="text-center">
                                <button className="btn btn-sm btn-outline-warning border-0"
                                  onClick={() => { setEditingFormula(f); setShowFormulaModal(true); }} title="แก้ไข">
                                  <i className="fas fa-edit" />
                                </button>
                                <button className="btn btn-sm btn-outline-danger border-0"
                                  onClick={() => setConfirmDeleteFormula(f)} title="ลบ">
                                  <i className="fas fa-trash" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </Searchable>
              </>
            )}

            {/* ── ฟีเจอร์เสริม (Features) — แต่ละฟีเจอร์แยกเป็นการ์ดของตัวเอง หัวข้อ+เส้นใต้เต็มความกว้าง
                 และปุ่ม/สวิตช์อยู่บนแถวหัวข้อฝั่งขวา ทรงเดียวกับหมวด "ค่าปรับล่าช้า" ในแท็บระบบบิล ── */}
            {sectionVisible("features") && (
              <>
                <Searchable query={q} keywords="live meter มิเตอร์สด เปิดปิด">
                  <div className="detail-section" style={CATEGORY_CARD_STYLE}>
                    <div className="d-flex justify-content-between align-items-center mb-3" style={{ borderBottom: "2px solid #fd7e14", paddingBottom: 8 }}>
                      <h6 className="mb-0" style={{ fontWeight: 700, color: "#fd7e14", border: "none", padding: 0, margin: 0 }}>
                        <i className="fas fa-broadcast-tower me-2" />Live Meter (มิเตอร์สด)
                      </h6>
                      <div className="form-check form-switch mb-0">
                        <input className="form-check-input" type="checkbox"
                          checked={liveMeterEnabled} onChange={(e) => setLiveMeterEnabled(e.target.checked)} />
                      </div>
                    </div>
                    <p className="text-muted small mb-0">ดึงข้อมูลจากมิเตอร์อัจฉริยะแบบเรียลไทม์ และแสดงปุ่ม "Live Meter" ในหน้าจดมิเตอร์</p>
                  </div>
                </Searchable>

                <Searchable query={q} keywords="เลขมิเตอร์ หลัก จำนวนหลัก digit max meter">
                  <div className="detail-section" style={CATEGORY_CARD_STYLE}>
                    <h6 style={{ color: "#0dcaf0", borderBottomColor: "#0dcaf0" }}>
                      <i className="fas fa-tachometer-alt me-2" />จำนวนหลักเลขมิเตอร์
                    </h6>
                    <p className="text-muted small mb-2">
                      กำหนดจำนวนหลักสูงสุดที่กรอกเลขมิเตอร์ได้ในหน้าจดมิเตอร์ (ปัจจุบันกรอกได้สูงสุด {Math.pow(10, meterDigits) - 1})
                    </p>
                    <div className="input-group" style={{ width: 140 }}>
                      <input type="number" className="form-control fw-bold" min={3} max={9}
                        value={meterDigits}
                        onChange={(e) => setMeterDigits(Math.max(3, Math.min(9, Number(e.target.value) || 5)))} />
                      <span className="input-group-text">หลัก</span>
                    </div>
                  </div>
                </Searchable>

                <Searchable query={q} keywords="ล็อกอินอัตโนมัติ auto logout idle timeout ไม่มีการใช้งาน เด้งออก">
                  <div className="detail-section" style={CATEGORY_CARD_STYLE}>
                    <h6 style={{ color: "var(--color-danger)", borderBottomColor: "var(--color-danger)" }}>
                      <i className="fas fa-user-clock me-2" />ออกจากระบบอัตโนมัติเมื่อไม่มีการใช้งาน
                    </h6>
                    <p className="text-muted small mb-2">
                      {sessionTimeoutMinutes > 0
                        ? `ถ้าไม่มีการกระทำใดๆ ในเว็บเกิน ${sessionTimeoutMinutes} นาที ระบบจะเด้งออกจากระบบอัตโนมัติ`
                        : "ปิดใช้งาน — จะไม่มีการเด้งออกจากระบบอัตโนมัติ"}
                    </p>
                    <div className="input-group" style={{ width: 160 }}>
                      <input type="number" className="form-control fw-bold" min={0} max={1440}
                        value={sessionTimeoutMinutes}
                        onChange={(e) => setSessionTimeoutMinutes(Math.max(0, Math.min(1440, Number(e.target.value) || 0)))} />
                      <span className="input-group-text">นาที (0=ปิด)</span>
                    </div>
                  </div>
                </Searchable>

                <Searchable query={q} keywords="หาร ค่าเช่า ผู้ร่วมพักอาศัย co-resident split rent คนละ ส่วนแบ่ง">
                  <div className="detail-section" style={CATEGORY_CARD_STYLE}>
                    <div className="d-flex justify-content-between align-items-center mb-3" style={{ borderBottom: "2px solid var(--color-success)", paddingBottom: 8 }}>
                      <h6 className="mb-0" style={{ fontWeight: 700, color: "var(--color-success)", border: "none", padding: 0, margin: 0 }}>
                        <i className="fas fa-users me-2" />หารยอดชำระตามจำนวนผู้ร่วมพักอาศัย
                      </h6>
                      <div className="form-check form-switch mb-0">
                        <input className="form-check-input" type="checkbox"
                          checked={splitRentByResidents} onChange={(e) => setSplitRentByResidents(e.target.checked)} />
                      </div>
                    </div>
                    <p className="text-muted small mb-0">แสดงส่วนแบ่งต่อคนของยอดชำระทั้งบิล (ยอดชำระสุทธิ ÷ จำนวนผู้เช่า + ผู้ร่วมพักอาศัย) — ไม่กระทบยอดรวมที่เรียกเก็บจริง</p>
                  </div>
                </Searchable>

                <Searchable query={q} keywords="line line messaging ส่งบิล แจ้งเตือน line oa channel access token line user id">
                  <div className="detail-section" style={CATEGORY_CARD_STYLE}>
                    <div className="d-flex justify-content-between align-items-center mb-3" style={{ borderBottom: "2px solid #06C755", paddingBottom: 8 }}>
                      <h6 className="mb-0" style={{ fontWeight: 700, color: "#06C755", border: "none", padding: 0, margin: 0 }}>
                        <i className="fab fa-line me-2" />ส่งบิลแจ้งเตือนทาง LINE
                      </h6>
                      <div className="form-check form-switch mb-0">
                        <input className="form-check-input" type="checkbox"
                          checked={lineEnabled} onChange={(e) => setLineEnabled(e.target.checked)} />
                      </div>
                    </div>
                    <p className="text-muted small mb-3">
                      ส่งใบแจ้งค่าเช่า (Flex Message) เข้า LINE ของผู้เช่าโดยตรงผ่าน LINE Official Account ของหอพัก —
                      กดส่งเองทีละห้องได้จากหน้ารายละเอียดบิล หรือให้ระบบส่งอัตโนมัติตาม "วันนัดส่ง" ที่ตั้งไว้ในหน้าบิลก็ได้
                    </p>

                    <label className="form-label small">LINE Channel Access Token</label>
                    <div className="input-group mb-2">
                      <input type={lineTokenVisible ? "text" : "password"} className="form-control" autoComplete="off"
                        placeholder="วาง Channel access token (long-lived) จาก LINE Developers Console"
                        value={lineToken} onChange={(e) => setLineToken(e.target.value)} />
                      <button type="button" className="btn btn-outline-secondary" onClick={() => setLineTokenVisible((v) => !v)}
                        title={lineTokenVisible ? "ซ่อนโทเค็น" : "แสดงโทเค็น"}>
                        <i className={`fas fa-eye${lineTokenVisible ? "-slash" : ""}`} />
                      </button>
                    </div>

                    <div className="form-check form-switch mb-3">
                      <input className="form-check-input" type="checkbox" id="lineAutoSendSwitch"
                        checked={lineAutoSendEnabled} onChange={(e) => setLineAutoSendEnabled(e.target.checked)} />
                      <label className="form-check-label small" htmlFor="lineAutoSendSwitch">
                        ส่งบิลอัตโนมัติตาม "วันนัดส่ง" ที่ตั้งไว้ในหน้าบิล (เช็คทุก 10 นาที ส่งครั้งเดียวต่อบิลต่อรอบ และข้ามห้องที่จ่ายแล้ว)
                      </label>
                    </div>

                    <div className="alert alert-light border small mb-0" style={{ background: "var(--color-background)" }}>
                      <strong><i className="fas fa-circle-info me-1" />วิธีใช้งาน</strong>
                      <ol className="mb-0 ps-3 mt-1">
                        <li>สร้าง LINE Official Account (ฟรี) แล้วเปิดใช้งาน Messaging API ที่เมนู "การตั้งค่า &gt; Messaging API" ใน LINE Official Account Manager</li>
                        <li>ไปที่ LINE Developers Console เลือก Channel ของ OA นี้ แล้วกด Issue ที่ช่อง "Channel access token (long-lived)" คัดลอกมาวางในช่องด้านบน</li>
                        <li>เปิดสวิตช์ด้านบนแล้วกด "บันทึกการตั้งค่าทั้งหมด" ด้านล่างสุดของหน้านี้</li>
                        <li>ให้ผู้เช่าแอด LINE OA เป็นเพื่อน แล้วนำ LINE User ID (ขึ้นต้นด้วย U ตามด้วยตัวอักษร/ตัวเลข 32 ตัว) ไปกรอกที่หน้า "ผู้เช่า" &gt; แก้ไขผู้เช่าคนนั้น &gt; ช่อง LINE User ID</li>
                        <li>ไปหน้า "บิล/แจ้งหนี้" เปิดบิลของห้องที่ต้องการ กดเข้าไปที่ห้องนั้น แล้วกดปุ่ม "ส่งบิลทาง LINE" — หรือถ้าเปิดส่งอัตโนมัติไว้ ระบบจะส่งให้เองเมื่อถึง "วันนัดส่ง" ที่ตั้งไว้ตอนแก้ไขบิล</li>
                      </ol>
                    </div>
                  </div>
                </Searchable>

                <Searchable query={q} keywords="ปี พ.ศ. ค.ศ. buddhist christian year format มุมมองปี">
                  <div className="detail-section" style={CATEGORY_CARD_STYLE}>
                    <div className="d-flex justify-content-between align-items-center mb-3" style={{ borderBottom: "2px solid #6610f2", paddingBottom: 8 }}>
                      <h6 className="mb-0" style={{ fontWeight: 700, color: "#6610f2", border: "none", padding: 0, margin: 0 }}>
                        <i className="fas fa-calendar-alt me-2" />รูปแบบปีที่แสดงผล
                      </h6>
                      <div className="btn-group" role="group">
                        <button type="button" className={`btn btn-sm ${yearFormat === "BE" ? "btn-primary" : "btn-outline-secondary"}`}
                          onClick={() => setYearFormat("BE")}>พ.ศ.</button>
                        <button type="button" className={`btn btn-sm ${yearFormat === "CE" ? "btn-primary" : "btn-outline-secondary"}`}
                          onClick={() => setYearFormat("CE")}>ค.ศ.</button>
                      </div>
                    </div>
                    <p className="text-muted small mb-0">เลือกมุมมองปีที่จะแสดงทั้งเว็บไซต์ (บิล, มิเตอร์, ผู้เช่า, ห้องพัก ฯลฯ)</p>
                  </div>
                </Searchable>
              </>
            )}

            {/* ── บัญชีผู้ใช้ (Users) ── */}
            {sectionVisible("users") && (
              <div className="detail-section" style={CATEGORY_CARD_STYLE}>
                <div className="d-flex justify-content-between align-items-center mb-3" style={{ borderBottom: "2px solid var(--color-primary)", paddingBottom: 8 }}>
                  <h6 className="mb-0" style={{ fontWeight: 700, color: "var(--color-primary)", border: "none", padding: 0, margin: 0 }}>
                    <i className="fas fa-users-cog me-2" />บัญชีผู้ใช้
                  </h6>
                  <button className="btn btn-sm btn-outline-primary" onClick={() => { setEditingUser(null); setShowUserModal(true); }}>
                    <i className="fas fa-user-plus me-1" />เพิ่มผู้ใช้
                  </button>
                </div>
                {loadingUsers ? (
                  <div className="text-center p-4"><div className="spinner-border spinner-border-sm" style={{ color: "var(--color-primary)" }} /></div>
                ) : (
                  <div className="nicescrollbar" style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table className="table table-hover align-middle">
                      <thead>
                        <tr>
                          <th>ชื่อผู้ใช้</th>
                          <th>ชื่อที่แสดง</th>
                          <th>เข้าสู่ระบบล่าสุด</th>
                          <th className="text-center">จัดการ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usersList.length === 0 ? (
                          <tr><td colSpan={4} className="text-center text-muted py-4">ยังไม่มีผู้ใช้</td></tr>
                        ) : usersList.map((u) => (
                          <tr key={u.id}>
                            <td className="fw-bold">
                              {u.username}
                              {currentUser?.id === u.id && (
                                <span className="badge bg-primary ms-2" style={{ fontSize: 10 }}>คุณ</span>
                              )}
                            </td>
                            <td>{u.displayName || "-"}</td>
                            <td className="small text-muted">
                              {u.lastLoginAt ? thaiDateOnlyString(new Date(u.lastLoginAt)) : "ยังไม่เคยเข้าสู่ระบบ"}
                            </td>
                            <td className="text-center">
                              <button className="btn btn-sm btn-outline-warning border-0" title="แก้ไข/เปลี่ยนรหัสผ่าน"
                                onClick={() => { setEditingUser(u); setShowUserModal(true); }}>
                                <i className="fas fa-edit" />
                              </button>
                              <button className="btn btn-sm btn-outline-danger border-0" title="ลบ"
                                disabled={currentUser?.id === u.id}
                                onClick={() => setConfirmDeleteUser(u)}>
                                <i className="fas fa-trash" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

          </div>
          )}
        </div>
      </div>

      {showUserModal && (
        <UserFormModal
          editingUser={editingUser}
          onClose={() => setShowUserModal(false)}
          onSaved={() => { setShowUserModal(false); reloadUsers(); }}
        />
      )}

      {confirmDeleteUser && (
        <div className="confirm-overlay" onClick={() => !deletingUser && setConfirmDeleteUser(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon confirm-icon--danger"><i className="fas fa-trash" /></div>
            <h6 className="confirm-title">ลบผู้ใช้ {confirmDeleteUser.username}?</h6>
            <p className="confirm-message">บัญชีนี้จะเข้าสู่ระบบไม่ได้อีกต่อไป การลบนี้ย้อนกลับไม่ได้</p>
            <div className="confirm-actions">
              <button className="btn btn-outline-secondary" onClick={() => setConfirmDeleteUser(null)} disabled={deletingUser}>ยกเลิก</button>
              <button className="btn btn-danger" disabled={deletingUser} onClick={async () => {
                setDeletingUser(true);
                try {
                  await authApi.deleteUser(confirmDeleteUser.id);
                  setConfirmDeleteUser(null);
                  await reloadUsers();
                  toastSuccess("ลบผู้ใช้สำเร็จ");
                } finally {
                  setDeletingUser(false);
                }
              }}>
                {deletingUser ? <><span className="spinner-border spinner-border-sm me-2" />กำลังลบ...</> : <><i className="fas fa-trash me-1" />ลบ</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {showFormulaModal && (
        <FormulaModal
          formula={editingFormula}
          defaultType={formulaTab}
          onClose={() => setShowFormulaModal(false)}
          onSaved={(saved) => {
            setFormulas((prev) => {
              const idx = prev.findIndex((f) => f.id === saved.id);
              let next = idx > -1
                ? [...prev.slice(0, idx), saved, ...prev.slice(idx + 1)]
                : [...prev, saved];
              if (saved.isDefault) {
                next = next.map((f) => (f.id !== saved.id && f.type === saved.type) ? { ...f, isDefault: false } : f);
              }
              return next;
            });
            setShowFormulaModal(false);
          }}
        />
      )}

      {confirmDeleteFormula && (
        <div className="confirm-overlay" onClick={() => !deletingFormula && setConfirmDeleteFormula(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon confirm-icon--danger"><i className="fas fa-trash-alt" /></div>
            <h6 className="confirm-title">ยืนยันการลบสูตร?</h6>
            <p className="confirm-message">
              ลบสูตร <strong>{confirmDeleteFormula.name}</strong> ใช่หรือไม่?
              <br /><small className="text-danger">คำเตือน: ข้อมูลจะถูกลบถาวร ไม่สามารถกู้คืนได้</small>
            </p>
            <div className="confirm-actions">
              <button className="btn btn-outline-secondary" onClick={() => setConfirmDeleteFormula(null)} disabled={deletingFormula}>ยกเลิก</button>
              <button className="btn btn-danger" onClick={handleDeleteFormula} disabled={deletingFormula}>
                {deletingFormula
                  ? <><span className="spinner-border spinner-border-sm me-2" />กำลังลบ...</>
                  : <><i className="fas fa-trash-alt me-1" />ใช่, ลบข้อมูล</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
