// Deterministic dietary & menu assistant. It parses a free-text question into structured
// filters and answers ONLY from stored menu metadata — no LLM, no invented facts. Items whose
// allergen data has not been verified by staff are never presented as safe for an allergy.

import type { DietTypeValue } from "@/lib/menu/diet";

export interface AssistantMenuItem {
  id: string;
  name: string;
  nameEn: string;
  categoryId: string;
  pricePaise: number;
  dietType: DietTypeValue;
  spiceLevel: number;
  ingredients: string[];
  ingredientsEn: string[];
  allergens: { key: string; name: string; level: "CONTAINS" | "MAY_CONTAIN" }[];
  allergenInfoVerified: boolean;
  available: boolean;
  isBestseller: boolean;
  isRecommended: boolean;
  dietary: { key: string; name: string }[];
}

export interface AssistantCategory {
  id: string;
  slug: string;
  name: string;
}

export interface ParsedQuery {
  diets: DietTypeValue[] | null;
  maxSpice: number | null;
  minSpice: number | null;
  maxPricePaise: number | null;
  excludeAllergens: string[];
  includeTerms: string[];
  categorySlugs: string[];
  dietaryKeys: string[];
  wantsPopular: boolean;
}

const ALLERGEN_SYNONYMS: Record<string, string[]> = {
  nuts: ["nut", "nuts", "cashew", "cashews", "almond", "almonds", "pistachio", "walnut", "kaju", "badam", "मेवा", "काजू", "बादाम"],
  peanuts: ["peanut", "peanuts", "groundnut", "मूंगफली"],
  dairy: ["dairy", "milk", "lactose", "cheese", "paneer", "butter", "ghee", "cream", "curd", "yogurt", "दूध", "पनीर", "डेयरी"],
  gluten: ["gluten", "wheat", "maida", "atta", "गेहूं", "ग्लूटेन"],
  egg: ["egg", "eggs", "अंडा", "अंडे"],
  soy: ["soy", "soya", "सोया"],
  shellfish: ["shellfish", "prawn", "prawns", "shrimp", "crab", "झींगा"],
  fish: ["fish", "मछली"],
  sesame: ["sesame", "til", "तिल"],
  mustard: ["mustard", "sarson", "सरसों"],
};

const CATEGORY_SYNONYMS: Record<string, string[]> = {
  starters: ["starter", "starters", "appetizer", "appetizers", "snack", "snacks", "स्टार्टर"],
  mains: ["main", "mains", "main course", "curry", "curries", "मुख्य"],
  breads: ["bread", "breads", "roti", "naan", "रोटी", "नान"],
  "rice-biryani": ["rice", "biryani", "pulao", "चावल", "बिरयानी"],
  desserts: ["dessert", "desserts", "sweet", "sweets", "मिठाई", "मीठा"],
  beverages: ["drink", "drinks", "beverage", "beverages", "juice", "lassi", "tea", "coffee", "पेय", "चाय"],
};

const DIETARY_SYNONYMS: Record<string, string[]> = {
  "gluten-free": ["gluten free", "gluten-free", "ग्लूटेन मुक्त"],
  jain: ["jain", "जैन", "no onion", "no garlic"],
  "high-protein": ["protein", "high protein", "प्रोटीन"],
};

function hasWord(text: string, word: string) {
  if (/[ऀ-ॿ]/.test(word)) return text.includes(word);
  return new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(text);
}

export function parseAssistantQuery(raw: string): ParsedQuery {
  const text = ` ${raw.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const q: ParsedQuery = {
    diets: null,
    maxSpice: null,
    minSpice: null,
    maxPricePaise: null,
    excludeAllergens: [],
    includeTerms: [],
    categorySlugs: [],
    dietaryKeys: [],
    wantsPopular: false,
  };

  // Diet
  if (/\bvegan\b|वीगन/.test(text)) q.diets = ["VEGAN"];
  else if (/non[\s-]?veg|nonveg|मांसाहारी|नॉन[\s-]?वेज/.test(text)) q.diets = ["NON_VEG"];
  else if (/\b(veg|vegetarian|veggie)\b|शाकाहारी|वेज/.test(text)) q.diets = ["VEG", "VEGAN"];
  if (/eggless|no eggs?|without eggs?|बिना अंडे?/.test(text)) q.excludeAllergens.push("egg");

  // Spice
  if (/not spicy|non[\s-]?spicy|less spicy|mild|no spice|kam teekha|कम तीखा|बिना मिर्च|हल्का/.test(text)) q.maxSpice = 1;
  else if (/\b(spicy|hot|teekha)\b|तीखा|मसालेदार/.test(text)) q.minSpice = 2;

  // Budget: "under 300", "below ₹250", "within rs 400", "300 se kam", "₹300 से कम"
  const budget =
    text.match(/(?:under|below|less than|within|upto|up to|max|budget|cheaper than|<)\s*(?:₹|rs\.?|inr|rupees)?\s*(\d{2,5})/) ??
    text.match(/(?:₹|rs\.?)?\s*(\d{2,5})\s*(?:rupees|rs)?\s*(?:se kam|से कम|tak|तक)/);
  if (budget) q.maxPricePaise = Number(budget[1]) * 100;

  // Allergen exclusions: "no nuts", "without dairy", "nut-free", "allergic to peanuts", "बिना दूध"
  for (const [key, words] of Object.entries(ALLERGEN_SYNONYMS)) {
    for (const w of words) {
      const patterns = [`no ${w}`, `without ${w}`, `${w}-free`, `${w} free`, `allergic to ${w}`, `allergy to ${w}`, `${w} allergy`, `बिना ${w}`, `${w} नहीं`];
      if (patterns.some((p) => text.includes(p))) {
        if (!q.excludeAllergens.includes(key)) q.excludeAllergens.push(key);
      }
    }
  }

  // Positive ingredient interest: "with paneer", "contains chicken", "has mushroom"
  for (const m of text.matchAll(/(?:with|contains|containing|has|having|made of|made with)\s+([a-zऀ-ॿ]{3,20})/g)) {
    q.includeTerms.push(m[1]);
  }

  for (const [slug, words] of Object.entries(CATEGORY_SYNONYMS)) if (words.some((w) => hasWord(text, w))) q.categorySlugs.push(slug);
  for (const [key, words] of Object.entries(DIETARY_SYNONYMS)) if (words.some((w) => text.includes(w))) q.dietaryKeys.push(key);
  if (q.dietaryKeys.includes("gluten-free") && !q.excludeAllergens.includes("gluten")) q.excludeAllergens.push("gluten");
  q.wantsPopular = /popular|best|recommend|bestseller|famous|signature|सबसे अच्छा|लोकप्रिय|सुझाव/.test(text);
  return q;
}

export interface AssistantResult {
  itemId: string;
  name: string;
  pricePaise: number;
  dietType: DietTypeValue;
  reasons: string[];
}

const L = {
  en: {
    disclaimer:
      "Suggestions use the restaurant's recorded menu information. If you have a severe allergy, please confirm ingredients and cross-contamination risks with staff before ordering.",
    noMatch: "No available dishes match all of those preferences. Try relaxing one of them.",
    found: (n: number) => `Found ${n} dish${n === 1 ? "" : "es"} that match.`,
    veg: "Vegetarian",
    vegan: "Vegan",
    nonveg: "Non-vegetarian",
    mild: (s: number) => `Spice level ${s}/3`,
    under: "Within budget",
    noAllergen: (n: string) => `No ${n} recorded (verified)`,
    contains: (t: string) => `Contains ${t}`,
    popular: "Bestseller",
    staffCheck: "Allergen details not yet verified — please ask staff",
    ingredientsOf: (name: string) => `About ${name}`,
  },
  hi: {
    disclaimer:
      "सुझाव रेस्टोरेंट की दर्ज मेन्यू जानकारी पर आधारित हैं। यदि आपको गंभीर एलर्जी है, तो ऑर्डर से पहले स्टाफ से सामग्री और क्रॉस-कंटैमिनेशन की पुष्टि करें।",
    noMatch: "इन सभी पसंदों से मेल खाता कोई उपलब्ध व्यंजन नहीं मिला। कोई एक शर्त हटाकर देखें।",
    found: (n: number) => `${n} व्यंजन मिले।`,
    veg: "शाकाहारी",
    vegan: "वीगन",
    nonveg: "मांसाहारी",
    mild: (s: number) => `तीखापन ${s}/3`,
    under: "बजट में",
    noAllergen: (n: string) => `${n} दर्ज नहीं (सत्यापित)`,
    contains: (t: string) => `${t} शामिल`,
    popular: "बेस्टसेलर",
    staffCheck: "एलर्जन जानकारी सत्यापित नहीं — कृपया स्टाफ से पूछें",
    ingredientsOf: (name: string) => `${name} के बारे में`,
  },
};

export function answerAssistant(
  query: string,
  menu: { items: AssistantMenuItem[]; categories: AssistantCategory[]; allergens: { key: string; name: string }[] },
  lang: "en" | "hi" = "en",
) {
  const t = L[lang] ?? L.en;
  const parsed = parseAssistantQuery(query);
  const lower = query.toLowerCase();

  // Direct question about a specific dish ("what is in paneer tikka?")
  const focusItem = menu.items
    .filter((i) => lower.includes(i.nameEn.toLowerCase()) || (i.name && query.includes(i.name)))
    .sort((a, b) => b.nameEn.length - a.nameEn.length)[0];

  const catIds = new Set(menu.categories.filter((c) => parsed.categorySlugs.includes(c.slug)).map((c) => c.id));
  const allergenName = (key: string) => menu.allergens.find((a) => a.key === key)?.name ?? key;

  const results: AssistantResult[] = [];
  const needsStaffCheck: AssistantResult[] = [];

  for (const item of menu.items) {
    if (!item.available) continue;
    if (parsed.diets && !parsed.diets.includes(item.dietType)) continue;
    if (parsed.maxSpice != null && item.spiceLevel > parsed.maxSpice) continue;
    if (parsed.minSpice != null && item.spiceLevel < parsed.minSpice) continue;
    if (parsed.maxPricePaise != null && item.pricePaise > parsed.maxPricePaise) continue;
    if (catIds.size && !catIds.has(item.categoryId)) continue;
    const otherDietary = parsed.dietaryKeys.filter((k) => k !== "gluten-free");
    if (otherDietary.length && !otherDietary.every((k) => item.dietary.some((d) => d.key === k))) continue;
    const haystack = [item.nameEn, item.name, ...item.ingredientsEn, ...item.ingredients].join(" ").toLowerCase();
    if (parsed.includeTerms.length && !parsed.includeTerms.some((term) => haystack.includes(term))) continue;

    const reasons: string[] = [];
    if (parsed.diets) reasons.push(item.dietType === "VEGAN" ? t.vegan : item.dietType === "NON_VEG" ? t.nonveg : t.veg);
    if (parsed.maxSpice != null || parsed.minSpice != null) reasons.push(t.mild(item.spiceLevel));
    if (parsed.maxPricePaise != null) reasons.push(t.under);
    for (const term of parsed.includeTerms) if (haystack.includes(term)) reasons.push(t.contains(term));
    if (item.isBestseller) reasons.push(t.popular);

    const row: AssistantResult = { itemId: item.id, name: item.name, pricePaise: item.pricePaise, dietType: item.dietType, reasons };
    if (parsed.excludeAllergens.length) {
      // Any recorded CONTAINS or MAY_CONTAIN of an excluded allergen rules the item out.
      if (item.allergens.some((a) => parsed.excludeAllergens.includes(a.key))) continue;
      if (!item.allergenInfoVerified) {
        needsStaffCheck.push({ ...row, reasons: [t.staffCheck] });
        continue;
      }
      reasons.push(...parsed.excludeAllergens.map((k) => t.noAllergen(allergenName(k))));
    }
    results.push(row);
  }

  results.sort((a, b) => {
    if (parsed.wantsPopular) {
      const pa = menu.items.find((i) => i.id === a.itemId)!;
      const pb = menu.items.find((i) => i.id === b.itemId)!;
      const s = Number(pb.isBestseller || pb.isRecommended) - Number(pa.isBestseller || pa.isRecommended);
      if (s) return s;
    }
    return a.pricePaise - b.pricePaise;
  });

  const focus = focusItem
    ? {
        itemId: focusItem.id,
        title: t.ingredientsOf(focusItem.name),
        dietType: focusItem.dietType,
        spiceLevel: focusItem.spiceLevel,
        ingredients: focusItem.ingredients,
        allergens: focusItem.allergens,
        allergenInfoVerified: focusItem.allergenInfoVerified,
        available: focusItem.available,
      }
    : null;

  const filtered = Boolean(
    parsed.diets || parsed.maxSpice != null || parsed.minSpice != null || parsed.maxPricePaise != null || parsed.excludeAllergens.length || parsed.includeTerms.length || catIds.size || parsed.dietaryKeys.length || parsed.wantsPopular,
  );

  return {
    interpreted: parsed,
    summary: !filtered && focus ? "" : results.length ? t.found(results.length) : t.noMatch,
    results: filtered || !focus ? results.slice(0, 12) : [],
    needsStaffCheck: needsStaffCheck.slice(0, 6),
    focus,
    disclaimer: t.disclaimer,
    source: "menu-database" as const,
  };
}
