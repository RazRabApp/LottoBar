// tickets.js - ПОЛНАЯ ИСПРАВЛЕННАЯ ВЕРСИЯ
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
            total_won: 0,
            active: 0,
            won: 0,
            lost: 0,
            drawing: 0
        };
        
        // Фильтры
        this.currentFilter = 'all';
        this.filterCounts = {
            all: 0,
            active: 0,
            drawing: 0,
            won: 0,
            lost: 0
        };
        
        // Ограничение количества запросов при ошибках
        this.errorCount = 0;
        this.maxErrors = 3;
        this.apiUnavailable = false;
        
        this.init();
    }
    
    async init() {
        console.log('📋 Инициализация менеджера билетов...');
        
        // Проверяем авторизацию из URL
        await this.checkAuthFromURL();
        
        // Настраиваем UI
        this.setupUI();
        
        // Загружаем данные
        await this.loadStats();
        await this.loadTickets();
        
        // Настраиваем обработчики
        this.setupEventListeners();
        
        console.log('✅ Менеджер билетов готов!');
    }
    
    async checkAuthFromURL() {
        console.log('🔐 Проверка авторизации из URL...');
        
        try {
            const urlParams = new URLSearchParams(window.location.search);
            this.userId = urlParams.get('userId');
            this.token = urlParams.get('token');
            
            if (this.userId && this.token) {
                console.log('✅ Авторизация из URL:', { userId: this.userId, token: '***' + this.token.slice(-4) });
                
                // Сохраняем сессию
                sessionStorage.setItem('fortuna_tickets_session', JSON.stringify({
                    userId: this.userId,
                    token: this.token,
                    expires: Date.now() + 24 * 60 * 60 * 1000
                }));
                
                return true;
            }
            
            // Проверяем сохраненную сессию
            const savedSession = sessionStorage.getItem('fortuna_tickets_session');
            if (savedSession) {
                const session = JSON.parse(savedSession);
                if (session.expires > Date.now()) {
                    this.userId = session.userId;
                    this.token = session.token;
                    console.log('💾 Восстановлена сессия из storage');
                    return true;
                }
            }
            
            // Проверяем основную сессию игры
            const gameSession = sessionStorage.getItem('fortuna_session');
            if (gameSession) {
                const session = JSON.parse(gameSession);
                if (session.expires > Date.now()) {
                    this.userId = session.userId;
                    this.token = session.token;
                    console.log('🎮 Восстановлена сессия из игры');
                    return true;
                }
            }
            
            console.warn('⚠️ Авторизация не найдена, создаем гостевую сессию');
            this.createGuestSession();
            return true;
            
        } catch (error) {
            console.error('❌ Ошибка проверки авторизации:', error);
            this.createGuestSession();
            return true;
        }
    }
    
    createGuestSession() {
        this.userId = 'guest_' + Date.now();
        this.token = 'guest_token_' + Math.random().toString(36).substr(2, 9);
        
        sessionStorage.setItem('fortuna_tickets_session', JSON.stringify({
            userId: this.userId,
            token: this.token,
            expires: Date.now() + 2 * 60 * 60 * 1000
        }));
        
        console.log('🎭 Создана гостовая сессия');
    }
    
    setupUI() {
        // Показываем демо-уведомление если гость
        if (this.userId && this.userId.startsWith('guest_')) {
            this.showDemoNotification();
        }
    }
    
    showDemoNotification() {
        const notification = document.createElement('div');
        notification.className = 'demo-notification';
        notification.innerHTML = `
            <div class="icon">ℹ️</div>
            <div>
                <strong>Демо-режим</strong>
                <p>Вы находитесь в демо-режиме. Реальные билеты доступны только через Telegram бота.</p>
            </div>
        `;
        
        const statsContainer = document.getElementById('statsContainer');
        if (statsContainer && statsContainer.parentNode) {
            statsContainer.parentNode.insertBefore(notification, statsContainer);
        }
    }
    
    async loadStats() {
        if (!this.userId) return;
        
        const statsContainer = document.getElementById('statsContainer');
        if (!statsContainer) return;
        
        try {
            // ИСПРАВЛЕННЫЙ ПУТЬ API
            const response = await fetch(`/api/tickets/stats?userId=${this.userId}`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                
                if (data.success) {
                    this.stats = data.stats;
                    this.totalTickets = data.stats.total_tickets || 0;
                    this.renderStats();
                } else {
                    // Fallback на демо-статистику
                    this.createFallbackStats();
                }
            } else {
                this.createFallbackStats();
            }
        } catch (error) {
            console.error('Ошибка загрузки статистики:', error);
            this.createFallbackStats();
        }
    }
    
    createFallbackStats() {
        // Создаем демо-статистику
        this.stats = {
            total_tickets: 5,
            total_won: 2,
            active: 3,
            won: 2,
            lost: 3,
            drawing: 0,
            total_prize: 250
        };
        
        this.totalTickets = 5;
        this.renderStats();
    }
    
    renderStats() {
        const statsContainer = document.getElementById('statsContainer');
        if (!statsContainer) return;
        
        const totalPrize = this.stats.total_prize || 0;
        
        statsContainer.innerHTML = `
            <div class="stats-cards">
                <div class="stat-card">
                    <div class="stat-value">${this.stats.total_tickets || 0}</div>
                    <div class="stat-label">Всего билетов</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${this.stats.won || 0}</div>
                    <div class="stat-label">Выигравших</div>
                </div>
            </div>
            
            <div class="stats-details">
                <h3>📊 Статистика</h3>
                <div class="stats-grid">
                    <div class="stat-item">
                        <div class="stat-item-value">${this.stats.active || 0}</div>
                        <div class="stat-item-label">Активных</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-item-value">${this.stats.drawing || 0}</div>
                        <div class="stat-item-label">В розыгрыше</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-item-value">${this.stats.lost || 0}</div>
                        <div class="stat-item-label">Проигравших</div>
                    </div>
                    <div class="stat-item total-prize">
                        <div class="stat-item-value">${totalPrize.toLocaleString()} Stars</div>
                        <div class="stat-item-label">Всего выиграно</div>
                    </div>
                </div>
            </div>
        `;
    }
    
    async loadTickets(clear = true) {
        if (this.isLoading || !this.userId) return;
        
        this.isLoading = true;
        this.showLoading(true);
        
        if (clear) {
            this.currentPage = 1;
            this.tickets = [];
            this.hasMore = true;
        }
        
        try {
            // ИСПРАВЛЕННЫЙ ПУТЬ API
            const response = await fetch(`/api/tickets/user?userId=${this.userId}&page=${this.currentPage}`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                
                if (data.success) {
                    const newTickets = data.tickets || [];
                    
                    if (clear) {
                        this.tickets = newTickets;
                    } else {
                        this.tickets = [...this.tickets, ...newTickets];
                    }
                    
                    this.hasMore = data.has_more || false;
                    this.currentPage++;
                    
                    // Обновляем счетчики фильтров
                    this.updateFilterCounts();
                    
                    // Рендерим билеты
                    this.renderTickets();
                    
                    this.errorCount = 0; // Сбрасываем счетчик ошибок
                } else {
                    // Fallback на демо-билеты
                    this.createFallbackTickets();
                }
            } else {
                // Fallback на демо-билеты
                this.createFallbackTickets();
            }
        } catch (error) {
            console.error('Ошибка загрузки билетов:', error);
            this.errorCount++;
            
            if (this.errorCount >= this.maxErrors) {
                this.apiUnavailable = true;
                this.showNotification('Сервер временно недоступен. Показываем демо-данные.', 'warning');
            }
            
            this.createFallbackTickets();
        } finally {
            this.isLoading = false;
            this.showLoading(false);
        }
    }
    
    createFallbackTickets() {
        // Создаем демо-билеты
        const demoTickets = [
            {
                id: 1,
                ticket_number: 'TICKET-' + Date.now().toString().slice(-8),
                draw_number: 'ТИРАЖ-' + (Date.now() - 86400000).toString().slice(-6),
                numbers: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23],
                status: 'won',
                prize_amount: 250,
                win_amount: 250,
                created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
                winning_numbers: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23],
                matched_count: 12
            },
            {
                id: 2,
                ticket_number: 'TICKET-' + (Date.now() - 1000).toString().slice(-8),
                draw_number: 'ТИРАЖ-' + Date.now().toString().slice(-6),
                numbers: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24],
                status: 'active',
                prize_amount: 0,
                win_amount: 0,
                created_at: new Date().toISOString(),
                winning_numbers: null,
                matched_count: 0
            },
            {
                id: 3,
                ticket_number: 'TICKET-' + (Date.now() - 5000).toString().slice(-8),
                draw_number: 'ТИРАЖ-' + (Date.now() - 43200000).toString().slice(-6),
                numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
                status: 'lost',
                prize_amount: 0,
                win_amount: 0,
                created_at: new Date(Date.now() - 86400000).toISOString(),
                winning_numbers: [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24],
                matched_count: 0
            },
            {
                id: 4,
                ticket_number: 'TICKET-' + (Date.now() - 10000).toString().slice(-8),
                draw_number: 'ТИРАЖ-' + (Date.now() - 21600000).toString().slice(-6),
                numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
                status: 'won',
                prize_amount: 100,
                win_amount: 100,
                created_at: new Date(Date.now() - 43200000).toISOString(),
                winning_numbers: [1, 2, 3, 4, 5, 6, 13, 14, 15, 16, 17, 18],
                matched_count: 6
            },
            {
                id: 5,
                ticket_number: 'TICKET-' + (Date.now() - 15000).toString().slice(-8),
                draw_number: 'ТИРАЖ-' + (Date.now() - 10800000).toString().slice(-6),
                numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
                status: 'drawing',
                prize_amount: 0,
                win_amount: 0,
                created_at: new Date(Date.now() - 3600000).toISOString(),
                winning_numbers: null,
                matched_count: null
            }
        ];
        
        this.tickets = demoTickets;
        this.hasMore = false;
        this.updateFilterCounts();
        this.renderTickets();
    }
    
    updateFilterCounts() {
        this.filterCounts = {
            all: this.tickets.length,
            active: this.tickets.filter(t => t.status === 'active').length,
            drawing: this.tickets.filter(t => t.status === 'drawing').length,
            won: this.tickets.filter(t => t.status === 'won').length,
            lost: this.tickets.filter(t => t.status === 'lost').length
        };
        
        this.updateFilterButtons();
    }
    
    updateFilterButtons() {
        const filters = ['all', 'active', 'drawing', 'won', 'lost'];
        
        filters.forEach(filter => {
            const countElement = document.getElementById(`count${filter.charAt(0).toUpperCase() + filter.slice(1)}`);
            if (countElement) {
                countElement.textContent = this.filterCounts[filter] || 0;
            }
            
            const button = document.querySelector(`[data-filter="${filter}"]`);
            if (button) {
                if (filter === this.currentFilter) {
                    button.classList.add('active');
                } else {
                    button.classList.remove('active');
                }
            }
        });
    }
    
    renderTickets() {
        const ticketsList = document.getElementById('ticketsList');
        if (!ticketsList) return;
        
        // Фильтруем билеты
        let filteredTickets = this.tickets;
        
        if (this.currentFilter !== 'all') {
            filteredTickets = this.tickets.filter(ticket => {
                if (this.currentFilter === 'active') return ticket.status === 'active';
                if (this.currentFilter === 'drawing') return ticket.status === 'drawing';
                if (this.currentFilter === 'won') return ticket.status === 'won';
                if (this.currentFilter === 'lost') return ticket.status === 'lost';
                return true;
            });
        }
        
        if (filteredTickets.length === 0) {
            ticketsList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📭</div>
                    <h3>Билеты не найдены</h3>
                    <p>${this.currentFilter !== 'all' ? 'Нет билетов с выбранным фильтром' : 'У вас пока нет билетов'}</p>
                    <button class="btn btn-primary" onclick="window.location.href='/game'">
                        🎮 Купить первый билет
                    </button>
                </div>
            `;
            return;
        }
        
        // Сортируем по дате (сначала новые)
        filteredTickets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        ticketsList.innerHTML = filteredTickets.map((ticket, index) => {
            const statusClass = `status-${ticket.status}`;
            const cardClass = `ticket-card ${ticket.status} visible`;
            const date = new Date(ticket.created_at);
            const formattedDate = date.toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
            }) + ' ' + date.toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit'
            });
            
            // Определяем статус текстом
            let statusText = '';
            let statusIcon = '';
            
            switch(ticket.status) {
                case 'active':
                    statusText = 'АКТИВЕН';
                    statusIcon = '🔄';
                    break;
                case 'drawing':
                    statusText = 'РОЗЫГРЫШ';
                    statusIcon = '🎲';
                    break;
                case 'won':
                    statusText = 'ВЫИГРАЛ';
                    statusIcon = '🏆';
                    break;
                case 'lost':
                    statusText = 'ПРОИГРАЛ';
                    statusIcon = '❌';
                    break;
                default:
                    statusText = 'НЕИЗВЕСТНО';
                    statusIcon = '❓';
            }
            
            // Формируем HTML чисел билета
            const numbersHtml = ticket.numbers.map(num => {
                const isMatched = ticket.winning_numbers && ticket.winning_numbers.includes(num);
                const matchedClass = isMatched ? 'matched' : '';
                return `<div class="ticket-number-badge ${matchedClass}">${num}</div>`;
            }).join('');
            
            // Формируем HTML выигрышных чисел (если есть)
            const winningNumbersHtml = ticket.winning_numbers ? `
                <div style="margin-top: 10px;">
                    <div style="font-size: 0.9rem; opacity: 0.8; margin-bottom: 5px;">Выигрышные числа:</div>
                    <div class="winning-numbers">
                        ${ticket.winning_numbers.map(n => `<span>${n}</span>`).join('')}
                    </div>
                </div>
            ` : '';
            
            // Формируем детали
            const detailsHtml = ticket.status === 'won' ? `
                <div class="win-amount">🎉 Выигрыш: ${ticket.win_amount.toLocaleString()} Stars</div>
            ` : ticket.status === 'active' ? `
                <div class="ticket-details">
                    <div class="info-row">
                        <span class="info-label">Совпадений:</span>
                        <span class="info-value">Ожидание розыгрыша</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Статус:</span>
                        <span class="info-value" style="color: #2196F3;">Активен</span>
                    </div>
                </div>
            ` : ticket.status === 'drawing' ? `
                <div class="ticket-details">
                    <div class="info-row">
                        <span class="info-label">Статус:</span>
                        <span class="info-value" style="color: #ffc107;">Идет розыгрыш</span>
                    </div>
                </div>
            ` : ticket.status === 'lost' ? `
                <div class="ticket-details">
                    <div class="info-row">
                        <span class="info-label">Совпадений:</span>
                        <span class="info-value">${ticket.matched_count || 0}/12</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Статус:</span>
                        <span class="info-value" style="color: #ff6b6b;">Не выиграл</span>
                    </div>
                </div>
            ` : '';
            
            return `
                <div class="${cardClass}" data-ticket-id="${ticket.id}">
                    <div class="ticket-header">
                        <div class="ticket-info">
                            <div class="ticket-number">${ticket.ticket_number}</div>
                            <div class="ticket-draw">${ticket.draw_number}</div>
                            <div class="ticket-date">${formattedDate}</div>
                        </div>
                        <div class="ticket-status ${statusClass}">
                            ${statusIcon} ${statusText}
                        </div>
                    </div>
                    
                    <div class="ticket-numbers">
                        ${numbersHtml}
                    </div>
                    
                    ${winningNumbersHtml}
                    ${detailsHtml}
                    
                    <div class="ticket-actions">
                        <button class="btn btn-secondary btn-small" onclick="ticketsManager.viewTicketDetails(${ticket.id})">
                            🔍 Подробнее
                        </button>
                        ${ticket.status === 'won' ? `
                            <button class="btn btn-primary btn-small" onclick="ticketsManager.claimPrize(${ticket.id})">
                                💰 Получить ${ticket.win_amount} Stars
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
        
        // Добавляем индикатор загрузки если есть еще билеты
        if (this.hasMore) {
            const loadMoreBtn = document.createElement('button');
            loadMoreBtn.className = 'btn btn-outline';
            loadMoreBtn.style.margin = '20px auto';
            loadMoreBtn.style.display = 'block';
            loadMoreBtn.textContent = 'Загрузить еще';
            loadMoreBtn.onclick = () => this.loadTickets(false);
            
            ticketsList.appendChild(loadMoreBtn);
        }
    }
    
    viewTicketDetails(ticketId) {
        const ticket = this.tickets.find(t => t.id === ticketId);
        if (!ticket) return;
        
        // Создаем модальное окно
        const modal = document.createElement('div');
        modal.className = 'ticket-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>🎫 Детали билета</h3>
                    <button class="close-modal" onclick="this.parentElement.parentElement.remove()">&times;</button>
                </div>
                <div class="modal-body">
                    ${this.createTicketDetailsHtml(ticket)}
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="this.parentElement.parentElement.parentElement.remove()">
                        Закрыть
                    </button>
                    ${ticket.status === 'won' ? `
                        <button class="btn btn-primary" onclick="ticketsManager.claimPrize(${ticket.id})">
                            🎁 Получить приз
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Закрытие по клику вне модального окна
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }
    
    createTicketDetailsHtml(ticket) {
        const date = new Date(ticket.created_at);
        const formattedDate = date.toLocaleDateString('ru-RU', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        let statusText = '';
        let statusColor = '';
        
        switch(ticket.status) {
            case 'active':
                statusText = 'Активен';
                statusColor = '#2196F3';
                break;
            case 'drawing':
                statusText = 'В процессе розыгрыша';
                statusColor = '#ffc107';
                break;
            case 'won':
                statusText = 'Выиграл';
                statusColor = '#4CAF50';
                break;
            case 'lost':
                statusText = 'Не выиграл';
                statusColor = '#ff6b6b';
                break;
        }
        
        return `
            <div style="margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                    <div>
                        <strong>Номер билета:</strong><br>
                        <span style="color: #ffd700; font-weight: bold;">${ticket.ticket_number}</span>
                    </div>
                    <div style="text-align: right;">
                        <strong>Тираж:</strong><br>
                        <span style="color: #4CAF50;">${ticket.draw_number}</span>
                    </div>
                </div>
                
                <div style="margin-bottom: 15px;">
                    <strong>Дата покупки:</strong><br>
                    <span>${formattedDate}</span>
                </div>
                
                <div style="margin-bottom: 15px;">
                    <strong>Статус:</strong><br>
                    <span style="color: ${statusColor}; font-weight: bold;">${statusText}</span>
                </div>
                
                <div style="margin-bottom: 20px;">
                    <strong>Ваши числа (12/24):</strong><br>
                    <div class="ticket-numbers" style="margin-top: 10px;">
                        ${ticket.numbers.map(num => {
                            const isMatched = ticket.winning_numbers && ticket.winning_numbers.includes(num);
                            const bgColor = isMatched ? 'rgba(255, 215, 0, 0.3)' : 'rgba(76, 175, 80, 0.2)';
                            const borderColor = isMatched ? 'rgba(255, 215, 0, 0.5)' : 'rgba(76, 175, 80, 0.3)';
                            const color = isMatched ? '#ffd700' : '#4CAF50';
                            return `<div style="
                                width: 40px; height: 40px; border-radius: 50%;
                                display: inline-flex; align-items: center; justify-content: center;
                                margin: 5px; font-weight: bold; font-size: 1rem;
                                background: ${bgColor}; border: 2px solid ${borderColor};
                                color: ${color};
                            ">${num}</div>`;
                        }).join('')}
                    </div>
                </div>
                
                ${ticket.winning_numbers ? `
                    <div style="margin-bottom: 20px;">
                        <strong>Выигрышные числа:</strong><br>
                        <div class="winning-numbers" style="margin-top: 10px;">
                            ${ticket.winning_numbers.map(n => `<span>${n}</span>`).join('')}
                        </div>
                    </div>
                    
                    <div style="margin-bottom: 15px;">
                        <strong>Совпадений:</strong><br>
                        <span style="font-weight: bold; font-size: 1.2rem;">
                            ${ticket.matched_count || 0} из 12
                        </span>
                    </div>
                ` : ''}
                
                ${ticket.status === 'won' ? `
                    <div style="
                        background: rgba(255, 215, 0, 0.1);
                        border: 2px solid rgba(255, 215, 0, 0.3);
                        border-radius: 12px;
                        padding: 20px;
                        text-align: center;
                        margin-top: 20px;
                    ">
                        <div style="font-size: 2rem; margin-bottom: 10px;">🏆</div>
                        <div style="font-size: 1.8rem; color: #ffd700; font-weight: bold; margin-bottom: 10px;">
                            ${ticket.win_amount.toLocaleString()} Stars
                        </div>
                        <div style="opacity: 0.9;">
                            Поздравляем! Вы выиграли приз!
                        </div>
                    </div>
                ` : ''}
                
                ${ticket.status === 'active' ? `
                    <div style="
                        background: rgba(33, 150, 243, 0.1);
                        border: 2px solid rgba(33, 150, 243, 0.3);
                        border-radius: 12px;
                        padding: 20px;
                        text-align: center;
                        margin-top: 20px;
                    ">
                        <div style="font-size: 2rem; margin-bottom: 10px;">⏳</div>
                        <div style="font-size: 1.2rem; color: #2196F3; font-weight: bold; margin-bottom: 10px;">
                            Ожидание розыгрыша
                        </div>
                        <div style="opacity: 0.9;">
                            Результаты будут доступны после завершения тиража
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }
    
    async claimPrize(ticketId) {
        const ticket = this.tickets.find(t => t.id === ticketId);
        if (!ticket || ticket.status !== 'won') {
            this.showNotification('Этот билет не выиграл или приз уже получен', 'error');
            return;
        }
        
        try {
            // ИСПРАВЛЕННЫЙ ПУТЬ API
            const response = await fetch('/api/tickets/claim', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({
                    ticketId: ticket.id,
                    userId: this.userId
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showNotification(`🎉 Приз ${ticket.win_amount} Stars получен!`, 'success');
                
                // Обновляем статус билета
                ticket.status = 'claimed';
                
                // Обновляем статистику
                await this.loadStats();
                
                // Обновляем отображение
                this.updateFilterCounts();
                this.renderTickets();
                
                // Закрываем все модальные окна
                document.querySelectorAll('.ticket-modal').forEach(modal => modal.remove());
            } else {
                this.showNotification(data.error || 'Ошибка получения приза', 'error');
            }
        } catch (error) {
            console.error('Ошибка получения приза:', error);
            this.showNotification('Ошибка сети. Попробуйте позже.', 'error');
        }
    }
    
    setupEventListeners() {
        // Фильтры
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const filter = btn.dataset.filter;
                this.currentFilter = filter;
                this.updateFilterButtons();
                this.renderTickets();
            });
        });
        
        // Сброс фильтров
        const resetBtn = document.getElementById('resetFiltersBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.currentFilter = 'all';
                this.updateFilterButtons();
                this.renderTickets();
            });
        }
        
        // Обновление
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refreshTickets());
        }
        
        // Infinity scroll
        window.addEventListener('scroll', () => {
            if (this.isLoading || !this.hasMore) return;
            
            const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
            const scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight;
            const clientHeight = document.documentElement.clientHeight;
            
            if (scrollTop + clientHeight >= scrollHeight - 100) {
                this.loadTickets(false);
            }
        });
    }
    
    async refreshTickets() {
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            const originalText = refreshBtn.innerHTML;
            refreshBtn.innerHTML = '<div class="spinner small"></div> Обновление...';
            refreshBtn.disabled = true;
            
            await this.loadStats();
            await this.loadTickets(true);
            
            refreshBtn.innerHTML = originalText;
            refreshBtn.disabled = false;
            
            this.showNotification('Билеты обновлены', 'success');
        }
    }
    
    showLoading(show) {
        const loadingElement = document.getElementById('loadingTickets');
        if (loadingElement) {
            loadingElement.style.display = show ? 'block' : 'none';
        }
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
            case 'warning': return '⚠️';
            default: return '💡';
        }
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOM загружен, запускаем менеджер билетов...');
    
    try {
        window.ticketsManager = new TicketsManager();
        console.log('✅ Менеджер билетов успешно инициализирован');
    } catch (error) {
        console.error('❌ Ошибка инициализации менеджера билетов:', error);
        document.body.innerHTML = `
            <div style="padding: 40px 20px; text-align: center; color: white;">
                <div style="font-size: 5rem;">⚠️</div>
                <h2>Ошибка загрузки билетов</h2>
                <p>Пожалуйста, вернитесь в игру и попробуйте снова</p>
                <button onclick="window.location.href='/game'" style="
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
                    🎮 Вернуться к игре
                </button>
                <div style="margin-top: 20px; color: #ff6b6b; font-size: 0.9rem;">
                    ${error.message}
                </div>
            </div>
        `;
    }
});

// Глобальная функция для обновления
window.refreshTickets = function() {
    if (window.ticketsManager) {
        window.ticketsManager.refreshTickets();
    }
};
