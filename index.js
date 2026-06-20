/**
 * 🏠 그남의 집 v0.1 (구 챗씨부동산)
 * SillyTavern Extension
 * 거주지(주소/구조) + 소지품 인벤토리, 챗틀로얄 포인트 합산
 */

import { event_types } from '../../../events.js';
import {
    buildWorldClassifyPrompt,
    buildAddressGeneratePrompt,
    buildHouseMovePrompt,
    buildItemPoolPrompt,
    buildFoodListPrompt,
    buildLorebookExportPrompt,
    buildSpaceLabelsPrompt,
    buildItemInjectionText,
    buildFoodBundleInjectionText,
} from './prompts.js';

const MODULE_NAME = 'chatssi_realestate';
const CHATLEROYAL_KEY = 'chatl_royal'; // 챗틀로얄 실제 모듈명 (확인됨)
const BASE_POINTS = 100;
const REFILL_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3시간
const REFILL_AMOUNT = 30;
const ROULETTE_COOLDOWN_MS = 1 * 60 * 60 * 1000; // 1시간마다 한 번
// 보상이 클수록 당첨 확률(weight)은 낮아짐 — 합 100 기준 비중
const ROULETTE_OUTCOMES = [
    { key: 'lose', label: '꽝', pct: -100, weight: 15, color: '#5b5650' },
    { key: 'p10', label: '+10%', pct: 10, weight: 35, color: '#f3c969' },
    { key: 'p30', label: '+30%', pct: 30, weight: 25, color: '#e8a13d' },
    { key: 'p50', label: '+50%', pct: 50, weight: 15, color: '#d97b29' },
    { key: 'p70', label: '+70%', pct: 70, weight: 7, color: '#c0392b' },
    { key: 'p100', label: '+100%', pct: 100, weight: 3, color: '#8e44ad' },
];
const ITEM_CAP = 12;

const SPACES = [
    { key: 'kitchen', label: '주방', emoji: '🍳', food: true },
    { key: 'living',  label: '거실', emoji: '🛋️', food: false },
    { key: 'bath',    label: '욕실', emoji: '🛁', food: false },
    { key: 'bedroom', label: '침실', emoji: '👗', food: false },
    { key: 'study',   label: '서재', emoji: '📚', food: false },
    { key: 'garage',  label: '차고', emoji: '🚗', food: false },
    { key: 'storage', label: '창고', emoji: '📦', food: false },
];

const WORLD_CATS = ['자동감지', '현실', '판타지', '시대극', '메이저IP'];

// ─── 컬러 토큰 ──────────────────────────────
// 탭1(거주지) = Deed/문서 톤, 탭2(소지품) = 귀여운 인벤토리 톤
const DEED = {
    bg: '#F7F3EA', bgCard: '#ffffff', ink: '#2B3A55',
    stamp: '#B33A3A', gold: '#C9A227', line: '#D8D2C2',
};
const CUTE = {
    bg: '#FFE8EF', bgCard: '#ffffff', text: '#3D2C3D',
    lav: '#C9B8FF', mint: '#BFEFDB', yellow: '#FFE177',
};

// ─── 기본 설정 ──────────────────────────────
const defaultSettings = {
    points: 0,
    lifetimePoints: 0,
    lastRefillAt: 0,
    selectedProfileName: null,
    maxTokens: 4000,
    outputLanguage: 'ko', // 'ko' | 'en'
    rouletteLastSpinAt: 0,
    chatHistoryCount: 30, // buildManualContext에서 가져올 최근 채팅 메시지 개수
    perChar: {}, // { [charKey]: { house:{current,history}, spaces:{key:[..]}, pantry:[], fridge:[] } }
};

// ─── 상태 ──────────────────────────────────
let state = {
    isPanelOpen: false,
    currentTab: 'house', // 'house' | 'items'
    currentSpace: 'bedroom',
    currentCategory: '자동감지',
    foodSubview: null, // null | 'pantry' | 'fridge'
};

// ─── 유틸 ──────────────────────────────────
function getSettings() {
    const ctx = SillyTavern.getContext();
    if (!ctx.extensionSettings[MODULE_NAME]) ctx.extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    const s = ctx.extensionSettings[MODULE_NAME];
    for (const key of Object.keys(defaultSettings)) {
        if (s[key] === undefined) s[key] = structuredClone(defaultSettings[key]);
    }
    return s;
}
function save() { SillyTavern.getContext().saveSettingsDebounced(); }
function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function filterPhoneTrigger(t) {
    return (t || '').replace(/<phone_trigger[^>]*>[\s\S]*?<\/phone_trigger>/gi, '').trim();
}
function uid() { return Math.random().toString(36).slice(2, 10); }
// 비동기 생성(AI 호출) 완료 후 DOM을 갱신할 때, 그 사이 유저가 탭을 옮겨서 해당 요소가
// 이미 사라졌을 수 있음 — 그런 경우 조용히 무시 (데이터 자체는 이미 save()로 저장됐으니 안전,
// 다음에 그 탭 다시 열면 최신 데이터로 보임).
function setInnerHTML(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
    return !!el;
}

// ─── 탭2 주입(inject) — generate_interceptor 사용 ───
// setExtensionPrompt(position/depth)는 Post-History Instructions보다 앞에 끼어들 수 있어서
// (다른 확장 로그에서 PME가 generate_interceptor 쓰는 걸 확인) 우리도 생성 직전 chat 배열을
// 직접 건드리는 인터셉터 방식으로 전환 — 이러면 PHI를 포함해 진짜로 모든 것보다 뒤에 들어감.
function collectActiveInjectionText() {
    const data = getCharData();
    const parts = [];
    for (const spaceKey of Object.keys(data.spaces || {})) {
        const slot = data.spaces[spaceKey];
        if (slot?.empty) continue;
        for (const it of slot?.items || []) {
            if (it.injected) parts.push(buildItemInjectionText(it));
        }
    }
    for (const subtype of ['pantry', 'fridge']) {
        if (data[`${subtype}BundleInjected`]) {
            const list = (data[subtype]?.list || []).filter((it) => it.unlocked);
            if (list.length) parts.push(buildFoodBundleInjectionText(subtype, list));
        }
        for (const it of data[subtype]?.list || []) {
            if (it.injected) parts.push(buildItemInjectionText(it));
        }
    }
    return parts.join('\n\n');
}
// manifest.json의 "generate_interceptor": "csrGenerateInterceptor"가 이 이름으로 전역에서 찾음
// ⚠ 진짜 원인 발견: ST의 coreChat 배열 원소는 {role, content}가 아니라 {mes, is_user, name, extra}
// 형태임 (openai.js의 setOpenAIMessages, script.js의 formatMessageHistoryItem 둘 다 .mes/.is_user를
// 읽음). {role:'user', content:text}로 push했던 건 형태 자체가 안 맞아서 다운스트림에서 통째로
// 무시된 거였음 — 그래서 태그가 "아예 없었던" 것. 올바른 형태로 수정.
window.csrGenerateInterceptor = function (chat, _contextSize, _abort, _type) {
    try {
        const text = collectActiveInjectionText();
        console.log(`[${MODULE_NAME}] generate_interceptor 호출됨. chat 배열?`, Array.isArray(chat), '| 주입할 텍스트 있음?', !!text, '| 텍스트:', text);
        if (text && Array.isArray(chat)) {
            const personaName = SillyTavern.getContext()?.name1 || 'You';
            chat.push({ mes: text, is_user: true, name: personaName, extra: {} });
            console.log(`[${MODULE_NAME}] 주입 완료. 최종 chat 길이:`, chat.length, '| 마지막 항목:', chat[chat.length - 1]);
        }
    } catch (e) { console.warn(`[${MODULE_NAME}] generate_interceptor 실패:`, e.message); }
};
// 인터셉터가 매 생성 시점에 현재 상태를 그대로 읽어가기 때문에, setExtensionPrompt 방식과 달리
// "다시 등록"해줄 필요가 없음 — 토글만 데이터에 저장해두면 끝.

// ─── 캐릭터 키 (캐릭터 단위로 데이터 보관 — chat 단위 아님) ───
function getCharKey() {
    const ctx = SillyTavern.getContext();
    const char = ctx.characters?.[ctx.characterId];
    return char?.avatar || ctx.name2 || 'default';
}
function getCharData() {
    const s = getSettings();
    const key = getCharKey();
    if (!s.perChar[key]) {
        s.perChar[key] = { house: { current: null, history: [] }, spaces: {}, pantry: null, fridge: null, updatedAt: Date.now() };
    }
    s.perChar[key].updatedAt = Date.now(); // 캡 안전망에서 LRU 판단용
    return s.perChar[key];
}

// ─── 데이터 정리: 고아 캐시 제거 + 캡 안전망 ───────
const PERCHAR_CAP = 100;     // 캐릭터별 데이터 최대 보관 개수 (안전망)
const HOUSE_HISTORY_CAP = 50; // 캐릭터당 거주 이력 최대 보관 개수 (안전망)

function pruneOrphanedData() {
    const s = getSettings();
    const ctx = SillyTavern.getContext();
    const cache = s.perChar || {};
    let changed = false;

    // ⚠ 안전장치: 캐릭터 목록이 아직 로드되기 전(확장 리로드/업데이트 직후처럼 ctx.characters가
    // 비어있는 시점)에 이 함수가 실행되면, 모든 저장된 캐릭터가 "고아"로 잘못 판단돼서 통째로
    // 삭제될 위험이 있음 — 그게 "확장 업데이트하면 집 데이터가 사라진다"는 버그의 진짜 원인이었음.
    // 캐릭터 목록이 비어있으면 정리 자체를 건너뜀 (저장된 게 있는데 목록이 비어있다는 건
    // 아직 로딩 중이라는 신호일 뿐, 실제로 캐릭터가 다 사라졌다는 뜻이 아님).
    if (!Array.isArray(ctx.characters) || ctx.characters.length === 0) {
        if (Object.keys(cache).length > 0) {
            console.warn(`[${MODULE_NAME}] 캐릭터 목록이 비어있어 고아 데이터 정리를 건너뜀 (로딩 중일 수 있음)`);
        }
        return;
    }

    // 1) 더 이상 존재하지 않는 캐릭터(avatar)의 데이터 삭제 — 'default'(페르소나만 있을 때 폴백 키)는 유지
    const validKeys = new Set((ctx.characters || []).map((c) => c.avatar));
    validKeys.add('default');
    for (const key of Object.keys(cache)) {
        if (!validKeys.has(key)) {
            delete cache[key];
            changed = true;
        }
    }

    // 2) 안전망 — 그래도 너무 많이 쌓이면 가장 오래 안 건드린 것부터 삭제
    const entries = Object.entries(cache);
    if (entries.length > PERCHAR_CAP) {
        entries.sort((a, b) => (a[1]?.updatedAt || 0) - (b[1]?.updatedAt || 0));
        entries.slice(0, entries.length - PERCHAR_CAP).forEach(([key]) => delete cache[key]);
        changed = true;
    }

    // 3) 거주 이력 배열 캡 (무한 누적 방지 — 유저가 원하는 "삭제 없이 누적"은 유지하되 상한선만 둠)
    for (const charData of Object.values(cache)) {
        if (Array.isArray(charData?.house?.history) && charData.house.history.length > HOUSE_HISTORY_CAP) {
            charData.house.history = charData.house.history.slice(0, HOUSE_HISTORY_CAP);
            changed = true;
        }
    }

    if (changed) { s.perChar = cache; save(); console.log(`[${MODULE_NAME}] 고아 데이터 정리 완료 (${Object.keys(cache).length}개 캐릭터 유지)`); }
}

// ─── 포인트 시스템 ──────────────────────────
function checkRefill() {
    const s = getSettings();
    const now = Date.now();
    if (!s.lastRefillAt) { s.lastRefillAt = now; s.points = BASE_POINTS; s.lifetimePoints = BASE_POINTS; save(); return; }
    const elapsed = now - s.lastRefillAt;
    if (elapsed >= REFILL_INTERVAL_MS) {
        const cycles = Math.floor(elapsed / REFILL_INTERVAL_MS);
        s.points += REFILL_AMOUNT * cycles;
        s.lifetimePoints += REFILL_AMOUNT * cycles;
        s.lastRefillAt += REFILL_INTERVAL_MS * cycles;
        save();
    }
}
function getChatleRoyalPoints() {
    try {
        const ctx = SillyTavern.getContext();
        const cr = ctx.extensionSettings?.[CHATLEROYAL_KEY];
        if (cr && typeof cr.points === 'number') return cr.points;
    } catch (e) { /* 챗틀로얄 없음 */ }
    return 0;
}
function getTotalPoints() {
    checkRefill();
    return getSettings().points + getChatleRoyalPoints();
}
function spendPoints(amount) {
    checkRefill();
    const s = getSettings();
    if (s.points >= amount) { s.points -= amount; save(); return true; }
    toastr.warning('자체 포인트가 부족해요. 챗틀로얄 포인트가 있다면 설정에서 동기화해보세요.');
    return false;
}
// 챗틀로얄 포인트를 자체 포인트로 가져오기 — 전부가 아니라 원하는 만큼만 입력해서 가져옴
function syncChatleRoyalPoints() {
    const ctx = SillyTavern.getContext();
    const cr = ctx.extensionSettings?.[CHATLEROYAL_KEY];
    const available = (cr && typeof cr.points === 'number') ? cr.points : 0;
    if (available <= 0) { toastr.info('가져올 챗틀로얄 포인트가 없어요'); return 0; }

    const input = window.prompt(`챗틀로얄 보유 포인트: ${available}P\n가져올 만큼 입력하세요 (최대 ${available}):`, String(available));
    if (input === null) return 0; // 취소
    const amount = Math.floor(Number(input));
    if (!Number.isFinite(amount) || amount <= 0) { toastr.warning('1 이상의 숫자를 입력해주세요'); return 0; }
    if (amount > available) { toastr.warning(`최대 ${available}P까지만 가져올 수 있어요`); return 0; }

    const s = getSettings();
    s.points += amount;
    s.lifetimePoints += amount;
    cr.points = available - amount;
    save();
    toastr.success(`챗틀로얄에서 ${amount}P 가져왔어요!`);
    return amount;
}

// ─── 룰렛(도박성 베팅) ───────────────────────
function getRouletteCooldownRemaining() {
    const s = getSettings();
    const next = (s.rouletteLastSpinAt || 0) + ROULETTE_COOLDOWN_MS;
    return Math.max(0, next - Date.now());
}
function formatCooldown(ms) {
    const totalMin = Math.ceil(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}
function pickRouletteOutcome() {
    const total = ROULETTE_OUTCOMES.reduce((sum, o) => sum + o.weight, 0);
    let r = Math.random() * total;
    for (const o of ROULETTE_OUTCOMES) {
        if (r < o.weight) return o;
        r -= o.weight;
    }
    return ROULETTE_OUTCOMES[0];
}
// bet: 자체 보유 포인트(s.points) 기준 — 챗틀로얄에서 동기화 안 한 포인트는 베팅 대상 아님
function spinRoulette(bet) {
    const s = getSettings();
    if (getRouletteCooldownRemaining() > 0) {
        return { error: `아직 쿨다운 중이에요 (${formatCooldown(getRouletteCooldownRemaining())} 남음)` };
    }
    bet = Math.floor(bet);
    if (!Number.isFinite(bet) || bet <= 0) return { error: '베팅 금액을 입력해주세요' };
    if (bet > s.points) return { error: `자체 보유 포인트(${s.points}P)보다 많이 베팅할 수 없어요` };

    const outcome = pickRouletteOutcome();
    if (outcome.pct < 0) {
        s.points -= bet;
    } else {
        const gain = Math.round(bet * outcome.pct / 100);
        s.points += gain;
        s.lifetimePoints += gain;
    }
    s.rouletteLastSpinAt = Date.now();
    save();
    return { outcome, bet, newPoints: s.points };
}

// ─── AI 호출 ────────────────────────────────
// 프로필 선택 시: 직접 모은 컨텍스트(캐릭터시트/페르소나/최근 챗) + 프롬프트를 ConnectionManager로 전송
// 프로필 미선택 시: generateQuietPrompt로 ST가 로어북/AN/챗을 자동으로 섞어서 생성 (현재 연결 사용)
async function buildManualContext() {
    const ctx = SillyTavern.getContext();
    const char = ctx.characters?.[ctx.characterId];
    const charDesc = [char?.description, char?.personality, char?.scenario].filter(Boolean).join('\n').slice(0, 8000);
    const personaName = ctx.name1 || '';
    const personaDesc = (ctx.powerUserSettings?.persona_description || '').slice(0, 4000);
    const recentChat = (ctx.chat || []).slice(-(getSettings().chatHistoryCount || 30)).map((m) => `${m.is_user ? (personaName || '유저') : (char?.name || 'AI')}: ${m.mes}`).join('\n').slice(-12000);
    // 로어북(월드인포) — isDryRun=true로 호출해서 실제 생성 이벤트(WORLD_INFO_ACTIVATED 등)는
    // 안 발생시키고 텍스트만 가져옴. 현재 챗 내용 기준으로 키워드 매칭된 엔트리만 반영됨.
    let worldInfo = '';
    try {
        // getWorldInfoPrompt가 내부적으로 messages[depth].trim()을 호출하므로, chat 객체 배열이
        // 아니라 .mes 텍스트만 뽑은 "문자열 배열"을 역순(최근 메시지가 depth 0)으로 넘겨야 함.
        // (script.js의 실제 호출부: coreChat.map(x => x.mes).reverse() 패턴과 동일하게 맞춤)
        const chatForWI = (ctx.chat || []).map((m) => m?.mes || '').reverse();
        const wi = await ctx.getWorldInfoPrompt?.(chatForWI, 16384, true);
        worldInfo = (wi?.worldInfoString || '').slice(0, 8000);
        console.log(`[${MODULE_NAME}] 로어북 조회 결과 — 매칭된 텍스트 길이: ${worldInfo.length}자`, worldInfo ? `\n내용 미리보기:\n${worldInfo.slice(0, 300)}${worldInfo.length > 300 ? '...' : ''}` : '(매칭된 엔트리 없음 — 키워드가 현재 채팅에 안 걸렸거나 로어북이 비어있을 수 있음)');
    } catch (e) { console.warn(`[${MODULE_NAME}] 로어북 읽기 실패:`, e.message); }
    return [
        charDesc ? `[캐릭터 시트]\n${charDesc}` : '',
        personaDesc ? `[페르소나: ${personaName}]\n${personaDesc}` : '',
        worldInfo ? `[로어북]\n${worldInfo}` : '',
        recentChat ? `[최근 대화]\n${recentChat}` : '',
    ].filter(Boolean).join('\n\n');
}
async function callAI(prompt) {
    const ctx = SillyTavern.getContext();
    const s = getSettings();
    const profileName = s.selectedProfileName;

    if (profileName && ctx.ConnectionManagerRequestService) {
        const profiles = ctx.extensionSettings?.['connectionManager']?.profiles || [];
        const profile = profiles.find((p) => p.name === profileName);
        if (profile) {
            const context = await buildManualContext();
            const content = context ? `${context}\n\n${prompt}` : prompt;
            const response = await ctx.ConnectionManagerRequestService.sendRequest(
                profile.id, [{ role: 'user', content }], s.maxTokens || 4000,
                { stream: false, extractData: true, includePreset: true, includeInstruct: false },
            );
            let raw = '';
            if (typeof response === 'string') raw = response;
            else if (typeof response?.content === 'string') raw = response.content;
            else if (response?.choices?.[0]?.message?.content) raw = response.choices[0].message.content;
            else if (response?.content?.[0]?.text) raw = response.content[0].text;
            return filterPhoneTrigger(raw);
        }
    }

    // 프로필 미선택 — 현재 연결 + ST 자동 컨텍스트(로어북/AN/챗)
    const result = await ctx.generateQuietPrompt({
        quietPrompt: prompt,
        quietToLoud: true,
        skipWIAN: false,
    });
    return filterPhoneTrigger(result || '');
}
function parseJSON(raw) {
    if (!raw) { console.warn(`[${MODULE_NAME}] AI 응답이 비어있음`); return null; }
    const cleaned = String(raw).replace(/```json|```/g, '').trim();
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        // 모델이 캐릭터 말투로 응답하면서 JSON 앞뒤에 다른 텍스트를 붙였을 수 있음 — 본문 중 JSON만 추출 시도
        const match = cleaned.match(/\{[\s\S]*\}/) || cleaned.match(/\[[\s\S]*\]/);
        if (match) {
            try { return JSON.parse(match[0]); } catch (e2) { /* 그래도 실패 */ }
        }
        console.error(`[${MODULE_NAME}] JSON 파싱 실패 — 원본 응답:`, raw);
        return null;
    }
}

// ─── 거주지 생성 / 이사가기 / 로어북 export ───
async function classifyWorld(userHint) {
    const lang = getSettings().outputLanguage || 'ko';
    const raw = await callAI(buildWorldClassifyPrompt('', userHint, lang));
    return parseJSON(raw) || { category: 'REALISTIC', subtype: '', location_hint: '' };
}
async function generateHouse(userHint, isMove) {
    const lang = getSettings().outputLanguage || 'ko';
    const worldClass = await classifyWorld(userHint);
    const data = getCharData();
    const prompt = isMove
        ? buildHouseMovePrompt('', worldClass, data.house.current, lang)
        : buildAddressGeneratePrompt('', worldClass, userHint, lang);
    const card = parseJSON(await callAI(prompt));
    if (!card) return null;
    card._worldClass = worldClass;
    if (data.house.current) data.house.history.unshift(data.house.current);
    data.house.current = card;
    save();
    return card;
}
async function exportLorebook() {
    const lang = getSettings().outputLanguage || 'ko';
    const data = getCharData();
    if (!data.house.current) return null;
    const { _worldClass, _generatedAt, ...cardForExport } = data.house.current; // 메타정보는 줄글 변환 대상에서 제외
    return await callAI(buildLorebookExportPrompt(cardForExport, lang));
}

// 탭2 고정 공간(주방/거실/욕실/침실/서재/차고/창고)의 "기능"은 안 바뀌고 "이름/이모지"만
// 세계관에 맞게 바뀜 — 집 생성 후 유저가 명시적으로 버튼을 눌러야 적용됨 (자동 아님)
async function applyWorldLabelsToSpaces() {
    const lang = getSettings().outputLanguage || 'ko';
    const data = getCharData();
    const worldClass = data.house.current?._worldClass;
    if (!worldClass) { toastr.warning('먼저 집을 생성해주세요 (세계관 정보가 필요해요).'); return false; }
    const currentLabels = Object.fromEntries(SPACES.map((s) => [s.key, { label: s.label, emoji: s.emoji }]));
    currentLabels.pantry = { label: '팬트리', emoji: '🥫' };
    currentLabels.fridge = { label: '냉장고', emoji: '🧊' };
    const result = parseJSON(await callAI(buildSpaceLabelsPrompt(worldClass, currentLabels, lang)));
    if (!result) { toastr.error('명칭 변경에 실패했어요 (AI 응답을 JSON으로 해석하지 못함).'); return false; }
    data.spaceLabels = result;
    save();
    toastr.success('세계관에 맞게 탭2 이름이 바뀌었어요!');
    return true;
}
// 실제 화면에 표시할 라벨/이모지 — 변경된 게 있으면 그걸, 없으면 기본값
function getSpaceDisplay(spaceKey) {
    const def = SPACES.find((s) => s.key === spaceKey);
    const override = getCharData().spaceLabels?.[spaceKey];
    return { label: override?.label || def.label, emoji: override?.emoji || def.emoji, food: def.food };
}
// 팬트리/냉장고는 SPACES 7개 고정 카테고리에 안 들어있고 주방 안의 서브카테고리라 별도 처리
function getFoodSubDisplay(subtype) {
    const defaults = { pantry: { label: '팬트리', emoji: '🥫' }, fridge: { label: '냉장고', emoji: '🧊' } };
    const override = getCharData().spaceLabels?.[subtype];
    return { label: override?.label || defaults[subtype].label, emoji: override?.emoji || defaults[subtype].emoji };
}

// 클립보드 쓰기 — 비동기 AI 호출 후라 유저 제스처(transient activation)가 만료돼서
// navigator.clipboard.writeText가 막힐 수 있음 → execCommand 폴백, 그래도 안 되면 수동복사 모달
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (e) {
        console.warn(`[${MODULE_NAME}] clipboard.writeText 실패, execCommand 폴백 시도:`, e.message);
    }
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (ok) return true;
    } catch (e2) {
        console.warn(`[${MODULE_NAME}] execCommand 폴백도 실패:`, e2.message);
    }
    showManualCopyModal(text);
    return false;
}
function showManualCopyModal(text) {
    document.getElementById('csr-copy-modal')?.remove();
    const mw = Math.min(320, window.innerWidth * 0.9);
    const ml = Math.max(10, (window.innerWidth - mw) / 2);
    const mt = Math.max(10, window.innerHeight * 0.15);
    const modal = document.createElement('div');
    modal.id = 'csr-copy-modal';
    modal.style.cssText = `position:fixed;top:${mt}px;left:${ml}px;width:${mw}px;background:#fff;border-radius:14px;padding:16px;font-family:system-ui;z-index:10600;box-shadow:0 8px 40px rgba(0,0,0,.4)`;
    modal.innerHTML = `
        <div style="font-size:12px;font-weight:800;color:${DEED.ink};margin-bottom:8px">자동 복사가 막혔어요 — 아래 텍스트를 직접 선택해서 복사해주세요</div>
        <textarea id="csr-copy-ta" readonly style="width:100%;height:160px;font-size:11px;padding:8px;border:1px solid ${DEED.line};border-radius:8px;box-sizing:border-box">${esc(text)}</textarea>
        <button id="csr-copy-modal-close" style="margin-top:8px;width:100%;padding:8px;border:none;border-radius:10px;background:${DEED.ink};color:${DEED.bg};font-weight:800;cursor:pointer;font-size:12px">닫기</button>
    `;
    document.body.appendChild(modal);
    const ta = document.getElementById('csr-copy-ta');
    ta.focus(); ta.select();
    document.getElementById('csr-copy-modal-close')?.addEventListener('click', () => modal.remove());
}

// ─── 아이템 풀 ──────────────────────────────
async function generateItemPool(spaceKey, isReroll = false) {
    const displayLabel = getSpaceDisplay(spaceKey).label;
    const lang = getSettings().outputLanguage || 'ko';
    const data = getCharData();
    const worldClass = data.house.current?._worldClass || (await classifyWorld(''));
    const existing = data.spaces[spaceKey];
    const pinned = (isReroll && existing && !existing.empty) ? existing.items.filter((it) => it.pinned) : [];
    const opts = { isReroll, pinnedItems: pinned.map((it) => ({ name: it.name, brand: it.brand })) };

    const result = parseJSON(await callAI(buildItemPoolPrompt('', worldClass, spaceKey, displayLabel, lang, opts)));
    if (!result) return null;

    if (result.empty) {
        data.spaces[spaceKey] = { empty: true, emptyReason: result.emptyReason };
    } else {
        const newItems = (result.items || []).map((it) => {
            const unlockCost = it.unlockCost || 0;
            return { ...it, id: uid(), unlockCost, unlocked: unlockCost === 0, pinned: false, injected: false, createdAt: Date.now() };
        });
        const finalItems = isReroll ? [...pinned, ...newItems].slice(0, ITEM_CAP) : newItems.slice(0, ITEM_CAP);
        data.spaces[spaceKey] = { empty: false, items: finalItems };
    }
    save();
    return data.spaces[spaceKey];
}
function unlockItem(spaceKey, idx) {
    const slot = getCharData().spaces[spaceKey];
    const item = slot?.items?.[idx];
    if (!item || item.unlocked) return false;
    if (!spendPoints(item.unlockCost)) return false;
    item.unlocked = true;
    save();
    return true;
}
function togglePin(spaceKey, idx) {
    const item = getCharData().spaces[spaceKey]?.items?.[idx];
    if (!item) return;
    item.pinned = !item.pinned;
    save();
}
async function generateFoodList(subtype, isReroll = false) {
    const lang = getSettings().outputLanguage || 'ko';
    const data = getCharData();
    const worldClass = data.house.current?._worldClass || (await classifyWorld(''));
    const existing = data[subtype];
    const pinned = (isReroll && existing && !existing.empty) ? existing.list.filter((it) => it.pinned) : [];
    const opts = { isReroll, pinnedItems: pinned.map((it) => ({ name: it.name })) };

    const result = parseJSON(await callAI(buildFoodListPrompt('', worldClass, subtype, lang, opts)));
    if (!result) return null;

    if (result.empty) {
        data[subtype] = { empty: true };
    } else {
        const newList = (result.list || []).map((it) => {
            const unlockCost = it.unlockCost || 0;
            return { ...it, id: uid(), unlockCost, unlocked: unlockCost === 0, pinned: false, injected: false };
        });
        data[subtype] = { empty: false, list: isReroll ? [...pinned, ...newList] : newList };
    }
    save();
    return data[subtype];
}
function unlockFoodItem(subtype, idx) {
    const item = getCharData()[subtype]?.list?.[idx];
    if (!item || item.unlocked) return false;
    if (!spendPoints(item.unlockCost)) return false;
    item.unlocked = true;
    save();
    return true;
}
function toggleFoodPin(subtype, idx) {
    const item = getCharData()[subtype]?.list?.[idx];
    if (!item) return;
    item.pinned = !item.pinned;
    save();
}

// ─── 주입 토글 ──────────────────────────────
function toggleItemInjection(item) {
    if (!item.id) item.id = uid(); // 업데이트 이전에 생성된 아이템 대비 안전장치
    item.injected = !item.injected;
    save();
    return item.injected;
}
function toggleFoodBundleInjection(subtype) {
    const data = getCharData();
    const flagKey = `${subtype}BundleInjected`;
    data[flagKey] = !data[flagKey];
    save();
    return data[flagKey];
}

// ─── 로딩 표시 (챗씨부인 방식 재사용) ───────
function showLoading(targetId, msg) {
    const el = document.getElementById(targetId);
    if (!el) return;
    el.innerHTML = `<div style="text-align:center;padding:24px;color:${DEED.gold};font-size:12px">
        <span class="csr-spin" style="display:inline-block;animation:csr-spin 1s linear infinite">🔄</span> ${esc(msg)}
    </div>`;
}

// ─── 렌더링: 거주지 카드 ────────────────────
function formatWorldClass(wc) {
    if (!wc) return '-';
    const labels = { REALISTIC: '현실', FANTASY: '판타지', HISTORICAL: '시대극', MAJOR_IP: '메이저IP' };
    const base = labels[wc.category] || wc.category || '-';
    if (wc.category === 'MAJOR_IP' && wc.subtype) return `${base} (${wc.subtype})`;
    if (wc.subtype) return `${base} · ${wc.subtype}`;
    return base;
}
function deedRow(label, value) {
    return `<div style="border-bottom:1px dashed ${DEED.line};padding-bottom:6px">
        <div style="font-size:9px;color:${DEED.gold};font-weight:800;letter-spacing:.4px;text-transform:uppercase">${esc(label)}</div>
        <div style="font-size:12px;color:${DEED.ink};font-weight:700;margin-top:2px;word-break:break-word">${esc(value ?? '-')}</div>
    </div>`;
}
function showHistoryPopup(idx) {
    const card = getCharData().house.history[idx];
    if (!card) return;
    document.getElementById('csr-history-popup')?.remove();
    const appendixHtml = card.appendix?.length
        ? `<ul style="margin:8px 0 0;padding-left:16px;font-size:11px;color:${DEED.ink};opacity:.8;line-height:1.6">
            ${card.appendix.map((a) => `<li>${esc(a)}</li>`).join('')}
        </ul>`
        : '';
    const modal = document.createElement('div');
    modal.id = 'csr-history-popup';
    modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10800;display:flex;align-items:center;justify-content:center;padding:16px`;
    modal.innerHTML = `
        <div style="background:${DEED.bgCard};border-radius:16px;padding:18px 16px;max-width:340px;max-height:80vh;overflow-y:auto;position:relative">
            <button id="csr-history-popup-close" style="position:absolute;top:10px;right:10px;border:none;background:none;font-size:14px;color:${DEED.ink};opacity:.6;cursor:pointer">✕</button>
            <h3 style="font-family:'Georgia',serif;margin:0 0 12px;color:${DEED.ink};font-size:15px">📦 이전 거주지</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 12px">
                ${deedRow('세계관', formatWorldClass(card._worldClass))}
                ${deedRow('거주형태', card.residenceType)}
                ${deedRow('가격', card.price)}
                ${deedRow('건물유형', card.buildingType)}
                ${deedRow('방·욕실', `${card.rooms ?? '-'}룸 · ${card.bathrooms ?? '-'}욕실`)}
                ${deedRow('구조', card.structureStyle)}
                ${deedRow('마당', card.hasYard ? '있음' : '없음')}
                ${deedRow('차고', card.hasGarage ? '있음' : '없음')}
                ${deedRow('위치', card.location)}
                ${deedRow('주소', card.address)}
                ${deedRow('입주시기', card.moveInDate)}
                ${deedRow('상태', card.status)}
                ${deedRow('인테리어', card.interiorStyle)}
                ${deedRow('리모델링', card.renovation)}
            </div>
            <div style="margin-top:14px;background:#FBF8F1;border:1px dashed ${DEED.line};border-radius:12px;padding:12px 13px">
                <div style="font-size:10px;font-weight:800;color:${DEED.gold};margin-bottom:5px">🏷 집 이야기</div>
                <p style="margin:0;font-size:11px;color:${DEED.ink};line-height:1.6;opacity:.9">${esc(card.story)}</p>
            </div>
            ${appendixHtml}
        </div>`;
    document.body.appendChild(modal);
    document.getElementById('csr-history-popup-close')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}
function renderDeed() {
    const data = getCharData();
    const card = data.house.current;
    const ctx = SillyTavern.getContext();
    const charName = ctx.characters?.[ctx.characterId]?.name || '캐릭터';

    if (!card) {
        return `<div style="text-align:center;color:${DEED.ink};opacity:.6;font-size:12px;padding:30px 10px">아직 생성된 거주지가 없어요.<br>위에서 "집 생성하기"를 눌러주세요.</div>`;
    }
    const historyHtml = data.house.history.length
        ? `<details style="margin-top:12px;border-top:1px solid ${DEED.line};padding-top:9px">
            <summary style="font-size:11px;font-weight:800;color:${DEED.ink};cursor:pointer">거주 이력 (${data.house.history.length})</summary>
            <ul style="margin:8px 0 0;padding-left:0;list-style:none;font-size:11px;color:${DEED.ink};opacity:.85;line-height:1.6">
                ${data.house.history.map((h, i) => `
                    <li style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:4px 0;border-bottom:1px dashed ${DEED.line}">
                        <span class="csr-history-item" data-idx="${i}" style="cursor:pointer;flex:1">${esc(h.location)} · ${esc(h.residenceType)} (${esc(h.moveInDate)})</span>
                        <button class="csr-history-del" data-idx="${i}" title="이 이력 삭제" style="border:none;background:none;color:${DEED.ink};opacity:.5;cursor:pointer;font-size:12px;flex-shrink:0;padding:2px 4px">✕</button>
                    </li>`).join('')}
            </ul>
        </details>`
        : '';
    const appendixHtml = card.appendix?.length
        ? `<details style="margin-top:12px;border-top:1px solid ${DEED.line};padding-top:9px">
            <summary style="font-size:11px;font-weight:800;color:${DEED.ink};cursor:pointer">부록 · 추가 자산 / TMI</summary>
            <ul style="margin:8px 0 0;padding-left:16px;font-size:11px;color:${DEED.ink};opacity:.8;line-height:1.6">
                ${card.appendix.map((a) => `<li>${esc(a)}</li>`).join('')}
            </ul>
        </details>`
        : '';

    return `
    <div style="background:${DEED.bgCard};border:1px solid ${DEED.line};border-radius:14px;padding:18px 16px;position:relative;overflow:hidden">
        <h3 style="font-family:'Georgia',serif;margin:0 0 12px;color:${DEED.ink};font-size:16px">${esc(charName)}의 거처</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 12px">
            ${deedRow('세계관', formatWorldClass(card._worldClass))}
            ${deedRow('거주형태', card.residenceType)}
            ${deedRow('가격', card.price)}
            ${deedRow('건물유형', card.buildingType)}
            ${deedRow('방·욕실', `${card.rooms ?? '-'}룸 · ${card.bathrooms ?? '-'}욕실`)}
            ${deedRow('구조', card.structureStyle)}
            ${deedRow('마당', card.hasYard ? '있음' : '없음')}
            ${deedRow('차고', card.hasGarage ? '있음' : '없음')}
            ${deedRow('위치', card.location)}
            ${deedRow('주소', card.address)}
            ${deedRow('입주시기', card.moveInDate)}
            ${deedRow('상태', card.status)}
            ${deedRow('인테리어', card.interiorStyle)}
            ${deedRow('리모델링', card.renovation)}
        </div>
        <div style="margin-top:14px;background:#FBF8F1;border:1px dashed ${DEED.line};border-radius:12px;padding:12px 13px">
            <div style="font-size:10px;font-weight:800;color:${DEED.gold};margin-bottom:5px">🏷 집 이야기</div>
            <p style="margin:0;font-size:11px;color:${DEED.ink};line-height:1.6;opacity:.9">${esc(card.story)}</p>
        </div>
        <button id="csr-move-btn" style="width:100%;margin-top:14px;padding:10px;border:none;border-radius:12px;background:${DEED.ink};color:${DEED.bg};font-weight:800;font-size:12px;cursor:pointer">🚚 이사가기</button>
        <button id="csr-lore-btn" style="width:100%;margin-top:10px;padding:10px;border:1px dashed ${DEED.gold};border-radius:12px;background:#FBF6E8;color:#8a6d1a;font-weight:800;font-size:11px;cursor:pointer">📋 로어북용 복사</button>
        <button id="csr-apply-world-labels-btn" style="width:100%;margin-top:10px;padding:10px;border:1px dashed ${DEED.ink};border-radius:12px;background:#fff;color:${DEED.ink};font-weight:800;font-size:11px;cursor:pointer">🌍 세계관에 맞게 탭2 이름 변경</button>
        ${appendixHtml}
        ${historyHtml}
    </div>`;
}

// ─── 렌더링: 아이템 그리드 / 식료품 ──────────
function renderItemGrid(spaceKey) {
    const slot = getCharData().spaces[spaceKey];
    if (!slot) return `<div style="text-align:center;color:${CUTE.text};opacity:.6;font-size:12px;padding:30px 10px;grid-column:1/-1">아래 버튼으로 불러와주세요.</div>`;
    if (slot.empty) return `<div style="text-align:center;color:${CUTE.text};opacity:.6;font-size:12px;padding:30px 10px;grid-column:1/-1">${esc(slot.emptyReason || '이 세계관에는 존재하지 않는 공간이에요.')}</div>`;
    return slot.items.map((it, idx) => {
        if (!it.unlocked) {
            return `<div class="csr-item-slot" data-action="unlock" data-idx="${idx}" style="aspect-ratio:1;border-radius:14px;background:repeating-linear-gradient(45deg,#fff,#fff 6px,#f6eef5 6px,#f6eef5 12px);display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;cursor:pointer">
                <div style="font-size:22px">🔒</div>
                <div style="position:absolute;bottom:5px;font-size:9px;background:${CUTE.yellow};border-radius:8px;padding:2px 6px;font-weight:800;color:${CUTE.text}">${it.unlockCost}P 해금</div>
            </div>`;
        }
        return `<div class="csr-item-slot" data-action="open" data-idx="${idx}" style="aspect-ratio:1;border-radius:14px;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;cursor:pointer">
            <div style="font-size:22px">${esc(it.emoji)}</div>
            <div style="font-size:9px;color:${CUTE.text};font-weight:800;margin-top:3px;text-align:center;padding:0 4px">${esc(it.name)}</div>
            ${it.pinned ? `<div style="position:absolute;top:4px;right:4px;font-size:10px">📌</div>` : ''}
        </div>`;
    }).join('');
}
function renderFoodList(subtype) {
    const slot = getCharData()[subtype];
    if (!slot) return `<div style="text-align:center;color:${CUTE.text};opacity:.6;font-size:12px;padding:20px">불러오는 중...</div>`;
    if (slot.empty) return `<div style="text-align:center;color:${CUTE.text};opacity:.6;font-size:12px;padding:20px">이 시대/세계관엔 해당 공간이 없어요.</div>`;
    return slot.list.map((f, idx) => {
        if (!f.unlocked) {
            return `<div class="csr-food-row" data-action="unlock" data-idx="${idx}" style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px dashed #f1d8e0;cursor:pointer">
                <div style="font-size:12px;color:${CUTE.text};font-weight:700">🔒 ???</div>
                <div style="font-size:9px;background:${CUTE.yellow};padding:2px 7px;border-radius:8px;font-weight:800;color:${CUTE.text}">${f.unlockCost}P 해금</div>
            </div>`;
        }
        const clickable = !!f.tmi;
        return `<div class="csr-food-row" ${clickable ? `data-action="open" data-idx="${idx}"` : ''} style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px dashed #f1d8e0;${clickable ? 'cursor:pointer' : ''}">
            <div style="font-size:12px;color:${CUTE.text};font-weight:700">${esc(f.emoji)} ${esc(f.name)} ${f.pinned ? '📌' : ''}</div>
            <div style="font-size:10px;color:#9b8aa0;font-weight:700">${esc(f.qty)}</div>
        </div>`;
    }).join('');
}

// ─── 렌더링: 탭 본문 ────────────────────────
function renderHouseTab() {
    return `
    <div style="padding:14px">
        <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">
            ${WORLD_CATS.map((c) => `<div class="csr-cat-chip" data-cat="${esc(c)}" style="flex:none;padding:7px 12px;border-radius:999px;background:${c === state.currentCategory ? DEED.ink : '#fff'};color:${c === state.currentCategory ? DEED.bg : DEED.ink};border:1px solid ${DEED.line};font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap">${esc(c)}</div>`).join('')}
        </div>
        <input id="csr-ref-input" style="width:100%;border:1px solid ${DEED.line};background:#fff;border-radius:10px;padding:10px 12px;font-size:12px;color:${DEED.ink};margin-bottom:10px;box-sizing:border-box" placeholder="예: 뉴욕 맨하탄 · 조선 한성 · 해리포터-런던 · 비워두면 자동">
        <button id="csr-generate-btn" style="width:100%;padding:12px;border:none;border-radius:12px;background:${DEED.ink};color:${DEED.bg};font-weight:800;font-size:13px;cursor:pointer;margin-bottom:16px">집 생성하기</button>
        <div id="csr-deed-container">${renderDeed()}</div>
    </div>`;
}
function renderItemsTab() {
    return `
    <div style="padding:14px">
        <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:6px;padding-bottom:10px">
            ${SPACES.map((s) => { const d = getSpaceDisplay(s.key); return `<div class="csr-space-chip" data-space="${s.key}" style="display:flex;align-items:center;justify-content:center;gap:4px;line-height:1.4;padding:7px 6px;border-radius:999px;background:${s.key === state.currentSpace ? CUTE.lav : '#fff'};color:${CUTE.text};font-size:10px;font-weight:800;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span style="font-size:13px;flex-shrink:0">${esc(d.emoji)}</span><span style="overflow:hidden;text-overflow:ellipsis">${esc(d.label)}</span></div>`; }).join('')}
        </div>
        <div id="csr-tab2-body"></div>
    </div>`;
}
function renderTab2Body() {
    if (state.currentSpace === 'kitchen') {
        if (state.foodSubview) {
            const data = getCharData();
            const bundleOn = !!data[`${state.foodSubview}BundleInjected`];
            const hasSlot = !!data[state.foodSubview];
            const pantryD = getFoodSubDisplay('pantry');
            const fridgeD = getFoodSubDisplay('fridge');
            const curD = state.foodSubview === 'pantry' ? pantryD : fridgeD;
            return `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
                <button id="csr-back-btn" style="border:none;background:rgba(0,0,0,.06);border-radius:10px;padding:7px 11px;font-weight:800;font-size:11px;color:${CUTE.text};cursor:pointer">‹ 뒤로</button>
                <div style="font-size:14px;font-weight:800;color:${CUTE.text}">${esc(curD.emoji)} ${esc(curD.label)}</div>
                <div style="display:flex;gap:6px;margin-left:auto">
                    <button class="csr-food-switch" data-sub="pantry" style="border:none;padding:6px 12px;border-radius:999px;font-size:10px;font-weight:800;background:${state.foodSubview === 'pantry' ? CUTE.lav : '#fff'};color:${CUTE.text};cursor:pointer">${esc(pantryD.label)}</button>
                    <button class="csr-food-switch" data-sub="fridge" style="border:none;padding:6px 12px;border-radius:999px;font-size:10px;font-weight:800;background:${state.foodSubview === 'fridge' ? CUTE.lav : '#fff'};color:${CUTE.text};cursor:pointer">${esc(fridgeD.label)}</button>
                </div>
            </div>
            <div style="background:#fff;border-radius:14px;padding:4px 13px;margin-bottom:10px">${renderFoodList(state.foodSubview)}</div>
            ${hasSlot ? `
            <div style="display:flex;gap:8px">
                <button id="csr-food-reroll-btn" style="flex:1;padding:8px;border-radius:12px;border:none;background:${CUTE.mint};font-weight:800;font-size:11px;color:${CUTE.text};cursor:pointer">🔄 새로채우기</button>
                <button id="csr-food-bundle-inject-btn" style="flex:1;padding:8px;border-radius:12px;border:none;background:${bundleOn ? CUTE.yellow : CUTE.lav};font-weight:800;font-size:11px;color:${CUTE.text};cursor:pointer">${bundleOn ? '✅ 주입중' : '📡 목록 주입하기'}</button>
            </div>` : ''}`;
        }
        const pantryD2 = getFoodSubDisplay('pantry');
        const fridgeD2 = getFoodSubDisplay('fridge');
        return `
        <div style="display:flex;gap:8px;margin-bottom:12px">
            <button id="csr-pantry-btn" style="flex:1;padding:9px;border-radius:12px;border:none;background:${CUTE.mint};font-weight:800;font-size:11px;color:${CUTE.text};cursor:pointer">${esc(pantryD2.emoji)} ${esc(pantryD2.label)} 보기</button>
            <button id="csr-fridge-btn" style="flex:1;padding:9px;border-radius:12px;border:none;background:${CUTE.mint};font-weight:800;font-size:11px;color:${CUTE.text};cursor:pointer">${esc(fridgeD2.emoji)} ${esc(fridgeD2.label)} 보기</button>
        </div>`;
    }
    const slot = getCharData().spaces[state.currentSpace];
    return `
    ${!slot ? `<button id="csr-load-space-btn" style="width:100%;padding:10px;border:none;border-radius:12px;background:${CUTE.lav};color:${CUTE.text};font-weight:800;font-size:12px;cursor:pointer;margin-bottom:10px">불러오기</button>` : ''}
    <div id="csr-item-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:10px">${renderItemGrid(state.currentSpace)}</div>
    ${slot ? `<button id="csr-room-reroll-btn" style="width:100%;padding:9px;border-radius:12px;border:none;background:${CUTE.mint};font-weight:800;font-size:11px;color:${CUTE.text};cursor:pointer">🔄 다시 채우기 (핀 제외, 새로 채워지는 건 항상 잠금)</button>` : ''}`;
}

// ─── 모달 ───────────────────────────────────
// kind: 'room' | 'food'
function showItemModal(kind, containerKey, idx) {
    const data = getCharData();
    const item = kind === 'room' ? data.spaces[containerKey].items[idx] : data[containerKey].list[idx];
    document.getElementById('csr-modal')?.remove();

    // 챗틀로얄 방식: flex 중앙정렬 대신 창 크기 기준으로 top/left를 미리 계산해서 고정 배치
    // (모바일 키보드 등으로 뷰포트 높이가 바뀌어도 모달이 다시 중앙정렬되며 위로 솟구치는 문제 방지)
    const mw = Math.min(300, window.innerWidth * 0.9);
    const ml = Math.max(10, (window.innerWidth - mw) / 2);
    const mt = Math.max(10, Math.min(window.innerHeight * 0.15, window.innerHeight - 320));

    const modal = document.createElement('div');
    modal.id = 'csr-modal';
    modal.style.cssText = `position:fixed;top:${mt}px;left:${ml}px;width:${mw}px;background:#fff;border-radius:18px;padding:20px;font-family:system-ui;z-index:10500;box-shadow:0 8px 40px rgba(0,0,0,.4)`;
    modal.innerHTML = `
        <button id="csr-modal-close-x" style="position:absolute;top:10px;right:12px;background:none;border:none;cursor:pointer;font-size:14px;color:${CUTE.text};opacity:.6">✕</button>
        <div style="font-weight:800;font-size:15px;color:${CUTE.text};padding-right:18px">${kind === 'room' ? esc(item.brand) : `${esc(item.emoji)} ${esc(item.name)}`}</div>
        ${kind === 'room' ? `<div style="font-weight:800;color:${DEED.stamp};margin:5px 0 10px;font-size:13px">${esc(item.price)}</div>` : `<div style="font-size:10px;color:#9b8aa0;margin:4px 0 10px">${esc(item.qty || '')}</div>`}
        <div style="font-size:11px;color:#555;line-height:1.55;background:#FFF7E8;border-radius:10px;padding:10px">${esc(item.tmi)}</div>
        <button id="csr-modal-pin" style="margin-top:9px;width:100%;padding:9px;border:none;border-radius:12px;background:${CUTE.yellow};font-weight:800;color:${CUTE.text};cursor:pointer;font-size:11px">${item.pinned ? '📌 고정 해제' : '📌 고정하기'}</button>
        <button id="csr-modal-inject" style="margin-top:7px;width:100%;padding:9px;border:none;border-radius:12px;background:${item.injected ? CUTE.yellow : CUTE.lav};color:${CUTE.text};font-weight:800;cursor:pointer;font-size:11px">${item.injected ? '✅ 주입중 (눌러서 해제)' : '📡 주입하기'}</button>
        <button id="csr-modal-close" style="margin-top:7px;width:100%;padding:9px;border:none;border-radius:12px;background:${CUTE.text};color:#fff;font-weight:800;cursor:pointer;font-size:12px">닫기</button>
    `;
    document.body.appendChild(modal);
    document.getElementById('csr-modal-close')?.addEventListener('click', () => modal.remove());
    document.getElementById('csr-modal-close-x')?.addEventListener('click', () => modal.remove());
    document.getElementById('csr-modal-pin')?.addEventListener('click', () => {
        if (kind === 'room') togglePin(containerKey, idx);
        else toggleFoodPin(containerKey, idx);
        renderBody();
        modal.remove();
    });
    document.getElementById('csr-modal-inject')?.addEventListener('click', () => {
        const nowInjected = toggleItemInjection(item);
        toastr.success(nowInjected ? '주입을 시작했어요 (다음 턴부터 반영)' : '주입을 해제했어요');
        refreshHeaderInjectBadge();
        modal.remove();
    });
}

// ─── 메인 렌더 / 바인딩 ─────────────────────
function refreshHeaderPoints() {
    const el = document.getElementById('csr-header-pts');
    if (el) el.textContent = `${getTotalPoints()} P`;
}

// ─── 주입 현황 요약 ──────────────────────────
function getActiveInjections() {
    const data = getCharData();
    const list = [];
    for (const spaceKey of Object.keys(data.spaces || {})) {
        const slot = data.spaces[spaceKey];
        if (slot?.empty) continue;
        for (const it of slot?.items || []) {
            if (it.injected) list.push({ label: `${it.emoji || '📦'} ${it.name}`, kind: 'item', item: it });
        }
    }
    for (const subtype of ['pantry', 'fridge']) {
        if (data[`${subtype}BundleInjected`]) {
            const fd = getFoodSubDisplay(subtype);
            list.push({ label: `${fd.emoji} ${fd.label} 목록 전체`, kind: 'bundle', subtype });
        }
        for (const it of data[subtype]?.list || []) {
            if (it.injected) list.push({ label: `${it.emoji || '🍽️'} ${it.name}`, kind: 'item', item: it });
        }
    }
    return list;
}
function refreshHeaderInjectBadge() {
    const btn = document.getElementById('csr-header-inject-btn');
    if (!btn) return;
    const count = getActiveInjections().length;
    btn.textContent = `📡 ${count}`;
    btn.style.opacity = count > 0 ? '1' : '.5';
}
function showInjectionSummaryPanel() {
    document.getElementById('csr-inject-summary')?.remove();
    const mw = Math.min(280, window.innerWidth * 0.85);
    const ml = Math.max(10, window.innerWidth - mw - 20);
    const mt = 60;
    const panel = document.createElement('div');
    panel.id = 'csr-inject-summary';
    panel.style.cssText = `position:fixed;top:${mt}px;left:${ml}px;width:${mw}px;max-height:60vh;overflow-y:auto;background:#fff;border-radius:14px;padding:14px;font-family:system-ui;z-index:10700;box-shadow:0 8px 40px rgba(0,0,0,.4)`;

    function renderList() {
        const items = getActiveInjections();
        panel.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <div style="font-weight:800;font-size:13px;color:${DEED.ink}">📡 주입중인 내용</div>
                <button id="csr-inject-summary-close" style="background:none;border:none;cursor:pointer;font-size:13px;color:${DEED.ink};opacity:.6">✕</button>
            </div>
            ${items.length === 0
                ? `<div style="font-size:11px;color:${DEED.ink};opacity:.6;text-align:center;padding:14px 0">현재 주입중인 게 없어요.</div>`
                : items.map((entry, i) => `
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:1px dashed ${DEED.line}">
                        <span style="font-size:12px;color:${DEED.ink}">${esc(entry.label)}</span>
                        <button class="csr-inject-remove" data-idx="${i}" style="font-size:10px;background:${CUTE.yellow};border:none;border-radius:8px;padding:3px 8px;font-weight:800;color:${CUTE.text};cursor:pointer;flex-shrink:0">해제</button>
                    </div>`).join('')}
        `;
        panel.querySelector('#csr-inject-summary-close')?.addEventListener('click', () => panel.remove());
        panel.querySelectorAll('.csr-inject-remove').forEach((btn) => btn.addEventListener('click', () => {
            const entry = items[parseInt(btn.dataset.idx)];
            if (entry.kind === 'bundle') toggleFoodBundleInjection(entry.subtype);
            else toggleItemInjection(entry.item);
            refreshHeaderInjectBadge();
            renderList();
        }));
    }
    renderList();
    document.body.appendChild(panel);
}

// ─── 룰렛 UI ─────────────────────────────────
function buildRouletteGradient() {
    let acc = 0;
    const stops = ROULETTE_OUTCOMES.map((o) => {
        const start = acc;
        acc += (o.weight / 100) * 360;
        return `${o.color} ${start}deg ${acc}deg`;
    });
    return `conic-gradient(${stops.join(',')})`;
}
function getOutcomeMidAngle(key) {
    let acc = 0;
    for (const o of ROULETTE_OUTCOMES) {
        const start = acc;
        acc += (o.weight / 100) * 360;
        if (o.key === key) return (start + acc) / 2;
    }
    return 0;
}
function showRoulettePopup() {
    document.getElementById('csr-roulette-popup')?.remove();
    const s = getSettings();
    const cooldownMs = getRouletteCooldownRemaining();
    const onCooldown = cooldownMs > 0;

    // 챗틀로얄/아이템모달 방식과 동일: flex 중앙정렬+inset:0 대신 창 크기 기준 top/left를 미리 계산해서
    // 고정 배치 — 모바일에서 숫자 입력창에 키보드가 뜨며 뷰포트가 바뀌어도 모달이 위로 솟구쳐서
    // 안 내려오는 문제를 방지함.
    const mw = Math.min(300, window.innerWidth * 0.9);
    const ml = Math.max(10, (window.innerWidth - mw) / 2);
    const mt = Math.max(10, Math.min(window.innerHeight * 0.12, window.innerHeight - 420));

    const modal = document.createElement('div');
    modal.id = 'csr-roulette-popup';
    modal.style.cssText = `position:fixed;top:${mt}px;left:${ml}px;width:${mw}px;background:${DEED.bgCard};border-radius:18px;padding:20px 16px;text-align:center;font-family:system-ui;z-index:10900;box-shadow:0 8px 40px rgba(0,0,0,.4)`;
    modal.innerHTML = `
        <button id="csr-roulette-close" style="position:absolute;top:10px;right:12px;border:none;background:none;font-size:14px;color:${DEED.ink};opacity:.6;cursor:pointer">✕</button>
        <h3 style="font-family:'Georgia',serif;margin:0 0 4px;color:${DEED.ink};font-size:15px">🎰 포인트 룰렛</h3>
        <div style="font-size:10px;color:${DEED.ink};opacity:.6;margin-bottom:14px">1시간마다 1회 · 자체 보유 ${s.points}P</div>
        <div style="position:relative;width:170px;height:170px;margin:0 auto 16px">
          <div id="csr-roulette-wheel" style="width:170px;height:170px;border-radius:50%;background:${buildRouletteGradient()};border:4px solid ${DEED.ink};transition:transform 3s cubic-bezier(.17,.67,.12,.99)"></div>
          <div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-top:16px solid ${DEED.ink}"></div>
        </div>
        <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:6px;font-size:9px;color:${DEED.ink};opacity:.75;margin-bottom:14px">
          ${ROULETTE_OUTCOMES.map((o) => `<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${o.color};margin-right:2px;vertical-align:middle"></span>${o.label}</span>`).join('')}
        </div>
        ${onCooldown
            ? `<div style="font-size:12px;color:${DEED.ink};opacity:.7;padding:10px 0">⏳ 쿨다운 중 — ${formatCooldown(cooldownMs)} 후 가능</div>`
            : `<div style="display:flex;gap:6px;margin-bottom:10px">
                <input id="csr-roulette-bet" type="number" min="1" max="${s.points}" value="${Math.min(10, s.points)}" placeholder="베팅 포인트" style="flex:1;padding:8px;border:1px solid ${DEED.line};border-radius:10px;font-size:12px;text-align:center">
                <button id="csr-roulette-spin-btn" style="padding:8px 14px;border:none;border-radius:10px;background:${DEED.ink};color:${DEED.bg};font-weight:800;font-size:12px;cursor:pointer" ${s.points <= 0 ? 'disabled' : ''}>스핀</button>
              </div>`}
        <div id="csr-roulette-result" style="font-size:12px;font-weight:800;color:${DEED.ink};min-height:18px"></div>
    `;
    document.body.appendChild(modal);
    document.getElementById('csr-roulette-close')?.addEventListener('click', () => modal.remove());

    document.getElementById('csr-roulette-spin-btn')?.addEventListener('click', () => {
        const betInput = document.getElementById('csr-roulette-bet');
        const bet = parseInt(betInput.value, 10);
        const spinBtn = document.getElementById('csr-roulette-spin-btn');
        const resultEl = document.getElementById('csr-roulette-result');
        const wheel = document.getElementById('csr-roulette-wheel');

        // 결과(당첨/꽝, 포인트 반영)는 미리 확정하고, 룰렛 휠은 그 결과에 맞춰 시각적으로만 돎
        const result = spinRoulette(bet);
        if (result.error) { toastr.warning(result.error); return; }

        spinBtn.disabled = true;
        betInput.disabled = true;
        resultEl.textContent = '';

        const mid = getOutcomeMidAngle(result.outcome.key);
        const spins = 5; // 시각적 회전 바퀴수
        const rotateTo = spins * 360 + ((360 - mid) % 360);
        wheel.style.transform = `rotate(${rotateTo}deg)`;

        setTimeout(() => {
            const isWin = result.outcome.pct > 0;
            resultEl.style.color = isWin ? '#2e8b57' : '#c0392b';
            resultEl.textContent = isWin
                ? `🎉 ${result.outcome.label}! +${Math.round(result.bet * result.outcome.pct / 100)}P (보유 ${result.newPoints}P)`
                : `💀 꽝! -${result.bet}P (보유 ${result.newPoints}P)`;
            refreshHeaderPoints();
            setTimeout(() => { modal.remove(); }, 2200);
        }, 3100);
    });
}
function renderBody() {
    const body = document.getElementById('csr-content');
    if (!body) return;
    refreshHeaderPoints();
    refreshHeaderInjectBadge();
    if (state.currentTab === 'house') {
        body.innerHTML = renderHouseTab();
        bindHouseTab();
    } else if (state.currentTab === 'items') {
        body.innerHTML = renderItemsTab();
        setInnerHTML('csr-tab2-body', renderTab2Body());
        bindItemsTab();
    } else if (state.currentTab === 'settings') {
        body.innerHTML = `<div style="padding:14px">${renderSettingsTabInner()}</div>`;
        bindSettingsTabInner();
    }
}

function bindHouseTab() {
    document.querySelectorAll('.csr-cat-chip').forEach((el) => el.addEventListener('click', () => {
        state.currentCategory = el.dataset.cat;
        renderBody();
    }));
    document.getElementById('csr-generate-btn')?.addEventListener('click', async () => {
        const hint = document.getElementById('csr-ref-input')?.value || '';
        showLoading('csr-deed-container', '그남의 집이 알아보는 중...');
        try {
            const card = await generateHouse(hint, false);
            if (!card) toastr.error('생성에 실패했어요 (AI 응답을 JSON으로 해석하지 못함). 다시 시도하거나 콘솔(F12) 로그를 확인해보세요.');
        } catch (e) { toastr.error(`생성 실패: ${e.message}`); }
        setInnerHTML('csr-deed-container', renderDeed());
        bindDeedButtons();
    });
    bindDeedButtons();
}
function bindDeedButtons() {
    document.getElementById('csr-move-btn')?.addEventListener('click', async () => {
        const hint = document.getElementById('csr-ref-input')?.value || '';
        showLoading('csr-deed-container', '이사 중...');
        try {
            const card = await generateHouse(hint, true);
            if (card) toastr.success('이사 완료!');
            else toastr.error('이사 실패 (AI 응답을 JSON으로 해석하지 못함). 다시 시도해보세요.');
        } catch (e) { toastr.error(`이사 실패: ${e.message}`); }
        setInnerHTML('csr-deed-container', renderDeed());
        bindDeedButtons();
    });
    document.getElementById('csr-lore-btn')?.addEventListener('click', async () => {
        if (!getCharData().house.current) { toastr.warning('먼저 집을 생성해주세요.'); return; }
        try {
            const text = await exportLorebook();
            if (!text) { toastr.error('변환에 실패했어요 (AI 응답이 비어있음). 다시 시도해보세요.'); return; }
            const copied = await copyToClipboard(text);
            if (copied) toastr.success('줄글로 정리해서 복사했어요!');
            // 실패 시 showManualCopyModal이 이미 안내 모달을 띄워줌
        } catch (e) { toastr.error(`처리 실패: ${e.message}`); }
    });
    document.getElementById('csr-apply-world-labels-btn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true; const origText = btn.textContent; btn.textContent = '🔄 변경 중...';
        try { await applyWorldLabelsToSpaces(); } catch (err) { toastr.error(`처리 실패: ${err.message}`); }
        btn.disabled = false; btn.textContent = origText;
    });
    document.querySelectorAll('.csr-history-item').forEach((el) => el.addEventListener('click', () => {
        showHistoryPopup(parseInt(el.dataset.idx));
    }));
    document.querySelectorAll('.csr-history-del').forEach((el) => el.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(el.dataset.idx);
        getCharData().house.history.splice(idx, 1);
        save();
        setInnerHTML('csr-deed-container', renderDeed());
        bindDeedButtons();
        toastr.success('이력 삭제 완료');
    }));
}

function bindItemsTab() {
    document.querySelectorAll('.csr-space-chip').forEach((el) => el.addEventListener('click', () => {
        state.currentSpace = el.dataset.space;
        state.foodSubview = null;
        renderBody();
    }));
    bindTab2Body();
}
function bindTab2Body() {
    document.getElementById('csr-pantry-btn')?.addEventListener('click', () => openFoodSubview('pantry'));
    document.getElementById('csr-fridge-btn')?.addEventListener('click', () => openFoodSubview('fridge'));
    document.getElementById('csr-back-btn')?.addEventListener('click', () => { state.foodSubview = null; setInnerHTML('csr-tab2-body', renderTab2Body()); bindTab2Body(); });
    document.querySelectorAll('.csr-food-switch').forEach((btn) => btn.addEventListener('click', () => openFoodSubview(btn.dataset.sub)));

    document.querySelectorAll('.csr-food-row').forEach((el) => el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx);
        const action = el.dataset.action;
        if (action === 'unlock') {
            if (unlockFoodItem(state.foodSubview, idx)) {
                setInnerHTML('csr-tab2-body', renderTab2Body());
                bindTab2Body();
                refreshHeaderPoints();
            }
        } else if (action === 'open') {
            showItemModal('food', state.foodSubview, idx);
        }
    }));

    document.getElementById('csr-food-reroll-btn')?.addEventListener('click', async () => {
        const subtype = state.foodSubview;
        setInnerHTML('csr-tab2-body', `<div style="text-align:center;padding:20px;color:${CUTE.text}">다시 채우는 중...</div>`);
        try { await generateFoodList(subtype, true); } catch (e) { toastr.error(`생성 실패: ${e.message}`); }
        setInnerHTML('csr-tab2-body', renderTab2Body());
        bindTab2Body();
    });
    document.getElementById('csr-food-bundle-inject-btn')?.addEventListener('click', () => {
        const nowOn = toggleFoodBundleInjection(state.foodSubview);
        toastr.success(nowOn ? '목록 주입을 시작했어요 (다음 턴부터 반영)' : '목록 주입을 해제했어요');
        setInnerHTML('csr-tab2-body', renderTab2Body());
        bindTab2Body();
        refreshHeaderInjectBadge();
    });

    document.getElementById('csr-load-space-btn')?.addEventListener('click', async () => {
        setInnerHTML('csr-item-grid', `<div style="grid-column:1/-1;text-align:center;padding:20px;color:${CUTE.text}">불러오는 중...</div>`);
        try { await generateItemPool(state.currentSpace, false); } catch (e) { toastr.error(`생성 실패: ${e.message}`); }
        setInnerHTML('csr-tab2-body', renderTab2Body());
        bindTab2Body();
    });
    document.getElementById('csr-room-reroll-btn')?.addEventListener('click', async () => {
        setInnerHTML('csr-item-grid', `<div style="grid-column:1/-1;text-align:center;padding:20px;color:${CUTE.text}">다시 채우는 중...</div>`);
        try { await generateItemPool(state.currentSpace, true); } catch (e) { toastr.error(`생성 실패: ${e.message}`); }
        setInnerHTML('csr-tab2-body', renderTab2Body());
        bindTab2Body();
    });
    document.querySelectorAll('.csr-item-slot').forEach((el) => el.addEventListener('click', async () => {
        const idx = parseInt(el.dataset.idx);
        if (el.dataset.action === 'unlock') {
            if (unlockItem(state.currentSpace, idx)) {
                setInnerHTML('csr-item-grid', renderItemGrid(state.currentSpace));
                bindTab2Body();
                refreshHeaderPoints();
            }
        } else {
            showItemModal('room', state.currentSpace, idx);
        }
    }));
}
async function openFoodSubview(subtype) {
    state.foodSubview = subtype;
    setInnerHTML('csr-tab2-body', renderTab2Body());
    bindTab2Body();
    const data = getCharData();
    if (!data[subtype]) {
        try { await generateFoodList(subtype, false); } catch (e) { toastr.error(`생성 실패: ${e.message}`); }
        setInnerHTML('csr-tab2-body', renderTab2Body());
        bindTab2Body();
    }
}

// ─── 드래그 / 리사이즈 (챗씨부인 방식 재사용) ───
function makeDraggable(panel, handle) {
    let drag = false, sx, sy, sl, st;
    const go = (cx, cy) => { drag = true; sx = cx; sy = cy; const r = panel.getBoundingClientRect(); sl = r.left; st = r.top; panel.style.right = 'auto'; document.body.style.userSelect = 'none'; };
    const mv = (cx, cy) => { if (!drag) return; const vw = window.innerWidth, vh = window.innerHeight; panel.style.left = Math.max(0, Math.min(vw - panel.offsetWidth, sl + cx - sx)) + 'px'; panel.style.top = Math.max(0, Math.min(vh - 60, st + cy - sy)) + 'px'; };
    const up = () => { drag = false; document.body.style.userSelect = ''; };
    handle.addEventListener('mousedown', (e) => { if (e.target.closest('button')) return; go(e.clientX, e.clientY); });
    document.addEventListener('mousemove', (e) => mv(e.clientX, e.clientY));
    document.addEventListener('mouseup', up);
    handle.addEventListener('touchstart', (e) => { if (e.target.closest('button')) return; const t = e.touches[0]; go(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
    document.addEventListener('touchmove', (e) => { if (!drag) return; mv(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }, { passive: false });
    document.addEventListener('touchend', up);
}

// ─── 패널 ───────────────────────────────────
function injectCSS() {
    if (document.getElementById('csr-styles')) return;
    const s = document.createElement('style');
    s.id = 'csr-styles';
    s.textContent = `@keyframes csr-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`;
    document.head.appendChild(s);
}

function createFloatingPanel() {
    return `<div id="csr-float" style="position:fixed;top:60px;right:20px;width:min(420px,95vw);height:80vh;background:${DEED.bg};border:2px solid ${DEED.ink};border-radius:6px;box-shadow:0 4px 30px rgba(0,0,0,.4);z-index:9997;display:flex;flex-direction:column;resize:both;overflow:hidden;min-width:300px;min-height:360px;font-family:system-ui,sans-serif">
        <div id="csr-drag-handle" style="background:${DEED.ink};padding:10px 12px;display:flex;align-items:center;gap:10px;cursor:move;flex-shrink:0;user-select:none">
            <span style="font-size:16px">🏠</span>
            <div style="flex:1;font-weight:800;color:${DEED.bg};font-size:13px">그남의 집</div>
            <button id="csr-header-inject-btn" style="font-weight:700;font-size:11px;color:${DEED.bg};background:rgba(255,255,255,.1);border:none;border-radius:8px;padding:3px 9px;cursor:pointer">📡 0</button>
            <button id="csr-header-roulette-btn" title="포인트 룰렛 (1시간마다 1회)" style="font-weight:700;font-size:12px;color:${DEED.bg};background:rgba(255,255,255,.1);border:none;border-radius:8px;padding:3px 7px;cursor:pointer">🎰</button>
            <span id="csr-header-pts" style="font-family:Georgia,serif;font-weight:700;font-size:12px;color:${DEED.gold};background:rgba(255,255,255,.1);border-radius:8px;padding:3px 9px">${getTotalPoints()} P</span>
            <button id="csr-close" style="background:none;border:1px solid ${DEED.bg}55;border-radius:4px;color:${DEED.bg};cursor:pointer;font-size:12px;padding:2px 7px">✕</button>
        </div>
        <div id="csr-tabs" style="display:flex;border-bottom:1px solid ${DEED.line};flex-shrink:0">
            <button class="csr-tab-btn" data-tab="house" style="flex:1;background:none;border:none;border-bottom:2px solid ${DEED.ink};padding:9px 0;cursor:pointer;color:${DEED.ink};font-size:12px;font-weight:800">🏠 거주지</button>
            <button class="csr-tab-btn" data-tab="items" style="flex:1;background:none;border:none;border-bottom:2px solid transparent;padding:9px 0;cursor:pointer;color:${DEED.ink};opacity:.5;font-size:12px;font-weight:800">🧳 소지품</button>
            <button class="csr-tab-btn" data-tab="settings" style="flex:1;background:none;border:none;border-bottom:2px solid transparent;padding:9px 0;cursor:pointer;color:${DEED.ink};opacity:.5;font-size:12px;font-weight:800">⚙️ 설정</button>
        </div>
        <div id="csr-content" style="flex:1;overflow-y:auto"></div>
    </div>`;
}

function openFloat() {
    if (document.getElementById('csr-float')) return;
    pruneOrphanedData();
    injectCSS();
    document.body.insertAdjacentHTML('beforeend', createFloatingPanel());
    const panel = document.getElementById('csr-float');
    makeDraggable(panel, document.getElementById('csr-drag-handle'));
    document.getElementById('csr-close')?.addEventListener('click', closeFloat);
    document.getElementById('csr-header-inject-btn')?.addEventListener('click', showInjectionSummaryPanel);
    document.getElementById('csr-header-roulette-btn')?.addEventListener('click', showRoulettePopup);
    panel.querySelectorAll('.csr-tab-btn').forEach((btn) => btn.addEventListener('click', () => {
        state.currentTab = btn.dataset.tab;
        panel.querySelectorAll('.csr-tab-btn').forEach((b) => {
            const active = b.dataset.tab === state.currentTab;
            b.style.borderBottom = active ? `2px solid ${DEED.ink}` : '2px solid transparent';
            b.style.opacity = active ? '1' : '.5';
        });
        panel.style.background = state.currentTab === 'items' ? CUTE.bg : DEED.bg;
        renderBody();
    }));
    state.isPanelOpen = true;
    renderBody();
}
function closeFloat() { document.getElementById('csr-float')?.remove(); state.isPanelOpen = false; }
function toggleFloat() { document.getElementById('csr-float') ? closeFloat() : openFloat(); }

// ─── 설정 탭 (메인 패널 안의 ⚙️ 설정 탭) ───────
function renderSettingsTabInner() {
    const ctx = SillyTavern.getContext();
    const s = getSettings();
    const own = s.points;
    const cr = getChatleRoyalPoints();
    const profiles = ctx.extensionSettings?.['connectionManager']?.profiles || [];
    const saved = s.selectedProfileName || '';
    const profileOpts = profiles.map((p) => `<option value="${esc(p.name)}" ${p.name === saved ? 'selected' : ''}>${esc(p.name)}</option>`).join('');

    return `<div style="display:flex;flex-direction:column;gap:12px">
        <div>
            <div style="font-size:11px;font-weight:800;color:${DEED.ink};margin-bottom:4px">연결 프로필 (선택 안 하면 현재 연결 + 로어북/챗 자동 포함)</div>
            <select id="csr-api-profile" style="width:100%;border:1px solid ${DEED.line};background:#fff;border-radius:10px;padding:8px 10px;font-size:12px;color:${DEED.ink};box-sizing:border-box">
                <option value="">현재 연결 그대로 (로어북/챗 자동 포함)</option>
                ${profileOpts}
            </select>
        </div>
        <div>
            <div style="font-size:11px;font-weight:800;color:${DEED.ink};margin-bottom:4px">Max Tokens</div>
            <input id="csr-max-tokens" type="number" min="500" max="16000" step="500" value="${s.maxTokens || 4000}" style="width:100%;border:1px solid ${DEED.line};background:#fff;border-radius:10px;padding:8px 10px;font-size:12px;color:${DEED.ink};box-sizing:border-box">
        </div>
        <div>
            <div style="font-size:11px;font-weight:800;color:${DEED.ink};margin-bottom:4px">불러올 최근 채팅 개수 (연결 프로필 지정 시에만 적용)</div>
            <input id="csr-chat-count" type="number" min="5" max="200" step="5" value="${s.chatHistoryCount || 30}" style="width:100%;border:1px solid ${DEED.line};background:#fff;border-radius:10px;padding:8px 10px;font-size:12px;color:${DEED.ink};box-sizing:border-box">
        </div>
        <div>
            <div style="font-size:11px;font-weight:800;color:${DEED.ink};margin-bottom:4px">출력 언어 / Output Language</div>
            <select id="csr-lang" style="width:100%;border:1px solid ${DEED.line};background:#fff;border-radius:10px;padding:8px 10px;font-size:12px;color:${DEED.ink};box-sizing:border-box">
                <option value="ko" ${s.outputLanguage === 'ko' ? 'selected' : ''}>한국어</option>
                <option value="en" ${s.outputLanguage === 'en' ? 'selected' : ''}>English</option>
            </select>
        </div>
        <div style="border-top:1px solid ${DEED.line};padding-top:10px">
            <div style="font-size:12px;color:${DEED.ink}">보유 포인트: <b>${own}P</b>${cr ? ` (+ 챗틀로얄 ${cr}P 동기화 가능)` : ''}</div>
            <div style="font-size:10px;color:${DEED.ink};opacity:.7;margin-top:3px">⏰ 3시간마다 자동으로 10P씩 적립됩니다 (앱을 꺼두었어도 다음 접속 시 경과 시간만큼 한꺼번에 적립).</div>
            <button id="csr-sync-btn" style="width:100%;margin-top:8px;padding:9px;border:none;border-radius:12px;background:${CUTE.lav};color:${CUTE.text};font-weight:800;font-size:12px;cursor:pointer">🔄 챗틀로얄 포인트 동기화</button>
        </div>
        <div style="border-top:1px solid ${DEED.line};padding-top:10px;display:flex;flex-direction:column;gap:6px">
            <button id="csr-clear-history-btn" style="width:100%;padding:9px;border:1px solid ${DEED.line};border-radius:12px;background:#fff;color:${DEED.ink};font-weight:800;font-size:12px;cursor:pointer">🗑 거주 이력만 삭제</button>
            <button id="csr-reset-btn" style="width:100%;padding:9px;border:1px solid ${DEED.line};border-radius:12px;background:#fff;color:${DEED.ink};font-weight:800;font-size:12px;cursor:pointer">🗑 데이터 초기화 (포인트는 보존)</button>
            <button id="csr-full-wipe-btn" style="width:100%;padding:9px;border:1px solid ${DEED.stamp};border-radius:12px;background:#fff;color:${DEED.stamp};font-weight:800;font-size:11px;cursor:pointer">⚠️ 완전 삭제 (포인트 포함 — 확장 제거 전용)</button>
        </div>
    </div>`;
}
function bindSettingsTabInner() {
    document.getElementById('csr-api-profile')?.addEventListener('change', (e) => {
        const s = getSettings(); s.selectedProfileName = e.target.value || null; save();
        toastr.success(e.target.value ? `"${e.target.value}" 프로필 선택됨` : '현재 연결 사용');
    });
    document.getElementById('csr-max-tokens')?.addEventListener('change', (e) => {
        const s = getSettings(); s.maxTokens = parseInt(e.target.value) || 4000; save();
    });
    document.getElementById('csr-chat-count')?.addEventListener('change', (e) => {
        const s = getSettings(); s.chatHistoryCount = parseInt(e.target.value) || 30; save();
    });
    document.getElementById('csr-lang')?.addEventListener('change', (e) => {
        const s = getSettings(); s.outputLanguage = e.target.value; save();
        toastr.success(e.target.value === 'en' ? 'Output language set to English' : '출력 언어가 한국어로 설정됐어요');
    });
    document.getElementById('csr-sync-btn')?.addEventListener('click', () => {
        syncChatleRoyalPoints();
        renderBody();
    });
    document.getElementById('csr-clear-history-btn')?.addEventListener('click', async () => {
        const { Popup, POPUP_RESULT } = SillyTavern.getContext();
        const ok = await Popup.show.confirm('거주 이력 삭제', '현재 캐릭터의 거주 이력만 삭제합니다 (현재 집 정보/소지품/포인트는 그대로 유지). 진행할까요?');
        if (ok === POPUP_RESULT.AFFIRMATIVE) {
            getCharData().house.history = [];
            save();
            toastr.success('거주 이력 삭제 완료');
            renderBody();
        }
    });
    document.getElementById('csr-reset-btn')?.addEventListener('click', async () => {
        const { Popup, POPUP_RESULT } = SillyTavern.getContext();
        const ok = await Popup.show.confirm('데이터 초기화', '모든 캐릭터의 거주지/소지품 데이터를 초기화합니다. 포인트와 설정(프로필/언어 등)은 그대로 유지됩니다. 되돌릴 수 없습니다. 진행할까요?');
        if (ok === POPUP_RESULT.AFFIRMATIVE) {
            const s = getSettings();
            s.perChar = {};
            save();
            toastr.success('데이터 초기화 완료 (포인트는 유지됨)');
            renderBody();
        }
    });
    document.getElementById('csr-full-wipe-btn')?.addEventListener('click', async () => {
        const { Popup, POPUP_RESULT } = SillyTavern.getContext();
        const ok = await Popup.show.confirm('완전 삭제', '포인트를 포함한 그남의 집의 모든 데이터를 완전히 삭제합니다. 확장을 제거하기 전에만 사용하세요. 되돌릴 수 없습니다. 정말 진행할까요?');
        if (ok === POPUP_RESULT.AFFIRMATIVE) {
            SillyTavern.getContext().extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
            save();
            toastr.success('완전 삭제 완료');
            renderBody();
        }
    });
}

// ─── 초기화 ─────────────────────────────────
export async function onActivate() {
    console.log(`[${MODULE_NAME}] 활성화`);
    checkRefill();
    pruneOrphanedData();

    if (!document.getElementById('csr-wand-btn')) {
        const html = `<div id="csr-wand-btn" title="그남의 집" style="cursor:pointer;padding:4px 8px;display:flex;align-items:center;gap:5px;font-size:13px">
            <span>🏠</span><span style="font-size:12px">그남의 집</span>
        </div>`;
        const toolbar = document.getElementById('extensionsMenu') ?? document.getElementById('top-bar');
        toolbar?.insertAdjacentHTML('beforeend', html);
        document.getElementById('csr-wand-btn')?.addEventListener('click', toggleFloat);
    }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.isPanelOpen) closeFloat(); });
    console.log(`[${MODULE_NAME}] 초기화 완료`);
}

jQuery(async () => {
    const context = SillyTavern.getContext();
    context.eventSource.on(event_types.APP_READY, async () => { await onActivate(); });
});
