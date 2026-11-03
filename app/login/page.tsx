"use client"

import type React from "react"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useAuth } from "@/hooks/use-auth"
import { Eye, EyeOff, ArrowRight, Zap, Users } from "lucide-react"
import { Spinner } from "@/components/ui/skeletons"

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-background">
          <Spinner className="h-6 w-6 text-muted-foreground" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  )
}

function LoginContent() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)

  const { login, loginWithGoogle } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams?.get("redirect")
  const [googleEnabled, setGoogleEnabled] = useState(true)
  const [authStatusChecked, setAuthStatusChecked] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    fetch("/api/auth/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.auth && typeof data.auth.google === "boolean") {
          setGoogleEnabled(data.auth.google)
        }
      })
      .catch(() => undefined)
      .finally(() => setAuthStatusChecked(true))
  }, [])

  useEffect(() => {
    const errorCode = searchParams?.get("error")
    if (!errorCode) return

    const messages: Record<string, string> = {
      auth_error: "We could not complete authentication. Please try again.",
      oauth_error: "The sign-in provider rejected the request.",
      profile_error: "Your account was created, but the profile could not be loaded.",
      server_error: "Authentication is temporarily unavailable. Please try again.",
    }

    const base = messages[errorCode] || "Authentication failed. Please try again."
    const reason = searchParams?.get("reason")
    setError(reason ? `${base} (${reason})` : base)
  }, [searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      await login(email, password)
      const destination = redirect && redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/"
      router.replace(`/legal/consent?returnTo=${encodeURIComponent(destination)}`)
    } catch (err: any) {
      setError(err.message || "Failed to sign in")
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    setError("")
    setLoading(true)
    try {
      await loginWithGoogle(
        `${window.location.origin}/legal/consent?returnTo=${encodeURIComponent(redirect && redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/")}`,
      )
    } catch (err: any) {
      setError(
        googleEnabled === false
          ? "Google sign-in is being set up — use email & password for now."
          : err.message || "Failed to sign in with Google",
      )
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground flex items-center justify-center">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 dark:hidden bg-gradient-to-br from-slate-50 via-white to-slate-100" />
        <div className="absolute inset-0 opacity-[0.04] dark:block hidden" style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }} />
        <div className="absolute -top-32 -left-32 h-64 w-64 rounded-full bg-violet-600/[0.06] dark:block hidden" />
        <div className="absolute -bottom-32 -right-32 h-64 w-64 rounded-full bg-cyan-600/[0.05] dark:block hidden" />
      </div>

      <div className={"relative z-10 w-full max-w-md px-6 transition-all duration-700 " + (mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4")}>
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <div className="relative group">
            <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-2xl shadow-cyan-500/20 dark:shadow-cyan-500/30 rotate-3 hover:rotate-0 transition-transform duration-300 ring-2 ring-cyan-500/30">
              <img src="/icons/icon.svg" alt="Loop" className="h-full w-full" />
            </div>
            <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-cyan-500 to-indigo-600 opacity-20 blur-lg group-hover:opacity-30 transition-opacity" />
          </div>
        </div>

        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            <span className="bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 dark:from-cyan-400 dark:via-blue-400 dark:to-indigo-400 bg-clip-text text-transparent">
              Welcome back
            </span>
          </h1>
          <p className="text-muted-foreground text-sm">
            Sign in to continue your loop
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border bg-card shadow-2xl p-6">
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-medium">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-11 rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-xs font-medium">Password</Label>
                <Link href="/reset-password" className="text-[11px] text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300 font-medium transition-colors">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-11 rounded-xl pr-11"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">
              After signing in, you’ll confirm the current Terms of Service and Privacy Policy before continuing.
            </p>
            <Button
              type="submit"
              className="w-full h-11 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 dark:from-cyan-500 dark:to-indigo-600 text-white font-semibold shadow-lg shadow-cyan-500/25 hover:from-cyan-500 hover:to-indigo-500 transition-all duration-200 group"
              disabled={loading}
            >
              {loading ? (
                <Spinner className="mr-2 h-4 w-4" />
              ) : (
                <>
                  Sign In
                  <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </Button>
          </form>

          {/* Divider */}
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-3 bg-card text-muted-foreground">or</span>
            </div>
          </div>

          {/* Google */}
          <Button
            type="button"
            variant="outline"
            className="w-full h-11 rounded-xl font-medium transition-all group"
            onClick={handleGoogleLogin}
            disabled={loading || (googleEnabled === false && authStatusChecked)}
          >
            <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </Button>

          {googleEnabled === false && authStatusChecked && (
            <p className="text-center text-[11px] text-amber-600 dark:text-amber-500/80 mt-3">
              Google sign-in is being set up — use email &amp; password for now.
            </p>
          )}

          {/* Footer */}
          <div className="text-center mt-5">
            <p className="text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link href="/signup" className="text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300 font-semibold transition-colors">
                Create one
              </Link>
            </p>
          </div>
        </div>

        {/* Terms */}
        <div className="flex items-center justify-center gap-3 text-[11px] text-muted-foreground mt-6">
          <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
          <span>·</span>
          <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
        </div>

        {/* Feature highlights */}
        <div className="grid grid-cols-3 gap-4 mt-8 max-w-sm mx-auto">
          <div className="text-center space-y-1.5">
            <div className="w-8 h-8 mx-auto rounded-lg bg-cyan-100 dark:bg-cyan-500/10 flex items-center justify-center">
              <Zap className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
            </div>
            <p className="text-[10px] text-muted-foreground font-medium">Create Loops</p>
          </div>
          <div className="text-center space-y-1.5">
            <div className="w-8 h-8 mx-auto rounded-lg bg-violet-100 dark:bg-violet-500/10 flex items-center justify-center">
              <Users className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            </div>
            <p className="text-[10px] text-muted-foreground font-medium">Co-Loop Live</p>
          </div>
          <div className="text-center space-y-1.5">
            <div className="w-8 h-8 mx-auto rounded-lg bg-blue-100 dark:bg-blue-500/10 flex items-center justify-center">
              <Zap className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <p className="text-[10px] text-muted-foreground font-medium">Earn Rewards</p>
          </div>
        </div>
      </div>
    </div>
  )
}
