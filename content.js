'use strict';
(() => {
  function getFreshnessTier(daysAgo, freshDays = 7, oldDays = 30) {
    if (daysAgo <= freshDays) {
      return 'fresh';
    } else if (daysAgo <= oldDays) {
      return 'recent';
    } else {
      return 'old';
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
      const s = document.createElement('script');
      s.src = rt.getURL('scripts/pageHook.js');
      s.onload = () => {
        s.remove();
        hookInjected = true;
      };
      s.onerror = () => {};
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  }
  if (document.head || document.documentElement) {
    injectHook();
  } else {
    document.addEventListener('DOMContentLoaded', injectHook, { once: true });
  }
  window.addEventListener('popstate', () => {
    hookInjected = false;
    injectHook();
  });
  var SELECTORS = {
    jobCardLink: 'a[data-jk]',
    jobListContainer: '#mosaic-provider-jobcards',
    activeLink: 'a[data-jk][aria-pressed="true"]',
  };
  const CACHE_KEY = 'nizViewerCache';
  const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
  const DETAIL_SCAN_VERSION = 4;
  const DETAIL_FETCH_TIMEOUT_MS = 15000;
  const FEED_FETCH_CONCURRENCY = 2;
  const FEED_FETCH_MAX_ATTEMPTS = 3;
  const FEED_FETCH_RETRY_DELAYS_MS = [2000, 10000, 30000];
  let cache = {};
  let badgePrefs = { ...DEFAULT_BADGE_PREFS };
  const expandedJobs = new Set();
  const fetchStates = new Map();
  let revealOldJobs = false;
  const feedView = {
    tech: '',
    setup: '',
    freshness: '',
    experience: '',
    salaryOnly: false,
    sort: 'relevance',
  };

  function announce(message) {
    let region = document.getElementById('nizviewer-live-region');
    if (!region) {
      region = document.createElement('div');
      region.id = 'nizviewer-live-region';
      region.className = 'nizviewer-sr-only';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      document.body.appendChild(region);
    }
    region.textContent = '';
    window.setTimeout(() => {
      region.textContent = message;
    }, 20);
  }

  function extractExperienceFromText(text) {
    const yearNums = [];
    const rangePat = /(\d+(?:\.\d+)?)\s*(?:to|[-–—])\s*(\d+(?:\.\d+)?)\s*(?:year|yr)s?/gi;
    for (const m of text.matchAll(rangePat)) yearNums.push(parseFloat(m[1]), parseFloat(m[2]));
    const orMorePat =
      /(?:at\s+least|minimum\s+of|min)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:or)?\s*more\s*(?:year|yr)s?/gi;
    for (const m of text.matchAll(orMorePat)) {
      const val = parseFloat(m[1] || m[2]);
      if (!isNaN(val)) yearNums.push(val);
    }
    const standalonePat = /(\d+(?:\.\d+)?)\s*(?:\+)?\s*(?:year|yr)s?/gi;
    let exM;
    while ((exM = standalonePat.exec(text)) !== null) {
      const val = parseFloat(exM[1]);
      const st = Math.max(0, exM.index - 60);
      const en = Math.min(text.length, exM.index + 80);
      const ctx = text.substring(st, en).toLowerCase();
      if (
        /\b(?:exp|experience|required|requirements|minimum|min|at\s+least|plus|prefer)\b/.test(ctx)
      )
        yearNums.push(val);
    }
    if (yearNums.length > 0) {
      const valid = Array.from(new Set(yearNums.filter((n) => n >= 0.5 && n <= 25))).sort(
        (a, b) => a - b,
      );
      if (valid.length > 0) {
        const mn = valid[0],
          mx = valid[valid.length - 1];
        return mn === mx ? `${mn}+ yrs` : `${mn}\u2013${mx} yrs`;
      }
    }
    if (/entry[\s-]*level|no\s+exp|fresh\s*grad/i.test(text)) return 'Entry Level';
    return undefined;
  }

  function classifyShift(text) {
    if (!text || text.length < 3) return void 0;
    const t = text.toLowerCase();
    const shiftLabelM = t.match(/\b(?:shift|schedule|working\s+hours)[\s\-:]*([^.,\n]{3,40})/i);
    if (shiftLabelM) {
      const val = shiftLabelM[1].trim();
      if (val.includes('mid') && val.includes('night')) return 'Mid to Night Shift';
      if (
        val.includes('night') ||
        val.includes('graveyard') ||
        val.includes('overnight') ||
        val.includes('us hours')
      )
        return 'Night Shift';
      if (val.includes('day') || val.includes('morning')) return 'Day Shift';
      if (val.includes('evening') || val.includes('afternoon') || val.includes('mid'))
        return 'Mid Shift';
      if (val.includes('rotating') || val.includes('rotation')) return 'Rotating Shift';
    }
    if (/\bmid[\s-]*to[\s-]*night[\s-]*shifts?\b/.test(t) || /\bmid[\s-]*shifts?\b/.test(t))
      return 'Mid to Night Shift';
    if (
      /\bnight[\s-]*shifts?\b/i.test(t) ||
      /\bnight[\s-]*schedules?\b/i.test(t) ||
      /\bnight[\s-]*hours\b/i.test(t) ||
      /\bnight[\s-]*work\b/i.test(t) ||
      /\bgraveyard\b/.test(t) ||
      /\bovernight\b/.test(t) ||
      /\bus[\s-]*hours\b/.test(t)
    )
      return 'Night Shift';
    if (
      /\bday[\s-]*shifts?\b/i.test(t) ||
      /\bday[\s-]*schedules?\b/i.test(t) ||
      /\bmorning[\s-]*shifts?\b/.test(t)
    )
      return 'Day Shift';
    if (
      /\bevening[\s-]*shifts?\b/.test(t) ||
      /\bafternoon[\s-]*shifts?\b/i.test(t) ||
      /\bmid[\s-]*shifts?\b/i.test(t)
    )
      return 'Mid Shift';
    if (/\brotating[\s-]*shifts?\b/.test(t) || /\bshift[\s-]*rotations?\b/.test(t))
      return 'Rotating Shift';
    if (/\bswing[\s-]*shifts?\b/.test(t)) return 'Swing Shift';
    const tm = t.match(
      /(\d{1,2})(?::\d{2})?\s*(am|pm)?\s*(?:to|[-–—])\s*(\d{1,2})(?::\d{2})?\s*(am|pm)?/i,
    );
    if (tm) {
      const hasMeridiem = !!(tm[2] || tm[4]);
      const idx = tm.index || 0;
      const hasContext = /\b(?:hours|schedule|work|between|time|shift|business)\b/i.test(
        t.substring(Math.max(0, idx - 20), idx + 20),
      );
      if (hasMeridiem || hasContext) {
        let sH = parseInt(tm[1], 10),
          eH = parseInt(tm[3], 10);
        const sM = (tm[2] || '').toLowerCase(),
          eM = (tm[4] || '').toLowerCase();

        if (!sM && !eM && sH >= 7 && sH <= 12 && eH <= 8 && eH < sH) {
          eH += 12;
        }

        if (sM === 'pm' && sH < 12) sH += 12;
        if (sM === 'am' && sH === 12) sH = 0;
        if (eM === 'pm' && eH < 12) eH += 12;
        if (eM === 'am' && eH === 12) eH = 0;

        if (sH >= 18 || sH <= 4 || (eH >= 0 && eH <= 6 && sH > eH)) return 'Night Shift';
        if (sH >= 6 && sH <= 10 && eH >= 14 && eH <= 19) return 'Day Shift';
        if (sH >= 12 && sH <= 16) return 'Mid Shift';
      }
    }
    if (/\bmidnight\b/.test(t) || /\bnocturnal\b/.test(t)) return 'Night Shift';
    if (/aligned\s+with\s+(?:us|u\.s\.|american|est|pst|cst|mst)\s+(?:business\s+)?hours/i.test(t))
      return 'Night Shift';
    return void 0;
  }

  function parseDetailHtml(html) {
    const rawText = html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#\d]+;/gi, ' ');
    const text = rawText.replace(/\s+/g, ' ');
    const shift = classifyShift(text);
    let workSetup;
    if (
      /\b(?:permanent[\s-]+remote|remote|wfh|work[\s-]+from[\s-]+home|home[\s-]*based|remotely|virtual)\b/i.test(
        text,
      )
    ) {
      workSetup = 'Remote';
    } else if (/\b(?:hybrid|hyrbid|mixed|work[\s-]+from[\s-]+office)\b/i.test(text)) {
      workSetup = 'Hybrid';
    }
    if (!workSetup) {
      const setupLabelM = text.match(
        /(?:Location|Set[\s-]?up|Arrangement|Work\s+Setup|Type|Working\s+Arrangement|Basis|Environment)[\s\-:]*([^.,\n]{3,40})/i,
      );
      if (setupLabelM) {
        const v = setupLabelM[1].toLowerCase();
        if (
          v.includes('onsite') ||
          v.includes('on-site') ||
          v.includes('office') ||
          v.includes('person') ||
          v.includes('in-person')
        )
          workSetup = 'Onsite';
      }
    }
    if (!workSetup) {
      if (/\b(?:on[\s-]?site|in[\s-]*office|in[\s-]*person|onsite|on[\s-]*site)\b/i.test(text))
        workSetup = 'Onsite';
    }
    if (!workSetup && /\bno\s+remote\b/i.test(text)) workSetup = 'Onsite';
    let experience = extractExperienceFromText(text);

    if (!experience && /entry[\s-]*level|no\s+experience|fresh\s*grad/i.test(text)) {
      experience = 'Entry Level';
    }

    let jobType;
    if (/\b(?:full[\s-]*time|ft)\b/i.test(text)) jobType = 'Full-time';
    else if (/\b(?:part[\s-]*time|pt)\b/i.test(text)) jobType = 'Part-time';
    else if (/\b(?:contract|contractor|c2c|1099)\b/i.test(text)) jobType = 'Contract';
    else if (/\b(?:freelance|freelancer)\b/i.test(text)) jobType = 'Freelance';
    else if (/\bintern(?:ship)?\b/i.test(text)) jobType = 'Internship';

    let salary;
    const salaryRegex =
      /(?:Rs|\$|£|€)\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:k|K)?(?:\s*(?:-|to)\s*(?:Rs|\$|£|€)?\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:k|K)?)?(?:\s*USD|\s*CAD|\s*EUR|\s*GBP)?\s*(?:a year|per year|annually|a month|per month|monthly|an hour|per hour|\/hr|\/yr|\/mo)/i;
    const salaryMatch = text.match(salaryRegex);
    if (salaryMatch) {
      salary = salaryMatch[0].trim();
    }

    let degree;
    if (/\b(?:phd|doctorate|ph\.d)\b/i.test(text)) degree = 'PhD';
    else if (/\b(?:master'?s?|ms|m\.s\.|mba|m\.b\.a\.)\b/i.test(text)) degree = "Master's";
    else if (/\b(?:bachelor'?s?|bs|b\.s\.|ba|b\.a\.|b\.sc|beng)\b/i.test(text))
      degree = "Bachelor's";
    else if (/\b(?:associate'?s?|aa|a\.a\.|as|a\.s\.)\b/i.test(text)) degree = "Associate's";
    else if (/\b(?:diploma|high school|ged)\b/i.test(text)) degree = 'Diploma';

    let techStack;
    const foundTechs = new Set();
    const regexList = getCompiledTechRegexes();
    for (const { tech, regex } of regexList) {
      if (regex.test(text)) {
        if (tech === 'C' && /(?:^|\W)C-(?:level|suite)/i.test(text)) continue;
        if (tech === 'R' && /(?:^|\W)R&D(?:$|\W)/i.test(text)) continue;
        foundTechs.add(tech);
      }
    }
    if (foundTechs.size > 0) {
      techStack = Array.from(foundTechs).join(', ');
    }

    let benefits;
    if (/\b(?:eobi|provident fund|gratuity|pf)\b/i.test(text)) benefits = 'EOBI / PF';

    let perks;
    if (/\b(?:pick and drop|transport allowance|fuel allowance|mobile allowance)\b/i.test(text))
      perks = 'Allowances';

    let ageLimit;
    const ageMatch = text.match(/(?:max|maximum)\s*age(?: limit)?\s*(?:is)?\s*(\d{2})/i);
    if (ageMatch) ageLimit = `Max Age: ${ageMatch[1]}`;

    let gender;
    if (/\b(?:females? encouraged|female staff)\b/i.test(text)) gender = 'Females Encouraged';
    else if (/\bmales? only\b/i.test(text)) gender = 'Males Only';
    else if (/\bfemales? only\b/i.test(text)) gender = 'Females Only';

    const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
    let applicationContext = '';
    let applyEmail;
    for (const match of Array.from(text.matchAll(emailPattern)).reverse()) {
      const context = text.slice(Math.max(0, match.index - 260), match.index + 420);
      if (/(?:apply|application|send|submit|resume|cv|subject|interested candidates)/i.test(context)) {
        applyEmail = match[0].toLowerCase();
        applicationContext = context;
        break;
      }
    }
    let applyPhone;
    const phonePattern = /(?<!\d)(?:\+?\d[\d\s().-]{7,}\d)(?!\d)/g;
    for (const match of Array.from(text.matchAll(phonePattern)).reverse()) {
      const candidate = match[0].trim();
      const digits = candidate.replace(/\D/g, '');
      const context = text.slice(Math.max(0, match.index - 220), match.index + 220);
      if (
        digits.length >= 8 &&
        digits.length <= 15 &&
        !/(?:salary|pay\s*:|per\s+(?:month|year)|commission|target)/i.test(context) &&
        /(?:apply|call|contact|phone|whatsapp|reach|send)/i.test(context)
      ) {
        applyPhone = candidate;
        break;
      }
    }
    const subjectMatch = applicationContext.match(
      /subject(?:\s+(?:header|line))?\s*[:=-]\s*["“']?([A-Z0-9][A-Z0-9 ,_+./&()-]{4,120}?)["”']?(?=\.|\s*$)/i,
    );
    const applySubject = subjectMatch?.[1]?.trim().replace(/\s+/g, ' ');

    return {
      shift,
      experience,
      workSetup,
      jobType,
      degree,
      techStack,
      salary,
      benefits,
      perks,
      ageLimit,
      gender,
      applyEmail,
      applySubject,
      applyPhone,
    };
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
      const localRes = await storage.local.get([CACHE_KEY, 'extensionEnabled', 'badgePrefs']);
      if (localRes?.[CACHE_KEY]) cache = localRes[CACHE_KEY];
      if (typeof localRes?.extensionEnabled === 'boolean')
        extensionEnabled = localRes.extensionEnabled;
      if (localRes?.badgePrefs) badgePrefs = { ...badgePrefs, ...localRes.badgePrefs };
    } catch {}
  }
  let compiledTechRegexes = null;
  function getCompiledTechRegexes() {
    if (!compiledTechRegexes) {
      const list = typeof TECH_KEYWORDS !== 'undefined' ? TECH_KEYWORDS : [];
      compiledTechRegexes = list
        .map((tech) => {
          if (tech.length === 1 && tech !== 'C' && tech !== 'R') return null;
          const escapedTech = tech.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const isCaseSensitive =
            tech.length <= 2 || ['Go', 'Dart', 'Chef', 'Puppet', 'Make'].includes(tech);
          const flags = isCaseSensitive ? '' : 'i';
          return { tech, regex: new RegExp(`(?:^|\\W)${escapedTech}(?:$|\\W)`, flags) };
        })
        .filter(Boolean);
    }
    return compiledTechRegexes;
  }

  let saveDebounceTimer = null;
  async function saveData() {
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(async () => {
      try {
        const localRes = await storage.local.get([CACHE_KEY]);
        if (localRes?.[CACHE_KEY]) {
          cache = { ...localRes[CACHE_KEY], ...cache };
        }
        await storage.local.set({ [CACHE_KEY]: cache });
      } catch (err) {
        console.error(`[NizViewer Storage] Error saving cache:`, err);
        announce('Job details are available for this session but could not be saved.');
      }
    }, 200);
  }

  let lastPruneTime = 0;
  function pruneCache() {
    const now = Date.now();
    if (now - lastPruneTime < 60000) return;
    lastPruneTime = now;

    let changed = false;
    for (const [jk, entry] of Object.entries(cache)) {
      if (!entry || typeof entry.savedAt !== 'number') {
        delete cache[jk];
        changed = true;
        continue;
      }
      if (now - entry.savedAt > CACHE_TTL_MS) {
        delete cache[jk];
        changed = true;
      }
    }
    if (changed) {
      storage.local.set({ [CACHE_KEY]: cache }).catch(() => {});
    }
  }
  function getActiveJk() {
    const url = new URL(location.href);
    const urlJk = url.searchParams.get('vjk') || url.searchParams.get('jk');
    if (isJobKey(urlJk)) return urlJk;
    const active = document.querySelector(SELECTORS.activeLink);
    return active?.getAttribute('data-jk') || null;
  }
  function isJobKey(jk) {
    return typeof jk === 'string' && /^[a-f0-9]{16}$/i.test(jk);
  }
  function escapeJk(jk) {
    if (!jk) return '';
    return typeof window !== 'undefined' && window.CSS?.escape ? window.CSS.escape(jk) : jk;
  }
  function ensureBadgeWrapper(jk) {
    const link = document.querySelector(`${SELECTORS.jobCardLink}[data-jk="${escapeJk(jk)}"]`);
    if (!link) {
      if (getActiveJk() !== jk) return null;
      const description =
        document.querySelector('#jobDescriptionText') ||
        document.querySelector('[data-testid="job-description"]') ||
        document.querySelector('[class*="jobDescription"]');
      const parent = description?.parentNode;
      if (!parent) return null;

      let wrapper = document.querySelector(
        `.badge-wrapper[data-detail-wrapper="true"][data-jk="${escapeJk(jk)}"]`,
      );
      if (wrapper) {
        if (wrapper.parentNode !== parent || wrapper.nextSibling !== description) {
          parent.insertBefore(wrapper, description);
        }
        return wrapper;
      }

      wrapper = document.createElement('div');
      wrapper.className = 'badge-wrapper nizviewer-detail-badge-wrapper';
      wrapper.setAttribute('data-jk', jk);
      wrapper.setAttribute('data-detail-wrapper', 'true');
      parent.insertBefore(wrapper, description);
      return wrapper;
    }
    const card = link.closest(
      '.cardOutline, [class*="cardOutline"], .tapItem, [data-testid="jobListing"], [class*="job_seen_beacon"], li',
    );
    const title = link.closest('.jobTitle, [data-testid="jobTitle"]') || link;
    const identityNodes = [
      title,
      card?.querySelector('[data-testid="company-name"], .companyName, [class*="companyName"]'),
      card?.querySelector('[data-testid="text-location"], .companyLocation, [class*="companyLocation"]'),
    ].filter((node) => node && card?.contains(node));
    let insertionAnchor = identityNodes[0] || title;
    for (const node of identityNodes.slice(1)) {
      if (insertionAnchor.compareDocumentPosition(node) & 4) {
        insertionAnchor = node;
      }
    }
    const parent = insertionAnchor.parentNode;
    if (!parent) return null;

    const allWrappers = parent.querySelectorAll('.badge-wrapper');
    allWrappers.forEach((el) => {
      if (el.getAttribute('data-jk') !== jk) {
        el.remove();
      }
    });

    let wrapper = parent.querySelector(`.badge-wrapper[data-jk="${jk}"]`);
    if (wrapper) {
      if (wrapper.parentNode !== parent || wrapper.previousSibling !== insertionAnchor) {
        parent.insertBefore(wrapper, insertionAnchor.nextSibling);
      }
      return wrapper;
    }

    wrapper = document.createElement('div');
    wrapper.className = 'badge-wrapper';
    wrapper.setAttribute('data-jk', jk);
    parent.insertBefore(wrapper, insertionAnchor.nextSibling);
    return wrapper;
  }
  function getShiftClass(shift) {
    if (/night|graveyard|overnight/i.test(shift)) return 'badge-shift-night';
    if (/mid/i.test(shift)) return 'badge-shift-mid';
    if (/rotating/i.test(shift)) return 'badge-shift-rotating';
    if (/swing/i.test(shift)) return 'badge-shift-swing';
    return 'badge-shift-day';
  }
  function getSetupClass(setup) {
    return `badge-setup-${(setup || '').toLowerCase()}`;
  }

  function inlineIconEl(name, cls, alt) {
    const img = document.createElement('img');
    if (typeof ICONS !== 'undefined' && ICONS[name]) img.src = ICONS[name];
    img.alt = alt || '';
    img.className = cls || 'nizviewer-btn-icon';
    return img;
  }

  function getJobRecord(jk) {
    const entry = cache[jk] || {};
    const link = document.querySelector(`${SELECTORS.jobCardLink}[data-jk="${escapeJk(jk)}"]`);
    const card =
      link?.closest('.cardOutline, [class*="cardOutline"], .tapItem, [data-testid="jobListing"]') ||
      link?.closest('[class*="job_seen_beacon"], li');

    let role =
      link?.querySelector('span[id^="jobTitle"], [data-testid="jobTitle"]')?.textContent ||
      link?.textContent ||
      link?.getAttribute('aria-label')?.replace(/^full details of\s+/i, '') ||
      '';
    role = role.replace(/[\t\r\n]+/g, ' ').trim();

    let company =
      entry.companyName ||
      card?.querySelector('[data-testid="company-name"], .companyName, [class*="companyName"]')
        ?.textContent ||
      '';
    company = company.replace(/[\t\r\n]+/g, ' ').trim();

    let locationText =
      entry.companyLocation ||
      card?.querySelector(
        '[data-testid="text-location"], .companyLocation, [class*="companyLocation"]',
      )?.textContent ||
      '';
    locationText = locationText.replace(/[\t\r\n]+/g, ' ').trim();

    let dateText = '';
    if (entry.datePostedIso) {
      const d = new Date(entry.datePostedIso);
      if (!isNaN(d.getTime())) {
        dateText = d.toISOString().split('T')[0];
      }
    }
    if (!dateText) {
      const dateEl = card?.querySelector(
        '.nizviewer-info-row.badge-fresh .nizviewer-info-value, .nizviewer-info-row.badge-recent .nizviewer-info-value, .nizviewer-info-row.badge-old .nizviewer-info-value, [data-testid="myJobsStateDate"], .date',
      );
      if (dateEl) {
        dateText = dateEl.textContent.replace(/[\t\r\n]+/g, ' ').trim();
      }
    }

    const workSetup = (entry.workSetup || '').replace(/[\t\r\n]+/g, ' ').trim();
    const jobType = (entry.jobType || '').replace(/[\t\r\n]+/g, ' ').trim();
    const degree = (entry.degree || '').replace(/[\t\r\n]+/g, ' ').trim();
    const jobLink = `${location.origin}/viewjob?jk=${encodeURIComponent(jk)}`;
    const salary = (entry.salary || '').replace(/[\t\r\n]+/g, ' ').trim();
    const experience = (entry.experience || '').replace(/[\t\r\n]+/g, ' ').trim();

    return {
      role,
      company,
      location: locationText,
      posted: dateText,
      workSetup,
      jobType,
      degree,
      link: jobLink,
      salary,
      experience,
      shift: (entry.shift || '').replace(/[\t\r\n]+/g, ' ').trim(),
      techStack: (entry.techStack || '').replace(/[\t\r\n]+/g, ' ').trim(),
      benefits: (entry.benefits || '').replace(/[\t\r\n]+/g, ' ').trim(),
      perks: (entry.perks || '').replace(/[\t\r\n]+/g, ' ').trim(),
      applyEmail: (entry.applyEmail || '').replace(/[\t\r\n]+/g, ' ').trim(),
      applySubject: (entry.applySubject || '').replace(/[\t\r\n]+/g, ' ').trim(),
      applyPhone: (entry.applyPhone || '').replace(/[\t\r\n]+/g, ' ').trim(),
    };
  }

  function getExportColumns() {
    const columns = [
      ['Role', 'role', true],
      ['Company', 'company', true],
      ['Location', 'location', true],
      ['Posted', 'posted', badgePrefs.datePosted],
      ['Work Setup', 'workSetup', badgePrefs.workSetup],
      ['Job Type', 'jobType', badgePrefs.jobType],
      ['Degree', 'degree', badgePrefs.degree],
      ['Link', 'link', true],
      ['Salary', 'salary', badgePrefs.salary],
      ['Experience', 'experience', badgePrefs.experience],
      ['Shift', 'shift', badgePrefs.shift],
      ['Tech Stack', 'techStack', badgePrefs.techStack],
      ['Benefits', 'benefits', badgePrefs.benefits],
      ['Perks', 'perks', badgePrefs.perks],
      ['Apply email', 'applyEmail', true],
      ['Email subject', 'applySubject', true],
      ['Apply phone', 'applyPhone', true],
    ];
    return columns.filter((column) => column[2]);
  }

  function getJobDataForClipboard(jk) {
    const record = getJobRecord(jk);
    return getExportColumns()
      .map((column) => record[column[1]] || '')
      .join('\t');
  }

  async function copyJobData(jk, btn) {
    const rowData = getJobDataForClipboard(jk);
    let success = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(rowData);
        success = true;
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = rowData;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
        success = true;
      }
    } catch (err) {
      console.error('[NizViewer] Failed to copy to clipboard:', err);
    }

    if (success) announce('Job details copied to the clipboard.');
    else announce('Could not copy job details. Try again.');

    if (success && btn) {
      btn.classList.add('nizviewer-copied');
      btn.textContent = '';
      btn.appendChild(inlineIconEl('check', 'nizviewer-btn-icon', 'Copied'));
      btn.title = 'Copied to clipboard!';
      setTimeout(() => {
        btn.classList.remove('nizviewer-copied');
        btn.textContent = '';
        btn.appendChild(inlineIconEl('copy', 'nizviewer-btn-icon', 'Copy'));
        btn.title = 'Copy job details for Google Sheets';
      }, 1500);
    }
  }

  function setBtnIcon(btn, iconName, alt) {
    btn.textContent = '';
    if (iconName && typeof ICONS !== 'undefined' && ICONS[iconName]) {
      btn.appendChild(inlineIconEl(iconName, 'nizviewer-btn-icon', alt || ''));
    }
  }

  function getDaysAgo(entry) {
    const timestamp = new Date(entry?.datePostedIso || '').getTime();
    if (!Number.isFinite(timestamp)) return null;
    return Math.max(0, Math.floor((Date.now() - timestamp) / 864e5));
  }

  function getNumericPref(value, fallback, minimum) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, number) : fallback;
  }

  function getFetchStatus(jk, entry) {
    const current = fetchStates.get(jk);
    if (current === 'queued') return { state: 'queued', label: 'Waiting to fetch' };
    if (current === 'loading') return { state: 'loading', label: 'Fetching full details' };
    if (current === 'failed') return { state: 'failed', label: 'Fetch failed' };
    if (hasCurrentDetails(entry)) return { state: 'complete', label: 'Full details' };
    if (entry) return { state: 'partial', label: 'Partial details' };
    return { state: 'queued', label: 'Waiting to fetch' };
  }

  function getVisibleTechs(entry) {
    if (!entry?.techStack || !badgePrefs.techStack) return [];
    const hidden = badgePrefs.hiddenTechCategories || {};
    return entry.techStack.split(', ').filter((tech) => {
      if (!tech) return false;
      const category =
        typeof TECH_CATEGORY_MAP !== 'undefined'
          ? TECH_CATEGORY_MAP[tech.toLowerCase()] || 'Other'
          : 'Other';
      return hidden[category] !== true;
    });
  }

  function makeInfoRow(label, value, cls, primary, title) {
    return { label, value, cls, primary: !!primary, title };
  }

  function addStatusRetry(jk, statusBar) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'nizviewer-text-action';
    retry.textContent = 'Retry';
    retry.setAttribute('aria-label', 'Retry loading full job details');
    retry.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      retry.disabled = true;
      fetchStates.set(jk, 'loading');
      renderBadges(jk);
      const success = await fetchJobDetailsDirectly(jk);
      if (success) fetchStates.delete(jk);
      else fetchStates.set(jk, 'failed');
      renderBadges(jk);
      updateFeedSummary();
      announce(success ? 'Full job details loaded.' : 'Full job details could not be loaded.');
    });
    statusBar.appendChild(retry);
  }

  function renderBadges(jk) {
    const entry = cache[jk];
    const link = document.querySelector(`${SELECTORS.jobCardLink}[data-jk="${escapeJk(jk)}"]`);
    const jobCard =
      link?.closest('.cardOutline, [class*="cardOutline"], .tapItem, [data-testid="jobListing"]') ||
      link?.closest('[class*="job_seen_beacon"], li');
    const jobItem = link?.closest('li, [data-testid="jobListing"]') || jobCard;

    if (jobCard || jobItem) {
      const daysAgo = getDaysAgo(entry);
      const freshDays = getNumericPref(badgePrefs.freshJobDays, 7, 0);
      const oldDays = Math.max(freshDays + 1, getNumericPref(badgePrefs.oldJobDays, 30, 1));
      const isFresh = extensionEnabled && daysAgo !== null && daysAgo <= freshDays;
      const isOldHidden =
        extensionEnabled &&
        badgePrefs.hideOldJobs === true &&
        !revealOldJobs &&
        daysAgo !== null &&
        daysAgo > oldDays;
      jobCard?.classList.toggle('nizviewer-card-fresh', isFresh);
      jobItem?.classList.toggle('nizviewer-card-hidden-old', isOldHidden);
      if (jobCard && jobCard !== jobItem) {
        jobCard.classList.toggle('nizviewer-card-hidden-old', isOldHidden);
      }
    }

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
      ae: entry?.applyEmail,
      as: entry?.applySubject,
      ap: entry?.applyPhone,
      be: entry?.benefits,
      pe: entry?.perks,
      ag: entry?.ageLimit,
      ge: entry?.gender,
      f: fetchStates.get(jk),
      x: expandedJobs.has(jk),
      p: badgePrefs,
    });
    if (wrapper.getAttribute('data-rendered-hash') === stateHash) return;
    wrapper.setAttribute('data-rendered-hash', stateHash);
    isApplyingChanges = true;
    try {
      wrapper.replaceChildren();
      if (!extensionEnabled) return;
      wrapper.className = `badge-wrapper${wrapper.dataset.detailWrapper === 'true' ? ' nizviewer-detail-badge-wrapper' : ''} nizviewer-theme-${badgePrefs.theme || 'light'} nizviewer-density-${badgePrefs.density || 'detailed'}`;

      const fetchStatus = getFetchStatus(jk, entry);
      const statusBar = document.createElement('div');
      statusBar.className = `nizviewer-status nizviewer-status-${fetchStatus.state}`;
      statusBar.setAttribute('aria-label', fetchStatus.label);
      const statusDot = document.createElement('span');
      statusDot.className = 'nizviewer-status-dot';
      statusDot.setAttribute('aria-hidden', 'true');
      statusBar.appendChild(statusDot);
      const statusText = document.createElement('span');
      statusText.textContent = fetchStatus.label;
      statusBar.appendChild(statusText);
      if (fetchStatus.state === 'failed') addStatusRetry(jk, statusBar);
      wrapper.appendChild(statusBar);

      if (!entry) return;

      const infoRows = [];
      if (entry.datePostedIso && badgePrefs.datePosted) {
        const date = new Date(entry.datePostedIso);
        const daysAgo = getDaysAgo(entry);
        const formattedDate = new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
        }).format(date);
        infoRows.push(
          makeInfoRow(
            'Posted',
            `${formattedDate} (${daysAgo === 0 ? 'Today' : `${daysAgo}d ago`})`,
            `badge-${getFreshnessTier(
              daysAgo,
              getNumericPref(badgePrefs.freshJobDays, 7, 0),
              getNumericPref(badgePrefs.oldJobDays, 30, 1),
            )}`,
            true,
            `Originally posted on ${date.toDateString()}`,
          ),
        );
      }
      if (entry.salary && badgePrefs.salary) {
        infoRows.push(makeInfoRow('Salary', entry.salary, 'badge-salary', true));
      }
      if (entry.shift && badgePrefs.shift) {
        infoRows.push(makeInfoRow('Shift', entry.shift, getShiftClass(entry.shift), false));
      }
      if (entry.workSetup && badgePrefs.workSetup) {
        infoRows.push(
          makeInfoRow('Work Setup', entry.workSetup, getSetupClass(entry.workSetup), true),
        );
      }
      if (entry.experience && badgePrefs.experience) {
        infoRows.push(makeInfoRow('Experience', entry.experience, 'badge-experience', true));
      }
      if (entry.jobType && badgePrefs.jobType) {
        infoRows.push(makeInfoRow('Job Type', entry.jobType, 'badge-jobtype', false));
      }
      if (entry.degree && badgePrefs.degree) {
        infoRows.push(makeInfoRow('Degree', entry.degree, 'badge-degree', false));
      }
      if (entry.benefits && badgePrefs.benefits) {
        infoRows.push(
          makeInfoRow(
            'Benefits',
            entry.benefits,
            'badge-benefits',
            false,
            'Retirement and statutory benefits',
          ),
        );
      }
      if (entry.perks && badgePrefs.perks) {
        infoRows.push(
          makeInfoRow('Perks', entry.perks, 'badge-perks', false, 'Allowances and perks'),
        );
      }
      if (entry.ageLimit && badgePrefs.ageLimit) {
        infoRows.push(makeInfoRow('Age Limit', entry.ageLimit, 'badge-age', false));
      }
      if (entry.gender && badgePrefs.gender) {
        infoRows.push(makeInfoRow('Gender', entry.gender, 'badge-gender', false));
      }

      const techs = getVisibleTechs(entry);
      const expanded = expandedJobs.has(jk) || badgePrefs.density === 'detailed';
      const visibleRows = expanded ? infoRows : infoRows.filter((row) => row.primary).slice(0, 4);

      if (infoRows.length || techs.length || expanded) {
        const card = document.createElement('div');
        card.className = 'nizviewer-tech-stack-card';

        const rowsEl = document.createElement('div');
        rowsEl.className = 'nizviewer-tech-stack-rows';

        for (const row of visibleRows) {
          const r = document.createElement('div');
          r.className = `nizviewer-info-row ${row.cls}`;
          if (row.title) r.title = row.title;

          const labelEl = document.createElement('span');
          labelEl.className = 'nizviewer-info-label';
          labelEl.textContent = row.label;
          r.appendChild(labelEl);

          const valueEl = document.createElement('span');
          valueEl.className = 'nizviewer-info-value';
          valueEl.textContent = row.value;
          r.appendChild(valueEl);

          rowsEl.appendChild(r);
        }

        if (techs.length) {
          const grouped = new Map();
          for (const tech of techs) {
            const label =
              typeof TECH_CATEGORY_MAP !== 'undefined'
                ? TECH_CATEGORY_MAP[tech.toLowerCase()] || 'Other'
                : 'Other';
            if (!grouped.has(label)) grouped.set(label, []);
            grouped.get(label).push(tech);
          }

          const groups = Array.from(grouped.entries());
          const visibleGroups = expanded ? groups : groups.slice(0, 1);
          for (const [label, originalList] of visibleGroups) {
            const list = expanded ? originalList : originalList.slice(0, 5);
            const row = document.createElement('div');
            row.className = 'nizviewer-tech-stack-row';

            const cat = document.createElement('div');
            cat.className = 'nizviewer-tech-stack-cat';
            cat.textContent = label;
            row.appendChild(cat);

            const pillsEl = document.createElement('div');
            pillsEl.className = 'nizviewer-tech-stack-pills';

            for (const tech of list) {
              const pill = document.createElement('span');
              pill.className = 'nizviewer-tech-pill';
              pill.textContent = tech;
              pill.title = 'Mentioned in the job description';
              pillsEl.appendChild(pill);
            }

            row.appendChild(pillsEl);
            rowsEl.appendChild(row);
          }
        }

        card.appendChild(rowsEl);
        if (expanded) {
          const candidates = [
            ['Posting date', 'datePosted', 'datePostedIso'],
            ['Salary', 'salary', 'salary'],
            ['Shift', 'shift', 'shift'],
            ['Work setup', 'workSetup', 'workSetup'],
            ['Experience', 'experience', 'experience'],
            ['Job type', 'jobType', 'jobType'],
            ['Degree', 'degree', 'degree'],
            ['Benefits', 'benefits', 'benefits'],
            ['Perks', 'perks', 'perks'],
            ['Age limit', 'ageLimit', 'ageLimit'],
            ['Gender', 'gender', 'gender'],
          ];
          const missing = candidates
            .filter((candidate) => badgePrefs[candidate[1]] !== false && !entry[candidate[2]])
            .map((candidate) => candidate[0]);
          if (badgePrefs.techStack !== false && !entry.techStack) missing.push('Technology stack');
          if (missing.length) {
            const unavailable = document.createElement('p');
            unavailable.className = 'nizviewer-unavailable-note';
            unavailable.textContent = `Not detected: ${missing.join(', ')}.`;
            card.appendChild(unavailable);
          }
          if (entry.applyEmail) {
            const apply = document.createElement('a');
            apply.className = 'nizviewer-apply-email';
            const params = entry.applySubject
              ? `?subject=${encodeURIComponent(entry.applySubject)}`
              : '';
            apply.href = `mailto:${entry.applyEmail}${params}`;
            apply.textContent = `Apply by email: ${entry.applyEmail}`;
            apply.addEventListener('click', (ev) => ev.stopPropagation());
            apply.title = entry.applySubject
              ? `Open an email addressed to ${entry.applyEmail} with subject “${entry.applySubject}”`
              : `Open an email addressed to ${entry.applyEmail}`;
            apply.setAttribute('aria-label', apply.title);
            card.appendChild(apply);
            if (entry.applySubject) {
              const subject = document.createElement('p');
              subject.className = 'nizviewer-apply-subject';
              subject.textContent = `Subject: ${entry.applySubject}`;
              card.appendChild(subject);
            }
          }
          if (entry.applyPhone) {
            const phone = document.createElement('a');
            phone.className = 'nizviewer-apply-phone';
            phone.href = `tel:${entry.applyPhone.replace(/[^+\d]/g, '')}`;
            phone.textContent = `Apply by phone: ${entry.applyPhone}`;
            phone.title = `Call ${entry.applyPhone} about this job`;
            phone.setAttribute('aria-label', phone.title);
            phone.addEventListener('click', (ev) => ev.stopPropagation());
            card.appendChild(phone);
          }
          const source = document.createElement('p');
          source.className = 'nizviewer-source-note';
          source.textContent =
            'Detected from the full job description. Verify details before applying.';
          card.appendChild(source);
        }
        wrapper.appendChild(card);
      }

      const link = document.querySelector(`${SELECTORS.jobCardLink}[data-jk="${escapeJk(jk)}"]`);
      const cardContainer = link?.closest(
        'li, [data-testid="jobListing"], [class*="job_seen_beacon"]',
      );
      if (cardContainer || wrapper.dataset.detailWrapper === 'true') {
        const directLegacyBtn = cardContainer?.querySelector(
          `:scope > .nizviewer-card-action[data-jk="${escapeJk(jk)}"]`,
        );
        if (directLegacyBtn) directLegacyBtn.remove();

        let actionsContainer = wrapper.querySelector(
          `.nizviewer-card-actions[data-jk="${escapeJk(jk)}"]`,
        );
        if (!actionsContainer) {
          actionsContainer = document.createElement('div');
          actionsContainer.className = 'nizviewer-card-actions';
          actionsContainer.setAttribute('data-jk', jk);
          wrapper.appendChild(actionsContainer);
        }

        const existingExpandBtn = actionsContainer.querySelector('.nizviewer-expand-btn');
        if (badgePrefs.density === 'detailed') {
          existingExpandBtn?.remove();
        } else {
          const expandBtn = existingExpandBtn || document.createElement('button');
          expandBtn.type = 'button';
          expandBtn.className = 'nizviewer-text-action nizviewer-expand-btn';
          expandBtn.setAttribute('aria-expanded', String(expanded));
          expandBtn.textContent = expanded ? 'Show less' : 'Show details';
          if (!existingExpandBtn) {
            expandBtn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              ev.preventDefault();
              if (expandedJobs.has(jk)) expandedJobs.delete(jk);
              else expandedJobs.add(jk);
              wrapper.removeAttribute('data-rendered-hash');
              renderBadges(jk);
            });
            actionsContainer.appendChild(expandBtn);
          }
        }

        let copyBtn = actionsContainer.querySelector(
          `.nizviewer-copy-btn[data-jk="${escapeJk(jk)}"]`,
        );
        if (!copyBtn) {
          copyBtn = document.createElement('button');
          copyBtn.type = 'button';
          copyBtn.className = 'nizviewer-card-action nizviewer-copy-btn';
          copyBtn.setAttribute('data-jk', jk);
          copyBtn.title = 'Copy job details for Google Sheets';
          copyBtn.setAttribute('aria-label', 'Copy this job’s visible fields');
          copyBtn.appendChild(inlineIconEl('copy', 'nizviewer-btn-icon', 'Copy'));
          actionsContainer.appendChild(copyBtn);
        }

        if (!copyBtn.__nizBound) {
          copyBtn.__nizBound = true;
          copyBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            ev.preventDefault();
            copyJobData(jk, copyBtn);
          });
        }

        let cardBtn = actionsContainer.querySelector(
          `.nizviewer-card-action.badge-fetch-btn[data-jk="${escapeJk(jk)}"], .nizviewer-card-action.badge-refetch-btn[data-jk="${escapeJk(jk)}"]`,
        );
        if (!cardBtn) {
          cardBtn = document.createElement('button');
          cardBtn.type = 'button';
          cardBtn.setAttribute('data-jk', jk);
          actionsContainer.appendChild(cardBtn);
        }

        if (!entry?.deepScanned) {
          cardBtn.className = 'nizviewer-card-action badge-fetch-btn';
          setBtnIcon(cardBtn, 'bolt', 'Fetch');
          cardBtn.title =
            'Full job details have not been fetched yet. Click to fetch full details & tech stack';
        } else {
          cardBtn.className = 'nizviewer-card-action badge-refetch-btn';
          setBtnIcon(cardBtn, 'rotate', 'Refetch');
          cardBtn.title = 'Job details fetched. Click to re-fetch latest details';
        }

        cardBtn.setAttribute(
          'aria-label',
          entry?.deepScanned ? 'Refresh full job details' : 'Fetch full job details',
        );
        cardBtn.hidden = fetchStatus.state === 'failed';

        if (!cardBtn.__nizBound) {
          cardBtn.__nizBound = true;
          cardBtn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            ev.preventDefault();
            cardBtn.disabled = true;
            setBtnIcon(cardBtn, 'hourglass', 'Fetching...');
            cardBtn.title = 'Fetching full job details...';
            fetchStates.set(jk, 'loading');
            wrapper.removeAttribute('data-rendered-hash');
            renderBadges(jk);
            const success = await fetchJobDetailsDirectly(jk);
            if (success) {
              fetchStates.delete(jk);
              announce('Full job details loaded.');
              cardBtn.classList.add('badge-fetch-success');
              setBtnIcon(cardBtn, 'check', 'Fetched');
              cardBtn.title = 'Job details fetched successfully!';
              setTimeout(() => {
                cardBtn.disabled = false;
                cardBtn.classList.remove('badge-fetch-success');
                cardBtn.className = 'nizviewer-card-action badge-refetch-btn';
                setBtnIcon(cardBtn, 'rotate', 'Refetch');
                cardBtn.title = 'Job details fetched. Click to re-fetch latest details';
              }, 1500);
            } else {
              fetchStates.set(jk, 'failed');
              announce('Full job details could not be loaded. Retry is available.');
              cardBtn.classList.add('badge-fetch-failed');
              setBtnIcon(cardBtn, 'cross', 'Failed');
              cardBtn.title = 'Failed to fetch job details. Click to try again.';
              setTimeout(() => {
                cardBtn.disabled = false;
                cardBtn.classList.remove('badge-fetch-failed');
                const hasFullDetails = cache[jk]?.deepScanned;
                cardBtn.className = hasFullDetails
                  ? 'nizviewer-card-action badge-refetch-btn'
                  : 'nizviewer-card-action badge-fetch-btn';
                setBtnIcon(cardBtn, hasFullDetails ? 'rotate' : 'bolt', 'Fetch');
                cardBtn.title = hasFullDetails
                  ? 'Job details fetched. Click to re-fetch latest details'
                  : 'Full job details have not been fetched yet. Click to fetch full details & tech stack';
              }, 2000);
            }
            wrapper.removeAttribute('data-rendered-hash');
            renderBadges(jk);
            updateFeedSummary();
          });
        }

      }
    } finally {
      setTimeout(() => {
        isApplyingChanges = false;
      }, 50);
    }
  }

  const directDetailFetches = new Map();
  function extractDetailTextFromHtml(html) {
    const doc = new window.DOMParser().parseFromString(html, 'text/html');
    const description =
      doc.querySelector('#jobDescriptionText') ||
      doc.querySelector('[data-testid="job-description"]') ||
      doc.querySelector('[class*="jobDescription"]');
    const descriptionText = description?.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (descriptionText.length < 30) return null;

    const header = doc.querySelector(
      '[data-testid="jobsearch-JobInfoHeader"], .jobsearch-JobInfoHeader-container, h1',
    );
    const headerText = header?.textContent?.replace(/\s+/g, ' ').trim() || '';
    return `${headerText} ${descriptionText}`.trim();
  }

  async function performJobDetailsFetch(jk) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DETAIL_FETCH_TIMEOUT_MS);
    try {
      const url = `${location.origin}/viewjob?jk=${encodeURIComponent(jk)}`;
      const res = await window.fetch(url, {
        headers: { Accept: 'text/html' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Received HTTP ${res.status}`);
      const html = await res.text();
      if (!html || html.length < 100) throw new Error('Received empty HTML response');
      const detailText = extractDetailTextFromHtml(html);
      if (!detailText) throw new Error('Response did not contain a job description');

      const existing = cache[jk] || { savedAt: Date.now() };
      const {
        shift,
        experience,
        workSetup,
        jobType,
        degree,
        techStack,
        salary,
        benefits,
        perks,
        ageLimit,
        gender,
        applyEmail,
        applySubject,
        applyPhone,
      } = parseDetailHtml(detailText);

      cache[jk] = {
        ...existing,
        salary: salary ?? existing.salary,
        shift: shift ?? existing.shift,
        experience: experience ?? existing.experience,
        workSetup: workSetup ?? existing.workSetup,
        jobType: jobType ?? existing.jobType,
        degree: degree ?? existing.degree,
        techStack,
        benefits: benefits ?? existing.benefits,
        perks: perks ?? existing.perks,
        ageLimit: ageLimit ?? existing.ageLimit,
        gender: gender ?? existing.gender,
        applyEmail: applyEmail ?? existing.applyEmail,
        applySubject: applySubject ?? existing.applySubject,
        applyPhone: applyPhone ?? existing.applyPhone,
        savedAt: Date.now(),
        deepScanned: true,
        detailScanVersion: DETAIL_SCAN_VERSION,
      };

      renderBadges(jk);
      saveData();
      return true;
    } catch (err) {
      console.error(`[NizViewer Fetch] Direct fetch failed for job ${jk}:`, err);
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  function fetchJobDetailsDirectly(jk) {
    if (!isJobKey(jk)) return Promise.resolve(false);
    const existingRequest = directDetailFetches.get(jk);
    if (existingRequest) return existingRequest;

    const request = performJobDetailsFetch(jk).finally(() => {
      directDetailFetches.delete(jk);
    });
    directDetailFetches.set(jk, request);
    return request;
  }

  const feedFetchQueue = [];
  const feedFetchQueued = new Set();
  const feedFetchAttempts = new Map();
  let activeFeedFetches = 0;

  function isSupportedFeed() {
    return location.pathname === '/' || location.pathname === '' || location.pathname === '/jobs';
  }

  function isNearViewport(jk) {
    const link = document.querySelector(`${SELECTORS.jobCardLink}[data-jk="${escapeJk(jk)}"]`);
    const card = link?.closest('li, [data-testid="jobListing"], [class*="job_seen_beacon"]');
    if (!card) return false;
    const rect = card.getBoundingClientRect();
    return rect.bottom >= -window.innerHeight && rect.top <= window.innerHeight * 2;
  }

  function hasCurrentDetails(entry) {
    return entry?.deepScanned && entry.detailScanVersion === DETAIL_SCAN_VERSION;
  }

  function drainFeedFetchQueue() {
    if (!extensionEnabled || !isSupportedFeed()) return;
    while (activeFeedFetches < FEED_FETCH_CONCURRENCY && feedFetchQueue.length > 0) {
      const jk = feedFetchQueue.shift();
      feedFetchQueued.delete(jk);
      if (hasCurrentDetails(cache[jk]) || !isNearViewport(jk)) continue;

      const attempt = feedFetchAttempts.get(jk) || { count: 0, nextRetryAt: 0 };
      if (attempt.count >= FEED_FETCH_MAX_ATTEMPTS || Date.now() < attempt.nextRetryAt) continue;

      activeFeedFetches += 1;
      fetchStates.set(jk, 'loading');
      renderBadges(jk);
      updateFeedSummary();
      fetchJobDetailsDirectly(jk)
        .then((success) => {
          if (success) {
            feedFetchAttempts.delete(jk);
            fetchStates.delete(jk);
            return;
          }
          const count = attempt.count + 1;
          fetchStates.set(jk, 'failed');
          feedFetchAttempts.set(jk, {
            count,
            nextRetryAt: Date.now() + FEED_FETCH_RETRY_DELAYS_MS[count - 1],
          });
        })
        .finally(() => {
          activeFeedFetches -= 1;
          renderBadges(jk);
          updateFeedSummary();
          drainFeedFetchQueue();
        });
    }
  }

  function queueFeedEnrichment(jks) {
    if (!extensionEnabled || !isSupportedFeed()) return;
    for (const jk of new Set(jks)) {
      const attempt = feedFetchAttempts.get(jk);
      if (
        hasCurrentDetails(cache[jk]) ||
        feedFetchQueued.has(jk) ||
        directDetailFetches.has(jk) ||
        !isNearViewport(jk) ||
        (attempt && (attempt.count >= FEED_FETCH_MAX_ATTEMPTS || Date.now() < attempt.nextRetryAt))
      ) {
        continue;
      }
      feedFetchQueued.add(jk);
      fetchStates.set(jk, 'queued');
      feedFetchQueue.push(jk);
      renderBadges(jk);
    }
    drainFeedFetchQueue();
  }
  function scavengeCard(jk) {
    const link = document.querySelector(`${SELECTORS.jobCardLink}[data-jk="${escapeJk(jk)}"]`);
    const card = link?.closest('li, [data-testid="jobListing"], [class*="job_seen_beacon"]');
    if (!card) return false;
    const existing = cache[jk];
    if (existing?.deepScanned) return false;
    const text = card.textContent?.replace(/\s+/g, ' ') || '';
    const {
      shift,
      experience,
      workSetup,
      jobType,
      degree,
      techStack,
      benefits,
      perks,
      ageLimit,
      gender,
      applyEmail,
      applySubject,
      applyPhone,
    } = parseDetailHtml(text);

    let changed = false;
    const updated = { ...existing };

    if (shift && !existing?.shift) {
      updated.shift = shift;
      changed = true;
    }
    if (experience && !existing?.experience) {
      updated.experience = experience;
      changed = true;
    }
    if (workSetup && !existing?.workSetup) {
      updated.workSetup = workSetup;
      changed = true;
    }
    if (jobType && !existing?.jobType) {
      updated.jobType = jobType;
      changed = true;
    }
    if (degree && !existing?.degree) {
      updated.degree = degree;
      changed = true;
    }
    if (techStack && !existing?.techStack) {
      updated.techStack = techStack;
      changed = true;
    }
    if (benefits && !existing?.benefits) {
      updated.benefits = benefits;
      changed = true;
    }
    if (perks && !existing?.perks) {
      updated.perks = perks;
      changed = true;
    }
    if (ageLimit && !existing?.ageLimit) {
      updated.ageLimit = ageLimit;
      changed = true;
    }
    if (gender && !existing?.gender) {
      updated.gender = gender;
      changed = true;
    }
    if (applyEmail && !existing?.applyEmail) {
      updated.applyEmail = applyEmail;
      changed = true;
    }
    if (applySubject && !existing?.applySubject) {
      updated.applySubject = applySubject;
      changed = true;
    }
    if (applyPhone && !existing?.applyPhone) {
      updated.applyPhone = applyPhone;
      changed = true;
    }

    if (changed) {
      updated.savedAt = Date.now();
      cache[jk] = updated;
      renderBadges(jk);
    }
    return changed;
  }

  function getJobItem(jk) {
    const link = document.querySelector(`${SELECTORS.jobCardLink}[data-jk="${escapeJk(jk)}"]`);
    return link?.closest('li, [data-testid="jobListing"], [class*="job_seen_beacon"]') || null;
  }

  function getVisibleFeedJks() {
    return Array.from(document.querySelectorAll(SELECTORS.jobCardLink))
      .map((link) => link.getAttribute('data-jk'))
      .filter((jk, index, all) => isJobKey(jk) && all.indexOf(jk) === index)
      .filter((jk) => {
        const item = getJobItem(jk);
        return (
          item &&
          !item.classList.contains('nizviewer-filter-hidden') &&
          !item.classList.contains('nizviewer-card-hidden-old')
        );
      });
  }

  function csvCell(value) {
    const text = String(value || '');
    return `"${text.replace(/"/g, '""')}"`;
  }

  async function copyVisibleJobs() {
    const jks = getVisibleFeedJks();
    if (!jks.length) {
      announce('No visible jobs to copy.');
      return;
    }
    const columns = getExportColumns();
    const output = [columns.map((column) => column[0]).join('\t')]
      .concat(jks.map((jk) => getJobDataForClipboard(jk)))
      .join('\n');
    try {
      await navigator.clipboard.writeText(output);
      announce(`${jks.length} visible job${jks.length === 1 ? '' : 's'} copied.`);
    } catch {
      announce('Could not copy visible jobs.');
    }
  }

  function exportVisibleJobs() {
    const jks = getVisibleFeedJks();
    if (!jks.length) {
      announce('No visible jobs to export.');
      return;
    }
    const columns = getExportColumns();
    const rows = [columns.map((column) => csvCell(column[0])).join(',')];
    for (const jk of jks) {
      const record = getJobRecord(jk);
      rows.push(columns.map((column) => csvCell(record[column[1]])).join(','));
    }
    const blob = new window.Blob([`\uFEFF${rows.join('\r\n')}`], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `nizviewer-jobs-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    announce(`${jks.length} jobs exported as CSV.`);
  }

  function parseExperienceValue(value) {
    if (/entry/i.test(value || '')) return 0;
    const match = String(value || '').match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : -1;
  }

  function matchesFeedView(jk) {
    const entry = cache[jk] || {};
    const days = getDaysAgo(entry);
    if (
      feedView.tech &&
      !String(entry.techStack || '')
        .toLowerCase()
        .includes(feedView.tech)
    ) {
      return false;
    }
    if (feedView.setup && String(entry.workSetup || '').toLowerCase() !== feedView.setup)
      return false;
    if (feedView.salaryOnly && !entry.salary) return false;
    if (feedView.experience !== '') {
      const experience = parseExperienceValue(entry.experience);
      if (experience < 0) return false;
      if (
        feedView.experience === '0' ? experience !== 0 : experience < Number(feedView.experience)
      ) {
        return false;
      }
    }
    if (feedView.freshness === '7' && (days === null || days > 7)) return false;
    if (feedView.freshness === '15' && (days === null || days < 8 || days > 15)) return false;
    if (feedView.freshness === '30' && (days === null || days < 16 || days > 30)) return false;
    if (feedView.freshness === 'older' && (days === null || days <= 30)) return false;
    return true;
  }

  function applyFeedView(jks) {
    for (const jk of jks) {
      getJobItem(jk)?.classList.toggle('nizviewer-filter-hidden', !matchesFeedView(jk));
    }
    const ranked = jks
      .map((jk, index) => ({ jk, index, item: getJobItem(jk) }))
      .filter((x) => x.item);
    for (const row of ranked) row.item.style.removeProperty('order');
    const parent = ranked[0]?.item?.parentElement;
    const sameParent = parent && ranked.every((row) => row.item.parentElement === parent);
    parent?.classList.toggle(
      'nizviewer-sortable-list',
      sameParent && feedView.sort !== 'relevance',
    );
    if (sameParent && feedView.sort !== 'relevance') {
      ranked.sort((a, b) => {
        if (feedView.sort === 'newest')
          return (getDaysAgo(cache[a.jk]) ?? 99999) - (getDaysAgo(cache[b.jk]) ?? 99999);
        if (feedView.sort === 'salary')
          return Number(!!cache[b.jk]?.salary) - Number(!!cache[a.jk]?.salary);
        if (feedView.sort === 'experience')
          return (
            (parseExperienceValue(cache[a.jk]?.experience) < 0
              ? 999
              : parseExperienceValue(cache[a.jk]?.experience)) -
            (parseExperienceValue(cache[b.jk]?.experience) < 0
              ? 999
              : parseExperienceValue(cache[b.jk]?.experience))
          );
        return a.index - b.index;
      });
      ranked.forEach((row, index) => row.item.style.setProperty('order', String(index)));
    }
    updateFeedSummary();
  }

  function controlOption(value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }

  function addToolbarSelect(parent, label, key, options) {
    const wrapper = document.createElement('label');
    wrapper.className = 'nizviewer-toolbar-field';
    const text = document.createElement('span');
    text.textContent = label;
    wrapper.appendChild(text);
    const select = document.createElement('select');
    select.setAttribute('data-feed-key', key);
    for (const option of options) select.appendChild(controlOption(option[0], option[1]));
    select.value = feedView[key];
    wrapper.appendChild(select);
    parent.appendChild(wrapper);
  }

  function ensureFeedToolbar(jks) {
    if (!extensionEnabled || !isSupportedFeed() || !jks.length) return null;
    const container = document.querySelector(SELECTORS.jobListContainer);
    if (!container) return null;
    let toolbar = document.getElementById('nizviewer-feed-toolbar');
    if (toolbar) {
      toolbar.className = `nizviewer-feed-toolbar nizviewer-theme-${badgePrefs.theme || 'light'}`;
      return toolbar;
    }
    toolbar = document.createElement('section');
    toolbar.id = 'nizviewer-feed-toolbar';
    toolbar.className = `nizviewer-feed-toolbar nizviewer-theme-${badgePrefs.theme || 'light'}`;
    toolbar.setAttribute('aria-label', 'NizViewer job controls');

    const heading = document.createElement('div');
    heading.className = 'nizviewer-toolbar-heading';
    heading.innerHTML =
      '<strong>NizViewer</strong><span id="nizviewer-feed-summary">Preparing job details…</span>';
    toolbar.appendChild(heading);

    const controls = document.createElement('div');
    controls.className = 'nizviewer-toolbar-controls';
    const techLabel = document.createElement('label');
    techLabel.className = 'nizviewer-toolbar-field';
    techLabel.innerHTML = '<span>Technology</span>';
    const techInput = document.createElement('input');
    techInput.type = 'search';
    techInput.placeholder = 'e.g. Next.js';
    techInput.value = feedView.tech;
    techInput.setAttribute('data-feed-key', 'tech');
    techLabel.appendChild(techInput);
    controls.appendChild(techLabel);
    addToolbarSelect(controls, 'Work setup', 'setup', [
      ['', 'Any'],
      ['remote', 'Remote'],
      ['hybrid', 'Hybrid'],
      ['onsite', 'Onsite'],
    ]);
    addToolbarSelect(controls, 'Posted', 'freshness', [
      ['', 'Any time'],
      ['7', 'Last 7 days'],
      ['15', '8–15 days'],
      ['30', '16–30 days'],
      ['older', 'Over 30 days'],
    ]);
    addToolbarSelect(controls, 'Experience', 'experience', [
      ['', 'Any'],
      ['0', 'Entry level'],
      ['1', '1+ years'],
      ['3', '3+ years'],
      ['5', '5+ years'],
    ]);
    addToolbarSelect(controls, 'Sort', 'sort', [
      ['relevance', 'Indeed order'],
      ['newest', 'Newest first'],
      ['salary', 'Salary listed first'],
      ['experience', 'Lowest experience first'],
    ]);
    const salaryLabel = document.createElement('label');
    salaryLabel.className = 'nizviewer-toolbar-check';
    salaryLabel.innerHTML =
      '<input type="checkbox" data-feed-key="salaryOnly"><span>Salary listed</span>';
    controls.appendChild(salaryLabel);
    toolbar.appendChild(controls);

    const actions = document.createElement('div');
    actions.className = 'nizviewer-toolbar-actions';
    for (const [action, label] of [
      ['copy', 'Copy visible'],
      ['export', 'Export CSV'],
      ['reveal', 'Show older jobs'],
      ['reset', 'Reset filters'],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = action;
      button.textContent = label;
      actions.appendChild(button);
    }
    toolbar.appendChild(actions);

    toolbar.addEventListener('input', (event) => {
      const key = event.target?.dataset?.feedKey;
      if (!key) return;
      feedView[key] =
        event.target.type === 'checkbox'
          ? event.target.checked
          : event.target.value.toLowerCase().trim();
      applyFeedView(getAllFeedJks());
    });
    toolbar.addEventListener('change', (event) => {
      const key = event.target?.dataset?.feedKey;
      if (!key) return;
      feedView[key] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
      applyFeedView(getAllFeedJks());
    });
    toolbar.addEventListener('click', (event) => {
      const action = event.target?.dataset?.action;
      if (action === 'copy') copyVisibleJobs();
      if (action === 'export') exportVisibleJobs();
      if (action === 'reveal') {
        revealOldJobs = !revealOldJobs;
        renderAllVisible();
      }
      if (action === 'reset') {
        Object.assign(feedView, {
          tech: '',
          setup: '',
          freshness: '',
          experience: '',
          salaryOnly: false,
          sort: 'relevance',
        });
        toolbar.remove();
        renderAllVisible();
        announce('Job filters reset.');
      }
    });
    container.prepend(toolbar);
    return toolbar;
  }

  function updateFeedSummary() {
    const summary = document.getElementById('nizviewer-feed-summary');
    if (!summary) return;
    const jks = Array.from(document.querySelectorAll(SELECTORS.jobCardLink))
      .map((link) => link.getAttribute('data-jk'))
      .filter((jk, index, all) => isJobKey(jk) && all.indexOf(jk) === index);
    const full = jks.filter((jk) => hasCurrentDetails(cache[jk])).length;
    const pending = jks.filter((jk) => ['queued', 'loading'].includes(fetchStates.get(jk))).length;
    const failed = jks.filter((jk) => fetchStates.get(jk) === 'failed').length;
    const hidden = jks.filter((jk) =>
      getJobItem(jk)?.classList.contains('nizviewer-card-hidden-old'),
    ).length;
    const visible = getVisibleFeedJks().length;
    summary.textContent = `${visible} visible · ${full} full · ${pending} pending${failed ? ` · ${failed} failed` : ''}${hidden ? ` · ${hidden} older hidden` : ''}`;
    const reveal = document.querySelector('#nizviewer-feed-toolbar [data-action="reveal"]');
    if (reveal) {
      reveal.hidden = badgePrefs.hideOldJobs !== true;
      reveal.textContent = revealOldJobs
        ? 'Hide older jobs'
        : `Show older jobs${hidden ? ` (${hidden})` : ''}`;
    }
  }

  function getAllFeedJks() {
    return Array.from(document.querySelectorAll(SELECTORS.jobCardLink))
      .map((link) => link.getAttribute('data-jk'))
      .filter((jk, index, all) => isJobKey(jk) && all.indexOf(jk) === index);
  }

  function renderAllVisible() {
    pruneCache();

    if (!extensionEnabled) {
      document.getElementById('nizviewer-feed-toolbar')?.remove();
      document.querySelectorAll('.nizviewer-card-fresh').forEach((el) => {
        el.classList.remove('nizviewer-card-fresh');
      });
      document.querySelectorAll('.nizviewer-card-hidden-old').forEach((el) => {
        el.classList.remove('nizviewer-card-hidden-old');
      });
      document.querySelectorAll('.nizviewer-filter-hidden').forEach((el) => {
        el.classList.remove('nizviewer-filter-hidden');
      });
      document.querySelectorAll('.nizviewer-sortable-list').forEach((el) => {
        el.classList.remove('nizviewer-sortable-list');
      });
    }

    if (!isSupportedFeed()) document.getElementById('nizviewer-feed-toolbar')?.remove();

    const allWrappers = document.querySelectorAll('.badge-wrapper');
    for (const w of allWrappers) {
      const wJk = w.getAttribute('data-jk');
      if (wJk) {
        const link = w.parentElement?.querySelector(
          `${SELECTORS.jobCardLink}[data-jk="${escapeJk(wJk)}"]`,
        );
        const isCurrentDetailWrapper =
          w.getAttribute('data-detail-wrapper') === 'true' && getActiveJk() === wJk;
        if (!link && !isCurrentDetailWrapper) {
          w.remove();
        }
      }
    }

    const links = Array.from(document.querySelectorAll(SELECTORS.jobCardLink));
    const jks = [];
    let cacheChanged = false;
    for (const a of links) {
      const jk = a.getAttribute('data-jk');
      if (isJobKey(jk)) {
        jks.push(jk);
        if (scavengeCard(jk)) cacheChanged = true;
        renderBadges(jk);
      }
    }
    const activeJk = getActiveJk();
    if (activeJk && !jks.includes(activeJk)) renderBadges(activeJk);
    if (cacheChanged) {
      saveData();
    }
    if (jks.length && extensionEnabled) {
      ensureFeedToolbar(jks);
      applyFeedView(jks);
      window.postMessage({ source: 'nizviewer', type: 'INTERESTED_JKS', jks }, location.origin);
      queueFeedEnrichment(jks);
    }
  }
  function isDetailPanelMatchingJk(jk) {
    const currentUrl = new URL(window.location.href);
    const activeUrlJk = currentUrl.searchParams.get('vjk') || currentUrl.searchParams.get('jk');
    if (activeUrlJk && activeUrlJk !== jk) return false;

    const rightPane = document.querySelector(
      '.jobsearch-RightPane, #jobsearch-ViewJobPane-container',
    );
    if (rightPane) {
      const isSkeleton = rightPane.querySelector(
        '[class*="Skeleton"], [class*="skeleton"], [data-testid="skeleton"], [aria-busy="true"]',
      );
      if (isSkeleton) return false;
    }

    const detailContainer =
      rightPane ||
      document.querySelector(
        '[data-testid="jobsearch-JobInfoHeader"], [data-testid="jobsearch-JobInfoHeader-title"], .jobsearch-JobInfoHeader-title',
      )?.parentElement;
    if (!detailContainer) return false;

    if (currentUrl.pathname === '/viewjob' && activeUrlJk === jk) {
      return !!document.querySelector(
        '#jobDescriptionText, [data-testid="job-description"], [class*="jobDescription"]',
      );
    }

    const jkLink = detailContainer.querySelector(`a[href*="${jk}"], [data-jk="${jk}"]`);
    if (jkLink) return true;

    const cardLink = document.querySelector(`${SELECTORS.jobCardLink}[data-jk="${jk}"]`);
    if (!cardLink) return false;

    const cardTitle = (cardLink.textContent || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ' ')
      .trim();
    const headerEl = detailContainer.querySelector(
      '[data-testid="jobsearch-JobInfoHeader"], [data-testid="jobsearch-JobInfoHeader-title"], .jobsearch-JobInfoHeader-title, [class*="JobInfoHeader"] h1, [class*="JobInfoHeader"] h2, h1',
    );
    if (!headerEl) return false;
    const headerTitle = (headerEl.textContent || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ' ')
      .trim();

    const cardWords = cardTitle.split(/\s+/).filter((w) => w.length > 2);
    if (cardWords.length === 0) return true;

    const matchCount = cardWords.filter((w) => headerTitle.includes(w)).length;
    return matchCount >= Math.ceil(cardWords.length * 0.4);
  }

  const inFlightScrapes = new Set();
  function scrapeDetailPanel(jk, attempt = 0) {
    if (attempt === 0) {
      if (inFlightScrapes.has(jk)) return Promise.resolve(false);
      inFlightScrapes.add(jk);
    }
    return new Promise((resolve) => {
      const finish = (res) => {
        inFlightScrapes.delete(jk);
        resolve(res);
      };
      try {
        if (!isDetailPanelMatchingJk(jk)) {
          if (attempt < 8) {
            setTimeout(() => {
              inFlightScrapes.delete(jk);
              scrapeDetailPanel(jk, attempt + 1).then(resolve);
            }, 400);
            return;
          }
          finish(false);
          return;
        }

        const HEADER_SELECTORS = [
          '[data-testid="jobsearch-JobInfoHeader"]',
          '[data-testid="jobsearch-JobInfoHeader-title"]',
          '[data-testid="inlineHeader-companyLocation"]',
          '[class*="jobsearch-InlineCompanyRating"]',
          '[class*="CompanyInfo"]',
          '[class*="companyLocation"]',
          '[class*="jobLocation"]',
          '.jobsearch-JobInfoHeader-subtitle',
          '.jobsearch-CompanyInfoWithoutHeaderImage',
        ];
        const BODY_SELECTORS = [
          '#jobDescriptionText',
          '[id*="jobDescription"]',
          '[class*="jobDescription"]',
          '.jobsearch-JobComponent',
          '[class*="JobDetail"]',
          '[class*="jobDetail"]',
          '[data-testid="job-detail"]',
          '.job-description',
        ];
        let headerText = '';
        for (const sel of HEADER_SELECTORS) {
          const el = document.querySelector(sel);
          if (el?.textContent) headerText += ' ' + el.textContent;
        }
        let bodyText = '';
        for (const sel of BODY_SELECTORS) {
          const el = document.querySelector(sel);
          if (el?.textContent && el.textContent.length > 50) {
            bodyText = el.textContent;
            break;
          }
        }
        const combinedText = (headerText + ' ' + bodyText).replace(/\s+/g, ' ');
        if (combinedText.length < 30 || bodyText.length < 30) {
          if (attempt < 8) {
            setTimeout(() => {
              inFlightScrapes.delete(jk);
              scrapeDetailPanel(jk, attempt + 1).then(resolve);
            }, 400);
            return;
          }
          finish(false);
          return;
        }
        const existing = cache[jk] || { savedAt: Date.now() };
        const {
          shift,
          experience,
          workSetup,
          jobType,
          degree,
          techStack,
          salary,
          benefits,
          perks,
          ageLimit,
          gender,
          applyEmail,
          applySubject,
          applyPhone,
        } = parseDetailHtml(combinedText);
        const needsUpdate =
          (salary && salary !== existing.salary) ||
          (shift && shift !== existing.shift) ||
          (experience && experience !== existing.experience) ||
          (workSetup && workSetup !== existing.workSetup) ||
          (jobType && jobType !== existing.jobType) ||
          (degree && degree !== existing.degree) ||
          techStack !== existing.techStack ||
          existing.detailScanVersion !== DETAIL_SCAN_VERSION ||
          (benefits && benefits !== existing.benefits) ||
          (perks && perks !== existing.perks) ||
          (ageLimit && ageLimit !== existing.ageLimit) ||
          (gender && gender !== existing.gender) ||
          (applyEmail && applyEmail !== existing.applyEmail) ||
          (applySubject && applySubject !== existing.applySubject) ||
          (applyPhone && applyPhone !== existing.applyPhone);
        if (needsUpdate || !existing.deepScanned) {
          cache[jk] = {
            ...existing,
            salary: salary ?? existing.salary,
            shift: shift ?? existing.shift,
            experience: experience ?? existing.experience,
            workSetup: workSetup ?? existing.workSetup,
            jobType: jobType ?? existing.jobType,
            degree: degree ?? existing.degree,
            techStack,
            benefits: benefits ?? existing.benefits,
            perks: perks ?? existing.perks,
            ageLimit: ageLimit ?? existing.ageLimit,
            gender: gender ?? existing.gender,
            applyEmail: applyEmail ?? existing.applyEmail,
            applySubject: applySubject ?? existing.applySubject,
            applyPhone: applyPhone ?? existing.applyPhone,
            savedAt: Date.now(),
            deepScanned: true,
            detailScanVersion: DETAIL_SCAN_VERSION,
          };
          renderBadges(jk);
          saveData();
        }
        finish(true);
      } catch {
        finish(false);
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
      const res = await storage.local.get(['extensionEnabled']);
      if (res.extensionEnabled !== void 0) extensionEnabled = res.extensionEnabled;

      if (storage.onChanged) {
        storage.onChanged.addListener((changes, areaName) => {
          if (areaName === 'local' && changes[CACHE_KEY]) {
            if (!changes[CACHE_KEY].newValue) {
              cache = {};
            } else {
              cache = { ...changes[CACHE_KEY].newValue, ...cache };
            }
            renderAllVisible();
          }
        });
      }

      window.addEventListener('message', async (ev) => {
        const d = ev.data;
        if (
          ev.source !== window ||
          ev.origin !== location.origin ||
          !d ||
          d.source !== 'nizviewer' ||
          d.type !== 'JOB_DATES'
        )
          return;
        if (Array.isArray(d.payload)) {
          let changed = false;
          for (const item of d.payload.slice(0, 100)) {
            if (!item || !isJobKey(item.jk)) continue;
            const existing = cache[item.jk];
            const acceptsDetailFields = item.deepScanned || !existing?.deepScanned;

            let shift = acceptsDetailFields ? (item.shift ?? existing?.shift) : existing?.shift;
            let workSetup = acceptsDetailFields
              ? (item.workSetup ?? existing?.workSetup)
              : existing?.workSetup;
            let experience = acceptsDetailFields
              ? (item.experience ?? existing?.experience)
              : existing?.experience;

            let applyEmail = existing?.applyEmail;
            let applySubject = existing?.applySubject;
            let applyPhone = existing?.applyPhone;
            if (acceptsDetailFields && !item.deepScanned && item.fullText) {
              const text = item.fullText;
              const applicationDetails = parseDetailHtml(text);
              applyEmail = applicationDetails.applyEmail ?? applyEmail;
              applySubject = applicationDetails.applySubject ?? applySubject;
              applyPhone = applicationDetails.applyPhone ?? applyPhone;
              let taxoShift, taxoExp;
              if (Array.isArray(item.taxoAttrs)) {
                for (const group of item.taxoAttrs) {
                  if (!group || typeof group !== 'object') continue;
                  const gl = (group.label || '').toLowerCase();
                  if ((gl === 'shifts' || gl === 'schedules') && Array.isArray(group.attributes)) {
                    const labels = group.attributes
                      .map((a) => (typeof a.label === 'string' ? a.label.trim() : ''))
                      .filter(Boolean);
                    if (labels.length > 0) taxoShift = labels.join(', ');
                  }
                  if (
                    (gl === 'experience' || gl === 'experience level') &&
                    Array.isArray(group.attributes)
                  ) {
                    const labels = group.attributes
                      .map((a) => (typeof a.label === 'string' ? a.label.trim() : ''))
                      .filter(Boolean);
                    if (labels.length > 0) taxoExp = labels.join(', ');
                  }
                }
              }
              if (!shift) {
                shift = classifyShift(text);
                if (!shift && taxoShift) shift = classifyShift(taxoShift) || taxoShift;
              }
              if (!workSetup) {
                if (
                  /\b(?:permanent[\s-]+remote|remote|wfh|work[\s-]+from[\s-]+home|home[\s-]*based|remotely|virtual)\b/i.test(
                    text,
                  )
                )
                  workSetup = 'Remote';
                else if (/\b(?:hybrid|hyrbid|mixed|work[\s-]+from[\s-]+office)\b/i.test(text))
                  workSetup = 'Hybrid';
                else if (
                  /\b(?:on[\s-]?site|in[\s-]*office|in[\s-]*person|onsite|on[\s-]*site)\b/i.test(
                    text,
                  )
                )
                  workSetup = 'Onsite';
                if (!workSetup && /\bno\s+remote\b/i.test(text)) workSetup = 'Onsite';
              }
              if (!experience) {
                if (typeof item.experienceLevel === 'string' && item.experienceLevel.length > 1) {
                  experience = item.experienceLevel;
                } else if (
                  typeof item.yearsExperienceRequired === 'number' &&
                  item.yearsExperienceRequired > 0
                ) {
                  experience = `${item.yearsExperienceRequired}+ yrs`;
                } else if (taxoExp) {
                  experience = taxoExp;
                }
                if (!experience) {
                  experience = extractExperienceFromText(text);
                }
              }
            }

            const updated = {
              ...existing,
              datePostedIso: item.dateIso ?? existing?.datePostedIso,
              companyName: item.companyName ?? existing?.companyName,
              salary: item.salary ?? existing?.salary,
              shift,
              experience,
              workSetup,
              jobType: acceptsDetailFields
                ? (item.jobType ?? existing?.jobType)
                : existing?.jobType,
              degree: acceptsDetailFields ? (item.degree ?? existing?.degree) : existing?.degree,
              techStack: acceptsDetailFields
                ? (item.techStack ?? existing?.techStack)
                : existing?.techStack,
              benefits: acceptsDetailFields
                ? (item.benefits ?? existing?.benefits)
                : existing?.benefits,
              perks: acceptsDetailFields ? (item.perks ?? existing?.perks) : existing?.perks,
              ageLimit: acceptsDetailFields
                ? (item.ageLimit ?? existing?.ageLimit)
                : existing?.ageLimit,
              gender: acceptsDetailFields ? (item.gender ?? existing?.gender) : existing?.gender,
              applyEmail,
              applySubject,
              applyPhone,
              savedAt: Date.now(),
              deepScanned: item.deepScanned || existing?.deepScanned,
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
    rt.onMessage.addListener(async (msg) => {
      if (msg.type === 'EXTENSION_STATE_CHANGED') {
        extensionEnabled = msg.enabled;
        renderAllVisible();
      } else if (msg.type === 'PREFS_CHANGED') {
        badgePrefs = { ...badgePrefs, ...msg.prefs };
        revealOldJobs = false;
        renderAllVisible();
      } else if (msg.type === 'CACHE_CLEARED') {
        cache = {};
        await storage.local.remove(CACHE_KEY);
        renderAllVisible();
      }
    });
    setInterval(() => {
      if (document.hidden) return;
      renderAllVisible();
      const activeJk = getActiveJk();
      if (activeJk && cache[activeJk] && !cache[activeJk].deepScanned) {
        scrapeDetailPanel(activeJk, 0);
      }
    }, 1e3);
    document.addEventListener(
      'click',
      (e) => {
        const t = e.target;
        if (t?.closest?.(SELECTORS.jobCardLink)) {
          setTimeout(() => debounced(), 350);
        }
      },
      true,
    );
    const observer = new MutationObserver(() => {
      if (isApplyingChanges) return;
      debounced();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
