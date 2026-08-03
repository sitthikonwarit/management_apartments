// สติกเกอร์ทางการของ LINE ที่ส่งผ่าน Messaging API ได้จริง (packageId/stickerId) — อ้างอิงจาก
// https://developers.line.biz/en/docs/messaging-api/sticker-list/ ต้องตรงกับ ALLOWED_STICKERS ใน
// backend/src/routes/chat.ts เสมอ (ฝั่ง backend validate ซ้ำอีกชั้นก่อนยิงเข้า LINE API จริง)
export interface LineSticker {
  packageId: string;
  stickerId: string;
}

export const LINE_STICKERS: LineSticker[] = [
  { packageId: "446", stickerId: "1988" },
  { packageId: "446", stickerId: "1989" },
  { packageId: "446", stickerId: "1990" },
  { packageId: "446", stickerId: "1991" },
  { packageId: "446", stickerId: "1992" },
  { packageId: "6325", stickerId: "10979904" },
  { packageId: "6325", stickerId: "10979905" },
  { packageId: "6325", stickerId: "10979906" },
  { packageId: "6325", stickerId: "10979907" },
  { packageId: "6325", stickerId: "10979908" },
  { packageId: "6359", stickerId: "11069848" },
  { packageId: "6359", stickerId: "11069849" },
  { packageId: "6359", stickerId: "11069850" },
  { packageId: "6359", stickerId: "11069851" },
  { packageId: "6359", stickerId: "11069852" },
  { packageId: "11537", stickerId: "52002734" },
  { packageId: "11537", stickerId: "52002735" },
  { packageId: "11537", stickerId: "52002736" },
  { packageId: "11537", stickerId: "52002737" },
  { packageId: "11537", stickerId: "52002738" },
];

// CDN สาธารณะของ LINE เอง ใช้แสดงตัวอย่างสติกเกอร์ในหน้าเว็บ (ทั้งตอนเลือกส่งและตอน render ข้อความ
// สติกเกอร์ที่ส่ง/ได้รับแล้วในเธรด)
export function stickerThumbUrl(stickerId: string): string {
  return `https://stickershop.line-scdn.net/stickershop/v1/sticker/${stickerId}/android/sticker.png`;
}
