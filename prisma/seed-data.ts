// SAMPLE DATA — synthetic, for development and demos only. All names, phone numbers and orders
// are fictitious. Prices are in paise (₹1 = 100 paise).

export type Diet = "VEG" | "VEGAN" | "EGG" | "NON_VEG";

export const ALLERGENS = [
  { key: "gluten", name: "Gluten", hi: "ग्लूटेन" },
  { key: "dairy", name: "Dairy", hi: "डेयरी" },
  { key: "nuts", name: "Tree nuts", hi: "मेवे" },
  { key: "peanuts", name: "Peanuts", hi: "मूंगफली" },
  { key: "egg", name: "Egg", hi: "अंडा" },
  { key: "soy", name: "Soy", hi: "सोया" },
  { key: "shellfish", name: "Shellfish", hi: "शेलफिश" },
  { key: "fish", name: "Fish", hi: "मछली" },
  { key: "sesame", name: "Sesame", hi: "तिल" },
  { key: "mustard", name: "Mustard", hi: "सरसों" },
];

export const DIETARY_ATTRIBUTES = [
  { key: "gluten-free", name: "Gluten-free", hi: "ग्लूटेन-मुक्त" },
  { key: "jain", name: "Jain-friendly", hi: "जैन" },
  { key: "high-protein", name: "High protein", hi: "उच्च प्रोटीन" },
  { key: "chef-special", name: "Chef's special", hi: "शेफ़ स्पेशल" },
];

export const CATEGORIES = [
  { slug: "starters", name: "Starters", hi: "स्टार्टर", description: "Small plates from the tandoor and wok", hiDesc: "तंदूर और कड़ाही से छोटे व्यंजन" },
  { slug: "mains", name: "Main Course", hi: "मुख्य व्यंजन", description: "Slow-cooked curries", hiDesc: "धीमी आँच पर पकी करी" },
  { slug: "breads", name: "Breads", hi: "रोटियाँ", description: "Fresh from the clay oven", hiDesc: "तंदूर से ताज़ा" },
  { slug: "rice-biryani", name: "Rice & Biryani", hi: "चावल और बिरयानी", description: "Fragrant basmati dishes", hiDesc: "सुगंधित बासमती व्यंजन" },
  { slug: "desserts", name: "Desserts", hi: "मिठाई", description: "Something sweet", hiDesc: "कुछ मीठा" },
  { slug: "beverages", name: "Beverages", hi: "पेय", description: "Chai, lassi and coolers", hiDesc: "चाय, लस्सी और ठंडे पेय" },
];

export interface GroupDef {
  key: string;
  name: string;
  hi: string;
  kind: "VARIANT" | "ADDON" | "CHOICE";
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  options: { name: string; hi: string; price: number; isDefault?: boolean; dietType?: Diet; allergenKeys?: string[] }[];
}

export const GROUPS: GroupDef[] = [
  {
    key: "portion",
    name: "Portion",
    hi: "मात्रा",
    kind: "VARIANT",
    isRequired: true,
    minSelect: 1,
    maxSelect: 1,
    options: [
      { name: "Regular", hi: "रेगुलर", price: 0, isDefault: true },
      { name: "Large", hi: "लार्ज", price: 8000 },
    ],
  },
  {
    key: "spice-level",
    name: "Spice level",
    hi: "तीखापन",
    kind: "CHOICE",
    isRequired: true,
    minSelect: 1,
    maxSelect: 1,
    options: [
      { name: "Mild", hi: "हल्का", price: 0 },
      { name: "Medium", hi: "मध्यम", price: 0, isDefault: true },
      { name: "Hot", hi: "तीखा", price: 0 },
    ],
  },
  {
    key: "curry-addons",
    name: "Add-ons",
    hi: "अतिरिक्त",
    kind: "ADDON",
    isRequired: false,
    minSelect: 0,
    maxSelect: 3,
    options: [
      { name: "Extra butter", hi: "अतिरिक्त मक्खन", price: 3000, allergenKeys: ["dairy"] },
      { name: "Extra paneer", hi: "अतिरिक्त पनीर", price: 6000, allergenKeys: ["dairy"] },
      { name: "Extra cheese", hi: "अतिरिक्त चीज़", price: 4000, allergenKeys: ["dairy"] },
    ],
  },
  {
    key: "naan-style",
    name: "Naan style",
    hi: "नान का प्रकार",
    kind: "VARIANT",
    isRequired: true,
    minSelect: 1,
    maxSelect: 1,
    options: [
      { name: "Plain", hi: "सादा", price: 0, isDefault: true },
      { name: "Butter", hi: "बटर", price: 1500, allergenKeys: ["dairy"] },
      { name: "Garlic", hi: "गार्लिक", price: 2500 },
      { name: "Cheese", hi: "चीज़", price: 4000, allergenKeys: ["dairy"] },
    ],
  },
  {
    key: "biryani-extras",
    name: "Biryani extras",
    hi: "बिरयानी के साथ",
    kind: "ADDON",
    isRequired: false,
    minSelect: 0,
    maxSelect: 2,
    options: [
      { name: "Extra raita", hi: "अतिरिक्त रायता", price: 4000, allergenKeys: ["dairy"] },
      { name: "Boiled egg", hi: "उबला अंडा", price: 3000, dietType: "EGG", allergenKeys: ["egg"] },
    ],
  },
  {
    key: "dips",
    name: "Choose your dips",
    hi: "चटनी चुनें",
    kind: "CHOICE",
    isRequired: true,
    minSelect: 1,
    maxSelect: 2,
    options: [
      { name: "Mint chutney", hi: "पुदीना चटनी", price: 0, isDefault: true },
      { name: "Tamarind chutney", hi: "इमली चटनी", price: 0 },
      { name: "Garlic mayo", hi: "गार्लिक मेयो", price: 2000, dietType: "EGG", allergenKeys: ["egg"] },
    ],
  },
  {
    key: "drink-size",
    name: "Size",
    hi: "साइज़",
    kind: "VARIANT",
    isRequired: true,
    minSelect: 1,
    maxSelect: 1,
    options: [
      { name: "Regular", hi: "रेगुलर", price: 0, isDefault: true },
      { name: "Large", hi: "लार्ज", price: 4000 },
    ],
  },
  {
    key: "sweetness",
    name: "Sweetness",
    hi: "मिठास",
    kind: "CHOICE",
    isRequired: false,
    minSelect: 0,
    maxSelect: 1,
    options: [
      { name: "Less sugar", hi: "कम चीनी", price: 0 },
      { name: "No sugar", hi: "बिना चीनी", price: 0 },
    ],
  },
  {
    key: "dessert-addon",
    name: "Make it special",
    hi: "और खास बनाएं",
    kind: "ADDON",
    isRequired: false,
    minSelect: 0,
    maxSelect: 1,
    options: [{ name: "Scoop of vanilla ice cream", hi: "वनीला आइसक्रीम स्कूप", price: 5000, allergenKeys: ["dairy"] }],
  },
];

export interface ItemDef {
  slug: string;
  category: string;
  name: string;
  hi: string;
  description: string;
  hiDesc: string;
  price: number;
  diet: Diet;
  spice: number;
  prep: number;
  ingredients: string[];
  hiIngredients: string[];
  allergens: { key: string; level?: "CONTAINS" | "MAY_CONTAIN" }[];
  dietary?: string[];
  groups?: string[];
  tax?: string;
  bestseller?: boolean;
  recommended?: boolean;
  unavailable?: boolean;
  unverified?: boolean;
  seasonalFuture?: boolean;
  emoji: string;
  hue: number;
}

export const ITEMS: ItemDef[] = [
  // Starters
  { slug: "paneer-tikka", category: "starters", name: "Paneer Tikka", hi: "पनीर टिक्का", description: "Cottage cheese cubes marinated in spiced yogurt, char-grilled in the tandoor.", hiDesc: "मसालेदार दही में मैरीनेट किए पनीर के टुकड़े, तंदूर में ग्रिल किए।", price: 28000, diet: "VEG", spice: 2, prep: 15, ingredients: ["paneer", "yogurt", "bell pepper", "onion", "spices"], hiIngredients: ["पनीर", "दही", "शिमला मिर्च", "प्याज़", "मसाले"], allergens: [{ key: "dairy" }], dietary: ["high-protein", "gluten-free"], groups: ["dips"], bestseller: true, emoji: "🧀", hue: 24 },
  { slug: "hara-bhara-kebab", category: "starters", name: "Hara Bhara Kebab", hi: "हरा भरा कबाब", description: "Spinach, peas and potato patties, pan-seared until crisp.", hiDesc: "पालक, मटर और आलू की टिक्की, कुरकुरी सिकी हुई।", price: 22000, diet: "VEGAN", spice: 1, prep: 12, ingredients: ["spinach", "green peas", "potato", "gram flour", "spices"], hiIngredients: ["पालक", "मटर", "आलू", "बेसन", "मसाले"], allergens: [], dietary: ["gluten-free"], groups: ["dips"], emoji: "🥬", hue: 110 },
  { slug: "chicken-65", category: "starters", name: "Chicken 65", hi: "चिकन 65", description: "Fiery fried chicken tossed with curry leaves and green chillies.", hiDesc: "करी पत्ता और हरी मिर्च के साथ तीखा तला चिकन।", price: 32000, diet: "NON_VEG", spice: 3, prep: 15, ingredients: ["chicken", "curry leaves", "green chilli", "rice flour", "egg"], hiIngredients: ["चिकन", "करी पत्ता", "हरी मिर्च", "चावल का आटा", "अंडा"], allergens: [{ key: "egg" }], groups: ["dips"], bestseller: true, unverified: true, emoji: "🍗", hue: 8 },
  { slug: "crispy-corn", category: "starters", name: "Crispy Corn", hi: "क्रिस्पी कॉर्न", description: "Golden fried sweet corn with pepper and spring onion.", hiDesc: "काली मिर्च और हरे प्याज़ के साथ सुनहरे तले मकई के दाने।", price: 21000, diet: "VEG", spice: 1, prep: 10, ingredients: ["sweet corn", "corn flour", "soy sauce", "spring onion"], hiIngredients: ["मकई", "कॉर्न फ्लोर", "सोया सॉस", "हरा प्याज़"], allergens: [{ key: "soy" }, { key: "gluten", level: "MAY_CONTAIN" }], unverified: true, emoji: "🌽", hue: 48 },
  { slug: "tandoori-mushroom", category: "starters", name: "Tandoori Mushroom", hi: "तंदूरी मशरूम", description: "Button mushrooms in a smoky malai marinade.", hiDesc: "धुएँदार मलाई मैरिनेड में मशरूम।", price: 26000, diet: "VEG", spice: 1, prep: 14, ingredients: ["mushroom", "cream", "cashew", "spices"], hiIngredients: ["मशरूम", "क्रीम", "काजू", "मसाले"], allergens: [{ key: "dairy" }, { key: "nuts" }], dietary: ["gluten-free"], emoji: "🍄", hue: 30 },
  { slug: "fish-amritsari", category: "starters", name: "Fish Amritsari", hi: "फिश अमृतसरी", description: "Gram-flour battered river sole with carom seeds.", hiDesc: "अजवाइन और बेसन के घोल में तली मछली।", price: 36000, diet: "NON_VEG", spice: 2, prep: 16, ingredients: ["sole fish", "gram flour", "carom seeds", "lemon"], hiIngredients: ["मछली", "बेसन", "अजवाइन", "नींबू"], allergens: [{ key: "fish" }], unavailable: true, emoji: "🐟", hue: 200 },

  // Mains
  { slug: "paneer-butter-masala", category: "mains", name: "Paneer Butter Masala", hi: "पनीर बटर मसाला", description: "Paneer simmered in a velvety tomato-cashew gravy.", hiDesc: "मखमली टमाटर-काजू ग्रेवी में पका पनीर।", price: 32000, diet: "VEG", spice: 1, prep: 18, ingredients: ["paneer", "tomato", "butter", "cream", "cashew"], hiIngredients: ["पनीर", "टमाटर", "मक्खन", "क्रीम", "काजू"], allergens: [{ key: "dairy" }, { key: "nuts" }], dietary: ["gluten-free"], groups: ["portion", "spice-level", "curry-addons"], bestseller: true, recommended: true, emoji: "🍛", hue: 16 },
  { slug: "dal-makhani", category: "mains", name: "Dal Makhani", hi: "दाल मखनी", description: "Black lentils slow-cooked overnight with butter and cream.", hiDesc: "मक्खन और क्रीम के साथ रात भर पकी काली दाल।", price: 26000, diet: "VEG", spice: 1, prep: 12, ingredients: ["black lentils", "kidney beans", "butter", "cream", "tomato"], hiIngredients: ["काली दाल", "राजमा", "मक्खन", "क्रीम", "टमाटर"], allergens: [{ key: "dairy" }], dietary: ["gluten-free", "high-protein"], groups: ["portion", "curry-addons"], bestseller: true, emoji: "🥘", hue: 20 },
  { slug: "butter-chicken", category: "mains", name: "Butter Chicken", hi: "बटर चिकन", description: "Tandoori chicken in a buttery tomato and fenugreek sauce.", hiDesc: "मक्खनी टमाटर और कसूरी मेथी सॉस में तंदूरी चिकन।", price: 38000, diet: "NON_VEG", spice: 1, prep: 20, ingredients: ["chicken", "tomato", "butter", "cream", "cashew", "fenugreek"], hiIngredients: ["चिकन", "टमाटर", "मक्खन", "क्रीम", "काजू", "मेथी"], allergens: [{ key: "dairy" }, { key: "nuts" }], dietary: ["gluten-free", "high-protein"], groups: ["portion", "spice-level"], bestseller: true, recommended: true, emoji: "🍲", hue: 12 },
  { slug: "chana-masala", category: "mains", name: "Chana Masala", hi: "चना मसाला", description: "Chickpeas in a tangy onion-tomato masala.", hiDesc: "खट्टे-मसालेदार प्याज़-टमाटर मसाले में छोले।", price: 24000, diet: "VEGAN", spice: 2, prep: 12, ingredients: ["chickpeas", "onion", "tomato", "ginger", "spices"], hiIngredients: ["छोले", "प्याज़", "टमाटर", "अदरक", "मसाले"], allergens: [], dietary: ["gluten-free", "high-protein"], groups: ["portion", "spice-level"], emoji: "🫘", hue: 36 },
  { slug: "mutton-rogan-josh", category: "mains", name: "Mutton Rogan Josh", hi: "मटन रोगन जोश", description: "Kashmiri-style lamb curry with Kashmiri chilli and fennel.", hiDesc: "कश्मीरी मिर्च और सौंफ़ के साथ कश्मीरी मटन करी।", price: 45000, diet: "NON_VEG", spice: 2, prep: 25, ingredients: ["mutton", "yogurt", "kashmiri chilli", "fennel"], hiIngredients: ["मटन", "दही", "कश्मीरी मिर्च", "सौंफ़"], allergens: [{ key: "dairy" }], dietary: ["gluten-free", "high-protein", "chef-special"], groups: ["spice-level"], emoji: "🍖", hue: 2 },
  { slug: "egg-curry", category: "mains", name: "Egg Curry", hi: "अंडा करी", description: "Boiled eggs in a home-style onion gravy.", hiDesc: "घर जैसी प्याज़ की ग्रेवी में उबले अंडे।", price: 26000, diet: "EGG", spice: 2, prep: 15, ingredients: ["egg", "onion", "tomato", "spices"], hiIngredients: ["अंडा", "प्याज़", "टमाटर", "मसाले"], allergens: [{ key: "egg" }], dietary: ["gluten-free"], groups: ["spice-level"], emoji: "🥚", hue: 42 },
  { slug: "palak-paneer", category: "mains", name: "Palak Paneer", hi: "पालक पनीर", description: "Paneer in a smooth, garlicky spinach purée.", hiDesc: "लहसुन वाली पालक प्यूरी में पनीर।", price: 30000, diet: "VEG", spice: 1, prep: 15, ingredients: ["spinach", "paneer", "garlic", "cream"], hiIngredients: ["पालक", "पनीर", "लहसुन", "क्रीम"], allergens: [{ key: "dairy" }], dietary: ["gluten-free"], groups: ["portion", "spice-level", "curry-addons"], emoji: "🥗", hue: 120 },

  // Breads
  { slug: "tandoori-roti", category: "breads", name: "Tandoori Roti", hi: "तंदूरी रोटी", description: "Whole-wheat flatbread from the clay oven.", hiDesc: "तंदूर में बनी गेहूं की रोटी।", price: 4000, diet: "VEGAN", spice: 0, prep: 5, ingredients: ["whole wheat flour", "water", "salt"], hiIngredients: ["गेहूं का आटा", "पानी", "नमक"], allergens: [{ key: "gluten" }], dietary: ["jain"], emoji: "🫓", hue: 34 },
  { slug: "naan", category: "breads", name: "Naan", hi: "नान", description: "Soft leavened bread — choose plain, butter, garlic or cheese.", hiDesc: "नरम खमीरी रोटी — सादा, बटर, गार्लिक या चीज़।", price: 6000, diet: "VEG", spice: 0, prep: 6, ingredients: ["refined flour", "yogurt", "yeast"], hiIngredients: ["मैदा", "दही", "खमीर"], allergens: [{ key: "gluten" }, { key: "dairy" }], groups: ["naan-style"], bestseller: true, emoji: "🥖", hue: 38 },
  { slug: "lachha-paratha", category: "breads", name: "Lachha Paratha", hi: "लच्छा पराठा", description: "Flaky, layered whole-wheat paratha.", hiDesc: "परतदार गेहूं का पराठा।", price: 7000, diet: "VEG", spice: 0, prep: 7, ingredients: ["whole wheat flour", "ghee"], hiIngredients: ["गेहूं का आटा", "घी"], allergens: [{ key: "gluten" }, { key: "dairy" }], emoji: "🥞", hue: 28 },

  // Rice & Biryani
  { slug: "veg-biryani", category: "rice-biryani", name: "Vegetable Dum Biryani", hi: "वेज दम बिरयानी", description: "Basmati and garden vegetables sealed and slow-cooked with saffron.", hiDesc: "केसर के साथ दम पर पकी बासमती और सब्ज़ियाँ।", price: 30000, diet: "VEG", spice: 2, prep: 20, ingredients: ["basmati rice", "vegetables", "saffron", "fried onion", "cashew"], hiIngredients: ["बासमती चावल", "सब्ज़ियाँ", "केसर", "तला प्याज़", "काजू"], allergens: [{ key: "dairy" }, { key: "nuts" }], groups: ["biryani-extras"], emoji: "🍚", hue: 44 },
  { slug: "chicken-dum-biryani", category: "rice-biryani", name: "Chicken Dum Biryani", hi: "चिकन दम बिरयानी", description: "Hyderabadi-style biryani layered with marinated chicken.", hiDesc: "मैरीनेट चिकन के साथ हैदराबादी बिरयानी।", price: 38000, diet: "NON_VEG", spice: 2, prep: 22, ingredients: ["basmati rice", "chicken", "yogurt", "saffron", "mint"], hiIngredients: ["बासमती चावल", "चिकन", "दही", "केसर", "पुदीना"], allergens: [{ key: "dairy" }], dietary: ["high-protein"], groups: ["biryani-extras"], bestseller: true, emoji: "🍛", hue: 32 },
  { slug: "jeera-rice", category: "rice-biryani", name: "Jeera Rice", hi: "जीरा राइस", description: "Basmati tempered with cumin.", hiDesc: "जीरे का तड़का लगा बासमती चावल।", price: 18000, diet: "VEGAN", spice: 0, prep: 10, ingredients: ["basmati rice", "cumin", "oil"], hiIngredients: ["बासमती चावल", "जीरा", "तेल"], allergens: [], dietary: ["gluten-free", "jain"], emoji: "🍚", hue: 50 },

  // Desserts
  { slug: "gulab-jamun", category: "desserts", name: "Gulab Jamun", hi: "गुलाब जामुन", description: "Warm milk dumplings in cardamom syrup (2 pcs).", hiDesc: "इलायची चाशनी में गरम गुलाब जामुन (2 पीस)।", price: 12000, diet: "VEG", spice: 0, prep: 5, ingredients: ["milk solids", "flour", "sugar", "cardamom"], hiIngredients: ["खोया", "मैदा", "चीनी", "इलायची"], allergens: [{ key: "dairy" }, { key: "gluten" }], groups: ["dessert-addon"], bestseller: true, emoji: "🍡", hue: 18 },
  { slug: "rasmalai", category: "desserts", name: "Rasmalai", hi: "रसमलाई", description: "Soft cheese discs in saffron-pistachio milk.", hiDesc: "केसर-पिस्ता दूध में नरम छेना।", price: 15000, diet: "VEG", spice: 0, prep: 5, ingredients: ["chhena", "milk", "saffron", "pistachio"], hiIngredients: ["छेना", "दूध", "केसर", "पिस्ता"], allergens: [{ key: "dairy" }, { key: "nuts" }], dietary: ["gluten-free"], emoji: "🍮", hue: 46 },
  { slug: "mango-kulfi", category: "desserts", name: "Mango Kulfi", hi: "मैंगो कुल्फ़ी", description: "Seasonal Alphonso mango kulfi.", hiDesc: "मौसमी अल्फांसो आम कुल्फ़ी।", price: 14000, diet: "VEG", spice: 0, prep: 3, ingredients: ["milk", "alphonso mango", "pistachio"], hiIngredients: ["दूध", "आम", "पिस्ता"], allergens: [{ key: "dairy" }, { key: "nuts" }], dietary: ["gluten-free"], seasonalFuture: true, emoji: "🥭", hue: 40 },
  { slug: "chocolate-brownie", category: "desserts", name: "Chocolate Brownie", hi: "चॉकलेट ब्राउनी", description: "Fudgy brownie, served warm.", hiDesc: "गरमागरम फ़ज़ी ब्राउनी।", price: 18000, diet: "EGG", spice: 0, prep: 6, ingredients: ["dark chocolate", "butter", "egg", "flour", "walnut"], hiIngredients: ["डार्क चॉकलेट", "मक्खन", "अंडा", "मैदा", "अखरोट"], allergens: [{ key: "egg" }, { key: "dairy" }, { key: "gluten" }, { key: "nuts" }], groups: ["dessert-addon"], emoji: "🍫", hue: 14 },

  // Beverages
  { slug: "masala-chai", category: "beverages", name: "Masala Chai", hi: "मसाला चाय", description: "Spiced milk tea brewed with ginger and cardamom.", hiDesc: "अदरक-इलायची वाली मसाला चाय।", price: 6000, diet: "VEG", spice: 0, prep: 5, ingredients: ["tea", "milk", "ginger", "cardamom", "sugar"], hiIngredients: ["चाय पत्ती", "दूध", "अदरक", "इलायची", "चीनी"], allergens: [{ key: "dairy" }], dietary: ["gluten-free"], groups: ["sweetness"], bestseller: true, emoji: "☕", hue: 26 },
  { slug: "sweet-lassi", category: "beverages", name: "Sweet Lassi", hi: "मीठी लस्सी", description: "Chilled churned yogurt, Punjabi style.", hiDesc: "ठंडी पंजाबी लस्सी।", price: 9000, diet: "VEG", spice: 0, prep: 4, ingredients: ["yogurt", "sugar", "cardamom"], hiIngredients: ["दही", "चीनी", "इलायची"], allergens: [{ key: "dairy" }], dietary: ["gluten-free"], groups: ["drink-size", "sweetness"], emoji: "🥛", hue: 190 },
  { slug: "fresh-lime-soda", category: "beverages", name: "Fresh Lime Soda", hi: "फ्रेश लाइम सोडा", description: "Sweet, salted or mixed — your choice.", hiDesc: "मीठा, नमकीन या मिक्स।", price: 8000, diet: "VEGAN", spice: 0, prep: 3, ingredients: ["lime", "soda", "sugar", "salt"], hiIngredients: ["नींबू", "सोडा", "चीनी", "नमक"], allergens: [], dietary: ["gluten-free", "jain"], groups: ["drink-size", "sweetness"], emoji: "🍋", hue: 80 },
  { slug: "cold-coffee", category: "beverages", name: "Cold Coffee", hi: "कोल्ड कॉफ़ी", description: "Blended iced coffee with a hint of vanilla.", hiDesc: "वनीला के साथ ठंडी कॉफ़ी।", price: 14000, diet: "VEG", spice: 0, prep: 5, ingredients: ["coffee", "milk", "ice cream", "sugar"], hiIngredients: ["कॉफ़ी", "दूध", "आइसक्रीम", "चीनी"], allergens: [{ key: "dairy" }], dietary: ["gluten-free"], groups: ["drink-size", "sweetness"], emoji: "🧋", hue: 22 },
  { slug: "soft-drink", category: "beverages", name: "Packaged Soft Drink", hi: "सॉफ्ट ड्रिंक", description: "Chilled 300 ml can.", hiDesc: "ठंडा 300 मि.ली. कैन।", price: 6000, diet: "VEGAN", spice: 0, prep: 1, ingredients: ["carbonated water", "sugar"], hiIngredients: ["सोडा पानी", "चीनी"], allergens: [], dietary: ["gluten-free"], tax: "GST18", emoji: "🥤", hue: 0 },
];

export const DEMO_PASSWORD = "DemoPass2026!";

export const STAFF = [
  { email: "admin@demo.restaurant.local", name: "Asha Admin", role: "ADMIN" },
  { email: "supervisor@demo.restaurant.local", name: "Sunil Supervisor", role: "SUPERVISOR" },
  { email: "kitchen@demo.restaurant.local", name: "Kiran Kitchen", role: "KITCHEN" },
  { email: "cashier@demo.restaurant.local", name: "Chitra Cashier", role: "CASHIER" },
  { email: "service@demo.restaurant.local", name: "Sameer Service", role: "SERVICE" },
] as const;

// Synthetic customers. Numbers are in a fictitious demo range.
export const CUSTOMERS = [
  { name: "Priya Sharma", phone: "+919800000001", verified: true },
  { name: "Rahul Verma", phone: "+919800000002", verified: true },
  { name: "Ananya Iyer", phone: "+919800000003", verified: false },
  { name: "Vikram Singh", phone: "+919800000004", verified: true },
  { name: "Meera Nair", phone: "+919800000005", verified: false },
];
