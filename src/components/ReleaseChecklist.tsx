"use client";

import { useEffect, useState } from "react";
import { Card } from "./ui";

// FR-005. Progress lives in localStorage rather than the database: a test
// pass is a personal working note, not a business record, and it should not
// end up in backups or reports.
const KEY = "twinoaks-release-checklist";

export default function ReleaseChecklist({
  groups,
}: {
  groups: { title: string; hint?: string; items: string[] }[];
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setChecked(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      // A corrupt or unavailable store just means starting fresh.
    }
    setLoaded(true);
  }, []);

  function toggle(item: string) {
    setChecked((prev) => {
      const next = { ...prev, [item]: !prev[item] };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  function reset() {
    setChecked({});
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }

  const all = groups.flatMap((g) => g.items);
  const done = all.filter((i) => checked[i]).length;

  return (
    <div>
      <Card className="mb-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-stone-700">
            {loaded ? `${done} of ${all.length} checked` : "Loading…"}
          </span>
          {done > 0 ? (
            <button type="button" onClick={reset} className="text-sm font-medium text-red-600">
              Reset
            </button>
          ) : null}
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-stone-200">
          <div
            className="h-full rounded-full bg-oak-700 transition-all"
            style={{ width: `${all.length ? (done / all.length) * 100 : 0}%` }}
          />
        </div>
      </Card>

      <div className="space-y-4">
        {groups.map((g) => (
          <Card key={g.title}>
            <h2 className="font-semibold text-stone-900">{g.title}</h2>
            {g.hint ? <p className="mb-2 text-xs text-stone-500">{g.hint}</p> : null}
            <div className="divide-y divide-stone-100">
              {g.items.map((item) => (
                <label
                  key={item}
                  className="flex cursor-pointer items-start gap-3 py-2.5 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(checked[item])}
                    onChange={() => toggle(item)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-oak-700"
                  />
                  <span className={checked[item] ? "text-stone-400 line-through" : "text-stone-800"}>
                    {item}
                  </span>
                </label>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
