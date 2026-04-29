import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:4000";
const AuthContext = createContext(null);

function buildHeaders(existingHeaders, accessToken) {
  const headers = new Headers(existingHeaders || {});

  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  return headers;
}

export function AuthProvider({ children }) {
  const [accessToken, setAccessToken] = useState("");
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const tokenRef = useRef("");
  const refreshPromiseRef = useRef(null);

  const applySession = useCallback((payload) => {
    tokenRef.current = payload.accessToken || "";
    setAccessToken(payload.accessToken || "");
    setUser(payload.user || null);
  }, []);

  const clearSession = useCallback(() => {
    tokenRef.current = "";
    setAccessToken("");
    setUser(null);
  }, []);

  const refreshSession = useCallback(async () => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    refreshPromiseRef.current = (async () => {
      const response = await fetch(`${apiUrl}/api/auth/refresh`, {
        method: "POST",
        credentials: "include"
      });

      if (!response.ok) {
        clearSession();
        throw new Error("Session refresh failed");
      }

      const payload = await response.json();
      applySession(payload);
      return payload;
    })();

    try {
      return await refreshPromiseRef.current;
    } finally {
      refreshPromiseRef.current = null;
    }
  }, [applySession, clearSession]);

  useEffect(() => {
    let ignore = false;

    refreshSession()
      .catch(() => {
        if (!ignore) {
          clearSession();
        }
      })
      .finally(() => {
        if (!ignore) {
          setBooting(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [clearSession, refreshSession]);

  const login = useCallback(
    async ({ username, password }) => {
      const response = await fetch(`${apiUrl}/api/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          username,
          password
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Unable to sign in");
      }

      applySession(payload);
      return payload;
    },
    [applySession]
  );

  const logout = useCallback(async () => {
    try {
      await fetch(`${apiUrl}/api/auth/logout`, {
        method: "POST",
        credentials: "include"
      });
    } finally {
      clearSession();
      window.location.hash = "home";
    }
  }, [clearSession]);

  const apiFetch = useCallback(
    async (path, options = {}, allowRetry = true) => {
      const response = await fetch(`${apiUrl}${path}`, {
        ...options,
        credentials: "include",
        headers: buildHeaders(options.headers, tokenRef.current)
      });

      if (response.status === 401 && allowRetry) {
        await refreshSession();

        return fetch(`${apiUrl}${path}`, {
          ...options,
          credentials: "include",
          headers: buildHeaders(options.headers, tokenRef.current)
        });
      }

      return response;
    },
    [refreshSession]
  );

  const value = useMemo(
    () => ({
      accessToken,
      apiFetch,
      booting,
      isAuthenticated: Boolean(user),
      login,
      logout,
      user
    }),
    [accessToken, apiFetch, booting, login, logout, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}
