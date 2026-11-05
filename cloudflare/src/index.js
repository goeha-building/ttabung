const json = (value, status, origin, env) => {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim());
  if (origin && allowed.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "86400");
  }
  return new Response(status === 204 ? null : JSON.stringify(value), { status, headers });
};

const fail = (message, status, origin, env) => json({ error: message }, status, origin, env);

function equalSecret(candidate, expected) {
  const encoder = new TextEncoder();
  const a = encoder.encode(String(candidate));
  const b = encoder.encode(String(expected));
  if (a.length > 256 || b.length > 256) return false;
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) difference |= (a[i] || 0) ^ (b[i] || 0);
  return difference === 0;
}

async function hashIp(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown-client";
  const bytes = new TextEncoder().encode(ip);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function allowRate(db, table, ipHash, periodSeconds, limit) {
  // Table names are fixed at call sites; user input is only ever bound as a value.
  const bucket = Math.floor(Date.now() / (periodSeconds * 1000)) * periodSeconds;
  const row = await db.prepare(`
    INSERT INTO ${table} (ip_hash, window_start, attempts)
    VALUES (?, ?, 1)
    ON CONFLICT(ip_hash) DO UPDATE SET
      attempts = CASE WHEN window_start = excluded.window_start THEN attempts + 1 ELSE 1 END,
      window_start = excluded.window_start
    RETURNING attempts
  `).bind(ipHash, bucket).first();
  return Number(row?.attempts || 0) <= limit;
}

function validateFish(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 32) : "";
  const owner = typeof input.owner === "string" ? input.owner.trim().slice(0, 32) : "";
  const introduction = typeof input.introduction === "string" ? input.introduction.trim().slice(0, 120) : "";
  if (!name || !owner) return null;

  const ranges = {
    snout: [0, 0.8, 0.35], mouth: [0.35, 0.8, 0.54], length: [1.5, 2.8, 2.4],
    body: [0.6, 1.25, 0.9], tail: [0.45, 1.2, 1], folds: [0, 8, 3], foldLength: [0.1, 0.55, 0.2],
    eyeX: [0.2, 1.2, 1], eyeY: [-0.45, 0.55, 0.03], scaleSize: [0.7, 1.3, 1], gillX: [0.2, 0.8, 0.6],
  };
  const design = {};
  for (const [key, [min, max, fallback]] of Object.entries(ranges)) {
    const value = input[key] === undefined ? fallback : Number(input[key]);
    if (!Number.isFinite(value) || value < min || value > max) return null;
    design[key] = key === "folds" ? Math.round(value) : value;
  }
  const eyeStyles = new Set(["circle", "star", "line", "x", "caret", "square", "angry"]);
  design.eyeStyle = eyeStyles.has(input.eyeStyle) ? input.eyeStyle : "circle";
  return { ...design, name, owner, introduction };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim());
    if (origin && !allowed.includes(origin)) return fail("Origin is not allowed.", 403, "", env);
    if (request.method === "OPTIONS") return json({}, 204, origin, env);

    try {
      if (url.pathname === "/api/fish" && request.method === "GET") {
        const result = await env.DB.prepare(
          "SELECT id, name, owner, introduction, fish_data, created_at FROM fish ORDER BY created_at DESC LIMIT 500",
        ).all();
        const fish = (result.results || []).map((row) => ({
          ...JSON.parse(row.fish_data), id: row.id, name: row.name, owner: row.owner,
          introduction: row.introduction, createdAt: row.created_at,
        }));
        return json({ fish }, 200, origin, env);
      }

      if (url.pathname === "/api/fish" && request.method === "POST") {
        const length = Number(request.headers.get("Content-Length") || 0);
        if (length > 16000) return fail("요청 내용이 너무 큽니다.", 413, origin, env);
        const text = await request.text();
        if (text.length > 16000) return fail("요청 내용이 너무 큽니다.", 413, origin, env);
        let input;
        try { input = JSON.parse(text); } catch { return fail("올바른 JSON이 아닙니다.", 400, origin, env); }
        const fish = validateFish(input);
        if (!fish) return fail("물고기 정보가 올바르지 않습니다.", 400, origin, env);
        const ipHash = await hashIp(request);
        if (!await allowRate(env.DB, "submission_attempts", ipHash, 3600, 8)) {
          return fail("한 시간에 저장할 수 있는 붕어 수를 넘었습니다.", 429, origin, env);
        }
        const id = crypto.randomUUID();
        const createdAt = Math.floor(Date.now() / 1000);
        const design = { ...fish };
        delete design.name; delete design.owner; delete design.introduction;
        await env.DB.prepare(
          "INSERT INTO fish (id, name, owner, introduction, fish_data, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).bind(id, fish.name, fish.owner, fish.introduction, JSON.stringify(design), createdAt).run();
        return json({ fish: { ...design, id, name: fish.name, owner: fish.owner, introduction: fish.introduction, createdAt } }, 201, origin, env);
      }

      const match = url.pathname.match(/^\/api\/fish\/([0-9a-f-]{36})$/i);
      if (match && request.method === "DELETE") {
        if (!env.ADMIN_PASSWORD) return fail("서버 관리자 비밀번호가 설정되지 않았습니다.", 503, origin, env);
        const length = Number(request.headers.get("Content-Length") || 0);
        if (length > 2048) return fail("요청 내용이 너무 큽니다.", 413, origin, env);
        let input;
        try { input = await request.json(); } catch { return fail("비밀번호를 입력해 주세요.", 400, origin, env); }
        const ipHash = await hashIp(request);
        if (!await allowRate(env.DB, "admin_attempts", ipHash, 600, 5)) {
          return fail("삭제 시도가 잠시 제한되었습니다.", 429, origin, env);
        }
        if (!equalSecret(input.password || "", env.ADMIN_PASSWORD)) return fail("관리자 비밀번호가 맞지 않습니다.", 403, origin, env);
        const result = await env.DB.prepare("DELETE FROM fish WHERE id = ?").bind(match[1]).run();
        await env.DB.prepare("DELETE FROM admin_attempts WHERE ip_hash = ?").bind(ipHash).run();
        if (!result.meta?.changes) return fail("붕어를 찾을 수 없습니다.", 404, origin, env);
        return json({ deleted: true }, 200, origin, env);
      }

      return fail("요청한 API 경로를 찾을 수 없습니다.", 404, origin, env);
    } catch {
      return fail("저장소 처리 중 오류가 발생했습니다.", 500, origin, env);
    }
  },
};
