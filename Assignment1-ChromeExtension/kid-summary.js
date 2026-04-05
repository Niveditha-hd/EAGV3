/**
 * Offline "kid summary" — rewrites RSS title + snippet into shorter, simpler English.
 * No network; safe for a 10-year-old when paired with grown-up reading time.
 */
function buildKidSummary(title, description) {
  const combined = [title, description].filter(Boolean).join(" ");
  let text = simplifyNewsText(combined);
  text = takeFirstSentences(text, 2);
  text = trimToWords(text, 55);
  text = ensureSentenceCase(text);
  if (!text) return "Kid-sized take: Ask a grown-up to read the headline with you — big news can need extra explaining.";
  if (!/[.!?]$/.test(text)) text += ".";
  return `Kid-sized take: ${text}`;
}

function simplifyNewsText(raw) {
  let t = raw.replace(/\s+/g, " ").trim();
  if (!t) return "";

  const rules = [
    [/\bthe Centre\b/gi, "the central government"],
    [/\bCentre announces\b/gi, "The government announces"],
    [/\bLok Sabha\b/g, "the Lok Sabha (a key part of Parliament)"],
    [/\bRajya Sabha\b/g, "the Rajya Sabha (another part of Parliament)"],
    [/\bParliament\b/g, "Parliament"],
    [/\bChief Minister\b/g, "the Chief Minister (the state's head leader)"],
    [/\bPrime Minister\b/g, "the Prime Minister"],
    [/\bGovernor\b/g, "the Governor"],
    [/\bCabinet\b/g, "the Cabinet (top ministers)"],
    [/\bMinistry\b/g, "ministry"],
    [/\bministry of\b/gi, "ministry of"],
    [/\bBill\b/g, "bill (a proposed new law)"],
    [/\bbill\b/g, "bill (a proposed new law)"],
    [/\blegislation\b/gi, "new laws"],
    [/\bverdict\b/gi, "court decision"],
    [/\bpolls?\b/g, "election"],
    [/\belections?\b/gi, "elections"],
    [/\bsummit\b/gi, "big meeting of leaders"],
    [/\bbilateral\b/gi, "between two countries"],
    [/\bmultilateral\b/gi, "with many countries"],
    [/\bdebris\b/gi, "broken pieces"],
    [/\bprobe\b/gi, "investigation"],
    [/\boutbreak\b/gi, "sudden spread of illness"],
    [/\bvaccine\b/gi, "vaccine (a shot that helps prevent disease)"],
    [/\binfrastructure\b/gi, "roads, trains, bridges, and power"],
    [/\bdeficit\b/gi, "shortfall (when spending is higher than income)"],
    [/\bsanctions?\b/gi, "official penalties between countries"],
    [/\bhostages?\b/gi, "people held against their will"],
    [/\bclashes?\b/gi, "fights or tense stand-offs"],
    [/\breservoir\b/gi, "water storage"],
    [/\bmonsoon\b/gi, "rainy season"],
    [/\bcyclone\b/gi, "big storm with strong wind and rain"],
    [/\bdrought\b/gi, "very dry spell with little rain"],
    [/\bwildfire\b/gi, "big outdoor fire"],
    [/\bwildfires\b/gi, "big outdoor fires"],
    [/\bspacecraft\b/gi, "space vehicle"],
    [/\bsatellite\b/gi, "satellite (a machine in space)"],
    [/\btelescope\b/gi, "telescope (a tool to see faraway things)"],
    [/\bfossil\b/gi, "very old remains of plants or animals"],
    [/\barchaeologists?\b/gi, "scientists who study old objects and places"],
    [/\bspecies\b/gi, "kind of plant or animal"],
    [/\bhabitat\b/gi, "natural home"],
    [/\bconservation\b/gi, "protecting nature"],
    [/\bsemifinals?\b/gi, "semi-finals (one step before the final match)"],
    [/\bquarter-finals?\b/gi, "quarter-finals"],
    [/\bchampionship\b/gi, "big contest to find the champion"],
    [/\btournament\b/gi, "series of matches"],
    [/\bstadium\b/gi, "big sports ground"],
    [/\bfranchise\b/gi, "team"],
    [/\bGDP\b/g, "size of the economy (GDP)"],
    [/\bRBI\b/g, "India's central bank (RBI)"],
    [/\bGDP growth\b/gi, "how fast the economy grows"],
  ];

  for (const [re, to] of rules) {
    t = t.replace(re, to);
  }

  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function takeFirstSentences(text, maxSentences) {
  const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (parts.length === 0) return text;
  return parts.slice(0, maxSentences).join(" ");
}

function trimToWords(text, maxWords) {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return `${words.slice(0, maxWords).join(" ")}…`;
}

function ensureSentenceCase(text) {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
