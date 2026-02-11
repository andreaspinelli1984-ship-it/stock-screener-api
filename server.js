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
        finance: ['JPM', 'BAC', 'GS', 'MS', 'WFC'],
        healthcare: ['JNJ', 'UNH', 'PFE', 'ABBV', 'TMO'],
        energy: ['XOM', 'CVX', 'COP', 'SLB'],
        consumer: ['AMZN', 'TSLA', 'NKE', 'SBUX', 'MCD']
    },
    growth: {
        ai: ['PLTR', 'AI', 'SOUN', 'BBAI'],
        cyber: ['CRWD', 'PANW', 'ZS', 'FTNT', 'S'],
        fintech: ['SQ', 'PYPL', 'UPST', 'AFRM', 'SOFI'],
        saas: ['SNOW', 'DDOG', 'NET', 'MDB', 'DOCN'],
        cleantech: ['ENPH', 'SEDG', 'RUN', 'FSLR'],
        biotech: ['MRNA', 'BNTX', 'NVAX', 'CRSP']
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
        
        // Limita a 5 simboli per non superare rate limit
        symbols = symbols.slice(0, 5);
        
        // Ottieni dati per ogni simbolo (con delay per rispettare rate limits)
        const results = [];
        
        for (let i = 0; i < symbols.length; i++) {
            try {
                // Delay tra richieste per evitare rate limiting
                if (i > 0) {
                    await new Promise(resolve => setTimeout(resolve, 12000)); // 12 sec tra chiamate (5 calls/min limit)
                }
                
                const quoteResponse = await axios.get(BASE_URL, {
                    params: {
                        function: 'GLOBAL_QUOTE',
                        symbol: symbols[i],
                        apikey: API_KEY
                    }
                });
                
                const quote = quoteResponse.data['Global Quote'];
                
                if (quote) {
                    const price = parseFloat(quote['05. price']);
                    const change = parseFloat(quote['09. change']);
                    const changePercent = parseFloat(quote['10. change percent'].replace('%', ''));
                    
                    // Calcola target e stop loss (esempio: +25% target, -10% stop)
                    const target = price * 1.25;
                    const stopLoss = price * 0.90;
                    
                    results.push({
                        ticker: symbols[i],
                        name: symbols[i], // In produzione, otterremmo il nome dalla company overview
                        price: price,
                        change: change,
                        changePercent: changePercent,
                        volume: quote['06. volume'],
                        entry: price,
                        target: target,
                        stopLoss: stopLoss,
                        riskReward: '1:2.5'
                    });
                }
            } catch (error) {
                console.error(`Error fetching ${symbols[i]}:`, error.message);
            }
        }
        
        res.json({
            success: true,
            stocks: results,
            note: 'Demo con Alpha Vantage free tier - max 5 simboli per query'
        });
        
    } catch (error) {
        console.error('Error in screening:', error);
        res.status(500).json({ error: 'Screening failed' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Stock Screener API is running' });
});

app.listen(PORT, () => {
    console.log(`🚀 Stock Screener API running on port ${PORT}`);
    console.log(`📊 Alpha Vantage API connected`);
});
