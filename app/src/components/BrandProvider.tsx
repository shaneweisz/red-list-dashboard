"use client";

import { createContext, useContext } from "react";
import type { Brand } from "../config/brand";

const BrandContext = createContext<Brand>({
  title: "Dash of Life: A Dashboard for Conservation of Threatened Species",
  description: "A dashboard for biodiversity data about life on Earth",
  assessedTabLabel: "Red List Assessed",
  unassessedTabLabel: "Unassessed",
  showGlobe: true,
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
