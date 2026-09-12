"use client";
import { createContext, useContext, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
const UserContext = createContext("");
export function AuthProvider({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const {
      data: { subscription },
    } = createClient().auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || (session && session.user.id !== userId))
        window.location.replace("/login");
    });
    return () => subscription.unsubscribe();
  }, [userId]);
  return <UserContext.Provider value={userId}>{children}</UserContext.Provider>;
}
export function useUserId() {
  const userId = useContext(UserContext);
  if (!userId) throw new Error("请先登录。");
  return userId;
}
