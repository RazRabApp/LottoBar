// server/routes/tickets.js - ПОЛНЫЙ ИСПРАВЛЕННЫЙ КОД С РАБОЧЕЙ ПОКУПКОЙ
const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// ПОКУПКА БИЛЕТА (game.js вызывает POST /api/tickets/buy)
router.post('/buy', async (req, res) => {
    const client = await pool.connect();
    
    try {
        console.log('🎫 Запрос покупки билета:', req.body);
        
        const { userId, numbers } = req.body;
        
        if (!userId || !numbers) {
            return res.status(400).json({ 
                success: false, 
                error: 'Не указаны обязательные параметры' 
            });
        }
        
        if (numbers.length !== 12) {
            return res.status(400).json({ 
                success: false, 
                error: 'Нужно выбрать ровно 12 чисел' 
            });
        }
        
        // Проверяем что все числа в диапазоне 1-24
        for (const num of numbers) {
            if (num < 1 || num > 24 || !Number.isInteger(num)) {
                return res.status(400).json({
                    success: false,
                    error: `Число ${num} вне диапазона 1-24 или не целое число`
                });
            }
        }
        
        // Проверяем уникальность чисел
        const uniqueNumbers = [...new Set(numbers)];
        if (uniqueNumbers.length !== 12) {
            return res.status(400).json({
                success: false,
                error: 'Все числа должны быть уникальными'
            });
        }
        
        // Начинаем транзакцию
        await client.query('BEGIN');
        
        // Получаем пользователя с блокировкой
        const userResult = await client.query(
            'SELECT id, balance, telegram_id, username FROM users WHERE id = $1 FOR UPDATE',
            [userId]
        );
        
        if (userResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ 
                success: false, 
                error: 'Пользователь не найден' 
            });
        }
        
        const user = userResult.rows[0];
        const userBalance = user.balance || 0;
        const ticketPrice = 50;
        
        if (userBalance < ticketPrice) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                success: false, 
                error: 'Недостаточно Stars!',
                current_balance: userBalance,
                required: ticketPrice
            });
        }
        
        // Получаем текущий активный тираж
        const drawResult = await client.query(`
            SELECT id, draw_number, draw_time FROM draws 
            WHERE status = 'scheduled' 
            ORDER BY draw_time ASC 
            LIMIT 1
        `);
        
        if (drawResult.rows.length === 0) {
            // Создаем новый тираж если нет активного
            const nextNumberResult = await client.query(`
                SELECT COALESCE(
                    MAX(CAST(SUBSTRING(draw_number FROM 'ТИРАЖ-(\\d+)') AS INTEGER)), 
                    0
                ) + 1 as next_num FROM draws WHERE draw_number LIKE 'ТИРАЖ-%'
            `);
            
            const nextNum = nextNumberResult.rows[0]?.next_num || 1;
            const drawNumber = `ТИРАЖ-${String(nextNum).padStart(4, '0')}`;
            
            const newDrawResult = await client.query(`
                INSERT INTO draws (draw_number, draw_time, status, jackpot_balance)
                VALUES ($1, NOW() + INTERVAL '15 minutes', 'scheduled', 10000)
                RETURNING id, draw_number, draw_time
            `, [drawNumber]);
            
            var draw = newDrawResult.rows[0];
        } else {
            var draw = drawResult.rows[0];
        }
        
        // Проверяем время до розыгрыша (нельзя покупать за 2 минуты до начала)
        const timeCheck = await client.query(`
            SELECT EXTRACT(EPOCH FROM (draw_time - NOW())) as seconds_until_draw
            FROM draws WHERE id = $1
        `, [draw.id]);
        
        const secondsUntilDraw = timeCheck.rows[0]?.seconds_until_draw || 0;
        if (secondsUntilDraw <= 120) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'Покупка временно недоступна. Скоро начнется розыгрыш.',
                seconds_until_draw: Math.floor(secondsUntilDraw)
            });
        }
        
        // Списываем деньги
        const newBalance = userBalance - ticketPrice;
        await client.query(
            'UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2',
            [newBalance, userId]
        );
        
        // Генерируем номер билета
        const timestamp = Date.now();
        const randomPart = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        const ticketNumber = `TKT-${timestamp.toString().slice(-6)}-${randomPart}`;
        
        // Сохраняем билет
        const ticketResult = await client.query(`
            INSERT INTO tickets (
                user_id, 
                draw_id, 
                ticket_number, 
                numbers, 
                price, 
                status,
                created_at
            ) VALUES ($1, $2, $3, $4, $5, 'active', NOW())
            RETURNING *
        `, [userId, draw.id, ticketNumber, JSON.stringify(numbers.sort((a, b) => a - b)), ticketPrice]);
        
        // Создаем транзакцию
        await client.query(`
            INSERT INTO transactions (
                user_id, 
                type, 
                amount, 
                description, 
                status,
                created_at
            ) VALUES ($1, 'ticket_purchase', $2, $3, 'completed', NOW())
        `, [userId, ticketPrice, `Покупка билета ${ticketNumber} на тираж ${draw.draw_number}`]);
        
        // Обновляем статистику тиража
        await client.query(`
            UPDATE draws 
            SET 
                total_tickets = COALESCE(total_tickets, 0) + 1,
                prize_pool = COALESCE(prize_pool, 0) + 40,
                jackpot_balance = COALESCE(jackpot_balance, 10000) + 40,
                updated_at = NOW()
            WHERE id = $1
        `, [draw.id]);
        
        // Фиксируем транзакцию
        await client.query('COMMIT');
        
        const ticket = ticketResult.rows[0];
        
        console.log(`✅ Билет куплен: ${ticketNumber} для пользователя ${userId} (${user.username})`);
        console.log(`💰 Новый баланс: ${newBalance} Stars`);
        console.log(`🎰 Тираж: ${draw.draw_number} (через ${Math.floor(secondsUntilDraw/60)} мин)`);
        
        // Форматируем билет для ответа
        let ticketNumbers = [];
        try {
            ticketNumbers = JSON.parse(ticket.numbers);
        } catch (e) {
            ticketNumbers = numbers;
        }
        
        res.json({
            success: true,
            ticket: {
                id: ticket.id,
                ticket_number: ticket.ticket_number,
                numbers: ticketNumbers,
                price: ticket.price,
                status: ticket.status,
                draw_id: draw.id,
                draw_number: draw.draw_number,
                draw_time: draw.draw_time,
                created_at: ticket.created_at
            },
            new_balance: newBalance,
            message: '🎫 Билет успешно куплен! Желаем удачи в розыгрыше!',
            next_draw_time: draw.draw_time,
            seconds_until_draw: Math.floor(secondsUntilDraw)
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Ошибка покупки билета:', error);
        res.status(500).json({ 
            success: false,
            error: 'Внутренняя ошибка сервера при покупке билета',
            details: error.message
        });
    } finally {
        client.release();
    }
});

// ПОЛУЧЕНИЕ БИЛЕТОВ ПОЛЬЗОВАТЕЛЯ
router.get('/user/tickets', async (req, res) => {
    try {
        const { userId, status, page = 1, limit = 20 } = req.query;
        
        console.log('📋 Запрос билетов пользователя:', { userId, status, page, limit });
        
        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                error: 'Не указан userId',
                tickets: [] 
            });
        }
        
        // Преобразуем параметры
        const offset = (parseInt(page) - 1) * parseInt(limit);
        
        // Строим базовый запрос
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
                d.status as draw_status,
                d.winning_numbers as draw_winning_numbers,
                d.jackpot_balance
            FROM tickets t
            LEFT JOIN draws d ON t.draw_id = d.id
            WHERE t.user_id = $1
        `;
        
        const params = [userId];
        let paramIndex = 2;
        
        // Фильтрация по статусу если указана
        if (status && status !== '' && status !== 'all') {
            query += ` AND t.status = $${paramIndex}`;
            params.push(status);
            paramIndex++;
        }
        
        // Сортировка и пагинация
        query += ` ORDER BY t.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(parseInt(limit), offset);
        
        console.log('🔍 SQL запрос:', query.substring(0, 200) + '...');
        
        const result = await pool.query(query, params);
        
        // Получаем общее количество для пагинации
        let countQuery = 'SELECT COUNT(*) as total FROM tickets WHERE user_id = $1';
        const countParams = [userId];
        
        if (status && status !== '' && status !== 'all') {
            countQuery += ' AND status = $2';
            countParams.push(status);
        }
        
        const countResult = await pool.query(countQuery, countParams);
        const total = parseInt(countResult.rows[0]?.total || 0);
        
        // Получаем статистику по статусам
        const statsQuery = `
            SELECT 
                status,
                COUNT(*) as count,
                COALESCE(SUM(win_amount), 0) as total_won
            FROM tickets 
            WHERE user_id = $1
            GROUP BY status
        `;
        
        const statsResult = await pool.query(statsQuery, [userId]);
        
        // Формируем статистику
        const stats = {
            all: total,
            active: 0,
            won: 0,
            lost: 0,
            drawing: 0
        };
        
        statsResult.rows.forEach(row => {
            const statusKey = row.status.toLowerCase();
            if (stats.hasOwnProperty(statusKey)) {
                stats[statusKey] = parseInt(row.count);
            }
        });
        
        // Если нет билетов, возвращаем пустой массив
        if (result.rows.length === 0) {
            console.log('ℹ️ Билеты не найдены для userId:', userId);
            
            // Получаем информацию о пользователе
            const userInfo = await pool.query(
                'SELECT username, balance, telegram_id FROM users WHERE id = $1',
                [userId]
            );
            
            return res.json({
                success: true,
                tickets: [],
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: total,
                    totalPages: Math.ceil(total / parseInt(limit))
                },
                stats: stats,
                user_info: userInfo.rows[0] || null
            });
        }
        
        // Форматируем билеты для фронтенда
        const formattedTickets = result.rows.map(ticket => {
            // Преобразуем numbers из массива или JSON
            let numbers = [];
            try {
                if (Array.isArray(ticket.numbers)) {
                    numbers = ticket.numbers;
                } else if (typeof ticket.numbers === 'string') {
                    numbers = JSON.parse(ticket.numbers);
                } else if (ticket.numbers) {
                    numbers = ticket.numbers;
                }
            } catch (e) {
                console.warn('⚠️ Ошибка парсинга numbers:', e.message);
                numbers = [];
            }
            
            // Преобразуем matched_numbers
            let matchedNumbers = [];
            try {
                if (ticket.matched_numbers) {
                    if (Array.isArray(ticket.matched_numbers)) {
                        matchedNumbers = ticket.matched_numbers;
                    } else if (typeof ticket.matched_numbers === 'string') {
                        matchedNumbers = JSON.parse(ticket.matched_numbers);
                    }
                }
            } catch (e) {
                console.warn('⚠️ Ошибка парсинга matched_numbers:', e.message);
            }
            
            // Преобразуем winning_numbers если есть
            let winningNumbers = [];
            try {
                if (ticket.draw_winning_numbers) {
                    if (Array.isArray(ticket.draw_winning_numbers)) {
                        winningNumbers = ticket.draw_winning_numbers;
                    } else if (typeof ticket.draw_winning_numbers === 'string') {
                        winningNumbers = JSON.parse(ticket.draw_winning_numbers);
                    }
                }
            } catch (e) {
                console.warn('⚠️ Ошибка парсинга winning_numbers:', e.message);
            }
            
            // Форматируем дату
            const createdAt = ticket.created_at 
                ? new Date(ticket.created_at).toLocaleDateString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                })
                : 'Неизвестно';
                
            const drawTime = ticket.draw_time
                ? new Date(ticket.draw_time).toLocaleDateString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                })
                : null;
            
            return {
                id: ticket.id,
                ticket_number: ticket.ticket_number || `TICKET-${ticket.id}`,
                draw_id: ticket.draw_id,
                draw_number: ticket.draw_number || 'ТИРАЖ-0000',
                numbers: numbers.sort((a, b) => a - b),
                price: ticket.price || 50,
                status: ticket.status || 'active',
                win_amount: ticket.win_amount || 0,
                matched_count: ticket.matched_count || 0,
                matched_numbers: matchedNumbers,
                winning_numbers: winningNumbers,
                created_at: createdAt,
                draw_time: drawTime,
                draw_status: ticket.draw_status || 'completed',
                jackpot_balance: ticket.jackpot_balance
            };
        });
        
        console.log(`✅ Найдено ${formattedTickets.length} билетов для userId: ${userId}`);
        
        // Получаем информацию о пользователе
        const userInfo = await pool.query(
            'SELECT username, balance, telegram_id FROM users WHERE id = $1',
            [userId]
        );
        
        res.json({
            success: true,
            tickets: formattedTickets,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                totalPages: Math.ceil(total / parseInt(limit)),
                has_more: (offset + formattedTickets.length) < total
            },
            stats: stats,
            user_info: userInfo.rows[0] || null
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения билетов:', error);
        res.status(500).json({ 
            success: false,
            error: error.message,
            tickets: [],
            stats: {
                all: 0,
                active: 0,
                won: 0,
                lost: 0,
                drawing: 0
            }
        });
    }
});

// Альтернативный маршрут для совместимости (если фронтенд ждет /api/tickets/user/tickets)
router.get('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { status, page = 1, limit = 20 } = req.query;
        
        // Перенаправляем на основной маршрут
        req.query.userId = userId;
        return router.get('/user/tickets')(req, res);
        
    } catch (error) {
        console.error('❌ Ошибка получения билетов (альтернативный маршрут):', error);
        res.status(500).json({ 
            success: false,
            error: error.message,
            tickets: [],
            stats: {
                all: 0,
                active: 0,
                won: 0,
                lost: 0,
                drawing: 0
            }
        });
    }
});

// Получение статистики билетов пользователя
router.get('/user/:userId/stats', async (req, res) => {
    try {
        const { userId } = req.params;
        
        console.log('📊 Запрос статистики для userId:', userId);
        
        const statsQuery = `
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
        `;
        
        const result = await pool.query(statsQuery, [userId]);
        
        const stats = result.rows[0] || {
            total_tickets: 0,
            active_tickets: 0,
            won_tickets: 0,
            lost_tickets: 0,
            drawing_tickets: 0,
            total_won: 0,
            total_spent: 0
        };
        
        // Получаем баланс пользователя
        const userResult = await pool.query(
            'SELECT balance, username FROM users WHERE id = $1',
            [userId]
        );
        
        const user = userResult.rows[0] || { balance: 0, username: 'Неизвестно' };
        
        res.json({
            success: true,
            stats: {
                total_tickets: parseInt(stats.total_tickets) || 0,
                active_tickets: parseInt(stats.active_tickets) || 0,
                won_tickets: parseInt(stats.won_tickets) || 0,
                lost_tickets: parseInt(stats.lost_tickets) || 0,
                drawing_tickets: parseInt(stats.drawing_tickets) || 0,
                total_won: parseInt(stats.total_won) || 0,
                total_spent: parseInt(stats.total_spent) || 0,
                current_balance: user.balance || 0,
                username: user.username
            }
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
                total_spent: 0,
                current_balance: 0,
                username: 'Ошибка'
            }
        });
    }
});

// Получение деталей конкретного билета
router.get('/:ticketId', async (req, res) => {
    try {
        const { ticketId } = req.params;
        const { userId } = req.query;
        
        console.log('🔍 Запрос деталей билета:', { ticketId, userId });
        
        let query = `
            SELECT 
                t.*,
                d.draw_number,
                d.draw_time,
                d.status as draw_status,
                d.winning_numbers,
                d.jackpot_balance,
                u.username,
                u.telegram_id
            FROM tickets t
            LEFT JOIN draws d ON t.draw_id = d.id
            LEFT JOIN users u ON t.user_id = u.id
            WHERE t.id = $1
        `;
        
        const params = [ticketId];
        
        if (userId) {
            query += ` AND t.user_id = $2`;
            params.push(userId);
        }
        
        const result = await pool.query(query, params);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Билет не найден'
            });
        }
        
        const ticket = result.rows[0];
        
        // Преобразуем данные
        let numbers = [];
        let winningNumbers = [];
        let matchedNumbers = [];
        
        try {
            numbers = JSON.parse(ticket.numbers || '[]');
            winningNumbers = JSON.parse(ticket.winning_numbers || '[]');
            matchedNumbers = JSON.parse(ticket.matched_numbers || '[]');
        } catch (e) {
            console.warn('⚠️ Ошибка парсинга JSON:', e.message);
        }
        
        // Рассчитываем совпадения если есть выигрышные числа
        const matchedCount = winningNumbers.length > 0 
            ? numbers.filter(num => winningNumbers.includes(num)).length
            : 0;
        
        const formattedTicket = {
            id: ticket.id,
            ticket_number: ticket.ticket_number,
            user_id: ticket.user_id,
            username: ticket.username,
            draw_id: ticket.draw_id,
            draw_number: ticket.draw_number,
            draw_time: ticket.draw_time,
            draw_status: ticket.draw_status,
            numbers: numbers.sort((a, b) => a - b),
            winning_numbers: winningNumbers.sort((a, b) => a - b),
            matched_numbers: matchedNumbers.sort((a, b) => a - b),
            matched_count: ticket.matched_count || matchedCount,
            price: ticket.price,
            status: ticket.status,
            win_amount: ticket.win_amount,
            jackpot_balance: ticket.jackpot_balance,
            created_at: ticket.created_at,
            updated_at: ticket.updated_at
        };
        
        res.json({
            success: true,
            ticket: formattedTicket
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения деталей билета:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
