// ==================== КОНФИГУРАЦИЯ ====================
const CONFIG = {
    ROUND_DURATION: 300, // 5 минут в секундах
    COMMISSION: 0.1, // 10% комиссия
    MIN_BET: 10,
    MAX_BET: 1000,
    PRICE_UPDATE_INTERVAL: 15000, // 15 секунд (оптимально для API лимитов)
    INITIAL_BALANCE: 1000,
    FALLBACK_PRICE: 65432.10,
    MAX_VOLATILITY: 5, // Максимальная волатильность в процентах
    PRICE_PRECISION: 2 // Количество знаков после запятой
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
    
    // Пользователь
    userBalance: CONFIG.INITIAL_BALANCE,
    currentBet: 100,
    selectedDirection: null, // 'up' или 'down'
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

// Для отслеживания цен
let priceHistory = [];

// ==================== РЕАЛЬНАЯ ЦЕНА BITCOIN ====================
async function getBitcoinPrice() {
    console.log('🔄 Получение реальной цены Bitcoin...');
    
    // 5 разных API для максимальной надежности
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
        },
        {
            name: 'Kraken',
            url: 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD',
            parser: (data) => parseFloat(data.result.XXBTZUSD.c[0])
        },
        {
            name: 'OKX',
            url: 'https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT',
            parser: (data) => parseFloat(data.data[0]?.last)
        }
    ];

    // Пробуем каждый API по очереди
    for (const api of apis) {
        try {
            console.log(`🔍 Пробуем ${api.name}...`);
            
            // Добавляем случайную задержку между запросами
            await new Promise(resolve => setTimeout(resolve, Math.random() * 300));
            
            // Fetch с таймаутом
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            const response = await fetch(api.url, {
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 BitcoinPredictor/1.0'
                }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                console.log(`❌ ${api.name}: HTTP ${response.status}`);
                continue;
            }
            
            const data = await response.json();
            const price = api.parser(data);
            
            // Проверка что цена реалистичная
            if (price && !isNaN(price) && price > 1000 && price < 200000) {
                console.log(`✅ ${api.name}: $${price.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
                return Math.round(price * 100) / 100; // Округляем до 2 знаков
            } else {
                console.log(`⚠️ ${api.name}: некорректная цена ${price}`);
            }
            
        } catch (error) {
            console.log(`❌ ${api.name} ошибка:`, error.name);
            continue;
        }
    }
    
    // Если ВСЕ API упали - используем последнюю известную цену
    console.log('⚠️ Все API недоступны, использую последнюю известную цену');
    return gameState.currentPrice || CONFIG.FALLBACK_PRICE;
}

// ==================== ВЕРИФИКАЦИЯ И КОНТРОЛЬ КАЧЕСТВА ====================
async function verifyBitcoinPrice(newPrice) {
    // Сохраняем в историю
    priceHistory.push({
        price: newPrice,
        timestamp: Date.now(),
        source: 'main'
    });
    
    // Держим только последние 100 записей
    if (priceHistory.length > 100) {
        priceHistory = priceHistory.slice(-100);
    }
    
    // Проверяем волатильность
    if (priceHistory.length > 10) {
        const recentPrices = priceHistory.slice(-10).map(p => p.price);
        const maxPrice = Math.max(...recentPrices);
        const minPrice = Math.min(...recentPrices);
        const volatility = ((maxPrice - minPrice) / minPrice) * 100;
        
        // Если волатильность больше 5% за 10 записей - подозрительно
        if (volatility > CONFIG.MAX_VOLATILITY) {
            console.warn(`⚠️ Высокая волатильность: ${volatility.toFixed(2)}%`);
            const verifiedPrice = await getSecondaryPrice();
            if (verifiedPrice) {
                return verifiedPrice;
            }
        }
    }
    
    return newPrice;
}

async function getSecondaryPrice() {
    console.log('🔐 Получение цены для верификации...');
    
    // Используем другие API для проверки
    const verificationApis = [
        {
            name: 'Coinbase',
            url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',
            parser: (data) => parseFloat(data.data.amount)
        },
        {
            name: 'Bitfinex',
            url: 'https://api-pub.bitfinex.com/v2/ticker/tBTCUSD',
            parser: (data) => data[6] // last_price
        },
        {
            name: 'Huobi',
            url: 'https://api.huobi.pro/market/detail/merged?symbol=btcusdt',
            parser: (data) => data.tick.close
        }
    ];
    
    const prices = [];
    
    for (const api of verificationApis) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            
            const response = await fetch(api.url, { 
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) continue;
            
            const data = await response.json();
            const price = api.parser(data);
            
            if (price && price > 1000) {
                console.log(`✅ ${api.name}: $${price.toLocaleString()}`);
                prices.push(price);
            }
        } catch (error) {
            continue;
        }
    }
    
    if (prices.length > 0) {
        // Берем медианную цену (чтобы исключить выбросы)
        prices.sort((a, b) => a - b);
        const medianPrice = prices[Math.floor(prices.length / 2)];
        console.log(`✅ Верифицированная медианная цена: $${medianPrice.toLocaleString()}`);
        return medianPrice;
    }
    
    return null;
}

// ==================== ОБНОВЛЕННАЯ ФУНКЦИЯ ОБНОВЛЕНИЯ ЦЕНЫ ====================
async function updatePriceWithVerification() {
    try {
        // 1. Получаем основную цену
        const rawPrice = await getBitcoinPrice();
        
        // 2. Верифицируем
        let finalPrice = rawPrice;
        const verifiedPrice = await verifyBitcoinPrice(rawPrice);
        
        if (verifiedPrice && verifiedPrice !== rawPrice) {
            const diffPercent = Math.abs((verifiedPrice - rawPrice) / rawPrice * 100);
            if (diffPercent > 2) { // Если разница больше 2%
                console.log(`⚠️ Корректирую цену (разница ${diffPercent.toFixed(2)}%): $${rawPrice.toFixed(2)} → $${verifiedPrice.toFixed(2)}`);
                finalPrice = verifiedPrice;
            }
        }
        
        // 3. Сохраняем и обновляем
        const oldPrice = gameState.currentPrice;
        gameState.currentPrice = finalPrice;
        
        // 4. Обновляем отображение
        updatePriceDisplay();
        
        // 5. Логируем изменение
        if (oldPrice > 0) {
            const change = ((finalPrice - oldPrice) / oldPrice * 100);
            console.log(`💰 Цена: $${finalPrice.toLocaleString('en-US', {minimumFractionDigits: 2})} (${change >= 0 ? '+' : ''}${change.toFixed(2)}%)`);
        } else {
            console.log(`💰 Начальная цена: $${finalPrice.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
        }
        
        return finalPrice;
        
    } catch (error) {
        console.error('❌ Критическая ошибка обновления цены:', error);
        
        // Аварийный режим - небольшая коррекция последней цены
        if (gameState.currentPrice === 0) {
            gameState.currentPrice = CONFIG.FALLBACK_PRICE;
        } else {
            // Случайное изменение ±0.5%
            const change = (Math.random() - 0.5) * 0.01;
            gameState.currentPrice = Math.round(gameState.currentPrice * (1 + change) * 100) / 100;
        }
        
        updatePriceDisplay();
        return gameState.currentPrice;
    }
}

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
        
        // Инициализация Telegram Stars
        if (tg.initDataUnsafe?.start_param) {
            const ref = tg.initDataUnsafe.start_param;
            if (ref.startsWith('ref_')) {
                gameState.userBalance += 100; // Бонус за реферала
                showNotification('🎁 +100 Stars за приглашенного друга!');
                updateBalanceDisplay();
            }
        }
    }
}

// ==================== ОТОБРАЖЕНИЕ ЦЕНЫ ====================
function updatePriceDisplay() {
    const priceElement = document.getElementById('current-price');
    const changeElement = document.getElementById('change-amount');
    const changeTimeElement = document.getElementById('change-time');
    
    if (priceElement) {
        priceElement.textContent = `$${gameState.currentPrice.toLocaleString('en-US', {
            minimumFractionDigits: CONFIG.PRICE_PRECISION,
            maximumFractionDigits: CONFIG.PRICE_PRECISION
        })}`;
    }
    
    if (changeElement && gameState.roundStartPrice > 0) {
        const changePercent = ((gameState.currentPrice - gameState.roundStartPrice) / gameState.roundStartPrice * 100);
        const changeText = `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`;
        
        changeElement.textContent = changeText;
        changeElement.style.color = changePercent >= 0 ? '#00ff00' : '#ff0000';
        
        // Обновляем время изменения
        if (changeTimeElement && gameState.roundStartTime > 0) {
            const timePassed = Math.floor((Date.now() - gameState.roundStartTime) / 60000);
            const minutes = Math.max(1, timePassed);
            changeTimeElement.textContent = `за ${minutes} мин`;
        }
    }
}

// ==================== ТАЙМЕР И РАУНДЫ ====================
function startNewRound() {
    gameState.roundNumber++;
    gameState.roundActive = true;
    gameState.selectedDirection = null;
    gameState.userBetAmount = 0;
    gameState.roundStartTime = Date.now();
    
    // Сброс ставок
    gameState.players.forEach(player => player.bets = []);
    
    // Установка времени окончания
    gameState.roundEndTime = Math.floor(Date.now() / 1000) + CONFIG.ROUND_DURATION;
    
    // Получение стартовой цены
    updatePriceWithVerification().then(price => {
        gameState.roundStartPrice = price;
        document.getElementById('round-start-price').textContent = 
            `$${price.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        
        // Включение кнопок ставок
        document.getElementById('bet-up').disabled = false;
        document.getElementById('bet-down').disabled = false;
        
        // Сброс стилей
        document.getElementById('bet-up').style.opacity = '1';
        document.getElementById('bet-down').style.opacity = '1';
        document.getElementById('bet-up').style.border = '';
        document.getElementById('bet-down').style.border = '';
        
        // Обновление отображения
        updateRoundInfo();
        
        showNotification(`🔄 Раунд #${gameState.roundNumber} начат! Ставки открыты.`);
    });
    
    // Симуляция ставок ботов
    simulateBotBets();
}

function updateTimer() {
    const now = Math.floor(Date.now() / 1000);
    const timeLeft = gameState.roundEndTime - now;
    
    if (timeLeft <= 0 && gameState.roundActive) {
        endRound();
        return;
    }
    
    // Обновление таймера
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    const timerElement = document.getElementById('timer');
    
    if (timerElement) {
        timerElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        // Изменение цвета при малом времени
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
    
    // Обновление прогресс-бара
    const progressElement = document.getElementById('progress-fill');
    if (progressElement) {
        const progressPercent = 100 - (timeLeft / CONFIG.ROUND_DURATION * 100);
        progressElement.style.width = `${progressPercent}%`;
    }
    
    // Блокировка ставок за 10 секунд до конца
    if (timeLeft < 10 && !document.getElementById('bet-up').disabled) {
        document.getElementById('bet-up').disabled = true;
        document.getElementById('bet-down').disabled = true;
        showNotification('⏰ Ставки закрыты! Раунд скоро завершится.');
    }
}

async function endRound() {
    gameState.roundActive = false;
    
    // Получение конечной цены
    const endPrice = await updatePriceWithVerification();
    gameState.roundEndPrice = endPrice;
    
    const direction = endPrice > gameState.roundStartPrice ? 'up' : 'down';
    const changePercent = ((endPrice - gameState.roundStartPrice) / gameState.roundStartPrice * 100);
    
    // Расчет результатов
    calculateRoundResults(direction);
    
    // Показ результата
    showRoundResult(direction, changePercent);
    
    // Запуск нового раунда через 5 секунд
    setTimeout(startNewRound, 5000);
}

function updateRoundInfo() {
    document.getElementById('round-number').textContent = gameState.roundNumber;
    
    // Обновление счетчика игроков (симуляция)
    const playerCount = 3 + Math.floor(Math.random() * 7); // 3-10 игроков
    document.getElementById('players-count').textContent = playerCount;
    
    // Обновление призового фонда (симуляция)
    const prizePool = playerCount * 150; // Средняя ставка 150 Stars
    document.getElementById('prize-pool').textContent = `${prizePool}⭐`;
}

// ==================== СТАВКИ ====================
function placeBet(direction) {
    // Проверки
    if (!gameState.roundActive) {
        showNotification('❌ Раунд не активен! Дождитесь начала нового раунда.');
        return;
    }
    
    if (gameState.selectedDirection) {
        showNotification(`❌ Вы уже поставили на ${gameState.selectedDirection === 'up' ? 'ВЫШЕ' : 'НИЖЕ'}!`);
        return;
    }
    
    if (gameState.userBalance < gameState.currentBet) {
        showNotification(`❌ Недостаточно Stars! Нужно ${gameState.currentBet}⭐, есть ${gameState.userBalance}⭐`);
        return;
    }
    
    const timeLeft = gameState.roundEndTime - Math.floor(Date.now() / 1000);
    if (timeLeft < 10) {
        showNotification('⏰ Слишком поздно! Ставки закрыты.');
        return;
    }
    
    // Размещение ставки
    gameState.userBalance -= gameState.currentBet;
    gameState.selectedDirection = direction;
    gameState.userBetAmount = gameState.currentBet;
    gameState.userStats.totalBets++;
    
    // Визуальное подтверждение
    const upBtn = document.getElementById('bet-up');
    const downBtn = document.getElementById('bet-down');
    
    upBtn.style.opacity = direction === 'up' ? '1' : '0.5';
    downBtn.style.opacity = direction === 'down' ? '1' : '0.5';
    
    upBtn.style.border = direction === 'up' ? '3px solid gold' : '';
    downBtn.style.border = direction === 'down' ? '3px solid gold' : '';
    
    upBtn.disabled = true;
    downBtn.disabled = true;
    
    // Обновление отображения
    document.getElementById('user-bet-amount').textContent = `${gameState.currentBet}⭐`;
    updateBalanceDisplay();
    updatePotentialWin();
    
    // Уведомление
    showNotification(`✅ Ставка ${gameState.currentBet}⭐ на ${direction === 'up' ? '📈 ВЫШЕ' : '📉 НИЖЕ'} принята!`);
    
    // Сохранение в историю
    gameState.history.push({
        round: gameState.roundNumber,
        direction: direction,
        amount: gameState.currentBet,
        price: gameState.roundStartPrice,
        timestamp: Date.now(),
        status: 'pending'
    });
}

function updateBetAmount(amount) {
    gameState.currentBet = parseInt(amount);
    
    // Обновление кнопок
    document.querySelectorAll('.amount-btn').forEach(btn => {
        btn.classList.remove('active');
        if (parseInt(btn.dataset.amount) === gameState.currentBet) {
            btn.classList.add('active');
        }
    });
    
    // Обновление слайдера
    document.getElementById('bet-slider').value = gameState.currentBet;
    document.getElementById('current-slider-value').textContent = `${gameState.currentBet}⭐`;
    
    // Обновление потенциального выигрыша
    updatePotentialWin();
}

function updatePotentialWin() {
    if (!gameState.selectedDirection) return;
    
    const odds = gameState.selectedDirection === 'up' ? gameState.odds.up : gameState.odds.down;
    const potentialWin = Math.floor(gameState.currentBet * odds);
    
    document.getElementById('potential-win').textContent = `${potentialWin}⭐`;
}

function updateOdds() {
    // Симуляция изменения коэффициентов на основе "спроса"
    const upBets = Math.floor(Math.random() * 100) + 50;
    const downBets = Math.floor(Math.random() * 100) + 50;
    
    // Расчет коэффициентов (чем больше ставок, тем меньше коэффициент)
    gameState.odds.up = 1.5 + (100 / (upBets + 50));
    gameState.odds.down = 1.5 + (100 / (downBets + 50));
    
    // Округление
    gameState.odds.up = Math.round(gameState.odds.up * 10) / 10;
    gameState.odds.down = Math.round(gameState.odds.down * 10) / 10;
    
    // Обновление отображения
    document.getElementById('odds-up').textContent = `${gameState.odds.up}x`;
    document.getElementById('odds-down').textContent = `${gameState.odds.down}x`;
}

// ==================== РАСЧЕТ РЕЗУЛЬТАТОВ ====================
function calculateRoundResults(winningDirection) {
    // Все ставки (пользователь + боты)
    const allBets = [];
    
    // Добавляем ставку пользователя
    if (gameState.selectedDirection) {
        allBets.push({
            userId: 'user',
            direction: gameState.selectedDirection,
            amount: gameState.userBetAmount
        });
    }
    
    // Добавляем ставки ботов
    gameState.players.forEach(player => {
        player.bets.forEach(bet => {
            allBets.push({
                userId: player.id,
                direction: bet.direction,
                amount: bet.amount
            });
        });
    });
    
    // Разделение ставок по направлениям
    const upBets = allBets.filter(bet => bet.direction === 'up');
    const downBets = allBets.filter(bet => bet.direction === 'down');
    
    const winningBets = winningDirection === 'up' ? upBets : downBets;
    const losingBets = winningDirection === 'up' ? downBets : upBets;
    
    // Расчет общего банка и комиссии
    const totalPool = allBets.reduce((sum, bet) => sum + bet.amount, 0);
    const commission = totalPool * CONFIG.COMMISSION;
    const prizePool = totalPool - commission;
    
    // Распределение призового фонда среди победителей
    if (winningBets.length > 0) {
        const totalWinningAmount = winningBets.reduce((sum, bet) => sum + bet.amount, 0);
        
        winningBets.forEach(bet => {
            const share = bet.amount / totalWinningAmount;
            const winAmount = Math.floor(prizePool * share);
            
            // Начисление выигрыша пользователю
            if (bet.userId === 'user') {
                gameState.userBalance += winAmount;
                
                const lastBetIndex = gameState.history.length - 1;
                const lastBet = gameState.history[lastBetIndex];
                
                if (winAmount > bet.amount) {
                    // Выигрыш
                    gameState.userStats.wins++;
                    gameState.userStats.winStreak++;
                    gameState.userStats.profit += (winAmount - bet.amount);
                    gameState.userStats.rating += 10;
                    
                    if (gameState.userStats.winStreak > gameState.userStats.bestWinStreak) {
                        gameState.userStats.bestWinStreak = gameState.userStats.winStreak;
                    }
                    
                    // Обновляем историю
                    if (lastBet) {
                        lastBet.result = 'win';
                        lastBet.winAmount = winAmount;
                        lastBet.status = 'completed';
                    }
                } else {
                    // Проигрыш
                    gameState.userStats.losses++;
                    gameState.userStats.winStreak = 0;
                    gameState.userStats.profit -= (bet.amount - winAmount);
                    gameState.userStats.rating -= 5;
                    
                    // Обновляем историю
                    if (lastBet) {
                        lastBet.result = 'loss';
                        lastBet.winAmount = winAmount;
                        lastBet.status = 'completed';
                    }
                }
            }
            
            // Начисление ботатам (симуляция)
            if (bet.userId.startsWith('bot')) {
                const player = gameState.players.find(p => p.id === bet.userId);
                if (player) {
                    player.balance += winAmount;
                }
            }
        });
    }
    
    // Обновление статистики ботов (симуляция)
    gameState.players.forEach(player => {
        player.balance = Math.max(100, player.balance + (Math.random() - 0.5) * 500);
    });
}

// ==================== ПОКАЗ РЕЗУЛЬТАТОВ ====================
function showRoundResult(winningDirection, changePercent) {
    const resultModal = document.getElementById('result-modal');
    const userWon = gameState.selectedDirection === winningDirection;
    
    // Заполнение данных
    document.getElementById('result-start-price').textContent = 
        `$${gameState.roundStartPrice.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
    document.getElementById('result-end-price').textContent = 
        `$${gameState.roundEndPrice.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
    
    const changeElement = document.getElementById('result-change');
    changeElement.textContent = `Изменение: ${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`;
    changeElement.style.color = changePercent >= 0 ? '#00ff00' : '#ff0000';
    
    // Информация о ставке пользователя
    const userResultElement = document.getElementById('user-result');
    if (gameState.selectedDirection) {
        userResultElement.innerHTML = `
            Ваша ставка: <span class="bet-amount">${gameState.userBetAmount}⭐</span> 
            на <span class="bet-direction">${gameState.selectedDirection === 'up' ? '📈 ВЫШЕ' : '📉 НИЖЕ'}</span>
        `;
    } else {
        userResultElement.textContent = 'Вы не делали ставку в этом раунде';
    }
    
    // Сообщение о результате
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
    
    // Показ модального окна
    resultModal.style.display = 'flex';
    
    // Автоматическое закрытие через 10 секунд
    setTimeout(() => {
        if (resultModal.style.display === 'flex') {
            closeModal('result-modal');
        }
    }, 10000);
}

// ==================== СИМУЛЯЦИЯ БОТОВ ====================
function simulateBotBets() {
    gameState.players.forEach(player => {
        const shouldBet = Math.random() > 0.3; // 70% шанс что бот сделает ставку
        
        if (shouldBet) {
            const direction = Math.random() > 0.5 ? 'up' : 'down';
            const amount = Math.floor(Math.random() * 500) + 50; // 50-550 Stars
            
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
    document.getElementById('balance').textContent = `${gameState.userBalance}⭐`;
}

function showNotification(message, type = 'info') {
    const notification = document.getElementById('notification');
    
    // Цвет в зависимости от типа
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
    
    // Автоматическое скрытие
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
    const recentHistory = gameState.history.slice(-10).reverse(); // Последние 10 ставок
    
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
    
    // Создание списка лидеров (пользователь + боты)
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
    
    // Сортировка по балансу
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
    
    // Инициализация Telegram
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
    
    // Запуск первого раунда
    startNewRound();
    
    console.log('✅ Игра успешно запущена!');
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
            
            showNotification(`🛒 Покупка ${stars} Stars... (в Telegram будет открыто окно оплаты)`);
            
            // Симуляция покупки для теста
            setTimeout(() => {
                gameState.userBalance += stars;
                updateBalanceDisplay();
                showNotification(`✅ Куплено ${stars} Stars! Новый баланс: ${gameState.userBalance}⭐`, 'success');
            }, 1000);
            
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
    
    // Обновление статистики при изменении
    document.getElementById('rating').textContent = gameState.userStats.rating;
    document.getElementById('level').textContent = Math.floor(gameState.userStats.wins / 10) + 1;
}

// ==================== ЗАПУСК ====================
document.addEventListener('DOMContentLoaded', initGame);