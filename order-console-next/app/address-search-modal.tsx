"use client";

import { useState } from "react";
import { API_URL } from "@/lib/api-client";

export interface AddressSearchResult {
  postalCode: string;
  roadAddress: string;
  jibunAddress: string;
  buildingName: string;
}

interface AddressSearchModalProps {
  onSelect: (address: { postalCode: string; address1: string }) => void;
  buttonLabel?: string;
}

export function AddressSearchModal({ onSelect, buttonLabel = "우편번호 찾기" }: AddressSearchModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AddressSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleOpen = () => {
    setIsOpen(true);
    setQuery("");
    setResults([]);
    setSearched(false);
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = query.trim();
    if (!q) return;

    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/addresses/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = (await res.json()) as { items: AddressSearchResult[] };
        setResults(data.items ?? []);
      } else {
        setResults([]);
      }
    } catch {
      setResults([]);
    } finally {
      setIsLoading(false);
      setSearched(true);
    }
  };

  const handleSelect = (item: AddressSearchResult) => {
    onSelect({
      postalCode: item.postalCode,
      address1: item.roadAddress,
    });
    handleClose();
  };

  return (
    <>
      <button
        type="button"
        className="btn text-xs py-1.5 px-3 self-end"
        data-testid="open-address-search"
        onClick={handleOpen}
      >
        {buttonLabel}
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="address-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-lg rounded bg-bg p-6 shadow-xl border border-line">
            <div className="flex items-center justify-between pb-3 border-b border-line mb-4">
              <h2 id="address-modal-title" className="text-base font-semibold">
                우편번호 · 주소 검색
              </h2>
              <button
                type="button"
                onClick={handleClose}
                aria-label="닫기"
                className="text-muted hover:text-fg text-lg p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSearch} className="flex gap-2 mb-4">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="도로명, 건물명, 지번 검색 (예: 테헤란로 123)"
                className="flex-1 border border-line px-3 py-1.5 text-sm rounded"
                data-testid="address-search-input"
                autoFocus
              />
              <button
                type="submit"
                className="btn text-sm px-4"
                disabled={isLoading}
              >
                {isLoading ? "검색 중…" : "검색"}
              </button>
            </form>

            <div className="max-h-64 overflow-y-auto divide-y divide-line text-sm border border-line rounded">
              {results.length > 0 ? (
                results.map((item, idx) => (
                  <button
                    key={`${item.postalCode}-${idx}`}
                    type="button"
                    className="w-full p-3 text-left hover:bg-neutral-100 transition flex flex-col gap-1"
                    data-testid="address-result-item"
                    onClick={() => handleSelect(item)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs px-1.5 py-0.5 bg-neutral-200 rounded text-neutral-800">
                        {item.postalCode}
                      </span>
                      <span className="font-medium">{item.roadAddress}</span>
                    </div>
                    {item.jibunAddress && (
                      <span className="text-xs text-muted">
                        [지번] {item.jibunAddress}
                      </span>
                    )}
                    {item.buildingName && (
                      <span className="text-xs text-muted">
                        [건물] {item.buildingName}
                      </span>
                    )}
                  </button>
                ))
              ) : searched ? (
                <div className="p-8 text-center text-muted text-sm">
                  검색 결과가 없습니다.
                </div>
              ) : (
                <div className="p-8 text-center text-muted text-sm">
                  도로명이나 건물명을 입력하고 검색해 주세요.
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="btn text-sm px-4"
                onClick={handleClose}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
