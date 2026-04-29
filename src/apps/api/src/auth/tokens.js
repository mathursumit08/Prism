import crypto from "node:crypto";

const accessTokenTtlSeconds = Number(process.env.JWT_ACCESS_TTL_SECONDS || 900);
const refreshTokenTtlSeconds = Number(process.env.JWT_REFRESH_TTL_SECONDS || 60 * 60 * 24 * 7);
const accessSecret = process.env.JWT_ACCESS_SECRET || "prism-access-secret-change-me";
const refreshSecret = process.env.JWT_REFRESH_SECRET || "prism-refresh-secret-change-me";
const refreshCookieSecure =
  process.env.AUTH_COOKIE_SECURE === undefined
    ? process.env.NODE_ENV === "production"
    : process.env.AUTH_COOKIE_SECURE === "true";
const refreshCookieSameSite = process.env.AUTH_COOKIE_SAME_SITE || "lax";

export function signAccessToken(username) {
  return signJwt({ sub: username, type: "access" }, accessSecret, accessTokenTtlSeconds);
}

export function signRefreshToken(username) {
  return signJwt(
    {
      sub: username,
      jti: crypto.randomUUID(),
      type: "refresh"
    },
    refreshSecret,
    refreshTokenTtlSeconds
  );
}

export function verifyAccessToken(token) {
  return verifyJwt(token, accessSecret);
}

export function verifyRefreshToken(token) {
  return verifyJwt(token, refreshSecret);
}

export function hashRefreshToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getRefreshTokenExpiryDate() {
  return new Date(Date.now() + refreshTokenTtlSeconds * 1000);
}

export function getRefreshCookieOptions() {
  return {
    httpOnly: true,
    sameSite: refreshCookieSameSite,
    secure: refreshCookieSecure,
    path: "/api/auth",
    maxAge: refreshTokenTtlSeconds * 1000
  };
}

function signJwt(payload, secret, expiresInSeconds) {
  const header = {
    alg: "HS256",
    typ: "JWT"
  };
  const issuedAt = Math.floor(Date.now() / 1000);
  const tokenPayload = {
    ...payload,
    iat: issuedAt,
    exp: issuedAt + expiresInSeconds
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(tokenPayload));
  const signature = createSignature(`${encodedHeader}.${encodedPayload}`, secret);

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyJwt(token, secret) {
  const [encodedHeader, encodedPayload, signature] = token.split(".");

  if (!encodedHeader || !encodedPayload || !signature) {
    throw new Error("Invalid token");
  }

  const expectedSignature = createSignature(`${encodedHeader}.${encodedPayload}`, secret);
  if (!safeCompare(signature, expectedSignature)) {
    throw new Error("Invalid token signature");
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Token expired");
  }

  return payload;
}

function createSignature(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
