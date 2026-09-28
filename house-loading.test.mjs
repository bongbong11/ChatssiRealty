import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the actual tab handlers with a deferred generation request and a minimal DOM.
const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
    .replace(/^import [^\n]+\n/m, '')
    .replace(/^import \{[\s\S]*?\} from '\.\/prompts\.js';\s*/m, '')
    .replace(/^import \{[^\n]+\} from '\.\/generation\.js';\s*/m, '')
    .replace('export async function onActivate()', 'async function onActivate()')
    .replace(/jQuery\(async \(\) => \{[\s\S]*$/, '');

async function runScenario(tabAtCompletion) {
    let resolveRequest;
    const pending = new Promise(resolve => { resolveRequest = resolve; });
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, { disabled: false, innerHTML: '', value: '', handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; } });
        return elements.get(id);
    };
    const appContext = { extensionSettings: {}, characters: [{ avatar: 'a' }], characterId: 0 };
    const sandbox = {
        window: {}, structuredClone, console, Map,
        SillyTavern: { getContext: () => appContext },
        document: { getElementById: id => elements.get(id) || null, querySelectorAll: () => [] },
        toastr: { error() {}, success() {} },
        pending,
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    let renderCount = 0;
    sandbox.onRender = () => { renderCount++; };
    vm.runInContext('generateHouse = async () => { await pending; return {}; }; renderBody = () => onRender(); state.isPanelOpen = true; state.currentTab = "house";', sandbox);
    element('csr-generate-btn'); element('csr-ref-input'); element('csr-deed-container'); element('csr-content');
    vm.runInContext('bindHouseTab()', sandbox);
    const button = element('csr-generate-btn');
    const first = button.handlers.click({ currentTarget: button });
    assert.match(element('csr-deed-container').innerHTML, /csr-moving-truck/);
    assert.match(vm.runInContext('renderHouseTab()', sandbox), /짐을 싣고 새 집으로 가는 중/);
    button.disabled = false; // Simulate the tab rebuilding the button mid-request.
    await button.handlers.click({ currentTarget: button });
    assert.equal(vm.runInContext('houseLoadingByChar.size', sandbox), 1);
    vm.runInContext(`state.currentTab = ${JSON.stringify(tabAtCompletion)}`, sandbox);
    resolveRequest();
    await first;
    assert.equal(vm.runInContext('houseLoadingByChar.size', sandbox), 0);
    assert.equal(renderCount, tabAtCompletion === 'house' ? 1 : 0);
}

await runScenario('items');
await runScenario('house');
console.log('house loading tab scenarios passed');
