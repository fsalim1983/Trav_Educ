"use strict";
var FetMANormalize = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/lib/fet-ma-normalize.ts
  var fet_ma_normalize_exports = {};
  __export(fet_ma_normalize_exports, {
    MA_DAYS: () => MA_DAYS,
    MA_HOURS: () => MA_HOURS,
    MA_REAL_DAYS: () => MA_REAL_DAYS,
    MA_REAL_HOURS: () => MA_REAL_HOURS,
    isMorningsAfternoonsFile: () => isMorningsAfternoonsFile,
    normalizeFetMA: () => normalizeFetMA,
    summarizeFet: () => summarizeFet,
    validateFetDaysAndHours: () => validateFetDaysAndHours
  });
  var MA_DAYS = [
    { name: "01 \u0627\u0644\u0623\u062D\u062F \u0635", longName: "\u0627\u0644\u0623\u062D\u062F \u0635\u0628\u0627\u062D\u0627", real: "\u0627\u0644\u0623\u062D\u062F", half: "s" },
    { name: "02 \u0627\u0644\u0623\u062D\u062F \u0645", longName: "\u0627\u0644\u0623\u062D\u062F \u0645\u0633\u0627\u0621\u0627", real: "\u0627\u0644\u0623\u062D\u062F", half: "m" },
    { name: "03 \u0627\u0644\u0627\u062B\u0646\u064A\u0646 \u0635", longName: "\u0627\u0644\u0625\u062B\u0646\u064A\u0646 \u0635\u0628\u0627\u062D\u0627", real: "\u0627\u0644\u0627\u062B\u0646\u064A\u0646", half: "s" },
    { name: "04 \u0627\u0644\u0627\u062B\u0646\u064A\u0646 \u0645", longName: "\u0627\u0644\u0625\u062B\u0646\u064A\u0646 \u0645\u0633\u0627\u0621\u0627", real: "\u0627\u0644\u0627\u062B\u0646\u064A\u0646", half: "m" },
    { name: "05 \u0627\u0644\u062B\u0644\u0627\u062B\u0627\u0621 \u0635", longName: "\u0627\u0644\u062B\u0644\u0627\u062B\u0627\u0621 \u0635\u0628\u0627\u062D\u0627", real: "\u0627\u0644\u062B\u0644\u0627\u062B\u0627\u0621", half: "s" },
    { name: "06 \u0627\u0644\u062B\u0644\u0627\u062B\u0627\u0621 \u0645", longName: "\u0627\u0644\u062B\u0644\u0627\u062B\u0627\u0621 \u0645\u0633\u0627\u0621\u0627", real: "\u0627\u0644\u062B\u0644\u0627\u062B\u0627\u0621", half: "m" },
    { name: "07 \u0627\u0644\u0627\u0631\u0628\u0639\u0627\u0621 \u0635", longName: "\u0627\u0644\u0623\u0631\u0628\u0639\u0627\u0621 \u0635\u0628\u0627\u062D\u0627", real: "\u0627\u0644\u0623\u0631\u0628\u0639\u0627\u0621", half: "s" },
    { name: "08 \u0627\u0644\u0627\u0631\u0628\u0639\u0627\u0621 \u0645", longName: "\u0627\u0644\u0623\u0631\u0628\u0639\u0627\u0621 \u0645\u0633\u0627\u0621\u0627", real: "\u0627\u0644\u0623\u0631\u0628\u0639\u0627\u0621", half: "m" },
    { name: "09 \u0627\u0644\u062E\u0645\u064A\u0633 \u0635", longName: "\u0627\u0644\u062E\u0645\u064A\u0633 \u0635\u0628\u0627\u062D\u0627", real: "\u0627\u0644\u062E\u0645\u064A\u0633", half: "s" },
    { name: "10 \u0627\u0644\u062E\u0645\u064A\u0633 \u0645", longName: "\u0627\u0644\u062E\u0645\u064A\u0633 \u0645\u0633\u0627\u0621\u0627", real: "\u0627\u0644\u062E\u0645\u064A\u0633", half: "m" }
  ];
  var MA_REAL_DAYS = [
    { name: "\u0627\u0644\u0623\u062D\u062F", longName: "\u0627\u0644\u0623\u062D\u062F" },
    { name: "\u0627\u0644\u0627\u062B\u0646\u064A\u0646", longName: "\u0627\u0644\u0627\u062B\u0646\u064A\u0646" },
    { name: "\u0627\u0644\u062B\u0644\u0627\u062B\u0627\u0621", longName: "\u0627\u0644\u062B\u0644\u0627\u062B\u0627\u0621" },
    { name: "\u0627\u0644\u0623\u0631\u0628\u0639\u0627\u0621", longName: "\u0627\u0644\u0623\u0631\u0628\u0639\u0627\u0621" },
    { name: "\u0627\u0644\u062E\u0645\u064A\u0633", longName: "\u0627\u0644\u062E\u0645\u064A\u0633" }
  ];
  var MA_HOURS = [
    { name: "H1", longName: "08:00" },
    { name: "H2", longName: "09:00" },
    { name: "H3", longName: "10:00" },
    { name: "H4", longName: "11:00" }
  ];
  var MA_REAL_HOURS = [
    { name: "RH1", longName: "08:00" },
    { name: "RH2", longName: "09:00" },
    { name: "RH3", longName: "10:00" },
    { name: "RH4", longName: "11:00" },
    { name: "RH5", longName: "13:30" },
    { name: "RH6", longName: "14:30" },
    { name: "RH7", longName: "15:30" },
    { name: "RH8", longName: "16:30" }
  ];
  var REAL_DAY_KEYS = [
    { index: 0, keys: ["sun", "dimanche", "sunday", "\u0627\u0644\u0623\u062D\u062F", "\u0627\u062D\u062F"] },
    {
      index: 1,
      keys: ["mon", "lundi", "monday", "\u0627\u0644\u0625\u062B\u0646\u064A\u0646", "\u0627\u0644\u0627\u062B\u0646\u064A\u0646", "\u0625\u062B\u0646\u064A\u0646", "\u0627\u062B\u0646\u064A\u0646", "\u0627\u0644\u0625\u062A\u0646\u064A\u0646"]
    },
    { index: 2, keys: ["tue", "mardi", "tuesday", "\u0627\u0644\u062B\u0644\u0627\u062B\u0627\u0621", "\u062B\u0644\u0627\u062B\u0627\u0621"] },
    {
      index: 3,
      keys: ["wed", "mercredi", "wednesday", "\u0627\u0644\u0623\u0631\u0628\u0639\u0627\u0621", "\u0627\u0644\u0627\u0631\u0628\u0639\u0627\u0621", "\u0623\u0631\u0628\u0639\u0627\u0621", "\u0627\u0631\u0628\u0639\u0627\u0621"]
    },
    { index: 4, keys: ["thu", "jeudi", "thursday", "\u0627\u0644\u062E\u0645\u064A\u0633", "\u062E\u0645\u064A\u0633"] }
  ];
  var HOUR_TABLE = [
    { keys: ["h1", "rh1"], hourIndex: 0, half: null },
    { keys: ["h2", "rh2"], hourIndex: 1, half: null },
    { keys: ["h3", "rh3"], hourIndex: 2, half: null },
    { keys: ["h4", "rh4"], hourIndex: 3, half: null },
    { keys: ["rh5"], hourIndex: 0, half: "m" },
    { keys: ["rh6"], hourIndex: 1, half: "m" },
    { keys: ["rh7"], hourIndex: 2, half: "m" },
    { keys: ["rh8"], hourIndex: 3, half: "m" },
    { keys: ["08:00-09:00", "08:00", "8:00"], hourIndex: 0, half: "s" },
    { keys: ["09:00-10:00", "09:00", "9:00"], hourIndex: 1, half: "s" },
    { keys: ["10:00-11:00", "10:00"], hourIndex: 2, half: "s" },
    { keys: ["11:00-12:00", "11:00"], hourIndex: 3, half: "s" },
    { keys: ["13:30-14:30", "13:30", "13:00-14:00", "13:00"], hourIndex: 0, half: "m" },
    { keys: ["14:30-15:30", "14:30", "14:00-15:00", "14:00"], hourIndex: 1, half: "m" },
    { keys: ["15:30-16:30", "15:30", "15:00-16:00", "15:00"], hourIndex: 2, half: "m" },
    { keys: ["16:30-17:30", "16:30", "16:00-17:00", "16:00"], hourIndex: 3, half: "m" }
  ];
  function fold(value) {
    return String(value ?? "").normalize("NFKC").replace(/[إأآٱ]/g, "\u0627").replace(/ى/g, "\u064A").replace(/ة/g, "\u0647").replace(/[\u0640\u200f\u200e]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  }
  function inner(xml, tag) {
    const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return m ? m[1] : null;
  }
  function namesIn(section) {
    if (!section) return [];
    return [...section.matchAll(/<Name>([\s\S]*?)<\/Name>/g)].map((m) => m[1].trim());
  }
  function isMorningsAfternoonsFile(xml) {
    if (!xml) return false;
    if (xml.includes("<Mode>Mornings_Afternoons</Mode>")) return true;
    const days = namesIn(inner(xml, "Days_List"));
    if (days.length === 10) {
      const folded = days.map(fold);
      if (folded.some((d) => d.includes("\u0635") || d.endsWith(" s") || d.includes("morning"))) {
        return true;
      }
      if (folded.some((d) => d.includes("\u0645") || d.includes("afternoon"))) return true;
    }
    if (/(<Day>|<Preferred_Day>)(sun|mon|tue|wed|thu)(<\/Day>|<\/Preferred_Day>)/i.test(xml)) {
      if (days.length >= 10) return true;
    }
    return false;
  }
  function parseHalfFromDay(raw) {
    const t = fold(raw);
    if (/\b(morning|-s|صباحا|صباح)\b/.test(t) || t.endsWith(" \u0635") || t.endsWith("\u0635")) return "s";
    if (/\b(afternoon|-m|مساءا|مساء)\b/.test(t) || t.endsWith(" \u0645") || t.endsWith("\u0645")) return "m";
    const num = t.match(/^0?(\d{1,2})\b/);
    if (num) {
      const n = Number(num[1]);
      if (n >= 1 && n <= 10) return n % 2 === 1 ? "s" : "m";
    }
    return null;
  }
  function parseRealIndex(raw) {
    const t = fold(raw);
    const num = t.match(/^0?(\d{1,2})\b/);
    if (num) {
      const n = Number(num[1]);
      if (n >= 1 && n <= 10) return Math.floor((n - 1) / 2);
    }
    for (const row of REAL_DAY_KEYS) {
      for (const key of row.keys) {
        const k = fold(key);
        if (t === k || t.startsWith(k + " ") || t.startsWith(k + "-") || t.startsWith(k)) {
          return row.index;
        }
      }
    }
    const id = t.replace(/[^a-z]/g, "").slice(0, 3);
    const map = {
      sun: 0,
      dim: 0,
      mon: 1,
      lun: 1,
      tue: 2,
      mar: 2,
      wed: 3,
      mer: 3,
      thu: 4,
      jeu: 4
    };
    if (id in map) return map[id];
    return null;
  }
  function parseHour(raw) {
    const t = fold(raw);
    for (const row of HOUR_TABLE) {
      for (const key of row.keys) {
        if (t === fold(key)) return { hourIndex: row.hourIndex, half: row.half };
      }
    }
    const asNum = Number(t);
    if (Number.isInteger(asNum) && asNum >= 0 && asNum <= 7) {
      return { hourIndex: asNum % 4, half: asNum >= 4 ? "m" : "s" };
    }
    return null;
  }
  function resolveSlot(dayRaw, hourRaw) {
    const dayHalf = parseHalfFromDay(dayRaw);
    const realIndex = parseRealIndex(dayRaw);
    const hour = parseHour(hourRaw);
    if (realIndex == null || hour == null) return null;
    let half = dayHalf;
    if (half && hour.half && half !== hour.half) {
      return null;
    }
    if (!half) half = hour.half ?? "s";
    return { realIndex, half, hourIndex: hour.hourIndex };
  }
  function canonical(slot) {
    const dayIndex = slot.realIndex * 2 + (slot.half === "m" ? 1 : 0);
    return {
      day: MA_DAYS[dayIndex].name,
      hour: MA_HOURS[slot.hourIndex].name
    };
  }
  function replaceSection(xml, tag, body) {
    const re = new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`);
    if (re.test(xml)) return xml.replace(re, body);
    return xml;
  }
  function insertAfter(xml, afterTag, snippet) {
    const re = new RegExp(`</${afterTag}>`);
    if (!re.test(xml)) return xml;
    return xml.replace(re, `</${afterTag}>
${snippet}`);
  }
  function buildDaysList() {
    const days = MA_DAYS.map(
      (d) => `  <Day>
    <Name>${d.name}</Name>
    <Long_Name>${d.longName}</Long_Name>
  </Day>`
    ).join("\n");
    return `<Days_List>
  <Number_of_Days>10</Number_of_Days>
${days}
</Days_List>`;
  }
  function buildRealDaysList() {
    const days = MA_REAL_DAYS.map(
      (d) => `  <Real_Day>
    <Name>${d.name}</Name>
    <Long_Name>${d.longName}</Long_Name>
  </Real_Day>`
    ).join("\n");
    return `<Real_Days_List>
  <Number_of_Real_Days>5</Number_of_Real_Days>
${days}
</Real_Days_List>`;
  }
  function buildHoursList() {
    const hours = MA_HOURS.map(
      (h) => `  <Hour>
    <Name>${h.name}</Name>
    <Long_Name>${h.longName}</Long_Name>
  </Hour>`
    ).join("\n");
    return `<Hours_List>
  <Number_of_Hours>4</Number_of_Hours>
${hours}
</Hours_List>`;
  }
  function buildRealHoursList() {
    const hours = MA_REAL_HOURS.map(
      (h) => `  <Real_Hour>
    <Name>${h.name}</Name>
    <Long_Name>${h.longName}</Long_Name>
  </Real_Hour>`
    ).join("\n");
    return `<Real_Hours_List>
  <Number_of_Real_Hours>8</Number_of_Real_Hours>
${hours}
</Real_Hours_List>`;
  }
  function rewriteTimePairs(xml, wrapperTag, dayTag, hourTag) {
    const re = new RegExp(`<${wrapperTag}>([\\s\\S]*?)</${wrapperTag}>`, "g");
    return xml.replace(re, (all, body) => {
      const dm = body.match(new RegExp(`<${dayTag}>([\\s\\S]*?)</${dayTag}>`));
      const hm = body.match(new RegExp(`<${hourTag}>([\\s\\S]*?)</${hourTag}>`));
      if (!dm || !hm) return all;
      const slot = resolveSlot(dm[1].trim(), hm[1].trim());
      if (!slot) return "";
      const c = canonical(slot);
      const next = body.replace(dm[0], `<${dayTag}>${c.day}</${dayTag}>`).replace(hm[0], `<${hourTag}>${c.hour}</${hourTag}>`);
      return `<${wrapperTag}>${next}</${wrapperTag}>`;
    });
  }
  function updateCount(xml, constraintTag, itemTag, countTag) {
    const re = new RegExp(`<${constraintTag}>([\\s\\S]*?)</${constraintTag}>`, "g");
    return xml.replace(re, (all, body) => {
      const n = (body.match(new RegExp(`<${itemTag}>`, "g")) || []).length;
      if (n === 0) return "";
      let next = body;
      if (new RegExp(`<${countTag}>`).test(next)) {
        next = next.replace(new RegExp(`<${countTag}>[\\s\\S]*?</${countTag}>`), `<${countTag}>${n}</${countTag}>`);
      }
      return `<${constraintTag}>${next}</${constraintTag}>`;
    });
  }
  function injectTeacherBehavior(xml) {
    // This field belongs to teacher definitions, not activity teacher references.
    // First clean legacy malformed files, but only inside Activities_List.
    let out = xml.replace(/<Activities_List>([\s\S]*?)<\/Activities_List>/g, (all, body) => {
      const nextBody = body.replace(/<Teacher>([\s\S]*?)<\/Teacher>/g, (teacher, teacherBody) => {
        const cleanBody = teacherBody.replace(/\s*<Mornings_Afternoons_Behavior>[\s\S]*?<\/Mornings_Afternoons_Behavior>/g, "");
        return `<Teacher>${cleanBody}</Teacher>`;
      });
      return `<Activities_List>${nextBody}</Activities_List>`;
    });
    // Add the field only to teacher definitions in Teachers_List.
    return out.replace(/<Teachers_List>([\s\S]*?)<\/Teachers_List>/g, (all, body) => {
      const nextBody = body.replace(/<Teacher>([\s\S]*?)<\/Teacher>/g, (teacher, teacherBody) => {
        if (teacherBody.includes("Mornings_Afternoons_Behavior")) return teacher;
        let next = teacherBody;
        if (next.includes("<Target_Number_of_Hours>")) {
          next = next.replace(
            "<Target_Number_of_Hours>",
            "<Mornings_Afternoons_Behavior>Unrestricted</Mornings_Afternoons_Behavior>\n    <Target_Number_of_Hours>"
          );
        } else if (next.includes("</Name>")) {
          next = next.replace(
            "</Name>",
            "</Name>\n    <Mornings_Afternoons_Behavior>Unrestricted</Mornings_Afternoons_Behavior>"
          );
        } else {
          next = `
    <Mornings_Afternoons_Behavior>Unrestricted</Mornings_Afternoons_Behavior>${next}`;
        }
        return `<Teacher>${next}</Teacher>`;
      });
      return `<Teachers_List>${nextBody}</Teachers_List>`;
    });
  }
  function convertMaxHoursDaily(xml) {
    return xml.replace(/<ConstraintTeacherMaxHoursDaily>/g, "<ConstraintTeacherMaxHoursDailyRealDays>").replace(/<\/ConstraintTeacherMaxHoursDaily>/g, "</ConstraintTeacherMaxHoursDailyRealDays>");
  }
  function addAllowEmptyDays(xml) {
    return xml.replace(
      /<ConstraintTeacherMinHoursDaily>([\s\S]*?)<\/ConstraintTeacherMinHoursDaily>/g,
      (all, body) => {
        if (body.includes("Allow_Empty_Days")) return all;
        const next = body.includes("<Active>") ? body.replace("<Active>", "<Allow_Empty_Days>true</Allow_Empty_Days>\n    <Active>") : `${body}
    <Allow_Empty_Days>true</Allow_Empty_Days>`;
        return `<ConstraintTeacherMinHoursDaily>${next}</ConstraintTeacherMinHoursDaily>`;
      }
    );
  }
  function ensureMode(xml) {
    if (xml.includes("<Mode>Mornings_Afternoons</Mode>")) return xml;
    return xml.replace(/<fet([^>]*)>/, `<fet$1>
  <Mode>Mornings_Afternoons</Mode>`);
  }
  function collapseBlankLines(xml) {
    return xml.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n");
  }
  function validateFetDaysAndHours(xml) {
    const issues = [];
    const dayNames = new Set(namesIn(inner(xml, "Days_List")));
    const hourSection = inner(xml, "Hours_List") ?? "";
    const hourNames = new Set(
      [...hourSection.matchAll(/<Hour>[\s\S]*?<Name>([\s\S]*?)<\/Name>/g)].map((m) => m[1].trim())
    );
    const days = [...xml.matchAll(/<(Day|Preferred_Day)>([\s\S]*?)<\/\1>/g)];
    for (const m of days) {
      const name = m[2].trim();
      if (name.includes("<")) continue;
      if (!dayNames.has(name)) {
        issues.push({ level: "error", message: `\u0627\u0644\u064A\u0648\u0645 "${name}" \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F \u0641\u064A \u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0623\u064A\u0627\u0645` });
      }
    }
    const hours = [...xml.matchAll(/<(Hour|Preferred_Hour)>([\s\S]*?)<\/\1>/g)].filter((m) => {
      return !m[2].includes("<Name>");
    });
    for (const m of hours) {
      const name = m[2].trim();
      if (!name || name.includes("<")) continue;
      if (!hourNames.has(name) && !name.startsWith("RH")) {
        issues.push({ level: "error", message: `\u0627\u0644\u062D\u0635\u0629 "${name}" \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F\u0629 \u0641\u064A \u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0633\u0627\u0639\u0627\u062A` });
      }
    }
    if (!xml.includes("<Mode>Mornings_Afternoons</Mode>") && isMorningsAfternoonsFile(xml)) {
      issues.push({ level: "warning", message: "\u0645\u0644\u0641 \u0635\u0628\u0627\u062D/\u0645\u0633\u0627\u0621 \u0628\u062F\u0648\u0646 \u0648\u0633\u0645 Mode" });
    }
    return uniqueIssues(issues);
  }
  function uniqueIssues(issues) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const i of issues) {
      const k = `${i.level}:${i.message}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(i);
    }
    return out;
  }
  function normalizeFetMA(xml) {
    if (!xml || typeof xml !== "string") return xml;
    if (!isMorningsAfternoonsFile(xml)) return xml;
    let out = xml.replace(/^\uFEFF/, "");
    out = ensureMode(out);
    out = replaceSection(out, "Days_List", buildDaysList());
    if (out.includes("<Real_Days_List>")) {
      out = replaceSection(out, "Real_Days_List", buildRealDaysList());
    } else {
      out = insertAfter(out, "Days_List", buildRealDaysList());
    }
    out = replaceSection(out, "Hours_List", buildHoursList());
    if (out.includes("<Real_Hours_List>")) {
      out = replaceSection(out, "Real_Hours_List", buildRealHoursList());
    } else {
      out = insertAfter(out, "Hours_List", buildRealHoursList());
    }
    out = rewriteTimePairs(out, "Not_Available_Time", "Day", "Hour");
    out = rewriteTimePairs(out, "Break_Time", "Day", "Hour");
    out = rewriteTimePairs(out, "Preferred_Time_Slot", "Preferred_Day", "Preferred_Hour");
    out = rewriteTimePairs(out, "Preferred_Starting_Time", "Preferred_Day", "Preferred_Hour");
    out = updateCount(out, "ConstraintTeacherNotAvailableTimes", "Not_Available_Time", "Number_of_Not_Available_Times");
    out = updateCount(
      out,
      "ConstraintStudentsSetNotAvailableTimes",
      "Not_Available_Time",
      "Number_of_Not_Available_Times"
    );
    out = updateCount(out, "ConstraintBreakTimes", "Break_Time", "Number_of_Break_Times");
    out = updateCount(
      out,
      "ConstraintActivityPreferredTimeSlots",
      "Preferred_Time_Slot",
      "Number_of_Preferred_Time_Slots"
    );
    out = updateCount(
      out,
      "ConstraintActivitiesPreferredStartingTimes",
      "Preferred_Starting_Time",
      "Number_of_Preferred_Starting_Times"
    );
    out = out.replace(/<(Day|Preferred_Day)>([\s\S]*?)<\/\1>/g, (all, tag, raw) => {
      if (raw.includes("<")) return all;
      const v = raw.trim();
      if (MA_DAYS.some((d) => d.name === v)) return all;
      const half = parseHalfFromDay(v) ?? "s";
      const realIndex = parseRealIndex(v);
      if (realIndex == null) return all;
      const name = MA_DAYS[realIndex * 2 + (half === "m" ? 1 : 0)].name;
      return `<${tag}>${name}</${tag}>`;
    });
    out = out.replace(/<(Hour|Preferred_Hour)>([\s\S]*?)<\/\1>/g, (all, tag, raw) => {
      if (raw.includes("<")) return all;
      const v = raw.trim();
      if (MA_HOURS.some((h) => h.name === v)) return all;
      const hour = parseHour(v);
      if (!hour) return all;
      return `<${tag}>${MA_HOURS[hour.hourIndex].name}</${tag}>`;
    });
    out = injectTeacherBehavior(out);
    out = convertMaxHoursDaily(out);
    out = addAllowEmptyDays(out);
    return collapseBlankLines(out);
  }
  function summarizeFet(xml) {
    const days = namesIn(inner(xml, "Days_List"));
    const hours = namesIn(inner(xml, "Hours_List"));
    return {
      version: xml.match(/<fet version="([^"]+)"/)?.[1] ?? "",
      mode: inner(xml, "Mode")?.trim() ?? "Official",
      days,
      hours,
      hasRealDays: xml.includes("<Real_Days_List>"),
      hasRealHours: xml.includes("<Real_Hours_List>"),
      issues: validateFetDaysAndHours(xml)
    };
  }
  if (typeof globalThis !== "undefined") {
    globalThis.__normalizeFetMA = normalizeFetMA;
  }
  return __toCommonJS(fet_ma_normalize_exports);
})();
