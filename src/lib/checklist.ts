/**
 * Milestone T1's seven acceptance items, verbatim from SEED.md, expanded into
 * something you can actually run with a phone in one hand.
 *
 * Each item carries: what SEED.md said (`criterion`, unedited), how to check it
 * on the device (`how`), what makes it a fail (`fails`), and which deploy the
 * row deep-links to. The wording of `criterion` is the contract with the seed —
 * do not reword it to match what the build currently does.
 */
import type { TargetId } from "./targets.ts";

export interface ChecklistItem {
  id: string;
  n: number;
  title: string;
  /** SEED.md's own words for this item. Frozen. */
  criterion: string;
  /** Steps to perform on the phone. */
  how: readonly string[];
  /** The observation that makes this a fail rather than a pass. */
  fails: string;
  target: TargetId;
}

export const CHECKLIST: readonly ChecklistItem[] = [
  {
    id: "load",
    n: 1,
    title: "Cold load & viewport",
    criterion: "loads < 3 s / viewport clean",
    how: [
      "Force-quit Safari, then open the game client link cold.",
      "Start a stopwatch as you tap; stop it when the title is interactive.",
      "Check no browser chrome overlaps the art and nothing sits under the home indicator.",
    ],
    fails: "Over 3 s to interactive, or content clipped by the notch, the URL bar or the home indicator.",
    target: "gameclient",
  },
  {
    id: "titlepan",
    n: 2,
    title: "Title pan holds",
    criterion: "title pan ≥ 30 s smooth and cool",
    how: [
      "Sit on the title screen for a full 30 s without touching it.",
      "Watch for judder, tearing, or the pan snapping back to its start.",
      "Put the back of the phone against your wrist: it should not be warm.",
    ],
    fails: "Visible stutter, a seam at the loop point, or the phone noticeably heating inside 30 s.",
    target: "gameclient",
  },
  {
    id: "targets",
    n: 3,
    title: "Touch targets",
    criterion: "targets ≥ 44 px, nothing hover-only",
    how: [
      "Tap every control with the pad of a thumb, not a fingertip.",
      "Look for anything that only reveals itself on hover — there is no hover on a phone.",
      "Check that nothing needs a long-press you were never told about.",
    ],
    fails: "A control you miss with a thumb, or an affordance that only appears on a mouse.",
    target: "gameclient",
  },
  {
    id: "map",
    n: 4,
    title: "Paradise pinch + pan",
    criterion: "pinch+pan Paradise without page rubber-band",
    how: [
      "Open the Paradise map and pinch-zoom in and out.",
      "Drag past the edge of the map in each direction.",
      "The map may bound itself; the *page* behind it must not bounce or scroll.",
    ],
    fails: "The whole page rubber-bands, the address bar shows itself, or a pinch zooms the document.",
    target: "gameclient",
  },
  {
    id: "dig",
    n: 5,
    title: "Dig → solve → bloom",
    criterion: "dig → solve 3–8 s → Holi burst → cell blooms",
    how: [
      "Dig a cell and time the solve from tap to the burst.",
      "It must land inside 3–8 s: under 3 s the work reads as fake, over 8 s it reads as broken.",
      "Confirm the Holi burst fires and the cell is left visibly bloomed.",
    ],
    fails: "Solve outside 3–8 s, no burst, or a cell that reverts after the animation. Time it — do not eyeball it.",
    target: "gameclient",
  },
  {
    id: "settings",
    n: 6,
    title: "Settings shows the receipt",
    criterion: "settings shows GRD-id + est. kWh",
    how: [
      "Open settings and find the Guardian id (GRD-…) minted by the dig above.",
      "Find the estimated kWh next to it.",
      "Both must be present and non-placeholder.",
    ],
    fails: "A missing or zeroed GRD-id, or a kWh figure that reads 0, NaN or a dash after a real dig.",
    target: "gameclient",
  },
  {
    id: "relaunch",
    n: 7,
    title: "Relaunch restores place",
    criterion: "relaunch → save-init pan-down to last cell",
    how: [
      "Force-quit Safari again and reopen the client.",
      "Let the save-init run without touching the screen.",
      "It must pan down and settle on the cell you last dug.",
    ],
    fails: "Lands on the default view, needs a tap to restore, or pans to the wrong cell.",
    target: "gameclient",
  },
] as const;

export const CHECKLIST_IDS: readonly string[] = CHECKLIST.map((item) => item.id);

export function itemById(id: string): ChecklistItem | undefined {
  return CHECKLIST.find((item) => item.id === id);
}
