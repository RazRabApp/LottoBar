// server/app.js - ИСПРАВЛЕННАЯ ВЕРСИЯ ДЛЯ ТЕЛЕГРАМ АВТОРИЗАЦИИ
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
let demoDraws = {
    currentDraw: null,
    lastUpdated: null
};

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

function generateDemoDraw() {
    const now = Date.now();
    const fifteenMinutes = CONFIG.DRAW_INTERVAL_MINUTES * 60 * 1000;
    
    if (!demoDraws.currentDraw || (now - demoDraws.lastUpdated) > fifteenMinutes) {
        const nextDrawTime = new Date(now + fifteenMinutes);
        const timeRemaining = Math.floor((nextDrawTime - now) / 1000);
        
        demoDraws.currentDraw = {
            id: Date.now(),
            draw_number: 'ТИРАЖ-' + now.toString().slice(-6),
            draw_time: nextDrawTime.toISOString(),
            status: 'scheduled',
            jackpot_balance: CONFIG.JACKPOT_INITIAL,
            time_remaining: timeRemaining,
            time_formatted: `${Math.floor(timeRemaining / 60)} мин ${timeRemaining % 60} сек`,
            can_buy_tickets: timeRemaining > (CONFIG.DRAW_DURATION_MINUTES * 60),
            winning_numbers: generateSecureNumbers(
                CONFIG.NUMBERS_TO_SELECT,
                CONFIG.NUMBERS_RANGE.min,
                CONFIG.NUMBERS_RANGE.max
            ),
            prize_pool: CONFIG.JACKPOT_INITIAL,
            total_tickets: Math.floor(Math.random() * 100) + 10
        };
        
        demoDraws.lastUpdated = now;
        console.log('🎰 Создан новый демо-тираж:', demoDraws.currentDraw.draw_number);
    }
    
    return demoDraws.currentDraw;
}

function updateDemoDraw() {
    if (!demoDraws.currentDraw) return;
    
    const now = Date.now();
    const drawTime = new Date(demoDraws.currentDraw.draw_time).getTime();
    const timeRemaining = Math.max(0, Math.floor((drawTime - now) / 1000));
    
    demoDraws.currentDraw.time_remaining = timeRemaining;
    demoDraws.currentDraw.can_buy_tickets = timeRemaining > (CONFIG.DRAW_DURATION_MINUTES * 60);
    
    if (timeRemaining === 0 && demoDraws.currentDraw.status === 'scheduled') {
        demoDraws.currentDraw.status = 'drawing';
        demoDraws.currentDraw.time_remaining = CONFIG.DRAW_DURATION_MINUTES * 60;
        demoDraws.currentDraw.can_buy_tickets = false;
        console.log('🎲 Демо-тираж перешел в статус "идет розыгрыш"');
    } else if (timeRemaining === 0 && demoDraws.currentDraw.status === 'drawing') {
        demoDraws.currentDraw.status = 'completed';
        console.log('✅ Демо-тираж завершен');
    }
}

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
        if (req.path !== '/api/health' && req.path !== '/api/debug/db') {
            console.log(`🌐 Демо-режим для: ${req.method} ${req.path}`);
        }
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

// 1. Авторизация Telegram - ИСПРАВЛЕННЫЙ КОД
app.post('/api/auth/telegram', async (req, res) => {
    try {
        const { telegram_id, username, first_name, last_name, initData } = req.body;
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
        
        // Режим с БД
        try {
            console.log('🔍 Поиск пользователя в БД...');
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
                // Пользователь найден
                user = result.rows[0];
                console.log('✅ Пользователь найден в БД:', user.username);
                
                // Обновляем активность
                await pool.query(
                    'UPDATE users SET last_active = NOW() WHERE id = $1',
                    [user.id]
                );
                
            } else {
                // Создаем нового пользователя
                console.log('🆕 Создание нового пользователя...');
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
            
            // Генерируем токен
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
            // Fallback на демо-режим
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
        
        console.log('🔍 Проверяем подключение к БД:', global.dbStatus.connected);
        console.log('🔍 Демо-режим:', demoMode);
        
        if (demoMode) {
            console.log('🌐 Используем демо-режим...');
            updateDemoDraw();
            const draw = generateDemoDraw();
            console.log('✅ Демо-тираж создан:', draw.draw_number);
            return res.json({
                success: true,
                draw: draw,
                demo_mode: true,
                server_time: new Date().toISOString()
            });
        }
        
        console.log('💾 Пытаемся загрузить из БД...');
        
        const result = await pool.query(`
            SELECT id, draw_number, status, draw_time, prize_pool,
            FLOOR(EXTRACT(EPOCH FROM (draw_time - NOW()))) as time_remaining,
            COALESCE(jackpot_balance, 10000) as jackpot_balance,
            total_tickets,
            winning_numbers
            FROM draws 
            WHERE status IN ('scheduled', 'drawing')
            ORDER BY draw_time ASC
            LIMIT 1
        `);
        
        if (result.rows.length > 0) {
            const draw = result.rows[0];
            const timeRemaining = Math.max(0, Math.floor(draw.time_remaining));
            const canBuyTickets = draw.status === 'scheduled' && 
                timeRemaining > (CONFIG.DRAW_DURATION_MINUTES * 60);
            
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
                INSERT INTO draws (draw_number, draw_time, status, prize_pool, total_tickets, jackpot_balance)
                VALUES ($1, NOW() + INTERVAL '15 minutes', 'scheduled', 10000, 0, 10000)
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
                demo_mode: false,
                newly_created: true
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка получения статуса тиража:', error);
        demoMode = true;
        updateDemoDraw();
        const draw = generateDemoDraw();
        
        res.json({
            success: true,
            draw: draw,
            demo_mode: true,
            error: error.message
        });
    }
});

// 3. Покупка билета
app.post('/api/tickets/buy', async (req, res) => {
    try {
        console.log('🎫 Запрос покупки билета:', req.body);
        const { userId, numbers } = req.body;
        
        if (!userId || !numbers || numbers.length !== CONFIG.NUMBERS_TO_SELECT) {
            return res.status(400).json({
                success: false,
                error: `Неверные данные. Выберите ${CONFIG.NUMBERS_TO_SELECT} чисел от ${CONFIG.NUMBERS_RANGE.min} до ${CONFIG.NUMBERS_RANGE.max}.`,
                demo_mode: demoMode
            });
        }
        
        const invalidNumbers = numbers.filter(n => 
            n < CONFIG.NUMBERS_RANGE.min || 
            n > CONFIG.NUMBERS_RANGE.max || 
            !Number.isInteger(n)
        );
        if (invalidNumbers.length > 0) {
            return res.status(400).json({
                success: false,
                error: `Некорректные числа: ${invalidNumbers.join(', ')}.`,
                demo_mode: demoMode
            });
        }
        
        if (demoMode) {
            const ticketNumber = 'TKT-DEMO-' + Date.now().toString().slice(-8);
            const currentDraw = demoDraws.currentDraw || generateDemoDraw();
            
            const ticket = {
                id: Date.now(),
                ticket_number: ticketNumber,
                user_id: userId,
                draw_id: currentDraw.id,
                draw_number: currentDraw.draw_number,
                numbers: numbers.sort((a, b) => a - b),
                price: CONFIG.TICKET_PRICE,
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
            if (currentBalance < CONFIG.TICKET_PRICE) {
                throw new Error('Недостаточно Stars для покупки билета');
            }
            
            const drawResult = await client.query(`
                SELECT id, draw_number FROM draws 
                WHERE status = 'scheduled' 
                AND draw_time > NOW()
                ORDER BY draw_time ASC 
                LIMIT 1
                FOR UPDATE
            `);
            
            if (drawResult.rows.length === 0) {
                throw new Error('Нет активного тиража для покупки билетов');
            }
            
            const draw = drawResult.rows[0];
            const drawTime = new Date(draw.draw_time);
            const timeUntilDraw = (drawTime - Date.now()) / 1000;
            
            if (timeUntilDraw <= (CONFIG.DRAW_DURATION_MINUTES * 60)) {
                throw new Error('Покупка временно недоступна. Скоро начнется розыгрыш.');
            }
            
            const newBalance = currentBalance - CONFIG.TICKET_PRICE;
            await client.query(
                'UPDATE users SET balance = $1 WHERE id = $2',
                [newBalance, userId]
            );
            
            const ticketNumber = 'TKT-' + 
                Date.now().toString().slice(-8) + '-' + 
                crypto.randomBytes(2).toString('hex').toUpperCase();
            
            const sortedNumbers = [...numbers].sort((a, b) => a - b);
            
            const ticketResult = await client.query(`
                INSERT INTO tickets (
                    user_id, draw_id, ticket_number, 
                    numbers, price, status
                ) VALUES ($1, $2, $3, $4, $5, 'active')
                RETURNING *
            `, [userId, draw.id, ticketNumber, sortedNumbers, CONFIG.TICKET_PRICE]);
            
            await client.query(`
                INSERT INTO transactions (user_id, type, amount, description, status)
                VALUES ($1, 'ticket_purchase', $2, $3, 'completed')
            `, [userId, CONFIG.TICKET_PRICE, `Покупка билета на тираж ${draw.draw_number}`]);
            
            await client.query(`
                UPDATE draws 
                SET total_tickets = total_tickets + 1,
                    prize_pool = prize_pool + $1,
                    jackpot_balance = COALESCE(jackpot_balance, 10000) + $2
                WHERE id = $3
            `, [
                CONFIG.TICKET_PRICE,
                Math.floor(CONFIG.TICKET_PRICE * CONFIG.JACKPOT_PERCENTAGE),
                draw.id
            ]);
            
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
        const numbers = generateSecureNumbers(
            CONFIG.NUMBERS_TO_SELECT,
            CONFIG.NUMBERS_RANGE.min,
            CONFIG.NUMBERS_RANGE.max
        );
        
        res.json({
            success: true,
            numbers: numbers,
            generated_at: new Date().toISOString(),
            algorithm: 'crypto.randomBytes',
            demo_mode: demoMode
        });
    } catch (error) {
        console.error('❌ Ошибка генерации чисел:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка генерации чисел',
            numbers: Array.from({length: CONFIG.NUMBERS_TO_SELECT}, (_, i) => i + 1),
            demo_mode: true
        });
    }
});

// 5. Баланс пользователя - ИСПРАВЛЕННЫЙ КОД
app.get('/api/user/balance', async (req, res) => {
    try {
        const { userId, telegramId } = req.query;
        console.log('💰 Запрос баланса для:', { userId, telegramId });
        
        if (demoMode) {
            return res.json({
                success: true,
                user: {
                    id: userId || 'demo_user',
                    telegram_id: telegramId,
                    username: 'Демо-пользователь',
                    first_name: 'Демо',
                    stars_balance: 1000.00,
                    is_demo: true
                },
                balance: 1000.00,
                demo_mode: true
            });
        }
        
        let user = null;
        
        if (telegramId) {
            const result = await pool.query(`
                SELECT 
                    id, 
                    telegram_id, 
                    username, 
                    first_name, 
                    balance as stars_balance
                FROM users 
                WHERE telegram_id = $1
            `, [telegramId]);
            
            if (result.rows.length > 0) {
                user = result.rows[0];
            }
        }
        
        if (!user && userId && !userId.startsWith('tg_') && !userId.startsWith('browser_')) {
            const result = await pool.query(`
                SELECT 
                    id, 
                    telegram_id, 
                    username, 
                    first_name, 
                    balance as stars_balance
                FROM users 
                WHERE id = $1
            `, [userId]);
            
            if (result.rows.length > 0) {
                user = result.rows[0];
            }
        }
        
        if (!user && telegramId) {
            const newUser = await pool.query(`
                INSERT INTO users (telegram_id, username, first_name, balance)
                VALUES ($1, $2, $3, 1000)
                RETURNING id, telegram_id, username, first_name, balance as stars_balance
            `, [telegramId, 'Новый игрок', 'Игрок']);
            
            user = newUser.rows[0];
        }
        
        if (user) {
            return res.json({
                success: true,
                user: {
                    id: user.id,
                    telegram_id: user.telegram_id,
                    username: user.username,
                    first_name: user.first_name,
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
                username: 'Неизвестный пользователь',
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

// 6. Получение билетов пользователя - ИСПРАВЛЕННЫЙ КОД
app.get('/api/user/tickets', async (req, res) => {
    try {
        const { userId, status, page = 1, limit = 20 } = req.query;
        console.log('📋 Запрос билетов пользователя:', { userId, status, page, limit });
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'Не указан userId',
                tickets: [],
                stats: {
                    total: 0,
                    active: 0,
                    won: 0,
                    lost: 0,
                    drawing: 0,
                    total_won: 0
                }
            });
        }
        
        if (demoMode) {
            // Демо-режим с реалистичными данными
            const demo_tickets = [];
            const demoStatuses = ['active', 'won', 'lost', 'drawing'];
            const demoPrizes = [0, 0, 0, 0, 50, 100, 250, 500, 1000];
            
            for (let i = 1; i <= 8; i++) {
                const status = demoStatuses[Math.floor(Math.random() * demoStatuses.length)];
                const numbers = [];
                const uniqueNumbers = new Set();
                
                // Генерируем уникальные числа
                while (uniqueNumbers.size < 12) {
                    uniqueNumbers.add(Math.floor(Math.random() * 24) + 1);
                }
                
                numbers.push(...Array.from(uniqueNumbers).sort((a, b) => a - b));
                
                demo_tickets.push({
                    id: `demo_${Date.now()}_${i}`,
                    ticket_number: `TICKET-${String(1000 + i).slice(1)}`,
                    draw_number: `ТИРАЖ-${String(100 + i).slice(1)}`,
                    numbers: numbers,
                    price: CONFIG.TICKET_PRICE,
                    status: status,
                    win_amount: status === 'won' ? demoPrizes[Math.floor(Math.random() * demoPrizes.length)] : 0,
                    prize_amount: status === 'won' ? demoPrizes[Math.floor(Math.random() * demoPrizes.length)] : 0,
                    created_at: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString()
                });
            }
            
            // Рассчитываем статистику
            const stats = {
                total_tickets: demo_tickets.length,
                total_won: demo_tickets.filter(t => t.status === 'won').reduce((sum, t) => sum + (t.win_amount || 0), 0),
                active: demo_tickets.filter(t => t.status === 'active').length,
                won: demo_tickets.filter(t => t.status === 'won').length,
                lost: demo_tickets.filter(t => t.status === 'lost').length,
                drawing: demo_tickets.filter(t => t.status === 'drawing').length
            };
            
            return res.json({
                success: true,
                tickets: demo_tickets,
                stats: stats,
                demo_mode: true,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: demo_tickets.length,
                    totalPages: 1
                }
            });
        }
        
        // Реальный режим с БД
        const offset = (parseInt(page) - 1) * parseInt(limit);
        
        // Запрос для билетов
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
                t.matched_count,
                t.matched_numbers,
                t.created_at,
                d.draw_number as draw_number,
                d.draw_time,
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
        
        // Запрос для статистики
        const statsQuery = `
            SELECT 
                COUNT(*) as total_tickets,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_tickets,
                SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) as won_tickets,
                SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost_tickets,
                SUM(CASE WHEN status = 'drawing' THEN 1 ELSE 0 END) as drawing_tickets,
                COALESCE(SUM(win_amount), 0) as total_won
            FROM tickets 
            WHERE user_id = $1
        `;
        
        const statsResult = await pool.query(statsQuery, [userId]);
        const stats = statsResult.rows[0] || {
            total_tickets: 0,
            active_tickets: 0,
            won_tickets: 0,
            lost_tickets: 0,
            drawing_tickets: 0,
            total_won: 0
        };
        
        // Общее количество для пагинации
        let countQuery = 'SELECT COUNT(*) as total FROM tickets WHERE user_id = $1';
        const countParams = [userId];
        
        if (status && status !== '' && status !== 'all') {
            countQuery += ' AND status = $2';
            countParams.push(status);
        }
        
        const countResult = await pool.query(countQuery, countParams);
        const total = parseInt(countResult.rows[0]?.total || 0);
        
        // Форматируем ответ
        const formattedTickets = result.rows.map(ticket => {
            // Преобразуем numbers в массив
            let numbers = [];
            try {
                if (Array.isArray(ticket.numbers)) {
                    numbers = ticket.numbers;
                } else if (typeof ticket.numbers === 'string') {
                    numbers = JSON.parse(ticket.numbers);
                }
            } catch (e) {
                console.warn('⚠️ Ошибка парсинга numbers:', e.message);
            }
            
            return {
                ...ticket,
                numbers: numbers,
                prize_amount: ticket.win_amount || 0
            };
        });
        
        res.json({
            success: true,
            tickets: formattedTickets,
            stats: {
                total_tickets: parseInt(stats.total_tickets) || 0,
                total_won: parseInt(stats.total_won) || 0,
                active: parseInt(stats.active_tickets) || 0,
                won: parseInt(stats.won_tickets) || 0,
                lost: parseInt(stats.lost_tickets) || 0,
                drawing: parseInt(stats.drawing_tickets) || 0
            },
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                totalPages: Math.ceil(total / parseInt(limit))
            },
            demo_mode: false
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения билетов:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            tickets: [],
            stats: {
                total: 0,
                active: 0,
                won: 0,
                lost: 0,
                drawing: 0,
                total_won: 0
            },
            demo_mode: true
        });
    }
});

// 7. Получение статистики пользователя
app.get('/api/user/stats', async (req, res) => {
    try {
        const { userId } = req.query;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'Не указан userId',
                stats: {
                    total: 0,
                    active: 0,
                    won: 0,
                    lost: 0,
                    drawing: 0,
                    total_won: 0
                }
            });
        }
        
        if (demoMode) {
            // Демо-статистика
            return res.json({
                success: true,
                stats: {
                    total_tickets: 8,
                    total_won: 1250,
                    active: 3,
                    won: 2,
                    lost: 2,
                    drawing: 1
                },
                demo_mode: true
            });
        }
        
        // Реальная статистика из БД
        const statsQuery = `
            SELECT 
                COUNT(*) as total_tickets,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_tickets,
                SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) as won_tickets,
                SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost_tickets,
                SUM(CASE WHEN status = 'drawing' THEN 1 ELSE 0 END) as drawing_tickets,
                COALESCE(SUM(win_amount), 0) as total_won
            FROM tickets 
            WHERE user_id = $1
        `;
        
        const result = await pool.query(statsQuery, [userId]);
        const stats = result.rows[0] || {
            total_tickets: 0,
            active_tickets: 0,
            won_tickets: 0,
            lost_tickets: 0,
            drawing_tickets: 0,
            total_won: 0
        };
        
        res.json({
            success: true,
            stats: {
                total_tickets: parseInt(stats.total_tickets) || 0,
                total_won: parseInt(stats.total_won) || 0,
                active: parseInt(stats.active_tickets) || 0,
                won: parseInt(stats.won_tickets) || 0,
                lost: parseInt(stats.lost_tickets) || 0,
                drawing: parseInt(stats.drawing_tickets) || 0
            },
            demo_mode: false
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения статистики:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            stats: {
                total: 0,
                active: 0,
                won: 0,
                lost: 0,
                drawing: 0,
                total_won: 0
            },
            demo_mode: true
        });
    }
});

// 8. Получение правил выигрыша
app.get('/api/rules', (req, res) => {
    res.json({
        success: true,
        rules: {
            ticket_price: CONFIG.TICKET_PRICE,
            numbers_to_select: CONFIG.NUMBERS_TO_SELECT,
            numbers_range: `${CONFIG.NUMBERS_RANGE.min}-${CONFIG.NUMBERS_RANGE.max}`,
            draw_interval: `${CONFIG.DRAW_INTERVAL_MINUTES} минут`,
            draw_duration: `${CONFIG.DRAW_DURATION_MINUTES} минуты`,
            win_table: WIN_RULES,
            jackpot_info: `${CONFIG.JACKPOT_PERCENTAGE * 100}% от стоимости каждого билета пополняет суперприз`
        },
        demo_mode: demoMode
    });
});

// 9. История тиражей
app.get('/api/draws/history', async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        
        if (demoMode) {
            const history = [];
            for (let i = 1; i <= 5; i++) {
                history.push({
                    id: i,
                    draw_number: `ТИРАЖ-${(1000 - i).toString().slice(-4)}`,
                    draw_time: new Date(Date.now() - i * 15 * 60 * 1000).toISOString(),
                    status: 'completed',
                    winning_numbers: generateSecureNumbers(
                        CONFIG.NUMBERS_TO_SELECT,
                        CONFIG.NUMBERS_RANGE.min,
                        CONFIG.NUMBERS_RANGE.max
                    ),
                    prize_pool: 10000 + i * 1000,
                    total_tickets: Math.floor(Math.random() * 100) + 50,
                    winners_count: Math.floor(Math.random() * 10) + 1
                });
            }
            
            return res.json({
                success: true,
                draws: history,
                demo_mode: true
            });
        }
        
        const offset = (page - 1) * limit;
        
        const result = await pool.query(`
            SELECT * FROM draws 
            WHERE status = 'completed'
            ORDER BY draw_time DESC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);
        
        const totalResult = await pool.query(
            "SELECT COUNT(*) FROM draws WHERE status = 'completed'"
        );
        
        res.json({
            success: true,
            draws: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: parseInt(totalResult.rows[0].count)
            },
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

// ==================== ОТЛАДОЧНЫЕ МАРШРУТЫ ====================

app.get('/api/debug/db', async (req, res) => {
    try {
        const tables = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);
        
        const result = {
            status: 'ok',
            timestamp: new Date().toISOString(),
            demo_mode: demoMode,
            db_status: global.dbStatus,
            tables: tables.rows.map(r => r.table_name),
            config: CONFIG
        };
        
        for (const table of ['users', 'draws', 'tickets', 'transactions']) {
            if (result.tables.includes(table)) {
                const countResult = await pool.query(`SELECT COUNT(*) FROM ${table}`);
                result[`${table}_count`] = parseInt(countResult.rows[0].count);
            }
        }
        
        res.json(result);
        
    } catch (error) {
        res.status(500).json({
            error: error.message,
            timestamp: new Date().toISOString(),
            demo_mode: true
        });
    }
});

app.get('/api/debug/status', (req, res) => {
    if (demoMode) updateDemoDraw();
    
    res.json({
        server: {
            status: 'running',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            version: '4.1.0'
        },
        database: global.dbStatus,
        demo_mode: demoMode,
        config: CONFIG,
        draws: demoMode ? demoDraws : null
    });
});

// ==================== ОБРАБОТКА ОШИБОК ====================

app.use('/api/*', (req, res) => {
    const timestamp = new Date().toISOString();
    console.warn(`⚠️ [${timestamp}] Маршрут не найден: ${req.method} ${req.originalUrl}`);
    
    res.status(404).json({ 
        success: false,
        error: 'Маршрут не найден',
        requested: `${req.method} ${req.originalUrl}`,
        available_routes: [
            'POST /api/auth/telegram',
            'GET  /api/draws/current/status',
            'GET  /api/draws/history',
            'GET  /api/user/balance',
            'GET  /api/numbers/quick-pick',
            'POST /api/tickets/buy',
            'GET  /api/user/tickets',
            'GET  /api/user/stats',
            'GET  /api/rules',
            'GET  /api/health',
            'GET  /api/test-db',
            'GET  /api/debug/db',
            'GET  /api/debug/status'
        ],
        timestamp: timestamp,
        demo_mode: demoMode
    });
});

app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Страница не найдена',
        path: req.originalUrl
    });
});

app.use((err, req, res, next) => {
    console.error('🔥 Ошибка сервера:', err);
    res.status(500).json({
        success: false,
        error: 'Внутренняя ошибка сервера',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Обратитесь к администратору',
        demo_mode: demoMode
    });
});

// ==================== ЗАПУСК СЕРВЕРА ====================

async function startServer() {
    try {
        console.log('🔧 Инициализация сервера Fortuna Lottery...');
        console.log(`📁 Корневая директория: ${__dirname}`);
        
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
            console.log(`🔧 Проверка БД: http://localhost:${PORT}/api/test-db`);
            console.log(`💾 База данных: ${dbConnected ? 'ПОДКЛЮЧЕНА' : 'НЕДОСТУПНА (демо-режим)'}`);
            console.log('='.repeat(70));
            
            if (demoMode) {
                console.log('⚠️  ВНИМАНИЕ: Работаем в ДЕМО-РЕЖИМЕ');
                generateDemoDraw();
            }
        });
        
    } catch (error) {
        console.error('❌ Критическая ошибка запуска сервера:', error);
        process.exit(1);
    }
}

process.on('SIGTERM', async () => {
    console.log('🛑 Получен SIGTERM, завершение работы...');
    await pool.end();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 Получен SIGINT, завершение работы...');
    await pool.end();
    process.exit(0);
});

startServer();

setInterval(() => {
    if (demoMode) updateDemoDraw();
}, 1000);
