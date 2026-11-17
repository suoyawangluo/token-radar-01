// A protocol's farm plan: seven steps, each an action with what it costs and how long it takes.
//
// Every part of the plan is derived from the protocol's own record — its category, its chains, its
// TVL, its age and its seven-day growth — never from a hand-written list of names. The dashboard's
// page re-derives the same plan from the same fields, so the plan the reader sees and the plan
// board.json carries are the same words.

import type { SnapshotProtocol } from './model.ts';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** Chains where a transaction costs under a dollar: rollups, sidechains and cheap L1s. */
const CHEAP_GAS_CHAINS = new Set([
  'Arbitrum',
  'Optimism',
  'Base',
  'Blast',
  'Unichain',
  'Linea',
  'Scroll',
  'zkSync Era',
  'Mantle',
  'Mode',
  'Manta',
  'Starknet',
  'Gnosis',
  'Moonbeam',
  'Polygon zkEVM',
  'Polygon',
]);

/** Chains where a transaction costs cents: high-throughput L1s. */
const CENTS_FEE_CHAINS = new Set([
  'Solana',
  'BSC',
  'BNB Chain',
  'Avalanche',
  'Tron',
  'Aptos',
  'Sui',
  'Near',
  'Fantom',
  'Celo',
  'Sei',
  'Berachain',
  'Sonic',
]);

/** What one transaction costs on a chain, for the setup step and for the weekly rhythm. */
export function gasPhrases(chain: string): { setup: string; weekly: string } {
  if (chain === 'Ethereum') return { setup: 'about $8 of gas', weekly: 'about $8 of gas a week' };
  if (chain === 'Bitcoin') return { setup: 'about $3 of network fees', weekly: 'about $3 of fees a week' };
  if (CENTS_FEE_CHAINS.has(chain)) return { setup: 'under $0.25 of fees', weekly: 'under $0.25 of fees a week' };
  if (CHEAP_GAS_CHAINS.has(chain)) return { setup: 'under $1 of gas', weekly: 'under $1 of gas a week' };
  return { setup: 'a few dollars of gas', weekly: 'a few dollars of gas a week' };
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 10_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  return 75;
}

/**
 * How long to hold, from the protocol's age and growth: a young protocol needs a longer qualifying
 * window, and a fast-growing one earns a longer hold while its momentum lasts. Capped at 90 days.
 */
export function holdDaysFor(p: SnapshotProtocol, age: number | null): number {
  let hold: number;
  if (age === null) hold = 60;
  else if (age < 90) hold = 90;
  else if (age < 365) hold = 60;
  else hold = 45;
  if (p.change_7d !== null && p.change_7d > 20) hold += 15;
  return Math.min(hold, 90);
}

/** The category's one main action, in the words a farmer can follow. */
export function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Lend $${capital} of USDC into ${name} on ${chain} and leave the supply earning.`;
  }
  // 'Indexes' contains 'dex' and 'Interest Rate Derivatives' contains 'derivative': check the
  // longer, more specific names before the shorter substrings that would swallow them.
  if (c.includes('index')) return `Buy $${capital} of the ${name} index token on ${chain} and hold it.`;
  if (c.includes('interest rate')) return `Lend $${capital} into ${name}'s fixed-rate market on ${chain} through one full term.`;
  if (c.includes('dex')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and leave it in range.`;
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) {
    return `Deposit $${capital} into ${name}'s highest-TVL strategy on ${chain} and leave the receipt tokens untouched.`;
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return `Bridge $${capital} of USDC through ${name} to ${chain} and put the bridged funds to work in its app.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} and hold the receipt token.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return `Post $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  }
  if (c.includes('prediction')) return `Fund $${capital} and take one position in an open market on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Allocate $${capital} to a ${name} vault on ${chain} and hold the vault shares.`;
  if (c.includes('stable')) return `Mint or hold $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Buy $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis strategy on ${chain} and hold the position.`;
  if (c === 'chain') return `Bridge $${capital} to the chain and use ${name}'s native app: one swap and one stake.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and leave the position open.`;
}

/** The weekly rhythm: one more qualifying action a week, shaped by the category. */
function weeklyActionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('dex')) return 'Each week, rebalance or top up the pool position once, and route one swap through the protocol.';
  if (c.includes('lend') || c.includes('cdp')) return 'Each week, adjust the supply once, or borrow and repay a small amount so the position stays active.';
  if (c.includes('staking') || c.includes('restak')) return 'Each week, restake the rewards or add a little more stake so the position keeps growing.';
  return 'Each week, make one more qualifying action: a deposit, a swap, a borrow-and-repay, or a vote when one is live.';
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  const suffix = ` Cost: ${step.cost}. Time: ${step.time}.`;
  let text = step.text.trim();
  if (text.length + suffix.length > 600) text = `${text.slice(0, 600 - suffix.length - 3)}...`;
  let s = `${text}${suffix}`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age, growth), never from a list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const gas = gasPhrases(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(p, age);
  const second = p.chains.length > 1 ? p.chains[1]! : null;
  const half = Math.max(25, Math.round(capital / 2));
  const steps: FarmStep[] = [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, fund it with ${gas.setup} for the first transactions, and keep its seed phrase offline.`,
      cost: gas.setup,
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gas.setup}`,
      time: '20 minutes to set up',
    },
    {
      text:
        second !== null
          ? `Open a second, smaller position of $${half} on ${second} so the activity spans two chains instead of one.`
          : `Add a second position of $${half} in a different pool or vault of ${p.name} so the activity is not a single transaction.`,
      cost: `$${half} of capital and ${gas.setup}`,
      time: '15 minutes',
    },
    {
      text: weeklyActionFor(p),
      cost: gas.weekly,
      time: '15 minutes a week',
    },
    {
      text: `Hold the positions for at least ${hold} days so the activity lands in more than one snapshot window.`,
      cost: `the $${capital} stays in the positions`,
      time: `${hold} days`,
    },
    {
      text: `Check ${p.name}'s own points or rewards page once a week, and join a vote or discussion when one is open; claim only from a link the protocol itself publishes, and never pay anyone to claim.`,
      cost: 'no fee to check',
      time: '10 minutes a week',
    },
    {
      text: `Keep a farm log with the wallet, the dates and every transaction hash, and unwind in reverse order when you leave: claim first, then withdraw, then close the wallet's approvals.`,
      cost: `exit gas of ${gas.setup}`,
      time: '20 minutes to unwind',
    },
  ];
  return steps.map(stepText);
}
