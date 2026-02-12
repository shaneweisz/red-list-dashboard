"use client";

import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

/** Renders a small photo tooltip above a lat/lng point on the map using native Leaflet. */
export default function MapImageTooltip({
  lat,
  lng,
  imageUrl,
}: {
  lat: number;
  lng: number;
  imageUrl: string;
}) {
  const map = useMap();

  useEffect(() => {
    const tooltip = L.tooltip({
      permanent: true,
      direction: "top",
      offset: [0, -10],
      opacity: 1,
    })
      .setLatLng([lat, lng])
      .setContent(
        `<img src="${imageUrl}" style="width:80px;height:60px;object-fit:cover;border-radius:4px;display:block" alt="" />`
      )
      .addTo(map);

    return () => {
      map.removeLayer(tooltip);
    };
  }, [map, lat, lng, imageUrl]);

  return null;
}
