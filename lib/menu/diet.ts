export type DietTypeValue = "VEG" | "VEGAN" | "EGG" | "NON_VEG";

const RANK: Record<DietTypeValue, number> = { VEGAN: 0, VEG: 1, EGG: 2, NON_VEG: 3 };

/** The most restrictive diet type wins (e.g. a veg dish with an "add chicken" option is NON_VEG). */
export function effectiveDiet(base: DietTypeValue, optionDiets: (DietTypeValue | null | undefined)[]): DietTypeValue {
  return optionDiets.reduce<DietTypeValue>((acc, d) => (d && RANK[d] > RANK[acc] ? d : acc), base);
}

export function isVegetarian(d: DietTypeValue) {
  return d === "VEG" || d === "VEGAN";
}
