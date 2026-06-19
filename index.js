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
const REFILL_INTERVAL_MS = 60 * 60 * 1000; // 1시간
const REFILL_AMOUNT = 1;
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
    // 합산 표시는 챗틀로얄 포인트를 포함하지만, 실제 차감은 자체 포인트에서만 처리
    // (다른 확장의 저장 데이터를 직접 수정하는 건 위험 요소라 보류 — 추후 정식 연동 API 생기면 교체)
    toastr.warning('자체 포인트가 부족해요 (합산 포인트는 표시용, 차감은 자체 포인트에서만 가능)');
    return false;
}

// ─── AI 호출 (챗씨부인 방식 그대로 — generateQuietPrompt) ───
async function callAI(prompt) {
    const ctx = SillyTavern.getContext();
    const result = await ctx.generateQuietPrompt({
        quietPrompt: prompt,
        quietToLoud: true,
        skipWIAN: false, // 로어북/Author's Note 포함
    });
    return filterPhoneTrigger(result || '');
}
function parseJSON(raw) {
    try {
        return JSON.parse(String(raw).replace(/```json|```/g, '').trim());
    } catch (e) {
        console.error(`[${MODULE_NAME}] JSON 파싱 실패:`, e, raw);
        return null;
    }
}

// ─── 거주지 생성 / 이사가기 / 로어북 export ───
async function classifyWorld(userHint) {
    const raw = await callAI(buildWorldClassifyPrompt('', userHint));
    return parseJSON(raw) || { category: 'REALISTIC', subtype: '', location_hint: '' };
}
async function generateHouse(userHint, isMove) {
    const worldClass = await classifyWorld(userHint);
    const data = getCharData();
    const prompt = isMove
        ? buildHouseMovePrompt('', worldClass, data.house.current)
        : buildAddressGeneratePrompt('', worldClass, userHint);
    const card = parseJSON(await callAI(prompt));
    if (!card) return null;
    card._worldClass = worldClass;
    if (data.house.current) data.house.history.unshift(data.house.current);
    data.house.current = card;
    save();
    return card;
}
async function exportLorebook() {
    const data = getCharData();
    if (!data.house.current) return null;
    return await callAI(buildLorebookExportPrompt(data.house.current));
}

// ─── 아이템 풀 ──────────────────────────────
async function generateItemPool(spaceKey) {
    const space = SPACES.find((s) => s.key === spaceKey);
    const data = getCharData();
    const worldClass = data.house.current?._worldClass || (await classifyWorld(''));
    const result = parseJSON(await callAI(buildItemPoolPrompt('', worldClass, spaceKey, space.label)));
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
    const data = getCharData();
    const worldClass = data.house.current?._worldClass || (await classifyWorld(''));
    const result = parseJSON(await callAI(buildFoodListPrompt('', worldClass, subtype)));
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
        <div style="display:flex;gap:6px;margin-bottom:10px;overflow-x:auto">
            ${WORLD_CATS.map((c) => `<div class="csr-cat-chip" data-cat="${esc(c)}" style="flex:none;padding:7px 12px;border-radius:999px;background:${c === state.currentCategory ? DEED.ink : '#fff'};color:${c === state.currentCategory ? DEED.bg : DEED.ink};border:1px solid ${DEED.line};font-size:11px;font-weight:800;cursor:pointer">${esc(c)}</div>`).join('')}
        </div>
        <input id="csr-ref-input" style="width:100%;border:1px solid ${DEED.line};background:#fff;border-radius:10px;padding:10px 12px;font-size:12px;color:${DEED.ink};margin-bottom:10px;box-sizing:border-box" placeholder="예: 뉴욕 맨하탄 · 조선 한성 · 해리포터-런던 · 비워두면 자동">
        <button id="csr-generate-btn" style="width:100%;padding:12px;border:none;border-radius:12px;background:${DEED.ink};color:${DEED.bg};font-weight:800;font-size:13px;cursor:pointer;margin-bottom:16px">집 생성하기</button>
        <div id="csr-deed-container">${renderDeed()}</div>
    </div>`;
}
function renderItemsTab() {
    return `
    <div style="padding:14px">
        <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:10px">
            ${SPACES.map((s) => `<div class="csr-space-chip" data-space="${s.key}" style="flex:none;padding:7px 12px;border-radius:999px;background:${s.key === state.currentSpace ? CUTE.lav : '#fff'};color:${CUTE.text};font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap">${s.emoji} ${s.label}</div>`).join('')}
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
    const modal = document.createElement('div');
    modal.id = 'csr-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10500;padding:20px';
    modal.innerHTML = `
        <div style="width:100%;max-width:300px;background:#fff;border-radius:18px;padding:20px;font-family:system-ui">
            <div style="font-weight:800;font-size:15px;color:${CUTE.text}">${esc(item.brand)}</div>
            <div style="font-weight:800;color:${DEED.stamp};margin:5px 0 10px;font-size:13px">${esc(item.price)}</div>
            <div style="font-size:11px;color:#555;line-height:1.55;background:#FFF7E8;border-radius:10px;padding:10px">${esc(item.tmi)}</div>
            <button id="csr-modal-pin" style="margin-top:9px;width:100%;padding:9px;border:none;border-radius:12px;background:${CUTE.yellow};font-weight:800;color:${CUTE.text};cursor:pointer;font-size:11px">${item.pinned ? '📌 고정 해제' : '📌 고정하기'}</button>
            <button id="csr-modal-close" style="margin-top:7px;width:100%;padding:9px;border:none;border-radius:12px;background:${CUTE.text};color:#fff;font-weight:800;cursor:pointer;font-size:12px">닫기</button>
        </div>`;
    document.body.appendChild(modal);
    document.getElementById('csr-modal-close')?.addEventListener('click', () => modal.remove());
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
    } else {
        body.innerHTML = renderItemsTab();
        document.getElementById('csr-tab2-body').innerHTML = renderTab2Body();
        bindItemsTab();
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
            await generateHouse(hint, false);
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
            await generateHouse(hint, true);
            toastr.success('이사 완료!');
        } catch (e) { toastr.error(`이사 실패: ${e.message}`); }
        document.getElementById('csr-deed-container').innerHTML = renderDeed();
        bindDeedButtons();
    });
    document.getElementById('csr-lore-btn')?.addEventListener('click', async () => {
        try {
            const text = await exportLorebook();
            if (!text) return;
            await navigator.clipboard.writeText(text);
            toastr.success('줄글로 정리해서 복사했어요!');
        } catch (e) { toastr.error(`복사 실패: ${e.message}`); }
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

// ─── 설정 드로어 (간단 버전 — 포인트 표시 + 전체 초기화) ───
function renderSettingsDrawerInner() {
    const own = getSettings().points;
    const cr = getChatleRoyalPoints();
    return `<div style="padding:8px;display:flex;flex-direction:column;gap:8px">
        <div style="font-size:0.82rem">보유 포인트: <b>${own}P</b> ${cr ? `+ 챗틀로얄 ${cr}P = 총 ${own + cr}P` : ''}</div>
        <button id="csr-reset-btn" class="menu_button" style="width:100%">🗑 전체 초기화</button>
    </div>`;
}
function injectSettingsDrawer() {
    if (document.getElementById('csr-ext-settings')) return;
    const html = `<div class="inline-drawer" id="csr-ext-settings">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>🏠 챗씨부동산</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" id="csr-settings-content"></div>
    </div>`;
    const target = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    target?.insertAdjacentHTML('beforeend', html);
    const content = document.getElementById('csr-settings-content');

    function renderAndBind() {
        content.innerHTML = renderSettingsDrawerInner();
        content.querySelector('#csr-reset-btn')?.addEventListener('click', async () => {
            const { Popup, POPUP_RESULT } = SillyTavern.getContext();
            const ok = await Popup.show.confirm('전체 초기화', '챗씨부동산의 모든 데이터(포인트/거주지/소지품)를 초기화합니다. 되돌릴 수 없습니다. 진행할까요?');
            if (ok === POPUP_RESULT.AFFIRMATIVE) {
                SillyTavern.getContext().extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
                save();
                toastr.success('초기화 완료');
                renderAndBind();
                closeFloat();
            }
        });
    }
    renderAndBind();
}

// ─── 초기화 ─────────────────────────────────
export async function onActivate() {
    console.log(`[${MODULE_NAME}] 활성화`);
    checkRefill();
    injectSettingsDrawer();

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
