"use strict";
(() => {
  function getFreshnessTier(daysAgo) {
    if (daysAgo <= 7) {
      return "fresh";
    } else if (daysAgo <= 14) {
      return "recent";
    } else {
      return "old";
    }
  }
  var storage = browserApi.storage;
  var rt = browserApi.runtime;
  var hookInjected = false;
  var extensionEnabled = true;
  var isApplyingChanges = false;
  function injectHook() {
    if (hookInjected) return;
    try {
      const s = document.createElement("script");
      s.src = rt.getURL("scripts/pageHook.js");
      s.onload = () => {
        s.remove();
        hookInjected = true;
      };
      s.onerror = () => {
      };
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {
    }
  }
  if (document.head || document.documentElement) {
    injectHook();
  } else {
    document.addEventListener("DOMContentLoaded", injectHook, { once: true });
  }
  window.addEventListener("popstate", () => {
    hookInjected = false;
    injectHook();
  });
  var SELECTORS = {
    jobCardLink: "a[data-jk]",
    jobListContainer: "#mosaic-provider-jobcards",
    activeLink: 'a[data-jk][aria-pressed="true"]'
  };
  const CACHE_KEY = "nizViewerCache";
  const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
  let cache = {};
  let badgePrefs = { ...DEFAULT_BADGE_PREFS };
  let activeFilters = new Set();
  
  function classifyShift(text) {
    if (!text || text.length < 3) return void 0;
    const t = text.toLowerCase();
    const shiftLabelM = t.match(/\b(?:shift|schedule|working\s+hours)[\s\-:]*([^.,\n]{3,40})/i);
    if (shiftLabelM) {
      const val = shiftLabelM[1].trim();
      if (val.includes("mid") && val.includes("night")) return "Mid to Night Shift";
      if (val.includes("night") || val.includes("graveyard") || val.includes("overnight") || val.includes("us hours")) return "Night Shift";
      if (val.includes("day") || val.includes("morning")) return "Day Shift";
      if (val.includes("evening") || val.includes("afternoon") || val.includes("mid")) return "Mid Shift";
      if (val.includes("rotating") || val.includes("rotation")) return "Rotating Shift";
    }
    if (/\bmid[\s-]*to[\s-]*night[\s-]*shifts?\b/.test(t) || /\bmid[\s-]*shifts?\b/.test(t)) return "Mid to Night Shift";
    if (/\bnight[\s-]*shifts?\b/i.test(t) || /\bnight[\s-]*schedules?\b/i.test(t) || /\bnight[\s-]*hours\b/i.test(t) || /\bnight[\s-]*work\b/i.test(t) || /\bgraveyard\b/.test(t) || /\bovernight\b/.test(t) || /\bus[\s-]*hours\b/.test(t)) return "Night Shift";
    if (/\bday[\s-]*shifts?\b/i.test(t) || /\bday[\s-]*schedules?\b/i.test(t) || /\bmorning[\s-]*shifts?\b/.test(t)) return "Day Shift";
    if (/\bevening[\s-]*shifts?\b/.test(t) || /\bafternoon[\s-]*shifts?\b/i.test(t) || /\bmid[\s-]*shifts?\b/i.test(t)) return "Mid Shift";
    if (/\brotating[\s-]*shifts?\b/.test(t) || /\bshift[\s-]*rotations?\b/.test(t)) return "Rotating Shift";
    if (/\bswing[\s-]*shifts?\b/.test(t)) return "Swing Shift";
    const tm = t.match(/(\d{1,2})(?::\d{2})?\s*(am|pm)?\s*(?:to|[-–—])\s*(\d{1,2})(?::\d{2})?\s*(am|pm)?/i);
    if (tm) {
      const hasMeridiem = !!(tm[2] || tm[4]);
      const idx = tm.index || 0;
      const hasContext = /\b(?:hours|schedule|work|between|time|shift|business)\b/i.test(t.substring(Math.max(0, idx - 20), idx + 20));
      if (hasMeridiem || hasContext) {
        let sH = parseInt(tm[1], 10), eH = parseInt(tm[3], 10);
        const sM = (tm[2] || "").toLowerCase(), eM = (tm[4] || "").toLowerCase();
        if (sM === "pm" && sH < 12) sH += 12;
        if (sM === "am" && sH === 12) sH = 0;
        if (eM === "pm" && eH < 12) eH += 12;
        if (eM === "am" && eH === 12) eH = 0;
        if (sH >= 18 || sH <= 4 || eH >= 0 && eH <= 8 && sH > eH) return "Night Shift";
        if (sH >= 6 && sH <= 10 && eH >= 14 && eH <= 19) return "Day Shift";
        if (sH >= 12 && sH <= 16) return "Mid Shift";
      }
    }
    if (/\bmidnight\b/.test(t) || /\bnocturnal\b/.test(t)) return "Night Shift";
    if (/aligned\s+with\s+(?:us|u\.s\.|american|est|pst|cst|mst)\s+(?:business\s+)?hours/i.test(t)) return "Night Shift";
    return void 0;
  }

  function parseDetailHtml(html) {
    const rawText = html.replace(/<[^>]+>/g, " ").replace(/&[a-z#\d]+;/gi, " ");
    const text = rawText.replace(/\s+/g, " ");
    const shift = classifyShift(text);
    let workSetup;
    if (/\b(?:permanent[\s-]+remote|remote|wfh|work[\s-]+from[\s-]+home|home[\s-]*based|remotely|virtual)\b/i.test(text)) {
      workSetup = "Remote";
    } else if (/\b(?:hybrid|hyrbid|mixed|work[\s-]+from[\s-]+office)\b/i.test(text)) {
      workSetup = "Hybrid";
    }
    if (!workSetup) {
      const setupLabelM = text.match(/(?:Location|Set[\s-]?up|Arrangement|Work\s+Setup|Type|Working\s+Arrangement|Basis|Environment)[\s\-:]*([^.,\n]{3,40})/i);
      if (setupLabelM) {
        const v = setupLabelM[1].toLowerCase();
        if (v.includes("onsite") || v.includes("on-site") || v.includes("office") || v.includes("person") || v.includes("in-person")) workSetup = "Onsite";
      }
    }
    if (!workSetup) {
      if (/\b(?:on[\s-]?site|in[\s-]*office|in[\s-]*person|onsite|on[\s-]*site)\b/i.test(text)) workSetup = "Onsite";
    }
    if (!workSetup && /\bno\s+remote\b/i.test(text)) workSetup = "Onsite";
    let experience;
    const yearNums = [];
    const rangePattern = /(\d+(?:\.\d+)?)\s*(?:to|[-–—])\s*(\d+(?:\.\d+)?)\s*(?:year|yr)s?/gi;
    for (const m of text.matchAll(rangePattern)) {
      yearNums.push(parseFloat(m[1]), parseFloat(m[2]));
    }
    const orMorePattern = /(?:at\s+least|minimum\s+of|min)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:or)?\s*more\s*(?:year|yr)s?/gi;
    for (const m of text.matchAll(orMorePattern)) {
      const val = parseFloat(m[1] || m[2]);
      if (!isNaN(val)) yearNums.push(val);
    }
    const standalonePattern = /(\d+(?:\.\d+)?)\s*(?:\+)?\s*(?:year|yr)s?/gi;
    let match;
    while ((match = standalonePattern.exec(text)) !== null) {
      const val = parseFloat(match[1]);
      const start = Math.max(0, match.index - 80);
      const end = Math.min(text.length, match.index + 120);
      const context = text.substring(start, end).toLowerCase();
      if (/\b(?:exp|experience|required|requirements|minimum|min|at\s+least|plus|prefer)\b/.test(context)) {
        yearNums.push(val);
      }
    }
    if (yearNums.length > 0) {
      const valid = Array.from(new Set(yearNums.filter((n) => n >= 0.5 && n <= 25))).sort((a, b) => a - b);
      if (valid.length > 0) {
        const min = valid[0];
        const max = valid[valid.length - 1];
        experience = min === max ? `${min}+ yrs` : `${min}\u2013${max} yrs`;
      }
    }
    if (!experience && /entry[\s-]*level|no\s+experience|fresh\s*grad/i.test(text)) {
      experience = "Entry Level";
    }

    let jobType;
    if (/\b(?:full[\s-]*time|ft)\b/i.test(text)) jobType = "Full-time";
    else if (/\b(?:part[\s-]*time|pt)\b/i.test(text)) jobType = "Part-time";
    else if (/\b(?:contract|contractor|c2c|1099)\b/i.test(text)) jobType = "Contract";
    else if (/\b(?:freelance|freelancer)\b/i.test(text)) jobType = "Freelance";
    else if (/\bintern(?:ship)?\b/i.test(text)) jobType = "Internship";

    let salary;
    const salaryRegex = /(?:Rs|\$|£|€)\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:k|K)?(?:\s*(?:-|to)\s*(?:Rs|\$|£|€)?\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:k|K)?)?(?:\s*USD|\s*CAD|\s*EUR|\s*GBP)?\s*(?:a year|per year|annually|a month|per month|monthly|an hour|per hour|\/hr|\/yr|\/mo)/i;
    const salaryMatch = text.match(salaryRegex);
    if (salaryMatch) {
      salary = salaryMatch[0].trim();
    }

    let degree;
    if (/\b(?:phd|doctorate|ph\.d)\b/i.test(text)) degree = "PhD";
    else if (/\b(?:master'?s?|ms|m\.s\.|mba|m\.b\.a\.)\b/i.test(text)) degree = "Master's";
    else if (/\b(?:bachelor'?s?|bs|b\.s\.|ba|b\.a\.|b\.sc|beng)\b/i.test(text)) degree = "Bachelor's";
    else if (/\b(?:associate'?s?|aa|a\.a\.|as|a\.s\.)\b/i.test(text)) degree = "Associate's";
    else if (/\b(?:diploma|high school|ged)\b/i.test(text)) degree = "Diploma";

    let techStack;
    const foundTechs = new Set();
    const keywordsToUse = typeof TECH_KEYWORDS !== 'undefined' ? TECH_KEYWORDS : [];
    
    for (const tech of keywordsToUse) {
      if (tech.length === 1 && tech !== 'C' && tech !== 'R') continue;
      
      const escapedTech = tech.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const isCaseSensitive = tech.length <= 2 || ['Go', 'Dart', 'Chef', 'Puppet', 'Make'].includes(tech);
      const flags = isCaseSensitive ? '' : 'i';
      
      const regex = new RegExp(`(?:^|\\W)${escapedTech}(?:$|\\W)`, flags);
      if (regex.test(text)) {
        if (tech === 'C' && /(?:^|\W)C-(?:level|suite)/i.test(text)) continue;
        if (tech === 'R' && /(?:^|\W)R&D(?:$|\W)/i.test(text)) continue;
        
        foundTechs.add(tech);
      }
    }
    if (foundTechs.size > 0) {
      techStack = Array.from(foundTechs).join(", ");
    }

    let benefits;
    if (/\b(?:eobi|provident fund|gratuity|pf)\b/i.test(text)) benefits = "EOBI / PF";

    let perks;
    if (/\b(?:pick and drop|transport allowance|fuel allowance|mobile allowance)\b/i.test(text)) perks = "Allowances";

    let ageLimit;
    const ageMatch = text.match(/(?:max|maximum)\s*age(?: limit)?\s*(?:is)?\s*(\d{2})/i);
    if (ageMatch) ageLimit = `Max Age: ${ageMatch[1]}`;

    let gender;
    if (/\b(?:females? encouraged|female staff)\b/i.test(text)) gender = "Females Encouraged";
    else if (/\bmales? only\b/i.test(text)) gender = "Males Only";
    else if (/\bfemales? only\b/i.test(text)) gender = "Females Only";

    return { shift, experience, workSetup, jobType, degree, techStack, salary, benefits, perks, ageLimit, gender };
  }
  function debounce(fn, ms) {
    let t;
    return (...args) => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => fn(...args), ms);
    };
  }
  async function loadData() {
    try {
      const localRes = await storage.local.get([CACHE_KEY, "extensionEnabled", "badgePrefs"]);
      if (localRes?.[CACHE_KEY]) cache = localRes[CACHE_KEY];
      if (typeof localRes?.extensionEnabled === "boolean") extensionEnabled = localRes.extensionEnabled;
      if (localRes?.badgePrefs) badgePrefs = { ...badgePrefs, ...localRes.badgePrefs };
    } catch {
    }
  }
  async function saveData() {
    try {
      const localRes = await storage.local.get([CACHE_KEY]);
      if (localRes?.[CACHE_KEY]) {
        cache = { ...localRes[CACHE_KEY], ...cache };
      }
      await storage.local.set({ [CACHE_KEY]: cache });
    } catch {
    }
  }
  function pruneCache() {
    const now = Date.now();
    let changed = false;
    for (const [jk, entry] of Object.entries(cache)) {
      if (!entry || typeof entry.savedAt !== "number") {
        delete cache[jk];
        changed = true;
        continue;
      }
      if (now - entry.savedAt > CACHE_TTL_MS) {
        delete cache[jk];
        changed = true;
      }
    }
    if (changed) saveData();
  }
  function getActiveJk() {
    const url = new URL(location.href);
    const vjk = url.searchParams.get("vjk");
    if (vjk) return vjk;
    const active = document.querySelector(SELECTORS.activeLink);
    return active?.getAttribute("data-jk") || null;
  }
  function ensureBadgeWrapper(jk) {
    const link = document.querySelector(`${SELECTORS.jobCardLink}[data-jk="${jk}"]`);
    if (!link) return null;
    const title = link.closest('.jobTitle, [data-testid="jobTitle"]') || link;
    const parent = title.parentNode;
    if (!parent) return null;
    let wrapper = parent.querySelector(`.badge-wrapper[data-jk="${jk}"]`);
    if (wrapper) return wrapper;
    const stale = parent.querySelectorAll(`.badge-wrapper[data-jk="${jk}"]`);
    if (stale.length > 0) {
      stale.forEach((el) => el.remove());
    }
    wrapper = document.createElement("div");
    wrapper.className = "badge-wrapper";
    wrapper.setAttribute("data-jk", jk);
    parent.insertBefore(wrapper, title);
    return wrapper;
  }
  function getShiftClass(shift) {
    if (/night|graveyard|overnight/i.test(shift)) return "badge-shift-night";
    if (/mid/i.test(shift)) return "badge-shift-mid";
    return "badge-shift-day";
  }
  function getShiftEmoji(shift) {
    if (/night|graveyard|overnight/i.test(shift)) return "🌙";
    if (/mid/i.test(shift)) return "🕒";
    return "☀️";
  }
  function getSetupClass(setup) {
    return `badge-setup-${(setup || "").toLowerCase()}`;
  }
  function getSetupEmoji(setup) {
    if (setup === "Remote") return "🏠";
    if (setup === "Hybrid") return "🤝";
    return "🏢";
  }
  function renderBadges(jk) {
    const entry = cache[jk];
    const wrapper = ensureBadgeWrapper(jk);
    if (!wrapper) return;
    const stateHash = JSON.stringify({
      e: extensionEnabled,
      d: entry?.datePostedIso,
      s: entry?.salary,
      sh: entry?.shift,
      ex: entry?.experience,
      ws: entry?.workSetup,
      jt: entry?.jobType,
      dg: entry?.degree,
      ts: entry?.techStack,
      be: entry?.benefits,
      pe: entry?.perks,
      ag: entry?.ageLimit,
      ge: entry?.gender,
      p: badgePrefs
    });
    if (wrapper.getAttribute("data-rendered-hash") === stateHash) return;
    wrapper.setAttribute("data-rendered-hash", stateHash);
    isApplyingChanges = true;
    try {
      wrapper.replaceChildren();
      if (!extensionEnabled) return;
      if (!entry) return;
      if (entry.datePostedIso) {
        const date = new Date(entry.datePostedIso);
        const diffTime = Math.abs(Date.now() - date.getTime());
        const daysAgo = Math.floor(diffTime / 864e5);
        const b = document.createElement("div");
        b.className = `nizviewer-badge badge-${getFreshnessTier(daysAgo)}`;
        const formattedDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
        b.textContent = `📅 ${formattedDate} (${daysAgo === 0 ? "Today" : `${daysAgo}d ago`})`;
        b.title = `Originally posted on ${date.toDateString()}`;
        b.addEventListener('click', (e) => toggleFilter(e, 'Freshness', daysAgo <= 7 ? 'Fresh' : daysAgo <= 14 ? 'Recent' : 'Old'));
        wrapper.appendChild(b);
      }
      
      if (entry.salary && badgePrefs.salary) {
          const b = document.createElement("div");
          b.className = "nizviewer-badge badge-info-pill";
          b.textContent = `💰 ${entry.salary}`;
          wrapper.appendChild(b);
      }
      
      if (entry.shift && badgePrefs.jobType) {
          const b = document.createElement("div");
          b.className = `nizviewer-badge badge-info-pill ${getShiftClass(entry.shift)}`;
          b.textContent = `${getShiftEmoji(entry.shift)} ${entry.shift}`;
          b.addEventListener('click', (e) => toggleFilter(e, 'Shift', entry.shift));
          wrapper.appendChild(b);
      }
      if (entry.workSetup && badgePrefs.workSetup) {
        const b = document.createElement("div");
        b.className = `nizviewer-badge badge-info-pill ${getSetupClass(entry.workSetup)}`;
        b.textContent = `${getSetupEmoji(entry.workSetup)} ${entry.workSetup}`;
        b.addEventListener('click', (e) => toggleFilter(e, 'Setup', entry.workSetup));
        wrapper.appendChild(b);
      }
      if (entry.experience && badgePrefs.degree) {
        const b = document.createElement("div");
        b.className = "nizviewer-badge badge-info-pill badge-experience";
        b.textContent = `💼 ${entry.experience}`;
        b.addEventListener('click', (e) => toggleFilter(e, 'Experience', entry.experience));
        wrapper.appendChild(b);
      }
      if (entry.jobType && badgePrefs.jobType) {
        const b = document.createElement("div");
        b.className = "nizviewer-badge badge-info-pill badge-jobtype";
        b.textContent = `⏱️ ${entry.jobType}`;
        b.addEventListener('click', (e) => toggleFilter(e, 'Type', entry.jobType));
        wrapper.appendChild(b);
      }
      if (entry.degree && badgePrefs.degree) {
        const b = document.createElement("div");
        b.className = "nizviewer-badge badge-info-pill badge-degree";
        b.textContent = `🎓 ${entry.degree}`;
        b.addEventListener('click', (e) => toggleFilter(e, 'Degree', entry.degree));
        wrapper.appendChild(b);
      }
      if (entry.techStack && badgePrefs.techStack) {
        const b = document.createElement("div");
        b.className = "nizviewer-badge badge-info-pill badge-techstack";
        b.textContent = `💻 ${entry.techStack}`;
        b.title = entry.techStack;
        wrapper.appendChild(b);
      }
      if (entry.benefits && badgePrefs.benefits) {
        const b = document.createElement("div");
        b.className = "nizviewer-badge badge-info-pill badge-benefits";
        b.textContent = `🏦 ${entry.benefits}`;
        b.title = "Retirement & Statutory Benefits";
        wrapper.appendChild(b);
      }
      if (entry.perks && badgePrefs.perks) {
        const b = document.createElement("div");
        b.className = "nizviewer-badge badge-info-pill badge-perks";
        b.textContent = `🚗 ${entry.perks}`;
        b.title = "Allowances & Perks";
        wrapper.appendChild(b);
      }
      if (entry.ageLimit && badgePrefs.ageLimit) {
        const b = document.createElement("div");
        b.className = "nizviewer-badge badge-info-pill badge-age";
        b.textContent = `🎂 ${entry.ageLimit}`;
        wrapper.appendChild(b);
      }
      if (entry.gender && badgePrefs.gender) {
        const b = document.createElement("div");
        b.className = "nizviewer-badge badge-info-pill badge-gender";
        b.textContent = `👥 ${entry.gender}`;
        wrapper.appendChild(b);
      }
    } finally {
      setTimeout(() => {
        isApplyingChanges = false;
      }, 50);
    }
  }
  function scavengeCard(jk) {
    const link = document.querySelector(`${SELECTORS.jobCardLink}[data-jk="${jk}"]`);
    const card = link?.closest('li, [data-testid="jobListing"], [class*="job_seen_beacon"]');
    if (!card) return;
    const text = card.textContent?.replace(/\s+/g, " ") || "";
    const { shift, experience, workSetup, jobType, degree, techStack, benefits, perks, ageLimit, gender } = parseDetailHtml(text);
    const existing = cache[jk];
    if (existing?.deepScanned) return;
    const hasNew = 
      (shift && shift !== existing?.shift) || 
      (experience && experience !== existing?.experience) || 
      (workSetup && workSetup !== existing?.workSetup) ||
      (jobType && jobType !== existing?.jobType) ||
      (degree && degree !== existing?.degree) ||
      (techStack && techStack !== existing?.techStack) ||
      (benefits && benefits !== existing?.benefits) ||
      (perks && perks !== existing?.perks) ||
      (ageLimit && ageLimit !== existing?.ageLimit) ||
      (gender && gender !== existing?.gender);
    if (hasNew) {
      cache[jk] = {
        ...existing,
        shift: existing?.shift ?? shift,
        experience: existing?.experience ?? experience,
        workSetup: existing?.workSetup ?? workSetup,
        jobType: existing?.jobType ?? jobType,
        degree: existing?.degree ?? degree,
        techStack: existing?.techStack ?? techStack,
        benefits: existing?.benefits ?? benefits,
        perks: existing?.perks ?? perks,
        ageLimit: existing?.ageLimit ?? ageLimit,
        gender: existing?.gender ?? gender,
        savedAt: Date.now()
      };
      renderBadges(jk);
    }
  }
  function applyFilters() {
    const links = Array.from(document.querySelectorAll(SELECTORS.jobCardLink));
    for (const link of links) {
      const jk = link.getAttribute("data-jk");
      const card = link.closest('li, [class*="job_seen_beacon"]');
      if (!card) continue;
      
      if (activeFilters.size === 0) {
        card.classList.remove('nizviewer-hidden-card');
        continue;
      }
      
      const entry = cache[jk];
      if (!entry) {
        card.classList.remove('nizviewer-hidden-card');
        continue;
      }
      
      let matchAll = true;
      for (const filterStr of activeFilters) {
        const [cat, val] = filterStr.split(':');
        
        let entryVal = null;
        if (cat === 'Shift') entryVal = entry.shift;
        else if (cat === 'Setup') entryVal = entry.workSetup;
        else if (cat === 'Type') entryVal = entry.jobType;
        else if (cat === 'Degree') entryVal = entry.degree;
        else if (cat === 'Experience') entryVal = entry.experience;
        else if (cat === 'Freshness' && entry.datePostedIso) {
          const diffTime = Math.abs(Date.now() - new Date(entry.datePostedIso).getTime());
          const daysAgo = Math.floor(diffTime / 864e5);
          entryVal = daysAgo <= 7 ? 'Fresh' : daysAgo <= 14 ? 'Recent' : 'Old';
        }
        
        if (entryVal !== val) {
          matchAll = false;
          break;
        }
      }
      
      if (matchAll) {
        card.classList.remove('nizviewer-hidden-card');
      } else {
        card.classList.add('nizviewer-hidden-card');
      }
    }
  }

  function toggleFilter(e, category, value) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const key = `${category}:${value}`;
    if (activeFilters.has(key)) {
      activeFilters.delete(key);
    } else {
      activeFilters.add(key);
    }
    renderFilterBar();
    applyFilters();
  }

  function renderFilterBar() {
    if (!extensionEnabled) {
      const existing = document.getElementById('nizviewer-filter-bar');
      if (existing) existing.remove();
      return;
    }
    const container = document.querySelector(SELECTORS.jobListContainer);
    if (!container) return;
    
    let bar = document.getElementById('nizviewer-filter-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'nizviewer-filter-bar';
      bar.className = 'nizviewer-filter-bar';
      container.parentElement.insertBefore(bar, container);
    }
    
    const availableFilters = new Set();
    const links = Array.from(document.querySelectorAll(SELECTORS.jobCardLink));
    for (const link of links) {
      const entry = cache[link.getAttribute("data-jk")];
      if (entry) {
        if (entry.shift) availableFilters.add(`Shift:${entry.shift}`);
        if (entry.workSetup) availableFilters.add(`Setup:${entry.workSetup}`);
        if (entry.jobType) availableFilters.add(`Type:${entry.jobType}`);
      }
    }
    for (const f of activeFilters) availableFilters.add(f);
    
    if (availableFilters.size === 0) {
      bar.style.display = 'none';
      return;
    }
    
    bar.style.display = 'flex';
    bar.innerHTML = `<div class="nizviewer-filter-label">Filters &#9663;</div>`;
    
    const sortedFilters = Array.from(availableFilters).sort();
    for (const filterStr of sortedFilters) {
      const [cat, val] = filterStr.split(':');
      const pill = document.createElement('div');
      pill.className = `nizviewer-filter-pill ${activeFilters.has(filterStr) ? 'active' : ''}`;
      pill.textContent = val;
      pill.title = `Filter by ${cat}: ${val}`;
      pill.setAttribute('aria-label', `Filter by ${val}`);
      pill.setAttribute('role', 'button');
      pill.setAttribute('tabindex', '0');
      pill.addEventListener('click', () => toggleFilter(null, cat, val));
      pill.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') toggleFilter(null, cat, val); });
      bar.appendChild(pill);
    }

    if (activeFilters.size > 0) {
      const clearBtn = document.createElement('div');
      clearBtn.className = 'nizviewer-filter-pill';
      clearBtn.textContent = '× Clear';
      clearBtn.title = 'Clear all active filters';
      clearBtn.setAttribute('role', 'button');
      clearBtn.setAttribute('tabindex', '0');
      clearBtn.style.marginLeft = 'auto';
      clearBtn.style.color = 'var(--colors-error, #e53e3e)';
      clearBtn.addEventListener('click', () => {
        activeFilters.clear();
        renderFilterBar();
        applyFilters();
      });
      bar.appendChild(clearBtn);
    }
  }

  function renderAllVisible() {
    pruneCache();
    const links = Array.from(document.querySelectorAll(SELECTORS.jobCardLink));
    const jks = [];
    for (const a of links) {
      const jk = a.getAttribute("data-jk");
      if (jk) {
        jks.push(jk);
        scavengeCard(jk);
        renderBadges(jk);
      }
    }
    if (jks.length) {
      window.postMessage({ source: "nizviewer", type: "INTERESTED_JKS", jks }, "*");
    }
    
    renderFilterBar();
    applyFilters();
    
    if (typeof window.injectAutoScanBtn === 'function') {
      window.injectAutoScanBtn();
    }
    if (typeof window.updateAutoScanBtnState === 'function') {
      window.updateAutoScanBtnState();
    }
  }
  function scrapeDetailPanel(jk, attempt = 0) {
    return new Promise((resolve) => {
      try {
        const activeVjk = new URL(window.location.href).searchParams.get("vjk");
        if (activeVjk && activeVjk !== jk) {
          if (attempt < 5) {
            setTimeout(() => resolve(scrapeDetailPanel(jk, attempt + 1)), 800);
            return;
          }
          resolve(false);
          return;
        }
      const HEADER_SELECTORS = [
        '[data-testid="jobsearch-JobInfoHeader"]',
        '[data-testid="inlineHeader-companyLocation"]',
        '[class*="jobsearch-InlineCompanyRating"]',
        '[class*="CompanyInfo"]',
        '[class*="companyLocation"]',
        '[class*="jobLocation"]',
        ".jobsearch-JobInfoHeader-subtitle",
        ".jobsearch-CompanyInfoWithoutHeaderImage"
      ];
      const BODY_SELECTORS = [
        "#jobDescriptionText",
        '[id*="jobDescription"]',
        '[class*="jobDescription"]',
        ".jobsearch-JobComponent",
        '[class*="JobDetail"]',
        '[class*="jobDetail"]',
        '[data-testid="job-detail"]',
        ".job-description"
      ];
      let headerText = "";
      for (const sel of HEADER_SELECTORS) {
        const el = document.querySelector(sel);
        if (el?.textContent) headerText += " " + el.textContent;
      }
      let bodyText = "";
      for (const sel of BODY_SELECTORS) {
        const el = document.querySelector(sel);
        if (el?.textContent && el.textContent.length > 50) {
          bodyText = el.textContent;
          break;
        }
      }
      if (!bodyText) {
        const main = document.querySelector('main, [role="main"]');
        if (main?.textContent && main.textContent.length > 100) bodyText = main.textContent;
      }
      const combinedText = (headerText + " " + bodyText).replace(/\s+/g, " ");
      if (combinedText.length < 30) {
        if (attempt < 5) {
          setTimeout(() => resolve(scrapeDetailPanel(jk, attempt + 1)), 800);
          return;
        }
        resolve(false);
        return;
      }
      const existing = cache[jk] || { savedAt: Date.now() };
      const { shift, experience, workSetup, jobType, degree, techStack, salary, benefits, perks, ageLimit, gender } = parseDetailHtml(combinedText);
      const needsUpdate = 
        (salary && salary !== existing.salary) ||
        (shift && shift !== existing.shift) || 
        (experience && experience !== existing.experience) || 
        (workSetup && workSetup !== existing.workSetup) ||
        (jobType && jobType !== existing.jobType) ||
        (degree && degree !== existing.degree) ||
        (techStack && techStack !== existing.techStack) ||
        (benefits && benefits !== existing.benefits) ||
        (perks && perks !== existing.perks) ||
        (ageLimit && ageLimit !== existing.ageLimit) ||
        (gender && gender !== existing.gender);
      if (needsUpdate) {
        cache[jk] = {
          ...existing,
          salary: salary ?? existing.salary,
          shift: shift ?? existing.shift,
          experience: experience ?? existing.experience,
          workSetup: workSetup ?? existing.workSetup,
          jobType: jobType ?? existing.jobType,
          degree: degree ?? existing.degree,
          techStack: techStack ?? existing.techStack,
          benefits: benefits ?? existing.benefits,
          perks: perks ?? existing.perks,
          ageLimit: ageLimit ?? existing.ageLimit,
          gender: gender ?? existing.gender,
          savedAt: Date.now(),
          deepScanned: true
        };
        renderBadges(jk);
        saveData();
      }
      resolve(true);
    } catch {
      resolve(false);
    }
    });
  }
  async function onSelectionMaybeChanged() {
    const jk = getActiveJk();
    if (!jk) return;
    ensureBadgeWrapper(jk);
    setTimeout(() => scrapeDetailPanel(jk, 0), 700);
  }
  function init() {
    injectHook();
    loadData().then(async () => {
      const res = await storage.local.get(["extensionEnabled"]);
      if (res.extensionEnabled !== void 0) extensionEnabled = res.extensionEnabled;
      
      window.addEventListener("message", async (ev) => {
        const d = ev.data;
        if (!d || d.source !== "nizviewer" || d.type !== "JOB_DATES") return;
        if (Array.isArray(d.payload)) {
          let changed = false;
          for (const item of d.payload) {
            if (!item.jk) continue;
            const existing = cache[item.jk];
            if (existing?.deepScanned && !item.deepScanned) continue;
            const updated = {
              ...existing,
              datePostedIso: item.dateIso || existing?.datePostedIso,
              companyName: item.companyName || existing?.companyName,
              salary: item.salary || existing?.salary,
              shift: item.shift ?? existing?.shift,
              experience: item.experience ?? existing?.experience,
              workSetup: item.workSetup ?? existing?.workSetup,
              jobType: item.jobType ?? existing?.jobType,
              degree: item.degree ?? existing?.degree,
              techStack: item.techStack ?? existing?.techStack,
              benefits: item.benefits ?? existing?.benefits,
              perks: item.perks ?? existing?.perks,
              ageLimit: item.ageLimit ?? existing?.ageLimit,
              gender: item.gender ?? existing?.gender,
              savedAt: Date.now(),
              deepScanned: item.deepScanned || existing?.deepScanned
            };
            if (JSON.stringify(existing) !== JSON.stringify(updated)) {
              cache[item.jk] = updated;
              changed = true;
              renderBadges(item.jk);
            }
          }
          if (changed) await saveData();
        }
      });

      renderAllVisible();
      onSelectionMaybeChanged();
    });
    const debounced = debounce(() => {
      renderAllVisible();
      onSelectionMaybeChanged();
    }, 100);
    rt.onMessage.addListener((msg) => {
      if (msg.type === "EXTENSION_STATE_CHANGED") {
        extensionEnabled = msg.enabled;
        renderAllVisible();
      } else if (msg.type === "PREFS_CHANGED") {
        badgePrefs = { ...badgePrefs, ...msg.prefs };
        renderAllVisible();
      } else if (msg.type === "CACHE_CLEARED") {
        cache = {};
        activeFilters.clear();
        renderAllVisible();
      }
    });
    setInterval(() => {
      if (document.hidden) return;
      renderAllVisible();
      if (typeof window.injectAutoScanBtn === 'function') {
        window.injectAutoScanBtn();
      }
      const activeJk = getActiveJk();
      if (activeJk && cache[activeJk] && !cache[activeJk].deepScanned) {
        scrapeDetailPanel(activeJk, 0);
      }
    }, 1e3);
    document.addEventListener("click", (e) => {
      const t = e.target;
      if (t?.closest?.(SELECTORS.jobCardLink)) {
        setTimeout(() => debounced(), 350);
      }
    }, true);
    const observer = new MutationObserver(() => {
      if (isApplyingChanges) return;
      debounced();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    let isScanning = false;
    let abortScan = false;
    
    document.addEventListener('click', (e) => {
      if (isScanning && e.isTrusted && !e.target.closest('#nizviewer-autoscan')) {
        abortScan = true;
      }
    }, true);
    
    window.injectAutoScanBtn = function() {
      if (document.getElementById('nizviewer-autoscan')) return;
      
      const btn = document.createElement('button');
      btn.id = 'nizviewer-autoscan';
      btn.className = 'auto-scan-btn';
      btn.type = 'button';
      
      window.renderBtnHtml = (text, progress = null) => {
        const intervalSec = parseFloat(((parseInt(badgePrefs.scanInterval, 10) || 1500) / 1000).toFixed(1));
        const progressHtml = progress !== null ? `<div class="scan-progress-fill" style="width: ${progress}%"></div>` : '';
        return `
          ${progressHtml}
          <div class="scan-content-wrapper">
            <span>${text}</span>
            <div class="scan-interval-pill" title="Configure speed in the NizViewer popup">
              ${intervalSec}s
              <div class="scan-interval-tooltip">⚙️ Configure speed in NizViewer popup</div>
            </div>
          </div>
        `;
      };
      
      window.getUnscannedJks = function() {
        const lks = Array.from(document.querySelectorAll(SELECTORS.jobCardLink));
        let curUnsc = lks
          .map(l => l.getAttribute('data-jk'))
          .filter(jk => jk && (!cache[jk] || !cache[jk].deepScanned));
          
        if (badgePrefs.scanLimit && parseInt(badgePrefs.scanLimit, 10) > 0) {
          curUnsc = curUnsc.slice(0, parseInt(badgePrefs.scanLimit, 10));
        }
        return curUnsc;
      };
      
      window.updateAutoScanBtnState = function() {
        if (isScanning) return;
        const b = document.getElementById('nizviewer-autoscan');
        if (!b) return;
        
        if (window.location.pathname.includes('/viewjob') || window.location.pathname.includes('/v/')) {
          b.style.display = 'none';
          return;
        } else {
          b.style.display = 'block';
        }
        
        const curUnsc = window.getUnscannedJks();
        b.innerHTML = window.renderBtnHtml(curUnsc.length > 0 ? `🤖 Auto-Scan (${curUnsc.length} jobs)` : `🤖 Auto-Scan Page`);
      };
      
      window.updateAutoScanBtnState();
      
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (isScanning) {
          abortScan = true;
          btn.innerHTML = window.renderBtnHtml(`🛑 Stopping...`);
          return;
        }
        
        isScanning = true;
        abortScan = false;
        
        const unScannedJks = window.getUnscannedJks();
        
        if (unScannedJks.length === 0) {
          btn.innerHTML = window.renderBtnHtml(`✨ All Scanned`);
          setTimeout(() => {
            if (!isScanning) window.updateAutoScanBtnState();
            isScanning = false;
            document.body.classList.remove('nizviewer-scanning-active');
          }, 2000);
          return;
        }
        
        const originalScrollY = window.scrollY;
        document.body.classList.add('nizviewer-scanning-active');
        
        for (let i = 0; i < unScannedJks.length; i++) {
          if (!extensionEnabled || abortScan) break;
          const jk = unScannedJks[i];
          
          btn.classList.add('scanning');
          const percent = ((i / unScannedJks.length) * 100).toFixed(1);
          btn.innerHTML = window.renderBtnHtml(`⏳ Scanning ${i + 1}/${unScannedJks.length}...`, percent);
          
          const link = document.querySelector(`${SELECTORS.jobCardLink}[data-jk="${jk}"]`);
          if (!link) continue;
          
          link.scrollIntoView({ behavior: 'smooth', block: 'center' });
          
          const baseInterval = parseInt(badgePrefs.scanInterval, 10) || 1500;
          await new Promise(resolve => setTimeout(resolve, baseInterval));
          
          if (abortScan) break;
          
          const titleEl = link.querySelector('span[title]') || link.querySelector('h2') || link;
          titleEl.dispatchEvent(new MouseEvent('click', { 
            bubbles: true, 
            cancelable: true, 
            view: window,
            button: 0,
            buttons: 1
          }));
          
          await scrapeDetailPanel(jk, 0);
        }
        
        btn.classList.remove('scanning');
        btn.innerHTML = window.renderBtnHtml(abortScan ? `🛑 Scan Stopped` : `✨ Scan Complete`);
        document.body.classList.remove('nizviewer-scanning-active');
        
        if (abortScan) {
          const closeBtn = document.querySelector('.jobsearch-RightPane-closeButton, [aria-label="Close"]');
          if (closeBtn) closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        } else {
          window.scrollTo({ top: originalScrollY, behavior: 'smooth' });
        }
        
        setTimeout(() => {
          isScanning = false;
          abortScan = false;
          window.updateAutoScanBtnState();
        }, 3000);
      });
      document.body.appendChild(btn);
    };
    window.injectAutoScanBtn();
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
