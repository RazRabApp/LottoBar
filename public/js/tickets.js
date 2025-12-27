// tickets.js - ИСПРАВЛЕННАЯ ВЕРСИЯ v3.1
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
        
        // Фильтры и сортировка
        this.filters = {
            status: 'all',
            drawId: ''
        };
        this.sortBy = 'newest';
        
        // Ограничение количества запросов при ошибках
        this.errorCount = 0;
        this.maxErrors = 3;
        this.apiUnavailable = false;
        
        this.init();
    }
    
    async init() {
        console.log('📋 Инициализация менеджера билетов v3.1...');
        
        // Проверяем авторизацию
        if (!await this.checkAuth()) {
            console.error('❌ Ошибка авторизации');
            this.showAuthError();
            return;
        }
        
        console.log('👤 User ID:', this.userId);
        
        // Сначала настраиваем UI и элементы
        this.setupUI();
        
        // Ждем немного чтобы DOM точно был готов
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Затем загружаем данные
        await this.loadInitialData();
        
        // Настраиваем обработчики событий
        this.setupEventListeners();
        
        // Настраиваем бесконечную прокрутку
        this.setupInfiniteScroll();
        
        console.log('✅ Менеджер билетов готов!');
    }
    
    async checkAuth() {
        console.log('🔐 Проверка авторизации...');
        
        try {
            // Проверяем параметры URL
            const urlParams = new URLSearchParams(window.location.search);
            this.userId = urlParams.get('userId');
            this.token = urlParams.get('token');
            
            if (this.userId && this.token) {
                console.log('🔐 Авторизация через URL');
                return true;
            }
            
            // Проверяем сессию
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
    
    async loadInitialData() {
        try {
            console.log('💰 Загрузка статистики пользователя...');
            await this.loadStats();
            
            console.log('📋 Загрузка билетов...');
            await this.loadTickets();
            
        } catch (error) {
            console.error('❌ Ошибка загрузки начальных данных:', error);
            
            // Если API недоступен, показываем демо-данные
            if (this.errorCount >= this.maxErrors) {
                this.apiUnavailable = true;
                console.log('🌐 API недоступен, показываем демо-данные');
                this.createDemoData();
            }
        }
    }
    
    async loadStats() {
        if (this.apiUnavailable) {
            this.createDemoStats();
            return;
        }
        
        try {
            const response = await fetch(`/api/user/stats?userId=${this.userId}`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                this.stats = data.stats;
                console.log('✅ Статистика загружена:', this.stats);
                this.updateStatsUI();
            } else {
                console.warn('⚠️ API вернул success: false при загрузке статистики');
                this.createDemoStats();
            }
            
        } catch (error) {
            console.error('❌ Ошибка загрузки статистики:', error);
            this.errorCount++;
            this.createDemoStats();
        }
    }
    
    createDemoStats() {
        console.log('🎭 Создание демо-статистики...');
        
        // Генерируем реалистичную статистику
        this.stats = {
            total_tickets: Math.floor(Math.random() * 15) + 5,
            total_won: Math.floor(Math.random() * 5000),
            active: Math.floor(Math.random() * 5),
            won: Math.floor(Math.random() * 3),
            lost: Math.floor(Math.random() * 5),
            drawing: Math.floor(Math.random() * 2)
        };
        
        this.updateStatsUI();
    }
    
    async loadTickets(append = false) {
        // Если API недоступен или идет загрузка - пропускаем
        if (this.apiUnavailable || this.isLoading || !this.hasMore) {
            console.log('⚠️ Пропускаем загрузку (API недоступен или загрузка идет)');
            return;
        }
        
        this.isLoading = true;
        
        try {
            console.log(`📋 Загрузка билетов, страница: ${this.currentPage}`);
            
            // Строим URL с параметрами
            let url = `/api/user/tickets?userId=${this.userId}&page=${this.currentPage}&limit=20`;
            
            // Добавляем фильтры если они есть
            if (this.filters.status && this.filters.status !== 'all') {
                url += `&status=${this.filters.status}`;
            }
            if (this.filters.drawId) {
                url += `&drawId=${this.filters.drawId}`;
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
                this.hasMore = data.has_more || (tickets.length >= 20);
                
                if (append) {
                    this.tickets = [...this.tickets, ...tickets];
                } else {
                    this.tickets = tickets;
                }
                
                // Обновляем статистику из ответа
                if (data.stats) {
                    this.stats = data.stats;
                    this.updateStatsUI();
                }
                
                this.errorCount = 0; // Сбрасываем счетчик ошибок при успехе
                
                console.log(`✅ Загружено ${tickets.length} билетов`);
                
                // Обновляем UI
                this.renderTickets();
                
                // Увеличиваем страницу только если загрузили реальные данные
                if (tickets.length > 0) {
                    this.currentPage++;
                }
                
            } else {
                console.warn('⚠️ API вернул ошибку:', data.error);
                this.createDemoTickets();
            }
            
        } catch (error) {
            console.error('❌ Ошибка загрузки билетов:', error.message);
            
            // Если много ошибок или API недоступен - показываем демо-данные
            if (this.errorCount >= this.maxErrors || this.apiUnavailable) {
                console.log('🎭 API недоступен, создаем демо-билеты...');
                this.apiUnavailable = true;
                this.createDemoTickets();
            }
            
        } finally {
            this.isLoading = false;
        }
    }
    
    createDemoTickets() {
        console.log('🎭 Создание демо-билетов...');
        
        // Создаем демо-билеты для отображения
        const demoStatuses = ['active', 'won', 'lost', 'drawing'];
        const demoPrizes = [0, 0, 0, 0, 50, 100, 250, 500, 1000];
        
        this.tickets = [];
        
        for (let i = 1; i <= 8; i++) {
            const status = demoStatuses[Math.floor(Math.random() * demoStatuses.length)];
            const numbers = [];
            
            // Генерируем уникальные числа
            const uniqueNumbers = new Set();
            while (uniqueNumbers.size < 12) {
                uniqueNumbers.add(Math.floor(Math.random() * 24) + 1);
            }
            
            numbers.push(...Array.from(uniqueNumbers).sort((a, b) => a - b));
            
            const ticket = {
                id: `demo_${Date.now()}_${i}`,
                ticket_number: `TICKET-${String(1000 + i).slice(1)}`,
                draw_number: `ТИРАЖ-${String(100 + i).slice(1)}`,
                numbers: numbers,
                status: status,
                created_at: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
                prize_amount: status === 'won' ? demoPrizes[Math.floor(Math.random() * demoPrizes.length)] : 0,
                win_amount: status === 'won' ? demoPrizes[Math.floor(Math.random() * demoPrizes.length)] : 0
            };
            
            this.tickets.push(ticket);
        }
        
        // Обновляем статистику на основе демо-билетов
        this.updateDemoStats();
        this.hasMore = false; // Для демо-данных нет пагинации
        this.renderTickets();
    }
    
    updateDemoStats() {
        const total = this.tickets.length;
        const active = this.tickets.filter(t => t.status === 'active').length;
        const won = this.tickets.filter(t => t.status === 'won').length;
        const lost = this.tickets.filter(t => t.status === 'lost').length;
        const drawing = this.tickets.filter(t => t.status === 'drawing').length;
        const total_won = this.tickets
            .filter(t => t.prize_amount)
            .reduce((sum, ticket) => sum + ticket.prize_amount, 0);
        
        this.stats = {
            total_tickets: total,
            total_won: total_won,
            active: active,
            won: won,
            lost: lost,
            drawing: drawing
        };
        
        this.updateStatsUI();
    }
    
    createDemoData() {
        this.createDemoTickets();
        this.updateDemoStats();
    }
    
    filterTickets() {
        console.log(`🔍 Фильтрация билетов по: ${this.filters.status}`);
        
        let filteredTickets = [...this.tickets];
        
        // Фильтр по статусу
        if (this.filters.status && this.filters.status !== 'all') {
            filteredTickets = filteredTickets.filter(ticket => 
                ticket.status === this.filters.status
            );
        }
        
        // Фильтр по номеру тиража
        if (this.filters.drawId) {
            filteredTickets = filteredTickets.filter(ticket =>
                ticket.draw_number && ticket.draw_number.includes(this.filters.drawId)
            );
        }
        
        // Сортировка
        filteredTickets = this.sortTickets(filteredTickets);
        
        console.log(`✅ Отфильтровано билетов: ${filteredTickets.length}`);
        return filteredTickets;
    }
    
    sortTickets(tickets) {
        console.log(`🔍 Сортировка билетов по: ${this.sortBy}`);
        
        const sortedTickets = [...tickets];
        
        switch(this.sortBy) {
            case 'newest':
                sortedTickets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                break;
            case 'oldest':
                sortedTickets.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
                break;
            case 'prize_high':
                sortedTickets.sort((a, b) => (b.prize_amount || 0) - (a.prize_amount || 0));
                break;
            case 'prize_low':
                sortedTickets.sort((a, b) => (a.prize_amount || 0) - (b.prize_amount || 0));
                break;
        }
        
        return sortedTickets;
    }
    
    renderTickets() {
        const container = document.getElementById('ticketsContainer');
        if (!container) {
            console.error('❌ Контейнер ticketsContainer не найден');
            return;
        }
        
        const filteredTickets = this.filterTickets();
        
        if (filteredTickets.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🎫</div>
                    <h3>Билеты не найдены</h3>
                    <p>${this.filters.status !== 'all' ? 'Попробуйте изменить фильтр' : 'Купите свой первый билет!'}</p>
                    <button onclick="location.href='/'" class="btn btn-primary" style="margin-top: 15px;">
                        🎮 Играть
                    </button>
                </div>
            `;
            return;
        }
        
        const ticketsHtml = filteredTickets.map(ticket => this.createTicketHTML(ticket)).join('');
        container.innerHTML = ticketsHtml;
        
        console.log(`✅ Отображено билетов: ${filteredTickets.length}`);
    }
    
    createTicketHTML(ticket) {
        const numbersHtml = Array.isArray(ticket.numbers) 
            ? ticket.numbers.map(num => `<span class="ticket-number">${num}</span>`).join('')
            : '';
        
        const statusClass = `status-${ticket.status}`;
        const statusText = this.getStatusText(ticket.status);
        const statusIcon = this.getStatusIcon(ticket.status);
        
        const date = ticket.created_at 
            ? new Date(ticket.created_at).toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
            })
            : 'Неизвестно';
        
        const prizeHtml = ticket.prize_amount > 0 
            ? `<div class="ticket-prize">🏆 ${ticket.prize_amount} Stars</div>`
            : (ticket.win_amount > 0 
                ? `<div class="ticket-prize">🏆 ${ticket.win_amount} Stars</div>`
                : '');
        
        return `
            <div class="ticket-card" data-id="${ticket.id}">
                <div class="ticket-header">
                    <div class="ticket-info">
                        <div class="ticket-number">${ticket.ticket_number || 'TICKET'}</div>
                        <div class="ticket-draw">${ticket.draw_number || 'ТИРАЖ-000'}</div>
                        <div class="ticket-date">${date}</div>
                    </div>
                    <div class="ticket-status ${statusClass}">
                        ${statusIcon} ${statusText}
                    </div>
                </div>
                
                ${numbersHtml ? `
                    <div class="ticket-numbers">
                        ${numbersHtml}
                    </div>
                ` : ''}
                
                ${prizeHtml}
                
                <div class="ticket-actions">
                    <button class="btn btn-small view-ticket" data-id="${ticket.id}">
                        👁️ Подробнее
                    </button>
                    ${ticket.status === 'active' ? `
                        <button class="btn btn-small btn-outline track-draw" data-draw="${ticket.draw_number}">
                            🔍 Следить за тиражом
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }
    
    getStatusText(status) {
        switch(status) {
            case 'active': return 'Активен';
            case 'won': return 'Выигрыш';
            case 'lost': return 'Проигрыш';
            case 'drawing': return 'Идет розыгрыш';
            default: return 'Неизвестно';
        }
    }
    
    getStatusIcon(status) {
        switch(status) {
            case 'active': return '⏳';
            case 'won': return '🎉';
            case 'lost': return '😔';
            case 'drawing': return '🎲';
            default: return '❓';
        }
    }
    
    updateStatsUI() {
        console.log('📊 Обновление статистики UI...');
        
        // БЕЗОПАСНОЕ обновление - проверяем элементы перед доступом
        const totalTicketsElement = document.getElementById('totalTickets');
        const wonAmountElement = document.getElementById('wonAmount');
        
        if (totalTicketsElement) {
            totalTicketsElement.textContent = this.stats.total_tickets || 0;
        } else {
            console.warn('⚠️ Элемент totalTickets не найден');
        }
        
        if (wonAmountElement) {
            wonAmountElement.textContent = this.stats.total_won || 0;
        } else {
            console.warn('⚠️ Элемент wonAmount не найден');
        }
        
        // Обновляем другие статистические элементы если они есть
        const totalEl = document.getElementById('totalTicketsStat');
        const wonEl = document.getElementById('wonTicketsStat');
        const activeEl = document.getElementById('activeTicketsStat');
        const lostEl = document.getElementById('lostTicketsStat');
        const drawingEl = document.getElementById('drawingTicketsStat');
        
        if (totalEl) totalEl.textContent = this.stats.total_tickets || 0;
        if (wonEl) wonEl.textContent = this.stats.won || 0;
        if (activeEl) activeEl.textContent = this.stats.active || 0;
        if (lostEl) lostEl.textContent = this.stats.lost || 0;
        if (drawingEl) drawingEl.textContent = this.stats.drawing || 0;
        
        // Добавляем уведомление о демо-режиме если нужно
        if (this.apiUnavailable) {
            this.addDemoModeNotification();
        }
    }
    
    addDemoModeNotification() {
        // Удаляем старое уведомление если есть
        const oldNotification = document.querySelector('.demo-mode-notification');
        if (oldNotification) oldNotification.remove();
        
        const notification = document.createElement('div');
        notification.className = 'demo-mode-notification notification warning';
        notification.innerHTML = `
            <div class="notification-content">
                <span class="notification-icon">⚠️</span>
                <span class="notification-message">Офлайн режим (демо-данные)</span>
            </div>
        `;
        notification.style.cssText = 'position: relative; top: 0; margin: 10px 0; padding: 10px; background: rgba(255,165,0,0.1); border: 1px solid orange; border-radius: 8px;';
        
        // Ищем место для вставки
        const statsSection = document.querySelector('.stats-section');
        if (statsSection) {
            statsSection.appendChild(notification);
        } else {
            // Или вставляем в начало контейнера
            const container = document.querySelector('.container, main') || document.body;
            container.insertBefore(notification, container.firstChild);
        }
    }
    
    setupUI() {
        console.log('🎨 Настройка UI...');
        
        // Создаем элементы статистики если их нет
        this.createStatsElements();
        
        // Инициализируем селекты фильтров
        const statusFilter = document.getElementById('statusFilter');
        const sortFilter = document.getElementById('sortFilter');
        
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
        
        // Поле поиска по номеру тиража
        const drawSearch = document.getElementById('drawSearch');
        if (drawSearch) {
            let searchTimeout;
            drawSearch.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    this.filters.drawId = e.target.value.trim();
                    this.renderTickets();
                }, 300);
            });
        }
        
        // Кнопка сброса фильтров
        const resetFiltersBtn = document.getElementById('resetFilters');
        if (resetFiltersBtn) {
            resetFiltersBtn.addEventListener('click', () => {
                this.filters = { status: 'all', drawId: '' };
                this.sortBy = 'newest';
                
                if (statusFilter) statusFilter.value = 'all';
                if (sortFilter) sortFilter.value = 'newest';
                if (drawSearch) drawSearch.value = '';
                
                this.renderTickets();
                this.showNotification('Фильтры сброшены', 'info');
            });
        }
        
        // Кнопка обновления
        const refreshBtn = document.getElementById('refreshTickets');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.disabled = true;
                refreshBtn.innerHTML = '<span class="loading-spinner"></span> Обновление...';
                
                // Сбрасываем состояние
                this.currentPage = 1;
                this.hasMore = true;
                this.apiUnavailable = false;
                this.errorCount = 0;
                
                // Очищаем контейнер
                const container = document.getElementById('ticketsContainer');
                if (container) {
                    container.innerHTML = '<div class="loading">Загрузка...</div>';
                }
                
                // Загружаем заново
                await this.loadTickets();
                
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = '🔄 Обновить';
                this.showNotification('Билеты обновлены', 'success');
            });
        }
        
        console.log('✅ UI настроен');
    }
    
    createStatsElements() {
        // Проверяем, есть ли контейнер статистики
        let statsContainer = document.getElementById('statsContainer');
        
        if (!statsContainer) {
            console.log('📊 Создаю контейнер статистики...');
            statsContainer = document.createElement('div');
            statsContainer.id = 'statsContainer';
            statsContainer.className = 'stats-container';
            
            // Вставляем в подходящее место
            const header = document.querySelector('header');
            const main = document.querySelector('main');
            
            if (header && header.nextElementSibling) {
                header.parentNode.insertBefore(statsContainer, header.nextElementSibling);
            } else if (main) {
                main.insertBefore(statsContainer, main.firstChild);
            } else {
                document.body.insertBefore(statsContainer, document.body.firstChild);
            }
        }
        
        // Проверяем и создаем элементы статистики
        if (!document.getElementById('totalTickets')) {
            console.log('📊 Создаю элементы статистики...');
            statsContainer.innerHTML = `
                <section class="stats-section">
                    <h2 style="margin-bottom: 15px;">📊 Статистика билетов</h2>
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-icon">🎫</div>
                            <div class="stat-value" id="totalTickets">0</div>
                            <div class="stat-label">Всего билетов</div>
                        </div>
                        
                        <div class="stat-card">
                            <div class="stat-icon">💰</div>
                            <div class="stat-value" id="wonAmount">0</div>
                            <div class="stat-label">Общий выигрыш</div>
                        </div>
                        
                        <div class="stat-card">
                            <div class="stat-icon">🎉</div>
                            <div class="stat-value" id="wonTicketsStat">0</div>
                            <div class="stat-label">Выигрыши</div>
                        </div>
                        
                        <div class="stat-card">
                            <div class="stat-icon">⏳</div>
                            <div class="stat-value" id="activeTicketsStat">0</div>
                            <div class="stat-label">Активные</div>
                        </div>
                    </div>
                </section>
            `;
        }
    }
    
    setupEventListeners() {
        console.log('🎮 Настройка обработчиков событий...');
        
        // Обработчик для кнопок "Подробнее"
        document.addEventListener('click', (e) => {
            const viewBtn = e.target.closest('.view-ticket');
            if (viewBtn) {
                const ticketId = viewBtn.dataset.id;
                this.showTicketDetails(ticketId);
                return;
            }
            
            // Обработчик для слежения за тиражом
            const trackBtn = e.target.closest('.track-draw');
            if (trackBtn) {
                const drawNumber = trackBtn.dataset.draw;
                this.trackDraw(drawNumber);
                return;
            }
            
            // Обработчик для кнопки "На главную"
            const homeBtn = e.target.closest('#goHomeBtn');
            if (homeBtn) {
                this.goHome();
                return;
            }
        });
        
        // Кнопка покупки нового билета
        const buyTicketBtn = document.getElementById('buyTicketBtn');
        if (buyTicketBtn) {
            buyTicketBtn.addEventListener('click', () => {
                window.location.href = '/?buy=true';
            });
        }
        
        console.log('✅ Обработчики событий настроены');
    }
    
    setupInfiniteScroll() {
        console.log('📜 Настройка бесконечной прокрутки...');
        
        const options = {
            root: null,
            rootMargin: '200px',
            threshold: 0.1
        };
        
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && this.hasMore && !this.isLoading && !this.apiUnavailable) {
                    console.log('⬇️ Загрузка следующей страницы...');
                    this.loadTickets(true);
                }
            });
        }, options);
        
        // Создаем элемент-триггер для бесконечной прокрутки
        const trigger = document.createElement('div');
        trigger.id = 'scrollTrigger';
        trigger.style.height = '50px';
        trigger.innerHTML = '<div class="loading-more">Загрузка...</div>';
        
        const container = document.getElementById('ticketsContainer');
        if (container) {
            container.appendChild(trigger);
            observer.observe(trigger);
            console.log('✅ Бесконечная прокрутка настроена');
        }
    }
    
    showTicketDetails(ticketId) {
        const ticket = this.tickets.find(t => t.id === ticketId);
        if (!ticket) {
            this.showNotification('Билет не найден', 'error');
            return;
        }
        
        // Показываем модальное окно с деталями билета
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
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary share-ticket">📤 Поделиться</button>
                    <button class="btn btn-outline close-btn">Закрыть</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Закрытие модального окна
        const closeModal = () => {
            modal.classList.add('closing');
            setTimeout(() => modal.remove(), 300);
        };
        
        modal.querySelector('.close-modal').addEventListener('click', closeModal);
        modal.querySelector('.close-btn').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
        
        // Кнопка поделиться
        modal.querySelector('.share-ticket').addEventListener('click', () => {
            this.shareTicket(ticket);
        });
    }
    
    shareTicket(ticket) {
        const shareText = `🎫 Мой билет в Fortuna Lottery:
Номер: ${ticket.ticket_number}
Тираж: ${ticket.draw_number}
Числа: ${Array.isArray(ticket.numbers) ? ticket.numbers.join(', ') : ''}
Статус: ${this.getStatusText(ticket.status)}
${ticket.prize_amount > 0 ? `Выигрыш: ${ticket.prize_amount} Stars 🏆` : ''}

Проверьте свои шансы на выигрыш!`;
        
        if (navigator.share) {
            navigator.share({
                title: 'Мой билет Fortuna Lottery',
                text: shareText,
                url: window.location.origin
            });
        } else {
            navigator.clipboard.writeText(shareText)
                .then(() => this.showNotification('Текст скопирован в буфер обмена', 'success'))
                .catch(() => this.showNotification('Не удалось скопировать', 'error'));
        }
    }
    
    trackDraw(drawNumber) {
        this.showNotification(`Переход к тиражу ${drawNumber}...`, 'info');
        
        // Сохраняем номер тиража для игры
        sessionStorage.setItem('tracked_draw', drawNumber);
        
        // Возвращаемся на главную
        setTimeout(() => {
            window.location.href = '/';
        }, 1000);
    }
    
    goHome() {
        window.location.href = '/';
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
    
    showAuthError() {
        document.body.innerHTML = `
            <div class="auth-error">
                <div class="error-icon">🔒</div>
                <h2>Требуется авторизация</h2>
                <p>Для просмотра билетов необходимо войти в систему</p>
                <button id="goToGame" class="btn btn-primary">Вернуться в игру</button>
                <button id="tryAgain" class="btn btn-outline">Попробовать снова</button>
            </div>
        `;
        
        document.getElementById('goToGame').addEventListener('click', () => {
            window.location.href = '/';
        });
        
        document.getElementById('tryAgain').addEventListener('click', () => {
            location.reload();
        });
    }
    
    destroy() {
        console.log('🛑 Остановка TicketsManager...');
        // Очистка ресурсов если нужно
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
                <h2>Ошибка загрузки билетов</h2>
                <p>Пожалуйста, попробуйте позже</p>
                <button onclick="location.reload()" style="
                    padding: 10px 20px;
                    background: #4CAF50;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    margin-top: 15px;
                    cursor: pointer;
                ">
                    Обновить
                </button>
            </div>
        `;
    }
});

// Глобальный экспорт для отладки
window.debugTickets = () => {
    if (window.ticketsManager) {
        console.log('🔍 Отладка TicketsManager:', {
            userId: window.ticketsManager.userId,
            ticketsCount: window.ticketsManager.tickets.length,
            stats: window.ticketsManager.stats,
            apiUnavailable: window.ticketsManager.apiUnavailable,
            errorCount: window.ticketsManager.errorCount,
            filters: window.ticketsManager.filters,
            sortBy: window.ticketsManager.sortBy
        });
    }
};
