"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { searchHref, suggestProducts, SUGGEST_DEBOUNCE_MS, type Suggestion } from "@/lib/search";

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// 상점 머리글의 검색 상자. WAI-ARIA 콤보박스 패턴:
//   ↓/↑ 추천 사이를 옮긴다(포커스는 입력 칸에 두고 aria-activedescendant로 알린다)
//   Enter 고른 추천이 있으면 그 상품으로, 없으면 결과 페이지(/shop/search?q=)로
//   Esc 추천을 닫고, 닫혀 있으면 입력을 지운다
// 결과 페이지에서는 주소의 q가 원본이라 입력 칸을 그 값으로 맞춘다.
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

  // 주소의 q가 바뀌면(뒤로 가기, 인기 검색어 칩) 입력 칸을 따라 바꾼다(렌더 중 상태 맞추기)
  if (syncedFrom !== urlQuery) {
    setSyncedFrom(urlQuery);
    setText(urlQuery);
  }

  const query = useDebounced(text.trim(), SUGGEST_DEBOUNCE_MS);
  const { data } = useQuery({ queryKey: ["suggest", query], queryFn: () => suggestProducts(query), enabled: query.length > 0, staleTime: 30_000 });
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
      e.preventDefault(); // type="search"는 Esc에 값을 지우는 기본 동작이 있다. 열려 있으면 닫기만 한다
      if (expanded) setOpen(false);
      else setText("");
      setActive(-1);
    }
  };

  return (
    <form role="search" className="relative mb-6" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <label htmlFor={`${listId}-input`} className="sr-only">상품 검색</label>
      <div className="flex gap-2">
        <input
          id={`${listId}-input`}
          type="search"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={`${listId}-list`}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? optionId(options[activeIndex]!) : undefined}
          autoComplete="off"
          placeholder="상품 검색"
          className="min-w-0 flex-1 border border-line-strong bg-bg px-3 py-2"
          value={text}
          onChange={(e) => { setText(e.target.value); setOpen(true); setActive(-1); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className="btn">검색</button>
      </div>
      <ul id={`${listId}-list`} role="listbox" aria-label="추천 상품" hidden={!expanded}
        className="absolute inset-x-0 top-full z-10 mt-1 border border-line-strong bg-bg py-1">
        {expanded && options.map((o, i) => (
          <li key={o.id} id={optionId(o)} role="option" aria-selected={i === activeIndex}
            className="cursor-pointer px-3 py-1.5 aria-selected:bg-surface"
            onMouseDown={(e) => { e.preventDefault(); choose(o); }}
            onMouseEnter={() => setActive(i)}>
            {o.name}
          </li>
        ))}
      </ul>
    </form>
  );
}

// Suspense가 주소를 읽기 전에 보이는 같은 모양의 자리
export function SearchBoxFallback() {
  return (
    <div className="mb-6 flex gap-2" aria-hidden="true">
      <span className="min-w-0 flex-1 border border-line-strong px-3 py-2 text-faint">상품 검색</span>
      <span className="btn">검색</span>
    </div>
  );
}
