import type { SVGProps } from "react";

/** Four rotors around a concave body, matching the game's drone silhouette. */
export function DroneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M7 7Q12 9.5 17 7Q14.5 12 17 17Q12 14.5 7 17Q9.5 12 7 7Z" fill="currentColor" />
      <path d="m7 7-3-3m13 3 3-3M7 17l-3 3m13-3 3 3M2 6l4-4m12 0 4 4M2 18l4 4m12 0 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
