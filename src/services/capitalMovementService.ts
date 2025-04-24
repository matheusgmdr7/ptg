import { supabase } from "../lib/supabase"

// Interface para movimentações de capital
export interface CapitalMovement {
  id?: string
  user_id?: string
  amount: number
  type: "deposit" | "withdrawal"
  description?: string
  reported_by: "user" | "system"
  created_at?: string
  source?: "manual" | "binance" | "auto_detected"
  binance_tx_id?: string
  binance_timestamp?: number
}

// Interface para movimentações não registradas
export interface UnregisteredMovement {
  id: string
  amount: number
  type: "deposit" | "withdrawal"
  timestamp: number
  coin: string
  txId?: string
  source: "binance"
  alreadyRegistered: boolean
}

// Adicionar esta função para garantir que as movimentações não afetem as conexões
export const ensureConnectionsIntegrity = async () => {
  try {
    const { useAppStore } = await import("../store")
    const { connections } = useAppStore.getState()

    // Se não há conexões no estado global, tentar carregá-las do Supabase
    if (!connections || connections.length === 0) {
      const { getExchangeConnections } = await import("./supabaseService")
      const loadedConnections = await getExchangeConnections()

      if (loadedConnections && loadedConnections.length > 0) {
        console.log("CapitalMovementService: Restoring connections from Supabase:", loadedConnections.length)
        useAppStore.getState().setConnections(loadedConnections)
        return true
      }
    }

    return connections && connections.length > 0
  } catch (error) {
    console.error("CapitalMovementService: Error ensuring connections integrity:", error)
    return false
  }
}

// Função para registrar uma movimentação de capital
export const registerCapitalMovement = async (movement: Omit<CapitalMovement, "user_id">): Promise<boolean> => {
  try {
    // Garantir integridade das conexões
    await ensureConnectionsIntegrity()

    const { data: userData } = await supabase.auth.getUser()

    if (!userData.user) {
      console.error("Usuário não autenticado")
      return false
    }

    const { error } = await supabase.from("capital_movements").insert({
      user_id: userData.user.id,
      amount: movement.amount,
      type: movement.type,
      description: movement.description || "",
      reported_by: movement.reported_by,
      source: movement.source || "manual",
      binance_tx_id: movement.binance_tx_id,
      binance_timestamp: movement.binance_timestamp,
    })

    if (error) {
      console.error("Erro ao registrar movimentação:", error)
      return false
    }

    return true
  } catch (error) {
    console.error("Erro:", error)
    return false
  }
}

// Função para obter o total de movimentações em um período
export const getCapitalMovementTotals = async (
  startDate: Date,
  endDate: Date = new Date(),
): Promise<{ deposits: number; withdrawals: number }> => {
  try {
    // Garantir integridade das conexões
    await ensureConnectionsIntegrity()

    const { data: userData } = await supabase.auth.getUser()

    if (!userData.user) {
      console.error("Usuário não autenticado")
      return { deposits: 0, withdrawals: 0 }
    }

    const { data, error } = await supabase
      .from("capital_movements")
      .select("*")
      .eq("user_id", userData.user.id)
      .gte("created_at", startDate.toISOString())
      .lte("created_at", endDate.toISOString())

    if (error) {
      console.error("Erro ao buscar movimentações:", error)
      return { deposits: 0, withdrawals: 0 }
    }

    const movements = data as CapitalMovement[]

    const deposits = movements.filter((m) => m.type === "deposit").reduce((sum, m) => sum + m.amount, 0)

    const withdrawals = movements.filter((m) => m.type === "withdrawal").reduce((sum, m) => sum + m.amount, 0)

    return { deposits, withdrawals }
  } catch (error) {
    console.error("Erro:", error)
    return { deposits: 0, withdrawals: 0 }
  }
}

// Função para detectar possíveis movimentações não informadas
export const detectUnreportedMovements = async (
  previousBalance: number,
  currentBalance: number,
  pnl: number,
  tolerance = 1.0, // Tolerância em %
): Promise<{ detected: boolean; estimatedAmount: number }> => {
  try {
    // Garantir integridade das conexões
    await ensureConnectionsIntegrity()

    // Calcular o saldo esperado com base no saldo anterior e no PnL
    const expectedBalance = previousBalance + pnl

    // Calcular a diferença entre o saldo esperado e o atual
    const difference = currentBalance - expectedBalance

    // Calcular a tolerância em valor absoluto
    const toleranceAmount = (previousBalance * tolerance) / 100

    // Se a diferença for maior que a tolerância, pode haver uma movimentação não informada
    if (Math.abs(difference) > toleranceAmount) {
      return {
        detected: true,
        estimatedAmount: difference,
      }
    }

    return {
      detected: false,
      estimatedAmount: 0,
    }
  } catch (error) {
    console.error("Erro ao detectar movimentações não informadas:", error)
    return {
      detected: false,
      estimatedAmount: 0,
    }
  }
}

// Nova função para detectar movimentações da Binance não registradas
export const detectBinanceMovementsNotRegistered = async (connections: any[]): Promise<UnregisteredMovement[]> => {
  try {
    console.log("CapitalMovementService: Detecting Binance movements not registered")

    // Verificar se temos conexões válidas
    if (!connections || connections.length === 0) {
      console.log("CapitalMovementService: No connections available")
      return []
    }

    // Importar a API
    const { api } = await import("./api")

    // Buscar movimentações da Binance (depósitos e saques)
    const accountType = connections[0].accountType || "spot"
    const binanceMovements = await api.getBinanceCapitalMovements(connections, accountType, true)

    console.log(`CapitalMovementService: Retrieved ${binanceMovements.length} movements from Binance`)

    if (binanceMovements.length === 0) {
      return []
    }

    // Buscar movimentações já registradas no Supabase
    const { data: userData } = await supabase.auth.getUser()

    if (!userData.user) {
      console.error("CapitalMovementService: User not authenticated")
      return []
    }

    // Buscar movimentações dos últimos 7 dias
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const { data: registeredMovements, error } = await supabase
      .from("capital_movements")
      .select("*")
      .eq("user_id", userData.user.id)
      .gte("created_at", sevenDaysAgo.toISOString())

    if (error) {
      console.error("CapitalMovementService: Error fetching registered movements:", error)
      return []
    }

    // Converter para o formato adequado
    const registeredMovementsArray = registeredMovements as CapitalMovement[]

    console.log(`CapitalMovementService: Found ${registeredMovementsArray.length} registered movements in database`)

    // Verificar cada movimentação da Binance
    const unregisteredMovements: UnregisteredMovement[] = []

    for (const movement of binanceMovements) {
      // Verificar se esta movimentação já está registrada
      const isRegistered = registeredMovementsArray.some((rm) => {
        // Verificar por txId exato
        if (rm.binance_tx_id && movement.txId && rm.binance_tx_id === movement.txId) {
          return true
        }

        // Verificar por timestamp e valor aproximado (1% de tolerância)
        const timestampMatch =
          rm.binance_timestamp && Math.abs(rm.binance_timestamp - movement.timestamp) < 24 * 60 * 60 * 1000 // 24 horas

        const amountMatch = Math.abs(rm.amount - movement.amount) / movement.amount < 0.01 // 1% de tolerância

        return timestampMatch && amountMatch && rm.type === movement.type
      })

      // Adicionar à lista se não estiver registrada
      if (!isRegistered) {
        unregisteredMovements.push({
          id: movement.id,
          amount: movement.amount,
          type: movement.type,
          timestamp: movement.timestamp,
          coin: movement.coin,
          txId: movement.txId,
          source: "binance",
          alreadyRegistered: false,
        })
      }
    }

    console.log(`CapitalMovementService: Found ${unregisteredMovements.length} unregistered Binance movements`)
    return unregisteredMovements
  } catch (error) {
    console.error("CapitalMovementService: Error detecting Binance movements:", error)
    return []
  }
}

// Função para registrar automaticamente uma movimentação da Binance
export const registerBinanceMovement = async (movement: UnregisteredMovement): Promise<boolean> => {
  try {
    // Verificar se a movimentação já está registrada
    if (movement.alreadyRegistered) {
      console.log("CapitalMovementService: Movement already registered, skipping")
      return true
    }

    // Registrar a movimentação
    const success = await registerCapitalMovement({
      amount: movement.amount,
      type: movement.type,
      description: `${movement.type === "deposit" ? "Depósito" : "Saque"} automático de ${movement.coin} (Binance)`,
      reported_by: "system",
      source: "binance",
      binance_tx_id: movement.txId,
      binance_timestamp: movement.timestamp,
    })

    if (success) {
      console.log(`CapitalMovementService: Successfully registered Binance ${movement.type}`)
    } else {
      console.error(`CapitalMovementService: Failed to register Binance ${movement.type}`)
    }

    return success
  } catch (error) {
    console.error("CapitalMovementService: Error registering Binance movement:", error)
    return false
  }
}

// Função para obter a última movimentação de capital
export const getLastCapitalMovement = async (): Promise<CapitalMovement | null> => {
  try {
    const { data: userData } = await supabase.auth.getUser()

    if (!userData.user) {
      console.error("Usuário não autenticado")
      return null
    }

    const { data, error } = await supabase
      .from("capital_movements")
      .select("*")
      .eq("user_id", userData.user.id)
      .order("created_at", { ascending: false })
      .limit(1)

    if (error) {
      console.error("Erro ao buscar última movimentação:", error)
      return null
    }

    if (!data || data.length === 0) {
      return null
    }

    return data[0] as CapitalMovement
  } catch (error) {
    console.error("Erro ao buscar última movimentação:", error)
    return null
  }
}

// Função para obter a tolerância de alerta baseada no nível de risco
export const getAlertToleranceByRiskLevel = async (): Promise<number> => {
  try {
    // Importar o store
    const { useAppStore } = await import("../store")
    const { selectedRiskLevel } = useAppStore.getState()

    // Definir tolerância com base no nível de risco
    switch (selectedRiskLevel) {
      case "Conservative":
        return 1.0 // 1%
      case "Moderate":
        return 2.0 // 2%
      case "Aggressive":
        return 5.0 // 5%
      default:
        return 2.0 // Padrão: 2%
    }
  } catch (error) {
    console.error("Erro ao obter tolerância de alerta:", error)
    return 2.0 // Valor padrão em caso de erro
  }
}
