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

const QUICK_KEYWORDS = [
  "테헤란로",
  "성수이로",
  "판교역로",
  "강남대로",
  "세종대로",
  "을지로",
  "해운대",
  "부산",
] as const;

const DEFAULT_SAMPLE_ADDRESSES: AddressSearchResult[] = [
  {
    postalCode: "06236",
    roadAddress: "서울특별시 강남구 테헤란로 123",
    jibunAddress: "서울특별시 강남구 역삼동 648-1",
    buildingName: "테헤란타워",
  },
  {
    postalCode: "04779",
    roadAddress: "서울특별시 성동구 성수이로 51",
    jibunAddress: "서울특별시 성동구 성수동2가 315-71",
    buildingName: "서울숲한라시그마밸리",
  },
  {
    postalCode: "13494",
    roadAddress: "경기도 성남시 분당구 판교역로 235",
    jibunAddress: "경기도 성남시 분당구 삼평동 681",
    buildingName: "에이치스퀘어 N동",
  },
  {
    postalCode: "06035",
    roadAddress: "서울특별시 강남구 가로수길 43",
    jibunAddress: "서울특별시 강남구 신사동 535-12",
    buildingName: "신사빌딩",
  },
  {
    postalCode: "03172",
    roadAddress: "서울특별시 종로구 세종대로 175",
    jibunAddress: "서울특별시 종로구 세종로 81-3",
    buildingName: "세종문화회관",
  },
];

export function AddressSearchModal({ onSelect, buttonLabel = "우편번호 찾기" }: AddressSearchModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AddressSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const runSearch = async (rawQuery: string) => {
    const q = rawQuery.trim() || "서울";
    setIsLoading(true);
    setResults([]);
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
    await runSearch(query);
  };

  const handleQuickKeyword = (kw: string) => {
    setQuery(kw);
    void runSearch(kw);
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
          <div className="w-full max-w-lg rounded bg-bg p-6 shadow-lg border border-line">
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

            <div className="flex gap-2 mb-2.5">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleSearch();
                  }
                }}
                placeholder="도로명, 건물명, 지번 검색 (예: 테헤란로 123)"
                className="flex-1 border border-line px-3 py-1.5 text-sm rounded"
                data-testid="address-search-input"
                autoFocus
              />
              <button
                type="button"
                className="btn text-sm px-4"
                disabled={isLoading}
                onClick={() => void handleSearch()}
              >
                {isLoading ? "검색 중…" : "검색"}
              </button>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted mr-1">추천 검색어:</span>
              {QUICK_KEYWORDS.map((kw) => (
                <button
                  key={kw}
                  type="button"
                  onClick={() => handleQuickKeyword(kw)}
                  className="border border-line px-2 py-0.5 rounded hover:bg-neutral-100 text-muted hover:text-fg transition"
                >
                  {kw}
                </button>
              ))}
            </div>

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
                <div className="p-6 text-center text-muted text-sm space-y-3">
                  <p>일치하는 내장 도로명 주소가 없습니다.</p>
                  <p className="text-xs leading-relaxed">
                    현재 외부 행안부 도로명주소 API 키(<code>JUSO_API_KEY</code>)가 설정되지 않아 내장된 주요 도로명 데이터셋(테헤란로, 성수이로, 판교역로 등 60여 건)으로 동작 중입니다.
                  </p>
                  {query.trim() && (
                    <div className="pt-1 flex justify-center gap-2">
                      <button
                        type="button"
                        className="btn text-xs px-3 py-1.5"
                        onClick={() =>
                          handleSelect({
                            postalCode: "06236",
                            roadAddress: query.trim(),
                            jibunAddress: "",
                            buildingName: "",
                          })
                        }
                      >
                        &ldquo;{query.trim()}&rdquo; 주소로 직접 적용 (06236)
                      </button>
                      <button
                        type="button"
                        className="border border-line text-xs px-3 py-1.5 rounded hover:bg-neutral-100"
                        onClick={() => handleQuickKeyword("서울")}
                      >
                        기본 주소 목록 보기
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-line">
                  <div className="bg-neutral-50 px-3 py-2 text-xs text-muted">
                    자주 찾는 대표 도로명 주소 (클릭 시 바로 적용 · 검색어 입력 가능)
                  </div>
                  {DEFAULT_SAMPLE_ADDRESSES.map((item, idx) => (
                    <button
                      key={`sample-${item.postalCode}-${idx}`}
                      type="button"
                      className="w-full p-3 text-left hover:bg-neutral-100 transition flex flex-col gap-1"
                      data-testid="address-preset-item"
                      onClick={() => handleSelect(item)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs px-1.5 py-0.5 bg-neutral-200 rounded text-neutral-800">
                          {item.postalCode}
                        </span>
                        <span className="font-medium">{item.roadAddress}</span>
                      </div>
                      {item.buildingName && (
                        <span className="text-xs text-muted">
                          [건물] {item.buildingName} · {item.jibunAddress}
                        </span>
                      )}
                    </button>
                  ))}
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
