/**
 * Wraps every inner page and is re-created on each navigation (unlike a layout), so a page arriving fades in.
 * Opacity only: a transform here would re-anchor the fixed bars inside full-screen pages for a moment.
 */
export default function PagesTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-fade">{children}</div>;
}
