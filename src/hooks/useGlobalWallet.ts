"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { createRhinestoneAccount } from "@rhinestone/sdk";
import { formatUnits } from "viem";

export interface TokenBalance {
  symbol: string;
  totalBalance: string;
  decimals: number;
  chains: Array<{
    chainId: number;
    chainName: string;
    balance: string;
    formattedBalance: string;
  }>;
}

export interface GlobalWalletState {
  rhinestoneAccount: any | null;
  accountAddress: string | null;
  portfolio: TokenBalance[];
  isLoading: boolean;
  error: string | null;
}

export function useGlobalWallet() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [state, setState] = useState<GlobalWalletState>({
    rhinestoneAccount: null,
    accountAddress: null,
    portfolio: [],
    isLoading: false,
    error: null,
  });

  const getChainName = (chainId: number): string => {
    const chainNames: { [key: number]: string } = {
      1: "Ethereum",
      42161: "Arbitrum",
      8453: "Base",
      137: "Polygon",
      10: "Optimism",
    };
    return chainNames[chainId] || `Chain ${chainId}`;
  };

  const initializeRhinestoneAccount = useCallback(async () => {
    if (!isConnected || !address || !walletClient) {
      setState((prev) => ({
        ...prev,
        rhinestoneAccount: null,
        accountAddress: null,
        portfolio: [],
        error: null,
      }));
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const apiKey = process.env.NEXT_PUBLIC_RHINESTONE_API_KEY;

      if (!apiKey) {
        throw new Error(
          "Rhinestone API key not configured. Please set NEXT_PUBLIC_RHINESTONE_API_KEY"
        );
      }

      const walletClientWithAddress = {
        ...walletClient,
        address: address,
      };

      // Use the connected wallet client
      const rhinestoneAccount = await createRhinestoneAccount({
        owners: {
          type: "ecdsa",
          accounts: [walletClientWithAddress as any],
        },
        rhinestoneApiKey: apiKey,
      });

      const accountAddress = rhinestoneAccount.getAddress();

      setState((prev) => ({
        ...prev,
        rhinestoneAccount,
        accountAddress,
        isLoading: false,
      }));

      // Fetch portfolio
      await fetchPortfolio(rhinestoneAccount);
    } catch (error) {
      console.error("Failed to initialize Rhinestone account:", error);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to initialize account",
      }));
    }
  }, [isConnected, address, walletClient]);

  const fetchPortfolio = useCallback(
    async (account?: any) => {
      const rhinestoneAccount = account || state.rhinestoneAccount;
      if (!rhinestoneAccount) return;

      try {
        setState((prev) => ({ ...prev, isLoading: true }));

        const portfolio = await rhinestoneAccount.getPortfolio();

        const formattedPortfolio: TokenBalance[] = portfolio
          .map((token: any) => {
            const totalBalance =
              token.balances.locked + token.balances.unlocked;
            const formattedTotal = formatUnits(totalBalance, token.decimals);

            const chains = token.chains
              .map((chain: any) => {
                const chainBalance = chain.locked + chain.unlocked;
                const formattedBalance = formatUnits(
                  chainBalance,
                  token.decimals
                );

                return {
                  chainId: chain.chain,
                  chainName: getChainName(chain.chain),
                  balance: chainBalance.toString(),
                  formattedBalance,
                };
              })
              .filter((chain: any) => BigInt(chain.balance) > BigInt(0));

            return {
              symbol: token.symbol,
              totalBalance: formattedTotal,
              decimals: token.decimals,
              chains,
            };
          })
          .filter((token: TokenBalance) => token.chains.length > 0);

        setState((prev) => ({
          ...prev,
          portfolio: formattedPortfolio,
          isLoading: false,
        }));
      } catch (error) {
        console.error("Failed to fetch portfolio:", error);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to fetch portfolio",
        }));
      }
    },
    [state.rhinestoneAccount]
  );

  const sendCrossChainTransaction = useCallback(
    async (
      sourceChains: any[],
      targetChain: any,
      calls: any[],
      tokenRequests: any[]
    ) => {
      if (!state.rhinestoneAccount) {
        throw new Error("Rhinestone account not initialized");
      }

      try {
        const transaction = await state.rhinestoneAccount.sendTransaction({
          sourceChains,
          targetChain,
          calls,
          tokenRequests,
        });

        // Wait for execution
        const result = await state.rhinestoneAccount.waitForExecution(
          transaction
        );

        // Refresh portfolio after transaction
        await fetchPortfolio();

        return { transaction, result };
      } catch (error) {
        console.error("Cross-chain transaction failed:", error);
        throw error;
      }
    },
    [state.rhinestoneAccount, fetchPortfolio]
  );

  useEffect(() => {
    initializeRhinestoneAccount();
  }, [initializeRhinestoneAccount]);

  return {
    ...state,
    refreshPortfolio: () => fetchPortfolio(),
    sendCrossChainTransaction,
  };
}
