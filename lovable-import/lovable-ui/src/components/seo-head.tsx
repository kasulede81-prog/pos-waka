interface SeoMetaInput {
  title: string;
  description: string;
  path: string;
  ogType?: "website" | "article";
}

/**
 * Returns a TanStack route head() meta + links array.
 * Use inside createFileRoute({ head: () => seoHead({ ... }) })
 */
export function seoHead({ title, description, path, ogType = "website" }: SeoMetaInput) {
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: ogType },
      { property: "og:url", content: path },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
    links: [{ rel: "canonical", href: path }],
  };
}
