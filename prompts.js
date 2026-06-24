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
(3-5 short lines) of {{char}}'s personality, occupation, notable traits, and the relationship
dynamic with the persona, distilled from the character sheet/persona/lorebook/chat context
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
country. Unless this is a genuinely original fantasy/virtual world with no Earth equivalent,
this is almost always a real country — REALISTIC obviously, but also HISTORICAL (a real
country's past) and most MAJOR_IP settings (Call of Duty, Harry Potter, etc. are still set
on real-Earth countries even though the franchise is fictional). Only invent a fantasy
country/region name if the setting is truly original/non-Earth. Once decided, this single
country value is the source of truth for EVERY other field below — write the "location"
field starting with that country name first (e.g. "미국 · 캘리포니아 LA 다운타운", "United
Kingdom · London, Camden"), and make sure "price" uses that exact country's real currency
and "address" follows that country's addressing convention. Do not let these fields drift
to different countries from each other.

World classification result: ${JSON.stringify(worldClass)}
User reference text: "${userHint || "(none)"}"

Task: Generate the character's housing info in the fields below. Keep each field a short
answer, not prose (the "story" field is the only exception).
  - residenceType (rent/own — reflect local convention; consider Korea's "jeonse" deposit
    system if relevant)
  - price (in the local currency of the locked-in country above, within the real going rate
    for that area — never a different country's currency)
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

If the world is not REALISTIC, swap only the "vocabulary" of the fields above to fit that
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
Is "price" in that exact country's real currency (not a different country's, and not
defaulted to Korean won just because you're writing in Korean)? Fix any mismatch before
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
unless it's a genuinely original fantasy/virtual world), make "location" start with that
country's name, and make "price"/"address" match that same country — never let them drift
to different countries, and never default to Korea just because you're writing in Korean.

${langInstructionStrong(lang)}

⚠ FINAL CHECK before you output: re-read "location", "price", and "address" together — do
they all point to the same country, with price in that country's real currency? Fix any
mismatch before outputting.

Output format: JSON only (same structure), no other text or code-block markers.
`.trim();
}

export function buildItemPoolPrompt(_unused, worldClass, spaceKey, spaceLabel, lang = 'ko', opts = {}) {
  // opts.isReroll: true means only refilling unpinned slots — but reroll should follow the
  // EXACT SAME lock style as a fresh first-time generation (mostly free items, only 4-6
  // specially-backstoried ones locked), not "everything locked".
  // opts.pinnedItems: pinned items that must be preserved as-is, not regenerated
  // opts.existingNames: names of ALL items currently shown in this space (pinned or not) —
  // purely for duplicate-avoidance context, not saved/persisted anywhere by us.
  const rerollNote = opts.isReroll
    ? `\n⚠ Reroll mode: never regenerate the pinned items listed below — keep them exactly as
they are. Only generate as many new items as there are slots to replace, following the
EXACT SAME style as a fresh first-time generation described below (mostly free, only 4-6
special locked items) — do NOT lock every regenerated item. This also means: do not
generate any new item that duplicates a pinned item's concept either (e.g. don't pin a
"toolbox" and then also generate "tool kit" as a new item) — pinned items count as
already-existing for duplicate-avoidance purposes too.
Pinned items (keep, excluded from the count): ${JSON.stringify(opts.pinnedItems || [])}
So the number of new items to generate = 12 - ${(opts.pinnedItems || []).length}.\n`
    : '';
  const existingNote = (opts.existingNames && opts.existingNames.length)
    ? `\n⚠ Avoid duplicates: items already present in this space right now are:
${JSON.stringify(opts.existingNames)}. This means more than just avoiding identical name
strings — also avoid generating something that's conceptually the SAME object just phrased
differently (e.g. if "electric guitar" already exists, don't add "an electric guitar" worded
another way, or a near-synonymous variant of it). Every newly generated item must be a
genuinely distinct object/concept, not a reworded duplicate.\n`
    : '';
  const isRealWorldCurrency = worldClass?.category === 'REALISTIC' || worldClass?.category === 'HISTORICAL' || worldClass?.category === 'MAJOR_IP';
  const countryNote = opts.countryHint
    ? `\n⚠ This character's home country/region is already locked in: "${opts.countryHint}".
${isRealWorldCurrency
      ? `Every "price" value below MUST use that exact country's real currency, written as a
SYMBOL ($, £, €, ¥, etc.) if one commonly exists, or its 3-letter ISO code (ILS, UAH, THB,
etc.) if it doesn't — never spell the currency out as a word. Never default to Korean won
just because you're writing the text in Korean; the currency is tied to the locked-in
country, not to the output language.`
      : `If this world has its own invented currency (gold coins, credits, etc.), use that
world's own canonical unit name consistently — don't drift to a real-world currency or to
Korean won.`}\n`
    : '';
  return `
Role: Belongings inventory generator.
${INFO_BLOCK_GUARD}
${BREAK_CHARACTER_GUARD}
${langInstruction(lang)}

Refer to the character sheet, persona, lorebook, and recent chat history of this conversation.

World classification result: ${JSON.stringify(worldClass)}
Target space: ${spaceKey} (${spaceLabel})
⚠ Out-of-category items: items here should almost always genuinely belong in / make sense
for THIS specific space (${spaceLabel}). This is NOT something to do every generation, or
even most generations — it should be the rare exception, not a recurring pattern. An
out-of-place object (e.g. a car part in a bedroom, a book ending up in the garage) may
appear very occasionally, but ONLY if its tmi gives a believable, mundane reason for why it
ended up there (got distracted and left it there, multitasking, a kid/pet moved it, etc.) —
never include an out-of-place object with no explanation, and never use it just for shock
value. The "surprise" for special items should still mostly come from a space-appropriate
item's BACKSTORY rather than from the item itself being out of place.
${rerollNote}${existingNote}${countryNote}
Task:
1. First decide how this space exists (if at all) in the current world/era. If it doesn't
   exist or makes no sense, return only { "empty": true, "emptyReason": "..." } and stop.
2. If it exists, combine items actually confirmed in the conversation context with plausible
   guessed items based on the character's personality/wealth level to fill exactly 12 slots
   (or, in reroll mode, the number of new items specified above).
   - Do not mark which items are confirmed vs. guessed — place them in random order.
   - Make **4–6 (random, varies each time)** of them special items worth spending points to
     unlock — items with a genuinely interesting backstory. Read the relationship context
     (lorebook, affection level, shared memories, relationship progress, character's own
     secrets/personality) and let it inform what kinds of backstories make sense — but this
     does NOT mean a romantic/relationship-themed item must appear every single time. Mix
     and match across generations, drawing from whichever fits the ACTUAL state of the
     relationship at this point in the story:
       · something tied to the relationship with the persona — but only if logically
         consistent with where the relationship actually stands. E.g. if they're already
         married/engaged, do NOT invent "a secret unproposed engagement ring" (that's a
         contradiction) — instead it could be a genuine wedding ring with real meaning behind
         it, a heartfelt anniversary gift, or simply skip the relationship angle that turn.
       · something purely personal to the character themselves, unrelated to the persona
         (a secret, an embarrassing keepsake, a sentimental object from their past, something
         that reveals an unexpected side of them)
     Quality matters more than hitting a theme — since unlocking costs real points, a
     contradictory or generic/boring backstory wastes the player's points and feels cheap.
     When in doubt, prefer a character-personal angle over forcing a relationship angle that
     doesn't fit.
   - All other items are ordinary, everyday belongings — these must be free (unlockCost 0),
     just like normal inventory browsing. Don't make plain items locked for no reason.
3. Fields for each item:
   - emoji: exactly ONE actual unicode emoji character — NEVER a text word/label. If there's
     no perfect emoji for a specific item, pick the closest generic one instead of writing
     text (e.g. for a helmet use 🪖, for tools use 🔧, for a car part use 🚗) — do not leave
     this field as a word like "helmet"; it must always render as a single emoji glyph.
   - name
   - brand (brand / artisan / guild name — fitting the world)
   - price: depends on the world.
     · If this is a real-Earth country (REALISTIC/HISTORICAL/most MAJOR_IP): use that
       country's real currency, written as a SYMBOL ($, £, €, ¥, etc.) if one commonly
       exists, or its 3-letter ISO code (ILS, UAH, THB, etc.) if it doesn't — never spell
       the currency out as a word, and never default to Korean won unless the locked-in
       country is actually Korea.
     · If this is a FANTASY/original or non-Earth setting with its own invented currency
       (gold coins, credits, Galleons, etc.): just use that world's own canonical unit name
       as a word — this is fine since it's a unique term, not at risk of defaulting to won.
   - tmi: for the 4-6 special items, 1-2 sentences of genuine backstory (for a secret
     persona-gift item, phrase it as a secret like "hasn't given it yet"). For ALL OTHER
     (ordinary) items, still write a short 1-sentence plain, factual description of the
     item (what it is, what it's for/like) — never leave tmi as an empty string; every
     item should have something worth reading when clicked, just at a different depth
     (ordinary = brief factual description, special = genuine backstory/secret).
   - unlockCost (0 for ordinary items; 5–15 ONLY for the 4-6 special backstory items)
   - isSecretGift (true/false)
4. Item flavor by world — **reflect BOTH category (broad classification) and subtype
   (genre/specific setting)**:
   - Baseline tone by category:
     - REALISTIC → genuine real-world brands that actually exist (Cartier, Apple, Nike,
       Le Creuset, etc.) — match the brand to the item's category and the character's
       actual wealth/taste level (don't default to luxury brands for an ordinary item, and
       don't undersell a wealthy character either)
     - FANTASY → invented brand names that fit the world's aesthetic — never real-world
       brands. Vary the naming style to match the world's flavor: a medieval-magic world
       might use guild/artisan names ("Hollowmere Smithy"), a cyberpunk world might use
       corporate-sounding names ("Nexar Dynamics"), a post-apocalyptic world might use
       salvaged/improvised labels or pre-collapse brand remnants. Invent something new each
       time rather than reusing the same handful of fantasy-sounding names.
     - HISTORICAL → invented period-appropriate names matching the actual era/region (a
       fictional royal workshop, merchant house, or artisan name styled to that specific
       period — e.g. Joseon-era naming conventions differ completely from Victorian-era
       English ones) — never a real modern brand, and never generic "ye olde" fantasy names
       for a real historical setting
     - MAJOR_IP → decide case by case using this priority:
       1. If the franchise has its own established in-universe brand/shop for this category
          of item, use it (e.g. Harry Potter wand → Ollivanders; Harry Potter prank item →
          Weasleys' Wizard Wheezes; Marvel tech → Stark Industries; a real-world-set
          military franchise like Call of Duty → genuine real-world tactical/gear brands
          such as Oakley, 5.11 Tactical, since that franchise's world IS the real world)
       2. If no canon brand exists for this specific item type, invent one that matches the
          franchise's in-universe naming conventions and tone (not generic real-world or
          generic fantasy names — make it feel like it belongs in that specific universe)
       3. For franchises split into many sub-series with different settings/eras (space
          opera vs. modern military vs. fantasy spin-off of the same IP), match the brand
          style to whichever specific sub-setting was identified in subtype/location_hint —
          don't default to one sub-series' aesthetic for all of them
     Across all categories, favor variety over repetition — avoid reusing the same few
     brand names across different generations for the same world; invent fresh ones each time
     while staying internally consistent with the established world.
   - **Detail by subtype (specific genre) — even with the same category, item types must
     differ completely depending on subtype**: e.g. if subtype is "zombie apocalypse", lean
     toward survival gear/armor/emergency rations; "cyberpunk" → implants/hacking gear/neon
     accessories; "medieval fantasy" → magic items/greatswords/armor; "modern military
     fiction" → tactical gear/military equipment. Read the subtype text directly and imagine
     concrete items that fit that genre.
   - **Also reflect the character's own occupation/role at the same time**: mix in
     profession-specific items matching the character's occupation as confirmed in context
     (soldier, doctor, mage, hacker, etc.). I.e. consider "world genre" + "character
     occupation" as two simultaneous layers — e.g. a soldier character in a cyberpunk world
     should get items that reflect BOTH: cyberpunk-flavored military implants or tactical gear.
   - Mixed settings (modern+fantasy, etc.) → real-world brands and world-specific items may coexist

⚠ If spaceKey is "kitchen": this is the kitchen ROOM itself (appliances, cookware, utensils,
a coffee/tea machine, leftover prepared/cooked food sitting out, dishware, small kitchen
gadgets, etc.) — NOT raw groceries/ingredients. Raw pantry/fridge groceries are handled by a
completely separate prompt (buildFoodListPrompt) and must never appear here.

${langInstructionStrong(lang)}

⚠ FINAL CHECK before you output: look at every item you're about to write. If any of them
is NOT something that genuinely belongs in "${spaceLabel}", either change it to something
that does belong there, or — if you're intentionally keeping it as a rare out-of-place
exception — make sure its tmi field actually states the mundane reason it ended up there.
Do not output an out-of-place item with an empty or generic tmi. Also check every "price" —
for a real-world country, is it a currency symbol/code matching the locked-in country (not
spelled-out Korean won defaulted from the output language)? For a fantasy/original world, is
it consistently using that world's own currency unit?

Output format: JSON only, no other text or code-block markers.
{ "empty": false, "items": [ { "emoji":"", "name":"", "brand":"", "price":"",
  "tmi":"", "unlockCost":0, "isSecretGift":false }, ... ] }
`.trim();
}

export function buildFoodListPrompt(_unused, worldClass, subtype, lang = 'ko', opts = {}) {
  // subtype: 'pantry' | 'fridge'
  // opts.isReroll: true means refreshing the non-pinned slots — but unlike room items,
  // food reroll should follow the SAME style as the initial generation (mostly free
  // groceries + only 2-3 special locked surprises), not "everything locked".
  // opts.pinnedItems: pinned items to preserve as-is during reroll (reference only)
  const rerollNote = opts.isReroll
    ? `\n⚠ Reroll mode: keep the pinned items listed below untouched. Regenerate the rest of
the list following the EXACT SAME style as a fresh, first-time generation — most items
stay ordinary and free (unlockCost 0), and only 2-3 NEW special items get a surprising
backstory and unlockCost (5-15). Do NOT lock every regenerated item — only those 2-3
special ones should be locked, exactly like in a normal first-time generation.
Pinned items (keep): ${JSON.stringify(opts.pinnedItems || [])}\n`
    : '';
  const existingNote = (opts.existingNames && opts.existingNames.length)
    ? `\n⚠ Avoid duplicates: items already present right now are:
${JSON.stringify(opts.existingNames)}. This means more than just avoiding identical name
strings — also avoid generating something that's conceptually the SAME item just phrased
differently (e.g. if "kimchi" already exists, don't add "pickled cabbage" as a reworded
duplicate of it). Every newly generated item must be a genuinely distinct food/object, not
a reworded duplicate.\n`
    : '';
  return `
Role: Food/grocery list generator.
${INFO_BLOCK_GUARD}
${BREAK_CHARACTER_GUARD}
${langInstruction(lang)}

Refer to the character sheet, persona, lorebook, and recent chat history of this conversation.

World classification result: ${JSON.stringify(worldClass)}
Target: ${subtype === "fridge" ? "fridge" : "pantry"}
${rerollNote}${existingNote}
Task: Generate about 8–10 food items, **matching the world's category and subtype (genre)**
(e.g. if subtype is "zombie apocalypse", lean toward canned goods/emergency rations/bottled
water; "cyberpunk" → synthetic food/energy bars; "medieval magic fantasy" → smoked meat/dried
fruit/herbs; Joseon-era → fermented sauces/grains, etc.). Unless the world is REALISTIC, never
default to modern supermarket groceries — it will feel out of place for the genre.
⚠ Out-of-category items: items here should almost always be actual food/beverage/ingredient
items. This is NOT something to do every generation, or even most generations — it should
be the rare exception, not a recurring pattern. A non-food object (like a forgotten remote
control, a stray tool, etc.) may appear very occasionally, but ONLY if its tmi gives a
believable, mundane reason for why it ended up there (got distracted and left it there,
multitasking and put it down absentmindedly, a kid/pet put it there, etc.) — never include
an out-of-place object with no explanation, and never use it just for shock value. The
"surprise" for the special items should still mostly come from a food item's BACKSTORY
rather than from the item being non-food.
Make **only 2–3** of them special items with a "why is this even here?" surprising/funny
detail. Read the relationship context (lorebook, affection level, shared memories,
relationship progress) and the character's own personality/secrets to inform these — but
don't force a relationship-themed item every time, and never invent something that
contradicts where the relationship actually stands (e.g. "secretly saving this for a
proposal" makes no sense if they're already married). Mix items tied to the persona
relationship with items purely personal to the character, whichever genuinely fits the
current story state — a contradictory or generic backstory wastes the points it costs to
unlock, so prioritize fit over forcing a theme.
Only these special items get an unlockCost (5–15) — **the name itself is also meant to stay
hidden until unlocked. That just means: write the real name normally in the name field as
usual; the client will replace it with "???" on screen whenever unlockCost > 0, so you don't
need to do anything special — just write the real name as normal.**
Fill the tmi field for these special items with a 1–2 sentence backstory.
For all other ordinary food items, set unlockCost to 0 and tmi to an empty string.
If the era/genre has no literal modern "fridge" concept (e.g. the Joseon era), don't return
empty — instead generate the closest functional equivalent's contents (e.g. a root
cellar/cold storage's actual contents for "fridge" in that era), matching how space names
get reinterpreted elsewhere in this system. Only return empty if there's truly no equivalent
storage concept of any kind for this world/era.

Fields per item: { "emoji":"", "name":"", "qty":"", "tmi":"", "unlockCost": 0 or 5–15 }

${langInstructionStrong(lang)}

⚠ FINAL CHECK before you output: look at every item you're about to write. If any of them
is NOT an actual food/beverage/ingredient, either change it to one, or — if you're
intentionally keeping it as a rare out-of-place exception — make sure its tmi field
actually states the mundane reason it ended up there. Do not output an out-of-place item
with an empty or generic tmi.

Output format: JSON only, no other text or code-block markers.
{ "empty": false, "list": [ { "emoji":"", "name":"", "qty":"", "tmi":"", "unlockCost":0 }, ... ] }
`.trim();
}

// ─── Tab 2 inject text builders ──────────────
// These are pushed directly into the chat array via the generate_interceptor — not a
// "prompt" sent to the AI for a data-generation call, but the literal tag block that gets
// injected into context. No langInstruction applied here (kept fixed in English).
// Uses custom <csr_item_info>/<csr_food_info> tags instead of an "(OOC: ...)" label, so the
// model is more likely to read it as system-level meta info rather than mistaking it for
// ordinary dialogue/narration and echoing it back.

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
  const excludeNote = (excludeNames && excludeNames.length)
    ? `\nItems that already exist anywhere (rooms, pantry/fridge, secret collection, or
already-pending discoveries) — never generate something that duplicates these, including
conceptually/semantically (not just exact name matches):
${JSON.stringify(excludeNames)}\n`
    : '';
  const wealthNote = wealthHint ? `\n{{char}}'s established financial/housing context (for wealth-level consistency on any pricier item): ${wealthHint}\n` : '';
  const isRealWorldCurrency = worldClass?.category === 'REALISTIC' || worldClass?.category === 'HISTORICAL' || worldClass?.category === 'MAJOR_IP';
  const countryNote = countryHint
    ? `\n⚠ This character's home country/region is already locked in: "${countryHint}". If the
"brand" field references a real-world brand, or if "tmi" mentions any price/monetary amount,
both MUST stay consistent with that locked-in country: ${isRealWorldCurrency
      ? `use a brand that actually makes sense for that country (don't default to a Korean
brand just because you're writing in Korean), and any amount mentioned must use that
country's real currency, written as a SYMBOL ($, £, €, ¥, etc.) if one commonly exists or its
3-letter ISO code if it doesn't — never spell it out as a word, and never default to Korean
won unless the locked-in country is actually Korea.`
      : `use this world's own invented brand/currency conventions consistently, not a
real-world country's brand or currency.`}\n`
    : '';
  const profileNote = profileContext ? `\n${profileContext}\n` : '';
  const triggerHistoryNote = recentTriggerNote ? `\n${recentTriggerNote}\n` : '';
  return `
Role: Hidden item discovery judge.
${INFO_BLOCK_GUARD}
${BREAK_CHARACTER_GUARD}
${langInstruction(lang)}

World classification result: ${JSON.stringify(worldClass)}
${profileNote}${wealthNote}${countryNote}${excludeNote}${triggerHistoryNote}
The most recent exchange in the roleplay (read-only context, do not narrate or continue it):
"""
${lastExchangeText}
"""

Task: Your job is genuine discernment, not a frequency quota — judge whether THIS SPECIFIC
moment plausibly supports {{char}} having quietly acquired, prepared, or kept a small item
just now — the way a mischievous "item collector" character watches {{char}}'s actions and
secretly notes down or slips out a hidden item.
This can be either something {{char}} did deliberately/calculatedly, OR something purely
spontaneous/impulsive — both count. What matters is that it's a genuine, in-character action
by {{char}}, not a random object appearing from nowhere.

⚠ Critical distinction: the discovered item must be something you INVENT/INFER as having
happened quietly OFF-SCREEN, inspired by the mood/context of the scene — NEVER an item or
object that the exchange above already explicitly describes, names, or shows on-screen. If
the text already directly states an item (e.g. it explicitly says {{char}} bought/handed over/
is holding a specific named thing), that is just the story already being told — it is NOT a
hidden discovery, and you must not "discover" it again. Only invent something genuinely new
that the visible narration does NOT already spell out — something that plausibly could have
happened alongside or just outside of what was shown, never a restatement of what's already
on the page.

⚠ Scene-continuation check (read this first): if a recent-trigger note is provided above,
first judge whether the CURRENT moment is still part of the SAME ongoing scene/event as that
earlier discovery (same activity, same setting, same conversation just continuing) — if so,
do NOT trigger again, even if it would otherwise qualify; the earlier discovery already
"used up" this scene. Only trigger again if the scene has genuinely moved on (a new activity,
a new location, a time-skip, a different topic/event entirely).

Illustrative (non-exhaustive) categories — these are GENRE-AGNOSTIC PATTERNS, not literal
scenarios. Always reinterpret them through the actual world classification (category/subtype)
— a "supply run" looks completely different in a contemporary slice-of-life world versus a
military/war setting, a medieval fantasy market, a zombie-apocalypse scavenging trip, or a
sci-fi resupply dock. Translate the underlying pattern, don't force the literal example:
- A routine errand/resupply/market moment: contemporary → grocery store; military → resupply
  run or PX/commissary; fantasy → town market or bazaar; apocalypse/horror → a scavenging run;
  sci-fi → a station resupply dock; cyberpunk → a night market or back-alley vendor; historical
  drama (Joseon, Victorian, etc.) → a period-appropriate marketplace or merchant visit;
  school/campus → a convenience store or campus shop run; idol/celebrity → a manager picking
  something up between schedules; mafia/noir → a errand that doubles as cover for something
  else; MAJOR_IP settings → that franchise's own equivalent (Diagon Alley, a cantina, etc.).
  Opportunistically slipping something practical into the haul while the persona isn't looking
  (something personally useful, or something for them),
  or a pre-planned gift tied to a relationship-positive moment OR a period of physical
  separation (deployment, a quest/mission away from home, training, a work trip, being
  stationed elsewhere, going off-world — whatever fits {{char}}'s actual occupation/setting):
  jewelry, a small carving/sculpture, a decorative piece, a ring, a trophy/memento from a
  mission, etc. — but this MUST make genuine sense given the ACTUAL narrative arc, not just
  the surface relationship label (read the recent context/lorebook for this). A flat
  contradiction with no narrative grounding is bad (e.g. "a secretly-kept unproposed
  engagement ring" when they're already happily, genuinely engaged makes no sense). But a
  more layered story can absolutely justify exactly this kind of item — e.g. if the
  relationship started as a contract/arranged marriage and has since grown into real
  feelings, {{char}} secretly buying "a real ring" (replacing the contractual one) to
  represent genuine commitment is a perfectly fitting, even moving, discovery. The test is
  narrative justification, not the relationship's surface label. Also, for any
  jewelry/significant-acquisition item, keep its price/quality/rarity consistent with
  {{char}}'s established wealth level and the world's own economy (from their
  housing/financial context) — don't have a modest-means character casually acquire
  something far above their reach without reason.
- A calm, ordinary moment of conversation or downtime (regardless of genre — a quiet barracks
  evening, a tavern night, a ship's mess hall, a living room, a dorm room, a backstage green
  room, a safehouse): {{char}} quietly picked up on an offhand remark or want and later acted
  on it (ordered online in a modern setting, commissioned a craftsman in a fantasy one,
  requisitioned it through channels in a military one, had a connection source it in a
  mafia/noir setting, etc.) without being asked
- The aftermath of intimacy, while the persona is still asleep/resting: an anticipatory
  caretaking gesture (painkillers set aside in case she's sore, a drink/meal already prepared
  — whatever fits the setting) — valid material, but this exact category is COMMON, so weigh
  it carefully against the rarity bar below rather than triggering it every time intimacy happens
- The aftermath of a genre-appropriate high-tension event: an argument/conflict in any genre,
  but also a battle/raid/mission gone wrong (military, fantasy), a narrow escape (horror,
  apocalypse), a difficult negotiation (political/court drama, mafia/noir), a bad performance
  or scandal (idol/celebrity), a brutal exam or rivalry blowup (school/campus), a near-miss
  on a job (heist/crime), survived danger of any kind in a MAJOR_IP setting too. NOT
  necessarily anything for the persona at all — could be something {{char}} got/kept for
  themselves out of anger, spite, impulse, relief, or grim humor, unrelated to making up or
  processing what happened
- Travel or transit downtime: a car ride, a long flight or train journey, a march between
  camps, a sea voyage, hyperspace transit — whatever fits the setting. The idle time, a
  layover/rest stop, or a different environment passed through creates an opportunity to
  notice, pick up, or quietly prepare something
- An incidental moment during {{char}}'s own duty/work itself — not a dedicated trip anywhere,
  just something that happens to come up while they're doing their normal job/role (a soldier
  on patrol, a doctor between patients, a chef experimenting in the kitchen, a mage
  restocking their workshop, a hacker mid-job) — they notice or acquire something as a
  side-effect of what they were already doing
- A milestone or celebratory occasion: a birthday, an anniversary, a promotion, a personal
  achievement, a holiday specific to the world/culture — a natural, premeditated occasion for
  {{char}} to have prepared something in advance (distinct from a generic "things are going
  well" mood — this is a specific, nameable occasion)
- Exploration or curiosity: {{char}} looking through an unfamiliar or half-forgotten space (a
  new room, an attic, an old storage area, ruins, an abandoned building, a relative's old
  belongings) and turning up something tucked away there

⚠ Full emotional range is valid — items don't have to be sweet or kind. Calculated-romantic,
impulsive, petty/spiteful, self-indulgent, practical — all of these are fair game, as long as
the resulting action genuinely fits {{char}}'s actual personality (don't force a romantic
gesture onto a character who wouldn't do that, and don't force pettiness onto someone who
wouldn't either).

- Do NOT trigger during active combat/danger or during an intimate act itself, or any moment
  where introducing this would break tension or feel jarring mid-scene. Aftermath/transition
  moments (the morning after, right after a fight ends, a time-skip) are fine windows even
  when the triggering moment itself was tense.
- Rarity calibration: even though several of the categories above (errands, mornings-after,
  post-argument) can recur often in a roleplay, this should still feel like a genuinely rare,
  special discovery overall — not something tied mechanically to "this scene type happened."
  Matching one of the categories above is necessary but NOT sufficient on its own — most
  individual instances of these common scene types should still resolve to false. When in
  doubt, lean toward false.

⚠ Quality bar — read this carefully: this item must feel genuinely WORTH discovering, and
the compelling reason must come EASILY and NATURALLY from the actual scene — not be invented
through effort. If you notice yourself straining, stretching, or forcing an "interesting"
spin onto an otherwise ordinary/mundane moment just to justify a trigger, that itself is the
signal to return triggered:false. A genuinely good discovery should feel obvious and natural
once you think of it, not like a contrived stretch. The object itself doesn't need to be
exotic or expensive; an ordinary, cheap, or small item is completely fine — what can NOT be
manufactured under pressure is the charm/humor/surprise/emotional hook in the tmi. Most
individual checks should end in "nothing compelling here, return false" — that is the
expected, normal outcome, not a failure state.

If triggered, generate ONE item that fits the world classification's brand/flavor
conventions (same rules as other item generation: REALISTIC → real brands; FANTASY →
invented brands fitting the aesthetic; HISTORICAL → invented period-appropriate names;
MAJOR_IP → in-universe brand if one exists, otherwise invent one matching its tone):
  - emoji: exactly one real unicode emoji character, never a text word
  - name
  - brand (or empty string if not applicable)
  - tmi: 1-2 sentences, written as a fun/charming/surprising note from the "item collector"
    about how and why this ended up with {{char}} without them noticing — this is the part
    that must earn the discovery, not just describe the object

${langInstructionStrong(lang)}

⚠ FINAL CHECK before you answer: if you're about to set triggered:true, re-read the tmi you
wrote one more time. Does it feel genuinely compelling, or does it feel like you stretched to
justify it? If there's any hint of straining, change your answer to triggered:false instead.
Also confirm: is this item something you invented/inferred as happening off-screen, or did
you just restate something the visible exchange already explicitly described? If it's the
latter, change your answer to triggered:false — that's not a hidden discovery.
Remember: false is the normal, expected outcome for most checks — not a fallback to avoid.

Also give a "qualityScore" from 0-10 rating how genuinely compelling/charming/surprising the
tmi is (10 = something you'd be delighted to stumble onto, 0 = bland filler). Be a harsh
grader — a merely "fine" or "acceptable" idea should score around 4-5, not 8+. Reserve
8-10 only for something that would genuinely make someone smile or gasp a little.

Output format: JSON only, no other text or code-block markers.
{ "triggered": false } OR
{ "triggered": true, "emoji":"", "name":"", "brand":"", "tmi":"", "qualityScore": 0 }
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
