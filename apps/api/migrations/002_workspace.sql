CREATE TABLE IF NOT EXISTS task_lists (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (user_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_default_list ON task_lists(user_id) WHERE is_default;
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  list_id UUID NOT NULL,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (user_id, list_id) REFERENCES task_lists(user_id, id)
);
CREATE INDEX IF NOT EXISTS tasks_owner ON tasks(user_id, created_at DESC, id);
CREATE TABLE IF NOT EXISTS habits (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS habits_owner ON habits(user_id);
CREATE TABLE IF NOT EXISTS habit_checks (
  habit_id UUID NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  checked_on DATE NOT NULL,
  PRIMARY KEY (habit_id, checked_on)
);
INSERT INTO task_lists(id, user_id, name, is_default)
SELECT gen_random_uuid(), id, '默认清单', TRUE FROM users
ON CONFLICT (user_id) WHERE is_default DO NOTHING;
