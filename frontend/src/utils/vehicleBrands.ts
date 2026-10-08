// รายการยี่ห้อ/รุ่นรถยอดนิยมในไทย ใช้เป็นตัวเลือกใน <datalist> ของฟอร์มยานพาหนะ — พิมพ์เองนอกลิสต์ได้เสมอ
export const VEHICLE_BRAND_MODELS: Record<string, string[]> = {
  Honda: ["Wave 110i", "Wave 125i", "Click 125i", "Click 160", "PCX 160", "Scoopy", "Dream", "Lead 125", "Giorno", "Forza 350", "CBR150R", "Civic", "City", "Jazz", "Accord", "CR-V", "HR-V", "BR-V", "Brio", "Freed"],
  Yamaha: ["Fino", "Mio", "Grand Filano", "Aerox 155", "NMAX 155", "XMAX 300", "Fazzio", "Finn", "Exciter 155", "Spark", "TFX 150", "R15", "MT-15", "Tricity"],
  Suzuki: ["Smash", "Step 125", "Address", "Raider", "GSX-R150", "GSX-S150", "Swift", "Ciaz", "Ertiga", "Celerio", "XL7", "Carry"],
  Kawasaki: ["Ninja 400", "Z400", "W175", "KSR", "Z650"],
  GPX: ["Demon 150", "Legend 150", "Drone 150"],
  Vespa: ["Primavera", "Sprint", "LX 125", "GTS 300"],
  Toyota: ["Vios", "Yaris", "Yaris Ativ", "Altis", "Camry", "Corolla Cross", "Fortuner", "Innova", "Hilux Revo", "Hilux Vigo", "Commuter", "Avanza", "Sienta", "Veloz", "Alphard", "C-HR", "Prius"],
  Isuzu: ["D-Max", "MU-X", "Spark", "Elf"],
  Mitsubishi: ["Triton", "Pajero Sport", "Mirage", "Attrage", "Xpander", "Lancer", "Space Wagon"],
  Nissan: ["Almera", "March", "Note", "Kicks", "Navara", "Teana", "Sylphy", "Terra", "Pulsar"],
  Mazda: ["Mazda2", "Mazda3", "CX-3", "CX-30", "CX-5", "CX-8", "BT-50"],
  Ford: ["Ranger", "Everest", "Focus", "Fiesta", "EcoSport"],
  Chevrolet: ["Colorado", "Trailblazer", "Cruze", "Sonic", "Captiva"],
  MG: ["MG3", "MG5", "MG ZS", "MG HS", "MG4", "Extender", "ZS EV"],
  Hyundai: ["Elantra", "H-1", "Tucson", "Creta", "Staria"],
  Kia: ["Seltos", "Sonet", "Carnival", "Sportage", "Picanto"],
  BMW: ["Series 3", "Series 5", "X1", "X3", "X5"],
  "Mercedes-Benz": ["C-Class", "E-Class", "GLA", "GLC", "A-Class"],
  Subaru: ["XV", "Forester", "Impreza", "BRZ"],
  Suzuki_Car: [],
  BYD: ["Atto 3", "Dolphin", "Seal", "Seal U"],
  Tesla: ["Model 3", "Model Y"],
  GWM: ["Ora Good Cat", "Haval H6", "Tank 300"],
  Neta: ["V", "V-II"],
  Volvo: ["XC40", "XC60", "S60"],
  Lexus: ["NX", "RX", "ES", "UX"],
};
delete (VEHICLE_BRAND_MODELS as Record<string, string[]>).Suzuki_Car;

export const VEHICLE_BRANDS = Object.keys(VEHICLE_BRAND_MODELS);

export function vehicleBrandLabel(v: { brand?: string; model?: string }): string {
  return [v.brand, v.model].filter(Boolean).join(" ");
}
