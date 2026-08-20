// The division picker, driven by the account's own division list.
// A single-division business (e.g. GENERAL for a service business) gets a
// hidden input — no Farm/Tech chrome for someone running a babysitting
// operation. The owner's three-way picker renders exactly as before.

import { DIVISION_LABELS, type Division } from "@/lib/domain";
import { labelCls } from "@/components/ui";

export default function DivisionField({
  divisions,
  defaultValue,
}: {
  divisions: Division[];
  defaultValue?: string | null;
}) {
  if (divisions.length <= 1) {
    return <input type="hidden" name="division" value={divisions[0] ?? "GENERAL"} />;
  }
  const fallback =
    defaultValue && (divisions as string[]).includes(defaultValue) ? defaultValue : divisions[0];
  return (
    <div>
      <span className={labelCls}>Division *</span>
      <div className={`grid gap-2 ${divisions.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
        {divisions.map((d) => (
          <label
            key={d}
            className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm font-medium text-stone-700 has-checked:border-oak-600 has-checked:bg-oak-50 has-checked:text-oak-800"
          >
            <input
              type="radio"
              name="division"
              value={d}
              defaultChecked={fallback === d}
              className="accent-oak-700"
            />
            {DIVISION_LABELS[d]}
          </label>
        ))}
      </div>
    </div>
  );
}
