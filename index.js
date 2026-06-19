// index.js — 챗씨부동산
// ⚠ 빌드 스캐폴드: ST 버전별로 import 경로/이벤트명이 다를 수 있음.
//   실제 환경에서 콘솔 에러 보면서 아래 표시된 TODO 지점들 확인할 것.

import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { ConnectionManagerRequestService } from "../../../connection-manager-request-service.js"; // TODO: 실제 경로/클래스명 확인

import {
  buildWorldClassifyPrompt,
  buildAddressGeneratePrompt,
  buildHouseMovePrompt,
  buildItemPoolPrompt,
  buildFoodListPrompt,
  buildLorebookExportPrompt,
} from "./prompts.js";

const MODULE_NAME = "chatssi_realestate";
const BASE_POINTS = 50;
const POINT_INTERVAL_MS = 60 * 60 * 1000; // 1시간
const ITEM_CAP = 12;

const SPACES = [
  { key: "kitchen", label: "주방", emoji: "🍳", food: true },
  { key: "living", label: "거실", emoji: "🛋️", food: false },
  { key: "bath", label: "욕실", emoji: "🛁", food: false },
  { key: "bedroom", label: "침실", emoji: "👗", food: false },
  { key: "study", label: "서재", emoji: "📚", food: false },
  { key: "garage", label: "차고", emoji: "🚗", food: false },
  { key: "storage", label: "창고", emoji: "📦", food: false },
];

// ---------------------------------------------------------------
// 0. 설정 초기화
// ---------------------------------------------------------------

function defaultSettings() {
  return {
    apiProfile: "",
    points: { total: BASE_POINTS, lastAccrual: Date.now() },
    perChat: {}, // chatKey -> { house:{current,history}, spaces:{key:[12 items]}, pantry:[], fridge:[] }
  };
}

function loadSettings() {
  if (!extension_settings[MODULE_NAME]) {
    extension_settings[MODULE_NAME] = defaultSettings();
    saveSettingsDebounced();
  }
  // 마이그레이션 안전장치 (필드 누락 보강)
  const s = extension_settings[MODULE_NAME];
  if (!s.points) s.points = { total: BASE_POINTS, lastAccrual: Date.now() };
  if (!s.perChat) s.perChat = {};
  return s;
}

function getChatKey() {
  // TODO: getContext()의 실제 채팅 식별자 필드명 확인 (chatId 등 ST 버전마다 다를 수 있음)
  const ctx = getContext();
  return ctx.chatId || ctx.characterId || "default";
}

function getChatData() {
  const s = loadSettings();
  const key = getChatKey();
  if (!s.perChat[key]) {
    s.perChat[key] = {
      house: { current: null, history: [] },
      spaces: {},
      pantry: null,
      fridge: null,
    };
  }
  return s.perChat[key];
}

// ---------------------------------------------------------------
// 1. 포인트 시스템
// ---------------------------------------------------------------

function accruePoints() {
  const s = loadSettings();
  const now = Date.now();
  const elapsed = now - s.points.lastAccrual;
  if (elapsed >= POINT_INTERVAL_MS) {
    const earned = Math.floor(elapsed / POINT_INTERVAL_MS);
    s.points.total += earned;
    s.points.lastAccrual = now; // 남은 잔여시간은 버림 (단순화) — 필요시 나머지 보존 로직으로 교체
    saveSettingsDebounced();
  }
}

function getChatleRoyalPoints() {
  // TODO: 챗틀로얄의 실제 extension_settings 키/필드명 확인 후 교체
  try {
    const cr = extension_settings["chatleroyal"]; // 추정 키
    if (cr && typeof cr.points === "number") return cr.points;
  } catch (e) { /* 챗틀로얄 없음 — 무시 */ }
  return 0;
}

function getTotalPoints() {
  accruePoints();
  const own = loadSettings().points.total;
  return own + getChatleRoyalPoints();
}

function spendPoints(amount) {
  const s = loadSettings();
  accruePoints();
  if (s.points.total >= amount) {
    s.points.total -= amount;
    saveSettingsDebounced();
    return true;
  }
  // 합산 포인트 안에서는 충분하지만 자체 포인트가 부족한 경우는
  // 챗틀로얄 포인트 차감까지 책임지지 않음 (다른 확장 데이터 직접 수정은 위험요소라 보류)
  // TODO: 챗틀로얄과 공식적인 연동 API가 있다면 이 부분 교체
  return false;
}

// ---------------------------------------------------------------
// 2. 컨텍스트 읽기 (최종 조립 프롬프트 전체)
// ---------------------------------------------------------------

async function readFullContext() {
  const ctx = getContext();
  // 챗씨부인에서 쓰던 방식과 동일: quietToLoud로 최종 조립된 프롬프트 텍스트를 얻음
  // TODO: 실제 반환 형태(string vs object) 확인 후 파싱 보강
  const result = await ctx.generateQuietPrompt({ quietPrompt: "", quietToLoud: true });
  return typeof result === "string" ? result : (result?.prompt || result?.text || "");
}

function stripInfoBlocks(text) {
  // 흔한 정보블록 패턴 사전 제거 (보조적 — 프롬프트 가드와 이중 방어)
  // TODO: 실제 사용 중인 정보블록 확장들의 구분자 패턴 확인 후 정규식 보강
  return text
    .replace(/\[STATUS\][\s\S]*?\[\/STATUS\]/gi, "")
    .replace(/<status>[\s\S]*?<\/status>/gi, "");
}

// ---------------------------------------------------------------
// 3. AI 호출
// ---------------------------------------------------------------

async function callAI(promptText) {
  const s = loadSettings();
  // TODO: ConnectionManagerRequestService 실제 사용법(생성자 인자, 메서드명) 확인
  const service = new ConnectionManagerRequestService(s.apiProfile);
  const raw = await service.sendRequest({
    messages: [{ role: "user", content: promptText }],
    max_tokens: 1500,
  });
  return raw;
}

function parseJSON(raw) {
  try {
    const cleaned = String(raw).replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("[챗씨부동산] JSON 파싱 실패:", e, raw);
    return null;
  }
}

// ---------------------------------------------------------------
// 4. 탭1 — 거주지 생성 / 이사가기 / 로어북 export
// ---------------------------------------------------------------

async function classifyWorld(fullContext, userHint) {
  const raw = await callAI(buildWorldClassifyPrompt(fullContext, userHint));
  return parseJSON(raw) || { category: "REALISTIC", subtype: "", location_hint: "" };
}

async function generateHouse(userHint, isMove = false) {
  const fullContext = stripInfoBlocks(await readFullContext());
  const worldClass = await classifyWorld(fullContext, userHint);
  const data = getChatData();

  const prompt = isMove
    ? buildHouseMovePrompt(fullContext, worldClass, data.house.current)
    : buildAddressGeneratePrompt(fullContext, worldClass, userHint);

  const raw = await callAI(prompt);
  const card = parseJSON(raw);
  if (!card) return null;

  card._worldClass = worldClass;
  card._generatedAt = Date.now();

  if (data.house.current) {
    data.house.history.unshift(data.house.current);
  }
  data.house.current = card;
  saveSettingsDebounced();
  return card;
}

async function exportLorebook() {
  const data = getChatData();
  if (!data.house.current) return null;
  const raw = await callAI(buildLorebookExportPrompt(data.house.current));
  return raw;
}

// ---------------------------------------------------------------
// 5. 탭2 — 아이템 풀 생성 / 해금 / 핀 / 교체
// ---------------------------------------------------------------

async function generateItemPool(spaceKey) {
  const space = SPACES.find((s) => s.key === spaceKey);
  const fullContext = stripInfoBlocks(await readFullContext());
  const data = getChatData();
  const worldClass = data.house.current?._worldClass || (await classifyWorld(fullContext, ""));

  const raw = await callAI(buildItemPoolPrompt(fullContext, worldClass, spaceKey, space.label));
  const result = parseJSON(raw);
  if (!result) return null;

  if (result.empty) {
    data.spaces[spaceKey] = { empty: true, emptyReason: result.emptyReason };
  } else {
    const items = result.items.slice(0, ITEM_CAP).map((it) => ({
      ...it,
      unlocked: it.unlockCost === 0,
      pinned: false,
      createdAt: Date.now(),
    }));
    data.spaces[spaceKey] = { empty: false, items };
  }
  saveSettingsDebounced();
  return data.spaces[spaceKey];
}

function unlockItem(spaceKey, idx) {
  const data = getChatData();
  const slot = data.spaces[spaceKey];
  if (!slot || slot.empty) return false;
  const item = slot.items[idx];
  if (!item || item.unlocked) return false;
  if (!spendPoints(item.unlockCost)) return false;
  item.unlocked = true;
  saveSettingsDebounced();
  return true;
}

function togglePin(spaceKey, idx) {
  const data = getChatData();
  const item = data.spaces[spaceKey]?.items?.[idx];
  if (!item) return;
  item.pinned = !item.pinned;
  saveSettingsDebounced();
}

// 스토리 진행으로 새 아이템이 풀에 들어와야 할 때 (가장 오래된 비고정 아이템 교체)
function replaceOldestUnpinned(spaceKey, newItem) {
  const data = getChatData();
  const slot = data.spaces[spaceKey];
  if (!slot || slot.empty) return false;
  const candidates = slot.items
    .map((it, i) => ({ ...it, _idx: i }))
    .filter((it) => !it.pinned)
    .sort((a, b) => a.createdAt - b.createdAt);
  if (!candidates.length) return false; // 전부 고정됨 — 교체 불가
  const targetIdx = candidates[0]._idx;
  slot.items[targetIdx] = {
    ...newItem,
    unlocked: newItem.unlockCost === 0,
    pinned: false,
    createdAt: Date.now(),
  };
  saveSettingsDebounced();
  return true;
}

async function generateFoodList(subtype) {
  // subtype: 'pantry' | 'fridge'
  const fullContext = stripInfoBlocks(await readFullContext());
  const data = getChatData();
  const worldClass = data.house.current?._worldClass || (await classifyWorld(fullContext, ""));
  const raw = await callAI(buildFoodListPrompt(fullContext, worldClass, subtype));
  const result = parseJSON(raw);
  if (!result) return null;
  data[subtype] = result.empty ? { empty: true } : { empty: false, list: result.list };
  saveSettingsDebounced();
  return data[subtype];
}

// ---------------------------------------------------------------
// 6. UI 렌더링
// ---------------------------------------------------------------

function deedRow(label, value) {
  return `<div class="csr-deed-row"><div class="csr-k">${label}</div><div class="csr-v">${value ?? "-"}</div></div>`;
}

function renderDeed(card) {
  if (!card) return `<div class="csr-empty-note">아직 생성된 거주지가 없어요. 위에서 "집 생성하기"를 눌러주세요.</div>`;
  return `
    <div class="csr-deed">
      <h3>${getContext().name2 || "캐릭터"}의 거처</h3>
      <div class="csr-deed-grid">
        ${deedRow("거주형태", card.residenceType)}
        ${deedRow("가격", card.price)}
        ${deedRow("건물유형", card.buildingType)}
        ${deedRow("방·욕실", `${card.rooms ?? "-"}룸 · ${card.bathrooms ?? "-"}욕실`)}
        ${deedRow("구조", card.structureStyle)}
        ${deedRow("마당", card.hasYard ? "있음" : "없음")}
        ${deedRow("차고", card.hasGarage ? "있음" : "없음")}
        ${deedRow("위치", card.location)}
        ${deedRow("주소", card.address)}
        ${deedRow("입주시기", card.moveInDate)}
        ${deedRow("상태", card.status)}
        ${deedRow("인테리어", card.interiorStyle)}
        ${deedRow("리모델링", card.renovation)}
      </div>
      <div class="csr-story-box">
        <div class="csr-story-label">🏷 집 이야기</div>
        <p>${card.story || ""}</p>
      </div>
      <button class="csr-move-btn" id="csr-move-btn">🚚 이사가기</button>
      <button class="csr-lore-btn" id="csr-lore-btn">📋 로어북용 복사</button>
      <div class="csr-toast" id="csr-toast">줄글로 정리해서 복사했어요!</div>
      ${card.appendix?.length ? `
      <details class="csr-accordion">
        <summary>부록 · 추가 자산 / TMI</summary>
        <ul>${card.appendix.map((a) => `<li>${a}</li>`).join("")}</ul>
      </details>` : ""}
    </div>
  `;
}

function renderHistory(history) {
  if (!history?.length) return "";
  return `
    <details class="csr-accordion">
      <summary>거주 이력</summary>
      <ul>${history.map((h) => `<li>${h.location || ""} · ${h.residenceType || ""} (${h.moveInDate || ""})</li>`).join("")}</ul>
    </details>
  `;
}

function renderItemGrid(spaceKey) {
  const data = getChatData();
  const slot = data.spaces[spaceKey];
  if (!slot) return `<div class="csr-empty-note">눌러서 생성해주세요.</div>`;
  if (slot.empty) return `<div class="csr-empty-note">${slot.emptyReason || "이 공간은 이 세계관에 존재하지 않아요."}</div>`;
  return slot.items
    .map((it, idx) => {
      if (!it.unlocked) {
        return `<div class="csr-item-slot csr-locked" data-idx="${idx}" data-action="unlock">
          <div class="csr-emoji">🔒</div><div class="csr-lockcost">${it.unlockCost}P 해금</div>
        </div>`;
      }
      return `<div class="csr-item-slot" data-idx="${idx}" data-action="open">
        <div class="csr-emoji">${it.emoji}</div><div class="csr-label">${it.name}</div>
        ${it.pinned ? '<div class="csr-pin">📌</div>' : ""}
      </div>`;
    })
    .join("");
}

function renderFoodList(subtype) {
  const data = getChatData();
  const slot = data[subtype];
  if (!slot) return `<div class="csr-empty-note">눌러서 불러와주세요.</div>`;
  if (slot.empty) return `<div class="csr-empty-note">이 시대/세계관에는 해당 공간이 없어요.</div>`;
  return slot.list
    .map(
      (f, idx) => `
      <div class="csr-food-row">
        <div class="csr-fname">${f.emoji} ${f.name}</div>
        <div class="csr-fqty">${f.unlockCost > 0
          ? `<span class="csr-flock" data-idx="${idx}" data-subtype="${subtype}">${f.unlockCost}P 해금</span>`
          : f.qty}</div>
      </div>`
    )
    .join("");
}

// 패널 전체 HTML — 실제 마운트는 mountPanel()에서 처리
function panelHTML() {
  const data = getChatData();
  return `
  <div class="csr-app" id="csr-app">
    <div class="csr-appbar"><div class="csr-title" id="csr-title">🏠 챗씨부동산</div></div>
    <div class="csr-tabs">
      <button class="csr-tab-btn csr-active" data-tab="1">거주지</button>
      <button class="csr-tab-btn" data-tab="2">소지품</button>
    </div>

    <div class="csr-panel" id="csr-panel1">
      <div class="csr-chip-row-cat" id="csr-cat-row">
        ${["자동감지", "현실", "판타지", "시대극", "메이저IP"]
          .map((c, i) => `<div class="csr-chip-cat ${i === 0 ? "csr-active" : ""}" data-cat="${c}">${c}</div>`)
          .join("")}
      </div>
      <input class="csr-ref-input" id="csr-ref-input" placeholder="예: 뉴욕 맨하탄 · 조선 한성 · 해리포터-런던 · 비워두면 자동">
      <button class="csr-generate-btn" id="csr-generate-btn">집 생성하기</button>
      <div id="csr-deed-container">${renderDeed(data.house.current)}</div>
      ${renderHistory(data.house.history)}
    </div>

    <div class="csr-panel csr-hidden" id="csr-panel2">
      <div id="csr-tab2-main">
        <div class="csr-chip-row" id="csr-chip-row">
          ${SPACES.map((s, i) => `<div class="csr-chip ${i === 3 ? "csr-active" : ""}" data-space="${s.key}">${s.emoji} ${s.label}</div>`).join("")}
        </div>
        <div class="csr-kitchen-extra csr-hidden" id="csr-kitchen-extra">
          <button id="csr-pantry-btn">🥫 팬트리 보기</button>
          <button id="csr-fridge-btn">🧊 냉장고 보기</button>
        </div>
        <div class="csr-points-bar"><span class="csr-label">보유 포인트</span><span class="csr-pts" id="csr-pts">${getTotalPoints()} P</span></div>
        <div class="csr-item-grid" id="csr-item-grid">${renderItemGrid("bedroom")}</div>
      </div>
      <div class="csr-food-subview csr-hidden" id="csr-food-subview">
        <div class="csr-subview-header">
          <button class="csr-back-btn" id="csr-back-btn">‹ 뒤로</button>
          <div class="csr-subview-title" id="csr-subview-title">팬트리</div>
          <div class="csr-subview-toggle">
            <button id="csr-sv-pantry">팬트리</button>
            <button id="csr-sv-fridge">냉장고</button>
          </div>
        </div>
        <div class="csr-food-list" id="csr-food-list"></div>
      </div>
    </div>
  </div>
  <div class="csr-modal-overlay csr-hidden" id="csr-modal">
    <div class="csr-modal-card">
      <div class="csr-brand" id="csr-modal-brand"></div>
      <div class="csr-price" id="csr-modal-price"></div>
      <div class="csr-tmi" id="csr-modal-tmi"></div>
      <button class="csr-pinbtn" id="csr-modal-pin">📌 고정하기</button>
      <button class="csr-closebtn" id="csr-modal-close">닫기</button>
    </div>
  </div>
  `;
}

// ---------------------------------------------------------------
// 7. 이벤트 바인딩
// ---------------------------------------------------------------

let currentSpace = "bedroom";
let currentModal = { space: null, idx: null };
let currentCategory = "자동감지";

function bindEvents($root) {
  // 탭 전환
  $root.find(".csr-tab-btn").on("click", function () {
    const n = $(this).data("tab");
    $root.find(".csr-tab-btn").removeClass("csr-active");
    $(this).addClass("csr-active");
    $root.find("#csr-panel1").toggleClass("csr-hidden", n !== 1);
    $root.find("#csr-panel2").toggleClass("csr-hidden", n !== 2);
    $root.find("#csr-app").toggleClass("csr-cute", n === 2);
    $root.find("#csr-title").text(n === 1 ? "🏠 챗씨부동산" : "🧳 소지품");
  });

  // 세계관 카테고리 칩
  $root.find(".csr-chip-cat").on("click", function () {
    $root.find(".csr-chip-cat").removeClass("csr-active");
    $(this).addClass("csr-active");
    currentCategory = $(this).data("cat");
  });

  // 집 생성하기
  $root.find("#csr-generate-btn").on("click", async function () {
    $(this).prop("disabled", true).text("생성 중...");
    const hint = $root.find("#csr-ref-input").val();
    const card = await generateHouse(hint, false);
    $root.find("#csr-deed-container").html(renderDeed(card));
    $(this).prop("disabled", false).text("집 생성하기");
    rebindDeedButtons($root);
  });

  rebindDeedButtons($root);

  // 공간 칩
  $root.find(".csr-chip").on("click", async function () {
    $root.find(".csr-chip").removeClass("csr-active");
    $(this).addClass("csr-active");
    currentSpace = $(this).data("space");
    closeFoodSubview($root);
    const isKitchen = currentSpace === "kitchen";
    $root.find("#csr-kitchen-extra").toggleClass("csr-hidden", !isKitchen);
    $root.find("#csr-item-grid").toggleClass("csr-hidden", isKitchen);
    if (!isKitchen) {
      const data = getChatData();
      if (!data.spaces[currentSpace]) await generateItemPool(currentSpace);
      $root.find("#csr-item-grid").html(renderItemGrid(currentSpace));
      bindItemGrid($root);
    }
  });

  $root.find("#csr-pantry-btn").on("click", () => openFoodSubview($root, "pantry"));
  $root.find("#csr-fridge-btn").on("click", () => openFoodSubview($root, "fridge"));
  $root.find("#csr-sv-pantry").on("click", () => openFoodSubview($root, "pantry"));
  $root.find("#csr-sv-fridge").on("click", () => openFoodSubview($root, "fridge"));
  $root.find("#csr-back-btn").on("click", () => closeFoodSubview($root));

  $root.find("#csr-modal-close").on("click", () => $root.find("#csr-modal").addClass("csr-hidden"));
  $root.find("#csr-modal-pin").on("click", function () {
    togglePin(currentModal.space, currentModal.idx);
    $root.find("#csr-item-grid").html(renderItemGrid(currentModal.space));
    bindItemGrid($root);
    $root.find("#csr-modal").addClass("csr-hidden");
  });

  bindItemGrid($root);
}

function rebindDeedButtons($root) {
  $root.find("#csr-move-btn").off("click").on("click", async function () {
    $(this).prop("disabled", true).text("이사 중...");
    const card = await generateHouse($root.find("#csr-ref-input").val(), true);
    $root.find("#csr-deed-container").html(renderDeed(card));
    $(this).prop("disabled", false);
    rebindDeedButtons($root);
  });
  $root.find("#csr-lore-btn").off("click").on("click", async function () {
    const text = await exportLorebook();
    if (!text) return;
    try { await navigator.clipboard.writeText(text); } catch (e) { /* 클립보드 권한 없음 */ }
    const toast = $root.find("#csr-toast");
    toast.addClass("csr-show");
    setTimeout(() => toast.removeClass("csr-show"), 1800);
  });
}

function bindItemGrid($root) {
  $root.find("#csr-item-grid .csr-item-slot").off("click").on("click", async function () {
    const idx = $(this).data("idx");
    const action = $(this).data("action");
    if (action === "unlock") {
      const ok = unlockItem(currentSpace, idx);
      if (ok) {
        $root.find("#csr-item-grid").html(renderItemGrid(currentSpace));
        $root.find("#csr-pts").text(`${getTotalPoints()} P`);
        bindItemGrid($root);
      }
    } else {
      const data = getChatData();
      const item = data.spaces[currentSpace].items[idx];
      currentModal = { space: currentSpace, idx };
      $root.find("#csr-modal-brand").text(item.brand);
      $root.find("#csr-modal-price").text(item.price);
      $root.find("#csr-modal-tmi").text(item.tmi);
      $root.find("#csr-modal-pin").text(item.pinned ? "📌 고정 해제" : "📌 고정하기");
      $root.find("#csr-modal").removeClass("csr-hidden");
    }
  });
}

async function openFoodSubview($root, subtype) {
  $root.find("#csr-tab2-main").addClass("csr-hidden");
  $root.find("#csr-food-subview").removeClass("csr-hidden");
  $root.find("#csr-subview-title").text(subtype === "pantry" ? "팬트리" : "냉장고");
  $root.find("#csr-sv-pantry, #csr-sv-fridge").removeClass("csr-active");
  $root.find(subtype === "pantry" ? "#csr-sv-pantry" : "#csr-sv-fridge").addClass("csr-active");

  const data = getChatData();
  if (!data[subtype]) await generateFoodList(subtype);
  $root.find("#csr-food-list").html(renderFoodList(subtype));

  $root.find(`.csr-flock[data-subtype="${subtype}"]`).off("click").on("click", function () {
    const idx = $(this).data("idx");
    const item = getChatData()[subtype].list[idx];
    if (spendPoints(item.unlockCost)) {
      item.unlockCost = 0;
      saveSettingsDebounced();
      $root.find("#csr-food-list").html(renderFoodList(subtype));
    }
  });
}

function closeFoodSubview($root) {
  $root.find("#csr-food-subview").addClass("csr-hidden");
  $root.find("#csr-tab2-main").removeClass("csr-hidden");
}

// ---------------------------------------------------------------
// 8. 설정 패널 (API 프로필 선택 / 전체 초기화)
// ---------------------------------------------------------------

function renderSettingsPanel() {
  const s = loadSettings();
  return `
    <div class="csr-settings-row">
      <label>API 프로필</label>
      <select id="csr-api-profile">
        <!-- TODO: ConnectionManager에 등록된 프로필 목록으로 옵션 채우기 -->
        <option value="">기본 프로필 사용</option>
      </select>
    </div>
    <div class="csr-settings-row">
      <label>보유 포인트: ${getTotalPoints()} P</label>
      <button class="csr-reset-btn" id="csr-reset-btn">전체 초기화</button>
    </div>
  `;
}

function bindSettingsPanel($root) {
  const s = loadSettings();
  $root.find("#csr-api-profile").val(s.apiProfile || "").on("change", function () {
    s.apiProfile = $(this).val();
    saveSettingsDebounced();
  });
  $root.find("#csr-reset-btn").on("click", function () {
    if (!confirm("챗씨부동산의 모든 데이터를 초기화할까요? (포인트, 거주지, 소지품 전부 삭제)")) return;
    extension_settings[MODULE_NAME] = defaultSettings();
    saveSettingsDebounced();
    location.reload(); // TODO: 더 부드러운 방식(패널 재마운트)으로 교체 가능
  });
}

// ---------------------------------------------------------------
// 9. 마운트
// ---------------------------------------------------------------

function mountPanel() {
  // TODO: 실제 ST 확장 패널 마운트 지점 확인 (extensions 메뉴 버튼 + 플로팅 패널 등)
  // 임시: #extensions_settings 영역에 직접 삽입
  const $container = $("#extensions_settings2").length ? $("#extensions_settings2") : $("#extensions_settings");
  const $wrapper = $('<div id="csr-root"></div>').html(panelHTML());
  $container.append($wrapper);
  bindEvents($wrapper);

  const $settingsWrapper = $('<div id="csr-settings-root"></div>').html(renderSettingsPanel());
  $container.append($settingsWrapper);
  bindSettingsPanel($settingsWrapper);
}

jQuery(async () => {
  loadSettings();
  accruePoints();
  mountPanel();
});
