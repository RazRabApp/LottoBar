const { Pool } = require('pg');

// Проверка переменной окружения
if (!process.env.DATABASE_URL) {
    console.warn('⚠️  DATABASE_URL не настроен. Бот может работать некорректно.');
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Обработчики событий пула
pool.on('error', (err) => {
    console.error('❌ Ошибка пула БД:', err);
});

pool.on('connect', () => {
    console.log('🔗 Подключение к БД установлено');
});

async function initializeDatabase() {
    const client = await pool.connect();
    
    try {
        console.log('🔧 Инициализация структуры базы данных...');
        
        await client.query(`
            -- Таблица пользователей
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                telegram_id BIGINT UNIQUE NOT NULL,
                username VARCHAR(100),
                first_name VARCHAR(100),
                last_name VARCHAR(100),
                balance DECIMAL(10,2) DEFAULT 1000.00,
                total_won DECIMAL(10,2) DEFAULT 0.00,
                is_admin BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_blocked BOOLEAN DEFAULT FALSE
            );
            
            -- Таблица тиражей
            CREATE TABLE IF NOT EXISTS draws (
                id SERIAL PRIMARY KEY,
                draw_number VARCHAR(50) UNIQUE NOT NULL,
                draw_time TIMESTAMP NOT NULL,
                status VARCHAR(20) DEFAULT 'scheduled',
                prize_pool DECIMAL(10,2) DEFAULT 10000.00,
                jackpot_balance DECIMAL(10,2) DEFAULT 10000.00,
                total_tickets INTEGER DEFAULT 0,
                winning_numbers INTEGER[],
                winners_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Таблица билетов
            CREATE TABLE IF NOT EXISTS tickets (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                draw_id INTEGER REFERENCES draws(id) ON DELETE CASCADE,
                ticket_number VARCHAR(50) UNIQUE NOT NULL,
                numbers INTEGER[] NOT NULL,
                price DECIMAL(10,2) DEFAULT 50.00,
                status VARCHAR(20) DEFAULT 'active',
                win_amount DECIMAL(10,2) DEFAULT 0.00,
                matched_count INTEGER DEFAULT 0,
                matched_numbers INTEGER[] DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                checked_at TIMESTAMP
            );
            
            -- Таблица транзакций
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                type VARCHAR(50) NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                description TEXT,
                status VARCHAR(20) DEFAULT 'completed',
                reference_id VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Индексы для производительности
            CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
            CREATE INDEX IF NOT EXISTS idx_users_balance ON users(balance);
            CREATE INDEX IF NOT EXISTS idx_draws_status_time ON draws(status, draw_time);
            CREATE INDEX IF NOT EXISTS idx_draws_number ON draws(draw_number);
            CREATE INDEX IF NOT EXISTS idx_tickets_user_draw ON tickets(user_id, draw_id);
            CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
            CREATE INDEX IF NOT EXISTS idx_tickets_number ON tickets(ticket_number);
            CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
            CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);
        `);
        
        console.log('✅ Структура базы данных инициализирована');
        
    } catch (error) {
        console.error('❌ Ошибка инициализации базы данных:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Функция для тестирования подключения
async function testConnection() {
    try {
        const result = await pool.query('SELECT NOW() as current_time');
        return { 
            success: true, 
            time: result.rows[0].current_time,
            message: '✅ Подключение к БД установлено успешно'
        };
    } catch (error) {
        return { 
            success: false, 
            error: error.message,
            message: '❌ Ошибка подключения к БД'
        };
    }
}

module.exports = { 
    pool, 
    initializeDatabase,
    testConnection 
};

