const express = require('express');
const cors = require('cors');
const YahooFinance = require('yahoo-finance2').default;

const app = express();
const yahooFinance = new YahooFinance();

app.use(cors());
app.use(express.static(process.cwd()));

app.get('/', (req, res) => {
    res.sendFile(process.cwd() + '/index.html');
});

const SETHD_UNIVERSE = [
    'AEONTS','AMATA','AP','BA','BAM','BBL','HMPRO','JMT','KBANK','KKP',
    'KTB','KTC','LH','M','MEGA','PRM','PTT','PTTEP','QH','RATCH','RCL',
    'SCB','SIRI','SPALI','TCAP','TISCO','TLI','TOA','TTB','WHA'
];

app.get('/api/stocks', async (req, res) => {
    try {
        const results = await Promise.all(
            SETHD_UNIVERSE.map(async (symbol) => {
                try {
                    const q = await yahooFinance.quote(`${symbol}.BK`);

                    return {
                        symbol,
                        name: q.longName || q.shortName || symbol,
                        price: q.regularMarketPrice ?? null,
                        previousClose: q.regularMarketPreviousClose ?? null,
                        change: q.regularMarketChange ?? null,
                        changePct: q.regularMarketChangePercent ?? null,
                        dividendRate: q.dividendRate ?? null,
                        dividendYield: q.dividendYield ?? null,
                        marketCap: q.marketCap ?? null,
                        volume: q.regularMarketVolume ?? null,
                        marketTime: q.regularMarketTime ?? null,
                        sector: q.sector || 'Unknown',
                        industry: q.industry || 'Unknown'
                    };
                } catch (error) {
                    return {
                        symbol,
                        name: symbol,
                        price: null,
                        previousClose: null,
                        change: null,
                        changePct: null,
                        dividendRate: null,
                        dividendYield: null,
                        marketCap: null,
                        volume: null,
                        marketTime: null,
                        sector: 'Unknown',
                        industry: 'Unknown',
                        error: error.message
                    };
                }
            })
        );

        res.json({
            source: 'Yahoo Finance',
            market: 'SET',
            dataType: 'Delayed Market Data',
            updatedAt: new Date().toISOString(),
            count: results.length,
            stocks: results
        });

    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

const PORT = 3001;

app.listen(PORT, () => {
    console.log(`Yahoo API server running on port ${PORT}`);
});