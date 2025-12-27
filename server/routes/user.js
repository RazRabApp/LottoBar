// server/routes/user.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Получение баланса пользователя (game.js запрашивает GET /api/user/balance?userId=...)
router.get('/balance', async (req, res) => {
    try {
        const { userId, telegramId } = req.query;
        
        console.log('💰 Запрос баланса для:', { userId, telegramId });
        
        if (!userId && !telegramId) {
            return res.status(400).json({ 
                success: false, 
                error: 'Не указан userId или telegramId',
                balance: 0 
            });
        }
        
        let query;
        let params;
        
        if (telegramId) {
            query = 'SELECT id, telegram_id, username, balance, stars_balance FROM users WHERE telegram_id = $1';
            params = [telegramId];
        } else {
            query = 'SELECT id, telegram_id, username, balance, stars_balance FROM users WHERE id = $1';
            params = [userId];
        }
        
        const result = await pool.query(query, params);
        
        if (result.rows.length === 0) {
            // Создаем временного пользователя для демо
            const demoUser = {
                id: userId || Math.floor(Math.random() * 1000000),
                telegram_id: telegramId || null,
                username: 'demo_' + Date.now().toString().slice(-6),
                balance: 1000,
                stars_balance: 1000
            };
            
            return res.json({ 
                success: true, 
                user: demoUser,
                balance: 1000,
                is_demo: true
            });
        }
        
        const user = result.rows[0];
        const balance = user.balance || user.stars_balance || 0;
        
        res.json({ 
            success: true, 
            user: user,
            balance: balance
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения баланса:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            balance: 0 
        });
    }
});

module.exports = router;
