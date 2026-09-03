'use strict';
var browserApi = typeof browser !== 'undefined' ? browser : chrome;
var DEFAULT_BADGE_PREFS = {
  datePosted: true,
  techStack: true,
  salary: true,
  shift: true,
  experience: true,
  workSetup: true,
  jobType: true,
  degree: true,
  benefits: true,
  perks: true,
  ageLimit: true,
  gender: true,

  theme: 'light',
  density: 'detailed',
  hideOldJobs: false,
  oldJobDays: 30,
  freshJobDays: 7,
  cardColorRules: [],
  hideByExperience: false,
  maxExperienceYears: 8,
  copyVisibleOnly: true,
  scraperMode: false,
  hiddenTechCategories: {},
};

var COLOR_RULE_FIELDS = ['age', 'experience'];
var COLOR_RULE_OPERATORS = ['lt', 'lte', 'gt', 'gte', 'eq'];
function isValidHexColor(value) {
  return (
    typeof value === 'string' &&
    /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)
  );
}
function normalizeCardColorRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules.slice(0, 12).map((rule, index) => {
    const field = COLOR_RULE_FIELDS.includes(rule?.field) ? rule.field : 'age';
    const operator = COLOR_RULE_OPERATORS.includes(rule?.operator) ? rule.operator : 'lt';
    const rawValue = Number(rule?.value);
    const maxValue = field === 'age' ? 365 : 25;
    const value = Number.isFinite(rawValue) ? Math.min(maxValue, Math.max(0, rawValue)) : 7;
    return {
      id: typeof rule?.id === 'string' && rule.id.length <= 80 ? rule.id : `rule-${index + 1}`,
      field,
      operator,
      value,
      color: isValidHexColor(rule?.color) ? rule.color.toLowerCase() : '#eaf8f1',
    };
  });
}
function normalizeBadgePrefs(prefs) {
  const merged = { ...DEFAULT_BADGE_PREFS, ...(prefs || {}) };
  merged.cardColorRules = normalizeCardColorRules(merged.cardColorRules);
  const maxYears = Number(merged.maxExperienceYears);
  merged.maxExperienceYears = Number.isFinite(maxYears) ? Math.min(25, Math.max(0, maxYears)) : 8;
  merged.hideByExperience = merged.hideByExperience === true;
  merged.scraperMode = merged.scraperMode === true;
  merged.hiddenTechCategories = { ...(merged.hiddenTechCategories || {}) };
  return merged;
}
