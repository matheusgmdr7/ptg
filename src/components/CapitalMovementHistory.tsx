"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { supabase } from "../lib/supabase"
import { ArrowDownCircle, ArrowUpCircle, Calendar } from "lucide-react"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"

interface CapitalMovement {
  id: string
  amount: number
  type: "deposit" | "withdrawal"
  description: string
  reported_by: "user" | "system"
  created_at: string
}

const CapitalMovementHistory: React.FC = () => {
  const [movements, setMovements] = useState<CapitalMovement[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchMovements = async () => {
      try {
        const { data: userData } = await supabase.auth.getUser()

        if (!userData.user) {
          console.error("Usuário não autenticado")
          setLoading(false)
          return
        }

        const { data, error } = await supabase
          .from("capital_movements")
          .select("*")
          .eq("user_id", userData.user.id)
          .order("created_at", { ascending: false })
          .limit(10)

        if (error) {
          console.error("Erro ao buscar movimentações:", error)
          return
        }

        setMovements(data as CapitalMovement[])
      } catch (error) {
        console.error("Erro:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchMovements()
  }, [])

  if (loading) {
    return (
      <div className="p-4 flex justify-center">
        <svg
          className="animate-spin h-5 w-5 text-violet-500"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
      </div>
    )
  }

  if (movements.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-400">Nenhuma movimentação registrada</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {movements.map((movement) => (
        <div
          key={movement.id}
          className="p-4 bg-violet-900/20 border border-violet-700/30 rounded-lg flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center ${
                movement.type === "deposit"
                  ? "bg-green-900/30 border border-green-700/30"
                  : "bg-red-900/30 border border-red-700/30"
              }`}
            >
              {movement.type === "deposit" ? (
                <ArrowDownCircle size={20} className="text-green-400" />
              ) : (
                <ArrowUpCircle size={20} className="text-red-400" />
              )}
            </div>

            <div>
              <h4 className="font-medium text-gray-200">
                {movement.type === "deposit" ? "Depósito" : "Saque"}
                {movement.reported_by === "system" && (
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-900/30 text-yellow-300 border border-yellow-700/30">
                    Auto
                  </span>
                )}
              </h4>
              <p className="text-sm text-gray-400">{movement.description || "-"}</p>
            </div>
          </div>

          <div className="text-right">
            <p className={`font-medium ${movement.type === "deposit" ? "text-green-400" : "text-red-400"}`}>
              {movement.type === "deposit" ? "+" : "-"}${movement.amount.toFixed(2)}
            </p>
            <div className="flex items-center justify-end gap-1 text-xs text-gray-500">
              <Calendar size={12} />
              <span>{format(new Date(movement.created_at), "dd MMM yyyy, HH:mm", { locale: ptBR })}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default CapitalMovementHistory
