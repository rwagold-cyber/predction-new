import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { createWallet, getCTFContract, getPositionId, formatUSDC } from '../lib/ethers';
import { USDC_ADDRESS } from '../lib/contracts';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

interface RedeemablePosition {
  marketId: string;
  conditionId: string;
  outcome: number;
  outcomeName: string;
  balance: string;
  balanceRaw: bigint;
  redeemableValue: string;
  timeframe: number;
}

interface Market {
  id: string;
  conditionId: string;
  resolved: boolean;
  winningOutcome: number | null;
  timeframe: number;
}

interface RedemptionPanelProps {
  account: { label: string; address: string; privateKey: string } | null;
}

export default function RedemptionPanel({ account }: RedemptionPanelProps) {
  const [redeemablePositions, setRedeemablePositions] = useState<RedeemablePosition[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(false);
  const [redeeming, setRedeeming] = useState<string | null>(null);

  useEffect(() => {
    loadMarkets();
  }, []);

  useEffect(() => {
    if (account && markets.length > 0) {
      loadRedeemablePositions();
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

  const loadRedeemablePositions = async () => {
    if (!account) return;

    setLoading(true);
    console.log('[RedemptionPanel] Loading redeemable positions for:', account.address);

    try {
      const wallet = createWallet(account.privateKey);
      const ctf = getCTFContract(wallet);

      const redeemable: RedeemablePosition[] = [];

      // Filter only resolved markets
      const resolvedMarkets = markets.filter((m) => m.resolved && m.winningOutcome !== null);

      console.log('[RedemptionPanel] Found', resolvedMarkets.length, 'resolved markets');

      for (const market of resolvedMarkets) {
        console.log(`[RedemptionPanel] Checking Market ${market.id}, winner: ${market.winningOutcome === 0 ? 'DOWN' : 'UP'}`);

        // Check both outcomes
        for (let outcome = 0; outcome <= 1; outcome++) {
          const positionId = getPositionId(market.conditionId, outcome);
          const balance = await ctf.balanceOf(account.address, positionId);

          console.log(`  ${outcome === 0 ? 'DOWN' : 'UP'} balance:`, formatUSDC(balance), 'tokens', balance > 0n && outcome === market.winningOutcome ? '✅ WINNER' : '');

          // Only include winning positions with non-zero balance
          if (balance > 0n && outcome === market.winningOutcome) {
            redeemable.push({
              marketId: market.id,
              conditionId: market.conditionId,
              outcome: outcome,
              outcomeName: outcome === 1 ? 'UP' : 'DOWN',
              balance: formatUSDC(balance),
              balanceRaw: balance,
              redeemableValue: formatUSDC(balance), // 1:1 redemption
              timeframe: market.timeframe,
            });
          }
        }
      }

      console.log('[RedemptionPanel] Found', redeemable.length, 'redeemable positions');
      setRedeemablePositions(redeemable);
    } catch (error) {
      console.error('Failed to load redeemable positions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRedeem = async (position: RedeemablePosition) => {
    if (!account) return;

    setRedeeming(position.marketId);
    try {
      const wallet = createWallet(account.privateKey);
      const ctf = getCTFContract(wallet);

      console.log(`Redeeming position for market ${position.marketId}...`);

      // Call redeemPositions with both indexSets [1, 2]
      const tx = await ctf.redeemPositions(
        USDC_ADDRESS,
        position.conditionId,
        [1, 2] // Redeem both UP and DOWN positions
      );

      console.log('Redemption transaction sent:', tx.hash);
      await tx.wait();
      console.log('Redemption confirmed!');

      alert(`Successfully redeemed ${position.redeemableValue} USDC from Market #${position.marketId}`);

      // Reload positions after redemption
      await loadRedeemablePositions();
    } catch (error: any) {
      console.error('Redemption failed:', error);
      alert(`Redemption failed: ${error.message || error}`);
    } finally {
      setRedeeming(null);
    }
  };

  const totalRedeemable = redeemablePositions.reduce(
    (sum, pos) => sum + parseFloat(pos.redeemableValue),
    0
  );

  return (
    <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f0f8ff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <h3 style={{ margin: 0, color: '#2e7d32' }}>Redemption Center</h3>
        <button onClick={loadRedeemablePositions} style={{ padding: '5px 10px', fontSize: '12px' }} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {!account ? (
        <div style={{ textAlign: 'center', color: '#999', padding: '20px' }}>
          Select an account to view redeemable positions
        </div>
      ) : redeemablePositions.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#999', padding: '20px' }}>
          No positions ready for redemption
        </div>
      ) : (
        <>
          <div
            style={{
              padding: '12px',
              marginBottom: '15px',
              backgroundColor: '#e8f5e9',
              border: '2px solid #4CAF50',
              borderRadius: '8px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '14px', color: '#2e7d32', marginBottom: '5px' }}>
              Total Redeemable
            </div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1b5e20' }}>
              {totalRedeemable.toFixed(2)} USDC
            </div>
          </div>

          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            {redeemablePositions.map((position, idx) => (
              <div
                key={idx}
                style={{
                  padding: '15px',
                  marginBottom: '10px',
                  backgroundColor: 'white',
                  border: '2px solid #4CAF50',
                  borderRadius: '8px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ fontWeight: 'bold' }}>
                    Market #{position.marketId} - {position.timeframe}min
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
                    {position.outcomeName} ✅
                  </div>
                </div>

                <div style={{ fontSize: '14px', marginBottom: '12px' }}>
                  <div>Winning Balance: <strong>{position.balance} tokens</strong></div>
                  <div style={{ color: '#2e7d32', fontWeight: 'bold' }}>
                    Redeemable: <strong>{position.redeemableValue} USDC</strong>
                  </div>
                </div>

                <button
                  onClick={() => handleRedeem(position)}
                  disabled={redeeming !== null}
                  style={{
                    width: '100%',
                    padding: '10px',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    backgroundColor: redeeming === position.marketId ? '#ccc' : '#4CAF50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: redeeming !== null ? 'not-allowed' : 'pointer',
                  }}
                >
                  {redeeming === position.marketId ? 'Redeeming...' : `Redeem ${position.redeemableValue} USDC`}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
