/**
 * Opens an outside link in a new tab for the AI's open_link tool. Browsers block tabs a page opens
 * without a recent tap, so this reports whether it worked; when blocked, the link's button stays on
 * screen to tap (or the owner allows pop-ups for this site once, and it always works after that).
 */
export function openExternal(href: string) {
  if (!/^https?:\/\//.test(href)) return false;
  const w = window.open(href, "_blank");
  if (!w) return false;
  try {
    w.opener = null;
  } catch {}
  return true;
}
