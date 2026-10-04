import { handleStocksRequest, handleXDRequest } from "./stocks-api.js";
import { handleFundamentalsRequest } from "./fundamentals-api.js";
const CACHE_KEY = "sethd-index-latest";
const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const CACHE_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

function isValidData(data) {
  return (
    data &&
    data.symbol === "^SETHD.BK" &&
    Number.isFinite(data.price) &&
    typeof data.date === "string" &&
    Number.isFinite(Date.parse(data.date))
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/stocks") {
      const origin = request.headers.get("Origin");
      let allowedOrigin = null;

      try {
        const originUrl = new URL(origin);
        if (
          originUrl.protocol === "https:" &&
          (
            originUrl.hostname === "cryp2b.pages.dev" ||
            originUrl.hostname.endsWith(".app.github.dev")
          )
        ) {
          allowedOrigin = origin;
        }
      } catch {}

      const corsHeaders = {
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin"
      };

      if (allowedOrigin) {
        corsHeaders["Access-Control-Allow-Origin"] = allowedOrigin;
      }

      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders
        });
      }

      const response = await handleStocksRequest(env);
      const headers = new Headers(response.headers);

      for (const [key, value] of Object.entries(corsHeaders)) {
        headers.set(key, value);
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    if (url.pathname === "/api/xd") {
      const origin = request.headers.get("Origin");
      let allowedOrigin = null;

      try {
        const originUrl = new URL(origin);
        if (
          originUrl.protocol === "https:" &&
          (
            originUrl.hostname === "cryp2b.pages.dev" ||
            originUrl.hostname.endsWith(".app.github.dev")
          )
        ) {
          allowedOrigin = origin;
        }
      } catch {}

      const corsHeaders = {
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin"
      };

      if (allowedOrigin) {
        corsHeaders["Access-Control-Allow-Origin"] = allowedOrigin;
      }

      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders
        });
      }

      if (request.method !== "GET") {
        return Response.json(
          { error: true, message: "Method not allowed" },
          { status: 405, headers: corsHeaders }
        );
      }

      const response = await handleXDRequest(env);
      const headers = new Headers(response.headers);

      for (const [key, value] of Object.entries(corsHeaders)) {
        headers.set(key, value);
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    if (url.pathname === "/api/fundamentals") {
      const origin = request.headers.get("Origin");
      let allowedOrigin = null;

      try {
        const originUrl = new URL(origin);
        if (
          originUrl.protocol === "https:" &&
          (
            originUrl.hostname === "cryp2b.pages.dev" ||
            originUrl.hostname.endsWith(".app.github.dev")
          )
        ) {
          allowedOrigin = origin;
        }
      } catch {}

      const corsHeaders = {
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin"
      };

      if (allowedOrigin) {
        corsHeaders["Access-Control-Allow-Origin"] = allowedOrigin;
      }

      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders
        });
      }

      if (request.method !== "GET") {
        return Response.json(
          { error: true, message: "Method not allowed" },
          { status: 405, headers: corsHeaders }
        );
      }

      const response = await handleFundamentalsRequest(env);
      const headers = new Headers(response.headers);

      for (const [key, value] of Object.entries(corsHeaders)) {
        headers.set(key, value);
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }


    if (url.pathname === "/api/sethd-index") {
      const origin = request.headers.get("Origin");
      let allowedOrigin = null;

      try {
        const originUrl = new URL(origin);
        if (
          originUrl.protocol === "https:" &&
          (
            originUrl.hostname === "cryp2b.pages.dev" ||
            originUrl.hostname.endsWith(".app.github.dev")
          )
        ) {
          allowedOrigin = origin;
        }
      } catch {}

      const corsHeaders = {
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin"
      };

      if (allowedOrigin) {
        corsHeaders["Access-Control-Allow-Origin"] = allowedOrigin;
      }

      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders
        });
      }

      if (request.method !== "GET") {
        return jsonResponse(
          { error: true, message: "Method not allowed" },
          { status: 405, headers: corsHeaders }
        );
      }

      const jsonResponse = (data, init = {}) =>
        Response.json(data, {
          ...init,
          headers: {
            ...corsHeaders,
            ...(init.headers || {})
          }
        });

      let cachedRecord = null;

      // 1. Read the latest data from KV
      try {
        if (env.STOCK_CACHE) {
          const cachedRaw = await env.STOCK_CACHE.get(CACHE_KEY);

          if (cachedRaw) {
            const parsed = JSON.parse(cachedRaw);

            if (
              isValidData(parsed.data) &&
              Number.isFinite(parsed.checkedAt)
            ) {
              cachedRecord = parsed;
            }
          }
        }
      } catch (error) {
        console.error("KV read error:", error.message);
      }

      // 2. Return cached data if it was checked within 15 minutes
      if (
  cachedRecord &&
  Date.now() - cachedRecord.checkedAt < REFRESH_INTERVAL_MS
) {
        return jsonResponse({
          ...cachedRecord.data,
          cached: true
        });
      }

      try {
        // 3. Fetch the latest daily data from Yahoo Finance
        const now = Math.floor(Date.now() / 1000);
        const period1 = now - 14 * 24 * 60 * 60;

        const yahooUrl =
          `https://query1.finance.yahoo.com/v8/finance/chart/%5ESETHD.BK?period1=${period1}&period2=${now}&interval=1d`;

        const response = await fetch(yahooUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0"
          }
        });

        if (!response.ok) {
          throw new Error(`Yahoo Finance HTTP ${response.status}`);
        }

        const result = await response.json();
        const chart = result.chart;

        if (chart?.error || !chart?.result?.length) {
          throw new Error("No SET HD Index data available");
        }

        const data = chart.result[0];
        const quotes = data.indicators?.quote?.[0];
        const meta = data.meta;

        if (!quotes?.close || !data.timestamp) {
          throw new Error("Invalid Yahoo Finance data");
        }

        const validQuotes = quotes.close
          .map((close, index) => ({
            close,
            timestamp: data.timestamp[index]
          }))
          .filter(item =>
            Number.isFinite(item.close) &&
            Number.isFinite(item.timestamp)
          );

        if (validQuotes.length === 0) {
          throw new Error("No valid index prices");
        }

        const latest = validQuotes[validQuotes.length - 1];

        const previous =
          validQuotes.length > 1
            ? validQuotes[validQuotes.length - 2].close
            : meta.chartPreviousClose;

        const price = latest.close;
        const previousClose = previous ?? null;

        const change =
          previousClose !== null
            ? price - previousClose
            : null;

        const changePct =
          previousClose !== null && previousClose !== 0
            ? (change / previousClose) * 100
            : null;

        const freshData = {
          symbol: "^SETHD.BK",
          name: "SET High Dividend Index",
          price,
          previousClose,
          change,
          changePct,
          date: new Date(latest.timestamp * 1000).toISOString(),
          source: "Yahoo Finance",
          dataType: "Daily Close"
        };

        // 4. Never replace newer cached data with older Yahoo data
        if (
          cachedRecord &&
          Date.parse(cachedRecord.data.date) > Date.parse(freshData.date)
        ) {
          const updatedRecord = {
            data: cachedRecord.data,
            checkedAt: Date.now()
          };

          try {
            await env.STOCK_CACHE.put(
              CACHE_KEY,
              JSON.stringify(updatedRecord),
              { expirationTtl: CACHE_TTL_SECONDS }
            );
          } catch (error) {
            console.error("KV update error:", error.message);
          }

          return jsonResponse({
            ...cachedRecord.data,
            cached: true
          });
        }

        // 5. Save valid Yahoo data to KV
        try {
          await env.STOCK_CACHE.put(
            CACHE_KEY,
            JSON.stringify({
              data: freshData,
              checkedAt: Date.now()
            }),
            { expirationTtl: CACHE_TTL_SECONDS }
          );
        } catch (error) {
          console.error("KV write error:", error.message);
        }

        return jsonResponse({
          ...freshData,
          cached: false
        });

      } catch (error) {
        console.error("SETHD fetch error:", error.message);

        // 6. If Yahoo fails, return the latest valid cached data
        if (cachedRecord) {
          return jsonResponse({
            ...cachedRecord.data,
            cached: true,
            cacheFallback: true
          });
        }

        return jsonResponse(
          {
            error: true,
            message: error.message
          },
          { status: 500 }
        );
      }
    }

    // Default response
    return Response.json({
      status: "ok",
      service: "cryp2b-api",
      message: "Cloudflare Worker is running"
    });
  }
};