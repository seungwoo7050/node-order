"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useDesignStore } from "@/lib/design-store";
import styles from "./switcher.module.css";
import { STORE_DESIGNS, type StoreDesignId } from "./types";

const SWATCH_CLASSES: Record<StoreDesignId, [string, string, string]> = {
  "editorial-atelier": [
    styles.swEditorial0,
    styles.swEditorial1,
    styles.swEditorial2,
  ],
  "muji-hara": [styles.swMuji0, styles.swMuji1, styles.swMuji2],
  "zavanas-archive": [
    styles.swZavanas0,
    styles.swZavanas1,
    styles.swZavanas2,
  ],
};

export function DesignSwitcher({ activeDesign }: { activeDesign: StoreDesignId }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const setOverrideDesign = useDesignStore((s) => s.setOverrideDesign);

  useEffect(() => {
    document.documentElement.dataset.storeDesign = activeDesign;
    const param = searchParams.get("design");
    if (
      param === "muji-hara" ||
      param === "editorial-atelier" ||
      param === "zavanas-archive"
    ) {
      setOverrideDesign(param);
    } else {
      setOverrideDesign(null);
    }
  }, [activeDesign, searchParams, setOverrideDesign]);

  const handleSelect = (id: StoreDesignId) => {
    setOverrideDesign(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set("design", id);
    router.replace(`${pathname}?${params.toString()}`);
  };

  const activeConfig =
    STORE_DESIGNS.find((d) => d.id === activeDesign) ?? STORE_DESIGNS[0]!;

  return (
    <div
      data-testid="design-switcher"
      className={styles.switcherBar}
      aria-label="스토어 디자인 아키타입 전환"
    >
      <span className={styles.switcherLabel}>
        <span>STOREFRONT EDITION</span>
        <strong>
          {activeConfig.number} / 03 · {activeConfig.subtitle}
        </strong>
      </span>

      <div className={styles.switcherOptions}>
        {STORE_DESIGNS.map((d) => {
          const isActive = activeDesign === d.id;
          const swatchClasses = SWATCH_CLASSES[d.id];
          return (
            <button
              key={d.id}
              type="button"
              data-testid={`design-option-${d.id}`}
              aria-pressed={isActive}
              title={d.subtitle}
              onClick={() => handleSelect(d.id)}
              className={`${styles.optionBtn} ${
                isActive ? styles.optionBtnActive : ""
              }`}
            >
              <span className={styles.swatch} aria-hidden="true">
                <span className={swatchClasses[0]} />
                <span className={swatchClasses[1]} />
                <span className={swatchClasses[2]} />
              </span>
              <span className={styles.num}>{d.number}</span>
              <span className={styles.koName}>{d.koName}</span>
              <span className={styles.badge}>{d.badge}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
