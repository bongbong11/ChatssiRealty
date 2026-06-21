// prompts.js — 그남의 집 (구 챗씨부동산)
// index.js's callAI() uses ctx.generateQuietPrompt({quietPrompt, quietToLoud:true, skipWIAN:false}).
// This means the character sheet / persona / lorebook / recent chat history are already
// automatically blended into context before the quietPrompt (instruction) below is added —
// we never paste the context in as raw text ourselves.

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
    ? '⚠ Write all generated text content in English. Do not mix languages.'
    : '⚠ 생성되는 모든 텍스트 내용은 한국어로 작성할 것. 언어를 섞지 말 것.';
}
// Repeated right above the output format, since models sometimes default to English
// when they see English JSON keys, even when asked to write Korean values.
function langInstructionStrong(lang) {
  return lang === 'en'
    ? '⚠ REMINDER: the JSON keys below (emoji, name, brand, etc.) stay as English field names, but every actual text VALUE you write into them must be in English too — this reminder exists because models sometimes default to the wrong language when keys are in English. Re-check your output language now.'
    : '⚠ 다시 한번 강조: 아래 JSON의 key(emoji, name, brand 등 영문 필드명)는 형식이니까 그대로 두고, 그 안에 채워넣는 실제 텍스트 값은 전부 한국어로 작성할 것. 영문 key를 보고 값까지 영어로 쓰지 않도록 출력 직전에 다시 확인할 것.';
}

export function buildWorldClassifyPrompt(_unused, userHint, lang = 'ko') {
  return `
Role: Character data analyst.
${INFO_BLOCK_GUARD}
${BREAK_CHARACTER_GUARD}
${langInstruction(lang)}

Refer to the character sheet, persona, lorebook, and recent chat history of this conversation.
User-provided reference text: "${userHint || "(none)"}"

Task: Classify into exactly one of these 4 categories.
  - REALISTIC: the real world, based on an actual country/city
  - FANTASY: not just traditional magic fantasy, but **any original (non-existing-IP) genre
    setting** — zombie apocalypse, cyberpunk, sci-fi/space, post-apocalyptic, dystopia,
    military fiction, etc. Any original genre world that isn't realistic, historical, or a
    major IP belongs here.
  - HISTORICAL: a specific period setting (state the era/region concretely)
  - MAJOR_IP: an existing well-known franchise's setting (infer and name the specific work)

⚠ Do NOT write the subtype field as a vague label like "fantasy" — write a **specific
genre/setting** (e.g. "zombie apocalypse", "cyberpunk dystopia", "near-future space sci-fi",
"modern military fiction", "medieval magic fantasy"). This subtype is used directly in the
item-generation step to pick genre-appropriate objects.

If the user provided reference text, prioritize it above all else. If the text is in
"setting-location" form (e.g. "Harry Potter-London"), parse the setting and location separately.

For MAJOR_IP cases that split into multiple sub-series (e.g. Call of Duty):
  1st priority - if the character sheet/lorebook has a clue, use that
  2nd priority - if the user's text names a specific sub-series, use that (allow partial
                 matches — "blops"/"black ops"/"Call of Duty Black Ops" should all match)
  3rd priority - if neither exists, use a default (Call of Duty → Modern Warfare reboot)

${langInstructionStrong(lang)}

Output format: JSON only, no other text or code-block markers, pure JSON.
{ "category": "REALISTIC|FANTASY|HISTORICAL|MAJOR_IP", "subtype": "...", "location_hint": "..." }
`.trim();
}

export function buildAddressGeneratePrompt(_unused, worldClass, userHint, lang = 'ko') {
  return `
Role: Real-estate info generator.
${INFO_BLOCK_GUARD}
${BREAK_CHARACTER_GUARD}
${langInstruction(lang)}

Refer to the character sheet, persona, lorebook, and recent chat history of this
conversation to estimate the character's wealth level, occupation, and home country.

World classification result: ${JSON.stringify(worldClass)}
User reference text: "${userHint || "(none)"}"

Task: Generate the character's housing info in the fields below. Keep each field a short
answer, not prose (the "story" field is the only exception).
  - residenceType (rent/own — reflect local convention; consider Korea's "jeonse" deposit
    system if relevant)
  - price (in the local currency, within the real going rate for that area)
  - buildingType
  - rooms, bathrooms
  - structureStyle (open-plan / separated, etc.)
  - hasYard
  - hasGarage
  - location (a real place name, down to the neighborhood level)
  - address (a specific street number/coordinate — pick any point within the neighborhood;
    don't worry about whether it matches a real building exactly)
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

⚠ Also output a hidden "characterProfileSummary" field — a compact, keyword-dense summary
(3-5 short lines) of {{char}}'s personality, occupation, notable traits, and the relationship
dynamic with the persona, distilled from the character sheet/persona/lorebook/chat context
you were given. This is INTERNAL metadata, never shown to the user — its only purpose is so
that OTHER generation calls later on can reference this compact summary instead of re-reading
the full character sheet every time. Keep it dense and information-rich, not prose.

${langInstructionStrong(lang)}

Output format: JSON only, no other text or code-block markers.
{ "residenceType":"", "price":"", "buildingType":"", "rooms":0, "bathrooms":0,
  "structureStyle":"", "hasYard":true, "hasGarage":true, "location":"", "address":"",
  "moveInDate":"", "interiorStyle":"", "renovation":"", "story":"", "status":"",
  "appendix": ["..."], "wealthTier": "low|middle|high|very_high",
  "characterProfileSummary": "" }
`.trim();
}

export function buildHouseMovePrompt(_unused, worldClass, prevCard, lang = 'ko') {
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
to buildAddressGeneratePrompt (including the hidden "wealthTier" field).

${langInstructionStrong(lang)}

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
${rerollNote}${existingNote}
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
   - price (local currency or the world's own currency unit)
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
Do not output an out-of-place item with an empty or generic tmi.

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
If the era/genre has no concept of a fridge (e.g. the Joseon era), do not generate a
"fridge" at all — return empty instead.

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

export function buildDiscoveryCheckPrompt(lastExchangeText, worldClass, profileContext, wealthHint, excludeNames, lang = 'ko') {
  const excludeNote = (excludeNames && excludeNames.length)
    ? `\nItems that already exist anywhere (rooms, pantry/fridge, secret collection, or
already-pending discoveries) — never generate something that duplicates these, including
conceptually/semantically (not just exact name matches):
${JSON.stringify(excludeNames)}\n`
    : '';
  const wealthNote = wealthHint ? `\n{{char}}'s established financial/housing context (for wealth-level consistency on any pricier item): ${wealthHint}\n` : '';
  const profileNote = profileContext ? `\n${profileContext}\n` : '';
  return `
Role: Hidden item discovery judge.
${INFO_BLOCK_GUARD}
${BREAK_CHARACTER_GUARD}
${langInstruction(lang)}

World classification result: ${JSON.stringify(worldClass)}
${profileNote}${wealthNote}${excludeNote}
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

Illustrative (non-exhaustive) categories — generalize beyond these, don't treat this as a
checklist to cycle through:
- Everyday outings (a walk, a cafe visit): a small thoughtful gesture (quietly pre-ordering
  her favorite dessert) or a spontaneous little creation (absent-mindedly folding a napkin
  into a paper crane) — only if it fits {{char}}'s established personality
- Errands/shopping together: opportunistically slipping something practical into the cart
  while the persona isn't looking (protection, a personal snack/drink they like), or a
  pre-planned gift tied to a relationship-positive moment or a period of physical separation
  (deployment, training, a work trip — whatever fits {{char}}'s occupation/situation):
  jewelry, a small carving/sculpture, a decorative piece, a ring, etc. — but this MUST make
  genuine sense given the ACTUAL narrative arc, not just the surface relationship label (read
  the recent context/lorebook for this). A flat contradiction with no narrative grounding is
  bad (e.g. "a secretly-kept unproposed engagement ring" when they're already happily,
  genuinely engaged makes no sense). But a more layered story can absolutely justify exactly
  this kind of item — e.g. if the relationship started as a contract/arranged marriage and has
  since grown into real feelings, {{char}} secretly buying "a real ring" (replacing the
  contractual one) to represent genuine commitment is a perfectly fitting, even moving,
  discovery. The test is narrative justification, not the relationship's surface label. Also,
  for any jewelry/significant-purchase item, keep its price/quality consistent with {{char}}'s
  established wealth level (from their housing/financial context) — don't have a
  modest-income character casually buy something far above their means without reason.
- A calm, ordinary conversation: {{char}} quietly picked up on an offhand remark or want and
  later ordered/acquired that exact thing (e.g. online) without being asked
- The morning after intimacy, while the persona is still asleep: an anticipatory caretaking
  gesture (painkillers set aside in case she's sore, coffee already brewing) — valid
  material, but this exact category is COMMON, so weigh it carefully against the rarity bar
  below rather than triggering it every time intimacy happens
- After an argument or conflict: NOT necessarily anything for the persona at all — could be
  something {{char}} got for themselves out of anger, spite, or impulse, unrelated to making up

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
  When in doubt, lean toward false.

⚠ Quality bar: this item must feel genuinely WORTH discovering — not a generic or forgettable
object. The object itself doesn't need to be exotic or expensive; an ordinary, cheap, or
small item is completely fine. What makes it worth discovering is the "why" — the tmi must
give it real charm, humor, surprise, or a small emotional hook. If you can't come up with a
genuinely compelling reason, return triggered:false instead of generating something boring
just to fill the slot.

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

Output format: JSON only, no other text or code-block markers.
{ "triggered": false } OR
{ "triggered": true, "emoji":"", "name":"", "brand":"", "tmi":"" }
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
