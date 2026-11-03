import { create } from "zustand";
import type { StoreDesignId } from "@/designs/types";

type DesignStore = {
  overrideDesign: StoreDesignId | null;
  setOverrideDesign: (design: StoreDesignId | null) => void;
};

export const useDesignStore = create<DesignStore>((set) => ({
  overrideDesign: null,
  setOverrideDesign: (overrideDesign) => set({ overrideDesign }),
}));
