import type { MetadataRoute } from "next";

/** A private app: no search engine should crawl or list any of it. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
