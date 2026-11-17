// A stand-in for Supabase Auth in the end-to-end tests of the screens that
// need accounts (the admin's cards on the profile). It keeps logins in memory
// and answers the few calls server/accounts.ts makes: create a login, sign in,
// refresh, who is this token, change a password, sign out.

import crypto from "node:crypto";
import http from "node:http";

const PORT = Number(process.env.FAKE_AUTH_PORT ?? 8895);

/** email -> { id, email, password } */
const users = new Map();
/** access or refresh token -> user id */
const tokens = new Map();

const byId = (id) => [...users.values()].find((u) => u.id === id);
const session = (u) => {
  const access_token = crypto.randomBytes(24).toString("hex");
  const refresh_token = crypto.randomBytes(24).toString("hex");
  tokens.set(access_token, u.id);
  tokens.set(refresh_token, u.id);
  return { access_token, refresh_token, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: u.id, email: u.email } };
};

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const send = (status, body) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const url = new URL(req.url ?? "/", "http://local");
      const body = raw ? JSON.parse(raw) : {};
      const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      const route = `${req.method} ${url.pathname}`;

      if (route === "POST /admin/users") {
        if (users.has(body.email)) return send(422, { msg: "A user with this email address has already been registered" });
        const u = { id: crypto.randomUUID(), email: body.email, password: body.password };
        users.set(u.email, u);
        return send(200, { id: u.id, email: u.email });
      }
      if (route === "GET /admin/users") return send(200, { users: [...users.values()].slice(0, 1).map((u) => ({ id: u.id })) });
      if (req.method === "PUT" && url.pathname.startsWith("/admin/users/")) {
        const u = byId(url.pathname.split("/").pop());
        if (!u) return send(404, { msg: "User not found" });
        u.password = body.password;
        return send(200, { id: u.id });
      }
      if (route === "POST /token") {
        if (url.searchParams.get("grant_type") === "refresh_token") {
          const u = byId(tokens.get(body.refresh_token));
          return u ? send(200, session(u)) : send(400, { error_description: "Invalid Refresh Token" });
        }
        const u = users.get(body.email);
        return u && u.password === body.password ? send(200, session(u)) : send(400, { error_description: "Invalid login credentials" });
      }
      if (route === "GET /user") {
        const u = byId(tokens.get(bearer));
        return u ? send(200, { id: u.id, email: u.email }) : send(401, { msg: "invalid JWT" });
      }
      if (route === "POST /logout") return send(204, {});
      send(404, { msg: `fake auth: no ${route}` });
    });
  })
  .listen(PORT, () => console.log(`fake auth on ${PORT}`));
