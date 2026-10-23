import { storeBrand, storeBrands } from "./store-brands";

export default function BrandFilter({
  names,
  value,
  onChange,
  label = "门店品牌",
}: {
  names: string[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const available = new Set(names.map(storeBrand));
  const options = [
    ...storeBrands,
    { id: "unknown", label: "其他 / 未识别", category: "" },
  ].filter((b) => available.has(b.id) || b.id === value);
  return (
    <label className="brand-filter">
      <span>品牌</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="all">全部品牌</option>
        {options.map((b) => (
          <option key={b.id} value={b.id}>
            {b.label}
            {available.has(b.id) ? "" : "（当前无结果）"}
          </option>
        ))}
      </select>
    </label>
  );
}
