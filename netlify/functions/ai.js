/**
 * Netlify Serverless Function: AI Proxy
 * Acts as a secure, CORS-free server-to-server gateway between the frontend
 * and the local LM Studio Ngrok tunnel (https://strangely-disarray-diary.ngrok-free.dev).
 * 
 * This enables team members in other countries (e.g. USA) to connect seamlessly
 * without triggering Ngrok browser warning interstitials or CORS preflight issues.
 */

const DEFAULT_NGROK_URL = "https://strangely-disarray-diary.ngrok-free.dev";

exports.handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, ngrok-skip-browser-warning",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json"
  };

  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: JSON.stringify({ status: "OK" }) };
  }

  // Determine target endpoint (use query param, body param, or default)
  let targetEndpoint = DEFAULT_NGROK_URL;
  if (event.queryStringParameters && event.queryStringParameters.endpoint) {
    targetEndpoint = event.queryStringParameters.endpoint;
  }

  targetEndpoint = targetEndpoint.replace(/\/+$/, "");

  try {
    // --- GET Request: Ping & Retrieve Available Models ---
    if (event.httpMethod === "GET") {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      try {
        const upstreamRes = await fetch(`${targetEndpoint}/v1/models`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "true",
            "User-Agent": "LegacyAIProxy/1.0"
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (upstreamRes.ok) {
          const data = await upstreamRes.json();
          const models = data.data ? data.data.map(m => m.id) : ["local-model"];
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              ok: true,
              models: models,
              activeModel: models[0] || "local-model",
              endpoint: targetEndpoint,
              via: "netlify-ai-proxy"
            })
          };
        } else {
          const errText = await upstreamRes.text();
          return {
            statusCode: 502,
            headers,
            body: JSON.stringify({
              ok: false,
              error: `LM Studio returned status ${upstreamRes.status}: ${errText.substring(0, 150)}`
            })
          };
        }
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        return {
          statusCode: 504,
          headers,
          body: JSON.stringify({
            ok: false,
            error: `Could not reach LM Studio tunnel at ${targetEndpoint}. Please verify Kevin's computer is online and running LM Studio + ngrok.`
          })
        };
      }
    }

    // --- POST Request: Forward Chat Completion ---
    if (event.httpMethod === "POST") {
      let body = {};
      try {
        body = JSON.parse(event.body || "{}");
      } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) };
      }

      if (body.endpoint) {
        targetEndpoint = body.endpoint.replace(/\/+$/, "");
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout for LLM generation

      try {
        const upstreamRes = await fetch(`${targetEndpoint}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "true",
            "User-Agent": "LegacyAIProxy/1.0"
          },
          body: JSON.stringify({
            model: body.model || "local-model",
            messages: body.messages || [],
            temperature: body.temperature || 0.7,
            max_tokens: body.max_tokens || 1200,
            stream: false
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        const data = await upstreamRes.json();
        return {
          statusCode: upstreamRes.status,
          headers,
          body: JSON.stringify(data)
        };
      } catch (postErr) {
        clearTimeout(timeoutId);
        return {
          statusCode: 504,
          headers,
          body: JSON.stringify({
            error: `LM Studio generation failed or timed out: ${postErr.message}`
          })
        };
      }
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || "Internal Server Error" })
    };
  }
};
