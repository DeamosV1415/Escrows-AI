import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  profileComplete?: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  loading: true,
  login: () => {},
  logout: () => {},
  updateUser: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore session from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("escrows_token");
    if (stored) {
      fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${stored}` },
      })
        .then((res) => {
          if (!res.ok) throw new Error("Invalid token");
          return res.json();
        })
        .then((data) => {
          setToken(stored);
          setUser(data.user);
        })
        .catch(() => {
          localStorage.removeItem("escrows_token");
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback((newToken: string, newUser: User) => {
    localStorage.setItem("escrows_token", newToken);
    setToken(newToken);
    setUser(newUser);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("escrows_token");
    setToken(null);
    setUser(null);
  }, []);

  const updateUser = useCallback((updatedUser: User) => {
    setUser(updatedUser);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export default AuthContext;
