import { SETHD_UNIVERSE, THAI_DESCRIPTIONS } from "./stock-data.js";

const CACHE_KEY = "fundamentals-latest";
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_SECONDS = 90 * 24 * 60 * 60;
const MAX_CONCURRENCY = 3;

const USER_AGENT = "Mozilla/5.0";

async function getYahooSession() {
  const sessionResponse = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": USER_AGENT },
    redirect: "manual"
  });

  let setCookies = [];

  if (typeof sessionResponse.headers.getSetCookie === "function") {
    setCookies = sessionResponse.headers.getSetCookie();
  } else {
    const cookie = sessionResponse.headers.get("set-cookie");
    if (cookie) setCookies = [cookie];
  }

  const cookies = setCookies
    .map(cookie => cookie.split(";")[0])
    .filter(cookie => cookie.includes("="));

  if (cookies.length === 0) {
    throw new Error("Yahoo session cookie unavailable");
  }

  const cookieHeader = cookies.join("; ");

  const crumbResponse = await fetch(
    "https://query1.finance.yahoo.com/v1/test/getcrumb",
    {
      headers: {
        "User-Agent": USER_AGENT,
        "Cookie": cookieHeader
      }
    }
  );

  const crumb = (await crumbResponse.text()).trim();

  if (
    !crumbResponse.ok ||
    !crumb ||
    crumb.startsWith("<")
  ) {
    throw new Error(
      `Yahoo crumb request failed: HTTP ${crumbResponse.status}`
    );
  }

  return { cookieHeader, crumb };
}

async function fetchFundamental(symbol, session) {
  const url = new URL(
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}.BK`
  );

  url.searchParams.set(
    "modules",
    "assetProfile,summaryProfile,financialData,defaultKeyStatistics,summaryDetail"
  );

  url.searchParams.set("crumb", session.crumb);

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": USER_AGENT,
      "Cookie": session.cookieHeader
    }
  });

  if (!response.ok) {
    throw new Error(`Yahoo HTTP ${response.status}`);
  }

  const json = await response.json();
  const result = json.quoteSummary?.result?.[0];

  if (!result) {
    throw new Error(
      json.quoteSummary?.error?.description ||
      "Yahoo returned no data"
    );
  }

  const summary = result.summaryDetail || {};
  const profile = result.assetProfile || {};
  const summaryProfile = result.summaryProfile || {};

  return {
    symbol,
    marketCap: summary.marketCap?.raw ?? null,
    pe: summary.trailingPE?.raw ?? null,
    payoutRatio: summary.payoutRatio?.raw ?? null,
    sector: profile.sector || summaryProfile.sector || "Unknown",
    industry: profile.industry || summaryProfile.industry || "Unknown",
    description:
      THAI_DESCRIPTIONS[symbol] ||
      profile.longBusinessSummary ||
      summaryProfile.longBusinessSummary ||
      null
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
        console.error(
          `Fundamentals error for ${items[index]}:`,
          error.message
        );

        results[index] = {
          symbol: items[index],
          marketCap: null,
          pe: null,
          payoutRatio: null,
          sector: "Unknown",
          industry: "Unknown",
          description: THAI_DESCRIPTIONS[items[index]] || null,
          dataError: true
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

function isValidCache(record) {
  return (
    record &&
    Number.isFinite(record.checkedAt) &&
    Array.isArray(record.stocks) &&
    record.stocks.length === SETHD_UNIVERSE.length
  );
}

async function readCache(env) {
  try {
    if (!env.STOCK_CACHE) return null;

    const raw = await env.STOCK_CACHE.get(CACHE_KEY);

    if (!raw) return null;

    const record = JSON.parse(raw);

    return isValidCache(record) ? record : null;
  } catch (error) {
    console.error("Fundamentals KV read error:", error.message);
    return null;
  }
}

async function saveCache(env, record) {
  try {
    if (!env.STOCK_CACHE) return;

    await env.STOCK_CACHE.put(
      CACHE_KEY,
      JSON.stringify(record),
      { expirationTtl: CACHE_TTL_SECONDS }
    );
  } catch (error) {
    console.error("Fundamentals KV write error:", error.message);
  }
}

export async function handleFundamentalsRequest(env) {
  const cachedRecord = await readCache(env);

  // Return cached Fundamentals when still fresh
  if (
    cachedRecord &&
    Date.now() - cachedRecord.checkedAt < REFRESH_INTERVAL_MS
  ) {
    return Response.json({
      count: cachedRecord.stocks.length,
      stocks: cachedRecord.stocks,
      checkedAt: cachedRecord.checkedAt,
      cached: true,
      source: "Yahoo Finance"
    });
  }

  try {
    // Create one Yahoo session for all 30 stocks
    const session = await getYahooSession();

    const freshStocks = await mapWithConcurrency(
      SETHD_UNIVERSE,
      MAX_CONCURRENCY,
      symbol => fetchFundamental(symbol, session)
    );

    // Preserve previous data if an individual stock fails
    const previousBySymbol = new Map(
      (cachedRecord?.stocks || []).map(stock => [
        stock.symbol,
        stock
      ])
    );

    const stocks = freshStocks.map(stock => {
      if (!stock.dataError) return stock;

      const previous = previousBySymbol.get(stock.symbol);

      if (previous) {
        return {
          ...previous,
          dataError: true,
          usingPreviousCache: true
        };
      }

      return stock;
    });

    const successfulCount = stocks.filter(
      stock => !stock.dataError
    ).length;

    if (successfulCount === 0 && !cachedRecord) {
      throw new Error("Yahoo returned no usable Fundamentals data");
    }

    const record = {
      checkedAt: Date.now(),
      stocks
    };

    await saveCache(env, record);

    return Response.json({
      count: stocks.length,
      successfulCount,
      failedCount: stocks.length - successfulCount,
      stocks,
      checkedAt: record.checkedAt,
      cached: false,
      source: "Yahoo Finance"
    });

  } catch (error) {
    console.error("Fundamentals API error:", error.message);

    // Keep previous valid data if Yahoo is unavailable
    if (cachedRecord) {
      return Response.json({
        count: cachedRecord.stocks.length,
        stocks: cachedRecord.stocks,
        checkedAt: cachedRecord.checkedAt,
        cached: true,
        cacheFallback: true,
        source: "Yahoo Finance"
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
