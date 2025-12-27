// public/js/game.js - ПОЛНАЯ ИСПРАВЛЕННАЯ ВЕРСИЯ
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
        this.isTimerRunning = false;
        this.botUsername = 'LottoMaxBot';
        this.sessionChecker = null;
        
        this.init();
    }
    
    async init() {
        console.log('🎮 Инициализация Fortuna Lottery v5...');
        console.log('🔍 Проверка окружения...');
        
        // Проверяем поддержку Web Crypto API
        if (!window.crypto || !window.crypto.subtle) {
            this.showNotification('Ваш браузер устарел. Обновите его для безопасной игры.', 'error');
        }
        
        // Проверяем Telegram WebApp
        if (typeof Telegram !== 'undefined' && Telegram.WebApp) {
            await this.initTelegram();
        } else {
            console.log('🌐 Telegram WebApp не обнаружен, используем браузерный режим');
            this.initBrowserMode();
        }
        
        // Создаем игровое поле
        this.createGameField();
        
        // Загружаем данные
        await this.loadUserData();
        await this.loadCurrentDraw();
        
        // Обновляем UI
        this.updateUI();
        
        // Настраиваем обработчики событий
        this.setupEventListeners();
        
        // Проверяем сессию каждые 5 минут
        this.sessionChecker = setInterval(() => {
            this.checkSession();
        }, 5 * 60 * 1000);
        
        console.log('✅ Игра готова! Режим:', this.isRealUser ? 'Реальный пользователь' : 'Демо-режим');
    }
    
    async initTelegram() {
        try {
            console.log('🤖 Инициализация Telegram WebApp...');
            this.tg = window.Telegram.WebApp;
            this.isTelegram = true;
            
            // Расширяем на весь экран
            this.tg.expand();
            this.tg.ready();
            
            console.log('📱 Telegram WebApp инициализирован:', {
                platform: this.tg.platform,
                version: this.tg.version
            });
            
            const telegramUser = this.tg.initDataUnsafe?.user;
            const initData = this.tg.initData;
            
            if (!telegramUser || !telegramUser.id || !initData) {
                console.warn('⚠️ Telegram данные не доступны, используем браузерный режим');
                this.initBrowserMode();
                return;
            }
            
            const telegramUserId = telegramUser.id;
            console.log('👤 Telegram пользователь найден:', {
                id: telegramUserId,
                username: telegramUser.username,
                name: telegramUser.first_name
            });
            
            try {
                console.log('📡 Отправка запроса авторизации...');
                const response = await fetch('/api/auth/telegram', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        telegram_id: telegramUserId,
                        username: telegramUser.username,
                        first_name: telegramUser.first_name,
                        last_name: telegramUser.last_name,
                        initData: initData
                    })
                });
                
                console.log('📡 Ответ от сервера:', response.status);
                
                if (response.ok) {
                    const data = await response.json();
                    console.log('📊 Данные авторизации:', data);
                    
                    if (data.success) {
                        // Используем stars_balance или fallback на balance
                        const balance = data.user.stars_balance || data.user.balance || 1000;
                        
                        this.isRealUser = !data.user.is_demo;
                        this.userId = data.user.id;
                        this.token = data.token;
                        this.balance = balance;
                        this.userData = data.user;
                        
                        console.log('✅ Telegram пользователь авторизован:', {
                            userId: this.userId,
                            telegramId: telegramUserId,
                            balance: this.balance,
                            isRealUser: this.isRealUser,
                            isDemo: data.user.is_demo
                        });
                        
                        sessionStorage.setItem('fortuna_session', JSON.stringify({
                            userId: this.userId,
                            token: this.token,
                            telegramId: telegramUserId,
                            expires: Date.now() + 24 * 60 * 60 * 1000,
                            source: 'telegram',
                            isRealUser: this.isRealUser
                        }));
                        
                        localStorage.setItem('fortuna_telegram_id', telegramUserId.toString());
                        
                    } else {
                        console.warn('⚠️ Сервер вернул success: false, создаем локального пользователя');
                        this.createLocalTelegramUser(telegramUser);
                    }
                } else {
                    console.warn('⚠️ API недоступен (статус:', response.status, '), создаем локального пользователя');
                    this.createLocalTelegramUser(telegramUser);
                }
                
            } catch (error) {
                console.error('❌ Ошибка авторизации через API:', error);
                this.createLocalTelegramUser(telegramUser);
            }
            
        } catch (error) {
            console.error('Ошибка инициализации Telegram:', error);
            this.initBrowserMode();
        }
    }
    
    createLocalTelegramUser(telegramUser) {
        const telegramUserId = telegramUser.id;
        this.userId = `tg_${telegramUserId}`;
        this.token = 'tg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        this.balance = 1000;
        this.isRealUser = false;
        this.userData = {
            id: this.userId,
            telegram_id: telegramUserId,
            username: telegramUser.username || telegramUser.first_name || `tg_${telegramUserId}`,
            first_name: telegramUser.first_name || 'Telegram User',
            last_name: telegramUser.last_name || '',
            stars_balance: 1000,
            is_demo: true
        };
        
        console.log('🎭 Создан локальный Telegram пользователь, ID:', this.userId);
        
        sessionStorage.setItem('fortuna_session', JSON.stringify({
            userId: this.userId,
            token: this.token,
            telegramId: telegramUserId,
            expires: Date.now() + 24 * 60 * 60 * 1000,
            source: 'telegram',
            isRealUser: false
        }));
        
        localStorage.setItem('fortuna_telegram_user', JSON.stringify(this.userData));
    }
    
    initBrowserMode() {
        console.log('💻 Браузерный режим - демо');
        this.isRealUser = false;
        
        const savedSession = sessionStorage.getItem('fortuna_session');
        
        if (savedSession) {
            try {
                const session = JSON.parse(savedSession);
                
                if (session.expires > Date.now()) {
                    this.userId = session.userId;
                    this.token = session.token;
                    this.isRealUser = session.isRealUser || false;
                    
                    console.log('💾 Восстановлена сессия из storage:', {
                        userId: this.userId,
                        isRealUser: this.isRealUser
                    });
                } else {
                    this.createBrowserUser();
                }
            } catch (e) {
                console.error('Ошибка парсинга сессии:', e);
                this.createBrowserUser();
            }
        } else {
            this.createBrowserUser();
        }
    }
    
    createBrowserUser() {
        // Генерируем безопасный ID
        const array = new Uint32Array(1);
        window.crypto.getRandomValues(array);
        this.userId = 'local_' + array[0];
        
        this.token = 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        this.balance = 1000;
        this.isRealUser = false;
        this.userData = {
            id: this.userId,
            username: 'guest_' + this.userId.toString().slice(-6),
            first_name: 'Гость',
            stars_balance: 1000,
            is_demo: true
        };
        
        console.log('🎭 Создан браузерный пользователь, ID:', this.userId);
        
        sessionStorage.setItem('fortuna_session', JSON.stringify({
            userId: this.userId,
            token: this.token,
            expires: Date.now() + 2 * 60 * 60 * 1000,
            source: 'browser',
            isRealUser: false
        }));
    }
    
    async checkSession() {
        if (!this.sessionActive || !this.isRealUser) return;
        
        try {
            // ИСПРАВЛЕН ПУТЬ API
            const response = await fetch(`/api/user/balance?userId=${this.userId}`);
            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    this.balance = data.user.stars_balance || data.user.balance || 1000;
                    this.userData = data.user;
                    this.updateBalanceUI();
                }
            }
        } catch (error) {
            console.log('🌐 Сеть недоступна, работаем в офлайн режиме');
        }
    }
    
    createGameField() {
        const container = document.getElementById('gameField');
        if (!container) return;
        
        container.innerHTML = '';
        
        // Создаем кнопки чисел с анимацией
        for (let i = 1; i <= 24; i++) {
            const btn = document.createElement('button');
            btn.className = 'number-btn';
            btn.textContent = i;
            btn.dataset.number = i;
            btn.setAttribute('aria-label', `Выбрать число ${i}`);
            btn.setAttribute('role', 'button');
            btn.setAttribute('tabindex', '0');
            
            // Задержка для анимации
            btn.style.animationDelay = `${(i - 1) * 0.05}s`;
            
            btn.addEventListener('click', () => this.toggleNumber(i));
            btn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.toggleNumber(i);
                }
            });
            
            container.appendChild(btn);
        }
    }
    
    toggleNumber(number) {
        const index = this.selectedNumbers.indexOf(number);
        
        if (index > -1) {
            // Убираем число
            this.selectedNumbers.splice(index, 1);
        } else {
            // Добавляем число (максимум 12)
            if (this.selectedNumbers.length < 12) {
                this.selectedNumbers.push(number);
            } else {
                this.showNotification('Можно выбрать только 12 чисел!', 'info');
                return;
            }
        }
        
        // Визуальная обратная связь
        const btn = document.querySelector(`[data-number="${number}"]`);
        if (btn) {
            btn.classList.toggle('selected');
            
            // Анимация
            btn.style.transform = 'scale(0.95)';
            setTimeout(() => {
                btn.style.transform = 'scale(1)';
            }, 150);
        }
        
        this.updateSelectedNumbersUI();
        this.updateUI();
        
        // Вибрация на мобильных
        if (navigator.vibrate) {
            navigator.vibrate(20);
        }
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
            
            // Добавляем обработчики для удаления чисел
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
        
        if (this.isRealUser) {
            try {
                // ИСПРАВЛЕН ПУТЬ API
                const response = await fetch(`/api/user/balance?userId=${this.userId}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.success) {
                        this.balance = data.user.stars_balance || data.user.balance || 1000;
                        this.userData = data.user;
                        console.log('✅ Данные реального пользователя загружены, баланс:', this.balance);
                    }
                }
            } catch (error) {
                console.error('Ошибка загрузки данных пользователя:', error);
            }
        }
        else if (this.userData) {
            this.balance = this.userData.stars_balance || this.userData.balance || 0;
        }
        
        this.updateBalanceUI();
    }
    
    async loadCurrentDraw() {
        try {
            console.log('🎰 Загрузка текущего тиража...');
            const response = await fetch('/api/draws/current/status');
            const data = await response.json();
            
            console.log('🎰 Ответ от API тиража:', data);
            
            if (data.success && data.draw) {
                this.currentDraw = data.draw;
                // ФИКСИРУЕМ ДЖЕКПОТ НА 10000 STARS
                this.currentDraw.jackpot_balance = 10000;
                
                console.log('✅ Тиража загружен:', {
                    номер: this.currentDraw.draw_number,
                    статус: this.currentDraw.status,
                    время_до: this.currentDraw.time_remaining,
                    можно_покупать: this.currentDraw.can_buy_tickets,
                    джекпот: this.currentDraw.jackpot_balance
                });
                
                this.updateDrawInfo();
                this.startDrawTimer();
                
                // Если тираж завершен, запускаем новый через 5 секунд
                if (this.currentDraw.status === 'completed') {
                    console.log('🎰 Тиража завершен, ждем 5 секунд для нового...');
                    setTimeout(() => {
                        this.loadCurrentDraw();
                    }, 5000);
                }
            } else {
                console.warn('⚠️ Ошибка загрузки тиража, создаем демо-тираж');
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
            id: 0,
            draw_number: 'ТИРАЖ-DEMO',
            draw_time: nextDrawTime.toISOString(),
            status: 'scheduled',
            jackpot_balance: 10000, // ФИКСИРОВАННЫЙ ДЖЕКПОТ 10000 STARS
            time_remaining: timeRemaining,
            time_formatted: '15 мин 00 сек',
            can_buy_tickets: timeRemaining > 120
        };
        
        console.log('🎭 Создан демо-тираж, джекпот:', this.currentDraw.jackpot_balance);
        
        this.updateDrawInfo();
        this.startDrawTimer();
    }
    
    updateDrawInfo() {
        if (!this.currentDraw) {
            console.warn('⚠️ Нет данных о тираже для обновления UI');
            return;
        }
        
        const drawInfo = document.getElementById('drawInfo');
        if (!drawInfo) {
            console.warn('⚠️ Элемент drawInfo не найден');
            return;
        }
        
        const draw = this.currentDraw;
        
        // Форматируем время
        const minutes = Math.floor((draw.time_remaining || 0) / 60);
        const seconds = (draw.time_remaining || 0) % 60;
        const timeFormatted = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        let statusHtml = '';
        let timeHtml = '';
        let actionHtml = '';
        
        switch(draw.status) {
            case 'scheduled':
                if (draw.can_buy_tickets) {
                    statusHtml = '<span class="status-badge scheduled">🕐 Тиража ожидается</span>';
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
                break;
                
            case 'completed':
                statusHtml = '<span class="status-badge completed">✅ Завершен</span>';
                timeHtml = '<div class="draw-timer">00:00</div>';
                actionHtml = '<div class="draw-action warning">🎰 Следующий тираж скоро</div>';
                break;
                
            default:
                statusHtml = '<span class="status-badge">❓ Статус неизвестен</span>';
                timeHtml = '<div class="draw-timer">--:--</div>';
                actionHtml = '<div class="draw-action error">⚠️ Ошибка получения статуса</div>';
        }
        
        // ВСЕГДА ПОКАЗЫВАЕМ 10,000 STARS
        drawInfo.innerHTML = `
            <div class="draw-header">
                <div class="draw-number">${draw.draw_number || 'ТИРАЖ-0001'}</div>
                ${statusHtml}
            </div>
            ${timeHtml}
            <div class="draw-prize">
                Суперприз: <span class="prize-amount">10,000 Stars</span>
            </div>
            ${actionHtml}
            ${draw.winning_numbers ? `
                <div class="winning-numbers">
                    Выигрышные числа прошлого тиража: 
                    <div class="numbers">${draw.winning_numbers.map(n => `<span>${n}</span>`).join('')}</div>
                </div>
            ` : ''}
            <div style="margin-top: 10px; font-size: 0.9rem; opacity: 0.7;">
                ⏰ Тираж обновляется каждые 15 минут
            </div>
        `;
    }
    
    startDrawTimer() {
        if (this.drawTimer) {
            clearInterval(this.drawTimer);
        }
        
        this.drawTimer = setInterval(() => {
            if (!this.currentDraw) return;
            
            const draw = this.currentDraw;
            
            // Для запланированного тиража
            if (draw.status === 'scheduled' && draw.time_remaining > 0) {
                draw.time_remaining--;
                draw.can_buy_tickets = draw.time_remaining > 120;
                
                // Каждую минуту обновляем отображение
                if (draw.time_remaining % 60 === 0) {
                    this.updateDrawInfo();
                    this.updateUI();
                }
                
                // Когда время вышло, переключаем на статус "идет розыгрыш"
                if (draw.time_remaining === 0) {
                    console.log('🎰 Время тиража вышло, переключаем на "идет розыгрыш"');
                    draw.status = 'drawing';
                    draw.time_remaining = 120; // 2 минуты на розыгрыш
                    draw.can_buy_tickets = false;
                    
                    this.showNotification('🎲 Розыгрыш начался!', 'info');
                    this.updateDrawInfo();
                    this.updateUI();
                }
            }
            
            // Для тиража в процессе
            else if (draw.status === 'drawing' && draw.time_remaining > 0) {
                draw.time_remaining--;
                
                // Каждые 30 секунд обновляем
                if (draw.time_remaining % 30 === 0) {
                    this.updateDrawInfo();
                }
                
                // Когда розыгрыш завершен
                if (draw.time_remaining === 0) {
                    console.log('🎰 Розыгрыш завершен, создаем новый тираж');
                    draw.status = 'completed';
                    
                    this.showNotification('🎉 Розыгрыш завершен! Проверьте результаты!', 'success');
                    this.updateDrawInfo();
                    
                    // Через 3 секунды создаем новый тираж
                    setTimeout(() => {
                        this.createNewDraw();
                    }, 3000);
                }
            }
            
            // Обновляем UI каждую секунду для плавного отображения времени
            this.updateDrawTimerUI();
            
        }, 1000);
    }
    
    updateDrawTimerUI() {
        // Обновляем только таймер для плавной анимации
        const drawTimerEl = document.querySelector('.draw-timer');
        if (drawTimerEl && this.currentDraw) {
            const minutes = Math.floor((this.currentDraw.time_remaining || 0) / 60);
            const seconds = (this.currentDraw.time_remaining || 0) % 60;
            drawTimerEl.textContent = this.currentDraw.status === 'scheduled' 
                ? `До розыгрыша: ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
                : `Завершение через: ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }
    
    async createNewDraw() {
        console.log('🎰 Создание нового тиража...');
        
        // Создаем новый демо-тираж с фиксированным джекпотом 10000 Stars
        const nextDrawTime = new Date(Date.now() + 15 * 60 * 1000);
        const timeRemaining = Math.floor((nextDrawTime - Date.now()) / 1000);
        
        this.currentDraw = {
            id: 0,
            draw_number: 'ТИРАЖ-' + Date.now().toString().slice(-6),
            draw_time: nextDrawTime.toISOString(),
            status: 'scheduled',
            jackpot_balance: 10000, // ВСЕГДА 10000 STARS
            time_remaining: timeRemaining,
            time_formatted: '15 мин 00 сек',
            can_buy_tickets: timeRemaining > 120
        };
        
        console.log('✅ Новый тираж создан, джекпот:', this.currentDraw.jackpot_balance);
        
        this.updateDrawInfo();
        this.startDrawTimer();
        
        this.showNotification('🎰 Новый тираж начался! Можно покупать билеты!', 'success');
    }
    
    updateUI() {
        // Обновляем счетчик выбранных чисел
        const counter = document.getElementById('selectedCount');
        if (counter) {
            counter.textContent = `${this.selectedNumbers.length}/12`;
            counter.className = this.selectedNumbers.length === 12 ? 'full' : '';
            
            // Визуальная обратная связь когда выбрано 12 чисел
            if (this.selectedNumbers.length === 12) {
                counter.style.animation = 'pulse 2s infinite';
            } else {
                counter.style.animation = '';
            }
        }
        
        // Обновляем баланс
        this.updateBalanceUI();
        
        // Обновляем кнопку покупки
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
                if (this.balance >= 50) {
                    balanceStat.classList.remove('insufficient');
                    balanceStat.classList.add('sufficient');
                } else {
                    balanceStat.classList.remove('sufficient');
                    balanceStat.classList.add('insufficient');
                }
            }
        }
    }
    
    async quickPick() {
        try {
            // ИСПРАВЛЕН ПУТЬ API
            const response = await fetch('/api/numbers/quick-pick');
            const data = await response.json();
            
            if (data.success) {
                this.selectedNumbers = data.numbers;
                this.showNotification('🎲 Числа выбраны криптографически безопасным ГСЧ!', 'success');
            } else {
                this.generateSecureQuickPick();
            }
        } catch (error) {
            console.log('🌐 API недоступен, используем локальную генерацию');
            this.generateSecureQuickPick();
        }
        
        // Обновляем UI
        this.updateSelectedNumbersUI();
        this.updateUI();
        
        // Снимаем выделение со всех чисел и выделяем выбранные
        document.querySelectorAll('.number-btn').forEach(btn => {
            btn.classList.remove('selected');
        });
        
        // Выделяем выбранные числа
        setTimeout(() => {
            this.selectedNumbers.forEach(num => {
                const btn = document.querySelector(`[data-number="${num}"]`);
                if (btn) {
                    btn.classList.add('selected');
                    btn.style.animation = 'pulse 0.5s ease-in-out';
                    setTimeout(() => {
                        btn.style.animation = '';
                    }, 500);
                }
            });
        }, 100);
    }
    
    generateSecureQuickPick() {
        const numbers = new Set();
        const array = new Uint32Array(12);
        
        while (numbers.size < 12) {
            window.crypto.getRandomValues(array);
            for (let i = 0; i < array.length && numbers.size < 12; i++) {
                const num = 1 + (array[i] % 24);
                numbers.add(num);
            }
        }
        
        this.selectedNumbers = Array.from(numbers).sort((a, b) => a - b);
        this.showNotification('🎲 Числа выбраны автоматически (локальная генерация)', 'info');
    }
    
    resetSelection() {
        if (this.selectedNumbers.length === 0) {
            this.showNotification('Нет выбранных чисел для сброса', 'info');
            return;
        }
        
        // Анимация сброса
        document.querySelectorAll('.number-btn.selected').forEach((btn, index) => {
            setTimeout(() => {
                btn.classList.remove('selected');
                btn.style.transform = 'scale(0.8)';
                setTimeout(() => {
                    btn.style.transform = 'scale(1)';
                }, 300);
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
            this.showNotification('Недостаточно Stars! Пополните баланс.', 'error');
            return;
        }
        
        // Проверяем, можно ли покупать билеты
        if (this.currentDraw && !this.currentDraw.can_buy_tickets) {
            this.showNotification('Покупка билетов временно недоступна. Идет или скоро начнется розыгрыш.', 'error');
            return;
        }
        
        const buyBtn = document.getElementById('buyTicketBtn');
        const originalText = buyBtn.innerHTML;
        buyBtn.innerHTML = '<span class="loading-spinner"></span><span>Обработка...</span>';
        buyBtn.disabled = true;
        
        try {
            console.log('🎫 Покупка билета...', {
                userId: this.userId,
                numbers: this.selectedNumbers,
                isRealUser: this.isRealUser
            });
            
            // ИСПРАВЛЕН ПУТЬ API
            const response = await fetch('/api/tickets/buy', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({
                    userId: this.userId,
                    numbers: this.selectedNumbers,
                    isRealUser: this.isRealUser
                })
            });
            
            const data = await response.json();
            console.log('🎫 Ответ покупки:', data);
            
            if (data.success) {
                // Обновляем баланс
                this.balance = data.new_balance || this.balance - 50;
                
                // Сбрасываем выбор
                this.selectedNumbers = [];
                
                // Обновляем UI
                this.updateBalanceUI();
                this.updateSelectedNumbersUI();
                this.updateUI();
                
                // Показываем уведомление
                this.showNotification('🎉 Билет успешно куплен!', 'success');
                
                // Визуальные эффекты
                this.confettiEffect();
                
                // Вибрация
                if (navigator.vibrate) {
                    navigator.vibrate([50, 30, 50]);
                }
                
                // Показываем информацию о билете
                if (data.ticket) {
                    this.showTicketInfo(data.ticket);
                }
                
                // Обновляем текущий тираж
                this.loadCurrentDraw();
                
            } else {
                this.showNotification(data.error || 'Ошибка покупки', 'error');
                console.error('❌ Ошибка покупки:', data);
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
        confetti.innerHTML = `
            <style>
                .confetti {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                    z-index: 1000;
                    overflow: hidden;
                }
                
                .confetti-piece {
                    position: absolute;
                    width: 10px;
                    height: 20px;
                    background: #ffd700;
                    top: -20px;
                    animation: fall linear forwards;
                }
                
                @keyframes fall {
                    to {
                        transform: translateY(100vh) rotate(360deg);
                        opacity: 0;
                    }
                }
            </style>
        `;
        
        document.body.appendChild(confetti);
        
        // Создаем конфетти
        for (let i = 0; i < 50; i++) {
            const piece = document.createElement('div');
            piece.className = 'confetti-piece';
            piece.style.left = `${Math.random() * 100}%`;
            piece.style.animationDuration = `${Math.random() * 2 + 2}s`;
            piece.style.animationDelay = `${Math.random() * 1}s`;
            piece.style.background = ['#ffd700', '#4CAF50', '#2196F3', '#ff6b6b', '#ff9800'][Math.floor(Math.random() * 5)];
            confetti.appendChild(piece);
        }
        
        setTimeout(() => {
            confetti.remove();
        }, 3000);
    }
    
    showTicketInfo(ticket) {
        const ticketInfo = document.getElementById('ticketInfo');
        if (!ticketInfo) return;
        
        const numbersHtml = ticket.numbers.map(num => 
            `<span class="ticket-number">${num}</span>`
        ).join('');
        
        const drawNumber = ticket.draw_number || this.currentDraw?.draw_number || 'ТИРАЖ-0001';
        
        ticketInfo.innerHTML = `
            <div class="ticket-preview">
                <div class="ticket-header">
                    <div class="ticket-icon">🎫</div>
                    <div class="ticket-details">
                        <div class="ticket-number">${ticket.ticket_number || 'TICKET-' + Date.now().toString().slice(-6)}</div>
                        <div class="ticket-date">${new Date().toLocaleTimeString()}</div>
                    </div>
                </div>
                <div class="ticket-numbers">
                    ${numbersHtml}
                </div>
                <div class="ticket-status active">✅ Билет активен</div>
                <div class="ticket-message">Участвует в тираже <strong>${drawNumber}</strong>! 🍀</div>
                <div class="ticket-message" style="margin-top: 10px; font-size: 0.9rem;">
                    Желаем удачи! Результаты будут через ${Math.floor((this.currentDraw?.time_remaining || 900) / 60)} минут
                </div>
            </div>
        `;
        
        ticketInfo.classList.add('show');
        
        setTimeout(() => {
            ticketInfo.classList.remove('show');
        }, 7000);
    }
    
    showNotification(message, type = 'info') {
        const oldNotifications = document.querySelectorAll('.notification');
        oldNotifications.forEach(n => n.remove());
        
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.setAttribute('role', 'alert');
        notification.innerHTML = `
            <div class="notification-content">
                <span class="notification-icon">${this.getNotificationIcon(type)}</span>
                <span class="notification-message">${message}</span>
            </div>
            <button class="close-notification" aria-label="Закрыть">&times;</button>
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
        console.log('🎮 Настройка обработчиков событий...');
        
        const quickPickBtn = document.getElementById('quickPickBtn');
        const resetBtn = document.getElementById('resetBtn');
        const buyTicketBtn = document.getElementById('buyTicketBtn');
        const myTicketsBtn = document.getElementById('myTicketsBtn');
        
        if (quickPickBtn) {
            quickPickBtn.addEventListener('click', () => this.quickPick());
            console.log('✅ Обработчик quickPick настроен');
        }
        
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetSelection());
            console.log('✅ Обработчик reset настроен');
        }
        
        if (buyTicketBtn) {
            buyTicketBtn.addEventListener('click', () => this.buyTicket());
            console.log('✅ Обработчик buyTicket настроен');
        }
        
        if (myTicketsBtn) {
            myTicketsBtn.addEventListener('click', () => this.openMyTickets());
            console.log('✅ Обработчик myTickets настроен');
        }
        
        // Горячие клавиши
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.resetSelection();
            }
            if (e.key === ' ' && e.target === document.body) {
                e.preventDefault();
                this.quickPick();
            }
            if (e.key === 'Enter' && this.selectedNumbers.length === 12 && this.balance >= 50) {
                this.buyTicket();
            }
        });
        
        // Касания на мобильных
        let lastTouchEnd = 0;
        document.addEventListener('touchend', (e) => {
            const now = Date.now();
            if (now - lastTouchEnd <= 300) {
                e.preventDefault();
            }
            lastTouchEnd = now;
        }, { passive: false });
        
        // Визуальная обратная связь для кнопок
        document.querySelectorAll('.btn').forEach(btn => {
            btn.addEventListener('mousedown', () => {
                btn.style.transform = 'scale(0.95)';
            });
            btn.addEventListener('mouseup', () => {
                btn.style.transform = '';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.transform = '';
            });
        });
        
        console.log('✅ Все обработчики событий настроены');
    }
    
    openMyTickets() {
        if (this.userId) {
            // ИСПРАВЛЕННЫЙ ПУТЬ - перенаправляем на страницу билетов с параметрами
            const token = this.token || 'local_token';
            const session = sessionStorage.getItem('fortuna_session');
            
            let url = `/tickets?userId=${this.userId}&token=${token}`;
            
            // Добавляем источник если это Telegram
            if (this.isTelegram) {
                url += `&source=telegram`;
            }
            
            console.log('📋 Открываем билеты по URL:', url);
            window.location.href = url;
        } else {
            this.showNotification('Сначала войдите в систему', 'error');
        }
    }
    
    destroy() {
        console.log('🛑 Остановка игры...');
        
        this.sessionActive = false;
        
        if (this.drawTimer) {
            clearInterval(this.drawTimer);
            this.drawTimer = null;
            console.log('⏰ Таймер тиража остановлен');
        }
        
        if (this.sessionChecker) {
            clearInterval(this.sessionChecker);
            this.sessionChecker = null;
            console.log('🔍 Проверка сессии остановлена');
        }
        
        console.log('🎮 Игра остановлена');
    }
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOM загружен, запускаем игру...');
    
    if (!window.fetch) {
        alert('Ваш браузер устарел. Пожалуйста, обновите его.');
        return;
    }
    
    try {
        window.game = new FortunaGame();
        console.log('✅ Игра успешно инициализирована');
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
                    font-weight: bold;
                    font-size: 1.1rem;
                ">
                    Обновить страницу
                </button>
                <div style="margin-top: 20px; color: #ff6b6b; font-size: 0.9rem;">
                    ${error.message}
                </div>
            </div>
        `;
    }
});

window.addEventListener('beforeunload', () => {
    if (window.game) {
        window.game.destroy();
    }
});

window.addEventListener('pagehide', () => {
    if (window.game) {
        window.game.destroy();
    }
});

// Функции отладки
window.debugGame = () => {
    if (window.game) {
        console.log('🔍 Отладка игры:', {
            userId: window.game.userId,
            isRealUser: window.game.isRealUser,
            isTelegram: window.game.isTelegram,
            balance: window.game.balance,
            botUsername: window.game.botUsername,
            userData: window.game.userData,
            selectedNumbers: window.game.selectedNumbers,
            currentDraw: window.game.currentDraw,
            tgUser: window.game.tg?.initDataUnsafe?.user,
            session: sessionStorage.getItem('fortuna_session')
        });
        
        this.showNotification('Отладочная информация выведена в консоль', 'info');
    } else {
        alert('Игра не инициализирована');
    }
};

window.updateBotUsername = (newUsername) => {
    if (window.game) {
        window.game.botUsername = newUsername;
        console.log('✅ Имя бота обновлено:', newUsername);
        this.showNotification(`Имя бота изменено на: ${newUsername}`, 'info');
    }
};

window.resetGameSession = () => {
    sessionStorage.removeItem('fortuna_session');
    localStorage.removeItem('fortuna_telegram_user');
    localStorage.removeItem('fortuna_telegram_id');
    
    console.log('🔄 Сессия игры сброшена');
    this.showNotification('Сессия сброшена. Перезагрузите страницу.', 'info');
    
    setTimeout(() => {
        location.reload();
    }, 2000);
};

// Экспорт для тестирования
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FortunaGame };
  }
};
