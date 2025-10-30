import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { createWallet, getCTFContract, getPositionId, formatUSDC } from '../lib/ethers';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

interface Position {
  marketId: string;
  conditionId: string;
  outcome: number;
  outcomeName: string;
  balance: string;
  positionId: string;
}

interface Market {
  id: string;
  conditionId: string;
  resolved: boolean;
  winningOutcome: number | null;
  timeframe: number;
}

interface PositionPanelProps {
  account: { label: string; address: string; privateKey: string } | null;
}

export default function PositionPanel({ account }: PositionPanelProps) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadMarkets();
  }, []);

  useEffect(() => {
    if (account && markets.length > 0) {
      loadPositions();
    }
  }, [account, markets]);

  const loadMarkets = async () => {
    try {
      const response = await fetch(`${API_URL}/api/v1/markets`);
      const data = await response.json();
      if (data.success) {
        setMarkets(data.markets);
      }
    } catch (error) {
      console.error('Failed to load markets:', error);
    }
  };

  const loadPositions = async () => {
    if (!account) return;

    setLoading(true);
    console.log('[PositionPanel] Loading positions for:', account.address);
    console.log('[PositionPanel] Checking', markets.length, 'markets');

    try {
      const wallet = createWallet(account.privateKey);
      const ctf = getCTFContract(wallet);

      const allPositions: Position[] = [];

      for (const market of markets) {
        // Check DOWN position (outcome 0)
        const downPositionId = getPositionId(market.conditionId, 0);
        const downBalance = await ctf.balanceOf(account.address, downPositionId);

        console.log(`[PositionPanel] Market ${market.id} DOWN:`, formatUSDC(downBalance), 'tokens');

        if (downBalance > 0n) {
          allPositions.push({
            marketId: market.id,
            conditionId: market.conditionId,
            outcome: 0,
            outcomeName: 'DOWN',
            balance: formatUSDC(downBalance),
            positionId: downPositionId.toString(),
          });
        }

        // Check UP position (outcome 1)
        const upPositionId = getPositionId(market.conditionId, 1);
        const upBalance = await ctf.balanceOf(account.address, upPositionId);

        console.log(`[PositionPanel] Market ${market.id} UP:`, formatUSDC(upBalance), 'tokens');

        if (upBalance > 0n) {
          allPositions.push({
            marketId: market.id,
            conditionId: market.conditionId,
            outcome: 1,
            outcomeName: 'UP',
            balance: formatUSDC(upBalance),
            positionId: upPositionId.toString(),
          });
        }
      }

      console.log('[PositionPanel] Found', allPositions.length, 'positions');
      setPositions(allPositions);
    } catch (error) {
      console.error('Failed to load positions:', error);
    } finally {
      setLoading(false);
    }
  };

  const getMarketInfo = (marketId: string) => {
    const market = markets.find((m) => m.id === marketId);
    return market ? `Market #${marketId} - ${market.timeframe}min` : `Market #${marketId}`;
  };

  const getPositionValue = (position: Position) => {
    const market = markets.find((m) => m.id === position.marketId);
    if (!market || !market.resolved) return 'Pending';
    
    const isWinner = market.winningOutcome === position.outcome;
    return isWinner ? `${position.balance} USDC (WINNER)` : '0 USDC (LOSER)';
  };

  return (
    <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <h3 style={{ margin: 0 }}>My Positions (CTF)</h3>
        <button onClick={loadPositions} style={{ padding: '5px 10px', fontSize: '12px' }} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {!account ? (
        <div style={{ textAlign: 'center', color: '#999', padding: '20px' }}>
          Select an account to view positions
        </div>
      ) : positions.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#999', padding: '20px' }}>
          No positions found. Trade to create positions.
        </div>
      ) : (
        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
          {positions.map((position, idx) => {
            const market = markets.find((m) => m.id === position.marketId);
            const isResolved = market?.resolved;
            const isWinner = isResolved && market.winningOutcome === position.outcome;

            return (
              <div
                key={idx}
                style={{
                  padding: '15px',
                  marginBottom: '10px',
                  backgroundColor: isWinner ? '#e8f5e9' : 'white',
                  border: isWinner ? '2px solid #4CAF50' : '1px solid #ddd',
                  borderRadius: '8px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ fontWeight: 'bold' }}>
                    {getMarketInfo(position.marketId)}
                  </div>
                  <div
                    style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      backgroundColor: position.outcome === 1 ? '#4CAF50' : '#f44336',
                      color: 'white',
                    }}
                  >
                    {position.outcomeName}
                  </div>
                </div>

                <div style={{ fontSize: '14px', marginBottom: '8px' }}>
                  <div>Balance: <strong>{position.balance} tokens</strong></div>
                  {isResolved && (
                    <div style={{ color: isWinner ? '#2e7d32' : '#c62828', fontWeight: 'bold' }}>
                      Value: {getPositionValue(position)}
                    </div>
                  )}
                </div>

                <div style={{ fontSize: '11px', color: '#999', fontFamily: 'monospace' }}>
                  Position ID: {position.positionId.substring(0, 20)}...
                </div>

                {isResolved && isWinner && (
                  <div style={{ marginTop: '10px' }}>
                    <div style={{ fontSize: '12px', color: '#2e7d32', marginBottom: '5px' }}>
                      ✅ This position won! You can redeem for USDC.
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
