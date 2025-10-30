import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

interface Market {
  id: string;
  conditionId: string;
  startTime: number;
  endTime: number;
  resolved: boolean;
  winningOutcome: number | null;
  collateral: string;
  oracle: string;
  kind: number;
  timeframe: number;
}

interface MarketListProps {
  selectedMarket: Market | null;
  onSelectMarket: (market: Market) => void;
}

export default function MarketList({ selectedMarket, onSelectMarket }: MarketListProps) {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'resolved'>('all');

  useEffect(() => {
    loadMarkets();
    const interval = setInterval(loadMarkets, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadMarkets = async () => {
    try {
      const response = await fetch(`${API_URL}/api/v1/markets`);
      const data = await response.json();
      if (data.success) {
        setMarkets(data.markets);
      }
    } catch (error) {
      console.error('Failed to load markets:', error);
    } finally {
      setLoading(false);
    }
  };

  const getMarketStatus = (market: Market): string => {
    const now = Date.now() / 1000;
    if (market.resolved) return 'resolved';
    if (now < market.startTime) return 'pending';
    if (now < market.endTime) return 'active';
    return 'expired';
  };

  const getCountdown = (market: Market): string => {
    const now = Date.now() / 1000;
    if (market.resolved) return 'Resolved';

    let targetTime: number;
    let label: string;

    if (now < market.startTime) {
      targetTime = market.startTime;
      label = 'Starts in';
    } else if (now < market.endTime) {
      targetTime = market.endTime;
      label = 'Ends in';
    } else {
      return 'Awaiting resolution';
    }

    const remaining = targetTime - now;
    const minutes = Math.floor(remaining / 60);
    const seconds = Math.floor(remaining % 60);

    return `${label} ${minutes}m ${seconds}s`;
  };

  const filteredMarkets = markets.filter((m) => {
    if (filter === 'all') return true;
    const status = getMarketStatus(m);
    if (filter === 'active') return status === 'active' || status === 'pending';
    if (filter === 'resolved') return status === 'resolved';
    return true;
  });

  return (
    <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <h2 style={{ margin: 0 }}>Markets</h2>
        <button onClick={loadMarkets} style={{ padding: '5px 10px', fontSize: '12px' }}>
          Refresh
        </button>
      </div>

      <div style={{ marginBottom: '15px', display: 'flex', gap: '10px' }}>
        <button
          onClick={() => setFilter('all')}
          style={{
            padding: '8px 16px',
            backgroundColor: filter === 'all' ? '#2196F3' : '#eee',
            color: filter === 'all' ? 'white' : 'black',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          All ({markets.length})
        </button>
        <button
          onClick={() => setFilter('active')}
          style={{
            padding: '8px 16px',
            backgroundColor: filter === 'active' ? '#4CAF50' : '#eee',
            color: filter === 'active' ? 'white' : 'black',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Active ({markets.filter((m) => !m.resolved && Date.now() / 1000 < m.endTime).length})
        </button>
        <button
          onClick={() => setFilter('resolved')}
          style={{
            padding: '8px 16px',
            backgroundColor: filter === 'resolved' ? '#9E9E9E' : '#eee',
            color: filter === 'resolved' ? 'white' : 'black',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Resolved ({markets.filter((m) => m.resolved).length})
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '20px' }}>Loading markets...</div>
      ) : filteredMarkets.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px', color: '#666' }}>
          No markets found. Create one using Market Creator.
        </div>
      ) : (
        <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
          {filteredMarkets.map((market) => {
            const status = getMarketStatus(market);
            const isSelected = selectedMarket?.id === market.id;

            return (
              <div
                key={market.id}
                onClick={() => onSelectMarket(market)}
                style={{
                  padding: '15px',
                  marginBottom: '10px',
                  border: isSelected ? '2px solid #2196F3' : '1px solid #ddd',
                  borderRadius: '8px',
                  backgroundColor: isSelected ? '#e3f2fd' : 'white',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = '#f5f5f5';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = 'white';
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '16px' }}>
                    Market #{market.id} - {market.timeframe}min
                  </div>
                  <div
                    style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      backgroundColor:
                        status === 'active'
                          ? '#4CAF50'
                          : status === 'pending'
                          ? '#FF9800'
                          : status === 'resolved'
                          ? '#9E9E9E'
                          : '#f44336',
                      color: 'white',
                    }}
                  >
                    {status.toUpperCase()}
                  </div>
                </div>

                <div style={{ fontSize: '14px', color: '#666', marginBottom: '5px' }}>
                  {getCountdown(market)}
                </div>

                {market.resolved && (
                  <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#2196F3' }}>
                    Winner: {market.winningOutcome === 0 ? 'DOWN' : 'UP'}
                  </div>
                )}

                <div style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>
                  Start: {new Date(market.startTime * 1000).toLocaleString()}
                  <br />
                  End: {new Date(market.endTime * 1000).toLocaleString()}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
