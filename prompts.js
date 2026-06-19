// prompts.js — 챗씨부동산
// index.js의 callAI()는 ctx.generateQuietPrompt({quietPrompt, quietToLoud:true, skipWIAN:false})를 사용함.
// 즉 캐릭터시트/페르소나/로어북/최근 챗 히스토리가 이미 자동으로 컨텍스트에 섞여 들어간 상태에서
// 아래 quietPrompt(지시문)만 추가되는 방식 — 컨텍스트를 텍스트로 직접 박아넣지 않음.

export const INFO_BLOCK_GUARD = `
⚠ 현재 대화 맥락 안에 다른 확장이 주입한 상태창/정보블록(고정 태그나 구분자로 감싸진 텍스트,
예: [STATUS], <status> 등)이 포함되어 있을 수 있다. 해당 블록은 참고하지 말고 완전히 무시할 것.
그 블록의 형식, 수치, 표현을 출력에 절대 반영하지 말 것.
`.trim();

export function buildWorldClassifyPrompt(_unused, userHint) {
  return `
역할: 캐릭터 데이터 분석가.
${INFO_BLOCK_GUARD}

지금 이 대화의 캐릭터시트, 페르소나, 로어북, 최근 대화 내용을 참고하라.
유저가 적은 참고 텍스트: "${userHint || "(없음)"}"

작업: 아래 4개 카테고리 중 하나로 분류하라.
  - REALISTIC: 현실 세계, 실제 국가/도시 기반
  - FANTASY: 오리지널 판타지/이세계
  - HISTORICAL: 특정 시대극 (어느 시대/지역인지 구체적으로 명시)
  - MAJOR_IP: 기성 유명 작품 세계관 (작품명 추론해서 명시)

유저 참고 텍스트가 있다면 최우선 반영. 텍스트에 "세계관-위치" 형태(예: "해리포터-런던")가
있으면 세계관과 위치를 분리해서 인식하라.

MAJOR_IP인데 세부 시리즈가 여러 개로 갈리는 경우(예: 콜오브듀티):
  1순위 - 캐릭터시트/로어북에 단서가 있으면 그걸로 판별
  2순위 - 유저 텍스트에 구체적 시리즈명이 있으면 그걸로 판별 (부분 일치 허용,
          "블옵"/"블랙옵스"/"콜 오브 듀티 블랙옵스" 전부 동일 인식)
  3순위 - 둘 다 없으면 기본값 사용 (콜오브듀티 → 모던워페어 리부트)

출력 형식: JSON만 출력, 다른 텍스트나 코드블록 표시 없이 순수 JSON으로만.
{ "category": "REALISTIC|FANTASY|HISTORICAL|MAJOR_IP", "subtype": "...", "location_hint": "..." }
`.trim();
}

export function buildAddressGeneratePrompt(_unused, worldClass, userHint) {
  return `
역할: 부동산 정보 생성기.
${INFO_BLOCK_GUARD}

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

출력 형식: JSON만 출력, 다른 텍스트나 코드블록 표시 없이.
{ "residenceType":"", "price":"", "buildingType":"", "rooms":0, "bathrooms":0,
  "structureStyle":"", "hasYard":true, "hasGarage":true, "location":"", "address":"",
  "moveInDate":"", "interiorStyle":"", "renovation":"", "story":"", "status":"",
  "appendix": ["..."] }
`.trim();
}

export function buildHouseMovePrompt(_unused, worldClass, prevCard) {
  return `
역할: 거주지 재생성기. ("이사가기" 버튼 클릭시에만 호출 — 자동감지 없음)
${INFO_BLOCK_GUARD}

지금 이 대화의 캐릭터시트, 페르소나, 로어북, 최근 대화 내용(특히 이사/매매전환/리모델링
등 거주 관련 변화가 언급됐는지)을 참고하라.

세계관 분류 결과: ${JSON.stringify(worldClass)}
기존 거주지 카드(참고용, 그대로 복사하지 말 것): ${JSON.stringify(prevCard)}

작업: 위 맥락을 바탕으로 새 거주지 카드를 생성하라.
같은 캐릭터의 톤/일관성은 유지하되, 기존 데이터를 그대로 복사하지 말 것.
출력 항목 구조는 buildAddressGeneratePrompt와 동일.

출력 형식: JSON만 출력 (구조 동일), 다른 텍스트나 코드블록 표시 없이.
`.trim();
}

export function buildItemPoolPrompt(_unused, worldClass, spaceKey, spaceLabel) {
  return `
역할: 소지품 인벤토리 생성기.
${INFO_BLOCK_GUARD}

지금 이 대화의 캐릭터시트, 페르소나, 로어북, 최근 대화 내용을 참고하라.

세계관 분류 결과: ${JSON.stringify(worldClass)}
대상 공간: ${spaceKey} (${spaceLabel})

작업:
1. 먼저 이 공간이 현재 세계관/시대에서 어떤 형태로 존재하는지 결정.
   존재하지 않거나 의미 없으면 { "empty": true, "emptyReason": "..." } 만 반환하고 종료.
2. 존재한다면, 대화 맥락에서 실제로 확인되는 아이템과 캐릭터 성격/재산수준 기반
   추측 아이템을 합쳐서 정확히 12개 슬롯을 채울 것.
   - 실제 확인된 아이템과 추측 아이템을 구분 표시하지 말고 무작위 순서로 배치.
   - 이 중 0~1개는 페르소나(유저 캐릭터)를 위해 캐릭터가 몰래 준비해둔 물건일 수 있음.
     관계 맥락(애정도, 선물 언급, 관계 진행도)을 읽고 그럴듯하면 생성, 아니면 생성하지 않아도 됨.
3. 각 아이템 필드:
   - emoji (이모지 1개)
   - name
   - brand (브랜드/장인/길드명 — 세계관에 맞게)
   - price (현지화폐 또는 세계관 화폐 단위)
   - tmi (1~2문장. 페르소나용 비밀 아이템인 경우 "아직 안 줬다" 같은 비밀스러운 사연으로)
   - unlockCost (5~15 중 하나, 기본 해금 슬롯 1~2개는 0)
   - isSecretGift (true/false)
4. 세계관별 아이템 성격:
   - REALISTIC → 실제 브랜드/가격
   - FANTASY → 세계관 고유 아이템, 브랜드는 장인/길드명
   - HISTORICAL → 시대 물품 + 시대 화폐
   - 혼합형 → 현실 브랜드 + 세계관 아이템 혼재 가능
   - MAJOR_IP/신규 세계관(SF 등) → 해당 세계관 고유 브랜드/아이템

음식보관 공간(주방의 팬트리/냉장고)은 별도 프롬프트(buildFoodListPrompt) 사용 — 이 프롬프트 대상 아님.

출력 형식: JSON만 출력, 다른 텍스트나 코드블록 표시 없이.
{ "empty": false, "items": [ { "emoji":"", "name":"", "brand":"", "price":"",
  "tmi":"", "unlockCost":0, "isSecretGift":false }, ... 12개 ] }
`.trim();
}

export function buildFoodListPrompt(_unused, worldClass, subtype) {
  // subtype: 'pantry' | 'fridge'
  return `
역할: 식료품 목록 생성기.
${INFO_BLOCK_GUARD}

지금 이 대화의 캐릭터시트, 페르소나, 로어북, 최근 대화 내용을 참고하라.

세계관 분류 결과: ${JSON.stringify(worldClass)}
대상: ${subtype === "fridge" ? "냉장고" : "팬트리"}

작업: 일반적인 식료품 목록을 생성하되, 명품처럼 수집가치 있는 아이템이 아니므로
포인트 잠금 없이 대부분 무잠금 리스트로. 단, 고가/특별한 수입식재료나 희귀 주류 등
1~2개만 포인트로 해금(unlockCost 5~15)하게 설정.
시대에 냉장고 개념이 없으면(예: 조선시대) "냉장고" 자체를 생성하지 말고 empty 반환.

각 항목 필드: { "emoji":"", "name":"", "qty":"", "unlockCost": 0 또는 5~15 }

출력 형식: JSON만 출력, 다른 텍스트나 코드블록 표시 없이.
{ "empty": false, "list": [ { "emoji":"", "name":"", "qty":"", "unlockCost":0 }, ... ] }
`.trim();
}

export function buildLorebookExportPrompt(card) {
  return `
역할: 로어북 엔트리 작성기.
입력 카드 데이터: ${JSON.stringify(card)}

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
