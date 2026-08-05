// app/providers.tsx
'use client'

import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import SingleConnectionGuard from '@/components/common/SingleConnectionGuard'
import { StellarWalletProvider } from '@/contexts/StellarWalletProvider'
import { ToastProvider } from '@/components/toast/ToastProvider'

const queryClient = new QueryClient()

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <StellarWalletProvider>
          <SingleConnectionGuard
            onWinnerChange={(winner) => {
              console.log('Nova chain vencedora:', winner)
            }}
          />
          {children}
        </StellarWalletProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}
