// GroupMe Joke Bot — Cloudflare Worker (no external libs)

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // Simple healthcheck
    if (req.method === "GET" && url.pathname === "/") {
      return new Response("jokebot alive");
    }

    // Manual test endpoint: visit /test?msg=Hello to ensure posting works
    if (req.method === "GET" && url.pathname === "/test") {
      const msg = url.searchParams.get("msg") || "Test OK";
      ctx.waitUntil(postToGroupMe(env.BOT_ID, msg));
      return new Response("sent");
    }

    // Webhook from GroupMe
    if (req.method === "POST" && url.pathname === "/webhook") {
      let body = {};
      try {
        body = await req.json();
      } catch (_) {
        console.log("invalid json");
        return new Response("ok");
      }

      // Avoid loops: only react to real users (GroupMe sends 'bot'/'system' too)
      if (body.sender_type !== "user") return new Response("ok");

      const name = (body.name || "there").trim();
      const text = (body.text || "").trim();
      const lower = text.toLowerCase();

      // Triggers we understand
      let reply = null;

      // Typical phrasings
      if (
        /\bjoke please\b/.test(lower) ||
        /\btell me a joke\b/.test(lower) ||
        /^joke\b/.test(lower)
      ) {
        reply = await getRandomJoke();
      } else {
        // "joke about X" / "do you have a joke about X"
        const m = lower.match(
          /(?:joke(?:\s+please)?\s+about|do you have a joke about)\s+(.+)/
        );
        if (m) {
          const term = m[1].replace(/[?.!]+$/, "").slice(0, 80);
          reply = await searchJoke(term);
        }
      }

      if (reply) {
        const message = `Hey ${name} — ${reply}`;
        // Respond to GroupMe asynchronously so we ack the webhook immediately
        ctx.waitUntil(postToGroupMe(env.BOT_ID, message));
      } else {
        console.log("no trigger matched", { text });
      }

      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  },

  async scheduled(_event, env, _ctx) {
    // Hourly drop
    const joke = await getRandomJoke();
    await postToGroupMe(env.BOT_ID, `Hourly joke time! ${joke}`);
  }
};

// ---- helpers ----

async function postToGroupMe(botId, text, attachments) {
  if (!botId) {
    console.log("BOT_ID missing");
    return;
  }
  try {
    const res = await fetch("https://api.groupme.com/v3/bots/post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bot_id: botId, text, attachments })
    });
    console.log("postToGroupMe", res.status);
  } catch (err) {
    console.log("postToGroupMe error", String(err));
  }
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function getRandomJoke() {
  // Free, public JSON endpoint (set Accept header)
  const r = await fetch("https://icanhazdadjoke.com/", {
    headers: {
      Accept: "application/json",
      "User-Agent": "groupme-jokebot (workers.dev)"
    }
  });
  const d = await r.json().catch(() => ({}));
  return d.joke || "Hmm… no joke right now 😅";
}

async function searchJoke(term) {
  const r = await fetch(
    `https://icanhazdadjoke.com/search?limit=30&term=${encodeURIComponent(
      term
    )}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "groupme-jokebot (workers.dev)"
      }
    }
  );
  const d = await r.json().catch(() => ({}));
  if (Array.isArray(d.results) && d.results.length) {
    return pick(d.results).joke;
  }
  return `I don’t have one about “${term}”… but here’s one: ${await getRandomJoke()}`;
}
