import { SETHD_UNIVERSE, THAI_DESCRIPTIONS } from "./stock-data.js";

const CACHE_KEY = "stocks-latest";
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_SECONDS = 90 * 24 * 60 * 60;
const MAX_CONCURRENCY = 5;

function getBangkokToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseThaiDate(value) {
  const months = {
    "ม.ค.": 1, "ก.พ.": 2, "มี.ค.": 3, "เม.ย.": 4,
    "พ.ค.": 5, "มิ.ย.": 6, "ก.ค.": 7, "ส.ค.": 8,
    "ก.ย.": 9, "ต.ค.": 10, "พ.ย.": 11, "ธ.ค.": 12
  };

  const match = value.match(
    /(\d{1,2})\s+(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s+(\d{4})/
  );

  if (!match) return null;

  const day = Number(match[1]);
  const month = months[match[2]];
  const year = Number(match[3]) - 543;

  if (!month || year < 1900) return null;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function stripHtml(value) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .trim();
}

async function getUpcomingXD(symbol) {
  try {
    const response = await fetch(
      `https://www.efin.finance/th/symbol/${symbol.toLowerCase()}/rights-benefits/xd`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0"
        }
      }
    );

    if (!response.ok) {
      throw new Error(`eFIN HTTP ${response.status}`);
    }

    const html = await response.text();
    const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
    const today = getBangkokToday();
    const futureDates = [];

    for (const row of rows) {
      const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];

      if (!cells.length) continue;

      const dateText = stripHtml(cells[0][1]);
      const date = parseThaiDate(dateText);

      if (date && date > today) {
        futureDates.push(date);
      }
    }

    futureDates.sort();
    return futureDates[0] ?? null;
  } catch (error) {
    console.error(symbol, "eFIN XD error:", error.message);
    return { error: true, message: error.message };
  }
}

async function fetchStock(symbol) {
  const now = Math.floor(Date.now() / 1000);
  // ดึงข้อมูลย้อนหลัง 400 วัน เพื่อคำนวณเงินปันผลย้อนหลัง 12 เดือน
  const period1 = now - 400 * 24 * 60 * 60;

  const yahooUrl =
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.BK` +
    `?period1=${period1}&period2=${now}&interval=1d&events=div`;

  const yahooResponse = await fetch(yahooUrl, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  const xdResult = null;

  if (!yahooResponse.ok) {
    throw new Error(`Yahoo Finance HTTP ${yahooResponse.status}`);
  }

  const result = await yahooResponse.json();
  const chart = result.chart;

  if (chart?.error || !chart?.result?.length) {
    throw new Error("No Yahoo Finance data available");
  }

  const data = chart.result[0];
  const meta = data.meta;
  const quotes = data.indicators?.quote?.[0];

  if (!quotes?.close || !data.timestamp) {
    throw new Error("Invalid Yahoo Finance data");
  }

  const validQuotes = quotes.close
    .map((close, index) => ({
      close,
      volume: quotes.volume?.[index] ?? null,
      timestamp: data.timestamp[index]
    }))
    .filter(item =>
      Number.isFinite(item.close) &&
      Number.isFinite(item.timestamp)
    );

  if (!validQuotes.length) {
    throw new Error("No valid stock prices");
  }

  const latest = validQuotes[validQuotes.length - 1];
  const previous = validQuotes.length > 1
    ? validQuotes[validQuotes.length - 2].close
    : null;

  const price = latest.close;

  // รวมเงินปันผลที่จ่ายจริงในช่วง 365 วันย้อนหลัง
  const dividendEvents = Object.values(data.events?.dividends ?? {});
  const trailing12MonthsDPS = dividendEvents
    .filter(event =>
      Number.isFinite(event.date) &&
      Number.isFinite(event.amount) &&
      event.date > now - 365 * 24 * 60 * 60 &&
      event.date <= now
    )
    .reduce((total, event) => total + event.amount, 0);

  const dividendRate = dividendEvents.length > 0
    ? Number(trailing12MonthsDPS.toFixed(4))
    : null;

  const dividendYield = dividendRate !== null && price > 0
    ? Number(((dividendRate / price) * 100).toFixed(4))
    : null;

  const previousClose = previous;
  const change = previousClose !== null
    ? price - previousClose
    : null;
  const changePct = previousClose !== null && previousClose !== 0
    ? (change / previousClose) * 100
    : null;

  const xdDataError =
    xdResult !== null &&
    typeof xdResult === "object" &&
    xdResult.error === true;

  return {
    symbol,
    name: meta.longName || meta.shortName || symbol,
    price,
    previousClose,
    change,
    changePct,
    dividendRate,
    dividendYield,
    nextXDDate: typeof xdResult === "string" ? xdResult : null,
    xdDataError,
    marketCap: null,
    pe: null,
    payoutRatio: null,
    volume: latest.volume,
    marketTime: new Date(latest.timestamp * 1000).toISOString(),
    sector: "Unknown",
    industry: "Unknown",
    description: THAI_DESCRIPTIONS[symbol] || null
  };
}

async function mapWithConcurrency(items, limit, callback) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;

      try {
        results[index] = await callback(items[index]);
      } catch (error) {
        console.error(items[index], "Stock fetch error:", error.message);

        results[index] = {
          symbol: items[index],
          name: items[index],
          price: null,
          previousClose: null,
          change: null,
          changePct: null,
          dividendRate: null,
          dividendYield: null,
          marketCap: null,
          volume: null,
          marketTime: null,
          sector: "Unknown",
          industry: "Unknown",
          error: error.message
        };
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(limit, items.length) },
      () => worker()
    )
  );

  return results;
}

function isValidCacheRecord(record) {
  return (
    record &&
    Number.isFinite(record.checkedAt) &&
    record.data &&
    record.data.count === SETHD_UNIVERSE.length &&
    Array.isArray(record.data.stocks) &&
    record.data.stocks.length === SETHD_UNIVERSE.length
  );
}

export async function handleStocksRequest(env) {
  let cachedRecord = null;

  try {
    if (env.STOCK_CACHE) {
      const cachedRaw = await env.STOCK_CACHE.get(CACHE_KEY);

      if (cachedRaw) {
        const parsed = JSON.parse(cachedRaw);

        if (isValidCacheRecord(parsed)) {
          cachedRecord = parsed;
        }
      }
    }
  } catch (error) {
    console.error("Stocks KV read error:", error.message);
  }

  if (
    cachedRecord &&
    Date.now() - cachedRecord.checkedAt < REFRESH_INTERVAL_MS
  ) {
    return Response.json({
      ...cachedRecord.data,
      cached: true
    });
  }

  try {
    const stocks = await mapWithConcurrency(
      SETHD_UNIVERSE,
      MAX_CONCURRENCY,
      fetchStock
    );

    const validCount = stocks.filter(
      stock => Number.isFinite(stock.price)
    ).length;

    if (
      stocks.length !== SETHD_UNIVERSE.length ||
      validCount !== SETHD_UNIVERSE.length
    ) {
      throw new Error(
        `Incomplete stock data: ${validCount}/${SETHD_UNIVERSE.length}`
      );
    }

    const freshData = {
      source: "Yahoo Finance",
      market: "SET",
      dataType: "Delayed Market Data",
      updatedAt: new Date().toISOString(),
      count: stocks.length,
      stocks
    };

    try {
      if (env.STOCK_CACHE) {
        await env.STOCK_CACHE.put(
          CACHE_KEY,
          JSON.stringify({
            data: freshData,
            checkedAt: Date.now()
          }),
          { expirationTtl: CACHE_TTL_SECONDS }
        );
      }
    } catch (error) {
      console.error("Stocks KV write error:", error.message);
    }

    return Response.json({
      ...freshData,
      cached: false
    });
  } catch (error) {
    console.error("Stocks fetch error:", error.message);

    if (cachedRecord) {
      return Response.json({
        ...cachedRecord.data,
        cached: true,
        cacheFallback: true
      });
    }

    return Response.json(
      {
        error: true,
        message: error.message
      },
      { status: 502 }
    );
  }
}

const XD_CACHE_KEY = "xd-latest";
const XD_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function handleXDRequest(env) {
  let cachedRecord = null;

  try {
    if (env.STOCK_CACHE) {
      const cachedRaw = await env.STOCK_CACHE.get(XD_CACHE_KEY);

      if (cachedRaw) {
        const parsed = JSON.parse(cachedRaw);

        if (
          parsed &&
          Number.isFinite(parsed.checkedAt) &&
          parsed.data &&
          Array.isArray(parsed.data.stocks) &&
          parsed.data.stocks.length === SETHD_UNIVERSE.length
        ) {
          cachedRecord = parsed;
        }
      }
    }
  } catch (error) {
    console.error("XD KV read error:", error.message);
  }

  if (
    cachedRecord &&
    Date.now() - cachedRecord.checkedAt < XD_REFRESH_INTERVAL_MS
  ) {
    return Response.json({
      ...cachedRecord.data,
      cached: true
    });
  }

  try {
    const results = await mapWithConcurrency(
      SETHD_UNIVERSE,
      MAX_CONCURRENCY,
      async symbol => {
        const result = await getUpcomingXD(symbol);

        return {
          symbol,
          nextXDDate: typeof result === "string" ? result : null,
          xdDataError:
            result !== null &&
            typeof result === "object" &&
            result.error === true
        };
      }
    );

    const freshData = {
      source: "eFIN",
      updatedAt: new Date().toISOString(),
      count: results.length,
      stocks: results
    };

    if (env.STOCK_CACHE) {
      await env.STOCK_CACHE.put(
        XD_CACHE_KEY,
        JSON.stringify({
          data: freshData,
          checkedAt: Date.now()
        }),
        { expirationTtl: CACHE_TTL_SECONDS }
      );
    }

    return Response.json({
      ...freshData,
      cached: false
    });
  } catch (error) {
    console.error("XD fetch error:", error.message);

    if (cachedRecord) {
      return Response.json({
        ...cachedRecord.data,
        cached: true,
        cacheFallback: true
      });
    }

    return Response.json(
      {
        error: true,
        message: error.message
      },
      { status: 502 }
    );
  }
}