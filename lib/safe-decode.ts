/**
 * decodeURIComponent that never throws: web addresses in the wild contain stray "%" signs ("/sale?off=100%"),
 * and the plain decoder throws "URI malformed" on those. A bad one is returned as it is.
 */
export function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
