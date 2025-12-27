// public/js/tickets.js - ИСПРАВЛЕННАЯ ВЕРСИЯ ДЛЯ ОТОБРАЖЕНИЯ БИЛЕТОВ
class TicketsManager {
    constructor() {
        this.userId = null;
        this.token = null;
        this.tickets = [];
        this.stats = {
            total_tickets: 0,
            total_won: 0,
            active: 0,
            drawing: 0,
            won: 0,
            lost: 0
        };
        this.currentFilter = 'all';
        this.isLoading = false;
        
        this.init();
    }
    
    async init() {
        console.log('📋 Инициализация менеджера билетов...');
        
        await this.checkAuthFromURL();
        await this.loadData();
        this.setupEventListeners();
        
        console.log('✅ Менеджер билетов готов');
    }
    
    async checkAuthFromURL() {
        const urlParams = new URLSearchParams(window.location.search);
        this.userId = urlParams.get('userId');
        this.token = urlParams.get('token');
        
        if (!this.userId || !this.token) {
            const savedSession = sessionStorage.getItem('fortuna_session');
            if (savedSession) {
                const session = JSON.parse(savedSession);
                this.userId = session.userId;
                this.token = session.token;
            }
        }
        
        if (!this.userId) {
            window.location.href = '/game';
            return;
        }
    }
    
    async loadData() {
        this.showLoading(true);
        
        try {
            // Загружаем статистику
            await this.loadStats();
            
            // Загружаем билеты
            await this.loadTickets();
            
        } catch (error) {
            console.error('❌ Ошибка загрузки данных:', error);
            this.showNotification('Ошибка загрузки данных', 'error');
        } finally {
            this.showLoading(false);
        }
    }
    
    async loadStats() {
        try {
            const response = await fetch(`/api/user/stats?userId=${this.userId}`);
            const data = await response.json();
            
            if (data.success) {
                this.stats = data.stats;
                this.renderStats();
            }
        } catch (error) {
            console.error('❌ Ошибка загрузки статистики:', error);
        }
    }
    
    async loadTickets() {
        try {
            const response = await fetch(`/api/user/tickets?userId=${this.userId}&status=${this.currentFilter}`);
            const data = await response.json();
            
            if (data.success) {
                this.tickets = data.tickets || [];
                this.renderTickets();
                this.updateFilterCounts();
            }
        } catch (error) {
            console.error('❌ Ошибка загрузки билетов:', error);
        }
    }
    
    renderStats() {
        const statsContainer = document.getElementById('statsContainer');
        if (!statsContainer) return;
        
        statsContainer.innerHTML = `
            <div class="stats-cards">
                <div class="stat-card">
                    <div class="stat-value">${this.stats.total_tickets}</div>
                    <div class="stat-label">Всего билетов</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${this.stats.won}</div>
                    <div class="stat-label">Выигравших</div>
                </div>
            </div>
            
            <div class="stats-details">
                <h3>📊 Статистика</h3>
                <div class="stats-grid">
                    <div class="stat-item">
                        <div class="stat-item-value">${this.stats.active}</div>
                        <div class="stat-item-label">Активных</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-item-value">${this.stats.drawing}</div>
                        <div class="stat-item-label">В розыгрыше</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-item-value">${this.stats.lost}</div>
                        <div class="stat-item-label">Проигравших</div>
                    </div>
                    <div class="stat-item total-prize">
                        <div class="stat-item-value">${this.stats.total_won.toLocaleString()} Stars</div>
                        <div class="stat-item-label">Всего выиграно</div>
                    </div>
                </div>
            </div>
        `;
    }
    
    renderTickets() {
        const ticketsList = document.getElementById('ticketsList');
        if (!ticketsList) return;
        
        if (this.tickets.length === 0) {
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
        
        const filteredTickets = this.tickets.filter(ticket => {
            if (this.currentFilter === 'all') return true;
            return ticket.status === this.currentFilter;
        });
        
        ticketsList.innerHTML = filteredTickets.map((ticket, index) => {
            return this.createTicketHTML(ticket, index);
        }).join('');
    }
    
    createTicketHTML(ticket, index) {
        const date = new Date(ticket.created_at);
        const formattedDate = date.toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        }) + ' ' + date.toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        let statusText = '';
        let statusClass = '';
        let statusIcon = '';
        
        switch(ticket.status) {
            case 'active':
                statusText = 'АКТИВЕН';
                statusClass = 'status-active';
                statusIcon = '🔄';
                break;
            case 'drawing':
                statusText = 'РОЗЫГРЫШ';
                statusClass = 'status-drawing';
                statusIcon = '🎲';
                break;
            case 'won':
                statusText = 'ВЫИГРАЛ';
                statusClass = 'status-won';
                statusIcon = '🏆';
                break;
            case 'lost':
                statusText = 'ПРОИГРАЛ';
                statusClass = 'status-lost';
                statusIcon = '❌';
                break;
        }
        
        const numbersHtml = ticket.numbers.map(num => {
            const isMatched = ticket.matched_numbers && ticket.matched_numbers.includes(num);
            const matchedClass = isMatched ? 'matched' : '';
            return `<div class="ticket-number-badge ${matchedClass}">${num}</div>`;
        }).join('');
        
        let winningNumbersHtml = '';
        if (ticket.winning_numbers && ticket.winning_numbers.length > 0) {
            winningNumbersHtml = `
                <div style="margin-top: 10px;">
                    <div style="font-size: 0.9rem; opacity: 0.8; margin-bottom: 5px;">Выигрышные числа:</div>
                    <div class="winning-numbers">
                        ${ticket.winning_numbers.map(n => `<span>${n}</span>`).join('')}
                    </div>
                </div>
            `;
        }
        
        let detailsHtml = '';
        if (ticket.status === 'won') {
            detailsHtml = `
                <div class="win-amount">🎉 Выигрыш: ${ticket.win_amount.toLocaleString()} Stars</div>
                <div style="margin-top: 10px; font-size: 0.9rem; color: #4CAF50;">
                    ✅ Совпадений: ${ticket.matched_count || 0}/12
                </div>
            `;
        } else if (ticket.status === 'lost') {
            detailsHtml = `
                <div style="margin-top: 10px; font-size: 0.9rem; color: #ff6b6b;">
                    ❌ Совпадений: ${ticket.matched_count || 0}/12
                </div>
            `;
        } else if (ticket.status === 'active') {
            detailsHtml = `
                <div style="margin-top: 10px; font-size: 0.9rem; color: #2196F3;">
                    ⏳ Ожидание розыгрыша
                </div>
            `;
        } else if (ticket.status === 'drawing') {
            detailsHtml = `
                <div style="margin-top: 10px; font-size: 0.9rem; color: #ffc107;">
                    🎲 Идет розыгрыш
                </div>
            `;
        }
        
        return `
            <div class="ticket-card ${ticket.status} visible" style="animation-delay: ${index * 0.05}s">
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
                    <button class="btn btn-secondary btn-small" onclick="ticketsManager.viewTicketDetails('${ticket.id}')">
                        🔍 Подробнее
                    </button>
                    ${ticket.status === 'won' && ticket.win_amount > 0 ? `
                        <button class="btn btn-primary btn-small" onclick="ticketsManager.claimPrize('${ticket.id}')">
                            💰 Получить ${ticket.win_amount} Stars
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }
    
    updateFilterCounts() {
        const counts = {
            all: this.tickets.length,
            active: this.tickets.filter(t => t.status === 'active').length,
            drawing: this.tickets.filter(t => t.status === 'drawing').length,
            won: this.tickets.filter(t => t.status === 'won').length,
            lost: this.tickets.filter(t => t.status === 'lost').length
        };
        
        ['all', 'active', 'drawing', 'won', 'lost'].forEach(filter => {
            const countElement = document.getElementById(`count${filter.charAt(0).toUpperCase() + filter.slice(1)}`);
            if (countElement) {
                countElement.textContent = counts[filter] || 0;
            }
            
            const button = document.querySelector(`[data-filter="${filter}"]`);
            if (button) {
                button.classList.toggle('active', filter === this.currentFilter);
            }
        });
    }
    
    viewTicketDetails(ticketId) {
        const ticket = this.tickets.find(t => t.id === ticketId);
        if (!ticket) return;
        
        const modal = document.createElement('div');
        modal.className = 'ticket-modal';
        modal.innerHTML = this.createTicketModalHTML(ticket);
        
        document.body.appendChild(modal);
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.classList.contains('close-modal')) {
                modal.remove();
            }
        });
    }
    
    createTicketModalHTML(ticket) {
        const date = new Date(ticket.created_at);
        const formattedDate = date.toLocaleDateString('ru-RU', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        let statusColor = '#2196F3';
        let statusText = 'Активен';
        
        switch(ticket.status) {
            case 'drawing': statusColor = '#ffc107'; statusText = 'В розыгрыше'; break;
            case 'won': statusColor = '#4CAF50'; statusText = 'Выиграл'; break;
            case 'lost': statusColor = '#ff6b6b'; statusText = 'Не выиграл'; break;
        }
        
        return `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>🎫 Детали билета</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body">
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
                                    const isMatched = ticket.matched_numbers && ticket.matched_numbers.includes(num);
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
                        
                        ${ticket.winning_numbers && ticket.winning_numbers.length > 0 ? `
                            <div style="margin-bottom: 20px;">
                                <strong>Выигрышные числа:</strong><br>
                                <div class="winning-numbers" style="margin-top: 10px;">
                                    ${ticket.winning_numbers.map(n => `<span>${n}</span>`).join('')}
                                </div>
                                <div style="margin-top: 5px; font-size: 0.8rem; color: #666;">
                                    🔒 Сгенерировано криптографическим ГСЧ
                                </div>
                            </div>
                            
                            <div style="margin-bottom: 15px;">
                                <strong>Совпадений:</strong><br>
                                <span style="font-weight: bold; font-size: 1.2rem;">
                                    ${ticket.matched_count || 0} из 12
                                </span>
                            </div>
                        ` : ''}
                        
                        ${ticket.status === 'won' && ticket.win_amount > 0 ? `
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
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary close-modal">
                        Закрыть
                    </button>
                    ${ticket.status === 'won' && ticket.win_amount > 0 ? `
                        <button class="btn btn-primary" onclick="ticketsManager.claimPrize('${ticket.id}')">
                            🎁 Получить приз
                        </button>
                    ` : ''}
                </div>
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
                
                // Обновляем данные
                await this.loadData();
                
                // Закрываем модальные окна
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
                this.loadTickets();
            });
        });
        
        // Сброс фильтров
        document.getElementById('resetFiltersBtn')?.addEventListener('click', () => {
            this.currentFilter = 'all';
            this.loadTickets();
        });
        
        // Обновление
        document.getElementById('refreshBtn')?.addEventListener('click', () => {
            this.refreshTickets();
        });
    }
    
    async refreshTickets() {
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            const originalText = refreshBtn.innerHTML;
            refreshBtn.innerHTML = '<div class="spinner small"></div> Обновление...';
            refreshBtn.disabled = true;
            
            await this.loadData();
            
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
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    try {
        window.ticketsManager = new TicketsManager();
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
                ">
                    🎮 Вернуться к игре
                </button>
            </div>
        `;
    }
});
