import CreatableSelect from "react-select/creatable";
import type { CreatableProps } from "react-select/creatable";
import { customStyles } from "./CustomSelect2";

// เหมือน CustomSelect2 ทุกอย่าง แต่เลือกจากตัวเลือกที่มีอยู่ หรือพิมพ์ค่าใหม่เองก็ได้
// (เช่น คำนำหน้าชื่อ: เลือก คุณ/นาย/นาง/นางสาว หรือพิมพ์คำอื่นเพิ่มเอง)
export default function CustomCreatableSelect2(props: CreatableProps<any, false, any>) {
  return (
    <CreatableSelect
      styles={customStyles}
      noOptionsMessage={() => "ไม่พบข้อมูล"}
      formatCreateLabel={(input: string) => `ใช้ "${input}"`}
      menuPortalTarget={document.body}
      menuPosition="fixed"
      {...props}
    />
  );
}
