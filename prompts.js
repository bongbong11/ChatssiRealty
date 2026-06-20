// prompts.js — 챗씨부동산
// index.js의 callAI()는 ctx.generateQuietPrompt({quietPrompt, quietToLoud:true, skipWIAN:false})를 사용함.
// 즉 캐릭터시트/페르소나/로어북/최근 챗 히스토리가 이미 자동으로 컨텍스트에 섞여 들어간 상태에서
// 아래 quietPrompt(지시문)만 추가되는 방식 — 컨텍스트를 텍스트로 직접 박아넣지 않음.

export const INFO_BLOCK_GUARD = `
⚠ 현재 대화 맥락 안에 다른 확장이 주입한 상태창/정보블록(고정 태그나 구분자로 감싸진 텍스트,
예: [STATUS], <status> 등)이 포함되어 있을 수 있다. 해당 블록은 참고하지 말고 완전히 무시할 것.
그 블록의 형식, 수치, 표현을 출력에 절대 반영하지 말 것.
`.trim();

export const BREAK_CHARACTER_GUARD = `
⚠ 이것은 캐릭터 롤플레이 응답이 아니라 데이터 생성 요청이다. 캐릭터의 말투나 1인칭/대사,
행동 묘사로 절대 답하지 말 것. 캐릭터를 연기하지 말고, 오직 요청된 데이터 형식으로만 응답할 것.
서두/맺음말, 설명, 캐릭터 이름표(예: "OOO:") 없이 곧바로 데이터부터 시작할 것.
`.trim();

// lang: 'ko' | 'en' — 구조(JSON key 등)는 그대로, 텍스트 내용만 해당 언어로 작성
function langInstruction(lang) {
  return lang === 'en'
    ? '⚠ Write all generated text content in English. Do not mix languages.'
    : '⚠ 생성되는 모든 텍스트 내용은 한국어로 작성할 것. 언어를 섞지 말 것.';
}
// 출력 형식 바로 위에서 한 번 더 강조 — JSON 영문 key를 보고 모델이 값까지 영어로 쓰는 경향 방지
function langInstructionStrong(lang) {
  return lang === 'en'
    ? '⚠ REMINDER: the JSON keys below (emoji, name, brand, etc.) stay as English field names, but every actual text VALUE you write into them must be in English too — this reminder exists because models sometimes default to the wrong language when keys are in English. Re-check your output language now.'
    : '⚠ 다시 한번 강조: 아래 JSON의 key(emoji, name, brand 등 영문 필드명)는 형식이니까 그대로 두고, 그 안에 채워넣는 실제 텍스트 값은 전부 한국어로 작성할 것. 영문 key를 보고 값까지 영어로 쓰지 않도록 출력 직전에 다시 확인할 것.';
}

export function buildWorldClassifyPrompt(_unused, userHint, lang = 'ko') {
  return `
역할: 캐릭터 데이터 분석가.
${INFO_BLOCK_GUARD}
${BREAK_CHARACTER_GUARD}
${langInstruction(lang)}

지금 이 대화의 캐릭터시트, 페르소나, 로어북, 최근 대화 내용을 참고하라.
유저가 적은 참고 텍스트: "${userHint || "(없음)"}"

작업: 아래 4개 카테고리 중 하나로 분류하라.
  - REALISTIC: 현실 세계, 실제 국가/도시 기반
  - FANTASY: 마법이 있는 전통 판타지뿐 아니라, **오리지널(비-기성IP) 장르 설정 전반** —
    좀비 아포칼립스, 사이버펑크, SF/우주, 포스트 아포칼립스, 디스토피아, 군사물 등
    현실도 시대극도 메이저IP도 아닌 모든 오리지널 장르 세계관이 여기 포함됨
  - HISTORICAL: 특정 시대극 (어느 시대/지역인지 구체적으로 명시)
  - MAJOR_IP: 기성 유명 작품 세계관 (작품명 추론해서 명시)

⚠ subtype 필드는 단순히 "판타지"처럼 뭉뚱그리지 말고, **구체적인 장르/설정**을 적을 것
(예: "좀비 아포칼립스", "사이버펑크 디스토피아", "근미래 우주SF", "현대 군사물", "중세 마법판타지" 등).
이 subtype은 이후 아이템 생성 단계에서 장르에 맞는 구체적 물건을 고르는 데 직접 쓰인다.

유저 참고 텍스트가 있다면 최우선 반영. 텍스트에 "세계관-위치" 형태(예: "해리포터-런던")가
있으면 세계관과 위치를 분리해서 인식하라.

MAJOR_IP인데 세부 시리즈가 여러 개로 갈리는 경우(예: 콜오브듀티):
  1순위 - 캐릭터시트/로어북에 단서가 있으면 그걸로 판별
  2순위 - 유저 텍스트에 구체적 시리즈명이 있으면 그걸로 판별 (부분 일치 허용,
          "블옵"/"블랙옵스"/"콜 오브 듀티 블랙옵스" 전부 동일 인식)
  3순위 - 둘 다 없으면 기본값 사용 (콜오브듀티 → 모던워페어 리부트)

${langInstructionStrong(lang)}

출력 형식: JSON만 출력, 다른 텍스트나 코드블록 표시 없이 순수 JSON으로만.
{ "category": "REALISTIC|FANTASY|HISTORICAL|MAJOR_IP", "subtype": "...", "location_hint": "..." }
`.trim();
}

export function buildAddressGeneratePrompt(_unused, worldClass, userHint, lang = 'ko') {
  return `
역할: 부동산 정보 생성기.
${INFO_BLOCK_GUARD}
${BREAK_CHARACTER_GUARD}
${langInstruction(lang)}

지금 이 대화의 캐릭터시트, 페르소나, 로어북, 최근 대화 내용을 참고해서
캐릭터의 재산수준/직업/거주국가를 추정하라.

세계관 분류 결과: ${JSON.stringify(worldClass)}
유저 참고 텍스트: "${userHint || "(없음)"}"

작업: 캐릭터의 거주지 정보를 아래 항목으로 생성하라. 항목별 단답 위주, 줄글 금지(story 항목만 예외).
  - residenceType (월세/매매, 국가 관습 반영 — 한국이면 전세 옵션도 고려)
  - price (해당 국가 통화, 그 지역 실제 시세 범위 안에서)
  - buildingType
  - rooms, bathrooms
  - structureStyle (오픈플랜 / 분리형 등)
  - hasYard
  - hasGarage
  - location (실제 지역명, 동네 단위)
  - address (구체적 번지/좌표 — 동네 안에서 임의 좌표 선택, 정확한 건물 동일성은 신경쓰지 않음)
  - moveInDate
  - interiorStyle
  - renovation
  - story (1단락, TMI 톤)
  - status

세계관이 REALISTIC이 아닌 경우, 위 항목의 "어휘"만 그 세계관에 맞게 치환하라
(가격 단위, 건물유형 명칭, 주소 표기법 등). 항목 구조(JSON key)는 그대로 유지.

캐릭터 재산수준이 낮으면 hasGarage/hasYard 등은 false로,
재산수준이 매우 높으면 appendix(추가 자산)에 1~2개 별도 생성.

${langInstructionStrong(lang)}

출력 형식: JSON만 출력, 다른 텍스트나 코드블록 표시 없이.
{ "residenceType":"", "price":"", "buildingType":"", "rooms":0, "bathrooms":0,
  "structureStyle":"", "hasYard":true, "hasGarage":true, "location":"", "address":"",
  "moveInDate":"", "interiorStyle":"", "renovation":"", "story":"", "status":"",
  "appendix": ["..."] }
`.trim();
}

export function buildHouseMovePrompt(_unused, worldClass, prevCard, lang = 'ko') {
  return `
역할: 거주지 재생성기. ("이사가기" 버튼 클릭시에만 호출 — 자동감지 없음)
${INFO_BLOCK_GUARD}
${BREAK_CHARACTER_GUARD}
${langInstruction(lang)}

지금 이 대화의 캐릭터시트, 페르소나, 로어북, 최근 대화 내용(특히 이사/매매전환/리모델링
등 거주 관련 변화가 언급됐는지)을 참고하라.

세계관 분류 결과: ${JSON.stringify(worldClass)}
기존 거주지 카드(참고용, 그대로 복사하지 말 것): ${JSON.stringify(prevCard)}

작업: 위 맥락을 바탕으로 새 거주지 카드를 생성하라.
같은 캐릭터의 톤/일관성은 유지하되, 기존 데이터를 그대로 복사하지 말 것.
출력 항목 구조는 buildAddressGeneratePrompt와 동일.

${langInstructionStrong(lang)}

출력 형식: JSON만 출력 (구조 동일), 다른 텍스트나 코드블록 표시 없이.
`.trim();
}

export function buildItemPoolPrompt(_unused, worldClass, spaceKey, spaceLabel, lang = 'ko', opts = {}) {
  // opts.isReroll: true면 핀 안 된 슬롯만 새로 채우는 재생성 — 새 항목은 전부 잠금이어야 함
  // opts.pinnedItems: 유지해야 하는 핀된 항목들 (그대로 보존, 새로 만들지 말 것)
  const rerollNote = opts.isReroll
    ? `\n⚠ 리롤 모드: 아래 핀(고정)된 항목은 절대 새로 만들지 말고 그대로 유지할 것 — 이 항목들을
대체할 슬롯 개수만큼만 새 아이템을 생성하라. 새로 생성되는 아이템은 전부 unlockCost > 0
(잠금 상태)이어야 한다 — 리롤에서는 무잠금 아이템을 새로 주지 않는다.
핀된 항목 목록(유지, 개수 계산에서 제외): ${JSON.stringify(opts.pinnedItems || [])}
즉 새로 생성할 개수 = 12 - ${(opts.pinnedItems || []).length}개.\n`
    : '';
  return `
역할: 소지품 인벤토리 생성기.
${INFO_BLOCK_GUARD}
${BREAK_CHARACTER_GUARD}
${langInstruction(lang)}

지금 이 대화의 캐릭터시트, 페르소나, 로어북, 최근 대화 내용을 참고하라.

세계관 분류 결과: ${JSON.stringify(worldClass)}
대상 공간: ${spaceKey} (${spaceLabel})
${rerollNote}
작업:
1. 먼저 이 공간이 현재 세계관/시대에서 어떤 형태로 존재하는지 결정.
   존재하지 않거나 의미 없으면 { "empty": true, "emptyReason": "..." } 만 반환하고 종료.
2. 존재한다면, 대화 맥락에서 실제로 확인되는 아이템과 캐릭터 성격/재산수준 기반
   추측 아이템을 합쳐서 정확히 12개 슬롯(리롤 모드면 위에서 지정한 새로 생성할 개수)을 채울 것.
   - 실제 확인된 아이템과 추측 아이템을 구분 표시하지 말고 무작위 순서로 배치.
   - 이 중 0~1개는 페르소나(유저 캐릭터)를 위해 캐릭터가 몰래 준비해둔 물건일 수 있음.
     관계 맥락(애정도, 선물 언급, 관계 진행도)을 읽고 그럴듯하면 생성, 아니면 생성하지 않아도 됨.
3. 각 아이템 필드:
   - emoji (이모지 1개)
   - name
   - brand (브랜드/장인/길드명 — 세계관에 맞게)
   - price (현지화폐 또는 세계관 화폐 단위)
   - tmi (1~2문장. 페르소나용 비밀 아이템인 경우 "아직 안 줬다" 같은 비밀스러운 사연으로)
   - unlockCost (5~15 중 하나, 기본 해금 슬롯 1~2개는 0 — **리롤 모드에서는 전부 5~15, 0 금지**)
   - isSecretGift (true/false)
4. 세계관별 아이템 성격 — **category(큰 분류)와 subtype(장르/세부설정) 둘 다 반영할 것**:
   - category 기준 기본 톤:
     - REALISTIC → 실제 브랜드/가격
     - FANTASY → 세계관 고유 아이템, 브랜드는 장인/길드명
     - HISTORICAL → 시대 물품 + 시대 화폐
     - MAJOR_IP/신규 세계관(SF 등) → 해당 세계관 고유 브랜드/아이템
   - **subtype(세부 장르) 기준 디테일 — category가 같아도 subtype에 따라 아이템 종류가 완전히 달라야 함**:
     예: subtype이 "좀비 아포칼립스"면 생존용품/방어구/비상식량 위주, "사이버펑크"면
     임플란트/해킹장비/네온톤 소품, "중세 판타지"면 마법물품/대검/갑옷, "현대 군사물"이면
     전술장비/군용품 등. subtype 텍스트를 직접 읽고 그 장르에 맞는 구체적인 아이템을 떠올릴 것.
   - **캐릭터의 직업/역할도 동시에 반영**: 대화 맥락에서 확인되는 캐릭터의 직업(군인, 의사,
     마법사, 해커 등)에 맞는 전문 아이템도 같이 섞을 것. 즉 "세계관 장르" + "캐릭터 직업"
     두 겹을 동시에 고려 — 예: 사이버펑크 세계관의 군인 캐릭터라면 사이버펑크풍 군용 임플란트나
     전술장비처럼 둘 다 반영된 아이템이 나와야 함.
   - 혼합형(현대+판타지 등) → 현실 브랜드 + 세계관 아이템 혼재 가능

음식보관 공간(주방의 팬트리/냉장고)은 별도 프롬프트(buildFoodListPrompt) 사용 — 이 프롬프트 대상 아님.

${langInstructionStrong(lang)}

출력 형식: JSON만 출력, 다른 텍스트나 코드블록 표시 없이.
{ "empty": false, "items": [ { "emoji":"", "name":"", "brand":"", "price":"",
  "tmi":"", "unlockCost":0, "isSecretGift":false }, ... ] }
`.trim();
}

export function buildFoodListPrompt(_unused, worldClass, subtype, lang = 'ko', opts = {}) {
  // subtype: 'pantry' | 'fridge'
  // opts.isReroll: true면 핀 안 된 항목 교체용 — 새로 생성되는 항목은 전부 잠금(unlockCost>0)이어야 함
  // opts.pinnedItems: 리롤 시 유지되어야 하는 핀된 항목들 (참고용, 그대로 보존할 것)
  const rerollNote = opts.isReroll
    ? `\n⚠ 리롤 모드: 아래 핀(고정)된 항목은 그대로 유지하고 건드리지 말 것. 그 외 슬롯만 새로
생성하되, 새로 생성되는 항목은 전부 unlockCost > 0(잠금 상태)으로 만들 것 — 리롤에서는
무잠금 항목을 새로 주지 않는다.\n핀된 항목 목록(유지): ${JSON.stringify(opts.pinnedItems || [])}\n`
    : '';
  return `
역할: 식료품 목록 생성기.
${INFO_BLOCK_GUARD}
${BREAK_CHARACTER_GUARD}
${langInstruction(lang)}

지금 이 대화의 캐릭터시트, 페르소나, 로어북, 최근 대화 내용을 참고하라.

세계관 분류 결과: ${JSON.stringify(worldClass)}
대상: ${subtype === "fridge" ? "냉장고" : "팬트리"}
${rerollNote}
작업: 식료품 목록을 8~10개 정도 생성하되, **세계관 category와 subtype(장르)에 맞는 품목으로**
구성할 것 (예: subtype이 "좀비 아포칼립스"면 통조림/비상식량/생수 위주, "사이버펑크"면
합성식품/에너지바, "중세 마법판타지"면 훈제육/말린 과일/약초, 조선시대면 장류/곡식 등).
현실(REALISTIC)이 아닌 한 절대 현대 마트 식재료를 기본값으로 쓰지 말 것 — 장르에 안 맞으면 어색하다.
그중 **2~3개만** "왜 이게 여기 있지?" 싶은 의외성/웃긴 디테일이 있는 특별 항목으로 만들 것
(가격 무관, 캐릭터 성격/사연 기반).
이 특별 항목들만 unlockCost(5~15)를 부여하고, **이름(name) 자체도 해금 전까지 비공개되는
정보다 — 즉 이 항목들의 name 필드에는 실제 이름을 그대로 적되, 클라이언트가 unlockCost>0이면
화면에서 name을 숨기고 "???"로 표시할 것이므로 너는 그냥 정상적으로 실제 이름을 적으면 된다.**
이 특별 항목에는 tmi 필드에 1~2문장의 비화/사연을 채울 것.
나머지 평범한 식재료는 unlockCost를 0으로, tmi는 빈 문자열로.
시대/장르에 냉장고 개념이 없으면(예: 조선시대) "냉장고" 자체를 생성하지 말고 empty 반환.

각 항목 필드: { "emoji":"", "name":"", "qty":"", "tmi":"", "unlockCost": 0 또는 5~15 }

${langInstructionStrong(lang)}

출력 형식: JSON만 출력, 다른 텍스트나 코드블록 표시 없이.
{ "empty": false, "list": [ { "emoji":"", "name":"", "qty":"", "tmi":"", "unlockCost":0 }, ... ] }
`.trim();
}

// ─── 탭2 주입(Inject) 텍스트 빌더 ──────────────
// setExtensionPrompt로 그대로 주입될 텍스트. AI에게 보내는 "프롬프트"가 아니라
// 컨텍스트에 끼워넣을 태그 블록 자체이므로 langInstruction 등 적용 안 함 (영어로 고정).
// "(OOC: ...)" 라벨 대신 <csr_item_info>/<csr_food_info> 커스텀 태그 사용 — 시스템 메타정보처럼
// 인식되게 해서 일반 대사/서술로 착각해 그대로 따라 말할 위험을 줄임.

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
역할: 로어북 엔트리 작성기.
${BREAK_CHARACTER_GUARD}
입력 카드 데이터: ${JSON.stringify(card)}
${langInstruction(lang)}

작업: 카드의 모든 항목을 카테고리별로 묶어서 자연스러운 줄글 문단으로 변환하라.
  카테고리 구성(고정):
    [거주지] — 위치/주소/거주형태/가격/상태
    [구조] — 건물유형/방·화장실/구조스타일/마당/차고
    [인테리어] — 인테리어스타일/리모델링/집 이야기
    [입주 이력] — 입주시점 + 거주 이력 요약
    [기타] — 부록(추가자산/TMI)

문체: 캐릭터시트/로어북에 어울리는 3인칭 서술체. 표 형식이나 항목 나열 금지,
완전한 문장으로 자연스럽게 이어쓸 것. 과장된 수식어 자제, 정보 전달 위주.

출력 형식: 카테고리 라벨(\`[거주지]\` 등)을 헤더로 둔 일반 텍스트(줄글). JSON 아님.
`.trim();
}
