import { getPlayerAge } from './PlayerManager';

// ─── Category / bucket helpers ────────────────────────────────
// All age-category logic lives here so EventManager stays lean.
// DB key 'u12' represents the U-13 bracket for this tournament;
// every label and cutoff reflects that.

export function isDoubles(type) { return type === 'doubles'; }

export function isGenderApplicable(category) { return category === 'adult'; }

export function getGenderOptions(type) {
  if (type === 'singles') return [{ value: 'mens', label: "Men's" }, { value: 'womens', label: "Women's" }];
  if (type === 'doubles') return [{ value: 'mens', label: "Men's" }, { value: 'womens', label: "Women's" }, { value: 'mixed', label: 'Mixed' }];
  return [];
}

// Human-readable label for a category key
export function categoryLabel(c) {
  return { u8: 'U-8', u12: 'U-13', u18: 'U-18', adult: 'Adult', senior: 'Senior' }[c] || c;
}

// Bucket index — 0 = most eligible, higher = less suitable
// u12 key = U-13 bracket: eligible age is 8 ≤ age < 13
export function getBucket(player, category) {
  const age = getPlayerAge(player);
  if (age === null) return 99;
  switch (category) {
    case 'u8':    return age < 8  ? 0 : age < 13 ? 1 : age < 18 ? 2 : age < 45 ? 3 : 4;
    case 'u12':   return (age >= 8 && age < 13) ? 0 : age < 8 ? 1 : age < 18 ? 2 : age < 45 ? 3 : 4;
    case 'u18':   return (age >= 13 && age < 18) ? 0 : (age >= 8 && age < 13) ? 1 : age < 8 ? 2 : age < 45 ? 3 : 4;
    case 'adult': return (age >= 18 && age < 45) ? 0 : age >= 45 ? 1 : (age >= 13 && age < 18) ? 2 : (age >= 8 && age < 13) ? 3 : 4;
    case 'senior':return age >= 45 ? 0 : (age >= 18 && age < 45) ? 1 : (age >= 13 && age < 18) ? 2 : (age >= 8 && age < 13) ? 3 : 4;
    default:      return 0;
  }
}

// Section header labels shown in the registration player list
export function bucketLabel(category, bucketIdx) {
  const labels = {
    u8:     ['Under 8 (eligible)',      'U-13',          'U-18',    'Adults',       'Seniors'],
    u12:    ['Ages 8-12 (eligible)',    'Under 8',       'U-18',    'Adults',       'Seniors'],
    u18:    ['Ages 13-18 (eligible)',   'U-13',          'Under 8', 'Adults',       'Seniors'],
    adult:  ['Adults 18-44 (eligible)', 'Seniors 45+',   'U-18',    'U-13',         'Under 8'],
    senior: ['Seniors 45+ (eligible)',  'Adults 18-44',  'U-18',    'U-13',         'Under 8'],
  };
  return (labels[category] || [])[bucketIdx] || 'Other';
}

export function sortByAgeRelevance(players, category) {
  return [...players].sort((a, b) => {
    const ba = getBucket(a, category), bb = getBucket(b, category);
    if (ba !== bb) return ba - bb;
    return a.name.localeCompare(b.name);
  });
}

export function sortByGenderAndAge(players, category, targetGender) {
  return [...players].sort((a, b) => {
    const gA = (targetGender && a.gender === targetGender) ? 0 : 1;
    const gB = (targetGender && b.gender === targetGender) ? 0 : 1;
    if (gA !== gB) return gA - gB;
    const bucketA = getBucket(a, category);
    const bucketB = getBucket(b, category);
    if (bucketA !== bucketB) return bucketA - bucketB;
    return a.name.localeCompare(b.name);
  });
}