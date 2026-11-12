import type { SVGProps } from "react";

// Upstream draws its "T3" mark here and every brand slot imports it, so Kodo swaps the drawing
// and keeps the name: a single-colour octagon emblem with the 香道 (kōdō) kanji.
export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="40 40 220 220" xmlns="http://www.w3.org/2000/svg">
      <polygon
        points="91.4,45 208.6,45 255,91.4 255,208.6 208.6,255 91.4,255 45,208.6 45,91.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="14"
        strokeLinejoin="miter"
      />
      <g
        fill="currentColor"
        fontFamily="'Noto Sans CJK JP', 'Noto Sans CJK SC', 'Noto Sans', sans-serif"
        fontSize="84"
        fontWeight="600"
        textAnchor="middle"
      >
        <text x="150" y="138">
          香
        </text>
        <text x="150" y="222">
          道
        </text>
      </g>
    </svg>
  );
}
