import Select, { StylesConfig, Props } from "react-select";
import CreatableSelect from "react-select/creatable";

export const customStyles: StylesConfig<any, false> = {
  control: (base, state) => ({
    ...base,
    backgroundColor: state.menuIsOpen || state.isFocused
      ? "var(--color-white)"
      : "var(--color-background)",
    border: `1px solid ${state.menuIsOpen || state.isFocused ? "var(--color-primary)" : "var(--color-light)"}`,
    borderRadius: "var(--border-radius-1)",
    boxShadow: state.menuIsOpen || state.isFocused
      ? "0 0 0 3px rgba(108,155,207,0.25)"
      : "none",
    minHeight: "unset",
    fontSize: "1rem",
    cursor: "pointer",
    transition: "border-color 0.3s ease, box-shadow 0.3s ease",
    "&:hover": {
      borderColor: "var(--color-primary)",
      boxShadow: "0 0 0 3px rgba(108,155,207,0.18)",
      backgroundColor: "var(--color-white)",
    },
  }),
  valueContainer: (base) => ({
    ...base,
    padding: "0.375rem 0.75rem",
  }),
  singleValue: (base) => ({
    ...base,
    color: "var(--color-dark)",
    fontWeight: 500,
    fontSize: "0.9rem",
  }),
  placeholder: (base) => ({
    ...base,
    color: "var(--color-dark-variant)",
    fontSize: "0.9rem",
  }),
  indicatorSeparator: () => ({ display: "none" }),
  dropdownIndicator: (base, state) => ({
    ...base,
    color: state.isFocused ? "var(--color-primary)" : "var(--color-dark-variant)",
    padding: "0 8px",
    transition: "transform 0.2s ease, color 0.2s ease",
    transform: state.selectProps.menuIsOpen ? "rotate(180deg)" : "rotate(0deg)",
  }),
  menuPortal: (base) => ({
    ...base,
    zIndex: 9999,
  }),
  menu: (base) => ({
    ...base,
    backgroundColor: "var(--color-white)",
    border: "1px solid var(--color-light)",
    borderRadius: "var(--border-radius-1)",
    boxShadow: "var(--box-shadow)",
    zIndex: 9999,
    overflow: "hidden",
  }),
  menuList: (base) => ({
    ...base,
    padding: "4px",
    maxHeight: "260px",
  }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isSelected
      ? "var(--color-primary)"
      : state.isFocused
      ? "var(--color-light)"
      : "transparent",
    color: state.isSelected ? "#fff" : "var(--color-dark)",
    fontSize: "0.88rem",
    fontWeight: state.isSelected ? 600 : 400,
    borderRadius: "var(--border-radius-1)",
    padding: "0.45rem 0.75rem",
    cursor: "pointer",
    transition: "background 0.15s ease",
  }),
  input: (base) => ({
    ...base,
    color: "var(--color-dark)",
    fontSize: "0.9rem",
  }),
  noOptionsMessage: (base) => ({
    ...base,
    color: "var(--color-dark-variant)",
    fontSize: "0.88rem",
  }),
};

export default function CustomSelect2(props: Props<any, false>) {
  return (
    <Select
      styles={customStyles}
      noOptionsMessage={() => "ไม่พบข้อมูล"}
      menuPortalTarget={document.body}
      menuPosition="fixed"
      {...props}
    />
  );
}

// Dropdown แบบเดียวกับ CustomSelect2 แต่พิมพ์ค่าใหม่นอกลิสต์เพิ่มเองได้ (เช่น ยี่ห้อ/รุ่นรถที่ไม่มีในลิสต์)
export function CreatableSelect2(props: Props<any, false>) {
  return (
    <CreatableSelect
      styles={customStyles}
      noOptionsMessage={() => "ไม่พบข้อมูล"}
      formatCreateLabel={(v: string) => `ใช้ "${v}"`}
      menuPortalTarget={document.body}
      menuPosition="fixed"
      {...(props as any)}
    />
  );
}
