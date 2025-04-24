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
}

// Função para registrar uma movimentação de capital
export const registerCapitalMovement = async (movement: Omit<CapitalMovement, "user_id">): Promise<boolean> => {
  try {
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
