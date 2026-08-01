// ── โทเค็นเข้าสู่ระบบแบบ JWT (HS256) ทำเองแบบง่ายๆ ด้วย Node crypto ──────────────
// ไม่พึ่ง @elysiajs/jwt (ซึ่งผูกกับ context ของ Elysia plugin ที่ scope ซับซ้อน) เพื่อให้ sign/verify
// เป็นฟังก์ชันล้วนๆ เรียกจากที่ไหนก็ได้แน่นอน ไม่ต้องกังวลเรื่อง plugin encapsulation
import { createHmac, timingSafeEqual } from "crypto";

const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error("Missing JWT_SECRET in .env — กรุณาตั้งค่าก่อนรันเซิร์ฟเวอร์");

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64urlDecode(input: string): Buffer {
  const padded = input + "=".repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

const HEADER_B64 = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
const DEFAULT_EXPIRES_SECONDS = 60 * 60 * 24 * 30; // 30 วัน

export function signToken(payload: Record<string, unknown>, expiresInSeconds = DEFAULT_EXPIRES_SECONDS): string {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const payloadB64 = base64url(JSON.stringify(body));
  const signature = base64url(createHmac("sha256", SECRET!).update(`${HEADER_B64}.${payloadB64}`).digest());
  return `${HEADER_B64}.${payloadB64}.${signature}`;
}

export function verifyToken(token: string): Record<string, any> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  const expectedSig = createHmac("sha256", SECRET!).update(`${headerB64}.${payloadB64}`).digest();
  let providedSig: Buffer;
  try {
    providedSig = base64urlDecode(signatureB64);
  } catch {
    return null;
  }
  if (providedSig.length !== expectedSig.length || !timingSafeEqual(providedSig, expectedSig)) return null;
  try {
    const payload = JSON.parse(base64urlDecode(payloadB64).toString("utf8"));
    if (typeof payload.exp === "number" && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
