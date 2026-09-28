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

let profile = null;

try {
    profile = await yahooFinance.quoteSummary(`${symbol}.BK`, {
    modules: ['assetProfile', 'summaryProfile']
});
} catch (profileError) {
    console.error(symbol, 'Profile Error:', profileError.message);
}
    console.log(symbol, 'Profile Sector:', profile?.assetProfile?.sector);

const xdResult = await getUpcomingXD(symbol);

const nextXDDate =
    typeof xdResult === 'string' ? xdResult : null;

const xdDataError =
    xdResult && typeof xdResult === 'object' && xdResult.error === true;
                    
                    return {
                        symbol,
                        name: q.longName || q.shortName || symbol,
                        price: q.regularMarketPrice ?? null,
                        previousClose: q.regularMarketPreviousClose ?? null,
                        change: q.regularMarketChange ?? null,
                        changePct: q.regularMarketChangePercent ?? null,
                        dividendRate: q.dividendRate ?? null,
                        dividendYield: q.dividendYield ?? null,
                        nextXDDate: nextXDDate,
                        xdDataError: xdDataError,
                        marketCap: q.marketCap ?? null,
                        volume: q.regularMarketVolume ?? null,
                        marketTime: q.regularMarketTime ?? null,
                        sector: profile?.assetProfile?.sector ||
        profile?.summaryProfile?.sector ||
        'Unknown',

                        industry: profile?.assetProfile?.industry ||
        profile?.summaryProfile?.industry ||
        'Unknown',

                        description: profile?.assetProfile?.longBusinessSummary || null
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

        function parseThaiDate(text) {
    const match = text.trim().match(
        /^(\d{1,2})\s+(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s+(\d{4})$/
    );

    if (!match) {
        return null;
    }

    const months = {
        'ม.ค.': 1,
        'ก.พ.': 2,
        'มี.ค.': 3,
        'เม.ย.': 4,
        'พ.ค.': 5,
        'มิ.ย.': 6,
        'ก.ค.': 7,
        'ส.ค.': 8,
        'ก.ย.': 9,
        'ต.ค.': 10,
        'พ.ย.': 11,
        'ธ.ค.': 12
    };

    const day = Number(match[1]);
    const month = months[match[2]];
    const year = Number(match[3]) - 543;

    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}


async function getUpcomingXD(symbol) {
    try {
        const url = `https://www.efin.finance/th/symbol/${symbol.toLowerCase()}/rights-benefits/xd`;

        const response = await fetch(url);

        if (!response.ok) {
    throw new Error(`eFIN HTTP ${response.status}`);
}

        const html = await response.text();

        // ดึงข้อมูลแต่ละแถวของตาราง
        const rows = [
            ...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)
        ].map(match => match[1]);
        console.log(symbol, 'eFIN rows:', rows.length);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const futureDates = [];

        for (const row of rows) {

            // ดึงแต่ละช่อง <td>
            const cells = [
                ...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)
            ].map(match =>
                match[1]
                    .replace(/<[^>]*>/g, ' ')
                    .replace(/&nbsp;/g, ' ')
                    .replace(/&amp;/g, '&')
                    .replace(/\s+/g, ' ')
                    .trim()
            );

            if (cells.length === 0) {
                continue;
            }

            // ช่องแรกของตารางคือ X-Date
            const dateCells = cells
    .map(cell => parseThaiDate(cell))
    .filter(date => date !== null);

const xdDate = dateCells[0] ?? null;

if (!xdDate) {
    continue;
}

            const date = new Date(`${xdDate}T00:00:00`);

            // เอาเฉพาะ XD ที่ยังไม่ผ่าน
            if (date >= today) {
                futureDates.push(xdDate);
            }
        }

        // เรียงจากวันที่ใกล้ที่สุดไปไกลที่สุด
        futureDates.sort();

        const nextXD = futureDates[0] ?? null;

        console.log(symbol, 'Next XD:', nextXD);

        return nextXD;

    } catch (error) {
    console.error(symbol, 'eFIN XD error:', error.message);
    return {
        error: true,
        message: error.message
    };
}
}

const PORT = 3001;

app.listen(PORT, () => {
    console.log(`Yahoo API server running on port ${PORT}`);
});