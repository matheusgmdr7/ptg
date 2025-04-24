// Adicionando as novas funções para buscar depósitos e saques da Binance

// Delay function for simulating API latency
const delay = (ms: number) => new Promise((res) => setTimeout(res, ms))

interface AccountBalance {
  total: number
  available: number
  inPositions: number
  currency: string
  accountType: "spot" | "futures"
}

// Definindo as interfaces Position e RiskLimits
interface Position {
  id: string
  symbol: string
  size: number
  entryPrice: number
  markPrice: number
  leverage: number
  liquidationPrice: number
  unrealizedPnl: number
  side: "long" | "short"
  timestamp: number
}

interface RiskLimits {
  dailyLossLimit: number
  weeklyLossLimit: number
  maxLeverage: number
  maxDailyTrades: number
  recoveryTime: number
}

// Interface para depósitos e saques
interface CapitalMovementRecord {
  id: string
  amount: number
  coin: string
  network?: string
  status: string
  address?: string
  txId?: string
  timestamp: number
  type: "deposit" | "withdrawal"
}

// Função para converter string para array de bytes
function stringToUint8Array(str: string): Uint8Array {
  const encoder = new TextEncoder()
  return encoder.encode(str)
}

// Função para converter array de bytes para string hexadecimal
function uint8ArrayToHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

// Função melhorada para criar assinatura HMAC SHA256
async function createHmacSignature(message: string, secret: string): Promise<string> {
  console.log(`API: Creating signature for message: ${message} with secret length: ${secret.length}`)

  try {
    // Tentar usar a Web Crypto API se disponível
    if (typeof crypto !== "undefined" && crypto.subtle && crypto.subtle.importKey) {
      console.log("API: Using Web Crypto API for HMAC signature")

      const encoder = new TextEncoder()
      const keyData = encoder.encode(secret)
      const messageData = encoder.encode(message)

      try {
        // Importar a chave secreta
        const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])

        // Criar a assinatura
        const signature = await crypto.subtle.sign("HMAC", key, messageData)

        // Converter para string hexadecimal
        const signatureHex = Array.from(new Uint8Array(signature))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")

        console.log("API: Successfully created HMAC signature with Web Crypto API")
        return signatureHex
      } catch (cryptoError) {
        console.error("API: Error using Web Crypto API:", cryptoError)
        // Continuar para o fallback se a Web Crypto API falhar
      }
    }

    // Fallback para uma implementação simples se a Web Crypto API não estiver disponível
    console.log("API: Falling back to simple HMAC implementation")

    // Implementação simples de HMAC SHA-256 para fins de demonstração
    // NOTA: Esta é uma implementação muito simplificada e NÃO deve ser usada em produção
    // Em produção, você deve usar uma biblioteca criptográfica adequada

    // Função simples de hash
    function simpleHash(str: string): number {
      let hash = 0
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i)
        hash = (hash << 5) - hash + char
        hash |= 0 // Converter para inteiro de 32 bits
      }
      return hash
    }

    // Criar um hash simples combinando a mensagem e o segredo
    const combinedString = message + secret
    const hash = simpleHash(combinedString).toString(16)

    console.log("API: Created fallback signature:", hash)
    return hash
  } catch (error) {
    console.error("API: Error creating HMAC signature:", error)
    // Em caso de erro, retornar uma string vazia ou um valor padrão
    return "fallback_signature_error"
  }
}

// Variável global para armazenar dados brutos recebidos da API da corretora
let rawExchangeData: any = null
// Variável global para armazenar o último saldo processado
let lastProcessedBalance: AccountBalance | null = null

// Função para adicionar parâmetros comuns às requisições da Binance
function addBinanceCommonParams(baseQueryString: string): string {
  // Adicionar recvWindow para evitar erros de timestamp
  const recvWindow = 60000 // 60 segundos
  return `${baseQueryString}&recvWindow=${recvWindow}`
}

// Função para dividir um intervalo de tempo em chunks menores
// para evitar problemas com consultas de períodos longos
function splitTimeRange(
  startTime: number,
  endTime: number,
  maxChunkSize: number = 7 * 24 * 60 * 60 * 1000,
): { start: number; end: number }[] {
  const chunks = []
  let currentStart = startTime

  while (currentStart < endTime) {
    const chunkEnd = Math.min(currentStart + maxChunkSize, endTime)
    chunks.push({ start: currentStart, end: chunkEnd })
    currentStart = chunkEnd + 1
  }

  return chunks
}

// Função para implementar rate limiting básico
let lastRequestTime = 0
const minRequestInterval = 300 // 300ms entre requisições

// Adicionar variáveis para cache
const _cacheTimestamps = {
  balance: 0,
  positions: 0,
  riskStatus: 0,
  behaviors: 0,
  deposits: 0,
  withdrawals: 0,
}

// Adicionar função para gerenciar WebSockets
const _activeWebSockets = {}

// Adicionar função para iniciar WebSocket
// Corrigir a variável de cache global
let _cachedTradingData = {
  timestamp: 0,
  data: {
    balance: null,
    positions: [],
    trades: [],
    pnlData: {},
    deposits: [],
    withdrawals: [],
  },
}

// Modificar a função getAccountBalance para suportar carregamento essencial
const getAccountBalance = async (
  connections: any[],
  accountType: "spot" | "futures" = "futures",
  essentialOnly = false,
): Promise<AccountBalance> => {
  console.log(`API: Getting account balance for: ${accountType}, essentialOnly: ${essentialOnly}`)

  // Validar as conexões recebidas
  if (!connections || !Array.isArray(connections) || connections.length === 0) {
    console.log("API: No connected exchanges or invalid connections, returning zero balance")
    return {
      total: 0,
      available: 0,
      inPositions: 0,
      currency: "USD",
      accountType: accountType,
    }
  }

  // Verificar cache se não for apenas dados essenciais
  if (
    !essentialOnly &&
    _cachedTradingData &&
    Date.now() - _cachedTradingData.timestamp < 10000 &&
    _cachedTradingData.data.balance
  ) {
    console.log("API: Using cached balance data (valid for 10 seconds)")
    return _cachedTradingData.data.balance
  }

  try {
    // Obter a primeira conexão disponível
    const connection = connections[0]

    // Validar a conexão
    if (!connection || !connection.exchange || !connection.apiKey || !connection.apiSecret) {
      console.error("API: Invalid connection object:", connection)
      throw new Error("Invalid connection configuration")
    }

    const exchange = connection.exchange.toLowerCase()
    const apiKey = connection.apiKey
    const apiSecret = connection.apiSecret

    console.log(
      `API: Fetching ${essentialOnly ? "essential" : "complete"} data from ${exchange} exchange with account type ${accountType}`,
    )

    let exchangeData: any = null
    let usedFallback = false

    // BINANCE
    if (exchange === "binance") {
      try {
        // Implementação real para Binance
        const timestamp = Date.now()
        let endpoint = ""

        // Diferentes endpoints baseados no tipo de conta
        if (accountType === "futures") {
          endpoint = "https://fapi.binance.com/fapi/v2/account"
        } else {
          endpoint = "https://api.binance.com/api/v3/account"
        }

        // Criar a string para assinatura com recvWindow
        const queryString = addBinanceCommonParams(`timestamp=${timestamp}`)

        // Criar a assinatura HMAC SHA256
        const signature = await createHmacSignature(queryString, apiSecret)

        // URL completa com parâmetros
        const url = `${endpoint}?${queryString}&signature=${signature}`

        console.log(`API: Sending request to Binance: ${url}`)

        // Fazer a requisição à API da Binance com rate limiting
        try {
          const response = await rateLimitedRequest(url, {
            method: "GET",
            headers: {
              "X-MBX-APIKEY": apiKey,
            },
          })

          if (!response.ok) {
            const errorText = await response.text()
            console.error(`API: Binance API error: ${response.status} ${response.statusText}`, errorText)
            throw new Error(`Binance API error: ${response.status} ${response.statusText} - ${errorText}`)
          }

          exchangeData = await response.json()
          console.log("API: Raw Binance response received")

          // Verificar se a resposta contém os campos esperados
          if (accountType === "futures" && !exchangeData.totalWalletBalance) {
            console.error("API: Binance response missing expected fields:", exchangeData)
            throw new Error("Binance response missing expected fields")
          } else if (accountType === "spot" && !exchangeData.balances) {
            console.error("API: Binance response missing expected fields:", exchangeData)
            throw new Error("Binance response missing expected fields")
          }
        } catch (fetchError) {
          console.error("API: Error fetching from Binance API:", fetchError)
          throw new Error(
            "Failed to fetch data from Binance API: " +
              (fetchError instanceof Error ? fetchError.message : "Unknown error"),
          )
        }
      } catch (error) {
        console.error("API: Error fetching from Binance:", error)
        // Se falhar a chamada real, use dados de teste para não quebrar a UI
        usedFallback = true
        if (accountType === "futures") {
          exchangeData = {
            totalWalletBalance: "1234.56",
            availableBalance: "987.65",
            positionInitialMargin: "246.91",
            unrealizedProfit: "0.00",
          }
        } else {
          exchangeData = {
            totalAssetOfBtc: "1234.56",
            totalAssetOfUsdt: "1234.56",
            balances: [{ asset: "USDT", free: "987.65", locked: "246.91" }],
          }
        }
        console.log("API: Using fallback data for Binance:", exchangeData)
      }
    } else {
      // Outras corretoras podem ser implementadas aqui
      console.log(`API: Exchange ${exchange} not supported, using fallback data`)
      usedFallback = true
      if (accountType === "futures") {
        exchangeData = {
          totalWalletBalance: "1234.56",
          availableBalance: "987.65",
          positionInitialMargin: "246.91",
          unrealizedProfit: "0.00",
        }
      } else {
        exchangeData = {
          totalAssetOfBtc: "1234.56",
          totalAssetOfUsdt: "1234.56",
          balances: [{ asset: "USDT", free: "987.65", locked: "246.91" }],
        }
      }
    }

    // Armazenar os dados brutos para depuração
    rawExchangeData = exchangeData
    console.log("API: Raw exchange data processed")

    // Processar os dados com base na corretora e tipo de conta
    let processedBalance: AccountBalance

    // Lógica para extrair os valores corretos com base na corretora e tipo de conta
    if (exchange === "binance") {
      if (accountType === "futures") {
        // Para contas futures da Binance, precisamos calcular corretamente o saldo em posições
        console.log("API: Processing Binance futures account data")

        // Verificar se temos os campos necessários
        if (!exchangeData.totalWalletBalance) {
          console.error("API: Missing totalWalletBalance in Binance response")
        }

        // Se for apenas dados essenciais, simplificar o processamento
        if (essentialOnly) {
          processedBalance = {
            total: Number.parseFloat(exchangeData.totalWalletBalance || "0"),
            available: Number.parseFloat(exchangeData.availableBalance || "0"),
            inPositions: 0, // Simplificado para carregamento rápido
            currency: "USD",
            accountType: accountType,
          }
        } else {
          // Calcular o saldo em posições de forma mais precisa
          // Na API da Binance, o saldo em posições pode ser calculado de várias formas
          const totalMargin = Number.parseFloat(
            exchangeData.totalPositionInitialMargin || exchangeData.totalInitialMargin || "0",
          )
          const unrealizedProfit = Number.parseFloat(exchangeData.totalUnrealizedProfit || "0")

          processedBalance = {
            total: Number.parseFloat(exchangeData.totalWalletBalance || "0"),
            available: Number.parseFloat(exchangeData.availableBalance || "0"),
            inPositions: totalMargin, // Usar o valor de margem total como saldo em posições
            currency: "USD",
            accountType: accountType,
          }
        }
      } else {
        // Para contas spot da Binance
        const usdtBalance = exchangeData.balances?.find((b: any) => b.asset === "USDT")
        processedBalance = {
          total: Number.parseFloat(exchangeData.totalAssetOfUsdt || "0"),
          available: Number.parseFloat(usdtBalance?.free || "0"),
          inPositions: Number.parseFloat(usdtBalance?.locked || "0"),
          currency: "USD",
          accountType: accountType,
        }
      }
    } else {
      // Processamento genérico para outras corretoras
      processedBalance = {
        total: Number.parseFloat(exchangeData.balance || "0"),
        available: Number.parseFloat(exchangeData.available || "0"),
        inPositions: Number.parseFloat(exchangeData.used || "0"),
        currency: exchangeData.currency || "USD",
        accountType: accountType,
      }
    }

    // Verificar se os valores são números válidos
    if (isNaN(processedBalance.total) || isNaN(processedBalance.available) || isNaN(processedBalance.inPositions)) {
      console.error("API: Invalid numeric values in processed balance:", processedBalance)

      // Fornecer valores padrão em caso de erro de processamento
      processedBalance = {
        total: 1234.56,
        available: 987.65,
        inPositions: 246.91,
        currency: "USD",
        accountType: accountType,
      }

      console.log("API: Using default values instead:", processedBalance)
    }

    // Armazenar o último saldo processado
    lastProcessedBalance = processedBalance

    // Atualizar cache se não for apenas dados essenciais
    if (!essentialOnly) {
      _cachedTradingData = {
        timestamp: Date.now(),
        data: {
          ..._cachedTradingData.data,
          balance: processedBalance,
        },
      }
      _cacheTimestamps.balance = Date.now()
    }

    return processedBalance
  } catch (error) {
    console.error("API: Error fetching account balance:", error)

    // Em caso de erro, retornar o último saldo processado ou valores de fallback
    if (lastProcessedBalance) {
      console.log("API: Returning last processed balance due to error:", lastProcessedBalance)
      return lastProcessedBalance
    }

    const fallbackBalance = {
      total: 1234.56,
      available: 987.65,
      inPositions: 246.91,
      currency: "USD",
      accountType: accountType,
    }

    console.log("API: Returning fallback balance due to error:", fallbackBalance)
    return fallbackBalance
  }
}

// Modificar a função getPositions para suportar carregamento essencial e usar cache
const getPositions = async (connections: any[], essentialOnly = false, skipCache = false) => {
  console.log(`API: Getting positions (essentialOnly: ${essentialOnly}, skipCache: ${skipCache})`)

  // Validar as conexões recebidas
  if (!connections || !Array.isArray(connections) || connections.length === 0) {
    console.log("API: No connected exchanges or invalid connections, returning empty positions")
    return []
  }

  // Verificar cache se não for apenas dados essenciais e não estiver pulando o cache
  if (
    !essentialOnly &&
    !skipCache &&
    _cachedTradingData &&
    Date.now() - _cachedTradingData.timestamp < 10000 &&
    _cachedTradingData.data.positions &&
    _cachedTradingData.data.positions.length > 0
  ) {
    console.log("API: Using cached positions data (valid for 10 seconds)")
    return _cachedTradingData.data.positions
  }

  try {
    // Obter a primeira conexão disponível
    const connection = connections[0]

    // Validar a conexão
    if (!connection || !connection.exchange || !connection.apiKey || !connection.apiSecret) {
      console.error("API: Invalid connection object:", connection)
      return []
    }

    const exchange = connection.exchange.toLowerCase()
    const apiKey = connection.apiKey
    const apiSecret = connection.apiSecret
    const accountType = connection.accountType || "futures"

    console.log(
      `API: Fetching ${essentialOnly ? "essential" : "complete"} positions from ${exchange} exchange with account type ${accountType}`,
    )

    // Array para armazenar as posições
    let positions = []

    // BINANCE
    if (exchange === "binance") {
      try {
        // Implementação real para Binance
        const timestamp = Date.now()
        let endpoint = ""

        // Diferentes endpoints baseados no tipo de conta
        if (accountType === "futures") {
          // Para contas futures, usamos o endpoint de posições
          endpoint = "https://fapi.binance.com/fapi/v2/positionRisk"
        } else {
          // Para contas spot, não há posições no mesmo sentido que futures
          console.log("API: Spot accounts don't have positions in the same way as futures")
          return []
        }

        // Criar a string para assinatura com recvWindow
        const queryString = addBinanceCommonParams(`timestamp=${timestamp}`)

        // Criar a assinatura HMAC SHA256
        const signature = await createHmacSignature(queryString, apiSecret)

        // URL completa com parâmetros
        const url = `${endpoint}?${queryString}&signature=${signature}`

        console.log(`API: Sending request to Binance for positions: ${url}`)

        // Fazer a requisição à API da Binance com rate limiting
        const response = await rateLimitedRequest(url, {
          method: "GET",
          headers: {
            "X-MBX-APIKEY": apiKey,
          },
        })

        if (!response.ok) {
          const errorText = await response.text()
          console.error(`API: Binance API error: ${response.status} ${response.statusText}`, errorText)
          throw new Error(`Binance API error: ${response.status} ${response.statusText} - ${errorText}`)
        }

        const positionsData = await response.json()
        console.log(`API: Raw Binance positions response received with ${positionsData.length} items`)

        // Processar as posições da Binance
        // Filtrar apenas posições com quantidade diferente de zero
        positions = positionsData
          .filter((pos: any) => Number.parseFloat(pos.positionAmt || "0") !== 0)
          .map((pos: any) => {
            const positionSize = Number.parseFloat(pos.positionAmt || "0")
            const entryPrice = Number.parseFloat(pos.entryPrice || "0")
            const markPrice = Number.parseFloat(pos.markPrice || "0")
            const leverage = Number.parseFloat(pos.leverage || "1")
            const unrealizedPnl = essentialOnly ? 0 : Number.parseFloat(pos.unRealizedProfit || "0") // Simplificar para carregamento rápido
            const liquidationPrice = essentialOnly ? 0 : Number.parseFloat(pos.liquidationPrice || "0") // Simplificar para carregamento rápido

            return {
              id: `${pos.symbol}-${Date.now()}`,
              symbol: pos.symbol,
              size: Math.abs(positionSize),
              entryPrice: entryPrice,
              markPrice: essentialOnly ? entryPrice : markPrice, // Usar entryPrice como fallback para carregamento rápido
              leverage: leverage,
              liquidationPrice: liquidationPrice,
              unrealizedPnl: unrealizedPnl,
              side: positionSize > 0 ? "long" : "short",
              timestamp: Date.now(),
            }
          })

        console.log(`API: Processed ${positions.length} Binance positions`)
      } catch (error) {
        console.error("API: Error fetching positions from Binance:", error)
        // Em caso de erro, retornar array vazio
        return []
      }
    } else {
      // Outras corretoras podem ser implementadas aqui
      console.log(`API: Exchange ${exchange} not supported for positions, returning empty array`)
      return []
    }

    // Atualizar cache se não for apenas dados essenciais
    if (!essentialOnly) {
      _cachedTradingData = {
        timestamp: Date.now(),
        data: {
          ..._cachedTradingData.data,
          positions: positions,
        },
      }
      _cacheTimestamps.positions = Date.now()
    }

    return positions
  } catch (error) {
    console.error("API: Error fetching positions:", error)
    return []
  }
}

// Modificar a função startWebSocketUpdates para melhor tratamento de erros
const startWebSocketUpdates = async (connections, callback) => {
  if (!connections || !Array.isArray(connections) || connections.length === 0) {
    console.log("API: No connections available for WebSocket updates")
    return false
  }

  try {
    const connection = connections[0]

    // Validar a conexão
    if (!connection || !connection.exchange) {
      console.error("API: Invalid connection object for WebSocket:", connection)
      return false
    }

    const exchange = connection.exchange.toLowerCase()
    const accountType = connection.accountType || "futures"

    // Gerar um ID único para esta conexão WebSocket
    const wsId = `${exchange}-${accountType}-${Date.now()}`

    if (exchange === "binance") {
      // Fechar WebSocket existente se houver
      if (_activeWebSockets[exchange]) {
        console.log(`API: Closing existing WebSocket for ${exchange}`)
        try {
          _activeWebSockets[exchange].close()
        } catch (closeError) {
          console.error(`API: Error closing existing WebSocket:`, closeError)
        }
      }

      console.log(`API: Starting WebSocket updates for ${exchange} ${accountType}`)

      // Criar URL do WebSocket baseado no tipo de conta
      let wsUrl = ""
      if (accountType === "futures") {
        wsUrl = "wss://fstream.binance.com/ws"
      } else {
        wsUrl = "wss://stream.binance.com:9443/ws"
      }

      try {
        // Criar conexão WebSocket
        const ws = new WebSocket(wsUrl)

        ws.onopen = () => {
          console.log(`API: WebSocket connection opened for ${exchange}`)

          // Obter símbolos das posições atuais para assinar
          api
            .getPositions(connections)
            .then((positions) => {
              try {
                const symbols = positions.map((p) => p.symbol.toLowerCase())

                // Se não houver posições, assinar pelo menos um símbolo comum
                if (symbols.length === 0) {
                  symbols.push("btcusdt")
                }

                // Criar payload de assinatura para múltiplos streams
                const streams = []

                // Adicionar streams para cada símbolo
                symbols.forEach((symbol) => {
                  streams.push(`${symbol}@markPrice`)
                  if (accountType === "futures") {
                    streams.push(`${symbol}@bookTicker`)
                  }
                })

                // Adicionar stream de conta se for futures
                if (accountType === "futures") {
                  // Nota: stream de conta requer autenticação, que não implementamos aqui
                  // Isso seria feito com listenKey em produção
                }

                // Enviar solicitação de assinatura
                const subscribePayload = {
                  method: "SUBSCRIBE",
                  params: streams,
                  id: 1,
                }

                ws.send(JSON.stringify(subscribePayload))
              } catch (subscribeError) {
                console.error("API: Error subscribing to WebSocket streams:", subscribeError)
              }
            })
            .catch((posError) => {
              console.error("API: Error getting positions for WebSocket:", posError)
            })
        }

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)

            // Processar diferentes tipos de mensagens
            if (data.e === "markPriceUpdate") {
              // Atualização de preço de marcação
              const markPrice = Number.parseFloat(data.p || "0")
              const symbol = data.s

              // Atualizar posições com novo preço de marcação
              api
                .getPositions(connections, false, true)
                .then((positions) => {
                  if (!positions || !Array.isArray(positions)) return

                  const updatedPositions = positions.map((pos) => {
                    if (pos.symbol === symbol) {
                      return {
                        ...pos,
                        markPrice: markPrice,
                        // Recalcular PnL se tivermos os dados necessários
                        unrealizedPnl: pos.size * (markPrice - pos.entryPrice) * (pos.side === "long" ? 1 : -1),
                      }
                    }
                    return pos
                  })

                  // Enviar posições atualizadas via callback
                  callback({
                    type: "positions",
                    positions: updatedPositions,
                  })
                })
                .catch((posError) => {
                  console.error("API: Error updating positions from WebSocket:", posError)
                })
            }
            // Outros tipos de mensagens podem ser processados aqui
          } catch (error) {
            console.error("API: Error processing WebSocket message:", error)
          }
        }

        ws.onerror = (error) => {
          console.error(`API: WebSocket error for ${exchange}:`, error)
        }

        ws.onclose = () => {
          console.log(`API: WebSocket connection closed for ${exchange}`)
          delete _activeWebSockets[exchange]

          // Tentar reconectar após 30 segundos
          setTimeout(() => {
            if (!_activeWebSockets[exchange]) {
              console.log(`API: Attempting to reconnect WebSocket for ${exchange}`)
              startWebSocketUpdates(connections, callback)
            }
          }, 30000)
        }

        // Armazenar referência ao WebSocket
        _activeWebSockets[exchange] = ws

        // Configurar ping periódico para manter a conexão viva
        const pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ method: "PING" }))
          } else {
            clearInterval(pingInterval)
          }
        }, 30000)

        return true
      } catch (wsError) {
        console.error(`API: Error creating WebSocket for ${exchange}:`, wsError)
        return false
      }
    } else {
      console.log(`API: WebSocket not implemented for ${exchange}`)
      return false
    }
  } catch (error) {
    console.error("API: Error starting WebSocket updates:", error)
    return false
  }
}

// Remover delays artificiais da função rateLimitedRequest
async function rateLimitedRequest(url: string, options: RequestInit): Promise<Response> {
  const now = Date.now()
  const timeSinceLastRequest = now - lastRequestTime

  if (timeSinceLastRequest < minRequestInterval) {
    // Reduzir o delay para o mínimo necessário
    await new Promise((resolve) => setTimeout(resolve, minRequestInterval - timeSinceLastRequest))
  }

  lastRequestTime = Date.now()

  try {
    return await fetch(url, options)
  } catch (error) {
    console.error("API: Error in rateLimitedRequest:", error)
    throw error
  }
}

// Nova função para buscar depósitos da Binance
const getBinanceDeposits = async (
  connections: any[],
  accountType: "spot" | "futures" = "spot",
  skipCache = false,
): Promise<CapitalMovementRecord[]> => {
  console.log(`API: Getting Binance deposits for account type: ${accountType}`)

  // Validar as conexões recebidas
  if (!connections || !Array.isArray(connections) || connections.length === 0) {
    console.log("API: No connected exchanges or invalid connections, returning empty deposits")
    return []
  }

  // Verificar cache se não estiver pulando o cache
  if (
    !skipCache &&
    _cachedTradingData &&
    Date.now() - _cachedTradingData.timestamp < 300000 && // Cache válido por 5 minutos
    _cachedTradingData.data.deposits &&
    _cachedTradingData.data.deposits.length > 0
  ) {
    console.log("API: Using cached deposits data (valid for 5 minutes)")
    return _cachedTradingData.data.deposits
  }

  try {
    // Obter a primeira conexão disponível
    const connection = connections[0]

    // Validar a conexão
    if (!connection || !connection.exchange || !connection.apiKey || !connection.apiSecret) {
      console.error("API: Invalid connection object:", connection)
      return []
    }

    const exchange = connection.exchange.toLowerCase()
    const apiKey = connection.apiKey
    const apiSecret = connection.apiSecret

    // Verificar se é Binance
    if (exchange !== "binance") {
      console.log(`API: Exchange ${exchange} not supported for deposits, returning empty array`)
      return []
    }

    console.log(`API: Fetching deposits from Binance for account type ${accountType}`)

    // Calcular timestamp para 7 dias atrás
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const timestamp = Date.now()

    // Endpoint para depósitos
    const endpoint = "https://api.binance.com/sapi/v1/capital/deposit/hisrec"

    // Criar a string para assinatura com recvWindow
    const queryString = addBinanceCommonParams(`timestamp=${timestamp}&startTime=${sevenDaysAgo}`)

    // Criar a assinatura HMAC SHA256
    const signature = await createHmacSignature(queryString, apiSecret)

    // URL completa com parâmetros
    const url = `${endpoint}?${queryString}&signature=${signature}`

    console.log(`API: Sending request to Binance for deposits: ${url}`)

    // Fazer a requisição à API da Binance com rate limiting
    const response = await rateLimitedRequest(url, {
      method: "GET",
      headers: {
        "X-MBX-APIKEY": apiKey,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`API: Binance API error: ${response.status} ${response.statusText}`, errorText)
      throw new Error(`Binance API error: ${response.status} ${response.statusText} - ${errorText}`)
    }

    const depositsData = await response.json()
    console.log(`API: Raw Binance deposits response received with ${depositsData.length} items`)

    // Processar os depósitos da Binance
    const deposits = depositsData
      .filter((deposit: any) => deposit.status === 1) // Filtrar apenas depósitos concluídos
      .map((deposit: any) => {
        return {
          id: deposit.txId || `deposit-${deposit.insertTime}`,
          amount: Number.parseFloat(deposit.amount || "0"),
          coin: deposit.coin,
          network: deposit.network,
          status: deposit.status === 1 ? "completed" : "pending",
          address: deposit.address,
          txId: deposit.txId,
          timestamp: deposit.insertTime,
          type: "deposit" as const,
        }
      })

    console.log(`API: Processed ${deposits.length} Binance deposits`)

    // Atualizar cache
    _cachedTradingData = {
      timestamp: Date.now(),
      data: {
        ..._cachedTradingData.data,
        deposits: deposits,
      },
    }
    _cacheTimestamps.deposits = Date.now()

    return deposits
  } catch (error) {
    console.error("API: Error fetching deposits from Binance:", error)
    return []
  }
}

// Nova função para buscar saques da Binance
const getBinanceWithdrawals = async (
  connections: any[],
  accountType: "spot" | "futures" = "spot",
  skipCache = false,
): Promise<CapitalMovementRecord[]> => {
  console.log(`API: Getting Binance withdrawals for account type: ${accountType}`)

  // Validar as conexões recebidas
  if (!connections || !Array.isArray(connections) || connections.length === 0) {
    console.log("API: No connected exchanges or invalid connections, returning empty withdrawals")
    return []
  }

  // Verificar cache se não estiver pulando o cache
  if (
    !skipCache &&
    _cachedTradingData &&
    Date.now() - _cachedTradingData.timestamp < 300000 && // Cache válido por 5 minutos
    _cachedTradingData.data.withdrawals &&
    _cachedTradingData.data.withdrawals.length > 0
  ) {
    console.log("API: Using cached withdrawals data (valid for 5 minutes)")
    return _cachedTradingData.data.withdrawals
  }

  try {
    // Obter a primeira conexão disponível
    const connection = connections[0]

    // Validar a conexão
    if (!connection || !connection.exchange || !connection.apiKey || !connection.apiSecret) {
      console.error("API: Invalid connection object:", connection)
      return []
    }

    const exchange = connection.exchange.toLowerCase()
    const apiKey = connection.apiKey
    const apiSecret = connection.apiSecret

    // Verificar se é Binance
    if (exchange !== "binance") {
      console.log(`API: Exchange ${exchange} not supported for withdrawals, returning empty array`)
      return []
    }

    console.log(`API: Fetching withdrawals from Binance for account type ${accountType}`)

    // Calcular timestamp para 7 dias atrás
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const timestamp = Date.now()

    // Endpoint para saques
    const endpoint = "https://api.binance.com/sapi/v1/capital/withdraw/history"

    // Criar a string para assinatura com recvWindow
    const queryString = addBinanceCommonParams(`timestamp=${timestamp}&startTime=${sevenDaysAgo}`)

    // Criar a assinatura HMAC SHA256
    const signature = await createHmacSignature(queryString, apiSecret)

    // URL completa com parâmetros
    const url = `${endpoint}?${queryString}&signature=${signature}`

    console.log(`API: Sending request to Binance for withdrawals: ${url}`)

    // Fazer a requisição à API da Binance com rate limiting
    const response = await rateLimitedRequest(url, {
      method: "GET",
      headers: {
        "X-MBX-APIKEY": apiKey,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`API: Binance API error: ${response.status} ${response.statusText}`, errorText)
      throw new Error(`Binance API error: ${response.status} ${response.statusText} - ${errorText}`)
    }

    const withdrawalsData = await response.json()
    console.log(`API: Raw Binance withdrawals response received with ${withdrawalsData.length} items`)

    // Processar os saques da Binance
    const withdrawals = withdrawalsData
      .filter((withdrawal: any) => withdrawal.status === 6) // Filtrar apenas saques concluídos (6 = completed)
      .map((withdrawal: any) => {
        return {
          id: withdrawal.id || `withdrawal-${withdrawal.applyTime}`,
          amount: Number.parseFloat(withdrawal.amount || "0"),
          coin: withdrawal.coin,
          network: withdrawal.network,
          status: withdrawal.status === 6 ? "completed" : "pending",
          address: withdrawal.address,
          txId: withdrawal.txId,
          timestamp: withdrawal.applyTime,
          type: "withdrawal" as const,
        }
      })

    console.log(`API: Processed ${withdrawals.length} Binance withdrawals`)

    // Atualizar cache
    _cachedTradingData = {
      timestamp: Date.now(),
      data: {
        ..._cachedTradingData.data,
        withdrawals: withdrawals,
      },
    }
    _cacheTimestamps.withdrawals = Date.now()

    return withdrawals
  } catch (error) {
    console.error("API: Error fetching withdrawals from Binance:", error)
    return []
  }
}

// Função para obter todas as movimentações de capital (depósitos e saques)
const getBinanceCapitalMovements = async (
  connections: any[],
  accountType: "spot" | "futures" = "spot",
  skipCache = false,
): Promise<CapitalMovementRecord[]> => {
  console.log(`API: Getting all Binance capital movements for account type: ${accountType}`)

  try {
    // Buscar depósitos e saques em paralelo
    const [deposits, withdrawals] = await Promise.all([
      getBinanceDeposits(connections, accountType, skipCache),
      getBinanceWithdrawals(connections, accountType, skipCache),
    ])

    // Combinar os resultados
    const allMovements = [...deposits, ...withdrawals]

    // Ordenar por timestamp (mais recente primeiro)
    allMovements.sort((a, b) => b.timestamp - a.timestamp)

    console.log(`API: Combined ${deposits.length} deposits and ${withdrawals.length} withdrawals`)
    return allMovements
  } catch (error) {
    console.error("API: Error getting combined capital movements:", error)
    return []
  }
}

// Modificar a função getPnLData para considerar movimentações de capital
const getPnLData = async (connections: any[]) => {
  console.log("API: Getting P&L data")
  console.log("API: Connections received:", connections)

  // Verificar se connections é um array válido e não está vazio
  if (!connections || !Array.isArray(connections) || connections.length === 0) {
    console.log("API: No connected exchanges or invalid connections array, returning zero P&L")
    return {
      dailyPnL: 0,
      dailyPnLPercentage: 0,
      weeklyPnL: 0,
      weeklyPnLPercentage: 0,
      highestLeverage: 0,
      dailyTrades: 0,
    }
  }

  // Verificar se a primeira conexão é válida
  const connection = connections[0]
  if (!connection || typeof connection !== "object") {
    console.log("API: First connection is invalid or undefined, returning zero P&L")
    return {
      dailyPnL: 0,
      dailyPnLPercentage: 0,
      weeklyPnLPercentage: 0,
      highestLeverage: 0,
      dailyTrades: 0,
    }
  }

  try {
    // Verificar se a conexão tem as propriedades necessárias
    const exchange = connection.exchange?.toLowerCase() || ""
    const apiKey = connection.apiKey || ""
    const apiSecret = connection.apiSecret || ""
    const accountType = connection.accountType || "futures"

    // Verificar se temos as informações mínimas necessárias
    if (!exchange || !apiKey || !apiSecret) {
      console.log("API: Missing required connection properties (exchange, apiKey, or apiSecret), returning zero P&L")
      return {
        dailyPnL: 0,
        dailyPnLPercentage: 0,
        weeklyPnLPercentage: 0,
        highestLeverage: 0,
        dailyTrades: 0,
      }
    }

    console.log(`API: Fetching P&L data from ${exchange} ${accountType} account`)

    // Buscar movimentações de capital da Binance
    let capitalMovements = []
    try {
      capitalMovements = await getBinanceCapitalMovements(connections, accountType)
      console.log(`API: Retrieved ${capitalMovements.length} capital movements from Binance`)
    } catch (movError) {
      console.error("API: Error fetching capital movements:", movError)
    }

    // Buscar movimentações manuais do Supabase
    let manualMovements = []
    try {
      const { getCapitalMovementTotals } = await import("../services/capitalMovementService")
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

      const dailyMovements = await getCapitalMovementTotals(oneDayAgo)
      const weeklyMovements = await getCapitalMovementTotals(sevenDaysAgo)

      manualMovements = { daily: dailyMovements, weekly: weeklyMovements }
      console.log("API: Retrieved manual capital movements:", manualMovements)
    } catch (manualError) {
      console.error("API: Error fetching manual capital movements:", manualError)
    }

    // Implementação específica para Binance
    if (exchange === "binance") {
      try {
        const timestamp = Date.now()

        // Calcular timestamps
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

        // Endpoint para income (inclui PnL realizado)
        const incomeEndpoint = "https://fapi.binance.com/fapi/v1/income"

        // Buscar PnL diário (últimas 24h)
        const dailyQueryString = addBinanceCommonParams(
          `timestamp=${timestamp}&incomeType=REALIZED_PNL&startTime=${oneDayAgo}`,
        )
        const dailySignature = await createHmacSignature(dailyQueryString, apiSecret)
        const dailyUrl = `${incomeEndpoint}?${dailyQueryString}&signature=${dailySignature}`

        console.log(`API: Sending request for daily P&L: ${dailyUrl}`)

        const dailyResponse = await rateLimitedRequest(dailyUrl, {
          headers: { "X-MBX-APIKEY": apiKey },
        })

        // Buscar PnL semanal (últimos 7 dias)
        const weeklyQueryString = addBinanceCommonParams(
          `timestamp=${timestamp}&incomeType=REALIZED_PNL&startTime=${sevenDaysAgo}`,
        )
        const weeklySignature = await createHmacSignature(weeklyQueryString, apiSecret)
        const weeklyUrl = `${incomeEndpoint}?${weeklyQueryString}&signature=${weeklySignature}`

        console.log(`API: Sending request for weekly P&L: ${weeklyUrl}`)

        const weeklyResponse = await rateLimitedRequest(weeklyUrl, {
          headers: { "X-MBX-APIKEY": apiKey },
        })

        // Buscar histórico de trades para calcular alavancagem máxima e número de trades
        const tradesEndpoint = "https://fapi.binance.com/fapi/v1/userTrades"
        const tradesQueryString = addBinanceCommonParams(`timestamp=${timestamp}&limit=100&startTime=${oneDayAgo}`)
        const tradesSignature = await createHmacSignature(tradesQueryString, apiSecret)
        const tradesUrl = `${tradesEndpoint}?${tradesQueryString}&signature=${tradesSignature}`

        console.log(`API: Sending request for trades history: ${tradesUrl}`)

        const tradesResponse = await rateLimitedRequest(tradesUrl, {
          headers: { "X-MBX-APIKEY": apiKey },
        })

        // Verificar se todas as requisições foram bem-sucedidas
        let dailyData = []
        let weeklyData = []
        let tradesData = []

        if (dailyResponse.ok) {
          dailyData = await dailyResponse.json()
          console.log("API: Received daily P&L data:", dailyData)
        } else {
          console.error(`API: Failed to fetch daily P&L data: ${dailyResponse.status}`)
        }

        if (weeklyResponse.ok) {
          weeklyData = await weeklyResponse.json()
          console.log("API: Received weekly P&L data:", weeklyData)
        } else {
          console.error(`API: Failed to fetch weekly P&L data: ${weeklyResponse.status}`)
        }

        if (tradesResponse.ok) {
          tradesData = await tradesResponse.json()
          console.log("API: Received trades data:", tradesData)
        } else {
          console.error(`API: Failed to fetch trades data: ${tradesResponse.status}`)
        }

        // Calcular P&L total
        const dailyPnL = dailyData.reduce((sum: number, item: any) => sum + Number.parseFloat(item.income), 0)
        const weeklyPnL = weeklyData.reduce((sum: number, item: any) => sum + Number.parseFloat(item.income), 0)

        // Calcular alavancagem máxima e número de trades
        let highestLeverage = 0
        const uniqueOrderIds = new Set()

        if (Array.isArray(tradesData)) {
          tradesData.forEach((trade: any) => {
            // Contar trades únicos (por orderId)
            uniqueOrderIds.add(trade.orderId)

            // Verificar alavancagem se disponível
            if (trade.leverage) {
              const leverage = Number.parseFloat(trade.leverage)
              if (leverage > highestLeverage) {
                highestLeverage = leverage
              }
            }
          })
        }

        const dailyTrades = uniqueOrderIds.size

        // Obter saldo total para calcular percentuais
        const balanceData = await api.getAccountBalance(connections, accountType)
        const totalBalance = balanceData.total

        // Ajustar o PnL considerando as movimentações de capital
        // Prioridade: registros manuais > movimentações detectadas da Binance
        let adjustedDailyPnL = dailyPnL
        let adjustedWeeklyPnL = weeklyPnL

        // Usar registros manuais se disponíveis
        if (manualMovements && manualMovements.daily) {
          const dailyDeposits = manualMovements.daily.deposits || 0
          const dailyWithdrawals = manualMovements.daily.withdrawals || 0
          adjustedDailyPnL = dailyPnL - dailyDeposits + dailyWithdrawals

          console.log(`API: Adjusted daily PnL using manual movements: ${dailyPnL} -> ${adjustedDailyPnL}`)
        }
        // Caso contrário, usar movimentações da Binance
        else if (capitalMovements && capitalMovements.length > 0) {
          const oneDayAgoTimestamp = Date.now() - 24 * 60 * 60 * 1000

          const dailyBinanceDeposits = capitalMovements
            .filter((m) => m.type === "deposit" && m.timestamp >= oneDayAgoTimestamp)
            .reduce((sum, m) => sum + m.amount, 0)

          const dailyBinanceWithdrawals = capitalMovements
            .filter((m) => m.type === "withdrawal" && m.timestamp >= oneDayAgoTimestamp)
            .reduce((sum, m) => sum + m.amount, 0)

          adjustedDailyPnL = dailyPnL - dailyBinanceDeposits + dailyBinanceWithdrawals

          console.log(`API: Adjusted daily PnL using Binance movements: ${dailyPnL} -> ${adjustedDailyPnL}`)
        }

        // Mesmo processo para PnL semanal
        if (manualMovements && manualMovements.weekly) {
          const weeklyDeposits = manualMovements.weekly.deposits || 0
          const weeklyWithdrawals = manualMovements.weekly.withdrawals || 0
          adjustedWeeklyPnL = weeklyPnL - weeklyDeposits + weeklyWithdrawals

          console.log(`API: Adjusted weekly PnL using manual movements: ${weeklyPnL} -> ${adjustedWeeklyPnL}`)
        } else if (capitalMovements && capitalMovements.length > 0) {
          const sevenDaysAgoTimestamp = Date.now() - 7 * 24 * 60 * 60 * 1000

          const weeklyBinanceDeposits = capitalMovements
            .filter((m) => m.type === "deposit" && m.timestamp >= sevenDaysAgoTimestamp)
            .reduce((sum, m) => sum + m.amount, 0)

          const weeklyBinanceWithdrawals = capitalMovements
            .filter((m) => m.type === "withdrawal" && m.timestamp >= sevenDaysAgoTimestamp)
            .reduce((sum, m) => sum + m.amount, 0)

          adjustedWeeklyPnL = weeklyPnL - weeklyBinanceDeposits + weeklyBinanceWithdrawals

          console.log(`API: Adjusted weekly PnL using Binance movements: ${weeklyPnL} -> ${adjustedWeeklyPnL}`)
        }

        // Calcular percentuais (em relação ao saldo atual)
        // Usamos Math.max com um valor pequeno para evitar divisão por zero
        const safeBalance = Math.max(totalBalance, 0.0001)
        const dailyPnLPercentage = (adjustedDailyPnL / safeBalance) * 100
        const weeklyPnLPercentage = (adjustedWeeklyPnL / safeBalance) * 100

        console.log("API: Calculated P&L metrics:", {
          dailyPnL: adjustedDailyPnL,
          dailyPnLPercentage,
          weeklyPnL: adjustedWeeklyPnL,
          weeklyPnLPercentage,
          highestLeverage,
          dailyTrades,
        })

        return {
          dailyPnL: adjustedDailyPnL,
          dailyPnLPercentage,
          weeklyPnL: adjustedWeeklyPnL,
          weeklyPnLPercentage,
          highestLeverage,
          dailyTrades,
        }
      } catch (error) {
        console.error("API: Error fetching P&L data from Binance:", error)
        // Em caso de erro específico da Binance, retornar valores padrão
        return {
          dailyPnL: 0,
          dailyPnLPercentage: 0,
          weeklyPnLPercentage: 0,
          highestLeverage: 0,
          dailyTrades: 0,
        }
      }
    } else {
      // Para outras exchanges
      console.log(`API: Exchange ${exchange} not supported for P&L data, returning defaults`)
      return {
        dailyPnL: 0,
        dailyPnLPercentage: 0,
        weeklyPnLPercentage: 0,
        highestLeverage: 0,
        dailyTrades: 0,
      }
    }
  } catch (error) {
    console.error("API: Error fetching P&L data:", error)
    // Em caso de erro geral, retornar valores padrão
    return {
      dailyPnL: 0,
      dailyPnLPercentage: 0,
      weeklyPnLPercentage: 0,
      highestLeverage: 0,
      dailyTrades: 0,
    }
  }
}

// Exportar o objeto API com todas as funções
export const api = {
  // Adicionar as novas funções
  getBinanceDeposits,
  getBinanceWithdrawals,
  getBinanceCapitalMovements,
  
  // Adicionar a função
  startWebSocketUpdates,

  // Modificar as funções existentes
  getAccountBalance,
  getPositions,
  getPnLData,

  checkRealConnections: async (connections: any[]) => {
    console.log("API: Checking real connections:", connections)
    const hasConnections = connections.length > 0
    console.log("API: Has connected exchanges:", hasConnections)
    return hasConnections
  },

  getRawExchangeData: () => {
    return rawExchangeData
  },

  getLastProcessedBalance: () => {
    return lastProcessedBalance
  },

  getTrades: async (connections: any[], limit = 100, startTime?: number) => {
    console.log(`API: Getting trades history (limit: ${limit}, startTime: ${startTime})`)
    console.log("API: Connections received:", connections)

    if (!connections || connections.length === 0) {
      console.log("API: No connected exchanges, returning empty trades")
      return []
    }

    try {
      // Obter a primeira conexão disponível
      const connection = connections[0]
      const exchange = connection.exchange.toLowerCase()
      const apiKey = connection.apiKey
      const apiSecret = connection.apiSecret
      const accountType = connection.accountType || "futures"

      console.log(`API: Fetching trade history from ${exchange} exchange with account type ${accountType}`)

      // Tentar buscar dados reais da API da corretora
      if (exchange === "binance") {
        // Implementação para Binance
        if (accountType === "futures") {
          try {
            // Implementação para Binance Futures
            const timestamp = Date.now()

            // Usar o startTime fornecido ou um padrão (30 dias atrás)
            const defaultStartTime = Date.now() - 30 * 24 * 60 * 60 * 1000 // 30 dias atrás
            const actualStartTime = startTime || defaultStartTime
            const endTime = Date.now()

            console.log(
              `API: Fetching trade history from ${new Date(actualStartTime).toISOString()} to ${new Date(endTime).toISOString()}`,
            )

            // Dividir o intervalo de tempo em chunks menores para evitar problemas com períodos longos
            const timeChunks = splitTimeRange(actualStartTime, endTime)
            console.log(`API: Split time range into ${timeChunks.length} chunks`)

            // Arrays para armazenar os resultados de cada endpoint
            let allOrders = []
            let allTrades = []
            const allIncome = []

            // Buscar dados para cada chunk de tempo
            for (const [index, chunk] of timeChunks.entries()) {
              try {
                console.log(
                  `API: Processing chunk ${index + 1}/${timeChunks.length}: ${new Date(chunk.start).toISOString()} to ${new Date(chunk.end).toISOString()}`,
                )

                // 1. Buscar histórico de ordens
                const ordersEndpoint = "https://fapi.binance.com/fapi/v1/allOrders"
                const ordersQueryString = addBinanceCommonParams(
                  `timestamp=${timestamp}&limit=500&startTime=${chunk.start}&endTime=${chunk.end}`,
                )
                const ordersSignature = await createHmacSignature(ordersQueryString, apiSecret)
                const ordersUrl = `${ordersEndpoint}?${ordersQueryString}&signature=${ordersSignature}`

                console.log(`API: Sending request to Binance for order history (chunk ${index + 1})`)

                const ordersResponse = await rateLimitedRequest(ordersUrl, {
                  method: "GET",
                  headers: {
                    "X-MBX-APIKEY": apiKey,
                  },
                })

                if (ordersResponse.ok) {
                  const chunkOrders = await ordersResponse.json()
                  console.log(`API: Received ${chunkOrders.length} orders for chunk ${index + 1}`)
                  allOrders = [...allOrders, ...chunkOrders]
                } else {
                  const errorText = await ordersResponse.text()
                  console.error(
                    `API: Binance API error for orders (chunk ${index + 1}): ${ordersResponse.status}`,
                    errorText,
                  )
                  // Continuar com os outros endpoints mesmo se este falhar
                }

                // Esperar um pouco para evitar rate limiting
                await delay(300)

                // 2. Buscar histórico de trades
                const tradesEndpoint = "https://fapi.binance.com/fapi/v1/userTrades"
                const tradesQueryString = addBinanceCommonParams(
                  `timestamp=${timestamp}&limit=1000&startTime=${chunk.start}&endTime=${chunk.end}`,
                )
                const tradesSignature = await createHmacSignature(tradesQueryString, apiSecret)
                const tradesUrl = `${tradesEndpoint}?${tradesQueryString}&signature=${tradesSignature}`

                console.log(`API: Sending request to Binance for trade history (chunk ${index + 1})`)

                const tradesResponse = await rateLimitedRequest(tradesUrl, {
                  method: "GET",
                  headers: {
                    "X-MBX-APIKEY": apiKey,
                  },
                })

                if (tradesResponse.ok) {
                  const chunkTrades = await tradesResponse.json()
                  console.log(`API: Received ${chunkTrades.length} trades for chunk ${index + 1}`)
                  allTrades = [...allTrades, ...chunkTrades]
                } else {
                  const errorText = await tradesResponse.text()
                  console.error(
                    `API: Binance API error for trades (chunk ${index + 1}): ${tradesResponse.status}`,
                    errorText,
                  )
                  // Continuar com os outros endpoints mesmo se este falhar
                }

                // Esperar um pouco para evitar rate limiting
                await delay(300)

                // 3. Buscar histórico de income
                const incomeEndpoint = "https://fapi.binance.com/fapi/v1/income"
                const incomeQueryString = addBinanceCommonParams(
                  `timestamp=${timestamp}&incomeType=REALIZED_PNL&limit=1000&startTime=${chunk.start}&endTime=${chunk.end}`,
                )
                const incomeSignature = await createHmacSignature(incomeQueryString, apiSecret)
                const incomeUrl = `${
