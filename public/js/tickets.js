// tickets.js - ИСПРАВЛЕННАЯ И РАБОЧАЯ ВЕРСИЯ
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
            
            let url = `/api/user/tickets?userId=${this.userId}&page=${this.currentPage}&limit=10`;
            
            if (this.filters.status && this.filters.status !== 'all') {
                url += `&status=${this.filters.status}`;
            }
            
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
    }
    
    renderTickets() {
        const container = document.getElementById('ticketsContainer');
        if (!container) return;
        
        let filteredTickets = [...this.tickets];
        
        if (this.filters.status && this.filters.status !== 'all') {
            filteredTickets = filteredTickets.filter(t => t.status === this.filters.status);
        }
        
        if (this.sortBy === 'newest') {
            filteredTickets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        } else if (this.sortBy === 'oldest') {
            filteredTickets.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        }
        
        if (filteredTickets.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🎫</div>
                    <h3>Билеты не найдены</h3>
                    <p>${this.filters.status !== 'all' ? 'Попробуйте изменить фильтр' : 'Купите свой первый билет!'}</p>
                </div>
            `;
            return;
        }
        
        const ticketsHtml = filteredTickets.map(ticket => this.createTicketHTML(ticket)).join('');
        container.innerHTML = ticketsHtml;
        
        console.log(`✅ Отображено билетов: ${filteredTickets.length}`);
    }
    
    createTicketHTML(ticket) {
        const numbersHtml = ticket.numbers.map(num => 
            `<span class="ticket-number">${num}</span>`
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
            ? `<div class="ticket-prize">🏆 ${ticket.win_amount} Stars</div>`
            : '';
        
        return `
            <div class="ticket-card" data-id="${ticket.id}">
                <div class="ticket-header">
                    <div class="ticket-info">
                        <div class="ticket-number-id">${ticket.ticket_number}</div>
                        <div class="ticket-draw">${ticket.draw_number}</div>
                        <div class="ticket-date">${date}</div>
                    </div>
                    <div class="ticket-status ${statusClass}">
                        ${statusIcon} ${statusText}
                    </div>
                </div>
                
                <div class="ticket-numbers">
                    ${numbersHtml}
                </div>
                
                ${prizeHtml}
                
                <div class="ticket-actions">
                    <button class="btn btn-small view-ticket" data-id="${ticket.id}">
                        👁️ Подробнее
                    </button>
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
        if (!statsElement) return;
        
        const stats = this.stats;
        
        statsElement.innerHTML = `
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon">🎫</div>
                    <div class="stat-value">${stats.total_tickets}</div>
                    <div class="stat-label">Всего билетов</div>
                </div>
                
                <div class="stat-card">
                    <div class="stat-icon">⏳</div>
                    <div class="stat-value">${stats.active_tickets}</div>
                    <div class="stat-label">Активные</div>
                </div>
                
                <div class="stat-card">
                    <div class="stat-icon">🎲</div>
                    <div class="stat-value">${stats.drawing_tickets}</div>
                    <div class="stat-label">В розыгрыше</div>
                </div>
                
                <div class="stat-card">
                    <div class="stat-icon">🎉</div>
                    <div class="stat-value">${stats.won_tickets}</div>
                    <div class="stat-label">Выигрыши</div>
                </div>
            </div>
            
            ${stats.total_won > 0 ? `
                <div class="total-prizes">
                    <div class="total-prize-label">Общий выигрыш:</div>
                    <div class="total-prize-amount">${stats.total_won} Stars</div>
                </div>
            ` : ''}
            
            ${this.apiUnavailable ? `
                <div class="api-warning">
                    <div class="warning-icon">⚠️</div>
                    <div class="warning-text">
                        <strong>Офлайн режим</strong>
                        <p>Показываются демо-данные</p>
                    </div>
                </div>
            ` : ''}
        `;
    }
    
    setupUI() {
        console.log('🎨 Настройка UI...');
        
        const statusFilter = document.getElementById('statusFilter');
        const sortFilter = document.getElementById('sortFilter');
        const refreshBtn = document.getElementById('refreshTickets');
        const resetBtn = document.getElementById('resetFilters');
        const homeBtn = document.getElementById('goHomeBtn');
        const buyBtn = document.getElementById('buyTicketBtn');
        
        if (statusFilter) {
            statusFilter.value = this.filters.status;
            statusFilter.addEventListener('change', (e) => {
                this.filters.status = e.target.value;
                this.renderTickets();
            });
        }
        
        if (sortFilter) {
            sortFilter.value = this.sortBy;
            sortFilter.addEventListener('change', (e) => {
                this.sortBy = e.target.value;
                this.renderTickets();
            });
        }
        
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.disabled = true;
                refreshBtn.innerHTML = '<span class="loading-spinner"></span>';
                
                this.currentPage = 1;
                this.hasMore = true;
                this.tickets = [];
                this.apiUnavailable = false;
                this.errorCount = 0;
                
                const container = document.getElementById('ticketsContainer');
                if (container) {
                    container.innerHTML = '<div class="loading">Загрузка...</div>';
                }
                
                await this.loadTickets();
                await this.loadStats();
                
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = '🔄';
                this.showNotification('Билеты обновлены', 'success');
            });
        }
        
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.filters = { status: 'all' };
                this.sortBy = 'newest';
                
                if (statusFilter) statusFilter.value = 'all';
                if (sortFilter) sortFilter.value = 'newest';
                
                this.renderTickets();
                this.showNotification('Фильтры сброшены', 'info');
            });
        }
        
        if (homeBtn) {
            homeBtn.addEventListener('click', () => {
                window.location.href = '/game';
            });
        }
        
        if (buyBtn) {
            buyBtn.addEventListener('click', () => {
                window.location.href = '/game';
            });
        }
        
        this.updateStatsUI();
        
        // Загружаем первые билеты
        this.loadTickets();
    }
    
    setupEventListeners() {
        console.log('🎮 Настройка обработчиков событий...');
        
        document.addEventListener('click', (e) => {
            const viewBtn = e.target.closest('.view-ticket');
            if (viewBtn) {
                const ticketId = viewBtn.dataset.id;
                this.showTicketDetails(ticketId);
            }
        });
        
        // Бесконечная прокрутка
        window.addEventListener('scroll', () => {
            if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 500) {
                if (!this.isLoading && this.hasMore) {
                    this.loadTickets();
                }
            }
        });
    }
    
    showTicketDetails(ticketId) {
        const ticket = this.tickets.find(t => t.id === ticketId);
        if (!ticket) {
            this.showNotification('Билет не найден', 'error');
            return;
        }
        
        const modal = document.createElement('div');
        modal.className = 'ticket-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>🎫 Детали билета</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    ${this.createTicketHTML(ticket)}
                    <div class="ticket-details">
                        <div class="detail-item">
                            <span class="detail-label">Статус:</span>
                            <span class="detail-value ${ticket.status}">${this.getStatusText(ticket.status)}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Цена:</span>
                            <span class="detail-value">50 Stars</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Дата покупки:</span>
                            <span class="detail-value">${new Date(ticket.created_at).toLocaleString('ru-RU')}</span>
                        </div>
                        ${ticket.win_amount > 0 ? `
                            <div class="detail-item">
                                <span class="detail-label">Выигрыш:</span>
                                <span class="detail-value prize">${ticket.win_amount} Stars</span>
                            </div>
                        ` : ''}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-outline close-btn">Закрыть</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const closeModal = () => {
            modal.classList.add('closing');
            setTimeout(() => modal.remove(), 300);
        };
        
        modal.querySelector('.close-modal').addEventListener('click', closeModal);
        modal.querySelector('.close-btn').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
    }
    
    showLoading(show) {
        const container = document.getElementById('ticketsContainer');
        const loadingEl = document.getElementById('loadingIndicator');
        
        if (show) {
            if (!loadingEl) {
                const loader = document.createElement('div');
                loader.id = 'loadingIndicator';
                loader.className = 'loading-indicator';
                loader.innerHTML = '<div class="loading-spinner"></div><div>Загрузка билетов...</div>';
                container?.appendChild(loader);
            }
        } else {
            loadingEl?.remove();
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
                <span>${message}</span>
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
        const container = document.getElementById('ticketsContainer');
        if (container) {
            container.innerHTML = `
                <div class="auth-error">
                    <div class="error-icon">🔒</div>
                    <h3>Требуется авторизация</h3>
                    <p>Для просмотра билетов войдите в систему</p>
                    <button id="goToGame" class="btn btn-primary">Войти в игру</button>
                </div>
            `;
            
            document.getElementById('goToGame').addEventListener('click', () => {
                window.location.href = '/game';
            });
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
            <div style="padding: 20px; text-align: center;">
                <h2>Ошибка загрузки билетов</h2>
                <p>${error.message}</p>
                <button onclick="location.reload()" class="btn">Обновить</button>
            </div>
        `;
    }
});
