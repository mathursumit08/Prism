export function requirePermission(permissionName) {
  return function permissionMiddleware(request, response, next) {
    const permissions = request.user?.permissions || [];

    if (!permissions.includes(permissionName)) {
      response.status(403).json({
        ok: false,
        error: "You do not have permission to access this resource"
      });
      return;
    }

    next();
  };
}
