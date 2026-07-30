/**
 * Движок жеребкування для дружніх падел-турнірів.
 *
 * Формати:
 *  - americano: партнери постійно змінюються; алгоритм мінімізує повтори
 *               пар та суперників.
 *  - mexicano:  склад пар визначається поточним рейтингом. Гравці 1-2-3-4
 *               за рейтингом грають на 1-му корті (1+4 проти 2+3), 5-8 на
 *               2-му корті і так далі.
 *
 * Кількість раундів не обмежена — раунди генеруються на вимогу.
 */

const PARTNER_WEIGHT = 100; // повтор партнера штрафується сильніше
const OPPONENT_WEIGHT = 10;
const COURT_WEIGHT = 1;
const RESTARTS = 400;

/** Ключ для пари гравців, незалежно від порядку. */
function pk(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function emptyStat(id) {
  return {
    playerId: id,
    appearances: 0, // скільки разів був поставлений у розклад
    gamesPlayed: 0, // скільки матчів має внесений рахунок
    wins: 0,
    losses: 0,
    draws: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    byes: 0,
    lastCourt: null,
  };
}

/**
 * Збирає всю статистику й історію зустрічей.
 * @param {number[]} playerIds — гравці турніру
 * @param {Array} rounds — [{number, matches:[{a1,a2,b1,b2,scoreA,scoreB,court}], byes:[id]}]
 */
export function buildHistory(playerIds, rounds = []) {
  const stats = new Map();
  for (const id of playerIds) stats.set(id, emptyStat(id));
  const ensure = (id) => {
    if (!stats.has(id)) stats.set(id, emptyStat(id));
    return stats.get(id);
  };

  const partner = new Map(); // pk -> count
  const opponent = new Map(); // pk -> count
  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

  for (const round of rounds) {
    for (const m of round.matches || []) {
      const teamA = [m.a1, m.a2];
      const teamB = [m.b1, m.b2];
      bump(partner, pk(teamA[0], teamA[1]));
      bump(partner, pk(teamB[0], teamB[1]));
      for (const x of teamA) for (const y of teamB) bump(opponent, pk(x, y));

      for (const id of [...teamA, ...teamB]) {
        const s = ensure(id);
        s.appearances += 1;
        if (m.court != null) s.lastCourt = m.court;
      }

      const scored = m.scoreA != null && m.scoreB != null;
      if (!scored) continue;
      for (const id of teamA) {
        const s = ensure(id);
        s.gamesPlayed += 1;
        s.pointsFor += m.scoreA;
        s.pointsAgainst += m.scoreB;
        if (m.scoreA > m.scoreB) s.wins += 1;
        else if (m.scoreA < m.scoreB) s.losses += 1;
        else s.draws += 1;
      }
      for (const id of teamB) {
        const s = ensure(id);
        s.gamesPlayed += 1;
        s.pointsFor += m.scoreB;
        s.pointsAgainst += m.scoreA;
        if (m.scoreB > m.scoreA) s.wins += 1;
        else if (m.scoreB < m.scoreA) s.losses += 1;
        else s.draws += 1;
      }
    }
    for (const id of round.byes || []) ensure(id).byes += 1;
  }

  return {
    stats,
    partnerCount: (a, b) => partner.get(pk(a, b)) || 0,
    opponentCount: (a, b) => opponent.get(pk(a, b)) || 0,
  };
}

/**
 * Турнірна таблиця. Рахунок ведеться і по м'ячах, і по виграних іграх.
 */
export function standings(playerIds, rounds, names = new Map()) {
  const { stats } = buildHistory(playerIds, rounds);
  const rows = playerIds.map((id) => {
    const s = stats.get(id) || emptyStat(id);
    return {
      ...s,
      name: names.get(id) || `#${id}`,
      diff: s.pointsFor - s.pointsAgainst,
      avgPoints: s.gamesPlayed ? s.pointsFor / s.gamesPlayed : 0,
      winRate: s.gamesPlayed ? s.wins / s.gamesPlayed : 0,
    };
  });
  rows.sort(
    (x, y) =>
      y.wins - x.wins ||
      y.pointsFor - x.pointsFor ||
      y.diff - x.diff ||
      x.name.localeCompare(y.name, 'uk'),
  );
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

/** Рейтинг для Мексикано: середня кількість м'ячів за гру. */
function mexicanoRank(playerIds, stats, rng) {
  return [...playerIds]
    .map((id) => {
      const s = stats.get(id) || emptyStat(id);
      return {
        id,
        avg: s.gamesPlayed ? s.pointsFor / s.gamesPlayed : 0,
        wins: s.gamesPlayed ? s.wins / s.gamesPlayed : 0,
        diff: s.pointsFor - s.pointsAgainst,
        noise: rng(),
      };
    })
    .sort((a, b) => b.avg - a.avg || b.wins - a.wins || b.diff - a.diff || a.noise - b.noise)
    .map((r) => r.id);
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Вибирає, хто грає цього раунду, а хто відпочиває.
 * Відпочивають ті, хто відпочивав найменше і зіграв найбільше.
 */
export function selectActive(playerIds, courts, stats, rng) {
  const capacity = courts * 4;
  const maxPlayable = Math.floor(playerIds.length / 4) * 4;
  const activeCount = Math.min(capacity, maxPlayable);
  const restCount = playerIds.length - activeCount;
  if (activeCount < 4) {
    throw new Error('Потрібно щонайменше 4 гравці');
  }
  if (restCount === 0) {
    return { active: [...playerIds], resting: [], usedCourts: activeCount / 4 };
  }
  const ordered = shuffle(playerIds, rng).sort((x, y) => {
    const sx = stats.get(x) || emptyStat(x);
    const sy = stats.get(y) || emptyStat(y);
    // першими відпочивають ті, хто ще мало відпочивав і багато грав
    return sx.byes - sy.byes || sy.appearances - sx.appearances;
  });
  const resting = ordered.slice(0, restCount);
  const restSet = new Set(resting);
  return {
    active: playerIds.filter((id) => !restSet.has(id)),
    resting,
    usedCourts: activeCount / 4,
  };
}

/** Жадібне формування пар з випадковими рестартами (Американо). */
function americanoPairing(active, hist, rng) {
  let best = null;

  for (let attempt = 0; attempt < RESTARTS; attempt++) {
    const pool = shuffle(active, rng);
    const teams = [];
    while (pool.length) {
      const a = pool.shift();
      let bestIdx = 0;
      let bestCost = Infinity;
      for (let i = 0; i < pool.length; i++) {
        const cost = hist.partnerCount(a, pool[i]) * PARTNER_WEIGHT + hist.opponentCount(a, pool[i]);
        if (cost < bestCost) {
          bestCost = cost;
          bestIdx = i;
        }
      }
      const b = pool.splice(bestIdx, 1)[0];
      teams.push([a, b]);
    }

    // зводимо команди у матчі, мінімізуючи повтори суперників
    const rest = shuffle(teams, rng);
    const matches = [];
    while (rest.length) {
      const t1 = rest.shift();
      let bestIdx = 0;
      let bestCost = Infinity;
      for (let i = 0; i < rest.length; i++) {
        const t2 = rest[i];
        let cost = 0;
        for (const x of t1) for (const y of t2) cost += hist.opponentCount(x, y);
        if (cost < bestCost) {
          bestCost = cost;
          bestIdx = i;
        }
      }
      const t2 = rest.splice(bestIdx, 1)[0];
      matches.push([t1, t2]);
    }

    let total = 0;
    for (const [t1, t2] of matches) {
      total += hist.partnerCount(t1[0], t1[1]) * PARTNER_WEIGHT;
      total += hist.partnerCount(t2[0], t2[1]) * PARTNER_WEIGHT;
      for (const x of t1) for (const y of t2) total += hist.opponentCount(x, y) * OPPONENT_WEIGHT;
    }
    if (best === null || total < best.cost) best = { cost: total, matches };
    if (best.cost === 0) break;
  }

  return best.matches;
}

/** Мексикано: групи по 4 за рейтингом, у групі 1+4 проти 2+3. */
function mexicanoPairing(active, hist, rng) {
  const ranked = mexicanoRank(active, hist.stats, rng);
  const matches = [];
  for (let i = 0; i < ranked.length; i += 4) {
    const g = ranked.slice(i, i + 4);
    matches.push([
      [g[0], g[3]],
      [g[1], g[2]],
    ]);
  }
  return matches;
}

/**
 * Генерує наступний раунд.
 * @returns {{number:number, matches:Array, byes:number[]}}
 */
export function generateRound({ format, courts, playerIds, rounds = [], seed = null }) {
  const rng = mulberry32(seed ?? Math.floor(Math.random() * 2 ** 31));
  const hist = buildHistory(playerIds, rounds);
  const { active, resting } = selectActive(playerIds, courts, hist.stats, rng);

  const pairs =
    format === 'mexicano' ? mexicanoPairing(active, hist, rng) : americanoPairing(active, hist, rng);

  const matches = pairs.map(([teamA, teamB], i) => ({
    court: i + 1,
    a1: teamA[0],
    a2: teamA[1],
    b1: teamB[0],
    b2: teamB[1],
    scoreA: null,
    scoreB: null,
  }));

  return {
    number: rounds.length + 1,
    matches,
    byes: resting,
  };
}

export const _internal = { pk, mulberry32, shuffle, COURT_WEIGHT };
