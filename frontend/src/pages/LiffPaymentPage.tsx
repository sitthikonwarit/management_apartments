// หน้า LIFF Payment — ปลายทางของปุ่มชำระเงินบนเมนู Member (LIFF Payment URL ที่ตั้งค่าไว้ในหน้า Settings >
// LINE Rich Menu) แสดงรายการบิลค้างชำระแยกตามเดือน เลือกดูรายละเอียดหรือเลือกจำนวนเงินที่จะจ่ายรอบนี้เอง
// (จ่ายเป็นงวดได้ ไม่ต้องเต็มยอด) แล้วสร้าง QR PromptPay ระบุยอดนั้นผ่าน EasySlip — เมื่อส่งสลิปกลับเข้าแชท
// LINE ระบบจะตรวจสอบยอดอัตโนมัติและบันทึกยอดชำระ+ส่งใบเสร็จให้ทันทีถ้ายอดตรง (ดู backend/src/services/
// payments.ts) หน้านี้โพลสถานะเป็นระยะเพื่อโชว์ผลให้เห็นสดๆ โดยไม่ต้องรอใบเสร็จมาในแชทเงียบๆ
// ถ้ายังไม่ได้ตั้งค่า EasySlip ไว้ (dynamicQrAvailable = false) จะ fallback ไปแสดง QR/เลขบัญชีคงที่แทน
import { useEffect, useRef, useState } from "react";
import liff from "@line/liff";
import { liffApi } from "../api/client";
import { extractLiffId } from "../utils/liffHelpers";
import { monthYearLabel } from "../utils/billCalc";
import { ChatBillMessage } from "../components/ChatBillCard";

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

export default function LiffPaymentPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [roomNumber, setRoomNumber] = useState("");
  const [items, setItems] = useState<OutstandingItem[]>([]);
  const [total, setTotal] = useState(0);
  const [paymentInfo, setPaymentInfo] = useState({ bankName: "", accountName: "", accountNumber: "", qrImage: "", dynamicQrAvailable: false });
  const [branding, setBranding] = useState({ logoUrl: "", nameText: "" });
  const [accessToken, setAccessToken] = useState("");
  const [copied, setCopied] = useState(false);

  // ป็อปอัพ "ดูรายละเอียดบิล"
  const [detailItem, setDetailItem] = useState<OutstandingItem | null>(null);
  const [detailSnapshot, setDetailSnapshot] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // ป็อปอัพ "จ่ายงวดนี้" — เลือกจำนวนเงิน + สร้าง/แสดง QR + โพลสถานะ
  const [payItem, setPayItem] = useState<OutstandingItem | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [generatingQr, setGeneratingQr] = useState(false);
  const [qrError, setQrError] = useState("");
  const [qrImage, setQrImage] = useState("");
  const [payStatus, setPayStatus] = useState<"" | "pending" | "confirmed">("");
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
  }

  useEffect(() => () => stopPolling(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await liffApi.getConfig();
        if (cancelled) return;
        setBranding({ logoUrl: cfg.appIdentity.logoUrl, nameText: cfg.appIdentity.nameText });

        const liffId = extractLiffId(cfg.liffPaymentUrl);
        if (!liffId) { setErrorMsg("ระบบยังไม่ได้ตั้งค่า LIFF Payment URL กรุณาติดต่อผู้ดูแลระบบ"); setStatus("error"); return; }

        await liff.init({ liffId });
        if (!liff.isLoggedIn()) { liff.login(); return; }

        const token = liff.getAccessToken();
        if (!token) { setErrorMsg("ไม่พบ Access Token จาก LINE กรุณาลองใหม่อีกครั้ง"); setStatus("error"); return; }
        setAccessToken(token);

        const result = await liffApi.payment(token);
        if (cancelled) return;
        if (result.linked) {
          setTenantName(result.tenantName);
          setRoomNumber(result.roomNumber);
          setItems(result.outstanding.items);
          setTotal(result.outstanding.total);
          setPaymentInfo(result.paymentInfo);
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
    return () => { cancelled = true; };
  }, []);

  async function refreshOutstanding() {
    try {
      const result = await liffApi.payment(accessToken);
      if (result.linked) { setItems(result.outstanding.items); setTotal(result.outstanding.total); }
    } catch {
      // รีเฟรชพื้นหลังไม่สำเร็จไม่เป็นไร ผู้เช่าจะได้ใบเสร็จทางแชทอยู่แล้ว
    }
  }

  async function openDetail(item: OutstandingItem) {
    setDetailItem(item);
    setDetailSnapshot(null);
    setLoadingDetail(true);
    try {
      const { snapshot } = await liffApi.billDetail(accessToken, item.billId, item.roomId);
      setDetailSnapshot(snapshot);
    } catch (e: any) {
      setDetailSnapshot(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  function openPay(item: OutstandingItem) {
    setPayItem(item);
    setPayAmount(String(item.amount));
    setQrImage(""); setQrError(""); setPayStatus("");
    stopPolling();
  }

  function closePay() {
    stopPolling();
    setPayItem(null);
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
      const result = await liffApi.generateQr(accessToken, payItem.billId, payItem.roomId, amountNum);
      setQrImage(result.qrImage);
      setPayStatus("pending");
      let attempts = 0;
      pollTimer.current = setInterval(async () => {
        attempts++;
        try {
          const s = await liffApi.paymentStatus(accessToken, result.intentId);
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

  function copyAccountNumber() {
    navigator.clipboard.writeText(paymentInfo.accountNumber);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

        {fullySettled ? (
          <div className="alert alert-success text-center py-3 mb-0">
            <i className="fas fa-check-circle me-2" />ไม่มียอดค้างชำระในขณะนี้
          </div>
        ) : paymentInfo.dynamicQrAvailable ? (
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
                  <div className="d-flex gap-2 mt-2">
                    <button className="btn btn-sm btn-outline-secondary flex-grow-1" onClick={() => openDetail(it)}>
                      <i className="fas fa-list-ul me-1" />ดูรายละเอียด
                    </button>
                    <button className="btn btn-sm btn-primary flex-grow-1" onClick={() => openPay(it)}>
                      <i className="fas fa-qrcode me-1" />จ่ายงวดนี้
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="p-3 rounded mb-3" style={{ background: "var(--color-background)", border: "1px solid var(--color-light)" }}>
              {items.map((it) => (
                <div key={`${it.billId}-${it.roomId}`} className="d-flex justify-content-between small mb-1">
                  <span className="text-muted">{monthYearLabel(it.monthYear)}</span>
                  <span>{fmtMoney(it.amount)} ฿</span>
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
                  <div className="mt-3 text-start small">
                    {paymentInfo.bankName && <div className="text-muted">ธนาคาร: {paymentInfo.bankName}</div>}
                    {paymentInfo.accountName && <div className="text-muted">ชื่อบัญชี: {paymentInfo.accountName}</div>}
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

      {detailItem && (
        <div className="confirm-overlay" onClick={() => setDetailItem(null)}>
          <div className="confirm-dialog" style={{ maxWidth: 340, width: "92%", textAlign: "left", padding: 0, background: "transparent", boxShadow: "none" }} onClick={(e) => e.stopPropagation()}>
            {loadingDetail ? (
              <div className="text-center p-5" style={{ background: "#fff", borderRadius: 14 }}>
                <div className="spinner-border" style={{ color: "var(--color-primary)" }} />
              </div>
            ) : detailSnapshot ? (
              <ChatBillMessage messageType="bill" raw={JSON.stringify(detailSnapshot)} />
            ) : (
              <div className="room-modal-error p-3" style={{ background: "#fff", borderRadius: 14 }}>โหลดรายละเอียดบิลไม่สำเร็จ</div>
            )}
            <button className="btn btn-outline-secondary w-100 mt-2" onClick={() => setDetailItem(null)}>ปิด</button>
          </div>
        </div>
      )}

      {payItem && (
        <div className="confirm-overlay" onClick={() => !generatingQr && closePay()}>
          <div className="confirm-dialog" style={{ maxWidth: 360, width: "92%", textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
            <h6 className="confirm-title" style={{ textAlign: "left" }}>ชำระค่าเช่า {monthYearLabel(payItem.monthYear)}</h6>

            {payStatus === "confirmed" ? (
              <div className="text-center py-3">
                <div className="login-icon mb-3" style={{ background: "rgba(27,156,133,0.15)", color: "var(--color-success)" }}>
                  <i className="fas fa-check-circle" />
                </div>
                <div className="alert alert-success py-2 px-3 small mb-3">ตรวจสลิปสำเร็จ บันทึกยอดชำระเรียบร้อยแล้ว ใบเสร็จส่งเข้าแชทให้แล้ว</div>
                <button className="btn btn-primary w-100" onClick={closePay}>ปิด</button>
              </div>
            ) : qrImage ? (
              <div className="text-center">
                <img src={qrImage} alt="QR ชำระเงิน" style={{ width: "100%", maxWidth: 260, borderRadius: 8, border: "1px solid var(--color-light)" }} />
                <div className="fw-bold fs-5 mt-2" style={{ color: "var(--color-primary)" }}>{fmtMoney(Number(payAmount))} ฿</div>
                <div className="alert alert-light border small mt-3 mb-2">
                  {payStatus === "pending"
                    ? <><span className="spinner-border spinner-border-sm me-2" />กำลังรอตรวจสลิป — สแกนแล้วโอนเงิน จากนั้นส่งรูปสลิปกลับมาที่แชทนี้ได้เลย ระบบจะตรวจและอัปเดตให้อัตโนมัติ</>
                    : "สแกนแล้วโอนเงิน จากนั้นส่งรูปสลิปกลับมาที่แชทนี้ได้เลย"}
                </div>
                <button className="btn btn-outline-secondary w-100" onClick={closePay}>ปิด</button>
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
                      ? <><span className="spinner-border spinner-border-sm me-2" />กำลังสร้าง QR...</>
                      : <><i className="fas fa-qrcode me-1" />สร้าง QR</>}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
