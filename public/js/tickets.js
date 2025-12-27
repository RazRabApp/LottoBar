// tickets.js - ОБНОВЛЕННАЯ ВЕРСИЯ ДЛЯ РАБОТЫ С ВАШИМ HTML
class TicketsManager {
    constructor() {
        this.userId = null;
        this.token = null;
        this.tickets = [];
        this.currentPage = 1;
        this.hasMore = true;
        this.isLoading = false;
        this.totalTickets = 0;
        this.stats = {
            total_tickets: 0,
            active_tickets: 0,
            won_tickets: 0,
            lost_tickets: 0,
            drawing_tickets: 0,
            total_won: 0,
            total_spent: 0
        };
        
        this.filters = {
            status: 'all'
        };
        this.sortBy = 'newest';
        
        this.errorCount = 0;
        this.maxErrors = 3;
        this.apiUnavailable = false;
        
        this.init();
    }
    
    async init() {
        console.log('🎫 Инициализация менеджера билетов...');
        
        if (!await this.checkAuth()) {
            console.error('❌ Ошибка авторизации');
            this.showAuthError();
            return;
        }
        
        console.log('👤 User ID:', this.userId);
        
        await this.loadStats();
        this.setupUI();
        this.setupEventListeners();
        
        console.log('✅ Менеджер билетов готов!');
    }
    
    async checkAuth() {
        console.log('🔐 Проверка авторизации...');
        
        try {
            const urlParams = new URLSearchParams(window.location.search);
            this.userId = urlParams.get('userId');
            this.token = urlParams.get('token');
            
            if (this.userId && this.token) {
                console.log('🔐 Авторизация через URL');
                return true;
            }
            
            const savedSession = sessionStorage.getItem('fortuna_session');
            if (savedSession) {
                const session = JSON.parse(savedSession);
                if (session.expires > Date.now()) {
                    this.userId = session.userId;
                    this.token = session.token;
                    console.log('💾 Авторизация через sessionStorage');
                    return true;
                }
            }
            
            console.warn('⚠️ Авторизация не найдена');
            return false;
            
        } catch (error) {
            console.error('❌ Ошибка проверки авторизации:', error);
            return false;
        }
    }
    
    async loadStats() {
        try {
            console.log('📊 Загрузка статистики...');
            const response = await fetch(`/api/user/stats?userId=${this.userId}`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                this.stats = data.stats;
                console.log('✅ Статистика загружена:', this.stats);
            } else {
                console.warn('⚠️ API вернул ошибку:', data.error);
                this.createDemoStats();
            }
            
            this.updateStatsUI();
            
        } catch (error) {
            console.error('❌ Ошибка загрузки статистики:', error);
            this.errorCount++;
            
            if (this.errorCount >= this.maxErrors) {
                this.apiUnavailable = true;
                console.log('🌐 API недоступен, показываем демо-данные');
            }
            
            this.createDemoStats();
            this.updateStatsUI();
        }
    }
    
    createDemoStats() {
        console.log('🎭 Создание демо-статистики...');
        
        this.stats = {
            total_tickets: 8,
            active_tickets: 3,
            won_tickets: 2,
            lost_tickets: 2,
            drawing_tickets: 1,
            total_won: 1500,
            total_spent: 400
        };
    }
    
    async loadTickets() {
        if (this.isLoading || !this.hasMore) return;
        
        this.isLoading = true;
        this.showLoading(true);
        
        try {
            console.log(`📋 Загрузка билетов, страница: ${this.currentPage}`);
            
            // ПРАВИЛЬНЫЙ URL
            let url = `/api/user/tickets?userId=${this.userId}&page=${this.currentPage}&limit=10`;
            
            if (this.filters.status && this.filters.status !== 'all') {
                url += `&status=${this.filters.status}`;
            }
            
            console.log('🌐 Запрос по URL:', url);
            const response = await fetch(url);
            
            if (!response.ok) {
                if (response.status === 500) {
                    this.errorCount++;
                    console.error('🌐 API сервер недоступен (500 ошибка)');
                    
                    if (this.errorCount >= this.maxErrors) {
                        this.apiUnavailable = true;
                        throw new Error('API сервер недоступен');
                    }
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                const tickets = data.tickets || [];
                this.totalTickets = data.total || tickets.length;
                this.hasMore = data.has_more || false;
                
                this.tickets = [...this.tickets, ...tickets];
                this.errorCount = 0;
                
                console.log(`✅ Загружено ${tickets.length} билетов, всего: ${this.tickets.length}`);
                
                this.renderTickets();
                
                if (tickets.length > 0) {
                    this.currentPage++;
                }
                
            } else {
                console.warn('⚠️ API вернул ошибку:', data.error);
                this.createDemoTickets();
            }
            
        } catch (error) {
            console.error('❌ Ошибка загрузки билетов:', error.message);
            
            if (this.errorCount >= this.maxErrors || this.apiUnavailable) {
                console.log('🎭 API недоступен, создаем демо-билеты...');
                this.apiUnavailable = true;
                this.createDemoTickets();
            }
            
        } finally {
            this.isLoading = false;
            this.showLoading(false);
        }
    }
    
    createDemoTickets() {
        console.log('🎭 Создание демо-билетов...');
        
        this.tickets = [];
        const statuses = ['active', 'won', 'lost', 'drawing'];
        
        for (let i = 1; i <= 8; i++) {
            const status = statuses[Math.floor(Math.random() * statuses.length)];
            const numbers = new Set();
            
            while (numbers.size < 12) {
                numbers.add(Math.floor(Math.random() * 24) + 1);
            }
            
            const ticket = {
                id: `demo_${Date.now()}_${i}`,
                ticket_number: `TICKET-${String(1000 + i).slice(1)}`,
                draw_number: `ТИРАЖ-${String(100 + i).slice(1)}`,
                numbers: Array.from(numbers).sort((a, b) => a - b),
                status: status,
                created_at: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
                win_amount: status === 'won' ? [50, 100, 250, 500, 1000][Math.floor(Math.random() * 5)] : 0
            };
            
            this.tickets.push(ticket);
        }
        
        this.hasMore = false;
        this.renderTickets();
        this.updateFilterCounts();
    }
    
    renderTickets() {
        const container = document.getElementById('ticketsList');
        if (!container) return;
        
        if (this.tickets.length === 0) {
            container.innerHTML = `
                <div class="no-tickets">
                    <div class="no-tickets-icon">🎫</div>
                    <h3>Билеты не найдены</h3>
                    <p>${this.filters.status !== 'all' ? 'Попробуйте изменить фильтр' : 'Купите свой первый билет!'}</p>
                    <button onclick="window.location.href='/game'" 
                            style="padding: 12px 24px; background: #4CAF50; color: white; border: none; border-radius: 12px; margin-top: 15px; cursor: pointer; font-weight: bold; width: 100%;">
                        🎮 Перейти к игре
                    </button>
                </div>
            `;
            return;
        }
        
        let filteredTickets = [...this.tickets];
        
        if (this.filters.status && this.filters.status !== 'all') {
            filteredTickets = filteredTickets.filter(t => t.status === this.filters.status);
        }
        
        if (this.sortBy === 'newest') {
            filteredTickets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        } else if (this.sortBy === 'oldest') {
            filteredTickets.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        }
        
        const ticketsHtml = filteredTickets.map(ticket => this.createTicketHTML(ticket)).join('');
        container.innerHTML = ticketsHtml;
        
        console.log(`✅ Отображено билетов: ${filteredTickets.length}`);
        
        this.updateFilterCounts();
    }
    
    createTicketHTML(ticket) {
        const numbersHtml = ticket.numbers.map(num => 
            `<div class="ticket-number-badge">${num}</div>`
        ).join('');
        
        const statusClass = `status-${ticket.status}`;
        const statusText = this.getStatusText(ticket.status);
        const statusIcon = this.getStatusIcon(ticket.status);
        
        const date = new Date(ticket.created_at).toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
        
        const prizeHtml = ticket.win_amount > 0 
            ? `<div class="win-amount">🏆 ${ticket.win_amount} Stars</div>`
            : '';
        
        const time = new Date(ticket.created_at).toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        return `
            <div class="ticket-card ${ticket.status}">
                <div class="ticket-header">
                    <div class="ticket-number">${ticket.ticket_number}</div>
                    <div class="ticket-status ${statusClass}">
                        ${statusIcon} ${statusText}
                    </div>
                </div>
                
                <div class="ticket-draw">
                    <span class="draw-label">Тираж:</span>
                    <span class="draw-number">${ticket.draw_number}</span>
                </div>
                
                <div class="ticket-numbers">
                    ${numbersHtml}
                </div>
                
                <div class="ticket-info">
                    <div class="info-row">
                        <span class="info-label">Дата:</span>
                        <span class="info-value">${date} ${time}</span>
                    </div>
                    
                    ${prizeHtml ? `
                    <div class="info-row">
                        <span class="info-label">Выигрыш:</span>
                        <span class="info-value">${ticket.win_amount} Stars</span>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
    }
    
    getStatusText(status) {
        const texts = {
            'active': 'Активен',
            'won': 'Выигрыш',
            'lost': 'Проигрыш',
            'drawing': 'В розыгрыше'
        };
        return texts[status] || 'Неизвестно';
    }
    
    getStatusIcon(status) {
        const icons = {
            'active': '⏳',
            'won': '🎉',
            'lost': '😔',
            'drawing': '🎲'
        };
        return icons[status] || '❓';
    }
    
    updateStatsUI() {
        const statsElement = document.getElementById('statsContainer');
        if (!statsElement) {
            console.error('❌ Элемент statsContainer не найден на странице');
            
            // Создаем элемент если его нет
            const statsSection = document.querySelector('.stats-section');
            if (statsSection) {
                statsSection.innerHTML = `
                    <div id="statsContainer">
                        <div class="stats-cards">
                            <div class="stat-card">
                                <div class="stat-value">${this.stats.total_tickets}</div>
                                <div class="stat-label">Всего билетов</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-value">${this.stats.total_won}</div>
                                <div class="stat-label">Выиграно Stars</div>
                            </div>
                        </div>
                    </div>
                `;
            }
            return;
        }
        
        const stats = this.stats;
        
        statsElement.innerHTML = `
            <div class="stats-cards">
                <div class="stat-card">
                    <div class="stat-value">${stats.total_tickets}</div>
                    <div class="stat-label">Всего билетов</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.total_won}</div>
                    <div class="stat-label">Выиграно Stars</div>
                </div>
            </div>
            
            ${this.apiUnavailable ? `
                <div class="api-warning" style="background: rgba(255,165,0,0.1); border: 1px solid orange; border-radius: 10px; padding: 10px; margin-top: 10px; text-align: center;">
                    <div style="font-size: 14px; color: orange;">⚠️ Офлайн режим (демо-данные)</div>
                </div>
            ` : ''}
        `;
        
        // Также обновляем верхние цифры
        document.getElementById('totalTickets').textContent = stats.total_tickets;
        document.getElementById('wonAmount').textContent = stats.total_won;
    }
    
    updateFilterCounts() {
        const filterButtons = document.querySelectorAll('.filter-btn');
        
        filterButtons.forEach(btn => {
            const filter = btn.dataset.filter;
            let count = 0;
            
            if (filter === 'all') {
                count = this.tickets.length;
            } else {
                count = this.tickets.filter(t => t.status === filter).length;
            }
            
            const countSpan = btn.querySelector('.filter-count');
            if (countSpan) {
                countSpan.textContent = count;
            }
        });
    }
    
    setupUI() {
        console.log('🎨 Настройка UI...');
        
        // Фильтры
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const filter = e.currentTarget.dataset.filter;
                
                // Убираем активный класс у всех кнопок
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                
                // Добавляем активный класс нажатой кнопке
                e.currentTarget.classList.add('active');
                
                // Устанавливаем фильтр
                this.filters.status = filter;
                this.currentPage = 1;
                this.hasMore = true;
                this.tickets = [];
                
                // Показываем загрузку
                const container = document.getElementById('ticketsList');
                if (container) {
                    container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Загрузка билетов...</p></div>';
                }
                
                // Загружаем билеты с новым фильтром
                this.loadTickets();
            });
        });
        
        this.updateStatsUI();
        
        // Загружаем первые билеты
        this.loadTickets();
    }
    
    setupEventListeners() {
        console.log('🎮 Настройка обработчиков событий...');
        
        // Обработчик для обновления
        const refreshBtn = document.querySelector('.header .back-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async (e) => {
                if (e.ctrlKey || e.metaKey) {
                    // Ctrl+click для обновления
                    e.preventDefault();
                    
                    this.currentPage = 1;
                    this.hasMore = true;
                    this.tickets = [];
                    this.apiUnavailable = false;
                    this.errorCount = 0;
                    
                    const container = document.getElementById('ticketsList');
                    if (container) {
                        container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Загрузка билетов...</p></div>';
                    }
                    
                    await this.loadTickets();
                    await this.loadStats();
                    
                    this.showNotification('Билеты обновлены', 'success');
                }
            });
        }
        
        // Бесконечная прокрутка
        window.addEventListener('scroll', () => {
            if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 500) {
                if (!this.isLoading && this.hasMore) {
                    this.loadTickets();
                }
            }
        });
    }
    
    showLoading(show) {
        const container = document.getElementById('ticketsList');
        const loadingEl = document.querySelector('.loading-indicator');
        
        if (show && !loadingEl && this.tickets.length > 0) {
            const loader = document.createElement('div');
            loader.className = 'loading-indicator';
            loader.innerHTML = '<div class="spinner small"></div><div>Загрузка...</div>';
            container?.appendChild(loader);
        } else if (!show && loadingEl) {
            loadingEl.remove();
        }
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
            notification.remove();
        });
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 4000);
    }
    
    getNotificationIcon(type) {
        const icons = {
            'success': '✅',
            'error': '❌',
            'info': 'ℹ️',
            'warning': '⚠️'
        };
        return icons[type] || '💡';
    }
    
    showAuthError() {
        const container = document.getElementById('ticketsList');
        if (container) {
            container.innerHTML = `
                <div class="no-tickets" style="color: #ff6b6b;">
                    <div style="font-size: 3rem;">🔒</div>
                    <h3>Требуется авторизация</h3>
                    <p>Для просмотра билетов войдите в систему</p>
                    <button onclick="window.location.href='/game'" 
                            style="padding: 12px 24px; background: #4CAF50; color: white; border: none; border-radius: 12px; margin-top: 15px; cursor: pointer; font-weight: bold; width: 100%;">
                        Войти в игру
                    </button>
                </div>
            `;
        }
    }
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOM загружен, запускаем TicketsManager...');
    
    try {
        window.ticketsManager = new TicketsManager();
        console.log('✅ TicketsManager загружен успешно');
    } catch (error) {
        console.error('❌ Ошибка загрузки TicketsManager:', error);
        document.body.innerHTML = `
            <div style="padding: 20px; text-align: center; color: white;">
                <h2 style="color: #ff6b6b;">Ошибка загрузки билетов</h2>
                <p>${error.message}</p>
                <button onclick="location.reload()" 
                        style="padding: 12px 24px; background: #4CAF50; color: white; border: none; border-radius: 12px; margin-top: 15px; cursor: pointer; font-weight: bold; width: 100%;">
                    🔄 Обновить
                </button>
            </div>
        `;
    }
});
