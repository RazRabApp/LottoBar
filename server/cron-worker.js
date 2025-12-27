// server/cron-worker.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const cron = require('node-cron');
const { pool } = require('./db');
const crypto = require('crypto');

console.log('='.repeat(70));
console.log('⏰ ЗАПУСК ПЛАНИРОВЩИКА НЕПРЕРЫВНЫХ ТИРАЖЕЙ');
console.log('='.repeat(70));

// Конфигурация
const CONFIG = {
    DRAW_INTERVAL_MINUTES: 15,    // Новый тираж каждые 15 минут
    DRAW_DURATION_MINUTES: 1,     // 1 минута на розыгрыш
    JACKPOT_AMOUNT: 10000,        // Фиксированный джекпот
    NUMBERS_COUNT: 12,            // 12 чисел из 24
    NUMBERS_MIN: 1,
    NUMBERS_MAX: 24
};

// Безопасная генерация чисел
function generateSecureNumbers(count, min, max) {
    const numbers = new Set();
    while (numbers.size < count) {
        const randomBuffer = crypto.randomBytes(4);
        const randomValue = randomBuffer.readUInt32BE(0);
        const num = min + (randomValue % (max - min + 1));
        numbers.add(num);
    }
    return Array.from(numbers).sort((a, b) => a - b);
}

// Обработка тиражей каждую минуту
cron.schedule('* * * * *', async () => {
    try {
        console.log(`🔔 Проверка тиражей: ${new Date().toISOString()}`);
        
        // 1. Проверяем тиражи, у которых время вышло
        await checkExpiredDraws();
        
        // 2. Проверяем тиражи в розыгрыше, у которых время вышло
        await checkDrawingDraws();
        
    } catch (error) {
        console.error('❌ Ошибка проверки тиражей:', error);
    }
});

// Проверка истекших тиражей
async function checkExpiredDraws() {
    try {
        const expiredDraws = await pool.query(`
            SELECT * FROM draws 
            WHERE status = 'scheduled' 
            AND draw_time <= NOW()
            ORDER BY draw_time ASC
        `);
        
        for (const draw of expiredDraws.rows) {
            console.log(`⏰ Время тиража ${draw.draw_number} вышло, начинаем розыгрыш`);
            
            // Переводим в статус "идет розыгрыш" на 1 минуту
            await pool.query(`
                UPDATE draws 
                SET status = 'drawing',
                    draw_time = NOW() + INTERVAL '${CONFIG.DRAW_DURATION_MINUTES} minutes',
                    updated_at = NOW()
                WHERE id = $1
            `, [draw.id]);
            
            console.log(`🎲 Тиражи ${draw.draw_number} переведен в статус "идет розыгрыш" (1 минута)`);
        }
        
    } catch (error) {
        console.error('❌ Ошибка проверки истекших тиражей:', error);
    }
}

// Проверка тиражей в процессе розыгрыша
async function checkDrawingDraws() {
    try {
        const drawingDraws = await pool.query(`
            SELECT * FROM draws 
            WHERE status = 'drawing' 
            AND draw_time <= NOW()
            ORDER BY draw_time ASC
        `);
        
        for (const draw of drawingDraws.rows) {
            console.log(`⏰ Розыгрыш тиража ${draw.draw_number} завершен`);
            
            // Генерируем выигрышные числа
            const winningNumbers = generateSecureNumbers(CONFIG.NUMBERS_COUNT, CONFIG.NUMBERS_MIN, CONFIG.NUMBERS_MAX);
            
            // Обновляем тираж
            await pool.query(`
                UPDATE draws 
                SET status = 'completed',
                    winning_numbers = $1,
                    completed_at = NOW(),
                    updated_at = NOW()
                WHERE id = $2
            `, [winningNumbers, draw.id]);
            
            // Обрабатываем билеты
            await processTickets(draw.id, winningNumbers);
            
            // Создаем новый тираж
            await createNewDraw();
            
            console.log(`✅ Тиражи ${draw.draw_number} завершен, выигрышные числа: ${winningNumbers.join(', ')}`);
        }
        
    } catch (error) {
        console.error('❌ Ошибка проверки тиражей в розыгрыше:', error);
    }
}

// Обработка билетов для тиража
async function processTickets(drawId, winningNumbers) {
    try {
        const tickets = await pool.query(`
            SELECT t.*, u.id as user_id, u.balance 
            FROM tickets t 
            JOIN users u ON t.user_id = u.id 
            WHERE t.draw_id = $1 AND t.status = 'active'
        `, [drawId]);
        
        console.log(`📊 Обработка ${tickets.rows.length} билетов для тиража ${drawId}`);
        
        for (const ticket of tickets.rows) {
            const userNumbers = Array.isArray(ticket.numbers) ? ticket.numbers : [];
            const matched = userNumbers.filter(num => winningNumbers.includes(num));
            const matchedCount = matched.length;
            
            // Определяем выигрыш по правилам 12/24
            let winAmount = 0;
            let status = 'lost';
            
            if (matchedCount === 12 || matchedCount === 0) {
                status = 'won';
                winAmount = CONFIG.JACKPOT_AMOUNT;
            } else if (matchedCount === 11 || matchedCount === 1) {
                status = 'won';
                winAmount = 1000;
            } else if (matchedCount === 10 || matchedCount === 2) {
                status = 'won';
                winAmount = 750;
            } else if (matchedCount === 9 || matchedCount === 3) {
                status = 'won';
                winAmount = 250;
            } else if (matchedCount === 8 || matchedCount === 4) {
                status = 'won';
                winAmount = 100;
            }
            
            // Обновляем билет
            await pool.query(`
                UPDATE tickets 
                SET status = $1, 
                    win_amount = $2, 
                    matched_count = $3,
                    matched_numbers = $4,
                    checked_at = NOW()
                WHERE id = $5
            `, [status, winAmount, matchedCount, matched, ticket.id]);
            
            // Обновляем баланс пользователя если есть выигрыш
            if (winAmount > 0) {
                await pool.query(`
                    UPDATE users 
                    SET balance = balance + $1,
                        total_won = COALESCE(total_won, 0) + $1,
                        updated_at = NOW()
                    WHERE id = $2
                `, [winAmount, ticket.user_id]);
                
                // Записываем транзакцию
                await pool.query(`
                    INSERT INTO transactions (user_id, type, amount, description, status)
                    VALUES ($1, 'win', $2, 'Выигрыш в лотерее 12/24', 'completed')
                `, [ticket.user_id, winAmount]);
                
                console.log(`💰 Пользователь ${ticket.user_id} выиграл ${winAmount} Stars`);
            }
        }
        
        console.log(`✅ Билеты обработаны для тиража ${drawId}`);
        
    } catch (error) {
        console.error(`❌ Ошибка обработки билетов для тиража ${drawId}:`, error);
    }
}

// Создание нового тиража
async function createNewDraw() {
    try {
        // Получаем следующий номер тиража
        const lastDraw = await pool.query(`
            SELECT * FROM draws 
            ORDER BY draw_number DESC 
            LIMIT 1
        `);
        
        let nextNumber = 1;
        if (lastDraw.rows.length > 0) {
            const lastNumber = lastDraw.rows[0].draw_number;
            const match = lastNumber.match(/ТИРАЖ-(\d+)/);
            if (match) {
                nextNumber = parseInt(match[1]) + 1;
            }
        }
        
        const drawNumber = `ТИРАЖ-${String(nextNumber).padStart(4, '0')}`;
        const drawTime = new Date(Date.now() + CONFIG.DRAW_INTERVAL_MINUTES * 60 * 1000);
        
        // Создаем новый тираж
        await pool.query(`
            INSERT INTO draws (
                draw_number, 
                draw_time, 
                status, 
                prize_pool, 
                jackpot_balance,
                total_tickets,
                created_at,
                updated_at
            ) VALUES ($1, $2, 'scheduled', 10000, 10000, 0, NOW(), NOW())
        `, [drawNumber, drawTime]);
        
        console.log(`✅ Создан новый тираж: ${drawNumber} на ${drawTime.toISOString()}`);
        
    } catch (error) {
        console.error('❌ Ошибка создания тиража:', error);
    }
}

// Тестирование подключения к БД
async function testDatabaseConnection() {
    try {
        const result = await pool.query('SELECT NOW() as current_time');
        console.log(`✅ Подключение к БД установлено: ${result.rows[0].current_time}`);
        return true;
    } catch (error) {
        console.error('❌ Ошибка подключения к БД:', error.message);
        return false;
    }
}

// Запуск воркера
async function startWorker() {
    console.log('🔧 Инициализация планировщика тиражей...');
    
    // Проверяем подключение к БД
    const dbConnected = await testDatabaseConnection();
    
    if (!dbConnected) {
        console.error('❌ Не удалось подключиться к БД. Воркер остановлен.');
        process.exit(1);
    }
    
    console.log('🎰 Настройки тиражей:');
    console.log(`   • Интервал: ${CONFIG.DRAW_INTERVAL_MINUTES} минут`);
    console.log(`   • Розыгрыш: ${CONFIG.DRAW_DURATION_MINUTES} минута`);
    console.log(`   • Джекпот: ${CONFIG.JACKPOT_AMOUNT.toLocaleString()} Stars`);
    console.log(`   • Числа: ${CONFIG.NUMBERS_COUNT} из ${CONFIG.NUMBERS_MAX}`);
    console.log('='.repeat(70));
    console.log('✅ Планировщик запущен. Тираж каждые 15 минут, розыгрыш 1 минуту.');
    console.log('📅 Проверка каждую минуту...');
    
    // Запускаем сразу для тестирования
    console.log('\n🔧 Первоначальная проверка тиражей...');
    await checkExpiredDraws();
    await checkDrawingDraws();
    
    // Удерживаем процесс для cron
    setInterval(() => {
        // Просто поддерживаем процесс активным
    }, 60000);
}

startWorker();

// Обработка завершения процесса
process.on('SIGTERM', async () => {
    console.log('🛑 Получен SIGTERM, завершение работы планировщика...');
    await pool.end();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 Получен SIGINT, завершение работы планировщика...');
    await pool.end();
    process.exit(0);
});
