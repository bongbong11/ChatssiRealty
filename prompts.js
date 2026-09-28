// prompts.js — 그남의 집 (구 챗씨부동산)
// index.js's callAI()는 두 경로 중 하나를 씀:
//  1) 연결 프로필 지정 시: buildManualContext()가 캐릭터/페르소나 요약(캐싱됨)+로어북+최근챗을
//     직접 모아서 프롬프트 앞에 텍스트로 붙여 ConnectionManager로 전송.
//  2) 프로필 미지정 시: ctx.generateQuietPrompt({skipWIAN:false})로 ST가 로어북/AN/챗을
//     자동으로 컨텍스트에 섞어줌 — 이 경우엔 우리가 따로 텍스트를 붙이지 않음.
// 아래 각 prompt 함수는 이 컨텍스트가 "이미 어떤 식으로든 포함된 뒤"에 덧붙는 지시문이라고 가정.

export const INFO_BLOCK_GUARD = `
⚠ The current conversation context may contain a status block or info block injected by
another extension (wrapped in fixed tags or delimiters, e.g. [STATUS], <status>, etc.).
Ignore that block entirely — do not let its format, numbers, or wording leak into your output.
`.trim();

export const BREAK_CHARACTER_GUARD = `
⚠ This is a data-generation request, not a roleplay reply. Do not answer in the character's
voice, first person, dialogue, or action description. Do not roleplay as the character —
respond ONLY in the requested data format. No preamble, no closing remarks, no speaker
label (e.g. "NAME:") — start directly with the data.
`.trim();

// lang: 'ko' | 'en' — structure (JSON keys etc.) stays as-is; only the text content changes language
function langInstruction(lang) {
  return lang === 'en'
    ? '⚠ Write all generated text content in English. Do not mix languages. (This is about the LANGUAGE of the text only — it has nothing to do with the character\'s actual nationality, location, or setting, which must be based on the real context you were given, not assumed from this language instruction.)'
    : '⚠ 생성되는 모든 텍스트 내용은 한국어로 작성할 것. 언어를 섞지 말 것. (이건 글자를 어떤 언어로 적을지에 대한 지시일 뿐, 캐릭터의 실제 국적·장소·설정과는 아무 상관 없음 — 국적/배경은 이 언어 지시와 무관하게 어디까지나 실제로 주어진 캐릭터 정보를 기준으로 판단할 것.)';
}
// Repeated right above the output format, since models sometimes default to English
// when they see English JSON keys, even when asked to write Korean values.
function langInstructionStrong(lang) {
  return lang === 'en'
    ? '⚠ REMINDER: the JSON keys below (emoji, name, brand, etc.) stay as English field names, but every actual text VALUE you write into them must be in English too — this reminder exists because models sometimes default to the wrong language when keys are in English. Re-check your output language now. (Again: this only governs what LANGUAGE the text is written in — never let it influence the character\'s actual nationality/setting/location, which comes only from the real context provided.)'
    : '⚠ 다시 한번 강조: 아래 JSON의 key(emoji, name, brand 등 영문 필드명)는 형식이니까 그대로 두고, 그 안에 채워넣는 실제 텍스트 값은 전부 한국어로 작성할 것. 영문 key를 보고 값까지 영어로 쓰지 않도록 출력 직전에 다시 확인할 것. (다시 강조: 이건 텍스트를 "어떤 언어로 쓸지"에 대한 지시일 뿐이다 — 캐릭터의 실제 국적/배경/장소를 한국으로 바꾸라는 뜻이 절대 아니다. 국적/배경은 오직 실제로 주어진 캐릭터 정보를 근거로만 판단할 것.)';
}

export function buildWorldClassifyPrompt(_unused, userHint, lang = 'ko', forcedCategory = null) {
  const taskBlock = forcedCategory
    ? `Task: The category is FIXED by explicit user selection — do not classify it yourself.
  category = "${forcedCategory}" (always use this value as-is)
Your only job is to determine "subtype" and "location_hint" that best fit this category,
based on the character sheet/persona/lorebook/chat context and the user reference text below.
${forcedCategory === 'FANTASY' ? `(FANTASY here covers not just traditional magic fantasy, but any original
non-existing-IP genre setting — zombie apocalypse, cyberpunk, sci-fi/space, post-apocalyptic,
dystopia, military fiction, etc.)` : ''}
${forcedCategory === 'MAJOR_IP' ? `For MAJOR_IP cases that split into multiple sub-series (e.g. Call of Duty):
  1st priority - if the character sheet/lorebook has a clue, use that
  2nd priority - if the user's text names a specific sub-series, use that (allow partial
                 matches — "blops"/"black ops"/"Call of Duty Black Ops" should all match)
  3rd priority - if neither exists, use a default (Call of Duty → Modern Warfare reboot)` : ''}`
    : `Task: Classify into exactly one of these 4 categories.
  - REALISTIC: the real world, based on an actual country/city
  - FANTASY: not just traditional magic fantasy, but **any original (non-existing-IP) genre
    setting** — zombie apocalypse, cyberpunk, sci-fi/space, post-apocalyptic, dystopia,
    military fiction, etc. Any original genre world that isn't realistic, historical, or a
    major IP belongs here.
  - HISTORICAL: a specific period setting (state the era/region concretely)
  - MAJOR_IP: an existing well-known franchise's setting (infer and name the specific work)

For MAJOR_IP cases that split into multiple sub-series (e.g. Call of Duty):
  1st priority - if the character sheet/lorebook has a clue, use that
  2nd priority - if the user's text names a specific sub-series, use that (allow partial
                 matches — "blops"/"black ops"/"Call of Duty Black Ops" should all match)
  3rd priority - if neither exists, use a default (Call of Duty → Modern Warfare reboot)`;
  return `
Role: Character data analyst.
${INFO_BLOCK_GUARD}
${BREAK_CHARACTER_GUARD}
${langInstruction(lang)}

Refer to the character sheet, persona, lorebook, and recent chat history of this conversation.
User-provided reference text: "${userHint || "(none)"}"

${taskBlock}

⚠ Do NOT write the subtype field as a vague label like "fantasy" — write a **specific
genre/setting** (e.g. "zombie apocalypse", "cyberpunk dystopia", "near-future space sci-fi",
"modern military fiction", "medieval magic fantasy"). This subtype is used directly in the
item-generation step to pick genre-appropriate objects.

If the user provided reference text, prioritize it above all else. If the text is in
"setting-location" form (e.g. "Harry Potter-London"), parse the setting and location separately.

${langInstructionStrong(lang)}

Output format: JSON only, no other text or code-block markers, pure JSON.
{ "category": "REALISTIC|FANTASY|HISTORICAL|MAJOR_IP", "subtype": "...", "location_hint": "..." }
`.trim();
}

export function buildAddressGeneratePrompt(_unused, worldClass, userHint, lang = 'ko', hasCachedProfile = false) {
  const profileFieldNote = hasCachedProfile ? '' : `
⚠ Also output a hidden "characterProfileSummary" field — a compact, keyword-dense summary
(3-5 short lines) of stable personality, occupation and enduring traits ONLY. Exclude current
relationship dynamics, affection, recent events and temporary moods. Distill from the character sheet
you were given. This is INTERNAL metadata, never shown to the user — its only purpose is so
that OTHER generation calls later on can reference this compact summary instead of re-reading
the full character sheet every time. Keep it dense and information-rich, not prose.
`;
  const profileFieldSchema = hasCachedProfile ? '' : `,
  "characterProfileSummary": ""`;
  return `
Role: Real-estate info generator.
${INFO_BLOCK_GUARD}
${BREAK_CHARACTER_GUARD}
${langInstruction(lang)}

Refer to the character sheet, persona, lorebook, and recent chat history of this
conversation to estimate the character's wealth level, occupation, and home country.
⚠ The home country/location must be based ONLY on the character's actual established
nationality/background from that context — it has nothing to do with what language you're
writing the output text in. A character who is American, British, etc. stays that
nationality regardless of whether you're asked to write the field values in Korean or
English; never default to a Korean location just because the output language is Korean.

⚠ Country-first anchoring: before filling in anything else, first decide and LOCK IN the
country. Unless this is a non-Earth world with no Earth equivalent,
this is almost always a real country — REALISTIC obviously, but also HISTORICAL (a real
country's past) and most MAJOR_IP settings (Call of Duty, Harry Potter, etc. are still set
on real-Earth countries even though the franchise is fictional). Only invent a fantasy
country/region name if the setting is truly original/non-Earth. Once decided, this single
country value is the source of truth for EVERY other field below — write the "location"
field starting with that country name first (e.g. "미국 · 캘리포니아 LA 다운타운", "United
Kingdom · London, Camden"), and make sure "price" uses that country's established currency
(real-world currency for Earth unless lore explicitly changes it). The "address" follows
that setting's convention. Do not let these fields drift
to different countries from each other.

World classification result: ${JSON.stringify(worldClass)}
User reference text: "${userHint || "(none)"}"

Task: Generate the character's housing info in the fields below. Keep each field a short
answer, not prose (the "story" field is the only exception).
  - residenceType (rent/own — reflect local convention; consider Korea's "jeonse" deposit
    system if relevant)
  - price (in that setting's established local currency, plausible for the area and era)
  - buildingType
  - rooms, bathrooms
  - structureStyle (open-plan / separated, etc.)
  - hasYard
  - hasGarage
  - location (MUST start with the locked-in country name, then narrow down to neighborhood
    level — e.g. "미국 · 캘리포니아 LA 다운타운")
  - address (a specific street number/coordinate within that same country/neighborhood — pick
    any point within the neighborhood; don't worry about whether it matches a real building
    exactly)
  - moveInDate
  - interiorStyle
  - renovation
  - story (one paragraph, in a "TMI"/personal-trivia tone)
  - status

When established lore requires it, swap only the "vocabulary" of the fields above to fit that
world (price units, building type names, address conventions, etc.) — keep the JSON key
structure unchanged.

If the character's wealth level is low, set hasGarage/hasYard etc. to false; if very
wealthy, generate 1–2 extra entries in appendix (additional assets).

⚠ Also assess and output a hidden "wealthTier" field — this is INTERNAL metadata, never
shown to the user in any displayed card, used only by other parts of this system to keep
later item-pricing consistent with this character's actual means. Give an honest assessment
regardless of how modestly or vaguely the visible fields above are phrased.
Allowed values: "low" | "middle" | "high" | "very_high".
${profileFieldNote}
${langInstructionStrong(lang)}

⚠ FINAL CHECK before you output: re-read "location", "price", and "address" together. Do
they all point to the SAME country? Does "location" actually start with that country's name?
Is "price" in that setting's established currency (not defaulted to Korean won just
because you're writing in Korean)? Fix any mismatch before
outputting.

Output format: JSON only, no other text or code-block markers.
{ "residenceType":"", "price":"", "buildingType":"", "rooms":0, "bathrooms":0,
  "structureStyle":"", "hasYard":true, "hasGarage":true, "location":"", "address":"",
  "moveInDate":"", "interiorStyle":"", "renovation":"", "story":"", "status":"",
  "appendix": ["..."], "wealthTier": "low|middle|high|very_high"${profileFieldSchema} }
`.trim();
}

export function buildHouseMovePrompt(_unused, worldClass, prevCard, lang = 'ko', hasCachedProfile = false) {
  return `
Role: Housing regenerator. (Only called when the "Move" button is clicked — no auto-detection.)
${INFO_BLOCK_GUARD}
${BREAK_CHARACTER_GUARD}
${langInstruction(lang)}

Refer to the character sheet, persona, lorebook, and recent chat history of this
conversation (especially whether a move/sale/renovation or other housing change was mentioned).

World classification result: ${JSON.stringify(worldClass)}
Previous housing card (for reference only — do not copy it as-is): ${JSON.stringify(prevCard)}

Task: Generate a new housing card based on the context above. Keep the same character's
tone/consistency, but do not simply copy the old data. Output field structure is identical
to buildAddressGeneratePrompt (including the hidden "wealthTier" field${hasCachedProfile ? '' : ' and "characterProfileSummary" field'}).
⚠ Same country-anchoring rule applies: lock in the country first (almost always a real one
unless it's a non-Earth world), make "location" start with that
country's name, and make "price"/"address" match that same country — never let them drift
to different countries, and never default to Korea just because you're writing in Korean.

${langInstructionStrong(lang)}

⚠ FINAL CHECK before you output: re-read "location", "price", and "address" together — do
they all point to the same setting, with price in its established currency? Fix any
mismatch before outputting.

If requested, characterProfileSummary contains stable personality/occupation/traits only; exclude relationship dynamics and recent events.
Output format: JSON only, no other text or code-block markers.
{"residenceType":"","price":"","buildingType":"","rooms":0,"bathrooms":0,
"structureStyle":"","hasYard":false,"hasGarage":false,"location":"","address":"",
"moveInDate":"","interiorStyle":"","renovation":"","story":"","status":"",
"appendix":[],"wealthTier":"low|middle|high|very_high"${hasCachedProfile ? '' : ',"characterProfileSummary":""'}}
`.trim();
}

// Category describes genre, not whether Earth brands or currencies exist.
function economyRules(countryHint = '') {
  return `Economy: location=${JSON.stringify(countryHint || '(infer from context)')}. Follow established lore first.
Earth and altered-Earth settings may retain real brands and local currency regardless of category,
including FANTASY and MAJOR_IP. Use genuine brands appropriate to product, era, region and means
when they exist; use established in-universe makers where applicable, otherwise a plausible local
maker or an empty brand. Never introduce modern brands into an incompatible era.
Use the setting's established currency; for Earth money use the local symbol/ISO code, for invented
money use its canonical unit. Do not infer country or currency from output language.`;
}
function batchRules(opts, total, specialTarget) {
  const pinned = opts.pinnedItems || [];
  const count = opts.count ?? Math.max(0, total - pinned.length);
  const special = opts.specialCount ?? Math.min(count, Math.max(0, specialTarget - pinned.filter(it => Number(it.unlockCost) > 0).length));
  return `NEW item count: exactly ${count}. NEW special count: exactly ${special}. These counts already
account for preserved pins; never output pinned items or lock ordinary items to meet a quota.
Preserved pins: ${JSON.stringify(pinned)}
Excluded current/recent concepts: ${JSON.stringify(opts.excludedItems || opts.existingNames || [])}
Avoid those objects, synonyms and cosmetic variants, both across generations and within this batch.
conceptKey: a short canonical lowercase English object-kind key, independent of brand, color,
wording, owner and backstory. Reuse the same key for synonymous objects; never add a random suffix.
Plan the final inventory including pins across different practical functions, object families and
backstory motives. Do not repeat a family or narrative device more than twice among new items
unless the storage function genuinely requires it. Existing pins need not be changed.
Space function comes first; personality supplies subtle choices. Occupation and relationship are
optional context, not quotas: keep each to at most a third of new items (rounded up), unless the
space is explicitly a workplace. Do not make every special item a gift, keepsake or secret.
Read current relationship state from recent chat/lore; never assume romance or invent milestones.
Specials earn their cost through a concrete, character-consistent backstory, not rarity or price.
Special unlockCost is an integer 5–15; ordinary unlockCost is 0. Do not use placeholder names.`;
}

export function buildItemPoolPrompt(_unused, worldClass, spaceKey, spaceLabel, lang = 'ko', opts = {}) {
  return `
Role: Belongings inventory generator. Output only valid JSON, no roleplay or code fences.
${INFO_BLOCK_GUARD}
${langInstruction(lang)}
World: ${JSON.stringify(worldClass)}
Space: ${spaceKey} (${spaceLabel})
Use established context plus plausible belongings consistent with means and era. Genre constrains
what can exist; it does not turn every room into a collection of signature genre/occupation props.
If this space has no functional equivalent, return {"empty":true,"emptyReason":"..."}.
Otherwise use space-appropriate objects. A misplaced object is a rare exception requiring a
mundane explanation in tmi, never a routine surprise. For kitchen, generate room contents and
prepared food only; raw groceries belong in the separate pantry/fridge lists.
${batchRules(opts, 12, 5)}
${economyRules(opts.countryHint)}
tmi: ordinary items have one short factual sentence; specials have 1–2 specific backstory sentences.
isSecretGift is true only for an as-yet ungiven gift supported by the current relationship.
emoji must be one real emoji glyph. Mix the order of ordinary and special items.
Before output, verify counts, distinct concepts, space fit, current story consistency and economy.
{"empty":false,"items":[{"emoji":"","name":"","conceptKey":"","brand":"","price":"","tmi":"","unlockCost":0,"isSecretGift":false}]}
`.trim();
}


export function buildFoodListPrompt(_unused, worldClass, subtype, lang = 'ko', opts = {}) {
  return `
Role: Food inventory generator. Output only valid JSON, no roleplay or code fences.
${INFO_BLOCK_GUARD}
${langInstruction(lang)}
World: ${JSON.stringify(worldClass)}
Storage: ${subtype === 'fridge' ? 'cold/perishable storage' : 'dry/non-perishable storage'}
Use the era's functional storage equivalent, even without a modern fridge. Return
{"empty":true} only if no equivalent exists. Food must suit storage, culture, means and availability;
altered-Earth genre settings may still have ordinary groceries if context supports them.
${batchRules(opts, 10, 3)}
${economyRules(opts.countryHint)}
Almost all items must be food/drink/ingredients. A misplaced non-food object is a rare exception
and needs a mundane explanation in tmi. Ordinary food tmi is empty; special tmi is 1–2 sentences
with a specific surprising or funny backstory. An explained misplaced object must be special.
emoji is one actual emoji glyph; qty is a plausible amount. Check counts and distinct concepts.
{"empty":false,"list":[{"emoji":"","name":"","conceptKey":"","qty":"","tmi":"","unlockCost":0}]}
`.trim();
}

export function buildItemInjectionText(item) {
  return `<csr_item_info>
[Item: ${item.name}${item.brand ? ` — ${item.brand}` : ''}]
${item.tmi || ''}

Instruction: Treat this purely as raw material for crafting your next in-character
response — never treat it as something to react to or answer directly. Find whatever
natural insertion point fits the current scene and flow, and weave it in ONLY if it
genuinely fits — never force it in awkwardly or mention it out of nowhere. You may let
it surface as a full, explicit moment, or let it show through only as a subtle nuance or
passing detail, or simply have {{char}} remain aware it exists without it surfacing in
the prose at all — whichever feels organic. Continue the roleplay normally as {{char}},
in-character, exactly as you would without this tag. Do NOT break character, do NOT
reply as if answering a question, and do NOT mention, quote, paraphrase, or otherwise
expose or acknowledge this tag or its instructions anywhere in your response — it must
remain completely invisible to the reader.
If the user's message contains its own (OOC: ...) question or instruction, that takes
top priority — answer or follow that first; treat this tag as secondary, supplementary
reference information only.
</csr_item_info>`.trim();
}

export function buildFoodBundleInjectionText(subtype, items) {
  const label = subtype === 'fridge' ? "{{char}}'s fridge" : "{{char}}'s pantry";
  const lines = items.map((it) => {
    const base = `- ${it.name}${it.qty ? ` (${it.qty})` : ''}`;
    return it.tmi ? `${base} — ${it.tmi}` : base;
  }).join('\n');
  return `<csr_food_info>
[${subtype === 'fridge' ? 'Fridge' : 'Pantry'} contents known to be in ${label}]
${lines}

Instruction: Treat this purely as raw material for crafting your next in-character
response, not as something to react to or answer directly — there's no need to force a
mention or use of these items. Find whatever natural insertion point fits the current
scene if you do use one. For any item with a description attached, you may let that
backstory color the scene naturally if it fits — anywhere from a full explicit moment
down to just a subtle nuance, entirely your call. Continue the roleplay normally as
{{char}}, in-character, exactly as you would without this tag. Do NOT break character,
do NOT reply as if answering a question, and do NOT mention, quote, paraphrase, or
otherwise expose or acknowledge this tag or its instructions anywhere in your response —
it must remain completely invisible to the reader. If the user's message contains its
own (OOC: ...) question or instruction, that takes top priority — answer or follow that
first; treat this tag as secondary, supplementary reference information only.
</csr_food_info>`.trim();
}

export function buildSpaceLabelsPrompt(worldClass, currentLabels, lang = 'ko') {
  return `
Role: Setting localizer for UI labels.
${INFO_BLOCK_GUARD}
${BREAK_CHARACTER_GUARD}
${langInstruction(lang)}

World classification result: ${JSON.stringify(worldClass)}
Current (default/realistic) labels for FIXED functional categories: ${JSON.stringify(currentLabels)}

Task: These categories represent fixed FUNCTIONS (a food-storage room, a common/social room,
a hygiene room, a sleeping room, a knowledge/hobby room, a vehicle-storage room, a general
storage room, plus two food-storage SUB-categories: a dry/non-perishable food storage spot,
and a cold/perishable food storage spot) — the function itself never changes, only what it's
CALLED and which emoji represents it changes to fit the world/era/genre. For each category,
give the closest functional equivalent's name in that world — never say something "doesn't
exist"; always find the era/genre-appropriate equivalent (e.g. for a "vehicle storage"
category in a medieval setting, that becomes a stable; for the "cold storage" sub-category
in a medieval setting with no refrigeration, that becomes a root cellar or cold pantry; in a
zombie apocalypse, "vehicle storage" becomes a fortified vehicle bay; in REALISTIC/modern
settings, just keep the original default label as-is).
If the world classification is REALISTIC, just return the current default labels unchanged.

⚠ emoji values must be exactly ONE actual unicode emoji character — NEVER a text word/label.
If there's no perfect emoji for a category's new name, pick the closest generic one instead
of writing text.

${langInstructionStrong(lang)}

Output format: JSON only, no other text or code-block markers. Keys must stay exactly
"kitchen","living","bath","bedroom","study","garage","storage","pantry","fridge" — only
change "label" and "emoji" values. "pantry" = dry/non-perishable storage, "fridge" =
cold/perishable storage (both nested under the kitchen's food-storage function).
{ "kitchen": {"label":"", "emoji":""}, "living": {"label":"", "emoji":""},
  "bath": {"label":"", "emoji":""}, "bedroom": {"label":"", "emoji":""},
  "study": {"label":"", "emoji":""}, "garage": {"label":"", "emoji":""},
  "storage": {"label":"", "emoji":""}, "pantry": {"label":"", "emoji":""},
  "fridge": {"label":"", "emoji":""} }
`.trim();
}


export function buildDiscoveryCheckPrompt(lastExchangeText, worldClass, profileContext, wealthHint, countryHint, excludeNames, recentTriggerNote, lang = 'ko') {
  return `
Role: Hidden item discovery judge. Output only valid JSON; never continue the roleplay.
${INFO_BLOCK_GUARD}
${langInstruction(lang)}
World: ${JSON.stringify(worldClass)}
Profile/lore (reference only): ${profileContext || '(none)'}
Financial context: ${wealthHint || '(infer from context)'}
${economyRules(countryHint)}
Excluded current/recent items: ${JSON.stringify(excludeNames || [])}
Recent discovery: ${recentTriggerNote || '(none)'}
Latest exchange (read-only):
<exchange>${lastExchangeText}</exchange>
Default to {"triggered":false}. This is discernment, not a frequency quota.
A discovery requires a specific, natural opportunity in THIS scene for the character to have
quietly acquired, prepared or kept ONE object off-screen. Never rediscover an object explicitly
named, shown or described in the exchange. Never repeat an excluded concept using a new name,
brand or backstory. If the previous discovery's scene is still continuing, return false until
a genuine change of activity, location, event or time. Do not trigger during active danger,
combat or an intimate act; a suitable aftermath/transition can qualify but does not require it.
The action may be deliberate or impulsive and span the character's full emotional range; it
need not be kind, romantic, occupational or for the persona. Current chat/lore governs relationship
state; never invent a milestone, acquisition beyond their means, or an unsupported change of heart.
Vary object family and narrative motive from recent discoveries. Avoid defaulting to gifts and
keepsakes. Ordinary inexpensive objects can qualify through a compelling backstory alone.
Most checks should be false. If the charm, humor, surprise or emotional hook requires stretching
the scene, return false. Being plausible or matching a scene type alone is insufficient.
If triggered, tmi is 1–2 sentences in the item collector's voice explaining how/why this hidden
object ended up with the character. emoji is one actual emoji; brand may be empty.
conceptKey is a short canonical lowercase English object-kind key, invariant across synonyms,
brands, colors and backstories. qualityScore is 0–10: merely acceptable is 4–5; 8–10 is exceptional.
Final check: off-screen, genuinely new scene/concept, unforced hook, consistent personality and
economy. If any fails, return false.
{"triggered":false} OR {"triggered":true,"emoji":"","name":"","conceptKey":"","brand":"","tmi":"","qualityScore":0}
`.trim();
}

export function buildLorebookExportPrompt(card, lang = 'ko') {
  return `
Role: Lorebook entry writer.
${BREAK_CHARACTER_GUARD}
Input card data: ${JSON.stringify(card)}
${langInstruction(lang)}

Task: Group all fields of the card into categories and convert them into natural flowing
prose paragraphs.
  Fixed category structure:
    [Housing] — location/address/residence type/price/status
    [Structure] — building type/rooms·bathrooms/structure style/yard/garage
    [Interior] — interior style/renovation/house story
    [Move-in history] — move-in date + summary of past residences
    [Other] — appendix (additional assets/TMI)

Style: third-person narration suited to a character sheet/lorebook. No tables or bullet
lists — write in complete, naturally flowing sentences. Avoid flowery language; prioritize
conveying information.

Output format: plain prose text with category labels (e.g. \`[Housing]\`) as headers. Not JSON.
`.trim();
}
