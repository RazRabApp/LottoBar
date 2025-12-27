// server/test-db-query.js
const { pool } = require('./db');

async function testDrawsQuery() {
    try {
        console.log('🔍 Тестируем запрос тиражей...');
        
        // Проверяем таблицу draws
        const result = await pool.query(`
            SELECT 
                id, 
                draw_number, 
                status, 
                draw_time,
                EXTRACT(EPOCH FROM (draw_time - NOW())) as time_remaining
            FROM draws 
            WHERE status IN ('scheduled', 'drawing')
            ORDER BY draw_time ASC
            LIMIT 1
        `);
        
        console.log('📊 Результат запроса:', {
            rowsCount: result.rows.length,
            rows: result.rows,
            query: result.command
        });
        
        // Проверяем структуру таблицы
        const tableInfo = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'draws'
            ORDER BY ordinal_position
        `);
        
        console.log('📋 Структура таблицы draws:');
        tableInfo.rows.forEach(col => {
            console.log(`   ${col.column_name} (${col.data_type}) - ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
        });
        
        // Считаем записи
        const countResult = await pool.query('SELECT COUNT(*) as total FROM draws');
        console.log(`📈 Всего записей в draws: ${countResult.rows[0].total}`);
        
        // Показываем все тиражи
        const allDraws = await pool.query('SELECT id, draw_number, status, draw_time FROM draws ORDER BY draw_time DESC LIMIT 5');
        console.log('📅 Последние 5 тиражей:');
        allDraws.rows.forEach(draw => {
            console.log(`   ${draw.draw_number} - ${draw.status} - ${draw.draw_time}`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка тестирования:', error.message);
        console.error('Полная ошибка:', error);
    }
}

testDrawsQuery();
