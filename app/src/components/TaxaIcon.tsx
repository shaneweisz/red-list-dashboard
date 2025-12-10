/**
 * SVG icons for each taxon group
 */

import { CSSProperties } from "react";

interface TaxaIconProps {
  taxonId: string;
  className?: string;
  size?: number;
  style?: CSSProperties;
}

export default function TaxaIcon({ taxonId, className = "", size = 16, style }: TaxaIconProps) {
  const iconProps = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "currentColor",
    className,
    style,
  };

  switch (taxonId) {
    case "mammalia":
      // Elephant/mammal silhouette
      return (
        <svg {...iconProps}>
          <path d="M19.5 10.5c-.83 0-1.5.67-1.5 1.5v1h-1v-2.5c0-1.38-1.12-2.5-2.5-2.5h-1V6c0-1.1-.9-2-2-2s-2 .9-2 2v2H8.5C7.12 8 6 9.12 6 10.5V13H5v-1c0-.83-.67-1.5-1.5-1.5S2 11.17 2 12v4c0 1.1.9 2 2 2h1v1c0 .55.45 1 1 1s1-.45 1-1v-1h10v1c0 .55.45 1 1 1s1-.45 1-1v-1h1c1.1 0 2-.9 2-2v-4c0-.83-.67-1.5-1.5-1.5zM8 14c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"/>
        </svg>
      );

    case "aves":
      // Bird silhouette
      return (
        <svg {...iconProps}>
          <path d="M21.5 6c-1.1 0-2.1.5-2.7 1.3L16 8.8l-1.4-2.1c-.4-.6-1-.9-1.7-.9-.4 0-.8.1-1.1.3L8 8H3c-.6 0-1 .4-1 1s.4 1 1 1h4.3l2.1 4.2c.3.5.8.8 1.4.8h.1c.6-.1 1.1-.5 1.3-1l1.3-3.3 2.5 1.6c.3.2.6.3.9.3.3 0 .6-.1.9-.2l3.5-2.1c.7-.4 1.2-1.2 1.2-2.1 0-1.2-1-2.2-2.5-2.2zM5 15c-.6 0-1 .4-1 1v2c0 .6.4 1 1 1h2c.6 0 1-.4 1-1v-2c0-.6-.4-1-1-1H5z"/>
        </svg>
      );

    case "reptilia":
      // Lizard/reptile silhouette
      return (
        <svg {...iconProps}>
          <path d="M21 9c-1.1 0-2 .9-2 2v1h-2v-1c0-.6-.4-1-1-1h-3V8h1c.6 0 1-.4 1-1V5c0-.6-.4-1-1-1h-2v1h1v1h-3V5h1V4h-2c-.6 0-1 .4-1 1v2c0 .6.4 1 1 1h1v2H6c-.6 0-1 .4-1 1v1H3v-1c0-1.1-.9-2-2-2s-1 .9-1 2v3c0 1.1.9 2 2 2h1v2c0 .6.4 1 1 1h2v-3h1v3h2v-3h1v2h8v-2h1c1.1 0 2-.9 2-2v-3c0-1.1-.9-2-2-2zM5 13c-.6 0-1-.4-1-1s.4-1 1-1 1 .4 1 1-.4 1-1 1z"/>
        </svg>
      );

    case "amphibia":
      // Frog silhouette
      return (
        <svg {...iconProps}>
          <path d="M19 8c-1.7 0-3 1.3-3 3v1h-1v-1c0-2.2-1.8-4-4-4S7 8.8 7 11v1H6v-1c0-1.7-1.3-3-3-3s-3 1.3-3 3v2c0 1.7 1.3 3 3 3h1v3h3v-3h2v3h3v-3h2v3h3v-3h1c1.7 0 3-1.3 3-3v-2c0-1.7-1.3-3-3-3zM5 13c-.6 0-1-.4-1-1s.4-1 1-1 1 .4 1 1-.4 1-1 1zm14 0c-.6 0-1-.4-1-1s.4-1 1-1 1 .4 1 1-.4 1-1 1z"/>
        </svg>
      );

    case "fishes":
      // Fish silhouette
      return (
        <svg {...iconProps}>
          <path d="M12 3C7 3 3 8 2 12c1 4 5 9 10 9 5 0 9-5 10-9-1-4-5-9-10-9zm-1 14.5c-.8 0-1.5-.7-1.5-1.5s.7-1.5 1.5-1.5 1.5.7 1.5 1.5-.7 1.5-1.5 1.5zM22 9l-2.3 3 2.3 3h-3l-1-2 1-4h3zM8.5 12c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5-.7 1.5-1.5 1.5-1.5-.7-1.5-1.5z"/>
        </svg>
      );

    case "invertebrates":
      // Butterfly/insect silhouette
      return (
        <svg {...iconProps}>
          <path d="M12 3c-.6 0-1 .4-1 1v1.5c-2.1.5-4 2.1-5.2 4.5-1.4-.5-2.8-.5-4 .5-.7.6-.8 1.5-.3 2.2.3.4.7.7 1.2.8 1 .2 2-.1 2.8-.8.5 1.3 1.2 2.4 2.1 3.3-.9.9-1.6 2-2.1 3.3-.8-.7-1.8-1-2.8-.8-.5.1-.9.4-1.2.8-.5.7-.4 1.6.3 2.2 1.2 1 2.6 1 4 .5 1.2 2.4 3.1 4 5.2 4.5V22c0 .6.4 1 1 1s1-.4 1-1v-1.5c2.1-.5 4-2.1 5.2-4.5 1.4.5 2.8.5 4-.5.7-.6.8-1.5.3-2.2-.3-.4-.7-.7-1.2-.8-1-.2-2 .1-2.8.8-.5-1.3-1.2-2.4-2.1-3.3.9-.9 1.6-2 2.1-3.3.8.7 1.8 1 2.8.8.5-.1.9-.4 1.2-.8.5-.7.4-1.6-.3-2.2-1.2-1-2.6-1-4-.5-1.2-2.4-3.1-4-5.2-4.5V4c0-.6-.4-1-1-1zm0 5c1.7 0 3 1.3 3 3v2c0 1.7-1.3 3-3 3s-3-1.3-3-3v-2c0-1.7 1.3-3 3-3z"/>
        </svg>
      );

    case "plantae":
      // Leaf/plant silhouette
      return (
        <svg {...iconProps}>
          <path d="M17 8C8 10 5.9 16.2 5.5 20.5c-.1.8.5 1.5 1.3 1.5.5 0 1-.3 1.2-.8C9 18.9 11.2 17 15 16.8V19c0 .6.4 1 1 1s1-.4 1-1v-5c4-.5 5-4 5-8 0-.6-.4-1-1-1-4 0-7.5 1-4 3z"/>
        </svg>
      );

    case "fungi":
      // Mushroom silhouette
      return (
        <svg {...iconProps}>
          <path d="M12 2C6.5 2 2 6.5 2 12c0 1.1.9 2 2 2h2v5c0 1.7 1.3 3 3 3h6c1.7 0 3-1.3 3-3v-5h2c1.1 0 2-.9 2-2 0-5.5-4.5-10-10-10zm2 17H10v-5h4v5zm-2-9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
        </svg>
      );

    default:
      // Default circle
      return (
        <svg {...iconProps}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
  }
}
