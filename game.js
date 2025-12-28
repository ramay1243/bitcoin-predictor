// ==================== КОНФИГУРАЦИЯ ====================
const CONFIG = {
    ROUND_DURATION: 300, // 5 минут в секундах
    COMMISSION: 0.1, // 10% комиссия
    MIN_BET: 10,
    MAX_BET: 1000,
    PRICE_UPDATE_INTERVAL: 15000, // 15 секунд
    FALLBACK_PRICE: 65432.10,
    MAX_VOLATILITY: 5,
    PRICE_PRECISION: 2
};

// ==================== СОСТОЯНИЕ ИГРЫ ====================
let gameState = {
    // Текущие данные
    currentPrice: 0,
    roundStartPrice: 0,
    roundEndPrice: 0,
    roundEndTime: 0,
    roundStartTime: 0,
    roundNumber: 1,
    roundActive: true,
    
    // Пользователь - НАЧИНАЕМ С 0!
    userBalance: 0,
    currentBet: 100,
    selectedDirection: null,
    userBetAmount: 0,
    
    // Статистика
    userStats: {
        totalBets: 0,
        wins: 0,
        losses: 0,
        profit: 0,
        winStreak: 0,
        bestWinStreak: 0,
        rating: 1000
    },
    
    // Игроки (симуляция)
    players: [
        { id: 'bot1', name: '@crypto_pro', balance: 5000, bets: [] },
        { id: 'bot2', name: '@bitcoin_king', balance: 3200, bets: [] },
        { id: 'bot3', name: '@trader777', balance: 2100, bets: [] }
    ],
    
    // История
    history: [],
    
    // Коэффициенты
    odds: {
        up: 1.8,
        down: 1.9
    }
};

let priceHistory = [];

// ==================== TELEGRAM ====================
const tg = window.Telegram.WebApp;

function initTelegram() {
    if (tg) {
        tg.ready();
        tg.expand();
        
        if (tg.initDataUnsafe?.user) {
            const user = tg.initDataUnsafe.user;
            document.getElementById('username').textContent = 
                user.first_name || user.username || 'Трейдер';
        }
        
        // Бонус за первую регистрацию
        const hasBonus = localStorage.getItem('bitcoin_bonus_given');
        if (!hasBonus && tg.initDataUnsafe?.user) {
            gameState.userBalance += 10; // Бонус 10 Stars
            localStorage.setItem('bitcoin_bonus_given', 'true');
            showNotification('🎁 +10 Stars за регистрацию!');
            updateBalanceDisplay();
        }
        
        if (tg.initDataUnsafe?.start_param) {
            const ref = tg.initDataUnsafe.start_param;
            if (ref.startsWith('ref_')) {
                gameState.userBalance += 50;
                showNotification('🎁 +50 Stars за приглашенного друга!');
                updateBalanceDisplay();
            }
        }
    }
}

// ==================== РЕАЛЬНАЯ ЦЕНА BITCOIN ====================
async function getBitcoinPrice() {
    console.log('🔄 Получение реальной цены Bitcoin...');
    
    const apis = [
        {
            name: 'Binance',
            url: 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
            parser: (data) => parseFloat(data.price)
        },
        {
            name: 'CoinGecko',
            url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
            parser: (data) => data.bitcoin.usd
        },
        {
            name: 'Bybit',
            url: 'https://api.bybit.com/v2/public/tickers?symbol=BTCUSD',
            parser: (data) => parseFloat(data.result[0]?.last_price)
        }
    ];

    for (const api of apis) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            
            const response = await fetch(api.url, {
                signal: controller.signal,
                headers: { 'Accept': 'application/json' }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) continue;
            
            const data = await response.json();
            const price = api.parser(data);
            
            if (price && !isNaN(price) && price > 1000 && price < 200000) {
                return Math.round(price * 100) / 100;
            }
            
        } catch (error) {
            continue;
        }
    }
    
    return gameState.currentPrice || CONFIG.FALLBACK_PRICE;
}

// ==================== ОБНОВЛЕННАЯ ФУНКЦИЯ ОБНОВЛЕНИЯ ЦЕНЫ ====================
async function updatePriceWithVerification() {
    try {
        const newPrice = await getBitcoinPrice();
        gameState.currentPrice = newPrice;
        updatePriceDisplay();
        return newPrice;
    } catch (error) {
        if (gameState.currentPrice === 0) {
            gameState.currentPrice = CONFIG.FALLBACK_PRICE;
        }
        updatePriceDisplay();
        return gameState.currentPrice;
    }
}

function updatePriceDisplay() {
    const priceElement = document.getElementById('current-price');
    const changeElement = document.getElementById('change-amount');
    
    if (priceElement) {
        priceElement.textContent = `$${gameState.currentPrice.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
    }
    
    if (changeElement && gameState.roundStartPrice > 0) {
        const changePercent = ((gameState.currentPrice - gameState.roundStartPrice) / gameState.roundStartPrice * 100);
        const changeText = `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`;
        
        changeElement.textContent = changeText;
        changeElement.style.color = changePercent >= 0 ? '#00ff00' : '#ff0000';
    }
}

// ==================== ТАЙМЕР И РАУНДЫ ====================
function startNewRound() {
    gameState.roundNumber++;
    gameState.roundActive = true;
    gameState.selectedDirection = null;
    gameState.userBetAmount = 0;
    gameState.roundStartTime = Date.now();
    
    gameState.players.forEach(player => player.bets = []);
    
    gameState.roundEndTime = Math.floor(Date.now() / 1000) + CONFIG.ROUND_DURATION;
    
    updatePriceWithVerification().then(price => {
        gameState.roundStartPrice = price;
        document.getElementById('round-start-price').textContent = 
            `$${price.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
        
        document.getElementById('bet-up').disabled = false;
        document.getElementById('bet-down').disabled = false;
        
        document.getElementById('bet-up').style.opacity = '1';
        document.getElementById('bet-down').style.opacity = '1';
        document.getElementById('bet-up').style.border = '';
        document.getElementById('bet-down').style.border = '';
        
        updateRoundInfo();
        
        showNotification(`🔄 Раунд #${gameState.roundNumber} начат! Ставки открыты.`);
    });
    
    simulateBotBets();
}

function updateTimer() {
    const now = Math.floor(Date.now() / 1000);
    const timeLeft = gameState.roundEndTime - now;
    
    if (timeLeft <= 0 && gameState.roundActive) {
        endRound();
        return;
    }
    
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    const timerElement = document.getElementById('timer');
    
    if (timerElement) {
        timerElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        if (timeLeft < 30) {
            timerElement.style.color = '#ff0000';
            timerElement.classList.add('pulse');
        } else if (timeLeft < 60) {
            timerElement.style.color = '#ffaa00';
        } else {
            timerElement.style.color = '#00ffff';
            timerElement.classList.remove('pulse');
        }
    }
    
    const progressElement = document.getElementById('progress-fill');
    if (progressElement) {
        const progressPercent = 100 - (timeLeft / CONFIG.ROUND_DURATION * 100);
        progressElement.style.width = `${progressPercent}%`;
    }
    
    if (timeLeft < 10 && !document.getElementById('bet-up').disabled) {
        document.getElementById('bet-up').disabled = true;
        document.getElementById('bet-down').disabled = true;
        showNotification('⏰ Ставки закрыты! Раунд скоро завершится.');
    }
}

async function endRound() {
    gameState.roundActive = false;
    
    const endPrice = await updatePriceWithVerification();
    gameState.roundEndPrice = endPrice;
    
    const direction = endPrice > gameState.roundStartPrice ? 'up' : 'down';
    const changePercent = ((endPrice - gameState.roundStartPrice) / gameState.roundStartPrice * 100);
    
    calculateRoundResults(direction);
    showRoundResult(direction, changePercent);
    
    setTimeout(startNewRound, 5000);
}

function updateRoundInfo() {
    document.getElementById('round-number').textContent = gameState.roundNumber;
    
    const playerCount = 3 + Math.floor(Math.random() * 7);
    document.getElementById('players-count').textContent = playerCount;
    
    const prizePool = playerCount * 150;
    document.getElementById('prize-pool').textContent = `${prizePool}⭐`;
}

// ==================== СТАВКИ (ГЛАВНЫЕ ИЗМЕНЕНИЯ) ====================
function placeBet(direction) {
    // 1. ПРОВЕРКА БАЛАНСА
    if (gameState.userBalance < gameState.currentBet) {
        showNotification(`❌ НЕТ ДЕНЕГ! Нужно ${gameState.currentBet}⭐, у тебя ${gameState.userBalance}⭐`, 'error');
        
        // Если денег 0, подсвечиваем кнопку покупки
        if (gameState.userBalance === 0) {
            setTimeout(() => {
                document.getElementById('buy-stars').classList.add('pulse');
            }, 500);
        }
        return;
    }
    
    // 2. ОСТАЛЬНЫЕ ПРОВЕРКИ
    if (!gameState.roundActive) {
        showNotification('❌ Раунд не активен! Жди новый раунд.');
        return;
    }
    
    if (gameState.selectedDirection) {
        showNotification(`❌ Ты уже поставил на ${gameState.selectedDirection === 'up' ? 'ВЫШЕ' : 'НИЖЕ'}!`);
        return;
    }
    
    const timeLeft = gameState.roundEndTime - Math.floor(Date.now() / 1000);
    if (timeLeft < 10) {
        showNotification('⏰ Слишком поздно! Ставки закрыты.');
        return;
    }
    
    // 3. СПИСЫВАЕМ ДЕНЬГИ
    gameState.userBalance -= gameState.currentBet;
    gameState.selectedDirection = direction;
    gameState.userBetAmount = gameState.currentBet;
    gameState.userStats.totalBets++;
    
    // 4. ВИЗУАЛЬНЫЕ ЭФФЕКТЫ
    const upBtn = document.getElementById('bet-up');
    const downBtn = document.getElementById('bet-down');
    
    upBtn.style.opacity = direction === 'up' ? '1' : '0.5';
    downBtn.style.opacity = direction === 'down' ? '1' : '0.5';
    
    upBtn.style.border = direction === 'up' ? '3px solid gold' : '';
    downBtn.style.border = direction === 'down' ? '3px solid gold' : '';
    
    upBtn.disabled = true;
    downBtn.disabled = true;
    
    // 5. ОБНОВЛЯЕМ ИНТЕРФЕЙС
    document.getElementById('user-bet-amount').textContent = `${gameState.currentBet}⭐`;
    updateBalanceDisplay();
    updatePotentialWin();
    
    showNotification(`✅ Ставка ${gameState.currentBet}⭐ на ${direction === 'up' ? '📈 ВЫШЕ' : '📉 НИЖЕ'} принята!`);
    
    // 6. СОХРАНЯЕМ В ИСТОРИЮ
    gameState.history.push({
        round: gameState.roundNumber,
        direction: direction,
        amount: gameState.currentBet,
        price: gameState.roundStartPrice,
        timestamp: Date.now(),
        status: 'pending'
    });
    
    // 7. СОХРАНЯЕМ БАЛАНС
    localStorage.setItem('bitcoinBalance', gameState.userBalance.toString());
}

function updateBetAmount(amount) {
    gameState.currentBet = parseInt(amount);
    
    document.querySelectorAll('.amount-btn').forEach(btn => {
        btn.classList.remove('active');
        if (parseInt(btn.dataset.amount) === gameState.currentBet) {
            btn.classList.add('active');
        }
    });
    
    document.getElementById('bet-slider').value = gameState.currentBet;
    document.getElementById('current-slider-value').textContent = `${gameState.currentBet}⭐`;
    
    updatePotentialWin();
}

function updatePotentialWin() {
    if (!gameState.selectedDirection) return;
    
    const odds = gameState.selectedDirection === 'up' ? gameState.odds.up : gameState.odds.down;
    const potentialWin = Math.floor(gameState.currentBet * odds);
    
    document.getElementById('potential-win').textContent = `${potentialWin}⭐`;
}

function updateOdds() {
    const upBets = Math.floor(Math.random() * 100) + 50;
    const downBets = Math.floor(Math.random() * 100) + 50;
    
    gameState.odds.up = 1.5 + (100 / (upBets + 50));
    gameState.odds.down = 1.5 + (100 / (downBets + 50));
    
    gameState.odds.up = Math.round(gameState.odds.up * 10) / 10;
    gameState.odds.down = Math.round(gameState.odds.down * 10) / 10;
    
    document.getElementById('odds-up').textContent = `${gameState.odds.up}x`;
    document.getElementById('odds-down').textContent = `${gameState.odds.down}x`;
}

// ==================== РАСЧЕТ РЕЗУЛЬТАТОВ ====================
function calculateRoundResults(winningDirection) {
    const allBets = [];
    
    if (gameState.selectedDirection) {
        allBets.push({
            userId: 'user',
            direction: gameState.selectedDirection,
            amount: gameState.userBetAmount
        });
    }
    
    gameState.players.forEach(player => {
        player.bets.forEach(bet => {
            allBets.push({
                userId: player.id,
                direction: bet.direction,
                amount: bet.amount
            });
        });
    });
    
    const upBets = allBets.filter(bet => bet.direction === 'up');
    const downBets = allBets.filter(bet => bet.direction === 'down');
    
    const winningBets = winningDirection === 'up' ? upBets : downBets;
    const losingBets = winningDirection === 'up' ? downBets : upBets;
    
    const totalPool = allBets.reduce((sum, bet) => sum + bet.amount, 0);
    const commission = totalPool * CONFIG.COMMISSION;
    const prizePool = totalPool - commission;
    
    if (winningBets.length > 0) {
        const totalWinningAmount = winningBets.reduce((sum, bet) => sum + bet.amount, 0);
        
        winningBets.forEach(bet => {
            const share = bet.amount / totalWinningAmount;
            const winAmount = Math.floor(prizePool * share);
            
            if (bet.userId === 'user') {
                gameState.userBalance += winAmount;
                
                if (winAmount > bet.amount) {
                    gameState.userStats.wins++;
                    gameState.userStats.winStreak++;
                    gameState.userStats.profit += (winAmount - bet.amount);
                    gameState.userStats.rating += 10;
                    
                    if (gameState.userStats.winStreak > gameState.userStats.bestWinStreak) {
                        gameState.userStats.bestWinStreak = gameState.userStats.winStreak;
                    }
                    
                    gameState.history[gameState.history.length - 1].result = 'win';
                    gameState.history[gameState.history.length - 1].winAmount = winAmount;
                } else {
                    gameState.userStats.losses++;
                    gameState.userStats.winStreak = 0;
                    gameState.userStats.profit -= (bet.amount - winAmount);
                    gameState.userStats.rating -= 5;
                    
                    gameState.history[gameState.history.length - 1].result = 'loss';
                    gameState.history[gameState.history.length - 1].winAmount = winAmount;
                }
            }
            
            if (bet.userId.startsWith('bot')) {
                const player = gameState.players.find(p => p.id === bet.userId);
                if (player) {
                    player.balance += winAmount;
                }
            }
        });
    }
    
    // Сохраняем баланс после выигрыша/проигрыша
    localStorage.setItem('bitcoinBalance', gameState.userBalance.toString());
    
    gameState.players.forEach(player => {
        player.balance = Math.max(100, player.balance + (Math.random() - 0.5) * 500);
    });
}

// ==================== ПОКАЗ РЕЗУЛЬТАТОВ ====================
function showRoundResult(winningDirection, changePercent) {
    const resultModal = document.getElementById('result-modal');
    const userWon = gameState.selectedDirection === winningDirection;
    
    document.getElementById('result-start-price').textContent = 
        `$${gameState.roundStartPrice.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
    document.getElementById('result-end-price').textContent = 
        `$${gameState.roundEndPrice.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
    
    const changeElement = document.getElementById('result-change');
    changeElement.textContent = `Изменение: ${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`;
    changeElement.style.color = changePercent >= 0 ? '#00ff00' : '#ff0000';
    
    const userResultElement = document.getElementById('user-result');
    if (gameState.selectedDirection) {
        userResultElement.innerHTML = `
            Ваша ставка: <span class="bet-amount">${gameState.userBetAmount}⭐</span> 
            на <span class="bet-direction">${gameState.selectedDirection === 'up' ? '📈 ВЫШЕ' : '📉 НИЖЕ'}</span>
        `;
    } else {
        userResultElement.textContent = 'Вы не делали ставку в этом раунде';
    }
    
    const messageElement = document.getElementById('result-message');
    const prizeElement = document.getElementById('result-prize');
    
    if (!gameState.selectedDirection) {
        messageElement.textContent = '👀 Вы наблюдали за раундом';
        messageElement.style.color = '#888';
        prizeElement.style.display = 'none';
    } else if (userWon) {
        const lastBet = gameState.history[gameState.history.length - 1];
        const winAmount = lastBet?.winAmount || 0;
        const profit = winAmount - gameState.userBetAmount;
        
        messageElement.textContent = profit > 0 ? '🎉 ПОБЕДА! Вы выиграли!' : '🤝 Ничья!';
        messageElement.style.color = '#00ff00';
        
        prizeElement.innerHTML = `
            Выигрыш: <span class="prize-amount">${winAmount}⭐</span>
            <br><small>Прибыль: ${profit >= 0 ? '+' : ''}${profit}⭐</small>
        `;
        prizeElement.style.display = 'block';
    } else {
        messageElement.textContent = '😢 Поражение... Попробуйте ещё раз!';
        messageElement.style.color = '#ff0000';
        messageElement.classList.add('shake');
        
        prizeElement.innerHTML = `
            Потеря: <span class="prize-amount" style="color: #ff0000">${gameState.userBetAmount}⭐</span>
        `;
        prizeElement.style.display = 'block';
    }
    
    resultModal.style.display = 'flex';
    
    setTimeout(() => {
        if (resultModal.style.display === 'flex') {
            closeModal('result-modal');
        }
    }, 10000);
}

// ==================== СИМУЛЯЦИЯ БОТОВ ====================
function simulateBotBets() {
    gameState.players.forEach(player => {
        const shouldBet = Math.random() > 0.3;
        
        if (shouldBet) {
            const direction = Math.random() > 0.5 ? 'up' : 'down';
            const amount = Math.floor(Math.random() * 500) + 50;
            
            if (player.balance >= amount) {
                player.balance -= amount;
                player.bets.push({
                    direction: direction,
                    amount: amount,
                    timestamp: Date.now()
                });
            }
        }
    });
}

// ==================== ОТОБРАЖЕНИЕ ====================
function updateBalanceDisplay() {
    const balanceElement = document.getElementById('balance');
    const buyButton = document.getElementById('buy-stars');
    
    if (balanceElement) {
        balanceElement.textContent = `${gameState.userBalance}⭐`;
        
        // Красный если баланс 0
        if (gameState.userBalance === 0) {
            balanceElement.style.color = '#ff0000';
            balanceElement.style.textShadow = '0 0 10px rgba(255, 0, 0, 0.7)';
            if (buyButton) buyButton.classList.add('pulse');
        } 
        // Оранжевый если мало
        else if (gameState.userBalance < 100) {
            balanceElement.style.color = '#ff9900';
            balanceElement.style.textShadow = 'none';
            if (buyButton) buyButton.classList.remove('pulse');
        } 
        // Нормальный если достаточно
        else {
            balanceElement.style.color = '#f7931a';
            balanceElement.style.textShadow = 'none';
            if (buyButton) buyButton.classList.remove('pulse');
        }
    }
}

function showNotification(message, type = 'info') {
    const notification = document.getElementById('notification');
    
    if (type === 'success') {
        notification.style.background = 'linear-gradient(45deg, #00aa00, #00ff00)';
    } else if (type === 'error') {
        notification.style.background = 'linear-gradient(45deg, #ff0000, #aa0000)';
    } else if (type === 'warning') {
        notification.style.background = 'linear-gradient(45deg, #ffaa00, #ff5500)';
    } else {
        notification.style.background = 'linear-gradient(45deg, #0088cc, #00aaff)';
    }
    
    notification.textContent = message;
    notification.style.display = 'block';
    
    setTimeout(() => {
        notification.style.display = 'none';
    }, 5000);
}

// ==================== МОДАЛЬНЫЕ ОКНА ====================
function showModal(modalId) {
    document.getElementById(modalId).style.display = 'flex';
    
    if (modalId === 'history-modal') {
        updateHistoryDisplay();
    } else if (modalId === 'leaders-modal') {
        updateLeadersDisplay();
    }
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

function updateHistoryDisplay() {
    const historyList = document.getElementById('history-list');
    const recentHistory = gameState.history.slice(-10).reverse();
    
    if (recentHistory.length === 0) {
        historyList.innerHTML = '<p style="text-align: center; color: #888;">Ставок пока нет</p>';
        return;
    }
    
    historyList.innerHTML = recentHistory.map(item => {
        let resultClass = '';
        let resultText = '';
        
        if (item.status === 'pending') {
            resultClass = 'pending';
            resultText = '⏳ Ожидание';
        } else if (item.result === 'win') {
            resultClass = 'win';
            resultText = `🎉 +${item.winAmount}⭐`;
        } else if (item.result === 'loss') {
            resultClass = 'lose';
            resultText = `😢 -${item.amount}⭐`;
        }
        
        return `
            <div class="history-item ${resultClass}">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <strong>Раунд #${item.round}</strong>
                    <span>${resultText}</span>
                </div>
                <div style="color: #888; font-size: 0.9rem;">
                    ${item.direction === 'up' ? '📈 ВЫШЕ' : '📉 НИЖЕ'} • ${item.amount}⭐ • 
                    $${item.price.toLocaleString('en-US', {minimumFractionDigits: 2})}
                </div>
            </div>
        `;
    }).join('');
}

function updateLeadersDisplay() {
    const leadersList = document.getElementById('leaders-list');
    
    const allPlayers = [
        {
            name: 'Вы',
            balance: gameState.userBalance,
            profit: gameState.userStats.profit,
            wins: gameState.userStats.wins,
            rating: gameState.userStats.rating
        },
        ...gameState.players.map(player => ({
            name: player.name,
            balance: player.balance,
            profit: Math.floor(Math.random() * 2000) - 1000,
            wins: Math.floor(Math.random() * 50),
            rating: 800 + Math.floor(Math.random() * 400)
        }))
    ];
    
    allPlayers.sort((a, b) => b.balance - a.balance);
    
    leadersList.innerHTML = allPlayers.slice(0, 10).map((player, index) => `
        <div class="leader-item">
            <div class="leader-rank">${index + 1}</div>
            <div class="leader-name">${player.name}</div>
            <div class="leader-stats">
                ${player.balance}⭐
                <br>
                <small style="color: ${player.profit >= 0 ? '#00ff00' : '#ff0000'}">
                    ${player.profit >= 0 ? '+' : ''}${player.profit}⭐
                </small>
            </div>
        </div>
    `).join('');
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
async function initGame() {
    console.log('🎰 Bitcoin Predictor PRO запускается...');
    
    // ЗАГРУЖАЕМ СОХРАНЕННЫЙ БАЛАНС
    const savedBalance = localStorage.getItem('bitcoinBalance');
    if (savedBalance !== null) {
        gameState.userBalance = parseInt(savedBalance);
        console.log('📂 Загружен баланс:', gameState.userBalance);
    } else {
        gameState.userBalance = 0;
        console.log('💰 Начинаем с 0');
    }
    
    // Telegram
    initTelegram();
    
    // Начальная цена
    await updatePriceWithVerification();
    gameState.roundStartPrice = gameState.currentPrice;
    gameState.roundEndTime = Math.floor(Date.now() / 1000) + CONFIG.ROUND_DURATION;
    gameState.roundStartTime = Date.now();
    
    // Привязка событий
    bindEvents();
    
    // Запуск таймеров
    setInterval(updateTimer, 1000);
    setInterval(updatePriceWithVerification, CONFIG.PRICE_UPDATE_INTERVAL);
    
    // Обновление отображения
    updateBalanceDisplay();
    updateRoundInfo();
    updateOdds();
    
    // Приветственное сообщение
    if (gameState.userBalance === 0) {
        setTimeout(() => {
            showNotification('💎 Для игры нужны Telegram Stars. Нажми "Купить Stars" чтобы начать!', 'info');
        }, 2000);
    }
    
    // Запуск первого раунда
    startNewRound();
    
    console.log('✅ Игра успешно запущена! Баланс:', gameState.userBalance);
}

function bindEvents() {
    // Кнопки ставок
    document.getElementById('bet-up').addEventListener('click', () => placeBet('up'));
    document.getElementById('bet-down').addEventListener('click', () => placeBet('down'));
    
    // Кнопки суммы ставки
    document.querySelectorAll('.amount-btn').forEach(btn => {
        btn.addEventListener('click', () => updateBetAmount(btn.dataset.amount));
    });
    
    // Слайдер ставки
    document.getElementById('bet-slider').addEventListener('input', (e) => {
        updateBetAmount(e.target.value);
    });
    
    // Кнопки действий
    document.getElementById('history-btn').addEventListener('click', () => showModal('history-modal'));
    document.getElementById('leaders-btn').addEventListener('click', () => showModal('leaders-modal'));
    document.getElementById('buy-stars').addEventListener('click', () => showModal('buy-modal'));
    document.getElementById('help-btn').addEventListener('click', () => {
        showNotification('ℹ️ Bitcoin Predictor: Угадай направление цены Bitcoin за 5 минут. Выигрывай Telegram Stars!');
    });
    
    // Кнопки покупки Stars
    document.querySelectorAll('.buy-package-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const packageElement = e.target.closest('.package');
            const stars = parseInt(packageElement.dataset.stars);
            
            showNotification(`💳 Покупка ${stars} Stars...`, 'warning');
            
            // Симуляция покупки
            setTimeout(() => {
                const oldBalance = gameState.userBalance;
                gameState.userBalance += stars;
                
                // Сохраняем в историю
                gameState.history.push({
                    type: 'purchase',
                    amount: stars,
                    oldBalance: oldBalance,
                    newBalance: gameState.userBalance,
                    timestamp: Date.now()
                });
                
                updateBalanceDisplay();
                showNotification(`✅ Куплено ${stars} Stars! Баланс: ${gameState.userBalance}⭐`, 'success');
                
                // Сохраняем баланс
                localStorage.setItem('bitcoinBalance', gameState.userBalance.toString());
                
            }, 1500);
            
            closeModal('buy-modal');
        });
    });
    
    // Кнопки закрытия модальных окон
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal');
            closeModal(modal.id);
        });
    });
    
    // Кнопка OK в результате
    document.getElementById('result-ok').addEventListener('click', () => {
        closeModal('result-modal');
    });
    
    // Закрытие модальных окон по клику вне окна
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal(modal.id);
            }
        });
    });
}

// ==================== ЗАПУСК ====================
document.addEventListener('DOMContentLoaded', initGame);
