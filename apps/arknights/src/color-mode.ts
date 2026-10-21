export const COLOR_MODE_STORAGE_KEY = "riic-color-mode";
export type ColorMode = "light" | "dark";
export function parseColorMode(value: unknown): ColorMode {
  return value === "dark" ? "dark" : "light";
}

/** Restore the explicit choice before the first paint. */
export const COLOR_MODE_BOOTSTRAP = `try{var m=localStorage.getItem('${COLOR_MODE_STORAGE_KEY}')==='dark'?'dark':'light';document.documentElement.classList.toggle('dark',m==='dark');document.documentElement.style.colorScheme=m}catch{}`;
