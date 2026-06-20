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

${langInstructionStrong(lang)}

Output format: JSON only, no other text or code-block markers.
{ "residenceType":"", "price":"", "buildingType":"", "rooms":0, "bathrooms":0,
  "structureStyle":"", "hasYard":true, "hasGarage":true, "location":"", "address":"",
  "moveInDate":"", "interiorStyle":"", "renovation":"", "story":"", "status":"",
  "appendix": ["..."] }
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
to buildAddressGeneratePrompt.

${langInstructionStrong(lang)}

Output format: JSON only (same structure), no other text or code-block markers.
`.trim();
}

export function buildItemPoolPrompt(_unused, worldClass, spaceKey, spaceLabel, lang = 'ko', opts = {}) {
  // opts.isReroll: true means only refilling unpinned slots — newly generated items must all be locked
  // opts.pinnedItems: pinned items that must be preserved as-is, not regenerated
  const rerollNote = opts.isReroll
    ? `\n⚠ Reroll mode: never regenerate the pinned items listed below — keep them exactly as
they are. Only generate as many new items as there are slots to replace. Every newly
generated item MUST have unlockCost > 0 (locked) — reroll never hands out free unlocks.
Pinned items (keep, excluded from the count): ${JSON.stringify(opts.pinnedItems || [])}
So the number of new items to generate = 12 - ${(opts.pinnedItems || []).length}.\n`
    : '';
  return `
Role: Belongings inventory generator.
${INFO_BLOCK_GUARD}
${BREAK_CHARACTER_GUARD}
${langInstruction(lang)}

Refer to the character sheet, persona, lorebook, and recent chat history of this conversation.

World classification result: ${JSON.stringify(worldClass)}
Target space: ${spaceKey} (${spaceLabel})
${rerollNote}
Task:
1. First decide how this space exists (if at all) in the current world/era. If it doesn't
   exist or makes no sense, return only { "empty": true, "emptyReason": "..." } and stop.
2. If it exists, combine items actually confirmed in the conversation context with plausible
   guessed items based on the character's personality/wealth level to fill exactly 12 slots
   (or, in reroll mode, the number of new items specified above).
   - Do not mark which items are confirmed vs. guessed — place them in random order.
   - 0–1 of these may be something the character has secretly prepared as a gift for the
     persona (the user's character). Read the relationship context (affection level, gift
     mentions, relationship progress) and generate one if it plausibly fits; otherwise skip it.
3. Fields for each item:
   - emoji (one emoji)
   - name
   - brand (brand / artisan / guild name — fitting the world)
   - price (local currency or the world's own currency unit)
   - tmi (1–2 sentences. For a secret persona-gift item, write it as a secret backstory like
     "hasn't given it yet")
   - unlockCost (one of 5–15; the 1–2 default free slots get 0 — **in reroll mode, ALWAYS
     5–15, never 0**)
   - isSecretGift (true/false)
4. Item flavor by world — **reflect BOTH category (broad classification) and subtype
   (genre/specific setting)**:
   - Baseline tone by category:
     - REALISTIC → real brands/prices
     - FANTASY → world-specific items, brand = artisan/guild name
     - HISTORICAL → period objects + period currency
     - MAJOR_IP/new setting (sci-fi, etc.) → that world's own brands/items
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

The food-storage space (kitchen's pantry/fridge) uses a separate prompt (buildFoodListPrompt)
— it is not a target of this prompt.

${langInstructionStrong(lang)}

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
  return `
Role: Food/grocery list generator.
${INFO_BLOCK_GUARD}
${BREAK_CHARACTER_GUARD}
${langInstruction(lang)}

Refer to the character sheet, persona, lorebook, and recent chat history of this conversation.

World classification result: ${JSON.stringify(worldClass)}
Target: ${subtype === "fridge" ? "fridge" : "pantry"}
${rerollNote}
Task: Generate about 8–10 food items, **matching the world's category and subtype (genre)**
(e.g. if subtype is "zombie apocalypse", lean toward canned goods/emergency rations/bottled
water; "cyberpunk" → synthetic food/energy bars; "medieval magic fantasy" → smoked meat/dried
fruit/herbs; Joseon-era → fermented sauces/grains, etc.). Unless the world is REALISTIC, never
default to modern supermarket groceries — it will feel out of place for the genre.
Make **only 2–3** of them special items with a "why is this even here?" surprising/funny
detail (regardless of price, based on the character's personality/backstory).
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

Instruction: Weave this into the story ONLY if it naturally fits the current scene and
flow — never force it in awkwardly or mention it out of nowhere. You may let it surface
as a full, explicit moment, or let it show through only as a subtle nuance or passing
detail, or simply have {{char}} remain aware it exists without it surfacing in the prose
at all — whichever feels organic. Continue the roleplay normally as {{char}}, in-character,
exactly as you would without this tag. Do NOT break character, do NOT reply as if
answering a question, and do NOT mention, quote, or acknowledge this tag in your response.
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

Instruction: Treat this as background reference only — there's no need to force a
mention or use of these items. For any item with a description attached, you may let
that backstory color the scene naturally if it fits — anywhere from a full explicit
moment down to just a subtle nuance, entirely your call. Continue the roleplay normally
as {{char}}, in-character, exactly as you would without this tag. Do NOT break character,
do NOT reply as if answering a question, and do NOT mention, quote, or acknowledge this
tag in your response. If the user's message contains its own (OOC: ...) question or
instruction, that takes top priority — answer or follow that first; treat this tag as
secondary, supplementary reference information only.
</csr_food_info>`.trim();
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
