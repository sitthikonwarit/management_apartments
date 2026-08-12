// หน้า LIFF Payment — ปลายทางของปุ่มชำระเงินบนเมนู Member (LIFF Payment URL ที่ตั้งค่าไว้ในหน้า Settings >
// LINE Rich Menu) แสดงรายการบิลค้างชำระแยกตามเดือน เลือกดูรายละเอียดหรือเลือกจำนวนเงินที่จะจ่ายรอบนี้เอง
// (จ่ายเป็นงวดได้ ไม่ต้องเต็มยอด) แล้วสร้าง QR PromptPay ระบุยอดนั้นผ่าน EasySlip — เมื่อส่งสลิปกลับเข้าแชท
// LINE ระบบจะตรวจสอบยอดอัตโนมัติและบันทึกยอดชำระ+ส่งใบเสร็จให้ทันทีถ้ายอดตรง (ดู backend/src/services/
// payments.ts) หน้านี้โพลสถานะเป็นระยะเพื่อโชว์ผลให้เห็นสดๆ โดยไม่ต้องรอใบเสร็จมาในแชทเงียบๆ
// ถ้ายังไม่ได้ตั้งค่า EasySlip API Key ไว้เลย จะ fallback ไปแสดง QR/เลขบัญชีคงที่แบบไม่ตรวจสลิปให้แทน — ถ้ามี
// API Key แต่ไม่มี PromptPay ID (เช่นผูกบัญชีธนาคารธรรมดาไว้ ไม่มี PromptPay ให้สร้าง QR จริง) ยังเลือกจำนวน
// เงิน+ตรวจสลิปอัตโนมัติได้เหมือนกัน แค่โชว์เลขบัญชีให้คัดลอกแทนรูป QR เท่านั้น
import { useEffect, useRef, useState } from "react";
import liff from "@line/liff";
import { liffApi } from "../api/client";
import { extractLiffId } from "../utils/liffHelpers";
import { monthYearLabel } from "../utils/billCalc";
import { BillLinePreview, type BillLinePreviewConfig } from "../components/BillLinePreviewCard";

type Status = "loading" | "linked" | "unlinked" | "error";

interface OutstandingItem {
  billId: string; roomId: string; monthYear: string; roomNumber: string;
  total: number; paidAmount: number; amount: number;
}

const POLL_INTERVAL_MS = 4000;
const POLL_MAX_ATTEMPTS = 75; // ~5 นาที

function fmtMoney(n: number) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n) || 0);
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function LiffPaymentPage() {
  // รหัสองค์กร (?org=<slug>) จาก Endpoint URL ของ LIFF app นี้เอง — ดูคอมเมนต์เดียวกันใน LiffLoginPage.tsx
  const org = new URLSearchParams(window.location.search).get("org") || undefined;
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [roomNumber, setRoomNumber] = useState("");
  const [items, setItems] = useState<OutstandingItem[]>([]);
  const [total, setTotal] = useState(0);
  const [paymentInfo, setPaymentInfo] = useState({
    bankName: "", accountName: "", accountNumber: "", qrImage: "", bankLogoUrl: "",
    autoTrackingAvailable: false, qrGenerationAvailable: false,
  });
  const [branding, setBranding] = useState({ logoUrl: "", nameText: "" });
  const [previewConfig, setPreviewConfig] = useState<BillLinePreviewConfig>({
    appIdentity: { logoUrl: "", logoBg: { enabled: false, color: "#ffffff" }, nameText: "" },
    features: { splitRentByResidents: false },
    overdue: { enabled: false, day: 5, type: "fixed", amount: 0 },
  });
  const [accessToken, setAccessToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [thisMonthNotice, setThisMonthNotice] = useState("");

  // ป็อปอัพ "จ่ายงวดนี้" — รวมรายละเอียดบิล (BillLinePreview หน้าตาเดียวกับ "บิลอิเล็กทรอนิกส์ (LINE)" ที่
  // พนักงานเห็นในหน้า Bills) ไว้ในป็อปอัพเดียวกับขั้นตอนเลือกจำนวนเงิน + สร้าง/แสดง QR + โพลสถานะ — เดิมแยก
  // เป็นสองปุ่ม/สองป็อปอัพ ("ดูรายละเอียด" กับ "จ่ายงวดนี้") รวมเป็นปุ่มเดียวให้เห็นรายละเอียดก่อนตัดสินใจจ่ายเลย
  const [payItem, setPayItem] = useState<OutstandingItem | null>(null);
  const [payBillDetail, setPayBillDetail] = useState<{ item: any; monthYear: string } | null>(null);
  const [loadingPayDetail, setLoadingPayDetail] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [generatingQr, setGeneratingQr] = useState(false);
  const [qrError, setQrError] = useState("");
  const [qrImage, setQrImage] = useState("");
  const [intentAccountInfo, setIntentAccountInfo] = useState<{ bankName: string; accountName: string; accountNumber: string } | null>(null);
  const [intentStarted, setIntentStarted] = useState(false);
  const [intentCopied, setIntentCopied] = useState(false);
  const [payStatus, setPayStatus] = useState<"" | "pending" | "confirmed">("");
  const [currentIntentId, setCurrentIntentId] = useState("");
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualSubmitted, setManualSubmitted] = useState(false);
  const [manualError, setManualError] = useState("");
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
  }

  useEffect(() => () => stopPolling(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await liffApi.getConfig(org);
        if (cancelled) return;
        setBranding({ logoUrl: cfg.appIdentity.logoUrl, nameText: cfg.appIdentity.nameText });
        setPreviewConfig({ appIdentity: cfg.appIdentity, features: cfg.features, overdue: cfg.overdue });

        const liffId = extractLiffId(cfg.liffPaymentUrl);
        if (!liffId) { setErrorMsg("ระบบยังไม่ได้ตั้งค่า LIFF Payment URL กรุณาติดต่อผู้ดูแลระบบ"); setStatus("error"); return; }

        await liff.init({ liffId });
        if (!liff.isLoggedIn()) { liff.login(); return; }

        const token = liff.getAccessToken();
        if (!token) { setErrorMsg("ไม่พบ Access Token จาก LINE กรุณาลองใหม่อีกครั้ง"); setStatus("error"); return; }
        setAccessToken(token);
        liffApi.notifyPresence(token, "payment", org);

        const result = await liffApi.payment(token, org);
        if (cancelled) return;
        if (result.linked) {
          setTenantName(result.tenantName);
          setRoomNumber(result.roomNumber);
          setItems(result.outstanding.items);
          setTotal(result.outstanding.total);
          setPaymentInfo(result.paymentInfo);
          setStatus("linked");

          // เปิดมาจากลิงก์ "ดูรายละเอียดบิล & ชำระเงิน" ที่แนบมากับบิลที่ส่งเข้าแชท (ดู buildBillFlexMessage
          // ใน backend/src/services/line.ts) หรือปุ่ม "บิลเดือนนี้" บนเมนู Member — เปิดป็อปอัพ "จ่ายงวดนี้"
          // (ซึ่งตอนนี้โชว์รายละเอียดบิลอยู่ในตัวแล้ว) ให้ทันที ไม่ต้องรอผู้เช่าไล่หาเอง เคลียร์ query string
          // ทิ้งกันเปิดซ้ำถ้าผู้เช่ากดรีเฟรชหน้าเอง
          const params = new URLSearchParams(window.location.search);
          const linkedBillId = params.get("billId");
          const linkedRoomId = params.get("roomId");
          const wantsThisMonth = params.get("view") === "thisMonth";
          if (linkedBillId && linkedRoomId) {
            window.history.replaceState(null, "", window.location.pathname);
            // เรียก billDetail ตรงๆ ด้วย token ในสโคปนี้ (ไม่เรียกผ่าน openPay เพราะฟังก์ชันนั้นอ่าน
            // accessToken จาก state ซึ่งเพิ่งสั่ง setAccessToken(token) ไปหมาดๆ ข้างบน ยังไม่อัปเดตจริงในรอบ
            // render นี้ ใช้ตัวแปร token ที่เพิ่งได้มาสดๆ แทนกันข้อมูลว่าง)
            setPayItem({ billId: linkedBillId, roomId: linkedRoomId, monthYear: "", roomNumber: "", total: 0, paidAmount: 0, amount: 0 });
            setPayBillDetail(null);
            setLoadingPayDetail(true);
            liffApi.billDetail(token, linkedBillId, linkedRoomId, org)
              .then((r) => { if (!cancelled) applyPayDetail(linkedBillId, linkedRoomId, r); })
              .catch(() => { if (!cancelled) setPayBillDetail(null); })
              .finally(() => { if (!cancelled) setLoadingPayDetail(false); });
          } else if (wantsThisMonth) {
            // ปุ่ม "บิลเดือนนี้" บนเมนู Member (ดู memberAreas ใน backend/src/services/richMenu.ts) — ไม่รู้
            // billId/roomId ล่วงหน้า (เมนูเป็น URL เดียวใช้ร่วมกันทุกคน) ต้องยิงถามฝั่ง backend เองว่า "เดือนนี้"
            // ของผู้เช่าคนนี้คือบิลใบไหน ได้ item/monthYear มาพร้อมกันในคำตอบเดียวเลย ไม่ต้องเรียก billDetail ซ้ำ
            window.history.replaceState(null, "", window.location.pathname);
            setPayItem({ billId: "", roomId: "", monthYear: "", roomNumber: "", total: 0, paidAmount: 0, amount: 0 });
            setPayBillDetail(null);
            setLoadingPayDetail(true);
            liffApi.billDetailThisMonth(token, org)
              .then((r) => { if (!cancelled) applyPayDetail(r.billId, r.roomId, r); })
              .catch((e: any) => {
                if (cancelled) return;
                setPayItem(null);
                setThisMonthNotice(e?.response?.data?.error ?? "ยังไม่มีบิลของคุณประจำเดือนนี้ในระบบ");
              })
              .finally(() => { if (!cancelled) setLoadingPayDetail(false); });
          }
        } else {
          setStatus("unlinked");
        }
      } catch (e: any) {
        if (cancelled) return;
        setErrorMsg(e?.response?.data?.error ?? e?.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
        setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function refreshOutstanding() {
    try {
      const result = await liffApi.payment(accessToken, org);
      if (result.linked) { setItems(result.outstanding.items); setTotal(result.outstanding.total); }
    } catch {
      // รีเฟรชพื้นหลังไม่สำเร็จไม่เป็นไร ผู้เช่าจะได้ใบเสร็จทางแชทอยู่แล้ว
    }
  }

  // อัปเดต payItem ด้วยยอดจริงจากรายละเอียดบิลที่โหลดมา (total/paidAmount/ยอดคงเหลือ) — ใช้ทั้งตอนกดปุ่ม
  // "จ่าย" จากรายการปกติ (ซึ่งรู้ยอดคร่าวๆ จากหน้ายอดค้างชำระอยู่แล้ว แต่ยังต้องรอโหลดรายละเอียดฉบับเต็ม) และ
  // ตอนเปิดมาจากลิงก์ภายนอกที่ยังไม่รู้ยอดอะไรเลยจนกว่าจะโหลดเสร็จ (ดู useEffect ด้านบน)
  function applyPayDetail(billId: string, roomId: string, r: { item: any; monthYear: string }) {
    setPayBillDetail(r);
    const total = Number(r.item?.total) || 0;
    const paidAmount = Number(r.item?.paidAmount) || 0;
    const remaining = Math.max(0, total - paidAmount);
    setPayItem({ billId, roomId, monthYear: r.monthYear, roomNumber: String(r.item?.roomNumber ?? ""), total, paidAmount, amount: remaining });
    setPayAmount(String(remaining));
  }

  function openPay(item: OutstandingItem) {
    setPayItem(item);
    setPayAmount(String(item.amount));
    setPayBillDetail(null);
    setQrImage(""); setIntentAccountInfo(null); setIntentStarted(false); setQrError(""); setPayStatus("");
    setCurrentIntentId(""); setManualSubmitting(false); setManualSubmitted(false); setManualError("");
    stopPolling();

    setLoadingPayDetail(true);
    liffApi.billDetail(accessToken, item.billId, item.roomId, org)
      .then((r) => setPayBillDetail(r))
      .catch(() => setPayBillDetail(null))
      .finally(() => setLoadingPayDetail(false));
  }

  function closePay() {
    stopPolling();
    setPayItem(null);
    setPayBillDetail(null);
  }

  async function handleGenerateQr() {
    if (!payItem) return;
    const amountNum = Number(payAmount);
    if (!amountNum || amountNum <= 0 || amountNum > payItem.amount + 0.5) {
      setQrError(`กรอกจำนวนเงินระหว่าง 1 - ${fmtMoney(payItem.amount)} บาท`);
      return;
    }
    setGeneratingQr(true); setQrError("");
    try {
      const result = await liffApi.generateQr(accessToken, payItem.billId, payItem.roomId, amountNum, org);
      setQrImage(result.qrImage || "");
      setIntentAccountInfo(result.accountInfo);
      setIntentStarted(true);
      setPayStatus("pending");
      setCurrentIntentId(result.intentId);
      let attempts = 0;
      pollTimer.current = setInterval(async () => {
        attempts++;
        try {
          const s = await liffApi.paymentStatus(accessToken, result.intentId, org);
          if (s.status === "confirmed") {
            setPayStatus("confirmed");
            stopPolling();
            refreshOutstanding();
          }
        } catch {
          // เช็คสถานะพลาดรอบนี้ไม่เป็นไร รอบถัดไปลองใหม่
        }
        if (attempts >= POLL_MAX_ATTEMPTS) stopPolling();
      }, POLL_INTERVAL_MS);
    } catch (e: any) {
      setQrError(e?.response?.data?.error ?? e?.message ?? "สร้าง QR ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setGeneratingQr(false);
    }
  }

  async function handleManualConfirm(file: File) {
    if (!currentIntentId) return;
    setManualSubmitting(true); setManualError("");
    try {
      const base64 = await readFileAsBase64(file);
      await liffApi.confirmPayment(accessToken, currentIntentId, base64, org);
      setManualSubmitted(true);
    } catch (e: any) {
      setManualError(e?.response?.data?.error ?? e?.message ?? "ส่งสลิปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setManualSubmitting(false);
    }
  }

  function copyAccountNumber() {
    navigator.clipboard.writeText(paymentInfo.accountNumber);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function copyIntentAccountNumber() {
    if (!intentAccountInfo) return;
    navigator.clipboard.writeText(intentAccountInfo.accountNumber);
    setIntentCopied(true);
    setTimeout(() => setIntentCopied(false), 2000);
  }

  if (status === "loading" || status === "error" || status === "unlinked") {
    return (
      <div className="login-page-wrap">
        <div className="login-card custom-card text-center">
          {branding.logoUrl
            ? <img src={branding.logoUrl} alt="" style={{ width: 56, height: 56, objectFit: "contain", borderRadius: "50%", margin: "0 auto", display: "block" }} />
            : <div className="login-icon"><i className="fas fa-wallet" /></div>}
          <h5 className="mt-3 mb-1" style={{ fontWeight: 700 }}>{branding.nameText || "ชำระเงิน"}</h5>
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

  const fullySettled = total <= 0.005;

  return (
    <div className="login-page-wrap">
      <div className="login-card custom-card" style={{ maxWidth: 440 }}>
        <div className="text-center mb-3">
          {branding.logoUrl
            ? <img src={branding.logoUrl} alt="" style={{ width: 56, height: 56, objectFit: "contain", borderRadius: "50%", margin: "0 auto", display: "block" }} />
            : <div className="login-icon"><i className="fas fa-wallet" /></div>}
          <h5 className="mt-3 mb-1" style={{ fontWeight: 700 }}>{tenantName}{roomNumber && ` · ห้อง ${roomNumber}`}</h5>
        </div>

        {thisMonthNotice && (
          <div className="alert alert-light border small d-flex justify-content-between align-items-center mb-3">
            <span><i className="fas fa-circle-info me-1" />{thisMonthNotice}</span>
            <button type="button" className="btn-close" style={{ fontSize: 11 }} onClick={() => setThisMonthNotice("")} />
          </div>
        )}

        {fullySettled ? (
          <div className="alert alert-success text-center py-3 mb-0">
            <i className="fas fa-check-circle me-2" />ไม่มียอดค้างชำระในขณะนี้
          </div>
        ) : paymentInfo.autoTrackingAvailable ? (
          <>
            <div className="d-flex justify-content-between align-items-center small text-muted mb-2">
              <span>ยอดค้างชำระทั้งหมด</span>
              <span className="fw-bold fs-6" style={{ color: "var(--color-primary)" }}>{fmtMoney(total)} ฿</span>
            </div>
            <div className="d-flex flex-column gap-2">
              {items.map((it) => (
                <div key={`${it.billId}-${it.roomId}`} className="p-2 rounded" style={{ border: "1px solid var(--color-light)" }}>
                  <div className="d-flex justify-content-between align-items-center">
                    <span className="small">{monthYearLabel(it.monthYear)}</span>
                    <span className="fw-bold">{fmtMoney(it.amount)} ฿</span>
                  </div>
                  {it.paidAmount > 0 && (
                    <div className="d-flex justify-content-between align-items-center small text-success">
                      <span><i className="fas fa-check-circle me-1" />ชำระไปแล้ว</span>
                      <span>{fmtMoney(it.paidAmount)} ฿ / {fmtMoney(it.total)} ฿</span>
                    </div>
                  )}
                  <button className="btn btn-sm btn-primary w-100 mt-2" onClick={() => openPay(it)}>
                    <i className="fas fa-qrcode me-1" />จ่ายงวดนี้
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="p-3 rounded mb-3" style={{ background: "var(--color-background)", border: "1px solid var(--color-light)" }}>
              {items.map((it) => (
                <div key={`${it.billId}-${it.roomId}`} className="mb-1">
                  <div className="d-flex justify-content-between small">
                    <span className="text-muted">{monthYearLabel(it.monthYear)}</span>
                    <span>{fmtMoney(it.amount)} ฿</span>
                  </div>
                  {it.paidAmount > 0 && (
                    <div className="d-flex justify-content-between text-success" style={{ fontSize: 11 }}>
                      <span>ชำระไปแล้ว</span>
                      <span>{fmtMoney(it.paidAmount)} ฿ / {fmtMoney(it.total)} ฿</span>
                    </div>
                  )}
                </div>
              ))}
              <hr className="my-2" />
              <div className="d-flex justify-content-between align-items-center">
                <span className="fw-bold">ยอดค้างชำระรวม</span>
                <span className="fw-bold fs-4" style={{ color: "var(--color-primary)" }}>{fmtMoney(total)} ฿</span>
              </div>
            </div>
            {(paymentInfo.qrImage || paymentInfo.accountNumber) ? (
              <div className="text-center">
                {paymentInfo.qrImage && (
                  <img src={paymentInfo.qrImage} alt="QR รับเงิน" style={{ width: "100%", maxWidth: 260, borderRadius: 8, border: "1px solid var(--color-light)" }} />
                )}
                {paymentInfo.accountNumber && (
                  <div className="mt-3 text-start">
                    {(paymentInfo.bankName || paymentInfo.bankLogoUrl) && (
                      <div className="d-flex align-items-center gap-2 mb-1">
                        {paymentInfo.bankLogoUrl && (
                          <div style={{ width: 32, height: 32, borderRadius: "50%", overflow: "hidden", background: "#fff", border: "1px solid var(--color-light)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <img src={paymentInfo.bankLogoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                          </div>
                        )}
                        {paymentInfo.bankName && <span className="fw-semibold fs-6">{paymentInfo.bankName}</span>}
                      </div>
                    )}
                    {paymentInfo.accountName && <div className="fw-semibold mb-1">{paymentInfo.accountName}</div>}
                    <div className="input-group mt-1">
                      <input type="text" className="form-control font-monospace" readOnly value={paymentInfo.accountNumber} />
                      <button className="btn btn-outline-secondary" type="button" onClick={copyAccountNumber} title="คัดลอกเลขบัญชี">
                        <i className={`fas ${copied ? "fa-check" : "fa-copy"}`} />
                      </button>
                    </div>
                  </div>
                )}
                <div className="alert alert-light border small mt-3 mb-0">
                  โอนเงินแล้วส่งรูปสลิปกลับมาที่แชทนี้ได้เลย พนักงานจะตรวจสอบและอัปเดตยอดให้
                </div>
              </div>
            ) : (
              <div className="alert alert-light border small mb-0">ยังไม่ได้ตั้งค่าข้อมูลบัญชีรับชำระเงิน กรุณาติดต่อผู้ดูแลหอพัก</div>
            )}
          </>
        )}
      </div>

      {payItem && (
        <div className="confirm-overlay" onClick={() => !generatingQr && closePay()}>
          {/* ไม่ใช้ padding/background/shadow ของ .confirm-dialog เริ่มต้น (ปล่อยโปร่งใส) เพราะ BillLinePreview
              มีกรอบ/เงา/มุมโค้งของตัวเองอยู่แล้ว — ถ้าห่อด้วย .confirm-dialog ปกติอีกชั้นจะกลายเป็นกรอบซ้อนกรอบ
              บีบพื้นที่เนื้อหาข้างในให้แคบลงโดยไม่จำเป็น ส่วนขั้นตอนจ่ายเงิน/QR ด้านล่างมีกล่องขาวเป็นของตัวเองแยก
              ต่างหาก ไม่ได้พึ่ง padding ของ .confirm-dialog เหมือนกัน */}
          <div
            className="confirm-dialog"
            style={{ maxWidth: 400, width: "92%", textAlign: "left", position: "relative", maxHeight: "88vh", overflowY: "auto", padding: 0, background: "transparent", boxShadow: "none" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* ปุ่มปิดแบบกากะบาทลอยมุมขวาบน ทับหัวการ์ดบิล (พื้นสีทึบ) เหมือนปุ่มปิดใน ImageLightbox — แทนที่
                ปุ่ม "ปิด" แบบข้อความเดิม */}
            <button className="lightbox-close" onClick={closePay} style={{ top: "0.6rem", right: "0.6rem", width: "2rem", height: "2rem", fontSize: "1.1rem", zIndex: 2 }}>
              <i className="fas fa-times" />
            </button>

            {loadingPayDetail ? (
              <div className="text-center py-5" style={{ background: "#fff", borderRadius: "var(--border-radius-2)" }}>
                <div className="spinner-border" style={{ color: "var(--color-primary)" }} />
              </div>
            ) : (
              <>
                <div className="mb-3">
                  {payBillDetail ? (
                    <BillLinePreview item={payBillDetail.item} monthYear={payBillDetail.monthYear} config={previewConfig} />
                  ) : (
                    <div className="room-modal-error p-3" style={{ background: "#fff", borderRadius: "var(--border-radius-2)" }}>โหลดรายละเอียดบิลไม่สำเร็จ</div>
                  )}
                </div>

                <div style={{ background: "#fff", borderRadius: "var(--border-radius-2)", boxShadow: "0 4px 12px rgba(0,0,0,0.08)", padding: "16px" }}>
                {payStatus === "confirmed" ? (
                  <div className="text-center py-3">
                    <div className="login-icon mb-3" style={{ background: "rgba(27,156,133,0.15)", color: "var(--color-success)" }}>
                      <i className="fas fa-check-circle" />
                    </div>
                    <div className="alert alert-success py-2 px-3 small mb-0">ตรวจสลิปสำเร็จ บันทึกยอดชำระเรียบร้อยแล้ว ใบเสร็จส่งเข้าแชทให้แล้ว</div>
                  </div>
                ) : intentStarted ? (
                  <div className="text-center">
                    {qrImage ? (
                      <img src={qrImage} alt="QR ชำระเงิน" style={{ width: "100%", maxWidth: 260, borderRadius: 8, border: "1px solid var(--color-light)" }} />
                    ) : intentAccountInfo && (
                      <div className="text-start">
                        {(intentAccountInfo.bankName || paymentInfo.bankLogoUrl) && (
                          <div className="d-flex align-items-center gap-2 mb-1">
                            {paymentInfo.bankLogoUrl && (
                              <div style={{ width: 32, height: 32, borderRadius: "50%", overflow: "hidden", background: "#fff", border: "1px solid var(--color-light)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <img src={paymentInfo.bankLogoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                              </div>
                            )}
                            {intentAccountInfo.bankName && <span className="fw-semibold fs-6">{intentAccountInfo.bankName}</span>}
                          </div>
                        )}
                        {intentAccountInfo.accountName && <div className="fw-semibold mb-1">{intentAccountInfo.accountName}</div>}
                        <div className="input-group mt-1">
                          <input type="text" className="form-control font-monospace" readOnly value={intentAccountInfo.accountNumber} />
                          <button className="btn btn-outline-secondary" type="button" onClick={copyIntentAccountNumber} title="คัดลอกเลขบัญชี">
                            <i className={`fas ${intentCopied ? "fa-check" : "fa-copy"}`} />
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="fw-bold fs-5 mt-2" style={{ color: "var(--color-primary)" }}>{fmtMoney(Number(payAmount))} ฿</div>
                    <div className="alert alert-light border small mt-3 mb-2">
                      {payStatus === "pending"
                        ? <><span className="spinner-border spinner-border-sm me-2" />กำลังรอตรวจสลิป — {qrImage ? "สแกนแล้ว" : ""}โอนเงินตามยอดนี้ จากนั้นส่งรูปสลิปกลับมาที่แชทนี้ได้เลย ระบบจะตรวจและอัปเดตให้อัตโนมัติ</>
                        : `${qrImage ? "สแกนแล้ว" : ""}โอนเงินตามยอดนี้ จากนั้นส่งรูปสลิปกลับมาที่แชทนี้ได้เลย`}
                    </div>
                    {payStatus === "pending" && (
                      manualSubmitted ? (
                        <div className="alert alert-light border small mb-0">
                          <i className="fas fa-paper-plane me-1" />ส่งสลิปให้พนักงานตรวจสอบแล้ว รอการยืนยัน
                        </div>
                      ) : (
                        <div className="mb-0">
                          <label className="btn btn-outline-secondary btn-sm w-100 mb-0" style={{ cursor: manualSubmitting ? "default" : "pointer" }}>
                            {manualSubmitting
                              ? <><span className="spinner-border spinner-border-sm me-2" />กำลังส่ง...</>
                              : <><i className="fas fa-paperclip me-1" />ตรวจสลิปอัตโนมัติไม่สำเร็จ? แนบสลิปยืนยันด้วยตนเอง</>}
                            <input type="file" accept="image/*" hidden disabled={manualSubmitting}
                              onChange={(e) => { if (e.target.files?.[0]) handleManualConfirm(e.target.files[0]); e.target.value = ""; }} />
                          </label>
                          {manualError && <div className="room-modal-error mt-2"><i className="fas fa-exclamation-circle me-2" />{manualError}</div>}
                        </div>
                      )
                    )}
                  </div>
                ) : payItem.amount <= 0 ? (
                  <div className="alert alert-success text-center py-2 small mb-0">
                    <i className="fas fa-check-circle me-2" />บิลนี้ชำระครบถ้วนแล้ว ไม่มียอดค้างชำระ
                  </div>
                ) : (
                  <>
                    <p className="text-muted small mb-2">ยอดค้างชำระงวดนี้ {fmtMoney(payItem.amount)} ฿ — จะจ่ายเต็มหรือบางส่วนก็ได้</p>
                    <div className="input-group mb-2">
                      <input type="number" className="form-control" min={1} max={payItem.amount}
                        value={payAmount} onChange={(e) => setPayAmount(e.target.value)} disabled={generatingQr} />
                      <span className="input-group-text">บาท</span>
                    </div>
                    {qrError && <div className="room-modal-error mb-2"><i className="fas fa-exclamation-circle me-2" />{qrError}</div>}
                    <div className="confirm-actions">
                      <button className="btn btn-outline-secondary" onClick={closePay} disabled={generatingQr}>ยกเลิก</button>
                      <button className="btn btn-primary" onClick={handleGenerateQr} disabled={generatingQr}>
                        {generatingQr
                          ? <><span className="spinner-border spinner-border-sm me-2" />กำลังดำเนินการ...</>
                          : paymentInfo.qrGenerationAvailable
                            ? <><i className="fas fa-qrcode me-1" />สร้าง QR</>
                            : <><i className="fas fa-check me-1" />ยืนยันจำนวนเงิน</>}
                      </button>
                    </div>
                  </>
                )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
