function clampBet(bet) {
  if (!Number.isInteger(bet) || bet <= 0) return null;
  if (bet > 1_000_000) return null;
  return bet;
}

function coinflip(choice, headsProb = 0.5) {
  const p = Math.max(0, Math.min(1, headsProb));
  const flip = Math.random() < p ? "heads" : "tails";
  return { flip, win: flip === choice };
}

// ---- SLOTS ----
// Base symbol weights + payout multipliers (same as before)
const SLOT_SYMBOLS = [
  { s: "🍒", w: 40, triple: 3 },
  { s: "🍋", w: 30, triple: 4 },
  { s: "🍇", w: 18, triple: 6 },
  { s: "🔔", w: 9, triple: 12 },
  { s: "💎", w: 3, triple: 30 },
];

function weightedPick(symbols) {
  const total = symbols.reduce((a, x) => a + x.w, 0);
  let r = Math.random() * total;
  for (const x of symbols) {
    r -= x.w;
    if (r <= 0) return x;
  }
  return symbols[0];
}

/**
 * winChance controls the probability of generating at least a pair/triple.
 * 0.0 => mostly random
 * 1.0 => forces wins almost always
 */
function slotsSpinWithWinChance(winChance = 0.28) {
  const p = Math.max(0, Math.min(1, winChance));

  let line;
  if (Math.random() < p) {
    // force a pair or triple
    const sym = weightedPick(SLOT_SYMBOLS).s;
    const makeTriple = Math.random() < 0.25; // within forced wins, 25% are triples
    if (makeTriple) {
      line = [sym, sym, sym];
    } else {
      // pair in a random position
      const other = weightedPick(SLOT_SYMBOLS).s;
      const patterns = [
        [sym, sym, other],
        [sym, other, sym],
        [other, sym, sym],
      ];
      line = patterns[Math.floor(Math.random() * patterns.length)];
    }
  } else {
    // normal random
    line = [
      weightedPick(SLOT_SYMBOLS).s,
      weightedPick(SLOT_SYMBOLS).s,
      weightedPick(SLOT_SYMBOLS).s,
    ];
  }

  const [a, b, c] = line;
  let mult = 0;

  if (a === b && b === c) {
    const sym = SLOT_SYMBOLS.find(x => x.s === a);
    mult = sym?.triple ?? 0;
  } else if (a === b || b === c || a === c) {
    mult = 1.3;
  }

  return { line, mult };
}

// ---- ROULETTE ----
function rouletteRoll() {
  const n = Math.floor(Math.random() * 37);
  const red = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
  const color = n === 0 ? "green" : (red.has(n) ? "red" : "black");
  const parity = (n === 0) ? null : (n % 2 === 0 ? "even" : "odd");
  return { n, color, parity };
}

function rouletteIsWin(roll, bet) {
  const { type, number } = bet;
  if (type === "red" || type === "black") return roll.color === type;
  if (type === "even" || type === "odd") return roll.parity === type;
  if (type === "number") return roll.n === number;
  return false;
}

function roulettePayoutMult(type) {
  if (type === "number") return 36;
  if (type === "red" || type === "black" || type === "even" || type === "odd") return 2;
  return 0;
}

/**
 * playerWinChance biases results toward the player winning approximately p of the time.
 * Uses rerolls to move outcome toward win/lose. (NOT shown in Discord.)
 */
function rouletteRollBiased(bet, playerWinChance = 0.47) {
  const p = Math.max(0, Math.min(1, playerWinChance));
  const payoutMult = roulettePayoutMult(bet.type);

  let roll = rouletteRoll();
  let win = rouletteIsWin(roll, bet);

  // Try a handful of rerolls to approach desired win rate.
  for (let i = 0; i < 6; i++) {
    const wantWin = Math.random() < p;
    if (win === wantWin) break;

    roll = rouletteRoll();
    win = rouletteIsWin(roll, bet);
  }

  return { ...roll, win, payoutMult };
}

// ---- BLACKJACK ----
function handValue(cards) {
  const ranks = cards.map(c => c.slice(0, c.length - 1));
  let total = 0;
  let aces = 0;

  for (const r of ranks) {
    if (r === "A") { aces++; total += 11; }
    else if (["K","Q","J"].includes(r)) total += 10;
    else total += parseInt(r, 10);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function newDeck() {
  const suits = ["♠","♥","♦","♣"];
  const ranks = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
  const deck = [];
  for (const s of suits) for (const r of ranks) deck.push(`${r}${s}`);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardRank(card) {
  return card.slice(0, card.length - 1);
}

function cardValueForPick(card) {
  const r = cardRank(card);
  if (r === "A") return 11;
  if (["K","Q","J"].includes(r)) return 10;
  return parseInt(r, 10);
}

function takeCardByPredicate(deck, predicate) {
  const idx = deck.findIndex(predicate);
  if (idx === -1) return null;
  return deck.splice(idx, 1)[0];
}

function drawHighCard(deck) {
  return (
    takeCardByPredicate(deck, c => ["A","K","Q","J","10"].includes(cardRank(c))) ||
    deck.pop()
  );
}

function drawLowCard(deck) {
  return (
    takeCardByPredicate(deck, c => ["2","3","4","5","6"].includes(cardRank(c))) ||
    deck.pop()
  );
}

/**
 * Deals initial blackjack hands with mild bias toward playerWinChance.
 * - If lucky (random < p): try to give player stronger start and dealer weaker
 * - If unlucky: opposite
 */
function dealBlackjackHandsBiased(deck, playerWinChance = 0.45) {
  const p = Math.max(0, Math.min(1, playerWinChance));
  const lucky = Math.random() < p;

  let player = [];
  let dealer = [];

  if (lucky) {
    // Try strong player hand
    player.push(drawHighCard(deck));
    player.push(drawHighCard(deck));
    // Try weaker dealer show
    dealer.push(drawLowCard(deck));
    dealer.push(drawLowCard(deck));
  } else {
    // Try strong dealer hand, weaker player hand
    player.push(drawLowCard(deck));
    player.push(drawLowCard(deck));
    dealer.push(drawHighCard(deck));
    dealer.push(drawHighCard(deck));
  }

  // Fallback safety (shouldn't happen)
  player = player.filter(Boolean);
  dealer = dealer.filter(Boolean);

  while (player.length < 2) player.push(deck.pop());
  while (dealer.length < 2) dealer.push(deck.pop());

  return { deck, player, dealer };
}

/**
 * Biased card draw during gameplay (subtle control):
 * - For player: if p high, slightly prefer low cards when close to bust
 * - For dealer: if p high, slightly prefer high cards that bust dealer less / help player win
 * This is intentionally mild; still playable and not fully rigged.
 */
function drawCardBiased(deck, playerWinChance = 0.45, who = "player") {
  const p = Math.max(0, Math.min(1, playerWinChance));

  // pick style:
  // higher p => help player more often
  const help = Math.random() < p;

  // Simple heuristic draws:
  if (who === "player") {
    // help player: more low cards (reduces bust risk)
    if (help) return drawLowCard(deck);
    return deck.pop();
  }

  // dealer draw:
  // help player => more high cards (dealer may bust or overshoot, but not guaranteed)
  if (help) {
    // 50/50 high vs normal to keep it mild
    if (Math.random() < 0.5) return drawHighCard(deck);
    return deck.pop();
  }
  return deck.pop();
}

// ---- DICE ----
function rollDiceBiased(guess, playerWinChance = 0.18) {
  const p = Math.max(0, Math.min(1, playerWinChance));
  if (p === 1) {
    return { roll: guess, win: true };
  }
  if (p === 0) {
    const miss = guess === 1 ? 2 : 1;
    return { roll: miss, win: false };
  }
  let roll = Math.floor(Math.random() * 6) + 1;
  let win = roll === guess;

  for (let i = 0; i < 5; i++) {
    const wantWin = Math.random() < p;
    if (win === wantWin) break;
    roll = Math.floor(Math.random() * 6) + 1;
    win = roll === guess;
  }

  return { roll, win };
}

// ---- HIGH-LOW ----
function randomRank(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function hiLoRound(guess, playerWinChance = 0.5) {
  const p = Math.max(0, Math.min(1, playerWinChance));
  const base = randomRank(2, 14);

  const higherPool = [];
  const lowerPool = [];
  for (let r = 2; r <= 14; r++) {
    if (r > base) higherPool.push(r);
    if (r < base) lowerPool.push(r);
  }

  let targetWin = Math.random() < p;
  let next = base;

  const tieChance = 0.08;
  if (Math.random() < tieChance) {
    next = base;
  } else if (guess === "higher") {
    if (higherPool.length === 0) targetWin = false;
    if (targetWin && higherPool.length) {
      next = higherPool[Math.floor(Math.random() * higherPool.length)];
    } else if (lowerPool.length) {
      next = lowerPool[Math.floor(Math.random() * lowerPool.length)];
    }
  } else {
    if (lowerPool.length === 0) targetWin = false;
    if (targetWin && lowerPool.length) {
      next = lowerPool[Math.floor(Math.random() * lowerPool.length)];
    } else if (higherPool.length) {
      next = higherPool[Math.floor(Math.random() * higherPool.length)];
    }
  }

  const win =
    next === base ? false : (guess === "higher" ? next > base : next < base);

  return { base, next, win, push: next === base };
}

module.exports = {
  clampBet,
  coinflip,
  slotsSpinWithWinChance,
  rouletteRollBiased,
  newDeck,
  handValue,
  dealBlackjackHandsBiased,
  drawCardBiased,
  rollDiceBiased,
  hiLoRound,
};
