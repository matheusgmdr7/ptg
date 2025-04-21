"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { useNavigate, Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Shield, Loader2 } from "lucide-react"
import LanguageSwitcher from "../components/LanguageSwitcher"
import { useAuthStore } from "../store/authStore"
import { toast } from "react-toastify"

const Signup: React.FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const { signup, user, isLoading, error } = useAuthStore()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [fullName, setFullName] = useState("")

  useEffect(() => {
    // If user is already logged in, redirect to dashboard
    if (user) {
      navigate("/")
    }
  }, [user, navigate])

  useEffect(() => {
    if (error) {
      toast.error(error)
    }
  }, [error])

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!email || !password || !confirmPassword) {
      toast.error("Please fill in all required fields")
      return
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match")
      return
    }

    if (password.length < 6) {
      toast.error("Password must be at least 6 characters long")
      return
    }

    try {
      await signup(email, password, fullName)
      toast.success("Account created successfully!")
      navigate("/")
    } catch (err: any) {
      // If there's a specific database error, show a more helpful message
      if (err.message && err.message.includes("Database error")) {
        toast.error("There was an issue creating your account. Please try again later or contact support.")
      }
      // Error is already handled in the store
    }
  }

  return (
    <div className="min-h-screen bg-dark-950 flex flex-col">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>

      <div className="flex flex-1 items-center justify-center px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8 bg-dark-800 p-8 rounded-lg shadow-md border border-dark-700">
          <div className="text-center">
            <div className="flex items-center justify-center">
              <div className="flex items-center justify-center w-16 h-16 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 shadow-lg mb-4">
                <Shield className="text-dark-900" size={32} />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-gray-200">
              <span className="text-primary-400">PTG</span> <span className="text-gray-200">ProTraderGain</span>
            </h1>
            <h2 className="mt-2 text-lg font-medium text-gray-200">{t("auth.createAccount")}</h2>
            <p className="mt-1 text-sm text-gray-400">{t("auth.createYourAccount")}</p>
          </div>

          <form className="mt-8 space-y-6" onSubmit={handleSignup}>
            <div className="space-y-4">
              <div>
                <label htmlFor="fullName" className="block text-sm font-medium text-gray-300">
                  Full Name (Optional)
                </label>
                <input
                  id="fullName"
                  name="fullName"
                  type="text"
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-dark-600 rounded-md shadow-sm bg-dark-700 text-gray-200 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-300">
                  {t("common.email")} *
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-dark-600 rounded-md shadow-sm bg-dark-700 text-gray-200 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-300">
                  {t("common.password")} *
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-dark-600 rounded-md shadow-sm bg-dark-700 text-gray-200 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
                <p className="mt-1 text-xs text-gray-400">Password must be at least 6 characters long</p>
              </div>

              <div>
                <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-300">
                  Confirm Password *
                </label>
                <input
                  id="confirm-password"
                  name="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-dark-600 rounded-md shadow-sm bg-dark-700 text-gray-200 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-dark-900 bg-primary-500 hover:bg-primary-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <span className="flex items-center">
                    <Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4 text-dark-900" />
                    {t("common.loading")}
                  </span>
                ) : (
                  t("common.signup")
                )}
              </button>
            </div>
          </form>

          <div className="text-center mt-4">
            <p className="text-sm text-gray-400">
              {t("auth.alreadyHaveAccount")}{" "}
              <Link to="/login" className="font-medium text-primary-400 hover:text-primary-300">
                {t("common.login")}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Signup

