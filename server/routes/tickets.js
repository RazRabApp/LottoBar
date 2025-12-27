// server/routes/tickets.js - ПОЛНЫЙ ИСПРАВЛЕННЫЙ КОД
const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// ПОКУПКА БИЛЕТА (game.js вызывает POST /api/tickets/buy)
router.post('/buy', async (req, res) => {
    try {
        console.log('🎫 Запрос покупки билета:', req.body);
        
        const { userId, numbers } = req.body;
        const authorization = req.headers.authorization;
        
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
        
        // Проверяем баланс пользователя
        const userResult = await pool.query(
            'SELECT id, balance, stars_balance FROM users WHERE id = $1',
            [userId]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Пользователь не найден' 
            });
        }
        
        const user = userResult.rows[0];
        const userBalance = user.balance || user.stars_balance || 0;
        const ticketPrice = 50;
        
        if (userBalance < ticketPrice) {
            return res.status(400).json({ 
                success: false, 
                error: 'Недостаточно Stars!',
                current_balance: userBalance,
                required: ticketPrice
            });
        }
        
        // Получаем текущий активный тираж
        const drawResult = await pool.query(`
            SELECT id, draw_number FROM draws 
            WHERE status = 'scheduled' 
            AND draw_time > NOW()
            ORDER BY draw_time ASC 
            LIMIT 1
        `);
        
        if (drawResult.rows.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Нет активного тиража для покупки билетов' 
            });
        }
        
        const draw = drawResult.rows[0];
        
        // ПОКУПКА БИЛЕТА НЕДОСТУПНА (по вашему требованию)
        // Возвращаем сообщение, что покупка отключена
        return res.status(403).json({
            success: false,
            error: '❌ Покупка билетов временно недоступна',
            message: 'Функция покупки отключена для технических работ. Попробуйте позже.',
            current_balance: userBalance,
            demo_mode: true
        });
        
    } catch (error) {
        console.error('❌ Ошибка покупки билета:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// ПОЛУЧЕНИЕ БИЛЕТОВ ПОЛЬЗОВАТЕЛЯ (tickets.js вызывает GET /api/user/tickets?userId=...)
// ВАЖНО: Этот маршрут должен быть доступен по /api/user/tickets, но он в файле tickets.js
// Значит в server/index.js он должен быть подключен как app.use('/api/tickets', ticketsRoutes)
// И тогда фронтенд должен запрашивать /api/tickets/user/tickets

// Альтернатива: Создаем маршрут, который работает с обоими путями
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
                d.winning_numbers as draw_winning_numbers
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
        
        console.log('🔍 SQL запрос:', query);
        console.log('🔍 Параметры:', params);
        
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
            
            // Получаем информацию о пользователе для заглушки
            const userInfo = await pool.query(
                'SELECT username, balance FROM users WHERE id = $1',
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
                ? new Date(ticket.created_at).toLocaleDateString('ru-RU')
                : 'Неизвестно';
                
            const drawTime = ticket.draw_time
                ? new Date(ticket.draw_time).toLocaleDateString('ru-RU')
                : null;
            
            return {
                id: ticket.id,
                ticket_number: ticket.ticket_number || `TICKET-${ticket.id}`,
                draw_id: ticket.draw_id,
                draw_number: ticket.draw_number || 'ТИРАЖ-0000',
                numbers: numbers,
                price: ticket.price || 50,
                status: ticket.status || 'active',
                win_amount: ticket.win_amount || 0,
                matched_count: ticket.matched_count || 0,
                matched_numbers: matchedNumbers,
                winning_numbers: winningNumbers,
                created_at: createdAt,
                draw_time: drawTime,
                draw_status: ticket.draw_status || 'completed'
            };
        });
        
        console.log(`✅ Найдено ${formattedTickets.length} билетов`);
        
        res.json({
            success: true,
            tickets: formattedTickets,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                totalPages: Math.ceil(total / parseInt(limit))
            },
            stats: stats
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения билетов:', error);
        res.status(500).json({ 
            success: false,
            error: error.message,
            tickets: [] 
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
            tickets: [] 
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
                all: parseInt(stats.total_tickets) || 0,
                active: parseInt(stats.active_tickets) || 0,
                won: parseInt(stats.won_tickets) || 0,
                lost: parseInt(stats.lost_tickets) || 0,
                drawing: parseInt(stats.drawing_tickets) || 0,
                total_won: parseInt(stats.total_won) || 0
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения статистики:', error);
        res.status(500).json({ 
            success: false,
            error: error.message,
            stats: {
                all: 0,
                active: 0,
                won: 0,
                lost: 0,
                drawing: 0,
                total_won: 0
            }
        });
    }
});

module.exports = router;
