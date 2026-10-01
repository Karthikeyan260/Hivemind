/** Pages open to people other than the owner (no password): owner-only widgets stay off there. */
export const isPublicPage = (path: string) => path.startsWith("/unlock") || path.startsWith("/call/");
