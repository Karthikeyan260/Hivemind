import { describe, expect, it } from "vitest";
import { flavor, learnWords, lexiconWord, LEARN_AT } from "@/lib/pet-words";

/** A roll that always lets the flavour in and picks the first of any list. */
const yes = () => 0.01;

describe("lexiconWord", () => {
  it("recognises Tanglish words and their stretched spellings", () => {
    expect(lexiconWord("seri")).toBe("seri");
    expect(lexiconWord("Seriii")).toBe("seri");
    expect(lexiconWord("semmaaa")).toBe("semma");
    expect(lexiconWord("daaa")).toBe("da");
    expect(lexiconWord("machaaan")).toBe("machan");
    expect(lexiconWord("romba")).toBe("romba");
  });
  it("ignores everything else: ordinary English, names, numbers, one-letter bits", () => {
    for (const w of ["the", "meeting", "priya", "9876543210", "a", "d", "database", "password", "address"]) expect(lexiconWord(w), w).toBeNull();
  });
});

describe("learnWords", () => {
  it("picks up a word only after it has been used a few times", () => {
    expect(learnWords(["seri da", "seri"])).toEqual([]);
    expect(learnWords(["seri da", "seri", "ok seri then", "da da"])).toEqual([
      { word: "da", count: 3 },
      { word: "seri", count: 3 },
    ]);
  });
  it("counts the most used first and keeps at most eight", () => {
    const many = ["seri", "da", "semma", "machan", "bro", "ayyo", "enna", "illa", "vaa", "poda"].flatMap((w, i) => Array(LEARN_AT + (10 - i)).fill(w));
    const out = learnWords(many);
    expect(out).toHaveLength(8);
    expect(out[0].word).toBe("seri");
    expect(out.map((o) => o.count)).toEqual([...out.map((o) => o.count)].sort((a, b) => b - a));
  });
  it("never learns anything private: names, numbers and addresses are not in the list", () => {
    const msgs = Array(10).fill("my number is 9876543210 and priya lives at 12 main street, password hunter2");
    expect(learnWords(msgs)).toEqual([]);
  });
  it("handles nothing at all", () => {
    expect(learnWords([])).toEqual([]);
    expect(learnWords(["", "   "])).toEqual([]);
  });
});

describe("flavor", () => {
  const learned = [
    { word: "da", count: 9 },
    { word: "semma", count: 6 },
  ];
  it("leaves a line alone when nothing is learned, or on most rolls", () => {
    expect(flavor("Coffee kudichiya?", [], yes)).toBe("Coffee kudichiya?");
    expect(flavor("Coffee kudichiya?", learned, () => 0.9)).toBe("Coffee kudichiya?");
  });
  it("adds a closing word before the question mark, and keeps a trailing emoji", () => {
    expect(flavor("Coffee kudichiya? ☕", [{ word: "da", count: 5 }], yes)).toBe("Coffee kudichiya da? ☕");
    expect(flavor("Innaiku saaptiya?", [{ word: "da", count: 5 }], yes)).toBe("Innaiku saaptiya da?");
  });
  it("or a cheer in front", () => {
    expect(flavor("Super ah irukku", [{ word: "semma", count: 5 }], yes)).toBe("Semma! Super ah irukku");
  });
  it("never doubles up a word the line already has", () => {
    expect(flavor("Semma! Vaa", learned, yes)).toBe("Semma! Vaa");
    expect(flavor("Seri da", [{ word: "da", count: 5 }], yes)).toBe("Seri da");
  });
  it("uses the owner's words only", () => {
    expect(flavor("Thanni kudichiya?", [{ word: "bro", count: 4 }], yes)).toBe("Thanni kudichiya bro?");
  });
});
