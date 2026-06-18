"use client";

import { createContext, useContext } from "react";
import type { Brand } from "../config/brand";

const BrandContext = createContext<Brand>({
  title: "IUCN Red List Assessments Dashboard",
  description: "IUCN Red List and GBIF occurrence data explorer",
});

export function BrandProvider({
  brand,
  children,
}: {
  brand: Brand;
  children: React.ReactNode;
}) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

export function useBrand(): Brand {
  return useContext(BrandContext);
}
