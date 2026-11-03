import { create } from "zustand";
import { isStoreDesignId, type StoreDesignId } from "@/designs/types";

const KEY = "store-design";

type DesignStore = {
  overrideDesign: StoreDesignId | null;
  setOverrideDesign: (design: StoreDesignId | null) => void;
};

export const useDesignStore = create<DesignStore>((set) => ({
  overrideDesign: null,
  setOverrideDesign: (overrideDesign) => {
    set({ overrideDesign });
    try {
      if (overrideDesign) {
        sessionStorage.setItem(KEY, overrideDesign);
      } else {
        sessionStorage.removeItem(KEY);
      }
    } catch {}
  },
}));

export function readDomDesign(): StoreDesignId | null {
  if (typeof document === "undefined") return null;
  const attr = document.documentElement.dataset.storeDesign;
  return isStoreDesignId(attr) ? attr : null;
}

export function setActiveStoreDesign(design: StoreDesignId | null) {
  useDesignStore.getState().setOverrideDesign(design);
  if (typeof document !== "undefined" && design) {
    document.documentElement.dataset.storeDesign = design;
  }
}

export function useActiveStoreDesign(): StoreDesignId | null {
  return useDesignStore((s) => s.overrideDesign);
}

/** 하이드레이션 뒤 effect에서만 부른다 */
export function restoreSessionDesign() {
  try {
    const v = sessionStorage.getItem(KEY);
    if (isStoreDesignId(v) && useDesignStore.getState().overrideDesign === null) {
      useDesignStore.setState({ overrideDesign: v });
      if (typeof document !== "undefined") {
        document.documentElement.dataset.storeDesign = v;
      }
    }
  } catch {}
}

export function withDesign(href: string, design: StoreDesignId | null): string {
  if (!design) return href;
  if (href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("#")) {
    return href;
  }
  const [path, query = ""] = href.split("?");
  const p = new URLSearchParams(query);
  p.set("design", design);
  return `${path}?${p.toString()}`;
}

export function useLinkFor(): (href: string) => string {
  const override = useDesignStore((s) => s.overrideDesign);
  return (href: string) => withDesign(href, override);
}
