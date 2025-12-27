// server/app.js - ПОЛНАЯ ИСПРАВЛЕННАЯ ВЕРСИЯ ДЛЯ НЕПРЕРЫВНЫХ ТИРАЖЕЙ
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

// Проверка загрузки переменных
console.log('='.repeat(70));
console.log('🔧 ЗАПУСК FORTUNA LOTTERY С НЕПРЕРЫВНЫМИ ТИРАЖАМИ');
console.log('='.repeat(70));

// ==================== КОНФИГУРАЦИЯ ====================

const CONFIG = {
    TICKET_PRICE: 50,
    DRAW_INTERVAL_MINUTES: 15,        // Новый тираж каждые 15 минут
    DRAW_DURATION_MINUTES: 1,         // 1 минута на розыгрыш
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

// Безопасная генерация чисел с использованием crypto
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

// Создание демо-тиража
function createDemoDraw() {
    const now = Date.now();
    const fifteenMinutes = CONFIG.DRAW_INTERVAL_MINUTES * 60 * 1000;
    const oneMinute = CONFIG.DRAW_DURATION_MINUTES * 60 * 1000;
    
    // Определяем статус на основе времени
    let status = 'scheduled';
    let drawTime = new Date(now + fifteenMinutes);
    let timeRemaining = Math.floor((drawTime - now) / 1000);
    
    // Для демо - если есть текущий тираж и его время вышло
    if (demoDraws.currentDraw) {
        const currentDrawEndTime = new Date(demoDraws.currentDraw.draw_time).getTime();
        const timeSinceLastUpdate = now - demoDraws.lastUpdated;
        
        // Если тираж был в статусе scheduled и время вышло
        if (demoDraws.currentDraw.status === 'scheduled' && now >= currentDrawEndTime) {
            status = 'drawing';
            drawTime = new Date(now + oneMinute); // 1 минута на розыгрыш
            timeRemaining = Math.floor((drawTime - now) / 1000);
        }
        // Если тираж был в статусе drawing и время вышло
        else if (demoDraws.currentDraw.status === 'drawing' && now >= currentDrawEndTime) {
            // Создаем новый тираж
            status = 'scheduled';
            drawTime = new Date(now + fifteenMinutes);
            timeRemaining = Math.floor((drawTime - now) / 1000);
            
            // Генерируем выигрышные числа для завершенного тиража
            const winningNumbers = generateSecureNumbers(
                CONFIG.NUMBERS_TO_SELECT,
                CONFIG.NUMBERS_RANGE.min,
                CONFIG.NUMBERS_RANGE.max
            );
            
            // Сохраняем завершенный тираж
            demoDraws.completedDraws = demoDraws.completedDraws || [];
            demoDraws.completedDraws.push({
                ...demoDraws.currentDraw,
                status: 'completed',
                winning_numbers: winningNumbers
            });
            
            // Ограничиваем историю до 5 последних тиражей
            if (demoDraws.completedDraws.length > 5) {
                demoDraws.completedDraws.shift();
            }
        }
    }
    
    // Получаем следующий номер для тиража
    let nextNumber = 1;
    if (demoDraws.currentDraw) {
        const match = demoDraws.currentDraw.draw_number.match(/ТИРАЖ-(\d+)/);
        if (match) {
            nextNumber = parseInt(match[1]) + 1;
        }
    }
    
    const draw = {
        id: Date.now(),
        draw_number: `ТИРАЖ-${String(nextNumber).padStart(4, '0')}`,
        draw_time: drawTime.toISOString(),
        status: status,
        jackpot_balance: CONFIG.JACKPOT_INITIAL,
        time_remaining: timeRemaining,
        time_formatted: `${Math.floor(timeRemaining / 60)} мин ${(timeRemaining % 60).toString().padStart(2, '0')} сек`,
        can_buy_tickets: status === 'scheduled' && timeRemaining > (CONFIG.DRAW_DURATION_MINUTES * 60),
        winning_numbers: null
    };
    
    // Если это тираж в процессе розыгрыша, генерируем числа
    if (status === 'drawing') {
        draw.winning_numbers = generateSecureNumbers(
            CONFIG.NUMBERS_TO_SELECT,
            CONFIG.NUMBERS_RANGE.min,
            CONFIG.NUMBERS_RANGE.max
        );
    }
    
    return draw;
}

// Обновление демо-тиража
function updateDemoDraw() {
    if (!demoDraws.currentDraw) {
        demoDraws.currentDraw = createDemoDraw();
        demoDraws.lastUpdated = Date.now();
        return;
    }
    
    const now = Date.now();
    const drawTime = new Date(demoDraws.currentDraw.draw_time).getTime();
    const timeRemaining = Math.max(0, Math.floor((drawTime - now) / 1000));
    
    demoDraws.currentDraw.time_remaining = timeRemaining;
    
    // Обновляем статус если время вышло
    if (timeRemaining === 0) {
        if (demoDraws.currentDraw.status === 'scheduled') {
            // Переходим в статус розыгрыша
            demoDraws.currentDraw.status = 'drawing';
            demoDraws.currentDraw.draw_time = new Date(now + CONFIG.DRAW_DURATION_MINUTES * 60 * 1000).toISOString();
            demoDraws.currentDraw.time_remaining = CONFIG.DRAW_DURATION_MINUTES * 60;
            demoDraws.currentDraw.can_buy_tickets = false;
            
            // Генерируем выигрышные числа
            demoDraws.currentDraw.winning_numbers = generateSecureNumbers(
                CONFIG.NUMBERS_TO_SELECT,
                CONFIG.NUMBERS_RANGE.min,
                CONFIG.NUMBERS_RANGE.max
            );
            
            console.log('🎲 Демо-тираж перешел в статус "идет розыгрыш"');
        } else if (demoDraws.currentDraw.status === 'drawing') {
            // Сохраняем завершенный тираж
            demoDraws.completedDraws = demoDraws.completedDraws || [];
            demoDraws.completedDraws.push({
                ...demoDraws.currentDraw,
                status: 'completed'
            });
            
            // Ограничиваем историю
            if (demoDraws.completedDraws.length > 5) {
                demoDraws.completedDraws.shift();
            }
            
            // Создаем новый тираж
            demoDraws.currentDraw = createDemoDraw();
            console.log('✅ Демо-тираж завершен, создан новый');
        }
    }
    
    // Обновляем статус покупки билетов
    if (demoDraws.currentDraw.status === 'scheduled') {
        demoDraws.currentDraw.can_buy_tickets = demoDraws.currentDraw.time_remaining > (CONFIG.DRAW_DURATION_MINUTES * 60);
    } else {
        demoDraws.currentDraw.can_buy_tickets = false;
    }
    
    demoDraws.lastUpdated = now;
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
        version: '5.0.0',
        demo_mode: demoMode,
        db_status: global.dbStatus,
        config: CONFIG
    });
});

// ==================== API МАРШРУТЫ ====================

// 1. Авторизация Telegram
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
            updateDemoDraw();
            const draw = demoDraws.currentDraw || createDemoDraw();
            demoDraws.currentDraw = draw;
            
            return res.json({
                success: true,
                draw: draw,
                demo_mode: true,
                server_time: new Date().toISOString(),
                message: `Тиражи ${draw.draw_number} - ${draw.status}`
            });
        }
        
        // Получаем текущий активный тираж
        let drawResult = await pool.query(`
            SELECT id, draw_number, status, draw_time, prize_pool,
            EXTRACT(EPOCH FROM (draw_time - NOW())) as time_remaining,
            COALESCE(jackpot_balance, 10000) as jackpot_balance,
            winning_numbers
            FROM draws 
            WHERE status IN ('scheduled', 'drawing')
            ORDER BY CASE 
                WHEN status = 'drawing' THEN 1
                WHEN status = 'scheduled' THEN 2
                ELSE 3
            END, draw_time ASC
            LIMIT 1
        `);
        
        if (drawResult.rows.length === 0) {
            // Создаем новый тираж если нет активного
            const nextNumberResult = await pool.query(`
                SELECT COALESCE(
                    MAX(CAST(SUBSTRING(draw_number FROM 'ТИРАЖ-(\\d+)') AS INTEGER)), 
                    0
                ) + 1 as next_num FROM draws WHERE draw_number LIKE 'ТИРАЖ-%'
            `);
            
            const nextNum = nextNumberResult.rows[0]?.next_num || 1;
            const drawNumber = `ТИРАЖ-${String(nextNum).padStart(4, '0')}`;
            const drawTime = new Date(Date.now() + CONFIG.DRAW_INTERVAL_MINUTES * 60 * 1000);
            const timeRemaining = CONFIG.DRAW_INTERVAL_MINUTES * 60;
            
            const newDraw = await pool.query(`
                INSERT INTO draws (draw_number, draw_time, status, prize_pool, total_tickets, jackpot_balance)
                VALUES ($1, $2, 'scheduled', 10000, 0, 10000)
                RETURNING id, draw_number, draw_time, status, prize_pool, jackpot_balance
            `, [drawNumber, drawTime]);
            
            const draw = newDraw.rows[0];
            
            return res.json({ 
                success: true,
                draw: {
                    id: draw.id,
                    draw_number: draw.draw_number,
                    draw_time: draw.draw_time,
                    status: draw.status,
                    jackpot_balance: draw.jackpot_balance || 10000,
                    time_remaining: timeRemaining,
                    time_formatted: `${CONFIG.DRAW_INTERVAL_MINUTES} мин 00 сек`,
                    can_buy_tickets: timeRemaining > (CONFIG.DRAW_DURATION_MINUTES * 60),
                    winning_numbers: null
                },
                newly_created: true,
                demo_mode: false
            });
        }
        
        let draw = drawResult.rows[0];
        let timeRemaining = Math.max(0, Math.floor(draw.time_remaining));
        let canBuyTickets = draw.status === 'scheduled' && 
            timeRemaining > (CONFIG.DRAW_DURATION_MINUTES * 60);
        
        // Проверяем, не нужно ли обновить статус
        if (draw.status === 'scheduled' && timeRemaining === 0) {
            // Переводим в статус розыгрыша
            await pool.query(`
                UPDATE draws 
                SET status = 'drawing',
                    draw_time = NOW() + INTERVAL '${CONFIG.DRAW_DURATION_MINUTES} minutes'
                WHERE id = $1
                RETURNING *
            `, [draw.id]);
            
            draw.status = 'drawing';
            timeRemaining = CONFIG.DRAW_DURATION_MINUTES * 60;
            canBuyTickets = false;
            
            // Генерируем выигрышные числа
            const winningNumbers = generateSecureNumbers(12, 1, 24);
            await pool.query(`
                UPDATE draws 
                SET winning_numbers = $1
                WHERE id = $2
            `, [winningNumbers, draw.id]);
            
            draw.winning_numbers = winningNumbers;
            
            console.log(`🎲 Тиражи ${draw.draw_number} переведен в статус "идет розыгрыш"`);
        }
        else if (draw.status === 'drawing' && timeRemaining === 0) {
            // Завершаем тираж
            await pool.query(`
                UPDATE draws 
                SET status = 'completed'
                WHERE id = $1
            `, [draw.id]);
            
            // Создаем новый тираж
            const nextNumberResult = await pool.query(`
                SELECT COALESCE(
                    MAX(CAST(SUBSTRING(draw_number FROM 'ТИРАЖ-(\\d+)') AS INTEGER)), 
                    0
                ) + 1 as next_num FROM draws WHERE draw_number LIKE 'ТИРАЖ-%'
            `);
            
            const nextNum = nextNumberResult.rows[0]?.next_num || 1;
            const drawNumber = `ТИРАЖ-${String(nextNum).padStart(4, '0')}`;
            const drawTime = new Date(Date.now() + CONFIG.DRAW_INTERVAL_MINUTES * 60 * 1000);
            const newTimeRemaining = CONFIG.DRAW_INTERVAL_MINUTES * 60;
            
            const newDraw = await pool.query(`
                INSERT INTO draws (draw_number, draw_time, status, prize_pool, total_tickets, jackpot_balance)
                VALUES ($1, $2, 'scheduled', 10000, 0, 10000)
                RETURNING id, draw_number, draw_time, status, prize_pool, jackpot_balance
            `, [drawNumber, drawTime]);
            
            const newDrawData = newDraw.rows[0];
            
            return res.json({ 
                success: true,
                draw: {
                    id: newDrawData.id,
                    draw_number: newDrawData.draw_number,
                    draw_time: newDrawData.draw_time,
                    status: newDrawData.status,
                    jackpot_balance: newDrawData.jackpot_balance || 10000,
                    time_remaining: newTimeRemaining,
                    time_formatted: `${CONFIG.DRAW_INTERVAL_MINUTES} мин 00 сек`,
                    can_buy_tickets: newTimeRemaining > (CONFIG.DRAW_DURATION_MINUTES * 60),
                    winning_numbers: null
                },
                previous_draw_completed: draw.draw_number,
                demo_mode: false
            });
        }
        
        res.json({ 
            success: true,
            draw: {
                id: draw.id,
                draw_number: draw.draw_number,
                draw_time: draw.draw_time,
                status: draw.status,
                jackpot_balance: draw.jackpot_balance || 10000,
                time_remaining: timeRemaining,
                time_formatted: `${Math.floor(timeRemaining/60)} мин ${(timeRemaining%60).toString().padStart(2,'0')} сек`,
                can_buy_tickets: canBuyTickets,
                winning_numbers: draw.winning_numbers
            },
            demo_mode: false
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения статуса тиража:', error);
        demoMode = true;
        updateDemoDraw();
        const draw = demoDraws.currentDraw || createDemoDraw();
        
        res.json({
            success: true,
            draw: draw,
            demo_mode: true,
            error: error.message
        });
    }
});

// 3. Запуск розыгрыша (вызывается клиентом)
app.post('/api/draws/trigger-draw', async (req, res) => {
    try {
        console.log('🎲 Запуск розыгрыша текущего тиража');
        
        if (demoMode) {
            updateDemoDraw();
            const draw = demoDraws.currentDraw;
            
            if (draw.status === 'drawing' && !draw.winning_numbers) {
                draw.winning_numbers = generateSecureNumbers(12, 1, 24);
            }
            
            return res.json({
                success: true,
                draw: draw,
                demo_mode: true
            });
        }
        
        // Находим тираж в статусе drawing
        const drawResult = await pool.query(`
            SELECT * FROM draws 
            WHERE status = 'drawing'
            ORDER BY draw_time ASC
            LIMIT 1
        `);
        
        if (drawResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Нет активного тиража для розыгрыша'
            });
        }
        
        const draw = drawResult.rows[0];
        
        // Генерируем выигрышные числа если их еще нет
        let winningNumbers = draw.winning_numbers;
        if (!winningNumbers || winningNumbers.length === 0) {
            winningNumbers = generateSecureNumbers(12, 1, 24);
            
            await pool.query(`
                UPDATE draws 
                SET winning_numbers = $1
                WHERE id = $2
            `, [winningNumbers, draw.id]);
        }
        
        // Обрабатываем билеты этого тиража
        await processTicketsForDraw(draw.id, winningNumbers);
        
        res.json({
            success: true,
            draw: {
                ...draw,
                winning_numbers: winningNumbers
            },
            demo_mode: false
        });
        
    } catch (error) {
        console.error('❌ Ошибка запуска розыгрыша:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            demo_mode: demoMode
        });
    }
});

// 4. Завершение тиража и создание нового
app.post('/api/draws/complete-and-create', async (req, res) => {
    try {
        console.log('🔄 Завершение текущего тиража и создание нового');
        
        if (demoMode) {
            updateDemoDraw();
            
            // Сохраняем завершенный тираж
            if (demoDraws.currentDraw && demoDraws.currentDraw.status === 'drawing') {
                demoDraws.completedDraws = demoDraws.completedDraws || [];
                demoDraws.completedDraws.push({
                    ...demoDraws.currentDraw,
                    status: 'completed'
                });
                
                if (demoDraws.completedDraws.length > 5) {
                    demoDraws.completedDraws.shift();
                }
            }
            
            // Создаем новый тираж
            demoDraws.currentDraw = createDemoDraw();
            
            return res.json({
                success: true,
                new_draw: demoDraws.currentDraw,
                demo_mode: true
            });
        }
        
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Находим и завершаем текущий тираж
            const currentDrawResult = await client.query(`
                SELECT * FROM draws 
                WHERE status IN ('scheduled', 'drawing')
                ORDER BY 
                    CASE WHEN status = 'drawing' THEN 1 ELSE 2 END,
                    draw_time ASC
                LIMIT 1
                FOR UPDATE
            `);
            
            if (currentDrawResult.rows.length === 0) {
                throw new Error('Нет активного тиража для завершения');
            }
            
            const currentDraw = currentDrawResult.rows[0];
            
            // Завершаем текущий тираж
            await client.query(`
                UPDATE draws 
                SET status = 'completed',
                    completed_at = NOW()
                WHERE id = $1
            `, [currentDraw.id]);
            
            // Создаем новый тираж
            const nextNumberResult = await client.query(`
                SELECT COALESCE(
                    MAX(CAST(SUBSTRING(draw_number FROM 'ТИРАЖ-(\\d+)') AS INTEGER)), 
                    0
                ) + 1 as next_num FROM draws WHERE draw_number LIKE 'ТИРАЖ-%'
            `);
            
            const nextNum = nextNumberResult.rows[0]?.next_num || 1;
            const newDrawNumber = `ТИРАЖ-${String(nextNum).padStart(4, '0')}`;
            const newDrawTime = new Date(Date.now() + CONFIG.DRAW_INTERVAL_MINUTES * 60 * 1000);
            const newTimeRemaining = CONFIG.DRAW_INTERVAL_MINUTES * 60;
            
            const newDrawResult = await client.query(`
                INSERT INTO draws (
                    draw_number, draw_time, status, prize_pool, 
                    total_tickets, jackpot_balance
                ) VALUES ($1, $2, 'scheduled', 10000, 0, 10000)
                RETURNING id, draw_number, draw_time, status, prize_pool, jackpot_balance
            `, [newDrawNumber, newDrawTime]);
            
            const newDraw = newDrawResult.rows[0];
            
            await client.query('COMMIT');
            
            res.json({
                success: true,
                completed_draw: {
                    id: currentDraw.id,
                    draw_number: currentDraw.draw_number,
                    status: 'completed'
                },
                new_draw: {
                    id: newDraw.id,
                    draw_number: newDraw.draw_number,
                    draw_time: newDraw.draw_time,
                    status: newDraw.status,
                    jackpot_balance: newDraw.jackpot_balance || 10000,
                    time_remaining: newTimeRemaining,
                    time_formatted: `${CONFIG.DRAW_INTERVAL_MINUTES} мин 00 сек`,
                    can_buy_tickets: newTimeRemaining > (CONFIG.DRAW_DURATION_MINUTES * 60)
                },
                demo_mode: false
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('❌ Ошибка завершения тиража:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            demo_mode: demoMode
        });
    }
});

// 5. Покупка билета
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
            const currentDraw = demoDraws.currentDraw || createDemoDraw();
            
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
                UPDATE draws 
                SET total_tickets = total_tickets + 1
                WHERE id = $1
            `, [draw.id]);
            
            await client.query(`
                INSERT INTO transactions (user_id, type, amount, description, status)
                VALUES ($1, 'ticket_purchase', $2, $3, 'completed')
            `, [userId, CONFIG.TICKET_PRICE, `Покупка билета на тираж ${draw.draw_number}`]);
            
            await client.query('COMMIT');
            
            res.json({
                success: true,
                ticket: {
                    ...ticketResult.rows[0],
                    draw_number: draw.draw_number
                },
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

// 6. Получение билетов пользователя
app.get('/api/user/tickets', async (req, res) => {
    try {
        const { userId, status } = req.query;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'Не указан userId',
                tickets: []
            });
        }
        
        if (demoMode) {
            const demo_tickets = [
                {
                    id: 1,
                    ticket_number: 'TICKET-' + Date.now().toString().slice(-8),
                    draw_number: 'ТИРАЖ-' + (Date.now() - 86400000).toString().slice(-6),
                    numbers: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23],
                    status: 'won',
                    prize_amount: 250,
                    win_amount: 250,
                    created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
                    winning_numbers: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23],
                    matched_count: 12
                }
            ];
            
            return res.json({
                success: true,
                tickets: demo_tickets,
                demo_mode: true
            });
        }
        
        let query = `
            SELECT 
                t.id,
                t.ticket_number,
                t.numbers,
                t.price,
                t.status,
                t.win_amount,
                t.matched_count,
                t.created_at,
                d.draw_number,
                d.winning_numbers
            FROM tickets t
            LEFT JOIN draws d ON t.draw_id = d.id
            WHERE t.user_id = $1
        `;
        
        const params = [userId];
        
        if (status && status !== '' && status !== 'all') {
            query += ` AND t.status = $2`;
            params.push(status);
        }
        
        query += ` ORDER BY t.created_at DESC`;
        
        const result = await pool.query(query, params);
        
        res.json({
            success: true,
            tickets: result.rows,
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

// Функция обработки билетов для тиража
async function processTicketsForDraw(drawId, winningNumbers) {
    try {
        console.log(`📊 Обработка билетов для тиража ${drawId}...`);
        
        const tickets = await pool.query(`
            SELECT * FROM tickets 
            WHERE draw_id = $1 AND status = 'active'
        `, [drawId]);
        
        console.log(`📊 Найдено ${tickets.rows.length} билетов для обработки`);
        
        for (const ticket of tickets.rows) {
            const ticketNumbers = ticket.numbers || [];
            const matched = ticketNumbers.filter(num => winningNumbers.includes(num));
            const matchedCount = matched.length;
            
            let winAmount = 0;
            let status = 'lost';
            
            if (matchedCount === 12 || matchedCount === 0) {
                status = 'won';
                winAmount = 10000;
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
            
            await pool.query(`
                UPDATE tickets 
                SET status = $1,
                    win_amount = $2,
                    matched_count = $3,
                    matched_numbers = $4,
                    checked_at = NOW()
                WHERE id = $5
            `, [status, winAmount, matchedCount, matched, ticket.id]);
            
            if (winAmount > 0) {
                await pool.query(`
                    UPDATE users 
                    SET balance = balance + $1,
                        total_won = total_won + $1,
                        updated_at = NOW()
                    WHERE id = $2
                `, [winAmount, ticket.user_id]);
                
                await pool.query(`
                    INSERT INTO transactions (user_id, type, amount, description, status)
                    VALUES ($1, 'win', $2, 'Выигрыш в лотерее', 'completed')
                `, [ticket.user_id, winAmount]);
            }
        }
        
        console.log(`✅ Билеты обработаны для тиража ${drawId}`);
        
    } catch (error) {
        console.error(`❌ Ошибка обработки билетов для тиража ${drawId}:`, error);
    }
}

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

// ==================== ЗАПУСК СЕРВЕРА ====================

async function startServer() {
    try {
        console.log('🔧 Инициализация сервера Fortuna Lottery...');
        
        await initializeDatabase();
        
        const dbConnected = await checkDatabaseConnection();
        demoMode = !dbConnected;
        
        // Обновляем демо-тираж каждую секунду
        setInterval(() => {
            if (demoMode) {
                updateDemoDraw();
            }
        }, 1000);
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Сервер запущен на порту ${PORT}`);
            console.log(`🎮 Игровая страница: http://localhost:${PORT}/game`);
            console.log(`💾 База данных: ${dbConnected ? 'ПОДКЛЮЧЕНА' : 'НЕДОСТУПНА (демо-режим)'}`);
            console.log(`🎰 Тираж каждые: ${CONFIG.DRAW_INTERVAL_MINUTES} минут`);
            console.log(`⏱️  Розыгрыш длится: ${CONFIG.DRAW_DURATION_MINUTES} минуту`);
            console.log('='.repeat(70));
            
            if (demoMode) {
                console.log('⚠️  ВНИМАНИЕ: Работаем в ДЕМО-РЕЖИМЕ');
                demoDraws.currentDraw = createDemoDraw();
            }
        });
        
    } catch (error) {
        console.error('❌ Критическая ошибка запуска сервера:', error);
        process.exit(1);
    }
}

startServer();
