"use client"

import type React from "react"
import { useState } from "react"
import { Wallet } from "lucide-react"
import CapitalMovementModal from "./CapitalMovementModal"

interface CapitalMovementButtonProps {
  onSuccess?: () => void
}

const CapitalMovementButton: React.FC<CapitalMovementButtonProps> = ({ onSuccess = () => {} }) => {
  const [isModalOpen, setIsModalOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className="flex items-center gap-2 px-3 py-2 bg-violet-900/20 hover:bg-violet-900/30 border border-violet-700/30 rounded-lg transition-colors"
      >
        <Wallet size={16} className="text-violet-400" />
        <span className="text-sm font-medium text-gray-200">Registrar Movimentação</span>
      </button>

      <CapitalMovementModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSuccess={onSuccess} />
    </>
  )
}

export default CapitalMovementButton
