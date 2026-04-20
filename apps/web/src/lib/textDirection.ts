export type TextDirection = "ltr" | "rtl" | "auto";

const RTL_CHAR_REGEX = /[\u0591-\u08FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;
const LTR_CHAR_REGEX = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u052F]/;

export function resolveTextDirection(text: string): TextDirection {
  for (const character of text) {
    if (RTL_CHAR_REGEX.test(character)) {
      return "rtl";
    }
    if (LTR_CHAR_REGEX.test(character)) {
      return "ltr";
    }
  }

  return "auto";
}

export function isRtlText(text: string): boolean {
  return resolveTextDirection(text) === "rtl";
}
