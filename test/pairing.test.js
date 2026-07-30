import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRound, buildHistory, standings } from '../src/pairing.js';

/** Симулює турнір: генерує N раундів і випадково проставляє рахунок. */
function simulate({ format, courts, playerCount, points, roundCount, seed = 7 }) {
  const playerIds = Array.from({ length: playerCount }, (_, i) => i + 1);
  const rounds = [];
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  for (let i = 0; i < roundCount; i++) {
    const r = generateRound({ format, courts, playerIds, rounds, seed: seed + i });
    for (const m of r.matches) {
      const a = Math.floor(rnd() * (points + 1));
      m.scoreA = a;
      m.scoreB = points - a;
    }
    rounds.push(r);
  }
  return { playerIds, rounds };
}

test('кожен раунд заповнює всі корти й не дублює гравців', () => {
  for (const format of ['americano', 'mexicano']) {
    const { rounds } = simulate({ format, courts: 3, playerCount: 14, points: 21, roundCount: 12 });
    for (const r of rounds) {
      assert.equal(r.matches.length, 3, 'має бути 3 матчі');
      const ids = r.matches.flatMap((m) => [m.a1, m.a2, m.b1, m.b2]);
      assert.equal(new Set(ids).size, 12, `${format}: гравець не може бути у двох матчах`);
      assert.equal(r.byes.length, 2, 'двоє відпочивають');
      for (const b of r.byes) assert.ok(!ids.includes(b), 'той хто відпочиває не грає');
    }
  }
});

test('кількість кортів обмежується кількістю гравців', () => {
  const { rounds } = simulate({
    format: 'americano',
    courts: 5,
    playerCount: 9,
    points: 21,
    roundCount: 4,
  });
  for (const r of rounds) {
    assert.equal(r.matches.length, 2, '9 гравців -> 2 корти');
    assert.equal(r.byes.length, 1);
  }
});

test('відпочинок розподіляється рівномірно', () => {
  const { playerIds, rounds } = simulate({
    format: 'americano',
    courts: 2,
    playerCount: 11,
    points: 21,
    roundCount: 33,
  });
  const { stats } = buildHistory(playerIds, rounds);
  const byes = playerIds.map((id) => stats.get(id).byes);
  assert.ok(Math.max(...byes) - Math.min(...byes) <= 1, `нерівний відпочинок: ${byes}`);
});

test('американо мінімізує повтори партнерів', () => {
  const playerIds = Array.from({ length: 8 }, (_, i) => i + 1);
  const rounds = [];
  // 8 гравців, 2 корти: за 7 раундів кожен має зіграти з кожним рівно раз
  for (let i = 0; i < 7; i++) {
    const r = generateRound({
      format: 'americano',
      courts: 2,
      playerIds,
      rounds,
      seed: 100 + i,
    });
    for (const m of r.matches) {
      m.scoreA = 12;
      m.scoreB = 9;
    }
    rounds.push(r);
  }
  const hist = buildHistory(playerIds, rounds);
  let repeats = 0;
  for (let a = 0; a < playerIds.length; a++)
    for (let b = a + 1; b < playerIds.length; b++) {
      const c = hist.partnerCount(playerIds[a], playerIds[b]);
      if (c > 1) repeats += c - 1;
    }
  assert.equal(repeats, 0, 'за 7 раундів повторів партнерів бути не має');
});

test('мексикано ставить лідерів на перший корт', () => {
  const playerIds = [1, 2, 3, 4, 5, 6, 7, 8];
  const rounds = [
    {
      number: 1,
      byes: [],
      matches: [
        { court: 1, a1: 1, a2: 2, b1: 3, b2: 4, scoreA: 21, scoreB: 5 },
        { court: 2, a1: 5, a2: 6, b1: 7, b2: 8, scoreA: 15, scoreB: 11 },
      ],
    },
  ];
  const next = generateRound({ format: 'mexicano', courts: 2, playerIds, rounds, seed: 3 });
  const court1 = next.matches.find((m) => m.court === 1);
  const top = new Set([court1.a1, court1.a2, court1.b1, court1.b2]);
  assert.ok(top.has(1) && top.has(2), 'переможці 21:5 мають бути на 1 корті');
  // 1+4 проти 2+3 за рейтингом
  assert.deepEqual(
    [court1.a1, court1.b1].sort((x, y) => x - y).length,
    2,
  );
});

test('таблиця рахує і мʼячі, і виграні ігри', () => {
  const playerIds = [1, 2, 3, 4];
  const rounds = [
    {
      number: 1,
      byes: [],
      matches: [{ court: 1, a1: 1, a2: 2, b1: 3, b2: 4, scoreA: 21, scoreB: 14 }],
    },
    {
      number: 2,
      byes: [],
      matches: [{ court: 1, a1: 1, a2: 3, b1: 2, b2: 4, scoreA: 10, scoreB: 21 }],
    },
  ];
  const names = new Map([
    [1, 'A'],
    [2, 'B'],
    [3, 'C'],
    [4, 'D'],
  ]);
  const table = standings(playerIds, rounds, names);
  const byName = Object.fromEntries(table.map((r) => [r.name, r]));
  assert.equal(byName.A.wins, 1);
  assert.equal(byName.A.losses, 1);
  assert.equal(byName.A.pointsFor, 31);
  assert.equal(byName.B.wins, 2);
  assert.equal(byName.B.pointsFor, 42);
  assert.equal(byName.D.wins, 1);
  assert.equal(byName.D.pointsFor, 35);
  assert.equal(table[0].name, 'B', 'B має бути першим');
});

test('незакінчені матчі не потрапляють у статистику', () => {
  const playerIds = [1, 2, 3, 4];
  const rounds = [
    {
      number: 1,
      byes: [],
      matches: [{ court: 1, a1: 1, a2: 2, b1: 3, b2: 4, scoreA: null, scoreB: null }],
    },
  ];
  const table = standings(playerIds, rounds);
  assert.equal(table[0].gamesPlayed, 0);
  const hist = buildHistory(playerIds, rounds);
  assert.equal(hist.partnerCount(1, 2), 1, 'пара врахована для жеребкування');
});

test('турнір може тривати як завгодно довго', () => {
  const { playerIds, rounds } = simulate({
    format: 'mexicano',
    courts: 4,
    playerCount: 16,
    points: 24,
    roundCount: 60,
  });
  assert.equal(rounds.length, 60);
  const table = standings(playerIds, rounds);
  assert.equal(
    table.reduce((s, r) => s + r.gamesPlayed, 0),
    60 * 4 * 4,
  );
});
