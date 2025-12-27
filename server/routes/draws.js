// server/routes/draws.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Получение текущего тиража со статусом (game.js запрашивает /current/status)
router.get('/current/status', async (req, res) => {
    try {
        console.log('🎰 Запрос статуса текущего тиража');
        
        const result = await pool.query(`
            SELECT id, draw_number, status, draw_time, prize_pool,
            EXTRACT(EPOCH FROM (draw_time - NOW())) as time_remaining,
            COALESCE(jackpot_balance, 10000) as jackpot_balance
            FROM draws 
            WHERE status IN ('scheduled', 'drawing')
            ORDER BY draw_time ASC
            LIMIT 1
        `);
        
        if (result.rows.length === 0) {
            // Создаем новый тираж если нет активного
            const nextNumberResult = await pool.query(`
                SELECT COALESCE(
                    MAX(CAST(SUBSTRING(draw_number FROM 'ТИРАЖ-(\\d+)') AS INTEGER)), 
                    0
                ) + 1 as next_num FROM draws WHERE draw_number LIKE 'ТИРАЖ-%'
            `);
            
            const nextNum = nextNumberResult.rows[0]?.next_num || 1;
            const drawNumber = `ТИРАЖ-${String(nextNum).padStart(4, '0')}`;
            
            const newDraw = await pool.query(`
                INSERT INTO draws (draw_number, draw_time, status, prize_pool, total_tickets)
                VALUES ($1, NOW() + INTERVAL '15 minutes', 'scheduled', 10000, 0)
                RETURNING *
            `, [drawNumber]);
            
            const draw = newDraw.rows[0];
            const timeRemaining = 15 * 60; // 15 минут в секундах
            
            return res.json({ 
                success: true,
                draw: {
                    id: draw.id,
                    draw_number: draw.draw_number,
                    draw_time: draw.draw_time,
                    status: draw.status,
                    jackpot_balance: 10000,
                    time_remaining: timeRemaining,
                    time_formatted: '15 мин 00 сек',
                    can_buy_tickets: timeRemaining > 120 // можно покупать пока не осталось 2 минуты
                }
            });
        }
        
        const draw = result.rows[0];
        const timeRemaining = Math.max(0, Math.floor(draw.time_remaining));
        const canBuyTickets = timeRemaining > 120 && draw.status === 'scheduled';
        
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
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения статуса тиража:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// История тиражей
router.get('/history', async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
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
            draws: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: parseInt(totalResult.rows[0].count)
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
