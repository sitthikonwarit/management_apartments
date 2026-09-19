import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { chatApi, type ChatConversation, type ChatMessage } from "../api/client";
import { useBreadcrumb } from "../context/BreadcrumbContext";
import { thaiDateTimeString } from "../utils/yearFormat";
import { useLiveRefreshTick } from "../utils/useLiveSync";
import { toastError, toastSuccess } from "../utils/toast";
import { LINE_STICKERS, stickerThumbUrl } from "../utils/lineStickers";
import { AVATAR_URL } from "../components/TenantTableView";
import PrivacyAvatar from "../components/PrivacyAvatar";
import ChatDetailModal, { type ChatDetailTab } from "../components/ChatDetailModal";
import ImageLightbox from "../components/ImageLightbox";
import { ChatBillMessage } from "../components/ChatBillCard";
import { ChatRepairMessage } from "../components/ChatRepairCard";
import { ChatPaymentConfirmMessage } from "../components/ChatPaymentConfirmCard";
import { ChatBookingMessage } from "../components/ChatBookingCard";
import CustomSelect2 from "../components/CustomSelect2";

// รูปโปรไฟล์ + วงกลมสีเขียวเล็กๆ มุมล่างขวา (แบบเดียวกับสถานะ "ออนไลน์" ของแอปแชททั่วไป) โผล่ตอนคนนี้กำลัง
// เปิดหน้า LIFF อยู่ผ่าน web (ดู state `presence` ใน ChatPage — มาจาก event "chat:web-presence")
function PresenceAvatar({ src, size, active, title }: { src: string; size: number; active: boolean; title?: string }) {
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }} title={title}>
      <PrivacyAvatar
        src={src} alt="" referrerPolicy="no-referrer"
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", display: "block" }}
        onError={(e) => { (e.target as HTMLImageElement).src = AVATAR_URL; }}
      />
      {active && (
        <span style={{
          position: "absolute", bottom: -1, right: -1, width: Math.max(10, size * 0.3), height: Math.max(10, size * 0.3),
          borderRadius: "50%", background: "var(--color-success)", border: "2px solid var(--color-white)",
        }} />
      )}
    </div>
  );
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// อ่านขนาดจริง (กว้าง/สูง) ของรูปจาก base64 — ใช้ส่งไปให้ backend คำนวณ aspectRatio ของการ์ด Flex ตอนส่งรูป
// พร้อมลิงก์ในฟีเจอร์ "ส่งข้อความหลายห้องพร้อมกัน" (ดู BroadcastModal) ให้การ์ดแสดงตามสัดส่วนจริงของรูป
// ไม่ใช่ตัดครอปตามอัตราส่วนตายตัวแบบเดิม
function readImageDims(base64: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("อ่านขนาดรูปไม่สำเร็จ"));
    img.src = base64;
  });
}

export default function ChatPage() {
  const { setBreadcrumb } = useBreadcrumb();
  useEffect(() => { setBreadcrumb([]); return () => setBreadcrumb([]); }, []);

  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [search, setSearch] = useState("");
  const [detailTab, setDetailTab] = useState<ChatDetailTab | null>(null);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const location = useLocation();
  const handledDeepLinkRef = useRef(false);

  // วงกลมสีเขียวเล็กๆ ที่รูปโปรไฟล์ — บอกว่าผู้เช่า/ผู้มาเยือนคนนี้กำลังเปิดหน้า LIFF หน้าไหนอยู่ผ่านปุ่ม
  // Rich Menu (type: uri) ตอนนี้ (key = lineUserId, value = ชื่อหน้าที่กำลังเปิด) — สถานะชั่วคราวล้วนๆ อยู่
  // แค่ในหน่วยความจำของแท็บนี้ ไม่ persist ข้ามการโหลดหน้าใหม่ ไม่มี DB รองรับ (ดู backend/src/lib/wsHub.ts
  // broadcastWebPresence) หมดอายุเองถ้าไม่มี heartbeat ใหม่เข้ามาภายใน PRESENCE_EXPIRE_MS (ดูด้านล่าง)
  const [presence, setPresence] = useState<Map<string, string>>(new Map());
  const presenceTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // โควตาข้อความ push/broadcast คงเหลือของรอบเดือนนี้ (แพลนฟรีของ LINE OA จำกัดจำนวนข้อความ/เดือน) —
  // null = ยังไม่ได้ตั้งค่า LINE Messaging หรือเรียก LINE API ไม่สำเร็จ (ไม่โชว์แถบนี้เลยในกรณีนั้น)
  const [quota, setQuota] = useState<{ type: "limited" | "none"; limit: number; used: number; remaining: number | null } | null>(null);

  function loadConversations() {
    chatApi.getConversations().then(setConversations).catch(() => {});
  }

  useEffect(() => { loadConversations(); }, []);
  useEffect(() => { chatApi.getQuota().then(setQuota).catch(() => {}); }, []);

  // ฟังอีเวนต์ "chat:web-presence" (ยิงจาก useLiveSync.ts ทุกครั้งที่ backend ยิง heartbeat "กำลังใช้งานหน้า
  // ... ผ่าน web" มา — ดู startLiffPresenceHeartbeat ใน api/client.ts ที่ยิงซ้ำทุก 20 วิตราบใดที่ผู้เช่ายังเปิด
  // หน้า LIFF หน้านั้นอยู่) รีเซ็ตตัวจับเวลาทุกครั้งที่มี heartbeat ใหม่เข้ามาของคนเดิม ถ้าไม่มี heartbeat ใหม่
  // เข้ามาภายใน PRESENCE_EXPIRE_MS แปลว่าเลิกใช้แล้ว (ปิดแท็บ/หน้าเปลี่ยนไปแล้ว) ให้เอาวงกลมออก
  useEffect(() => {
    const PRESENCE_EXPIRE_MS = 40000;
    function handleWebPresence(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (!detail?.lineUserId) return;
      setPresence((prev) => new Map(prev).set(detail.lineUserId, detail.pageLabel || ""));
      const existing = presenceTimersRef.current.get(detail.lineUserId);
      if (existing) clearTimeout(existing);
      presenceTimersRef.current.set(detail.lineUserId, setTimeout(() => {
        setPresence((prev) => { const next = new Map(prev); next.delete(detail.lineUserId); return next; });
        presenceTimersRef.current.delete(detail.lineUserId);
      }, PRESENCE_EXPIRE_MS));
    }
    window.addEventListener("chat:web-presence", handleWebPresence);
    return () => {
      window.removeEventListener("chat:web-presence", handleWebPresence);
      presenceTimersRef.current.forEach((t) => clearTimeout(t));
      presenceTimersRef.current.clear();
    };
  }, []);

  // เปิดตรงไปยังสนทนาที่ระบุ เมื่อมีคนนำทางมาจากหน้าอื่น (เช่น กดที่ป็อปอัพแจ้งเตือนข้อความแชทใหม่มุมขวาล่าง)
  // ผ่าน navigate("/chat", { state: { openLineUserId } }) — ดู ChatToastHost.tsx — ทำครั้งเดียวหลังโหลดรายชื่อสนทนาเสร็จ
  useEffect(() => {
    const state = location.state as { openLineUserId?: string } | null;
    if (!state?.openLineUserId || handledDeepLinkRef.current || conversations.length === 0) return;
    handledDeepLinkRef.current = true;
    setSelected(state.openLineUserId);
  }, [conversations, location.state]);

  // เปิดการสนทนาที่เลือก — โหลดข้อความ + มาร์คว่าอ่านแล้วทันที (ไม่ต้องรอตอบก่อน)
  useEffect(() => {
    setDetailTab(null);
    atBottomRef.current = true;
    setAtBottom(true);
    setHasNewMessages(false);
    if (!selected) { setMessages([]); return; }
    setLoadingMessages(true);
    chatApi.getMessages(selected).then(setMessages).finally(() => setLoadingMessages(false));
    chatApi.markRead(selected).then(loadConversations).catch(() => {});
  }, [selected]);

  // เลื่อนลงล่างสุดอัตโนมัติเฉพาะตอนที่ยังอยู่ล่างสุดอยู่แล้ว (กำลังไล่อ่านข้อความล่าสุด) — ถ้าเลื่อนขึ้นไป
  // ดูข้อความเก่าอยู่ ไม่บังคับเด้งลงทับ แค่ขึ้นปุ่ม "ข้อความล่าสุด" ให้กดเองแทน (ดู scrollToBottom ด้านล่าง)
  useEffect(() => {
    if (atBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    } else if (messages.length > 0) {
      setHasNewMessages(true);
    }
  }, [messages]);

  function handleScroll() {
    const el = scrollContainerRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    atBottomRef.current = near;
    setAtBottom(near);
    if (near) setHasNewMessages(false);
  }

  function scrollToBottom() {
    atBottomRef.current = true;
    setAtBottom(true);
    setHasNewMessages(false);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  // แชทเก่าที่ยังไม่เคยแคชรูปโปรไฟล์ไว้ (ก่อนมีฟีเจอร์นี้) — ดึงรูปมาแคชครั้งเดียวตอนเปิดดู ไม่ต้องรอ
  // ข้อความเข้าใหม่จาก LINE ถึงจะมีรูป
  useEffect(() => {
    if (!selected) return;
    const conv = conversations.find((c) => c.lineUserId === selected);
    if (!conv || conv.pictureUrl) return;
    chatApi.refreshProfile(selected)
      .then(({ pictureUrl }) => {
        if (!pictureUrl) return;
        setConversations((prev) => prev.map((c) => (c.lineUserId === selected ? { ...c, pictureUrl } : c)));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  function jumpToMessage(messageId: string) {
    const node = messageRefs.current.get(messageId);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(messageId);
    setTimeout(() => setHighlightId((cur) => (cur === messageId ? null : cur)), 1500);
  }

  // มีข้อความแชทใหม่เข้ามา (webhook) หรือมีคนตอบจากเครื่องอื่น — รีเฟรชรายชื่อสนทนาเสมอ และรีเฟรช
  // ข้อความในเธรดที่เปิดอยู่ด้วยถ้ามี (ไม่ mark read ซ้ำ เผื่อเป็นข้อความเข้าใหม่ที่ยังไม่ได้อ่านจริง)
  const chatLiveTick = useLiveRefreshTick(["chat"]);
  useEffect(() => {
    if (chatLiveTick === 0) return;
    loadConversations();
    if (selected) chatApi.getMessages(selected).then(setMessages).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatLiveTick]);

  async function handleSend() {
    const value = text.trim();
    if (!value || !selected || sending) return;
    setSending(true);
    try {
      const msg = await chatApi.sendReply(selected, value);
      atBottomRef.current = true; setAtBottom(true);
      setMessages((prev) => [...prev, msg]);
      setText("");
      loadConversations();
    } catch (e: any) {
      toastError(e?.response?.data?.error || "ส่งข้อความไม่สำเร็จ");
    } finally {
      setSending(false);
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // เคลียร์ทันที กันเลือกไฟล์เดิมซ้ำแล้ว onChange ไม่ทำงาน
    if (!file || !selected || attaching) return;
    setAttaching(true);
    try {
      const base64 = await readFileAsBase64(file);
      const msg = await chatApi.sendAttachment(selected, base64, file.name);
      atBottomRef.current = true; setAtBottom(true);
      setMessages((prev) => [...prev, msg]);
      loadConversations();
    } catch (e: any) {
      toastError(e?.response?.data?.error || "ส่งไฟล์ไม่สำเร็จ");
    } finally {
      setAttaching(false);
    }
  }

  async function handleSendSticker(packageId: string, stickerId: string) {
    if (!selected || sending) return;
    setStickerPickerOpen(false);
    setSending(true);
    try {
      const msg = await chatApi.sendSticker(selected, packageId, stickerId);
      atBottomRef.current = true; setAtBottom(true);
      setMessages((prev) => [...prev, msg]);
      loadConversations();
    } catch (e: any) {
      toastError(e?.response?.data?.error || "ส่งสติกเกอร์ไม่สำเร็จ");
    } finally {
      setSending(false);
    }
  }

  const activeConversation = conversations.find((c) => c.lineUserId === selected);
  const filteredConversations = conversations.filter((c) =>
    `${c.displayName} ${c.roomNumber ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())
  );
  const threadImages = messages.filter((m) => m.messageType === "image" && m.imageUrl).map((m) => m.imageUrl as string);

  return (
    <div className={`chat-page-wrap${selected ? " chat-thread-open" : ""}`}>
      <div className="chat-list-pane" style={{
        background: "var(--color-white)",
        borderRadius: "var(--border-radius-1)", border: "1px solid var(--color-light)",
      }}>
        {/* ส่วนหัว (ค้นหา + ปุ่มส่งหลายห้อง + แถบโควตา) ต้อง "ค้าง" อยู่บนสุดตอนเลื่อนดูรายชื่อสนทนาด้านล่าง
            ไม่ใช่เลื่อนหายไปพร้อมรายชื่อ — position: sticky เทียบกับ .chat-list-pane ที่เป็นตัว scroll เอง
            (overflow-y: auto) ต้องมีพื้นหลังทึบ (ไม่ใช่ transparent) กันรายชื่อที่เลื่อนผ่านทะลุขึ้นมาโชว์ใต้ส่วนหัว */}
        <div style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--color-white)" }}>
          <div className="d-flex gap-2 p-2" style={{ borderBottom: "1px solid var(--color-light)" }}>
            <div className="search-container flex-grow-1">
              <i className="fas fa-search" />
              <input
                type="text" className="form-control form-control-sm" placeholder="ค้นหาด้วยชื่อ..."
                value={search} onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button type="button" className="btn btn-outline-primary btn-sm flex-shrink-0" title="ส่งข้อความหลายห้องพร้อมกัน"
              disabled={conversations.length === 0} onClick={() => setBroadcastOpen(true)}>
              <i className="fas fa-bullhorn" />
            </button>
          </div>
          {quota?.type === "limited" && (() => {
            const pct = quota.limit > 0 ? Math.max(0, Math.min(100, ((quota.remaining ?? 0) / quota.limit) * 100)) : 0;
            const color = pct <= 20 ? "var(--color-danger)" : pct <= 50 ? "#f7d060" : "var(--color-success)";
            return (
              <div className="px-2 pt-2 pb-1" style={{ borderBottom: "1px solid var(--color-light)" }}
                title={`ใช้ไปแล้ว ${quota.used.toLocaleString()} จาก ${quota.limit.toLocaleString()} ข้อความในรอบเดือนนี้ (LINE Official Account แพลนฟรีจำกัดจำนวนข้อความ push/broadcast ต่อเดือน)`}>
                <div className="d-flex justify-content-between align-items-center mb-1">
                  <span className="text-muted" style={{ fontSize: 11 }}>โควตาข้อความเดือนนี้</span>
                  <span className="small fw-bold" style={{ color }}>
                    เหลือ {(quota.remaining ?? 0).toLocaleString()} / {quota.limit.toLocaleString()}
                  </span>
                </div>
                <div style={{ height: 5, borderRadius: 3, background: "var(--color-light)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: color, transition: "width 0.3s ease" }} />
                </div>
              </div>
            );
          })()}
          {quota?.type === "none" && (
            <div className="px-2 py-1 text-muted" style={{ fontSize: 11, borderBottom: "1px solid var(--color-light)" }}>
              <i className="fas fa-infinity me-1" />ส่งข้อความไม่จำกัด — ใช้ไปแล้ว {quota.used.toLocaleString()} ข้อความเดือนนี้
            </div>
          )}
        </div>
        {conversations.length === 0 && (
          <p className="text-muted small p-3 mb-0">ยังไม่มีข้อความเข้ามาจาก LINE</p>
        )}
        {conversations.length > 0 && filteredConversations.length === 0 && (
          <p className="text-muted small p-3 mb-0">ไม่พบชื่อที่ค้นหา</p>
        )}
        {filteredConversations.map((c) => (
          <div
            key={c.lineUserId}
            onClick={() => setSelected(c.lineUserId)}
            style={{
              cursor: "pointer", padding: "10px 12px", borderBottom: "1px solid var(--color-light)",
              background: c.lineUserId === selected ? "var(--color-background)" : "transparent",
              display: "flex", gap: 10, alignItems: "flex-start",
            }}
          >
            <PresenceAvatar
              src={c.pictureUrl || AVATAR_URL} size={40}
              active={presence.has(c.lineUserId)}
              title={presence.has(c.lineUserId) ? `กำลังใช้งานหน้า ${presence.get(c.lineUserId)} ผ่าน web` : undefined}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="d-flex justify-content-between align-items-center">
                <strong className="small text-truncate" style={{ maxWidth: 160 }}>
                  {c.displayName}{c.roomNumber ? ` · ห้อง ${c.roomNumber}` : ""}
                </strong>
                {c.unreadCount > 0 && <span className="badge rounded-pill bg-danger">{c.unreadCount}</span>}
              </div>
              <div className="text-muted small text-truncate">
                {c.lastDirection === "out" ? "คุณ: " : ""}{c.lastMessage}
              </div>
              <div className="text-muted" style={{ fontSize: 11 }}>{thaiDateTimeString(new Date(c.lastMessageAt))}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="chat-thread-pane" style={{
        background: "var(--color-white)",
        borderRadius: "var(--border-radius-1)", border: "1px solid var(--color-light)", overflow: "hidden",
      }}>
        {!selected && (
          <div className="d-flex align-items-center justify-content-center flex-grow-1 text-muted">
            เลือกการสนทนาทางซ้ายเพื่อเริ่มดูข้อความ
          </div>
        )}
        {selected && (
          <>
            <div className="d-flex align-items-center" style={{ padding: "10px 16px", borderBottom: "1px solid var(--color-light)" }}>
              <button
                type="button" className="btn btn-sm btn-outline-secondary chat-mobile-back me-2"
                onClick={() => setSelected(null)} title="กลับไปหน้ารายชื่อสนทนา"
              >
                <i className="fas fa-arrow-left" />
              </button>
              <div style={{ marginRight: 10 }}>
                <PresenceAvatar
                  src={activeConversation?.pictureUrl || AVATAR_URL} size={36}
                  active={!!selected && presence.has(selected)}
                  title={selected && presence.has(selected) ? `กำลังใช้งานหน้า ${presence.get(selected)} ผ่าน web` : undefined}
                />
              </div>
              <div className="flex-grow-1" style={{ minWidth: 0 }}>
                <strong>{activeConversation?.displayName ?? "ไม่ทราบชื่อ"}</strong>
                {activeConversation?.roomNumber && (
                  <span className="text-muted small ms-2">ห้อง {activeConversation.roomNumber}</span>
                )}
                {selected && presence.has(selected) && (
                  <span className="small ms-2" style={{ color: "var(--color-success)" }}>
                    <i className="fas fa-circle me-1" style={{ fontSize: 6, verticalAlign: "middle" }} />
                    กำลังใช้งานหน้า {presence.get(selected)} ผ่าน web
                  </span>
                )}
              </div>
              <button
                type="button" className="btn btn-sm btn-outline-secondary" title="รายละเอียดการสนทนา"
                onClick={() => setDetailTab("info")}
              >
                <i className="fas fa-ellipsis-vertical" />
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column" }}>
              <div
                ref={scrollContainerRef} onScroll={handleScroll}
                style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}
              >
                {loadingMessages && <div className="text-muted small">กำลังโหลด...</div>}
                {messages.map((m) => (
                  <div
                    key={m.id}
                    ref={(node) => {
                      if (node) messageRefs.current.set(m.id, node);
                      else messageRefs.current.delete(m.id);
                    }}
                    style={{
                      alignSelf: m.direction === "out" ? "flex-end" : "flex-start",
                      maxWidth: "70%", minWidth: 0,
                      // จัดเป็นคอลัมน์ + ชิดด้านตามทิศข้อความ เพื่อให้ "ฟองข้อความ" กับ "บรรทัดเวลา" ต่างก็หด
                      // พอดีเนื้อหาตัวเอง ไม่งั้นฟองข้อความ (บล็อก) จะถูกยืดกว้างเท่าบรรทัดเวลาที่ยาวกว่า
                      // ทำให้ข้อความสั้นๆ เช่น "D" มีกล่องใหญ่เกินตัวหนังสือ
                      display: "flex", flexDirection: "column",
                      alignItems: m.direction === "out" ? "flex-end" : "flex-start",
                      borderRadius: "var(--border-radius-1)",
                      transition: "background-color 0.3s ease",
                      backgroundColor: highlightId === m.id ? "rgba(255, 214, 0, 0.35)" : "transparent",
                    }}
                  >
                    {m.messageType === "sticker" && m.stickerId ? (
                      // สติกเกอร์แสดงแบบลอยเดี่ยวๆ ไม่มีกล่องพื้นหลัง เหมือนแอปแชททั่วไป
                      <img src={stickerThumbUrl(m.stickerId)} alt="สติกเกอร์" style={{ width: 110, height: 110, objectFit: "contain" }} />
                    ) : m.messageType === "bill" || m.messageType === "receipt" ? (
                      // การ์ดแจ้งบิล/ใบเสร็จ (ส่งอัตโนมัติตอนกดส่งบิล/บันทึกชำระเงินทาง LINE) มีหน้าตา/สีพื้นหลัง
                      // ของตัวเองอยู่แล้ว ไม่ต้องห่อด้วยฟองข้อความสีปกติ
                      <ChatBillMessage messageType={m.messageType} raw={m.text} />
                    ) : m.messageType === "repair" ? (
                      // การ์ดแจ้งซ่อม (ผู้เช่าส่งเข้ามาจากหน้า LIFF Repair) — พนักงานกรอกรายละเอียดการซ่อม
                      // แล้วยืนยันปิดงานได้ตรงนี้เลย ไม่ต้องห่อด้วยฟองข้อความสีปกติเหมือนบิล/ใบเสร็จ
                      <ChatRepairMessage
                        messageId={m.id} lineUserId={m.lineUserId} raw={m.text}
                        onUpdated={(updated) => setMessages((prev) => prev.map((msg) => (msg.id === updated.id ? updated : msg)))}
                      />
                    ) : m.messageType === "payment_confirm" ? (
                      // การ์ดแจ้งชำระเงิน (ผู้เช่าส่งเข้ามาจากป็อปอัพ "จ่ายงวดนี้" ในหน้า LIFF Payment ตอนตรวจ
                      // สลิปอัตโนมัติด้วย EasySlip ไม่สำเร็จ) — พนักงานยืนยัน/ปฏิเสธได้ตรงนี้เลย
                      <ChatPaymentConfirmMessage
                        messageId={m.id} lineUserId={m.lineUserId} raw={m.text}
                        onUpdated={(updated) => setMessages((prev) => prev.map((msg) => (msg.id === updated.id ? updated : msg)))}
                      />
                    ) : m.messageType === "booking" ? (
                      // การ์ดคำขอจองห้อง (ผู้สนใจส่งเข้ามาจากหน้า LIFF Booking) — แสดงผลอย่างเดียว ไม่มี action
                      <ChatBookingMessage raw={m.text} />
                    ) : m.messageType === "image" && m.imageUrl ? (
                      // รูปภาพแสดงแบบลอยเดี่ยวๆ ไม่มีฟองข้อความ/พื้นหลังห่อ (เหมือนสติกเกอร์) — ของเดิมห่อด้วย
                      // ฟองสีทำให้ดูเหมือนมีกรอบ/ขอบรอบรูปเกินจำเป็น
                      <img
                        src={m.imageUrl} alt="รูปภาพ"
                        // maxWidth เดิมเป็น 100% ของฟองข้อความ ซึ่งกว้างได้ถึง 70% ของพื้นที่แชท (ดู maxWidth
                        // ของ wrapper ด้านบน) บนจอเดสก์ท็อปที่กว้างมากรูปเลยดูใหญ่เกินไป — จำกัดเพดานตายตัวไว้
                        // ที่ 260px แต่ยังหดตามพื้นที่ที่มีได้ถ้าฟองข้อความแคบกว่านั้น (เช่นจอมือถือ)
                        style={{ maxWidth: "min(260px, 100%)", maxHeight: 320, borderRadius: 8, display: "block", cursor: "pointer" }}
                        onClick={() => setLightboxIndex(threadImages.indexOf(m.imageUrl as string))}
                      />
                    ) : (
                      <div style={{
                        background: m.direction === "out" ? "var(--color-primary)" : "var(--color-background)",
                        color: m.direction === "out" ? "#fff" : "inherit",
                        borderRadius: "var(--border-radius-1)", padding: "8px 12px",
                        // ข้อความไทยไม่มีเว้นวรรคระหว่างคำ และลิงก์ไฟล์แนบก็เป็นตัวอักษรยาวไม่มีช่องว่าง — ถ้าไม่บอก
                        // เบราว์เซอร์ให้ตัดคำได้ทุกจุด (ไม่ใช่แค่ตรงช่องว่าง) ฟองข้อความจะทะลุ maxWidth ด้านบนไป
                        overflowWrap: "anywhere", wordBreak: "break-word",
                      }}>
                        {m.messageType === "file" ? (
                          <a
                            href={m.fileUrl ?? "#"} target="_blank" rel="noopener noreferrer"
                            className={m.direction === "out" ? "text-white" : ""}
                            style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", color: "inherit" }}
                          >
                            <i className="fas fa-file-arrow-down" />
                            <span>{m.fileName || "ไฟล์แนบ"}</span>
                          </a>
                        ) : (
                          <span style={{ whiteSpace: "pre-wrap" }}>{m.text}</span>
                        )}
                      </div>
                    )}
                    <div className="text-muted" style={{ fontSize: 11, textAlign: m.direction === "out" ? "right" : "left" }}>
                      {m.direction === "out" && m.senderName ? `${m.senderName} · ` : ""}
                      {thaiDateTimeString(new Date(m.createdAt))}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              {!atBottom && (
                <button
                  type="button" className="chat-jump-bottom-btn" title="ไปที่ข้อความล่าสุด"
                  onClick={scrollToBottom}
                >
                  <i className="fas fa-arrow-down" />
                  {hasNewMessages && <span className="chat-jump-bottom-dot" />}
                </button>
              )}
            </div>
            <div style={{ padding: 12, borderTop: "1px solid var(--color-light)", position: "relative" }}>
              {stickerPickerOpen && (
                <div style={{
                  position: "absolute", bottom: "100%", left: 12, marginBottom: 8, zIndex: 10,
                  background: "var(--color-white)", border: "1px solid var(--color-light)",
                  borderRadius: "var(--border-radius-1)", boxShadow: "var(--box-shadow)",
                  padding: 10, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, width: 260,
                }}>
                  {LINE_STICKERS.map((s) => (
                    <img
                      key={`${s.packageId}-${s.stickerId}`}
                      src={stickerThumbUrl(s.stickerId)}
                      alt="สติกเกอร์"
                      style={{ width: 44, height: 44, objectFit: "contain", cursor: "pointer" }}
                      onClick={() => handleSendSticker(s.packageId, s.stickerId)}
                    />
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <input ref={fileInputRef} type="file" hidden onChange={handleFileSelected} />
                <button
                  type="button" className="btn btn-outline-secondary" title="แนบไฟล์/รูปภาพ"
                  disabled={attaching} onClick={() => fileInputRef.current?.click()}
                >
                  {attaching ? <span className="spinner-border spinner-border-sm" /> : <i className="fas fa-paperclip" />}
                </button>
                <button
                  type="button" className="btn btn-outline-secondary" title="ส่งสติกเกอร์"
                  onClick={() => setStickerPickerOpen((v) => !v)}
                >
                  <i className="fas fa-face-smile" />
                </button>
                <input
                  className="form-control"
                  placeholder="พิมพ์ข้อความตอบกลับ..."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onFocus={() => setStickerPickerOpen(false)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                />
                <button className="btn btn-primary" disabled={!text.trim() || sending} onClick={handleSend}>
                  <i className="fas fa-paper-plane" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {selected && detailTab && (
        <ChatDetailModal
          lineUserId={selected}
          displayName={activeConversation?.displayName ?? "ไม่ทราบชื่อ"}
          pictureUrl={activeConversation?.pictureUrl ?? null}
          messages={messages}
          initialTab={detailTab}
          onClose={() => setDetailTab(null)}
          onJumpToMessage={jumpToMessage}
        />
      )}

      {lightboxIndex !== null && (
        <ImageLightbox
          images={threadImages}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}

      {broadcastOpen && (
        <BroadcastModal
          conversations={conversations}
          onClose={() => setBroadcastOpen(false)}
          onSent={() => { setBroadcastOpen(false); loadConversations(); if (selected) chatApi.getMessages(selected).then(setMessages).catch(() => {}); }}
        />
      )}
    </div>
  );
}

type BroadcastFormat = "text" | "image" | "template";

// ── ป็อปอัพส่งข้อความเดียวกันให้หลายห้อง/หลายคนพร้อมกัน — เลือกผู้รับเองจากรายชื่อสนทนาที่มีอยู่แล้ว
// (ค้นหา + กรองตามตึก + ติ๊กทีละคน/เลือกทั้งหมด) เลือกรูปแบบข้อความได้ 3 แบบ (ดู FORMAT_TABS ด้านล่าง) แล้วยิง
// ทีละคนฝั่ง backend (ดู POST /chat/broadcast) สรุปผลสำเร็จ/ล้มเหลวกลับมาแสดงให้พนักงานเห็นหลังส่งเสร็จ
function BroadcastModal({ conversations, onClose, onSent }: {
  conversations: ChatConversation[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [search, setSearch] = useState("");
  const [towerFilter, setTowerFilter] = useState<string>(""); // "" = ทุกตึก
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<BroadcastFormat>("text");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [image, setImage] = useState<{ base64: string; name: string; width: number; height: number } | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number; results: { lineUserId: string; ok: boolean; error?: string }[] } | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  // รายชื่อตึก (เอาเฉพาะตึกที่มีห้องผูกกับสนทนาอยู่จริง) — เรียงตามชื่อให้หาง่าย มีตัวเลือก "ไม่ระบุตึก" ไว้ท้าย
  // สำหรับสนทนาที่ยังไม่ผูกผู้เช่า/ห้อง (เช่น คนทักเข้ามาถามก่อนจอง)
  const towerOptions = Array.from(
    new Map(conversations.filter((c) => c.towerId).map((c) => [c.towerId as string, c.towerName || ""])).entries()
  ).sort((a, b) => a[1].localeCompare(b[1], "th"));
  const hasUnassigned = conversations.some((c) => !c.towerId);
  const towerSelectOptions = [
    { value: "", label: "ทุกตึก" },
    ...towerOptions.map(([id, name]) => ({ value: id, label: name || "(ไม่มีชื่อ)" })),
    ...(hasUnassigned ? [{ value: "__none__", label: "ไม่ระบุตึก" }] : []),
  ];

  const filtered = conversations.filter((c) => {
    if (towerFilter === "__none__" && c.towerId) return false;
    if (towerFilter && towerFilter !== "__none__" && c.towerId !== towerFilter) return false;
    return `${c.displayName} ${c.roomNumber ?? ""}`.toLowerCase().includes(search.trim().toLowerCase());
  });
  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selectedIds.has(c.lineUserId));

  function toggle(lineUserId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(lineUserId)) next.delete(lineUserId); else next.add(lineUserId);
      return next;
    });
  }

  function toggleSelectAllFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((c) => next.delete(c.lineUserId));
      else filtered.forEach((c) => next.add(c.lineUserId));
      return next;
    });
  }

  async function handlePickImage(file: File) {
    const base64 = await readFileAsBase64(file);
    const { width, height } = await readImageDims(base64).catch(() => ({ width: 0, height: 0 }));
    setImage({ base64, name: file.name, width, height });
  }

  const canSend = selectedIds.size > 0
    && (format === "text" ? !!text.trim()
      : format === "template" ? !!text.trim()
        : !!image); // image: รูปภาพบังคับ ลิงก์ไม่บังคับ

  async function handleSend() {
    if (!canSend || sending) return;
    setSending(true);
    try {
      const res = await chatApi.broadcast({
        lineUserIds: Array.from(selectedIds),
        format,
        text: text.trim() || undefined,
        title: title.trim() || undefined,
        linkUrl: (format === "image" || format === "template") ? linkUrl.trim() || undefined : undefined,
        image: format === "image" && image ? image : undefined,
      });
      setResult(res);
      if (res.failed === 0) {
        toastSuccess(`ส่งข้อความสำเร็จ ${res.sent} ห้อง`);
        onSent();
      }
    } catch (e: any) {
      toastError(e?.response?.data?.error || "ส่งข้อความไม่สำเร็จ");
    } finally {
      setSending(false);
    }
  }

  const failedNames = result
    ? result.results.filter((r) => !r.ok).map((r) => conversations.find((c) => c.lineUserId === r.lineUserId)?.displayName ?? r.lineUserId)
    : [];

  const FORMAT_TABS: { key: BroadcastFormat; icon: string; label: string }[] = [
    { key: "text", icon: "fa-comment-dots", label: "ข้อความธรรมดา" },
    { key: "image", icon: "fa-image", label: "รูปภาพขนาดใหญ่" },
    { key: "template", icon: "fa-rectangle-ad", label: "การ์ดประกาศ" },
  ];

  return (
    <div className="confirm-overlay" onClick={() => !sending && onClose()} style={{ zIndex: 1200 }}>
      <div className="confirm-dialog" style={{ maxWidth: 520, width: "94%", textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
        <div className="d-flex align-items-center gap-2 mb-3">
          <i className="fas fa-bullhorn text-primary" style={{ fontSize: "1.3rem" }} />
          <h6 className="confirm-title mb-0" style={{ textAlign: "left" }}>ส่งข้อความหลายห้องพร้อมกัน</h6>
        </div>

        {result ? (
          <div>
            <div className={`small mb-2 ${result.failed > 0 ? "text-warning" : "text-success"}`}>
              <i className={`fas ${result.failed > 0 ? "fa-triangle-exclamation" : "fa-circle-check"} me-1`} />
              ส่งสำเร็จ {result.sent} ห้อง{result.failed > 0 ? ` · ล้มเหลว ${result.failed} ห้อง` : ""}
            </div>
            {failedNames.length > 0 && (
              <ul className="small text-muted mb-3" style={{ maxHeight: 140, overflowY: "auto" }}>
                {failedNames.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            )}
            <div className="confirm-actions">
              <button className="btn btn-primary" onClick={onSent}>เสร็จสิ้น</button>
            </div>
          </div>
        ) : (
          <>
            <label className="form-label small fw-bold mb-1">รูปแบบข้อความ</label>
            <div className="btn-group btn-group-sm w-100 mb-3" role="group">
              {FORMAT_TABS.map((f) => (
                <button key={f.key} type="button" className={`btn btn-outline-primary${format === f.key ? " active" : ""}`}
                  onClick={() => setFormat(f.key)}>
                  <i className={`fas ${f.icon} me-1`} />{f.label}
                </button>
              ))}
            </div>

            <label className="form-label small fw-bold mb-1">เลือกผู้รับ ({selectedIds.size} คน)</label>
            <div className="d-flex gap-2 mb-2">
              <div className="search-container flex-grow-1">
                <i className="fas fa-search" />
                <input
                  type="text" className="form-control form-control-sm" placeholder="ค้นหาด้วยชื่อ/ห้อง..."
                  value={search} onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div style={{ minWidth: 150, flexShrink: 0 }}>
                <CustomSelect2
                  value={towerSelectOptions.find((o) => o.value === towerFilter) ?? towerSelectOptions[0]}
                  options={towerSelectOptions}
                  isSearchable={false}
                  onChange={(o: any) => setTowerFilter(o?.value ?? "")}
                />
              </div>
            </div>
            <div className="d-flex justify-content-between align-items-center mb-1">
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={toggleSelectAllFiltered}>
                {allFilteredSelected ? "ยกเลิกเลือกทั้งหมด" : "เลือกทั้งหมด"}
              </button>
              {selectedIds.size > 0 && (
                <button type="button" className="btn btn-sm btn-outline-danger border-0" onClick={() => setSelectedIds(new Set())}>
                  ล้างที่เลือก
                </button>
              )}
            </div>
            <div className="nicescrollbar mb-3" style={{ maxHeight: 200, overflowY: "auto", border: "1px solid var(--color-light)", borderRadius: 8 }}>
              {filtered.length === 0 && <p className="text-muted small p-3 mb-0">ไม่พบรายชื่อ</p>}
              {filtered.map((c) => (
                <label key={c.lineUserId} className="d-flex align-items-center gap-2 px-2 py-1" style={{ cursor: "pointer", borderBottom: "1px solid var(--color-light)" }}>
                  <input type="checkbox" className="form-check-input" checked={selectedIds.has(c.lineUserId)} onChange={() => toggle(c.lineUserId)} />
                  <PrivacyAvatar src={c.pictureUrl || AVATAR_URL} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                    onError={(e) => { (e.target as HTMLImageElement).src = AVATAR_URL; }} />
                  <span className="small text-truncate">
                    {c.displayName}{c.roomNumber ? ` · ห้อง ${c.roomNumber}` : ""}
                  </span>
                </label>
              ))}
            </div>

            <label className="form-label small fw-bold mb-1">
              หัวข้อ <span className="text-muted fw-normal">(ไม่บังคับ — แสดงในแจ้งเตือน LINE ของผู้รับ)</span>
            </label>
            <input className="form-control mb-1" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="เช่น แจ้งปิดน้ำชั่วคราว, ประกาศจากผู้ดูแลหอพัก..." />
            <div className="text-muted mb-2" style={{ fontSize: 11 }}>
              {format === "text" && "จะแทรกเป็นบรรทัดแรกของข้อความ และเป็นข้อความที่เห็นในแจ้งเตือน"}
              {format === "image" && "กำหนดข้อความแจ้งเตือนแทนคำว่า \"ส่งรูปภาพ\" เริ่มต้นของ LINE (ถ้าเว้นว่างและไม่แปะลิงก์ จะส่งเป็นรูปภาพธรรมดา)"}
              {format === "template" && "แสดงเป็นหัวข้อบนการ์ด และเป็นข้อความที่เห็นในแจ้งเตือน"}
            </div>

            {format === "image" ? (
              <>
                <label className="form-label small fw-bold mb-1">รูปภาพ</label>
                <input ref={imageInputRef} type="file" accept="image/*" hidden
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePickImage(f); e.target.value = ""; }} />
                {image ? (
                  <div className="mb-3" style={{
                    position: "relative", width: "100%", borderRadius: 12, overflow: "hidden",
                    border: "1px solid var(--color-light)",
                  }}>
                    <img src={image.base64} alt="" style={{ width: "100%", height: 190, objectFit: "cover", display: "block" }} />
                    <div style={{
                      position: "absolute", inset: 0,
                      background: "linear-gradient(to top, rgba(0,0,0,0.65), rgba(0,0,0,0) 55%)",
                    }} />
                    <div className="d-flex justify-content-between align-items-end" style={{ position: "absolute", left: 10, right: 10, bottom: 10 }}>
                      <span className="small text-white text-truncate" style={{ maxWidth: "60%", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                        <i className="fas fa-image me-1" />{image.name}
                      </span>
                      <div className="d-flex gap-1">
                        <button type="button" className="btn btn-sm btn-light" title="เปลี่ยนรูป" onClick={() => imageInputRef.current?.click()}>
                          <i className="fas fa-rotate" />
                        </button>
                        <button type="button" className="btn btn-sm btn-danger" title="ลบรูป" onClick={() => setImage(null)}>
                          <i className="fas fa-trash" />
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="w-100 mb-3" onClick={() => imageInputRef.current?.click()} style={{
                    border: "2px dashed var(--color-light)", borderRadius: 12, background: "var(--color-background)",
                    padding: "28px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                    color: "var(--color-dark-variant)", transition: "border-color 0.15s ease, color 0.15s ease",
                  }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--color-primary)"; e.currentTarget.style.color = "var(--color-primary)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--color-light)"; e.currentTarget.style.color = "var(--color-dark-variant)"; }}
                  >
                    <i className="fas fa-cloud-arrow-up" style={{ fontSize: 26 }} />
                    <span className="small fw-semibold">คลิกเพื่อเลือกรูปภาพ</span>
                    <span className="text-muted" style={{ fontSize: 11 }}>จะแสดงเป็นรูปขนาดใหญ่เต็มการ์ดในแชท LINE</span>
                  </button>
                )}
              </>
            ) : (
              <>
                <label className="form-label small fw-bold mb-1">ข้อความ</label>
                <textarea className="form-control mb-2" rows={format === "template" ? 4 : 5} value={text} onChange={(e) => setText(e.target.value)}
                  placeholder="พิมพ์ข้อความที่จะส่งให้ทุกคนที่เลือกไว้..." />
              </>
            )}

            {(format === "image" || format === "template") && (
              <>
                <label className="form-label small fw-bold mb-1">ลิงก์แนบ <span className="text-muted fw-normal">(ไม่บังคับ)</span></label>
                <input className="form-control mb-3" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https:// ... เช่น ลิงก์รูปประกาศ/รายละเอียดเพิ่มเติม" />
              </>
            )}

            <div className="confirm-actions">
              <button className="btn btn-outline-secondary" onClick={onClose} disabled={sending}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={handleSend} disabled={sending || !canSend}>
                {sending
                  ? <><span className="spinner-border spinner-border-sm me-2" />กำลังส่ง...</>
                  : <><i className="fas fa-paper-plane me-1" />ส่งให้ {selectedIds.size || ""} ห้อง</>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
