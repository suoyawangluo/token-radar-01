// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, filters, a per-protocol detail view with the model's own inputs and the
// protocol's farm plan, and the live-token view the model prices from. No network: every byte it
// shows is in data.js.
//
// The pure functions at the top mirror lib/model.ts and lib/farm.ts exactly: the page recomputes a
// row's implied value from the snapshot figures and re-derives its farm plan from the same fields,
// so the page's code and the board's data are visibly the same arithmetic. They are top-level on
// purpose: the build checks them against the TypeScript outside the browser too.

'use strict';

/** A number held inside [lo, hi]. */
function radarClamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

/** One row's implied value, recomputed from the snapshot figures and the stated multiple. */
function radarScoreRow(row, model) {
  var growthPct = radarClamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, model.growth_floor, model.growth_cap);
  var growthMult = radarClamp(1 + (growthPct / 100) * model.growth_weight, model.growth_mult_min, model.growth_mult_max);
  var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
  var tenureMult = model.tenure_floor + model.tenure_range * Math.sqrt(radarClamp(age, 0, model.tenure_days) / model.tenure_days);
  var chains = row.chains && row.chains.length ? row.chains.length : 0;
  var breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(chains - 1, 0), model.breadth_max_chains);
  var implied = Math.max(1, Math.round(row.tvl_usd * row.multiple * growthMult * tenureMult * breadthMult));
  return { implied: implied, growthPct: growthPct, growthMult: growthMult, tenureMult: tenureMult, breadthMult: breadthMult, age: row.age_days };
}

/** Chains where a transaction costs under a dollar: rollups, sidechains and cheap L1s. */
var RADAR_CHEAP_GAS = ['Arbitrum', 'Optimism', 'Base', 'Blast', 'Unichain', 'Linea', 'Scroll', 'zkSync Era', 'Mantle', 'Mode', 'Manta', 'Starknet', 'Gnosis', 'Moonbeam', 'Polygon zkEVM', 'Polygon'];

/** Chains where a transaction costs cents: high-throughput L1s. */
var RADAR_CENTS_FEE = ['Solana', 'BSC', 'BNB Chain', 'Avalanche', 'Tron', 'Aptos', 'Sui', 'Near', 'Fantom', 'Celo', 'Sei', 'Berachain', 'Sonic'];

/** What one transaction costs on a chain, for the setup step and for the weekly rhythm. */
function radarGasPhrases(chain) {
  if (chain === 'Ethereum') return { setup: 'about $8 of gas', weekly: 'about $8 of gas a week' };
  if (chain === 'Bitcoin') return { setup: 'about $3 of network fees', weekly: 'about $3 of fees a week' };
  if (RADAR_CENTS_FEE.indexOf(chain) >= 0) return { setup: 'under $0.25 of fees', weekly: 'under $0.25 of fees a week' };
  if (RADAR_CHEAP_GAS.indexOf(chain) >= 0) return { setup: 'under $1 of gas', weekly: 'under $1 of gas a week' };
  return { setup: 'a few dollars of gas', weekly: 'a few dollars of gas a week' };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function radarCapitalFor(row) {
  if (row.tvl_usd >= 10000000000) return 500;
  if (row.tvl_usd >= 1000000000) return 250;
  if (row.tvl_usd >= 100000000) return 150;
  return 75;
}

/** How long to hold, from the protocol's age and growth. Capped at 90 days. */
function radarHoldDaysFor(row) {
  var hold;
  var age = row.age_days;
  if (age === null || age === undefined) hold = 60;
  else if (age < 90) hold = 90;
  else if (age < 365) hold = 60;
  else hold = 45;
  if (row.change_7d !== null && row.change_7d !== undefined && row.change_7d > 20) hold += 15;
  return Math.min(hold, 90);
}

/** The category's one main action, in the words a farmer can follow. */
function radarActionFor(row, capital, chain) {
  var c = (row.category || '').toLowerCase();
  var name = row.name;
  if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Lend $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and leave the supply earning.';
  if (c.indexOf('dex') >= 0) return 'Add $' + capital + " of liquidity to " + name + "'s deepest pool on " + chain + ' and leave it in range.';
  if (c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('farm') >= 0) return 'Deposit $' + capital + " into " + name + "'s highest-TVL strategy on " + chain + ' and leave the receipt tokens untouched.';
  if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0) return 'Bridge $' + capital + ' of USDC through ' + name + ' to ' + chain + ' and put the bridged funds to work in its app.';
  if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and hold the receipt token.';
  if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Post $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.';
  if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and take one position in an open market on ' + name + '.';
  if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Allocate $' + capital + ' to a ' + name + ' vault on ' + chain + ' and hold the vault shares.';
  if (c.indexOf('stable') >= 0) return 'Mint or hold $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
  if (c.indexOf('rwa') >= 0) return 'Buy $' + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it.';
  if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
  if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + " into " + name + "'s basis strategy on " + chain + ' and hold the position.';
  if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of the ' + name + ' index token on ' + chain + ' and hold it.';
  if (c.indexOf('interest rate') >= 0) return 'Lend $' + capital + " into " + name + "'s fixed-rate market on " + chain + ' through one full term.';
  if (c === 'chain') return 'Bridge $' + capital + " to the chain and use " + name + "'s native app: one swap and one stake.";
  return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and leave the position open.';
}

/** The weekly rhythm: one more qualifying action a week, shaped by the category. */
function radarWeeklyActionFor(row) {
  var c = (row.category || '').toLowerCase();
  if (c.indexOf('dex') >= 0) return 'Each week, rebalance or top up the pool position once, and route one swap through the protocol.';
  if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0) return 'Each week, adjust the supply once, or borrow and repay a small amount so the position stays active.';
  if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Each week, restake the rewards or add a little more stake so the position keeps growing.';
  return 'Each week, make one more qualifying action: a deposit, a swap, a borrow-and-repay, or a vote when one is live.';
}

/** A step as one string: its action, then its cost and time, within 20..600 characters. */
function radarStepText(step) {
  var suffix = ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
  var text = step.text.replace(/^\s+|\s+$/g, '');
  if (text.length + suffix.length > 600) text = text.slice(0, 600 - suffix.length - 3) + '...';
  var s = text + suffix;
  if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
  return s;
}

/** A protocol's farm plan: seven steps, derived from the protocol's own record. */
function radarFarmSteps(row) {
  var chain = row.chains && row.chains.length > 0 ? row.chains[0] : 'its main chain';
  var gas = radarGasPhrases(chain);
  var capital = radarCapitalFor(row);
  var hold = radarHoldDaysFor(row);
  var second = row.chains && row.chains.length > 1 ? row.chains[1] : null;
  var half = Math.max(25, Math.round(capital / 2));
  var steps = [
    { text: 'Open a fresh wallet that holds only the funds you plan to farm, fund it with ' + gas.setup + ' for the first transactions, and keep its seed phrase offline.', cost: gas.setup, time: '10 minutes' },
    { text: radarActionFor(row, capital, chain), cost: '$' + capital + ' of capital and ' + gas.setup, time: '20 minutes to set up' },
    { text: second !== null ? 'Open a second, smaller position of $' + half + ' on ' + second + ' so the activity spans two chains instead of one.' : 'Add a second position of $' + half + ' in a different pool or vault of ' + row.name + ' so the activity is not a single transaction.', cost: '$' + half + ' of capital and ' + gas.setup, time: '15 minutes' },
    { text: radarWeeklyActionFor(row), cost: gas.weekly, time: '15 minutes a week' },
    { text: 'Hold the positions for at least ' + hold + ' days so the activity lands in more than one snapshot window.', cost: 'the $' + capital + ' stays in the positions', time: hold + ' days' },
    { text: "Check " + row.name + "'s own points or rewards page once a week, and join a vote or discussion when one is open; claim only from a link the protocol itself publishes, and never pay anyone to claim.", cost: 'no fee to check', time: '10 minutes a week' },
    { text: "Keep a farm log with the wallet, the dates and every transaction hash, and unwind in reverse order when you leave: claim first, then withdraw, then close the wallet's approvals.", cost: 'exit gas of ' + gas.setup, time: '20 minutes to unwind' }
  ];
  return steps.map(radarStepText);
}

(function () {
  if (typeof window === 'undefined' || !window.RADAR) return;
  var DATA = window.RADAR;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(3) + 'x';
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    if (hash.indexOf('/protocol/') === 0) {
      state.selected = decodeURIComponent(hash.slice('/protocol/'.length)) || null;
      return;
    }
    var query = hash.charAt(0) === '/' ? hash.slice(1) : hash;
    if (query.charAt(0) === '?') query = query.slice(1);
    var params = new URLSearchParams(query);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('dir') === '1' || params.get('dir') === '-1') state.dir = parseInt(params.get('dir'), 10);
  }
  function writeHash() {
    var next;
    if (state.selected) {
      next = '#/protocol/' + encodeURIComponent(state.selected);
    } else {
      var params = new URLSearchParams();
      if (state.q) params.set('q', state.q);
      if (state.category !== 'all') params.set('category', state.category);
      if (state.chain !== 'all') params.set('chain', state.chain);
      if (state.tab !== 'pre-token') params.set('tab', state.tab);
      if (state.sort !== 'implied') params.set('sort', state.sort);
      if (state.dir !== -1) params.set('dir', String(state.dir));
      var qs = params.toString();
      next = qs ? '#/?' + qs : window.location.pathname + window.location.search;
    }
    window.history.replaceState(null, '', next);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Uncategorized') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.multiple; bv = b.multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'radar-mark', 'aria-hidden': 'true' }), el('span', { class: 'brand-name' }, el('b', { text: 'Token ' }), 'Radar')),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { class: 'dot', text: '·' }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { class: 'dot', text: '·' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', null, 'Every pre-token protocol, priced off ', el('span', { class: 'accent-word', text: 'its own category' }), '.'),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' more below that floor. Each implied value is TVL times the median market-cap-to-TVL ratio of the trading protocols in its own category — never a hand-picked number. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows ranked' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Trading comparables priced from' }), el('b', { text: String(DATA.global_comparables) })),
        el('div', { class: 'fact' }, el('span', { text: 'Global fallback multiple' }), el('b', { text: fmtMult(DATA.global_multiple) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorized'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? filteredRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } writeHash(); render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Uncategorized') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.multiple) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, r.on_watchlist ? el('span', { class: 'watch', text: 'WATCHLIST' }) : el('span', { class: 'pill', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model, its comparables and its farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('multiple', 'Multiple'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Uncategorized') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(r.mcap_tvl_ratio) }),
        el('td', null, el('span', { class: 'pill live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their market-cap-to-TVL ratios are the comparables the model prices the board from.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var catRows = DATA.categories.map(function (c) {
      return el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.comparables) }),
        el('td', { class: 'num', text: fmtMult(c.multiple) }),
        el('td', { class: 'sub', text: c.source === 'category' ? 'own category' : 'global fallback' })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked: the multiple comes from the trading protocols in the same category.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x multiple x clamp(1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ', ' + m.growth_mult_min + ', ' + m.growth_mult_max + ') x (' + m.tenure_floor + ' + ' + m.tenure_range + ' x sqrt(min(age_days, ' + m.tenure_days + ') / ' + m.tenure_days + ')) x (1 + ' + m.breadth_per_chain + ' x min(chains - 1, ' + m.breadth_max_chains + ')) )'
      ),
      el('p', { class: 'sub', text: 'multiple = the median market-cap-to-TVL ratio of the trading protocols in the row\'s category (at least ' + m.min_comparables + ' of them), clamped to [' + m.multiple_min + ', ' + m.multiple_max + ']; a category with too few comparables, or none, uses the global median of ' + fmtMult(DATA.global_multiple) + ' over ' + DATA.global_comparables + ' trading protocols. Age is the time since the protocol was first listed; an unlisted age uses ' + m.unknown_age_days + ' days.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'compact-table' },
          el('caption', { class: 'sub', text: 'The multiple each category on the board scores with, and how many trading protocols priced it.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Comparables' }), el('th', { scope: 'col', text: 'Multiple' }), el('th', { scope: 'col', text: 'Source' }))),
          el('tbody', null, catRows)
        )
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = radarFarmSteps(row);
    var recomputed = radarScoreRow(row, DATA.model);
    var matches = recomputed.implied === row.implied_value_usd;
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'kicker', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.on_watchlist ? ' · Watchlist' : ' · Early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Uncategorized') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · records no token' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: fmtMult(row.multiple) + ' (' + row.comparables + ' comparables, ' + (row.multiple_source === 'category' ? 'own category' : 'global fallback') + ')' })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Tenure multiplier' }), el('b', { class: 'num', text: String(row.tenure_multiplier) })),
        el('div', null, el('span', { text: 'Chain breadth' }), el('b', { class: 'num', text: String(row.breadth_multiplier) + ' (' + (row.chains ? row.chains.length : 0) + ' chains)' })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'note', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed.implied) + (matches ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () {
    var before = state.selected;
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.selected = null;
    readHash();
    if (before && !state.selected && dialog.open) dialog.close();
    render();
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
