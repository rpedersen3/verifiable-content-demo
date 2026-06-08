// US Code titles (a subset, for display + validation). US federal statutory law
// is in the public domain — no copyright (unlike most scripture translations).
// This is the legal analog of the scripture canon's book table.

export interface UscTitle {
  /** Title number (1–54). */
  title: number;
  name: string;
}

export const USC_TITLES: UscTitle[] = [
  { title: 1, name: 'General Provisions' },
  { title: 5, name: 'Government Organization and Employees' },
  { title: 7, name: 'Agriculture' },
  { title: 11, name: 'Bankruptcy' },
  { title: 15, name: 'Commerce and Trade' },
  { title: 17, name: 'Copyrights' },
  { title: 18, name: 'Crimes and Criminal Procedure' },
  { title: 26, name: 'Internal Revenue Code' },
  { title: 28, name: 'Judiciary and Judicial Procedure' },
  { title: 29, name: 'Labor' },
  { title: 35, name: 'Patents' },
  { title: 42, name: 'The Public Health and Welfare' },
  { title: 47, name: 'Telecommunications' },
  { title: 50, name: 'War and National Defense' },
];

const BY_NUM = new Map<number, UscTitle>(USC_TITLES.map((t) => [t.title, t]));

/** The full canon is titles 1–54; only the subset above carries a display name. */
export function lookupTitle(title: number): UscTitle | undefined {
  if (!Number.isInteger(title) || title < 1 || title > 54) return undefined;
  return BY_NUM.get(title) ?? { title, name: `Title ${title}` };
}
