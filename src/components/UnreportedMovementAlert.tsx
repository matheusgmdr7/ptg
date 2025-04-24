"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { AlertTriangle } from "lucide-react"
import { detectUnreportedMovements } from "../services/capitalMovementService"
import { useAppStore } from "../store"
import CapitalMovementModal from "./CapitalMovementModal"

const UnreportedMovementAlert: React.FC = () => {
  const [unreportedMovement, setUnreportedMovement] = useState<{ detected: boolean; estimatedAmount: number } | null>(
    null,
  )
  const [isModalOpen, setIsModalOpen] = useState(false)
  const { balance } = useAppStore()

  // Armazenar o último saldo conhecido
  const [lastKnownBalance, setLastKnownBalance] = useState<number | null>(null)

  useEffect(() => {
    // Verificar se temos o saldo atual
    if (!balance || !balance.total) return

    const checkForUnreportedMovements = async () => {
      // Se não temos um saldo anterior registrado, apenas armazenar o atual
      if (lastKnownBalance === null) {
        setLastKnownBalance(balance.total)
        return
      }

      // Obter o PnL diário para comparação
      const { api } = await import("../services/api")
      const connections = await api.checkRealConnections([]) // Obter conexões ativas
      const pnlData = await api.getPnLData(connections)

      // Detectar possíveis movimentações não informadas
      const result = await detectUnreportedMovements(
        lastKnownBalance,
        balance.total,
        pnlData.dailyPnL,
        2.0, // 2% de tolerância
      )

      if (result.detected) {
        setUnreportedMovement(result)
      } else {
        setUnreportedMovement(null)
      }

      // Atualizar o último saldo conhecido
      setLastKnownBalance(balance.total)
    }

    // Verificar apenas quando o componente for montado ou quando o saldo mudar significativamente
    checkForUnreportedMovements()
  }, [balance])

  // Se não houver movimentação não informada detectada, não renderizar nada
  if (!unreportedMovement || !unreportedMovement.detected) {
    return null
  }

  const isDeposit = unreportedMovement.estimatedAmount > 0

  return (
    <>
      <div className="p-4 bg-yellow-900/20 border border-yellow-700/30 rounded-lg mb-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5">
            <AlertTriangle size={20} className="text-yellow-400" />
          </div>
          <div>
            <h3 className="font-medium text-yellow-300 mb-1">Possível movimentação não registrada detectada</h3>
            <p className="text-sm text-gray-300 mb-3">
              Detectamos uma mudança no seu saldo que pode indicar um {isDeposit ? "depósito" : "saque"} de
              aproximadamente ${Math.abs(unreportedMovement.estimatedAmount).toFixed(2)} não registrado. Registrar suas
              movimentações ajuda a manter suas métricas de risco precisas.
            </p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="text-sm font-medium text-yellow-300 hover:text-yellow-200 transition-colors flex items-center gap-1"
            >
              Registrar esta movimentação
            </button>
          </div>
        </div>
      </div>

      <CapitalMovementModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => setUnreportedMovement(null)}
      />
    </>
  )
}

export default UnreportedMovementAlert
