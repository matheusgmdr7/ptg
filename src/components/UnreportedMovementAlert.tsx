"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { AlertTriangle, CheckCircle2, ArrowDownCircle, ArrowUpCircle } from "lucide-react"
import {
  detectUnreportedMovements,
  detectBinanceMovementsNotRegistered,
  registerBinanceMovement,
  getAlertToleranceByRiskLevel,
} from "../services/capitalMovementService"
import { useAppStore } from "../store"
import CapitalMovementModal from "./CapitalMovementModal"
import { toast } from "react-toastify"

const UnreportedMovementAlert: React.FC = () => {
  const [unreportedMovement, setUnreportedMovement] = useState<{ detected: boolean; estimatedAmount: number } | null>(
    null,
  )
  const [binanceMovements, setBinanceMovements] = useState<any[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedMovement, setSelectedMovement] = useState<any>(null)
  const [isRegistering, setIsRegistering] = useState(false)
  const { balance, connections } = useAppStore()

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
      const activeConnections = (await api.checkRealConnections(connections)) ? connections : []
      const pnlData = await api.getPnLData(activeConnections)

      // Obter tolerância baseada no nível de risco
      const tolerance = await getAlertToleranceByRiskLevel()

      // Detectar possíveis movimentações não informadas
      const result = await detectUnreportedMovements(
        lastKnownBalance,
        balance.total,
        pnlData.dailyPnL,
        tolerance, // Tolerância dinâmica baseada no nível de risco
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

  // Verificar movimentações da Binance não registradas
  useEffect(() => {
    const checkBinanceMovements = async () => {
      if (!connections || connections.length === 0) return

      try {
        const unregisteredMovements = await detectBinanceMovementsNotRegistered(connections)
        setBinanceMovements(unregisteredMovements)
      } catch (error) {
        console.error("Erro ao verificar movimentações da Binance:", error)
      }
    }

    checkBinanceMovements()

    // Verificar a cada 5 minutos
    const intervalId = setInterval(checkBinanceMovements, 5 * 60 * 1000)

    return () => clearInterval(intervalId)
  }, [connections])

  // Função para registrar automaticamente uma movimentação da Binance
  const handleRegisterBinanceMovement = async (movement: any) => {
    setIsRegistering(true)

    try {
      const success = await registerBinanceMovement(movement)

      if (success) {
        toast.success(`${movement.type === "deposit" ? "Depósito" : "Saque"} registrado com sucesso`)

        // Remover a movimentação da lista
        setBinanceMovements((prev) => prev.filter((m) => m.id !== movement.id))
      } else {
        toast.error(`Erro ao registrar ${movement.type === "deposit" ? "depósito" : "saque"}`)
      }
    } catch (error) {
      console.error("Erro ao registrar movimentação:", error)
      toast.error("Ocorreu um erro ao processar sua solicitação")
    } finally {
      setIsRegistering(false)
    }
  }

  // Função para abrir o modal com dados pré-preenchidos
  const openModalWithMovement = (movement: any) => {
    setSelectedMovement({
      amount: movement.amount,
      type: movement.type,
      description: `${movement.type === "deposit" ? "Depósito" : "Saque"} de ${movement.coin} (Binance)`,
      binance_tx_id: movement.txId,
      binance_timestamp: movement.timestamp,
    })
    setIsModalOpen(true)
  }

  // Se não houver movimentação não informada detectada e nenhuma movimentação da Binance, não renderizar nada
  if ((!unreportedMovement || !unreportedMovement.detected) && (!binanceMovements || binanceMovements.length === 0)) {
    return null
  }

  return (
    <>
      {/* Alerta para movimentações detectadas por diferença de saldo */}
      {unreportedMovement && unreportedMovement.detected && (
        <div className="p-4 bg-yellow-900/20 border border-yellow-700/30 rounded-lg mb-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              <AlertTriangle size={20} className="text-yellow-400" />
            </div>
            <div>
              <h3 className="font-medium text-yellow-300 mb-1">Possível movimentação não registrada detectada</h3>
              <p className="text-sm text-gray-300 mb-3">
                Detectamos uma mudança no seu saldo que pode indicar um{" "}
                {unreportedMovement.estimatedAmount > 0 ? "depósito" : "saque"} de aproximadamente $
                {Math.abs(unreportedMovement.estimatedAmount).toFixed(2)} não registrado. Registrar suas movimentações
                ajuda a manter suas métricas de risco precisas.
              </p>
              <button
                onClick={() => {
                  setSelectedMovement({
                    amount: Math.abs(unreportedMovement.estimatedAmount),
                    type: unreportedMovement.estimatedAmount > 0 ? "deposit" : "withdrawal",
                    description: `${unreportedMovement.estimatedAmount > 0 ? "Depósito" : "Saque"} detectado automaticamente`,
                  })
                  setIsModalOpen(true)
                }}
                className="text-sm font-medium text-yellow-300 hover:text-yellow-200 transition-colors flex items-center gap-1"
              >
                Registrar esta movimentação
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alerta para movimentações da Binance não registradas */}
      {binanceMovements && binanceMovements.length > 0 && (
        <div className="p-4 bg-violet-900/20 border border-violet-700/30 rounded-lg mb-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              <AlertTriangle size={20} className="text-violet-400" />
            </div>
            <div className="w-full">
              <h3 className="font-medium text-violet-300 mb-1">
                {binanceMovements.length} movimentação(ões) da Binance não registrada(s)
              </h3>
              <p className="text-sm text-gray-300 mb-3">
                Detectamos {binanceMovements.length} {binanceMovements.length === 1 ? "movimentação" : "movimentações"}{" "}
                na sua conta da Binance que ainda não{" "}
                {binanceMovements.length === 1 ? "foi registrada" : "foram registradas"} no sistema. Registrar estas
                movimentações ajuda a manter suas métricas de risco precisas.
              </p>

              <div className="space-y-3 mt-2">
                {binanceMovements.map((movement) => (
                  <div key={movement.id} className="bg-violet-900/30 border border-violet-700/30 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {movement.type === "deposit" ? (
                          <ArrowDownCircle size={18} className="text-green-400" />
                        ) : (
                          <ArrowUpCircle size={18} className="text-red-400" />
                        )}
                        <div>
                          <div className="font-medium text-gray-200">
                            {movement.type === "deposit" ? "Depósito" : "Saque"} de {movement.amount} {movement.coin}
                          </div>
                          <div className="text-xs text-gray-400">
                            {new Date(movement.timestamp).toLocaleDateString()}{" "}
                            {new Date(movement.timestamp).toLocaleTimeString()}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openModalWithMovement(movement)}
                          className="text-xs px-3 py-1 bg-violet-900/30 hover:bg-violet-900/50 border border-violet-700/30 rounded-md transition-colors text-violet-300"
                        >
                          Editar e registrar
                        </button>

                        <button
                          onClick={() => handleRegisterBinanceMovement(movement)}
                          disabled={isRegistering}
                          className="text-xs px-3 py-1 bg-violet-800/50 hover:bg-violet-800/70 border border-violet-600/50 rounded-md transition-colors text-white flex items-center gap-1"
                        >
                          {isRegistering ? (
                            <>
                              <span className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full mr-1"></span>
                              Processando...
                            </>
                          ) : (
                            <>
                              <CheckCircle2 size={12} />
                              Registrar automaticamente
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <CapitalMovementModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setSelectedMovement(null)
        }}
        onSuccess={() => {
          setIsModalOpen(false)
          setSelectedMovement(null)
          // Remover a movimentação da lista se for da Binance
          if (selectedMovement && selectedMovement.binance_tx_id) {
            setBinanceMovements((prev) => prev.filter((m) => m.txId !== selectedMovement.binance_tx_id))
          }
          // Limpar o alerta de movimentação não registrada
          setUnreportedMovement(null)
        }}
        initialValues={selectedMovement}
      />
    </>
  )
}

export default UnreportedMovementAlert
