import { useEffect, useRef, useState } from "react";
import { chatApi, type ChatConversation, type ChatMessage } from "../api/client";
import { useBreadcrumb } from "../context/BreadcrumbContext";
import { thaiDateTimeString } from "../utils/yearFormat";
import { useLiveRefreshTick } from "../utils/useLiveSync";
import { toastError } from "../utils/toast";
import { LINE_STICKERS, stickerThumbUrl } from "../utils/lineStickers";

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
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function loadConversations() {
    chatApi.getConversations().then(setConversations).catch(() => {});
  }

  useEffect(() => { loadConversations(); }, []);

  // เปิดการสนทนาที่เลือก — โหลดข้อความ + มาร์คว่าอ่านแล้วทันที (ไม่ต้องรอตอบก่อน)
  useEffect(() => {
    if (!selected) { setMessages([]); return; }
    setLoadingMessages(true);
    chatApi.getMessages(selected).then(setMessages).finally(() => setLoadingMessages(false));
    chatApi.markRead(selected).then(loadConversations).catch(() => {});
  }, [selected]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
      setMessages((prev) => [...prev, msg]);
      loadConversations();
    } catch (e: any) {
      toastError(e?.response?.data?.error || "ส่งสติกเกอร์ไม่สำเร็จ");
    } finally {
      setSending(false);
    }
  }

  const activeConversation = conversations.find((c) => c.lineUserId === selected);

  return (
    <div style={{ display: "flex", height: "calc(100vh - 160px)", minHeight: 400, gap: 16 }}>
      <div style={{
        width: 320, flexShrink: 0, overflowY: "auto", background: "var(--color-white)",
        borderRadius: "var(--border-radius-1)", border: "1px solid var(--color-light)",
      }}>
        {conversations.length === 0 && (
          <p className="text-muted small p-3 mb-0">ยังไม่มีข้อความเข้ามาจาก LINE</p>
        )}
        {conversations.map((c) => (
          <div
            key={c.lineUserId}
            onClick={() => setSelected(c.lineUserId)}
            style={{
              cursor: "pointer", padding: "10px 12px", borderBottom: "1px solid var(--color-light)",
              background: c.lineUserId === selected ? "var(--color-background)" : "transparent",
            }}
          >
            <div className="d-flex justify-content-between align-items-center">
              <strong className="small text-truncate" style={{ maxWidth: 200 }}>
                {c.displayName}{c.roomNumber ? ` · ห้อง ${c.roomNumber}` : ""}
              </strong>
              {c.unreadCount > 0 && <span className="badge rounded-pill bg-danger">{c.unreadCount}</span>}
            </div>
            <div className="text-muted small text-truncate">
              {c.lastDirection === "out" ? "คุณ: " : ""}{c.lastMessage}
            </div>
            <div className="text-muted" style={{ fontSize: 11 }}>{thaiDateTimeString(new Date(c.lastMessageAt))}</div>
          </div>
        ))}
      </div>

      <div style={{
        flex: 1, display: "flex", flexDirection: "column", background: "var(--color-white)",
        borderRadius: "var(--border-radius-1)", border: "1px solid var(--color-light)", overflow: "hidden",
      }}>
        {!selected && (
          <div className="d-flex align-items-center justify-content-center flex-grow-1 text-muted">
            เลือกการสนทนาทางซ้ายเพื่อเริ่มดูข้อความ
          </div>
        )}
        {selected && (
          <>
            <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--color-light)" }}>
              <strong>{activeConversation?.displayName ?? "ไม่ทราบชื่อ"}</strong>
              {activeConversation?.roomNumber && (
                <span className="text-muted small ms-2">ห้อง {activeConversation.roomNumber}</span>
              )}
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              {loadingMessages && <div className="text-muted small">กำลังโหลด...</div>}
              {messages.map((m) => (
                <div key={m.id} style={{ alignSelf: m.direction === "out" ? "flex-end" : "flex-start", maxWidth: "70%" }}>
                  {m.messageType === "sticker" && m.stickerId ? (
                    // สติกเกอร์แสดงแบบลอยเดี่ยวๆ ไม่มีกล่องพื้นหลัง เหมือนแอปแชททั่วไป
                    <img src={stickerThumbUrl(m.stickerId)} alt="สติกเกอร์" style={{ width: 110, height: 110, objectFit: "contain" }} />
                  ) : (
                    <div style={{
                      background: m.direction === "out" ? "var(--color-primary)" : "var(--color-background)",
                      color: m.direction === "out" ? "#fff" : "inherit",
                      borderRadius: "var(--border-radius-1)", padding: "8px 12px",
                    }}>
                      {m.messageType === "image" && m.imageUrl ? (
                        <img src={m.imageUrl} alt="รูปภาพ" style={{ maxWidth: "100%", borderRadius: 8, display: "block" }} />
                      ) : m.messageType === "file" ? (
                        <a
                          href={m.fileUrl ?? "#"} target="_blank" rel="noopener noreferrer"
                          className={m.direction === "out" ? "text-white" : ""}
                          style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", color: "inherit" }}
                        >
                          <i className="fas fa-file-arrow-down" />
                          <span style={{ wordBreak: "break-all" }}>{m.fileName || "ไฟล์แนบ"}</span>
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
    </div>
  );
}
