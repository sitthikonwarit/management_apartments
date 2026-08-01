// ผู้เช่า 1 คนอาจเช่าได้หลายห้อง: idRoom คือห้องหลัก (ของเดิม, backward-compatible)
// extraRoomIds คือห้องเพิ่มเติมนอกเหนือจากห้องหลัก — ฟังก์ชันในไฟล์นี้เช็คทั้งสองอย่างรวมกัน
export function tenantOccupiesRoom(tenant: any, room: any): boolean {
  if (!tenant || !room) return false;
  if (tenant.idRoom && (tenant.idRoom === room.id || tenant.idRoom === room.number)) return true;
  const extra: string[] = Array.isArray(tenant.extraRoomIds) ? tenant.extraRoomIds : [];
  return extra.some((rid) => rid === room.id || rid === room.number);
}

export function findTenantForRoom(tenants: any[], room: any): any | null {
  return tenants.find((t) => tenantOccupiesRoom(t, room)) ?? null;
}

export function roomHasTenant(tenants: any[], room: any): boolean {
  return tenants.some((t) => tenantOccupiesRoom(t, room));
}

// รายชื่อห้องทั้งหมดของผู้เช่า (หลัก + เพิ่มเติม) เป็น room object จาก allRooms ที่ให้มา
export function roomsOfTenant(tenant: any, allRooms: any[]): any[] {
  if (!tenant) return [];
  const ids = [tenant.idRoom, ...(Array.isArray(tenant.extraRoomIds) ? tenant.extraRoomIds : [])].filter(Boolean);
  const seen = new Set<string>();
  const out: any[] = [];
  for (const rid of ids) {
    const room = allRooms.find((r) => r.id === rid || r.number === rid);
    if (room && !seen.has(room.id)) { seen.add(room.id); out.push(room); }
  }
  return out;
}
