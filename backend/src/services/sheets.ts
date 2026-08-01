import { google } from "googleapis";
import { readFileSync } from "fs";
import { resolve } from "path";

const SPREADSHEET_ID = process.env.SPREADSHEET_ID!;

function getAuth(extraScopes: string[] = []) {
  const path = resolve(process.env.GOOGLE_SERVICE_ACCOUNT_PATH ?? "./service-account.json");
  const credentials = JSON.parse(readFileSync(path, "utf-8"));
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      ...extraScopes,
    ],
  });
}

export async function getDriveImageBuffer(fileId: string): Promise<{ buffer: Buffer; contentType: string }> {
  // Try 1: service account (works if file is shared with service account)
  try {
    const auth = getAuth(["https://www.googleapis.com/auth/drive.readonly"]);
    const drive = google.drive({ version: "v3", auth });
    const meta = await drive.files.get({ fileId, fields: "mimeType", supportsAllDrives: true } as any);
    const contentType = (meta.data.mimeType as string) || "image/jpeg";
    const res = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true } as any,
      { responseType: "arraybuffer" }
    );
    return { buffer: Buffer.from(res.data as ArrayBuffer), contentType };
  } catch {
    // Try 2: public fetch (works if file is shared "anyone with link")
    const urls = [
      `https://drive.google.com/uc?export=view&id=${fileId}`,
      `https://lh3.googleusercontent.com/d/${fileId}`,
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0" },
          redirect: "follow",
        });
        if (res.ok && res.headers.get("content-type")?.startsWith("image")) {
          const arrayBuffer = await res.arrayBuffer();
          const contentType = res.headers.get("content-type") || "image/jpeg";
          return { buffer: Buffer.from(arrayBuffer), contentType };
        }
      } catch {}
    }
    throw new Error(`Cannot access Drive file: ${fileId}`);
  }
}

export async function uploadFileToDrive(
  filename: string,
  mimeType: string,
  base64Data: string
): Promise<string> {
  const { writeFileSync, mkdirSync } = await import("fs");
  const { resolve } = await import("path");

  const uploadDir = resolve(process.cwd(), "uploads", "tenants");
  mkdirSync(uploadDir, { recursive: true });

  const base64 = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
  const buffer = Buffer.from(base64, "base64");
  const safeName = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const filePath = resolve(uploadDir, safeName);

  writeFileSync(filePath, buffer);

  // path สัมพัทธ์ล้วนๆ (ไม่ฝัง host:port) — ฝั่ง frontend พร็อกซี /uploads ไปที่ backend เอง (ดู vite.config.ts)
  // กัน URL รูปพังตอน IP เครื่องใน LAN เปลี่ยน (เช่น BASE_URL เดิมผูกกับ IP ที่ DHCP จ่ายใหม่ไปแล้ว)
  return `/uploads/tenants/${safeName}`;
}

function sheetsClient() {
  return google.sheets({ version: "v4", auth: getAuth() });
}

export async function getRows(sheetName: string): Promise<any[][]> {
  const res = await sheetsClient().spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A2:ZZ`,
  });
  return res.data.values ?? [];
}

export async function appendRow(sheetName: string, values: any[]): Promise<void> {
  await sheetsClient().spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [values] },
  });
}

export async function updateRow(sheetName: string, rowIndex: number, values: any[]): Promise<void> {
  await sheetsClient().spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A${rowIndex + 2}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [values] },
  });
}

export async function findRowIndex(sheetName: string, colIndex: number, id: string): Promise<number> {
  const rows = await getRows(sheetName);
  return rows.findIndex((row) => String(row[colIndex]).trim() === String(id).trim());
}
