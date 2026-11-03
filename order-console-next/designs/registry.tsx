"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { useDefaultDesign } from "@/app/providers";
import {
  useDesignStore,
  withDesign,
} from "@/lib/design-store";
import { storeInfoOptions } from "@/lib/store-info";
import {
  useStorefrontCatalogViewModel,
  type StorefrontProduct,
} from "@/lib/storefront-view-model";
import { EditorialAtelierCatalog } from "./editorial-atelier/catalog";
import { EditorialAtelierDetail } from "./editorial-atelier/detail";
import { EditorialAtelierHeader } from "./editorial-atelier/header";
import { MujiHaraCatalog } from "./muji-hara/catalog";
import { MujiHaraDetail } from "./muji-hara/detail";
import { MujiHaraHeader } from "./muji-hara/header";
import {
  isStoreDesignId,
  resolveActiveDesign,
  type HeaderDesignProps,
  type StoreDesignId,
} from "./types";
import { ZavanasArchiveCatalog } from "./zavanas-archive/catalog";
import { ZavanasArchiveDetail } from "./zavanas-archive/detail";
import { ZavanasArchiveHeader } from "./zavanas-archive/header";
import styles from "./registry.module.css";

function DesignSync({ activeDesign }: { activeDesign: StoreDesignId }) {
  const searchParams = useSearchParams();
  const designParam = searchParams.get("design");
  const setOverrideDesign = useDesignStore((s) => s.setOverrideDesign);

  useEffect(() => {
    if (isStoreDesignId(designParam)) {
      setOverrideDesign(designParam);
    }
    if (typeof document !== "undefined") {
      document.documentElement.dataset.storeDesign = activeDesign;
    }
  }, [designParam, activeDesign, setOverrideDesign]);

  return null;
}

export function StoreHeader({
  design,
  ...props
}: { design: StoreDesignId } & HeaderDesignProps) {
  if (design === "muji-hara") return <MujiHaraHeader {...props} />;
  if (design === "zavanas-archive") return <ZavanasArchiveHeader {...props} />;
  return <EditorialAtelierHeader {...props} />;
}

function InnerCatalog() {
  const searchParams = useSearchParams();
  const designParam = searchParams.get("design");
  const overrideDesign = useDesignStore((s) => s.overrideDesign);
  const { data: storeInfo } = useQuery(storeInfoOptions);
  const defaultDesign = useDefaultDesign();

  const activeDesign = resolveActiveDesign(
    designParam,
    overrideDesign,
    storeInfo?.storeDesign,
    defaultDesign,
  );

  const effectiveDesign = isStoreDesignId(designParam)
    ? designParam
    : overrideDesign ?? activeDesign;

  const linkFor = (href: string) => withDesign(href, effectiveDesign);

  const vm = useStorefrontCatalogViewModel();

  const props = {
    ...vm,
    storeInfo,
    linkFor,
  };

  return (
    <>
      <DesignSync activeDesign={activeDesign} />
      {activeDesign === "muji-hara" && <MujiHaraCatalog {...props} />}
      {activeDesign === "editorial-atelier" && (
        <EditorialAtelierCatalog {...props} />
      )}
      {activeDesign === "zavanas-archive" && (
        <ZavanasArchiveCatalog {...props} />
      )}
    </>
  );
}

export function StorefrontCatalog() {
  return (
    <Suspense fallback={<div className={styles.fallback} />}>
      <InnerCatalog />
    </Suspense>
  );
}

function InnerDetail({
  id,
  initialProduct,
}: {
  id: number;
  initialProduct?: StorefrontProduct | null;
}) {
  const searchParams = useSearchParams();
  const designParam = searchParams.get("design");
  const overrideDesign = useDesignStore((s) => s.overrideDesign);
  const { data: storeInfo } = useQuery(storeInfoOptions);
  const defaultDesign = useDefaultDesign();

  const activeDesign = resolveActiveDesign(
    designParam,
    overrideDesign,
    storeInfo?.storeDesign,
    defaultDesign,
  );

  const effectiveDesign = isStoreDesignId(designParam)
    ? designParam
    : overrideDesign ?? activeDesign;

  const linkFor = (href: string) => withDesign(href, effectiveDesign);

  const props = { id, initialProduct, storeInfo, linkFor };

  return (
    <>
      <DesignSync activeDesign={activeDesign} />
      {activeDesign === "muji-hara" && <MujiHaraDetail {...props} />}
      {activeDesign === "editorial-atelier" && (
        <EditorialAtelierDetail {...props} />
      )}
      {activeDesign === "zavanas-archive" && (
        <ZavanasArchiveDetail {...props} />
      )}
    </>
  );
}

export function StorefrontDetail({
  id,
  initialProduct,
}: {
  id: number;
  initialProduct?: StorefrontProduct | null;
}) {
  return (
    <Suspense fallback={<div className={styles.fallback} />}>
      <InnerDetail id={id} initialProduct={initialProduct} />
    </Suspense>
  );
}
