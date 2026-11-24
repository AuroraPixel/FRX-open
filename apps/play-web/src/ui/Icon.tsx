// Line icons for the diamond buttons, drawn on a 24-unit grid with 1.5 strokes like the prototype's.
// The first four are the prototype's own; the rest follow them until the interface art (plan item 37)
// replaces the set.

const PATHS = {
  scroll: ['M7 4h10v14a2 2 0 0 0 2 2H9a2 2 0 0 1-2-2V4z', 'M7 4a2 2 0 0 0-2 2v2h2', 'M10 9h5M10 13h5'],
  person: ['M12 4a3 3 0 1 1 0 6a3 3 0 1 1 0-6z', 'M5 20c1-5 4-7 7-7s6 2 7 7'],
  bag: ['M8 8c-3 3-4 7-3 10 1 2 3 2 7 2s6 0 7-2c1-3 0-7-3-10z', 'M9 8l-1-3h8l-1 3', 'M9 8h6'],
  flag: ['M6 3v18', 'M6 4h11l-3 4 3 4H6'],
  map: ['M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2z', 'M9 4v14M15 6v14'],
  more: ['M6 12h.01M12 12h.01M18 12h.01'],
  skill: ['M12 3c3 4 5 6 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z'],
  people: ['M9 5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5z', 'M3 19c.8-4 3-6 6-6s5.2 2 6 6', 'M16 6a2.5 2.5 0 1 1 0 5', 'M17 13c2 .6 3.4 2.6 4 6'],
  beast: ['M5 9c0-3 2-5 4-5l1 3h4l1-3c2 0 4 2 4 5 0 6-4 11-7 11s-7-5-7-11z', 'M10 12h.01M14 12h.01', 'M11 16h2'],
  world: ['M3 18l6-9 4 5 3-3 5 7z', 'M16 6a2 2 0 1 1 0 .1'],
  save: ['M5 4h11l3 3v13H5z', 'M8 4v5h7V4', 'M8 14h8M8 17h5'],
  settings: ['M4 7h10M18 7h2M4 17h4M12 17h8', 'M16 5v4M10 15v4'],
  send: ['M4 12l16-7-6 16-3-6z', 'M11 15l9-10'],
  close: ['M7 7l10 10M17 7L7 17'],
  // the cultivation life's home (洞府: a cave's mouth under its hill) and arrays (阵法: a disc and its eight marks)
  home: ['M3 19c2-8 5-12 9-12s7 4 9 12', 'M8 19c0-4 2-6 4-6s4 2 4 6', 'M3 19h18'],
  array: ['M12 4a8 8 0 1 1 0 16a8 8 0 1 1 0-16z', 'M12 8l4 4-4 4-4-4z', 'M12 4v2M12 18v2M4 12h2M18 12h2'],
  // a gate's roof over two posts: the sect (宗门)
  sect: ['M3 9l9-5 9 5', 'M5 9h14', 'M7 9v11M17 9v11', 'M4 20h16', 'M10 20v-5h4v5'],
  // a book bound with a cord: a life's record (一生)
  life: ['M6 4h11a1 1 0 0 1 1 1v15H7a1 1 0 0 1-1-1z', 'M6 17h12', 'M10 8h5M10 11h5', 'M9 4v13'],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
