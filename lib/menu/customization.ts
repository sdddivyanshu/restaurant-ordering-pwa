// Customization constraint validation — shared verbatim by the item sheet (client) and the
// pricing service (server), so both enforce identical rules.

export interface GroupRule {
  id: string;
  name: string;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  options: { id: string; isAvailable: boolean }[];
}

export interface SelectionError {
  groupId: string;
  code: "UNKNOWN_GROUP" | "UNKNOWN_OPTION" | "OPTION_UNAVAILABLE" | "DUPLICATE_OPTION" | "TOO_FEW" | "TOO_MANY";
  message: string;
}

export type Selections = Record<string, string[]>;

export function effectiveMin(g: Pick<GroupRule, "isRequired" | "minSelect">) {
  return Math.max(g.minSelect, g.isRequired ? 1 : 0);
}

export function validateSelections(groups: GroupRule[], selections: Selections): SelectionError[] {
  const errors: SelectionError[] = [];
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const groupId of Object.keys(selections)) {
    if (!byId.has(groupId) && (selections[groupId]?.length ?? 0) > 0) {
      errors.push({ groupId, code: "UNKNOWN_GROUP", message: "This customization is not offered for this item" });
    }
  }
  for (const g of groups) {
    const chosen = selections[g.id] ?? [];
    if (new Set(chosen).size !== chosen.length) {
      errors.push({ groupId: g.id, code: "DUPLICATE_OPTION", message: `${g.name}: an option was selected twice` });
    }
    const options = new Map(g.options.map((o) => [o.id, o]));
    for (const optionId of chosen) {
      const opt = options.get(optionId);
      if (!opt) errors.push({ groupId: g.id, code: "UNKNOWN_OPTION", message: `${g.name}: invalid option` });
      else if (!opt.isAvailable)
        errors.push({ groupId: g.id, code: "OPTION_UNAVAILABLE", message: `${g.name}: a selected option is no longer available` });
    }
    const min = effectiveMin(g);
    if (chosen.length < min) {
      errors.push({
        groupId: g.id,
        code: "TOO_FEW",
        message: min === 1 ? `${g.name}: please choose an option` : `${g.name}: choose at least ${min}`,
      });
    }
    if (chosen.length > g.maxSelect) {
      errors.push({ groupId: g.id, code: "TOO_MANY", message: `${g.name}: choose at most ${g.maxSelect}` });
    }
  }
  return errors;
}

/** Default selections: options flagged isDefault, else the first available option of required single-choice groups. */
export function defaultSelections(groups: (Omit<GroupRule, "options"> & { options: { id: string; isAvailable: boolean; isDefault?: boolean }[] })[]): Selections {
  const out: Selections = {};
  for (const g of groups) {
    const defaults = g.options.filter((o) => o.isDefault && o.isAvailable).map((o) => o.id).slice(0, g.maxSelect);
    if (defaults.length) out[g.id] = defaults;
    else if (effectiveMin(g) >= 1 && g.maxSelect === 1) {
      const first = g.options.find((o) => o.isAvailable);
      out[g.id] = first ? [first.id] : [];
    } else out[g.id] = [];
  }
  return out;
}
