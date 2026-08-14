// The fine print. The board where the corpus is readable by a person rather than by a lane.
//
// In 2013 the owner went through his filing cabinet, found every reference to an Act in the fine
// print of his own life, downloaded them and read them. Between fifty-five and sixty instruments.
// data/legislation.json is that read done again against the current consolidations, and
// src/systems/civic/legislation.js works out which of them bind a particular islander and why. This
// is where you look at it.
//
// FIVE SURFACES, AND THE ORDER IS THE ARGUMENT.
//
//   The weight     what sixty-six Acts actually amount to, measured, with the spread across the
//                  island rather than one number for everybody.
//   Right now      who on this island is inside one of these Acts at this moment, because a road
//                  rule is doing nothing at three in the morning and everything at ten past eight.
//   One person     a resident, the events of their life that the pack names, the Acts that follow,
//                  and why each one follows. Then two of them side by side, which is the only way
//                  to see that the weight is not the same weight.
//   The edges      Magna Carta, a United States financing statement, a treaty, and two arguments a
//                  Queensland court has already decided. This is the part somebody arrives holding.
//   Every Act      all sixty-six, filterable, with the citation and a link to the register.
//
// THE LINE THAT NEVER LEAVES THE SCREEN. data/legislation.json carries a not_advice line and says
// where it must show: on every screen that names an instrument, beside the citation, not behind a
// menu and not in a footer a reader can scroll past. So it sits in the header of this board, always
// mounted, on every tab, and the pack's own sentence is used rather than a paraphrase.
//
// WHAT THIS BOARD MUST NEVER DO. It must never read as advice, it must never tell a person what
// their position is, and it must never present a generated resident as a real one. The people are
// invented and the panel says so wherever a person is named. The Acts are real, measured from the
// published consolidations, and every number here can be followed to a register.

import { registerPanel, el } from '../mount.js';

function rail() {
  let r = document.getElementById('twin-rail');
  if (r) return r;
  r = el('div', { id: 'twin-rail' });
  document.getElementById('ui-root').append(r);
  return r;
}

const n0 = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-AU') : '0');
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

const BEARING_TONE = {
  mostly_protects: 'leaf', mostly_requires: 'coral', both: 'sea', machinery: 'iron'
};
const EDGE_TONE = {
  partially_in_force: 'sand', foreign_domestic: 'iron',
  treaty_unincorporated: 'heath', asserted_rejected: 'coral'
};

registerPanel({
  id: 'legislation',
  order: 47,
  mount(root, world) { return mountLegislation(root, world); }
});

function mountLegislation(root, world) {
  injectStyle();

  const launcher = el('button', {
    class: 'btn rail-btn', type: 'button', title: 'The fine print (x)', onclick: () => toggle()
  }, 'Fine print');
  rail().append(launcher);

  const scrim = el('div', { class: 'lg-scrim', onclick: () => toggle(false) });
  const board = el('section', {
    class: 'panel lg-board', role: 'dialog', 'aria-modal': 'true', tabindex: '-1', 'aria-label': 'The fine print'
  });
  root.append(scrim, board);

  const notAdvice = el('div', { class: 'lg-notadvice' });
  const head = el('div', { class: 'lg-top' },
    el('div', {},
      el('h2', {}, 'The fine print'),
      el('div', { class: 'lg-sub' },
        'Every Act an ordinary person on this island is subject to, measured from the published '
        + 'consolidation rather than described from memory, and joined to the life a particular '
        + 'islander is actually living.')),
    el('button', { class: 'btn ghost', type: 'button', title: 'Close (Esc)', onclick: () => toggle(false) }, 'Close'));

  const TABS = [
    { id: 'weight', label: 'The weight' },
    { id: 'now', label: 'Right now' },
    { id: 'person', label: 'One person' },
    { id: 'edges', label: 'The edges' },
    { id: 'acts', label: 'Every Act' }
  ];
  let tab = 'weight';
  const tabRow = el('div', { class: 'lg-tabs', role: 'tablist' });
  const tabBtn = {};
  for (const t of TABS) {
    tabBtn[t.id] = el('button', {
      class: 'btn ghost', type: 'button', role: 'tab',
      onclick: () => { tab = t.id; paintTabs(); render(); }
    }, t.label);
    tabRow.append(tabBtn[t.id]);
  }
  const body = el('div', { class: 'lg-body scroll' });
  board.append(head, notAdvice, tabRow, body);

  function paintTabs() {
    for (const t of TABS) {
      tabBtn[t.id].classList.toggle('on', t.id === tab);
      tabBtn[t.id].setAttribute('aria-selected', t.id === tab ? 'true' : 'false');
    }
  }
  paintTabs();

  /* ---- open and close ---------------------------------------------------- */

  let open = false;
  function toggle(force) {
    open = force === undefined ? !open : !!force;
    scrim.classList.toggle('on', open);
    board.classList.toggle('on', open);
    launcher.classList.toggle('on', open);
    if (open) {
      world.bus.emit('ui:drawer', { id: 'legislation' });
      render();
      board.focus({ preventScroll: true });
    }
  }
  world.bus.on('ui:drawer', (p) => { if (p && p.id !== 'legislation' && open) toggle(false); });
  world.bus.on('ui:open', (p) => {
    if (!p || p.id !== 'legislation') return;
    if (p.tab) tab = p.tab;
    if (p.personId) { personA = p.personId; tab = p.tab || 'person'; }
    paintTabs();
    toggle(true);
  });

  const TYPING = { INPUT: 1, TEXTAREA: 1, SELECT: 1 };
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && TYPING[e.target.tagName]) return;
    if (e.code === 'Escape' && open) { toggle(false); e.preventDefault(); }
    else if (e.code === 'KeyX') { toggle(); e.preventDefault(); }
  });

  /* ---- state the reader controls ----------------------------------------- */

  let personA = null;
  let personB = null;
  let openEdge = null;
  const F = { event: 'all', jurisdiction: 'all', bearing: 'all', query: '' };

  function L() { return world.read('legislation'); }
  function pack() { return (world.data && world.data.legislation) || null; }

  /* ================================================================ rendering */

  function render() {
    if (!open) return;
    const s = L();
    notAdvice.textContent = (s && s.notAdvice)
      || 'This is a description of published law, not advice.';
    body.replaceChildren();
    if (!s || !s.ready) {
      body.append(el('p', { class: 'lg-p' }, 'The legislation pack has not finished loading.'));
      return;
    }
    if (tab === 'weight') paintWeight(s);
    else if (tab === 'now') paintNow(s);
    else if (tab === 'person') paintPerson(s);
    else if (tab === 'edges') paintEdges(s);
    else paintActs(s);
  }

  /* ---- the weight -------------------------------------------------------- */

  function paintWeight(s) {
    const t = s.totals;
    const p = pack();
    body.append(
      el('div', { class: 'lg-figures' },
        figure(n0(t.instruments), 'Acts in this pack', 'Every one verified against its register and measured from its own consolidation.'),
        figure(n0(t.pages), 'pages', `A stack about ${t.stackMetres} m high, ${t.stackNote}.`),
        figure(n0(t.provisions), 'numbered provisions', 'Counted from each Act\'s own table of contents.'),
        figure(`${t.byJurisdiction.Commonwealth || 0} / ${t.byJurisdiction.Queensland || 0}`, 'Commonwealth / Queensland',
          'Two parliaments, two registers, one person underneath both.')),

      section('Which way it falls',
        el('div', { class: 'lg-bars' }, ...(p.bearing_scale || []).map((b) => bar(b, t.byBearing[b.key] || 0, t.instruments))),
        note('Mostly gives and mostly asks are judgements written against each Act and marked as '
          + 'judgements in the pack. They are not a score and they do not add up to a verdict.')),

      section('And it is not the same weight for everybody',
        s.people
          ? el('div', {},
            el('p', { class: 'lg-lede' },
              `The median adult on this island is inside ${n0(s.people.medianPages)} pages of it.`),
            el('div', { class: 'lg-two' },
              personCard('Lightest', s.people.lightest),
              personCard('Heaviest', s.people.heaviest)),
            note(s.people.note))
          : el('p', { class: 'lg-p' }, 'The island-wide pass has not finished yet.')),

      section('What is left out, and said so',
        el('ul', { class: 'lg-list' },
          ...(p.left_out || []).slice(0, 4).map((x) => el('li', {}, el('b', {}, x.what), ' ', el('span', {}, x.why))),
          ...(p.provisions_not_confirmed || []).length
            ? [el('li', {}, el('b', {}, `${p.provisions_not_confirmed.length} named provision(s) dropped`),
              ' ', el('span', {}, 'the lane could not confirm the number against the Act\'s own contents, so it was not published.'))]
            : [])),

      section('Where these came from',
        el('div', { class: 'lg-two' },
          ...Object.entries((p.method && p.method.registers) || {}).map(([k, r]) => el('div', { class: 'lg-card' },
            el('b', {}, r.label), el('span', {}, r.publisher), el('em', {}, r.licence_note)))),
        note(p.method.what_is_not_here))
    );
  }

  function figure(value, label, sub) {
    return el('div', { class: 'lg-fig' },
      el('b', {}, value), el('span', {}, label), el('em', {}, sub));
  }

  function bar(b, count, total) {
    const pct = total ? Math.round((100 * count) / total) : 0;
    return el('div', { class: 'lg-bar' },
      el('div', { class: 'lg-bar-h' }, el('b', {}, b.label), el('i', {}, `${count} of ${total}`)),
      el('div', { class: 'lg-bar-t' }, el('div', { class: `lg-bar-f t-${BEARING_TONE[b.key] || 'sea'}`, style: { width: `${pct}%` } })),
      el('span', { class: 'lg-bar-m' }, b.meaning));
  }

  function personCard(title, who) {
    if (!who) return el('div', { class: 'lg-card' }, el('b', {}, title), el('span', {}, 'not measured yet'));
    return el('div', {
      class: 'lg-card click', role: 'button', tabindex: '0',
      onclick: () => { personA = who.id; tab = 'person'; paintTabs(); render(); },
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); personA = who.id; tab = 'person'; paintTabs(); render(); } }
    },
    el('b', {}, `${title}: ${n0(who.pages)} pages`),
    el('span', {}, `${who.name}, ${who.occupation}, ${who.tenure}`),
    el('em', {}, `${who.count} Acts. Open them.`));
  }

  /* ---- right now --------------------------------------------------------- */

  let liveNodes = null;

  function paintNow(s) {
    const p = pack();
    const rows = el('div', { class: 'lg-live' });
    liveNodes = new Map();
    for (const l of LIVE_ROWS) {
      const value = el('b', {}, n0((s.live || {})[l.key] || 0));
      const acts = el('div', { class: 'lg-acts' });
      liveNodes.set(l.key, { value, acts, event: l.event });
      rows.append(el('div', { class: 'lg-live-row' },
        el('div', { class: 'lg-live-n' }, value, el('span', {}, l.label)),
        el('div', { class: 'lg-live-w' }, el('em', {}, l.note), acts)));
    }
    const busiest = el('p', { class: 'lg-lede' });
    body.append(
      el('p', { class: 'lg-p' },
        'An Act applies to a person while they are doing the thing it is about. This counts the '
        + 'people on Minjerribah who are inside one of those things at this moment, from the same '
        + 'agent systems that move them around the island.'),
      busiest,
      rows,
      section('What this is not',
        note('A count of people currently doing something is not a count of offences, breaches or '
          + 'anything else. It says which instruments are live on this island right now, which is a '
          + 'different and smaller claim.')));
    liveNodes.set('_busiest', { value: busiest });
    fillLive(s);
  }

  const LIVE_ROWS = [
    { key: 'on-the-road', event: 'drive', label: 'on the road', note: 'while the vehicle is moving on a road' },
    { key: 'on-the-water', event: 'go-on-the-water', label: 'on the water', note: 'while the boat is under way' },
    { key: 'at-work', event: 'work-for-wages', label: 'at work', note: 'while the shift is running' },
    { key: 'at-school', event: 'study', label: 'at school', note: 'while the school day is running' },
    { key: 'across-the-bay', event: null, label: 'across the bay', note: 'the crossing itself is a public passenger service' }
  ];

  function fillLive(s) {
    if (!liveNodes) return;
    const p = pack();
    for (const [key, node] of liveNodes) {
      if (key === '_busiest') {
        node.value.textContent = s.busiest
          ? `${n0(s.busiest.people)} people are ${s.busiest.doing} right now, and while they are, ${s.busiest.instruments.length} of these Acts are the ones that decide.`
          : 'Nobody on the island is inside one of these right now.';
        continue;
      }
      node.value.textContent = n0((s.live || {})[key] || 0);
      if (node.acts.childElementCount) continue;
      const ids = node.event
        ? (p.instruments || []).filter((i) => (i.life_events || []).includes(node.event)).map((i) => i.id)
        : ['qld-passenger-transport-1994'];
      for (const id of ids) {
        const rec = (p.instruments || []).find((i) => i.id === id);
        if (!rec) continue;
        node.acts.append(actChip(rec));
      }
    }
  }

  function actChip(rec) {
    return el('button', {
      class: 'btn lg-chip', type: 'button', title: rec.citation,
      onclick: () => { F.query = rec.short_title; tab = 'acts'; paintTabs(); render(); }
    }, rec.short_title, el('i', {}, `${n0(rec.size.pages)}p`));
  }

  /* ---- one person -------------------------------------------------------- */

  function paintPerson(s) {
    const sample = s.sample || [];
    // A resident can leave the island or die while the board is open, and the panel holds an id
    // rather than a person on purpose. If the one being shown has gone, fall back to the sample
    // rather than rendering an empty board and blaming the roster.
    if (!personA || !s.forPerson(personA)) personA = sample.find((id) => s.forPerson(id)) || null;
    if (!personB || personB === personA || !s.forPerson(personB)) {
      personB = sample.find((id) => id !== personA && s.forPerson(id)) || null;
    }

    // The three the system chose, plus whoever the inspector sent in, because arriving from a
    // person on the island and finding three strangers offered instead would be the wrong answer.
    const offer = sample.includes(personA) || !personA ? sample : [personA, ...sample];
    const picker = el('div', { class: 'lg-picker' });
    for (const id of offer) {
      const b = s.forPerson(id);
      if (!b) continue;
      picker.append(el('button', {
        class: `btn ${id === personA ? 'on' : 'ghost'}`, type: 'button',
        onclick: () => { personA = id; if (personB === id) personB = offer.find((x) => x !== id) || null; render(); }
      }, b.name, el('i', {}, b.occupation)));
    }

    const b = personA ? s.forPerson(personA) : null;
    body.append(
      el('p', { class: 'lg-p' },
        'Three islanders, chosen because they differ: what they do, what they own and how they get '
        + 'about. The Acts are real. The people are generated, and the reason for every line is '
        + 'printed beside it so nothing here has to be taken on trust.'),
      picker);

    if (!b) {
      body.append(el('p', { class: 'lg-p' }, 'No resident is on the roster yet.'));
      return;
    }

    body.append(
      el('div', { class: 'lg-who' },
        el('b', {}, b.name),
        el('span', {}, `${b.age} years old, ${b.occupation}, ${b.tenure}`),
        el('em', {}, b.generated)),

      el('div', { class: 'lg-figures tight' },
        figure(n0(b.count), 'Acts', 'reach this person through what they do and what they own'),
        figure(n0(b.pages), 'pages', 'the union of them, counted once each'),
        figure(n0(b.bearing.mostly_protects), 'mostly give', 'the duty in them falls on somebody else'),
        figure(n0(b.bearing.mostly_requires), 'mostly ask', 'the duty in them falls on this person')),

      section('The life this pack recognises',
        el('div', { class: 'lg-events' }, ...b.events.map((e) => el('div', { class: 'lg-event' },
          el('b', {}, e.label),
          el('span', {}, e.why),
          el('i', {}, `${e.instruments} Act${e.instruments === 1 ? '' : 's'}`)))),
        note('Each of these is a life event named in the pack, matched to something the twin holds '
          + 'about this resident. Nothing is attached without a reason.')),

      section('What it cannot tell',
        el('ul', { class: 'lg-list' }, ...b.unknowable.map((u) => el('li', {},
          el('b', {}, cap(u.key.replace(/-/g, ' '))), ' ', el('span', {}, u.why)))),
        note('Four of the twenty-seven life events in the pack are about things no system here '
          + 'models. Nothing is attached for them, and a list that quietly left them out would be '
          + 'a worse answer than one that says so.')),

      section(`The Acts, heaviest first (${b.instruments.length})`,
        el('div', { class: 'lg-rows' }, ...b.instruments.map((i) => instrumentRow(i)))),

      compareBlock(s)
    );
  }

  function instrumentRow(i) {
    const rec = pack().instruments.find((x) => x.id === i.id) || {};
    return el('div', { class: 'lg-row' },
      el('div', { class: 'lg-row-h' },
        el('b', {}, i.short_title),
        el('span', { class: `lg-tag t-${BEARING_TONE[i.bearing] || 'sea'}` }, bearingLabel(i.bearing)),
        el('i', {}, `${n0(i.pages)} pages`)),
      el('div', { class: 'lg-cite' }, rec.citation || i.citation),
      el('div', { class: 'lg-why' },
        i.because.length ? `Because: ${i.because.join(', ').toLowerCase()}.` : '',
        i.occupation_reason ? ` Their work: ${i.occupation_reason}.` : ''),
      rec.deep_link || (rec.register && rec.register.deep_link)
        ? el('a', {
          class: 'lg-link', href: (rec.register && rec.register.deep_link) || rec.deep_link,
          target: '_blank', rel: 'noopener noreferrer'
        }, 'read it on the register')
        : null);
  }

  function bearingLabel(key) {
    const b = (pack().bearing_scale || []).find((x) => x.key === key);
    return b ? b.label : key;
  }

  function compareBlock(s) {
    const sample = (s.sample || []).filter((id) => id !== personA && s.forPerson(id));
    const wrap = el('div', {});
    const picker = el('div', { class: 'lg-picker' });
    for (const id of sample) {
      const other = s.forPerson(id);
      if (!other) continue;
      picker.append(el('button', {
        class: `btn ${id === personB ? 'on' : 'ghost'}`, type: 'button',
        onclick: () => { personB = id; render(); }
      }, `against ${other.name}`));
    }
    const d = personB ? s.difference(personA, personB) : null;
    wrap.append(picker);
    if (d) {
      wrap.append(
        el('p', { class: 'lg-lede' },
          `They share ${d.shared} Acts and ${n0(d.sharedPages)} pages. The difference is `
          + `${d.onlyA.length + d.onlyB.length} Acts, and it is entirely about what they do and what they own.`),
        el('div', { class: 'lg-two' },
          diffCard(d.a, d.onlyA), diffCard(d.b, d.onlyB)));
    }
    return section('Two people, side by side', wrap,
      note('This is the answer to the question the pack exists for. The weight is not one number: '
        + 'most of it falls on everybody, and the part that separates two islanders is a handful of '
        + 'Acts that follow from a job, a tenure and a boat.'));
  }

  function diffCard(who, only) {
    return el('div', { class: 'lg-card' },
      el('b', {}, `${who.name} carries, and the other does not`),
      el('span', {}, `${who.occupation}, ${who.tenure}, ${n0(who.pages)} pages in total`),
      el('ul', { class: 'lg-list tight' }, ...only.map((i) => el('li', {},
        el('b', {}, i.short_title), ' ', el('span', {}, `${n0(i.pages)} pages. ${i.because.join(', ').toLowerCase()}${i.occupation_reason ? '. ' + i.occupation_reason : ''}`)))),
      only.length ? null : el('em', {}, 'nothing this person carries alone'));
  }

  /* ---- the edges --------------------------------------------------------- */

  function paintEdges(s) {
    const p = pack();
    body.append(
      el('p', { class: 'lg-p' },
        'The 2012 stack ended at Magna Carta and a United States financing statement, which is where '
        + 'this kind of reading usually ends. Neither of them is answered by a list of Australian '
        + 'Acts, so they are answered here: what the thing is, how it stands in Queensland, and what '
        + 'a court has already held about it, with the judgment cited so you can go and read it.'),
      el('div', { class: 'lg-types' }, ...(p.edge_types || []).map((t) => el('div', { class: 'lg-card' },
        el('b', { class: `t-${EDGE_TONE[t.key] || 'sea'}` }, t.label),
        el('span', {}, t.meaning)))));

    for (const e of p.edges || []) body.append(edgeCard(e, p));

    body.append(section('How a judgment gets into this pack',
      note((p.judgments_method && p.judgments_method.what_is_checked) || ''),
      note((p.judgments_method && p.judgments_method.how_holdings_are_written) || '')));
  }

  function edgeCard(e, p) {
    const type = (p.edge_types || []).find((t) => t.key === e.type);
    const isOpen = openEdge === e.id;
    const head2 = el('div', {
      class: 'lg-edge-h', role: 'button', tabindex: '0',
      onclick: () => { openEdge = isOpen ? null : e.id; render(); },
      onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openEdge = isOpen ? null : e.id; render(); } }
    },
    el('span', { class: `lg-tag t-${EDGE_TONE[e.type] || 'sea'}` }, type ? type.label : e.type),
    el('b', {}, e.title),
    el('i', {}, isOpen ? 'close' : 'open'));

    const kids = [head2, el('div', { class: 'lg-cite' }, e.citation || e.jurisdiction)];
    if (isOpen) {
      kids.push(
        para('What it is', e.what_it_is),
        para('How it stands here', e.how_it_stands_here),
        e.what_people_are_told ? para('What people are told', e.what_people_are_told) : null,
        e.what_a_court_held ? para('What a court held', e.what_a_court_held) : null,
        e.mechanism ? para('The mechanism', e.mechanism) : null,
        e.what_to_do_with_it ? para('What to do with it', e.what_to_do_with_it) : null,
        e.quote ? el('blockquote', { class: 'lg-quote' }, `"${e.quote}"`,
          el('cite', {}, `${e.source}, ${e.locator}`)) : null,
        e.instruments && e.instruments.length
          ? el('div', { class: 'lg-acts' }, ...e.instruments.map((id) => {
            const rec = (p.instruments || []).find((x) => x.id === id);
            return rec ? actChip(rec) : null;
          }).filter(Boolean))
          : null,
        ...(e.judgments || []).map((id) => judgmentCard((p.judgments || []).find((j) => j.id === id))).filter(Boolean),
        el('div', { class: 'lg-notadvice inline' }, e.not_advice));
    }
    return el('div', { class: `lg-edge ${isOpen ? 'on' : ''}` }, ...kids.filter(Boolean));
  }

  function judgmentCard(j) {
    if (!j) return null;
    return el('div', { class: 'lg-judgment' },
      el('b', {}, `${j.case_name} ${j.citation}`),
      el('span', {}, `${j.court}. ${j.bench ? j.bench + '. ' : ''}Decided ${j.decided}.`),
      para('Argued', j.what_was_argued),
      para('Held', j.what_was_held),
      el('blockquote', { class: 'lg-quote' }, `"${j.quote}"`, el('cite', {}, j.locator)),
      j.island_link ? el('div', { class: 'lg-why' }, j.island_link) : null,
      el('a', { class: 'lg-link', href: j.source_url, target: '_blank', rel: 'noopener noreferrer' }, 'read the judgment'),
      el('div', { class: 'lg-fine' }, j.neutral_note),
      el('div', { class: 'lg-fine' }, `Checked against the publisher: ${j.verified_against}.`));
  }

  function para(label, text) {
    if (!text) return null;
    return el('div', { class: 'lg-para' }, el('b', {}, label), el('p', {}, text));
  }

  /* ---- every Act --------------------------------------------------------- */

  function paintActs(s) {
    const p = pack();
    const search = el('input', {
      class: 'lg-search', type: 'search', placeholder: 'search the short title', value: F.query,
      oninput: (e) => { F.query = e.target.value; paintList(); }
    });
    const chips = el('div', { class: 'lg-chips' });
    const chip = (label, on, fn) => el('button', { class: `btn ${on ? 'on' : 'ghost'}`, type: 'button', onclick: fn }, label);
    function paintChips() {
      chips.replaceChildren(
        chip('all', F.event === 'all' && F.jurisdiction === 'all' && F.bearing === 'all', () => { F.event = 'all'; F.jurisdiction = 'all'; F.bearing = 'all'; paintChips(); paintList(); }),
        chip('Commonwealth', F.jurisdiction === 'Commonwealth', () => { F.jurisdiction = F.jurisdiction === 'Commonwealth' ? 'all' : 'Commonwealth'; paintChips(); paintList(); }),
        chip('Queensland', F.jurisdiction === 'Queensland', () => { F.jurisdiction = F.jurisdiction === 'Queensland' ? 'all' : 'Queensland'; paintChips(); paintList(); }),
        ...(p.bearing_scale || []).map((b) => chip(b.label, F.bearing === b.key, () => { F.bearing = F.bearing === b.key ? 'all' : b.key; paintChips(); paintList(); })),
        ...(p.life_events || []).map((le) => chip(le.label, F.event === le.key, () => { F.event = F.event === le.key ? 'all' : le.key; paintChips(); paintList(); }))
      );
    }
    const count = el('p', { class: 'lg-p' });
    const list = el('div', { class: 'lg-rows' });

    function paintList() {
      const q = F.query.trim().toLowerCase();
      const rows = (p.instruments || []).filter((i) => {
        if (F.jurisdiction !== 'all' && i.jurisdiction !== F.jurisdiction) return false;
        if (F.bearing !== 'all' && i.bearing !== F.bearing) return false;
        if (F.event !== 'all' && !(i.life_events || []).includes(F.event)) return false;
        if (q && !(`${i.short_title} ${i.citation}`.toLowerCase().includes(q))) return false;
        return true;
      });
      const pages = rows.reduce((a, i) => a + (i.size.pages || 0), 0);
      count.textContent = `${rows.length} Act${rows.length === 1 ? '' : 's'}, ${n0(pages)} pages.`;
      list.replaceChildren(...rows.map((i) => actCard(i)));
    }

    paintChips();
    paintList();
    body.append(
      el('p', { class: 'lg-p' },
        'All sixty-six, with the citation, the size counted from the consolidation, and a link to '
        + 'the register that serves it.'),
      search, chips, count, list);
  }

  function actCard(i) {
    return el('div', { class: 'lg-row' },
      el('div', { class: 'lg-row-h' },
        el('b', {}, i.short_title),
        el('span', { class: `lg-tag t-${BEARING_TONE[i.bearing] || 'sea'}` }, bearingLabel(i.bearing)),
        el('i', {}, `${n0(i.size.pages)} pages${i.size.contents_entries ? `, ${n0(i.size.contents_entries)} provisions` : ''}`)),
      el('div', { class: 'lg-cite' }, `${i.citation}. ${i.currency}. ${i.register.site}, ${i.register.id}.`),
      el('p', { class: 'lg-what' }, i.what_it_does),
      (i.parts_that_bear_on_a_person || []).length
        ? el('ul', { class: 'lg-list tight' }, ...i.parts_that_bear_on_a_person.slice(0, 4).map((x) => el('li', {}, x)))
        : null,
      (i.key_provisions || []).length
        ? el('div', { class: 'lg-provs' }, ...i.key_provisions.map((k) => el('span', {}, `s ${k.ref} ${k.label}`)))
        : null,
      i.island_link ? el('div', { class: 'lg-why' }, i.island_link) : null,
      el('a', { class: 'lg-link', href: i.register.deep_link, target: '_blank', rel: 'noopener noreferrer' }, 'read it on the register'),
      el('div', { class: 'lg-fine' }, i.not_advice));
  }

  /* ---- small helpers ----------------------------------------------------- */

  function section(title, ...kids) {
    return el('section', { class: 'lg-sec' }, el('h3', {}, title), ...kids.filter(Boolean));
  }
  function note(text) { return text ? el('p', { class: 'lg-note' }, text) : null; }

  /* ---- the 10 Hz update -------------------------------------------------- */

  return {
    update(w) {
      const s = w.read('legislation');
      launcher.classList.toggle('has', Boolean(s && s.ready));
      if (!open || !s || !s.ready) return;
      if (tab === 'now') fillLive(s);
    }
  };
}

/* ================================================================== styles */

let styleDone = false;
function injectStyle() {
  if (styleDone) return;
  styleDone = true;
  const s = document.createElement('style');
  s.id = 'lg-style';
  s.textContent = `
.lg-scrim { position: fixed; inset: 0; background: var(--s-0); backdrop-filter: blur(3px);
  z-index: 40; opacity: 0; pointer-events: none; transition: opacity var(--med) var(--ease); }
.lg-scrim.on { opacity: 1; pointer-events: auto; }
.lg-board { position: fixed; inset: var(--board-inset); z-index: 41; display: flex; flex-direction: column;
  max-width: 1360px; margin: 0 auto; opacity: 0; transform: translateY(14px) scale(.994);
  pointer-events: none; transition: opacity var(--med) var(--ease-out), transform var(--med) var(--ease-out); }
.lg-board.on { opacity: 1; transform: none; pointer-events: auto; }
@media (max-width: 860px) { .lg-board { inset: 0; border-radius: 0; } }

.lg-top { display: flex; align-items: flex-start; gap: var(--sp-5); padding: var(--sp-3) var(--sp-4);
  border-bottom: 1px solid var(--edge); background: linear-gradient(180deg, rgba(255,255,255,.04), transparent); }
.lg-top h2 { font-size: var(--fs-label); letter-spacing: .18em; text-transform: uppercase;
  color: var(--t-dim); font-weight: 600; margin-bottom: 3px; }
.lg-sub { font-size: var(--fs-sm); color: var(--t-faint); max-width: 82ch; line-height: 1.5; }
.lg-top > button { flex: none; margin-left: auto; }

.lg-notadvice { padding: 7px var(--sp-4); font-size: var(--fs-sm); line-height: 1.5; color: var(--sun);
  background: rgba(240,180,41,.09); border-bottom: 1px solid var(--edge); }
.lg-notadvice.inline { border: 1px solid rgba(240,180,41,.3); border-radius: var(--r-2);
  margin-top: var(--sp-3); font-size: var(--fs-micro); }

.lg-tabs { display: flex; gap: 4px; padding: var(--sp-2) var(--sp-4); border-bottom: 1px solid var(--edge); }
.lg-body { flex: 1; min-height: 0; padding: var(--sp-4) var(--sp-5); }

.lg-p { font-size: var(--fs-sm); line-height: 1.65; color: var(--t-dim); max-width: 84ch; margin-bottom: var(--sp-3); }
.lg-lede { font: 300 var(--fs-lg)/1.6 var(--f-ui); color: var(--t-hi); max-width: 84ch; margin-bottom: var(--sp-3); }
.lg-note { font-size: var(--fs-micro); line-height: 1.7; color: var(--t-faint); max-width: 84ch; margin-top: var(--sp-2); }
.lg-fine { font-size: var(--fs-micro); line-height: 1.6; color: var(--t-faint); margin-top: 4px; }
.lg-sec { margin-top: var(--sp-5); }
.lg-sec h3 { font-size: var(--fs-micro); letter-spacing: .16em; text-transform: uppercase;
  color: var(--t-faint); font-weight: 600; margin-bottom: var(--sp-2); }

.lg-figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--sp-3); }
.lg-figures.tight { margin: var(--sp-3) 0; }
.lg-fig { border: 1px solid var(--edge); border-radius: var(--r-2); padding: var(--sp-3); }
.lg-fig b { display: block; font: 300 var(--fs-xl)/1.1 var(--f-num); color: var(--t-hi); }
.lg-fig span { display: block; font-size: var(--fs-sm); color: var(--t-dim); margin-top: 2px; }
.lg-fig em { display: block; font-style: normal; font-size: var(--fs-micro); color: var(--t-faint);
  line-height: 1.6; margin-top: 5px; }

.lg-bars { display: grid; gap: var(--sp-3); }
.lg-bar-h { display: flex; justify-content: space-between; font-size: var(--fs-sm); color: var(--t); }
.lg-bar-h i { font-style: normal; font-family: var(--f-num); color: var(--t-faint); }
.lg-bar-t { height: 6px; background: var(--s-sunk); border-radius: var(--r-pill); overflow: hidden; margin: 4px 0; }
.lg-bar-f { height: 100%; border-radius: var(--r-pill); }
.lg-bar-m { font-size: var(--fs-micro); color: var(--t-faint); line-height: 1.6; }
.t-leaf { background: var(--leaf); } .t-coral { background: var(--coral); }
.t-sea { background: var(--sea); } .t-iron { background: var(--iron); }
.t-sand { background: var(--sand); } .t-heath { background: var(--heath); }

.lg-two { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-3); }
@media (max-width: 900px) { .lg-two { grid-template-columns: 1fr; } }
.lg-card { border: 1px solid var(--edge); border-radius: var(--r-2); padding: var(--sp-3); }
.lg-card.click { cursor: pointer; transition: border-color var(--fast), background var(--fast); }
.lg-card.click:hover { border-color: var(--sea); background: rgba(63,182,196,.07); }
.lg-card.click:focus-visible { outline: none; box-shadow: var(--glow-sea); }
.lg-card b { display: block; color: var(--t-hi); font-weight: 500; }
.lg-card span { display: block; font-size: var(--fs-sm); color: var(--t-dim); margin-top: 2px; }
.lg-card em { display: block; font-style: normal; font-size: var(--fs-micro); color: var(--t-faint);
  line-height: 1.6; margin-top: 5px; }

.lg-list { margin: var(--sp-2) 0 0 0; padding-left: var(--sp-4); }
.lg-list li { font-size: var(--fs-sm); line-height: 1.65; color: var(--t-dim); margin-bottom: 5px; }
.lg-list li b { color: var(--t); font-weight: 500; }
.lg-list.tight li { font-size: var(--fs-micro); line-height: 1.6; }

.lg-live { display: grid; gap: var(--sp-3); }
.lg-live-row { display: grid; grid-template-columns: 150px 1fr; gap: var(--sp-4); align-items: start;
  border-top: 1px solid var(--edge); padding-top: var(--sp-3); }
.lg-live-n b { display: block; font: 300 var(--fs-xl)/1 var(--f-num); color: var(--sea); }
.lg-live-n span { display: block; font-size: var(--fs-sm); color: var(--t-dim); margin-top: 3px; }
.lg-live-w em { display: block; font-style: normal; font-size: var(--fs-micro); color: var(--t-faint);
  margin-bottom: 6px; }
.lg-acts { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.lg-chip { padding: 3px 8px; font-size: var(--fs-micro); gap: 6px; }
.lg-chip i { font-style: normal; font-family: var(--f-num); opacity: .6; }

.lg-picker { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: var(--sp-3); }
.lg-picker .btn { flex-direction: column; align-items: flex-start; gap: 2px; padding: 6px 10px; }
.lg-picker .btn i { font-style: normal; font-size: var(--fs-micro); opacity: .7; }

.lg-who { border-left: 2px solid var(--sea); padding: 4px var(--sp-3); margin-bottom: var(--sp-3); }
.lg-who b { display: block; font-size: var(--fs-lg); color: var(--t-hi); font-weight: 500; }
.lg-who span { display: block; font-size: var(--fs-sm); color: var(--t-dim); }
.lg-who em { display: block; font-style: normal; font-size: var(--fs-micro); color: var(--t-faint); margin-top: 4px; }

.lg-events { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 6px; }
.lg-event { border: 1px solid var(--edge); border-radius: var(--r-2); padding: 6px var(--sp-2); }
.lg-event b { display: block; font-size: var(--fs-sm); color: var(--t); font-weight: 500; }
.lg-event span { display: block; font-size: var(--fs-micro); color: var(--t-faint); line-height: 1.55; }
.lg-event i { font-style: normal; font-size: var(--fs-micro); font-family: var(--f-num); color: var(--sea); }

.lg-rows { display: grid; gap: 6px; }
.lg-row { border: 1px solid var(--edge); border-radius: var(--r-2); padding: var(--sp-2) var(--sp-3); }
.lg-row-h { display: flex; align-items: baseline; gap: var(--sp-2); flex-wrap: wrap; }
.lg-row-h b { color: var(--t-hi); font-weight: 500; }
.lg-row-h i { font-style: normal; margin-left: auto; font-family: var(--f-num);
  font-size: var(--fs-micro); color: var(--t-faint); }
.lg-tag { font-size: 9px; letter-spacing: .06em; text-transform: uppercase; color: var(--t-on-accent);
  border-radius: var(--r-pill); padding: 1px 7px; }
.lg-cite { font: 400 var(--fs-micro)/1.6 var(--f-num); color: var(--t-faint); margin-top: 2px; }
.lg-what { font-size: var(--fs-sm); line-height: 1.65; color: var(--t-dim); margin-top: 6px; max-width: 90ch; }
.lg-why { font-size: var(--fs-micro); line-height: 1.6; color: var(--sea); margin-top: 4px; }
.lg-provs { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.lg-provs span { font: 400 var(--fs-micro)/1.4 var(--f-num); color: var(--t-dim);
  background: var(--s-sunk); border-radius: var(--r-1); padding: 3px 7px; }
.lg-link { display: inline-block; margin-top: 6px; font-size: var(--fs-micro); color: var(--sea);
  text-decoration: none; border-bottom: 1px solid rgba(63,182,196,.4); }
.lg-link:hover { color: var(--t-hi); }

.lg-types { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--sp-2);
  margin-bottom: var(--sp-4); }
.lg-types .lg-card b { color: var(--t-on-accent); border-radius: var(--r-pill); padding: 1px 8px;
  display: inline-block; font-size: 9px; letter-spacing: .06em; text-transform: uppercase; }

.lg-edge { border: 1px solid var(--edge); border-radius: var(--r-2); padding: var(--sp-3);
  margin-bottom: var(--sp-2); }
.lg-edge.on { border-color: var(--edge-strong); background: rgba(255,255,255,.02); }
.lg-edge-h { display: flex; align-items: center; gap: var(--sp-2); cursor: pointer; }
.lg-edge-h b { color: var(--t-hi); font-weight: 500; }
.lg-edge-h i { font-style: normal; margin-left: auto; font-size: var(--fs-micro); color: var(--t-faint); }
.lg-edge-h:focus-visible { outline: none; box-shadow: var(--glow-sea); }
.lg-para { margin-top: var(--sp-3); }
.lg-para b { display: block; font-size: var(--fs-micro); letter-spacing: .14em; text-transform: uppercase;
  color: var(--t-faint); margin-bottom: 3px; }
.lg-para p { font-size: var(--fs-sm); line-height: 1.7; color: var(--t-dim); max-width: 90ch; }
.lg-quote { border-left: 2px solid var(--sand); padding: 4px var(--sp-3); margin: var(--sp-3) 0;
  font: 400 var(--fs-sm)/1.7 var(--f-ui); color: var(--t); max-width: 90ch; }
.lg-quote cite { display: block; font-style: normal; font-size: var(--fs-micro); color: var(--t-faint); margin-top: 4px; }
.lg-judgment { border: 1px solid var(--edge); border-left: 2px solid var(--coral); border-radius: var(--r-2);
  padding: var(--sp-3); margin-top: var(--sp-3); }
.lg-judgment > b { display: block; color: var(--t-hi); font-weight: 500; }
.lg-judgment > span { display: block; font-size: var(--fs-micro); color: var(--t-faint); margin-top: 2px; }

.lg-search { width: 100%; max-width: 420px; appearance: none; background: var(--s-sunk);
  border: 1px solid var(--edge-strong); border-radius: var(--r-2); color: var(--t);
  font: var(--fs-sm) var(--f-ui); padding: var(--sp-2) var(--sp-3); margin-bottom: var(--sp-2); }
.lg-search:focus-visible { outline: none; box-shadow: var(--glow-sea); }
.lg-chips { display: flex; flex-wrap: wrap; gap: 3px; margin-bottom: var(--sp-3); }
.lg-chips .btn { padding: 3px 7px; font-size: 9px; letter-spacing: .06em; text-transform: uppercase; }
`;
  document.head.appendChild(s);
}
