// В game.js добавляем/изменяем следующие методы:

async loadCurrentDraw() {
    try {
        console.log('🎰 Загрузка текущего тиража...');
        const response = await fetch('/api/draws/current/status');
        const data = await response.json();
        
        console.log('🎰 Ответ от API тиража:', data);
        
        if (data.success && data.draw) {
            this.currentDraw = data.draw;
            this.currentDraw.jackpot_balance = 10000; // ФИКСИРОВАННЫЙ ДЖЕКПОТ
            
            console.log('✅ Тиража загружен:', {
                номер: this.currentDraw.draw_number,
                статус: this.currentDraw.status,
                время_до: this.currentDraw.time_remaining,
                можно_покупать: this.currentDraw.can_buy_tickets,
                джекпот: this.currentDraw.jackpot_balance
            });
            
            this.updateDrawInfo();
            this.startDrawTimer();
        } else {
            this.createFallbackDraw();
        }
    } catch (error) {
        console.error('Ошибка загрузки тиража:', error);
        this.createFallbackDraw();
    }
}

startDrawTimer() {
    if (this.drawTimer) {
        clearInterval(this.drawTimer);
    }
    
    this.drawTimer = setInterval(() => {
        if (!this.currentDraw) return;
        
        const draw = this.currentDraw;
        
        if (draw.time_remaining > 0) {
            draw.time_remaining--;
            
            // Обновляем статус покупки билетов
            if (draw.status === 'scheduled') {
                draw.can_buy_tickets = draw.time_remaining > 60; // 1 минута на покупку до розыгрыша
                
                // Когда время вышло, переключаем на розыгрыш
                if (draw.time_remaining === 0) {
                    draw.status = 'drawing';
                    draw.time_remaining = 60; // 1 минута на розыгрыш
                    draw.can_buy_tickets = false;
                    
                    // Запрашиваем розыгрыш у сервера
                    this.triggerDraw();
                    
                    this.showNotification('🎲 Розыгрыш начался! Генерация выигрышных чисел...', 'info');
                }
            }
            // Обратный отсчет розыгрыша
            else if (draw.status === 'drawing') {
                if (draw.time_remaining === 0) {
                    this.completeDraw();
                }
            }
            
            this.updateDrawTimerUI();
            
            // Каждые 10 секунд проверяем статус
            if (draw.time_remaining % 10 === 0) {
                this.updateDrawInfo();
            }
        }
        
        // Обновляем UI каждую секунду для плавного отображения времени
        this.updateDrawTimerUI();
        
    }, 1000);
}

async triggerDraw() {
    try {
        console.log('🎰 Запуск розыгрыша...');
        const response = await fetch('/api/draws/trigger-draw', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ Розыгрыш запущен, выигрышные числа:', data.winning_numbers);
            this.currentDraw.winning_numbers = data.winning_numbers;
            this.updateDrawInfo();
        }
    } catch (error) {
        console.error('❌ Ошибка запуска розыгрыша:', error);
        // Генерируем демо-числа
        this.currentDraw.winning_numbers = this.generateDemoWinningNumbers();
    }
}

async completeDraw() {
    console.log('✅ Розыгрыш завершен');
    this.currentDraw.status = 'completed';
    
    this.showNotification('🎉 Розыгрыш завершен! Создаем новый тираж...', 'success');
    this.updateDrawInfo();
    
    // Через 5 секунд создаем новый тираж
    setTimeout(() => {
        this.createNewDraw();
    }, 5000);
}

async createNewDraw() {
    console.log('🎰 Создание нового тиража...');
    
    try {
        const response = await fetch('/api/draws/create-next', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            this.currentDraw = data.draw;
            this.updateDrawInfo();
            this.startDrawTimer();
            
            this.showNotification('🎰 Новый тираж начался! Можно покупать билеты!', 'success');
        } else {
            // Fallback на локальное создание
            const nextDrawTime = new Date(Date.now() + 15 * 60 * 1000);
            const timeRemaining = Math.floor((nextDrawTime - Date.now()) / 1000);
            
            this.currentDraw = {
                id: 0,
                draw_number: 'ТИРАЖ-' + (parseInt(this.currentDraw.draw_number.split('-')[1]) + 1).toString().padStart(4, '0'),
                draw_time: nextDrawTime.toISOString(),
                status: 'scheduled',
                jackpot_balance: 10000,
                time_remaining: timeRemaining,
                time_formatted: '15 мин 00 сек',
                can_buy_tickets: timeRemaining > 60,
                winning_numbers: null
            };
            
            this.updateDrawInfo();
            this.startDrawTimer();
        }
    } catch (error) {
        console.error('❌ Ошибка создания нового тиража:', error);
        // Локальное создание
        const nextDrawTime = new Date(Date.now() + 15 * 60 * 1000);
        const timeRemaining = Math.floor((nextDrawTime - Date.now()) / 1000);
        
        this.currentDraw = {
            id: 0,
            draw_number: 'ТИРАЖ-' + (parseInt(this.currentDraw.draw_number.split('-')[1]) + 1).toString().padStart(4, '0'),
            draw_time: nextDrawTime.toISOString(),
            status: 'scheduled',
            jackpot_balance: 10000,
            time_remaining: timeRemaining,
            time_formatted: '15 мин 00 сек',
            can_buy_tickets: timeRemaining > 60,
            winning_numbers: null
        };
        
        this.updateDrawInfo();
        this.startDrawTimer();
    }
}
