// server/routes/auth.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Аутентификация через Telegram (как ожидает game.js v3)
router.post('/telegram', async (req, res) => {
    try {
        const { initData } = req.body;
        
        console.log('🔐 Запрос авторизации через Telegram');
        
        // В реальном приложении здесь должна быть валидация initData от Telegram
        // Для демо просто создаем/находим пользователя
        
        // Извлекаем данные (упрощенно для демо)
        let telegramId = Math.floor(Math.random() * 1000000000); // случайный ID для демо
        let username = 'tg_user_' + Date.now().toString().slice(-6);
        
        if (req.body.userId) {
            telegramId = parseInt(req.body.userId);
        }
        
        // Поиск или создание пользователя
        let userResult = await pool.query(
            'SELECT * FROM users WHERE telegram_id = $1',
            [telegramId]
        );
        
        let user;
        if (userResult.rows.length === 0) {
            // Создание нового пользователя
            userResult = await pool.query(`
                INSERT INTO users (telegram_id, username, first_name, balance, stars_balance)
                VALUES ($1, $2, 'Telegram User', 1000, 1000)
                RETURNING *
            `, [telegramId, username]);
            user = userResult.rows[0];
            console.log(`👤 Создан новый пользователь: ${username} (ID: ${telegramId})`);
        } else {
            user = userResult.rows[0];
            console.log(`👤 Найден существующий пользователь: ${user.username} (ID: ${user.telegram_id})`);
        }
        
        // Генерируем токен
        const token = 'tg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        res.json({ 
            success: true,
            user: {
                id: user.id,
                telegram_id: user.telegram_id,
                username: user.username || username,
                stars_balance: user.balance || user.stars_balance || 1000
            },
            token: token
        });
        
    } catch (error) {
        console.error('❌ Ошибка авторизации:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

module.exports = router;
