/**
 * OpenWeather proxy for the public portfolio demo.
 *
 * Required secret: OPENWEATHER_API_KEY
 * Endpoint: GET /weather?zip=84010
 *
 * The browser never receives the provider key. This endpoint is intentionally
 * limited to one operation and one provider, rather than acting as a generic proxy.
 */
const ALLOWED_ORIGIN = "https://mikekelley89.github.io";

function jsonResponse(body, status, origin = ALLOWED_ORIGIN, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}

function errorResponse(message, status, origin, extraHeaders = {}) {
  return jsonResponse({ error: { message } }, status, origin, extraHeaders);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000)
  });

  if (!response.ok) {
    // Do not relay provider response bodies or credentials to the browser.
    const error = new Error("Upstream provider request failed");
    error.status = response.status;
    throw error;
  }

  return response.json();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (origin && origin !== ALLOWED_ORIGIN) {
      return errorResponse("This origin is not allowed.", 403, ALLOWED_ORIGIN);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin"
        }
      });
    }

    if (request.method !== "GET") {
      return errorResponse("Use GET for this endpoint.", 405, ALLOWED_ORIGIN, {
        Allow: "GET, OPTIONS"
      });
    }

    if (url.pathname !== "/weather") {
      return errorResponse("Endpoint not found.", 404, ALLOWED_ORIGIN);
    }

    const zip = (url.searchParams.get("zip") || "").trim();
    if (!/^\d{5}$/.test(zip)) {
      return errorResponse("Enter a valid five-digit US ZIP code.", 400, ALLOWED_ORIGIN);
    }

    if (!env.OPENWEATHER_API_KEY) {
      return errorResponse("Weather service is not configured.", 503, ALLOWED_ORIGIN);
    }

    // Approximate per-IP rate limit. Cloudflare documents that this binding
    // is local to each Cloudflare location and is not a strict global quota.
    const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
    if (env.WEATHER_RATE_LIMITER) {
      const { success } = await env.WEATHER_RATE_LIMITER.limit({ key: clientIp });
      if (!success) {
        return errorResponse("Too many requests. Please wait a minute and try again.", 429, ALLOWED_ORIGIN, {
          "Retry-After": "60"
        });
      }
    }

    try {
      const geocodeUrl = new URL("https://api.openweathermap.org/geo/1.0/zip");
      geocodeUrl.searchParams.set("zip", zip + ",US");
      geocodeUrl.searchParams.set("appid", env.OPENWEATHER_API_KEY);
      const location = await fetchJson(geocodeUrl);

      if (!Number.isFinite(location.lat) || !Number.isFinite(location.lon)) {
        return errorResponse("That ZIP code did not return a usable location.", 404, ALLOWED_ORIGIN);
      }

      const weatherUrl = new URL("https://api.openweathermap.org/data/3.0/onecall");
      weatherUrl.searchParams.set("lat", String(location.lat));
      weatherUrl.searchParams.set("lon", String(location.lon));
      weatherUrl.searchParams.set("exclude", "minutely,hourly");
      weatherUrl.searchParams.set("units", "imperial");
      weatherUrl.searchParams.set("appid", env.OPENWEATHER_API_KEY);
      const weather = await fetchJson(weatherUrl);

      return jsonResponse({
        location: {
          name: typeof location.name === "string" ? location.name : "Selected location",
          country: typeof location.country === "string" ? location.country : "US"
        },
        weather: {
          current: weather.current || {},
          daily: Array.isArray(weather.daily) ? weather.daily : [],
          alerts: Array.isArray(weather.alerts) ? weather.alerts : []
        }
      }, 200, ALLOWED_ORIGIN);
    } catch (error) {
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        return errorResponse("The weather provider took too long to respond. Try again.", 504, ALLOWED_ORIGIN);
      }

      if (error.status === 404) {
        return errorResponse("No location was found for that ZIP code.", 404, ALLOWED_ORIGIN);
      }

      if (error.status === 401 || error.status === 403) {
        return errorResponse("The weather service rejected its credentials or access plan.", 502, ALLOWED_ORIGIN);
      }

      if (error.status === 429) {
        return errorResponse("The weather provider rate limit was reached. Try again later.", 503, ALLOWED_ORIGIN);
      }

      return errorResponse("The weather service is temporarily unavailable. Try again later.", 502, ALLOWED_ORIGIN);
    }
  }
};
