// หน้า LIFF Profile — ปลายทางของปุ่ม "ข้อมูลผู้เช่า" บนเมนู Member แสดงข้อมูลส่วนตัว + บิลทุกใบ (ทั้งจ่ายแล้ว
// และค้างอยู่) + ประวัติการชำระเงินทั้งหมดของผู้เช่าคนนั้น กดดูรายละเอียดแต่ละบิลได้ (หน้าตาแบบ "บิลอิเล็กทรอนิกส์
// (LINE)" เดียวกับที่พนักงานเห็นในหน้า Bills — ดู BillLinePreviewCard.tsx) และดูสลิปการโอนแต่ละรายการในประวัติ
// การชำระเงินได้
import { useEffect, useState } from "react";
import liff from "@line/liff";
import { liffApi, startLiffPresenceHeartbeat } from "../api/client";
import { extractLiffId } from "../utils/liffHelpers";
import { monthYearLabel } from "../utils/billCalc";
import { thaiDateOnlyString } from "../utils/yearFormat";
import { BillLinePreview, type BillLinePreviewConfig } from "../components/BillLinePreviewCard";
import ImageLightbox from "../components/ImageLightbox";
import LiffThemeToggle from "../components/LiffThemeToggle";

const AVATAR = "https://cdn-icons-png.flaticon.com/512/149/149071.png";

// Google Drive image proxy ปิดใช้งานถาวรที่ฝั่ง backend — ไม่ยิง request ไปเปล่าๆ ให้ตกกลับเป็น avatar
// เริ่มต้นทันทีถ้า url เป็นลิงก์ Drive (แพทเทิร์นเดียวกับ frontend/src/pages/TenantsPage.tsx)
function getDriveImgSrc(url: string): string {
  if (!url) return AVATAR;
  if (/\/d\/[a-zA-Z0-9_-]+/.test(url) || /[?&]id=[a-zA-Z0-9_-]+/.test(url)) return AVATAR;
  return url;
}

type Status = "loading" | "linked" | "unlinked" | "error";

interface CoResident { name: string; phone: string; lineId: string; image: string }
interface TenantVehicle { id: string; licensePlate: string; brand: string; model?: string; color: string; typeName: string; typeIcon: string; images: string[] }
interface TenantFile { name: string; url: string }
interface FullProfile {
  personal: {
    idLicense: string; title: string; firstName: string; lastName: string; tel: string; idLine: string;
    houseNo: string; soi: string; road: string; tambon: string; amphoe: string; province: string;
    zipcode: string; address: string; driveImageUrl: string;
  };
  roomNumbers: string[];
  coResidents: CoResident[];
  vehicles: TenantVehicle[];
  files: TenantFile[];
}

interface BillRow {
  billId: string; roomId: string; monthYear: string; roomNumber: string;
  total: number; paidAmount: number; status: string;
}

interface PaymentRow {
  id: string; paymentDate: string; monthYear: string; roomNumber: string;
  method: string; amount: number; note: string; slipUrl: string; cancelled: boolean;
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n) || 0);
}

function BillStatusBadge({ bill }: { bill: BillRow }) {
  if (bill.status === "paid") return <span className="status-badge status-paid">จ่ายแล้ว</span>;
  if (bill.paidAmount > 0) return <span className="status-badge status-partial">ค้าง {fmtMoney(bill.total - bill.paidAmount)} ฿</span>;
  return <span className="status-badge status-unpaid">รอชำระ</span>;
}

export default function LiffProfilePage() {
  // รหัสองค์กร (?org=<slug>) จาก Endpoint URL ของ LIFF app นี้เอง — ดูคอมเมนต์เดียวกันใน LiffLoginPage.tsx
  const org = new URLSearchParams(window.location.search).get("org") || undefined;
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [branding, setBranding] = useState({ logoUrl: "", nameText: "" });
  const [previewConfig, setPreviewConfig] = useState<BillLinePreviewConfig>({
    appIdentity: { logoUrl: "", logoBg: { enabled: false, color: "#ffffff" }, nameText: "" },
    features: { splitRentByResidents: false },
    overdue: { enabled: false, day: 5, type: "fixed", amount: 0 },
  });
  const [accessToken, setAccessToken] = useState("");

  const [tenant, setTenant] = useState({ tenantName: "", roomNumber: "", tel: "", contractStartDate: "", contractEndDate: "" });
  const [bills, setBills] = useState<BillRow[]>([]);
  const [paymentHistory, setPaymentHistory] = useState<PaymentRow[]>([]);
  const [tab, setTab] = useState<"bills" | "payments" | "personal">("bills");

  const [selectedBill, setSelectedBill] = useState<BillRow | null>(null);
  const [detailData, setDetailData] = useState<{ item: any; monthYear: string } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [slipToView, setSlipToView] = useState<string | null>(null);
  const [lightboxImages, setLightboxImages] = useState<string[] | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // ป็อปอัพ "ดูข้อมูลส่วนตัวทั้งหมด" — ต้องกรอกเลขบัตรประชาชน 4 ตัวท้ายให้ตรงก่อนถึงจะเห็นข้อมูลอ่อนไหว
  // (ที่อยู่เต็ม/ผู้พักอาศัยร่วม/รถ/ไฟล์แนบ) ยืนยันสำเร็จแล้วเก็บไว้ใน state หน้านี้เท่านั้น ไม่ persist ข้าม
  // การเปิดหน้าใหม่ (ต้องกรอกใหม่ทุกครั้งที่เข้าหน้านี้)
  const [fullProfile, setFullProfile] = useState<FullProfile | null>(null);
  const [verifyInput, setVerifyInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let stopPresence: (() => void) | null = null;
    (async () => {
      try {
        const cfg = await liffApi.getConfig(org);
        if (cancelled) return;
        setBranding({ logoUrl: cfg.appIdentity.logoUrl, nameText: cfg.appIdentity.nameText });
        setPreviewConfig({ appIdentity: cfg.appIdentity, features: cfg.features, overdue: cfg.overdue });

        const liffId = extractLiffId(cfg.liffProfileUrl);
        if (!liffId) { setErrorMsg("ระบบยังไม่ได้ตั้งค่า LIFF Profile URL กรุณาติดต่อผู้ดูแลระบบ"); setStatus("error"); return; }

        await liff.init({ liffId });
        if (!liff.isLoggedIn()) { liff.login(); return; }

        const token = liff.getAccessToken();
        if (!token) { setErrorMsg("ไม่พบ Access Token จาก LINE กรุณาลองใหม่อีกครั้ง"); setStatus("error"); return; }
        setAccessToken(token);
        if (!cancelled) stopPresence = startLiffPresenceHeartbeat(token, "profile", org);

        const result = await liffApi.profile(token, org);
        if (cancelled) return;
        if (result.linked) {
          setTenant(result.tenant);
          setBills(result.bills);
          setPaymentHistory(result.paymentHistory);
          setStatus("linked");
        } else {
          setStatus("unlinked");
        }
      } catch (e: any) {
        if (cancelled) return;
        setErrorMsg(e?.response?.data?.error ?? e?.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
        setStatus("error");
      }
    })();
    return () => { cancelled = true; stopPresence?.(); };
  }, []);

  async function openDetail(bill: BillRow) {
    setSelectedBill(bill);
    setDetailData(null);
    setLoadingDetail(true);
    try {
      const result = await liffApi.billDetail(accessToken, bill.billId, bill.roomId, org);
      setDetailData(result);
    } catch {
      setDetailData(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function handleVerifyIdentity() {
    const digits = verifyInput.trim();
    if (!/^\d{4}$/.test(digits)) { setVerifyError("กรุณากรอกตัวเลข 4 หลัก"); return; }
    setVerifying(true); setVerifyError("");
    try {
      const result = await liffApi.profileFull(accessToken, digits, org);
      setFullProfile(result);
    } catch (e: any) {
      setVerifyError(e?.response?.data?.error ?? e?.message ?? "ยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setVerifying(false);
    }
  }

  if (status === "loading" || status === "error" || status === "unlinked") {
    return (
      <div className="login-page-wrap">
        <LiffThemeToggle />
        <div className="login-card custom-card text-center">
          {branding.logoUrl
            ? <img src={branding.logoUrl} alt="" style={{ width: 56, height: 56, objectFit: "contain", borderRadius: "50%", margin: "0 auto", display: "block" }} />
            : <div className="login-icon"><i className="fas fa-user" /></div>}
          <h5 className="mt-3 mb-1" style={{ fontWeight: 700 }}>{branding.nameText || "ข้อมูลผู้เช่า"}</h5>
          {status === "loading" && (
            <div className="py-4">
              <div className="spinner-border" style={{ color: "var(--color-primary)" }} />
              <p className="text-muted small mt-3 mb-0">กำลังโหลดข้อมูล...</p>
            </div>
          )}
          {status === "error" && (
            <div className="room-modal-error mt-3"><i className="fas fa-exclamation-circle me-2" />{errorMsg}</div>
          )}
          {status === "unlinked" && (
            <div className="room-modal-error mt-3 text-start">
              <i className="fas fa-exclamation-circle me-2" />ยังไม่พบข้อมูลผู้เช่าที่ผูกกับบัญชี LINE นี้ กรุณาติดต่อผู้ดูแลหอพักเพื่อผูกบัญชีก่อน
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="login-page-wrap">
      <LiffThemeToggle />
      <div className="login-card custom-card" style={{ maxWidth: 440 }}>
        <div className="text-center mb-3">
          {branding.logoUrl
            ? <img src={branding.logoUrl} alt="" style={{ width: 56, height: 56, objectFit: "contain", borderRadius: "50%", margin: "0 auto", display: "block" }} />
            : <div className="login-icon"><i className="fas fa-user" /></div>}
          <h5 className="mt-3 mb-1" style={{ fontWeight: 700 }}>{tenant.tenantName}</h5>
        </div>

        <div className="p-3 rounded mb-3 small" style={{ background: "var(--color-background)", border: "1px solid var(--color-light)" }}>
          <div className="d-flex justify-content-between mb-1"><span className="text-muted">ห้อง</span><span className="fw-bold">{tenant.roomNumber || "-"}</span></div>
          <div className="d-flex justify-content-between mb-1"><span className="text-muted">เบอร์โทร</span><span>{tenant.tel || "-"}</span></div>
          <div className="d-flex justify-content-between mb-1"><span className="text-muted">เริ่มสัญญา</span><span>{tenant.contractStartDate ? thaiDateOnlyString(new Date(tenant.contractStartDate)) : "-"}</span></div>
          <div className="d-flex justify-content-between"><span className="text-muted">สิ้นสุดสัญญา</span><span>{tenant.contractEndDate ? thaiDateOnlyString(new Date(tenant.contractEndDate)) : "-"}</span></div>
        </div>

        <div className="d-flex gap-2 mb-3">
          <button className={`btn btn-sm flex-grow-1 ${tab === "bills" ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => setTab("bills")}>
            <i className="fas fa-file-invoice me-1" />บิลทั้งหมด
          </button>
          <button className={`btn btn-sm flex-grow-1 ${tab === "payments" ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => setTab("payments")}>
            <i className="fas fa-receipt me-1" />ประวัติการชำระ
          </button>
          <button className={`btn btn-sm flex-grow-1 ${tab === "personal" ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => setTab("personal")}>
            <i className="fas fa-id-card me-1" />ข้อมูลส่วนตัว
          </button>
        </div>

        <div className="d-flex flex-column gap-2" style={{ maxHeight: 360, overflowY: "auto" }}>
          {tab === "personal" ? (
            !fullProfile ? (
              <div className="p-3 rounded" style={{ border: "1px solid var(--color-light)" }}>
                <div className="text-center mb-3">
                  <div className="login-icon mb-2" style={{ width: 48, height: 48, fontSize: 18 }}>
                    <i className="fas fa-lock" />
                  </div>
                  <div className="small text-muted">
                    เพื่อความปลอดภัย กรุณากรอกเลขบัตรประชาชน 4 ตัวท้ายของคุณ ก่อนดูข้อมูลส่วนตัว/ผู้พักอาศัยร่วม/รถ/ไฟล์แนบ
                  </div>
                </div>
                <input
                  type="tel" inputMode="numeric" maxLength={4} className="form-control text-center mb-2"
                  style={{ letterSpacing: 4, fontSize: 20 }}
                  placeholder="XXXX" value={verifyInput} disabled={verifying}
                  onChange={(e) => setVerifyInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
                />
                {verifyError && <div className="room-modal-error mb-2"><i className="fas fa-exclamation-circle me-2" />{verifyError}</div>}
                <button className="btn btn-primary w-100" onClick={handleVerifyIdentity} disabled={verifying}>
                  {verifying ? <><span className="spinner-border spinner-border-sm me-2" />กำลังยืนยัน...</> : <><i className="fas fa-unlock me-1" />ยืนยันตัวตน</>}
                </button>
              </div>
            ) : (
              <>
                <div className="p-2 rounded" style={{ border: "1px solid var(--color-light)" }}>
                  <div className="fw-bold small mb-2"><i className="fas fa-user me-2 text-muted" />ข้อมูลส่วนตัว</div>
                  {fullProfile.personal.driveImageUrl && (
                    <img
                      src={getDriveImgSrc(fullProfile.personal.driveImageUrl)} alt=""
                      style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover", cursor: "pointer", marginBottom: 8 }}
                      onError={(e) => { (e.target as HTMLImageElement).src = AVATAR; }}
                      onClick={() => { setLightboxImages([getDriveImgSrc(fullProfile.personal.driveImageUrl)]); setLightboxIndex(0); }}
                    />
                  )}
                  <div className="small d-flex justify-content-between mb-1"><span className="text-muted">เลขบัตรประชาชน</span><span>{fullProfile.personal.idLicense || "-"}</span></div>
                  <div className="small d-flex justify-content-between mb-1"><span className="text-muted">LINE ID</span><span>{fullProfile.personal.idLine || "-"}</span></div>
                  <div className="small d-flex justify-content-between mb-1"><span className="text-muted">ห้องที่เช่า</span><span>{fullProfile.roomNumbers.join(", ") || "-"}</span></div>
                  <div className="small text-muted mt-2">ที่อยู่</div>
                  <div className="small">
                    {fullProfile.personal.address ||
                      [fullProfile.personal.houseNo, fullProfile.personal.soi, fullProfile.personal.road, fullProfile.personal.tambon, fullProfile.personal.amphoe, fullProfile.personal.province, fullProfile.personal.zipcode]
                        .filter(Boolean).join(" ") || "-"}
                  </div>
                </div>

                <div className="p-2 rounded" style={{ border: "1px solid var(--color-light)" }}>
                  <div className="fw-bold small mb-2"><i className="fas fa-users me-2 text-muted" />ผู้พักอาศัยร่วม</div>
                  {fullProfile.coResidents.length === 0 ? (
                    <div className="text-muted small">ไม่มีผู้พักอาศัยร่วม</div>
                  ) : (
                    <div className="d-flex flex-column gap-2">
                      {fullProfile.coResidents.map((cr, i) => (
                        <div key={i} className="d-flex align-items-center gap-2">
                          <img
                            src={cr.image || AVATAR} alt={cr.name}
                            style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", cursor: "pointer", flexShrink: 0 }}
                            onError={(e) => { (e.target as HTMLImageElement).src = AVATAR; }}
                            onClick={() => { setLightboxImages([cr.image || AVATAR]); setLightboxIndex(0); }}
                          />
                          <div className="small">
                            <div className="fw-bold">คุณ{cr.name}</div>
                            <div className="text-muted">{[cr.phone, cr.lineId].filter(Boolean).join(" · ") || "-"}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-2 rounded" style={{ border: "1px solid var(--color-light)" }}>
                  <div className="fw-bold small mb-2"><i className="fas fa-car me-2 text-muted" />รถ</div>
                  {fullProfile.vehicles.length === 0 ? (
                    <div className="text-muted small">ไม่มีข้อมูลรถ</div>
                  ) : (
                    <div className="d-flex flex-column gap-2">
                      {fullProfile.vehicles.map((v) => (
                        <div key={v.id} className="small d-flex align-items-center gap-2">
                          <i className={`${v.typeIcon} text-muted`} />
                          <div className="flex-grow-1">
                            <div className="fw-bold">{v.licensePlate}</div>
                            <div className="text-muted">{[v.typeName, [v.brand, v.model].filter(Boolean).join(" "), v.color].filter(Boolean).join(" · ") || "-"}</div>
                          </div>
                          {v.images.length > 0 && (
                            <img
                              src={v.images[0]} alt="" style={{ width: 32, height: 32, objectFit: "cover", borderRadius: 6, cursor: "pointer" }}
                              onClick={() => { setLightboxImages(v.images); setLightboxIndex(0); }}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-2 rounded" style={{ border: "1px solid var(--color-light)" }}>
                  <div className="fw-bold small mb-2"><i className="fas fa-paperclip me-2 text-muted" />ไฟล์แนบ</div>
                  {fullProfile.files.length === 0 ? (
                    <div className="text-muted small">ไม่มีไฟล์แนบ</div>
                  ) : (
                    <div className="d-flex flex-column gap-1">
                      {fullProfile.files.map((f, i) => (
                        <a key={i} href={f.url} target="_blank" rel="noopener noreferrer" className="small d-flex align-items-center gap-2">
                          <i className="fas fa-file-pdf text-danger" />{f.name || `ไฟล์ ${i + 1}`}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )
          ) : tab === "bills" ? (
            bills.length === 0 ? (
              <div className="text-muted small text-center py-3">ยังไม่มีข้อมูลบิล</div>
            ) : bills.map((b) => (
              <div key={`${b.billId}-${b.roomId}`} className="p-2 rounded d-flex justify-content-between align-items-center" style={{ border: "1px solid var(--color-light)" }}>
                <div>
                  <div className="small fw-bold">{monthYearLabel(b.monthYear)}</div>
                  <BillStatusBadge bill={b} />
                </div>
                <div className="text-end">
                  <div className="small text-muted">{fmtMoney(b.total)} ฿</div>
                  <button className="btn btn-sm btn-outline-secondary mt-1" onClick={() => openDetail(b)}>ดูรายละเอียด</button>
                </div>
              </div>
            ))
          ) : (
            paymentHistory.length === 0 ? (
              <div className="text-muted small text-center py-3">ยังไม่มีประวัติการชำระ</div>
            ) : paymentHistory.map((p) => (
              <div key={p.id} className="p-2 rounded" style={{ border: "1px solid var(--color-light)", opacity: p.cancelled ? 0.5 : 1 }}>
                <div className="d-flex justify-content-between align-items-center">
                  <span className="small">{p.paymentDate ? thaiDateOnlyString(new Date(p.paymentDate)) : "-"} — {monthYearLabel(p.monthYear)}</span>
                  <span className="fw-bold">{fmtMoney(p.amount)} ฿</span>
                </div>
                <div className="d-flex justify-content-between align-items-center">
                  <div className="small text-muted">
                    {p.method === "scan" ? "สแกน/โอน" : "เงินสด"}{p.cancelled ? " · ยกเลิกแล้ว" : ""}{p.note ? ` · ${p.note}` : ""}
                  </div>
                  {p.slipUrl && (
                    <button className="btn btn-sm btn-outline-secondary py-0 px-2" onClick={() => setSlipToView(p.slipUrl)}>
                      <i className="fas fa-image me-1" />ดูสลิป
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {selectedBill && (
        <div className="confirm-overlay" onClick={() => setSelectedBill(null)}>
          <div className="confirm-dialog" style={{ maxWidth: 400, width: "92%", textAlign: "left", padding: 0, background: "transparent", boxShadow: "none" }} onClick={(e) => e.stopPropagation()}>
            {loadingDetail ? (
              <div className="text-center p-5" style={{ background: "#fff", borderRadius: 14 }}>
                <div className="spinner-border" style={{ color: "var(--color-primary)" }} />
              </div>
            ) : detailData ? (
              <BillLinePreview item={detailData.item} monthYear={detailData.monthYear} config={previewConfig} />
            ) : (
              <div className="room-modal-error p-3" style={{ background: "#fff", borderRadius: 14 }}>โหลดรายละเอียดบิลไม่สำเร็จ</div>
            )}
            <button className="btn btn-outline-secondary w-100 mt-2" onClick={() => setSelectedBill(null)}>ปิด</button>
          </div>
        </div>
      )}

      {slipToView && (
        <ImageLightbox images={[slipToView]} index={0} onClose={() => setSlipToView(null)} onIndexChange={() => {}} />
      )}

      {lightboxImages && (
        <ImageLightbox images={lightboxImages} index={lightboxIndex} onClose={() => setLightboxImages(null)} onIndexChange={setLightboxIndex} />
      )}
    </div>
  );
}
