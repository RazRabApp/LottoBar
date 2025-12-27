// server/init-db.js - ИСПРАВЛЕННАЯ ВЕРСИЯ ДЛЯ МИГРАЦИЙ
const { pool } = require('./db');

async function migrateDatabase() {
    console.log('🔄 Начало миграции базы данных...');
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('📝 Создаем расширение для UUID...');
        await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        
        console.log('👤 Проверяем таблицу users...');
        
        // Таблица пользователей
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id BIGSERIAL PRIMARY KEY,
                telegram_id VARCHAR(100) UNIQUE NOT NULL,
                username VARCHAR(100),
                first_name VARCHAR(100),
                last_name VARCHAR(100),
                balance DECIMAL(12,2) DEFAULT 1000.00,
                total_won DECIMAL(12,2) DEFAULT 0.00,
                tickets_purchased INTEGER DEFAULT 0,
                is_active BOOLEAN DEFAULT TRUE,
                is_blocked BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                last_active TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        console.log('🎰 Проверяем таблицу draws...');
        
        // Таблица тиражей
        await client.query(`
            CREATE TABLE IF NOT EXISTS draws (
                id BIGSERIAL PRIMARY KEY,
                draw_number VARCHAR(50) UNIQUE NOT NULL,
                draw_time TIMESTAMP WITH TIME ZONE NOT NULL,
                status VARCHAR(20) DEFAULT 'scheduled',
                prize_pool DECIMAL(12,2) DEFAULT 10000.00,
                jackpot_balance DECIMAL(12,2) DEFAULT 10000.00,
                total_tickets INTEGER DEFAULT 0,
                winning_numbers INTEGER[],
                winning_proof JSONB,
                verification_hash VARCHAR(255),
                winners_count INTEGER DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP WITH TIME ZONE
            );
        `);
        
        console.log('🎫 Проверяем таблицу tickets...');
        
        // Таблица билетов
        await client.query(`
            CREATE TABLE IF NOT EXISTS tickets (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                telegram_id VARCHAR(100) NOT NULL,
                draw_id BIGINT NOT NULL,
                ticket_number VARCHAR(100) UNIQUE NOT NULL,
                numbers INTEGER[] NOT NULL,
                numbers_hash VARCHAR(255) NOT NULL,
                verification_hash VARCHAR(255) NOT NULL,
                signed_data TEXT,
                price DECIMAL(10,2) DEFAULT 50.00,
                status VARCHAR(20) DEFAULT 'active',
                win_amount DECIMAL(12,2) DEFAULT 0.00,
                matched_count INTEGER DEFAULT 0,
                matched_numbers INTEGER[] DEFAULT '{}',
                checked_at TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        console.log('💰 Проверяем таблицу transactions...');
        
        // Таблица транзакций
        await client.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                telegram_id VARCHAR(100) NOT NULL,
                type VARCHAR(50) NOT NULL,
                amount DECIMAL(12,2) NOT NULL,
                description TEXT,
                reference_id VARCHAR(100),
                status VARCHAR(20) DEFAULT 'completed',
                metadata JSONB,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        console.log('🔑 Проверяем таблицу user_sessions...');
        
        // Таблица сессий
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                telegram_id VARCHAR(100) NOT NULL,
                token VARCHAR(255) UNIQUE NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                last_used TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        console.log('⚙️  Проверяем таблицу system_settings...');
        
        // Таблица настроек
        await client.query(`
            CREATE TABLE IF NOT EXISTS system_settings (
                id BIGSERIAL PRIMARY KEY,
                key VARCHAR(100) UNIQUE NOT NULL,
                value TEXT,
                description TEXT,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        console.log('📦 Проверяем таблицу draws_archive...');
        
        // Таблица архива
        await client.query(`
            CREATE TABLE IF NOT EXISTS draws_archive (
                id BIGSERIAL PRIMARY KEY,
                original_draw_id BIGINT,
                draw_number VARCHAR(50) NOT NULL,
                draw_time TIMESTAMP WITH TIME ZONE NOT NULL,
                status VARCHAR(20),
                prize_pool DECIMAL(12,2),
                total_tickets INTEGER,
                winning_numbers INTEGER[],
                winning_proof JSONB,
                verification_hash VARCHAR(255),
                winners_count INTEGER,
                archived_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        // Добавляем внешние ключи если их нет
        console.log('🔗 Добавляем внешние ключи...');
        
        try {
            await client.query(`
                ALTER TABLE tickets 
                ADD CONSTRAINT fk_tickets_user_id 
                FOREIGN KEY (user_id) REFERENCES users(id) 
                ON DELETE CASCADE;
            `);
        } catch (e) {
            console.log('   Внешний ключ fk_tickets_user_id уже существует');
        }
        
        try {
            await client.query(`
                ALTER TABLE tickets 
                ADD CONSTRAINT fk_tickets_draw_id 
                FOREIGN KEY (draw_id) REFERENCES draws(id) 
                ON DELETE CASCADE;
            `);
        } catch (e) {
            console.log('   Внешний ключ fk_tickets_draw_id уже существует');
        }
        
        try {
            await client.query(`
                ALTER TABLE transactions 
                ADD CONSTRAINT fk_transactions_user_id 
                FOREIGN KEY (user_id) REFERENCES users(id) 
                ON DELETE CASCADE;
            `);
        } catch (e) {
            console.log('   Внешний ключ fk_transactions_user_id уже существует');
        }
        
        try {
            await client.query(`
                ALTER TABLE user_sessions 
                ADD CONSTRAINT fk_user_sessions_user_id 
                FOREIGN KEY (user_id) REFERENCES users(id) 
                ON DELETE CASCADE;
            `);
        } catch (e) {
            console.log('   Внешний ключ fk_user_sessions_user_id уже существует');
        }
        
        // Создаем индексы
        console.log('📊 Создаем индексы...');
        
        const indexes = [
            { name: 'idx_users_telegram_id', sql: 'CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)' },
            { name: 'idx_draws_status_time', sql: 'CREATE INDEX IF NOT EXISTS idx_draws_status_time ON draws(status, draw_time)' },
            { name: 'idx_tickets_user_status', sql: 'CREATE INDEX IF NOT EXISTS idx_tickets_user_status ON tickets(user_id, status)' },
            { name: 'idx_tickets_telegram_id', sql: 'CREATE INDEX IF NOT EXISTS idx_tickets_telegram_id ON tickets(telegram_id)' },
            { name: 'idx_transactions_user_id', sql: 'CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id)' }
        ];
        
        for (const index of indexes) {
            try {
                await client.query(index.sql);
                console.log(`   ✅ Создан индекс: ${index.name}`);
            } catch (error) {
                console.log(`   ⚠️  Ошибка создания индекса ${index.name}: ${error.message}`);
            }
        }
        
        // Добавляем начальные настройки
        console.log('⚙️  Добавляем начальные настройки...');
        
        await client.query(`
            INSERT INTO system_settings (key, value, description)
            VALUES 
                ('ticket_price', '50', 'Стоимость билета в Stars'),
                ('draw_interval_minutes', '15', 'Интервал между тиражами в минутах'),
                ('draw_duration_minutes', '1', 'Длительность розыгрыша в минутах'),
                ('jackpot_amount', '10000', 'Размер джекпота в Stars'),
                ('numbers_to_select', '12', 'Количество чисел для выбора'),
                ('numbers_range_min', '1', 'Минимальное число'),
                ('numbers_range_max', '24', 'Максимальное число'),
                ('demo_mode', 'false', 'Режим демо (true/false)'),
                ('system_version', '6.0.0', 'Версия системы')
            ON CONFLICT (key) DO UPDATE SET 
                value = EXCLUDED.value,
                description = EXCLUDED.description,
                updated_at = CURRENT_TIMESTAMP;
        `);
        
        // Проверяем наличие активного тиража
        console.log('🎰 Проверяем активный тираж...');
        
        const activeDraw = await client.query(`
            SELECT * FROM draws 
            WHERE status IN ('scheduled', 'drawing')
            LIMIT 1
        `);
        
        if (activeDraw.rows.length === 0) {
            console.log('🎰 Создаем начальный тираж...');
            
            await client.query(`
                INSERT INTO draws (
                    draw_number, 
                    draw_time, 
                    status, 
                    prize_pool, 
                    jackpot_balance,
                    total_tickets,
                    created_at,
                    updated_at
                ) VALUES (
                    'ТИРАЖ-0001', 
                    NOW() + INTERVAL '15 minutes', 
                    'scheduled', 
                    10000, 
                    10000,
                    0,
                    NOW(),
                    NOW()
                )
            `);
            
            console.log('✅ Создан начальный тираж: ТИРАЖ-0001');
        } else {
            console.log(`📊 Найден активный тираж: ${activeDraw.rows[0].draw_number}`);
        }
        
        await client.query('COMMIT');
        
        console.log('✅ Миграция базы данных завершена успешно');
        
        // Выводим статистику
        const stats = await client.query(`
            SELECT 
                (SELECT COUNT(*) FROM users) as users_count,
                (SELECT COUNT(*) FROM draws) as draws_count,
                (SELECT COUNT(*) FROM tickets) as tickets_count,
                (SELECT COUNT(*) FROM transactions) as transactions_count
        `);
        
        console.log('\n📊 СТАТИСТИКА БАЗЫ ДАННЫХ:');
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
            hint: error.hint
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
            console.error('💥 Критическая ошибка миграций:', error);
            process.exit(1);
        });
}
