'use strict';
(() => {
  function getFreshnessTier(daysAgo) {
    if (daysAgo <= 7) {
      return 'fresh';
    } else if (daysAgo <= 14) {
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
  let cache = {};
  let badgePrefs = { ...DEFAULT_BADGE_PREFS };

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
    let experience;
    const yearNums = [];
    const rangePattern = /(\d+(?:\.\d+)?)\s*(?:to|[-–—])\s*(\d+(?:\.\d+)?)\s*(?:year|yr)s?/gi;
    for (const m of text.matchAll(rangePattern)) {
      yearNums.push(parseFloat(m[1]), parseFloat(m[2]));
    }
    const orMorePattern =
      /(?:at\s+least|minimum\s+of|min)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:or)?\s*more\s*(?:year|yr)s?/gi;
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
      if (
        /\b(?:exp|experience|required|requirements|minimum|min|at\s+least|plus|prefer)\b/.test(
          context,
        )
      ) {
        yearNums.push(val);
      }
    }
    if (yearNums.length > 0) {
      const valid = Array.from(new Set(yearNums.filter((n) => n >= 0.5 && n <= 25))).sort(
        (a, b) => a - b,
      );
      if (valid.length > 0) {
        const min = valid[0];
        const max = valid[valid.length - 1];
        experience = min === max ? `${min}+ yrs` : `${min}\u2013${max} yrs`;
      }
    }
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
    const vjk = url.searchParams.get('vjk');
    if (vjk) return vjk;
    const active = document.querySelector(SELECTORS.activeLink);
    return active?.getAttribute('data-jk') || null;
  }
  function escapeJk(jk) {
    if (!jk) return '';
    return typeof window !== 'undefined' && window.CSS?.escape ? window.CSS.escape(jk) : jk;
  }
  function ensureBadgeWrapper(jk) {
    const link = document.querySelector(`${SELECTORS.jobCardLink}[data-jk="${escapeJk(jk)}"]`);
    if (!link) return null;
    const title = link.closest('.jobTitle, [data-testid="jobTitle"]') || link;
    const parent = title.parentNode;
    if (!parent) return null;

    const allWrappers = parent.querySelectorAll('.badge-wrapper');
    allWrappers.forEach((el) => {
      if (el.getAttribute('data-jk') !== jk) {
        el.remove();
      }
    });

    let wrapper = parent.querySelector(`.badge-wrapper[data-jk="${jk}"]`);
    if (wrapper) return wrapper;

    wrapper = document.createElement('div');
    wrapper.className = 'badge-wrapper';
    wrapper.setAttribute('data-jk', jk);
    parent.insertBefore(wrapper, title);
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

  function setBtnText(btn, iconName, text) {
    btn.textContent = '';
    if (iconName && typeof ICONS !== 'undefined' && ICONS[iconName]) {
      btn.appendChild(inlineIconEl(iconName, 'nizviewer-btn-icon'));
    }
    btn.appendChild(document.createTextNode(text));
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
      p: badgePrefs,
    });
    if (wrapper.getAttribute('data-rendered-hash') === stateHash) return;
    wrapper.setAttribute('data-rendered-hash', stateHash);
    isApplyingChanges = true;
    try {
      wrapper.replaceChildren();
      if (!extensionEnabled) return;
      if (!entry) return;

      const infoRows = [];
      if (entry.datePostedIso) {
        const date = new Date(entry.datePostedIso);
        const diffTime = Math.abs(Date.now() - date.getTime());
        const daysAgo = Math.floor(diffTime / 864e5);
        const formattedDate = new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
        }).format(date);
        infoRows.push({
          label: 'Posted',
          value: `${formattedDate} (${daysAgo === 0 ? 'Today' : `${daysAgo}d ago`})`,
          title: `Originally posted on ${date.toDateString()}`,
          cls: `badge-${getFreshnessTier(daysAgo)}`,
        });
      }
      if (entry.salary && badgePrefs.salary) {
        infoRows.push({ label: 'Salary', value: entry.salary, cls: 'badge-salary' });
      }
      if (entry.shift && badgePrefs.shift) {
        infoRows.push({ label: 'Shift', value: entry.shift, cls: getShiftClass(entry.shift) });
      }
      if (entry.workSetup && badgePrefs.workSetup) {
        infoRows.push({
          label: 'Work Setup',
          value: entry.workSetup,
          cls: getSetupClass(entry.workSetup),
        });
      }
      if (entry.experience && badgePrefs.experience) {
        infoRows.push({
          label: 'Experience',
          value: entry.experience,
          cls: 'badge-experience',
        });
      }
      if (entry.jobType && badgePrefs.jobType) {
        infoRows.push({ label: 'Job Type', value: entry.jobType, cls: 'badge-jobtype' });
      }
      if (entry.degree && badgePrefs.degree) {
        infoRows.push({ label: 'Degree', value: entry.degree, cls: 'badge-degree' });
      }
      if (entry.benefits && badgePrefs.benefits) {
        infoRows.push({
          label: 'Benefits',
          value: entry.benefits,
          title: 'Retirement & Statutory Benefits',
          cls: 'badge-benefits',
        });
      }
      if (entry.perks && badgePrefs.perks) {
        infoRows.push({
          label: 'Perks',
          value: entry.perks,
          title: 'Allowances & Perks',
          cls: 'badge-perks',
        });
      }
      if (entry.ageLimit && badgePrefs.ageLimit) {
        infoRows.push({ label: 'Age Limit', value: entry.ageLimit, cls: 'badge-age' });
      }
      if (entry.gender && badgePrefs.gender) {
        infoRows.push({ label: 'Gender', value: entry.gender, cls: 'badge-gender' });
      }

      const techs =
        entry.techStack && badgePrefs.techStack ? entry.techStack.split(', ').filter(Boolean) : [];

      if (infoRows.length || techs.length) {
        const card = document.createElement('div');
        card.className = 'nizviewer-tech-stack-card';

        const rowsEl = document.createElement('div');
        rowsEl.className = 'nizviewer-tech-stack-rows';

        for (const row of infoRows) {
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

          for (const [label, list] of grouped) {
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
              pillsEl.appendChild(pill);
            }

            row.appendChild(pillsEl);
            rowsEl.appendChild(row);
          }
        }

        card.appendChild(rowsEl);
        wrapper.appendChild(card);
      }

      const link = document.querySelector(`${SELECTORS.jobCardLink}[data-jk="${escapeJk(jk)}"]`);
      const cardContainer = link?.closest(
        'li, [data-testid="jobListing"], [class*="job_seen_beacon"]',
      );
      if (cardContainer) {
        if (window.getComputedStyle(cardContainer).position === 'static') {
          cardContainer.style.position = 'relative';
        }

        let cardBtn = cardContainer.querySelector(
          `.nizviewer-card-action[data-jk="${escapeJk(jk)}"]`,
        );
        if (!cardBtn) {
          cardBtn = document.createElement('button');
          cardBtn.type = 'button';
          cardBtn.setAttribute('data-jk', jk);
          cardContainer.appendChild(cardBtn);
        }

        if (!entry?.deepScanned) {
          cardBtn.className = 'nizviewer-card-action badge-fetch-btn';
          setBtnText(cardBtn, 'bolt', 'Fetch');
          cardBtn.title =
            'Full job details have not been fetched yet. Click to fetch full details & tech stack';
        } else {
          cardBtn.className = 'nizviewer-card-action badge-refetch-btn';
          setBtnText(cardBtn, 'rotate', 'Refetch Details');
          cardBtn.title = 'Job details fetched. Click to re-fetch latest details';
        }

        if (!cardBtn.__nizBound) {
          cardBtn.__nizBound = true;
          cardBtn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            ev.preventDefault();
            cardBtn.disabled = true;
            setBtnText(cardBtn, 'hourglass', 'Fetching...');
            const success = await fetchJobDetailsDirectly(jk);
            if (success) {
              setBtnText(cardBtn, 'check', 'Fetched');
              setTimeout(() => {
                cardBtn.disabled = false;
                cardBtn.className = 'nizviewer-card-action badge-refetch-btn';
                setBtnText(cardBtn, 'rotate', 'Refetch Details');
              }, 1500);
            } else {
              setBtnText(cardBtn, 'cross', 'Failed');
              setTimeout(() => {
                cardBtn.disabled = false;
                setBtnText(
                  cardBtn,
                  entry?.deepScanned ? 'rotate' : 'bolt',
                  entry?.deepScanned ? 'Refetch Details' : 'Fetch',
                );
              }, 2000);
            }
          });
        }
      }
    } finally {
      setTimeout(() => {
        isApplyingChanges = false;
      }, 50);
    }
  }

  async function fetchJobDetailsDirectly(jk) {
    try {
      const url = `${location.origin}/viewjob?jk=${encodeURIComponent(jk)}`;
      const res = await window.fetch(url, { headers: { Accept: 'text/html' } });
      const html = await res.text();
      if (!html || html.length < 100) throw new Error('Received empty HTML response');

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
      } = parseDetailHtml(html);

      cache[jk] = {
        ...existing,
        salary: salary ?? existing.salary,
        shift: shift ?? existing.shift,
        experience: experience ?? existing.experience,
        workSetup: workSetup ?? existing.workSetup,
        jobType: jobType ?? existing.jobType,
        degree: degree ?? existing.degree,
        techStack: techStack || existing.techStack || undefined,
        benefits: benefits ?? existing.benefits,
        perks: perks ?? existing.perks,
        ageLimit: ageLimit ?? existing.ageLimit,
        gender: gender ?? existing.gender,
        savedAt: Date.now(),
        deepScanned: true,
      };

      renderBadges(jk);
      saveData();
      return true;
    } catch (err) {
      console.error(`[NizViewer Fetch] Direct fetch failed for job ${jk}:`, err);
      return false;
    }
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

    if (changed) {
      updated.savedAt = Date.now();
      cache[jk] = updated;
      renderBadges(jk);
    }
    return changed;
  }
  function renderAllVisible() {
    pruneCache();

    const allWrappers = document.querySelectorAll('.badge-wrapper');
    for (const w of allWrappers) {
      const wJk = w.getAttribute('data-jk');
      if (wJk) {
        const link = w.parentElement?.querySelector(
          `${SELECTORS.jobCardLink}[data-jk="${escapeJk(wJk)}"]`,
        );
        if (!link) {
          w.remove();
        }
      }
    }

    const links = Array.from(document.querySelectorAll(SELECTORS.jobCardLink));
    const jks = [];
    let cacheChanged = false;
    for (const a of links) {
      const jk = a.getAttribute('data-jk');
      if (jk) {
        jks.push(jk);
        if (scavengeCard(jk)) cacheChanged = true;
        renderBadges(jk);
      }
    }
    if (cacheChanged) {
      saveData();
    }
    if (jks.length) {
      window.postMessage({ source: 'nizviewer', type: 'INTERESTED_JKS', jks }, location.origin);
    }

  }
  function isDetailPanelMatchingJk(jk) {
    const activeVjk = new URL(window.location.href).searchParams.get('vjk');
    if (activeVjk && activeVjk !== jk) return false;

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
      rightPane || document.querySelector('[data-testid="jobsearch-JobInfoHeader"]');
    if (!detailContainer) return false;

    const jkLink = detailContainer.querySelector(`a[href*="${jk}"], [data-jk="${jk}"]`);
    if (jkLink) return true;

    const cardLink = document.querySelector(`${SELECTORS.jobCardLink}[data-jk="${jk}"]`);
    if (!cardLink) return false;

    const cardTitle = (cardLink.textContent || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ' ')
      .trim();
    const headerEl = detailContainer.querySelector(
      '[data-testid="jobsearch-JobInfoHeader"], h1.jobsearch-JobInfoHeader-title, h1[class*="jobsearch"], [class*="JobInfoHeader"] h1, h1',
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
        } = parseDetailHtml(combinedText);
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
        if (needsUpdate || !existing.deepScanned) {
          cache[jk] = {
            ...existing,
            salary: salary ?? existing.salary,
            shift: shift ?? existing.shift,
            experience: experience ?? existing.experience,
            workSetup: workSetup ?? existing.workSetup,
            jobType: jobType ?? existing.jobType,
            degree: degree ?? existing.degree,
            techStack: techStack || existing.techStack || undefined,
            benefits: benefits ?? existing.benefits,
            perks: perks ?? existing.perks,
            ageLimit: ageLimit ?? existing.ageLimit,
            gender: gender ?? existing.gender,
            savedAt: Date.now(),
            deepScanned: true,
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
        if (!d || d.source !== 'nizviewer' || d.type !== 'JOB_DATES') return;
        if (Array.isArray(d.payload)) {
          let changed = false;
          for (const item of d.payload) {
            if (!item.jk) continue;
            const existing = cache[item.jk];
            if (existing?.deepScanned && !item.deepScanned) continue;
            const updated = {
              ...existing,
              datePostedIso: item.dateIso ?? existing?.datePostedIso,
              companyName: item.companyName ?? existing?.companyName,
              salary: item.salary ?? existing?.salary,
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
