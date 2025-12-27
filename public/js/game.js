// public/js/game.js - ИСПРАВЛЕННАЯ ВЕРСИЯ КЛИЕНТА
class FortunaGame {
    constructor() {
        this.selectedNumbers = [];
        this.balance = 1000;
        this.userId = null;
        this.token = null;
        this.userData = null;
        this.currentDraw = null;
        this.drawTimer = null;
        this.tg = null;
        this.isTelegram = false;
        this.isRealUser = false;
        this.sessionActive = true;
        
        this.init();
    }
    
    async init() {
        console.log('🎮 Инициализация Fortuna Lottery...');
        
        // Проверяем Telegram WebApp
        if (typeof Telegram !== 'undefined' && Telegram.WebApp) {
            await this.initTelegram();
        } else {
            console.log('🌐 Браузерный режим');
            this.initBrowserMode();
        }
        
        // Создаем игровое поле
        this.createGameField();
        
        // Загружаем данные
        await this.loadUserData();
        await this.loadCurrentDraw();
        
        // Обновляем UI
        this.updateUI();
        
        // Настраиваем обработчики
        this.setupEventListeners();
        
        console.log('✅ Игра готова!');
    }
    
    async initTelegram() {
        try {
            console.log('🤖 Инициализация Telegram WebApp...');
            this.tg = Telegram.WebApp;
            this.isTelegram = true;
            
            this.tg.expand();
            this.tg.ready();
            
            const telegramUser = this.tg.initDataUnsafe?.user;
            
            if (!telegramUser || !telegramUser.id) {
                console.warn('⚠️ Telegram данные не доступны');
                this.initBrowserMode();
                return;
            }
            
            console.log('👤 Telegram пользователь:', {
                id: telegramUser.id,
                username: telegramUser.username,
                name: telegramUser.first_name
            });
            
            try {
                const response = await fetch('/api/auth/telegram', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        telegram_id: telegramUser.id,
                        username: telegramUser.username,
                        first_name: telegramUser.first_name,
                        last_name: telegramUser.last_name,
                        initData: this.tg.initData
                    })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    this.userId = data.user.id;
                    this.token = data.token;
                    this.balance = data.user.stars_balance || 1000;
                    this.userData = data.user;
                    this.isRealUser = !data.user.is_demo;
                    
                    // Сохраняем сессию
                    sessionStorage.setItem('fortuna_session', JSON.stringify({
                        userId: this.userId,
                        token: this.token,
                        telegramId: telegramUser.id,
                        isRealUser: this.isRealUser,
                        expires: Date.now() + 7 * 24 * 60 * 60 * 1000
                    }));
                    
                    console.log('✅ Telegram авторизация успешна:', {
                        userId: this.userId,
                        balance: this.balance,
                        isRealUser: this.isRealUser
                    });
                } else {
                    throw new Error('Авторизация не удалась');
                }
            } catch (error) {
                console.error('❌ Ошибка авторизации:', error);
                this.createLocalTelegramUser(telegramUser);
            }
            
        } catch (error) {
            console.error('Ошибка инициализации Telegram:', error);
            this.initBrowserMode();
        }
    }
    
    createLocalTelegramUser(telegramUser) {
        this.userId = `local_tg_${telegramUser.id}`;
        this.token = 'local_token_' + Date.now();
        this.balance = 1000;
        this.isRealUser = false;
        this.userData = {
            id: this.userId,
            telegram_id: telegramUser.id,
            username: telegramUser.username || `tg_${telegramUser.id}`,
            first_name: telegramUser.first_name || 'Telegram User',
            stars_balance: 1000,
            is_demo: true
        };
        
        sessionStorage.setItem('fortuna_session', JSON.stringify({
            userId: this.userId,
            token: this.token,
            telegramId: telegramUser.id,
            isRealUser: false,
            expires: Date.now() + 24 * 60 * 60 * 1000
        }));
    }
    
    initBrowserMode() {
        const savedSession = sessionStorage.getItem('fortuna_session');
        
        if (savedSession) {
            try {
                const session = JSON.parse(savedSession);
                if (session.expires > Date.now()) {
                    this.userId = session.userId;
                    this.token = session.token;
                    this.isRealUser = session.isRealUser || false;
                } else {
                    this.createBrowserUser();
                }
            } catch (e) {
                this.createBrowserUser();
            }
        } else {
            this.createBrowserUser();
        }
    }
    
    createBrowserUser() {
        this.userId = 'browser_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        this.token = 'browser_token_' + Date.now();
        this.balance = 1000;
        this.isRealUser = false;
        this.userData = {
            id: this.userId,
            username: 'Гость_' + this.userId.slice(-6),
            stars_balance: 1000,
            is_demo: true
        };
        
        sessionStorage.setItem('fortuna_session', JSON.stringify({
            userId: this.userId,
            token: this.token,
            isRealUser: false,
            expires: Date.now() + 2 * 60 * 60 * 1000
        }));
    }
    
    createGameField() {
        const container = document.getElementById('gameField');
        if (!container) return;
        
        container.innerHTML = '';
        
        for (let i = 1; i <= 24; i++) {
            const btn = document.createElement('button');
            btn.className = 'number-btn';
            btn.textContent = i;
            btn.dataset.number = i;
            btn.setAttribute('aria-label', `Выбрать число ${i}`);
            
            btn.style.animationDelay = `${(i - 1) * 0.03}s`;
            
            btn.addEventListener('click', () => this.toggleNumber(i));
            
            container.appendChild(btn);
        }
    }
    
    toggleNumber(number) {
        const index = this.selectedNumbers.indexOf(number);
        
        if (index > -1) {
            this.selectedNumbers.splice(index, 1);
        } else {
            if (this.selectedNumbers.length < 12) {
                this.selectedNumbers.push(number);
            } else {
                this.showNotification('Можно выбрать только 12 чисел!', 'info');
                return;
            }
        }
        
        const btn = document.querySelector(`[data-number="${number}"]`);
        if (btn) {
            btn.classList.toggle('selected');
            btn.style.transform = 'scale(0.95)';
            setTimeout(() => btn.style.transform = 'scale(1)', 150);
        }
        
        this.updateSelectedNumbersUI();
        this.updateUI();
        
        if (navigator.vibrate) navigator.vibrate(20);
    }
    
    updateSelectedNumbersUI() {
        const container = document.getElementById('selectedNumbers');
        if (!container) return;
        
        if (this.selectedNumbers.length === 0) {
            container.innerHTML = '<div class="empty-selection">Выберите 12 чисел из 24</div>';
        } else {
            const sorted = [...this.selectedNumbers].sort((a, b) => a - b);
            container.innerHTML = sorted.map(num => 
                `<div class="number-chip" data-number="${num}">${num}</div>`
            ).join('');
            
            container.querySelectorAll('.number-chip').forEach(chip => {
                chip.addEventListener('click', (e) => {
                    const num = parseInt(e.target.dataset.number);
                    this.toggleNumber(num);
                });
            });
        }
    }
    
    async loadUserData() {
        if (!this.userId) return;
        
        try {
            const response = await fetch(`/api/user/balance?userId=${this.userId}`);
            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    this.balance = data.user.stars_balance || 1000;
                    this.userData = data.user;
                }
            }
        } catch (error) {
            console.error('Ошибка загрузки данных пользователя:', error);
        }
        
        this.updateBalanceUI();
    }
    
    async loadCurrentDraw() {
        try {
            console.log('🎰 Загрузка текущего тиража...');
            const response = await fetch('/api/draws/current/status');
            const data = await response.json();
            
            if (data.success && data.draw) {
                this.currentDraw = data.draw;
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
    
    createFallbackDraw() {
        const nextDrawTime = new Date(Date.now() + 15 * 60 * 1000);
        const timeRemaining = Math.floor((nextDrawTime - Date.now()) / 1000);
        
        this.currentDraw = {
            draw_number: 'ТИРАЖ-0001',
            status: 'scheduled',
            jackpot_balance: 10000,
            time_remaining: timeRemaining,
            can_buy_tickets: timeRemaining > 60,
            winning_numbers: null
        };
        
        this.updateDrawInfo();
        this.startDrawTimer();
    }
    
    updateDrawInfo() {
        const drawInfo = document.getElementById('drawInfo');
        if (!drawInfo || !this.currentDraw) return;
        
        const draw = this.currentDraw;
        const minutes = Math.floor((draw.time_remaining || 0) / 60);
        const seconds = (draw.time_remaining || 0) % 60;
        const timeFormatted = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        let statusHtml = '';
        let timeHtml = '';
        let actionHtml = '';
        let winningNumbersHtml = '';
        
        switch(draw.status) {
            case 'scheduled':
                if (draw.can_buy_tickets) {
                    statusHtml = '<span class="status-badge scheduled">🕐 Тиражи ожидается</span>';
                    timeHtml = `<div class="draw-timer">До розыгрыша: ${timeFormatted}</div>`;
                    actionHtml = '<div class="draw-action">✅ Покупка билетов доступна</div>';
                } else {
                    statusHtml = '<span class="status-badge starting">⚠️ Скоро розыгрыш</span>';
                    timeHtml = `<div class="draw-timer">Розыгрыш через: ${timeFormatted}</div>`;
                    actionHtml = '<div class="draw-action warning">⛔ Покупка временно закрыта</div>';
                }
                break;
                
            case 'drawing':
                statusHtml = '<span class="status-badge drawing">🎲 Идет розыгрыш</span>';
                timeHtml = `<div class="draw-timer">Завершение через: ${timeFormatted}</div>`;
                actionHtml = '<div class="draw-action error">⛔ Розыгрыш идет, покупка недоступна</div>';
                
                if (draw.winning_numbers) {
                    winningNumbersHtml = `
                        <div class="winning-numbers">
                            <div style="margin-bottom: 5px; font-size: 0.9rem;">Выигрышные числа:</div>
                            <div class="numbers">${draw.winning_numbers.map(n => `<span>${n}</span>`).join('')}</div>
                            <div style="margin-top: 10px; font-size: 0.8rem; opacity: 0.8;">
                                🔒 Сгенерировано криптографическим ГСЧ
                            </div>
                        </div>
                    `;
                }
                break;
                
            case 'completed':
                statusHtml = '<span class="status-badge completed">✅ Завершен</span>';
                timeHtml = '<div class="draw-timer">00:00</div>';
                actionHtml = '<div class="draw-action warning">🎰 Следующий тираж скоро</div>';
                break;
        }
        
        drawInfo.innerHTML = `
            <div class="draw-header">
                <div class="draw-number">${draw.draw_number}</div>
                ${statusHtml}
            </div>
            ${timeHtml}
            <div class="draw-prize">
                Суперприз: <span class="prize-amount">10,000 Stars</span>
            </div>
            ${actionHtml}
            ${winningNumbersHtml}
            <div style="margin-top: 10px; font-size: 0.9rem; opacity: 0.7;">
                ⏰ Тираж каждые 15 минут • Розыгрыш 1 минуту
            </div>
        `;
    }
    
    startDrawTimer() {
        if (this.drawTimer) clearInterval(this.drawTimer);
        
        this.drawTimer = setInterval(() => {
            if (!this.currentDraw) return;
            
            const draw = this.currentDraw;
            
            if (draw.time_remaining > 0) {
                draw.time_remaining--;
                
                if (draw.status === 'scheduled') {
                    draw.can_buy_tickets = draw.time_remaining > 60;
                    
                    if (draw.time_remaining === 0) {
                        draw.status = 'drawing';
                        draw.time_remaining = 60;
                        draw.can_buy_tickets = false;
                        this.showNotification('🎲 Розыгрыш начался!', 'info');
                    }
                } else if (draw.status === 'drawing' && draw.time_remaining === 0) {
                    this.completeDrawing();
                }
                
                this.updateDrawTimerUI();
                
                if (draw.time_remaining % 30 === 0 || draw.time_remaining < 10) {
                    this.updateDrawInfo();
                }
            }
        }, 1000);
    }
    
    async completeDrawing() {
        try {
            this.currentDraw.status = 'completed';
            this.updateDrawInfo();
            
            this.showNotification('🎉 Розыгрыш завершен! Создаем новый тираж...', 'success');
            
            // Обновляем данные
            setTimeout(async () => {
                await this.loadCurrentDraw();
                this.showNotification('🎰 Новый тираж начался! Можно покупать билеты!', 'success');
            }, 3000);
            
        } catch (error) {
            console.error('❌ Ошибка завершения розыгрыша:', error);
        }
    }
    
    updateDrawTimerUI() {
        const drawTimerEl = document.querySelector('.draw-timer');
        if (drawTimerEl && this.currentDraw) {
            const minutes = Math.floor((this.currentDraw.time_remaining || 0) / 60);
            const seconds = (this.currentDraw.time_remaining || 0) % 60;
            
            if (this.currentDraw.status === 'scheduled') {
                drawTimerEl.textContent = `До розыгрыша: ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            } else if (this.currentDraw.status === 'drawing') {
                drawTimerEl.textContent = `Завершение через: ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }
        }
    }
    
    updateUI() {
        const counter = document.getElementById('selectedCount');
        if (counter) {
            counter.textContent = `${this.selectedNumbers.length}/12`;
            counter.style.animation = this.selectedNumbers.length === 12 ? 'pulse 2s infinite' : '';
        }
        
        this.updateBalanceUI();
        
        const buyBtn = document.getElementById('buyTicketBtn');
        if (buyBtn) {
            const canBuy = this.selectedNumbers.length === 12 && 
                          this.balance >= 50 && 
                          this.currentDraw && 
                          this.currentDraw.can_buy_tickets;
            
            buyBtn.disabled = !canBuy;
            
            if (canBuy) {
                buyBtn.classList.add('enabled');
                buyBtn.innerHTML = `🎫 Купить билет (50 Stars)`;
            } else {
                buyBtn.classList.remove('enabled');
                if (this.selectedNumbers.length < 12) {
                    buyBtn.innerHTML = `🎫 Выберите еще ${12 - this.selectedNumbers.length} чисел`;
                } else if (this.balance < 50) {
                    buyBtn.innerHTML = `🎫 Недостаточно Stars (нужно 50)`;
                } else if (this.currentDraw && !this.currentDraw.can_buy_tickets) {
                    buyBtn.innerHTML = `🎫 Покупка временно недоступна`;
                } else {
                    buyBtn.innerHTML = `🎫 Купить билет (50 Stars)`;
                }
            }
        }
    }
    
    updateBalanceUI() {
        const balanceEl = document.getElementById('balance');
        if (balanceEl) {
            balanceEl.textContent = this.balance.toLocaleString();
            
            const balanceStat = document.getElementById('balanceStat');
            if (balanceStat) {
                balanceStat.classList.toggle('sufficient', this.balance >= 50);
                balanceStat.classList.toggle('insufficient', this.balance < 50);
            }
        }
    }
    
    async quickPick() {
        try {
            const response = await fetch('/api/numbers/quick-pick');
            const data = await response.json();
            
            if (data.success) {
                this.selectedNumbers = data.numbers;
                this.showNotification('🎲 Числа выбраны криптографически безопасным ГСЧ!', 'success');
            } else {
                this.generateSecureQuickPick();
            }
        } catch (error) {
            this.generateSecureQuickPick();
        }
        
        this.updateSelectedNumbersUI();
        this.updateUI();
        
        document.querySelectorAll('.number-btn').forEach(btn => {
            btn.classList.remove('selected');
        });
        
        setTimeout(() => {
            this.selectedNumbers.forEach(num => {
                const btn = document.querySelector(`[data-number="${num}"]`);
                if (btn) btn.classList.add('selected');
            });
        }, 100);
    }
    
    generateSecureQuickPick() {
        const numbers = new Set();
        while (numbers.size < 12) {
            const array = new Uint32Array(12);
            window.crypto.getRandomValues(array);
            for (let i = 0; i < array.length && numbers.size < 12; i++) {
                numbers.add(1 + (array[i] % 24));
            }
        }
        
        this.selectedNumbers = Array.from(numbers).sort((a, b) => a - b);
        this.showNotification('🎲 Числа выбраны автоматически', 'info');
    }
    
    resetSelection() {
        if (this.selectedNumbers.length === 0) return;
        
        document.querySelectorAll('.number-btn.selected').forEach((btn, index) => {
            setTimeout(() => {
                btn.classList.remove('selected');
                btn.style.transform = 'scale(0.8)';
                setTimeout(() => btn.style.transform = 'scale(1)', 300);
            }, index * 30);
        });
        
        this.selectedNumbers = [];
        this.updateSelectedNumbersUI();
        this.updateUI();
        this.showNotification('Выбор сброшен', 'info');
    }
    
    async buyTicket() {
        if (this.selectedNumbers.length !== 12) {
            this.showNotification('Выберите ровно 12 чисел!', 'error');
            return;
        }
        
        if (this.balance < 50) {
            this.showNotification('Недостаточно Stars!', 'error');
            return;
        }
        
        if (this.currentDraw && !this.currentDraw.can_buy_tickets) {
            this.showNotification('Покупка временно недоступна. Идет розыгрыш.', 'error');
            return;
        }
        
        const buyBtn = document.getElementById('buyTicketBtn');
        const originalText = buyBtn.innerHTML;
        buyBtn.innerHTML = '<span class="loading-spinner"></span><span>Обработка...</span>';
        buyBtn.disabled = true;
        
        try {
            const response = await fetch('/api/tickets/buy', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({
                    userId: this.userId,
                    numbers: this.selectedNumbers,
                    token: this.token
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.balance = data.new_balance || this.balance - 50;
                this.selectedNumbers = [];
                
                this.updateBalanceUI();
                this.updateSelectedNumbersUI();
                this.updateUI();
                
                this.showNotification('🎉 Билет успешно куплен!', 'success');
                this.confettiEffect();
                
                if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
                
                if (data.ticket) {
                    this.showTicketInfo(data.ticket);
                }
                
                await this.loadCurrentDraw();
                
            } else {
                this.showNotification(data.error || 'Ошибка покупки', 'error');
            }
            
        } catch (error) {
            console.error('❌ Ошибка покупки билета:', error);
            this.showNotification('Ошибка сети. Проверьте подключение.', 'error');
        } finally {
            buyBtn.innerHTML = originalText;
            buyBtn.disabled = false;
        }
    }
    
    confettiEffect() {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        
        for (let i = 0; i < 50; i++) {
            const piece = document.createElement('div');
            piece.style.cssText = `
                position: absolute;
                width: 10px;
                height: 20px;
                background: ${['#ffd700', '#4CAF50', '#2196F3', '#ff6b6b', '#ff9800'][Math.floor(Math.random() * 5)]};
                top: -20px;
                left: ${Math.random() * 100}%;
                animation: fall linear forwards;
                animation-duration: ${Math.random() * 2 + 2}s;
                animation-delay: ${Math.random() * 1}s;
            `;
            confetti.appendChild(piece);
        }
        
        document.body.appendChild(confetti);
        
        setTimeout(() => confetti.remove(), 3000);
    }
    
    showTicketInfo(ticket) {
        const ticketInfo = document.getElementById('ticketInfo');
        if (!ticketInfo) return;
        
        const numbersHtml = ticket.numbers.map(num => 
            `<span class="ticket-number">${num}</span>`
        ).join('');
        
        ticketInfo.innerHTML = `
            <div class="ticket-preview">
                <div class="ticket-header">
                    <div class="ticket-icon">🎫</div>
                    <div class="ticket-details">
                        <div class="ticket-number">${ticket.ticket_number}</div>
                        <div class="ticket-date">${new Date().toLocaleTimeString()}</div>
                    </div>
                </div>
                <div class="ticket-numbers">
                    ${numbersHtml}
                </div>
                <div class="ticket-status active">✅ Билет активен</div>
                <div class="ticket-message">Участвует в тираже <strong>${ticket.draw_number || this.currentDraw?.draw_number}</strong>! 🍀</div>
                <div class="ticket-message" style="margin-top: 10px; font-size: 0.9rem;">
                    🔒 Данные защищены криптографическими хешами
                </div>
            </div>
        `;
        
        ticketInfo.classList.add('show');
        setTimeout(() => ticketInfo.classList.remove('show'), 7000);
    }
    
    showNotification(message, type = 'info') {
        const oldNotifications = document.querySelectorAll('.notification');
        oldNotifications.forEach(n => n.remove());
        
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <span class="notification-icon">${this.getNotificationIcon(type)}</span>
                <span class="notification-message">${message}</span>
            </div>
            <button class="close-notification">&times;</button>
        `;
        
        document.body.appendChild(notification);
        
        notification.querySelector('.close-notification').addEventListener('click', () => {
            notification.classList.add('hiding');
            setTimeout(() => notification.remove(), 300);
        });
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.classList.add('hiding');
                setTimeout(() => notification.remove(), 300);
            }
        }, 4000);
    }
    
    getNotificationIcon(type) {
        switch(type) {
            case 'success': return '✅';
            case 'error': return '❌';
            case 'info': return 'ℹ️';
            default: return '💡';
        }
    }
    
    setupEventListeners() {
        document.getElementById('quickPickBtn')?.addEventListener('click', () => this.quickPick());
        document.getElementById('resetBtn')?.addEventListener('click', () => this.resetSelection());
        document.getElementById('buyTicketBtn')?.addEventListener('click', () => this.buyTicket());
        document.getElementById('myTicketsBtn')?.addEventListener('click', () => this.openMyTickets());
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.resetSelection();
            if (e.key === ' ' && e.target === document.body) {
                e.preventDefault();
                this.quickPick();
            }
        });
    }
    
    openMyTickets() {
        if (!this.userId) {
            this.showNotification('Сначала войдите в систему', 'error');
            return;
        }
        
        const token = this.token || 'local_token';
        let url = `/tickets?userId=${this.userId}&token=${token}`;
        
        if (this.isTelegram) {
            url += `&source=telegram`;
        }
        
        window.location.href = url;
    }
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    try {
        window.game = new FortunaGame();
    } catch (error) {
        console.error('❌ Ошибка инициализации игры:', error);
        document.body.innerHTML = `
            <div style="padding: 20px; text-align: center; color: white;">
                <div style="font-size: 5rem;">⚠️</div>
                <h2>Ошибка загрузки</h2>
                <p>Пожалуйста, обновите страницу</p>
                <button onclick="location.reload()" style="
                    padding: 15px 30px;
                    background: #4CAF50;
                    color: white;
                    border: none;
                    border-radius: 12px;
                    margin-top: 20px;
                    cursor: pointer;
                ">
                    Обновить страницу
                </button>
            </div>
        `;
    }
});
