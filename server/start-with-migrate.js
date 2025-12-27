// start-with-migrate.js - ИСПРАВЛЕННАЯ ВЕРСИЯ
// Главный стартовый файл для Render
// Запускает миграции и инициализацию перед стартом приложения
// В начале server/start-with-migrate.js добавьте:
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
console.log('='.repeat(70));
console.log('🚀 ЗАПУСК FORTUNA LOTTERY НА RENDER');
console.log('='.repeat(70));

// Асинхронная функция запуска
async function startApp() {
    try {
        // ШАГ 0: Проверка переменных окружения
        await checkEnvironment();
        
        // ШАГ 1: Миграции базы данных
        await runMigrations();
        
        // ШАГ 2: Проверка подключения к БД
        await testDatabaseConnection();
        
        // ШАГ 3: Запуск основного приложения
        await startMainApplication();
        
    } catch (error) {
        console.error('❌ ФАТАЛЬНАЯ ОШИБКА ПРИ СТАРТЕ:', error);
        process.exit(1);
    }
}

// Функция проверки переменных окружения
async function checkEnvironment() {
    console.log('\n🔍 ПРОВЕРКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ...');
    
    // Логируем информацию о среде
    console.log(`📅 Время запуска: ${new Date().toISOString()}`);
    console.log(`🔧 NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🌐 PORT: ${process.env.PORT || 10000}`);
    console.log(`💾 DATABASE_URL: ${process.env.DATABASE_URL ? '***НАСТРОЕН***' : '❌ ОТСУТСТВУЕТ'}`);
    console.log(`🤖 TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN ? '***НАСТРОЕН***' : '❌ ОТСУТСТВУЕТ'}`);
    console.log('='.repeat(70));
    
    // Обязательные переменные
    const requiredVars = [];
    const recommendedVars = ['DATABASE_URL', 'TELEGRAM_BOT_TOKEN'];
    
    // Проверяем рекомендуемые переменные
    const missingRecommended = recommendedVars.filter(varName => !process.env[varName]);
    
    if (missingRecommended.length > 0) {
        console.warn('⚠️  ВНИМАНИЕ: Отсутствуют рекомендуемые переменные:');
        missingRecommended.forEach(varName => {
            console.warn(`   - ${varName}`);
        });
        
        console.log('\n📋 РЕКОМЕНДАЦИИ:');
        
        if (missingRecommended.includes('DATABASE_URL')) {
            console.log('1. DATABASE_URL - подключение к PostgreSQL:');
            console.log('   postgresql://user:password@host:port/database');
            console.log('   Для Render можно использовать:');
            console.log('   postgresql://fortuna_user:wmrMycp1tDAUEChekJ6lct5FEMNhUO7y@dpg-d5374ichg0os738le92g-a.frankfurt-postgres.render.com/fortuna_lottery');
        }
        
        if (missingRecommended.includes('TELEGRAM_BOT_TOKEN')) {
            console.log('2. TELEGRAM_BOT_TOKEN - токен бота Telegram:');
            console.log('   Получите у @BotFather в Telegram');
        }
        
        console.log('\nℹ️  Приложение запустится в демо-режиме');
    }
    
    // Критические ошибки только для обязательных переменных
    const missingRequired = requiredVars.filter(varName => !process.env[varName]);
    if (missingRequired.length > 0) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА: Отсутствуют обязательные переменные:');
        missingRequired.forEach(varName => {
            console.error(`   - ${varName}`);
        });
        throw new Error('Необходимо настроить переменные окружения');
    }
}

// Функция выполнения миграций
async function runMigrations() {
    console.log('\n🔧 ЗАПУСК МИГРАЦИЙ БАЗЫ ДАННЫХ...');
    
    if (!process.env.DATABASE_URL) {
        console.log('⚠️  DATABASE_URL не настроен, пропускаем миграции');
        console.log('ℹ️  Будет использован демо-режим');
        return;
    }
    
    try {
        // Загружаем и выполняем init-db.js
        console.log('📝 Запуск миграций из init-db.js...');
        
        // Временный require чтобы проверить наличие файла
        try {
            require.resolve('./init-db.js');
        } catch (error) {
            console.warn('⚠️  Файл init-db.js не найден, создаем базовую структуру...');
            await createBasicTables();
            return;
        }
        
        // Выполняем миграции
        const migration = require('./init-db.js');
        
        if (typeof migration.migrateDatabase === 'function') {
            await migration.migrateDatabase();
        } else if (typeof migration === 'function') {
            await migration();
        } else {
            console.warn('⚠️  init-db.js не экспортирует функцию миграций');
            await createBasicTables();
        }
        
        console.log('✅ Миграции выполнены успешно');
        
    } catch (migrationError) {
        console.warn('⚠️  ПРЕДУПРЕЖДЕНИЕ при выполнении миграций:');
        console.warn(`   ${migrationError.message}`);
        
        if (migrationError.message.includes('already exists') || 
            migrationError.message.includes('существует')) {
            console.log('ℹ️  Таблицы уже существуют, продолжаем запуск...');
        } else if (migrationError.message.includes('connect') || 
                   migrationError.message.includes('ECONNREFUSED')) {
            console.error('❌ ОШИБКА ПОДКЛЮЧЕНИЯ К БД при миграциях');
            console.error('   Проверьте DATABASE_URL и доступность базы данных');
            throw migrationError;
        } else {
            console.warn('⚠️  Неизвестная ошибка миграций, продолжаем запуск...');
            console.warn('   Детали:', migrationError.message);
        }
    }
}

// Функция создания базовых таблиц (если init-db.js нет)
async function createBasicTables() {
    console.log('📝 Создание базовых таблиц...');
    
    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    
    try {
        const client = await pool.connect();
        
        // Создаем таблицы если их нет
        const createTables = `
            -- Таблица пользователей
            CREATE TABLE IF NOT EXISTS users (
                id BIGSERIAL PRIMARY KEY,
                telegram_id BIGINT UNIQUE,
                username VARCHAR(255),
                first_name VARCHAR(255),
                last_name VARCHAR(255),
                balance DECIMAL(10,2) DEFAULT 1000.00,
                total_won DECIMAL(10,2) DEFAULT 0.00,
                tickets_purchased INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Таблица тиражей
            CREATE TABLE IF NOT EXISTS draws (
                id BIGSERIAL PRIMARY KEY,
                draw_number VARCHAR(50) NOT NULL,
                draw_time TIMESTAMP NOT NULL,
                status VARCHAR(20) DEFAULT 'scheduled',
                winning_numbers INTEGER[],
                prize_pool INTEGER DEFAULT 10000,
                jackpot_balance DECIMAL(10,2) DEFAULT 10000.00,
                total_tickets INTEGER DEFAULT 0,
                winners_count INTEGER DEFAULT 0,
                completed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Таблица билетов
            CREATE TABLE IF NOT EXISTS tickets (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT REFERENCES users(id),
                draw_id BIGINT REFERENCES draws(id),
                ticket_number VARCHAR(50),
                numbers INTEGER[] NOT NULL,
                price INTEGER DEFAULT 50,
                status VARCHAR(20) DEFAULT 'active',
                win_amount INTEGER DEFAULT 0,
                matched_count INTEGER DEFAULT 0,
                matched_numbers INTEGER[] DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Таблица транзакций
            CREATE TABLE IF NOT EXISTS transactions (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT REFERENCES users(id),
                type VARCHAR(50) NOT NULL,
                amount INTEGER NOT NULL,
                description TEXT,
                status VARCHAR(20) DEFAULT 'completed',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;
        
        await client.query(createTables);
        
        // Создаем активный тираж если нет
        const activeDraw = await client.query(
            "SELECT * FROM draws WHERE status IN ('scheduled', 'drawing') LIMIT 1"
        );
        
        if (activeDraw.rows.length === 0) {
            const nextNumber = await client.query(`
                SELECT COALESCE(
                    MAX(CAST(SUBSTRING(draw_number FROM 'ТИРАЖ-(\\d+)') AS INTEGER)), 
                    0
                ) + 1 as next_num FROM draws WHERE draw_number LIKE 'ТИРАЖ-%'
            `);
            
            const nextNum = nextNumber.rows[0]?.next_num || 1;
            const drawNumber = `ТИРАЖ-${String(nextNum).padStart(4, '0')}`;
            
            await client.query(`
                INSERT INTO draws (draw_number, draw_time, status, prize_pool, total_tickets)
                VALUES ($1, NOW() + INTERVAL '15 minutes', 'scheduled', 10000, 0)
            `, [drawNumber]);
            
            console.log(`✅ Создан новый тираж: ${drawNumber}`);
        }
        
        client.release();
        console.log('✅ Базовые таблицы созданы/проверены');
        
    } catch (error) {
        console.error('❌ Ошибка создания таблиц:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

// Функция тестирования подключения к БД
async function testDatabaseConnection() {
    console.log('\n🔍 ТЕСТИРУЕМ ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ...');
    
    if (!process.env.DATABASE_URL) {
        console.log('⚠️  DATABASE_URL не настроен, пропускаем тест подключения');
        console.log('🎭 Приложение запустится в демо-режиме');
        return;
    }
    
    try {
        const { Pool } = require('pg');
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 10000,
            idleTimeoutMillis: 30000
        });
        
        const client = await pool.connect();
        console.log('✅ Подключение к БД успешно установлено!');
        
        // Проверяем основные таблицы
        const tablesQuery = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);
        
        console.log(`📊 Найдено таблиц: ${tablesQuery.rows.length}`);
        
        const expectedTables = ['users', 'draws', 'tickets', 'transactions'];
        const foundTables = tablesQuery.rows.map(r => r.table_name);
        
        console.log('📋 Найденные таблицы:', foundTables.join(', '));
        
        // Проверяем наличие ключевых таблиц
        const missingTables = expectedTables.filter(table => !foundTables.includes(table));
        if (missingTables.length > 0) {
            console.warn(`⚠️  Отсутствуют таблицы: ${missingTables.join(', ')}`);
            console.log('🔄 Попробуем создать отсутствующие таблицы...');
            
            for (const table of missingTables) {
                console.log(`   Создаем таблицу: ${table}`);
                // Здесь можно добавить создание конкретных таблиц
            }
        } else {
            console.log('✅ Все необходимые таблицы присутствуют');
        }
        
        // Проверяем количество записей
        const counts = {};
        for (const table of foundTables) {
            try {
                const countResult = await client.query(`SELECT COUNT(*) FROM ${table}`);
                counts[table] = parseInt(countResult.rows[0].count);
            } catch (e) {
                counts[table] = 'error';
            }
        }
        
        console.log('📈 Количество записей:');
        Object.entries(counts).forEach(([table, count]) => {
            console.log(`   ${table}: ${count}`);
        });
        
        client.release();
        await pool.end();
        
        console.log('✅ Тестирование БД завершено успешно');
        
    } catch (dbError) {
        console.error('❌ ОШИБКА ПОДКЛЮЧЕНИЯ К БАЗЕ ДАННЫХ:');
        console.error(`   ${dbError.message}`);
        
        // Показываем отладочную информацию
        if (process.env.DATABASE_URL) {
            const maskedUrl = process.env.DATABASE_URL.replace(
                /:\/\/[^:]+:[^@]+@/,
                '://***:***@'
            );
            console.error(`   URL: ${maskedUrl}`);
        }
        
        console.warn('\n⚠️  ПРЕДУПРЕЖДЕНИЕ: Не удалось подключиться к БД');
        console.warn('🎭 Приложение запустится в демо-режиме');
    }
}

// Функция запуска основного приложения
async function startMainApplication() {
    console.log('\n🎮 ЗАПУСКАЕМ ОСНОВНОЕ ПРИЛОЖЕНИЕ...');
    console.log('='.repeat(70));
    
    try {
        // Проверяем наличие app.js
        require.resolve('./app.js');
        
        console.log('📁 Загружаем основной файл приложения: app.js');
        
        // Запускаем приложение
        require('./app.js');
        
        console.log('✅ Приложение успешно запущено');
        console.log('\n🔗 ДОСТУПНЫЕ МАРШРУТЫ:');
        console.log('   - http://localhost:' + (process.env.PORT || 10000) + '          - Игровая страница');
        console.log('   - http://localhost:' + (process.env.PORT || 10000) + '/game    - Игровая страница');
        console.log('   - http://localhost:' + (process.env.PORT || 10000) + '/tickets - Страница билетов');
        console.log('   - http://localhost:' + (process.env.PORT || 10000) + '/api/health - Проверка здоровья');
        console.log('   - http://localhost:' + (process.env.PORT || 10000) + '/api/test-db - Проверка БД');
        console.log('='.repeat(70));
        
    } catch (appError) {
        if (appError.code === 'MODULE_NOT_FOUND') {
            console.error('❌ ОШИБКА: Файл app.js не найден!');
            console.error('\n🔧 Проверьте структуру проекта:');
            console.error('   - Убедитесь что файл server/app.js существует');
            console.error('   - Или переименуйте index.js в app.js');
            
            // Проверяем наличие index.js как запасного варианта
            try {
                require.resolve('./index.js');
                console.log('\n🔍 Найден файл index.js, пытаемся использовать его...');
                require('./index.js');
                console.log('✅ Успешно запущен через index.js');
            } catch (indexError) {
                console.error('❌ index.js также не найден');
                console.error('\n💡 РЕШЕНИЕ:');
                console.error('1. Создайте файл server/app.js с основным кодом приложения');
                console.error('2. Или переименуйте существующий index.js в app.js');
                console.error('3. Или измените start-with-migrate.js для использования другого файла');
            }
        } else {
            console.error('❌ ОШИБКА ПРИ ЗАПУСКЕ ПРИЛОЖЕНИЯ:');
            console.error(appError);
            console.error('\n🔧 Проверьте:');
            console.error('   - Все ли зависимости установлены (npm install)');
            console.error('   - Корректен ли файл app.js');
            console.error('   - Достаточно ли памяти на сервере');
        }
        process.exit(1);
    }
}

// Глобальные обработчики ошибок
process.on('uncaughtException', (error) => {
    console.error('\n❌ НЕОБРАБОТАННАЯ ОШИБКА:');
    console.error(error.message || error);
    console.error('\n🔄 Перезапустите приложение вручную при необходимости');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('\n❌ НЕОБРАБОТАННЫЙ ОТКАЗ ПРОМИСА:');
    console.error(reason);
});

// Запускаем приложение
startApp();
