const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('../packager/node_modules/jsdom');

const source = fs.existsSync('features/traitSetLabels.js')
    ? fs.readFileSync('features/traitSetLabels.js', 'utf8') : '() => {}';
const groups = {
    Forest: ['Woodcutting', 'Farming', 'Alchemy', 'Exploring', 'Ranged', 'Defense'],
    Mountain: ['Mining', 'Smelting', 'Smithing', 'Delving', 'One-handed', 'Defense'],
    Ocean: ['Enchanting', 'Fishing', 'Cooking', 'Imbuing', 'Two-handed', 'Defense']
};
const skills = [...new Set([...Object.values(groups).flat(), 'Health'])]
    .map((displayName, id) => ({ id, displayName }));
const regionalSets = Object.entries(groups).map(([name, members]) => ({
    name, skills: skills.filter(s => members.includes(s.displayName)).map(s => s.id)
}));
const sets = [...regionalSets,
    { name: 'All', skills: skills.map(s => s.id) },
    { name: 'Gathering', skills: regionalSets[0].skills },
    { name: 'Other', skills: [skills.find(s => s.displayName === 'Health').id] }
];
const row = name => `<button class="row"><span class="image">🌲</span><span class="title">${name} XP</span><span class="effect">+20.29%</span><span class="level">Lv. 103</span></button>`;
const page = () => `<traits-page><div class="groups"><div class="first"><div class="card"><div class="header"><span class="name">Equipped</span></div>${row('Defense')}</div></div><div class="last"><div class="card"><div class="header"><span class="name">Traits</span></div>${skills.map(s => row(s.displayName)).join('')}${row('Miningology')}</div></div></div></traits-page>`;
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
function setup(html = page()) {
    const dom = new JSDOM(`<body>${html}</body>`);
    let config, handler;
    let current = { type: 'traits', menu: 'traits' };
    const context = vm.createContext({ document: dom.window.document, MutationObserver: dom.window.MutationObserver });
    vm.runInContext(`(${source})`, context)(
        { registerCheckbox: item => { config = item; item.handler(item.default); } },
        { register: (_, fn) => { handler = fn; fn(current); }, getLast: () => current },
        { list: skills }, { list: sets, byName: Object.fromEntries(sets.map(set => [set.name, set])) },
        { addStyles: css => { const style = dom.window.document.createElement('style'); style.textContent = css; dom.window.document.head.append(style); } }
    );
    return { dom, document: dom.window.document, config, navigate: value => { current = value; handler(value); } };
}

test('labels match cache membership, exclude Equipped and unrelated skills, and preserve title/level', async () => {
    const { dom, document, config } = setup();
    await settle();
    assert.equal(config?.name, 'Show Skill Set Labels');
    assert.equal(config.category, 'Traits');
    assert.equal(config.default, true);
    const rows = [...document.querySelectorAll('.last button.row')];
    for (const [i, skill] of skills.entries()) {
        const expected = skill.displayName === 'Defense' ? 'All Sets' : regionalSets.find(set => set.skills.includes(skill.id))?.name;
        const label = rows[i].querySelector('.trait-set-label');
        assert.equal(label?.textContent, expected);
        if (label) assert.equal(label.nextElementSibling.className, 'level');
        assert.equal(rows[i].querySelector('.title').textContent, `${skill.displayName} XP`);
        assert.equal(rows[i].querySelector('.level').textContent, 'Lv. 103');
    }
    assert.equal(rows.at(-1).querySelector('.trait-set-label'), null);
    assert.equal(document.querySelector('.first .trait-set-label'), null);
    dom.window.close();
});

test('toggle, sorting/filtering, text reuse, replacement, and navigation remain idempotent', async () => {
    const { dom, document, config, navigate } = setup();
    await settle();
    const card = document.querySelector('.last .card');
    const rows = [...card.querySelectorAll('button')];
    rows.reverse().forEach(button => card.append(button));
    rows[0].style.display = 'none';
    await settle();
    const count = document.querySelectorAll('.trait-set-label').length;
    assert.equal(count, 16);
    let mutations = 0;
    const observer = new dom.window.MutationObserver(records => mutations += records.length);
    observer.observe(document.body, { childList: true, subtree: true });
    await settle();
    assert.equal(mutations, 0, 'observers settle without feedback');
    const button = rows.find(button => button.querySelector('.title').textContent.startsWith('Woodcutting '));
    button.querySelector('.title').firstChild.data = 'Mining XP ';
    await settle();
    assert.equal(button.querySelector('.trait-set-label').textContent, 'Mountain');
    document.querySelector('.first .card').append(button);
    await settle();
    assert.equal(button.querySelector('.trait-set-label'), null);
    config.handler(false);
    assert.equal(document.querySelectorAll('.trait-set-label').length, 0);
    config.handler(true);
    await settle();
    assert.equal(document.querySelectorAll('.trait-set-label').length, count - 1);
    document.querySelector('traits-page').outerHTML = page();
    await settle();
    assert.equal(document.querySelectorAll('.trait-set-label').length, count);
    navigate({ type: 'marks', menu: 'skill marks' });
    assert.equal(document.querySelectorAll('.trait-set-label').length, 0);
    navigate({ type: 'traits', menu: 'traits' });
    await settle();
    assert.equal(document.querySelectorAll('.trait-set-label').length, count);
    observer.disconnect();
    dom.window.close();
});

test('page arriving after the navigation event receives labels', async () => {
    const { dom, document } = setup('');
    document.body.innerHTML = page();
    await settle();
    assert.equal(document.querySelectorAll('.trait-set-label').length, 16);
    dom.window.close();
});

test('actual traitFilter sorting/filtering observer cooperates with labels', async () => {
    const { dom, document, navigate } = setup();
    const $ = require('../packager/node_modules/jquery')(dom.window);
    // jsdom has no layout; give jQuery's visibility selector a display-based equivalent.
    $.expr.pseudos.visible = element => element.style.display !== 'none';
    $.expr.pseudos.hidden = element => element.style.display === 'none';
    let config, sort, blueprint;
    const context = vm.createContext({ document, MutationObserver: dom.window.MutationObserver, $ });
    vm.runInContext(`(${fs.readFileSync('features/traitFilter.js', 'utf8')})`, context)(
        { register: (_, handler) => { sort = handler; }, getLast: () => ({ type: 'traits', menu: 'traits' }) },
        { exists: async () => document.querySelector('traits-page') },
        { registerCheckbox: item => { config = item; } },
        { search: (value) => value.tabs[0].rows[0], addComponent: value => { blueprint = value; } },
        { getVariousEntry: async () => 'Name Desc', saveVariousEntry: () => {} },
        { addStyles: () => {} }, value => value,
        { list: skills.map(skill => ({ ...skill, type: skill.displayName === 'Woodcutting' ? 'Gathering' : 'Combat' })) }
    );
    await settle();
    config.handler(true);
    await sort({ type: 'traits', menu: 'traits' });
    await settle();
    let rows = [...document.querySelectorAll('.last button.row')];
    assert.equal(rows[0].querySelector('.title').textContent, 'Woodcutting XP');
    assert.equal(document.querySelectorAll('.trait-set-label').length, 16);
    blueprint.tabs[0].rows[0].action('Only Gathering');
    await settle();
    rows = [...document.querySelectorAll('.last button.row')];
    assert.equal(rows.filter(row => row.style.display !== 'none').length, 1);
    assert.equal(document.querySelectorAll('.trait-set-label').length, 16);
    let mutations = 0;
    const observer = new dom.window.MutationObserver(records => mutations += records.length);
    observer.observe(document.body, { childList: true, subtree: true });
    await settle();
    assert.equal(mutations, 0, 'both modules settle without an observer loop');
    observer.disconnect();
    navigate({ type: 'marks', menu: 'skill marks' });
    await sort({ type: 'marks', menu: 'skill marks' });
    dom.window.close();
});

test('distributed userscript registers the same standalone module', () => {
    const registrations = new Map();
    const context = vm.createContext({ window: {
        moduleRegistry: { add: (name, fn) => registrations.set(name, fn), build: () => {} }
    } });
    vm.runInContext(fs.readFileSync('plugin.js', 'utf8'), context);
    assert.equal(registrations.get('traitSetLabels')?.toString(), source.trim());
});
