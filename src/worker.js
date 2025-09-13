// GroupMe Joke Bot — Cloudflare Worker

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // 0) Healthcheck
    if (req.method === "GET" && url.pathname === "/") {
      return new Response("jokebot alive");
    }

    // 1) Manual post test (proves BOT_ID + outbound post)
    // Visit: /test?msg=Hello
    if (req.method === "GET" && url.pathname === "/test") {
      const msg = url.searchParams.get("msg") || "Test OK";
      ctx.waitUntil(postToGroupMe(env.BOT_ID, msg));
      return new Response("sent");
    }

    // 2) Debug: show what we receive (so you can POST from a web client)
    // POST JSON to /debug: {"sender_type":"user","name":"Alberto","text":"joke please"}
    if (req.method === "POST" && url.pathname === "/debug") {
      const body = await safeJson(req);
      console.log("DEBUG /debug payload", body);
      const reply = await handleMessage(body);
      if (reply) ctx.waitUntil(postToGroupMe(env.BOT_ID, reply));
      return json({ ok: true, replied: !!reply });
    }

    // 3) Real webhook from GroupMe (callback_url points here)
    if (req.method === "POST" && url.pathname === "/webhook") {
      const body = await safeJson(req);
      console.log("incoming webhook", { sender_type: body?.sender_type, text: body?.text });

      // Avoid loops: ignore bot/system events
      if (body?.sender_type !== "user") return new Response("ok");

      const reply = await handleMessage(body);
      if (reply) ctx.waitUntil(postToGroupMe(env.BOT_ID, reply));
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  },

  async scheduled(_evt, env) {
    const joke = await getRandomJoke();
    await postToGroupMe(env.BOT_ID, `Hourly joke time! ${joke}`);
  }
};

// ---------- helpers ----------

async function handleMessage(body) {
  const name = (body?.name || "there").trim();
  const text = (body?.text || "").trim();
  const lower = text.toLowerCase();

  let joke = null;
  if (/\btell me a joke\b/.test(lower) || /\bjoke please\b/.test(lower) || /^joke\b/.test(lower)) {
    joke = await getRandomJoke();
  } else {
    const m = lower.match(/(?:joke(?:\s+please)?\s+about|do you have a joke about)\s+(.+)/);
    if (m) {
      const term = m[1].replace(/[?.!]+$/, "").slice(0, 80);
      joke = await searchJoke(term);
    }
  }

  if (!joke) return null;
  return `Hey ${name} — ${joke}`;
}

async function postToGroupMe(botId, text, attachments) {
  if (!botId) { console.log("BOT_ID missing"); return; }
  try {
    const res = await fetch("https://api.groupme.com/v3/bots/post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bot_id: botId, text, attachments })
    });
    console.log("postToGroupMe status", res.status);
  } catch (err) {
    console.log("postToGroupMe error", String(err));
  }
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function getRandomJoke() {
  const r = await fetch("https://icanhazdadjoke.com/", {
    headers: { Accept: "application/json", "User-Agent": "groupme-jokebot (workers.dev)" }
  });
  const d = await r.json().catch(() => ({}));
  return d.joke || "Hmm… no joke right now 😅";
}

async function searchJoke(term) {
  const r = await fetch(`https://icanhazdadjoke.com/search?limit=30&term=${encodeURIComponent(term)}`, {
    headers: { Accept: "application/json", "User-Agent": "groupme-jokebot (workers.dev)" }
  });
  const d = await r.json().catch(() => ({}));
  if (Array.isArray(d.results) && d.results.length) return pick(d.results).joke;
  return `I don’t have one about “${term}”… but here’s one: ${await getRandomJoke()}`;
}

async function safeJson(req) {
  try { return await req.json(); } catch { return {}; }
}
function json(x) { return new Response(JSON.stringify(x), { headers: { "Content-Type": "application/json" } }); }
