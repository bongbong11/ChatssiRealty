import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
    .replace(/^import [^\n]+\n/m, '')
    .replace(/^import \{[\s\S]*?\} from '\.\/prompts\.js';\s*/m, '')
    .replace(/^import \{[^\n]+\} from '\.\/generation\.js';\s*/m, '')
    .replace('export async function onActivate()', 'async function onActivate()')
    .replace(/jQuery\(async \(\) => \{[\s\S]*$/, '');
const credited = [];
const frameWindow = { postMessage: message => credited.push(message) };
const frame = { contentWindow: frameWindow };
const extensionSettings = { chatssi_realestate: { points: 100, lifetimePoints: 100,
    lastRefillAt: Date.now(), rouletteLastSpinAt: Date.now() } };
const app = { extensionSettings, saveSettingsDebounced() {}, characters: [], characterId: 0 };
const sandbox = {
    window: { location: { origin: 'https://example.test' } },
    document: { querySelector: () => frame },
    SillyTavern: { getContext: () => app },
    toastr: { success() {}, warning() {} },
    structuredClone, console, Map, Set, Date, Math,
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
vm.runInContext('refreshHeaderPoints = () => {}', sandbox);
// Call with the actual host window/source identity, then check duplicate and spoofed messages.
const rewardEvent = { source: frameWindow, origin: 'https://example.test',
    data: { source: 'st-mini-games', type: 'reward', version: 1,
        game: 'slide', achievement: 'complete', eventId: 'round-1' } };
sandbox.rewardEvent = rewardEvent;
vm.runInContext('handleMinigameReward(rewardEvent)', sandbox);
vm.runInContext('handleMinigameReward(rewardEvent)', sandbox);
assert.equal(extensionSettings.chatssi_realestate.points, 110);
assert.equal(credited.length, 1);
assert.equal(extensionSettings.chatssi_realestate.pointHistory[0].delta, 10);
assert.equal(extensionSettings.chatssi_realestate.pointHistory[0].label, '슬라이드 퍼즐 완성');
sandbox.rewardEvent = { ...rewardEvent, source: {}, data: { ...rewardEvent.data, eventId: 'round-2' } };
vm.runInContext('handleMinigameReward(rewardEvent)', sandbox);
assert.equal(extensionSettings.chatssi_realestate.points, 110);

const first = vm.runInContext('spinRoulette(10)', sandbox);
const second = vm.runInContext('spinRoulette(10)', sandbox);
assert.equal(first.error, undefined);
assert.equal(second.error, undefined, 'An old spin timestamp must not impose a cooldown');
assert.equal(extensionSettings.chatssi_realestate.pointHistory.length, 3);
assert.equal(extensionSettings.chatssi_realestate.pointHistory[1].delta,
    first.outcome.pct < 0 ? -10 : Math.round(first.bet * first.outcome.pct / 100));
vm.runInContext("spendPoints(5, '테스트 잠금 해제')", sandbox);
assert.equal(extensionSettings.chatssi_realestate.pointHistory.at(-1).delta, -5);
assert.equal(extensionSettings.chatssi_realestate.pointHistory.at(-1).label, '테스트 잠금 해제');
console.log('roulette and point bridge passed');
