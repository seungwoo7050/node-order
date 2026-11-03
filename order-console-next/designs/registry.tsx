"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { storeInfoOptions } from "@/lib/store-info";
import { useStorefrontCatalogViewModel } from "@/lib/storefront-view-model";
import { EditorialAtelierCatalog } from "./editorial-atelier/catalog";
import { EditorialAtelierDetail } from "./editorial-atelier/detail";
import { MujiHaraCatalog } from "./muji-hara/catalog";
import { MujiHaraDetail } from "./muji-hara/detail";
import { DesignSwitcher } from "./switcher";
import type { DetailDesignProps, StoreDesignId } from "./types";
import { ZavanasArchiveCatalog } from "./zavanas-archive/catalog";
import { ZavanasArchiveDetail } from "./zavanas-archive/detail";

function resolveActiveDesign(param: string | null, serverDesign?: string): StoreDesignId {
  if (param === "muji-hara" || param === "editorial-atelier" || param === "zavanas-archive") {
    return param;
  }
  if (serverDesign === "muji-hara" || serverDesign === "editorial-atelier" || serverDesign === "zavanas-archive") {
    return serverDesign;
  }
  return "editorial-atelier";
}

function InnerCatalog() {
  const searchParams = useSearchParams();
  const designParam = searchParams.get("design");
  const { data: storeInfo } = useQuery(storeInfoOptions);

  const activeDesign = resolveActiveDesign(designParam, storeInfo?.storeDesign);
  const vm = useStorefrontCatalogViewModel();

  const props = {
    ...vm,
    storeInfo,
  };

  return (
    <>
      <DesignSwitcher activeDesign={activeDesign} />
      {activeDesign === "muji-hara" && <MujiHaraCatalog {...props} />}
      {activeDesign === "editorial-atelier" && <EditorialAtelierCatalog {...props} />}
      {activeDesign === "zavanas-archive" && <ZavanasArchiveCatalog {...props} />}
    </>
  );
}

export function StorefrontCatalog() {
  return (
    <Suspense fallback={<div className="py-8 text-sm text-muted">스토어 로딩 중...</div>}>
      <InnerCatalog />
    </Suspense>
  );
}

function InnerDetail({ id, initialProduct }: DetailDesignProps) {
  const searchParams = useSearchParams();
  const designParam = searchParams.get("design");
  const { data: storeInfo } = useQuery(storeInfoOptions);

  const activeDesign = resolveActiveDesign(designParam, storeInfo?.storeDesign);
  const props = { id, initialProduct, storeInfo };

  return (
    <>
      <DesignSwitcher activeDesign={activeDesign} />
      {activeDesign === "muji-hara" && <MujiHaraDetail {...props} />}
      {activeDesign === "editorial-atelier" && <EditorialAtelierDetail {...props} />}
      {activeDesign === "zavanas-archive" && <ZavanasArchiveDetail {...props} />}
    </>
  );
}

export function StorefrontDetail({ id, initialProduct }: DetailDesignProps) {
  return (
    <Suspense fallback={<div className="py-8 text-sm text-muted">상품 로딩 중...</div>}>
      <InnerDetail id={id} initialProduct={initialProduct} />
    </Suspense>
  );
}
