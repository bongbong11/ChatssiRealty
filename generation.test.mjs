import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load = async file => import('data:text/javascript;base64,' + readFileSync(new URL(file, import.meta.url)).toString('base64'));
const { rememberItems, planBatch, selectUnique, finalizeBatch } = await load('./generation.js');
const { buildItemPoolPrompt, buildFoodListPrompt, buildDiscoveryCheckPrompt } = await load('./prompts.js');

const pins = Array.from({ length: 9 }, (_, i) => ({ name: `pin ${i}`, unlockCost: i < 4 ? 10 : 0 }));
assert.deepEqual(planBatch(12, pins, 5), { total: 12, count: 3, specialCount: 1 });
assert.deepEqual(planBatch(10, pins, 3), { total: 10, count: 1, specialCount: 0 });
assert.equal(planBatch(10, Array.from({ length: 10 }, () => ({})), 3).count, 0);

const data = {};
rememberItems(data, [{ name: 'Electric guitar', conceptKey: 'guitar' }]);
const candidates = [
    { name: 'Blue electric guitar', conceptKey: 'guitar', unlockCost: 10, tmi: 'Story' },
    { name: 'Desk lamp', conceptKey: 'lamp', unlockCost: 10, tmi: 'Story' },
    { name: 'Another lamp', conceptKey: 'lamp', unlockCost: 10, tmi: 'Story' },
    { name: 'Mug', conceptKey: 'mug', unlockCost: 10, tmi: 'Story' },
];
const selected = selectUnique(candidates, data.generationHistory, 2);
assert.deepEqual(selected.map(it => it.name), ['Desk lamp', 'Mug']);
assert.deepEqual(finalizeBatch(selected, 1).map(it => it.unlockCost), [10, 0]);
for (let i = 0; i < 110; i++) rememberItems(data, [{ name: `item ${i}`, conceptKey: `key ${i}` }]);
assert.equal(data.generationHistory.length, 96);

const world = { category: 'FANTASY', subtype: 'altered Earth' };
const room = buildItemPoolPrompt('', world, 'bedroom', 'Bedroom', 'en', {
    count: 3, specialCount: 1, pinnedItems: pins, excludedItems: data.generationHistory,
});
assert.match(room, /NEW item count: exactly 3\. NEW special count: exactly 1/);
assert.match(room, /altered-Earth settings may retain real brands/);
const food = buildFoodListPrompt('', world, 'fridge', 'en', {
    count: 1, specialCount: 0, pinnedItems: pins,
});
assert.match(food, /NEW item count: exactly 1\. NEW special count: exactly 0/);
const discovery = buildDiscoveryCheckPrompt('chat', world, '', '', '', [{ name: 'Mug', conceptKey: 'mug' }], '', 'en');
assert.match(discovery, /Default to \{"triggered":false\}/);
assert.match(discovery, /conceptKey/);
console.log('generation tests passed');
