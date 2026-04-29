import { Router } from "express";
import {
  findUserForLogin,
  getSessionUser,
  recordLogin,
  recordLogout,
  revokeRefreshToken,
  rotateRefreshToken,
  storeRefreshToken,
  touchRefreshToken
} from "../auth/authService.js";
import { verifyPassword } from "../auth/passwords.js";
import {
  getRefreshCookieOptions,
  getRefreshTokenExpiryDate,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken
} from "../auth/tokens.js";
import { authenticate } from "../middleware/authenticate.js";

const router = Router();
const refreshCookieName = "prism_refresh_token";

function clearRefreshCookie(response) {
  response.clearCookie(refreshCookieName, getRefreshCookieOptions());
}

router.post("/login", async (request, response) => {
  const username = request.body?.username?.trim();
  const password = request.body?.password;

  if (!username || !password) {
    response.status(400).json({
      ok: false,
      error: "Username and password are required"
    });
    return;
  }

  try {
    const user = await findUserForLogin(username);

    if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) {
      response.status(401).json({
        ok: false,
        error: "Invalid username or password"
      });
      return;
    }

    const accessToken = signAccessToken(user.username);
    const refreshToken = signRefreshToken(user.username);
    const refreshExpiresAt = getRefreshTokenExpiryDate();

    await recordLogin(user.username);
    await storeRefreshToken(user.username, refreshToken, refreshExpiresAt);

    response.cookie(refreshCookieName, refreshToken, getRefreshCookieOptions());
    response.json({
      ok: true,
      accessToken,
      user: await getSessionUser(user.username)
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.post("/refresh", async (request, response) => {
  const currentRefreshToken = request.cookies?.[refreshCookieName];

  if (!currentRefreshToken) {
    response.status(401).json({
      ok: false,
      error: "Refresh token is required"
    });
    return;
  }

  try {
    const payload = verifyRefreshToken(currentRefreshToken);
    const tokenOwner = await touchRefreshToken(currentRefreshToken);

    if (!tokenOwner || tokenOwner !== payload.sub) {
      clearRefreshCookie(response);
      response.status(401).json({
        ok: false,
        error: "Refresh token is invalid"
      });
      return;
    }

    const user = await getSessionUser(payload.sub);
    if (!user || !user.isActive) {
      clearRefreshCookie(response);
      response.status(401).json({
        ok: false,
        error: "Session is no longer active"
      });
      return;
    }

    const nextRefreshToken = signRefreshToken(user.username);
    const nextRefreshExpiry = getRefreshTokenExpiryDate();
    await rotateRefreshToken(currentRefreshToken, nextRefreshToken, user.username, nextRefreshExpiry);

    response.cookie(refreshCookieName, nextRefreshToken, getRefreshCookieOptions());
    response.json({
      ok: true,
      accessToken: signAccessToken(user.username),
      user
    });
  } catch {
    await revokeRefreshToken(currentRefreshToken);
    clearRefreshCookie(response);
    response.status(401).json({
      ok: false,
      error: "Refresh token is invalid or expired"
    });
  }
});

router.post("/logout", async (request, response) => {
  const currentRefreshToken = request.cookies?.[refreshCookieName];
  const authorization = request.headers.authorization || "";
  const [, accessToken] = authorization.split(" ");

  try {
    if (currentRefreshToken) {
      const refreshPayload = verifyRefreshToken(currentRefreshToken);
      await recordLogout(refreshPayload.sub);
    } else if (accessToken) {
      const accessPayload = verifyAccessToken(accessToken);
      await recordLogout(accessPayload.sub);
    }
  } catch {
    // Continue with refresh-token revocation and cookie cleanup even if token parsing fails.
  }

  await revokeRefreshToken(currentRefreshToken);
  clearRefreshCookie(response);
  response.json({
    ok: true
  });
});

router.get("/me", authenticate, async (request, response) => {
  response.json({
    ok: true,
    user: request.user
  });
});

export default router;
