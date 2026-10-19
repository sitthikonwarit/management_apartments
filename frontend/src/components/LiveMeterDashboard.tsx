import { useCallback, useEffect, useMemo, useState } from "react";
import { liveMeterApi, type LiveMeterDevice } from "../api/client";
import CustomSelect2 from "./CustomSelect2";
import EmptyState from "./EmptyState";
import { useLiveRefreshTick } from "../utils/useLiveSync";
import { toastSuccess, toastError } from "../utils/toast";

const errMsg = (e: any) => e?.response?.data?.error ?? e?.message ?? "เกิดข้อผิดพลาด";
const POLL_MS = 10000;

function ago(iso: string) {
  if (!iso) return "ยังไม่เคยส่งค่า";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} วินาทีที่แล้ว`;
  if (s < 3600) return `${Math.floor(s / 60)} นาทีที่แล้ว`;
  if (s < 86400) return `${Math.floor(s / 3600)} ชั่วโมงที่แล้ว`;
  return `${Math.floor(s / 86400)} วันที่แล้ว`;
}
const num = (v: string, d = 2) => (v === "" || v == null ? "-" : Number(v).toLocaleString("th-TH", { maximumFractionDigits: d }));

const FILTERS = [
  { value: "all", label: "ทุกสถานะ" },
  { value: "online", label: "ออนไลน์" },
  { value: "offline", label: "ออฟไลน์" },
  { value: "unlinked", label: "ยังไม่ผูกห้อง" },
];

// Dashboard มิเตอร์สด: ห้องไหนเชื่อมมิเตอร์แล้ว/ออนไลน์/ออฟไลน์ + ค่าล่าสุดที่อุปกรณ์ส่งเข้ามา + ผูกอุปกรณ์กับห้อง
export default function LiveMeterDashboard({ rooms, onClose }: { rooms: any[]; onClose: () => void }) {
  const [devices, setDevices] = useState<LiveMeterDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setNow] = useState(0);
  const [filter, setFilter] = useState("all");
  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [delDev, setDelDev] = useState<LiveMeterDevice | null>(null);

  const tick = useLiveRefreshTick(["live-meter"]);
  const load = useCallback(async () => {
    try { setDevices(await liveMeterApi.getDevices()); } catch (e) { toastError(errMsg(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load, tick]);
  useEffect(() => {
    const id = window.setInterval(() => { load(); setNow((n) => n + 1); }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sortedRooms = useMemo(
    () => [...rooms].sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true })),
    [rooms]
  );
  const roomById = useMemo(() => new Map(rooms.map((r) => [String(r.id), r])), [rooms]);
  const roomOptions = [{ value: "", label: "— ยังไม่ผูกห้อง —" }, ...sortedRooms.map((r) => ({ value: String(r.id), label: `ห้อง ${r.number}` }))];

  const online = devices.filter((d) => d.online).length;
  const unlinked = devices.filter((d) => !d.roomId || !roomById.has(d.roomId)).length;
  // สถานะต่อห้อง: ไม่มีอุปกรณ์ = ยังไม่เชื่อม / มีและออนไลน์ทุกตัว = ออนไลน์ / มีตัวใดออฟไลน์ = ออฟไลน์
  const roomStatus = useMemo(() => sortedRooms.map((r) => {
    const mine = devices.filter((d) => d.roomId === String(r.id));
    const st = mine.length === 0 ? "none" : mine.every((d) => d.online) ? "online" : "offline";
    return { room: r, st, count: mine.length };
  }), [sortedRooms, devices]);
  const noMeterRooms = roomStatus.filter((x) => x.st === "none").length;

  const shown = devices.filter((d) =>
    filter === "all" ? true
      : filter === "online" ? d.online
      : filter === "offline" ? !d.online
      : (!d.roomId || !roomById.has(d.roomId)));

  async function link(d: LiveMeterDevice, roomId: string) {
    try { await liveMeterApi.updateDevice(d.id, { roomId }); toastSuccess(roomId ? "ผูกมิเตอร์กับห้องแล้ว" : "ยกเลิกการผูกแล้ว"); load(); } catch (e) { toastError(errMsg(e)); }
  }
  async function showKeyPanel(regenerate = false) {
    try { const r = await liveMeterApi.getKey(regenerate); setApiKey(r.apiKey); setShowKey(true); if (regenerate) toastSuccess("ออกคีย์ใหม่แล้ว — คีย์เก่าใช้ไม่ได้อีก ต้องอัปเดตในอุปกรณ์"); } catch (e) { toastError(errMsg(e)); }
  }
  const endpoint = `${window.location.origin}/api/live-meter/ingest`;
  const curl = `curl -X POST ${endpoint} \\\n  -H "x-meter-key: ${apiKey || "<คีย์>"}" -H "Content-Type: application/json" \\\n  -d '{"slaveId":"1","type":"electric","value":1234.5,"voltage":230,"current":4.2,"power":950}'`;

  return (
    <div className="confirm-overlay" style={{ alignItems: "flex-start", overflow: "auto", zIndex: 1400 }} onClick={onClose}>
      <div className="confirm-dialog" style={{ maxWidth: 1180, width: "100%", textAlign: "left", margin: "2vh auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <h5 className="mb-0"><i className="fas fa-satellite-dish me-2 text-success" />Dashboard มิเตอร์สด
            <span className="ms-2 small text-muted fw-normal"><i className="fas fa-circle text-success me-1" style={{ fontSize: "0.5rem", verticalAlign: "middle" }} />รีเฟรชอัตโนมัติ</span>
          </h5>
          <div className="d-flex gap-2">
            <button className="btn btn-outline-secondary" onClick={() => (showKey ? setShowKey(false) : showKeyPanel())}><i className="fas fa-plug me-2" />การเชื่อมต่ออุปกรณ์</button>
            <button className="btn btn-outline-secondary" onClick={onClose}><i className="fas fa-times" /></button>
          </div>
        </div>

        {showKey && (
          <div className="mb-3 p-3" style={{ background: "var(--color-background)", borderRadius: "var(--border-radius-1)" }}>
            <div className="fw-bold mb-1">ให้อุปกรณ์มิเตอร์ส่งค่าเข้ามาที่เว็บ (HTTP POST ทุกไม่กี่วินาที)</div>
            <div className="small text-muted mb-2">ใส่คีย์ของหอพักใน header <code>x-meter-key</code> ส่งได้ทีละตัว หรือหลายตัวพร้อมกันด้วย <code>{"{ \"readings\": [ ... ] }"}</code> — อุปกรณ์ใหม่จะโผล่ในตารางด้านล่างอัตโนมัติเมื่อส่งค่าครั้งแรก แล้วผูกกับห้องได้</div>
            <div className="d-flex gap-2 align-items-center flex-wrap mb-2">
              <code style={{ wordBreak: "break-all" }}>{apiKey}</code>
              <button className="btn btn-sm btn-outline-secondary" onClick={() => { navigator.clipboard?.writeText(apiKey); toastSuccess("คัดลอกคีย์แล้ว"); }}><i className="fas fa-copy me-1" />คัดลอก</button>
              <button className="btn btn-sm btn-outline-danger" onClick={() => { if (window.confirm("ออกคีย์ใหม่? คีย์เก่าจะใช้ไม่ได้ทันที ต้องแก้ในอุปกรณ์ทุกตัว")) showKeyPanel(true); }}>ออกคีย์ใหม่</button>
            </div>
            <pre className="mb-0 p-2" style={{ background: "#0d1117", color: "#c9d1d9", borderRadius: 8, fontSize: "0.78rem", whiteSpace: "pre-wrap" }}>{curl}</pre>
            <div className="small text-muted mt-2">ฟิลด์: <code>slaveId</code> (จำเป็น) · <code>type</code> = electric/water · <code>value</code> เลขมิเตอร์สะสม · <code>voltage</code> · <code>current</code> · <code>power</code> — ถือว่าออนไลน์ถ้าส่งค่ามาไม่เกิน 5 นาทีที่ผ่านมา</div>
          </div>
        )}

        <div className="row g-3 mb-3">
          {[
            { icon: "fa-microchip text-primary", label: "อุปกรณ์ทั้งหมด", val: devices.length },
            { icon: "fa-wifi text-success", label: "ออนไลน์", val: online },
            { icon: "fa-plug-circle-xmark text-danger", label: "ออฟไลน์", val: devices.length - online },
            { icon: "fa-link-slash text-warning", label: "ยังไม่ผูกห้อง", val: unlinked },
            { icon: "fa-door-closed text-secondary", label: "ห้องที่ยังไม่มีมิเตอร์", val: noMeterRooms },
          ].map(({ icon, label, val }) => (
            <div key={label} className="col-6 col-md">
              <div className="detail-item" style={{ height: "100%" }}>
                <i className={`fas ${icon}`} />
                <div><div className="label">{label}</div><div className="value">{val}</div></div>
              </div>
            </div>
          ))}
        </div>

        <div className="fw-bold mb-2">สถานะรายห้อง</div>
        <div className="d-flex flex-wrap gap-2 mb-1">
          {roomStatus.map(({ room, st, count }) => {
            const c = st === "online" ? "#28a745" : st === "offline" ? "#dc3545" : "#8a8f98";
            return (
              <span key={room.id} title={st === "online" ? "ออนไลน์" : st === "offline" ? "ออฟไลน์" : "ยังไม่ได้เชื่อมมิเตอร์"}
                style={{ border: `1.5px solid ${c}`, color: c, background: `${c}1a`, borderRadius: 8, padding: "3px 10px", fontSize: "0.82rem", fontWeight: 600 }}>
                {room.number}{count > 1 ? ` ×${count}` : ""}
              </span>
            );
          })}
        </div>
        <div className="small text-muted mb-3">
          <span style={{ color: "#28a745" }}>● ออนไลน์</span> · <span style={{ color: "#dc3545" }}>● ออฟไลน์</span> · <span style={{ color: "#8a8f98" }}>● ยังไม่ได้เชื่อมมิเตอร์</span>
        </div>

        <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
          <div className="fw-bold">อุปกรณ์มิเตอร์</div>
          <div style={{ minWidth: 180 }}>
            <CustomSelect2 value={FILTERS.find((o) => o.value === filter)} options={FILTERS} onChange={(o: any) => setFilter(o?.value ?? "all")} isSearchable={false} />
          </div>
        </div>
        {loading ? (
          <div className="text-center p-4"><div className="spinner-border" style={{ color: "var(--color-primary)" }} /></div>
        ) : shown.length === 0 ? (
          <EmptyState icon="fa-satellite-dish" text={devices.length === 0 ? "ยังไม่มีอุปกรณ์ส่งค่าเข้ามา — กด \"การเชื่อมต่ออุปกรณ์\" เพื่อดูคีย์และวิธีส่งค่า" : "ไม่มีอุปกรณ์ตามตัวกรองที่เลือก"} compact />
        ) : (
          <div className="nicescrollbar" style={{ overflow: "auto", maxHeight: "46vh" }}>
            <table className="table-mainstyle table-hover" style={{ width: "100%", minWidth: 900 }}>
              <thead>
                <tr><th>สถานะ</th><th style={{ minWidth: 190 }}>ห้อง</th><th>อุปกรณ์</th><th>ประเภท</th><th className="text-end">เลขมิเตอร์</th><th className="text-end">แรงดัน (V)</th><th className="text-end">กระแส (A)</th><th className="text-end">กำลัง (W)</th><th>ส่งค่าล่าสุด</th><th /></tr>
              </thead>
              <tbody>
                {shown.map((d) => {
                  const linked = d.roomId && roomById.has(d.roomId);
                  return (
                    <tr key={d.id}>
                      <td><span className={`status-badge ${d.online ? "status-paid" : "status-overdue"}`}>{d.online ? "ออนไลน์" : "ออฟไลน์"}</span></td>
                      <td>
                        <CustomSelect2 value={roomOptions.find((o) => o.value === (linked ? d.roomId : "")) ?? roomOptions[0]} options={roomOptions}
                          onChange={(o: any) => link(d, o?.value ?? "")} />
                      </td>
                      <td><span className="fw-bold">{d.name || `มิเตอร์ ${d.slaveId}`}</span><div className="text-muted small">ID: {d.slaveId}</div></td>
                      <td><i className={`fas ${d.type === "water" ? "fa-droplet text-info" : "fa-bolt text-warning"} me-1`} />{d.type === "water" ? "น้ำ" : "ไฟ"}</td>
                      <td className="text-end">{num(d.value)}</td>
                      <td className="text-end">{num(d.voltage, 1)}</td>
                      <td className="text-end">{num(d.current)}</td>
                      <td className="text-end">{num(d.power, 0)}</td>
                      <td className="text-muted small">{ago(d.lastSeenAt)}</td>
                      <td><button className="btn btn-sm btn-outline-danger" title="ลบอุปกรณ์" onClick={() => setDelDev(d)}><i className="fas fa-trash-alt" /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {delDev && (
        <div className="confirm-overlay" style={{ zIndex: 1500 }} onClick={() => setDelDev(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon confirm-icon--danger"><i className="fas fa-trash-alt" /></div>
            <h6 className="confirm-title">ลบอุปกรณ์นี้?</h6>
            <p className="confirm-message">ลบ <strong>{delDev.name || `มิเตอร์ ${delDev.slaveId}`}</strong> ออกจากรายการ (ถ้าอุปกรณ์ยังส่งค่าอยู่ จะโผล่ขึ้นมาใหม่เป็นอุปกรณ์ที่ยังไม่ผูกห้อง)</p>
            <div className="confirm-actions">
              <button className="btn btn-outline-secondary" onClick={() => setDelDev(null)}>ยกเลิก</button>
              <button className="btn btn-danger" onClick={async () => { try { await liveMeterApi.deleteDevice(delDev.id); setDelDev(null); load(); } catch (e) { toastError(errMsg(e)); } }}>
                <i className="fas fa-trash-alt me-1" />ลบ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
