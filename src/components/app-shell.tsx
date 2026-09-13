"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AuthProvider } from "./auth-context";
import { createClient } from "@/lib/supabase/client";
import {
  CalendarDays,
  Flag,
  History,
  Leaf,
  Sparkles,
  ArrowUpRight,
} from "lucide-react";
const links = [
  { href: "/", label: "今日", icon: CalendarDays },
  { href: "/schedule", label: "课表", icon: CalendarDays },
  { href: "/goals", label: "目标", icon: Flag },
  { href: "/history", label: "历史", icon: History },
  { href: "/butler", label: "管家", icon: Sparkles },
];
export function AppShell({
  children,
  userId,
  email,
}: {
  children: React.ReactNode;
  userId: string;
  email: string;
}) {
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  async function logout() {
    setSigningOut(true);
    setLogoutError("");
    try {
      const { error } = await createClient().auth.signOut({ scope: "local" });
      if (error) throw error;
      window.location.replace("/login");
    } catch {
      setLogoutError("退出失败，请检查网络后重试。");
      setSigningOut(false);
    }
  }
  return (
    <AuthProvider userId={userId}>
      <div className="app-shell">
        <a className="skip-link" href="#main">
          跳到主要内容
        </a>
        <aside className="sidebar">
          <Link className="brand" href="/">
            <span className="brand-icon">
              <Leaf size={24} />
            </span>
            <span>
              成长管家<small>GROWTH BUTLER</small>
            </span>
          </Link>
          <p className="nav-label">我的成长空间</p>
          <nav aria-label="主导航">
            {links.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={`nav-link ${pathname === href ? "active" : ""}`}
                aria-current={pathname === href ? "page" : undefined}
              >
                <Icon size={21} />
                <span>{label}</span>
                {pathname === href && <span className="nav-dot" />}
              </Link>
            ))}
          </nav>
          <div className="sidebar-note">
            <Leaf size={23} />
            <p>
              慢慢来，
              <br />
              每一步都算数。
            </p>
            <small>给成长一点时间</small>
          </div>
          <div className="profile">
            <span className="avatar">我</span>
            <div>
              我的成长旅程
              <small className="account-email" title={email}>
                {email}
              </small>
            </div>
            <ArrowUpRight size={16} />
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <span>
              我的空间 <span className="separator">/</span>{" "}
              {links.find((link) => link.href === pathname)?.label ?? "页面"}
            </span>
            <div className="account-actions">
              <span className="demo-badge">云端空间</span>
              <button
                className="secondary-button"
                disabled={signingOut}
                onClick={logout}
              >
                {signingOut ? "正在退出……" : "退出登录"}
              </button>
            </div>
          </header>
          {logoutError && (
            <p className="error-message shell-error" role="alert">
              {logoutError}
            </p>
          )}
          <main id="main" tabIndex={-1}>
            {children}
          </main>
          <footer>
            一点一滴，成为想成为的自己。<span>成长管家 · 云端同步</span>
          </footer>
        </div>
      </div>
    </AuthProvider>
  );
}
