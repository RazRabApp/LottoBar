// server/app.js - ПОЛНАЯ ИСПРАВЛЕННАЯ ВЕРСИЯ
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

// Проверка загрузки переменных
console.log('='.repeat(70));
console.log('🔧 ПРОВЕРКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ:');
console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`PORT: ${process.env.PORT}`);
console.log(`DATABASE_URL: ${process.env.DATABASE_URL ? '***НАСТРОЕН***' : '❌ ОТСУТСТВУЕТ'}`);
console.log(`TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN ? '***НАСТРОЕН***' : '❌ ОТСУТСТВУЕТ'}`);
console.log('='.repeat(70));

// ==================== КОНФИГУРАЦИЯ ====================

const CONFIG = {
    TICKET_PRICE: 50,
    DRAW_INTERVAL_MINUTES: 15,
    DRAW_DURATION_MINUTES: 2,
    JACKPOT_INITIAL: 10000,
    JACKPOT_PERCENTAGE: 0.8,
    NUMBERS_TO_SELECT: 12,
    NUMBERS_RANGE: { min: 1, max: 24 }
};

// ==================== ПОДКЛЮЧЕНИЕ К БД ====================

const { pool, initializeDatabase } = require('./db');

global.dbStatus = {
    connected: false,
    lastCheck: null,
    error: null
};

async function checkDatabaseConnection() {
    try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        
        global.dbStatus = {
            connected: true,
            lastCheck: new Date(),
            error: null
        };
        
        console.log('✅ Подключение к БД активно');
        return true;
        
    } catch (error) {
        global.dbStatus = {
            connected: false,
            lastCheck: new Date(),
            error: error.message
        };
        
        console.error('❌ Ошибка подключения к БД:', error.message);
        return false;
    }
}

// ==================== СИСТЕМА ТИРАЖЕЙ ====================

const WIN_RULES = {
    0: { amount: 'jackpot', description: 'Суперприз (0 совпадений)' },
    1: { amount: 1000, description: '1000 Stars' },
    2: { amount: 750, description: '750 Stars' },
    3: { amount: 250, description: '250 Stars' },
    4: { amount: 100, description: '100 Stars' },
    8: { amount: 100, description: '100 Stars' },
    9: { amount: 250, description: '250 Stars' },
    10: { amount: 750, description: '750 Stars' },
    11: { amount: 1000, description: '1000 Stars' },
    12: { amount: 'jackpot', description: 'Суперприз (12 совпадений)' }
};

let demoMode = false;

// ==================== MIDDLEWARE ====================

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`📥 [${timestamp}] ${req.method} ${req.originalUrl}`);
    if (Object.keys(req.body).length > 0 && req.method !== 'GET') {
        console.log(`   Body:`, JSON.stringify(req.body).substring(0, 200));
    }
    next();
});

app.use(async (req, res, next) => {
    if (!global.dbStatus.connected) {
        demoMode = true;
    }
    next();
});

// ==================== МАРШРУТЫ ====================

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        message: 'Fortuna Lottery API работает',
        version: '4.1.0',
        demo_mode: demoMode,
        db_status: global.dbStatus
    });
});

app.get('/api/test-db', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW() as time, version() as version');
        res.json({ 
            success: true, 
            time: result.rows[0].time,
            version: result.rows[0].version,
            message: 'База данных подключена',
            demo_mode: false
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message,
            demo_mode: true
        });
    }
});

// ==================== API МАРШРУТЫ ====================

// 1. Авторизация Telegram
app.post('/api/auth/telegram', async (req, res) => {
    try {
        const { telegram_id, username, first_name, last_name } = req.body;
        console.log('🔐 Запрос авторизации через Telegram:', { telegram_id, username });
        
        if (demoMode) {
            const token = 'tg_' + Date.now() + '_' + crypto.randomBytes(16).toString('hex');
            return res.json({
                success: true,
                token: token,
                user: {
                    id: `tg_${telegram_id}`,
                    telegram_id: telegram_id,
                    username: username || `user_${telegram_id}`,
                    first_name: first_name || 'Игрок',
                    last_name: last_name || '',
                    stars_balance: 1000,
                    is_demo: true
                },
                demo_mode: true
            });
        }
        
        try {
            const result = await pool.query(`
                SELECT 
                    id, 
                    telegram_id, 
                    username, 
                    first_name, 
                    last_name, 
                    balance as stars_balance
                FROM users 
                WHERE telegram_id = $1
            `, [telegram_id]);
            
            let user;
            
            if (result.rows.length > 0) {
                user = result.rows[0];
                console.log('✅ Пользователь найден в БД:', user.username);
                
                await pool.query(
                    'UPDATE users SET last_active = NOW() WHERE id = $1',
                    [user.id]
                );
                
            } else {
                const newUserResult = await pool.query(`
                    INSERT INTO users (
                        telegram_id, 
                        username, 
                        first_name, 
                        last_name, 
                        balance,
                        last_active
                    ) VALUES ($1, $2, $3, $4, 1000, NOW())
                    RETURNING id, telegram_id, username, first_name, last_name, balance as stars_balance
                `, [
                    telegram_id,
                    username || `user_${telegram_id}`,
                    first_name || 'Игрок',
                    last_name || ''
                ]);
                
                user = newUserResult.rows[0];
                console.log('✅ Новый пользователь создан:', user.username);
            }
            
            const token = 'tg_' + crypto.randomBytes(32).toString('hex');
            
            res.json({
                success: true,
                token: token,
                user: {
                    id: user.id,
                    telegram_id: user.telegram_id,
                    username: user.username,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    stars_balance: user.stars_balance,
                    is_demo: false
                },
                demo_mode: false
            });
            
        } catch (dbError) {
            console.error('❌ Ошибка БД при авторизации:', dbError);
            const token = 'tg_' + Date.now() + '_' + crypto.randomBytes(16).toString('hex');
            res.json({
                success: true,
                token: token,
                user: {
                    id: `tg_${telegram_id}`,
                    telegram_id: telegram_id,
                    username: username || `user_${telegram_id}`,
                    first_name: first_name || 'Игрок',
                    last_name: last_name || '',
                    stars_balance: 1000,
                    is_demo: true
                },
                demo_mode: true,
                error: 'БД недоступна, переключены в демо-режим'
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка авторизации:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера при авторизации',
            demo_mode: true
        });
    }
});

// 2. Получение текущего тиража
app.get('/api/draws/current/status', async (req, res) => {
    try {
        console.log('🎰 Запрос статуса текущего тиража');
        
        if (demoMode) {
            const nextDrawTime = new Date(Date.now() + 15 * 60 * 1000);
            const timeRemaining = Math.floor((nextDrawTime - Date.now()) / 1000);
            
            const draw = {
                id: Date.now(),
                draw_number: 'ТИРАЖ-DEMO',
                draw_time: nextDrawTime.toISOString(),
                status: 'scheduled',
                jackpot_balance: 10000,
                time_remaining: timeRemaining,
                time_formatted: `${Math.floor(timeRemaining/60)} мин ${(timeRemaining%60).toString().padStart(2,'0')} сек`,
                can_buy_tickets: timeRemaining > 120
            };
            
            return res.json({
                success: true,
                draw: draw,
                demo_mode: true
            });
        }
        
        const result = await pool.query(`
            SELECT id, draw_number, status, draw_time, 
            FLOOR(EXTRACT(EPOCH FROM (draw_time - NOW()))) as time_remaining,
            COALESCE(jackpot_balance, 10000) as jackpot_balance
            FROM draws 
            WHERE status IN ('scheduled', 'drawing')
            ORDER BY draw_time ASC
            LIMIT 1
        `);
        
        if (result.rows.length > 0) {
            const draw = result.rows[0];
            const timeRemaining = Math.max(0, Math.floor(draw.time_remaining));
            const canBuyTickets = draw.status === 'scheduled' && timeRemaining > 120;
            
            res.json({ 
                success: true,
                draw: {
                    id: draw.id,
                    draw_number: draw.draw_number,
                    draw_time: draw.draw_time,
                    status: draw.status,
                    jackpot_balance: draw.jackpot_balance,
                    time_remaining: timeRemaining,
                    time_formatted: `${Math.floor(timeRemaining/60)} мин ${(timeRemaining%60).toString().padStart(2,'0')} сек`,
                    can_buy_tickets: canBuyTickets
                },
                demo_mode: false
            });
        } else {
            const nextNumberResult = await pool.query(`
                SELECT COALESCE(
                    MAX(CAST(SUBSTRING(draw_number FROM 'ТИРАЖ-(\\d+)') AS INTEGER)), 
                    0
                ) + 1 as next_num FROM draws WHERE draw_number LIKE 'ТИРАЖ-%'
            `);
            
            const nextNum = nextNumberResult.rows[0]?.next_num || 1;
            const drawNumber = `ТИРАЖ-${String(nextNum).padStart(4, '0')}`;
            
            const newDraw = await pool.query(`
                INSERT INTO draws (draw_number, draw_time, status, jackpot_balance)
                VALUES ($1, NOW() + INTERVAL '15 minutes', 'scheduled', 10000)
                RETURNING *
            `, [drawNumber]);
            
            const draw = newDraw.rows[0];
            const timeRemaining = 15 * 60;
            
            res.json({ 
                success: true,
                draw: {
                    id: draw.id,
                    draw_number: draw.draw_number,
                    draw_time: draw.draw_time,
                    status: draw.status,
                    jackpot_balance: draw.jackpot_balance || 10000,
                    time_remaining: timeRemaining,
                    time_formatted: '15 мин 00 сек',
                    can_buy_tickets: true
                },
                demo_mode: false
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка получения статуса тиража:', error);
        demoMode = true;
        
        const nextDrawTime = new Date(Date.now() + 15 * 60 * 1000);
        const timeRemaining = Math.floor((nextDrawTime - Date.now()) / 1000);
        
        res.json({
            success: true,
            draw: {
                id: Date.now(),
                draw_number: 'ТИРАЖ-ERROR',
                draw_time: nextDrawTime.toISOString(),
                status: 'scheduled',
                jackpot_balance: 10000,
                time_remaining: timeRemaining,
                time_formatted: `${Math.floor(timeRemaining/60)} мин ${(timeRemaining%60).toString().padStart(2,'0')} сек`,
                can_buy_tickets: timeRemaining > 120
            },
            demo_mode: true,
            error: error.message
        });
    }
});

// 3. Покупка билета
app.post('/api/tickets/buy', async (req, res) => {
    try {
        const { userId, numbers } = req.body;
        console.log('🎫 Запрос покупки билета:', { userId, numbers: numbers?.length });
        
        if (!userId || !numbers || numbers.length !== 12) {
            return res.status(400).json({
                success: false,
                error: 'Выберите 12 чисел от 1 до 24',
                demo_mode: demoMode
            });
        }
        
        if (demoMode) {
            const ticketNumber = 'TKT-DEMO-' + Date.now().toString().slice(-8);
            const ticket = {
                id: Date.now(),
                ticket_number: ticketNumber,
                user_id: userId,
                numbers: numbers.sort((a, b) => a - b),
                price: 50,
                status: 'active',
                win_amount: 0,
                created_at: new Date().toISOString()
            };
            
            return res.json({
                success: true,
                ticket: ticket,
                new_balance: 950,
                message: 'Билет успешно куплен в демо-режиме! 🎫',
                demo_mode: true
            });
        }
        
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const userResult = await client.query(
                'SELECT id, balance FROM users WHERE id = $1 FOR UPDATE',
                [userId]
            );
            
            if (userResult.rows.length === 0) {
                throw new Error('Пользователь не найден');
            }
            
            const currentBalance = userResult.rows[0].balance;
            if (currentBalance < 50) {
                throw new Error('Недостаточно Stars для покупки билета');
            }
            
            const drawResult = await client.query(`
                SELECT id, draw_number FROM draws 
                WHERE status = 'scheduled' 
                AND draw_time > NOW()
                ORDER BY draw_time ASC 
                LIMIT 1
            `);
            
            if (drawResult.rows.length === 0) {
                throw new Error('Нет активного тиража для покупки билетов');
            }
            
            const draw = drawResult.rows[0];
            const drawTime = new Date(draw.draw_time);
            const timeUntilDraw = (drawTime - Date.now()) / 1000;
            
            if (timeUntilDraw <= 120) {
                throw new Error('Покупка временно недоступна. Скоро начнется розыгрыш.');
            }
            
            const newBalance = currentBalance - 50;
            await client.query(
                'UPDATE users SET balance = $1 WHERE id = $2',
                [newBalance, userId]
            );
            
            const ticketNumber = 'TKT-' + Date.now().toString().slice(-8);
            
            const ticketResult = await client.query(`
                INSERT INTO tickets (
                    user_id, draw_id, ticket_number, 
                    numbers, price, status
                ) VALUES ($1, $2, $3, $4, 50, 'active')
                RETURNING *
            `, [userId, draw.id, ticketNumber, numbers, 50]);
            
            await client.query(`
                INSERT INTO transactions (user_id, type, amount, description, status)
                VALUES ($1, 'ticket_purchase', $2, $3, 'completed')
            `, [userId, 50, `Покупка билета на тираж ${draw.draw_number}`]);
            
            await client.query(`
                UPDATE draws 
                SET total_tickets = total_tickets + 1,
                    prize_pool = prize_pool + 50,
                    jackpot_balance = COALESCE(jackpot_balance, 10000) + 40
                WHERE id = $1
            `, [draw.id]);
            
            await client.query('COMMIT');
            
            res.json({
                success: true,
                ticket: ticketResult.rows[0],
                new_balance: newBalance,
                message: 'Билет успешно куплен! 🎫',
                demo_mode: false
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('❌ Ошибка покупки билета:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            demo_mode: demoMode
        });
    }
});

// 4. Быстрый выбор чисел
app.get('/api/numbers/quick-pick', (req, res) => {
    try {
        const numbers = new Set();
        while (numbers.size < 12) {
            numbers.add(Math.floor(Math.random() * 24) + 1);
        }
        
        res.json({
            success: true,
            numbers: Array.from(numbers).sort((a, b) => a - b),
            generated_at: new Date().toISOString(),
            demo_mode: demoMode
        });
    } catch (error) {
        console.error('❌ Ошибка генерации чисел:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка генерации чисел',
            numbers: Array.from({length: 12}, (_, i) => i + 1),
            demo_mode: true
        });
    }
});

// 5. Баланс пользователя
app.get('/api/user/balance', async (req, res) => {
    try {
        const { userId, telegramId } = req.query;
        
        if (demoMode) {
            return res.json({
                success: true,
                user: {
                    id: userId || 'demo_user',
                    telegram_id: telegramId,
                    stars_balance: 1000,
                    is_demo: true
                },
                balance: 1000,
                demo_mode: true
            });
        }
        
        let user = null;
        
        if (telegramId) {
            const result = await pool.query(`
                SELECT id, telegram_id, balance as stars_balance
                FROM users WHERE telegram_id = $1
            `, [telegramId]);
            
            if (result.rows.length > 0) {
                user = result.rows[0];
            }
        }
        
        if (!user && userId) {
            const result = await pool.query(`
                SELECT id, telegram_id, balance as stars_balance
                FROM users WHERE id = $1
            `, [userId]);
            
            if (result.rows.length > 0) {
                user = result.rows[0];
            }
        }
        
        if (user) {
            return res.json({
                success: true,
                user: {
                    id: user.id,
                    telegram_id: user.telegram_id,
                    stars_balance: user.stars_balance,
                    is_demo: false
                },
                balance: user.stars_balance,
                demo_mode: false
            });
        }
        
        return res.json({
            success: true,
            user: {
                id: userId || 'unknown',
                stars_balance: 0,
                is_demo: true
            },
            balance: 0,
            demo_mode: true
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения баланса:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            balance: 1000,
            demo_mode: true
        });
    }
});

// 6. БИЛЕТЫ ПОЛЬЗОВАТЕЛЯ - ОСНОВНОЙ МАРШРУТ
app.get('/api/user/tickets', async (req, res) => {
    try {
        const { userId, status, page = 1, limit = 10 } = req.query;
        console.log('📋 Запрос билетов пользователя:', { userId, status });
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'Не указан userId',
                demo_mode: demoMode
            });
        }
        
        if (demoMode) {
            const demo_tickets = [];
            for (let i = 1; i <= 5; i++) {
                const numbers = [];
                while (numbers.size < 12) {
                    numbers.add(Math.floor(Math.random() * 24) + 1);
                }
                
                demo_tickets.push({
                    id: i,
                    ticket_number: 'TKT-DEMO-' + i.toString().padStart(3, '0'),
                    user_id: userId,
                    numbers: Array.from(numbers).sort((a, b) => a - b),
                    price: 50,
                    status: ['active', 'won', 'lost'][Math.floor(Math.random() * 3)],
                    win_amount: Math.floor(Math.random() * 1000),
                    created_at: new Date(Date.now() - i * 86400000).toISOString(),
                    draw_number: 'ТИРАЖ-' + (1000 + i).toString().slice(-4)
                });
            }
            
            return res.json({
                success: true,
                tickets: demo_tickets,
                total: demo_tickets.length,
                page: parseInt(page),
                limit: parseInt(limit),
                has_more: false,
                demo_mode: true
            });
        }
        
        const offset = (parseInt(page) - 1) * parseInt(limit);
        
        let query = `
            SELECT 
                t.id,
                t.ticket_number,
                t.user_id,
                t.draw_id,
                t.numbers,
                t.price,
                t.status,
                t.win_amount,
                t.created_at,
                d.draw_number,
                d.status as draw_status
            FROM tickets t
            LEFT JOIN draws d ON t.draw_id = d.id
            WHERE t.user_id = $1
        `;
        
        const params = [userId];
        let paramIndex = 2;
        
        if (status && status !== '' && status !== 'all') {
            query += ` AND t.status = $${paramIndex}`;
            params.push(status);
            paramIndex++;
        }
        
        query += ` ORDER BY t.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(parseInt(limit), offset);
        
        const result = await pool.query(query, params);
        
        const countResult = await pool.query(
            'SELECT COUNT(*) as total FROM tickets WHERE user_id = $1',
            [userId]
        );
        
        const total = parseInt(countResult.rows[0]?.total || 0);
        const has_more = (offset + result.rows.length) < total;
        
        res.json({
            success: true,
            tickets: result.rows,
            total: total,
            page: parseInt(page),
            limit: parseInt(limit),
            has_more: has_more,
            demo_mode: false
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения билетов:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            tickets: [],
            demo_mode: true
        });
    }
});

// 7. Статистика пользователя (новый маршрут)
app.get('/api/user/stats', async (req, res) => {
    try {
        const { userId } = req.query;
        console.log('📊 Запрос статистики для пользователя:', userId);
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'Не указан userId',
                demo_mode: demoMode
            });
        }
        
        if (demoMode) {
            return res.json({
                success: true,
                stats: {
                    total_tickets: 5,
                    active_tickets: 2,
                    won_tickets: 1,
                    lost_tickets: 2,
                    drawing_tickets: 0,
                    total_won: 1000,
                    total_spent: 250
                },
                demo_mode: true
            });
        }
        
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_tickets,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_tickets,
                SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) as won_tickets,
                SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost_tickets,
                SUM(CASE WHEN status = 'drawing' THEN 1 ELSE 0 END) as drawing_tickets,
                COALESCE(SUM(win_amount), 0) as total_won,
                COALESCE(SUM(price), 0) as total_spent
            FROM tickets 
            WHERE user_id = $1
        `, [userId]);
        
        res.json({
            success: true,
            stats: stats.rows[0] || {
                total_tickets: 0,
                active_tickets: 0,
                won_tickets: 0,
                lost_tickets: 0,
                drawing_tickets: 0,
                total_won: 0,
                total_spent: 0
            },
            demo_mode: false
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения статистики:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            stats: {
                total_tickets: 0,
                active_tickets: 0,
                won_tickets: 0,
                lost_tickets: 0,
                drawing_tickets: 0,
                total_won: 0,
                total_spent: 0
            },
            demo_mode: true
        });
    }
});

// 8. Получение правил выигрыша
app.get('/api/rules', (req, res) => {
    res.json({
        success: true,
        rules: WIN_RULES,
        demo_mode: demoMode
    });
});

// 9. История тиражей
app.get('/api/draws/history', async (req, res) => {
    try {
        if (demoMode) {
            const history = [];
            for (let i = 1; i <= 5; i++) {
                history.push({
                    id: i,
                    draw_number: `ТИРАЖ-${(1000 - i).toString().slice(-4)}`,
                    draw_time: new Date(Date.now() - i * 15 * 60 * 1000).toISOString(),
                    status: 'completed',
                    winning_numbers: Array.from({length: 12}, (_, i) => i + 1),
                    prize_pool: 10000 + i * 1000
                });
            }
            
            return res.json({
                success: true,
                draws: history,
                demo_mode: true
            });
        }
        
        const result = await pool.query(`
            SELECT * FROM draws 
            WHERE status = 'completed'
            ORDER BY draw_time DESC
            LIMIT 10
        `);
        
        res.json({
            success: true,
            draws: result.rows,
            demo_mode: false
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения истории тиражей:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            draws: [],
            demo_mode: true
        });
    }
});

// ==================== СТАТИЧЕСКИЕ СТРАНИЦЫ ====================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/game.html'));
});

app.get('/game', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/game.html'));
});

app.get('/tickets', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/tickets.html'));
});

app.get('/js/:filename', (req, res) => {
    const filename = req.params.filename;
    res.sendFile(path.join(__dirname, `../public/js/${filename}`));
});

// ==================== ОБРАБОТКА ОШИБОК ====================

app.use('/api/*', (req, res) => {
    res.status(404).json({ 
        success: false,
        error: 'Маршрут не найден',
        available_routes: [
            'POST /api/auth/telegram',
            'GET  /api/draws/current/status',
            'GET  /api/draws/history',
            'GET  /api/user/balance',
            'GET  /api/user/tickets',
            'GET  /api/user/stats',
            'GET  /api/numbers/quick-pick',
            'POST /api/tickets/buy',
            'GET  /api/rules',
            'GET  /api/health',
            'GET  /api/test-db'
        ]
    });
});

app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Страница не найдена'
    });
});

app.use((err, req, res, next) => {
    console.error('🔥 Ошибка сервера:', err);
    res.status(500).json({
        success: false,
        error: 'Внутренняя ошибка сервера'
    });
});

// ==================== ЗАПУСК СЕРВЕРА ====================

async function startServer() {
    try {
        console.log('🔧 Инициализация сервера Fortuna Lottery...');
        
        await initializeDatabase();
        
        console.log('🔍 Проверка подключения к БД...');
        const dbConnected = await checkDatabaseConnection();
        demoMode = !dbConnected;
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Сервер запущен на порту ${PORT}`);
            console.log(`🌐 URL: http://localhost:${PORT}`);
            console.log(`🎮 Игровая страница: http://localhost:${PORT}/game`);
            console.log(`🎫 Билеты: http://localhost:${PORT}/tickets`);
            console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
            console.log(`💾 База данных: ${dbConnected ? 'ПОДКЛЮЧЕНА' : 'НЕДОСТУПНА (демо-режим)'}`);
            console.log('='.repeat(70));
        });
        
    } catch (error) {
        console.error('❌ Критическая ошибка запуска сервера:', error);
        process.exit(1);
    }
}

startServer();

// Обработчики завершения
process.on('SIGTERM', async () => {
    console.log('🛑 Получен SIGTERM, завершение работы...');
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 Получен SIGINT, завершение работы...');
    process.exit(0);
});
