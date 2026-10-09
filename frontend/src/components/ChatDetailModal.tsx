import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { chatApi, type ChatConversationInfo, type ChatMessage, type OutstandingBillItem } from "../api/client";
import { monthYearLabel } from "../utils/billCalc";
import { thaiDateTimeString } from "../utils/yearFormat";
import { toastError, toastSuccess } from "../utils/toast";
import { AVATAR_URL } from "./TenantTableView";
import ImageLightbox from "./ImageLightbox";
import PrivacyMask from "./PrivacyMask";
import PrivacyAvatar from "./PrivacyAvatar";

export type ChatDetailTab = "info" | "bills" | "images" | "files" | "search";

const TABS: { key: ChatDetailTab; label: string; icon: string }[] = [
  { key: "info", label: "ข้อมูล", icon: "fa-circle-info" },
  { key: "bills", label: "บิลค้าง", icon: "fa-file-invoice-dollar" },
  { key: "images", label: "รูปภาพ", icon: "fa-image" },
  { key: "files", label: "ไฟล์", icon: "fa-paperclip" },
  { key: "search", label: "ค้นหาข้อความ", icon: "fa-magnifying-glass" },
];

function fmtMoney(n: number) {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(n || 0);
}

interface ChatDetailModalProps {
  lineUserId: string;
  displayName: string;
  pictureUrl: string | null;
  messages: ChatMessage[];
  initialTab: ChatDetailTab;
  onClose: () => void;
  onJumpToMessage: (messageId: string) => void;
}

export default function ChatDetailModal({ lineUserId, displayName, pictureUrl, messages, initialTab, onClose, onJumpToMessage }: ChatDetailModalProps) {
  const [tab, setTab] = useState<ChatDetailTab>(initialTab);

  return (
    <div className="room-select-modal-overlay show" style={{ zIndex: 1060 }} onClick={onClose}>
      <div className="room-select-modal-content" style={{ maxWidth: 520, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="import-modal-header">
          <h5>รายละเอียดการสนทนา</h5>
          <button type="button" className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="d-flex" style={{ borderBottom: "1px solid var(--color-light)" }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="btn btn-sm flex-fill"
              style={{
                borderRadius: 0, border: "none", background: "transparent",
                borderBottom: tab === t.key ? "2px solid var(--color-primary)" : "2px solid transparent",
                color: tab === t.key ? "var(--color-primary)" : "var(--color-dark-variant)",
                fontWeight: tab === t.key ? 600 : 400,
              }}
            >
              <i className={`fas ${t.icon} d-block mb-1`} />
              <span style={{ fontSize: 12 }}>{t.label}</span>
            </button>
          ))}
        </div>
        <div className="import-modal-body" style={{ minHeight: 280, maxHeight: "60vh" }}>
          {tab === "info" && <InfoTab lineUserId={lineUserId} displayName={displayName} pictureUrl={pictureUrl} />}
          {tab === "bills" && <BillsTab lineUserId={lineUserId} />}
          {tab === "images" && <ImagesTab messages={messages} />}
          {tab === "files" && <FilesTab messages={messages} />}
          {tab === "search" && (
            <SearchTab messages={messages} onJump={(id) => { onJumpToMessage(id); onClose(); }} />
          )}
        </div>
      </div>
    </div>
  );
}

function InfoTab({ lineUserId, displayName, pictureUrl }: { lineUserId: string; displayName: string; pictureUrl: string | null }) {
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<ChatConversationInfo | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    chatApi.getConversationInfo(lineUserId)
      .then((res) => { if (alive) setInfo(res); })
      .catch(() => { if (alive) toastError("โหลดข้อมูลการสนทนาไม่สำเร็จ"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [lineUserId]);

  function copyUid() {
    navigator.clipboard.writeText(lineUserId).then(() => toastSuccess("คัดลอก LINE UID แล้ว")).catch(() => toastError("คัดลอกไม่สำเร็จ"));
  }

  const picture = info?.pictureUrl || pictureUrl;
  // contactName = เจ้าของบทสนทนานี้จริงๆ (อาจเป็นผู้ร่วมพักอาศัย ไม่ใช่ผู้ทำสัญญาหลักเสมอไป — ดู
  // GET /chat/conversations/:lineUserId/info) ต่างจาก info.tenant.fullName ที่ยังคงเป็นผู้ทำสัญญาหลักเสมอ
  const name = info?.contactName || info?.tenant?.fullName || info?.profileDisplayName || displayName;

  return (
    <div>
      <div className="d-flex flex-column align-items-center text-center mb-3">
        <PrivacyAvatar
          src={picture || AVATAR_URL} alt="" referrerPolicy="no-referrer"
          style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover" }}
          onError={(e) => { (e.target as HTMLImageElement).src = AVATAR_URL; }}
        />
        <strong className="mt-2">{name || "ไม่ทราบชื่อ"}</strong>
        {info?.room?.number && <span className="text-muted small">ห้อง {info.room.number}</span>}
      </div>

      <div className="d-flex justify-content-between align-items-center py-2" style={{ borderTop: "1px solid var(--color-light)" }}>
        <div>
          <div className="text-muted" style={{ fontSize: 11 }}>LINE UID</div>
          <div className="small text-truncate" style={{ maxWidth: 320 }}><PrivacyMask value={lineUserId} /></div>
        </div>
        <button type="button" className="btn btn-sm btn-outline-secondary" title="คัดลอก UID" onClick={copyUid}>
          <i className="fas fa-copy" />
        </button>
      </div>

      {loading && (
        <div className="text-center text-muted py-4"><span className="spinner-border spinner-border-sm me-2" />กำลังโหลด...</div>
      )}

      {!loading && info?.tenant && (
        <div className="py-2" style={{ borderTop: "1px solid var(--color-light)" }}>
          <div className="text-muted mb-1" style={{ fontSize: 11 }}>ผู้เช่า</div>
          <div className="small">{info.tenant.fullName || "-"}</div>
          {info.tenant.tel && <div className="small text-muted">โทร <PrivacyMask value={info.tenant.tel} /></div>}
        </div>
      )}

      {!loading && info?.room && (
        <div className="py-2" style={{ borderTop: "1px solid var(--color-light)" }}>
          <div className="text-muted mb-1" style={{ fontSize: 11 }}>ห้องพัก</div>
          <div className="small">
            ห้อง {info.room.number}
            {info.room.towerName ? ` · ตึก ${info.room.towerName}` : ""}
            {info.room.floor ? ` · ชั้น ${info.room.floor}` : ""}
          </div>
          {info.room.price && <div className="small text-muted">ราคา {Number(info.room.price).toLocaleString("th-TH")} บาท/เดือน</div>}
        </div>
      )}

      {!loading && !info?.tenant && (
        <div className="text-center text-muted py-3" style={{ borderTop: "1px solid var(--color-light)" }}>
          ยังไม่พบผู้เช่าที่ผูกกับบัญชี LINE นี้
        </div>
      )}
    </div>
  );
}

function BillsTab({ lineUserId }: { lineUserId: string }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{ items: OutstandingBillItem[]; total: number } | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    chatApi.getOutstandingBills(lineUserId)
      .then((res) => { if (alive) setData(res); })
      .catch(() => { if (alive) toastError("โหลดยอดค้างชำระไม่สำเร็จ"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [lineUserId]);

  if (loading) {
    return <div className="text-center text-muted py-4"><span className="spinner-border spinner-border-sm me-2" />กำลังโหลด...</div>;
  }
  if (!data || data.items.length === 0) {
    return <div className="text-center text-muted py-4">ไม่มียอดค้างชำระ</div>;
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3 p-2" style={{ background: "var(--color-background)", borderRadius: "var(--border-radius-1)" }}>
        <strong>ยอดค้างชำระรวม</strong>
        <strong className="text-danger">{fmtMoney(data.total)} ฿</strong>
      </div>
      {data.items.map((it) => (
        <div key={it.billId} className="d-flex justify-content-between align-items-center py-2" style={{ borderBottom: "1px solid var(--color-light)" }}>
          <div>
            <div className="small fw-semibold">{monthYearLabel(it.monthYear)}</div>
            <div className="text-muted" style={{ fontSize: 12 }}>ห้อง {it.roomNumber}</div>
          </div>
          <div className="d-flex align-items-center gap-2">
            <div className="text-danger fw-semibold">{fmtMoney(it.amount)} ฿</div>
            <button type="button" className="btn btn-sm btn-outline-secondary" title="เปิดบิลนี้"
              onClick={() => navigate("/bills", { state: { openBillId: it.billId, openRoomId: it.roomId } })}>
              <i className="fas fa-arrow-up-right-from-square" />
            </button>
            <button type="button" className="btn btn-sm btn-primary" title="ยืนยันการชำระเงิน"
              onClick={() => navigate("/bills", { state: { openBillId: it.billId, openRoomId: it.roomId, openPayment: true } })}>
              <i className="fas fa-check me-1" />ชำระ
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ImagesTab({ messages }: { messages: ChatMessage[] }) {
  const images = messages.filter((m) => m.messageType === "image" && m.imageUrl).map((m) => m.imageUrl as string);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (images.length === 0) return <div className="text-center text-muted py-4">ยังไม่มีรูปภาพที่ส่ง</div>;

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {images.map((src, idx) => (
          <img
            key={`${src}-${idx}`} src={src} alt="รูปภาพ"
            style={{ width: "100%", height: 100, objectFit: "cover", borderRadius: 8, display: "block", cursor: "pointer" }}
            onClick={() => setLightboxIndex(idx)}
          />
        ))}
      </div>
      {lightboxIndex !== null && (
        <ImageLightbox
          images={images}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}
    </>
  );
}

function FilesTab({ messages }: { messages: ChatMessage[] }) {
  const files = messages.filter((m) => m.messageType === "file" && m.fileUrl);
  const senders = Array.from(new Set(files.map((m) => m.senderName || "ไม่ทราบชื่อ")));
  const [sender, setSender] = useState("all");
  const filtered = sender === "all" ? files : files.filter((m) => (m.senderName || "ไม่ทราบชื่อ") === sender);

  if (files.length === 0) return <div className="text-center text-muted py-4">ยังไม่มีไฟล์ที่ส่ง</div>;

  return (
    <div>
      {senders.length > 1 && (
        <select className="form-select form-select-sm mb-3" value={sender} onChange={(e) => setSender(e.target.value)}>
          <option value="all">ผู้ส่งทั้งหมด</option>
          {senders.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      )}
      {filtered.length === 0 ? (
        <div className="text-center text-muted py-4">ไม่พบไฟล์จากผู้ส่งนี้</div>
      ) : filtered.map((m) => (
        <a
          key={m.id} href={m.fileUrl ?? "#"} target="_blank" rel="noopener noreferrer"
          className="d-flex align-items-center gap-2 py-2 text-decoration-none"
          style={{ borderBottom: "1px solid var(--color-light)", color: "inherit" }}
        >
          <i className="fas fa-file-arrow-down text-muted" />
          <div className="flex-grow-1" style={{ minWidth: 0 }}>
            <div className="small text-truncate">{m.fileName || "ไฟล์แนบ"}</div>
            <div className="text-muted" style={{ fontSize: 11 }}>{m.senderName || "ไม่ทราบชื่อ"} · {thaiDateTimeString(new Date(m.createdAt))}</div>
          </div>
        </a>
      ))}
    </div>
  );
}

function SearchTab({ messages, onJump }: { messages: ChatMessage[]; onJump: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const results = q ? messages.filter((m) => m.messageType === "text" && m.text.toLowerCase().includes(q)) : [];

  return (
    <div>
      <div className="search-container mb-3">
        <i className="fas fa-search" />
        <input
          type="text" className="form-control" placeholder="ค้นหาข้อความ..."
          value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
        />
      </div>
      {!q && <div className="text-center text-muted py-4">พิมพ์คำที่ต้องการค้นหาข้อความในแชทนี้</div>}
      {q && results.length === 0 && <div className="text-center text-muted py-4">ไม่พบข้อความที่ตรงกัน</div>}
      {results.map((m) => (
        <div
          key={m.id} role="button" onClick={() => onJump(m.id)} className="py-2"
          style={{ borderBottom: "1px solid var(--color-light)", cursor: "pointer" }}
        >
          <div className="small text-truncate">{m.text}</div>
          <div className="text-muted" style={{ fontSize: 11 }}>
            {m.direction === "out" ? `คุณ${m.senderName ? ` (${m.senderName})` : ""}` : "ผู้เช่า"} · {thaiDateTimeString(new Date(m.createdAt))}
          </div>
        </div>
      ))}
    </div>
  );
}
