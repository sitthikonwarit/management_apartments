import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { chatApi, type ChatConversation, type ChatMessage } from "../api/client";
import { useBreadcrumb } from "../context/BreadcrumbContext";
import { thaiDateTimeString } from "../utils/yearFormat";
import { useLiveRefreshTick } from "../utils/useLiveSync";
import { toastError } from "../utils/toast";
import { LINE_STICKERS, stickerThumbUrl } from "../utils/lineStickers";
import { AVATAR_URL } from "../components/TenantTableView";
import ChatDetailModal, { type ChatDetailTab } from "../components/ChatDetailModal";
import ImageLightbox from "../components/ImageLightbox";
import { ChatBillMessage } from "../components/ChatBillCard";
import { ChatRepairMessage } from "../components/ChatRepairCard";
import { ChatPaymentConfirmMessage } from "../components/ChatPaymentConfirmCard";
import { ChatBookingMessage } from "../components/ChatBookingCard";

// รูปโปรไฟล์ + วงกลมสีเขียวเล็กๆ มุมล่างขวา (แบบเดียวกับสถานะ "ออนไลน์" ของแอปแชททั่วไป) โผล่ตอนคนนี้กำลัง
// เปิดหน้า LIFF อยู่ผ่าน web (ดู state `presence` ใน ChatPage — มาจาก event "chat:web-presence")
function PresenceAvatar({ src, size, active, title }: { src: string; size: number; active: boolean; title?: string }) {
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }} title={title}>
      <img
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

  function loadConversations() {
    chatApi.getConversations().then(setConversations).catch(() => {});
  }

  useEffect(() => { loadConversations(); }, []);

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
        <div className="search-container p-2" style={{ borderBottom: "1px solid var(--color-light)" }}>
          <i className="fas fa-search" />
          <input
            type="text" className="form-control form-control-sm" placeholder="ค้นหาด้วยชื่อ..."
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
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
    </div>
  );
}
