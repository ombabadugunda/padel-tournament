CREATE TABLE IF NOT EXISTS players (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  archived    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS players_name_key ON players (lower(name));

CREATE TABLE IF NOT EXISTS tournaments (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  format          TEXT NOT NULL CHECK (format IN ('mexicano', 'americano')),
  courts          INT  NOT NULL CHECK (courts >= 1),
  points_per_game INT  NOT NULL CHECK (points_per_game >= 1),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tournament_players (
  tournament_id INT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id     INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, player_id)
);

CREATE TABLE IF NOT EXISTS rounds (
  id            SERIAL PRIMARY KEY,
  tournament_id INT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  number        INT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, number)
);

CREATE TABLE IF NOT EXISTS matches (
  id       SERIAL PRIMARY KEY,
  round_id INT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  court    INT NOT NULL,
  a1       INT NOT NULL REFERENCES players(id),
  a2       INT NOT NULL REFERENCES players(id),
  b1       INT NOT NULL REFERENCES players(id),
  b2       INT NOT NULL REFERENCES players(id),
  score_a  INT,
  score_b  INT
);

CREATE INDEX IF NOT EXISTS matches_round_idx ON matches (round_id);

CREATE TABLE IF NOT EXISTS round_byes (
  round_id  INT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  PRIMARY KEY (round_id, player_id)
);
