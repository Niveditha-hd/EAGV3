const ROBINAGE_NEWS_FEED = "https://www.robinage.com/category/news-for-kids/feed/";

const FETCH_MS = 14000;

let sessionQuizAnswers = {};

function $(id) {
  return document.getElementById(id);
}

function showScreen(name) {
  const screens = ["screen-welcome", "screen-later", "screen-load", "screen-main", "screen-error"];
  for (const id of screens) {
    const el = $(id);
    if (el) el.classList.toggle("hidden", id !== name);
  }
}

function dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}

function stripHtml(raw) {
  if (!raw) return "";
  return raw
    .replace(/<!\[CDATA\[/gi, "")
    .replace(/\]\]>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function shorten(text, max = 76) {
  const t = (text || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function parseRSS(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) return [];
  const items = [...doc.querySelectorAll("channel > item, rss > channel > item")];
  const out = [];
  for (const item of items) {
    const titleEl = item.querySelector("title");
    const descEl = item.querySelector("description");
    let link = "";
    const linkEl = item.querySelector("link");
    if (linkEl) {
      link = linkEl.textContent?.trim() || linkEl.getAttribute("href") || "";
    }
    const title = stripHtml(titleEl?.textContent || "");
    const description = stripHtml(descEl?.textContent || "");
    const categories = [...item.querySelectorAll("category")]
      .map((c) => stripHtml(c.textContent || ""))
      .filter(Boolean);
    if (title) out.push({ title, description, link, categories });
  }
  return out;
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(tid);
  }
}

async function loadJson(path) {
  const url = chrome.runtime.getURL(path);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Missing ${path}`);
  return res.json();
}

function textBlob(it) {
  return `${it.title} ${it.description} ${(it.categories || []).join(" ")}`.toLowerCase();
}

function cat(it, re) {
  return (it.categories || []).some((c) => re.test(c));
}

function isKidNewsItem(it) {
  const blob = (it.categories || []).join(" ").toLowerCase();
  if (/creative writing|wall of fame|puzzle|activity|recipe|contest|junior/i.test(blob)) return false;
  return true;
}

function buildRobinAgeBundle(allItems) {
  const usable = allItems.filter(isKidNewsItem);
  if (usable.length < 6) {
    throw new Error("RobinAge returned too few stories. Try again soon.");
  }

  const used = new Set();

  function take(predicate, limit) {
    const out = [];
    for (const item of usable) {
      if (out.length >= limit) break;
      if (!item.link || used.has(item.link)) continue;
      if (predicate(item)) {
        out.push(item);
        used.add(item.link);
      }
    }
    return out;
  }

  const sciPred = (it) =>
    cat(it, /space\s*&\s*science|science|technology/i) ||
    /\b(scientists?|fossil|dinosaur|species|planet|space station|telescope|satellite)\b/i.test(textBlob(it));

  const sportPred = (it) => cat(it, /^sports?$/i);
  const sportLoose = (it) =>
    /\b(sport|cricket|football|hockey|tennis|olympics?|world cup|match|player|team|stadium|tournament)\b/i.test(
      textBlob(it),
    );

  const natPred = (it) =>
    cat(it, /india news|world news|news makers|^india$/i) ||
    cat(it, /green news|school news|environment/i);

  let science = take(sciPred, 1);
  let sports = take(sportPred, 2);
  let national = take(natPred, 3);

  if (science.length < 1) {
    science = science.concat(
      take(
        (it) =>
          /\b(science|scientist|research|climate|energy|animal|plant|ocean|moon|experiment|robot)\b/i.test(textBlob(it)),
        1,
      ),
    );
  }
  if (science.length < 1) {
    science = science.concat(take(() => true, 1));
  }

  if (sports.length < 2) {
    sports = sports.concat(take((it) => sportLoose(it), 2 - sports.length));
  }
  if (sports.length < 2) {
    sports = sports.concat(take(() => true, 2 - sports.length));
  }

  if (national.length < 3) {
    national = national.concat(take(() => true, 3 - national.length));
  }

  if (national.length < 3 || sports.length < 2 || science.length < 1) {
    throw new Error("Could not sort RobinAge stories into sections. Try again soon.");
  }

  return {
    national: national.slice(0, 3),
    sports: sports.slice(0, 2),
    science: science.slice(0, 1),
  };
}

async function loadAllFeeds() {
  const xml = await fetchText(ROBINAGE_NEWS_FEED);
  const items = parseRSS(xml);
  return buildRobinAgeBundle(items);
}

function buildCorpus(bundle) {
  const chunks = [];
  for (const it of [...bundle.national, ...bundle.sports, ...bundle.science]) {
    chunks.push(`${it.title} ${it.description}`.toLowerCase());
  }
  return chunks.join(" ");
}

function findRiverInNews(corpus, rivers) {
  for (const r of rivers) {
    for (const m of r.match) {
      if (corpus.includes(m.toLowerCase())) return r;
    }
  }
  return null;
}

function pickSpotlightRiver(rivers, dayIndex) {
  return rivers[dayIndex % rivers.length];
}

function pickDailyWord(words, dayIndex) {
  return words[dayIndex % words.length];
}

function pickDailyState(states, dayIndex) {
  return states[dayIndex % states.length];
}

function renderDidYouKnow(container, items, prefix) {
  container.innerHTML = "";
  items.forEach((it, i) => {
    const card = document.createElement("article");
    card.className = "did-card";
    const snippet = shorten(it.description, 140) || "Read more with a grown-up — headlines can be tricky!";
    const kidLine =
      typeof buildKidSummary === "function"
        ? buildKidSummary(it.title, it.description)
        : "Kid-sized take: Read this story with a grown-up.";
    card.innerHTML = `
      <p class="did-label">${prefix} ${i + 1}</p>
      <p class="did-title">${escapeHtml(it.title)}</p>
      <p class="kid-summary">${escapeHtml(kidLine)}</p>
      <p class="did-snippet">${escapeHtml(snippet)}</p>
    `;
    if (it.link) {
      const a = document.createElement("a");
      a.className = "did-link";
      a.href = it.link;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "Open on RobinAge (with a grown-up)";
      card.appendChild(a);
    }
    container.appendChild(card);
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrongCapitals(allStates, correctCapital, count = 3) {
  const pool = allStates.map((s) => s.capital).filter((c) => c && c !== correctCapital);
  return shuffle(pool).slice(0, count);
}

function wrongMeanings(words, correctWord, count = 3) {
  const pool = words.filter((w) => w.word !== correctWord.word).map((w) => w.meaning);
  return shuffle(pool).slice(0, count);
}

function wrongRiverNames(rivers, correctName, count = 3) {
  const pool = rivers.map((r) => r.name).filter((n) => n !== correctName);
  return shuffle(pool).slice(0, count);
}

const BOILERPLATE_RE = /appeared first on|the post <|read more|subscribe|image source:|facebook\.com|youtube\.com\/watch|click here|bookmark\(/i;

function normalizeForCompare(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSnippetsFromItem(item) {
  let text = (item.description || "").replace(/\s+/g, " ").trim();
  if (BOILERPLATE_RE.test(text)) {
    const cut = text.split(/appeared first on/i)[0];
    if (cut.length > 30) text = cut.trim();
  }
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 18 && !/^the post\b/i.test(s));

  const chunks = [];
  for (const s of sentences) {
    const t = shorten(s, 96).trim();
    if (t.length >= 26 && t.length <= 96 && !BOILERPLATE_RE.test(t)) chunks.push(t);
  }

  if (chunks.length === 0 && item.title) {
    const u = shorten(item.title, 88);
    if (u.length >= 12) chunks.push(u);
  }
  return [...new Set(chunks)];
}

function pickBestSnippet(item) {
  const list = extractSnippetsFromItem(item);
  if (list.length === 0) return shorten(item.title || item.description || "This story", 88);
  const withNumber = list.find((s) => /\d/.test(s));
  const pick = withNumber || list[0];
  return shorten(pick, 96);
}

function allBundleItems(bundle) {
  return [...bundle.national, ...bundle.sports, ...bundle.science];
}

const PLACE_FALLBACK = shuffle([
  "Brazil",
  "Kenya",
  "Norway",
  "Thailand",
  "Mexico",
  "Argentina",
  "New Zealand",
  "Vietnam",
  "Canada",
  "France",
  "Egypt",
  "Japan",
]);

function isLikelyPlaceName(s) {
  const t = String(s).trim().replace(/[,.;:]+$/, "");
  if (t.length < 3 || t.length > 42) return false;
  const parts = t.split(/\s+/);
  if (parts.length > 5) return false;
  if (/^(the|this|these|those|a|an|most|many|several|first|second|one|two)$/i.test(parts[0])) return false;
  const badToken = /^(march|april|may|june|july|january|february|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|scientists?|researchers?|children|students?|years?|days?)$/i;
  if (parts.some((p) => badToken.test(p))) return false;
  return true;
}

function extractPrimaryLocation(item) {
  const blob = `${item.description || ""} ${item.title || ""}`;
  const patterns = [
    /\boff\s+the\s+coast\s+of\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\b/g,
    /\bin\s+the\s+state\s+of\s+([A-Z][A-Za-z]+)\b/gi,
    /\bin\s+(southern|northern|eastern|western)\s+([A-Z][A-Za-z]+)\b/gi,
    /\bnear\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\b/g,
    /\bin\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})\b/g,
  ];
  const seen = new Set();
  for (const re of patterns) {
    const r = new RegExp(re.source, "g");
    let m;
    while ((m = r.exec(blob)) !== null) {
      const cand = (m[m.length - 1] || m[1]).replace(/[,.;:]+$/, "").trim();
      const key = normalizeForCompare(cand);
      if (!key || seen.has(key)) continue;
      if (!isLikelyPlaceName(cand)) continue;
      seen.add(key);
      return cand;
    }
  }
  return null;
}

function gatherLocationDistractors(bundle, excludeLink, correctPlace, need) {
  const correctNorm = normalizeForCompare(correctPlace);
  const out = [];
  const seen = new Set([correctNorm]);
  for (const it of allBundleItems(bundle)) {
    if (it.link === excludeLink) continue;
    const p = extractPrimaryLocation(it);
    if (!p) continue;
    const n = normalizeForCompare(p);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(p);
    if (out.length >= need + 2) break;
  }
  for (const p of PLACE_FALLBACK) {
    const n = normalizeForCompare(p);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(p);
    if (out.length >= need) break;
  }
  return out.slice(0, need);
}

function tryWhereQuestion(id, item, bundle) {
  const place = extractPrimaryLocation(item);
  if (!place) return null;
  const topic = (item.title || "this story").replace(/\?/g, "").trim();
  const shortTopic = shorten(topic, 52);
  const wrong = gatherLocationDistractors(bundle, item.link, place, 6);
  const opts = shuffle([place, ...wrong.slice(0, 3)]);
  const correctIndex = opts.indexOf(place);
  if (correctIndex < 0) return null;
  return {
    id,
    text: `Where was **${shortTopic}** seen, found, or talked about in that story?`,
    options: opts,
    correctIndex,
  };
}

function tryGoldOrMedalCountQuestion(id, item, bundle) {
  const blob = `${item.title} ${item.description}`;
  const gold = blob.match(/\b(\d+)\s+gold(?:\s+medals?)?\b/i);
  const medals = blob.match(/\b(\d+)\s+medals?\b/i);
  const m = gold || medals;
  if (!m) return null;
  const correct = m[1];
  const n = parseInt(correct, 10);
  if (Number.isNaN(n) || n > 999) return null;
  const pool = new Set([correct]);
  const deltas = [1, -1, 2, -2, 3, 5, 10, 15];
  for (const d of shuffle(deltas)) {
    const v = String(Math.max(0, n + d));
    if (!pool.has(v)) pool.add(v);
    if (pool.size >= 4) break;
  }
  let pad = 0;
  while (pool.size < 4) {
    const v = String(Math.max(0, n + 20 + pad));
    if (!pool.has(v)) pool.add(v);
    pad += 1;
  }
  const opts = shuffle([...pool]);
  const correctIndex = opts.indexOf(correct);
  let text = `How many **gold** medals does this **sports** story mention?`;
  if (gold && /india/i.test(blob) && /asian|games|championship|asiad|cup\s+games/i.test(blob)) {
    text = `According to this **sports** story, how many **gold** did **India** win at the **Asian-style** contest it describes?`;
  } else if (gold) {
    text = `According to the **sports** story, how many **gold** medals does it mention?`;
  } else {
    text = `According to the **sports** story, how many **medals** (the number given) does it mention?`;
  }
  return { id, text, options: opts, correctIndex };
}

function extractNamedDiscoveries(text) {
  const out = [];
  const re = /\bnamed\s+([A-Z][a-z]+(?:\s+[a-z]{2,22})?)\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(m[1].trim());
  }
  return out;
}

function tryNamedDiscoveryQuestion(id, item, bundle) {
  const blob = item.description || "";
  const names = extractNamedDiscoveries(blob);
  if (names.length === 0) return null;
  const correct = names[0];
  const pool = new Set([correct]);
  for (const it of allBundleItems(bundle)) {
    if (it.link === item.link) continue;
    for (const n of extractNamedDiscoveries(it.description || "")) {
      if (n !== correct) pool.add(n);
    }
  }
  const wrong = shuffle([...pool].filter((x) => x !== correct)).slice(0, 3);
  if (wrong.length < 3) return null;
  const opts = shuffle([correct, ...wrong]);
  return {
    id,
    text: `In the **science** story, what name was the discovery **given** (the story says it was “named …”)?`,
    options: opts,
    correctIndex: opts.indexOf(correct),
  };
}

function buildStoryQuestion(id, item, bundle, profile, fallbackStem) {
  if (profile === "sports") {
    const g = tryGoldOrMedalCountQuestion(id, item, bundle);
    if (g && g.correctIndex >= 0) return g;
    const w = tryWhereQuestion(id, item, bundle);
    if (w && w.correctIndex >= 0) return w;
  } else if (profile === "science") {
    const n = tryNamedDiscoveryQuestion(id, item, bundle);
    if (n && n.correctIndex >= 0) return n;
    const w = tryWhereQuestion(id, item, bundle);
    if (w && w.correctIndex >= 0) return w;
  } else {
    const w = tryWhereQuestion(id, item, bundle);
    if (w && w.correctIndex >= 0) return w;
    const n = tryNamedDiscoveryQuestion(id, item, bundle);
    if (n && n.correctIndex >= 0) return n;
  }
  return makeNewsComprehensionQ(id, fallbackStem, item, bundle);
}

function worldCapitalQuestion(id, worldRows, dayIndex) {
  if (!worldRows || worldRows.length < 4) return null;
  const row = worldRows[dayIndex % worldRows.length];
  const correct = row.capital;
  const wrong = [];
  const seen = new Set([correct]);
  for (const c of shuffle(worldRows.map((r) => r.capital))) {
    if (seen.has(c)) continue;
    seen.add(c);
    wrong.push(c);
    if (wrong.length >= 3) break;
  }
  const opts = shuffle([correct, ...wrong.slice(0, 3)]);
  return {
    id,
    text: `World geography: what is the capital of **${row.country}**?`,
    options: opts,
    correctIndex: opts.indexOf(correct),
  };
}

function distractorSnippets(bundle, excludeLink, need = 3) {
  const out = [];
  const seen = new Set();
  const pool = shuffle(
    allBundleItems(bundle).filter((it) => it.link && it.link !== excludeLink),
  );
  for (const it of pool) {
    for (const s of extractSnippetsFromItem(it)) {
      const n = normalizeForCompare(s);
      if (n.length < 20) continue;
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(shorten(s, 96));
      if (out.length >= need + 4) return out;
    }
  }
  for (const it of pool) {
    const t = shorten(it.title, 88);
    const n = normalizeForCompare(t);
    if (n.length < 12 || seen.has(n)) continue;
    seen.add(n);
    out.push(t);
    if (out.length >= need + 4) break;
  }
  return out;
}

function makeNewsComprehensionQ(id, stem, targetItem, bundle) {
  const correct = pickBestSnippet(targetItem);
  const correctNorm = normalizeForCompare(correct);
  let rawWrong = distractorSnippets(bundle, targetItem.link, 12).filter(
    (s) => normalizeForCompare(s) !== correctNorm,
  );
  rawWrong = rawWrong.filter(
    (s, i, a) => a.findIndex((x) => normalizeForCompare(x) === normalizeForCompare(s)) === i,
  );

  while (rawWrong.length < 3) {
    for (const it of shuffle(allBundleItems(bundle))) {
      if (it.link === targetItem.link) continue;
      const t = shorten(it.title, 88);
      if (normalizeForCompare(t).length < 10 || normalizeForCompare(t) === correctNorm) continue;
      if (rawWrong.some((w) => normalizeForCompare(w) === normalizeForCompare(t))) continue;
      rawWrong.push(t);
      if (rawWrong.length >= 3) break;
    }
    if (rawWrong.length < 3) {
      rawWrong.push(`A detail from a different RobinAge story (${rawWrong.length + 1}).`);
    }
  }

  const options = shuffle([correct, ...rawWrong.slice(0, 3)]);
  const correctIndex = options.indexOf(correct);
  return {
    id,
    text: stem,
    options,
    correctIndex,
  };
}

function buildQuiz(bundle, statePair, wordEntry, riverHighlightName, lib) {
  const nat0 = bundle.national[0];
  const nat1 = bundle.national[1];
  const sp0 = bundle.sports[0];
  const sc0 = bundle.science[0];
  const { states: allStates, words: allWords, rivers: allRivers, worldCapitals = [] } = lib;
  const dIndex = dayOfYear(new Date());

  const questions = [];

  questions.push(
    buildStoryQuestion(
      "q1",
      nat0,
      bundle,
      "national",
      "**First** India & world story — which **detail** actually appeared in that piece?",
    ),
  );

  questions.push(
    buildStoryQuestion(
      "q2",
      nat1,
      bundle,
      "national",
      "**Second** India & world story — pick the **fact or line** that belongs to it.",
    ),
  );

  questions.push(
    buildStoryQuestion(
      "q3",
      sp0,
      bundle,
      "sports",
      "**Sports** corner — which option matches the **sports** story you read?",
    ),
  );

  questions.push(
    buildStoryQuestion(
      "q4",
      sc0,
      bundle,
      "science",
      "**Science** spark — which sentence fits **that** science article?",
    ),
  );

  const capCorrect = statePair.capital;
  const capOpts = shuffle([capCorrect, ...wrongCapitals(allStates, capCorrect)]);
  questions.push({
    id: "q5",
    text: `India geography: what is the capital of **${statePair.state}**?`,
    options: capOpts,
    correctIndex: capOpts.indexOf(capCorrect),
  });

  let wcq = worldCapitalQuestion("q6", worldCapitals, dIndex);
  if (!wcq || wcq.correctIndex < 0) {
    const correct = "Cairo";
    const opts = shuffle([correct, "Tokyo", "Paris", "Berlin"]);
    wcq = {
      id: "q6",
      text: "World geography: what is the capital of **Egypt**?",
      options: opts,
      correctIndex: opts.indexOf(correct),
    };
  }
  questions.push(wcq);

  const meanCorrect = wordEntry.meaning;
  const meanOpts = shuffle([meanCorrect, ...wrongMeanings(allWords, wordEntry)]);
  questions.push({
    id: "q7",
    text: `Vocabulary: what does **${wordEntry.word}** mean in the card above?`,
    options: meanOpts,
    correctIndex: meanOpts.indexOf(meanCorrect),
  });

  const riverCorrect = riverHighlightName;
  const riverOpts = shuffle([riverCorrect, ...wrongRiverNames(allRivers, riverCorrect)]);
  questions.push({
    id: "q8",
    text: "**Rivers** — which one did we spotlight in today’s cards?",
    options: riverOpts,
    correctIndex: riverOpts.indexOf(riverCorrect),
  });

  const answers = {};
  for (const q of questions) {
    if (q.correctIndex < 0) throw new Error("Quiz build error — try again.");
    answers[q.id] = q.correctIndex;
  }
  return { questions, answers };
}

function renderQuiz(formEl, questions, answersMap) {
  formEl.innerHTML = "";
  sessionQuizAnswers = answersMap;
  questions.forEach((q) => {
    const wrap = document.createElement("div");
    wrap.className = "quiz-q";
    const h = document.createElement("p");
    h.className = "quiz-qtext";
    h.innerHTML = q.text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    wrap.appendChild(h);
    const opts = document.createElement("div");
    opts.className = "quiz-opts";
    q.options.forEach((label, i) => {
      const id = `${q.id}_${i}`;
      const lab = document.createElement("label");
      lab.className = "quiz-opt";
      lab.htmlFor = id;
      lab.innerHTML = `<input type="radio" name="${q.id}" id="${id}" value="${i}" /> <span>${escapeHtml(label)}</span>`;
      opts.appendChild(lab);
    });
    wrap.appendChild(opts);
    formEl.appendChild(wrap);
  });
}

function scoreQuiz(formEl, answersMap) {
  let score = 0;
  const total = Object.keys(answersMap).length;
  for (const [qid, correctIdx] of Object.entries(answersMap)) {
    const picked = formEl.querySelector(`input[name="${qid}"]:checked`);
    if (picked && Number(picked.value) === correctIdx) score += 1;
  }
  return { score, total };
}

async function runMainFlow(states, words, rivers, worldCapitals) {
  showScreen("screen-load");
  $("quizResult").classList.add("hidden");
  $("btnSubmitQuiz").disabled = false;

  let bundle;
  try {
    bundle = await loadAllFeeds();
  } catch (e) {
    $("errorText").textContent =
      e.name === "AbortError"
        ? "That took too long — check your connection and try again."
        : e.message || "Something went wrong loading feeds.";
    showScreen("screen-error");
    return;
  }

  const today = new Date();
  const dIndex = dayOfYear(today);
  $("dateLine").textContent = today.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const corpus = buildCorpus(bundle);
  const riverHit = findRiverInNews(corpus, rivers);
  const spotlight = pickSpotlightRiver(rivers, dIndex);
  const riverCard = riverHit || spotlight;
  const riverHighlightName = riverHit ? riverHit.name : spotlight.name;

  const wordEntry = pickDailyWord(words, dIndex);
  const statePair = pickDailyState(states, dIndex);

  renderDidYouKnow($("nationalCards"), bundle.national, "India");
  renderDidYouKnow($("sportsCards"), bundle.sports, "Sports");
  renderDidYouKnow($("scienceCards"), bundle.science, "Science");

  $("wordCard").innerHTML = `
    <p class="word-term">${escapeHtml(wordEntry.word)}</p>
    <p class="word-mean">${escapeHtml(wordEntry.meaning)}</p>
    <p class="word-ex">Example: ${escapeHtml(wordEntry.example)}</p>
  `;

  $("stateCard").innerHTML = `
    <p class="state-pair">${escapeHtml(statePair.state)} → <span style="color:var(--accent-2)">${escapeHtml(
      statePair.capital,
    )}</span></p>
    <p class="state-hint">Tip: trace it on a map tonight — which neighbours does this state touch?</p>
  `;

  if (riverHit) {
    $("riverCard").innerHTML = `
      <p class="state-pair">River in the news: <span style="color:var(--sun)">${escapeHtml(riverHit.name)}</span></p>
      <p class="state-hint">${escapeHtml(riverHit.fact)} We spotted this river’s name in today’s headlines — neat!</p>
    `;
  } else {
    $("riverCard").innerHTML = `
      <p class="state-pair">River spotlight: <span style="color:var(--sun)">${escapeHtml(spotlight.name)}</span></p>
      <p class="state-hint">${escapeHtml(spotlight.fact)}</p>
    `;
  }

  const { questions, answers } = buildQuiz(bundle, statePair, wordEntry, riverHighlightName, {
    states,
    words,
    rivers,
    worldCapitals,
  });
  renderQuiz($("quizForm"), questions, answers);

  showScreen("screen-main");
}

function init() {
  showScreen("screen-welcome");

  $("btnYes").addEventListener("click", async () => {
    try {
      const [states, words, rivers, worldCapitals] = await Promise.all([
        loadJson("data/states.json"),
        loadJson("data/words.json"),
        loadJson("data/rivers.json"),
        loadJson("data/world-capitals.json"),
      ]);
      await runMainFlow(states, words, rivers, worldCapitals);
    } catch (e) {
      $("errorText").textContent = e.message || "Could not load local data files.";
      showScreen("screen-error");
    }
  });

  $("btnNotToday").addEventListener("click", () => showScreen("screen-later"));
  $("btnBackWelcome").addEventListener("click", () => showScreen("screen-welcome"));

  $("btnRetry").addEventListener("click", async () => {
    try {
      const [states, words, rivers, worldCapitals] = await Promise.all([
        loadJson("data/states.json"),
        loadJson("data/words.json"),
        loadJson("data/rivers.json"),
        loadJson("data/world-capitals.json"),
      ]);
      await runMainFlow(states, words, rivers, worldCapitals);
    } catch (e) {
      $("errorText").textContent = e.message || "Could not load local data files.";
      showScreen("screen-error");
    }
  });

  $("btnErrorHome").addEventListener("click", () => showScreen("screen-welcome"));

  $("btnSubmitQuiz").addEventListener("click", () => {
    const form = $("quizForm");
    const { score, total } = scoreQuiz(form, sessionQuizAnswers);
    const res = $("quizResult");
    res.classList.remove("hidden");
    const pct = Math.round((score / total) * 100);
    let cheer = "You’re a headline hero!";
    if (pct < 40) cheer = "Nice try — read the cards again and retry!";
    else if (pct < 70) cheer = "Solid work — a little more focus and you’ll ace it!";
    res.textContent = `${cheer} Score: ${score} / ${total}.`;
    $("btnSubmitQuiz").disabled = true;
  });

  $("btnRestart").addEventListener("click", () => {
    $("quizResult").classList.add("hidden");
    $("btnSubmitQuiz").disabled = false;
    showScreen("screen-welcome");
  });
}

init();
