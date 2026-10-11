/**
 * A fast chess board for the bot's search only (the game itself uses chess.js for rules, SAN and
 * draws). 0x88 board, legal moves by make → king-in-check → unmake, an undo stack. Checked against
 * the standard perft counts in tests/chess-fast.test.ts.
 */
// Pieces: 1..6 = P N B R Q K for white, +8 for black. 0 = empty.
export const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
const BLACK = 8;
const typeOf = (p: number) => p & 7;
const colorOf = (p: number) => (p & 8 ? 1 : 0); // 0 white, 1 black

export type FMove = { from: number; to: number; piece: number; captured: number; promo: number; flag: 0 | 1 | 2 | 3 }; // 1 en passant, 2 castle, 3 double push
type Undo = { m: FMove; castle: number; ep: number; half: number; capturedSq: number };

const KNIGHT = [-33, -31, -18, -14, 14, 18, 31, 33];
const KING = [-17, -16, -15, -1, 1, 15, 16, 17];
const DIAG = [-17, -15, 15, 17];
const ORTHO = [-16, -1, 1, 16];
const sqName = (s: number) => "abcdefgh"[s & 7] + (8 - (s >> 4));
const sqOf = (name: string) => (8 - Number(name[1])) * 16 + "abcdefgh".indexOf(name[0]);

export class FastBoard {
  b = new Int8Array(128);
  side = 0;
  /** Castling rights: 1 white king side, 2 white queen side, 4 black king side, 8 black queen side. */
  castle = 0;
  ep = -1;
  half = 0;
  kings = [0, 0];
  private stack: Undo[] = [];

  static fromFen(fen: string): FastBoard {
    const f = new FastBoard();
    const [pos, side, castle, ep, half] = fen.split(" ");
    let r = 0;
    let c = 0;
    for (const ch of pos) {
      if (ch === "/") {
        r++;
        c = 0;
      } else if (/\d/.test(ch)) c += Number(ch);
      else {
        const t = "pnbrqk".indexOf(ch.toLowerCase()) + 1;
        const p = t + (ch === ch.toLowerCase() ? BLACK : 0);
        f.b[r * 16 + c] = p;
        if (t === K) f.kings[colorOf(p)] = r * 16 + c;
        c++;
      }
    }
    f.side = side === "b" ? 1 : 0;
    f.castle = (castle.includes("K") ? 1 : 0) | (castle.includes("Q") ? 2 : 0) | (castle.includes("k") ? 4 : 0) | (castle.includes("q") ? 8 : 0);
    f.ep = ep && ep !== "-" ? sqOf(ep) : -1;
    f.half = Number(half) || 0;
    return f;
  }

  /** Is square `s` attacked by side `by`? */
  attacked(s: number, by: number): boolean {
    const b = this.b;
    const own = by ? BLACK : 0;
    // Pawns attack diagonally forward (for white, from a lower rank = higher index).
    const pd = by ? -16 : 16;
    for (const d of [pd - 1, pd + 1]) {
      const t = s + d;
      if (!(t & 0x88) && b[t] === own + P) return true;
    }
    for (const d of KNIGHT) {
      const t = s + d;
      if (!(t & 0x88) && b[t] === own + N) return true;
    }
    for (const d of KING) {
      const t = s + d;
      if (!(t & 0x88) && b[t] === own + K) return true;
    }
    for (const d of DIAG)
      for (let t = s + d; !(t & 0x88); t += d) {
        const p = b[t];
        if (!p) continue;
        if (p === own + B || p === own + Q) return true;
        break;
      }
    for (const d of ORTHO)
      for (let t = s + d; !(t & 0x88); t += d) {
        const p = b[t];
        if (!p) continue;
        if (p === own + R || p === own + Q) return true;
        break;
      }
    return false;
  }

  inCheck(side = this.side) {
    return this.attacked(this.kings[side], side ^ 1);
  }

  /** Pseudo-legal moves (may leave the king in check); `captures` = captures and promotions only. */
  private pseudo(captures = false): FMove[] {
    const out: FMove[] = [];
    const b = this.b;
    const me = this.side;
    const add = (from: number, to: number, piece: number, captured: number, flag: FMove["flag"] = 0) => out.push({ from, to, piece, captured, promo: 0, flag });
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) {
        s += 7;
        continue;
      }
      const p = b[s];
      if (!p || colorOf(p) !== me) continue;
      const t = typeOf(p);
      if (t === P) {
        const dir = me ? 16 : -16;
        const startRank = me ? 1 : 6;
        const lastRank = me ? 7 : 0;
        const one = s + dir;
        const promoteAt = (to: number) => to >> 4 === lastRank;
        const pushPromos = (from: number, to: number, cap: number) => {
          for (const pr of [Q, R, B, N]) out.push({ from, to, piece: p, captured: cap, promo: pr + (me ? BLACK : 0), flag: 0 });
        };
        if (!(one & 0x88) && !b[one]) {
          if (promoteAt(one)) pushPromos(s, one, 0);
          else if (!captures) {
            add(s, one, p, 0);
            const two = one + dir;
            if (s >> 4 === startRank && !b[two]) add(s, two, p, 0, 3);
          }
        }
        for (const d of [dir - 1, dir + 1]) {
          const to = s + d;
          if (to & 0x88) continue;
          const q = b[to];
          if (q && colorOf(q) !== me) {
            if (promoteAt(to)) pushPromos(s, to, q);
            else add(s, to, p, q);
          } else if (to === this.ep) add(s, to, p, (me ? 0 : BLACK) + P, 1);
        }
        continue;
      }
      const steps = t === N ? KNIGHT : t === K ? KING : t === B ? DIAG : t === R ? ORTHO : [...DIAG, ...ORTHO];
      const slide = t === B || t === R || t === Q;
      for (const d of steps)
        for (let to = s + d; !(to & 0x88); to += d) {
          const q = b[to];
          if (q) {
            if (colorOf(q) !== me) add(s, to, p, q);
            break;
          }
          if (!captures) add(s, to, p, 0);
          if (!slide) break;
        }
      // Castling: rights, empty squares, and not through or out of check.
      if (t === K && !captures) {
        const home = me ? 4 : 116;
        if (s === home && !this.attacked(s, me ^ 1)) {
          const ks = me ? 4 : 1;
          const qs = me ? 8 : 2;
          if (this.castle & ks && !b[s + 1] && !b[s + 2] && !this.attacked(s + 1, me ^ 1) && !this.attacked(s + 2, me ^ 1)) add(s, s + 2, p, 0, 2);
          if (this.castle & qs && !b[s - 1] && !b[s - 2] && !b[s - 3] && !this.attacked(s - 1, me ^ 1) && !this.attacked(s - 2, me ^ 1)) add(s, s - 2, p, 0, 2);
        }
      }
    }
    return out;
  }

  /** Legal moves (captures only, for the quiet search, when asked). */
  moves(captures = false): FMove[] {
    const legal: FMove[] = [];
    for (const m of this.pseudo(captures)) {
      this.make(m);
      if (!this.inCheck(this.side ^ 1)) legal.push(m);
      this.unmake();
    }
    return legal;
  }

  make(m: FMove) {
    const b = this.b;
    const capturedSq = m.flag === 1 ? m.to + (this.side ? -16 : 16) : m.to;
    this.stack.push({ m, castle: this.castle, ep: this.ep, half: this.half, capturedSq });
    b[capturedSq] = 0;
    b[m.to] = m.promo || m.piece;
    b[m.from] = 0;
    if (m.flag === 2) {
      // Castling: the rook jumps over.
      const kingSide = m.to > m.from;
      const rookFrom = kingSide ? m.from + 3 : m.from - 4;
      const rookTo = kingSide ? m.from + 1 : m.from - 1;
      b[rookTo] = b[rookFrom];
      b[rookFrom] = 0;
    }
    if (typeOf(m.piece) === K) this.kings[this.side] = m.to;
    // Rights are lost when the king or a rook moves, or a rook is captured on its corner.
    for (const sq of [m.from, m.to]) {
      if (sq === 116) this.castle &= ~3;
      if (sq === 4) this.castle &= ~12;
      if (sq === 119) this.castle &= ~1;
      if (sq === 112) this.castle &= ~2;
      if (sq === 7) this.castle &= ~4;
      if (sq === 0) this.castle &= ~8;
    }
    this.ep = m.flag === 3 ? (m.from + m.to) >> 1 : -1;
    this.half = typeOf(m.piece) === P || m.captured ? 0 : this.half + 1;
    this.side ^= 1;
  }

  unmake() {
    const u = this.stack.pop()!;
    const m = u.m;
    const b = this.b;
    this.side ^= 1;
    b[m.from] = m.piece;
    b[m.to] = 0;
    b[u.capturedSq] = m.captured;
    if (m.flag === 2) {
      const kingSide = m.to > m.from;
      const rookFrom = kingSide ? m.from + 3 : m.from - 4;
      const rookTo = kingSide ? m.from + 1 : m.from - 1;
      b[rookFrom] = b[rookTo];
      b[rookTo] = 0;
    }
    if (typeOf(m.piece) === K) this.kings[this.side] = m.from;
    this.castle = u.castle;
    this.ep = u.ep;
    this.half = u.half;
  }

  /** "e2e4" / "e7e8q" for a move. */
  static uci(m: FMove) {
    return sqName(m.from) + sqName(m.to) + (m.promo ? "nbrq"[[N, B, R, Q].indexOf(typeOf(m.promo))] : "");
  }
}

export { typeOf, colorOf, BLACK };

/** Counts move paths to a depth (the standard way to prove a move generator correct). */
export function perft(f: FastBoard, depth: number): number {
  if (depth === 0) return 1;
  const ms = f.moves();
  if (depth === 1) return ms.length;
  let n = 0;
  for (const m of ms) {
    f.make(m);
    n += perft(f, depth - 1);
    f.unmake();
  }
  return n;
}
