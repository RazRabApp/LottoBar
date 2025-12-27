// server/app.js - ПОЛНОСТЬЮ ИСПРАВЛЕННАЯ ВЕРСИЯ ДЛЯ НЕПРЕРЫВНЫХ ТИРАЖЕЙ И ХРАНЕНИЯ ДАННЫХ
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { createHash } = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

console.log('='.repeat(70));
console.log('🔧 ЗАПУСК FORTUNA LOTTERY С НЕПРЕРЫВНЫМИ ТИРАЖАМИ И БЕЗОПАСНЫМ ХРАНЕНИЕМ');
console.log('='.repeat(70));

// ==================== КОНФИГУРАЦИЯ ====================

const CONFIG = {
    TICKET_PRICE: 50,
    DRAW_INTERVAL_MINUTES: 15,
    DRAW_DURATION_MINUTES: 1,
    JACKPOT_INITIAL: 10000,
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

// ==================== КРИПТОГРАФИЧЕСКИЕ ФУНКЦИИ ====================

// Хеширование данных для верификации
function hashData(data) {
    return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

// Подпись данных
function signData(data, secret = process.env.DATA_SECRET || 'fortuna-secret-key') {
    return createHash('sha256').update(JSON.stringify(data) + secret).digest('hex');
}

// Безопасная генерация чисел с верификацией
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
    const verificationHash = hashData({
        numbers: numbersArray,
        proof: proof,
        drawId: drawId,
        generatedAt: new Date().toISOString()
    });
    
    return {
        numbers: numbersArray,
        proof: proof,
        verificationHash: verificationHash,
        timestamp: new Date().toISOString()
    };
}

// ==================== СИСТЕМА ТИРАЖЕЙ ====================

const WIN_RULES = {
    0: { amount: 10000, description: 'Суперприз (0 совпадений)' },
    12: { amount: 10000, description: 'Суперприз (12 совпадений)' },
    1: { amount: 1000, description: '1000 Stars' },
    11: { amount: 1000, description: '1000 Stars' },
    2: { amount: 750, description: '750 Stars' },
    10: { amount: 750, description: '750 Stars' },
    3: { amount: 250, description: '250 Stars' },
    9: { amount: 250, description: '250 Stars' },
    4: { amount: 100, description: '100 Stars' },
    8: { amount: 100, description: '100 Stars' }
};

let demoMode = false;

// ==================== МИДЛВАРЫ ====================

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    const method = req.method;
    const url = req.originalUrl;
    
    if (method === 'POST' && (url.includes('/api/auth') || url.includes('/api/tickets'))) {
        console.log(`📥 [${timestamp}] ${method} ${url}`);
        if (req.body && Object.keys(req.body).length > 0) {
            const safeBody = { ...req.body };
            if (safeBody.token) safeBody.token = '***';
            if (safeBody.initData) safeBody.initData = '***';
            console.log(`   Body:`, JSON.stringify(safeBody).substring(0, 300));
        }
    } else {
        console.log(`📥 [${timestamp}] ${method} ${url}`);
    }
    next();
});

// ==================== МАРШРУТЫ API ====================

// 1. Проверка здоровья
app.get('/api/health', (req, res) => {
    res.json({ 
        success: true,
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: '6.0.0',
        demo_mode: demoMode,
        db_status: global.dbStatus,
        config: CONFIG
    });
});

// 2. Авторизация через Telegram с сохранением реального ID
app.post('/api/auth/telegram', async (req, res) => {
    try {
        const { telegram_id, username, first_name, last_name, initData } = req.body;
        
        console.log('🔐 Запрос авторизации через Telegram:', { 
            telegram_id, 
            username: username || 'не указан',
            name: `${first_name || ''} ${last_name || ''}`.trim() || 'не указано'
        });
        
        if (!telegram_id) {
            return res.status(400).json({
                success: false,
                error: 'Не указан telegram_id'
            });
        }
        
        // Проверяем подключение к БД
        if (!global.dbStatus.connected) {
            console.warn('⚠️ БД недоступна, переключаем в демо-режим');
            demoMode = true;
        }
        
        if (demoMode) {
            // Демо-режим: создаем временного пользователя
            const token = 'tg_demo_' + Date.now() + '_' + crypto.randomBytes(16).toString('hex');
            
            return res.json({
                success: true,
                token: token,
                user: {
                    id: `demo_tg_${telegram_id}`,
                    telegram_id: telegram_id.toString(),
                    username: username || `tg_user_${telegram_id}`,
                    first_name: first_name || 'Telegram',
                    last_name: last_name || 'User',
                    stars_balance: 1000,
                    is_demo: true,
                    created_at: new Date().toISOString()
                },
                demo_mode: true,
                message: 'Демо-режим: данные не сохраняются в БД'
            });
        }
        
        // РЕАЛЬНЫЙ РЕЖИМ С БАЗОЙ ДАННЫХ
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Поиск пользователя по telegram_id
            let userResult = await client.query(`
                SELECT 
                    id, 
                    telegram_id, 
                    username, 
                    first_name, 
                    last_name, 
                    balance as stars_balance,
                    created_at,
                    last_active
                FROM users 
                WHERE telegram_id = $1
            `, [telegram_id.toString()]);
            
            let user;
            
            if (userResult.rows.length === 0) {
                // СОЗДАЕМ НОВОГО ПОЛЬЗОВАТЕЛЯ С РЕАЛЬНЫМ TELEGRAM_ID
                console.log('👤 Создание нового пользователя в БД');
                
                const newUserResult = await client.query(`
                    INSERT INTO users (
                        telegram_id, 
                        username, 
                        first_name, 
                        last_name, 
                        balance,
                        last_active,
                        created_at
                    ) VALUES ($1, $2, $3, $4, 1000, NOW(), NOW())
                    RETURNING 
                        id, 
                        telegram_id, 
                        username, 
                        first_name, 
                        last_name, 
                        balance as stars_balance,
                        created_at,
                        last_active
                `, [
                    telegram_id.toString(),
                    username || `tg_user_${telegram_id}`,
                    first_name || 'Telegram',
                    last_name || 'User'
                ]);
                
                user = newUserResult.rows[0];
                console.log(`✅ Создан новый пользователь: ${user.username} (ID: ${user.id}, Telegram ID: ${user.telegram_id})`);
                
            } else {
                // ОБНОВЛЯЕМ СУЩЕСТВУЮЩЕГО ПОЛЬЗОВАТЕЛЯ
                user = userResult.rows[0];
                
                await client.query(`
                    UPDATE users 
                    SET last_active = NOW(),
                        username = COALESCE($1, username),
                        first_name = COALESCE($2, first_name),
                        last_name = COALESCE($3, last_name)
                    WHERE id = $4
                `, [username, first_name, last_name, user.id]);
                
                console.log(`✅ Найден существующий пользователь: ${user.username} (ID: ${user.id}, Telegram ID: ${user.telegram_id})`);
            }
            
            // ГЕНЕРИРУЕМ ТОКЕН ДОСТУПА
            const tokenData = {
                userId: user.id,
                telegramId: user.telegram_id,
                timestamp: Date.now(),
                random: crypto.randomBytes(32).toString('hex')
            };
            
            const token = 'tg_' + hashData(tokenData);
            
            // СОХРАНЯЕМ ТОКЕН В БАЗУ (ОПЦИОНАЛЬНО)
            await client.query(`
                INSERT INTO user_sessions (user_id, token, created_at, expires_at)
                VALUES ($1, $2, NOW(), NOW() + INTERVAL '30 days')
                ON CONFLICT (user_id) DO UPDATE SET
                    token = EXCLUDED.token,
                    created_at = NOW(),
                    expires_at = NOW() + INTERVAL '30 days'
            `, [user.id, token]);
            
            await client.query('COMMIT');
            
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
                    is_demo: false,
                    created_at: user.created_at,
                    last_active: user.last_active
                },
                demo_mode: false,
                message: 'Успешная авторизация через Telegram'
            });
            
        } catch (dbError) {
            await client.query('ROLLBACK');
            console.error('❌ Ошибка БД при авторизации:', dbError);
            throw dbError;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('❌ Ошибка авторизации:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера при авторизации',
            demo_mode: true
        });
    }
});

// 3. Получение текущего тиража
app.get('/api/draws/current/status', async (req, res) => {
    try {
        console.log('🎰 Запрос статуса текущего тиража');
        
        if (demoMode) {
            // ДЕМО-РЕЖИМ
            const now = Date.now();
            const drawNumber = 'ТИРАЖ-' + Math.floor(now / (15 * 60 * 1000)).toString().slice(-4);
            const nextDrawTime = new Date(Math.ceil(now / (15 * 60 * 1000)) * (15 * 60 * 1000));
            const timeRemaining = Math.floor((nextDrawTime - now) / 1000);
            
            const isDrawing = timeRemaining <= 60;
            const status = isDrawing ? 'drawing' : 'scheduled';
            
            return res.json({
                success: true,
                draw: {
                    id: Math.floor(now / 1000),
                    draw_number: drawNumber,
                    draw_time: nextDrawTime.toISOString(),
                    status: status,
                    jackpot_balance: CONFIG.JACKPOT_INITIAL,
                    time_remaining: timeRemaining,
                    time_formatted: `${Math.floor(timeRemaining / 60)} мин ${(timeRemaining % 60).toString().padStart(2, '0')} сек`,
                    can_buy_tickets: !isDrawing && timeRemaining > 60,
                    winning_numbers: null
                },
                demo_mode: true
            });
        }
        
        // РЕАЛЬНЫЙ РЕЖИМ
        const client = await pool.connect();
        
        try {
            // ПОЛУЧАЕМ ТЕКУЩИЙ АКТИВНЫЙ ТИРАЖ
            let drawResult = await client.query(`
                SELECT 
                    id,
                    draw_number,
                    draw_time,
                    status,
                    prize_pool,
                    jackpot_balance,
                    total_tickets,
                    winning_numbers,
                    winning_proof,
                    completed_at,
                    created_at
                FROM draws 
                WHERE status IN ('scheduled', 'drawing')
                ORDER BY 
                    CASE 
                        WHEN status = 'drawing' THEN 0
                        WHEN status = 'scheduled' THEN 1
                        ELSE 2
                    END,
                    draw_time ASC
                LIMIT 1
            `);
            
            let draw;
            const now = new Date();
            
            if (drawResult.rows.length === 0) {
                // СОЗДАЕМ ПЕРВЫЙ ТИРАЖ
                console.log('🎰 Создание первого тиража');
                
                const firstDrawResult = await client.query(`
                    INSERT INTO draws (
                        draw_number,
                        draw_time,
                        status,
                        prize_pool,
                        jackpot_balance,
                        total_tickets,
                        created_at
                    ) VALUES ('ТИРАЖ-0001', NOW() + INTERVAL '15 minutes', 'scheduled', 10000, 10000, 0, NOW())
                    RETURNING *
                `);
                
                draw = firstDrawResult.rows[0];
            } else {
                draw = drawResult.rows[0];
                
                // ПРОВЕРЯЕМ, НЕ ЗАВЕРШИЛСЯ ЛИ ТИРАЖ
                const drawTime = new Date(draw.draw_time);
                const timeDiff = Math.floor((drawTime - now) / 1000);
                
                if (draw.status === 'scheduled' && timeDiff <= 0) {
                    // ТИРАЖ ЗАВЕРШИЛСЯ, НАЧИНАЕМ РОЗЫГРЫШ
                    console.log(`🎲 Тиражи ${draw.draw_number} завершен, начинаем розыгрыш`);
                    
                    // ГЕНЕРИРУЕМ ВЫИГРЫШНЫЕ ЧИСЛА С ДОКАЗАТЕЛЬСТВАМИ
                    const winningNumbersData = generateSecureNumbersWithProof(
                        CONFIG.NUMBERS_TO_SELECT,
                        CONFIG.NUMBERS_RANGE.min,
                        CONFIG.NUMBERS_RANGE.max,
                        draw.id
                    );
                    
                    await client.query(`
                        UPDATE draws 
                        SET status = 'drawing',
                            draw_time = NOW() + INTERVAL '1 minute',
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
                    
                    // ОБРАБАТЫВАЕМ БИЛЕТЫ ЭТОГО ТИРАЖА
                    await processTicketsForDraw(draw.id, winningNumbersData.numbers, client);
                    
                    draw.status = 'drawing';
                    draw.draw_time = new Date(Date.now() + 60 * 1000).toISOString();
                    draw.winning_numbers = winningNumbersData.numbers;
                    draw.time_remaining = 60;
                    
                } else if (draw.status === 'drawing' && timeDiff <= 0) {
                    // РОЗЫГРЫШ ЗАВЕРШЕН, СОЗДАЕМ НОВЫЙ ТИРАЖ
                    console.log(`✅ Розыгрыш тиража ${draw.draw_number} завершен`);
                    
                    await client.query(`
                        UPDATE draws 
                        SET status = 'completed',
                            completed_at = NOW(),
                            updated_at = NOW()
                        WHERE id = $1
                    `, [draw.id]);
                    
                    // СОЗДАЕМ НОВЫЙ ТИРАЖ
                    const nextNumberResult = await client.query(`
                        SELECT COALESCE(
                            MAX(CAST(SUBSTRING(draw_number FROM 'ТИРАЖ-(\\d+)') AS INTEGER)), 
                            0
                        ) + 1 as next_num 
                        FROM draws 
                        WHERE draw_number LIKE 'ТИРАЖ-%'
                    `);
                    
                    const nextNum = nextNumberResult.rows[0]?.next_num || 1;
                    const nextDrawNumber = `ТИРАЖ-${String(nextNum).padStart(4, '0')}`;
                    const nextDrawTime = new Date(Date.now() + CONFIG.DRAW_INTERVAL_MINUTES * 60 * 1000);
                    
                    const newDrawResult = await client.query(`
                        INSERT INTO draws (
                            draw_number,
                            draw_time,
                            status,
                            prize_pool,
                            jackpot_balance,
                            total_tickets,
                            created_at
                        ) VALUES ($1, $2, 'scheduled', 10000, 10000, 0, NOW())
                        RETURNING *
                    `, [nextDrawNumber, nextDrawTime]);
                    
                    draw = newDrawResult.rows[0];
                }
            }
            
            // РАССЧИТЫВАЕМ ОСТАВШЕЕСЯ ВРЕМЯ
            const drawTime = new Date(draw.draw_time);
            const timeRemaining = Math.max(0, Math.floor((drawTime - now) / 1000));
            const canBuyTickets = draw.status === 'scheduled' && timeRemaining > 60;
            
            const responseDraw = {
                id: draw.id,
                draw_number: draw.draw_number,
                draw_time: draw.draw_time,
                status: draw.status,
                jackpot_balance: draw.jackpot_balance || CONFIG.JACKPOT_INITIAL,
                time_remaining: timeRemaining,
                time_formatted: `${Math.floor(timeRemaining / 60)} мин ${(timeRemaining % 60).toString().padStart(2, '0')} сек`,
                can_buy_tickets: canBuyTickets,
                winning_numbers: draw.winning_numbers || null,
                total_tickets: draw.total_tickets || 0
            };
            
            res.json({
                success: true,
                draw: responseDraw,
                demo_mode: false
            });
            
        } catch (error) {
            console.error('❌ Ошибка получения статуса тиража:', error);
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('❌ Ошибка получения статуса тиража:', error);
        demoMode = true;
        
        // ВОЗВРАЩАЕМ ДЕМО-ДАННЫЕ
        const now = Date.now();
        const drawNumber = 'ТИРАЖ-' + Math.floor(now / (15 * 60 * 1000)).toString().slice(-4);
        const nextDrawTime = new Date(Math.ceil(now / (15 * 60 * 1000)) * (15 * 60 * 1000));
        const timeRemaining = Math.floor((nextDrawTime - now) / 1000);
        
        res.json({
            success: true,
            draw: {
                id: Math.floor(now / 1000),
                draw_number: drawNumber,
                draw_time: nextDrawTime.toISOString(),
                status: 'scheduled',
                jackpot_balance: CONFIG.JACKPOT_INITIAL,
                time_remaining: timeRemaining,
                time_formatted: `${Math.floor(timeRemaining / 60)} мин ${(timeRemaining % 60).toString().padStart(2, '0')} сек`,
                can_buy_tickets: timeRemaining > 60,
                winning_numbers: null
            },
            demo_mode: true
        });
    }
});

// 4. ПОКУПКА БИЛЕТА С ШИФРОВАНИЕМ ДАННЫХ
app.post('/api/tickets/buy', async (req, res) => {
    try {
        const { userId, numbers, token } = req.body;
        
        console.log('🎫 Запрос покупки билета:', { 
            userId: userId ? userId.substring(0, 10) + '...' : 'не указан',
            numbersCount: numbers ? numbers.length : 0,
            token: token ? '***' + token.slice(-6) : 'нет'
        });
        
        if (!userId || !numbers || numbers.length !== CONFIG.NUMBERS_TO_SELECT) {
            return res.status(400).json({
                success: false,
                error: `Неверные данные. Выберите ${CONFIG.NUMBERS_TO_SELECT} чисел от ${CONFIG.NUMBERS_RANGE.min} до ${CONFIG.NUMBERS_RANGE.max}.`,
                demo_mode: demoMode
            });
        }
        
        // ПРОВЕРЯЕМ ЧИСЛА
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
            // ДЕМО-РЕЖИМ
            const ticketNumber = 'TKT-DEMO-' + Date.now().toString().slice(-8) + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();
            const now = Date.now();
            const drawNumber = 'ТИРАЖ-' + Math.floor(now / (15 * 60 * 1000)).toString().slice(-4);
            
            return res.json({
                success: true,
                ticket: {
                    id: 'demo_' + Date.now(),
                    ticket_number: ticketNumber,
                    user_id: userId,
                    draw_number: drawNumber,
                    numbers: numbers.sort((a, b) => a - b),
                    price: CONFIG.TICKET_PRICE,
                    status: 'active',
                    win_amount: 0,
                    created_at: new Date().toISOString(),
                    numbers_hash: hashData(numbers),
                    verification_hash: hashData({
                        ticket_number: ticketNumber,
                        numbers: numbers,
                        timestamp: Date.now(),
                        user_id: userId
                    })
                },
                new_balance: 950,
                message: 'Билет успешно куплен в демо-режиме! 🎫',
                demo_mode: true,
                warning: 'Данные не сохраняются в БД'
            });
        }
        
        // РЕАЛЬНЫЙ РЕЖИМ
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // 1. ПРОВЕРЯЕМ ПОЛЬЗОВАТЕЛЯ
            const userResult = await client.query(`
                SELECT id, telegram_id, balance 
                FROM users 
                WHERE id = $1 OR telegram_id::text = $1
                FOR UPDATE
            `, [userId]);
            
            if (userResult.rows.length === 0) {
                throw new Error('Пользователь не найден');
            }
            
            const user = userResult.rows[0];
            const currentBalance = user.balance;
            
            if (currentBalance < CONFIG.TICKET_PRICE) {
                throw new Error('Недостаточно Stars для покупки билета');
            }
            
            // 2. ПРОВЕРЯЕМ ТЕКУЩИЙ ТИРАЖ
            const drawResult = await client.query(`
                SELECT id, draw_number, draw_time, status
                FROM draws 
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
            
            if (timeUntilDraw <= 60) {
                throw new Error('Покупка временно недоступна. Скоро начнется розыгрыш.');
            }
            
            // 3. ВЫЧИТАЕМ СРЕДСТВА
            const newBalance = currentBalance - CONFIG.TICKET_PRICE;
            await client.query(`
                UPDATE users 
                SET balance = $1,
                    tickets_purchased = COALESCE(tickets_purchased, 0) + 1,
                    updated_at = NOW()
                WHERE id = $2
            `, [newBalance, user.id]);
            
            // 4. ГЕНЕРИРУЕМ НОМЕР БИЛЕТА
            const ticketNumber = 'TKT-' + 
                Date.now().toString().slice(-8) + '-' + 
                crypto.randomBytes(3).toString('hex').toUpperCase();
            
            const sortedNumbers = [...numbers].sort((a, b) => a - b);
            
            // 5. СОЗДАЕМ ХЕШИ ДЛЯ ВЕРИФИКАЦИИ
            const numbersHash = hashData(sortedNumbers);
            const verificationData = {
                ticket_number: ticketNumber,
                user_id: user.id,
                telegram_id: user.telegram_id,
                draw_id: draw.id,
                numbers: sortedNumbers,
                numbers_hash: numbersHash,
                price: CONFIG.TICKET_PRICE,
                timestamp: Date.now(),
                server_seed: crypto.randomBytes(32).toString('hex')
            };
            
            const verificationHash = hashData(verificationData);
            const signedData = signData(verificationData);
            
            // 6. СОХРАНЯЕМ БИЛЕТ В БД
            const ticketResult = await client.query(`
                INSERT INTO tickets (
                    user_id,
                    telegram_id,
                    draw_id,
                    ticket_number,
                    numbers,
                    numbers_hash,
                    verification_hash,
                    signed_data,
                    price,
                    status,
                    created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', NOW())
                RETURNING 
                    id,
                    ticket_number,
                    numbers,
                    price,
                    status,
                    created_at,
                    numbers_hash,
                    verification_hash
            `, [
                user.id,
                user.telegram_id,
                draw.id,
                ticketNumber,
                sortedNumbers,
                numbersHash,
                verificationHash,
                signedData,
                CONFIG.TICKET_PRICE
            ]);
            
            // 7. ОБНОВЛЯЕМ СТАТИСТИКУ ТИРАЖА
            await client.query(`
                UPDATE draws 
                SET total_tickets = total_tickets + 1,
                    updated_at = NOW()
                WHERE id = $1
            `, [draw.id]);
            
            // 8. СОХРАНЯЕМ ТРАНЗАКЦИЮ
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
                ) VALUES ($1, $2, 'ticket_purchase', $3, $4, $5, 'completed', NOW())
            `, [
                user.id,
                user.telegram_id,
                CONFIG.TICKET_PRICE,
                `Покупка билета ${ticketNumber} на тираж ${draw.draw_number}`,
                ticketResult.rows[0].id
            ]);
            
            await client.query('COMMIT');
            
            const ticket = ticketResult.rows[0];
            
            res.json({
                success: true,
                ticket: {
                    ...ticket,
                    draw_number: draw.draw_number,
                    user_telegram_id: user.telegram_id
                },
                new_balance: newBalance,
                message: 'Билет успешно куплен и сохранен в БД! 🎫',
                demo_mode: false,
                verification: {
                    numbers_hash: ticket.numbers_hash,
                    verification_hash: ticket.verification_hash,
                    message: 'Данные защищены криптографическими хешами'
                }
            });
            
            console.log(`✅ Билет куплен: ${ticketNumber} для пользователя ${user.telegram_id}`);
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Ошибка покупки билета:', error);
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

// 5. ПОЛУЧЕНИЕ БИЛЕТОВ ПОЛЬЗОВАТЕЛЯ
app.get('/api/user/tickets', async (req, res) => {
    try {
        const { userId, telegramId, status, page = 1, limit = 50 } = req.query;
        
        console.log('📋 Запрос билетов пользователя:', { 
            userId: userId ? userId.substring(0, 10) + '...' : 'не указан',
            telegramId: telegramId ? telegramId.substring(0, 10) + '...' : 'не указан',
            status: status || 'all',
            page: page,
            limit: limit
        });
        
        if (!userId && !telegramId) {
            return res.status(400).json({
                success: false,
                error: 'Не указаны данные пользователя',
                tickets: [],
                stats: getEmptyStats()
            });
        }
        
        if (demoMode) {
            // ДЕМО-РЕЖИМ
            const demo_tickets = generateDemoTickets(userId || telegramId);
            
            return res.json({
                success: true,
                tickets: demo_tickets,
                stats: calculateStats(demo_tickets),
                demo_mode: true,
                pagination: {
                    page: 1,
                    limit: limit,
                    total: demo_tickets.length,
                    totalPages: 1
                }
            });
        }
        
        // РЕАЛЬНЫЙ РЕЖИМ
        const client = await pool.connect();
        
        try {
            // НАХОДИМ ПОЛЬЗОВАТЕЛЯ
            let userQuery = `
                SELECT id, telegram_id 
                FROM users 
                WHERE 1=1
            `;
            
            const userParams = [];
            
            if (userId) {
                userQuery += ` AND (id = $${userParams.length + 1} OR telegram_id::text = $${userParams.length + 1})`;
                userParams.push(userId);
            }
            
            if (telegramId) {
                userQuery += ` AND telegram_id::text = $${userParams.length + 1}`;
                userParams.push(telegramId);
            }
            
            userQuery += ` LIMIT 1`;
            
            const userResult = await client.query(userQuery, userParams);
            
            if (userResult.rows.length === 0) {
                return res.json({
                    success: true,
                    tickets: [],
                    stats: getEmptyStats(),
                    demo_mode: false,
                    message: 'Пользователь не найден'
                });
            }
            
            const user = userResult.rows[0];
            
            // ПОЛУЧАЕМ БИЛЕТЫ
            let ticketsQuery = `
                SELECT 
                    t.id,
                    t.ticket_number,
                    t.numbers,
                    t.numbers_hash,
                    t.verification_hash,
                    t.price,
                    t.status,
                    t.win_amount,
                    t.matched_count,
                    t.matched_numbers,
                    t.created_at,
                    t.checked_at,
                    d.draw_number,
                    d.draw_time,
                    d.status as draw_status,
                    d.winning_numbers,
                    d.winning_proof,
                    d.verification_hash as draw_verification_hash
                FROM tickets t
                LEFT JOIN draws d ON t.draw_id = d.id
                WHERE t.user_id = $1
            `;
            
            const ticketsParams = [user.id];
            let paramIndex = 2;
            
            if (status && status !== 'all' && status !== '') {
                ticketsQuery += ` AND t.status = $${paramIndex}`;
                ticketsParams.push(status);
                paramIndex++;
            }
            
            ticketsQuery += ` ORDER BY t.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            ticketsParams.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
            
            const ticketsResult = await client.query(ticketsQuery, ticketsParams);
            
            // СТАТИСТИКА
            const statsQuery = `
                SELECT 
                    COUNT(*) as total_tickets,
                    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
                    SUM(CASE WHEN status = 'drawing' THEN 1 ELSE 0 END) as drawing,
                    SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) as won,
                    SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost,
                    COALESCE(SUM(win_amount), 0) as total_won
                FROM tickets 
                WHERE user_id = $1
            `;
            
            const statsResult = await client.query(statsQuery, [user.id]);
            const stats = statsResult.rows[0] || getEmptyStats();
            
            // ОБЩЕЕ КОЛИЧЕСТВО ДЛЯ ПАГИНАЦИИ
            let countQuery = `SELECT COUNT(*) as total FROM tickets WHERE user_id = $1`;
            const countParams = [user.id];
            
            if (status && status !== 'all' && status !== '') {
                countQuery += ` AND status = $2`;
                countParams.push(status);
            }
            
            const countResult = await client.query(countQuery, countParams);
            const total = parseInt(countResult.rows[0]?.total || 0);
            
            // ФОРМАТИРУЕМ ОТВЕТ
            const formattedTickets = ticketsResult.rows.map(ticket => {
                return {
                    id: ticket.id,
                    ticket_number: ticket.ticket_number,
                    draw_number: ticket.draw_number,
                    numbers: ticket.numbers || [],
                    numbers_hash: ticket.numbers_hash,
                    verification_hash: ticket.verification_hash,
                    price: ticket.price,
                    status: ticket.status,
                    win_amount: ticket.win_amount || 0,
                    matched_count: ticket.matched_count || 0,
                    matched_numbers: ticket.matched_numbers || [],
                    created_at: ticket.created_at,
                    checked_at: ticket.checked_at,
                    draw_time: ticket.draw_time,
                    draw_status: ticket.draw_status,
                    winning_numbers: ticket.winning_numbers || [],
                    winning_proof: ticket.winning_proof,
                    draw_verification_hash: ticket.draw_verification_hash,
                    verification: {
                        numbers_valid: ticket.numbers_hash ? 
                            ticket.numbers_hash === hashData(ticket.numbers || []) : 
                            false,
                        message: 'Данные защищены криптографическими хешами'
                    }
                };
            });
            
            res.json({
                success: true,
                tickets: formattedTickets,
                stats: {
                    total_tickets: parseInt(stats.total_tickets) || 0,
                    total_won: parseFloat(stats.total_won) || 0,
                    active: parseInt(stats.active) || 0,
                    drawing: parseInt(stats.drawing) || 0,
                    won: parseInt(stats.won) || 0,
                    lost: parseInt(stats.lost) || 0
                },
                user_info: {
                    id: user.id,
                    telegram_id: user.telegram_id
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
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('❌ Ошибка получения билетов:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            tickets: [],
            stats: getEmptyStats(),
            demo_mode: true
        });
    }
});

// 6. ПОЛУЧЕНИЕ СТАТИСТИКИ ПОЛЬЗОВАТЕЛЯ
app.get('/api/user/stats', async (req, res) => {
    try {
        const { userId, telegramId } = req.query;
        
        if (!userId && !telegramId) {
            return res.json({
                success: true,
                stats: getEmptyStats(),
                demo_mode: demoMode
            });
        }
        
        if (demoMode) {
            return res.json({
                success: true,
                stats: {
                    total_tickets: 5,
                    total_won: 1250,
                    active: 2,
                    drawing: 1,
                    won: 1,
                    lost: 1
                },
                demo_mode: true
            });
        }
        
        const client = await pool.connect();
        
        try {
            // НАХОДИМ ПОЛЬЗОВАТЕЛЯ
            let userQuery = `SELECT id FROM users WHERE `;
            const userParams = [];
            
            if (userId) {
                userQuery += `(id = $1 OR telegram_id::text = $1)`;
                userParams.push(userId);
            } else if (telegramId) {
                userQuery += `telegram_id::text = $1`;
                userParams.push(telegramId);
            }
            
            userQuery += ` LIMIT 1`;
            
            const userResult = await client.query(userQuery, userParams);
            
            if (userResult.rows.length === 0) {
                return res.json({
                    success: true,
                    stats: getEmptyStats(),
                    demo_mode: false
                });
            }
            
            const userIdFromDb = userResult.rows[0].id;
            
            // СТАТИСТИКА
            const statsQuery = `
                SELECT 
                    COUNT(*) as total_tickets,
                    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
                    SUM(CASE WHEN status = 'drawing' THEN 1 ELSE 0 END) as drawing,
                    SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) as won,
                    SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost,
                    COALESCE(SUM(win_amount), 0) as total_won
                FROM tickets 
                WHERE user_id = $1
            `;
            
            const statsResult = await client.query(statsQuery, [userIdFromDb]);
            const stats = statsResult.rows[0] || getEmptyStats();
            
            res.json({
                success: true,
                stats: {
                    total_tickets: parseInt(stats.total_tickets) || 0,
                    total_won: parseFloat(stats.total_won) || 0,
                    active: parseInt(stats.active) || 0,
                    drawing: parseInt(stats.drawing) || 0,
                    won: parseInt(stats.won) || 0,
                    lost: parseInt(stats.lost) || 0
                },
                demo_mode: false
            });
            
        } catch (error) {
            console.error('❌ Ошибка получения статистики:', error);
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('❌ Ошибка получения статистики:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            stats: getEmptyStats(),
            demo_mode: true
        });
    }
});

// 7. БЫСТРЫЙ ВЫБОР ЧИСЕЛ
app.get('/api/numbers/quick-pick', (req, res) => {
    try {
        const numbers = new Set();
        
        while (numbers.size < CONFIG.NUMBERS_TO_SELECT) {
            const randomBuffer = crypto.randomBytes(4);
            const randomValue = randomBuffer.readUInt32BE(0);
            const num = CONFIG.NUMBERS_RANGE.min + (randomValue % (CONFIG.NUMBERS_RANGE.max - CONFIG.NUMBERS_RANGE.min + 1));
            numbers.add(num);
        }
        
        const numbersArray = Array.from(numbers).sort((a, b) => a - b);
        
        res.json({
            success: true,
            numbers: numbersArray,
            verification_hash: hashData({
                numbers: numbersArray,
                timestamp: Date.now(),
                algorithm: 'crypto.randomBytes'
            }),
            demo_mode: demoMode
        });
    } catch (error) {
        console.error('❌ Ошибка генерации чисел:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            numbers: [],
            demo_mode: true
        });
    }
});

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

async function processTicketsForDraw(drawId, winningNumbers, client) {
    try {
        console.log(`📊 Обработка билетов для тиража ${drawId}...`);
        
        const tickets = await client.query(`
            SELECT 
                t.id,
                t.user_id,
                t.numbers,
                t.ticket_number
            FROM tickets t
            WHERE t.draw_id = $1 AND t.status = 'active'
        `, [drawId]);
        
        console.log(`📊 Найдено ${tickets.rows.length} билетов для обработки`);
        
        for (const ticket of tickets.rows) {
            const ticketNumbers = ticket.numbers || [];
            const matched = ticketNumbers.filter(num => winningNumbers.includes(num));
            const matchedCount = matched.length;
            
            let winAmount = 0;
            let status = 'lost';
            
            if (WIN_RULES[matchedCount]) {
                status = 'won';
                winAmount = WIN_RULES[matchedCount].amount;
            }
            
            // ОБНОВЛЯЕМ БИЛЕТ
            await client.query(`
                UPDATE tickets 
                SET status = $1,
                    win_amount = $2,
                    matched_count = $3,
                    matched_numbers = $4,
                    checked_at = NOW()
                WHERE id = $5
            `, [status, winAmount, matchedCount, matched, ticket.id]);
            
            // ЕСЛИ ЕСТЬ ВЫИГРЫШ - ОБНОВЛЯЕМ БАЛАНС
            if (winAmount > 0) {
                await client.query(`
                    UPDATE users 
                    SET balance = balance + $1,
                        total_won = COALESCE(total_won, 0) + $1,
                        updated_at = NOW()
                    WHERE id = $2
                `, [winAmount, ticket.user_id]);
                
                // СОХРАНЯЕМ ТРАНЗАКЦИЮ
                await client.query(`
                    INSERT INTO transactions (
                        user_id,
                        type,
                        amount,
                        description,
                        reference_id,
                        status,
                        created_at
                    ) VALUES ($1, 'win', $2, $3, $4, 'completed', NOW())
                `, [
                    ticket.user_id,
                    winAmount,
                    `Выигрыш по билету ${ticket.ticket_number}`,
                    ticket.id
                ]);
                
                console.log(`💰 Пользователь ${ticket.user_id} выиграл ${winAmount} Stars`);
            }
        }
        
        console.log(`✅ Билеты обработаны для тиража ${drawId}`);
        
    } catch (error) {
        console.error(`❌ Ошибка обработки билетов для тиража ${drawId}:`, error);
        throw error;
    }
}

function getEmptyStats() {
    return {
        total_tickets: 0,
        total_won: 0,
        active: 0,
        drawing: 0,
        won: 0,
        lost: 0
    };
}

function generateDemoTickets(userId) {
    const statuses = ['active', 'drawing', 'won', 'lost'];
    const prizes = [0, 0, 0, 0, 100, 250, 750, 1000, 10000];
    
    const tickets = [];
    const now = Date.now();
    
    for (let i = 1; i <= 8; i++) {
        const status = statuses[Math.floor(Math.random() * statuses.length)];
        const numbers = [];
        const uniqueNumbers = new Set();
        
        while (uniqueNumbers.size < 12) {
            uniqueNumbers.add(Math.floor(Math.random() * 24) + 1);
        }
        
        numbers.push(...Array.from(uniqueNumbers).sort((a, b) => a - b));
        
        const winningNumbers = [];
        const uniqueWinning = new Set();
        while (uniqueWinning.size < 12) {
            uniqueWinning.add(Math.floor(Math.random() * 24) + 1);
        }
        winningNumbers.push(...Array.from(uniqueWinning).sort((a, b) => a - b));
        
        const matched = numbers.filter(n => winningNumbers.includes(n)).length;
        const winAmount = status === 'won' ? prizes[Math.floor(Math.random() * prizes.length)] : 0;
        
        tickets.push({
            id: `demo_${now}_${i}`,
            ticket_number: `DEMO-${String(1000 + i).slice(1)}`,
            draw_number: `ТИРАЖ-${String(900 + i).slice(1)}`,
            numbers: numbers,
            numbers_hash: hashData(numbers),
            verification_hash: hashData({ numbers, timestamp: now }),
            price: 50,
            status: status,
            win_amount: winAmount,
            matched_count: matched,
            matched_numbers: numbers.filter(n => winningNumbers.includes(n)),
            created_at: new Date(now - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
            draw_time: new Date(now - Math.random() * 3 * 24 * 60 * 60 * 1000).toISOString(),
            draw_status: status === 'active' ? 'scheduled' : 'completed',
            winning_numbers: winningNumbers,
            winning_proof: { demo: true },
            draw_verification_hash: hashData(winningNumbers),
            verification: {
                numbers_valid: true,
                message: 'Демо-данные'
            }
        });
    }
    
    return tickets;
}

function calculateStats(tickets) {
    return {
        total_tickets: tickets.length,
        total_won: tickets.filter(t => t.status === 'won').reduce((sum, t) => sum + (t.win_amount || 0), 0),
        active: tickets.filter(t => t.status === 'active').length,
        drawing: tickets.filter(t => t.status === 'drawing').length,
        won: tickets.filter(t => t.status === 'won').length,
        lost: tickets.filter(t => t.status === 'lost').length
    };
}

// ==================== СТАТИЧЕСКИЕ СТРАНИЦЫ ====================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/game', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/game.html'));
});

app.get('/tickets', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/tickets.html'));
});

app.get('/js/:filename', (req, res) => {
    res.sendFile(path.join(__dirname, `../public/js/${req.params.filename}`));
});

// ==================== ИНИЦИАЛИЗАЦИЯ И ЗАПУСК ====================

async function startServer() {
    try {
        console.log('🔧 Инициализация сервера Fortuna Lottery...');
        
        // ИНИЦИАЛИЗИРУЕМ БАЗУ ДАННЫХ
        await initializeDatabase();
        
        // ПРОВЕРЯЕМ ПОДКЛЮЧЕНИЕ К БД
        try {
            const client = await pool.connect();
            await client.query('SELECT 1');
            client.release();
            
            global.dbStatus = {
                connected: true,
                lastCheck: new Date(),
                error: null
            };
            
            demoMode = false;
            console.log('✅ Подключение к БД установлено');
            
        } catch (dbError) {
            console.error('❌ Ошибка подключения к БД:', dbError.message);
            global.dbStatus = {
                connected: false,
                lastCheck: new Date(),
                error: dbError.message
            };
            
            demoMode = true;
            console.warn('⚠️ Работаем в демо-режиме (без БД)');
        }
        
        // ЗАПУСКАЕМ СЕРВЕР
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Сервер запущен на порту ${PORT}`);
            console.log(`🎮 Игровая страница: http://localhost:${PORT}/game`);
            console.log(`📋 Билеты: http://localhost:${PORT}/tickets`);
            console.log(`🔧 Режим: ${demoMode ? 'ДЕМО' : 'ПРОДАКШЕН (с БД)'}`);
            console.log(`🎰 Тираж каждые: ${CONFIG.DRAW_INTERVAL_MINUTES} минут`);
            console.log(`⏱️  Розыгрыш длится: ${CONFIG.DRAW_DURATION_MINUTES} минуту`);
            console.log('='.repeat(70));
        });
        
    } catch (error) {
        console.error('❌ Критическая ошибка запуска сервера:', error);
        process.exit(1);
    }
}

startServer();
