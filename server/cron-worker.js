require('dotenv').config();
const cron = require('node-cron');
const { pool } = require('./db');

console.log('⏰ Запуск планировщика тиражей (12 из 24)...');

// Запуск каждые 15 минут
cron.schedule('*/15 * * * *', async () => {
    console.log(`🔔 Запуск обработки тиражей: ${new Date().toISOString()}`);
    
    try {
        // 1. Находим завершенные тиражи
        const drawsToProcess = await pool.query(`
            SELECT * FROM draws 
            WHERE status = 'scheduled' 
            AND draw_time <= NOW()
            ORDER BY draw_time ASC
            LIMIT 1
        `);
        
        for (const draw of drawsToProcess.rows) {
            console.log(`🎰 Обработка тиража ${draw.draw_number}...`);
            
            // 2. Генерируем 12 выигрышных чисел из 24
            const winningNumbers = generateWinningNumbers(12, 24);
            
            // 3. Обновляем тираж
            await pool.query(`
                UPDATE draws 
                SET status = 'completed',
                    winning_numbers = $1,
                    completed_at = NOW(),
                    updated_at = NOW()
                WHERE id = $2
                RETURNING *
            `, [winningNumbers, draw.id]);
            
            // 4. Обрабатываем билеты этого тиража
            await processTicketsForDraw(draw.id, winningNumbers);
            
            // 5. Создаем новый тираж
            const nextNumber = await pool.query(`
                SELECT COALESCE(
                    MAX(CAST(SUBSTRING(draw_number FROM 'ТИРАЖ-(\\d+)') AS INTEGER)), 
                    0
                ) + 1 as next_num FROM draws WHERE draw_number LIKE 'ТИРАЖ-%'
            `);
            
            const newDrawNumber = `ТИРАЖ-${String(nextNumber.rows[0].next_num).padStart(4, '0')}`;
            
            await pool.query(`
                INSERT INTO draws (
                    draw_number, draw_time, status, prize_pool, 
                    total_tickets, created_at, updated_at
                ) VALUES ($1, NOW() + INTERVAL '15 minutes', 'scheduled', 
                          10000, 0, NOW(), NOW())
            `, [newDrawNumber]);
            
            console.log(`✅ Тиражи ${draw.draw_number} завершен, создан ${newDrawNumber}`);
        }
        
        if (drawsToProcess.rows.length === 0) {
            console.log('ℹ️ Нет тиражей для обработки');
        }
        
    } catch (error) {
        console.error('❌ Ошибка обработки тиражей:', error);
    }
});

function generateWinningNumbers(count, max) {
    const numbers = new Set();
    while (numbers.size < count) {
        numbers.add(Math.floor(Math.random() * max) + 1);
    }
    return Array.from(numbers).sort((a, b) => a - b);
}

async function processTicketsForDraw(drawId, winningNumbers) {
    const tickets = await pool.query(
        `SELECT t.*, u.telegram_id 
         FROM tickets t 
         JOIN users u ON t.user_id = u.id 
         WHERE t.draw_id = $1 AND t.status = 'active'`,
        [drawId]
    );
    
    console.log(`📊 Обработка ${tickets.rows.length} билетов...`);
    
    for (const ticket of tickets.rows) {
        const userNumbers = Array.isArray(ticket.numbers) ? ticket.numbers : [];
        const matched = userNumbers.filter(num => winningNumbers.includes(num));
        const matchedCount = matched.length;
        
        // Правила выигрыша для 12/24
        let winAmount = 0;
        let status = 'lost';
        
        if (matchedCount === 12 || matchedCount === 0) {
            status = 'won';
            winAmount = 10000; // Джекпот
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
                matched_numbers = $4
            WHERE id = $5
        `, [status, winAmount, matchedCount, matched, ticket.id]);
        
        // Обновляем баланс пользователя
        if (winAmount > 0) {
            await pool.query(`
                UPDATE users 
                SET balance = balance + $1,
                    total_won = total_won + $1
                WHERE id = $2
            `, [winAmount, ticket.user_id]);
            
            // Записываем транзакцию
            await pool.query(`
                INSERT INTO transactions (user_id, type, amount, description, status)
                VALUES ($1, 'win', $2, 'Выигрыш в лотерее 12/24', 'completed')
            `, [ticket.user_id, winAmount]);
        }
    }
}

// Запускаем сразу для тестирования
console.log('✅ Планировщик запущен. Тиражи обновляются каждые 15 минут.');

// Удерживаем процесс для cron
process.stdin.resume();

