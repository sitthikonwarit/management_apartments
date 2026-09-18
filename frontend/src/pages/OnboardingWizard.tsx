// ── ตั้งค่าเริ่มต้นครั้งแรก (บังคับ + เรียงลำดับ) ────────────────────────────────
// แทนที่การ "ล็อกไปหน้า Settings เฉยๆ ให้กรอกอะไรก่อนก็ได้" แบบเดิม ด้วย wizard 4 ขั้นตอนที่บังคับทำเรียง
// ลำดับ: รูปลักษณ์ → ค่าน้ำไฟ → สร้างตึก → สร้างห้อง — แต่ละขั้นต้องทำให้ "เสร็จจริง" (มีข้อมูลบันทึกแล้ว
// ในฐานข้อมูล ไม่ใช่แค่เข้าฟอร์มมาดู) ถึงจะไปขั้นถัดไปได้ ดึงสถานะ "เสร็จหรือยัง" ของแต่ละขั้นจากข้อมูลจริง
// เสมอ (ไม่ได้เก็บเป็นตัวเลข step แยกต่างหาก) กันเคส refresh หน้ากลางคันแล้วสถานะเพี้ยน/ข้ามขั้นได้เอง
// ต้องมี AppConfigContext ครบก่อนถึงจะ render (ดู App.tsx: setupLocked)
import { useEffect, useMemo, useRef, useState } from "react";
import { settingsApi, roomsApi, tenantsApi } from "../api/client";
import { useAppConfig, DEFAULT_APP_CONFIG } from "../context/AppConfigContext";
import { useBreadcrumb } from "../context/BreadcrumbContext";
import { toastSuccess, toastError } from "../utils/toast";
import TowerManagement from "../components/TowerManagement";

const MAX_LOGO_SIZE = 120; // เหมือน SettingsPage.tsx — ย่อโลโก้ที่อัปโหลดให้ไม่ใหญ่เกินจำเป็นก่อนเก็บเป็น base64

const STEPS = [
  { key: "appearance", label: "รูปลักษณ์", icon: "fa-paint-brush" },
  { key: "rates", label: "ค่าน้ำไฟ", icon: "fa-bolt" },
  { key: "towers", label: "สร้างตึก", icon: "fa-building" },
  { key: "rooms", label: "สร้างห้อง", icon: "fa-door-open" },
] as const;

const CARD_STYLE: React.CSSProperties = {
  background: "var(--color-white)",
  border: "1px solid var(--color-light)",
  borderRadius: "var(--border-radius-1)",
  padding: "1.5rem",
};

export default function OnboardingWizard() {
  const { config, refresh } = useAppConfig();
  const { setBreadcrumb } = useBreadcrumb();
  useEffect(() => { setBreadcrumb([{ label: "ตั้งค่าเริ่มต้น" }]); return () => setBreadcrumb([]); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [towers, setTowers] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    Promise.all([roomsApi.getTowers(), roomsApi.getAll(), tenantsApi.getAll()])
      .then(([t, r, ten]) => { setTowers(t); setRooms(r); setTenants(ten); })
      .finally(() => setLoadingData(false));
  }, []);

  // สถานะ "เสร็จหรือยัง" ของแต่ละขั้น — อิงข้อมูลจริงที่บันทึกไว้แล้วเสมอ (config จาก context / towers-rooms
  // ที่โหลดมา) ไม่ใช่ค่าฟอร์มที่ยังไม่ได้กด "บันทึก" กันคนพิมพ์ข้อมูลไว้ในช่องเฉยๆ แล้วหลอกให้ผ่านขั้นได้
  const appearanceDone = !!config.appIdentity.nameText.trim();
  const ratesDone = Number(config.electricRate) > 0 && Number(config.waterRate) > 0;
  const towersDone = towers.length > 0;
  const roomsDone = rooms.length > 0;
  const doneFlags = [appearanceDone, ratesDone, towersDone, roomsDone];
  const firstIncomplete = doneFlags.findIndex((d) => !d);
  const allDone = firstIncomplete === -1;
  const targetStep = allDone ? STEPS.length - 1 : firstIncomplete;

  // ผู้ใช้คลิกย้อนไปดูขั้นที่ทำผ่านไปแล้วเองได้ (ทบทวน/แก้ไขซ้ำ) แต่ข้ามไปขั้นที่ยังไม่เสร็จล่วงหน้าไม่ได้
  // (ปุ่มขั้นถัดๆ ไปถูก disabled ไว้ — ดู stepper ด้านล่าง) พอทำขั้นที่ค้างอยู่เสร็จ ต้องเด้งตามไปขั้นถัดไปเอง
  const [clickedStep, setClickedStep] = useState<number | null>(null);
  useEffect(() => { if (clickedStep !== null && clickedStep <= targetStep) setClickedStep(null); }, [targetStep]); // eslint-disable-line react-hooks/exhaustive-deps
  const viewStep = clickedStep !== null && clickedStep <= targetStep ? clickedStep : targetStep;

  // ── ขั้น 1: รูปลักษณ์ ──────────────────────────────────────────────────────
  const [logoUrl, setLogoUrl] = useState("");
  const [nameText, setNameText] = useState("");
  const [savingAppearance, setSavingAppearance] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLogoUrl(config.appIdentity.logoUrl);
    setNameText(config.appIdentity.nameText);
  }, [config.appIdentity.logoUrl, config.appIdentity.nameText]);

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

  // ทุกขั้นที่ "บันทึกค่า" (ไม่ใช่สร้างตึก/ห้อง) ต้องส่ง config ทั้งก้อนกลับไปเสมอ (PUT /settings/config ฝั่ง
  // backend อ่านทุกฟิลด์จาก body ไม่ใช่ patch บางส่วน) จึง clone config ปัจจุบันมาแก้เฉพาะจุดที่ต้องการ
  function buildConfigPayload(patch: Partial<typeof config>) {
    return { ...config, ...patch };
  }

  async function saveAppearance() {
    if (!nameText.trim()) { toastError("กรุณากรอกชื่อระบบ"); return; }
    setSavingAppearance(true);
    try {
      await settingsApi.updateConfig(buildConfigPayload({
        appIdentity: { ...config.appIdentity, logoUrl, nameText: nameText.trim() },
      }));
      await refresh();
      setClickedStep(null);
      toastSuccess("บันทึกรูปลักษณ์สำเร็จ");
    } catch {
      toastError("บันทึกไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSavingAppearance(false);
    }
  }

  // ── ขั้น 2: ค่าน้ำไฟ ──────────────────────────────────────────────────────
  const [electricRate, setElectricRate] = useState("");
  const [waterRate, setWaterRate] = useState("");
  const [savingRates, setSavingRates] = useState(false);

  useEffect(() => {
    setElectricRate(config.electricRate ? String(config.electricRate) : "");
    setWaterRate(config.waterRate ? String(config.waterRate) : "");
  }, [config.electricRate, config.waterRate]);

  async function saveRates() {
    const e = Number(electricRate) || 0;
    const w = Number(waterRate) || 0;
    if (e <= 0 || w <= 0) { toastError("กรุณากรอกค่าไฟและค่าน้ำให้มากกว่า 0 ทั้งคู่"); return; }
    setSavingRates(true);
    try {
      await settingsApi.updateConfig(buildConfigPayload({ electricRate: e, waterRate: w }));
      await refresh();
      setClickedStep(null);
      toastSuccess("บันทึกค่าน้ำไฟสำเร็จ");
    } catch {
      toastError("บันทึกไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSavingRates(false);
    }
  }

  // ── ขั้นสุดท้าย: เสร็จสิ้น ────────────────────────────────────────────────
  const [completing, setCompleting] = useState(false);
  async function handleComplete() {
    setCompleting(true);
    try {
      await settingsApi.completeSetup();
      await refresh();
      toastSuccess("ตั้งค่าเริ่มต้นเสร็จสมบูรณ์ ยินดีต้อนรับ!");
    } catch {
      toastError("ทำรายการไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setCompleting(false);
    }
  }

  const stepMeta = useMemo(() => STEPS.map((s, i) => ({
    ...s,
    done: doneFlags[i],
    reachable: i <= targetStep, // ห้ามคลิกข้ามไปขั้นที่ยังไม่เสร็จ (ต้องทำเรียงลำดับ)
  })), [doneFlags, targetStep]);

  return (
    <div className="custom-card" style={{ maxWidth: 760, margin: "0 auto" }}>
      <div className="text-center mb-4">
        <h5 className="mb-1" style={{ fontWeight: 700 }}>
          <i className="fas fa-flag-checkered me-2" style={{ color: "var(--color-primary)" }} />ตั้งค่าเริ่มต้นระบบ
        </h5>
        <p className="text-muted small mb-0">ทำตามขั้นตอนให้ครบก่อน ถึงจะเริ่มใช้งานระบบส่วนอื่นได้</p>
      </div>

      {/* หัวขั้นตอน — คลิกย้อนไปขั้นที่ทำผ่านแล้วได้ ข้ามไปขั้นที่ยังไม่เสร็จไม่ได้ */}
      <div className="d-flex align-items-center justify-content-center mb-4" style={{ flexWrap: "wrap", gap: 4 }}>
        {stepMeta.map((s, i) => (
          <div key={s.key} className="d-flex align-items-center">
            <button
              type="button"
              disabled={!s.reachable}
              onClick={() => setClickedStep(i)}
              className="d-flex flex-column align-items-center border-0 bg-transparent"
              style={{ cursor: s.reachable ? "pointer" : "default", padding: "0 6px", opacity: s.reachable ? 1 : 0.45 }}
            >
              <span
                className="d-inline-flex align-items-center justify-content-center"
                style={{
                  width: 34, height: 34, borderRadius: "50%", fontSize: 14, fontWeight: 700,
                  background: s.done ? "var(--color-success)" : viewStep === i ? "var(--color-primary)" : "var(--color-light)",
                  color: s.done || viewStep === i ? "#fff" : "var(--color-dark-variant)",
                  border: viewStep === i && !s.done ? "2px solid var(--color-primary)" : "none",
                }}
              >
                {s.done ? <i className="fas fa-check" /> : <i className={`fas ${s.icon}`} />}
              </span>
              <span className="small mt-1" style={{ fontWeight: viewStep === i ? 700 : 400, whiteSpace: "nowrap" }}>{s.label}</span>
            </button>
            {i < stepMeta.length - 1 && <hr className="mx-1" style={{ width: 24, opacity: s.done ? 1 : 0.3, borderColor: s.done ? "var(--color-success)" : undefined }} />}
          </div>
        ))}
      </div>

      {allDone && clickedStep === null ? (
        <div style={CARD_STYLE} className="text-center">
          <i className="fas fa-circle-check text-success mb-3" style={{ fontSize: 40 }} />
          <h6 className="fw-bold mb-2">ครบทุกขั้นตอนแล้ว!</h6>
          <p className="text-muted small mb-3">
            ตั้งชื่อระบบ, ค่าน้ำไฟ, สร้างตึก {towers.length} ตึก และห้องพัก {rooms.length} ห้องเรียบร้อยแล้ว
            กดปุ่มด้านล่างเพื่อเริ่มใช้งานระบบทุกส่วน (แก้ไขค่าพวกนี้เพิ่มเติมได้ตลอดในหน้า Settings ภายหลัง)
          </p>
          <button type="button" className="btn btn-primary" disabled={completing} onClick={handleComplete}>
            {completing
              ? <><span className="spinner-border spinner-border-sm me-2" />กำลังดำเนินการ...</>
              : <><i className="fas fa-rocket me-2" />เริ่มใช้งานระบบ</>}
          </button>
        </div>
      ) : viewStep === 0 ? (
        <div style={CARD_STYLE}>
          <h6 className="fw-bold mb-3"><i className="fas fa-paint-brush me-2" />รูปลักษณ์ของระบบ</h6>
          <label className="form-label small fw-bold">โลโก้ (ไม่บังคับ)</label>
          <div className="d-flex gap-3 align-items-start flex-wrap mb-3">
            <img src={logoUrl || DEFAULT_APP_CONFIG.appIdentity.logoUrl} alt="logo"
              style={{ width: 60, height: 60, objectFit: "contain", borderRadius: 10, border: "1px solid var(--color-light)" }}
              onError={(e) => { (e.target as HTMLImageElement).src = DEFAULT_APP_CONFIG.appIdentity.logoUrl; }} />
            <div className="flex-grow-1" style={{ minWidth: 240 }}>
              <div className="input-group">
                <input type="text" className="form-control" placeholder="https://..."
                  value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
                <button className="btn btn-outline-secondary" type="button" disabled={uploadingLogo}
                  onClick={() => logoFileRef.current?.click()}>
                  {uploadingLogo ? <span className="spinner-border spinner-border-sm" /> : <i className="fas fa-upload" />}
                </button>
              </div>
              <input ref={logoFileRef} type="file" accept="image/*" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoFile(f); e.target.value = ""; }} />
            </div>
          </div>

          <label className="form-label small fw-bold">ชื่อระบบ / ชื่อหอพัก</label>
          <input type="text" className="form-control mb-3" placeholder="เช่น บ้านบุญอัมพร"
            value={nameText} onChange={(e) => setNameText(e.target.value)} autoFocus />

          <button type="button" className="btn btn-primary" disabled={savingAppearance} onClick={saveAppearance}>
            {savingAppearance
              ? <><span className="spinner-border spinner-border-sm me-2" />กำลังบันทึก...</>
              : <>บันทึกและไปต่อ<i className="fas fa-arrow-right ms-2" /></>}
          </button>
          <p className="text-muted small mt-2 mb-0">ปรับแต่งสี/รายละเอียดเพิ่มเติมได้ในหน้า Settings ภายหลัง</p>
        </div>
      ) : viewStep === 1 ? (
        <div style={CARD_STYLE}>
          <h6 className="fw-bold mb-3"><i className="fas fa-bolt me-2" />ค่าน้ำไฟเริ่มต้น</h6>
          <p className="text-muted small mb-3">อัตราค่าเริ่มต้นที่ใช้คำนวณบิลทุกห้อง — ปรับต่อห้อง/ปรับสูตรเพิ่มเติมได้ในหน้า Settings ภายหลัง</p>
          <div className="row g-3 mb-3">
            <div className="col-sm-6">
              <label className="form-label small fw-bold"><i className="fas fa-bolt text-warning me-1" />ค่าไฟ (บาท/หน่วย)</label>
              <input type="number" min={0} className="form-control" placeholder="เช่น 7"
                value={electricRate} onChange={(e) => setElectricRate(e.target.value)} autoFocus />
            </div>
            <div className="col-sm-6">
              <label className="form-label small fw-bold"><i className="fas fa-tint text-info me-1" />ค่าน้ำ (บาท/หน่วย)</label>
              <input type="number" min={0} className="form-control" placeholder="เช่น 18"
                value={waterRate} onChange={(e) => setWaterRate(e.target.value)} />
            </div>
          </div>
          <button type="button" className="btn btn-primary" disabled={savingRates} onClick={saveRates}>
            {savingRates
              ? <><span className="spinner-border spinner-border-sm me-2" />กำลังบันทึก...</>
              : <>บันทึกและไปต่อ<i className="fas fa-arrow-right ms-2" /></>}
          </button>
        </div>
      ) : viewStep === 2 ? (
        <div>
          <div className="mb-3 text-center">
            <h6 className="fw-bold mb-1"><i className="fas fa-building me-2" />สร้างตึก/อาคาร</h6>
            <p className="text-muted small mb-0">
              {towersDone ? `สร้างไว้แล้ว ${towers.length} ตึก — สร้างเพิ่มหรือกดไปขั้นถัดไปได้เลย` : "สร้างอย่างน้อย 1 ตึกก่อนถึงจะไปขั้นถัดไปได้"}
            </p>
          </div>
          {loadingData ? (
            <div className="text-center py-4"><div className="spinner-border spinner-border-sm" /></div>
          ) : (
            <TowerManagement
              towers={towers}
              allRooms={rooms}
              tenants={tenants}
              onClose={() => {}}
              onTowersUpdate={setTowers}
              onRoomsUpdate={setRooms}
              onTenantsUpdate={(updater) => setTenants(updater)}
            />
          )}
          {towersDone && (
            <div className="text-center mt-3">
              <button type="button" className="btn btn-primary" onClick={() => setClickedStep(null)}>
                ไปขั้นถัดไป<i className="fas fa-arrow-right ms-2" />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div>
          <div className="mb-3 text-center">
            <h6 className="fw-bold mb-1"><i className="fas fa-door-open me-2" />สร้างห้องพัก</h6>
            <p className="text-muted small mb-0">
              {roomsDone
                ? `สร้างไว้แล้ว ${rooms.length} ห้อง — เสร็จสิ้นขั้นตอนตั้งค่าเริ่มต้นแล้ว`
                : "กดที่ตึกด้านล่างแล้วใช้ปุ่ม \"สร้างห้องอัตโนมัติ\" เพื่อสร้างห้องตามชั้น/จำนวนที่กำหนด"}
            </p>
          </div>
          {loadingData ? (
            <div className="text-center py-4"><div className="spinner-border spinner-border-sm" /></div>
          ) : (
            <TowerManagement
              towers={towers}
              allRooms={rooms}
              tenants={tenants}
              onClose={() => {}}
              onTowersUpdate={setTowers}
              onRoomsUpdate={setRooms}
              onTenantsUpdate={(updater) => setTenants(updater)}
            />
          )}
        </div>
      )}
    </div>
  );
}
