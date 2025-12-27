// server/routes/numbers.js
const express = require('express');
const router = express.Router();

// Быстрый подбор 12 чисел из 24 (game.js вызывает POST /api/numbers/quick-pick)
router.post('/quick-pick', (req, res) => {
    try {
        console.log('🎲 Запрос быстрого подбора чисел');
        
        // Криптографически безопасная генерация
        const numbers = new Set();
        const array = new Uint32Array(12);
        
        while (numbers.size < 12) {
            // Используем crypto API для безопасности
            if (typeof window !== 'undefined' && window.crypto) {
                window.crypto.getRandomValues(array);
            } else {
                // Fallback для Node.js
                require('crypto').randomBytes(48).copy(Buffer.from(array.buffer));
            }
            
            for (let i = 0; i < array.length && numbers.size < 12; i++) {
                const num = 1 + (array[i] % 24); // числа от 1 до 24
                numbers.add(num);
            }
        }
        
        const sortedNumbers = Array.from(numbers).sort((a, b) => a - b);
        
        res.json({ 
            success: true, 
            numbers: sortedNumbers,
            message: 'Числа сгенерированы криптографически безопасным ГСЧ'
        });
        
    } catch (error) {
        console.error('❌ Ошибка генерации чисел:', error);
        res.status(500).json({ 
            success: false,
            error: error.message,
            numbers: [] 
        });
    }
});

module.exports = router;
