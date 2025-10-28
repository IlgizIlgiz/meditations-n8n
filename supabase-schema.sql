-- Таблица пользователей для Meditation Bot
-- Заменяет Redis для персистентного хранения данных пользователей

CREATE TABLE IF NOT EXISTS users (
  chat_id BIGINT PRIMARY KEY,
  name TEXT,  -- Имя для медитаций (может отличаться от telegram_first_name)
  telegram_first_name TEXT,
  telegram_username TEXT,
  state TEXT,  -- Текущее состояние: 'set_name' | 'awaiting_goal' | NULL
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Индекс для быстрого поиска по состоянию
CREATE INDEX IF NOT EXISTS idx_users_state ON users(state);

-- Индекс для поиска по дате создания
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);

-- Триггер для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Комментарии к полям
COMMENT ON TABLE users IS 'Таблица пользователей для Meditation Bot';
COMMENT ON COLUMN users.chat_id IS 'Telegram chat ID (уникальный идентификатор)';
COMMENT ON COLUMN users.name IS 'Имя пользователя для медитаций (вводится вручную)';
COMMENT ON COLUMN users.telegram_first_name IS 'Имя из профиля Telegram';
COMMENT ON COLUMN users.telegram_username IS 'Username из Telegram (@username)';
COMMENT ON COLUMN users.state IS 'Текущий шаг в диалоге: set_name (ожидает имя), awaiting_goal (ожидает цель), NULL (готов)';
COMMENT ON COLUMN users.created_at IS 'Дата первого взаимодействия с ботом';
COMMENT ON COLUMN users.updated_at IS 'Дата последнего обновления профиля';

-- Тестовые данные (опционально, для разработки)
-- INSERT INTO users (chat_id, name, telegram_first_name, state) 
-- VALUES (123456789, 'Тестовый Пользователь', 'Test', NULL);

-- Запросы для управления:

-- Получить всех пользователей с именами
-- SELECT * FROM users WHERE name IS NOT NULL;

-- Получить пользователей в определенном состоянии
-- SELECT * FROM users WHERE state = 'awaiting_goal';

-- Очистить состояние пользователя
-- UPDATE users SET state = NULL WHERE chat_id = 123456789;

-- Удалить пользователя
-- DELETE FROM users WHERE chat_id = 123456789;

-- Статистика
-- SELECT 
--   COUNT(*) as total_users,
--   COUNT(name) as users_with_name,
--   COUNT(CASE WHEN state IS NOT NULL THEN 1 END) as users_in_process
-- FROM users;
