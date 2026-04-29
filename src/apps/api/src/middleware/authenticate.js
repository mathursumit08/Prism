import { getSessionUser } from "../auth/authService.js";
import { verifyAccessToken } from "../auth/tokens.js";

export async function authenticate(request, response, next) {
  const authorization = request.headers.authorization || "";
  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    response.status(401).json({
      ok: false,
      error: "Authentication is required"
    });
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    const user = await getSessionUser(payload.sub);

    if (!user || !user.isActive) {
      response.status(401).json({
        ok: false,
        error: "Session is no longer active"
      });
      return;
    }

    if (user.lastLogoutAt) {
      const logoutEpochSeconds = Math.floor(new Date(user.lastLogoutAt).getTime() / 1000);
      if (!payload.iat || payload.iat <= logoutEpochSeconds) {
        response.status(401).json({
          ok: false,
          error: "Access token has been revoked"
        });
        return;
      }
    }

    request.user = user;
    next();
  } catch {
    response.status(401).json({
      ok: false,
      error: "Invalid or expired access token"
    });
  }
}
