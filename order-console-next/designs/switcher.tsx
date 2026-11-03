"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { StoreDesignId } from "./types";

const DESIGNS: { id: StoreDesignId; label: string; badge: string }[] = [
  { id: "muji-hara", label: "무지·하라", badge: "Tactile" },
  { id: "editorial-atelier", label: "에디토리얼", badge: "Lookbook" },
  { id: "zavanas-archive", label: "자바나스", badge: "Matrix" },
];

export function DesignSwitcher({ activeDesign }: { activeDesign: StoreDesignId }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleSelect = (id: StoreDesignId) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("design", id);
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <div
      data-testid="design-switcher"
      className="mb-6 flex flex-wrap items-center justify-between gap-3 border border-line bg-surface/50 p-2 text-xs"
    >
      <div className="flex items-center gap-1.5 font-mono text-muted">
        <span className="font-semibold text-fg">DESIGN ARCHETYPE:</span>
        <span>{activeDesign}</span>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {DESIGNS.map((d) => {
          const isActive = activeDesign === d.id;
          return (
            <button
              key={d.id}
              type="button"
              data-testid={`design-option-${d.id}`}
              onClick={() => handleSelect(d.id)}
              className={`flex items-center gap-1.5 border px-2.5 py-1 transition-colors cursor-pointer ${
                isActive
                  ? "border-fg bg-fg text-bg font-medium"
                  : "border-line bg-bg text-muted hover:border-line-strong hover:text-fg"
              }`}
            >
              <span>{d.label}</span>
              <span
                className={`text-[10px] uppercase font-mono ${
                  isActive ? "text-bg/80" : "text-faint"
                }`}
              >
                {d.badge}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
