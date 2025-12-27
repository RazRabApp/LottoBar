const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Пополнение баланса
router.post('/deposit', async (req, res) => {
    try {
        const { userId, amount } = req.body;
        
        if (!userId || !amount || amount <= 0) {
            return res.status(400).json({ error: 'Неверные параметры' });
        }
        
        // Обновляем баланс
        const result = await pool.query(`
            UPDATE users 
            SET balance = balance + $1,
                updated_at = NOW()
            WHERE id = $2
            RETURNING *
        `, [amount, userId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        // Записываем транзакцию
        await pool.query(`
            INSERT INTO transactions (user_id, type, amount, description, status)
            VALUES ($1, 'deposit', $2, 'Пополнение баланса', 'completed')
        `, [userId, amount]);
        
        res.json({ 
            success: true, 
            user: result.rows[0],
            message: `Баланс пополнен на ${amount} Stars`
        });
    } catch (error) {
        console.error('Ошибка пополнения:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
