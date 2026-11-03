"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useState, type KeyboardEvent } from "react";
import {
  SUGGEST_DEBOUNCE_MS,
  searchHref,
  suggestProducts,
  type Suggestion,
} from "@/lib/search";

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function SearchBox() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlQuery = pathname === "/shop/search" ? (params.get("q") ?? "") : "";
  const [text, setText] = useState(urlQuery);
  const [syncedFrom, setSyncedFrom] = useState(urlQuery);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();

  if (syncedFrom !== urlQuery) {
    setSyncedFrom(urlQuery);
    setText(urlQuery);
  }

  const query = useDebounced(text.trim(), SUGGEST_DEBOUNCE_MS);
  const { data } = useQuery({
    queryKey: ["suggest", query],
    queryFn: () => suggestProducts(query),
    enabled: query.length > 0,
    staleTime: 30_000,
  });
  const options: Suggestion[] = query && text.trim() ? (data ?? []) : [];
  const expanded = open && options.length > 0;
  const activeIndex = expanded && active < options.length ? active : -1;
  const optionId = (o: Suggestion) => `${listId}-option-${o.id}`;

  const choose = (o: Suggestion) => {
    setOpen(false);
    router.push(`/shop/${o.id}`);
  };
  const submit = () => {
    const q = text.trim();
    if (!q) return;
    setOpen(false);
    router.push(searchHref(q));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (options.length === 0 ? -1 : (i + 1) % options.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0) choose(options[activeIndex]!);
      else submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (expanded) setOpen(false);
      else setText("");
      setActive(-1);
    }
  };

  return (
    <form
      role="search"
      className="relative w-full sm:w-80"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={`${listId}-input`} className="sr-only">
        상품 검색
      </label>
      <div className="flex items-stretch border border-line bg-bg/90 focus-within:border-fg transition-colors">
        <input
          id={`${listId}-input`}
          type="search"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={`${listId}-list`}
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 ? optionId(options[activeIndex]!) : undefined
          }
          autoComplete="off"
          placeholder="상품 검색..."
          className="min-w-0 flex-1 bg-transparent px-3 py-1.5 text-xs text-fg placeholder:text-faint focus:outline-none"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        <button
          type="submit"
          className="border-l border-line px-3 py-1.5 text-[11px] font-medium tracking-wider text-muted hover:text-fg hover:bg-surface/60 transition-colors cursor-pointer"
        >
          검색
        </button>
      </div>
      <ul
        id={`${listId}-list`}
        role="listbox"
        aria-label="추천 상품"
        hidden={!expanded}
        className="absolute inset-x-0 top-full z-30 mt-1 border border-fg bg-bg py-1 shadow-sm"
      >
        {expanded &&
          options.map((o, i) => (
            <li
              key={o.id}
              id={optionId(o)}
              role="option"
              aria-selected={i === activeIndex}
              className="cursor-pointer px-3 py-1.5 text-xs text-fg aria-selected:bg-surface"
              onMouseDown={(e) => {
                e.preventDefault();
                choose(o);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {o.name}
            </li>
          ))}
      </ul>
    </form>
  );
}

export function SearchBoxFallback() {
  return (
    <div
      className="flex w-full sm:w-80 items-stretch border border-line bg-bg/90"
      aria-hidden="true"
    >
      <span className="min-w-0 flex-1 px-3 py-1.5 text-xs text-faint">
        상품 검색...
      </span>
      <span className="border-l border-line px-3 py-1.5 text-[11px] text-muted">
        검색
      </span>
    </div>
  );
}
