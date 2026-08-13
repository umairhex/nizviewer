"use strict";
(() => {
  var jobKeyLike = (k) => /^[a-f0-9]{16}$/i.test(k);
  var foundJobs = new Map();
  function post(type, data) {
    window.postMessage({ source: "nizviewer", type, ...data }, "*");
  }
  function toIsoFromAgeDays(days) {
    if (typeof days !== "number" || !isFinite(days) || days < 0 || days > 3650) return null;
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - days);
    date.setUTCHours(12, 0, 0, 0);
    return date.toISOString();
  }
  function toIsoIfPossible(v) {
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v;
    if (typeof v === "number" && isFinite(v)) {
      const ms = v < 1e10 ? v * 1e3 : v;
      if (ms > 9466848e5 && ms < 41024448e5) return new Date(ms).toISOString();
    }
    return null;
  }
  function extractFromTaxonomyAttributes(taxo) {
    if (!Array.isArray(taxo)) return {};
    for (const group of taxo) {
      if (!group || typeof group !== "object") continue;
      const groupLabel = (group.label || "").toLowerCase();
      if ((groupLabel === "shifts" || groupLabel === "schedules") && Array.isArray(group.attributes)) {
        const labels = group.attributes.map((a) => typeof a?.label === "string" ? a.label.trim() : "").filter(Boolean);
        if (labels.length > 0) return { shift: labels.join(", ") };
      }
    }
    return {};
  }
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
    return void 0;
  }
  function scanMosaicCards(results) {
    const out = [];
    if (!Array.isArray(results)) return out;
    for (const card of results) {
      if (!card || typeof card !== "object") continue;
      const jk = card.jobkey || card.jk || card.jobKey || "";
      if (!jobKeyLike(jk)) continue;
      const dateIso = toIsoIfPossible(card.pubDate) || toIsoIfPossible(card.createDate) || (/(just posted|today)/i.test(card.formattedRelativeTime || "") ? new Date().toISOString() : null) || (card.formattedRelativeTime?.match(/(\d+)\s*day/i)?.[1] != null ? toIsoFromAgeDays(parseInt(card.formattedRelativeTime.match(/(\d+)\s*day/i)[1], 10)) : null);
      if (!dateIso) continue;
      const companyName = card.company || card.truncatedCompany || card.companyName || "";
      let salary;
      const ss = card.salarySnippet;
      if (ss?.text) salary = ss.text;
      else if (typeof card.salary === "string" && /\d/.test(card.salary)) salary = card.salary;
      let shift;
      const titleObj = card.displayTitle || card.title || card.normTitle || "";
      shift = classifyShift(titleObj);
      if (!shift) {
        const taxoShift = extractFromTaxonomyAttributes(card.taxonomyAttributes || []);
        if (taxoShift.shift) shift = classifyShift(taxoShift.shift) || taxoShift.shift;
      }
      if (!shift && card.snippet) {
        const snippetText = (card.snippet || "").replace(/<[^>]+>/g, " ");
        shift = classifyShift(snippetText);
      }
      let workSetup;
      const locationObj = card.location || card.formattedLocation || "";
      const fullScanText = (titleObj + " " + (card.snippet || "") + " " + (locationObj || "")).toLowerCase();
      if (/\b(?:permanent[\s-]+remote|remote|wfh|work[\s-]+from[\s-]+home|home[\s-]*based|remotely|virtual)\b/i.test(fullScanText)) {
        workSetup = "Remote";
      } else if (/\b(?:hybrid|hyrbid|mixed)\b/i.test(fullScanText)) {
        workSetup = "Hybrid";
      } else if (/\b(?:on[\s-]?site|in[\s-]*office|in[\s-]*person|onsite|on[\s-]*site)\b/i.test(fullScanText)) {
        workSetup = "Onsite";
      }
      if (!workSetup && card.remoteLocation) workSetup = "Remote";
      if (!workSetup && card.snippet) {
        const snip = card.snippet.toLowerCase();
        if (/\b(?:remote|wfh|home[\s-]*based|remotely|work[\s-]+from[\s-]+home|remote)\b/i.test(snip)) workSetup = "Remote";
        else if (/\b(?:hybrid|hyrbid)\b/i.test(snip)) workSetup = "Hybrid";
        else if (/\b(?:on[\s-]*site|in[\s-]*office|in[\s-]*person|onsite)\b/i.test(snip)) workSetup = "Onsite";
      }
      let experience;
      if (typeof card.experienceLevel === "string" && card.experienceLevel.length > 1) {
        experience = card.experienceLevel;
      } else if (typeof card.yearsExperienceRequired === "number" && card.yearsExperienceRequired > 0) {
        experience = `${card.yearsExperienceRequired}+ yrs`;
      }
      if (!experience && Array.isArray(card.taxonomyAttributes)) {
        for (const group of card.taxonomyAttributes) {
          if (!group || typeof group !== "object") continue;
          const gl = (group.label || "").toLowerCase();
          if ((gl === "experience" || gl === "experience level") && Array.isArray(group.attributes)) {
            const labels = group.attributes.map((a) => typeof a?.label === "string" ? a.label.trim() : "").filter(Boolean);
            if (labels.length > 0) {
              experience = labels.join(", ");
              break;
            }
          }
        }
      }
      if (!experience && card.snippet) {
        const snippetClean = (card.snippet || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
        const yearNums = [];
        const rangePat = /(\d+(?:\.\d+)?)\s*(?:to|[-–—])\s*(\d+(?:\.\d+)?)\s*(?:year|yr)s?/gi;
        for (const m of snippetClean.matchAll(rangePat)) yearNums.push(parseFloat(m[1]), parseFloat(m[2]));
        const orMorePat = /(?:at\s+least|minimum\s+of|min)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:or)?\s*more\s*(?:year|yr)s?/gi;
        for (const m of snippetClean.matchAll(orMorePat)) {
          const val = parseFloat(m[1] || m[2]);
          if (!isNaN(val)) yearNums.push(val);
        }
        const standalonePat = /(\d+(?:\.\d+)?)\s*(?:\+)?\s*(?:year|yr)s?/gi;
        let exM;
        while ((exM = standalonePat.exec(snippetClean)) !== null) {
          const val = parseFloat(exM[1]);
          const st = Math.max(0, exM.index - 60);
          const en = Math.min(snippetClean.length, exM.index + 80);
          const ctx = snippetClean.substring(st, en).toLowerCase();
          if (/\b(?:exp|experience|required|requirements|minimum|min|at\s+least|plus|prefer)\b/.test(ctx)) yearNums.push(val);
        }
        if (yearNums.length > 0) {
          const valid = Array.from(new Set(yearNums.filter((n) => n >= 0.5 && n <= 25))).sort((a, b) => a - b);
          if (valid.length > 0) {
            const mn = valid[0], mx = valid[valid.length - 1];
            experience = mn === mx ? `${mn}+ yrs` : `${mn}\u2013${mx} yrs`;
          }
        }
        if (!experience && /entry[\s-]*level|no\s+exp|fresh\s*grad/i.test(snippetClean)) experience = "Entry Level";
      }
      out.push({ jk, dateIso, companyName: companyName || void 0, salary, shift, workSetup, experience });
    }
    return out;
  }
  function extractJobFieldsInSubtree(node, maxDepth = 25) {
    const result = {};
    const dateFields = [
      "datePosted",
      "postedAt",
      "postedDate",
      "publishDate",
      "publishedAt",
      "firstPublishedAt",
      "createdAt",
      "creationDate",
      "originalPostingDate",
      "originalPostDate",
      "pubDate"
    ];
    const ageFields = ["ageInDays", "jobAgeDays", "daysSincePosted", "postingAgeDays", "daysAgo", "ageDays", "age", "formattedRelativeTime"];
    const companyFields = ["company", "companyName", "employerName", "source"];
    const salaryFields = ["extractedSalary", "salarySnippet", "estimatedSalary", "salary"];
    const shiftFields = [
      "jobScheduleTypes",
      "jobScheduleType",
      "shiftDescription",
      "workSchedule",
      "shiftSchedule",
      "jobShift",
      "shift",
      "schedule"
    ];
    const expFields = [
      "experienceLevel",
      "yearsExperienceRequired",
      "minimumExperience",
      "experienceRequirements",
      "requiredExperience",
      "formattedExperience",
      "experience"
    ];
    if (node && typeof node === "object") result._debugObj = node;
    if (node === null || node === void 0 || maxDepth <= 0) return result;
    if (typeof node !== "object") return result;
    const seen = new Set();
    const stack = [{ obj: node, depth: 0 }];
    while (stack.length) {
      const { obj: cur, depth } = stack.pop();
      if (!cur || typeof cur !== "object" || seen.has(cur) || depth > maxDepth) continue;
      seen.add(cur);
      if (!result.dateIso) {
        for (const f of dateFields) {
          const iso = toIsoIfPossible(cur[f]);
          if (iso) {
            result.dateIso = iso;
            break;
          }
        }
        if (!result.dateIso) {
          for (const f of ageFields) {
            const val = cur[f];
            if (typeof val === "string") {
              const match = val.match(/(\d+)\s*(?:day|jour|día|tag|giorn)/i);
              if (match) {
                result.dateIso = toIsoFromAgeDays(parseInt(match[1], 10));
                break;
              }
              if (/(today|aujourd'hui|just posted|active)/i.test(val)) {
                result.dateIso = new Date().toISOString();
                break;
              }
            }
            const iso = toIsoFromAgeDays(val);
            if (iso) {
              result.dateIso = iso;
              break;
            }
          }
        }
      }
      if (!result.companyName) {
        for (const f of companyFields) {
          const val = cur[f];
          if (typeof val === "string" && val.length > 1 && val.length < 100) {
            result.companyName = val;
            break;
          } else if (val && typeof val === "object" && val.name) {
            result.companyName = val.name;
            break;
          }
        }
      }
      if (!result.salary) {
        for (const f of salaryFields) {
          const val = cur[f];
          if (val && typeof val === "object") {
            if (val.text) {
              result.salary = val.text;
              break;
            }
            if (val.max || val.min) {
              const rawMin = val.min && val.min > 0 ? Math.round(val.min) : null;
              const rawMax = val.max && val.max > 0 ? Math.round(val.max) : null;
              if (!rawMin && !rawMax) break;
              const min = rawMin ? rawMin.toLocaleString() : "";
              const max = rawMax ? rawMax.toLocaleString() : "";
              let symbol = "";
              if (val.currency) {
                try {
                  const parts = new Intl.NumberFormat(void 0, { style: "currency", currency: val.currency }).formatToParts(0);
                  symbol = parts.find((p) => p.type === "currency")?.value || val.currency;
                } catch {
                  symbol = val.currency;
                }
              }
              const format = (n) => symbol ? `${symbol}${n}` : n;
              if (min && max && min !== max) result.salary = `${format(min)} - ${format(max)}`;
              else if (min) result.salary = format(min);
              else if (max) result.salary = `Up to ${format(max)}`;
              if (val.type) result.salary += ` / ${val.type.toLowerCase()}`;
              break;
            }
          } else if (typeof val === "string" && /\d/.test(val) && (val.includes("$") || val.includes("\u20AC") || val.includes("\xA3") || val.includes("\u20B1") || val.includes("\xA5"))) {
            result.salary = val;
            break;
          }
        }
      }
      if (!result.shift) {
        for (const f of shiftFields) {
          const val = cur[f];
          if (typeof val === "string" && val.length > 2 && val.length < 60) {
            result.shift = val;
            break;
          }
          if (Array.isArray(val) && val.length > 0 && typeof val[0] === "string") {
            result.shift = val.join(", ");
            break;
          }
        }
        if (!result.shift) {
          const attrs = cur.attributes || cur.jobAttributes;
          if (Array.isArray(attrs)) {
            for (const attr of attrs) {
              if (attr && /schedule|shift/i.test(attr.label || "") && attr.value) {
                result.shift = String(attr.value);
                break;
              }
            }
          }
        }
        if (!result.shift) {
          const SHIFT_RE = /night\s*shift|day\s*shift|morning\s*shift|graveyard|evening|overnight|rotating/i;
          for (const f of ["formattedJobTypes", "formattedJobType", "jobTypes", "jobType"]) {
            const val = cur[f];
            const arr = Array.isArray(val) ? val : typeof val === "string" ? [val] : [];
            const hit = arr.find((s) => typeof s === "string" && SHIFT_RE.test(s));
            if (hit) {
              result.shift = hit;
              break;
            }
          }
        }
      }
      if (!result.experience) {
        for (const f of expFields) {
          const val = cur[f];
          if (typeof val === "string" && val.length > 1 && val.length < 80) {
            result.experience = val;
            break;
          } else if (val && typeof val === "object" && typeof val.text === "string") {
            result.experience = val.text;
            break;
          } else if (typeof val === "number" && val >= 0 && val <= 50) {
            result.experience = `${val}+ years`;
            break;
          }
        }
        if (!result.experience) {
          const attrs = cur.attributes || cur.jobAttributes;
          if (Array.isArray(attrs)) {
            for (const attr of attrs) {
              if (attr && /experience|exp/i.test(attr.label || "") && attr.value) {
                result.experience = String(attr.value);
                break;
              }
            }
          }
        }
      }
      if (result.dateIso && result.companyName && result.salary) break;
      if (Array.isArray(cur)) {
        for (const it of cur) stack.push({ obj: it, depth: depth + 1 });
      } else {
        for (const v of Object.values(cur)) {
          if (v && typeof v === "object") stack.push({ obj: v, depth: depth + 1 });
        }
      }
    }
    return result;
  }
  function scanObject(obj, path, results, seen, depth, maxDepth) {
    if (depth > maxDepth || !obj || typeof obj !== "object" || seen.has(obj)) return;
    seen.add(obj);
    try {
      const jk = obj.jk || obj.jobKey || obj.jobkey || obj.id;
      if (typeof jk === "string" && jobKeyLike(jk)) {
        const info = extractJobFieldsInSubtree(obj);
        if (info.dateIso) {
          const { _debugObj, ...cleanInfo } = info;
          const dataStr = JSON.stringify(cleanInfo);
          if (foundJobs.get(jk) !== dataStr) {
            foundJobs.set(jk, dataStr);
            results.push({ jk, ...cleanInfo });
          }
        }
      }
      if (!Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj)) {
          if (jobKeyLike(k) && v && typeof v === "object") {
            const info = extractJobFieldsInSubtree(v);
            if (info.dateIso) {
              const { _debugObj, ...cleanInfo } = info;
              const dataStr = JSON.stringify(cleanInfo);
              if (foundJobs.get(k) !== dataStr) {
                foundJobs.set(k, dataStr);
                results.push({ jk: k, ...cleanInfo });
              }
            }
          }
        }
      }
      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          scanObject(obj[i], `${path}[${i}]`, results, seen, depth + 1, maxDepth);
        }
      } else {
        for (const [k, v] of Object.entries(obj)) {
          if (v && typeof v === "object") {
            scanObject(v, `${path}.${k}`, results, seen, depth + 1, maxDepth);
          }
        }
      }
    } catch (e) {
    }
  }
  function scanForDates() {
    const results = [];
    const seen = new Set();
    try {
      const mosaicResults = window?.mosaic?.providerData?.["mosaic-provider-jobcards"]?.metaData?.mosaicProviderJobCardsModel?.results;
      if (Array.isArray(mosaicResults)) {
        const cards = scanMosaicCards(mosaicResults);
        for (const card of cards) {
          const dataStr = JSON.stringify(card);
          if (foundJobs.get(card.jk) !== dataStr) {
            foundJobs.set(card.jk, dataStr);
            results.push(card);
          }
        }
        for (const r of mosaicResults) {
          if (r && typeof r === "object") seen.add(r);
        }
      }
    } catch (e) {
    }
    const knownPaths = [
      "mosaic",
      "_initialData",
      "__NEXT_DATA__",
      "__remixContext",
      "__PRELOADED_STATE__",
      "initialState",
      "pageData",
      "window.__data"
    ];
    for (const path of knownPaths) {
      try {
        const obj = window[path];
        if (obj) scanObject(obj, `window.${path}`, results, seen, 0, 25);
      } catch (e) {
      }
    }
    try {
      for (const key of Object.keys(window)) {
        if (key.startsWith("_") || key.includes("mosaic") || key.includes("data") || key.includes("state") || key.includes("props")) {
          try {
            const obj = window[key];
            if (obj && typeof obj === "object") scanObject(obj, `window.${key}`, results, seen, 0, 25);
          } catch (e) {
          }
        }
      }
    } catch (e) {
    }
    try {
      const scripts = document.querySelectorAll('script[type="application/ld+json"], script[type="application/json"], script:not([src])');
      for (const script of scripts) {
        const text = script.textContent?.trim();
        if (!text || text.length < 50 || text.length > 5e5) continue;
        const jkMatches = text.matchAll(/"(?:jk|jobKey|jobkey)"\s*:\s*"([a-f0-9]{16})"/gi);
        for (const m of jkMatches) {
          const jk = m[1];
          try {
            const json = JSON.parse(text);
            scanObject(json, "script-json", results, seen, 0, 25);
          } catch {
            const dateMatch = text.match(new RegExp(`"${jk}"[^}]*?"(?:datePosted|age|ageInDays)"\\s*:\\s*["']?([^"',}]+)`, "i"));
            const companyMatch = text.match(new RegExp(`"${jk}"[^}]*?"(?:companyName|employerName)"\\s*:\\s*["']?([^"',}]+)`, "i"));
            if (dateMatch) {
              const val = dateMatch[1];
              const iso = toIsoIfPossible(val) || (parseInt(val, 10) >= 0 ? toIsoFromAgeDays(parseInt(val, 10)) : null);
              if (iso) {
                const info = { dateIso: iso, companyName: companyMatch ? companyMatch[1] : void 0 };
                const dataStr = JSON.stringify(info);
                if (foundJobs.get(jk) !== dataStr) {
                  foundJobs.set(jk, dataStr);
                  results.push({ jk, ...info });
                }
              }
            }
          }
        }
      }
    } catch (e) {
    }
    if (results.length > 0) {
      post("JOB_DATES", { payload: results });
    }
  }
  function installFetchHook() {
    if (window.__nizviewerHooked) return;
    window.__nizviewerHooked = true;
    const origFetch = window.fetch;
    window.fetch = async function(...args) {
      const res = await origFetch.apply(this, args);
      try {
        const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
        if (typeof url === "string" && (url.includes("graphql") || url.includes("/api/") || url.includes("id=") || url.includes("viewjob") || url.includes("mosaic") || url.includes("/rpc/") || url.includes("serpapi") || url.includes("indeed.com") && url.includes("jk="))) {
          const clone = res.clone();
          clone.json().then((json) => {
            const results = [];
            const seen = new Set();
            try {
              const mosaicR = json?.metaData?.mosaicProviderJobCardsModel?.results || json?.mosaicProviderJobCardsModel?.results;
              if (Array.isArray(mosaicR)) {
                const cards = scanMosaicCards(mosaicR);
                for (const card of cards) {
                  const dataStr = JSON.stringify(card);
                  if (foundJobs.get(card.jk) !== dataStr) {
                    foundJobs.set(card.jk, dataStr);
                    results.push(card);
                  }
                }
              }
            } catch {
            }
            scanObject(json, "fetch-json", results, seen, 0, 25);
            if (results.length) post("JOB_DATES", { payload: results });
          }).catch(() => {
            if (url.includes("viewjob") || url.includes("jk=")) {
              res.clone().text().then((html) => {
                if (!html) return;
                const text = html.replace(/<[^>]+>/g, " ").replace(/&[a-z#\d]+;/gi, " ").replace(/\s+/g, " ");
                const jkM = url.match(/[?&]jk=([a-f0-9]{16})/i);
                if (!jkM) return;
                const jk = jkM[1];
                const shift = classifyShift(text);
                let workSetup;
                const setupLabelM = text.match(/(?:Location|Set[\s-]?up|Arrangement|Work\s+Setup|Type|Working\s+Arrangement|Basis|Environment)[\s\-:]*([^.,\n]{3,40})/i);
                if (setupLabelM) {
                  const v = setupLabelM[1].toLowerCase();
                  if (v.includes("hybrid") || v.includes("hyrbid") || v.includes("mixed")) workSetup = "Hybrid";
                  else if (v.includes("remote") || v.includes("wfh") || v.includes("home-based") || v.includes("remotely")) workSetup = "Remote";
                  else if (v.includes("onsite") || v.includes("on-site") || v.includes("office") || v.includes("person") || v.includes("in-person")) workSetup = "Onsite";
                }
                if (!workSetup) {
                  if (/\bHybrid\s+(?:work|arrangement|set[\s-]?up)\b/i.test(text) || /\bHyrbid\b/i.test(text)) workSetup = "Hybrid";
                  else if (/\bOn-?site\b/i.test(text) && /\bHybrid\b/i.test(text)) workSetup = "Hybrid";
                  else if (/\bHome-based\b/i.test(text) || /\bRemote\s+work\b/i.test(text)) workSetup = "Remote";
                }
                if (!workSetup) {
                  if (/[|·•]\s*Remote\s*[|·•]?/i.test(text) || /\bRemote\b\s*[|·•—]/.test(text)) workSetup = "Remote";
                  else if (/\bHybrid\b\s*[|·•—]/.test(text) || /\bHybrid\s+work\b/i.test(text)) workSetup = "Hybrid";
                  else if (/\bOn-?site\b\s*[|·•—]/.test(text) || /\bOn-?site\b/i.test(text) || /\bIn-office\b/i.test(text)) workSetup = "Onsite";
                }
                if (!workSetup && /\bno\s+remote\b/i.test(text)) workSetup = "Onsite";
                const yearNums = [];
                const rangePat = /(\d+(?:\.\d+)?)\s*(?:to|[-–—])\s*(\d+(?:\.\d+)?)\s*(?:year|yr)s?/gi;
                for (const m of text.matchAll(rangePat)) {
                  yearNums.push(parseFloat(m[1]), parseFloat(m[2]));
                }
                const orMorePat = /(?:at\s+least|minimum\s+of|min)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:or)?\s*more\s*(?:year|yr)s?/gi;
                for (const m of text.matchAll(orMorePat)) {
                  const val = parseFloat(m[1] || m[2]);
                  if (!isNaN(val)) yearNums.push(val);
                }
                const standalonePat = /(\d+(?:\.\d+)?)\s*(?:\+)?\s*(?:year|yr)s?/gi;
                let exM;
                while ((exM = standalonePat.exec(text)) !== null) {
                  const val = parseFloat(exM[1]);
                  const st = Math.max(0, exM.index - 80);
                  const en = Math.min(text.length, exM.index + 120);
                  const ctx = text.substring(st, en).toLowerCase();
                  if (/\b(?:exp|experience|required|requirements|minimum|min|at\s+least|plus|prefer)\b/.test(ctx)) {
                    yearNums.push(val);
                  }
                }
                const valid = yearNums.filter((n) => n >= 0.5 && n <= 25);
                let experience;
                if (valid.length > 0) {
                  const unique = Array.from(new Set(valid)).sort((a, b) => a - b);
                  const min = unique[0];
                  const max = unique[unique.length - 1];
                  experience = min === max ? `${min}+ yrs` : `${min}\u2013${max} yrs`;
                }
                if (!experience && /entry[\s-]*level|no\s+exp|fresh\s*grad|0\s+exp/i.test(text)) {
                  experience = "Entry Level";
                }
                if (shift || experience || workSetup) {
                  post("JOB_DATES", { payload: [{ jk, shift, experience, workSetup }] });
                }
              }).catch(() => {
              });
            }
          });
        }
      } catch {
      }
      return res;
    };
  }
  installFetchHook();
  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (!d || d.source !== "nizviewer" || d.type !== "INTERESTED_JKS") return;
    scanForDates();
  });
  setInterval(scanForDates, 2e3);
  scanForDates();
  setTimeout(scanForDates, 500);
})();
