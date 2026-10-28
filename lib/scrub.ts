/**
 * Text that is safe to hand to the database: no NUL character, and no lone half of an emoji.
 * An emoji is two UTF-16 units, so cutting a string with slice() can leave one half behind (a title taken from the
 * first 60 characters, a chunk edge): the database refuses either, and the whole save fails.
 */
const BROKEN_HALF = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const NUL = /\u0000/g;

export const scrub = (s: string) => s.replace(NUL, "").replace(BROKEN_HALF, "");
