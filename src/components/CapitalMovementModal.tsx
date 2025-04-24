"use client"

import type React from "react"
import { useState } from "react"
import { X, DollarSign, ArrowDownCircle, ArrowUpCircle } from "lucide-react"
import { supabase } from "../lib/supabase"
import { toast } from "react-toastify"
import { useAppStore } from "../store"

interface CapitalMovementModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

const CapitalMovementModal: React.FC<CapitalMovementModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [amount, setAmount] = useState<string>("")
  const [type, setType] = useState<"deposit" | "withdrawal">("withdrawal")
  const [description, setDescription] = useState<string>("")
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const { balance } = useAppStore()

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!amount || Number.parseFloat(amount) <= 0) {
      toast.error("Por favor, informe um valor válido")
      return
    }

    setIsSubmitting(true)

    try {
      const { data: userData } = await supabase.auth.getUser()

      if (!userData.user) {
        toast.error("Usuário não autenticado")
        return
      }

      // Registrar a movimentação no banco de dados
      const { error } = await supabase.from("capital_movements").insert({
        user_id: userData.user.id,
        amount: Number.parseFloat(amount),
        type,
        description: description || (type === "deposit" ? "Depósito" : "Saque"),
        reported_by: "user",
      })

      if (error) {
        console.error("Erro ao registrar movimentação:", error)
        toast.error("Erro ao registrar movimentação")
        return
      }

      toast.success(`${type === "deposit" ? "Depósito" : "Saque"} registrado com sucesso`)
      onSuccess()
      onClose()

      // Limpar formulário
      setAmount("")
      setDescription("")
    } catch (error) {
      console.error("Erro:", error)
      toast.error("Ocorreu um erro ao processar sua solicitação")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md bg-gradient-to-br from-black to-violet-950/20 rounded-xl border border-violet-700/30 shadow-lg relative overflow-hidden p-6">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.05),transparent_70%)]"></div>

        <div className="relative z-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-200">Registrar Movimentação de Capital</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-200 transition-colors">
              <X size={20} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Tipo de Movimentação</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  className={`p-3 rounded-lg border-2 flex items-center justify-center gap-2 transition-all ${
                    type === "deposit"
                      ? "border-green-500 bg-green-900/30"
                      : "border-violet-700/30 bg-violet-900/20 hover:bg-violet-900/30"
                  }`}
                  onClick={() => setType("deposit")}
                >
                  <ArrowDownCircle size={18} className="text-green-400" />
                  <span className="font-medium">Depósito</span>
                </button>

                <button
                  type="button"
                  className={`p-3 rounded-lg border-2 flex items-center justify-center gap-2 transition-all ${
                    type === "withdrawal"
                      ? "border-red-500 bg-red-900/30"
                      : "border-violet-700/30 bg-violet-900/20 hover:bg-violet-900/30"
                  }`}
                  onClick={() => setType("withdrawal")}
                >
                  <ArrowUpCircle size={18} className="text-red-400" />
                  <span className="font-medium">Saque</span>
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="amount" className="block text-sm font-medium text-gray-300 mb-1">
                Valor
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <DollarSign size={16} className="text-gray-400" />
                </div>
                <input
                  type="number"
                  id="amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full pl-10 px-4 py-3 bg-violet-900/20 border border-violet-700/30 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 text-gray-200 placeholder-gray-500"
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  required
                />
              </div>
              {type === "withdrawal" && balance && (
                <p className="text-xs text-gray-400 mt-1">Saldo disponível: ${balance.available.toFixed(2)}</p>
              )}
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-300 mb-1">
                Descrição (opcional)
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-4 py-3 bg-violet-900/20 border border-violet-700/30 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 text-gray-200 placeholder-gray-500"
                placeholder="Motivo da movimentação..."
                rows={2}
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className={`w-full flex items-center justify-center gap-2 px-5 py-3 ${
                  type === "deposit"
                    ? "bg-gradient-to-r from-green-800 to-emerald-800 hover:from-green-700 hover:to-emerald-700"
                    : "bg-gradient-to-r from-violet-800 to-fuchsia-800 hover:from-violet-700 hover:to-fuchsia-700"
                } text-white rounded-lg transition-all duration-300 font-medium relative overflow-hidden group shadow-lg ${
                  type === "deposit" ? "shadow-green-700/20" : "shadow-violet-700/20"
                }`}
              >
                <span className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.4),transparent_70%)] opacity-0 group-hover:opacity-100 transition-opacity duration-300"></span>
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <svg
                      className="animate-spin h-5 w-5 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    Processando...
                  </span>
                ) : (
                  <span className="relative z-10">{type === "deposit" ? "Registrar Depósito" : "Registrar Saque"}</span>
                )}
              </button>
            </div>
          </form>

          <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-700/30 rounded-lg">
            <p className="text-xs text-yellow-300">
              <strong>Importante:</strong> Registrar suas movimentações de capital ajuda o sistema a calcular
              corretamente suas métricas de risco e desempenho.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CapitalMovementModal
