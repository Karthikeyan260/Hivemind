/** Small helpers that pages need without loading the whole film catalogue. */
export const runtime = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m` : `${min}m`);
