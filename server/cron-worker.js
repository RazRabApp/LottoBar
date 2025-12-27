// server/cron-worker.js - ИСПРАВЛЕННАЯ ВЕРСИЯ ДЛЯ НЕПРЕРЫВНЫХ ТИРАЖЕЙ
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const cron = require('node-cron');
const { pool } = require('./db');
const crypto = require('crypto');
const { createHash } = require('crypto');

console.log('='.repeat(70));
console.log('⏰ ЗАПУСК ПЛАНИРОВЩИКА НЕПРЕРЫВНЫХ ТИРАЖЕЙ');
console.log('='.repeat(70));

// Конфигурация
const CONFIG = {
    DRAW_INTERVAL_MINUTES: 15,
    DRAW_DURATION_MINUTES: 1,
    JACKPOT_AMOUNT: 10000,
    NUMBERS_COUNT: 12,
    NUMBERS_MIN: 1,
    NUMBERS_MAX: 24
};

// Правила выигрыша
const WIN_RULES = {
    0: 10000,
    12: 10000,
    1: 1000,
    11: 1000,
    2: 750,
    10: 750,
    3: 250,
    9: 250,
    4: 100,
    8: 100
};

// Безопасная генерация чисел с доказательствами
function generateSecureNumbersWithProof(count, min, max, drawId) {
    const numbers = new Set();
    const proof = [];
    
    while (numbers.size < count) {
        const randomBuffer = crypto.randomBytes(16);
        const randomValue = randomBuffer.readUInt32BE(0);
        const num = min + (randomValue % (max - min + 1));
        
        if (numbers.add(num)) {
            proof.push({
                seed: randomBuffer.toString('hex'),
                timestamp: Date.now(),
                drawId: drawId,
                number: num
            });
        }
    }
    
    const numbersArray = Array.from(numbers).sort((a, b) => a - b);
    const verificationHash = createHash('sha256').update(JSON.stringify({
        numbers: numbersArray,
        proof: proof,
        drawId: drawId,
        generatedAt: new Date().toISOString()
    })).digest('hex');
    
    return {
        numbers: numbersArray,
        proof: proof,
        verificationHash: verificationHash,
        timestamp: new Date().toISOString()
    };
}

// Обработка тиражей каждую минуту
cron.schedule('* * * * *', async () => {
    try {
        const now = new Date();
        console.log(`🔔 Проверка тиражей: ${now.toISOString()}`);
        
        const client = await pool.connect();
        
        try {
            // 1. ПРОВЕРЯЕМ ТИРАЖИ, У КОТОРЫХ ВРЕМЯ ВЫШЛО (scheduled -> drawing)
            const expiredDraws = await client.query(`
                SELECT * FROM draws 
                WHERE status = 'scheduled' 
                AND draw_time <= NOW()
                ORDER BY draw_time ASC
                FOR UPDATE SKIP LOCKED
            `);
            
            for (const draw of expiredDraws.rows) {
                console.log(`⏰ Время тиража ${draw.draw_number} вышло, начинаем розыгрыш`);
                
                // Генерируем выигрышные числа с доказательствами
                const winningNumbersData = generateSecureNumbersWithProof(
                    CONFIG.NUMBERS_COUNT,
                    CONFIG.NUMBERS_MIN,
                    CONFIG.NUMBERS_MAX,
                    draw.id
                );
                
                // Обновляем тираж: scheduled -> drawing
                await client.query(`
                    UPDATE draws 
                    SET 
                        status = 'drawing',
                        draw_time = NOW() + INTERVAL '${CONFIG.DRAW_DURATION_MINUTES} minutes',
                        winning_numbers = $1,
                        winning_proof = $2,
                        verification_hash = $3,
                        updated_at = NOW()
                    WHERE id = $4
                `, [
                    winningNumbersData.numbers,
                    winningNumbersData.proof,
                    winningNumbersData.verificationHash,
                    draw.id
                ]);
                
                console.log(`🎲 Тиражи ${draw.draw_number} переведен в статус "идет розыгрыш"`);
                console.log(`   Выигрышные числа: ${winningNumbersData.numbers.join(', ')}`);
                console.log(`   Хеш верификации: ${winningNumbersData.verificationHash.substring(0, 16)}...`);
            }
            
            // 2. ПРОВЕРЯЕМ ТИРАЖИ В РОЗЫГРЫШЕ, У КОТОРЫХ ВРЕМЯ ВЫШЛО (drawing -> completed)
            const drawingDraws = await client.query(`
                SELECT * FROM draws 
                WHERE status = 'drawing' 
                AND draw_time <= NOW()
                ORDER BY draw_time ASC
                FOR UPDATE SKIP LOCKED
            `);
            
            for (const draw of drawingDraws.rows) {
                console.log(`⏰ Розыгрыш тиража ${draw.draw_number} завершен, обрабатываем билеты...`);
                
                // ОБРАБАТЫВАЕМ БИЛЕТЫ ЭТОГО ТИРАЖА
                await processTicketsForDraw(draw.id, draw.winning_numbers || [], client);
                
                // ОБНОВЛЯЕМ СТАТУС ТИРАЖА
                await client.query(`
                    UPDATE draws 
                    SET 
                        status = 'completed',
                        completed_at = NOW(),
                        updated_at = NOW()
                    WHERE id = $1
                `, [draw.id]);
                
                console.log(`✅ Тиражи ${draw.draw_number} завершен и обработан`);
                
                // 3. СОЗДАЕМ НОВЫЙ ТИРАЖ
                await createNewDraw(client);
            }
            
            // 4. ЕСЛИ НЕТ АКТИВНОГО ТИРАЖА - СОЗДАЕМ
            const activeDraws = await client.query(`
                SELECT COUNT(*) as count FROM draws 
                WHERE status IN ('scheduled', 'drawing')
            `);
            
            if (parseInt(activeDraws.rows[0].count) === 0) {
                console.log('🎰 Нет активного тиража, создаем новый...');
                await createNewDraw(client);
            }
            
        } catch (error) {
            console.error('❌ Ошибка в обработке тиражей:', error);
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('❌ Ошибка подключения к БД:', error);
    }
});

// Обработка билетов для тиража
async function processTicketsForDraw(drawId, winningNumbers, client) {
    try {
        console.log(`📊 Обработка билетов для тиража ${drawId}...`);
        
        // Получаем все активные билеты этого тиража
        const tickets = await client.query(`
            SELECT 
                t.id,
                t.user_id,
                t.telegram_id,
                t.numbers,
                t.ticket_number,
                t.numbers_hash
            FROM tickets t
            WHERE t.draw_id = $1 AND t.status = 'active'
            FOR UPDATE SKIP LOCKED
        `, [drawId]);
        
        console.log(`📊 Найдено ${tickets.rows.length} билетов для обработки`);
        
        let totalWinners = 0;
        let totalPrize = 0;
        
        for (const ticket of tickets.rows) {
            const ticketNumbers = ticket.numbers || [];
            const matched = ticketNumbers.filter(num => winningNumbers.includes(num));
            const matchedCount = matched.length;
            
            let winAmount = 0;
            let status = 'lost';
            
            // Проверяем по правилам выигрыша
            if (WIN_RULES[matchedCount] !== undefined) {
                status = 'won';
                winAmount = WIN_RULES[matchedCount];
                totalWinners++;
                totalPrize += winAmount;
            }
            
            // ОБНОВЛЯЕМ БИЛЕТ
            await client.query(`
                UPDATE tickets 
                SET 
                    status = $1,
                    win_amount = $2,
                    matched_count = $3,
                    matched_numbers = $4,
                    checked_at = NOW(),
                    updated_at = NOW()
                WHERE id = $5
            `, [status, winAmount, matchedCount, matched, ticket.id]);
            
            // ЕСЛИ ЕСТЬ ВЫИГРЫШ - ОБНОВЛЯЕМ БАЛАНС ПОЛЬЗОВАТЕЛЯ
            if (winAmount > 0) {
                await client.query(`
                    UPDATE users 
                    SET 
                        balance = balance + $1,
                        total_won = COALESCE(total_won, 0) + $1,
                        updated_at = NOW()
                    WHERE id = $2
                `, [winAmount, ticket.user_id]);
                
                // СОХРАНЯЕМ ТРАНЗАКЦИЮ
                await client.query(`
                    INSERT INTO transactions (
                        user_id,
                        telegram_id,
                        type,
                        amount,
                        description,
                        reference_id,
                        status,
                        created_at
                    ) VALUES ($1, $2, 'win', $3, $4, $5, 'completed', NOW())
                `, [
                    ticket.user_id,
                    ticket.telegram_id,
                    winAmount,
                    `Выигрыш ${winAmount} Stars по билету ${ticket.ticket_number}`,
                    ticket.id
                ]);
                
                console.log(`💰 Пользователь ${ticket.telegram_id} выиграл ${winAmount} Stars (билет: ${ticket.ticket_number})`);
            }
        }
        
        // ОБНОВЛЯЕМ СТАТИСТИКУ ТИРАЖА
        await client.query(`
            UPDATE draws 
            SET 
                winners_count = $1,
                updated_at = NOW()
            WHERE id = $2
        `, [totalWinners, drawId]);
        
        console.log(`✅ Билеты обработаны для тиража ${drawId}`);
        console.log(`   Всего победителей: ${totalWinners}`);
        console.log(`   Общая сумма выигрышей: ${totalPrize} Stars`);
        
    } catch (error) {
        console.error(`❌ Ошибка обработки билетов для тиража ${drawId}:`, error);
        throw error;
    }
}

// Создание нового тиража
async function createNewDraw(client) {
    try {
        // Получаем следующий номер тиража
        const nextNumberResult = await client.query(`
            SELECT COALESCE(
                MAX(CAST(SUBSTRING(draw_number FROM 'ТИРАЖ-(\\d+)') AS INTEGER)), 
                0
            ) + 1 as next_num 
            FROM draws 
            WHERE draw_number LIKE 'ТИРАЖ-%'
        `);
        
        const nextNum = nextNumberResult.rows[0]?.next_num || 1;
        const drawNumber = `ТИРАЖ-${String(nextNum).padStart(4, '0')}`;
        const drawTime = new Date(Date.now() + CONFIG.DRAW_INTERVAL_MINUTES * 60 * 1000);
        
        // Создаем новый тираж
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
            ) VALUES ($1, $2, 'scheduled', 10000, 10000, 0, NOW(), NOW())
        `, [drawNumber, drawTime]);
        
        console.log(`✅ Создан новый тираж: ${drawNumber}`);
        console.log(`   Время начала: ${drawTime.toISOString()}`);
        console.log(`   Джекпот: ${CONFIG.JACKПOT_AMOUNT.toLocaleString()} Stars`);
        
    } catch (error) {
        console.error('❌ Ошибка создания тиража:', error);
        throw error;
    }
}

// Архивация старых тиражей (раз в день)
cron.schedule('0 3 * * *', async () => {
    try {
        console.log('📦 Архивация старых тиражей...');
        
        const client = await pool.connect();
        
        try {
            // Находим завершенные тиражи старше 30 дней
            const oldDraws = await client.query(`
                SELECT * FROM draws 
                WHERE status = 'completed' 
                AND completed_at < NOW() - INTERVAL '30 days'
            `);
            
            for (const draw of oldDraws.rows) {
                // Архивируем в отдельную таблицу
                await client.query(`
                    INSERT INTO draws_archive (
                        original_draw_id,
                        draw_number,
                        draw_time,
                        status,
                        prize_pool,
                        total_tickets,
                        winning_numbers,
                        winning_proof,
                        verification_hash,
                        winners_count,
                        archived_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
                `, [
                    draw.id,
                    draw.draw_number,
                    draw.draw_time,
                    draw.status,
                    draw.prize_pool,
                    draw.total_tickets,
                    draw.winning_numbers,
                    draw.winning_proof,
                    draw.verification_hash,
                    draw.winners_count
                ]);
                
                // Удаляем из основной таблицы
                await client.query('DELETE FROM draws WHERE id = $1', [draw.id]);
                
                console.log(`📦 Архивирован тираж: ${draw.draw_number}`);
            }
            
            console.log(`✅ Архивация завершена: ${oldDraws.rows.length} тиражей`);
            
        } catch (error) {
            console.error('❌ Ошибка архивации:', error);
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('❌ Ошибка подключения к БД при архивации:', error);
    }
});

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
    console.log('🎰 Настройки системы:');
    console.log(`   • Тираж каждые: ${CONFIG.DRAW_INTERVAL_MINUTES} минут`);
    console.log(`   • Розыгрыш длится: ${CONFIG.DRAW_DURATION_MINUTES} минуту`);
    console.log(`   • Выбирается чисел: ${CONFIG.NUMBERS_COUNT} из ${CONFIG.NUMBERS_MAX}`);
    console.log(`   • Джекпот: ${CONFIG.JACKPOT_AMOUNT.toLocaleString()} Stars`);
    console.log('='.repeat(70));
    
    // Проверяем подключение к БД
    const dbConnected = await testDatabaseConnection();
    
    if (!dbConnected) {
        console.error('❌ Не удалось подключиться к БД. Воркер остановлен.');
        process.exit(1);
    }
    
    console.log('✅ Планировщик запущен');
    console.log('📅 Проверка тиражей каждую минуту');
    console.log('📦 Архивация старых тиражей каждый день в 3:00');
    
    // Запускаем сразу первую проверку
    console.log('\n🔧 Первоначальная проверка тиражей...');
    
    const client = await pool.connect();
    try {
        const activeDraws = await client.query(`
            SELECT COUNT(*) as count FROM draws 
            WHERE status IN ('scheduled', 'drawing')
        `);
        
        console.log(`🎰 Активных тиражей: ${activeDraws.rows[0].count}`);
        
        if (parseInt(activeDraws.rows[0].count) === 0) {
            console.log('🎰 Создаем начальный тираж...');
            await createNewDraw(client);
        }
        
    } catch (error) {
        console.error('❌ Ошибка при проверке:', error);
    } finally {
        client.release();
    }
    
    // Удерживаем процесс для cron
    console.log('\n⏰ Планировщик работает в фоновом режиме...\n');
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
