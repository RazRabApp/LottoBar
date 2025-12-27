const { pool } = require('./db');

async function migrateDatabase() {
    console.log('🔄 Начало миграции базы данных...');
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('📝 Создаем недостающие таблицы...');
        
        // Сначала создаем таблицу settings если ее нет
        await client.query(`
            CREATE TABLE IF NOT EXISTS settings (
                id SERIAL PRIMARY KEY,
                key VARCHAR(100) UNIQUE NOT NULL,
                value TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            INSERT INTO settings (key, value) 
            VALUES ('jackpot_balance', '10000')
            ON CONFLICT (key) DO NOTHING;
        `);
        
        console.log('👤 Проверяем и обновляем таблицу users...');
        
        // Сначала проверяем существование таблицы users
        const usersTableExists = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'users'
            )
        `);
        
        if (!usersTableExists.rows[0].exists) {
            console.log('📋 Таблица users не существует, создаем...');
            await client.query(`
                CREATE TABLE users (
                    id SERIAL PRIMARY KEY,
                    telegram_id BIGINT UNIQUE,
                    username VARCHAR(100),
                    first_name VARCHAR(100),
                    last_name VARCHAR(100),
                    balance DECIMAL(10,2) DEFAULT 1000.00,
                    total_won DECIMAL(10,2) DEFAULT 0.00,
                    is_demo BOOLEAN DEFAULT FALSE,
                    last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('✅ Таблица users создана');
        } else {
            // Таблица существует, добавляем недостающие колонки
            console.log('📋 Таблица users существует, проверяем колонки...');
            
            // Проверяем и добавляем колонку balance если ее нет
            const hasBalance = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'users' 
                AND column_name = 'balance'
            `);
            
            if (hasBalance.rows.length === 0) {
                console.log('➕ Добавляем колонку balance в users');
                await client.query('ALTER TABLE users ADD COLUMN balance DECIMAL(10,2) DEFAULT 1000.00');
            }
            
            // Проверяем и добавляем колонку total_won если ее нет
            const hasTotalWon = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'users' 
                AND column_name = 'total_won'
            `);
            
            if (hasTotalWon.rows.length === 0) {
                console.log('➕ Добавляем колонку total_won в users');
                await client.query('ALTER TABLE users ADD COLUMN total_won DECIMAL(10,2) DEFAULT 0.00');
            }
            
            // Обновляем балансы только для существующих записей
            const usersCount = await client.query('SELECT COUNT(*) FROM users');
            if (parseInt(usersCount.rows[0].count) > 0) {
                console.log('💰 Обновляем балансы пользователей...');
                await client.query(`
                    UPDATE users 
                    SET balance = 1000 
                    WHERE balance IS NULL OR balance = 0
                `);
                console.log(`✅ Обновлено ${usersCount.rows[0].count} пользователей`);
            }
        }
        
        console.log('🎫 Проверяем и обновляем таблицу tickets...');
        
        // Проверяем существование таблицы tickets
        const ticketsTableExists = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'tickets'
            )
        `);
        
        if (!ticketsTableExists.rows[0].exists) {
            console.log('📋 Таблица tickets не существует, создаем...');
            await client.query(`
                CREATE TABLE tickets (
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
                )
            `);
            console.log('✅ Таблица tickets создана');
        } else {
            // Таблица существует, проверяем колонки
            console.log('📋 Таблица tickets существует, проверяем колонки...');
            
            // Проверяем колонку matched_numbers
            const hasMatchedNumbers = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'tickets' 
                AND column_name = 'matched_numbers'
            `);
            
            if (hasMatchedNumbers.rows.length === 0) {
                console.log('➕ Добавляем колонку matched_numbers в tickets');
                await client.query('ALTER TABLE tickets ADD COLUMN matched_numbers INTEGER[] DEFAULT \'{}\'');
            }
            
            // Проверяем колонку matched_count
            const hasMatchedCount = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'tickets' 
                AND column_name = 'matched_count'
            `);
            
            if (hasMatchedCount.rows.length === 0) {
                console.log('➕ Добавляем колонку matched_count в tickets');
                await client.query('ALTER TABLE tickets ADD COLUMN matched_count INTEGER DEFAULT 0');
            }
        }
        
        console.log('🎰 Проверяем и обновляем таблицу draws...');
        
        // Проверяем существование таблицы draws
        const drawsTableExists = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'draws'
            )
        `);
        
        if (!drawsTableExists.rows[0].exists) {
            console.log('📋 Таблица draws не существует, создаем...');
            await client.query(`
                CREATE TABLE draws (
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
                )
            `);
            console.log('✅ Таблица draws создана');
        }
        
        console.log('🎰 Обновляем номера тиражей если нужно...');
        // Обновляем только если есть записи
        const drawsCount = await client.query('SELECT COUNT(*) FROM draws');
        if (parseInt(drawsCount.rows[0].count) > 0) {
            await client.query(`
                UPDATE draws 
                SET draw_number = 'ТИРАЖ-' || LPAD(
                    (EXTRACT(EPOCH FROM COALESCE(created_at, draw_time))::INTEGER % 10000)::TEXT,
                    4, '0'
                )
                WHERE draw_number NOT LIKE 'ТИРАЖ-%' 
                OR draw_number IS NULL;
            `);
        }
        
        console.log('📅 Проверяем активные тиражи...');
        const activeDraw = await client.query(
            "SELECT * FROM draws WHERE status IN ('scheduled', 'drawing') LIMIT 1"
        );
        
        if (activeDraw.rows.length === 0) {
            console.log('🎰 Нет активного тиража, создаем новый...');
            
            // Получаем следующий номер для тиража
            let nextNum = 1;
            try {
                const nextNumber = await client.query(`
                    SELECT COALESCE(
                        MAX(CAST(SUBSTRING(draw_number FROM 'ТИРАЖ-(\\d+)') AS INTEGER)), 
                        0
                    ) + 1 as next_num 
                    FROM draws 
                    WHERE draw_number LIKE 'ТИРАЖ-%'
                `);
                
                if (nextNumber.rows[0]?.next_num) {
                    nextNum = nextNumber.rows[0].next_num;
                }
            } catch (error) {
                console.log('⚠️ Не удалось получить следующий номер тиража, используем 1:', error.message);
            }
            
            const drawNumber = `ТИРАЖ-${String(nextNum).padStart(4, '0')}`;
            
            await client.query(`
                INSERT INTO draws (
                    draw_number, draw_time, status, prize_pool, 
                    total_tickets, jackpot_balance
                ) VALUES ($1, NOW() + INTERVAL '15 minutes', 'scheduled', 
                          10000, 0, 10000)
                RETURNING draw_number
            `, [drawNumber]);
            
            console.log(`✅ Создан новый тираж: ${drawNumber}`);
        } else {
            console.log(`📊 Найден активный тираж: ${activeDraw.rows[0].draw_number}`);
        }
        
        console.log('✅ Все таблицы проверены/созданы');
        
        // Проверяем таблицу transactions
        const transactionsTableExists = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'transactions'
            )
        `);
        
        if (!transactionsTableExists.rows[0].exists) {
            console.log('📋 Создаем таблицу transactions...');
            await client.query(`
                CREATE TABLE transactions (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    type VARCHAR(50) NOT NULL,
                    amount DECIMAL(10,2) NOT NULL,
                    description TEXT,
                    status VARCHAR(20) DEFAULT 'completed',
                    reference_id VARCHAR(100),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('✅ Таблица transactions создана');
        }
        
        // Создаем индексы для производительности
        console.log('📊 Создаем индексы для производительности...');
        
        const indexes = [
            { name: 'idx_users_telegram_id', sql: 'CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)' },
            { name: 'idx_users_balance', sql: 'CREATE INDEX IF NOT EXISTS idx_users_balance ON users(balance)' },
            { name: 'idx_draws_status_time', sql: 'CREATE INDEX IF NOT EXISTS idx_draws_status_time ON draws(status, draw_time)' },
            { name: 'idx_draws_number', sql: 'CREATE INDEX IF NOT EXISTS idx_draws_number ON draws(draw_number)' },
            { name: 'idx_tickets_user_draw', sql: 'CREATE INDEX IF NOT EXISTS idx_tickets_user_draw ON tickets(user_id, draw_id)' },
            { name: 'idx_tickets_status', sql: 'CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)' },
            { name: 'idx_tickets_number', sql: 'CREATE INDEX IF NOT EXISTS idx_tickets_number ON tickets(ticket_number)' },
            { name: 'idx_transactions_user', sql: 'CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id)' },
            { name: 'idx_transactions_created', sql: 'CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC)' }
        ];
        
        for (const index of indexes) {
            try {
                await client.query(index.sql);
                console.log(`   ✅ Создан индекс: ${index.name}`);
            } catch (error) {
                console.log(`   ⚠️  Не удалось создать индекс ${index.name}: ${error.message}`);
            }
        }
        
        await client.query('COMMIT');
        console.log('✅ Миграция базы данных завершена успешно');
        
        // Выводим итоговую статистику
        const stats = await client.query(`
            SELECT 
                (SELECT COUNT(*) FROM users) as users_count,
                (SELECT COUNT(*) FROM draws) as draws_count,
                (SELECT COUNT(*) FROM tickets) as tickets_count,
                (SELECT COUNT(*) FROM transactions) as transactions_count
        `);
        
        console.log('\n📊 ИТОГОВАЯ СТАТИСТИКА БАЗЫ ДАННЫХ:');
        console.log(`👤 Пользователей: ${stats.rows[0].users_count}`);
        console.log(`🎰 Тиражей: ${stats.rows[0].draws_count}`);
        console.log(`🎫 Билетов: ${stats.rows[0].tickets_count}`);
        console.log(`💰 Транзакций: ${stats.rows[0].transactions_count}`);
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Ошибка миграции:', error.message);
        console.error('🔧 Детали ошибки:', {
            code: error.code,
            detail: error.detail,
            hint: error.hint,
            position: error.position
        });
        throw error;
        
    } finally {
        client.release();
    }
}

module.exports = { migrateDatabase };

if (require.main === module) {
    migrateDatabase()
        .then(() => {
            console.log('🚀 Миграции выполнены, завершаем процесс');
            process.exit(0);
        })
        .catch(error => {
            console.error('💥 Критическая ошибка миграций:', error.message);
            console.log('⚠️  Продолжаем работу без миграций...');
            process.exit(0); // Выходим без ошибки, чтобы сервер запустился
        });
}