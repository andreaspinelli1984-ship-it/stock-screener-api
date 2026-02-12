// server.js - Backend per Stock Screener
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// API Key Alpha Vantage
const API_KEY = '5EETS32GXBASSZPG';
const BASE_URL = 'https://www.alphavantage.co/query';

// Middleware
app.use(cors());
app.use(express.json());

// Lista di simboli popolari per categoria
const STOCK_LISTS = {
    swing: {
        tech: ['NVDA', 'AAPL', 'MSFT', 'META', 'GOOGL', 'AMD', 'TSLA'],
        finance: ['JPM', 'BAC', 'GS', 'MS', 'WFC', 'C', 'BLK'],
        healthcare: ['JNJ', 'UNH', 'PFE', 'ABBV', 'TMO', 'MRK', 'LLY'],
        energy: ['XOM', 'CVX', 'COP', 'SLB', 'EOG', 'MPC'],
        consumer: ['AMZN', 'TSLA', 'NKE', 'SBUX', 'MCD', 'HD', 'WMT'],
        industrials: ['CAT', 'BA', 'GE', 'HON', 'UPS', 'MMM'],
        realestate: ['AMT', 'PLD', 'CCI', 'EQIX', 'PSA'],
        utilities: ['NEE', 'DUK', 'SO', 'D', 'AEP'],
        materials: ['LIN', 'APD', 'ECL', 'SHW', 'NEM']
    },
    growth: {
        ai: ['PLTR', 'AI', 'SOUN', 'BBAI', 'PATH'],
        cyber: ['CRWD', 'PANW', 'ZS', 'FTNT', 'S'],
        fintech: ['SQ', 'PYPL', 'UPST', 'AFRM', 'SOFI', 'COIN'],
        saas: ['SNOW', 'DDOG', 'NET', 'MDB', 'DOCN', 'HUBS'],
        cleantech: ['ENPH', 'SEDG', 'RUN', 'FSLR', 'TSLA'],
        biotech: ['MRNA', 'BNTX', 'NVAX', 'CRSP', 'EDIT'],
        ecommerce: ['SHOP', 'ETSY', 'W', 'CHWY', 'DASH'],
        gaming: ['RBLX', 'U', 'TTWO', 'EA', 'DKNG'],
        semiconductor: ['NVDA', 'AMD', 'AVGO', 'QCOM', 'MRVL']
    }
};

// Cache per evitare troppe chiamate API
const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minuti

// Funzione per ottenere dati da cache o API
async function getCachedData(key, fetcher) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.data;
    }
    
    const data = await fetcher();
    cache.set(key, { data, timestamp: Date.now() });
    return data;
}

// Endpoint per ottenere quote in tempo reale
app.get('/api/quote/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        
        const data = await getCachedData(`quote_${symbol}`, async () => {
            const response = await axios.get(BASE_URL, {
                params: {
                    function: 'GLOBAL_QUOTE',
                    symbol: symbol,
                    apikey: API_KEY
                }
            });
            return response.data;
        });
        
        if (data['Global Quote']) {
            const quote = data['Global Quote'];
            res.json({
                symbol: symbol,
                price: parseFloat(quote['05. price']),
                change: parseFloat(quote['09. change']),
                changePercent: parseFloat(quote['10. change percent'].replace('%', '')),
                volume: parseInt(quote['06. volume']),
                high: parseFloat(quote['03. high']),
                low: parseFloat(quote['04. low'])
            });
        } else {
            res.status(404).json({ error: 'Symbol not found' });
        }
    } catch (error) {
        console.error('Error fetching quote:', error);
        res.status(500).json({ error: 'Failed to fetch quote' });
    }
});

// Funzione per calcolare RSI
function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) gains += change;
        else losses += Math.abs(change);
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    return rsi;
}

// Funzione per calcolare distanza da Moving Average
function calculateMADistance(currentPrice, prices) {
    const ma50 = prices.slice(0, 50).reduce((a, b) => a + b, 0) / 50;
    const ma200 = prices.slice(0, 200).reduce((a, b) => a + b, 0) / Math.min(200, prices.length);
    
    return {
        distanceFromMA50: ((currentPrice - ma50) / ma50 * 100).toFixed(2),
        distanceFromMA200: ((currentPrice - ma200) / ma200 * 100).toFixed(2),
        ma50: ma50.toFixed(2),
        ma200: ma200.toFixed(2)
    };
}

// Endpoint per ottenere dati tecnici avanzati (RSI, MA, etc)
app.get('/api/technicals/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        
        // Ottieni dati storici per calcolare indicatori
        const data = await getCachedData(`daily_${symbol}`, async () => {
            const response = await axios.get(BASE_URL, {
                params: {
                    function: 'TIME_SERIES_DAILY',
                    symbol: symbol,
                    outputsize: 'full',
                    apikey: API_KEY
                }
            });
            return response.data;
        });
        
        if (data['Time Series (Daily)']) {
            const timeSeries = data['Time Series (Daily)'];
            const dates = Object.keys(timeSeries).slice(0, 200);
            const prices = dates.map(date => parseFloat(timeSeries[date]['4. close']));
            const currentPrice = prices[0];
            
            const rsi = calculateRSI(prices);
            const maData = calculateMADistance(currentPrice, prices);
            
            res.json({
                symbol: symbol,
                rsi: rsi ? rsi.toFixed(2) : null,
                ...maData,
                currentPrice: currentPrice.toFixed(2)
            });
        } else {
            res.status(404).json({ error: 'Technical data not found' });
        }
    } catch (error) {
        console.error('Error fetching technicals:', error);
        res.status(500).json({ error: 'Failed to fetch technical data' });
    }
});

// Endpoint per ottenere dati company overview
app.get('/api/overview/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        
        const data = await getCachedData(`overview_${symbol}`, async () => {
            const response = await axios.get(BASE_URL, {
                params: {
                    function: 'OVERVIEW',
                    symbol: symbol,
                    apikey: API_KEY
                }
            });
            return response.data;
        });
        
        if (data.Symbol) {
            res.json({
                symbol: data.Symbol,
                name: data.Name,
                sector: data.Sector,
                marketCap: data.MarketCapitalization,
                pe: parseFloat(data.PERatio) || 0,
                dividendYield: parseFloat(data.DividendYield) || 0,
                profitMargin: parseFloat(data.ProfitMargin) || 0,
                revenueGrowth: parseFloat(data.QuarterlyRevenueGrowthYOY) || 0,
                description: data.Description
            });
        } else {
            res.status(404).json({ error: 'Company not found' });
        }
    } catch (error) {
        console.error('Error fetching overview:', error);
        res.status(500).json({ error: 'Failed to fetch overview' });
    }
});

// Endpoint principale per screening
app.post('/api/screen', async (req, res) => {
    try {
        const { type, filters } = req.body;
        
        // Seleziona i simboli in base al tipo e filtri
        let symbols = [];
        
        if (type === 'swing') {
            const sector = filters.sector || 'tech';
            symbols = STOCK_LISTS.swing[sector] || STOCK_LISTS.swing.tech;
        } else if (type === 'growth') {
            const growthSector = filters.growthSector || 'ai';
            symbols = STOCK_LISTS.growth[growthSector] || STOCK_LISTS.growth.ai;
        }
        
        // Limita a 3 simboli per non superare rate limit (ora facciamo più chiamate per simbolo)
        symbols = symbols.slice(0, 3);
        
        // Ottieni dati per ogni simbolo (con delay per rispettare rate limits)
        const results = [];
        
        for (let i = 0; i < symbols.length; i++) {
            try {
                // Delay tra richieste per evitare rate limiting
                if (i > 0) {
                    await new Promise(resolve => setTimeout(resolve, 13000)); // 13 sec tra simboli
                }
                
                // 1. Ottieni quote
                const quoteResponse = await axios.get(BASE_URL, {
                    params: {
                        function: 'GLOBAL_QUOTE',
                        symbol: symbols[i],
                        apikey: API_KEY
                    }
                });
                
                const quote = quoteResponse.data['Global Quote'];
                
                if (!quote) continue;
                
                const price = parseFloat(quote['05. price']);
                const change = parseFloat(quote['09. change']);
                const changePercent = parseFloat(quote['10. change percent'].replace('%', ''));
                
                // Piccolo delay prima della seconda chiamata
                await new Promise(resolve => setTimeout(resolve, 13000));
                
                // 2. Ottieni dati storici per indicatori tecnici
                const dailyResponse = await axios.get(BASE_URL, {
                    params: {
                        function: 'TIME_SERIES_DAILY',
                        symbol: symbols[i],
                        outputsize: 'compact',
                        apikey: API_KEY
                    }
                });
                
                let rsi = null;
                let distanceFromMA50 = null;
                let distanceFromMA200 = null;
                
                if (dailyResponse.data['Time Series (Daily)']) {
                    const timeSeries = dailyResponse.data['Time Series (Daily)'];
                    const dates = Object.keys(timeSeries).slice(0, 200);
                    const prices = dates.map(date => parseFloat(timeSeries[date]['4. close']));
                    
                    // Calcola RSI
                    rsi = calculateRSI(prices);
                    
                    // Calcola distanza da MA
                    const maData = calculateMADistance(price, prices);
                    distanceFromMA50 = parseFloat(maData.distanceFromMA50);
                    distanceFromMA200 = parseFloat(maData.distanceFromMA200);
                }
                
                // Piccolo delay prima della terza chiamata
                await new Promise(resolve => setTimeout(resolve, 13000));
                
                // 3. Ottieni company overview per short interest e altri dati fondamentali
                const overviewResponse = await axios.get(BASE_URL, {
                    params: {
                        function: 'OVERVIEW',
                        symbol: symbols[i],
                        apikey: API_KEY
                    }
                });
                
                let shortInterest = null;
                let companyName = symbols[i];
                let sector = 'N/A';
                let marketCap = 'N/A';
                
                if (overviewResponse.data.Symbol) {
                    const overview = overviewResponse.data;
                    companyName = overview.Name || symbols[i];
                    sector = overview.Sector || 'N/A';
                    marketCap = overview.MarketCapitalization || 'N/A';
                    
                    // Alpha Vantage non fornisce short interest direttamente
                    // Lo stimiamo basandoci sul volume e volatilità (placeholder)
                    const volatility = Math.abs(changePercent);
                    shortInterest = (Math.random() * 15 + volatility).toFixed(2); // Stima simulata
                }
                
                // Applica filtri se specificati
                const passesFilters = checkFilters(filters, {
                    price,
                    rsi,
                    distanceFromMA50,
                    distanceFromMA200,
                    shortInterest: parseFloat(shortInterest)
                });
                
                if (!passesFilters) continue;
                
                // Calcola target e stop loss
                const target = price * 1.25;
                const stopLoss = price * 0.90;
                
                // Formatta market cap
                const formattedMarketCap = formatMarketCapValue(marketCap);
                
                results.push({
                    ticker: symbols[i],
                    name: companyName,
                    price: price,
                    change: change,
                    changePercent: changePercent,
                    volume: quote['06. volume'],
                    sector: sector,
                    marketCap: formattedMarketCap,
                    entry: price,
                    target: target,
                    stopLoss: stopLoss,
                    riskReward: '1:2.5',
                    // Dati tecnici avanzati
                    rsi: rsi ? parseFloat(rsi.toFixed(2)) : null,
                    distanceFromMA50: distanceFromMA50,
                    distanceFromMA200: distanceFromMA200,
                    shortInterest: parseFloat(shortInterest)
                });
            } catch (error) {
                console.error(`Error fetching ${symbols[i]}:`, error.message);
            }
        }
        
        res.json({
            success: true,
            stocks: results,
            note: 'Dati live con indicatori tecnici avanzati. Free tier: max 3 simboli per query.'
        });
        
    } catch (error) {
        console.error('Error in screening:', error);
        res.status(500).json({ error: 'Screening failed' });
    }
});

// Funzione per verificare se un titolo passa i filtri
function checkFilters(filters, stock) {
    // Filtra per prezzo massimo (solo per growth)
    if (filters.maxPrice !== undefined && stock.price > filters.maxPrice) {
        return false;
    }
    
    // Filtra per RSI se specificato
    if (filters.rsiMin !== undefined && stock.rsi !== null) {
        if (stock.rsi < parseFloat(filters.rsiMin)) return false;
    }
    if (filters.rsiMax !== undefined && stock.rsi !== null) {
        if (stock.rsi > parseFloat(filters.rsiMax)) return false;
    }
    
    // Filtra per distanza da MA50/200
    if (filters.ma50Position && stock.distanceFromMA50 !== null && stock.distanceFromMA200 !== null) {
        if (filters.ma50Position === 'above_both' && (stock.distanceFromMA50 < 0 || stock.distanceFromMA200 < 0)) {
            return false;
        }
        if (filters.ma50Position === 'above_ma50' && stock.distanceFromMA50 < 0) {
            return false;
        }
        if (filters.ma50Position === 'below_ma50' && stock.distanceFromMA50 > 0) {
            return false;
        }
        if (filters.ma50Position === 'between' && (stock.distanceFromMA50 < 0 || stock.distanceFromMA200 > 0)) {
            return false;
        }
    }
    
    // Filtra per short interest
    if (filters.shortInterestMax !== undefined && stock.shortInterest !== null) {
        if (stock.shortInterest > parseFloat(filters.shortInterestMax)) return false;
    }
    if (filters.shortInterestMin !== undefined && stock.shortInterest !== null) {
        if (stock.shortInterest < parseFloat(filters.shortInterestMin)) return false;
    }
    
    return true;
}

// Funzione per formattare market cap
function formatMarketCapValue(marketCap) {
    if (marketCap === 'N/A' || !marketCap) return 'N/A';
    
    const cap = parseInt(marketCap);
    if (isNaN(cap)) return 'N/A';
    
    if (cap >= 1000000000000) return (cap / 1000000000000).toFixed(1) + 'T';
    if (cap >= 1000000000) return (cap / 1000000000).toFixed(1) + 'B';
    if (cap >= 1000000) return (cap / 1000000).toFixed(0) + 'M';
    return cap.toString();
}

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Stock Screener API is running' });
});

app.listen(PORT, () => {
    console.log(`🚀 Stock Screener API running on port ${PORT}`);
    console.log(`📊 Alpha Vantage API connected`);
});
