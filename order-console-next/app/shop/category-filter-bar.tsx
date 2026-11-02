"use client";

import { useQuery } from "@tanstack/react-query";
import { API_URL } from "@/lib/api-client";

export function CategoryFilterBar({
  selectedId,
  onSelect,
}: {
  selectedId: number | null;
  onSelect: (id: number | null, name: string | null) => void;
}) {
  const { data: categories } = useQuery<{ id: number; name: string; sortOrder: number }[]>({
    queryKey: ["shop-categories"],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/categories`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  return (
    <div
      data-testid="category-filter-bar"
      className="mb-6 flex flex-wrap items-center gap-2 border-b border-line pb-3 text-sm"
    >
      <button
        type="button"
        className={`rounded px-3 py-1 font-medium transition-colors ${
          selectedId === null
            ? "bg-fg text-bg"
            : "text-muted hover:text-fg hover:bg-neutral-100"
        }`}
        onClick={() => onSelect(null, null)}
      >
        전체
      </button>
      {categories?.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`rounded px-3 py-1 font-medium transition-colors ${
            selectedId === c.id
              ? "bg-fg text-bg"
              : "text-muted hover:text-fg hover:bg-neutral-100"
          }`}
          onClick={() => onSelect(c.id, c.name)}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}
