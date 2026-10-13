// รูปโปรไฟล์ LINE (sprofile.line-scdn.net) ถูกลบ/หมดอายุได้เมื่อผู้ใช้เปลี่ยนรูป ทำให้เบราว์เซอร์ยิงขอแล้วได้ 404 ค้างใน
// console เช็คฝั่งเซิร์ฟเวอร์ก่อนส่งให้หน้าเว็บ — ถ้ารูปหายแล้วส่ง null ให้หน้าเว็บใช้อวาตาร์สำรองแทน
// จำผลไว้ในหน่วยความจำ (หายแล้วจำนาน ใช้ได้จำสั้นกว่า) เช็คขนานกันพร้อม timeout สั้น ถ้าเช็คไม่ได้ (เน็ตล่ม/timeout)
// ถือว่ารูปยังใช้ได้ ไม่ตัดรูปทิ้งโดยไม่จำเป็น
const cache = new Map<string, { ok: boolean; until: number }>();
const GONE_TTL_MS = 6 * 60 * 60 * 1000;
const OK_TTL_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 2500;

async function check(url: string): Promise<boolean> {
  const hit = cache.get(url);
  if (hit && hit.until > Date.now()) return hit.ok;
  let ok = true;
  let definitive = false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(url, { method: "HEAD", signal: ctrl.signal });
    clearTimeout(timer);
    if (res.status === 404 || res.status === 410) { ok = false; definitive = true; }
    else if (res.ok) definitive = true;
  } catch { /* เช็คไม่ได้ = ถือว่าใช้ได้ */ }
  cache.set(url, { ok, until: Date.now() + (definitive ? (ok ? OK_TTL_MS : GONE_TTL_MS) : 60 * 1000) });
  return ok;
}

// คืน Map url -> ยังโหลดได้ไหม (เฉพาะ URL ภายนอกแบบ http/https เท่านั้นที่เช็ค)
export async function livePictureMap(urls: (string | null | undefined)[]): Promise<Map<string, boolean>> {
  const unique = [...new Set(urls.filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u)))];
  const results = await Promise.all(unique.map(async (u) => [u, await check(u)] as const));
  return new Map(results);
}

export async function livePicture(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  const m = await livePictureMap([url]);
  return m.get(url) === false ? null : url;
}
