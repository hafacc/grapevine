// The glyphs the app draws, as data for `icon.svelte`.
//
// The `Lu` ones are Lucide's (ISC License, Copyright (c) for portions of Lucide
// are held by Cole Bemis 2013-2022 as part of Feather (MIT); all other
// copyright for Lucide is held by Lucide Contributors 2022), and `FaGoogle` is
// Font Awesome Free's brand glyph (CC BY 4.0, fontawesome.com). They are
// copied here rather than taken from a package so that a glyph never changes
// under the app: Lucide redraws its icons between releases.

/** One glyph: its box, whether it is stroked or filled, and its shapes. */
export type IconData = {
  readonly viewBox: string;
  readonly stroked: boolean;
  readonly nodes: readonly (readonly [
    tag: "path" | "circle" | "line" | "polyline" | "rect",
    attributes: Readonly<Record<string, string>>,
  ])[];
};

export const LuCheck: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [["path", { d: "M20 6 9 17l-5-5" }]],
};

export const LuChevronLeft: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [["path", { d: "m15 18-6-6 6-6" }]],
};

export const LuCopy: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [
    ["rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2" }],
    ["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }],
  ],
};

export const LuDownload: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [
    ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }],
    ["polyline", { points: "7 10 12 15 17 10" }],
    ["line", { x1: "12", x2: "12", y1: "15", y2: "3" }],
  ],
};

export const LuExternalLink: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [
    ["path", { d: "M15 3h6v6" }],
    ["path", { d: "M10 14 21 3" }],
    ["path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }],
  ],
};

export const LuEye: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [
    [
      "path",
      {
        d: "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",
      },
    ],
    ["circle", { cx: "12", cy: "12", r: "3" }],
  ],
};

export const LuEyeOff: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [
    [
      "path",
      {
        d: "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",
      },
    ],
    ["path", { d: "M14.084 14.158a3 3 0 0 1-4.242-4.242" }],
    [
      "path",
      {
        d: "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",
      },
    ],
    ["path", { d: "m2 2 20 20" }],
  ],
};

export const LuFlag: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [
    [
      "path",
      { d: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" },
    ],
    ["line", { x1: "4", x2: "4", y1: "22", y2: "15" }],
  ],
};

export const LuFlagOff: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [
    ["path", { d: "M8 2c3 0 5 2 8 2s4-1 4-1v11" }],
    ["path", { d: "M4 22V4" }],
    ["path", { d: "M4 15s1-1 4-1 5 2 8 2" }],
    ["line", { x1: "2", x2: "22", y1: "2", y2: "22" }],
  ],
};

export const LuLink: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [
    [
      "path",
      { d: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" },
    ],
    [
      "path",
      { d: "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" },
    ],
  ],
};

export const LuLoaderCircle: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [["path", { d: "M21 12a9 9 0 1 1-6.219-8.56" }]],
};

export const LuMapPin: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [
    [
      "path",
      {
        d: "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0",
      },
    ],
    ["circle", { cx: "12", cy: "10", r: "3" }],
  ],
};

export const LuMapPinOff: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [
    ["path", { d: "M12.75 7.09a3 3 0 0 1 2.16 2.16" }],
    [
      "path",
      {
        d: "M17.072 17.072c-1.634 2.17-3.527 3.912-4.471 4.727a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 1.432-4.568",
      },
    ],
    ["path", { d: "m2 2 20 20" }],
    ["path", { d: "M8.475 2.818A8 8 0 0 1 20 10c0 1.183-.31 2.377-.81 3.533" }],
    ["path", { d: "M9.13 9.13a3 3 0 0 0 3.74 3.74" }],
  ],
};

export const LuMinus: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [["path", { d: "M5 12h14" }]],
};

export const LuMonitor: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [
    ["rect", { width: "20", height: "14", x: "2", y: "3", rx: "2" }],
    ["line", { x1: "8", x2: "16", y1: "21", y2: "21" }],
    ["line", { x1: "12", x2: "12", y1: "17", y2: "21" }],
  ],
};

export const LuMoon: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [["path", { d: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" }]],
};

export const LuPencil: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [
    [
      "path",
      {
        d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
      },
    ],
    ["path", { d: "m15 5 4 4" }],
  ],
};

export const LuPlus: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [
    ["path", { d: "M5 12h14" }],
    ["path", { d: "M12 5v14" }],
  ],
};

export const LuRefreshCw: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [
    ["path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" }],
    ["path", { d: "M21 3v5h-5" }],
    ["path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" }],
    ["path", { d: "M8 16H3v5" }],
  ],
};

export const LuSearch: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [
    ["circle", { cx: "11", cy: "11", r: "8" }],
    ["path", { d: "m21 21-4.3-4.3" }],
  ],
};

export const LuSearchX: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [
    ["path", { d: "m13.5 8.5-5 5" }],
    ["path", { d: "m8.5 8.5 5 5" }],
    ["circle", { cx: "11", cy: "11", r: "8" }],
    ["path", { d: "m21 21-4.3-4.3" }],
  ],
};

export const LuShare2: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [
    ["circle", { cx: "18", cy: "5", r: "3" }],
    ["circle", { cx: "6", cy: "12", r: "3" }],
    ["circle", { cx: "18", cy: "19", r: "3" }],
    ["line", { x1: "8.59", x2: "15.42", y1: "13.51", y2: "17.49" }],
    ["line", { x1: "15.41", x2: "8.59", y1: "6.51", y2: "10.49" }],
  ],
};

export const LuSun: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [
    ["circle", { cx: "12", cy: "12", r: "4" }],
    ["path", { d: "M12 2v2" }],
    ["path", { d: "M12 20v2" }],
    ["path", { d: "m4.93 4.93 1.41 1.41" }],
    ["path", { d: "m17.66 17.66 1.41 1.41" }],
    ["path", { d: "M2 12h2" }],
    ["path", { d: "M20 12h2" }],
    ["path", { d: "m6.34 17.66-1.41 1.41" }],
    ["path", { d: "m19.07 4.93-1.41 1.41" }],
  ],
};

export const LuThumbsDown: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [
    ["path", { d: "M17 14V2" }],
    [
      "path",
      {
        d: "M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z",
      },
    ],
  ],
};

export const LuThumbsUp: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [
    ["path", { d: "M7 10v12" }],
    [
      "path",
      {
        d: "M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z",
      },
    ],
  ],
};

export const LuTrash2: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [
    ["path", { d: "M3 6h18" }],
    ["path", { d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" }],
    ["path", { d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" }],
    ["line", { x1: "10", x2: "10", y1: "11", y2: "17" }],
    ["line", { x1: "14", x2: "14", y1: "11", y2: "17" }],
  ],
};

export const LuUnlink: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [
    [
      "path",
      {
        d: "m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71",
      },
    ],
    [
      "path",
      {
        d: "m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71",
      },
    ],
    ["line", { x1: "8", x2: "8", y1: "2", y2: "5" }],
    ["line", { x1: "2", x2: "5", y1: "8", y2: "8" }],
    ["line", { x1: "16", x2: "16", y1: "19", y2: "22" }],
    ["line", { x1: "19", x2: "22", y1: "16", y2: "16" }],
  ],
};

export const LuUserMinus: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [
    ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }],
    ["circle", { cx: "9", cy: "7", r: "4" }],
    ["line", { x1: "22", x2: "16", y1: "11", y2: "11" }],
  ],
};

export const LuX: IconData = {
  viewBox: "0 0 24 24",
  stroked: true,
  nodes: [
    ["path", { d: "M18 6 6 18" }],
    ["path", { d: "m6 6 12 12" }],
  ],
};

export const FaGoogle: IconData = {
  viewBox: "0 0 488 512",
  stroked: false,
  nodes: [
    [
      "path",
      {
        d: "M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z",
      },
    ],
  ],
};
