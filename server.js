import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { query, withTransaction, initDb } from './src/db.js';
import { generateRound, standings, buildHistory } from './src/pairing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

const api = express.Router();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);
const notFound = (msg) => new HttpError(404, msg);

/* ------------------------------------------------------------------ гравці */

api.get('/players', async (_req, res) => {
  const { rows } = await query(
    `SELECT p.id, p.name,
            COUNT(DISTINCT tp.tournament_id)::int AS tournaments
       FROM players p
       LEFT JOIN tournament_players tp ON tp.player_id = p.id
      WHERE p.archived = FALSE
      GROUP BY p.id
      ORDER BY lower(p.name)`,
  );
  res.json(rows);
});

api.post('/players', async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) throw bad("Вкажіть імʼя гравця");
  if (name.length > 40) throw bad("Занадто довге імʼя");
  const { rows } = await query(
    `INSERT INTO players (name) VALUES ($1)
     ON CONFLICT (lower(name)) DO UPDATE SET archived = FALSE
     RETURNING id, name`,
    [name],
  );
  res.status(201).json(rows[0]);
});

api.patch('/players/:id', async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) throw bad("Вкажіть імʼя гравця");
  const { rows } = await query('UPDATE players SET name = $1 WHERE id = $2 RETURNING id, name', [
    name,
    req.params.id,
  ]);
  if (!rows[0]) throw notFound('Гравця не знайдено');
  res.json(rows[0]);
});

api.delete('/players/:id', async (req, res) => {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS n FROM tournament_players WHERE player_id = $1',
    [req.params.id],
  );
  if (rows[0].n > 0) {
    await query('UPDATE players SET archived = TRUE WHERE id = $1', [req.params.id]);
  } else {
    await query('DELETE FROM players WHERE id = $1', [req.params.id]);
  }
  res.json({ ok: true });
});

/* --------------------------------------------------------------- турніри */

api.get('/tournaments', async (_req, res) => {
  const { rows } = await query(
    `SELECT t.id, t.name, t.format, t.courts, t.points_per_game AS "pointsPerGame",
            t.status, t.created_at AS "createdAt",
            (SELECT COUNT(*)::int FROM tournament_players tp WHERE tp.tournament_id = t.id) AS "playerCount",
            (SELECT COUNT(*)::int FROM rounds r WHERE r.tournament_id = t.id) AS "roundCount"
       FROM tournaments t
      ORDER BY t.created_at DESC`,
  );
  res.json(rows);
});

api.post('/tournaments', async (req, res) => {
  const name = String(req.body?.name ?? '').trim() || 'Турнір';
  const format = req.body?.format === 'mexicano' ? 'mexicano' : 'americano';
  const courts = Number(req.body?.courts);
  const pointsPerGame = Number(req.body?.pointsPerGame);
  const playerIds = Array.isArray(req.body?.playerIds) ? [...new Set(req.body.playerIds.map(Number))] : [];

  if (!Number.isInteger(courts) || courts < 1 || courts > 12) throw bad('Кількість кортів: 1–12');
  if (!Number.isInteger(pointsPerGame) || pointsPerGame < 1 || pointsPerGame > 200)
    throw bad('Кількість поінтів: 1–200');
  if (playerIds.length < 4) throw bad('Потрібно щонайменше 4 гравці');

  const tournament = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO tournaments (name, format, courts, points_per_game)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [name, format, courts, pointsPerGame],
    );
    const id = rows[0].id;
    for (const pid of playerIds) {
      await client.query(
        'INSERT INTO tournament_players (tournament_id, player_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [id, pid],
      );
    }
    return id;
  });

  res.status(201).json(await loadTournament(tournament));
});

async function loadTournament(id) {
  const { rows: trows } = await query(
    `SELECT id, name, format, courts, points_per_game AS "pointsPerGame", status,
            created_at AS "createdAt"
       FROM tournaments WHERE id = $1`,
    [id],
  );
  const tournament = trows[0];
  if (!tournament) throw notFound('Турнір не знайдено');

  const { rows: players } = await query(
    `SELECT p.id, p.name FROM tournament_players tp
       JOIN players p ON p.id = tp.player_id
      WHERE tp.tournament_id = $1
      ORDER BY tp.joined_at, p.id`,
    [id],
  );

  const { rows: roundRows } = await query(
    'SELECT id, number FROM rounds WHERE tournament_id = $1 ORDER BY number',
    [id],
  );
  const roundIds = roundRows.map((r) => r.id);

  let matchRows = [];
  let byeRows = [];
  if (roundIds.length) {
    ({ rows: matchRows } = await query(
      `SELECT id, round_id AS "roundId", court, a1, a2, b1, b2,
              score_a AS "scoreA", score_b AS "scoreB"
         FROM matches WHERE round_id = ANY($1::int[]) ORDER BY court`,
      [roundIds],
    ));
    ({ rows: byeRows } = await query(
      'SELECT round_id AS "roundId", player_id AS "playerId" FROM round_byes WHERE round_id = ANY($1::int[])',
      [roundIds],
    ));
  }

  const rounds = roundRows.map((r) => ({
    id: r.id,
    number: r.number,
    matches: matchRows.filter((m) => m.roundId === r.id),
    byes: byeRows.filter((b) => b.roundId === r.id).map((b) => b.playerId),
  }));

  const playerIds = players.map((p) => p.id);
  const names = new Map(players.map((p) => [p.id, p.name]));

  return {
    tournament,
    players,
    rounds,
    standings: standings(playerIds, rounds, names),
    complete: rounds.length > 0 && rounds.every((r) => r.matches.every((m) => m.scoreA != null && m.scoreB != null)),
  };
}

api.get('/tournaments/:id', async (req, res) => {
  res.json(await loadTournament(req.params.id));
});

api.patch('/tournaments/:id', async (req, res) => {
  const fields = [];
  const values = [];
  const set = (col, val) => {
    values.push(val);
    fields.push(`${col} = $${values.length}`);
  };
  if (req.body?.name != null) set('name', String(req.body.name).trim() || 'Турнір');
  if (req.body?.courts != null) {
    const c = Number(req.body.courts);
    if (!Number.isInteger(c) || c < 1 || c > 12) throw bad('Кількість кортів: 1–12');
    set('courts', c);
  }
  if (req.body?.pointsPerGame != null) {
    const p = Number(req.body.pointsPerGame);
    if (!Number.isInteger(p) || p < 1 || p > 200) throw bad('Кількість поінтів: 1–200');
    set('points_per_game', p);
  }
  if (req.body?.status != null) {
    if (!['active', 'finished'].includes(req.body.status)) throw bad('Невідомий статус');
    set('status', req.body.status);
  }
  if (!fields.length) throw bad('Нема що змінювати');
  values.push(req.params.id);
  await query(`UPDATE tournaments SET ${fields.join(', ')} WHERE id = $${values.length}`, values);
  res.json(await loadTournament(req.params.id));
});

api.delete('/tournaments/:id', async (req, res) => {
  await query('DELETE FROM tournaments WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

api.post('/tournaments/:id/players', async (req, res) => {
  const playerId = Number(req.body?.playerId);
  if (!Number.isInteger(playerId)) throw bad('Не вказано гравця');
  await query(
    'INSERT INTO tournament_players (tournament_id, player_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [req.params.id, playerId],
  );
  res.json(await loadTournament(req.params.id));
});

api.delete('/tournaments/:id/players/:playerId', async (req, res) => {
  const { rows } = await query(
    `SELECT 1 FROM matches m
       JOIN rounds r ON r.id = m.round_id
      WHERE r.tournament_id = $1
        AND $2 IN (m.a1, m.a2, m.b1, m.b2)
      LIMIT 1`,
    [req.params.id, req.params.playerId],
  );
  if (rows.length) throw bad('Гравець уже брав участь у матчах — його не можна прибрати');
  await query('DELETE FROM tournament_players WHERE tournament_id = $1 AND player_id = $2', [
    req.params.id,
    req.params.playerId,
  ]);
  res.json(await loadTournament(req.params.id));
});

/* ---------------------------------------------------------------- раунди */

api.post('/tournaments/:id/rounds', async (req, res) => {
  const state = await loadTournament(req.params.id);
  const playerIds = state.players.map((p) => p.id);
  if (playerIds.length < 4) throw bad('Потрібно щонайменше 4 гравці');

  const last = state.rounds[state.rounds.length - 1];
  if (last && last.matches.some((m) => m.scoreA == null || m.scoreB == null)) {
    throw bad('Спочатку внесіть рахунок усіх матчів поточного раунду');
  }

  const round = generateRound({
    format: state.tournament.format,
    courts: state.tournament.courts,
    playerIds,
    rounds: state.rounds,
  });

  await withTransaction(async (client) => {
    const { rows } = await client.query(
      'INSERT INTO rounds (tournament_id, number) VALUES ($1,$2) RETURNING id',
      [req.params.id, round.number],
    );
    const roundId = rows[0].id;
    for (const m of round.matches) {
      await client.query(
        'INSERT INTO matches (round_id, court, a1, a2, b1, b2) VALUES ($1,$2,$3,$4,$5,$6)',
        [roundId, m.court, m.a1, m.a2, m.b1, m.b2],
      );
    }
    for (const pid of round.byes) {
      await client.query('INSERT INTO round_byes (round_id, player_id) VALUES ($1,$2)', [
        roundId,
        pid,
      ]);
    }
  });

  res.status(201).json(await loadTournament(req.params.id));
});

api.delete('/tournaments/:id/rounds/last', async (req, res) => {
  const { rows } = await query(
    'SELECT id FROM rounds WHERE tournament_id = $1 ORDER BY number DESC LIMIT 1',
    [req.params.id],
  );
  if (!rows[0]) throw bad('Немає раундів');
  await query('DELETE FROM rounds WHERE id = $1', [rows[0].id]);
  res.json(await loadTournament(req.params.id));
});

/** Перегенерувати останній раунд (якщо жереб не сподобався). */
api.post('/tournaments/:id/rounds/reshuffle', async (req, res) => {
  const state = await loadTournament(req.params.id);
  const last = state.rounds[state.rounds.length - 1];
  if (!last) throw bad('Немає раундів');
  if (last.matches.some((m) => m.scoreA != null || m.scoreB != null)) {
    throw bad('У раунді вже є внесений рахунок');
  }
  const history = state.rounds.slice(0, -1);
  const round = generateRound({
    format: state.tournament.format,
    courts: state.tournament.courts,
    playerIds: state.players.map((p) => p.id),
    rounds: history,
  });
  await withTransaction(async (client) => {
    await client.query('DELETE FROM matches WHERE round_id = $1', [last.id]);
    await client.query('DELETE FROM round_byes WHERE round_id = $1', [last.id]);
    for (const m of round.matches) {
      await client.query(
        'INSERT INTO matches (round_id, court, a1, a2, b1, b2) VALUES ($1,$2,$3,$4,$5,$6)',
        [last.id, m.court, m.a1, m.a2, m.b1, m.b2],
      );
    }
    for (const pid of round.byes) {
      await client.query('INSERT INTO round_byes (round_id, player_id) VALUES ($1,$2)', [
        last.id,
        pid,
      ]);
    }
  });
  res.json(await loadTournament(req.params.id));
});

/* ---------------------------------------------------------------- матчі */

api.patch('/matches/:id', async (req, res) => {
  const parse = (v) => {
    if (v === null || v === '' || v === undefined) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 200) throw bad('Некоректний рахунок');
    return n;
  };
  const scoreA = parse(req.body?.scoreA);
  const scoreB = parse(req.body?.scoreB);
  const { rows } = await query(
    `UPDATE matches SET score_a = $1, score_b = $2 WHERE id = $3
     RETURNING round_id AS "roundId"`,
    [scoreA, scoreB, req.params.id],
  );
  if (!rows[0]) throw notFound('Матч не знайдено');
  const { rows: t } = await query('SELECT tournament_id AS id FROM rounds WHERE id = $1', [
    rows[0].roundId,
  ]);
  res.json(await loadTournament(t[0].id));
});

/** Ручна заміна гравця в матчі (хтось не прийшов / підмінили). */
api.patch('/matches/:id/lineup', async (req, res) => {
  const slots = ['a1', 'a2', 'b1', 'b2'];
  const updates = [];
  const values = [];
  for (const s of slots) {
    if (req.body?.[s] != null) {
      values.push(Number(req.body[s]));
      updates.push(`${s} = $${values.length}`);
    }
  }
  if (!updates.length) throw bad('Нема що змінювати');
  values.push(req.params.id);
  const { rows } = await query(
    `UPDATE matches SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING round_id AS "roundId"`,
    values,
  );
  if (!rows[0]) throw notFound('Матч не знайдено');
  const { rows: t } = await query('SELECT tournament_id AS id FROM rounds WHERE id = $1', [
    rows[0].roundId,
  ]);
  res.json(await loadTournament(t[0].id));
});

app.use('/api', api);
app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Внутрішня помилка' });
});

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Падел-турніри працюють на порті ${PORT}`));
  })
  .catch((err) => {
    console.error('Не вдалося ініціалізувати БД:', err);
    process.exit(1);
  });

export { app, buildHistory };
