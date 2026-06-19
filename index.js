/**
 * 🏠 챗씨부동산 v0.1
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
} from './prompts.js';

const MODULE_NAME = 'chatssi_realestate';
const CHATLEROYAL_KEY = 'chatl_royal'; // 챗틀로얄 실제 모듈명 (확인됨)
const BASE_POINTS = 50;
const REFILL_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3시간
const REFILL_AMOUNT = 10;
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
        s.perChar[key] = { house: { current: null, history: [] }, spaces: {}, pantry: null, fridge: null };
    }
    return s.perChar[key];
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
// 챗틀로얄 포인트를 자체 포인트로 가져오기 (동기화 — 챗틀로얄 쪽 포인트는 그만큼 차감됨)
function syncChatleRoyalPoints() {
    const ctx = SillyTavern.getContext();
    const cr = ctx.extensionSettings?.[CHATLEROYAL_KEY];
    const amount = (cr && typeof cr.points === 'number') ? cr.points : 0;
    if (amount <= 0) { toastr.info('가져올 챗틀로얄 포인트가 없어요'); return 0; }
    const s = getSettings();
    s.points += amount;
    s.lifetimePoints += amount;
    cr.points = 0;
    save();
    toastr.success(`챗틀로얄에서 ${amount}P 가져왔어요!`);
    return amount;
}

// ─── AI 호출 ────────────────────────────────
// 프로필 선택 시: 직접 모은 컨텍스트(캐릭터시트/페르소나/최근 챗) + 프롬프트를 ConnectionManager로 전송
// 프로필 미선택 시: generateQuietPrompt로 ST가 로어북/AN/챗을 자동으로 섞어서 생성 (현재 연결 사용)
function buildManualContext() {
    const ctx = SillyTavern.getContext();
    const char = ctx.characters?.[ctx.characterId];
    const charDesc = [char?.description, char?.personality, char?.scenario].filter(Boolean).join('\n').slice(0, 1200);
    const personaName = ctx.name1 || '';
    const personaDesc = (ctx.powerUserSettings?.persona_description || '').slice(0, 500);
    const recentChat = (ctx.chat || []).slice(-15).map((m) => `${m.is_user ? (personaName || '유저') : (char?.name || 'AI')}: ${m.mes}`).join('\n').slice(0, 3000);
    return [
        charDesc ? `[캐릭터 시트]\n${charDesc}` : '',
        personaDesc ? `[페르소나: ${personaName}]\n${personaDesc}` : '',
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
            const context = buildManualContext();
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
    return await callAI(buildLorebookExportPrompt(data.house.current, lang));
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
async function generateItemPool(spaceKey) {
    const space = SPACES.find((s) => s.key === spaceKey);
    const lang = getSettings().outputLanguage || 'ko';
    const data = getCharData();
    const worldClass = data.house.current?._worldClass || (await classifyWorld(''));
    const result = parseJSON(await callAI(buildItemPoolPrompt('', worldClass, spaceKey, space.label, lang)));
    if (!result) return null;
    if (result.empty) {
        data.spaces[spaceKey] = { empty: true, emptyReason: result.emptyReason };
    } else {
        data.spaces[spaceKey] = {
            empty: false,
            items: result.items.slice(0, ITEM_CAP).map((it) => ({ ...it, unlocked: it.unlockCost === 0, pinned: false, createdAt: Date.now() })),
        };
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
async function generateFoodList(subtype) {
    const lang = getSettings().outputLanguage || 'ko';
    const data = getCharData();
    const worldClass = data.house.current?._worldClass || (await classifyWorld(''));
    const result = parseJSON(await callAI(buildFoodListPrompt('', worldClass, subtype, lang)));
    if (!result) return null;
    data[subtype] = result.empty ? { empty: true } : { empty: false, list: result.list };
    save();
    return data[subtype];
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
function deedRow(label, value) {
    return `<div style="border-bottom:1px dashed ${DEED.line};padding-bottom:6px">
        <div style="font-size:9px;color:${DEED.gold};font-weight:800;letter-spacing:.4px;text-transform:uppercase">${esc(label)}</div>
        <div style="font-size:12px;color:${DEED.ink};font-weight:700;margin-top:2px;word-break:break-word">${esc(value ?? '-')}</div>
    </div>`;
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
            <summary style="font-size:11px;font-weight:800;color:${DEED.ink};cursor:pointer">거주 이력</summary>
            <ul style="margin:8px 0 0;padding-left:16px;font-size:11px;color:${DEED.ink};opacity:.8;line-height:1.6">
                ${data.house.history.map((h) => `<li>${esc(h.location)} · ${esc(h.residenceType)} (${esc(h.moveInDate)})</li>`).join('')}
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
    return slot.list.map((f, idx) => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px dashed #f1d8e0">
            <div style="font-size:12px;color:${CUTE.text};font-weight:700">${esc(f.emoji)} ${esc(f.name)}</div>
            <div style="font-size:10px;color:#9b8aa0;font-weight:700">
                ${f.unlockCost > 0
                    ? `<span class="csr-food-unlock" data-idx="${idx}" data-subtype="${subtype}" style="font-size:9px;background:${CUTE.yellow};padding:2px 7px;border-radius:8px;font-weight:800;color:${CUTE.text};cursor:pointer">${f.unlockCost}P 해금</span>`
                    : esc(f.qty)}
            </div>
        </div>`).join('');
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
        <div style="display:flex;gap:6px;flex-wrap:wrap;padding-bottom:10px">
            ${SPACES.map((s) => `<div class="csr-space-chip" data-space="${s.key}" style="flex:none;display:inline-flex;align-items:center;gap:4px;line-height:1.4;padding:7px 12px;border-radius:999px;background:${s.key === state.currentSpace ? CUTE.lav : '#fff'};color:${CUTE.text};font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap"><span style="font-size:13px">${s.emoji}</span><span>${s.label}</span></div>`).join('')}
        </div>
        <div id="csr-tab2-body"></div>
    </div>`;
}
function renderTab2Body() {
    if (state.currentSpace === 'kitchen') {
        if (state.foodSubview) {
            return `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
                <button id="csr-back-btn" style="border:none;background:rgba(0,0,0,.06);border-radius:10px;padding:7px 11px;font-weight:800;font-size:11px;color:${CUTE.text};cursor:pointer">‹ 뒤로</button>
                <div style="font-size:14px;font-weight:800;color:${CUTE.text}">${state.foodSubview === 'pantry' ? '팬트리' : '냉장고'}</div>
                <div style="display:flex;gap:6px;margin-left:auto">
                    <button class="csr-food-switch" data-sub="pantry" style="border:none;padding:6px 12px;border-radius:999px;font-size:10px;font-weight:800;background:${state.foodSubview === 'pantry' ? CUTE.lav : '#fff'};color:${CUTE.text};cursor:pointer">팬트리</button>
                    <button class="csr-food-switch" data-sub="fridge" style="border:none;padding:6px 12px;border-radius:999px;font-size:10px;font-weight:800;background:${state.foodSubview === 'fridge' ? CUTE.lav : '#fff'};color:${CUTE.text};cursor:pointer">냉장고</button>
                </div>
            </div>
            <div style="background:#fff;border-radius:14px;padding:4px 13px">${renderFoodList(state.foodSubview)}</div>`;
        }
        return `
        <div style="display:flex;gap:8px;margin-bottom:12px">
            <button id="csr-pantry-btn" style="flex:1;padding:9px;border-radius:12px;border:none;background:${CUTE.mint};font-weight:800;font-size:11px;color:${CUTE.text};cursor:pointer">🥫 팬트리 보기</button>
            <button id="csr-fridge-btn" style="flex:1;padding:9px;border-radius:12px;border:none;background:${CUTE.mint};font-weight:800;font-size:11px;color:${CUTE.text};cursor:pointer">🧊 냉장고 보기</button>
        </div>`;
    }
    const slot = getCharData().spaces[state.currentSpace];
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;background:#fff;border-radius:14px;padding:10px 13px;margin-bottom:10px">
        <span style="font-size:11px;color:${CUTE.text};font-weight:700">보유 포인트</span>
        <span style="font-family:Georgia,serif;color:${CUTE.text};font-weight:700;font-size:14px">${getTotalPoints()} P</span>
    </div>
    ${!slot ? `<button id="csr-load-space-btn" style="width:100%;padding:10px;border:none;border-radius:12px;background:${CUTE.lav};color:${CUTE.text};font-weight:800;font-size:12px;cursor:pointer;margin-bottom:10px">불러오기</button>` : ''}
    <div id="csr-item-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:9px">${renderItemGrid(state.currentSpace)}</div>`;
}

// ─── 모달 ───────────────────────────────────
function showItemModal(spaceKey, idx) {
    const item = getCharData().spaces[spaceKey].items[idx];
    document.getElementById('csr-modal')?.remove();

    // 챗틀로얄 방식: flex 중앙정렬 대신 창 크기 기준으로 top/left를 미리 계산해서 고정 배치
    // (모바일 키보드 등으로 뷰포트 높이가 바뀌어도 모달이 다시 중앙정렬되며 위로 솟구치는 문제 방지)
    const mw = Math.min(300, window.innerWidth * 0.9);
    const ml = Math.max(10, (window.innerWidth - mw) / 2);
    const mt = Math.max(10, Math.min(window.innerHeight * 0.15, window.innerHeight - 280));

    const modal = document.createElement('div');
    modal.id = 'csr-modal';
    modal.style.cssText = `position:fixed;top:${mt}px;left:${ml}px;width:${mw}px;background:#fff;border-radius:18px;padding:20px;font-family:system-ui;z-index:10500;box-shadow:0 8px 40px rgba(0,0,0,.4)`;
    modal.innerHTML = `
        <button id="csr-modal-close-x" style="position:absolute;top:10px;right:12px;background:none;border:none;cursor:pointer;font-size:14px;color:${CUTE.text};opacity:.6">✕</button>
        <div style="font-weight:800;font-size:15px;color:${CUTE.text};padding-right:18px">${esc(item.brand)}</div>
        <div style="font-weight:800;color:${DEED.stamp};margin:5px 0 10px;font-size:13px">${esc(item.price)}</div>
        <div style="font-size:11px;color:#555;line-height:1.55;background:#FFF7E8;border-radius:10px;padding:10px">${esc(item.tmi)}</div>
        <button id="csr-modal-pin" style="margin-top:9px;width:100%;padding:9px;border:none;border-radius:12px;background:${CUTE.yellow};font-weight:800;color:${CUTE.text};cursor:pointer;font-size:11px">${item.pinned ? '📌 고정 해제' : '📌 고정하기'}</button>
        <button id="csr-modal-close" style="margin-top:7px;width:100%;padding:9px;border:none;border-radius:12px;background:${CUTE.text};color:#fff;font-weight:800;cursor:pointer;font-size:12px">닫기</button>
    `;
    document.body.appendChild(modal);
    document.getElementById('csr-modal-close')?.addEventListener('click', () => modal.remove());
    document.getElementById('csr-modal-close-x')?.addEventListener('click', () => modal.remove());
    document.getElementById('csr-modal-pin')?.addEventListener('click', () => {
        togglePin(spaceKey, idx);
        renderBody();
        modal.remove();
    });
}

// ─── 메인 렌더 / 바인딩 ─────────────────────
function renderBody() {
    const body = document.getElementById('csr-content');
    if (!body) return;
    if (state.currentTab === 'house') {
        body.innerHTML = renderHouseTab();
        bindHouseTab();
    } else if (state.currentTab === 'items') {
        body.innerHTML = renderItemsTab();
        document.getElementById('csr-tab2-body').innerHTML = renderTab2Body();
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
        showLoading('csr-deed-container', '챗씨부동산이 집을 알아보는 중...');
        try {
            const card = await generateHouse(hint, false);
            if (!card) toastr.error('생성에 실패했어요 (AI 응답을 JSON으로 해석하지 못함). 다시 시도하거나 콘솔(F12) 로그를 확인해보세요.');
        } catch (e) { toastr.error(`생성 실패: ${e.message}`); }
        document.getElementById('csr-deed-container').innerHTML = renderDeed();
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
        document.getElementById('csr-deed-container').innerHTML = renderDeed();
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
    document.getElementById('csr-back-btn')?.addEventListener('click', () => { state.foodSubview = null; document.getElementById('csr-tab2-body').innerHTML = renderTab2Body(); bindTab2Body(); });
    document.querySelectorAll('.csr-food-switch').forEach((btn) => btn.addEventListener('click', () => openFoodSubview(btn.dataset.sub)));
    document.querySelectorAll('.csr-food-unlock').forEach((btn) => btn.addEventListener('click', () => {
        const subtype = btn.dataset.subtype, idx = btn.dataset.idx;
        const item = getCharData()[subtype].list[idx];
        if (spendPoints(item.unlockCost)) { item.unlockCost = 0; save(); document.getElementById('csr-tab2-body').innerHTML = renderTab2Body(); bindTab2Body(); }
    }));
    document.getElementById('csr-load-space-btn')?.addEventListener('click', async () => {
        document.getElementById('csr-item-grid').innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:${CUTE.text}">불러오는 중...</div>`;
        try { await generateItemPool(state.currentSpace); } catch (e) { toastr.error(`생성 실패: ${e.message}`); }
        document.getElementById('csr-tab2-body').innerHTML = renderTab2Body();
        bindTab2Body();
    });
    document.querySelectorAll('.csr-item-slot').forEach((el) => el.addEventListener('click', async () => {
        const idx = parseInt(el.dataset.idx);
        if (el.dataset.action === 'unlock') {
            if (unlockItem(state.currentSpace, idx)) {
                document.getElementById('csr-item-grid').innerHTML = renderItemGrid(state.currentSpace);
                bindTab2Body();
            }
        } else {
            showItemModal(state.currentSpace, idx);
        }
    }));
}
async function openFoodSubview(subtype) {
    state.foodSubview = subtype;
    document.getElementById('csr-tab2-body').innerHTML = renderTab2Body();
    bindTab2Body();
    const data = getCharData();
    if (!data[subtype]) {
        try { await generateFoodList(subtype); } catch (e) { toastr.error(`생성 실패: ${e.message}`); }
        document.getElementById('csr-tab2-body').innerHTML = renderTab2Body();
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
            <div style="flex:1;font-weight:800;color:${DEED.bg};font-size:13px">챗씨부동산</div>
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
    injectCSS();
    document.body.insertAdjacentHTML('beforeend', createFloatingPanel());
    const panel = document.getElementById('csr-float');
    makeDraggable(panel, document.getElementById('csr-drag-handle'));
    document.getElementById('csr-close')?.addEventListener('click', closeFloat);
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
        <button id="csr-reset-btn" style="width:100%;padding:9px;border:1px solid ${DEED.stamp};border-radius:12px;background:#fff;color:${DEED.stamp};font-weight:800;font-size:12px;cursor:pointer">🗑 전체 초기화</button>
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
    document.getElementById('csr-lang')?.addEventListener('change', (e) => {
        const s = getSettings(); s.outputLanguage = e.target.value; save();
        toastr.success(e.target.value === 'en' ? 'Output language set to English' : '출력 언어가 한국어로 설정됐어요');
    });
    document.getElementById('csr-sync-btn')?.addEventListener('click', () => {
        syncChatleRoyalPoints();
        renderBody();
    });
    document.getElementById('csr-reset-btn')?.addEventListener('click', async () => {
        const { Popup, POPUP_RESULT } = SillyTavern.getContext();
        const ok = await Popup.show.confirm('전체 초기화', '챗씨부동산의 모든 데이터(포인트/거주지/소지품)를 초기화합니다. 되돌릴 수 없습니다. 진행할까요?');
        if (ok === POPUP_RESULT.AFFIRMATIVE) {
            SillyTavern.getContext().extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
            save();
            toastr.success('초기화 완료');
            renderBody();
        }
    });
}

// ─── 초기화 ─────────────────────────────────
export async function onActivate() {
    console.log(`[${MODULE_NAME}] 활성화`);
    checkRefill();

    if (!document.getElementById('csr-wand-btn')) {
        const html = `<div id="csr-wand-btn" title="챗씨부동산" style="cursor:pointer;padding:4px 8px;display:flex;align-items:center;gap:5px;font-size:13px">
            <span>🏠</span><span style="font-size:12px">챗씨부동산</span>
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
